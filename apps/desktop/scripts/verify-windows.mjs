/** Validate an unpacked or installed Windows build, without calling any model. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODEX_BUILD, verifyCodexBundle } from './codex-bundle.mjs';

export function verifyWindowsApp(dir, { run = process.platform === 'win32' } = {}) {
  const runtime = join(dir, 'resources/runtime');
  const codex = verifyCodexBundle(join(runtime, 'codex'));
  const required = ['OpenFilm.exe', 'resources/app.asar',
    'resources/app.asar.unpacked/node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    'resources/app.asar.unpacked/node_modules/openfilm/skills/ad-editing/SKILL.md',
    'resources/app.asar.unpacked/node_modules/openfilm/skills/talk-editing/SKILL.md',
    'resources/app.asar.unpacked/node_modules/openfilm/skills/copy-rewrite/SKILL.md',
    'resources/app.asar.unpacked/node_modules/openfilm/skills/live-clips/SKILL.md',
    'resources/runtime/ffmpeg/ffmpeg.exe', 'resources/runtime/ffmpeg/ffprobe.exe'];
  for (const file of required) if (!existsSync(join(dir, file))) throw new Error(`Windows package is incomplete: ${file}`);
  const browsers = join(runtime, 'ms-playwright');
  const browserDir = readdirSync(browsers).find((name) => name.startsWith('chromium_headless_shell-'));
  const browser = browserDir && join(browsers, browserDir, 'chrome-headless-shell-win64/chrome-headless-shell.exe');
  if (!browser || !existsSync(browser)) throw new Error('The Windows headless browser is missing.');
  for (const file of [join(dir, 'OpenFilm.exe'), join(runtime, 'codex/bin/codex.exe'), browser]) {
    const bytes = readFileSync(file);
    const pe = bytes.readUInt32LE(0x3c);
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) {
      throw new Error(`Not a Windows x64 executable: ${file}`);
    }
  }
  if (run) {
    if (process.platform !== 'win32') throw new Error('Native runtime checks require Windows.');
    const call = (file, args) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    const version = call(join(runtime, 'codex/bin/codex.exe'), ['-c', 'check_for_update_on_startup=false', '--version']);
    if (!version.includes(CODEX_BUILD.version)) throw new Error(`Unexpected Codex version: ${version}`);
    call(join(runtime, 'codex/codex-path/rg.exe'), ['--version']);
    for (const name of ['ffmpeg', 'ffprobe']) call(join(runtime, 'ffmpeg', `${name}.exe`), ['-version']);
    call(browser, ['--version']);
  }
  return { platform: 'win32', arch: 'x64', codexVersion: codex.version, nativeChecks: run };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-windows.mjs <installed-or-unpacked-folder>');
  console.log(JSON.stringify(verifyWindowsApp(resolve(process.argv[2])), null, 2));
}
