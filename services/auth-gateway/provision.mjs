import { openProfileStore } from './profiles.mjs';
// Server-side administration only. Never include this directory in client packages.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const base = process.env.KEYGEN_URL;
const token = process.env.KEYGEN_TOKEN;
if (!base || !token) throw new Error('请设置 KEYGEN_URL 和 KEYGEN_TOKEN');
async function api(path, data) {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.api+json', accept: 'application/vnd.api+json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Keygen 请求失败 HTTP ${response.status}: ${JSON.stringify(result.errors?.map(e => ({ title: e.title, detail: e.detail })))}`);
  return result.data;
}
const [command, ...args] = process.argv.slice(2);
if (command === 'policy') {
  const product = await api('/products', { type: 'products', attributes: { name: 'OpenFilm' } });
  const policy = await api('/policies', { type: 'policies', attributes: { name: 'OpenFilm single device', strict: true, floating: false, maxMachines: 1 }, relationships: { product: { data: { type: 'products', id: product.id } } } });
  console.log(`KEYGEN_POLICY_ID=${policy.id}`);
} else if (command === 'issue') {
  const [keyFile, outputFile] = args;
  if (!process.env.KEYGEN_POLICY_ID || !keyFile || !outputFile) throw new Error('用法: KEYGEN_POLICY_ID=... node provision.mjs issue sub2api-key文件 激活信息输出文件');
  const apiKey = readFileSync(keyFile, 'utf8').trim();
  if (!apiKey) throw new Error('sub2api Key 不能为空');
  const profiles = await openProfileStore(process.env.PROFILE_DATABASE_URL || process.env.LOG_DATABASE_URL);
  const license = await api('/licenses', { type: 'licenses', relationships: { policy: { data: { type: 'policies', id: process.env.KEYGEN_POLICY_ID } } } });
  const mappingFile = process.env.MAPPING_FILE ?? './data/mappings.json';
  mkdirSync(dirname(mappingFile), { recursive: true, mode: 0o700 });
  let mappings = {};
  try { mappings = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const profile = await profiles.ensure(license.id);
  await profiles.close();
  mappings[license.id] = { apiKey };
  writeFileSync(mappingFile, JSON.stringify(mappings, null, 2), { mode: 0o600 });
  writeFileSync(outputFile, JSON.stringify({ licenseId: license.id, activationCode: license.attributes.key, ...profile }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log('已创建授权、关联用户 Key 并将激活信息写入指定文件。');
} else {
  throw new Error('命令: policy 或 issue');
}
