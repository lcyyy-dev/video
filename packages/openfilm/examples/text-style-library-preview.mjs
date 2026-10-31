import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { listTextStyles } from '../src/text-styles.mjs';
import { textPageJson } from '../src/text-page.mjs';
import { bundledTextFonts } from '../studio/server/text-fonts.mjs';

const output = resolve(process.argv[2] ?? 'packages/openfilm/examples/text-style-library-preview.html');
const styles = listTextStyles();
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const families = [...new Set(styles.map((preset) => preset.style.fontFamily).filter((family) => family && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(family)))];
const fonts = bundledTextFonts().filter((font) => families.includes(font.family));
const fontCss = fonts.map((font) => {
  const mime = font.file.endsWith('.ttc') ? 'collection' : font.file.endsWith('.otf') ? 'otf' : 'ttf';
  const url = relative(dirname(output), font.path).split('\\').join('/');
  return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(url)}) format(${JSON.stringify(font.format)});font-weight:400;font-style:normal;font-display:block;}`;
}).join('\n');

const cards = styles.map((preset, index) => {
  const page = { version: 1, width: 640, height: 220, duration: 2, texts: [{
    text: index % 3 === 0 ? '专业训练·看见变化' : index % 3 === 1 ? '每天进步一点点' : '济南体适能训练',
    x: 320, y: 112, width: 570, align: 'center', ...preset.style,
  }] };
  const json = textPageJson(page, { fontCss });
  return `<article class="card"><div class="meta"><strong>${index + 1}. ${esc(preset.name)}</strong><code>${esc(preset.id)}</code></div><pre>${esc(json)}</pre><p>${esc(preset.description)}</p></article>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>OpenFilm 30 native text styles</title><style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#080d16;color:#e9eef7}
body{margin:0;padding:28px;background:radial-gradient(circle at 50% -10%,#20314a 0,#080d16 48%);min-height:100vh}
h1{margin:0 0 8px;font-size:28px} .intro{color:#aab7ca;margin:0 0 22px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;max-width:1200px;margin:auto}
.card{background:#121a27;border:1px solid #263650;border-radius:14px;padding:12px;box-shadow:0 10px 30px #0004}
.meta{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin:2px 2px 8px}.meta strong{font-size:15px}.meta code{color:#7f91ac;font-size:11px}
iframe{display:block;width:100%;height:220px;border:0;border-radius:9px;background:#111827}
.card p{color:#aab7ca;font-size:12px;line-height:1.5;margin:9px 2px 2px;min-height:36px}
</style><body><main><h1>OpenFilm · 30 种剪映原生文字样式</h1><p class="intro">每张卡片内部都是 <code>openfilm-text</code> 结构化页面，只使用字体、颜色、描边和阴影等原生字段。没有背景框、圆角标签或其他会触发渲染回退的属性。</p><section class="grid">${cards}</section></main></body>`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, { flag: 'w' });
console.log(JSON.stringify({ output, styles: styles.length }, null, 2));
