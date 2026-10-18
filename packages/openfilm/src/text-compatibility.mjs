// @ts-check
import compatibility from './text-style-compatibility.json' with { type: 'json' };

/** A machine-readable snapshot for agents; compatibility claims stay separate from visual certification. */
export function getTextStyleCompatibility() {
  return structuredClone(compatibility);
}

/**
 * Used by the real draft export path. Conditions are evaluated in code; the JSON contains ordered rule IDs and
 * reasons, never executable expressions. Invalid structured data is still rejected by the text page validator.
 * @param {import('./text-page.mjs').TextPage} page
 * @param {{ canvas: { width: number, height: number }, hasElementOverrides?: boolean, hasClipOverrides?: boolean }} context
 * @returns {string | null}
 */
export function nativeTextFallbackReason(page, context) {
  /** @type {Record<string, boolean>} */
  const flags = {
    hasElementOverrides: Boolean(context.hasElementOverrides),
    hasClipOverrides: Boolean(context.hasClipOverrides),
    canvasMismatch: page.width !== context.canvas.width || page.height !== context.canvas.height,
    hasOpacityKeyframes: page.texts.some((item) => Boolean(item.keyframes?.opacity)),
  };
  for (const rule of compatibility.nativeFallbackRules) {
    if (typeof flags[rule.check] !== 'boolean') throw new Error(`Unknown native text condition: ${rule.check}`);
    if (flags[rule.check]) return rule.reason;
  }
  return null;
}
