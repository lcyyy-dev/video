import { eventRecord } from './log-fields.mjs';
export { keyReference, errorCode } from './log-fields.mjs';

/** Runtime events go to PostgreSQL; stdout is an operational mirror. */
export function createEventLog({store, source='gateway', stdout=true, now=()=>new Date()}={}) {
  const emit=(event,fields={},level='info')=>{
    const lineId=source==='tunnel'&&event==='external.line'&&/^[a-f0-9]{32}$/.test(fields.lineId??'')?fields.lineId:null;
    const stableId=lineId?`${lineId.slice(0,8)}-${lineId.slice(8,12)}-${lineId.slice(12,16)}-${lineId.slice(16,20)}-${lineId.slice(20)}`:undefined;
    const row=eventRecord(source,event,fields,level,now(),stableId);
    if(stdout)process.stdout.write(JSON.stringify(row)+'\n');
    if(store)store.enqueue(row);
    return row;
  };
  emit.flush=async()=>{if(store)await store.flush();};
  return emit;
}
