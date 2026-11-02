import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openLogStore } from './log-store.mjs';
import { createEventLog, errorCode } from './logs.mjs';

/** External software is optional: only a directory of plain-text logs is read. */
export function redactExternalLine(line) {
  if (/PRIVATE KEY|CERTIFICATE|publicKey|refreshToken|accessToken|apiKey|activationCode|webui_pass|remote_management_key/i.test(line)) return '[含凭据的外部日志已省略]';
  return line.replace(/\b(Bearer|Basic)\s+\S+/gi,'$1 [redacted]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key|authorization|access[_-]?key)\b["']?\s*[:=]\s*["']?[^\s,;"']+/gi,'$1=[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@')
    .replace(/([?&](?:token|key|auth|password)=)[^&\s]+/gi,'$1[redacted]').slice(0,1500);
}
export async function probeGateway(url, {fetchImpl=fetch, timeoutMs=8000}={}) {
  const started=performance.now();
  try {
    const target=new URL(url);if(!['https:','http:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Object.assign(new Error('InvalidProbeUrl'),{code:'INVALID_PROBE_URL'});
    const response=await fetchImpl(target,{redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    // Bound the body and validate identity, rather than accepting an unrelated HTTP 200.
    let text='',bytes=0;const reader=response.body?.getReader();
    try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096)throw Object.assign(new Error('InvalidHealthBody'),{code:'HEALTH_BODY_TOO_LARGE'});text+=new TextDecoder().decode(value);}}finally{await reader?.cancel().catch(()=>{});}
    let body;try{body=JSON.parse(text);}catch{}
    const ok=response.ok&&body?.service==='openfilm-gateway'&&body?.ok===true;
    return {ok,status:response.status,durationMs:Math.round(performance.now()-started),...(ok?{}:{errorCode:'HEALTH_RESPONSE_INVALID'})};
  }catch(error){return {ok:false,durationMs:Math.round(performance.now()-started),errorCode:errorCode(error)};}
}
export async function monitorCycle({localUrl,publicUrl,fetchImpl=fetch,log,timeoutMs=8000}) {
  const probeId=randomUUID();
  const [local,remote]=await Promise.all([probeGateway(localUrl,{fetchImpl,timeoutMs}),publicUrl?probeGateway(publicUrl,{fetchImpl,timeoutMs}):null]);
  for(const [target,result] of [['local',local],['public',remote]])if(result)log('link.probe',{probeId,target,status:result.status,durationMs:result.durationMs,errorCode:result.errorCode,outcome:result.ok?'success':'failed'},result.ok?'info':'error');
  const diagnosis=!local.ok?'local_gateway_unavailable':!remote?'public_not_configured':!remote.ok?'public_path_unavailable':'both_reachable';
  log('link.summary',{probeId,localOk:local.ok,...(remote?{publicOk:remote.ok}:{}),diagnosis},!local.ok||remote&&!remote.ok?'error':'info');
  return {local,public:remote,diagnosis};
}

/** Tail external logs with a durable byte cursor, rotation detection and bounded reads. */
export async function importExternalLogs({directory,store,log,maxRead=1024*1024}) {
  if(!directory)return {files:0,lines:0};
  let state=await store.state('external-files')??{};
  const droppedBefore=store.dropped;
  const knownIdentities=new Map(Object.values(state).map(entry=>[entry.identity,entry]));
  const names=readdirSync(directory).filter(name=>/\.(log|txt)(?:\.\d+)?$/i.test(name)).sort().slice(-20);let count=0;
  for(const name of names){
    const file=join(directory,name),stat=statSync(file);if(!stat.isFile())continue;
    const identity=`${stat.dev}:${stat.ino}`;const previous=knownIdentities.get(identity);
    let offset=previous?.identity===identity&&stat.size>=previous.offset?previous.offset:Math.max(0,stat.size-maxRead);
    const isPartialStart=offset>0&&(!previous||previous.identity!==identity||stat.size<previous.offset);
    const length=Math.min(maxRead,stat.size-offset);if(!length){if(previous)state[name]=previous;continue;}
    const fd=openSync(file,'r');let bytes;try{const buffer=Buffer.alloc(length);const read=readSync(fd,buffer,0,length,offset);bytes=buffer.subarray(0,read);}finally{closeSync(fd);}
    const end=bytes.lastIndexOf(10);if(end<0){if(length===maxRead){state[name]={identity,offset:offset+length};log('external.line_skipped',{file:basename(name),errorCode:'LINE_TOO_LONG'},'warn');}continue;}
    const complete=bytes.subarray(0,end+1);let text=complete.toString('utf8');if(isPartialStart)text=text.slice(text.indexOf('\n')+1);
    let lineOffset=offset+(isPartialStart?complete.indexOf(10)+1:0);
    for(const rawLine of text.split('\n')){const line=rawLine.replace(/\r$/,'');if(line.trim()){
      const message=redactExternalLine(line);const level=/\b(error|fatal|fail(?:ed|ure)?|timeout|disconnect)\b|错误|失败|断开|超时/i.test(message)?'error':/\bwarn\b|重试|重连/i.test(message)?'warn':'info';
      const sourceTime=/\b(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2})/.exec(message)?.[1];
      const lineId=createHash('sha256').update(`${identity}:${lineOffset}:${line}`).digest('hex').slice(0,32);
      log('external.line',{file:basename(name),lineId,message,sourceTime},level);count++;if(count%100===0)await store.flush();
    }lineOffset+=Buffer.byteLength(rawLine)+1;}
    state[name]={identity,offset:offset+complete.length};
  }
  state=Object.fromEntries(Object.entries(state).filter(([name])=>names.includes(name)));
  await store.flush();
  if(store.dropped!==droppedBefore)throw Object.assign(new Error('External log batch exceeded database queue'),{code:'LOG_QUEUE_FULL'});
  await store.setState('external-files',state);
  return {files:names.length,lines:count};
}
export function startMonitor({store,localUrl,publicUrl,externalDir,intervalMs=30000,fetchImpl=fetch}) {
  const log=createEventLog({store,source:'monitor'}),externalLog=createEventLog({store,source:'tunnel'});let stopped=false,timer,running=Promise.resolve();
  const cycle=async()=>{
    try{await monitorCycle({localUrl,publicUrl,fetchImpl,log});}catch(error){log('monitor.error',{errorCode:errorCode(error)},'error');}
    try{if(externalDir)await importExternalLogs({directory:externalDir,store,log:externalLog});}catch(error){log('external.read_error',{errorCode:errorCode(error)},'error');}
    if(!stopped)timer=setTimeout(tick,Math.max(5000,intervalMs));
  };
  const tick=()=>{running=cycle();};
  log('monitor.started',{outcome:publicUrl?'public_enabled':'public_not_configured'});tick();
  return async()=>{stopped=true;clearTimeout(timer);await running;};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const store=await openLogStore(process.env.LOG_DATABASE_URL);
 const stop=startMonitor({store,localUrl:process.env.MONITOR_LOCAL_URL??'http://gateway:8787/healthz',publicUrl:process.env.MONITOR_PUBLIC_URL,externalDir:process.env.EXTERNAL_LOG_DIR,intervalMs:Number(process.env.MONITOR_INTERVAL_MS)||30000});
 const shutdown=async()=>{await stop();try{await store.close();process.exit(0);}catch{process.exit(1);}};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
