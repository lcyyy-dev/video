// @ts-check
/** Node-only file access. Browser consumers use the bundled snapshot in text-styles.mjs. */
import { readFileSync } from 'node:fs';
import { sampleTextStyle, getTextElementLibrary } from './text-styles.mjs';

/** @param {string | URL} [file] @returns {ReturnType<typeof getTextElementLibrary>} */
export function readTextElementLibrary(file = new URL('./text-elements.json', import.meta.url)) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Re-read saved weights on each server/CLI generation, without restarting the process.
 * @param {string | number} [seed] @param {string | URL} [file] */
export function sampleCurrentTextStyle(seed, file) {
  return sampleTextStyle(seed === undefined ? undefined : String(seed), readTextElementLibrary(file).weights);
}
