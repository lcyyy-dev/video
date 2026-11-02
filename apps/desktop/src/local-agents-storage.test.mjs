import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentSession} from './agents.mjs';
import {ProjectSession} from './project-session.mjs';
import {registerLocalAgentIpc} from './local-agents-ipc.mjs';
import {credentialStorage} from './credential-storage.mjs';
import {activateGateway} from './sub2api-config.mjs';

test('agent probe and project start read saved encrypted activation through the supplied native storage',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'of-agent-storage-')),dataDir=join(dir,'app'),root=join(dir,'project');mkdirSync(dataDir);mkdirSync(root);
 const storage=credentialStorage({dataDir,safeStorage:{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:value=>Buffer.from('os:'+value),decryptString:bytes=>bytes.toString().slice(3)}});
 await activateGateway(dataDir,{baseUrl:'http://127.0.0.1:8188/v1',model:'test',activationCode:'test'},storage,async()=>Response.json({refreshToken:'private-refresh'}));
 const sessions=[],closing=[];
 t.mock.method(AgentSession.prototype,'start',async function(){sessions.push(this);return {sessionId:'test-session',promptCapabilities:{}};});
 const originalClose=ProjectSession.prototype.close;
 t.mock.method(ProjectSession.prototype,'close',function(){const promise=originalClose.call(this);closing.push(promise);return promise;});
 const handlers=new Map(),sender=Object.assign(new EventEmitter(),{isDestroyed:()=>false,send:()=>{}});
 const manager=registerLocalAgentIpc({handle:(name,fn)=>handlers.set(name,fn)},{trusted:()=>true,videoSecurity:{dataDir,storage,projects:async()=>[root],projectFor:async()=>root}});
 const call=(name,opts)=>handlers.get('desktop:local-agents:'+name)({sender},opts);
 try{
  const probe=await call('probe',{agent:'codex'});assert.equal(probe.ok,true,probe.error);
  const started=await call('start',{agent:'codex',cwd:root});assert.equal(started.ok,true,started.error);
  assert.equal(sessions.length,2);assert.ok(sessions.every(session=>session.opts.storage===storage));
  const home=join(dataDir,'project-codex',createHash('sha256').update(root).digest('hex'));
  const config=readFileSync(join(home,'config.toml'),'utf8');assert.match(config,/model_provider = "openfilm"/);assert.ok(!config.includes('private-refresh'));
 }finally{manager.closeAll();await Promise.all(closing);rmSync(dir,{recursive:true,force:true});}
});
