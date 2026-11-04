import { randomInt } from 'node:crypto';

const invalid = message => Object.assign(new Error(message), { status: 400 });
export function validateUsername(value) {
  if (typeof value !== 'string') throw invalid('用户名需要为 1–8 个字符。');
  const username = value.trim();
  if (!username || [...username].length > 8 || /[\p{C}]/u.test(username)) throw invalid('用户名需要为 1–8 个字符，不能包含控制字符。');
  return username;
}
const profile = row => ({ username: row.username, userId: row.user_id });

/** License-linked account data is independent of Keygen's upstream database and log retention. */
export class ProfileStore {
  constructor(pool, schema = 'gateway_accounts') {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid profile schema');
    this.pool = pool;
    this.schema = `"${schema}"`;
    this.schemaName = schema;
  }
  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`profiles-schema:${this.schemaName}`]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.license_profiles (
        license_id text PRIMARY KEY,
        username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 8),
        user_id text NOT NULL UNIQUE CHECK (user_id ~ '^0406 2003 [0-9]{4}$'),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async ensure(licenseId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`profile:${this.schemaName}:${licenseId}`]);
      let result = await client.query(`SELECT username,user_id FROM ${this.schema}.license_profiles WHERE license_id=$1`, [licenseId]);
      if (!result.rows.length) {
        // Serialize allocation across gateway/admin processes; choose an unused random suffix.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`profile-id-allocation:${this.schemaName}`]);
        const available = await client.query(`SELECT '0406 2003 ' || lpad(n::text,4,'0') AS user_id
          FROM generate_series(1,9999) AS n WHERE NOT EXISTS (
            SELECT 1 FROM ${this.schema}.license_profiles WHERE user_id='0406 2003 ' || lpad(n::text,4,'0')
          ) ORDER BY random() LIMIT 1`);
        if (!available.rows.length) throw Object.assign(new Error('用户 ID 已分配完毕，请联系管理员'), { status: 503 });
        const username = `用户${String(randomInt(1000000)).padStart(6, '0')}`;
        result = await client.query(`INSERT INTO ${this.schema}.license_profiles (license_id,username,user_id)
          VALUES ($1,$2,$3) RETURNING username,user_id`, [licenseId, username, available.rows[0].user_id]);
      }
      await client.query('COMMIT');
      return profile(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async rename(licenseId, username) {
    username = validateUsername(username);
    await this.ensure(licenseId);
    const result = await this.pool.query(`UPDATE ${this.schema}.license_profiles SET username=$2 WHERE license_id=$1 RETURNING username,user_id`, [licenseId, username]);
    return profile(result.rows[0]);
  }
  async close() { await this.pool.end(); }
}
export async function openProfileStore(connectionString) {
  if (!connectionString) throw new Error('用户资料需要配置 PROFILE_DATABASE_URL 或 LOG_DATABASE_URL');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  pool.on('error', () => process.stderr.write('User profile database connection failed\n'));
  const store = new ProfileStore(pool);
  try { await store.initialize(); return store; }
  catch (error) { await pool.end(); throw error; }
}
