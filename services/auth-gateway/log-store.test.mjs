import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEventLog} from './logs.mjs';
import {eventRecord} from './log-fields.mjs';
import {PostgresLogStore,openLogStore} from './log-store.mjs';
import {testLogStore,hasTestDatabase} from './test-log-store.mjs';
import {migrateLegacyLogs} from './log-db.mjs';

test('PostgreSQL persists, filters, paginates and recovers state across new connections', {skip:!hasTestDatabase},async t=>{
 const store=await testLogStore(t);const log=createEventLog({store,stdout:false});
 for(let i=0;i<12;i++)log('request.complete',{licenseId:i%2?'alice':'bob',requestId:'request-'+i,status:i%2?502:200,path:'/v1/responses',apiKey:'private'},i%2?'error':'info');
 createEventLog({store,source:'monitor',stdout:false})('link.summary',{diagnosis:'both_reachable'});
 await store.flush();
 const first=await store.queryEvents(new URLSearchParams({scope:'calls',limit:'3'}));assert.equal(first.events.length,3);assert.ok(first.nextCursor);
 const second=await store.queryEvents(new URLSearchParams({scope:'calls',limit:'3',cursor:first.nextCursor}));assert.equal(second.events.length,3);assert.ok(!first.events.some(a=>second.events.some(b=>b.id===a.id)));
 assert.equal((await store.queryEvents(new URLSearchParams({license:'alice',errors:'true'}))).events.length,6);
 assert.equal((await store.queryEvents(new URLSearchParams({scope:'diagnostics'}))).events.length,1);
 assert.equal((await store.queryEvents(new URLSearchParams({request:'request-5'}))).events.length,1);
 assert.equal((await store.queryEvents(new URLSearchParams({q:"' OR 1=1 --"}))).events.length,0);
 assert.ok(!(JSON.stringify(first)).includes('private'));
 await assert.rejects(store.queryEvents(new URLSearchParams({from:'broken'})),{status:400});await assert.rejects(store.queryEvents(new URLSearchParams({cursor:'bad'})),{status:400});
 await store.setState('external-files',{offset:123});
 const fresh=await openLogStore(process.env.LOG_TEST_DATABASE_URL??process.env.LOG_DATABASE_URL,{schema:store.schemaName});
 try{assert.equal((await fresh.status()).eventCount,'13');assert.deepEqual(await fresh.state('external-files'),{offset:123});}finally{await fresh.close();}
 const rows=await store.pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname=$1`,[store.schemaName]);assert.ok(rows.rows.some(r=>r.indexname==='events_license_time_idx'));
});

test('legacy migration is idempotent and transfers cursor without modifying original files',{skip:!hasTestDatabase},async t=>{
 const store=await testLogStore(t),dir=mkdtempSync(join(tmpdir(),'legacy-import-'));
 try{
  const row=eventRecord('gateway','auth.activate',{licenseId:'legacy',apiKey:'must-not-import'});
  const file=join(dir,'2026-11-03.gateway.jsonl');const contents=JSON.stringify(row)+'\n';writeFileSync(file,contents);writeFileSync(join(dir,'external-cursor.json'),JSON.stringify({'proxy.log':{identity:'1:2',offset:3}}));
  assert.deepEqual(await migrateLegacyLogs(store,dir),{read:1,inserted:1});assert.deepEqual(await migrateLegacyLogs(store,dir),{read:1,inserted:0});
  assert.equal((await store.queryEvents()).events.length,1);assert.equal((await store.state('external-files'))['proxy.log'].offset,3);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('database outage retains queued events and retries without changing their identities',async()=>{
 const inserted=[];let unavailable=true;
 const pool={query:async(text,values)=>{if(unavailable)throw Object.assign(new Error('private connection details'),{code:'ECONNREFUSED'});if(text.startsWith('INSERT')){inserted.push(...JSON.parse(values[0]));return {rowCount:1};}return {rows:[],rowCount:0};},end:async()=>{}};
 const store=new PostgresLogStore({pool});const log=createEventLog({store,stdout:false});const row=log('request.complete',{licenseId:'user'});
 await assert.rejects(store.flush());assert.equal(store.queue.length,1);unavailable=false;await store.flush();assert.equal(store.queue.length,0);assert.equal(inserted[0].id,row.id);await store.close();
});
