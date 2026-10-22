import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from './agents.mjs';
import { loggedBlocks, readLog, writeModelLog } from './chat-store.mjs';

test('the Codex message log records the exact prompts sent to the adapter', async () => {
  const sent = [], requested = [];
  const session = new AgentSession({ agent: 'codex', cwd: '/project', onSend: (message) => sent.push(message) });
  session.sessionId = 'test-session';
  session.conn = { agent: { request: async (_method, params) => { requested.push(params); return { stopReason: 'end_turn' }; } } };
  await session.prompt([{ type: 'text', text: 'Make an ad' }]);
  await session.prompt([{ type: 'text', text: 'Change the second line' }]);
  assert.deepEqual(sent.map((entry) => entry.prompt), requested.map((entry) => entry.prompt));
});

test('a message\'s pictures are kept in the logs by their content and named in its blocks; a turn\'s model log is written whole', () => {
  const project = mkdtempSync(join(tmpdir(), 'of-log-'));
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const blocks = loggedBlocks(project, [{ type: 'text', text: 'this one' }, { type: 'image', mimeType: 'image/jpeg', data }, { type: 'image', mimeType: 'image/jpeg', data }]);
  assert.deepEqual(blocks[0], { type: 'text', text: 'this one' });
  assert.match(blocks[1].file, /^\.film\/logs\/images\/[0-9a-f]{40}\.jpg$/);
  assert.equal(blocks[1].file, blocks[2].file, 'the same picture kept once');
  assert.equal(blocks[1].bytes, 7);
  assert.ok(!('data' in blocks[1]));
  assert.ok(existsSync(join(project, blocks[1].file)));

  const turn = 'local:t1';
  writeModelLog(project, turn, [{ startedAt: 1, ms: 2, prefix: 0, messages: [], answer: null }]);
  writeModelLog(project, turn, [{ startedAt: 3, ms: 4, prefix: 0, messages: [], answer: null }]);
  writeFileSync(join(project, '.film', 'logs', 'local-t1.jsonl'), `${JSON.stringify({ t: 0, kind: 'prompt' })}\n`);
  assert.deepEqual(readLog(project, turn).calls.map((c) => c.startedAt), [3], 'in place of the one before');
});
