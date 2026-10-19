// @ts-check
/** Project-owned font files: no machine font installation or Jianying cache is required. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import manifest from '../../src/text-fonts.json' with { type: 'json' };

export function bundledTextFonts() {
  return manifest.fonts.map((font) => ({ ...font, path: fileURLToPath(new URL(`../../fonts/${font.file}`, import.meta.url)) }));
}

/** @param {string | undefined} family */
export function bundledTextFont(family) {
  return bundledTextFonts().find((font) => font.family === family);
}

/** @param {string[]} families @param {boolean} [embed] */
export function textFontCss(families, embed = false) {
  return bundledTextFonts().filter((font) => families.includes(font.family)).map((font) => {
    const mime = font.file.endsWith('.ttc') ? 'collection' : font.file.endsWith('.otf') ? 'otf' : 'ttf';
    const url = embed ? `data:font/${mime};base64,${readFileSync(font.path).toString('base64')}`
      : `/api/text-styles/fonts/${font.id}`;
    return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(url)}) format(${JSON.stringify(font.format)});font-weight:400;font-style:normal;font-display:block;}`;
  }).join('\n');
}
