import { VideoPolicyError } from './video-policy.mjs';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fileFor = dataDir => dataDir ? join(dataDir, 'sub2api.json') : null;
const storedFor = dataDir => {
  const file = fileFor(dataDir);
  if (!file || !existsSync(file)) return {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

/** Read the hosted model endpoint without ever passing the product key to Codex. */
export function readSub2ApiConfig(env = process.env, dataDir = null) {
  const stored = storedFor(dataDir);
  const rawBaseUrl = String(env.OPENFILM_SUB2API_BASE_URL ?? stored.baseUrl ?? '').trim();
  const apiKey = String(env.OPENFILM_SUB2API_API_KEY ?? stored.apiKey ?? '').trim();
  if (!rawBaseUrl && !apiKey) return null;
  if (!rawBaseUrl || !apiKey) throw new VideoPolicyError('请配置完整的 Sub2API 地址和 Key。');
  let url;
  try { url = new URL(rawBaseUrl); } catch { throw new VideoPolicyError('Sub2API 地址无效。'); }
  const insecure = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !insecure) throw new VideoPolicyError('Sub2API 生产地址必须使用 HTTPS。');
  if (url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname)) throw new VideoPolicyError('Sub2API 地址必须是域名下的 /v1。');
  url.pathname = '/v1';
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey, model: /^[\w.-]+$/.test(String(env.OPENFILM_SUB2API_MODEL ?? stored.model ?? '')) ? String(env.OPENFILM_SUB2API_MODEL ?? stored.model) : 'gpt-6.1-sol' };
}

export function saveSub2ApiConfig(dataDir, input) {
  const existing = storedFor(dataDir);
  const next = readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: input.baseUrl, OPENFILM_SUB2API_API_KEY: input.apiKey || existing.apiKey, OPENFILM_SUB2API_MODEL: input.model });
  mkdirSync(dataDir, { recursive: true });
  const file = fileFor(dataDir);
  writeFileSync(file, JSON.stringify({ baseUrl: next.baseUrl, apiKey: next.apiKey, model: next.model }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { baseUrl: next.baseUrl, model: next.model, configured: true };
}

export function publicSub2ApiConfig(dataDir) {
  const config = readSub2ApiConfig(process.env, dataDir);
  return config ? { baseUrl: config.baseUrl, model: config.model, configured: true } : { baseUrl: 'http://127.0.0.1:8188/v1', model: 'gpt-6.1-sol', configured: false };
}

export async function checkSub2ApiConfig(dataDir, input = {}, fetchImpl = fetch) {
  const stored = storedFor(dataDir);
  if (input.model !== undefined && !/^[\w.-]+$/.test(input.model)) throw new VideoPolicyError('模型名称无效。');
  const config = readSub2ApiConfig({ OPENFILM_SUB2API_BASE_URL: input.baseUrl || stored.baseUrl, OPENFILM_SUB2API_API_KEY: input.apiKey || stored.apiKey, OPENFILM_SUB2API_MODEL: input.model || stored.model });
  if (!config) throw new VideoPolicyError('请先填写 Sub2API 地址和 Key。');
  const response = await fetchImpl(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ model: config.model, input: 'Reply with OK.', stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new VideoPolicyError(`模型连接失败（HTTP ${response.status}）。`);
  const result = await response.json().catch(() => null);
  const replied = result?.output?.some?.(item => item.type === 'message' && item.content?.some?.(part => part.type === 'output_text' && typeof part.text === 'string' && part.text.trim()));
  if (result?.status !== 'completed' || !replied) throw new VideoPolicyError('模型未成功完成回复，请检查模型配置。');
  return { ok: true, baseUrl: config.baseUrl, model: config.model };
}
