import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textStyleLibrary, saveTextStyle, resolveTextStyle, setDefaultTextStyle, deleteTextStyle, styledTextPage } from './text-styles.mjs';
import { startStudio } from './server.mjs';
import { textPageJson, readTextPageJson } from '../../src/text-page.mjs';
import { jianyingDraft } from './jianying.mjs';
import { planNleTimeline } from './nle.mjs';
import { bundledTextFont, textFontCss } from './text-fonts.mjs';

let home, studio;
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'text-styles-'));
  process.env.OPENFILM_HOME = home;
  process.env.OPENFILM_LIBRARY = join(home, 'projects');
  studio = await startStudio({ port: 0 });
});
after(async () => { await studio?.close(); rmSync(home, { recursive: true, force: true }); });
const request = async (path = '', method = 'GET', body) => {
  const response = await fetch(`${studio.origin}/api/text-styles${path}`, { method,
    headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test('custom presets persist, defaults resolve, built-ins are immutable and stale updates fail', async () => {
  const initial = await request();
  assert.equal(initial.status, 200);
  const builtin = initial.body.presets[0];
  const made = await request('', 'POST', { name: 'My workout captions', style: { ...builtin.style, color: '#00cfff',
    shadow: { color: '#000000', opacity: 1, blur: 1, x: 6, y: 8 } } });
  assert.equal(made.status, 201);
  const preset = made.body.preset;
  assert.equal(preset.version, 1);
  assert.equal((await request('/default', 'PUT', { id: preset.id })).status, 200);
  assert.equal(resolveTextStyle().id, preset.id);
  assert.equal(JSON.parse(readFileSync(join(home, 'text-styles.json'))).defaultId, preset.id);
  const page = styledTextPage({ text: 'Keep moving', width: 1080, height: 1920, duration: 3 });
  assert.equal(page.texts[0].color, '#00cfff');
  assert.deepEqual(readTextPageJson(textPageJson(page)), page);
  const updated = await request(`/${preset.id}`, 'PUT', { name: preset.name, style: { ...preset.style, color: '#ff0000' }, version: 1 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preset.version, 2);
  assert.equal((await request(`/${preset.id}`, 'PUT', { ...preset, name: 'Stale' })).status, 409);
  assert.equal(page.texts[0].color, '#00cfff', 'existing project snapshots never change with the library');
  assert.equal((await request(`/${builtin.id}`, 'PUT', { ...builtin })).status, 400);
  assert.equal((await request(`/${builtin.id}`, 'DELETE')).status, 400);
  assert.equal(textStyleLibrary().presets.find((entry) => entry.id === builtin.id).style.color, builtin.style.color);
  const deleted = await request(`/${preset.id}`, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.defaultId, builtin.id);
  assert.equal(resolveTextStyle().id, builtin.id);
});

test('invalid or corrupt style data does not overwrite stored presets', async () => {
  for (const input of [null, {}, { name: '', style: { fontSize: 64 } }, { name: 'Invalid', style: { fontSize: -1 } },
    { name: 'Invalid', style: { fontSize: 64, effectId: 'fake' } }]) {
    assert.equal((await request('', 'POST', input)).status, 400);
  }
  assert.equal((await request('/default', 'PUT', { id: 'missing' })).status, 404);
  assert.equal((await request('/default', 'PUT', null)).status, 400);
  const isolated = mkdtempSync(join(tmpdir(), 'corrupt-text-styles-'));
  try {
    writeFileSync(join(isolated, 'text-styles.json'), 'broken');
    assert.throws(() => saveTextStyle({ name: 'New', style: { fontSize: 64 } }, null, isolated), /left unchanged/);
    assert.equal(readFileSync(join(isolated, 'text-styles.json'), 'utf8'), 'broken');
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

test('a page generated with a saved default exports its resolved appearance as editable draft text', () => {
  const { preset } = saveTextStyle({ name: 'Native default', style: { fontSize: 96, fontFamily: 'Example font',
    fontPath: 'C:/Windows/Fonts/example.ttf', color: '#ffe21f', bold: true,
    stroke: { color: '#000000', width: 8 }, shadow: { color: '#000000', opacity: 1, blur: 2, x: 5, y: 6 } } });
  setDefaultTextStyle(preset.id);
  const page = styledTextPage({ text: 'Editable styled title', width: 1080, height: 1920, duration: 3 });
  const timeline = planNleTimeline({ stage: { w: 1080, h: 1920 }, duration: 3, sounds: [], pictures: [
    { id: 'title', kind: 'page', src: 'title.text.json', path: '/project/title.text.json', at: 0, end: 3, from: 0, speed: 1, track: 0, hidden: false, facts: null },
  ] }, { title: 'Custom', fps: 30, audio: 'clips', media: 'copy', mediaDir: '/drafts/Custom/media' });
  const { info } = jianyingDraft(timeline, { name: 'Custom', folder: '/drafts/Custom', root: '/drafts', textPages: new Map([['title', page]]) });
  assert.equal(info.materials.videos.length, 0);
  assert.equal(info.tracks[0].type, 'text');
  const material = info.materials.texts[0], content = JSON.parse(material.content), style = content.styles[0];
  assert.equal(content.text, page.texts[0].text);
  assert.equal(material.text_color, '#ffe21fFF');
  assert.equal(style.size, 14.222222);
  assert.equal(style.strokes[0].width, 0.208333);
  assert.equal(style.shadows[0].alpha, 1);
  assert.equal(style.font.path, preset.style.fontPath);
  deleteTextStyle(preset.id);
});

test('bundled fonts resolve without local mappings or machine-specific installation', async () => {
  const isolated = mkdtempSync(join(tmpdir(), 'text-font-map-'));
  try {
    const family = 'HYZhongYuanJ', path = 'openfilm-font:hy-zhongyuan';
    const preset = resolveTextStyle('zhongyuan-red', isolated);
    assert.equal(preset.style.fontPath, path);
    const page = styledTextPage({ text: '核心控制', width: 1080, height: 1920, duration: 3 }, preset.id, isolated);
    assert.equal(page.texts[0].fontPath, path);
    assert.equal(page.texts[0].fontFamily, family);
    const custom = saveTextStyle({ name: 'Explicit file', style: { fontFamily: family, fontSize: 80, fontPath: 'D:/Fonts/custom.ttf' } }, null, isolated).preset;
    assert.equal(resolveTextStyle(custom.id, isolated).style.fontPath, 'D:/Fonts/custom.ttf');
    const css = await fetch(`${studio.origin}/api/text-styles/fonts.css`, { headers: { 'x-studio-key': studio.key } });
    assert.equal(css.status, 200);
    assert.match(await css.text(), /HYZhongYuanJ/);
    const font = await fetch(`${studio.origin}/api/text-styles/fonts/hy-zhongyuan`, { headers: { 'x-studio-key': studio.key } });
    assert.equal(font.status, 200);
    assert.deepEqual(Buffer.from(await font.arrayBuffer()), readFileSync(bundledTextFont(family).path));
    assert.match(textFontCss([family], true), /data:font\/ttf;base64,/);
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

test('a user-created style stores no font size and generated pages remain valid', async () => {
  const made = await request('', 'POST', { name: 'Appearance without size', style: {
    fontFamily: 'SimHei', color: '#F2DA2D', stroke: { color: '#000000', width: 4 },
  } });
  assert.equal(made.status, 201);
  assert.equal(Object.hasOwn(made.body.preset.style, 'fontSize'), false);
  const saved = resolveTextStyle(made.body.preset.id);
  assert.equal(Object.hasOwn(saved.style, 'fontSize'), false);
  const page = styledTextPage({ text: '自适应字号', width: 1080, height: 1920, duration: 2 }, saved.id);
  assert.ok(page.texts[0].fontSize > 0, 'a standalone preview has a usable demonstration size');
});
