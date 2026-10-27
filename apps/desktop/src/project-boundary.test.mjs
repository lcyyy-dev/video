import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRequest } from './project-boundary.mjs';

test('native requests stay in the active project while preserving Codex turn shape', () => {
  const root = '/tmp/openfilm-project';
  const input = { jsonrpc: '2.0', id: 1, method: 'turn/start', params: { threadId: 't', input: [{ type: 'text', text: '删除配音轨' }], cwd: '/home/other', environments: [], sandboxPolicy: { type: 'dangerFullAccess' } } };
  const out = projectRequest(input, root);
  assert.equal(out.params.cwd, root);
  assert.deepEqual(out.params.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [root], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
  assert.deepEqual(out.params.input, input.params.input);
  assert.equal(Object.hasOwn(out.params, 'environments'), false, 'native local execution must stay enabled');
});

test('native project sessions cannot change host settings or run host commands', () => {
  for (const method of ['config/value/write', 'config/batchWrite', 'account/login/start', 'account/logout', 'command/exec', 'process/exec', 'fs/writeFile']) {
    assert.throws(() => projectRequest({ method, params: {} }, '/tmp/openfilm-project'), /Project sessions/);
  }
});
