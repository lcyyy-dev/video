import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTextStyle, getTextElementLibrary, getTextStyle, getTextStyleCompatibility, listTextStyles, sampleTextStyle, validateTextStyleLibrary } from './text-styles.mjs';
import { nativeTextFallbackReason } from './text-compatibility.mjs';
import { readTextPageJson, textPageJson } from './text-page.mjs';

const item = { text: '每天训练，改变自己', x: 540, y: 1500, width: 900, align: 'center', fontSize: 40,
  fontPath: '/old/font.ttf', color: '#112233', italic: true,
  shadow: { color: '#000000', opacity: 1, blur: 8, x: 2, y: 2 },
  runs: [{ text: '每天训练，', color: '#00ff00', fontSize: 20 }, { text: '改变自己', underline: true }],
  keyframes: { x: [{ time: 0, value: 500 }, { time: 1, value: 540 }] } };

test('agents can inspect an isolated compatibility snapshot that describes every accepted appearance field', () => {
  const rules = getTextStyleCompatibility();
  assert.equal(rules.version, 1);
  assert.deepEqual(rules.targets, ['jianying', 'capcut']);
  assert.equal(rules.evidence.clientVisualParity, 'not-certified');
  for (const field of Object.keys(rules.appearance)) {
    const preset = listTextStyles().find((entry) => field in entry.style)?.style;
    const value = field === 'fontPath' ? 'fonts/example.ttf' : preset[field];
    assert.doesNotThrow(() => applyTextStyle(item, 'white-outline', { [field]: value }));
  }
  rules.appearance.fontSize.requiredInPreset = true;
  assert.equal(getTextStyleCompatibility().appearance.fontSize.requiredInPreset, false);
});

test('native draft fallback decisions and report reasons follow the machine-readable rules', () => {
  const rules = getTextStyleCompatibility();
  const page = { version: 1, width: 1080, height: 1920, duration: 2, texts: [item] };
  const context = { canvas: { width: 1080, height: 1920 } };
  assert.equal(nativeTextFallbackReason(page, context), null);
  assert.equal(nativeTextFallbackReason(page, { ...context, hasElementOverrides: true }), rules.nativeFallbackRules[0].reason);
  assert.equal(nativeTextFallbackReason(page, { ...context, hasClipOverrides: true }), rules.nativeFallbackRules[1].reason);
  assert.equal(nativeTextFallbackReason({ ...page, width: 720 }, context), rules.nativeFallbackRules[2].reason);
  const animated = { ...page, texts: [{ ...item, keyframes: { opacity: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } }] };
  assert.equal(nativeTextFallbackReason(animated, context), rules.nativeFallbackRules[3].reason);
  assert.equal(nativeTextFallbackReason(animated, { ...context, hasElementOverrides: true }), rules.nativeFallbackRules[0].reason);
  assert.equal(nativeTextFallbackReason({ ...page, texts: [{ ...page.texts[0], backgroundColor: '#0066cc' }] }, context), rules.nativeFallbackRules[4].reason);
});

test('built-in JSON presets are discoverable, independent snapshots', () => {
  const presets = listTextStyles();
  assert.equal(presets.length, 282);
  assert.match(presets[0].id, /^element-/);
  assert.ok(presets.some((preset) => preset.id === 'white-outline'), 'legacy IDs remain addressable');
  assert.equal(new Set(presets.map((preset) => preset.id)).size, presets.length);
  presets[0].style.stroke.width = 999;
  assert.equal(getTextStyle(presets[1].id).style.stroke.width, 14);
  assert.equal(getTextStyle('white-outline').style.stroke.width, 4);
  assert.throws(() => getTextStyle('missing'), /Unknown text style/);
});

test('element pools generate reproducible independent combinations', () => {
  const library = getTextElementLibrary();
  assert.deepEqual(library.elements.fonts.map((font) => font.name), ['黑体', '方糖体', '新青年体']);
  assert.equal(library.elements.colors.length, 12);
  assert.equal(library.elements.strokes.length, 7);
  const a = sampleTextStyle('same-seed');
  const b = sampleTextStyle('same-seed');
  const c = sampleTextStyle('different-seed');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.style, c.style);
  assert.equal(a.style.fontSize, 88);
  assert.equal(a.style.bold, true);
  assert.equal(a.style.italic, false);
  assert.equal(a.style.underline, false);
  assert.equal(a.style.stroke.width, 14);
  assert.equal(a.style.shadow, undefined);
});

test('applying and switching appearance preserves content, placement and keys without stale styles', () => {
  const original = structuredClone(item);
  const yellow = applyTextStyle(item, 'yellow-headline');
  const white = applyTextStyle(yellow, 'white-outline');
  assert.deepEqual(item, original);
  assert.equal(yellow.color, '#ffe21f');
  assert.ok(yellow.shadow);
  assert.equal(white.shadow, undefined);
  assert.equal(white.fontPath, undefined);
  assert.equal(white.italic, false);
  assert.equal(white.x, item.x);
  assert.equal(white.y, item.y);
  assert.equal(white.width, item.width);
  assert.equal(white.align, item.align);
  assert.equal(white.text, item.text);
  assert.deepEqual(white.keyframes, item.keyframes);
  assert.deepEqual(white.runs, item.runs.map(({ text }) => ({ text })));
  for (const preset of listTextStyles()) {
    const page = { version: 1, width: 1080, height: 1920, duration: 2, texts: [applyTextStyle(item, preset)] };
    assert.deepEqual(readTextPageJson(textPageJson(page)), page);
  }
});

test('custom JSON libraries and local overrides use the same validated appearance contract', () => {
  const library = { version: 1, presets: [{ ...getTextStyle('white-outline'), id: 'custom', name: 'Custom' }] };
  const parsed = validateTextStyleLibrary(JSON.parse(JSON.stringify(library)));
  const overrides = { fontSize: 72, fontFamily: 'Example font', fontPath: 'fonts/example.ttf',
    stroke: { color: '#ffffff', width: 2 } };
  const styled = applyTextStyle(item, parsed.presets[0], overrides);
  overrides.stroke.width = 99;
  assert.equal(styled.fontSize, 72);
  assert.equal(styled.fontPath, 'fonts/example.ttf');
  assert.equal(styled.stroke.width, 2);
  parsed.presets[0].style.color = '#123456';
  assert.equal(library.presets[0].style.color, '#ffffff');
  for (const invalid of [{ color: 'red' }, { fontSize: 0 }, { x: 12 }, { text: 'Replacement' },
    { shadow: { color: '#000000', opacity: 2, blur: 1, x: 0, y: 0 } }, { effectId: 'unknown' }]) {
    assert.throws(() => applyTextStyle(item, 'white-outline', invalid));
  }
});

test('invalid library versions, duplicate ids and unsupported preset properties fail explicitly', () => {
  const preset = getTextStyle('white-outline');
  for (const invalid of [null, [], { version: 2, presets: [preset] }, { version: 1, presets: [] },
    { version: 1, presets: [preset, preset] },
    { version: 1, presets: [{ ...preset, version: 0 }] },
    { version: 1, presets: [{ ...preset, id: '../external' }] },
    { version: 1, presets: [{ ...preset, style: { color: 'invalid-color' } }] },
    { version: 1, presets: [{ ...preset, style: { ...preset.style, keyframes: {} } }] }]) {
    assert.throws(() => validateTextStyleLibrary(invalid));
  }
});

test('custom appearance can omit font size and inherits the generated text layout size', () => {
  const preset = { id: 'custom-no-size', version: 1, name: 'Yellow outline', description: 'Appearance only',
    style: { fontFamily: 'SimHei', color: '#F2DA2D', stroke: { color: '#000000', width: 4 } } };
  const styled = applyTextStyle({ text: '标题', x: 540, y: 200, fontSize: 76 }, preset);
  assert.equal(styled.fontSize, 76);
  assert.equal(styled.color, '#F2DA2D');
  assert.equal('fontSize' in preset.style, false, 'the reusable style does not store the preview size');
  const resized = applyTextStyle({ ...styled, fontSize: 59 }, preset);
  assert.equal(resized.fontSize, 59);
});
