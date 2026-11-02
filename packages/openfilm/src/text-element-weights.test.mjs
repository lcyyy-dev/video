import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedElementIndex, textColorContrast, contrastingTextPairs } from './text-element-weights.mjs';
import { getTextElementLibrary, sampleTextStyle } from './text-styles.mjs';
test('weights exclude disabled entries, reproduce seeds and reject invalid pools', () => {
  for (let i = 0; i < 100; i++) assert.equal(weightedElementIndex([0, 7, 0], i), 1);
  assert.equal(weightedElementIndex([1, 3], 'same'), weightedElementIndex([1, 3], 'same'));
  for (const values of [[], [0, 0], [-1, 2], [NaN, 1], [Infinity], [Number.MAX_VALUE, Number.MAX_VALUE]]) assert.throws(() => weightedElementIndex(values, 'test'));
  let selected = 0;
  for (let i = 0; i < 20000; i++) selected += weightedElementIndex([1, 3], `distribution-${i}`);
  assert.ok(selected / 20000 > 0.72 && selected / 20000 < 0.78);
});
test('the production sampler uses each configured pool weight', () => {
  const library = getTextElementLibrary();
  const weights = library.weights;
  for (const pool of Object.values(weights)) Object.keys(pool).forEach((key, index) => { pool[key] = index === 0 ? 1 : 0; });
  for (let i = 0; i < 30; i++) {
    const style = sampleTextStyle(i, weights).style;
    assert.equal(style.fontFamily, library.elements.fonts[0].family);
    assert.equal(style.color, library.elements.colors[0]);
    assert.deepEqual(style.stroke, library.elements.strokes[0]);
  }
});

test('automatic styles never pair similar fill and outline colors', () => {
  assert.equal(textColorContrast('#FFFFFF', '#000000'), 21);
  assert.ok(textColorContrast('#F55757', '#E63946') < 3);
  assert.ok(textColorContrast('#3B82F6', '#2563EB') < 3);
  for (let i = 0; i < 2000; i++) {
    const style = sampleTextStyle(`contrast-${i}`).style;
    assert.ok(textColorContrast(style.color, style.stroke.color) >= 3);
  }
  assert.throws(() => contrastingTextPairs(['#F55757'], [{color:'#E63946',width:14}], {}, {}), /没有可用/);
  const pairs = contrastingTextPairs(['#FFFFFF', '#FFFAFA'], [{color:'#000000',width:14}], {'#FFFFFF':1,'#FFFAFA':3}, {'#000000:14':2});
  assert.deepEqual(pairs.map(pair => pair.weight), [2,6]);
});
