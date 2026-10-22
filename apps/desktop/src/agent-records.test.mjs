import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexCallsOf, findCodexRecord, agentRecordCalls, compactCalls } from './agent-records.mjs';
const at = (s) => new Date(Date.UTC(2026, 9, 15, 10, 0, s)).toISOString();
test("Codex's rollout: base instructions, what Codex put in, each request closed by its usage, tool calls and their output", () => {
  const rows = [
    { timestamp: at(0), type: 'session_meta', payload: { id: 'th1', base_instructions: { text: 'You are Codex.' } } },
    { timestamp: at(0), type: 'turn_context', payload: { model: 'gpt-x', effort: 'high', approval_policy: 'never' } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are inside OpenFilm.' }] } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make a title' }] } },
    { timestamp: at(3), type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'look first' }], encrypted_content: 'zzz' } },
    { timestamp: at(3), type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: '{"cmd":"openfilm look"}', call_id: 'c1' } },
    { timestamp: at(4), type: 'token_usage_record', payload: { usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 9, reasoning_output_tokens: 4 } } },
    { timestamp: at(4), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 999 } } } },
    { timestamp: at(6), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'frames saved' } },
    { timestamp: at(8), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } },
    { timestamp: at(9), type: 'token_usage_record', payload: { usage: { input_tokens: 150, cached_input_tokens: 120, output_tokens: 3 } } },
  ];
  const calls = codexCallsOf(rows);
  assert.equal(calls.length, 2, 'a token_count beside a usage record is not a request of its own');
  const [first, second] = calls;
  assert.equal(first.systemPrompt, 'You are Codex.');
  assert.equal(first.tools, null);
  assert.equal(first.toolsUnknown, true);
  assert.deepEqual(first.settings, { model: 'gpt-x', effort: 'high', approval_policy: 'never' });
  assert.deepEqual(first.messages.map((m) => [m.role, m.label ?? null]), [['context', 'developer'], ['context', 'environment_context'], ['user', null]]);
  assert.deepEqual(first.answer.content, [{ type: 'thinking', thinking: 'look first' }, { type: 'toolCall', id: 'c1', name: 'exec', arguments: { cmd: 'openfilm look' } }]);
  assert.deepEqual(first.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 9, reasoning: 4 }, 'input without the cached part');
  assert.equal(first.answer.responseModel, 'gpt-x');
  assert.deepEqual(second.messages.slice(3), [
    { role: 'assistant', content: first.answer.content },
    { role: 'toolResult', toolCallId: 'c1', toolName: 'exec', content: [{ type: 'text', text: 'frames saved' }], isError: false },
  ]);
  assert.deepEqual(second.answer.content, [{ type: 'text', text: 'Done.' }]);
  assert.equal(second.startedAt, Date.parse(at(6)), 'sent with the tool\'s output');
  assert.equal(second.ms, 3000);
});

test("Codex's rollout: an older one closes requests by token_count; a compaction starts the history again", () => {
  const rows = [
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }] } },
    { timestamp: at(2), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a' }] } },
    { timestamp: at(2), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 1 } } } },
    { timestamp: at(3), type: 'compacted', payload: { message: 'they asked for one' } },
    { timestamp: at(4), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'two' }] } },
    { timestamp: at(5), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'b' }] } },
    { timestamp: at(5), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } } },
  ];
  const calls = codexCallsOf(rows);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].answer.usage.input, 10);
  assert.deepEqual(calls[1].messages, [
    { role: 'context', as: 'user', label: 'compaction summary', content: [{ type: 'text', text: 'they asked for one' }] },
    { role: 'user', content: [{ type: 'text', text: 'two' }] },
  ]);
});

test('Codex record discovery handles archived sessions and rejects other agents', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-codex-record-'));
  mkdirSync(join(root, 'archived_sessions'));
  const file = join(root, 'archived_sessions/rollout-session123.jsonl');
  writeFileSync(file, '');
  assert.equal(findCodexRecord({ sessionId: 'session123', env: { CODEX_HOME: root } }), file);
  assert.equal(agentRecordCalls({ agent: 'byok', sessionId: 'session123' }), null);
  const calls = compactCalls([{ startedAt: 1, ms: 1, messages: [{ role: 'user', content: 'hello' }] },
    { startedAt: 2, ms: 1, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] }]);
  assert.equal(calls[1].prefix, 1);
  assert.equal(calls[1].messages.length, 1);
});
