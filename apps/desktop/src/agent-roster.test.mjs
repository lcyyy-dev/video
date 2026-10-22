import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoster, readChoices } from './agent-roster.mjs';

const roster = (dataDir, fetch, extra = {}) => createRoster({
  dataDir,
  localAgents: async () => [],
  openSignIn: async () => ({ ok: true }),
  closeSessions: () => {},
  seal: (text) => Buffer.from(`sealed:${text}`),
  unseal: (data) => data.toString().replace(/^sealed:/, ''),
  onChange: () => {},
  fetch,
  ...extra,
});

test('an agent not found can be pointed at: the program is tried first, kept, and used until found automatically again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let picked = null;
  let check = { ok: true };
  const used = [];
  const asked = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: null, signedIn: null, install: 'https://developers.openai.com/codex', setupRequired: null }],
    pickProgram: async (id, words) => { asked.push([id, words]); return picked; },
    checkProgram: async () => check,
    usePaths: (paths) => used.push(paths),
  });
  assert.deepEqual(used, [{}], 'told at once what was kept');
  await r.refresh();
  assert.deepEqual(await r.locate('codex', { title: 'Choose the Codex program' }), { ok: false }, 'cancelled: nothing said, nothing kept');
  assert.deepEqual(asked, [['codex', { title: 'Choose the Codex program' }]]);
  picked = 'C:\\tools\\notes.txt';
  check = { ok: false, error: '', code: 'not-a-program' };
  assert.deepEqual(await r.locate('codex'), { ok: false, error: '', code: 'not-a-program' });
  assert.deepEqual(readChoices(dir).paths, {}, 'a program that does not start is not kept');
  picked = 'C:\\tools\\codex.exe';
  check = { ok: true, version: 'codex-cli 1.0.0' };
  assert.deepEqual(await r.locate('codex'), { ok: true });
  assert.deepEqual(readChoices(dir).paths, { codex: 'C:\\tools\\codex.exe' });
  assert.deepEqual(used.at(-1), { codex: 'C:\\tools\\codex.exe' });
  assert.equal(r.list().find((a) => a.id === 'codex').chosen, 'C:\\tools\\codex.exe');
  assert.deepEqual(await r.useAutomatic('codex'), { ok: true });
  assert.deepEqual(readChoices(dir).paths, {});
  assert.deepEqual(used.at(-1), {});
  assert.deepEqual(await r.locate('byok'), { ok: false, error: 'No agent byok' }, 'only the person\'s own programs');
});

test('a kept path for something that is not one of the agents is dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ paths: { codex: '/opt/codex', byok: '/x', nope: '/y', claude: 3 } }));
  assert.deepEqual(readChoices(dir).paths, { codex: '/opt/codex' });
});

test("Codex found but unable to read its own settings says so, with what it said", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const problem = 'Error loading configuration: config.toml:2:16: unknown variant `full`';
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: { path: '/bin/codex' }, signedIn: null, account: null, problem, install: null, setupRequired: null }],
  });
  await r.refresh();
  const codex = r.list().find((a) => a.id === 'codex');
  assert.equal(codex.status, 'ready');
  assert.equal(codex.problem, problem);
});

test('only Codex is offered, including after reading old multi-agent preferences', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ shown: { codex: false, claude: true }, byok: { model: 'old' }, disconnected: ['claude'] }));
  let email = 'first@example.test';
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: { path: '/bin/codex' }, signedIn: true, account: { method: 'chatgpt', email }, install: null }],
  });
  await r.refresh();
  assert.deepEqual(r.list().map((agent) => [agent.id, agent.shown, agent.status]), [['codex', true, 'ready']]);
  assert.equal((await r.connect('claude')).ok, false);
  r.disconnect('codex');
  assert.equal(r.list()[0].status, 'off');
  email = 'second@example.test';
  await r.connect('codex');
  assert.equal(r.list()[0].account.email, email);
});
