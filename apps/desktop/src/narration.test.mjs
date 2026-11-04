import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateNarration, narrationRatePlan, narrationSentences } from './narration.mjs';
import { saveTemplate } from './edit-workflow.mjs';
import { initialTemplate } from './edit-template.mjs';

const ffmpegDir = process.env.OPENFILM_TEST_FFMPEG_DIR ?? fileURLToPath(new URL('../.dev/runtime/ffmpeg/', import.meta.url));
const binary = name => join(ffmpegDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
test('generated sentence audio is probed with real FFprobe and invalid media cannot be cached', { skip: !existsSync(binary('ffmpeg')) || !existsSync(binary('ffprobe')) }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'narration-media-'));
  try {
    const sample = join(root, 'sample.mp3');
    execFileSync(binary('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', sample]);
    saveTemplate(root, { ...initialTemplate(), narration: true, bodyText: '测试音频。' });
    const hosted = { baseUrl: 'https://gateway.test/v1', fetchImpl: async () => Response.json({ audio: readFileSync(sample).toString('base64'), format: 'mp3', words: [] }) };
    const manifest = await generateNarration(root, hosted, { ffprobe: binary('ffprobe') });
    assert.ok(manifest.duration >= 1 && manifest.duration < 1.2);
    assert.equal(manifest.sentences[0].cached, false);
    const cached = await generateNarration(root, hosted, { ffprobe: binary('ffprobe') });
    assert.equal(cached.sentences[0].cached, true);
    saveTemplate(root, { ...initialTemplate(), narration: true, bodyText: '无效音频。' });
    await assert.rejects(generateNarration(root, { ...hosted, fetchImpl: async () => Response.json({ audio: 'aW52YWxpZA==', format: 'mp3', words: [] }) }, { ffprobe: binary('ffprobe') }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native narration preserves original punctuation, caches unchanged sentences, and rejects other templates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'narration-'));
  let calls = 0;
  const hosted = { baseUrl: 'https://gateway.test/v1', fetchImpl: async (url, opts) => {
    assert.equal(url, 'https://gateway.test/tts/synthesize');
    assert.equal(JSON.parse(opts.body).speaker, 'zh_female_vv_uranus_bigtts'); calls++;
    return Response.json({ audio: Buffer.from('fake-for-probe').toString('base64'), format: 'mp3', words: [{ text: '欢迎', start: 0, end: 0.8 }], requestId: 'id' });
  } };
  const options = { probe: async () => 1 };
  try {
    const config = { ...initialTemplate(), narration: true, bodyText: '欢迎光临。今天有优惠！' };
    saveTemplate(root, config);
    const result = await generateNarration(root, hosted, options);
    assert.equal(calls, 2);
    assert.equal(result.sentences.map(s => s.text).join(''), config.bodyText);
    assert.equal(result.sentences[1].start, 1.2);
    assert.equal(result.duration, 2.2);
    const subtitle = join(root, result.sentences[0].src.replace('.mp3', '.vtt'));
    assert.equal(existsSync(subtitle), false, 'TTS must not generate duplicate captions');
    const receipt = JSON.parse(readFileSync(join(root, result.sentences[0].src.replace('.mp3', '.json')), 'utf8'));
    assert.equal(receipt.words.length, 1, 'timing metadata remains available');
    await generateNarration(root, hosted, options); assert.equal(calls, 2);
    assert.equal(existsSync(subtitle), false, 'cache reuse must not restore captions');
    saveTemplate(root, { ...config, titleText: '新标题', bodyText: '欢迎光临。全场优惠！' });
    await generateNarration(root, hosted, options); assert.equal(calls, 3);
    saveTemplate(root, { ...config, kind: 'copy' });
    await assert.rejects(generateNarration(root, hosted, options), /仅广告/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('native narration rejects linked asset destinations before contacting service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'narration-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'narration-outside-'));
  try {
    saveTemplate(root, { ...initialTemplate(), narration: true, bodyText: '你好。' });
    mkdirSync(join(root, 'assets')); symlinkSync(outside, join(root, 'assets/narration'));
    await assert.rejects(generateNarration(root, { fetchImpl: () => { throw new Error('must not contact service'); } }), /链接/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
test('narration splitting keeps complete copy', () => {
  assert.equal(narrationSentences('你好，世界！\n欢迎。').join(''), '你好，世界！\n欢迎。');
  assert.deepEqual(narrationSentences('他说：“欢迎。” Hello world. Next sentence.'), ['他说：“欢迎。” ', 'Hello world. ', 'Next sentence.']);

});

test('failed narration preserves completed sentences for retry and cancellation stops before service access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'narration-retry-'));
  let calls = 0, failing = true;
  const hosted = { baseUrl: 'https://gateway.test/v1', fetchImpl: async () => {
    calls++;
    if (calls === 2 && failing) return Response.json({ error: { message: 'service unavailable' } }, { status: 503 });
    return Response.json({ audio: 'YXVkaW8=', format: 'mp3', words: [] });
  } };
  try {
    saveTemplate(root, { ...initialTemplate(), narration: true, bodyText: '第一句。第二句。' });
    await assert.rejects(generateNarration(root, hosted, { probe: async () => 1 }), /第 2 句旁白未完成/);
    failing = false;
    const result = await generateNarration(root, hosted, { probe: async () => 1 });
    assert.equal(calls, 3); assert.equal(result.sentences[0].cached, true);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(generateNarration(root, hosted, { signal: abort.signal }));
    assert.equal(calls, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('target duration estimates a bounded speech rate and preserves original copy', async () => {
  const calibrated = narrationRatePlan('测试正文。', 20, { baselineSeconds: 32.808, baselineRate: 0, sentenceCount: 4 });
  assert.equal(calibrated.speechRate, 69);
  assert.ok(Math.abs(calibrated.estimatedSeconds - 20) < 0.1);
  assert.equal(calibrated.basis, 'previous-audio');
  assert.equal(narrationRatePlan('很长的文案。'.repeat(50), 2).speechRate, 100);
  assert.equal(narrationRatePlan('你好。', 100).speechRate, -50);
  assert.throws(() => narrationRatePlan('正文', NaN), /目标时长/);
  const root = mkdtempSync(join(tmpdir(), 'narration-target-'));
  const rates = [];
  try {
    saveTemplate(root, { ...initialTemplate(), narration: true, bodyText: '第一句话。第二句话。' });
    const hosted = { baseUrl: 'https://gateway.test/v1', fetchImpl: async (url, options) => {
      const input = JSON.parse(options.body); rates.push(input.speechRate);
      return Response.json({ audio: 'YXVkaW8=', format: 'mp3', words: [] });
    } };
    await generateNarration(root, hosted, { probe: async () => 2 });
    rates.length = 0;
    const result = await generateNarration(root, hosted, { targetSeconds: 3, probe: async () => 1.4 });
    assert.equal(result.speechRate, 40);
    assert.deepEqual(rates, [40, 40]);
    assert.equal(result.sentences.map(s => s.text).join(''), '第一句话。第二句话。');
    assert.equal(result.ratePlan.basis, 'previous-audio');
    await generateNarration(root, hosted, { targetSeconds: 3, probe: async () => 1.4 });
    assert.equal(rates.length, 2, 'same target and measured baseline reuse audio');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
