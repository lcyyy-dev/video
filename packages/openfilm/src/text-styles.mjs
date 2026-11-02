// @ts-check
/** Local appearance presets; placement and timing remain properties of the text page and its clip. */
import { weightedElementIndex, contrastingTextPairs } from './text-element-weights.mjs';
import legacy from './text-styles.json' with { type: 'json' };
import elements from './text-elements.json' with { type: 'json' };
import compatibility from './text-style-compatibility.json' with { type: 'json' };
import generationRules from './text-style-generation-rules.json' with { type: 'json' };
import { validateTextPage } from './text-page.mjs';
export { getTextStyleCompatibility } from './text-compatibility.mjs';

/** Scene-informed candidate ranges for agents, separate from resolved renderable presets. */
export function getTextStyleGenerationRules() {
  return structuredClone(generationRules);
}

/** @typedef {import('./text-page.mjs').TextItem} TextItem */
/** @typedef {Pick<TextItem, 'fontFamily' | 'fontPath' | 'color' | 'bold' | 'italic' | 'underline' | 'stroke' | 'shadow'> & { fontSize?: number }} TextStyle */
/** @typedef {{ id: string, version: number, name: string, description: string, style: TextStyle }} TextStylePreset */
/** @typedef {{ version: 1, presets: TextStylePreset[] }} TextStyleLibrary */
/** @typedef {{ id: string, name: string, family: string, fontPath: string }} ElementFont */
/** @typedef {{ color: string, width: number }} ElementStroke */

const STYLE_KEYS = new Set(Object.keys(compatibility.appearance));
const object = (/** @type {any} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A copy of the user-provided element pools used to build native-compatible styles. */
export function getTextElementLibrary() {
  return structuredClone(elements);
}

/** @param {ElementFont} font @param {string} color @param {ElementStroke} stroke */
const elementPreset = (font, color, stroke) => ({
  id: `element-${font.id}-${color.slice(1).toLowerCase()}-${stroke.color.slice(1).toLowerCase()}`,
  version: 1,
  name: `元素组合 · ${font.name} · ${color} · 描边 ${stroke.color}`,
  description: '从元素库独立抽取字体、文字颜色和描边组合；只使用剪映原生文字字段。',
  style: {
    fontFamily: font.family,
    fontPath: font.fontPath,
    fontSize: elements.defaults.fontSize,
    color,
    bold: elements.defaults.bold,
    italic: elements.defaults.italic,
    underline: elements.defaults.underline,
    stroke: { color: stroke.color, width: stroke.width },
  },
});

/** Every independent element combination is a valid native text preset. */
const generated = elements.elements.fonts.flatMap((font) => elements.elements.colors.flatMap((color) =>
  elements.elements.strokes.map((stroke) => elementPreset(font, color, stroke))));

/** The generated library is first; legacy IDs remain addressable for existing projects and scripts. */
const BUILTIN = validateTextStyleLibrary({ version: 1, presets: [...generated, ...legacy.presets] });

/** @template T @param {T[]} list @param {Record<string, number>} weights @param {(item: T) => string} key @param {unknown} seed @returns {T} */
const pick = (list, weights, key, seed) => list[weightedElementIndex(list.map(item => weights[key(item)] ?? 1), seed)];

/**
 * Choose a weighted font and a weighted fill/outline pair with at least 3:1 contrast.
 * A seed makes generation reproducible; omitting it creates a fresh combination each time.
 */
export function sampleTextStyle(seed = `${Date.now()}-${Math.random()}`, weights = getTextElementLibrary().weights) {
  const font = pick(elements.elements.fonts, weights.fonts, font => font.id, `${seed}:font`);
  const pairs = contrastingTextPairs(elements.elements.colors, elements.elements.strokes, weights.colors, weights.strokes);
  const { color, stroke } = pairs[weightedElementIndex(pairs.map(pair => pair.weight), `${seed}:pair`)];
  return elementPreset(font, color, stroke);
}

/** Reject layout, content and unsupported effects rather than silently discarding them. @param {unknown} input */
function validateStyle(input, partial = false) {
  if (!object(input) || Object.keys(/** @type {object} */ (input)).some((key) => !STYLE_KEYS.has(key))) {
    throw new Error('Invalid text style properties');
  }
  const style = /** @type {TextStyle} */ (input);
  if (!partial) for (const [key, property] of Object.entries(compatibility.appearance)) {
    if ('requiredInPreset' in property && property.requiredInPreset && !Object.hasOwn(style, key)) throw new Error(`Text style requires ${key}`);
  }
  validateTextPage({ version: 1, width: 1080, height: 1920, duration: 1,
    texts: [Object.assign({ text: 'Style', x: 540, y: 960, fontSize: 64 }, style)] });
  return style;
}

/** Validate a JSON library and return an independent snapshot. @param {unknown} input @returns {TextStyleLibrary} */
export function validateTextStyleLibrary(input) {
  const library = /** @type {TextStyleLibrary} */ (input);
  if (!object(library) || library.version !== 1 || Object.keys(library).some((key) => !['version', 'presets'].includes(key))
    || !Array.isArray(library.presets) || !library.presets.length) throw new Error('Invalid text style library');
  const ids = new Set();
  for (const preset of library.presets) {
    if (!object(preset) || Object.keys(preset).some((key) => !['id', 'version', 'name', 'description', 'style'].includes(key))
      || typeof preset.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(preset.id) || ids.has(preset.id)
      || !Number.isSafeInteger(preset.version) || preset.version < 1
      || typeof preset.name !== 'string' || !preset.name.trim()
      || typeof preset.description !== 'string' || !preset.description.trim()) throw new Error('Invalid text style preset');
    ids.add(preset.id);
    validateStyle(preset.style);
  }
  return structuredClone(library);
}

/** A fresh copy on every call: changing one project's preset cannot change another's. */
export function listTextStyles() {
  return structuredClone(BUILTIN.presets);
}

/** Find a built-in preset. @param {string} id @returns {TextStylePreset} */
export function getTextStyle(id) {
  const preset = BUILTIN.presets.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Unknown text style: ${id}`);
  return structuredClone(preset);
}

/**
 * Replace appearance while keeping content, layout and animation. Existing run formatting is reset so a previous
 * rich-text color cannot hide the chosen style; run text and boundaries remain intact. No source object is mutated.
 * Save the returned item in the page; keep preset id/version separately in the production plan if needed.
 * @param {TextItem} item
 * @param {string | TextStylePreset} selection A built-in id or a validated custom preset.
 * @param {Partial<TextStyle>} [overrides] Local appearance changes, including the destination font file.
 * @returns {TextItem}
 */
export function applyTextStyle(item, selection, overrides = {}) {
  const preset = typeof selection === 'string' ? getTextStyle(selection)
    : validateTextStyleLibrary({ version: 1, presets: [selection] }).presets[0];
  validateStyle(overrides, true);
  const result = /** @type {TextItem} */ (Object.fromEntries(
    Object.entries(structuredClone(item)).filter(([key]) => !STYLE_KEYS.has(key))));
  Object.assign(result, { fontSize: item.fontSize }, preset.style, structuredClone(overrides));
  if (result.runs) result.runs = result.runs.map(({ text }) => ({ text }));
  return result;
}
