import { VideoPolicyError } from './video-policy.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { deviceIdentity, createGatewayFetch, signedHeaders } from './gateway-auth.mjs';

/** Public service configuration only. Sub2API credentials never belong in the client. */
export function gatewayEndpoint(env = process.env) {
  const baseUrl = String(env.OPENFILM_GATEWAY_BASE_URL ?? 'https://api.u4178022.nyat.app:13547/v1').trim();
  let url;
  try { url = new URL(baseUrl); } catch { throw new VideoPolicyError('授权服务地址无效。'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new VideoPolicyError('授权服务必须使用 HTTPS。');
  if (url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname)) throw new VideoPolicyError('授权服务地址必须以 /v1 结尾。');
  const model = String(env.OPENFILM_GATEWAY_MODEL ?? 'gpt-6.1-sol');
  if (!/^[\w.-]+$/.test(model)) throw new VideoPolicyError('模型名称无效。');
  return { baseUrl: url.toString().replace(/\/$/, ''), model };
}

export async function activateGateway(dataDir, input, storage = {}, fetchImpl = fetch) {
  const config = gatewayEndpoint({ OPENFILM_GATEWAY_BASE_URL: input.baseUrl, OPENFILM_GATEWAY_MODEL: input.model });
  const identity = deviceIdentity(dataDir, storage);
  if (!input.activationCode?.trim()) throw new VideoPolicyError('请输入激活码。');
  const body = JSON.stringify({ activationCode: input.activationCode.trim(), publicKey: identity.publicKey });
  const response = await fetchImpl(`${new URL(config.baseUrl).origin}/auth/activate`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', ...signedHeaders(identity, 'POST', '/auth/activate', body) }, body,
  });
  if (!response.ok) throw new VideoPolicyError('激活失败，请检查激活码及设备授权。');
  const result = await response.json();
  if (typeof result.refreshToken !== 'string') throw new VideoPolicyError('激活服务返回无效凭证。');
  const encrypted = storage.encrypt(result.refreshToken);
  if (!encrypted) throw new VideoPolicyError('系统安全存储不可用。');
  writeFileSync(join(dataDir, 'gateway-session.json'), JSON.stringify({ sessionId:randomUUID(), baseUrl: config.baseUrl, model: config.model, refreshTokenEncrypted: encrypted }), { mode: 0o600 });
  const directFile = join(dataDir, 'sub2api.json');
  if (existsSync(directFile)) unlinkSync(directFile);
  return { baseUrl: config.baseUrl, model: config.model, configured: true };
}

export function gatewayConfig(dataDir, storage = {}, fetchImpl = fetch) {
  if (!dataDir || !existsSync(join(dataDir, 'gateway-session.json'))) return null;
  const sessionFile=join(dataDir,'gateway-session.json');
  const snapshot=readFileSync(sessionFile,'utf8'),saved=JSON.parse(snapshot);
  if(saved.authorizationInvalidated)throw new VideoPolicyError('授权已停用、过期或设备已解绑，请重新激活。');
  const identity = deviceIdentity(dataDir, storage);
  const refreshToken = storage.decrypt(saved.refreshTokenEncrypted);
  const endpoint = gatewayEndpoint({ OPENFILM_GATEWAY_BASE_URL: saved.baseUrl, OPENFILM_GATEWAY_MODEL: saved.model });
  return { ...endpoint, apiKey: 'device-session', fetchImpl: createGatewayFetch({ baseUrl: saved.baseUrl, refreshToken, identity, fetchImpl, onAuthorizationInvalidated:code=>{
    if(readFileSync(sessionFile,'utf8')!==snapshot)return;
    const revoked={...saved,authorizationInvalidated:code};
    try{writeFileSync(sessionFile+'.tmp',JSON.stringify(revoked),{mode:0o600});renameSync(sessionFile+'.tmp',sessionFile);}
    finally{storage.onAuthorizationInvalidated?.(code);}
  } }) };
}

export function publicSub2ApiConfig(dataDir, storage = {}) {
  let gateway = null;
  try { gateway = gatewayConfig(dataDir, storage); } catch { /* Invalid storage must still allow the activation screen to open. */ }
  const endpoint = gateway ?? gatewayEndpoint();
  return { baseUrl: endpoint.baseUrl, model: endpoint.model, configured: Boolean(gateway) };
}

/** Workspace access depends only on saved activation. Cloud requests validate authorization separately. */
export async function checkGatewayAuthorization(dataDir, storage = {}) {
  try {
    if (!gatewayConfig(dataDir, storage)) return { authorized: false, message: '请输入激活码以使用 OpenFilm。' };
    return { authorized: true, message: '' };
  } catch(error) { return { authorized: false, message:error instanceof VideoPolicyError?error.message:'无法读取本机激活凭据，请恢复应用数据或重新激活。' }; }
}

/** Network failures never revoke local activation. Only the gateway's explicit authorization code can do so. */
export async function probeGatewayAuthorization(dataDir,storage={},fetchImpl=fetch){
  let config;try{config=gatewayConfig(dataDir,storage,fetchImpl);}catch{return;}
  if(!config)return;
  try{await config.fetchImpl(`${new URL(config.baseUrl).origin}/auth/status`,{method:'POST',body:'{}',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{/* Offline and service outages preserve local activation. */}
}

export async function checkSub2ApiConfig(dataDir, fetchImpl = fetch, storage = {}) {
  const config = gatewayConfig(dataDir, storage, fetchImpl);
  if (!config) throw new VideoPolicyError('请先输入激活码完成激活。');
  fetchImpl = config.fetchImpl;
  let response;
  let lastError;
  /* WSL2 and a local Windows Sub2API service can briefly return 502 while the upstream worker wakes up. */
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetchImpl(`${config.baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model: config.model, input: 'Reply with OK.', stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
    } catch (error) {
      lastError = error;
      if(error.authorizationInvalidated)throw new VideoPolicyError(error.message);
      if (attempt === 2) throw new VideoPolicyError(`模型连接失败：${error.message || error}`);
    }
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  if (!response) throw new VideoPolicyError(`模型连接失败：${lastError?.message || '网络请求未返回结果'}。`);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const suffix = detail.replace(config.apiKey, '[redacted]').replace(/\s+/g, ' ').slice(0, 160);
    throw new VideoPolicyError(`模型连接失败（HTTP ${response.status}）${suffix ? `：${suffix}` : '。'}`);
  }
  const result = await response.json().catch(() => null);
  const replied = result?.output?.some?.(item => item.type === 'message' && item.content?.some?.(part => part.type === 'output_text' && typeof part.text === 'string' && part.text.trim()));
  if (result?.status !== 'completed' || !replied) throw new VideoPolicyError('模型未成功完成回复，请检查模型配置。');
  return { ok: true, baseUrl: config.baseUrl, model: config.model };
}
