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

test('selected text styles are deduplicated, bounded and included in the template summary', () => {
  const config = normalizeTemplate({ ...initialTemplate(), textStyleIds: ['yellow-headline', 'yellow-headline', 'element-simhei-ffffff-000000'] });
  assert.deepEqual(config.textStyleIds, ['yellow-headline', 'element-simhei-ffffff-000000']);
  assert.match(templateSummary(config), /仅使用已勾选样式（yellow-headline、element-simhei-ffffff-000000）/);
  assert.throws(() => normalizeTemplate({ ...initialTemplate(), textStyleIds: ['not valid'] }), /文字样式格式/);
});


test('optional narration persists and old advertising modes migrate without retaining categories', () => {
  assert.equal(initialTemplate().narration, false);
  for (const narration of [false, true]) {
    const config = normalizeTemplate({ ...initialTemplate(), narration });
    assert.equal(normalizeTemplate(JSON.parse(JSON.stringify(config))).narration, narration);
    assert.match(templateSummary(config), narration ? /已勾选；豆包 seed-tts-2.0/ : /未勾选；不生成配音/);
    assert.doesNotMatch(templateSummary(config), /广告素材 \/ /);
  }
  assert.equal(normalizeTemplate({ kind: 'ad', adMode: '文案朗读 + 音频' }).narration, true);
  for (const adMode of ['原声 · 无朗读', '动作分享', '大字报', '正确动作教学']) {
    const config = normalizeTemplate({ kind: 'ad', adMode });
    assert.equal(config.narration, false);
    assert.equal('adMode' in config, false);
  }
  assert.equal(normalizeTemplate({ kind: 'ad', adMode: '文案朗读 + 音频', narration: false }).narration, false);
  assert.throws(() => normalizeTemplate({ kind: 'ad', narration: 'yes' }), /无效的模板字段/);
});


test('talk templates discard retired cover and scene settings from older projects', () => {
  const config = normalizeTemplate({ ...initialTemplate(), kind: 'talk', cover: true, coverText: '旧封面', scenes: true });
  for (const key of ['cover', 'coverText', 'scenes']) assert.equal(key in config, false);
  assert.doesNotMatch(templateSummary(config), /封面|场景剪辑|旧封面/);
});


test('live templates discard retired logic and do not impose a fixed duration', () => {
  const config = normalizeTemplate({ ...initialTemplate(), kind: 'live', logic: '旧内容逻辑' });
  assert.equal('logic' in config, false);
  assert.doesNotMatch(templateSummary(config), /01:00|成品长度|切片内容逻辑|旧内容逻辑/);
});


test('advertising templates discard retired opening and picture-in-picture settings', () => {
  const config = normalizeTemplate({ ...initialTemplate(), opening: true, pip: true });
  assert.equal('opening' in config, false);
  assert.equal('pip' in config, false);
  assert.doesNotMatch(templateSummary(config), /开头：|画中画：/);
});


test('copy templates retain source content and discard retired rewrite settings', () => {
  const config = normalizeTemplate({ ...initialTemplate(), kind: 'copy', source: '原始文案', rewrite: '旧方向' });
  assert.equal(config.source, '原始文案');
  assert.equal('rewrite' in config, false);
  assert.match(templateSummary(config), /原始文案：原始文案/);
  assert.doesNotMatch(templateSummary(config), /二创方向|旧方向/);
});


test('narration is available only to advertising with body content enabled', () => {
  for (const kind of ['ad', 'talk', 'copy', 'live']) {
    const config = normalizeTemplate({ ...initialTemplate(), kind, body: true, narration: true });
    if (kind === 'copy') {
      assert.doesNotMatch(templateSummary(config), /文案朗读/);
    } else if (kind !== 'ad') {
      assert.equal(config.narration, false);
    } else {
      assert.match(templateSummary(config), /文案朗读：已勾选；豆包 seed-tts-2.0/);
      assert.match(templateSummary({ ...config, body: false }), /文案朗读：未勾选/);
    }
  }
});


test('copy content does not inherit hidden advertising fields', () => {
  const config = normalizeTemplate({ ...initialTemplate(), kind: 'copy', source: '二创原文', titleText: '广告标题', bodyText: '广告正文', location: true, locationText: '广告地点', narration: true });
  assert.equal(config.source, '二创原文');
  assert.equal(config.bodyText, '');
  assert.equal(config.titleText, '');
  assert.equal(config.location, false);
  assert.equal(config.narration, false);
  assert.doesNotMatch(templateSummary(config), /广告标题|广告正文|广告地点|文案朗读/);
  assert.equal(normalizeTemplate({ ...initialTemplate(), kind: 'copy', bodyText: '隐藏旧文案' }).source, '');
});
