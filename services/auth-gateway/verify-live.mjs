import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createGateway } from './server.mjs';
import { activateGateway, gatewayConfig, checkSub2ApiConfig, checkGatewayAuthorization } from '../../apps/desktop/src/sub2api-config.mjs';
import { createCodexProvider } from '../../apps/desktop/src/codex-provider.mjs';
import assert from 'node:assert/strict';

const activationFile = process.argv[2];
if (!activationFile) throw new Error('用法: node --env-file=.env verify-live.mjs 激活信息.json');
const activation = JSON.parse(readFileSync(activationFile, 'utf8'));
async function resetTestDevices() {
  const base = process.env.KEYGEN_URL.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${process.env.KEYGEN_TOKEN}`, 'x-forwarded-proto': 'https' };
  const response = await fetch(`${base}/licenses/${activation.licenseId}/machines`, { headers });
  if (!response.ok) throw new Error(`无法读取测试设备 HTTP ${response.status}`);
  const result = await response.json();
  for (const machine of result.data) {
    const deleted = await fetch(`${base}/machines/${machine.id}`, { method: 'DELETE', headers });
    if (!deleted.ok) throw new Error(`测试设备解绑失败 HTTP ${deleted.status}`);
  }
}
if (!process.argv.includes('--reset-test-devices')) throw new Error('此脚本会清理测试授权的设备，请仅使用专用测试许可证并指定 --reset-test-devices');
await resetTestDevices();
const dir = mkdtempSync(join(tmpdir(), 'openfilm-gateway-live-'));
// Test adapter only: production uses Electron safeStorage / Windows DPAPI.
const key = randomBytes(32);
const storage = {
  encrypt(value) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  },
  decrypt(value) {
    const data = Buffer.from(value, 'base64'); const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString();
  },
};
const server = createGateway({ secret: process.env.GATEWAY_SECRET, mappingFile: process.env.MAPPING_FILE, keygenUrl: process.env.KEYGEN_URL, keygenToken: process.env.KEYGEN_TOKEN, sub2apiUrl: process.env.SUB2API_URL });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = process.env.GATEWAY_TEST_URL ?? `http://127.0.0.1:${server.address().port}/v1`;
let provider;
try {
  await activateGateway(dir, { baseUrl, activationCode: activation.activationCode, model: 'gpt-6.1-sol' }, storage);
  console.log('真实 Keygen 激活成功');
  assert.equal((await checkGatewayAuthorization(dir, storage)).authorized, true);
  console.log('在线授权状态检查成功');
  const config = gatewayConfig(dir, storage);
  provider = await createCodexProvider(config);
  const response = await fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${provider.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: config.model, input: 'Reply with OK.', stream: false }), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok || result.status !== 'completed') throw new Error(`模型未完成 HTTP ${response.status}: ${result.error?.message ?? result.status}`);
  console.log('OpenFilm 请求桥 → 自动续期 → 真实 Keygen → 用户 Key 映射 → sub2api 模型回复成功');
  const checked = await checkSub2ApiConfig(dir, fetch, storage);
  console.log(`重新读取设备会话后连接检测成功: ${checked.model}`);
  const secondDir = mkdtempSync(join(tmpdir(), 'openfilm-second-device-'));
  try {
    await assert.rejects(activateGateway(secondDir, { baseUrl, activationCode: activation.activationCode, model: config.model }, storage), /激活失败/);
    console.log('真实 Keygen 拒绝第二台设备使用同一激活码');
  } finally { rmSync(secondDir, { recursive: true, force: true }); }
  const streamed = await fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${provider.token}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ model: config.model, input: 'Reply with OK.', stream: true }), signal: AbortSignal.timeout(60000) });
  assert.equal(streamed.status, 200);
  assert.match(await streamed.text(), /response.completed/);
  console.log('真实模型 SSE 流式响应成功');
  await resetTestDevices();
  assert.equal((await checkGatewayAuthorization(dir, storage)).authorized, false);
  const denied = await config.fetchImpl(`${baseUrl}/responses`, { method: 'POST', body: JSON.stringify({ model: config.model, input: 'Reply with OK.' }) });
  assert.equal(denied.status, 403);
  console.log('真实设备解绑后，已有访问凭证立即被拒绝');
} finally {
  await provider?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
