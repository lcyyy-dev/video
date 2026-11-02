import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createTextElementsServer} from './text-elements-server.mjs';
test('editor persists weights, reloads them and rejects invalid, stale or unauthenticated writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'text-elements-')),file=join(dir,'elements.json');
 writeFileSync(file,readFileSync(new URL('../src/text-elements.json',import.meta.url)));
 const server=createTextElementsServer({file});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  const html=await (await fetch(origin+'/examples/text-elements-preview.html')).text();
  const token=JSON.parse(html.match(/window.elementSaveToken=("[a-f0-9]+")/)[1]);
  const original=await (await fetch(origin+'/api/elements')).json();
  const weights=structuredClone(original.library.weights);weights.fonts.simhei=7;
  const put=(body,auth=token)=>fetch(origin+'/api/elements',{method:'PUT',headers:{'content-type':'application/json','x-element-token':auth,origin},body:JSON.stringify(body)});
  assert.equal((await put({weights,revision:original.revision},'wrong')).status,403);
  const response=await put({weights,revision:original.revision});assert.equal(response.status,200);
  const current=await response.json();assert.equal(JSON.parse(readFileSync(file)).weights.fonts.simhei,7);
  const reloaded=await (await fetch(origin+'/api/elements')).json();assert.equal(reloaded.library.weights.fonts.simhei,7);
  assert.equal((await put({weights,revision:original.revision})).status,409);
  weights.fonts.simhei=-1;assert.equal((await put({weights,revision:current.revision})).status,400);
  assert.equal(JSON.parse(readFileSync(file)).weights.fonts.simhei,7);
  assert.equal((await fetch(origin+'/fonts/element-fangtang-j.otf')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
