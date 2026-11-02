import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const bodyHash = body => createHash('sha256').update(body ?? '').digest('hex');
export const proofMessage = (method, path, timestamp, nonce, body, token = '') =>
  [method, path, timestamp, nonce, bodyHash(body), bodyHash(token)].join('\n');

/** Private keys remain in Electron's main process and are encrypted by the OS store. */
export function deviceIdentity(dataDir, storage) {
  if (!storage?.encrypt || !storage?.decrypt) throw new Error('设备激活需要系统安全存储。');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'gateway-device.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return { publicKey: saved.publicKey, privateKey: storage.decrypt(saved.privateKeyEncrypted) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取设备凭据，请重新激活。');
  }
  const keys = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const encrypted = storage.encrypt(keys.privateKey);
  if (!encrypted) throw new Error('系统安全存储不可用。');
  writeFileSync(file, JSON.stringify({ publicKey: keys.publicKey, privateKeyEncrypted: encrypted }), { mode: 0o600, flag: 'wx' });
  return keys;
}

export function signedHeaders(identity, method, path, body, token = '') {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  return {
    'x-openfilm-public-key': Buffer.from(identity.publicKey).toString('base64'),
    'x-openfilm-time': timestamp,
    'x-openfilm-nonce': nonce,
    'x-openfilm-signature': sign(null, Buffer.from(proofMessage(method, path, timestamp, nonce, body, token)), identity.privateKey).toString('base64'),
  };
}

export function createGatewayFetch({ baseUrl, refreshToken, identity, fetchImpl = fetch, onAuthorizationInvalidated = () => {} }) {
  const origin = new URL(baseUrl).origin;
  let access = null;
  let refreshing = null;
  async function inspectAuthorization(response){
    if(response.status!==403||response.headers.get('x-openfilm-authorization')!=='revoked')return;
    const result=await response.clone().json().catch(()=>null);const code=result?.error?.code;
    if(['LICENSE_SUSPENDED','LICENSE_EXPIRED','DEVICE_UNBOUND','LICENSE_REVOKED'].includes(code)){onAuthorizationInvalidated(code);return code;}
  }
  async function renew() {
    const body = JSON.stringify({ refreshToken, publicKey: identity.publicKey });
    const response = await fetchImpl(`${origin}/auth/refresh`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', ...signedHeaders(identity, 'POST', '/auth/refresh', body) }, body,
    });
    const invalidated=await inspectAuthorization(response);
    if (!response.ok) throw Object.assign(new Error(invalidated?'授权已停用、过期或设备已解绑，请重新激活。':'授权续期失败，请检查网络或重新激活。'),{authorizationInvalidated:Boolean(invalidated)});
    access = await response.json();
  }
  return async (url, options = {}) => {
    if (new URL(url).origin !== origin) throw new Error('拒绝向其他地址发送设备凭证。');
    if (!access || access.expiresAt < Date.now() + 30000) {
      refreshing ??= renew().finally(() => { refreshing = null; });
      await refreshing;
    }
    const path = new URL(url).pathname + new URL(url).search;
    const token = access.accessToken;
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${token}`);
    for (const [key, value] of Object.entries(signedHeaders(identity, options.method ?? 'GET', path, options.body, token))) headers.set(key, value);
    const response=await fetchImpl(url, { ...options, redirect: 'error', headers });
    await inspectAuthorization(response);return response;
  };
}
