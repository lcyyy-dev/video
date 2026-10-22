/** Linux cross-builds need WoW64 to run NSIS's 32-bit uninstaller generator. Not shipped to users. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFetch } from './download.mjs';

const NAME = 'wine-11.0-amd64-wow64';
const URL = `https://github.com/Kron4ek/Wine-Builds/releases/download/11.0/${NAME}.tar.xz`;
const SHA256 = '39574efa1132c3ca0d5c77dd2eddbe4a49cca0d6cc2c290ff4924493a1c40314';

export async function windowsHostTools(cacheDir) {
  if (process.platform !== 'linux') return {};
  if (process.arch !== 'x64') throw new Error('Linux cross-builds currently require an x64 host; use the Windows workflow instead.');
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, `${NAME}.tar.xz`);
  if (!existsSync(archive)) writeFileSync(archive, Buffer.from(await (await buildFetch(URL)).arrayBuffer()));
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== SHA256) throw new Error('Wine build tool checksum mismatch.');
  const dir = join(cacheDir, NAME);
  if (!existsSync(join(dir, 'bin/wine'))) execFileSync('tar', ['-xJf', archive, '-C', cacheDir]);
  mkdirSync(join(dir, 'wine-home'), { recursive: true });
  return { ELECTRON_BUILDER_WINE_TOOLSET_DIR: dir };
}
