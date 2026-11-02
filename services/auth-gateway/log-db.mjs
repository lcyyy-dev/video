import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openLogStore} from './log-store.mjs';
import {eventRecord} from './log-fields.mjs';
import {legacyEvents} from './legacy-logs.mjs';

export async function migrateLegacyLogs(store,directory) {
  let batch=[],inserted=0,read=0;
  for await(const old of legacyEvents(directory)) {
    if(!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(old.id??'')||!Number.isFinite(Date.parse(old.time)))throw new Error('Invalid legacy event identity/time');
    batch.push(eventRecord(old.source,old.event,old,old.level,new Date(old.time),old.id));read++;
    if(batch.length===100){inserted+=await store.insertBatch(batch);batch=[];}
  }
  inserted+=await store.insertBatch(batch);
  try {
    const cursor=JSON.parse(readFileSync(join(directory,'external-cursor.json'),'utf8'));
    if(!await store.state('external-files'))await store.setState('external-files',cursor);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return {read,inserted};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const command=process.argv[2];if(!['init','migrate','status'].includes(command))throw new Error('Usage: node log-db.mjs init | migrate <legacy-log-dir> | status');
  const store=await openLogStore(process.env.LOG_DATABASE_URL,{initialize:command==='init'});
  try{if(command==='migrate'){if(!process.argv[3])throw new Error('Provide legacy log directory');console.log(JSON.stringify(await migrateLegacyLogs(store,process.argv[3])));}else console.log(JSON.stringify(await store.status()));}
  finally{await store.close();}
}
