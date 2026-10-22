import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, STUDIO_REFERENCES, isAgentId } from './agents.mjs';

test('the advertising agent uses the current Studio, reads its workflow, and preserves edits', () => {
  assert.ok(INSTRUCTIONS.endsWith(STUDIO_REFERENCES));
  assert.match(INSTRUCTIONS, /openfilm skill ad-editing/);
  assert.match(INSTRUCTIONS, /Preserve\nmanual timeline edits/);
  assert.match(INSTRUCTIONS, /simulation clearly/);
  assert.equal(isAgentId('codex'), true);
  for (const removed of ['claude', 'byok', 'gemini', 'opencode']) assert.equal(isAgentId(removed), false);
});
