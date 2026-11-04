import { openProfileStore } from './profiles.mjs';
import { openLogStore } from './log-store.mjs';
import { createEventLog, keyReference, errorCode } from './logs.mjs';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createHash, createPublicKey, createHmac, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { synthesizeTts } from './tts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const revoked = (code='LICENSE_REVOKED') => Object.assign(fail(403,'授权已停用、过期或设备已解绑，请重新激活。'),{authorizationCode:code});
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
  const log = config.log ?? createEventLog({store:config.logStore, source:'gateway',stdout:config.logStdout ?? true});
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
  async function keygen(path, body, context = {}) {
    const started = performance.now();context.stage='keygen';
    try {
    const response = await fetchImpl(`${config.keygenUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${config.keygenToken}`, 'content-type': 'application/vnd.api+json', accept: 'application/vnd.api+json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify(body),
    });
    log('upstream.keygen',{...context,upstreamStatus:response.status,durationMs:Math.round(performance.now()-started)},response.ok?'info':'error');
    const result = await response.json();
    if (!response.ok) throw fail(context.path==='/auth/activate'&&response.status<500?403:503, '授权服务暂时无法完成校验，请稍后重试');
    return result;
    }catch(error){log('upstream.keygen_error',{...context,errorCode:errorCode(error),durationMs:Math.round(performance.now()-started)},'error');throw error;}
  }
  async function validate(license, fingerprint, context) {
    const result = await keygen(`/licenses/${encodeURIComponent(license)}/actions/validate`, { meta: { scope: { fingerprint } } }, context);
    if(typeof result.meta?.valid!=='boolean')throw fail(503,'授权服务返回无效状态，请稍后重试');
    if(!result.meta.valid){
      const code=String(result.meta.code??'');context.keygenCode=code;
      throw revoked(/SUSPENDED/.test(code)?'LICENSE_SUSPENDED':/EXPIRED/.test(code)?'LICENSE_EXPIRED':/NO_MACHINE|FINGERPRINT_SCOPE_MISMATCH|MACHINE_SCOPE_MISMATCH/.test(code)?'DEVICE_UNBOUND':'LICENSE_REVOKED');
    }
    return result;
  }
  function access(license, fingerprint) {
    const expiresAt = Date.now() + 5 * 60000;
    return { accessToken: issue({ kind: 'access', license, fingerprint, exp: expiresAt }), expiresAt };
  }
  return createServer(async (req, res) => {
    const started=performance.now(), requestId=randomUUID();
    const knownPaths=new Set(['/auth/activate','/auth/refresh','/auth/status','/account/quota','/account/profile','/v1/responses','/v1/models','/tts/synthesize','/tts/voices','/healthz']);
    const context={requestId,method:req.method,path:knownPaths.has(req.url)?req.url:'/unknown',peer:req.socket.remoteAddress,stage:'request'};
    res.setHeader('x-request-id',requestId);
    const abort = new AbortController();let recorded=false;
    const complete = disconnected => {
      if(recorded)return;recorded=true;
      const status=res.statusCode;
      log(context.path==='/auth/activate'?'auth.activate':'request.complete',{...context,status,durationMs:Math.round(performance.now()-started),outcome:disconnected?'disconnected':status>=400?'failed':context.streamOutcome==='incomplete'?'incomplete':context.streamOutcome==='failed'?'failed':'success'},disconnected||status>=500||['incomplete','failed'].includes(context.streamOutcome)?'error':status>=400?'warn':'info');
    };
    res.on('finish',()=>complete(false));
    res.on('close', () => { if (!res.writableEnded) {context.errorCode??='CLIENT_CONNECTION_CLOSED';abort.abort();complete(true);} });
    if(req.method==='GET'&&req.url==='/healthz'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({service:'openfilm-gateway',ok:true}));return;}
    log('request.start',context);
    const requestFetch=async(url,options)=>{
      const stage=context.stage,at=performance.now();
      try{const response=await fetchImpl(url,options);log('upstream.response',{...context,stage,upstreamStatus:response.status,firstByteMs:Math.round(performance.now()-at)},response.ok?'info':'error');return response;}
      catch(error){context.errorCode=errorCode(error);log('upstream.error',{...context,stage,durationMs:Math.round(performance.now()-at)},'error');throw error;}
    };
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const allowed = req.method === 'POST' && ['/auth/activate', '/auth/refresh', '/auth/status', '/v1/responses', '/tts/synthesize', '/tts/voices'].includes(req.url) || req.method === 'GET' && ['/v1/models', '/account/quota', '/account/profile'].includes(req.url) || req.method === 'PATCH' && req.url === '/account/profile';
      if (!allowed) return json(404, { error: { message: '接口不存在' } });
      const raw = await bodyOf(req);
      if (req.url === '/auth/activate') {
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '请求格式无效'); }
        context.activationRef=keyReference(input.activationCode);
        const fingerprint = proof(req, raw, input.publicKey);context.fingerprint=fingerprint;
        if (typeof input.activationCode !== 'string' || input.activationCode.length > 512) throw fail(400, '激活码无效');
        const found = await keygen('/licenses/actions/validate-key', { meta: { key: input.activationCode, scope: { fingerprint } } },context);
        const license = found.data?.id;context.licenseId=license;
        if(license)context.keyRef=keyReference(mappings()[license]?.apiKey);
        if (!license || !mappings()[license]) throw fail(403, '授权尚未关联模型服务');
        if (!found.meta?.valid) {
          if (!['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH'].includes(found.meta?.code)) throw fail(403, '激活码不可用');
          await keygen('/machines', { data: { type: 'machines', attributes: { fingerprint }, relationships: { license: { data: { type: 'licenses', id: license } } } } },context);
        }
        await validate(license, fingerprint,context);
        return json(200, { refreshToken: issue({ kind: 'refresh', license, fingerprint, exp: Date.now() + 365 * 86400000 }), ...access(license, fingerprint) });
      }
      if (req.url === '/auth/refresh') {
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '请求格式无效'); }
        const claims = decode(input.refreshToken, 'refresh');context.licenseId=claims.license;context.keyRef=keyReference(mappings()[claims.license]?.apiKey);
        const fingerprint = proof(req, raw, input.publicKey);
        if (fingerprint !== claims.fingerprint) throw revoked('DEVICE_UNBOUND');
        if (!mappings()[claims.license]) throw revoked();
        context.fingerprint=fingerprint;
        await validate(claims.license, fingerprint,context);
        return json(200, access(claims.license, fingerprint));
      }
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const claims = decode(token, 'access');context.licenseId=claims.license;
      const publicKey = req.headers['x-openfilm-public-key'];
      let pem; try { pem = Buffer.from(publicKey ?? '', 'base64').toString(); } catch { throw fail(401, '设备信息无效'); }
      if (proof(req, raw, pem, token) !== claims.fingerprint) throw revoked('DEVICE_UNBOUND');
      context.fingerprint=claims.fingerprint;
      const mapping = mappings()[claims.license];context.keyRef=keyReference(mapping?.apiKey);
      if (!mapping) throw revoked();
      await validate(claims.license, claims.fingerprint,context);
      if (req.url === '/account/profile') {
        if (!config.profileStore) throw fail(503, '用户资料服务暂不可用');
        if (req.method === 'GET') return json(200, await config.profileStore.ensure(claims.license));
        if (raw.length > 1024) throw fail(400, '用户资料请求过大');
        let input; try { input = JSON.parse(raw); } catch { throw fail(400, '用户资料格式无效'); }
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'username')) throw fail(400, '只允许修改用户名，ID 不可修改');
        return json(200, await config.profileStore.rename(claims.license, input.username));
      }
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
          context.stage='tts';
          return json(200, await synthesizeTts({ input, speakers, key: config.ttsKey, fetchImpl:requestFetch, signal: abort.signal }));
        } finally { limit.active--; }
      }
      if (!mapping.apiKey) throw fail(403, '授权尚未关联模型服务');
      if (req.url === '/account/quota') {
        context.stage = 'sub2api';
        const response = await requestFetch(`${config.sub2apiUrl.replace(/\/$/, '')}/usage`, {
          method: 'GET', headers: { authorization: `Bearer ${mapping.apiKey}`, accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw fail(502, '个人额度查询失败，请稍后重试');
        const usage = await response.json();
        if (!['quota_limited', 'unrestricted'].includes(usage?.mode)) throw fail(502, '额度服务返回无效数据');
        const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        const limit = number(usage.quota?.limit);
        const used = number(usage.quota?.used);
        const remaining = number(usage.quota?.remaining);
        // Only a key-level quota defines a percentage. Wallet and subscription balances are not key quotas.
        return json(200, { limit, used, remaining, percent: limit > 0 && remaining !== null ? Math.min(100, remaining / limit * 100) : null, unit: 'USD' });
      }
      const headers = { authorization: `Bearer ${mapping.apiKey}`, 'content-type': req.headers['content-type'] ?? 'application/json', accept: req.headers.accept ?? 'text/event-stream' };
      for (const name of ['openai-beta', 'session_id', 'conversation_id', 'content-encoding']) if (req.headers[name]) headers[name] = req.headers[name];
      context.stage='sub2api';
      const response = await requestFetch(`${config.sub2apiUrl.replace(/\/$/, '')}${req.url.slice(3)}`, { method: req.method, headers, redirect: 'error', signal: abort.signal, ...(req.method === 'POST' ? { body: raw } : {}) });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      context.firstByteMs=Math.round(performance.now()-started);context.bytes=0;
      const sse=response.ok&&response.headers.get('content-type')?.includes('text/event-stream');
      let pending='',terminal=false,failed=false;
      const observe=new Transform({transform(chunk,encoding,callback){
        context.bytes+=chunk.length;
        if(sse){pending+=chunk.toString('utf8');let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline).trim();pending=pending.slice(newline+1);if(line.startsWith('data:')){const value=line.slice(5).trim();if(value==='[DONE]')terminal=true;else try{const item=JSON.parse(value);if(item.type==='response.completed')terminal=true;if(['response.failed','response.incomplete','error'].includes(item.type)){terminal=true;failed=true;}}catch{}}}if(pending.length>65536)pending=pending.slice(-1024);context.streamOutcome=failed?'failed':terminal?'completed':'incomplete';}
        callback(null,chunk);
      }});
      if (response.body) await pipeline(Readable.fromWeb(response.body),observe,res); else res.end();
    } catch (error) {
      context.errorCode=errorCode(error);if(error.status)context.reason=error.message;log('request.error',{...context,status:error.status??502},'error');
      if (res.headersSent) res.destroy();
      else {
        if(error.authorizationCode)res.setHeader('x-openfilm-authorization','revoked');
        json(error.status??502,{error:{message:error.status?error.message:'服务连接失败，请重试',...(error.authorizationCode?{code:error.authorizationCode}:{})}});
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logStore=await openLogStore(process.env.LOG_DATABASE_URL);
  const profileStore = await openProfileStore(process.env.PROFILE_DATABASE_URL || process.env.LOG_DATABASE_URL);
  const existingMappings = JSON.parse(readFileSync(process.env.MAPPING_FILE ?? '/data/mappings.json', 'utf8'));
  for (const licenseId of Object.keys(existingMappings)) await profileStore.ensure(licenseId);
  const server = createGateway({ profileStore, logStore, secret: process.env.GATEWAY_SECRET, mappingFile: process.env.MAPPING_FILE ?? '/data/mappings.json', keygenUrl: process.env.KEYGEN_URL, keygenToken: process.env.KEYGEN_TOKEN, sub2apiUrl: process.env.SUB2API_URL, ttsKey: process.env.DOUBAO_TTS_API_KEY, ttsSpeakers: process.env.DOUBAO_TTS_SPEAKERS });
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;server.closeIdleConnections();server.close(async()=>{try{await profileStore.close();await logStore.close();process.exit(0);}catch{process.exit(1);}});setTimeout(()=>server.closeAllConnections(),5000).unref();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  server.listen(Number(process.env.PORT ?? 8787), process.env.BIND ?? '0.0.0.0',()=>createEventLog({store:logStore,source:'gateway'})('service.started',{stage:'listen'}));
}
