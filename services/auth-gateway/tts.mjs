import { randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

/** The gateway constructs the entire upstream request; callers cannot supply proxy options. */
export function ttsInput(input, speakers) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['text', 'speaker', 'speechRate'].includes(key))) throw fail(400, '配音参数无效');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw fail(400, '每次配音需要 1–2000 字符');
  if (!speakers.includes(input.speaker)) throw fail(400, '音色不可用');
  const speechRate = input.speechRate ?? 0;
  if (!Number.isInteger(speechRate) || speechRate < -50 || speechRate > 100) throw fail(400, '语速无效');
  return { text: input.text, speaker: input.speaker, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: speechRate, enable_subtitle: true } };
}

/** Read NDJSON incrementally with hard bounds. Never expose provider errors or headers to clients. */
export async function synthesizeTts({ input, speakers, key, fetchImpl = fetch, signal }) {
  const req_params = ttsInput(input, speakers);
  if (!key) throw fail(503, '旁白服务尚未配置');
  const requestId = randomUUID();
  const response = await fetchImpl(TTS_ENDPOINT, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    headers: { 'content-type': 'application/json', 'X-Api-Key': key, 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': requestId },
    body: JSON.stringify({ req_params }),
  });
  if (!response.ok || !response.body) throw fail(502, '豆包配音请求失败，请检查服务配置与余额');
  const audio = [], words = []; let pending = '', size = 0, completed = false;
  const parse = line => {
    if (!line.trim()) return;
    let item; try { item = JSON.parse(line); } catch { throw fail(502, '配音响应格式无效'); }
    if (item.code === 20000000) { completed = true; return; }
    if (item.code !== 0) throw fail(502, '豆包配音未完成，请检查服务后重试');
    if (item.data) {
      if (typeof item.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw fail(502, '配音数据无效');
      audio.push(Buffer.from(item.data, 'base64'));
    }
    if (item.sentence?.words) {
      if (!Array.isArray(item.sentence.words)) throw fail(502, '配音时间戳无效');
      for (const w of item.sentence.words) {
        if (typeof w.word !== 'string' || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime) || w.startTime < 0 || w.endTime < w.startTime) throw fail(502, '配音时间戳无效');
        words.push({ text: w.word, start: w.startTime, end: w.endTime });
      }
    }
  };
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 24 * 1024 * 1024) throw fail(502, '配音响应过大');
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) { parse(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    }
    parse(pending + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed || !audio.length) throw fail(502, completed ? '配音未返回音频' : '配音响应不完整');
  return { audio: Buffer.concat(audio).toString('base64'), format: 'mp3', words, requestId };
}
