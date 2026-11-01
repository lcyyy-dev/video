import { createServer } from 'node:http';
import { createHash, createPublicKey, createHmac, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { synthesizeTts } from './tts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
async function bodyOf(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > (req.url.startsWith('/tts/') ? 16000 : 32 * 1024 * 1024)) throw fail(413, '请求过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createGateway(config) {
  if (!config.secret || config.secret.length < 32) throw new Error('GATEWAY_SECRET 至少需要 32 字符');
  const fetchImpl = config.fetchImpl ?? fetch;
  const nonces = new Map();
  const ttsLimits = new Map();
  const speakers = (config.ttsSpeakers ?? 'zh_female_vv_uranus_bigtts').split(',').map(s => s.trim()).filter(Boolean);
  const mappings = () => JSON.parse(readFileSync(config.mappingFile, 'utf8'));
  function issue(claims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${createHmac('sha256', config.secret).update(payload).digest('base64url')}`;
  }
  function decode(token, kind) {
    const [payload, signature, extra] = String(token).split('.');
    if (!payload || !signature || extra || !equal(signature, createHmac('sha256', config.secret).update(payload).digest('base64url'))) throw fail(401, '凭证无效');
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw fail(401, '凭证无效'); }
    if (claims.kind !== kind || claims.exp < Date.now()) throw fail(401, '凭证已过期');
    return claims;
  }
  function proof(req, body, publicKey, token = '') {
    let key;
    try { key = createPublicKey(publicKey); } catch { throw fail(401, '设备公钥无效'); }
    if (key.asymmetricKeyType !== 'ed25519') throw fail(401, '设备密钥类型无效');
    const time = req.headers['x-openfilm-time'], nonce = req.headers['x-openfilm-nonce'];
    if (!time || !nonce || nonce.length > 128 || !Number.isFinite(Number(time)) || Math.abs(Date.now() - Number(time)) > 60000) throw fail(401, '设备签名已过期');
    const fingerprint = hash(publicKey);
    const nonceKey = `${fingerprint}:${nonce}`;
    for (const [id, expiry] of nonces) if (expiry < Date.now()) nonces.delete(id);
    if (nonces.has(nonceKey)) throw fail(401, '重复请求');
    const message = [req.method, req.url, time, nonce, hash(body), hash(token)].join('\n');
    let valid = false;
    try { valid = verify(null, Buffer.from(message), key, Buffer.from(req.headers['x-openfilm-signature'] ?? '', 'base64')); } catch { /* invalid proof */ }
    if (!valid) throw fail(401, '设备签名无效');
    nonces.set(nonceKey, Date.now() + 120000);
    return fingerprint;
  }
  async function keygen(path, body) {
    const response = await fetchImpl(`${config.keygenUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${config.keygenToken}`, 'content-type': 'application/vnd.api+json', accept: 'application/vnd.api+json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw fail(response.status < 500 ? 403 : 503, '授权服务拒绝请求');
    return result;
  }
  async function validate(license, fingerprint) {
    const result = await keygen(`/licenses/${encodeURIComponent(license)}/actions/validate`, { meta: { scope: { fingerprint } } });
    if (!result.meta?.valid) throw fail(403, '授权无效、已过期或设备已解绑');
    return result;
  }
  function access(license, fingerprint) {
    const expiresAt = Date.now() + 5 * 60000;
    return { accessToken: issue({ kind: 'access', license, fingerprint, exp: expiresAt }), expiresAt };
  }
  return createServer(async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const allowed = req.method === 'POST' && ['/auth/activate', '/auth/refresh', '/auth/status', '/v1/responses', '/tts/synthesize', '/tts/voices'].includes(req.url) || req.method === 'GET' && req.url === '/v1/models';
      if (!allowed) return json(404, { error: { message: '接口不存在' } });
      const raw = await bodyOf(req);
      if (req.url === '/auth/activate') {
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '请求格式无效'); }
        const fingerprint = proof(req, raw, input.publicKey);
        if (typeof input.activationCode !== 'string' || input.activationCode.length > 512) throw fail(400, '激活码无效');
        const found = await keygen('/licenses/actions/validate-key', { meta: { key: input.activationCode, scope: { fingerprint } } });
        const license = found.data?.id;
        if (!license || !mappings()[license]) throw fail(403, '授权尚未关联模型服务');
        if (!found.meta?.valid) {
          if (!['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH'].includes(found.meta?.code)) throw fail(403, '激活码不可用');
          await keygen('/machines', { data: { type: 'machines', attributes: { fingerprint }, relationships: { license: { data: { type: 'licenses', id: license } } } } });
        }
        await validate(license, fingerprint);
        return json(200, { refreshToken: issue({ kind: 'refresh', license, fingerprint, exp: Date.now() + 365 * 86400000 }), ...access(license, fingerprint) });
      }
      if (req.url === '/auth/refresh') {
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '请求格式无效'); }
        const claims = decode(input.refreshToken, 'refresh');
        const fingerprint = proof(req, raw, input.publicKey);
        if (fingerprint !== claims.fingerprint) throw fail(403, '设备不匹配');
        if (!mappings()[claims.license]) throw fail(403, '授权已撤销');
        await validate(claims.license, fingerprint);
        return json(200, access(claims.license, fingerprint));
      }
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const claims = decode(token, 'access');
      const publicKey = req.headers['x-openfilm-public-key'];
      let pem; try { pem = Buffer.from(publicKey ?? '', 'base64').toString(); } catch { throw fail(401, '设备信息无效'); }
      if (proof(req, raw, pem, token) !== claims.fingerprint) throw fail(403, '设备不匹配');
      const mapping = mappings()[claims.license];
      if (!mapping) throw fail(403, '授权已撤销');
      await validate(claims.license, claims.fingerprint);
      if (req.url === '/auth/status') return json(200, { authorized: true });
      if (req.url === '/tts/voices') return json(200, { configured: Boolean(config.ttsKey), speakers });
      if (req.url === '/tts/synthesize') {
        if (raw.length > 16000) throw fail(413, '配音请求过大');
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '配音参数无效'); }
        const now = Date.now();
        for (const [id, entry] of ttsLimits) if (!entry.active && entry.reset <= now) ttsLimits.delete(id);
        const limit = ttsLimits.get(claims.license) ?? { count: 0, active: 0, reset: now + 60000 };
        if (limit.reset <= now) { limit.count = 0; limit.reset = now + 60000; }
        if (limit.active >= 2 || limit.count >= 30) throw fail(429, '配音请求过于频繁，请稍后重试');
        limit.count++; limit.active++; ttsLimits.set(claims.license, limit);
        try {
          return json(200, await synthesizeTts({ input, speakers, key: config.ttsKey, fetchImpl, signal: abort.signal }));
        } finally { limit.active--; }
      }
      if (!mapping.apiKey) throw fail(403, '授权尚未关联模型服务');
      const headers = { authorization: `Bearer ${mapping.apiKey}`, 'content-type': req.headers['content-type'] ?? 'application/json', accept: req.headers.accept ?? 'text/event-stream' };
      for (const name of ['openai-beta', 'session_id', 'conversation_id', 'content-encoding']) if (req.headers[name]) headers[name] = req.headers[name];
      const response = await fetchImpl(`${config.sub2apiUrl.replace(/\/$/, '')}${req.url.slice(3)}`, { method: req.method, headers, redirect: 'error', signal: abort.signal, ...(req.method === 'POST' ? { body: raw } : {}) });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(error.status ?? 502, { error: { message: error.status ? error.message : '服务连接失败，请重试' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway({ secret: process.env.GATEWAY_SECRET, mappingFile: process.env.MAPPING_FILE ?? '/data/mappings.json', keygenUrl: process.env.KEYGEN_URL, keygenToken: process.env.KEYGEN_TOKEN, sub2apiUrl: process.env.SUB2API_URL, ttsKey: process.env.DOUBAO_TTS_API_KEY, ttsSpeakers: process.env.DOUBAO_TTS_SPEAKERS });
  server.listen(Number(process.env.PORT ?? 8787), process.env.BIND ?? '0.0.0.0');
}
