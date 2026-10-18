import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, 'text-styles', ...args], { encoding: 'utf8' });

test('the text styles command exposes presets and rules as JSON without opening a project', () => {
  const list = run('list');
  assert.equal(list.status, 0, list.stderr);
  const presets = JSON.parse(list.stdout);
  assert.ok(presets.length > 0);
  const show = run('show', presets[0].id);
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(JSON.parse(show.stdout), presets[0]);
  const rules = run('rules');
  assert.equal(rules.status, 0, rules.stderr);
  const contract = JSON.parse(rules.stdout);
  assert.equal(contract.version, 1);
  assert.ok(contract.appearance.stroke && contract.appearance.shadow);
  assert.ok(contract.nativeFallbackRules.length > 0);
});

test('unknown styles and malformed text styles commands return usage errors', () => {
  for (const args of [['show', 'unknown-style'], ['show'], ['rules', 'extra'], ['list', 'extra']]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stdout.trim());
    assert.doesNotMatch(result.stderr, /Executable doesn't exist|downloading|Error:/);
  }
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /machine-readable/);
});
