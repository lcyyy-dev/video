/** Upload-time source index, shared with native Codex through project files. No conversation or editing logic. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { extname, join } from 'node:path';
import { videoFile, assertVideoStorage } from './video-policy.mjs';

const run = promisify(execFile);
const jobs = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
const videos = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const images = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const formats = 'mov,matroska,webm,avi,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,image2';

export function precomputeUploadFrames(options) {
  const root = realpathSync(options.root);
  const pending = jobs.get(root);
  if (pending) { pending.again = true; return pending.promise; }
  const state = { again: false, promise: null };
  state.promise = (async () => {
    let result;
    do { state.again = false; result = await analyze({ ...options, root }); } while (state.again);
    return result;
  })().finally(() => jobs.delete(root));
  jobs.set(root, state);
  return state.promise;
}

async function analyze({ root, ffmpegDir }) {
  assertVideoStorage(root);
  const folder = join(root, '.film', 'source-analysis');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'index.json');
  let previous;
  try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { previous = { sources: [] }; }
  const sources = [];
  const visit = prefix => {
    if (!existsSync(join(root, prefix))) return;
    const dir = videoFile(root, prefix);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && (videos.has(extname(name).toLowerCase()) || images.has(extname(name).toLowerCase()))) sources.push(name);
    }
  };
  visit('assets/upload');
  const binary = name => ffmpegDir ? join(ffmpegDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  const invoke = async (name, args) => (await run(binary(name), args, { encoding: 'buffer', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout;
  const index = { version: 1, intervalSeconds: 2, sources: [] };
  for (const name of sources.sort()) {
    const source = videoFile(root, name), stat = statSync(source);
    const signature = hash(`${name}:${stat.size}:${stat.mtimeMs}:${stat.ino}`);
    const old = previous.sources?.find(item => item.path === name && item.signature === signature);
    if (old?.frames?.every(frame => existsSync(join(root, frame.path)))) { index.sources.push(old); continue; }
    const info = JSON.parse((await invoke('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats, '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', source])).toString());
    const stream = info.streams?.find(item => item.codec_type === 'video');
    if (!stream) throw new Error(`无法读取视频素材：${name}`);
    const still = images.has(extname(name).toLowerCase());
    const duration = still ? null : Number(info.format?.duration ?? stream.duration);
    if (!still && (!Number.isFinite(duration) || duration <= 0)) throw new Error(`素材时长无效：${name}`);
    const item = { path: name, signature, duration, width: stream.width, height: stream.height, frames: [] };
    for (let time = 0; time < (still ? 1 : duration); time += 2) {
      const path = `.film/source-analysis/${signature}-${time}.png`;
      const bytes = await invoke('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats, '-ss', String(time), '-i', source, '-frames:v', '1', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
      writeFileSync(join(root, path), bytes);
      item.frames.push({ time, path });
    }
    index.sources.push(item);
  }
  writeFileSync(`${file}.tmp`, JSON.stringify(index, null, 2));
  renameSync(`${file}.tmp`, file);
  return index;
}
