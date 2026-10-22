/** Stage the complete, checksum-pinned Windows Codex distribution, including its helper programs. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CODEX_BUILD = Object.freeze(JSON.parse(readFileSync(join(here, 'codex-build.json'), 'utf8')));
export const CODEX_REQUIRED = ['bin/codex.exe', 'bin/codex-code-mode-host.exe', 'codex-path/rg.exe',
  'codex-resources/codex-command-runner.exe', 'codex-resources/codex-windows-sandbox-setup.exe', 'codex-package.json', 'LICENSE', 'NOTICE'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyCodexArchive(bytes, integrity = CODEX_BUILD.integrity) {
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== integrity) throw new Error('Codex archive checksum mismatch. Refusing to package it.');
}

function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

export function verifyCodexBundle(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (manifest.version !== CODEX_BUILD.version || manifest.integrity !== CODEX_BUILD.integrity) throw new Error('Wrong bundled Codex version.');
  for (const file of CODEX_REQUIRED) if (!manifest.files?.[file]) throw new Error(`Codex component missing: ${file}`);
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (file.includes('..') || file.startsWith('/') || file.includes('\\')) throw new Error(`Invalid Codex manifest path: ${file}`);
    if (hash(readFileSync(join(dir, file))) !== digest) throw new Error(`Damaged Codex component: ${file}`);
  }
  return manifest;
}

export function stageCodex(runtime, { cacheDir, arch = 'x64' }) {
  if (arch !== CODEX_BUILD.arch) throw new Error('The bundled Windows release currently supports x64 only.');
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, `codex-${CODEX_BUILD.version}-win32-${arch}.tgz`);
  if (!existsSync(archive)) {
    execFileSync('curl', ['--fail', '--location', '--retry', '3', '--connect-timeout', '30', '--max-time', '1200',
      '--output', `${archive}.part`, CODEX_BUILD.url], { stdio: 'inherit', windowsHide: true });
    verifyCodexArchive(readFileSync(`${archive}.part`));
    cpSync(`${archive}.part`, archive);
    rmSync(`${archive}.part`);
  }
  verifyCodexArchive(readFileSync(archive));
  const scratch = mkdtempSync(join(cacheDir, 'unpack-'));
  const target = join(runtime, 'codex');
  try {
    execFileSync('tar', ['-xzf', archive, '-C', scratch], { windowsHide: true });
    const pkg = join(scratch, 'package');
    cpSync(join(pkg, 'vendor', CODEX_BUILD.target), target, { recursive: true });
    cpSync(join(pkg, 'README.md'), join(target, 'README.md'));
    for (const name of ['LICENSE', 'NOTICE']) cpSync(join(here, '../build/licenses/codex', name), join(target, name));
    const manifest = { ...CODEX_BUILD, files: Object.fromEntries(filesIn(target)
      .map((file) => [relative(target, file).replaceAll('\\', '/'), hash(readFileSync(file))])) };
    writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    verifyCodexBundle(target);
    return manifest;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
