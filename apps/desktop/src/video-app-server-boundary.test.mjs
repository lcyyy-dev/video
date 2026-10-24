import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoAppServerRequest } from './video-app-server-boundary.mjs';

test('the actual native sandbox is read-only even if ACP asks for its misleading workspace-write preset', () => {
  const cwd = process.cwd();
  const start = videoAppServerRequest({ id: 1, method: 'thread/start', params: { cwd: '/other', sandbox: 'danger-full-access', approvalPolicy: 'on-request', dynamicTools: [{ name: 'read_secret' }] } }, cwd);
  assert.equal(start.params.cwd, cwd); assert.equal(start.params.sandbox, 'read-only'); assert.equal(start.params.approvalPolicy, 'never'); assert.deepEqual(start.params.dynamicTools, []);
  const turn = videoAppServerRequest({ id: 2, method: 'turn/start', params: { sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/'] }, approvalPolicy: 'on-request', cwd: '/other' } }, cwd);
  assert.deepEqual(turn.params.sandboxPolicy, { type: 'readOnly' }); assert.equal(turn.params.approvalPolicy, 'never'); assert.equal(turn.params.cwd, cwd);
});

test('the planner cannot resume unrestricted history, run review/commands, manage login, or change security config', () => {
  for (const method of ['thread/resume', 'thread/fork', 'review/start', 'command/exec', 'process/exec', 'fs/readFile', 'fs/writeFile', 'account/login/start', 'account/logout', 'config/value/write', 'thread/goal/set', 'mcpServer/oauth/login']) assert.throws(() => videoAppServerRequest({ id: 1, method, params: {} }, '/film'), /视频/);
  assert.throws(() => videoAppServerRequest({ id: 2, method: 'thread/settings/update', params: { threadId: 'x', sandboxPolicy: { type: 'dangerFullAccess' } } }, '/film'), /安全策略/);
  const model = { id: 3, method: 'thread/settings/update', params: { threadId: 'x', model: 'gpt-6.1-sol' } };
  assert.deepEqual(videoAppServerRequest(model, '/film'), model);
});
