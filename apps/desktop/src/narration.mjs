import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadTemplate } from './edit-workflow.mjs';
import { videoFile, assertVideoStorage } from './video-policy.mjs';

const exec = promisify(execFile);
const generating = new Set();
export async function speechRequest(hosted, path, input, signal) {
  if (!hosted) throw new Error('请先激活 OpenFilm。');
  const response = await hosted.fetchImpl(`${new URL(hosted.baseUrl).origin}/tts/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    signal: signal ?? AbortSignal.timeout(130000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message ?? '旁白服务请求失败。');
  return result;
}
export function narrationSentences(text) {
  return [...new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(String(text))]
    .map(part => part.segment).filter(s => s.trim());
}
const timestamp = seconds => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
export function narrationVtt(words) {
  if (!words.length) return 'WEBVTT\n\n';
  let previous = 0;
  const payload = words.map((w, index) => {
    if (typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < previous || w.end <= w.start) throw new Error('旁白字幕时间戳无效。');
    previous = w.start;
    const text = w.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]/g, ' ');
    return `${index ? `<${timestamp(w.start)}>` : ''}${text}`;
  }).join('');
  return `WEBVTT\n\n${timestamp(words[0].start)} --> ${timestamp(words.at(-1).end)}\n${payload}\n`;
}
export async function probeNarration(file, { ffprobe = 'ffprobe', signal, env = process.env } = {}) {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { windowsHide: true, timeout: 15000, signal, env });
  const media = JSON.parse(stdout), duration = Number(media.format?.duration);
  if (!media.streams?.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0 || duration > 1800) throw new Error('旁白音频无法读取或时长无效。');
  return duration;
}

/** Native writes use content-addressed audio, never paths or text supplied by the model. */
export async function generateNarration(project, hosted, { signal, ffprobe, env, probe = probeNarration } = {}) {
  if (generating.has(project)) throw new Error('当前工程旁白正在生成，请等待完成。');
  generating.add(project);
  try { return await generateProjectNarration(project, hosted, { signal, ffprobe, env, probe }); }
  finally { generating.delete(project); }
}
async function generateProjectNarration(project, hosted, { signal, ffprobe, env, probe }) {
  assertVideoStorage(project);
  const config = loadTemplate(project);
  if (config.kind !== 'ad' || !config.body || !config.narration) throw new Error('仅广告模板开启文案朗读时可生成旁白。');
  const sentences = narrationSentences(config.bodyText);
  if (!sentences.length || sentences.some(s => s.length > 2000)) throw new Error('请填写广告正文，每句不超过 2000 字符。');
  assertVideoStorage(project);
  const dir = videoFile(project, 'assets/narration', { optional: true });
  mkdirSync(dir, { recursive: true });
  videoFile(project, 'assets/narration');
  const results = []; let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    signal?.throwIfAborted();
    const input = { text: sentences[i], speaker: config.speaker, speechRate: config.speechRate };
    const hash = createHash('sha256').update(JSON.stringify({ model: 'seed-tts-2.0', ...input })).digest('hex');
    const src = `assets/narration/${hash}.mp3`;
    const file = videoFile(project, src, { optional: true });
    videoFile(project, src.replace('.mp3', '.vtt'), { optional: true });
    const receipt = videoFile(project, `assets/narration/${hash}.json`, { optional: true });
    let duration, cached = false;
    try {
      const saved = JSON.parse(readFileSync(receipt, 'utf8'));
      const bytes = readFileSync(file);
      if (saved.sha256 === createHash('sha256').update(bytes).digest('hex')) {
        duration = await probe(file, { ffprobe, signal, env });
        if (Array.isArray(saved.words) && saved.words.length) {
          const subtitle = videoFile(project, src.replace('.mp3', '.vtt'), { optional: true });
          try { readFileSync(subtitle); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            writeFileSync(subtitle, narrationVtt(saved.words), { flag: 'wx' });
          }
        }
        cached = true;
      }
    } catch (error) { if (signal?.aborted) throw error; }
    if (!cached) {
      const result = await speechRequest(hosted, 'synthesize', input, signal).catch(error => {
        throw new Error(`第 ${i + 1} 句旁白未完成：${error.message}。已成功生成的句子会在重试时复用。`);
      });
      if (result.format !== 'mp3' || typeof result.audio !== 'string' || result.audio.length > 32 * 1024 * 1024) throw new Error('旁白返回格式无效。');
      const bytes = Buffer.from(result.audio, 'base64');
      if (!bytes.length) throw new Error('旁白未返回音频。');
      const temporary = videoFile(project, `assets/narration/${hash}-${randomUUID()}.mp3`, { optional: true });
      writeFileSync(temporary, bytes, { flag: 'wx' });
      try {
        duration = await probe(temporary, { ffprobe, signal, env });
        videoFile(project, src, { optional: true }); renameSync(temporary, file);
      } finally { try { unlinkSync(temporary); } catch {} }
      const words = Array.isArray(result.words) ? result.words : [];
      if (words.length) {
        if (words.some(w => w.end > duration + 0.15)) throw new Error('字幕时间戳超出旁白时长。');
        writeFileSync(videoFile(project, src.replace('.mp3', '.vtt'), { optional: true }), narrationVtt(words));
      }
      writeFileSync(videoFile(project, `assets/narration/${hash}.json`, { optional: true }), JSON.stringify({ ...input, duration, words, requestId: result.requestId, sha256: createHash('sha256').update(bytes).digest('hex') }));
    }
    results.push({ id: `s${String(i + 1).padStart(3, '0')}`, text: input.text, src, duration, start, end: start + duration, cached });
    start += duration + 0.2;
  }
  if (JSON.stringify(loadTemplate(project)) !== JSON.stringify(config)) throw new Error('生成期间模板已修改，请重新生成旁白。');
  assertVideoStorage(project);
  const manifest = { version: 1, model: 'seed-tts-2.0', speaker: config.speaker, speechRate: config.speechRate, duration: results.at(-1).end, sentences: results };
  mkdirSync(join(project, '.film'), { recursive: true });
  writeFileSync(join(project, '.film', 'narration.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
