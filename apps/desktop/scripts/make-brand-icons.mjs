/** Generate desktop PNG/ICO/ICNS assets from the shared, unchanged brand image. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(desktop, '../../packages/openfilm/studio/ui/src/assets/brand-logo.png');
const build = join(desktop, 'build');
const bundled = join(desktop, '.dev/runtime/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffmpeg = process.env.FFMPEG_PATH || (existsSync(bundled) ? bundled : 'ffmpeg');
const work = mkdtempSync(join(tmpdir(), 'openfilm-brand-icons-'));
const png = size => {
  const path = join(work, `${size}.png`);
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vf', `scale=${size}:${size}:flags=lanczos,format=rgba`, '-frames:v', '1', path]);
  return readFileSync(path);
};
try {
  const images = new Map([16, 24, 32, 48, 64, 128, 256, 512, 1024].map(size => [size, png(size)]));
  writeFileSync(join(build, 'logo-1024.png'), images.get(1024));
  for (const file of ['icon.png', 'icon-dev.png']) writeFileSync(join(build, file), images.get(256));
  const sizes = [16, 24, 32, 48, 64, 256];
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const bytes = images.get(size), at = 6 + i * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  writeFileSync(join(build, 'icon.ico'), Buffer.concat([header, ...sizes.map(size => images.get(size))]));
  const chunks = [[128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
    const bytes = images.get(size), header = Buffer.alloc(8);
    header.write(type, 0, 'ascii'); header.writeUInt32BE(bytes.length + 8, 4);
    return Buffer.concat([header, bytes]);
  });
  const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((n, b) => n + b.length, 0), 4);
  for (const file of ['icon.icns', 'icon-dev.icns']) writeFileSync(join(build, file), Buffer.concat([icns, ...chunks]));
  console.log('Updated shared-brand desktop PNG, ICO and ICNS assets.');
} finally { rmSync(work, { recursive: true, force: true }); }
