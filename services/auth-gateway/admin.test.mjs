import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin } from './admin.mjs';

test('admin requires login and CSRF, hides mapped keys, creates and replaces mappings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-admin-'));
  const file = join(dir, 'mappings.json'); writeFileSync(file, '{}');
  let role = 'admin'; let valid = true; const calls = [];
  const server = createAdmin({ mappingFile: file, keygenUrl: 'http://keygen/v1', keygenToken: 'server-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/tokens')) return Response.json({ data: { attributes: { token: 'admin-session-token' } } }, { status: valid ? 201 : 401 });
    if (url.endsWith('/me')) return Response.json({ data: { attributes: { role } } });
    if (url.includes('/policies?')) return Response.json({ data: [{ id: 'policy', attributes: { name: 'Single device', maxMachines: 1 } }] });
    if (url.includes('/machines?')) return Response.json({ data: [{ id: 'machine', attributes: { fingerprint: 'device' } }] });
    if (url.includes('/licenses?')) return Response.json({ data: [{ id: 'license', attributes: { key: 'activation-code' } }] });
    if (url.endsWith('/licenses') && options.method === 'POST') return Response.json({ data: { id: 'license', attributes: { key: 'activation-code' } } });
    return Response.json({ data: { id: 'license' } });
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const login = () => fetch(`${origin}/admin/login`, { method: 'POST', headers: { origin }, body: JSON.stringify({ email: 'admin@example.com', password: 'test' }) });
  try {
    assert.equal((await fetch(`${origin}/admin/state`)).status, 401);
    assert.equal((await fetch(`${origin}/admin/login`, { method: 'POST', body: '{}' })).status, 403);
    role = 'user'; assert.equal((await login()).status, 403);
    role = 'admin'; valid = false; assert.equal((await login()).status, 400); valid = true;
    const response = await login(); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const { csrf } = await response.json();
    const request = (path, method, body, extra = {}) => fetch(`${origin}/admin/${path}`, { method, headers: { cookie, origin, 'x-csrf-token': csrf, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await request('issue', 'POST', {}, { 'x-csrf-token': '' })).status, 403);
    assert.equal((await request('issue', 'POST', { policyId: 'policy', apiKey: 'first-private-key', name: '<b>User</b>' })).status, 200);
    assert.equal(JSON.parse(readFileSync(file)).license.apiKey, 'first-private-key');
    const state = await (await request('state', 'GET')).json();
    assert.equal(state.licenses[0].mapped, true);
    assert.ok(!JSON.stringify(state).includes('first-private-key'));
    await request('licenses/license/mapping', 'POST', { apiKey: '', name: 'updated' });
    assert.equal(JSON.parse(readFileSync(file)).license.apiKey, 'first-private-key');
    await request('licenses/license/mapping', 'POST', { apiKey: 'replacement-key' });
    assert.equal(JSON.parse(readFileSync(file)).license.apiKey, 'replacement-key');
    assert.equal((await request('licenses/license/devices', 'DELETE', { deviceId: 'someone-else' })).status, 400);
    assert.equal((await request('licenses/license/devices', 'DELETE', { deviceId: 'machine' })).status, 200);
    await request('licenses/license/suspend', 'POST', {});
    assert.ok(calls.some(call => call.url.endsWith('/actions/suspend')));
    await request('licenses/license/mapping', 'DELETE', {});
    assert.deepEqual(JSON.parse(readFileSync(file)), {});
    await request('logout', 'POST', {});
    assert.equal((await request('state', 'GET')).status, 401);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});
