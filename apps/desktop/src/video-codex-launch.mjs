import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
export function videoCodexLaunchEnv(realCodex, { directory, nodeCommand, nodeArgs = [], windows = process.platform === 'win32' }) {
  const script = fileURLToPath(new URL('./project-app-server.mjs', import.meta.url));
  const file = join(directory, windows ? 'codex-video.cmd' : 'codex-video.sh');
  const args = [...nodeArgs, script];
  if (nodeArgs.length > 1) throw new Error('Unsupported Codex runtime');
  const command = windows ? `@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n${nodeArgs.length ? 'set "ELECTRON_RUN_AS_NODE=1"\r\n' : ''}"%OPENFILM_VIDEO_NODE%" ${nodeArgs.length ? '"%OPENFILM_VIDEO_BOOTSTRAP%" ' : ''}"%OPENFILM_VIDEO_PROXY%" %*\r\n`
    : `#!/bin/sh\n${nodeArgs.length ? 'export ELECTRON_RUN_AS_NODE=1\n' : ''}exec ${[nodeCommand, ...args].map(quote).join(' ')} "$@"\n`;
  writeFileSync(file, command, { mode: 0o700 });
  return { CODEX_PATH: file, OPENFILM_VIDEO_REAL_CODEX: realCodex, OPENFILM_VIDEO_NODE: nodeCommand, OPENFILM_VIDEO_PROXY: script, ...(nodeArgs.length ? { OPENFILM_VIDEO_BOOTSTRAP: nodeArgs[0] } : {}) };
}
