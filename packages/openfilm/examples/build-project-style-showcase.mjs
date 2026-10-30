import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { listTextStyles, applyTextStyle } from '../src/text-styles.mjs';
import { textPageHtml } from '../src/text-page.mjs';
import manifest from '../src/text-fonts.json' with { type: 'json' };
import { bundledTextFonts } from '../studio/server/text-fonts.mjs';

const project = resolve(process.argv[2] ?? '/home/lvcy/Movies/OpenFilm Dev/Projects/未命名');
const titles = join(project, 'titles');
const fontDir = join(project, 'assets', 'fonts');
const styleSeconds = 1.5;
const repeats = 3;
const sourceShots = [
  { id: 'training-1', video: 'assets/preview/IMG_2143.mp4', audio: 'assets/IMG_2143(1).MOV', from: 3, to: 6, reason: '同步示范动作' },
  { id: 'training-2', video: 'assets/preview/IMG_2147.mp4', audio: 'assets/IMG_2147.MOV', from: 2, to: 5, reason: '近景观察起跳与落地' },
  { id: 'training-3', video: 'assets/preview/IMG_2149.mp4', audio: 'assets/IMG_2149.MOV', from: 6, to: 9, reason: '脚步和反应训练' },
  { id: 'training-4', video: 'assets/preview/IMG_2150.mp4', audio: 'assets/IMG_2150.MOV', from: 3, to: 6, reason: '侧面观察动作' },
  { id: 'training-5', video: 'assets/preview/IMG_2148.mp4', audio: 'assets/IMG_2148.MOV', from: 3, to: 6, reason: '连续跳跃收尾' },
];

const backup = (file) => {
  const copy = `${file}.original`;
  if (!existsSync(copy) && existsSync(file)) copyFileSync(file, copy);
};
backup(join(project, 'film.html'));
backup(join(project, 'ad-plan.json'));
backup(join(titles, 'compact-style.html'));
mkdirSync(titles, { recursive: true });
mkdirSync(fontDir, { recursive: true });

const packaged = bundledTextFonts();
for (const font of packaged) copyFileSync(font.path, join(fontDir, font.file));
const fontCssFor = (families) => packaged.filter((font) => families.includes(font.family)).map((font) => {
  const mime = font.file.endsWith('.ttc') ? 'collection' : font.file.endsWith('.otf') ? 'otf' : 'ttf';
  const src = `../assets/fonts/${font.file}`;
  return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(src)}) format(${JSON.stringify(font.format)});font-weight:400;font-style:normal;font-display:block;}`;
}).join('\n');

const styles = listTextStyles();
const pages = styles.map((preset, index) => {
  const label = `${String(index + 1).padStart(2, '0')}·${preset.name}`;
  const item = applyTextStyle({ text: label, x: 540, y: 960, width: 900, align: 'center', lineHeight: 1.12, fontSize: 64 }, preset);
  const page = { version: 1, width: 1080, height: 1920, duration: styleSeconds, texts: [item] };
  const file = `style-${String(index + 1).padStart(2, '0')}.html`;
  const families = item.fontFamily && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(item.fontFamily)
    ? [item.fontFamily] : [];
  writeFileSync(join(titles, file), textPageHtml(page, { fontCss: fontCssFor(families) }));
  return { preset, item, page, file, id: `style-${String(index + 1).padStart(2, '0')}` };
});

const filmText = pages.map(({ id, file }, index) =>
  `  <iframe id="${id}" src="titles/${file}#t=0,${styleSeconds}" at="${(index * styleSeconds).toFixed(2)}"></iframe>`).join('\n');
const footage = [];
const audio = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  const offset = repeat * sourceShots.length * 3;
  for (const [index, shot] of sourceShots.entries()) {
    const at = offset + index * 3;
    const suffix = `${repeat + 1}-${index + 1}`;
    footage.push(`  <video id="${shot.id}-${suffix}" src="${shot.video}#t=${shot.from},${shot.to}" at="${at}" muted style="left:0px;top:0px;width:1080px;height:1920px;object-fit:contain"></video>`);
    audio.push(`  <audio id="source-sound-${shot.id}-${suffix}" src="${shot.audio}#t=${shot.from},${shot.to}" at="${at}" volume="1"></audio>`);
  }
}
const film = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080, height=1920"><title>OpenFilm 样式库 30 种剪映兼容性测试</title></head><body>
<section id="text-style-showcase">
${filmText}
</section>
<section id="footage">
${footage.join('\n')}
</section>
<section id="original-sound">
${audio.join('\n')}
</section>
</body></html>
`;
writeFileSync(join(project, 'film.html'), film);

const total = styles.length * styleSeconds;
const plan = {
  version: 1,
  workflow: { id: 'ad-editing', version: '0.1.0' },
  brief: {
    copy: 'OpenFilm 样式库 30 种剪映兼容性测试', width: 1080, height: 1920, fps: null,
    formatReason: '保留未命名项目的 1080×1920 竖屏画布；本次为样式库展示测试片，不是原广告成片。',
    targetSeconds: total, exactDuration: true, deliverables: ['project'], preferredExportFps: 60,
    title: 'OpenFilm 样式库 30 种剪映兼容性测试', mode: '原声 · 无朗读',
  },
  media: sourceShots.map((shot, index) => ({ id: `v0${index + 1}`, src: shot.audio, candidates: [{ from: shot.from, to: shot.to, action: shot.reason }] })),
  shots: Array.from({ length: repeats }, (_, repeat) => sourceShots.map((shot, index) => ({
    id: `${shot.id}-${repeat + 1}`, src: shot.video, original: shot.audio, from: shot.from, to: shot.to,
    start: repeat * 15 + index * 3, end: repeat * 15 + index * 3 + 3, speed: 1, reason: `${shot.reason}（第${repeat + 1}轮）`,
  }))).flat(),
  sentences: pages.map(({ id, file, preset }, index) => ({
    id, displayText: `${String(index + 1).padStart(2, '0')}·${preset.name}`, voice: null,
    timeline: { start: index * styleSeconds, end: (index + 1) * styleSeconds },
    textPage: `titles/${file}`, textItem: 1, presetId: preset.id, presetVersion: preset.version,
    status: 'ready', locked: false,
  })),
  textPages: pages.map(({ id, file, preset, page }) => ({ id, src: `titles/${file}`, start: 0, end: styleSeconds,
    presetId: preset.id, presetVersion: preset.version, data: page })),
  outputs: [{ path: 'film.html', kind: 'project', duration: total, status: 'pending-check', checks: {
    nativeText: '待导出剪映草稿后检查', presets: styles.length, renderedFallbacksExpected: 0,
  } }],
  limitations: [
    '这是 30 种文字样式的兼容性测试展示片，已保留原项目文件为 film.html.original、ad-plan.json.original 和 titles/compact-style.html.original。',
    '样式库只使用剪映原生文字字段；没有加入 HTML 背景框、圆角标签或其他渲染回退效果。',
  ],
  styleChecks: { source: 'packages/openfilm/src/text-styles.json', presets: styles.length, nativeExportCandidates: styles.length,
    selection: '每个片段都由 text-styles.json 的 presetId 生成，未随机拼接外观参数。' },
};
writeFileSync(join(project, 'ad-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
writeFileSync(join(project, 'STYLE-LIBRARY-TEST.zh-CN.md'), `# 样式库 30 种剪映兼容性测试\n\n当前 film.html 已替换为 30 个连续文字片段，每个片段对应一个样式库预设，单片段 ${styleSeconds} 秒，总时长 ${total} 秒。视频和原声音轨重复三轮，仅用于在 Studio 中查看和导出剪映草稿。\n\n原始工程已备份：\n\n- film.html.original\n- ad-plan.json.original\n- titles/compact-style.html.original\n\n导出剪映草稿后，检查 native-text-report.json，预期 30 个文字页面均为 native，且没有文字视频素材。\n`);
console.log(JSON.stringify({ project, presets: styles.length, styleSeconds, duration: total, backup: true }, null, 2));
