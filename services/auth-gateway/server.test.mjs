import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createGateway } from './server.mjs';
import { createGatewayFetch, signedHeaders } from '../../apps/desktop/src/gateway-auth.mjs';

test('activation, refresh, per-user key substitution, streaming, replay and revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-test-'));
  const mappingFile = join(dir, 'mappings.json');
  writeFileSync(mappingFile, JSON.stringify({ alice: { apiKey: 'alice-private' }, bob: { apiKey: 'bob-private' } }));
  const devices = new Map(); let revoked = false; const calls = [];
  const upstream = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.startsWith('http://keygen/v1')) {
      if (url.endsWith('validate-key')) {
        const id = body.meta.key;
        return Response.json({ data: { id }, meta: { valid: devices.get(id) === body.meta.scope.fingerprint, code: 'NO_MACHINE' } });
      }
      if (url.endsWith('/machines')) {
        const id = body.data.relationships.license.data.id;
        if (devices.has(id)) return Response.json({}, { status: 422 });
        devices.set(id, body.data.attributes.fingerprint);
        return Response.json({ data: { id: 'machine' } });
      }
      const id = url.split('/licenses/')[1].split('/')[0];
      return Response.json({ meta: { valid: !revoked && devices.get(id) === body.meta.scope.fingerprint } });
    }
    calls.push({ url, key: options.headers.authorization, body: options.body.toString() });
    return new Response('data: {"text":"OK"}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const server = createGateway({ secret: 'a'.repeat(64), mappingFile, keygenUrl: 'http://keygen/v1', keygenToken: 'admin', sub2apiUrl: 'http://sub2api/v1', fetchImpl: upstream });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const identity = () => generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const activate = async (name, device) => {
    const body = JSON.stringify({ activationCode: name, publicKey: device.publicKey });
    return fetch(`${origin}/auth/activate`, { method: 'POST', headers: signedHeaders(device, 'POST', '/auth/activate', body), body });
  };
  try {
    for (const name of ['alice', 'bob']) {
      const device = identity();
      const activated = await activate(name, device);
      assert.equal(activated.status, 200);
      const session = await activated.json();
      assert.ok(!JSON.stringify(session).includes('private'));
      const client = createGatewayFetch({ baseUrl: `${origin}/v1`, refreshToken: session.refreshToken, identity: device });
      const before = calls.length;
      const status = await client(`${origin}/auth/status`, { method: 'POST', body: '{}' });
      assert.deepEqual(await status.json(), { authorized: true });
      assert.equal(calls.length, before, 'authorization checks must not consume model quota');
      const body = JSON.stringify({ model: 'model', input: name, stream: true });
      const response = await client(`${origin}/v1/responses`, { method: 'POST', body });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /\[DONE\]/);
      assert.equal(calls.at(-1).key, `Bearer ${name}-private`);
      assert.equal(calls.at(-1).body, body);
      const headers = { ...signedHeaders(device, 'POST', '/v1/responses', body, session.accessToken), authorization: `Bearer ${session.accessToken}` };
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers, body })).status, 200);
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers, body })).status, 401);
      const other = identity();
      assert.equal((await activate(name, other)).status, 403);
      const stolen = { ...signedHeaders(other, 'POST', '/v1/responses', body, session.accessToken), authorization: `Bearer ${session.accessToken}` };
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers: stolen, body })).status, 403);
      revoked = true;
      assert.equal((await client(`${origin}/auth/status`, { method: 'POST', body: '{}' })).status, 403);
      assert.equal((await client(`${origin}/v1/responses`, { method: 'POST', body })).status, 403);
      revoked = false;
    }
    assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${origin}/v1/anything`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
