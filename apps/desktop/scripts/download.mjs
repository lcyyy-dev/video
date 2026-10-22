/** Build-time downloads through the system's proxy-aware curl (also included with Windows). */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildFetch(url, { signal } = {}) {
  const cacheDir = fileURLToPath(new URL('../.release/cache/downloads/', import.meta.url));
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, createHash('sha256').update(String(url)).digest('hex'));
  // FFmpeg's existing loader checks the pinned archive checksum, including cache hits.
  if (existsSync(cached)) return Promise.resolve(new Response(readFileSync(cached)));
  console.log(`Downloading ${String(url).split('/').pop()}`);
  return new Promise((resolve, reject) => {
    execFile('curl', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '30',
      '--speed-time', '30', '--speed-limit', '1', '--max-time', '600', String(url)],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true, signal }, (error, stdout) => {
      if (error) reject(error);
      else { writeFileSync(cached, stdout); resolve(new Response(stdout)); }
    });
  });
}
