import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {AgentSession} from './agents.mjs';
import {ProjectSession} from './project-session.mjs';
import {activateGateway} from './sub2api-config.mjs';
import {saveTemplate} from './edit-workflow.mjs';
import {initialTemplate} from './edit-template.mjs';

const exec=promisify(execFile);
const runtime=fileURLToPath(new URL('../.dev/runtime/ffmpeg/',import.meta.url));
const binary=name=>join(runtime,process.platform==='win32'?name+'.exe':name);
test('openfilm narrate uses session capability, gateway TTS and bundled FFprobe without a system FFprobe', {skip:!existsSync(binary('ffmpeg'))||!existsSync(binary('ffprobe'))},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'session-narration-')),root=join(dir,'project'),dataDir=join(dir,'app');mkdirSync(root);mkdirSync(dataDir);
 const sample=join(dir,'voice.mp3');execFileSync(binary('ffmpeg'),['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','24000',sample]);
 const storage={encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString()};
 await activateGateway(dataDir,{baseUrl:'https://gateway.test/v1',model:'test',activationCode:'code'},storage,async()=>Response.json({refreshToken:'private-refresh'}));
 saveTemplate(root,{...initialTemplate(),narration:true,bodyText:'原生配音测试。'});
 const originalFetch=globalThis.fetch;let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).startsWith('https://gateway.test/')){
   if(String(url).endsWith('/auth/refresh'))return Response.json({accessToken:'access',expiresAt:Date.now()+300000});
   assert.equal(String(url),'https://gateway.test/tts/synthesize');assert.equal(JSON.parse(options.body).text,'原生配音测试。');calls++;
   return Response.json({audio:readFileSync(sample).toString('base64'),format:'mp3',words:[]});
  }
  return originalFetch(url,options);
 });
 t.mock.method(AgentSession.prototype,'start',async()=>({sessionId:'test'}));
 const session=new ProjectSession({agent:'codex',cwd:root,dataDir,storage,fallbackDir:runtime,env:{PATH:join(dir,'empty-path')}});
 try{
  await session.start();
  const command=fileURLToPath(new URL('../../../packages/openfilm/bin/openfilm.mjs',import.meta.url));
  const {stdout}=await exec(process.execPath,[command,'narrate'],{cwd:root,env:{...process.env,...session.opts.env}});
  const manifest=JSON.parse(stdout);assert.equal(manifest.sentences.length,1);assert.equal(manifest.sentences[0].text,'原生配音测试。');assert.ok(manifest.duration>=1&&manifest.duration<1.2);
  assert.ok(existsSync(resolve(root,manifest.sentences[0].src)));assert.ok(existsSync(join(root,'.film/narration.json')));assert.equal(calls,1);
  await exec(process.execPath,[command,'narrate'],{cwd:root,env:{...process.env,...session.opts.env}});assert.equal(calls,1,'retry reuses completed audio');
 }finally{await session.close();rmSync(dir,{recursive:true,force:true});}
});
