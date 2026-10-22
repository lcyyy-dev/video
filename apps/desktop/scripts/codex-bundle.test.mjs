import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CODEX_BUILD, CODEX_REQUIRED, verifyCodexArchive, verifyCodexBundle } from './codex-bundle.mjs';

test('an altered archive cannot enter the installer', () => {
  assert.throws(() => verifyCodexArchive(Buffer.from('corrupt download')), /checksum mismatch/);
});

test('missing helpers and damaged bundled files stop package verification', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-codex-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = {};
  for (const name of CODEX_REQUIRED) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), name);
    files[name] = createHash('sha256').update(name).digest('hex');
  }
  const save = () => writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...CODEX_BUILD, files }));
  save();
  assert.equal(verifyCodexBundle(dir).version, CODEX_BUILD.version);
  writeFileSync(join(dir, 'bin/codex.exe'), 'damaged');
  assert.throws(() => verifyCodexBundle(dir), /Damaged Codex/);
  delete files['codex-path/rg.exe'];
  save();
  assert.throws(() => verifyCodexBundle(dir), /component missing/);
});
