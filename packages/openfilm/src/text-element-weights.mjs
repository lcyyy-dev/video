// @ts-check
/** @param {number[]} weights @param {unknown} seed */
export function weightedElementIndex(weights, seed) {
  if (!weights.length || weights.some(weight => !Number.isFinite(weight) || weight < 0)) throw new Error('元素权重必须是有限的非负数');
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('每个元素库至少需要一个大于 0 的权重');
  let hash = 2166136261;
  for (const char of String(seed)) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  let target = (hash >>> 0) / 4294967296 * total;
  for (let index = 0; index < weights.length; index++) {
    if (target < weights[index]) return index;
    target -= weights[index];
  }
  return weights.findLastIndex(weight => weight > 0);
}

/** Relative luminance contrast; 3:1 keeps fill and outline visibly distinct.
 * @param {string} first @param {string} second */
export function textColorContrast(first, second) {
  /** @param {string} color */
  const luminance = color => {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('文字颜色必须为六位十六进制色值');
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** @param {string[]} colors @param {{color: string, width: number}[]} strokes
 * @param {Record<string, number>} colorWeights @param {Record<string, number>} strokeWeights */
export function contrastingTextPairs(colors, strokes, colorWeights, strokeWeights) {
  weightedElementIndex(colors.map(color => colorWeights[color] ?? 1), 'validate');
  weightedElementIndex(strokes.map(stroke => strokeWeights[`${stroke.color}:${stroke.width}`] ?? 1), 'validate');
  const pairs = colors.flatMap(color => strokes.map(stroke => ({ color, stroke,
    weight: (colorWeights[color] ?? 1) * (strokeWeights[`${stroke.color}:${stroke.width}`] ?? 1),
  }))).filter(pair => pair.weight > 0 && textColorContrast(pair.color, pair.stroke.color) >= 3);
  if (!pairs.length) throw new Error('当前权重没有可用的文字与描边组合，请启用对比更明显的颜色（至少 3:1）');
  weightedElementIndex(pairs.map(pair => pair.weight), 'validate');
  return pairs;
}
