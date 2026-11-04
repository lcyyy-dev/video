import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createEventLog, keyReference } from './logs.mjs';
import { validateUsername } from './profiles.mjs';
import { createGateway } from './server.mjs';
import { createGatewayFetch, signedHeaders } from '../../apps/desktop/src/gateway-auth.mjs';

test('activation, refresh, per-user key substitution, streaming, replay and revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-test-'));
  const mappingFile = join(dir, 'mappings.json');
  const readMappings = () => JSON.parse(readFileSync(mappingFile, 'utf8'));
  writeFileSync(mappingFile, JSON.stringify({ alice: { apiKey: 'alice-private' }, bob: { apiKey: 'bob-private' } }));
  const devices = new Map(); let quotaMode = 'normal'; let revoked = false; const calls = [];
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
    if (url === 'https://openspeech.bytedance.com/api/v3/tts/unidirectional') {
      calls.push({ url, key: options.headers['X-Api-Key'], body });
      return new Response('{"code":0,"data":"YXVkaW8="}\n{"code":20000000}\n');
    }
    if (url === 'http://sub2api/v1/usage') {
      calls.push({ url, key: options.headers.authorization });
      if (quotaMode === 'error') return Response.json({ error: 'alice-private' }, { status: 403 });
      if (quotaMode === 'unlimited') return Response.json({ mode: 'unrestricted', balance: 900, remaining: 900 });
      if (quotaMode === 'invalid') return Response.json({});
      return Response.json({ mode: 'quota_limited', quota: { limit: 100, used: quotaMode === 'zero' ? 100 : 25, remaining: quotaMode === 'zero' ? 0 : 75 }, apiKey: 'must-not-leak' });
    }
    calls.push({ url, key: options.headers.authorization, body: options.body.toString() });
    return new Response('data: {"text":"OK"}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const loggedEvents=[];const logStore={enqueue:row=>loggedEvents.push(row)};
  const profiles = new Map();
  const profileStore = { ensure: async license => { if (!profiles.has(license)) profiles.set(license, { username: '用户123456', userId: license === 'alice' ? '0406 2003 7412' : '0406 2003 5829' }); return profiles.get(license); }, rename: async (license, username) => { const profile = await profileStore.ensure(license); profile.username = validateUsername(username); return profile; } };
  const server = createGateway({ profileStore, log:createEventLog({store:logStore,stdout:false}), secret: 'a'.repeat(64), mappingFile, keygenUrl: 'http://keygen/v1', keygenToken: 'admin', sub2apiUrl: 'http://sub2api/v1', fetchImpl: upstream, ttsKey: 'speech-private' });
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
      const ownProfile = await (await client(`${origin}/account/profile`)).json();
      assert.equal(ownProfile.username, '用户123456');
      const renamed = await client(`${origin}/account/profile`, { method: 'PATCH', body: JSON.stringify({ username: name }) });
      assert.equal(renamed.status, 200);
      assert.deepEqual(await renamed.json(), { ...ownProfile, username: name });
      for (const input of [{ username: '123456789' }, { username: 'new', userId: '0406 2003 0001' }, { userId: '0406 2003 0001' }]) {
        assert.equal((await client(`${origin}/account/profile`, { method: 'PATCH', body: JSON.stringify(input) })).status, 400);
      }
      const quota = await client(`${origin}/account/quota`);
      assert.equal(quota.status, 200);
      assert.deepEqual(await quota.json(), { limit: 100, used: 25, remaining: 75, percent: 75, unit: 'USD' });
      assert.equal(calls.at(-1).key, `Bearer ${name}-private`);
      quotaMode = 'zero';
      assert.equal((await (await client(`${origin}/account/quota`)).json()).percent, 0);
      quotaMode = 'unlimited';
      assert.deepEqual(await (await client(`${origin}/account/quota`)).json(), { limit: null, used: null, remaining: null, percent: null, unit: 'USD' });
      for (const mode of ['error', 'invalid']) {
        quotaMode = mode;
        const failed = await client(`${origin}/account/quota`);
        assert.equal(failed.status, 502);
        assert.ok(!(await failed.text()).includes('private'));
      }
      quotaMode = 'normal';
      const body = JSON.stringify({ model: 'model', input: name, stream: true });
      const response = await client(`${origin}/v1/responses`, { method: 'POST', body });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /\[DONE\]/);
      assert.equal(calls.at(-1).key, `Bearer ${name}-private`);
      assert.equal(calls.at(-1).body, body);
      const ttsBody = JSON.stringify({ text: '欢迎光临', speaker: 'zh_female_vv_uranus_bigtts' });
      const savedMappings = readMappings();
      writeFileSync(mappingFile, JSON.stringify({ ...savedMappings, [name]: {} }));
      const tts = await client(`${origin}/tts/synthesize`, { method: 'POST', body: ttsBody });
      assert.equal(tts.status, 200);
      assert.equal((await tts.json()).audio, 'YXVkaW8=');
      assert.equal(calls.at(-1).key, 'speech-private');
      writeFileSync(mappingFile, JSON.stringify(savedMappings));
      assert.match(calls.at(-1).url, /^https:\/\/openspeech.bytedance.com\//);
      const beforeInvalidTts = calls.length;
      assert.equal((await client(`${origin}/tts/synthesize`, { method: 'POST', body: JSON.stringify({ ...JSON.parse(ttsBody), url: 'http://keygen' }) })).status, 400);
      assert.equal(calls.length, beforeInvalidTts);
      const headers = { ...signedHeaders(device, 'POST', '/v1/responses', body, session.accessToken), authorization: `Bearer ${session.accessToken}` };
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers, body })).status, 200);
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers, body })).status, 401);
      const other = identity();
      assert.equal((await activate(name, other)).status, 403);
      const stolen = { ...signedHeaders(other, 'POST', '/v1/responses', body, session.accessToken), authorization: `Bearer ${session.accessToken}` };
      assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', headers: stolen, body })).status, 403);
      revoked = true;
      assert.equal((await client(`${origin}/account/profile`)).status, 403);
      assert.equal((await client(`${origin}/account/profile`, { method: 'PATCH', body: JSON.stringify({ username: 'bad' }) })).status, 403);
      assert.equal((await client(`${origin}/account/quota`)).status, 403);
      assert.equal((await client(`${origin}/auth/status`, { method: 'POST', body: '{}' })).status, 403);
      assert.equal((await client(`${origin}/v1/responses`, { method: 'POST', body })).status, 403);
      assert.equal((await client(`${origin}/tts/synthesize`, { method: 'POST', body: ttsBody })).status, 403);
      revoked = false;
    }
    assert.equal((await fetch(`${origin}/v1/responses`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${origin}/v1/anything`)).status, 404);
    assert.equal((await fetch(`${origin}/account/quota`)).status, 401);
    assert.equal((await fetch(`${origin}/account/profile`)).status, 401);
    const events=loggedEvents;
    for(const name of ['alice','bob']){
      assert.ok(events.some(row=>row.event==='auth.activate'&&row.licenseId===name&&row.status===200&&row.keyRef===keyReference(`${name}-private`)));
      assert.ok(events.some(row=>row.event==='request.complete'&&row.path==='/v1/responses'&&row.licenseId===name&&row.streamOutcome==='completed'&&row.bytes>0));
      assert.ok(events.some(row=>row.event==='request.complete'&&row.path==='/v1/responses'&&row.licenseId===name&&row.status===403));
      assert.ok(events.some(row=>row.event==='upstream.keygen'&&row.licenseId===name&&row.durationMs>=0));
    }
    const serialized=JSON.stringify(events);
    for(const secret of ['alice-private','bob-private','speech-private','欢迎光临','BEGIN PUBLIC KEY'])assert.ok(!serialized.includes(secret));
    assert.ok(events.every(row=>row.requestId));
    const health=await fetch(`${origin}/healthz`);assert.deepEqual(await health.json(),{service:'openfilm-gateway',ok:true});

    assert.equal((await fetch(`${origin}/tts/synthesize`, { method: 'POST', body: '{}' })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
