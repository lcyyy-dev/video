import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSub2ApiConfig, saveSub2ApiConfig } from './sub2api-config.mjs';

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
