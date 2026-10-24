/** The host's only video capabilities. There is intentionally no command, patch, URL or arbitrary-file operation. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { filmHtml, readFilmFile } from 'openfilm/film-doc';
import { readTextPage, textPageHtml, validateTextPage } from 'openfilm/text-page';
import { bundledTextFonts, textFontCss } from 'openfilm/text-fonts';
import { videoFile, VideoPolicyError } from './video-policy.mjs';
import { validateVideoPlan } from './video-plan.mjs';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('openfilm/package.json'));
const settingsEngine = () => import(pathToFileURL(join(packageRoot, 'studio/server/project-settings.mjs')).href);
const MEDIA = new Map([
  ...['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].map(ext => [ext, 'video']),
  ...['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].map(ext => [ext, 'image']),
  ...['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.opus'].map(ext => [ext, 'audio']),
]);
const digest = text => createHash('sha256').update(text).digest('hex');
const mediaId = name => `media-${digest(name).slice(0, 16)}`;
// A renamed playlist must not make FFmpeg follow local file references outside the project.
const MEDIA_FORMATS = 'mov,matroska,webm,avi,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,image2,mp3,aac,ogg,flac,wav,aiff';
const STYLE_PROPERTIES = new Set(['color', 'backgroundColor', 'opacity', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textAlign', 'textShadow', 'borderRadius', 'filter', 'objectFit', 'objectPosition', 'transformOrigin', 'clipPath', 'webkitTextStrokeColor', 'webkitTextStrokeWidth']);
function safeOverrides(overrides) {
  for (const entry of overrides ?? []) {
    if (entry.style && Object.entries(entry.style).some(([key, value]) => !STYLE_PROPERTIES.has(key) || (typeof value === 'string' && /(?:url\s*\(|expression|javascript:|data:|@import|\\|[{};])/i.test(value)))) throw new VideoPolicyError('当前工程含外部资源或不支持的样式，受限剪辑器不会执行这些内容。');
  }
  return overrides;
}

function controlDirectory(root) {
  const dir = join(root, '.film');
  if (!existsSync(dir)) mkdirSync(dir);
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new VideoPolicyError('影片配置目录不能是链接。');
  for (const name of ['settings.json', 'edit-template.json']) {
    const file = join(dir, name);
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).nlink !== 1)) throw new VideoPolicyError('影片配置文件不能是链接。');
  }
}

function atomicVideoWrite(root, name, content) {
  const file = videoFile(root, name, { optional: true });
  mkdirSync(dirname(file), { recursive: true });
  videoFile(root, name, { optional: true });
  const tempName = `${name}.video-${randomUUID()}.tmp`;
  const temp = videoFile(root, tempName, { optional: true });
  writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
}

const safeText = text => ({ text: text.text, x: text.x, y: text.y, width: text.width ?? 1000, fontSize: text.fontSize,
  color: text.color ?? '#ffffff', bold: text.bold ?? false, align: text.align ?? 'center' });

/** Native-owned media inspection: fixed executable and arguments, bounded buffers, no shell. */
export class VideoExecutor {
  constructor({ root, ffmpegDir, authorize = async () => {}, exportFilm = null, signal = null }) {
    this.root = root; this.ffmpegDir = ffmpegDir; this.authorize = authorize; this.exportFilm = exportFilm; this.signal = signal;
    this.assets = new Map(); this.oldClips = new Map();
  }
  binary(name) {
    const file = join(this.ffmpegDir ?? '', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    if (!this.ffmpegDir || !existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new VideoPolicyError('应用的视频处理组件不可用，请重新安装或修复。');
    return file;
  }
  async run(name, args) {
    this.signal?.throwIfAborted();
    try { return await exec(this.binary(name), args, { encoding: 'buffer', timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...(this.signal ? { signal: this.signal } : {}) }); }
    catch { if (this.signal?.aborted) throw new Error('cancelled'); throw new VideoPolicyError('素材无法安全解析，请检查格式或重新上传。'); }
  }
  async inspect(name) {
    const kind = MEDIA.get(extname(name).toLowerCase());
    if (!kind) throw new VideoPolicyError('只能读取已导入的视频、图片或音频。');
    const file = videoFile(this.root, name);
    const stat = lstatSync(file);
    const answer = await this.run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', MEDIA_FORMATS, '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate,duration', '-of', 'json', file]);
    let data;
    try { data = JSON.parse(answer.stdout.toString('utf8')); } catch { throw new VideoPolicyError('素材元数据无效。'); }
    const video = data.streams?.find(stream => stream.codec_type === 'video');
    const audio = data.streams?.some(stream => stream.codec_type === 'audio') ?? false;
    if ((kind === 'audio' && !audio) || (kind !== 'audio' && !video)) throw new VideoPolicyError('素材内容与扩展名不匹配。');
    const duration = kind === 'image' ? 600 : Number(data.format?.duration ?? video?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 36000) throw new VideoPolicyError('素材时长无效或超过处理限额。');
    const [num, den] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const asset = { id: mediaId(name), name: basename(name), path: name, kind, duration, width: Number(video?.width) || 0, height: Number(video?.height) || 0, fps: den ? num / den : 0, hasAudio: audio };
    this.assets.set(asset.id, { ...asset, file, signature: `${stat.size}:${stat.mtimeMs}:${stat.ino}` });
    return asset;
  }
  mediaNames(film) {
    const names = new Set();
    const visit = (prefix, depth = 0) => {
      if (depth > 5) return;
      const folder = videoFile(this.root, prefix);
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const name = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(name, depth + 1);
        else if (entry.isFile() && MEDIA.has(extname(name).toLowerCase())) names.add(name);
        if (names.size > 120) throw new VideoPolicyError('当前工程素材过多，请分批进行剪辑。');
      }
    };
    if (existsSync(join(this.root, 'assets'))) visit('assets');
    for (const track of film.tracks) for (const clip of track.clips) if (MEDIA.has(extname(clip.src).toLowerCase())) names.add(clip.src);
    return [...names];
  }
  async snapshot() {
    await this.authorize(); this.signal?.throwIfAborted();
    const path = videoFile(this.root, 'film.html', { optional: true });
    const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (raw.length > 2_000_000) throw new VideoPolicyError('影片工程过大。');
    const parsed = raw.trim() ? readFilmFile(raw) : { value: { stage: { w: 1920, h: 1080 }, tracks: [] } };
    const film = parsed.value;
    if (!film || (raw.trim() && !parsed.doc)) throw new VideoPolicyError('影片工程格式无效，未执行任何修改。');
    this.revision = digest(raw); this.assets.clear(); this.oldClips.clear();
    const assets = [];
    for (const name of this.mediaNames(film)) assets.push(await this.inspect(name));
    controlDirectory(this.root);
    const { readProjectSettings } = await settingsEngine();
    const settings = await readProjectSettings(this.root);
    const fps = settings.fps ?? assets.find(asset => asset.fps > 0)?.fps ?? 30;
    const rates = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
    const projected = { stage: { ...film.stage, fps: rates.reduce((best, rate) => Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best, 30) }, tracks: [] };
    for (const [index, track] of film.tracks.entries()) {
      const row = { id: `track-${index + 1}`, locked: track.locked ?? false, hidden: track.hidden ?? false, muted: track.muted ?? false, clips: [] };
      for (const clip of track.clips) {
        let text = null, page = null;
        if (/\.html?$/i.test(clip.src)) {
          const source = videoFile(this.root, clip.src);
          if (lstatSync(source).size > 4 * 1024 * 1024) throw new VideoPolicyError('自定义页面不受视频隔离模式支持。');
          page = readTextPage(readFileSync(source, 'utf8'));
          if (!page || page.texts.length !== 1) throw new VideoPolicyError('当前工程含自定义动画或复合页面，无法由受限剪辑器安全修改。');
          if (page.texts.some(item => item.fontPath && !/^openfilm-font:[\w-]+$/.test(item.fontPath))) throw new VideoPolicyError('文字字体必须来自应用内置字体库。');
          text = safeText(page.texts[0]);
        }
        const asset = text ? null : this.assets.get(mediaId(clip.src));
        if (!text && !asset) throw new VideoPolicyError('影片引用了不受支持或工程外的素材。');
        const known = new Set(['id', 'src', 'at', 'time', 'speed', 'volume', 'muted', 'box', 'overrides', 'link']);
        if (Object.keys(clip).some(key => !known.has(key)) || clip.box?.r) throw new VideoPolicyError('当前工程含未支持的自定义片段属性，未执行修改。');
        safeOverrides(clip.overrides);
        const time = [clip.time?.[0] ?? 0, clip.time?.[1] ?? page?.duration ?? (asset.kind === 'image' ? 3 : asset.duration)];
        const item = { id: clip.id, assetId: asset?.id ?? null, text, start: time[0], end: time[1], at: clip.at ?? 0,
          speed: clip.speed ?? 1, volume: clip.volume ?? 1, muted: clip.volume === 0, box: clip.box ? { x: clip.box.x, y: clip.box.y, w: clip.box.w ?? film.stage.w, h: clip.box.h ?? film.stage.h } : null };
        this.oldClips.set(item.id, { projected: structuredClone(item), clip, page }); row.clips.push(item);
      }
      projected.tracks.push(row);
    }
    this.current = { assets, film: projected, lockedClipIds: [...this.oldClips].filter(([, old]) => old.clip.overrides?.some(entry => entry.lock)).map(([id]) => id) };
    return this.current;
  }
  async frames(limit = 36) {
    const images = [];
    for (const asset of this.assets.values()) {
      if (asset.kind === 'audio') continue;
      for (const time of asset.kind === 'image' ? [0] : [asset.duration * .2, asset.duration * .6]) {
        if (images.length >= limit) return images;
        videoFile(this.root, asset.path);
        const result = await this.run('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', MEDIA_FORMATS, '-ss', String(time), '-i', asset.file,
          '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
        images.push({ label: `${asset.id} at ${time.toFixed(3)} seconds`, data: result.stdout.toString('base64'), mimeType: 'image/png' });
      }
    }
    return images;
  }
  async apply(rawPlan) {
    await this.authorize(); this.signal?.throwIfAborted();
    const plan = validateVideoPlan(rawPlan, this.current);
    if (plan.status !== 'edit') return { status: plan.status, message: plan.message };
    const filmPath = videoFile(this.root, 'film.html', { optional: true });
    if (digest(existsSync(filmPath) ? readFileSync(filmPath, 'utf8') : '') !== this.revision) throw new VideoPolicyError('影片已被手工修改，请重新发送需求，避免覆盖你的操作。');
    for (const asset of this.assets.values()) {
      const stat = lstatSync(videoFile(this.root, asset.path));
      if (`${stat.size}:${stat.mtimeMs}:${stat.ino}` !== asset.signature) throw new VideoPolicyError('素材在分析后发生变化，请重新发送需求。');
    }
    const titles = [];
    const value = { stage: { w: plan.film.stage.w, h: plan.film.stage.h }, tracks: plan.film.tracks.map(track => ({ locked: track.locked, hidden: track.hidden, muted: track.muted, clips: track.clips.map(item => {
      const old = this.oldClips.get(item.id);
      let src;
      if (item.text) {
        src = `titles/video-${randomUUID()}.html`;
        const font = bundledTextFonts()[0];
        const initialText = { ...item.text, ...(font ? { fontFamily: font.family, fontPath: `openfilm-font:${font.id}` } : {}) };
        let page = { version: 1, width: valueStage(plan).w, height: valueStage(plan).h, duration: item.end, texts: [initialText] };
        if (old?.page) {
          const previous = old.page;
          page = { ...previous, width: valueStage(plan).w, height: valueStage(plan).h, duration: item.end,
            texts: [{ ...previous.texts[0], ...item.text }] };
        }
        validateTextPage(page); titles.push({ src, html: textPageHtml(page, { fontCss: textFontCss(page.texts.map(text => text.fontFamily).filter(Boolean), true) }) });
      } else src = this.assets.get(item.assetId).path;
      const kept = old ? { ...(old.clip.overrides ? { overrides: safeOverrides(old.clip.overrides) } : {}), ...(old.clip.link ? { link: old.clip.link } : {}) } : {};
      return { id: item.id, src, time: [item.start, item.end], at: item.at, ...(item.text || this.assets.get(item.assetId)?.kind === 'image' ? {} : { speed: item.speed, volume: item.muted ? 0 : item.volume }), ...(item.box ? { box: item.box } : {}), ...kept };
    }) })) };
    const html = filmHtml(value);
    if (!readFilmFile(html).doc) throw new VideoPolicyError('影片校验失败，未执行修改。');
    // Validate every destination before creating any file.
    videoFile(this.root, 'film.html', { optional: true });
    for (const title of titles) videoFile(this.root, title.src, { optional: true });
    controlDirectory(this.root);
    for (const title of titles) atomicVideoWrite(this.root, title.src, title.html);
    atomicVideoWrite(this.root, 'film.html', html);
    const { patchProjectSettings } = await settingsEngine();
    await patchProjectSettings(this.root, { fps: plan.film.stage.fps });
    let outputs = [];
    if (plan.export !== 'none') {
      if (!this.exportFilm) throw new VideoPolicyError('导出服务不可用，影片修改已保存。');
      outputs = await this.exportFilm({ format: plan.export, fps: plan.film.stage.fps, signal: this.signal });
    }
    return { status: 'edit', tracks: value.tracks.length, clips: value.tracks.reduce((n, track) => n + track.clips.length, 0), outputs };
  }
}
const valueStage = plan => plan.film.stage;
