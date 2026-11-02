import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,createHmac,generateKeyPairSync} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createGateway} from './server.mjs';
import {signedHeaders} from '../../apps/desktop/src/gateway-auth.mjs';

test('logs distinguish upstream timeouts, incomplete SSE, provider failures and downstream disconnects',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gateway-errors-')),mappingFile=join(dir,'mappings.json');writeFileSync(mappingFile,JSON.stringify({license:{apiKey:'private-user-key'}}));
 const secret='s'.repeat(64),device=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const fingerprint=createHash('sha256').update(device.publicKey).digest('hex');
 const payload=Buffer.from(JSON.stringify({kind:'access',license:'license',fingerprint,exp:Date.now()+60000})).toString('base64url');const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
 let mode='timeout';const events=[];
 const server=createGateway({secret,mappingFile,keygenUrl:'http://keygen/v1',keygenToken:'private-service-key',sub2apiUrl:'http://upstream/v1',log:(event,fields,level)=>events.push({event,...fields,level}),fetchImpl:async(url)=>{
  if(url.startsWith('http://keygen')){if(mode==='keygen-timeout')throw Object.assign(new Error('private-service-key'),{name:'TimeoutError'});return Response.json({meta:{valid:true}});}
  if(mode==='timeout')throw Object.assign(new Error('private-user-key'),{cause:{code:'ETIMEDOUT'}});
  if(mode==='incomplete')return new Response('data: {"type":"response.output_text.delta","delta":"private-prompt"}\n\n',{headers:{'content-type':'text/event-stream'}});
  if(mode==='failed')return new Response('data: {"type":"response.failed"}\n\n',{headers:{'content-type':'text/event-stream'}});
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));}}),{headers:{'content-type':'text/event-stream'}});
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const request=()=>{const body=JSON.stringify({model:'test',input:'private-prompt',stream:true});return fetch(origin+'/v1/responses',{method:'POST',headers:{...signedHeaders(device,'POST','/v1/responses',body,token),authorization:'Bearer '+token},body});};
 try{
  const timeout=await request();assert.equal(timeout.status,502);await timeout.text();assert.ok(events.some(row=>row.event==='upstream.error'&&row.stage==='sub2api'&&row.errorCode==='ETIMEDOUT'));
  mode='keygen-timeout';const keygen=await request();assert.equal(keygen.status,502);await keygen.text();assert.ok(events.some(row=>row.event==='upstream.keygen_error'&&row.errorCode==='TimeoutError'));
  mode='incomplete';await(await request()).text();assert.ok(events.some(row=>row.event==='request.complete'&&row.outcome==='incomplete'&&row.level==='error'));
  mode='failed';await(await request()).text();assert.ok(events.some(row=>row.event==='request.complete'&&row.streamOutcome==='failed'&&row.outcome==='failed'));
  mode='disconnect';const response=await request(),reader=response.body.getReader();await reader.read();await reader.cancel();
  for(let i=0;i<50&&!events.some(row=>row.outcome==='disconnected');i++)await delay(10);
  const disconnected=events.find(row=>row.outcome==='disconnected');assert.ok(disconnected);assert.equal(disconnected.errorCode,'CLIENT_CONNECTION_CLOSED');assert.equal(disconnected.licenseId,'license');
  for(const value of ['private-user-key','private-service-key','private-prompt',token])assert.ok(!JSON.stringify(events).includes(value));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
