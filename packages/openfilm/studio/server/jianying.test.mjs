import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, win32 } from 'node:path';
import { planNleTimeline } from './nle.mjs';
import { draftsRoot, jianyingDraft } from './jianying.mjs';
import { applyTextStyle, listTextStyles } from '../../src/text-styles.mjs';

test('every built-in text preset exports native editable text with its appearance', () => {
  for (const preset of listTextStyles()) {
    const item = applyTextStyle({ text: '原生样式 😀', x: 960, y: 700, fontSize: 40 }, preset,
      { fontFamily: 'Example font', fontPath: 'C:/Windows/Fonts/example.ttf' });
    const textPages = new Map([['title', { version: 1, width: 1920, height: 1080, duration: 2, texts: [item] }]]);
    for (const app of ['jianying', 'capcut']) {
      const { info } = jianyingDraft(plan(), { app, name: 'Presets', folder: '/drafts/Presets', root: '/drafts', textPages });
      assert.equal(info.materials.texts.length, 1);
      const material = info.materials.texts[0];
      const content = JSON.parse(material.content);
      assert.equal(content.text, item.text);
      assert.equal(content.styles[0].size, Math.round(item.fontSize / 6.75 * 1e6) / 1e6);
      assert.equal(content.styles[0].font.path, item.fontPath);
      assert.equal(content.styles[0].bold, Boolean(item.bold));
      assert.equal(material.text_color, `${item.color}FF`);
      assert.equal(material.has_shadow, Boolean(item.shadow));
      assert.equal(content.styles[0].strokes[0].width, Math.round(item.stroke.width / item.fontSize / 0.4 * 1e6) / 1e6);
      assert.equal(info.tracks.filter((track) => track.type === 'text').length, 1);
      assert.equal(info.materials.videos.some((media) => media.path.endsWith('title.mov')), false);
    }
  }
});

test('structured titles become native text, with no corresponding video material', () => {
  const timeline = plan();
  const textPages = new Map([['title', { version: 1, width: 1920, height: 1080, duration: 2,
    texts: [{ text: '可编辑 😀', x: 960, y: 270, fontSize: 80, color: '#ff8000', fontFamily: 'Microsoft YaHei',
      fontPath: 'C:/Windows/Fonts/msyh.ttc', bold: true,
      keyframes: { x: [{ time: 0, value: 480 }, { time: 1, value: 960 }] } }] }]]);
  const { info } = jianyingDraft(timeline, { name: 'Native', folder: '/d/Native', root: '/d', textPages });
  const native = info.tracks.find((t) => t.type === 'text');
  const material = info.materials.texts.find((m) => m.id === native.segments[0].material_id);
  const content = JSON.parse(material.content);
  assert.equal(content.text, '可编辑 😀');
  assert.equal(content.styles[0].size, 11.851852);
  assert.equal(content.styles[0].font.path, 'C:/Windows/Fonts/msyh.ttc');
  assert.deepEqual(content.styles[0].fill.content.solid.color, [1, 128 / 255, 0]);
  assert.deepEqual(native.segments[0].target_timerange, { start: 0, duration: 2_000_000 });
  assert.deepEqual(native.segments[0].clip.transform, { x: 0, y: 0.5 });
  const key = native.segments[0].common_keyframes[0];
  assert.equal(key.property_type, 'KFTypePositionX');
  assert.deepEqual(key.keyframe_list.map((k) => [k.time_offset, ...k.values]), [[0, -0.5], [1_000_000, 0], [2_000_000, 0]]);
  assert.equal(info.materials.videos.some((m) => m.path.endsWith('title.mov')), false);
});

test('formatted text keeps spacing, alignment, font metadata, outline and shadow', () => {
  const textPages = new Map([['title', { version: 1, width: 1920, height: 1080, duration: 2,
    texts: [{ text: '保留样式', x: 600, y: 250, fontSize: 80, color: '#d5ff60', fontFamily: 'Microsoft YaHei',
      fontPath: 'C:/Windows/Fonts/msyh.ttc', align: 'left', width: 900, lineHeight: 1.25,
      letterSpacing: 4, underline: true, stroke: { color: '#000000', width: 2 },
      shadow: { color: '#112233', opacity: 0.5, blur: 6, x: 3, y: 4 } }] }]]);
  const { info } = jianyingDraft(plan(), { name: 'Styles', folder: '/d/Styles', root: '/d', textPages });
  const material = info.materials.texts[0], style = JSON.parse(material.content).styles[0];
  assert.equal(material.font_name, 'Microsoft YaHei');
  assert.equal(material.font_path, style.font.path);
  assert.equal(material.font_size, style.size);
  assert.equal(material.text_color, '#d5ff60FF');
  assert.equal(material.letter_spacing, 0.05);
  assert.equal(material.line_spacing, 0.25);
  assert.equal(material.alignment, 0);
  assert.equal(material.force_apply_line_max_width, true);
  assert.equal(style.underline, true);
  assert.equal(style.strokes[0].width, 0.0625);
  assert.equal(style.shadows[0].alpha, 0.5);
  assert.equal(info.materials.videos.some((m) => m.path.endsWith('title.mov')), false);
});

test('sequential native titles share a track; overlapping titles remain separate', () => {
  const timeline = plan();
  const layer = timeline.video.find((t) => t.clips.some((c) => c.fileId === timeline.files.find((f) => f.job.kind === 'render')?.id));
  const original = layer.clips[0];
  layer.clips.push({ ...original, id: 'next', start: 60, end: 120 });
  const textPages = new Map([['title', { version: 1, width: 1920, height: 1080, duration: 2,
    texts: [{ text: '标题', x: 960, y: 300, fontSize: 80 }] }]]);
  const opts = { name: 'Lanes', folder: '/d/Lanes', root: '/d', textPages };
  const sequential = jianyingDraft(timeline, opts).info.tracks.filter((t) => t.type === 'text');
  assert.equal(sequential.length, 1);
  assert.deepEqual(sequential[0].segments.map((s) => s.target_timerange), [
    { start: 0, duration: 2_000_000 }, { start: 2_000_000, duration: 2_000_000 },
  ]);
  layer.clips[1].start = 30;
  assert.equal(jianyingDraft(timeline, opts).info.tracks.filter((t) => t.type === 'text').length, 2);
});

test('multi-color outlined copy stays one editable text segment with per-range styles', () => {
  const textPages = new Map([['title', { version: 1, width: 1920, height: 1080, duration: 2,
    texts: [{ text: '黄标题\n白说明\n红重点', x: 960, y: 250, fontSize: 80, bold: true,
      runs: [{ text: '黄标题\n', color: '#ffe21f', stroke: { color: '#000000', width: 8 } },
        { text: '白说明\n', color: '#ffffff', fontSize: 64, stroke: { color: '#000000', width: 6 } },
        { text: '红重点', color: '#ff344d', fontSize: 68, stroke: { color: '#ffffff', width: 6 } }] }] }]]);
  const { info } = jianyingDraft(plan(), { name: 'Rich', folder: '/d/Rich', root: '/d', textPages });
  assert.equal(info.materials.texts.length, 1);
  assert.equal(info.tracks.filter((t) => t.type === 'text').length, 1);
  const content = JSON.parse(info.materials.texts[0].content);
  assert.deepEqual(content.styles.map((s) => s.range), [[0, 4], [4, 8], [8, 11]]);
  assert.equal(info.materials.texts[0].is_rich_text, true);
  assert.deepEqual(content.styles.map((s) => s.size), [11.851852, 9.481481, 10.074074]);
  assert.deepEqual(content.styles[2].strokes[0].content.solid.color, [1, 1, 1]);
  assert.equal(content.styles[0].bold, true);
  assert.equal(info.materials.videos.some((m) => m.path.endsWith('title.mov')), false);
});

const facts = { w: 960, h: 540, duration: 10, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const sound = { duration: 20, hasVideo: false, hasAudio: true, channels: 2, sampleRate: 48000 };

/** A film: a page over footage placed small, its own sound, music fading in on a muted track's neighbour, a still. */
const plan = (/** @type {Partial<{ musicOn: boolean }>} */ o = {}) => planNleTimeline({
  stage: { w: 1920, h: 1080 }, duration: 6,
  pictures: [
    { id: 'title', kind: 'page', src: 'title.html', path: '/p/title.html', at: 0, end: 2, from: 0, speed: 1, track: 0, hidden: false, facts: null },
    { id: 'shot', kind: 'video', src: 'a.mp4', path: '/p/a.mp4', at: 1, end: 5, from: 2, speed: 1, track: 1, hidden: false, box: { x: 480, y: 0, w: 960 }, facts },
    { id: 'still', kind: 'still', src: 'b.png', path: '/p/b.png', at: 5, end: 6, from: 0, speed: 1, track: 1, hidden: true, facts: { w: 1920, h: 1080 } },
  ],
  sounds: [
    { id: 'shot', src: 'a.mp4', path: '/p/a.mp4', at: 1, from: 2, to: 6, speed: 1, volume: 0.5, enabled: true, role: 'footage', picture: 'shot', facts },
    { id: 'bed', src: 'assets/audio/music/bed.wav', path: '/p/bed.wav', at: 0, from: 0, to: 6, speed: 1, volume: 0.8, enabled: o.musicOn ?? true, role: 'music', facts: sound, fade: [1, 0] },
  ],
}, { title: 'Film', fps: 30, audio: 'clips', media: 'copy', mediaDir: '/drafts/Film/media' });

test('a 剪映 draft: microseconds edge by edge, the plan\'s tracks, bottom first, as 剪映 stacks them', () => {
  const { info, meta } = jianyingDraft(plan(), { name: 'Film', folder: '/drafts/Film', root: '/drafts', now: 1_700_000_000_000 });
  assert.deepEqual(info.canvas_config, { width: 1920, height: 1080, ratio: 'original' });
  assert.equal(info.fps, 30);
  assert.equal(info.duration, 6_000_000);
  assert.deepEqual(info.tracks.map((t) => t.type), ['video', 'video', 'audio']);
  /* the film's second track is under its first: 剪映's first video track is the bottom one */
  const [bottom, top] = info.tracks;
  assert.deepEqual(bottom.segments.map((s) => s.target_timerange), [{ start: 1_000_000, duration: 4_000_000 }, { start: 5_000_000, duration: 1_000_000 }]);
  assert.deepEqual(top.segments[0].target_timerange, { start: 0, duration: 2_000_000 });
  /* footage from its second 2 */
  assert.deepEqual(bottom.segments[0].source_timerange, { start: 2_000_000, duration: 4_000_000 });
  assert.equal(meta.draft_name, 'Film');
  assert.equal(meta.draft_fold_path, '/drafts/Film');
  assert.equal(meta.draft_root_path, '/drafts');
  assert.equal(meta.draft_id, info.id);
  assert.equal(meta.tm_duration, 6_000_000);
});

test('placement: fitted in the canvas, then the plan\'s scale; moved in half-canvas units, y upward', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const shot = info.tracks[0].segments[0];
  /* 960 × 540 at its own size is half of a 1920 × 1080 canvas it would fill: scale 0.5; its middle a quarter up */
  assert.deepEqual(shot.clip.scale, { x: 0.5, y: 0.5 });
  assert.deepEqual(shot.clip.transform, { x: 0, y: 0.5 });
  /* the page fills the canvas as it is */
  assert.deepEqual(info.tracks[1].segments[0].clip.scale, { x: 1, y: 1 });
  const still = info.tracks[0].segments[1];
  assert.equal(still.visible, false, 'a hidden track\'s clip comes hidden');
  const photo = info.materials.videos.find((m) => m.id === still.material_id);
  assert.equal(photo.type, 'photo');
  assert.deepEqual(still.source_timerange, { start: 0, duration: 1_000_000 });
});

test('footage plays its own sound at its level; other sounds are audio clips with 剪映\'s fades', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const shot = info.tracks[0].segments[0];
  assert.equal(shot.volume, 0.5);
  const audio = info.tracks.filter((t) => t.type === 'audio');
  assert.equal(audio.length, 1, 'the footage\'s sound is not a second clip');
  const bed = audio[0].segments[0];
  assert.equal(bed.volume, 0.8);
  const fade = info.materials.audio_fades.find((f) => bed.extra_material_refs.includes(f.id));
  assert.equal(fade.fade_in_duration, 1_000_000);
  assert.equal(fade.fade_out_duration, 0);
  for (const s of info.tracks.flatMap((t) => t.segments)) {
    assert.ok(s.extra_material_refs.some((id) => info.materials.speeds.some((m) => m.id === id)), 'each clip has its speed');
  }
  /* each file one material */
  assert.equal(new Set(info.materials.videos.map((m) => m.path)).size, info.materials.videos.length);
  const silent = jianyingDraft(plan({ musicOn: false }), { name: 'Film', folder: '/d/Film', root: '/d' });
  assert.equal(silent.info.tracks.find((t) => t.type === 'audio').segments[0].volume, 0, 'a sound not heard comes silent');
});

test('subtitles: a text track over all, one clip a cue, white with a dark edge, low in the picture', () => {
  const { info } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d', cues: [{ text: '你好 world', startMs: 500, durMs: 1500 }, { text: ' ', startMs: 2000, durMs: 500 }] });
  const text = info.tracks.at(-1);
  assert.equal(text.type, 'text');
  assert.equal(text.segments.length, 1, 'an empty cue is left out');
  assert.deepEqual(text.segments[0].target_timerange, { start: 500_000, duration: 1_500_000 });
  assert.equal(text.segments[0].clip.transform.y, -0.8);
  const content = JSON.parse(info.materials.texts[0].content);
  assert.equal(content.text, '你好 world');
  assert.deepEqual(content.styles[0].range, [0, 8]);
  assert.deepEqual(content.styles[0].strokes[0].content.solid.color, [0, 0, 0]);
});

test('the drafts folders: 剪映\'s and CapCut\'s, on a Mac and on Windows, when they are there', () => {
  const mac = (app) => join('/mac-home', 'Movies', app, 'User Data', 'Projects', 'com.lveditor.draft');
  assert.equal(draftsRoot('jianying', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('JianyingPro') }), mac('JianyingPro'));
  assert.equal(draftsRoot('capcut', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('CapCut') }), mac('CapCut'));
  assert.equal(draftsRoot('capcut', { platform: 'darwin', home: '/mac-home', exists: (p) => p === mac('JianyingPro') }), null);
  const win = win32.join('D:\\local-app-data', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
  assert.equal(draftsRoot('jianying', { platform: 'win32', home: 'D:\\win-home', localAppData: 'D:\\local-app-data', exists: (p) => p === win }), win);
  assert.equal(draftsRoot('jianying', { platform: 'linux', home: '/linux-home', exists: () => true }), null);
});

test('Windows draft detection reads the editor custom location and decodes QSettings paths', () => {
  const configured = 'D:\\剪映草稿\\My Drafts';
  const detected = draftsRoot('jianying', {
    platform: 'win32', home: 'C:\\Users\\Alice', localAppData: 'C:\\Users\\Alice\\AppData\\Local',
    readText: file => {
      assert.equal(file, 'C:\\Users\\Alice\\AppData\\Local\\JianyingPro\\User Data\\Config\\globalSetting');
      return String.raw`[General]
currentCustomDraftPath="D:\\\x526a\x6620\x8349\x7a3f\\My Drafts"
`;
    },
    exists: folder => folder === configured || folder.includes('com.lveditor.draft'),
  });
  assert.equal(detected, configured);
});

test('Windows draft detection safely falls back for missing, invalid and unavailable custom paths', () => {
  const fallback = 'C:\\Users\\Alice\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft';
  for (const content of ['', 'currentCustomDraftPath=relative/path', 'currentCustomDraftPath=D:/Disconnected/Drafts', 'currentCustomDraftPath=']) {
    assert.equal(draftsRoot('jianying', { platform: 'win32', home: 'C:\\Users\\Alice', readText: () => content, exists: folder => folder === fallback }), fallback);
  }
  assert.equal(draftsRoot('jianying', { platform: 'win32', home: 'C:\\Users\\Alice', readText: () => { throw new Error('unreadable'); }, exists: () => false }), null);
});

test('a draft says which app wrote it: 剪映 or CapCut', () => {
  const jy = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' }).info;
  const cc = jianyingDraft(plan(), { app: 'capcut', name: 'Film', folder: '/d/Film', root: '/d' }).info;
  assert.equal(jy.platform.app_source, 'lv');
  assert.equal(cc.platform.app_source, 'cc');
  assert.deepEqual(cc.last_modified_platform, cc.platform);
});

test('each file is in the draft\'s media library, once, and each material names its entry', () => {
  const { info, meta } = jianyingDraft(plan(), { name: 'Film', folder: '/d/Film', root: '/d' });
  const library = meta.draft_materials.find((g) => g.type === 0).value;
  const files = [...info.materials.videos, ...info.materials.audios];
  assert.equal(library.length, new Set(files.map((m) => m.path)).size, 'one entry a file');
  for (const m of files) {
    const entry = library.find((e) => e.id === m.local_material_id);
    assert.ok(entry, `${m.path} is in the library`);
    assert.equal(entry.file_Path, m.path);
  }
  const kinds = Object.fromEntries(library.map((e) => [e.file_Path.split('/').pop(), e.metetype]));
  assert.equal(kinds['bed fade.wav'], 'music', 'the bed, its fade its own part');
  assert.equal(kinds['b.png'], 'photo');
  assert.equal(Object.values(kinds).filter((k) => k === 'video').length, 2, 'the page rendered and the footage');
  const shot = library.find((e) => e.file_Path.endsWith('a.mp4'));
  assert.deepEqual([shot.width, shot.height, shot.duration], [960, 540, 10_000_000]);
});

test('portable drafts use media paths relative to the draft folder', () => {
  const { info, meta } = jianyingDraft(plan(), { name: 'Portable', folder: '/tmp/Portable', root: '/tmp', portable: true });
  const video = info.materials.videos[0];
  const audio = info.materials.audios[0];
  const library = meta.draft_materials.find((group) => group.type === 0).value;
  assert.match(video.path, /^##_draftpath_placeholder_[^/]+##\/Resources\/local\//);
  assert.match(audio.path, /^##_draftpath_placeholder_[^/]+##\/Resources\/local\//);
  assert.match(library[0].file_Path, /^\.\/Resources\/local\//);
  assert.equal(meta.draft_fold_path, '');
  assert.equal(meta.draft_root_path, '');
});

test('portable drafts resolve bundled fonts inside the relocated draft on Windows', () => {
  for (const folder of ['/home/lvcy/素材/未命名 2', 'C:\\Exports\\未命名']) {
    const fontPath = `${folder}/Resources/local/fonts/element-simhei.ttf`;
    const textPages = new Map([['title', { version: 1, width: 1080, height: 1920, duration: 2,
      texts: [{ text: '济南', x: 540, y: 235, fontSize: 59, fontFamily: 'SimHei', fontPath }] }]]);
    const options = { name: 'Portable fonts', folder, root: '/drafts', textPages };
    const { info } = jianyingDraft(plan(), { ...options, portable: true });
    const material = info.materials.texts[0];
    assert.equal(material.font_path, '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##/Resources/local/fonts/element-simhei.ttf');
    assert.equal(JSON.parse(material.content).styles[0].font.path, material.font_path);
    const absolute = jianyingDraft(plan(), options).info.materials.texts[0];
    assert.equal(absolute.font_path, fontPath, 'nonportable paths keep their original meaning');
    textPages.get('title').texts[0].fontPath = '/external/fonts/custom.ttf';
    assert.equal(jianyingDraft(plan(), { ...options, portable: true }).info.materials.texts[0].font_path,
      '/external/fonts/custom.ttf', 'external fonts are not falsely treated as packaged files');
  }
});

test('native font size follows canvas resolution and portrait/landscape rather than a fixed px divisor', () => {
  for (const [width, height, fontSize, nativeSize] of [
    [1080, 1920, 59, 8.740741], [1920, 1080, 59, 8.740741],
    [720, 1280, 59 * 2 / 3, 8.740741], [1280, 1920, 48, 6],
  ]) {
    const textPages = new Map([['title', { version: 1, width, height, duration: 2,
      texts: [{ text: '济南', x: width / 2, y: height / 2, fontSize,
        runs: [{ text: '济', fontSize: fontSize * 2 }, { text: '南' }] }] }]]);
    const { info } = jianyingDraft(plan(), { name: 'Font size', folder: '/drafts/font', root: '/drafts', textPages });
    const text = info.materials.texts[0], styles = JSON.parse(text.content).styles;
    assert.equal(text.font_size, nativeSize);
    assert.equal(styles[1].size, nativeSize);
    assert.ok(Math.abs(styles[0].size - nativeSize * 2) < 0.000002, 'rich text keeps the size ratio');
  }
});

test('absolute 14px outline exports to the provided Jianying reference strength for a 59px title', () => {
  const textPages = new Map([['title', { version: 1, width: 1080, height: 1920, duration: 2,
    texts: [{ text: '济南', x: 540, y: 235, fontSize: 59, stroke: { width: 14, color: '#000000' },
      runs: [{ text: '济' }, { text: '南', fontSize: 76 }] }] }]]);
  const { info } = jianyingDraft(plan(), { name: 'Outline', folder: '/drafts/outline', root: '/drafts', textPages });
  const text = info.materials.texts[0], styles = JSON.parse(text.content).styles;
  assert.equal(text.border_width, 0.59322);
  assert.equal(styles[0].strokes[0].width, 0.59322);
  assert.equal(styles[1].strokes[0].width, 0.460526);
  assert.equal(textPages.get('title').texts[0].stroke.width, 14, 'export keeps the absolute source width unchanged');
});

test('bundled FangTang and XinQingNian fonts carry catalog IDs in material and every rich-text range', () => {
  for (const [family, name, resourceId] of [
    ['WenYue FangTangTi (Authorization Required) J', '方糖体', '7037017159280628231'],
    ['WenYue XinQingNianTi (Authorization Required) W8-J', '新青年体', '6740435892441190919'],
    ['SimHei', 'SimHei', null],
  ]) {
    const textPages = new Map([['title', { version: 1, width: 1080, height: 1920, duration: 2,
      texts: [{ text: '红黄', x: 540, y: 200, fontSize: 76, fontFamily: family,
        fontPath: '/drafts/font/Resources/local/fonts/font.otf', runs: [{ text: '红', color: '#ff0000' }, { text: '黄', color: '#ffff00' }] }] }]]);
    for (const app of ['jianying', 'capcut']) {
      const { info } = jianyingDraft(plan(), { app, name: 'Fonts', folder: '/drafts/font', root: '/drafts', portable: true, textPages });
      const material = info.materials.texts[0];
      assert.equal(material.font_name, name);
      for (const range of JSON.parse(material.content).styles) {
        assert.equal(range.font.id, resourceId ?? '');
        assert.equal(range.font.path, material.font_path);
      }
      if (resourceId) {
        assert.equal(material.font_resource_id, resourceId);
        assert.equal(material.font_source_platform, 1);
        assert.equal(material.fonts[0].resource_id, resourceId);
        assert.equal(material.fonts[0].effect_id, resourceId);
        assert.equal(material.fonts[0].path, material.font_path);
        assert.equal(material.fonts[0].title, name);
      } else assert.equal(material.font_resource_id, undefined, 'system font gets no invented online ID');
    }
  }
});
