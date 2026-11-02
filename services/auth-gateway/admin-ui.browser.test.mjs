import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAdmin} from './admin.mjs';
import {createEventLog} from './logs.mjs';
import {testLogStore,hasTestDatabase} from './test-log-store.mjs';

test('independent admin pages preserve login, separate calls and diagnostics, and query PostgreSQL safely', {skip:!process.env.AUTH_UI_BROWSER||!hasTestDatabase},async t=>{
 const {chromium}=await import('../../packages/openfilm/node_modules/playwright-core/index.mjs');
 const dir=mkdtempSync(join(tmpdir(),'admin-ui-')),mappingFile=join(dir,'mappings.json'),logStore=await testLogStore(t);
 writeFileSync(mappingFile,JSON.stringify({license:{name:'测试用户 <img src=x onerror=alert(1)>',apiKey:'private-key'}}));
 const log=createEventLog({store:logStore,stdout:false});
 log('auth.activate',{licenseId:'license',keyRef:'key-fingerprint',status:200,outcome:'success',requestId:'activation-request'});
 log('request.complete',{licenseId:'license',path:'/v1/responses',status:502,outcome:'failed',requestId:'failed-request',stage:'keygen',errorCode:'ECONNRESET'},'error');
 createEventLog({store:logStore,source:'monitor',stdout:false})('link.summary',{localOk:true,publicOk:false,diagnosis:'public_path_unavailable',probeId:'probe'},'error');
 createEventLog({store:logStore,source:'tunnel',stdout:false})('external.line',{file:'proxy.log',message:'connection timeout',sourceTime:'2026/11/02 09:41:36'},'error');
 await logStore.flush();
 const server=createAdmin({mappingFile,logStore,keygenUrl:'http://keygen/v1',keygenToken:'server-key',fetchImpl:async url=>{
  if(url.endsWith('/tokens'))return Response.json({data:{attributes:{token:'session-token'}}});
  if(url.endsWith('/me'))return Response.json({data:{attributes:{role:'admin'}}});
  if(url.includes('/policies?'))return Response.json({data:[{id:'policy',attributes:{name:'test'}}]});
  return Response.json({data:[{id:'license',attributes:{key:'activation-code'}}]});
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.AUTH_UI_BROWSER,headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin+'/logs');
  await page.locator('[name=email]').fill('admin@example.com');await page.locator('[name=password]').fill('test');await page.locator('#login-form button').click();
  await page.waitForFunction(()=>document.querySelector('#logs-rows').children.length===2);
  assert.equal(new URL(page.url()).pathname,'/logs');assert.equal(await page.locator('#issue-form').isVisible(),false);assert.equal(await page.locator('#diagnostics').isVisible(),false);
  assert.match(await page.locator('#logs-rows').innerText(),/激活/);assert.match(await page.locator('#logs-rows').innerText(),/ECONNRESET/);
  assert.equal(await page.locator('#logs-rows img').count(),0);assert.ok(!(await page.locator('#logs-panel').innerText()).includes('private-key'));
  await page.locator('#logs-search').fill('failed-request');await page.locator('#logs-filter button').click();await page.waitForFunction(()=>document.querySelector('#logs-rows').children.length===1);
  assert.match(await page.locator('#logs-rows').innerText(),/502/);
  await page.locator('[data-route=diagnostics]').click();await page.waitForURL(origin+'/diagnostics');await page.waitForFunction(()=>document.querySelector('#diag-rows').children.length===2);
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('本机正常'));
  assert.equal(await page.locator('#logs-panel').isVisible(),false);assert.match(await page.locator('#diagnostics').innerText(),/本机正常，公网不可达/);assert.match(await page.locator('#storage-status').innerText(),/PostgreSQL/);
  await page.locator('#diag-source').selectOption('tunnel');await page.locator('#diag-filter button').click();await page.waitForFunction(()=>document.querySelector('#diag-rows').children.length===1);assert.match(await page.locator('#diag-rows').innerText(),/proxy.log/);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#diag-rows').children.length===2);assert.equal(new URL(page.url()).pathname,'/diagnostics');
  if(process.env.AUTH_UI_SCREENSHOT)await page.screenshot({path:process.env.AUTH_UI_SCREENSHOT,fullPage:true});
  await page.locator('[data-route=licenses]').click();await page.waitForURL(origin+'/licenses');await page.locator('#issue-form').waitFor();assert.equal(await page.locator('#logs-panel').isVisible(),false);assert.equal(await page.locator('#diag-panel').isVisible(),false);
  await page.goBack();await page.waitForURL(origin+'/diagnostics');assert.equal(await page.locator('#diagnostics').isVisible(),true);
  assert.deepEqual(errors,[]);await page.locator('#logout').click();await page.waitForFunction(()=>document.querySelector('#workspace').hidden===true);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
