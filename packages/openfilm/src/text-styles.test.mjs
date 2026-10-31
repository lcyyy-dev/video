import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTextStyle, getTextStyle, getTextStyleCompatibility, listTextStyles, validateTextStyleLibrary } from './text-styles.mjs';
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
  rules.appearance.fontSize.requiredInPreset = false;
  assert.equal(getTextStyleCompatibility().appearance.fontSize.requiredInPreset, true);
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
  assert.equal(presets.length, 30);
  assert.deepEqual(presets.slice(0, 9).map((preset) => preset.id), ['white-outline', 'yellow-headline', 'red-emphasis',
    'xinqingnian-yellow', 'houxiandai-cyan', 'zhongyuan-red', 'simsun-white', 'simhei-yellow', 'kaiti-white']);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 30);
  presets[0].style.stroke.width = 999;
  assert.equal(getTextStyle('white-outline').style.stroke.width, 4);
  assert.throws(() => getTextStyle('missing'), /Unknown text style/);
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
    { version: 1, presets: [{ ...preset, style: { color: '#ffffff' } }] },
    { version: 1, presets: [{ ...preset, style: { ...preset.style, keyframes: {} } }] }]) {
    assert.throws(() => validateTextStyleLibrary(invalid));
  }
});
