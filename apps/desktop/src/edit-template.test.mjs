import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTemplate, normalizeTemplate, templateSummary, titleFontSize } from './edit-template.mjs';

test('title sizing fits longer titles while keeping a readable minimum', () => {
  assert.equal(titleFontSize(''), 112);
  assert.ok(titleFontSize('济南体适能界复购率最高的教练') < titleFontSize('济南最新的运动训练'));
  assert.ok(titleFontSize('一'.repeat(80)) >= 42);
});

test('legacy subtitle text migrates into ordered independent inputs', () => {
  const config = normalizeTemplate({ ...initialTemplate(), subtitles: true, subtitleText: '第一条\n第二条\n第三条' });
  assert.deepEqual(config.subtitleTexts, ['第一条', '第二条', '第三条']);
  assert.match(templateSummary(config), /副标题1：第一条\n副标题2：第二条\n副标题3：第三条/);
});

test('subtitle arrays remain independent and are bounded at the native boundary', () => {
  const config = normalizeTemplate({ ...initialTemplate(), subtitles: true, subtitleTexts: ['第一条', '第二条', '第三条'] });
  assert.deepEqual(config.subtitleTexts, ['第一条', '第二条', '第三条']);
  assert.throws(() => normalizeTemplate({ ...initialTemplate(), subtitleTexts: ['x'.repeat(2001)] }), /副标题格式/);
});
