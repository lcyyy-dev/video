import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gatewayEndpoint, activateGateway, gatewayConfig, publicSub2ApiConfig, checkSub2ApiConfig, checkGatewayAuthorization } from './sub2api-config.mjs';

const storage = {
  encrypt: value => Buffer.from(`test:${value}`).toString('base64'),
  decrypt: value => Buffer.from(value, 'base64').toString().slice(5),
};
const directory = () => mkdtempSync(join(tmpdir(), 'openfilm-activation-'));
const endpoint = { baseUrl: 'http://127.0.0.1:8188/v1', model: 'gpt-6.1-sol' };
const reply = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] };

test('gateway endpoint permits HTTPS and loopback HTTP only', () => {
  assert.equal(gatewayEndpoint({}).baseUrl, 'https://api.u4178022.nyat.app:13547/v1');
  assert.equal(gatewayEndpoint({ OPENFILM_GATEWAY_BASE_URL: 'https://example.test/v1/' }).baseUrl, 'https://example.test/v1');
  for (const baseUrl of ['http://example.test/v1', 'https://example.test/api', 'https://user:pass@example.test/v1', 'https://example.test/v1?q=1']) {
    assert.throws(() => gatewayEndpoint({ OPENFILM_GATEWAY_BASE_URL: baseUrl }));
  }
  assert.throws(() => gatewayEndpoint({ OPENFILM_GATEWAY_MODEL: 'invalid model' }), /模型/);
});

test('authorization fails closed for missing, corrupt, revoked and unreachable sessions', async () => {
  const dir = directory();
  try {
    assert.equal((await checkGatewayAuthorization(dir, storage)).authorized, false);
    await activateGateway(dir, { ...endpoint, activationCode: 'code' }, storage, async () => Response.json({ refreshToken: 'refresh' }));
    const mock = status => async url => url.endsWith('/auth/refresh')
      ? Response.json({ accessToken: 'access', expiresAt: Date.now() + 300000 })
      : (assert.ok(url.endsWith('/auth/status')), Response.json({ authorized: status }, { status: status ? 200 : 403 }));
    assert.equal((await checkGatewayAuthorization(dir, storage, mock(true))).authorized, true);
    assert.equal((await checkGatewayAuthorization(dir, storage, mock(false))).authorized, false);
    assert.equal((await checkGatewayAuthorization(dir, storage, async () => { throw new Error('offline'); })).authorized, false);
    writeFileSync(join(dir, 'gateway-session.json'), 'broken');
    assert.equal((await checkGatewayAuthorization(dir, storage)).authorized, false);
    assert.equal(publicSub2ApiConfig(dir, storage).configured, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('old direct settings never authorize the client and cannot run model tests', async () => {
  const dir = directory();
  try {
    writeFileSync(join(dir, 'sub2api.json'), JSON.stringify({ ...endpoint, apiKey: 'legacy-private-key' }));
    assert.equal(gatewayConfig(dir, storage), null);
    assert.equal(publicSub2ApiConfig(dir, storage).configured, false);
    await assert.rejects(checkSub2ApiConfig(dir, () => { throw new Error('must not fetch'); }, storage), /激活码/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('activation stores only encrypted device credentials, removes old key, and resumes without activation code', async () => {
  const dir = directory(); let activationCount = 0, refreshCount = 0;
  const fetchImpl = async (url, options) => {
    const headers = new Headers(options.headers);
    assert.ok(headers.get('x-openfilm-signature'));
    assert.ok(headers.get('x-openfilm-public-key'));
    if (url.endsWith('/auth/activate')) {
      activationCount++;
      assert.equal(JSON.parse(options.body).activationCode, 'license-code');
      return Response.json({ refreshToken: 'private-refresh-token' });
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCount++;
      assert.equal(JSON.parse(options.body).refreshToken, 'private-refresh-token');
      return Response.json({ accessToken: 'short-lived-access', expiresAt: Date.now() + 300000 });
    }
    assert.equal(url, endpoint.baseUrl + '/responses');
    assert.equal(headers.get('authorization'), 'Bearer short-lived-access');
    return Response.json(reply);
  };
  try {
    writeFileSync(join(dir, 'sub2api.json'), '{"apiKey":"legacy-private-key"}');
    await activateGateway(dir, { ...endpoint, activationCode: ' license-code ' }, storage, fetchImpl);
    assert.equal(existsSync(join(dir, 'sub2api.json')), false);
    const saved = readFileSync(join(dir, 'gateway-session.json'), 'utf8');
    assert.doesNotMatch(saved, /private-refresh-token|license-code/);
    assert.doesNotMatch(readFileSync(join(dir, 'gateway-device.json'), 'utf8'), /BEGIN PRIVATE KEY/);
    assert.equal(publicSub2ApiConfig(dir, storage).configured, true);
    assert.equal((await checkSub2ApiConfig(dir, fetchImpl, storage)).ok, true);
    assert.equal((await checkSub2ApiConfig(dir, fetchImpl, storage)).ok, true);
    assert.equal(activationCount, 1);
    assert.equal(refreshCount, 2);
    await assert.rejects(activateGateway(dir, { ...endpoint, activationCode: 'wrong-code' }, storage, async () => new Response('', { status: 403 })), /激活失败/);
    assert.equal(readFileSync(join(dir, 'gateway-session.json'), 'utf8'), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('activation requires an activation code and secure device storage', async () => {
  const dir = directory();
  try {
    await assert.rejects(activateGateway(dir, { ...endpoint, activationCode: 'code' }, {}), /系统安全存储/);
    await assert.rejects(activateGateway(dir, { ...endpoint, apiKey: 'raw-sub2api-key' }, storage), /激活码/);
    assert.equal(publicSub2ApiConfig(dir, storage).configured, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
