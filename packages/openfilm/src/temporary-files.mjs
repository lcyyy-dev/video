/** Crash recovery for registered application scratch files only. No directory-wide wildcard cleanup. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const registryOf = () => process.env.OPENFILM_TEMP_REGISTRY;
const recordName = (/** @type {string} */ path) => createHash('sha256').update(resolve(path)).digest('hex') + '.json';
function ownedShape(/** @type {string} */ path) {
  const normalized = path.replaceAll('\\', '/');
  return /\/\.film\/cache\/export\/(?:clip|burn|nle)-[a-f0-9]{8}$/.test(normalized)
    || /\/\.film\/tmp\/session-[a-f0-9-]{36}$/.test(normalized)
    || /\/assets\/narration\/[a-f0-9]{64}-[a-f0-9-]{36}\.mp3$/.test(normalized)
    || /^openfilm-export-[a-zA-Z0-9]+$/.test(basename(path))
    || /^\..+\.partial-[a-f0-9]{12}$/.test(basename(path));
}
export function trackTemporary(/** @type {string} */ path) {
  const registry = registryOf();
  if (!registry || !ownedShape(path)) return;
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  if (lstatSync(registry).isSymbolicLink()) throw new Error('Invalid temporary registry');
  const file = join(registry, recordName(path));
  const entry = { version: 1, path: resolve(path), parent: realpathSync(dirname(path)), pid: process.pid, createdAt: Date.now() };
  writeFileSync(file + '.tmp', JSON.stringify(entry), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
export function forgetTemporary(/** @type {string} */ path) {
  const registry = registryOf();
  if (registry) rmSync(join(registry, recordName(path)), { force: true });
}
export async function managedMkdtemp(/** @type {string} */ prefix) {
  const path = await mkdtemp(prefix);
  trackTemporary(path);
  return path;
}
const alive = (/** @type {number} */ pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};
/** Called before workers start. Live owners, recent entries and changed parent directories are preserved. */
export async function cleanupStaleTemporaries(/** @type {string} */ registry, { now = Date.now(), minAgeMs = 60000, isAlive = alive } = {}) {
  let names;
  try { if (lstatSync(registry).isSymbolicLink()) return 0; names = readdirSync(registry); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let removed = 0;
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json(?:\.tmp)?$/.test(name)) continue;
    const record = join(registry, name);
    try {
      if (!lstatSync(record).isFile() || lstatSync(record).isSymbolicLink()) continue;
      const entry = JSON.parse(readFileSync(record, 'utf8'));
      if (entry.version !== 1 || typeof entry.path !== 'string' || !isAbsolute(entry.path) || name.replace(/\.tmp$/, '') !== recordName(entry.path)
        || !ownedShape(entry.path) || !Number.isInteger(entry.pid) || entry.pid < 1 || !Number.isFinite(entry.createdAt)
        || now - entry.createdAt < minAgeMs || isAlive(entry.pid)) continue;
      if (name.endsWith('.tmp') && existsSync(record.slice(0, -4))) { rmSync(record, { force: true }); continue; }
      if (existsSync(dirname(entry.path)) && realpathSync(dirname(entry.path)) !== entry.parent) continue;
      await rm(entry.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      rmSync(record, { force: true }); removed++;
    } catch { /* A locked, malformed or inaccessible entry is preserved for a later launch. */ }
  }
  return removed;
}
