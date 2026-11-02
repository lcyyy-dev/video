import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,appendFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEventLog,errorCode} from './logs.mjs';
import {monitorCycle,importExternalLogs,redactExternalLine} from './monitor.mjs';

test('event logging never accepts arbitrary payload fields',()=>{
 const events=[];const log=createEventLog({stdout:false,store:{enqueue:row=>events.push(row)}});
 log('request.complete',{licenseId:'user',apiKey:'secret',body:'private-prompt'});
 assert.equal(events.length,1);assert.equal(events[0].licenseId,'user');assert.ok(!JSON.stringify(events).includes('secret'));assert.ok(!JSON.stringify(events).includes('private-prompt'));
 assert.equal(errorCode({cause:{code:'ECONNRESET'}}),'ECONNRESET');
});

test('link monitoring distinguishes public path errors, local failures and HTTP impostors',async()=>{
 const events=[];const log=(event,fields,level)=>events.push({event,...fields,level});
 let mode='public-failed';
 const fetchImpl=async url=>{
  const local=String(url).includes('local.test');
  if(mode==='public-failed'&&!local)throw Object.assign(new Error('private detail'),{cause:{code:'ECONNRESET'}});
  if(mode==='local-failed'&&local)throw Object.assign(new Error('private detail'),{code:'ECONNREFUSED'});
  if(mode==='impostor'&&!local)return Response.json({ok:true});
  return Response.json({service:'openfilm-gateway',ok:true});
 };
 const config={localUrl:'http://local.test/healthz',publicUrl:'https://public.test/healthz',fetchImpl,log};
 assert.equal((await monitorCycle(config)).diagnosis,'public_path_unavailable');
 assert.ok(events.some(row=>row.errorCode==='ECONNRESET'&&row.target==='public'));
 mode='local-failed';assert.equal((await monitorCycle(config)).diagnosis,'local_gateway_unavailable');
 mode='impostor';assert.equal((await monitorCycle(config)).diagnosis,'public_path_unavailable');
 mode='ok';assert.equal((await monitorCycle(config)).diagnosis,'both_reachable');
 assert.equal((await monitorCycle({...config,publicUrl:''})).diagnosis,'public_not_configured');
 assert.ok(!JSON.stringify(events).includes('private detail'));
});

test('generic external log import resumes across restarts, handles partial lines and rotation, and redacts credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'external-logs-')),stateFile=join(dir,'cursor.json'),file=join(dir,'proxy.log');const events=[];
 let cursor=null;const store={dropped:0,state:async()=>cursor,setState:async(name,value)=>{cursor=JSON.parse(JSON.stringify(value));},flush:async()=>{}};
 const config={directory:dir,store,log:(event,fields,level)=>events.push({event,...fields,level})};
 try{
  writeFileSync(file,'2026/11/01 15:06:00 tunnel connected\n2026/11/02 09:41:36 timeout token=very-secret\npartial');
  assert.equal((await importExternalLogs(config)).lines,2);assert.equal((await importExternalLogs(config)).lines,0);
  assert.equal(events[1].level,'error');assert.ok(!events[1].message.includes('very-secret'));
  appendFileSync(file,' completed\n');assert.equal((await importExternalLogs(config)).lines,1);assert.equal(events.at(-1).message,'partial completed');
  renameSync(file,file+'.1');writeFileSync(file,'reconnected\n');assert.equal((await importExternalLogs(config)).lines,1);
  assert.ok(events.some(row=>row.sourceTime==='2026/11/02 09:41:36'));
  for(const raw of ['Authorization: Bearer secret','password="secret"','https://user:secret@example.test/?token=secret','{"apiKey":"secret"}'])assert.ok(!redactExternalLine(raw).includes('secret'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
