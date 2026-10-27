import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { videoFile, VideoPolicyError } from './video-policy.mjs';

const exec = promisify(execFile);

/** Local provider kept behind this interface so it can be replaced by cloud TTS later. */
export async function synthesizeOffline({ root, text, out, sid = 0, signal }) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = dirname(dirname(dirname(sourceDir)));
  const python = join(repoRoot, '.dev', 'offline-tts', 'venv', 'bin', 'python');
  const script = join(sourceDir, 'offline-tts.py');
  // Virtualenv's python is normally a symlink to its versioned interpreter.
  if (!existsSync(python) || !existsSync(script)) {
    throw new VideoPolicyError('本地离线语音包不可用，请安装 .dev/offline-tts 后重试。');
  }
  const destination = videoFile(root, out, { optional: true });
  mkdirSync(dirname(destination), { recursive: true });
  try {
    const result = await exec(python, [script, '--text', text, '--out', destination, '--sid', String(sid)], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    if (signal?.aborted) throw new Error('cancelled');
    throw new VideoPolicyError(`离线语音生成失败：${error?.message ?? '未知错误'}`);
  }
}
