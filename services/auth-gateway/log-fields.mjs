import { createHash, randomUUID } from 'node:crypto';
export const keyReference = value => typeof value === 'string' && value ? createHash('sha256').update(value).digest('hex').slice(0, 16) : undefined;
export function errorCode(error) {
  const code = error?.cause?.code ?? error?.code ?? error?.name ?? 'Error';
  return /^[\w.-]{1,80}$/.test(String(code)) ? String(code) : 'Error';
}
const FIELDS = new Set(['requestId','method','path','stage','licenseId','keyRef','activationRef','fingerprint','peer','status','upstreamStatus','durationMs','firstByteMs','bytes','outcome','errorCode','target','probeId','localOk','publicOk','diagnosis','file','lineId','message','sourceTime','streamOutcome','reason','keygenCode']);

export function eventRecord(source,event,fields={},level='info',now=new Date(),id=randomUUID()) {
  if(!['gateway','monitor','tunnel','admin'].includes(source))throw new Error('Unknown log source');
  if(!['info','warn','error'].includes(level))throw new Error('Unknown log level');
  const row={time:now.toISOString(),id,source,event:String(event).slice(0,100),level};
  for(const [key,value] of Object.entries(fields)) {
    if(!FIELDS.has(key)||value===undefined||value===null)continue;
    if(typeof value==='string')row[key]=value.slice(0,key==='message'?1500:250);
    else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))row[key]=value;
  }
  return row;
}
