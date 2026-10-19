// @ts-check
/** User presets are local data, separate from immutable built-ins and resolved project snapshots. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTextStyle, listTextStyles, validateTextStyleLibrary } from '../../src/text-styles.mjs';
import { validateTextPage } from '../../src/text-page.mjs';
import { studioHome } from './projects.mjs';
import { bundledTextFont } from './text-fonts.mjs';

/** @typedef {import('../../src/text-styles.mjs').TextStylePreset} Preset */
/** @typedef {{ version: 1, defaultId: string, presets: Preset[] }} Saved */
const builtins = listTextStyles();
const builtinIds = builtins.map((preset) => preset.id);
const fallback = builtinIds[0];

export class TextStyleError extends Error {
  /** @param {string} message */
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** @param {string} home @returns {Saved} */
function read(home) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(home, 'text-styles.json'), 'utf8')); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return /** @type {Saved} */ ({ version: 1, defaultId: fallback, presets: [] });
    throw new TextStyleError('Could not read saved text styles; the file was left unchanged.', 500);
  }
  if (raw?.version !== 1 || !Array.isArray(raw.presets) || typeof raw.defaultId !== 'string') throw new TextStyleError('Invalid saved text styles.', 500);
  try {
    if (raw.presets.length) validateTextStyleLibrary({ version: 1, presets: raw.presets });
    const presets = /** @type {Preset[]} */ (raw.presets);
    if (presets.some((preset) => builtinIds.includes(preset.id))) throw new Error('Built-in ID');
    if (![...builtinIds, ...presets.map((preset) => preset.id)].includes(raw.defaultId)) throw new Error('Default ID');
  } catch { throw new TextStyleError('Invalid saved text styles; the file was left unchanged.', 500); }
  return /** @type {Saved} */ (raw);
}

/** @param {string} home @param {Saved} state */
function write(home, state) {
  mkdirSync(home, { recursive: true });
  const file = join(home, 'text-styles.json'), temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, file);
}

/** Built-ins and saved presets, read fresh so UI and agent commands share the same choices. */
export function textStyleLibrary(home = studioHome()) {
  const state = read(home);
  const presets = [...listTextStyles(), ...state.presets].map((preset) => {
    const font = bundledTextFont(preset.style.fontFamily);
    if (font && !preset.style.fontPath) preset.style.fontPath = `openfilm-font:${font.id}`;
    return preset;
  });
  return { version: 1, defaultId: state.defaultId, builtinIds: [...builtinIds], presets };
}

export function resolveTextStyle(id = 'default', home = studioHome()) {
  const library = textStyleLibrary(home);
  const preset = library.presets.find((preset) => preset.id === (id === 'default' ? library.defaultId : id));
  if (!preset) throw new TextStyleError(`Unknown text style: ${id}`, 404);
  return preset;
}

/** @param {{ name?: unknown, style?: unknown, version?: unknown }} input @param {string | null} [id] */
export function saveTextStyle(input, id = null, home = studioHome()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TextStyleError('Provide a text style name and appearance.');
  const state = read(home);
  if (id && builtinIds.includes(id)) throw new TextStyleError('Built-in styles are read-only; save a copy.');
  const previous = id ? state.presets.find((preset) => preset.id === id) : null;
  if (id && !previous) throw new TextStyleError('No such custom text style.', 404);
  if (previous && input.version !== previous.version) throw new TextStyleError('This style changed elsewhere; reload it before saving.', 409);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new TextStyleError('Give the style a name of 1 to 80 characters.');
  const preset = { id: previous?.id ?? `custom-${randomUUID()}`, version: (previous?.version ?? 0) + 1,
    name: input.name.trim(), description: previous?.description ?? 'Custom text style', style: input.style };
  let checked;
  try { checked = validateTextStyleLibrary({ version: 1, presets: [preset] }).presets[0]; }
  catch (error) { throw new TextStyleError(/** @type {Error} */ (error).message); }
  state.presets = [...state.presets.filter((entry) => entry.id !== checked.id), checked];
  write(home, state);
  return { library: textStyleLibrary(home), preset: checked };
}

/** @param {string} id */
export function setDefaultTextStyle(id, home = studioHome()) {
  const preset = resolveTextStyle(id, home);
  const state = read(home);
  state.defaultId = preset.id;
  write(home, state);
  return textStyleLibrary(home);
}

/** Generate a fully resolved snapshot; later library edits never change this page. */
/** @param {{ text: string, width: number, height: number, duration: number }} input @param {string} [id] */
export function styledTextPage(input, id = 'default', home = studioHome()) {
  const preset = resolveTextStyle(id, home);
  return validateTextPage({ version: 1, width: input.width, height: input.height, duration: input.duration,
    texts: [applyTextStyle({ text: input.text, x: input.width / 2, y: input.height / 2, width: input.width * 0.9,
      align: 'center', fontSize: preset.style.fontSize }, preset)] });
}

/** @param {string} id */
export function deleteTextStyle(id, home = studioHome()) {
  if (builtinIds.includes(id)) throw new TextStyleError('Built-in styles cannot be deleted.');
  const state = read(home);
  if (!state.presets.some((preset) => preset.id === id)) throw new TextStyleError('No such custom text style.', 404);
  state.presets = state.presets.filter((preset) => preset.id !== id);
  if (state.defaultId === id) state.defaultId = fallback;
  write(home, state);
  return textStyleLibrary(home);
}
