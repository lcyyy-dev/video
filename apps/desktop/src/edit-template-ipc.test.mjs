import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerEditTemplateIpc } from './edit-template-ipc.mjs';
import { initialTemplate } from './edit-template.mjs';

test('preview requires a trusted page, registered project, advertising narration and bounded original copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tts-ipc-'));
  const other = mkdtempSync(join(tmpdir(), 'tts-other-'));
  const handlers = new Map(); const calls = [];
  registerEditTemplateIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
    trusted: event => event.trusted, projects: async () => [root],
    hosted: () => ({ baseUrl: 'https://gateway.test/v1', fetchImpl: async (url, options) => {
      calls.push({ url, input: JSON.parse(options.body) });
      return Response.json({ audio: 'YXVkaW8=', format: 'mp3' });
    } }),
  });
  const preview = (config, opts = {}) => handlers.get('desktop:edit-template:preview')({ trusted: true, ...opts.event }, { project: root, config, ...opts.input });
  const config = { ...initialTemplate(), narration: true, bodyText: '原文，保持标点！'.repeat(30), speechRate: 20 };
  try {
    await assert.rejects(preview(config, { event: { trusted: false } }), /window page/);
    await assert.rejects(preview(config, { input: { project: other } }), /project of Studio/);
    for (const kind of ['copy', 'talk', 'live']) await assert.rejects(preview({ ...config, kind }), /仅广告/);
    await assert.rejects(preview({ ...config, body: false }), /仅广告/);
    await assert.rejects(preview({ ...config, narration: false }), /仅广告/);
    assert.equal(calls.length, 0);
    await preview(config);
    assert.deepEqual(calls, [{ url: 'https://gateway.test/tts/synthesize', input: { text: config.bodyText.slice(0, 100), speaker: config.speaker, speechRate: 20 } }]);
    symlinkSync(other, join(root, '.film'));
    await assert.rejects(preview(config), /链接/);
    assert.equal(calls.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});
