/** Native video capability policy. Text never grants filesystem or execution privileges. */
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export class VideoPolicyError extends Error {
  constructor(message = '工程目录访问无效。') { super(message); this.code = 'video-policy'; }
}

const clean = text => String(text).normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');

export const inside = (root, file) => { const r = relative(root, file); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };

/** Both the renderer's project selection and every broker operation must pass this check. */
export function videoProjectRoot(project, { projects, protectedRoots = [] } = {}) {
  if (typeof project !== 'string' || !isAbsolute(project)) throw new VideoPolicyError('无效的影片工程目录。');
  const root = realpathSync(project);
  if (!lstatSync(root).isDirectory() || lstatSync(project).isSymbolicLink()) throw new VideoPolicyError('影片工程目录不能是链接。');
  if (!Array.isArray(projects) || !projects.some(path => { try { return realpathSync(path) === root; } catch { return false; } })) throw new VideoPolicyError('只能操作当前已登记的影片工程。');
  for (const item of protectedRoots) {
    let protectedRoot;
    try { protectedRoot = realpathSync(item); } catch { protectedRoot = resolve(item); }
    if (inside(protectedRoot, root) || inside(root, protectedRoot)) throw new VideoPolicyError('软件、账号和系统目录不能作为剪辑工作目录。');
  }
  return root;
}

/** A portable, local project asset name. No URLs, drive letters, ADS, traversal or hidden files. */
export function videoRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || clean(value) !== value.normalize('NFKC') || /[\\:#?%\x00-\x1f<>"|*]/.test(clean(value))
    || isAbsolute(value) || win32.isAbsolute(value)) throw new VideoPolicyError('素材路径必须是工程内的相对路径。');
  const parts = clean(value).split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new VideoPolicyError('素材路径不受支持。');
  return value;
}

/** Refuse every symlink/reparse target and hard link, including existing write destinations. */
export function videoFile(root, name, { optional = false } = {}) {
  videoRelativePath(name);
  const path = resolve(root, name);
  if (!inside(root, path) || realpathSync(root) !== root) throw new VideoPolicyError('素材不在当前工程内。');
  let current = root;
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (optional && error.code === 'ENOENT') return path;
      throw new VideoPolicyError('素材不存在或无法访问。');
    }
    if (stat.isSymbolicLink() || !inside(root, realpathSync(current)) || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new VideoPolicyError('不能访问链接、特殊文件或工程外的素材。');
    if (i < parts.length - 1 && !stat.isDirectory()) throw new VideoPolicyError('素材路径无效。');
  }
  return path;
}

/** Logs, cached previews and editor state are host writes too; none may redirect outside the film. */
export function assertVideoStorage(root) {
  const visit = path => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !inside(root, realpathSync(path)) || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new VideoPolicyError('影片状态目录含链接或特殊文件，不能安全执行剪辑。');
    if (stat.isDirectory()) for (const name of readdirSync(path)) {
      // Browser temporary profiles contain native lock symlinks. They are used only by sandboxed commands;
      // host persistence never writes through them.
      if (path === directory && name === 'tmp') continue;
      visit(resolve(path, name));
    }
  };
  const directory = resolve(root, '.film');
  if (existsSync(directory) || (() => { try { lstatSync(directory); return true; } catch { return false; } })()) visit(directory);
}
