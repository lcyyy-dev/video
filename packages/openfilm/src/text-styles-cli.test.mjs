import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveTextStyle, setDefaultTextStyle } from '../studio/server/text-styles.mjs';
import { readTextPage } from './text-page.mjs';

const cli = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'styles-cli-'));
after(() => rmSync(home, { recursive: true, force: true }));
const run = (...args) => spawnSync(process.execPath, [cli, 'text-styles', ...args], { encoding: 'utf8', env: { ...process.env, OPENFILM_HOME: home } });

test('the text styles command exposes presets and rules as JSON without opening a project', () => {
  const list = run('list');
  assert.equal(list.status, 0, list.stderr);
  const presets = JSON.parse(list.stdout);
  assert.ok(presets.length > 0);
  const compact = run('list', '--compact');
  assert.equal(compact.status, 0, compact.stderr);
  assert.deepEqual(Object.keys(JSON.parse(compact.stdout)[0]).sort(), ['description', 'id', 'name', 'version']);
  const show = run('show', presets[0].id);
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(JSON.parse(show.stdout), presets[0]);
  const rules = run('rules');
  assert.equal(rules.status, 0, rules.stderr);
  const contract = JSON.parse(rules.stdout);
  assert.equal(contract.version, 1);
  assert.ok(contract.appearance.stroke && contract.appearance.shadow);
  assert.ok(contract.nativeFallbackRules.length > 0);
});

test('the generator uses the user default, supports an explicit preset and protects existing files', () => {
  const { preset } = saveTextStyle({ name: 'Custom default', style: { fontSize: 88, color: '#123456', bold: true,
    stroke: { color: '#ffffff', width: 6 } } }, null, home);
  setDefaultTextStyle(preset.id, home);
  assert.equal(JSON.parse(run('show', 'default').stdout).id, preset.id);
  const output = join(home, 'title.html');
  const generated = run('page', output, '--text', 'Keep moving', '--duration', '4', '--size', '1080x1920');
  assert.equal(generated.status, 0, generated.stderr);
  const page = readTextPage(readFileSync(output, 'utf8'));
  assert.equal(page.texts[0].color, '#123456');
  assert.equal(page.texts[0].fontSize, 88);
  assert.equal(page.duration, 4);
  assert.equal(run('page', output, '--text', 'Overwrite', '--duration', '4').status, 2);
  assert.equal(readTextPage(readFileSync(output, 'utf8')).texts[0].text, 'Keep moving');
  const explicit = join(home, 'explicit.html');
  assert.equal(run('page', explicit, '--text', 'Explicit', '--duration', '2', '--preset', 'yellow-headline').status, 0);
  assert.equal(readTextPage(readFileSync(explicit, 'utf8')).texts[0].color, '#ffe21f');
});

test('agents can read scene-adaptive ranges without confusing them with renderable presets', () => {
  const result = run('generation-rules');
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout);
  assert.deepEqual(policy.font.candidates, ['宋体', '新青年体', '后现代体', '黑体', '圆体', '楷体']);
  assert.equal(policy.rangePolicy.strength, 'advisory');
  assert.equal(policy.rangePolicy.reference, 'jianying-panel');
  assert.equal(policy.selection.mode, 'library-only');
  assert.equal(policy.selection.presetIdRequired, true);
  assert.equal(policy.selection.allowAdHocAppearance, false);
  assert.equal(policy.selection.randomizePerCaption, false);
  assert.equal(policy.stroke.thickness.unit, 'jianying-panel-value');
  assert.equal(policy.shadow.distance.unit, 'jianying-panel-value');
  assert.equal(policy.background.enabled, 'when-needed-for-scene-readability');
  assert.equal(policy.shadow.enabled, 'when-needed-for-scene-readability');
  const range = (value) => [value.min, value.max];
  assert.deepEqual(range(policy.stroke.opacity), [60, 100]);
  assert.deepEqual(range(policy.stroke.thickness), [30, 45]);
  assert.deepEqual(policy.stroke.color, { darkText: '#FFFFFF', lightText: '#000000' });
  const [yellow, white] = policy.background.variants;
  assert.equal(yellow.color, '#FFEA00');
  assert.deepEqual(range(yellow.opacity), [100, 100]);
  assert.deepEqual(range(yellow.cornerRadius), [20, 50]);
  assert.equal(white.color, '#FFFFFF');
  assert.deepEqual(range(white.opacity), [40, 40]);
  assert.deepEqual(range(white.cornerRadius), [0, 0]);
  assert.deepEqual(range(policy.shadow.opacity), [70, 90]);
  assert.deepEqual(range(policy.shadow.blur), [15, 25]);
  assert.deepEqual(range(policy.shadow.distance), [5, 10]);
  assert.deepEqual(range(policy.shadow.angle), [-150, -30]);
  assert.ok(policy.implementation.notYetSupportedInStructuredText.includes('background'));
  assert.equal(run('generation-rules', 'extra').status, 2);
});

test('reference preset pages carry their fonts instead of depending on system installation', () => {
  for (const id of ['xinqingnian-yellow', 'houxiandai-cyan', 'zhongyuan-red', 'simsun-white', 'simhei-yellow', 'kaiti-white']) {
    const output = join(home, `${id}.html`);
    const generated = run('page', output, '--text', '测试字体', '--duration', '3', '--preset', id);
    assert.equal(generated.status, 0, generated.stderr);
    const html = readFileSync(output, 'utf8');
    assert.match(html, /@font-face/);
    assert.match(html, /data:font\/(ttf|otf|collection);base64,/);
    const page = readTextPage(html);
    assert.match(page.texts[0].fontPath, /^openfilm-font:/);
  }
});

test('unknown styles and malformed text styles commands return usage errors', () => {
  for (const args of [['show', 'unknown-style'], ['show'], ['rules', 'extra'], ['list', 'extra']]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stdout.trim());
    assert.doesNotMatch(result.stderr, /Executable doesn't exist|downloading|Error:/);
  }
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /machine-readable/);
});
