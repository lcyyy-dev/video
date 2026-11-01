import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) throw new Error('.env 已存在，不会覆盖现有网关配置');
const { KEYGEN_ADMIN_EMAIL, KEYGEN_ADMIN_PASSWORD } = process.env;
if (!KEYGEN_ADMIN_EMAIL || !KEYGEN_ADMIN_PASSWORD) throw new Error('请使用 --env-file=.env.keygen 运行');
const response = await fetch('http://127.0.0.1:3300/v1/tokens', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
  headers: { authorization: `Basic ${Buffer.from(`${KEYGEN_ADMIN_EMAIL}:${KEYGEN_ADMIN_PASSWORD}`).toString('base64')}`, 'content-type': 'application/vnd.api+json', 'x-forwarded-proto': 'https' },
  body: JSON.stringify({ data: { type: 'tokens', attributes: { name: 'OpenFilm gateway' } } }),
});
if (!response.ok) throw new Error(`创建网关服务端 Token 失败 HTTP ${response.status}`);
const result = await response.json();
const token = result.data?.attributes?.token;
if (!token) throw new Error('Keygen 未返回服务端 Token');
mkdirSync('data', { recursive: true, mode: 0o700 });
if (!existsSync('data/mappings.json')) writeFileSync('data/mappings.json', '{}', { mode: 0o600 });
writeFileSync('.env', `GATEWAY_SECRET=${randomBytes(48).toString('hex')}\nKEYGEN_URL=http://host.docker.internal:3300/v1\nKEYGEN_TOKEN=${token}\nSUB2API_URL=http://host.docker.internal:8189/v1\nMAPPING_FILE=/data/mappings.json\n`, { mode: 0o600, flag: 'wx' });
console.log('网关 .env 已生成；服务端 Token 未输出。');
