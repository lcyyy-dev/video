import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGateway} from './server.mjs';
import {activateGateway,gatewayConfig,checkGatewayAuthorization,probeGatewayAuthorization} from '../../apps/desktop/src/sub2api-config.mjs';
import {authorizationController} from '../../apps/desktop/src/authorization-state.mjs';

test('real gateway rejection locks desktop IPC for suspended, expired, unbound and removed licenses while outages do not',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gateway-revocation-')),mappingFile=join(dir,'mappings.json');
 const mappings=()=>writeFileSync(mappingFile,JSON.stringify({license:{apiKey:'private-key'}}));mappings();
 let mode='active';
 const server=createGateway({secret:'s'.repeat(64),mappingFile,keygenUrl:'http://keygen/v1',keygenToken:'private-token',sub2apiUrl:'http://upstream/v1',log:()=>{},fetchImpl:async url=>{
  if(url.startsWith('http://keygen')){
   if(mode==='keygen-http-403')return Response.json({errors:[{code:'FORBIDDEN'}]},{status:403});
   if(mode==='invalid-keygen-body')return Response.json({});
   if(url.endsWith('validate-key'))return Response.json({data:{id:'license'},meta:{valid:true}});
   return Response.json({meta:{valid:mode==='active'||mode==='upstream-http-403',code:mode}});
  }
  if(mode==='upstream-http-403')return Response.json({error:{code:'LICENSE_REVOKED'}},{status:403,headers:{'x-openfilm-authorization':'revoked'}});
  return Response.json({data:[]});
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test'};
 const controller=authorizationController(()=>checkGatewayAuthorization(dir,storage));
 const storage={encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString(),onAuthorizationInvalidated:()=>controller.invalidate()};
 const activate=async()=>{mode='active';mappings();await controller.activate(()=>activateGateway(dir,{...endpoint,activationCode:'code'},storage));};
 try{
  for(const code of ['SUSPENDED','EXPIRED','FINGERPRINT_SCOPE_MISMATCH','NO_MACHINES','mapping-removed']){
   await activate();const cloud=gatewayConfig(dir,storage);assert.equal((await cloud.fetchImpl(endpoint.baseUrl+'/models')).status,200);
   mode=code;if(code==='mapping-removed')writeFileSync(mappingFile,'{}');
   const rejected=await cloud.fetchImpl(endpoint.baseUrl+'/models');assert.equal(rejected.status,403);assert.equal(rejected.headers.get('x-openfilm-authorization'),'revoked');
   assert.equal(controller.get(),false);assert.throws(()=>controller.guard('desktop:chat:send'),/激活/);assert.equal((await checkGatewayAuthorization(dir,storage)).authorized,false);
  }
  for(const transient of ['keygen-http-403','invalid-keygen-body','upstream-http-403']){
   await activate();const cloud=gatewayConfig(dir,storage);assert.equal((await cloud.fetchImpl(endpoint.baseUrl+'/models')).status,200);
   mode=transient;const failed=await cloud.fetchImpl(endpoint.baseUrl+'/models');assert.equal(failed.status,transient==='upstream-http-403'?403:503);
   assert.equal(controller.get(),true);assert.equal((await checkGatewayAuthorization(dir,storage)).authorized,true);
  }
  await activate();mode='SUSPENDED';await probeGatewayAuthorization(dir,storage);assert.equal(controller.get(),false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
