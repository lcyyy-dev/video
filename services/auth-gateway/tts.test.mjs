import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeTts, ttsInput, TTS_ENDPOINT } from './tts.mjs';

const speakers = ['zh_female_vv_uranus_bigtts'];
const input = { text: '欢迎光临。', speaker: speakers[0], speechRate: 0 };
test('TTS rejects proxy parameters, unknown voices and invalid rates', () => {
  for (const value of [{ ...input, url: 'http://localhost' }, { ...input, headers: {} }, { ...input, speaker: 'unknown' }, { ...input, speechRate: 101 }, { ...input, text: '' }, { ...input, text: '字'.repeat(2001) }]) {
    assert.throws(() => ttsInput(value, speakers));
  }
});
test('TTS builds fixed upstream request and decodes split NDJSON with real timestamps', async () => {
  const lines = JSON.stringify({ code: 0, data: Buffer.from('audio').toString('base64'), sentence: { words: [{ word: '欢迎', startTime: 0, endTime: 1 }] } }) + '\n' + JSON.stringify({ code: 20000000 });
  const bytes = new TextEncoder().encode(lines);
  const result = await synthesizeTts({ input, speakers, key: 'server-secret', signal: new AbortController().signal, fetchImpl: async (url, options) => {
    assert.equal(url, TTS_ENDPOINT);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Api-Key'], 'server-secret');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(JSON.parse(options.body).req_params.audio_params.enable_subtitle, true);
    return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 53)); c.enqueue(bytes.slice(53)); c.close(); } }));
  } });
  assert.equal(Buffer.from(result.audio, 'base64').toString(), 'audio');
  assert.deepEqual(result.words, [{ text: '欢迎', start: 0, end: 1 }]);
  assert.ok(!JSON.stringify(result).includes('server-secret'));
});
test('TTS fails on provider error after partial audio and never retries', async () => {
  let calls = 0;
  await assert.rejects(synthesizeTts({ input, speakers, key: 'secret', signal: new AbortController().signal, fetchImpl: async () => {
    calls++;
    return new Response('{"code":0,"data":"YQ=="}\n{"code":123,"message":"secret"}\n');
  } }), /未完成/);
  assert.equal(calls, 1);
});
test('TTS rejects truncated success chunks without terminal success', async () => {
  await assert.rejects(synthesizeTts({ input, speakers, key: 'secret', signal: new AbortController().signal,
    fetchImpl: async () => new Response('{"code":0,"data":"YQ=="}\n') }), /不完整/);
});
