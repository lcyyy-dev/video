import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRuntimeDir, removeProjectRuntime } from './project-runtime.mjs';

test('deleting a project removes only its private runtime, preserving other projects and activation', async () => {
  const data = mkdtempSync(join(tmpdir(), 'project-runtime-'));
  const a = projectRuntimeDir(data, '/projects/a'), b = projectRuntimeDir(data, '/projects/b');
  for (const home of [a, b]) { mkdirSync(home, { recursive: true }); writeFileSync(join(home, 'session.json'), '{}'); }
  writeFileSync(join(data, 'gateway-session.json'), 'activation');
  await removeProjectRuntime(data, '/projects/a');
  assert.equal(existsSync(a), false);
  assert.equal(existsSync(b), true);
  assert.equal(existsSync(join(data, 'gateway-session.json')), true);
  await removeProjectRuntime(data, '/projects/a');
});
test('runtime cleanup refuses a redirected storage directory', { skip: process.platform === 'win32' }, async () => {
  const data = mkdtempSync(join(tmpdir(), 'runtime-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'runtime-away-'));
  symlinkSync(outside, join(data, 'project-codex'));
  assert.equal(await removeProjectRuntime(data, '/projects/a'), false);
  assert.equal(existsSync(outside), true);
});
