/** The Windows installer's private Codex runtime. No Electron imports. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let bundled = null;

/** Fail early on a damaged installer instead of silently running a different system Codex. */
export function configureBundledCodex({ runtimeDir, dataDir } = {}) {
  bundled = null;
  if (!runtimeDir) return;
  const path = join(runtimeDir, 'codex', 'bin', 'codex.exe');
  if (!existsSync(path)) throw new Error('The bundled Codex component is missing. Please reinstall OpenFilm.');
  const home = join(dataDir, 'codex');
  mkdirSync(home, { recursive: true });
  const config = join(home, 'config.toml');
  if (!existsSync(config)) writeFileSync(config, 'check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\n', { mode: 0o600 });
  bundled = { path, home };
}

export const bundledCodex = () => bundled ? { path: bundled.path, source: 'bundled' } : null;

/** Shared by login, sessions, usage and record readers, so they all use the same account. */
export const codexEnvironment = (shell = {}) => bundled ? { ...shell, CODEX_HOME: bundled.home } : shell;

/** Updates are managed by the desktop app, including commands outside the chat's ACP session. */
export const codexArguments = (args) => ['-c', 'check_for_update_on_startup=false', ...(bundled ? ['-c', 'cli_auth_credentials_store="file"'] : []), ...args];
