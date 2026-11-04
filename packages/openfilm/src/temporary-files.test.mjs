import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, renameSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupStaleTemporaries, trackTemporary, forgetTemporary } from './temporary-files.mjs';

test('crash recovery removes registered scratch but preserves live work, final exports and unregistered files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'temporary-recovery-'));
  const old = process.env.OPENFILM_TEMP_REGISTRY;
  const registry = join(root, 'registry'); process.env.OPENFILM_TEMP_REGISTRY = registry;
  try {
    const partial = join(root, '.草稿.partial-123456abcdef');
    mkdirSync(partial); writeFileSync(join(partial, 'unfinished'), 'partial'); trackTemporary(partial);
    const source = join(root, 'original.mp4'); writeFileSync(source, 'source');
    const final = join(root, '完整草稿'); mkdirSync(final);
    const untracked = join(root, '.manual.partial-abcdef123456'); mkdirSync(untracked);
    assert.equal(await cleanupStaleTemporaries(registry, { now: Date.now() + 120000 }), 0, 'live owner survives');
    assert.equal(await cleanupStaleTemporaries(registry, { isAlive: () => false }), 0, 'recent work survives');
    assert.equal(await cleanupStaleTemporaries(registry, { now: Date.now() + 120000, isAlive: () => false }), 1);
    assert.equal(existsSync(partial), false);
    for (const file of [source, final, untracked]) assert.equal(existsSync(file), true);
    assert.deepEqual(readdirSync(registry), []);
    const complete = join(root, '.完成.partial-123456abcdef'); mkdirSync(complete); trackTemporary(complete);
    const completed = join(root, '完成'); renameSync(complete, completed);
    await cleanupStaleTemporaries(registry, { now: Date.now() + 120000, isAlive: () => false });
    assert.equal(existsSync(completed), true, 'recovery never removes the renamed final result');
  } finally { if (old === undefined) delete process.env.OPENFILM_TEMP_REGISTRY; else process.env.OPENFILM_TEMP_REGISTRY = old; rmSync(root, { recursive: true, force: true }); }
});

test('temporary recovery refuses redirected parents and normal completion removes registry entries', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'temporary-links-'));
  const old = process.env.OPENFILM_TEMP_REGISTRY; process.env.OPENFILM_TEMP_REGISTRY = join(root, 'registry');
  try {
    const parent = join(root, 'output'); mkdirSync(parent);
    const scratch = join(parent, '.draft.partial-123456abcdef'); mkdirSync(scratch); trackTemporary(scratch);
    renameSync(parent, join(root, 'moved'));
    const other = join(root, 'other'); mkdirSync(other); mkdirSync(join(other, '.draft.partial-123456abcdef'));
    symlinkSync(other, parent);
    assert.equal(await cleanupStaleTemporaries(process.env.OPENFILM_TEMP_REGISTRY, { now: Date.now() + 120000, isAlive: () => false }), 0);
    assert.equal(existsSync(join(other, '.draft.partial-123456abcdef')), true);
    forgetTemporary(scratch);
    assert.deepEqual(readdirSync(process.env.OPENFILM_TEMP_REGISTRY), []);
  } finally { if (old === undefined) delete process.env.OPENFILM_TEMP_REGISTRY; else process.env.OPENFILM_TEMP_REGISTRY = old; rmSync(root, { recursive: true, force: true }); }
});
