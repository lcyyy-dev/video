/** Model output is a video value, never a script, file patch, command or arbitrary path. */
import { VideoPolicyError } from './video-policy.mjs';
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' }, number = { type: 'number' }, boolean = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const textSchema = object({ text: string, x: number, y: number, width: number, fontSize: number, color: string, bold: boolean, align: { type: 'string', enum: ['left', 'center', 'right'] } });
const clipSchema = object({ id: string, assetId: nullable(string), text: nullable(textSchema), start: number, end: number, at: number, speed: number, volume: number, muted: boolean,
  box: nullable(object({ x: number, y: number, w: number, h: number })) });
const filmSchema = object({ stage: object({ w: number, h: number, fps: number }), tracks: { type: 'array', items: object({ id: string, locked: boolean, hidden: boolean, muted: boolean, clips: { type: 'array', items: clipSchema } }) } });
export const VIDEO_INTENT_SCHEMA = object({ allowed: boolean, category: { type: 'string', enum: ['video', 'harmless', 'unsafe', 'unrelated', 'needs_video_context'] } });
export const VIDEO_PLAN_SCHEMA = object({ status: { type: 'string', enum: ['edit', 'question', 'refuse'] }, message: string, film: nullable(filmSchema), export: { type: 'string', enum: ['none', 'jianying', 'mp4'] } });

const record = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);
const finite = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const ident = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value);
export function readVideoJson(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) throw new VideoPolicyError('视频规划结果无效。');
  try { return JSON.parse(text); } catch { throw new VideoPolicyError('视频规划器没有返回有效的结构化结果，未执行任何修改。'); }
}
export function validateVideoIntent(value) {
  if (!record(value, ['allowed', 'category']) || typeof value.allowed !== 'boolean' || !['video', 'harmless', 'unsafe', 'unrelated', 'needs_video_context'].includes(value.category)) throw new VideoPolicyError();
  return value.allowed && value.category === 'video';
}

/** Validate again in native code; the model's schema is not an authorization boundary. */
export function validateVideoPlan(plan, snapshot) {
  if (!record(plan, ['status', 'message', 'film', 'export']) || !['edit', 'question', 'refuse'].includes(plan.status)
    || typeof plan.message !== 'string' || plan.message.length > 3000 || !['none', 'jianying', 'mp4'].includes(plan.export)) throw new VideoPolicyError('视频规划结果不符合允许的操作格式。');
  if (plan.status !== 'edit') {
    if (plan.film !== null || plan.export !== 'none') throw new VideoPolicyError();
    return plan;
  }
  const film = plan.film;
  if (!record(film, ['stage', 'tracks']) || !record(film.stage, ['w', 'h', 'fps']) || !Number.isInteger(film.stage.w) || !Number.isInteger(film.stage.h)
    || !finite(film.stage.w, 16, 4096) || !finite(film.stage.h, 16, 4096) || ![23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].includes(film.stage.fps)
    || !Array.isArray(film.tracks) || film.tracks.length > 24) throw new VideoPolicyError('画布或轨道参数无效。');
  const assets = new Map(snapshot.assets.map(asset => [asset.id, asset]));
  const ids = new Set(), trackIds = new Set();
  let clips = 0;
  for (const track of film.tracks) {
    if (!record(track, ['id', 'locked', 'hidden', 'muted', 'clips']) || !ident(track.id) || trackIds.has(track.id) || !Array.isArray(track.clips)
      || ['locked', 'hidden', 'muted'].some(key => typeof track[key] !== 'boolean')) throw new VideoPolicyError('轨道参数无效。');
    trackIds.add(track.id);
    for (const clip of track.clips) {
      if (++clips > 240 || !record(clip, ['id', 'assetId', 'text', 'start', 'end', 'at', 'speed', 'volume', 'muted', 'box']) || !ident(clip.id) || ids.has(clip.id)
        || !finite(clip.start, 0, 36000) || !finite(clip.end, 0.001, 36000) || clip.end <= clip.start || !finite(clip.at, 0, 600)
        || !finite(clip.speed, .25, 4) || !finite(clip.volume, 0, 2) || typeof clip.muted !== 'boolean'
        || clip.at + (clip.end - clip.start) / clip.speed > 600.01) throw new VideoPolicyError('片段参数无效或超过视频任务限额。');
      ids.add(clip.id);
      if (clip.box !== null && (!record(clip.box, ['x', 'y', 'w', 'h']) || !finite(clip.box.x, -8192, 8192) || !finite(clip.box.y, -8192, 8192) || !finite(clip.box.w, 1, 8192) || !finite(clip.box.h, 1, 8192))) throw new VideoPolicyError('画面位置无效。');
      if (clip.text !== null) {
        const text = clip.text;
        if (clip.assetId !== null || !record(text, ['text', 'x', 'y', 'width', 'fontSize', 'color', 'bold', 'align']) || typeof text.text !== 'string' || !text.text.trim() || text.text.length > 2000
          || !finite(text.x, -8192, 8192) || !finite(text.y, -8192, 8192) || !finite(text.width, 1, 8192) || !finite(text.fontSize, 6, 1000)
          || !/^#[0-9a-f]{6}$/i.test(text.color) || typeof text.bold !== 'boolean' || !['left', 'center', 'right'].includes(text.align) || clip.speed !== 1) throw new VideoPolicyError('字幕只能使用受支持的结构化文字参数。');
      } else {
        const asset = assets.get(clip.assetId);
        if (!asset || ((asset.kind === 'video' || asset.kind === 'audio') && clip.end > asset.duration + .05)) throw new VideoPolicyError('片段必须引用当前工程已验证的素材和有效时段。');
      }
    }
  }
  // A whole-film plan still cannot unlock, move, remove or rewrite a locked track.
  for (const [index, old] of (snapshot.film?.tracks ?? []).entries()) {
    if (old.locked && JSON.stringify(film.tracks[index]) !== JSON.stringify(old)) throw new VideoPolicyError('不能修改或移动已锁定轨道。');
  }
  if ((snapshot.film?.tracks ?? []).some(track => track.locked) && JSON.stringify(film.stage) !== JSON.stringify(snapshot.film.stage)) throw new VideoPolicyError('有锁定轨道时不能改变画布或帧率。');
  for (const id of snapshot.lockedClipIds ?? []) {
    const beforeTrack = snapshot.film.tracks.findIndex(track => track.clips.some(clip => clip.id === id));
    const beforeIndex = snapshot.film.tracks[beforeTrack].clips.findIndex(clip => clip.id === id);
    if (JSON.stringify(snapshot.film.tracks[beforeTrack].clips[beforeIndex]) !== JSON.stringify(film.tracks[beforeTrack]?.clips[beforeIndex])) throw new VideoPolicyError('不能修改或移动已锁定片段。');
  }
  return plan;
}
