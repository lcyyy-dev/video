import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, STUDIO_REFERENCES, isAgentId } from './agents.mjs';

test('the video agent uses the current Studio, reads its workflow, and preserves edits', () => {
  assert.ok(INSTRUCTIONS.endsWith(STUDIO_REFERENCES));
  assert.match(INSTRUCTIONS, /openfilm skill <name>/);
  assert.match(INSTRUCTIONS, /Preserve\s+manual timeline edits/);
  assert.match(INSTRUCTIONS, /simulation clearly/);
  assert.equal(isAgentId('codex'), true);
  for (const removed of ['claude', 'byok', 'gemini', 'opencode']) assert.equal(isAgentId(removed), false);
});
