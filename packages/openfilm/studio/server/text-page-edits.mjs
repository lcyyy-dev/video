// @ts-check
/** Save structured text edits as immutable JSON revisions so film undo can restore its previous source. */
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readTextPageJson, textPageJson, validateTextPage } from '../../src/text-page.mjs';
import { isTextPage } from '../../src/film-doc.mjs';
import { inProject } from './files.mjs';
import { writeAtomic } from './atomic.mjs';

/** @param {import('../../src/text-page.mjs').TextPage} source @param {any[]} edits */
export function editTextPage(source, edits) {
  const page = structuredClone(source);
  for (const edit of edits) {
    if (edit.at === undefined) continue;
    const match = /^\[data-openfilm-text-index="(\d+)"\]/.exec(edit.at);
    const index = match ? Number(match[1]) : page.texts.length === 1 && /(?:^|>\s*)div(?::nth-of-type\(1\))?$/.test(edit.at) ? 0 : -1;
    const item = page.texts[index];
    if (!item || edit.n > 1) throw new Error('无法确定结构化文字目标，请重新选择文字后调整。');
    if (edit.r && edit.r !== 0 || edit.lock || Object.keys(edit).some(key => !['at','n','t','s','r','style','text','lock'].includes(key))) throw new Error('此调整尚不支持保存为结构化文字。');
    if (edit.t) {
      item.x += edit.t[0]; item.y += edit.t[1];
      for (const [key, offset] of [['x', edit.t[0]], ['y', edit.t[1]]]) {
        const points = item.keyframes?.[/** @type {'x'|'y'} */ (key)];
        if (points) for (const point of points) point.value += offset;
      }
    }
    if (edit.s != null) {
      const sx = Array.isArray(edit.s) ? edit.s[0] : edit.s;
      const sy = Array.isArray(edit.s) ? edit.s[1] : edit.s;
      const width = /data-openfilm-text-base-width="([\d.]+)"/.exec(edit.at);
      const height = /data-openfilm-text-base-height="([\d.]+)"/.exec(edit.at);
      const bw = width ? Number(width[1]) : item.width;
      const bh = height ? Number(height[1]) : item.height ?? Math.round(item.fontSize * (item.lineHeight ?? 1.25) * item.text.split('\n').length);
      if (bw == null) throw new Error('请重新选择文字后调整文本框大小。');
      item.width = Math.max(1, bw * sx); item.height = Math.max(1, bh * sy);
    }
    if (edit.text != null) { item.text = edit.text; delete item.runs; }
    for (const [key, value] of Object.entries(edit.style ?? {})) {
      if (value == null) throw new Error('请通过文字属性设置具体值，不能清除结构化字段。');
      if (['fontSize','letterSpacing','lineHeight','width','height','opacity'].includes(key)) {
        const number = typeof value === 'number' ? value : Number(String(value).replace(/px$/, ''));
        if (!Number.isFinite(number)) throw new Error('无效的文字数值。');
        item[/** @type {'fontSize'|'letterSpacing'|'lineHeight'|'width'|'height'|'opacity'} */ (key)] = number;
      } else if (['fontFamily','color','textAlign'].includes(key)) {
        Object.assign(item, { [key === 'textAlign' ? 'align' : key]: String(value) });
        if (key === 'fontFamily') delete item.fontPath;
      } else if (key === 'fontWeight') item.bold = Number(value) >= 600 || value === 'bold';
      else if (key === 'fontStyle') item.italic = value === 'italic';
      else if (key === 'textDecoration') item.underline = String(value).includes('underline');
      else throw new Error(`结构化文字暂不支持属性 ${key}，未保存 DOM 覆盖。`);
      const inherited = { fontSize: 'fontSize', color: 'color', fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline' }[key];
      if (inherited && item.runs) for (const run of item.runs) delete run[/** @type {'fontSize'|'color'|'bold'|'italic'|'underline'} */ (inherited)];
    }
  }
  return validateTextPage(page);
}

/** @param {string} root @param {any} value @param {any[]} ops */
export async function saveTextPageEdits(root, value, ops) {
  const changed = new Set(ops.flatMap(op => op.op === 'props' ? op.edits.filter((/** @type {any} */ e) => e.prop === 'overrides').map((/** @type {any} */ e) => e.clip) : []));
  const pending = [];
  for (const track of value.tracks) for (const clip of track.clips) {
    if (!changed.has(clip.id) || !isTextPage(clip.src) || !clip.overrides?.some((/** @type {any} */ o) => o.at !== undefined)) continue;
    const path = inProject(root, clip.src);
    if (!path) throw new Error('文字源文件不在项目内。');
    const source = readTextPageJson(await readFile(path, 'utf8'));
    if (!source) throw new Error('无效的结构化文字源文件。');
    const page = editTextPage(source, clip.overrides);
    const src = `titles/text-edit-${randomUUID()}.text.json`;
    pending.push({ src, text: textPageJson(page) });
    clip.src = src;
    clip.overrides = clip.overrides.filter((/** @type {any} */ o) => o.at === undefined);
    if (!clip.overrides.length) delete clip.overrides;
  }
  if (pending.length) await mkdir(join(root, 'titles'), { recursive: true });
  for (const file of pending) await writeAtomic(join(root, file.src), file.text);
}
