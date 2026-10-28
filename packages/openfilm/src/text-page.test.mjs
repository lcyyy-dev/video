import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTextPage, textPageHtml, textStyleRuns, textValueAt, validateTextPage } from './text-page.mjs';

const page = { version: 1, width: 1080, height: 1920, duration: 4,
  texts: [{ text: '文字 </script> 😀', x: 540, y: 300, fontSize: 80, color: '#d5ff60' }] };

test('structured text round trips as data, including HTML and Unicode', () => {
  const html = textPageHtml(page);
  assert.deepEqual(readTextPage(html), page);
  assert.ok(!html.includes('文字 </script>'));
  assert.equal(readTextPage('<h1>Arbitrary HTML</h1>'), null);
});

test('invalid styles and keyframes fail explicitly instead of losing information', () => {
  for (const change of [{ color: 'red' }, { shadow: true }, { x: NaN },
    { stroke: { color: '#ffffff', width: 2, glow: true } }, { keyframes: 1 },
    { keyframes: { rotation: [{ time: 0, value: 1 }] } },
    { keyframes: { x: [{ time: 1, value: 1 }, { time: 0, value: 2 }] } }]) {
    assert.throws(() => validateTextPage({ ...page, texts: [{ ...page.texts[0], ...change }] }));
  }
  assert.equal(textValueAt([{ time: 0, value: 100 }, { time: 2, value: 200 }], 1), 150);
  assert.equal(textValueAt([{ time: 0, value: 100 }, { time: 2, value: 200 }], 3), 200);
});

test('rich text runs inherit defaults and cover the complete text, including newlines', () => {
  const item = { text: '黄标题\n白说明\n红重点', x: 540, y: 240, fontSize: 80, bold: true,
    runs: [{ text: '黄标题\n', color: '#ffe21f' }, { text: '白说明\n', color: '#ffffff', fontSize: 64 },
      { text: '红重点', color: '#ff344d', stroke: { color: '#ffffff', width: 6 } }] };
  const input = { ...page, texts: [item] };
  assert.deepEqual(readTextPage(textPageHtml(input)), input);
  assert.deepEqual(textStyleRuns(item).map((run) => run.range), [[0, 4], [4, 8], [8, 11]]);
  assert.ok(textStyleRuns(item).every((run) => run.bold));
  assert.throws(() => validateTextPage({ ...input, texts: [{ ...item, runs: [{ text: '漏掉内容' }] }] }), /cover exactly/);
  assert.deepEqual(textStyleRuns({ ...item, text: '火🔥热身', runs: [{ text: '火🔥' }, { text: '热身' }] }).map((r) => r.range), [[0, 3], [3, 5]]);
});

test('empty rich text fragments do not block reading or create empty draft style ranges', () => {
  const item = { ...page.texts[0], text: '火🔥\n热身', runs: [
    { text: '', color: '#ffffff' }, { text: '火🔥\n', color: '#FFEA00' },
    { text: '' }, { text: '热身' }, { text: '', bold: true },
  ] };
  const parsed = readTextPage(textPageHtml({ ...page, texts: [item] }));
  assert.deepEqual(textStyleRuns(parsed.texts[0]).map((run) => [run.text, run.range]), [
    ['火🔥\n', [0, 4]], ['热身', [4, 6]],
  ]);
  assert.throws(() => validateTextPage({ ...page, texts: [{ ...item,
    runs: [...item.runs, { text: '', color: 'invalid' }],
  }] }), /Invalid text run style/);
});
