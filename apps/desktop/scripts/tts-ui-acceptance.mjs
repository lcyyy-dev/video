/** Renderer interaction acceptance with an explicit IPC test double; never calls paid speech services. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
import { initialTemplate } from '../src/edit-template.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(desktop, '../..');
mkdirSync(join(desktop, '.dev'), { recursive: true });
const directory = mkdtempSync(join(desktop, '.dev', 'tts-ui-'));
writeFileSync(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.jsx"></script></body></html>');
writeFileSync(join(directory, 'entry.jsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditTemplateBuilder } from '/@fs/${desktop}/chat/src/components/EditTemplateBuilder.tsx';
import '/@fs/${desktop}/chat/src/chat.css';
createRoot(document.getElementById('root')).render(<div style={{width:800,margin:40}}><EditTemplateBuilder projectPath="/test-film" busy={false} onSaved={() => {window.savedCount++;}} /></div>);`);
const server = await createServer({ configFile: false, root: directory, plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
server.middlewares.use((req, res, next) => {
  if (req.url === '/api/text-styles') { res.setHeader('content-type', 'application/json'); res.end('{"presets":[]}'); }
  else if (req.url === '/api/text-styles/fonts.css') { res.setHeader('content-type', 'text/css'); res.end(''); }
  else next();
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(config => {
    window.savedCount = 0; window.playCalls = 0; window.previewCalls = [];
    HTMLMediaElement.prototype.play = function () { window.playCalls++; return Promise.resolve(); };
    window.openfilmDesktop = { editTemplate: {
      load: async () => config,
      save: async (_project, next) => { window.saved = next; return next; },
      voices: async () => ({ configured: true, speakers: ['zh_female_vv_uranus_bigtts'] }),
      preview: async (_project, next) => { window.previewCalls.push(next); return new Promise(resolve => { window.resolvePreview = resolve; }); },
    } };
  }, { ...initialTemplate(), narration: true, bodyText: '欢迎光临。今天有优惠！' });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const trigger = page.locator('.edit-template-trigger');
  await trigger.click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('combobox', { name: '旁白音色' }).waitFor();
  await page.getByRole('slider', { name: '旁白语速' }).press('End');
  await page.getByRole('button', { name: '试听正文前 100 字' }).click();
  await page.waitForFunction(() => window.previewCalls.length === 1);
  assert.equal(await page.getByRole('button', { name: '正在生成试听…' }).isDisabled(), true);
  await page.getByRole('button', { name: '关闭剪辑模板' }).click();
  await page.evaluate(() => window.resolvePreview({ audio: 'YQ==', format: 'mp3' }));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await page.evaluate(() => window.playCalls), 0, 'closing before synthesis completes must prevent late playback');
  await trigger.click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('slider', { name: '旁白语速' }).press('End');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '保存并输入需求', exact: true }).click();
  await page.waitForFunction(() => window.savedCount === 1);
  assert.equal(await page.evaluate(() => window.saved.speechRate), 100);
  assert.equal(await page.evaluate(() => window.saved.narration), true);
  await trigger.click();
  await page.getByRole('button', { name: /文案二创.*保留原意/ }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '文案朗读', exact: true }).count(), 0);
  assert.equal(await page.getByRole('combobox', { name: '旁白音色' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: advertising voice settings, preview pending/close behavior, persistence and copy-template exclusion; IPC test double, no live TTS.');
} finally {
  await browser?.close(); await server.close(); rmSync(directory, { recursive: true, force: true });
}
