import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSub2ApiConfig, saveSub2ApiConfig, checkSub2ApiConfig } from './sub2api-config.mjs';

test('Sub2API config requires a complete HTTPS v1 endpoint and key', () => {
  assert.equal(readSub2ApiConfig({}), null);
  assert.throws(() => readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: 'https://example.test/v1' }), /完整/);
  assert.throws(() => readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: 'http://example.test/v1', OPENFILM_SUB2API_API_KEY: 'k' }), /HTTPS/);
  assert.throws(() => readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: 'https://example.test/api', OPENFILM_SUB2API_API_KEY: 'k' }), /\/v1/);
  assert.deepEqual(readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: 'https://example.test/v1/', OPENFILM_SUB2API_API_KEY: 'secret', OPENFILM_SUB2API_MODEL: 'gpt-6.1-sol' }), { baseUrl: 'https://example.test/v1', apiKey: 'secret', model: 'gpt-6.1-sol' });
});

test('stored settings survive reopening and a blank key keeps the saved key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sub2api-'));
  saveSub2ApiConfig(dir, { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: 'saved-key', model: 'gpt-6.1-sol' });
  saveSub2ApiConfig(dir, { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: '', model: 'gpt-6.1-sol' });
  const config = readSub2ApiConfig({}, dir);
  assert.equal(config.apiKey, 'saved-key');
  assert.equal(JSON.parse(readFileSync(join(dir, 'sub2api.json'))).apiKey, 'saved-key');
  writeFileSync(join(dir, 'sub2api.json'), '{broken');
  assert.equal(readSub2ApiConfig({}, dir), null);
});

test('uses the supplied OS-store adapter instead of writing the key as plain text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sub2api-secure-'));
  const storage = { encrypt: value => Buffer.from(value, 'utf8').toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString('utf8') };
  saveSub2ApiConfig(dir, { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: 'saved-key', model: 'gpt-6.1-sol' }, storage);
  const raw = readFileSync(join(dir, 'sub2api.json'), 'utf8');
  assert.doesNotMatch(raw, /saved-key/);
  assert.equal(readSub2ApiConfig({}, dir, storage).apiKey, 'saved-key');
});

test('model test sends the selected model and saved key to Responses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sub2api-test-'));
  try {
    saveSub2ApiConfig(dir, { baseUrl: 'http://localhost:8188/v1', apiKey: 'secret', model: 'saved-model' });
    const result = await checkSub2ApiConfig(dir, { baseUrl: 'http://localhost:8188/v1', apiKey: '', model: 'selected-model' }, async (url, options) => {
      assert.equal(url, 'http://localhost:8188/v1/responses');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.authorization, 'Bearer secret');
      assert.deepEqual(JSON.parse(options.body), { model: 'selected-model', input: 'Reply with OK.', stream: false });
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    });
    assert.equal(result.model, 'selected-model');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('model test rejects HTTP errors and responses without a completed reply', async () => {
  const input = { baseUrl: 'http://localhost:8188/v1', apiKey: 'key', model: 'model' };
  await assert.rejects(checkSub2ApiConfig(null, input, async () => new Response('', { status: 401 })), /HTTP 401/);
  for (const body of [{ status: 'failed', output: [] }, { status: 'completed', output: [] }]) {
    await assert.rejects(checkSub2ApiConfig(null, input, async () => Response.json(body)), /未成功完成回复/);
  }
  await assert.rejects(checkSub2ApiConfig(null, { ...input, model: '' }), /模型名称无效/);
});
