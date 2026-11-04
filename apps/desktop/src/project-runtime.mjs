/** Internal agent state stays outside the editable project, but is owned by that project. */
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { lstat, rm } from 'node:fs/promises';

export const projectRuntimeDir = (dataDir, project) => join(dataDir, 'project-codex', createHash('sha256').update(resolve(project)).digest('hex'));
export async function removeProjectRuntime(dataDir, project) {
  const parent = join(dataDir, 'project-codex');
  try {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  await rm(projectRuntimeDir(dataDir, project), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return true;
}
