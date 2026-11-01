import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const random = () => randomBytes(32).toString('hex');
const password = random();
const values = {
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgres://keygen:${password}@postgres:5432/keygen`,
  REDIS_URL: 'redis://redis:6379',
  SECRET_KEY_BASE: random() + random(),
  ENCRYPTION_DETERMINISTIC_KEY: random(),
  ENCRYPTION_PRIMARY_KEY: random(),
  ENCRYPTION_KEY_DERIVATION_SALT: random(),
  KEYGEN_EDITION: 'CE', KEYGEN_MODE: 'singleplayer',
  KEYGEN_ACCOUNT_ID: randomUUID(), KEYGEN_ADMIN_EMAIL: 'admin@openfilm.local',
  KEYGEN_ADMIN_PASSWORD: random(), KEYGEN_HOST: 'api.keygen.localhost', KEYGEN_DOMAIN: 'keygen.localhost', KEYGEN_SUBDOMAIN: 'api',
  KEYGEN_HOSTS: 'localhost,keygen,host.docker.internal,127.0.0.1',
  RAILS_ENV: 'production', RAILS_LOG_TO_STDOUT: '1',
  WEB_CONCURRENCY: '1', RAILS_MAX_THREADS: '2', SIDEKIQ_CONCURRENCY: '2', REDIS_POOL_SIZE: '10',
};
writeFileSync(new URL('.env.keygen', import.meta.url), Object.entries(values).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log('已生成 .env.keygen；凭据未输出，请保留该文件。');
