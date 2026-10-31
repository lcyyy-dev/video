import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTextPage } from './text-page-edits.mjs';
import { editProjectFilm } from './film.mjs';
import { filmHtml } from '../../src/film-doc.mjs';
const page = { version: 1, width: 1080, height: 1920, duration: 5,
  texts: [{ text: '这个生成效果怎么样', x: 540, y: 235, width: 1000, fontSize: 76, lineHeight: 1.22 }] };
const at = '[data-openfilm-text-index="0"][data-openfilm-text-base-width="1000"][data-openfilm-text-base-height="93"]';
test('drag and box resize write absolute JSON layout and retain glyph size', () => {
  const result = editTextPage(page, [{ at, t: [0,136.9], s: [1.131,1.1828] }]);
  assert.equal(result.texts[0].x, 540);
  assert.equal(result.texts[0].y, 371.9);
  assert.equal(result.texts[0].width, 1131);
  assert.ok(Math.abs(result.texts[0].height - 110.0004) < .00001);
  assert.equal(result.texts[0].fontSize, 76);
  assert.equal(page.texts[0].y, 235);
});
test('JSON edits use stable indexes, update text/style and reject unsupported effects', () => {
  const source = { ...page, texts: [page.texts[0], { ...page.texts[0], text: '第二段' }] };
  const result = editTextPage(source, [{ at: '[data-openfilm-text-index="1"]', text: '修改后', style: { fontSize: '59px', color: '#ff0000' } }]);
  assert.equal(result.texts[0].text, page.texts[0].text);
  assert.equal(result.texts[1].text, '修改后');
  assert.equal(result.texts[1].fontSize, 59);
  assert.throws(() => editTextPage(page, [{ at, style: { filter: 'blur(5px)' } }]));
});
test('film edits store JSON revisions, clear DOM overrides, preserve shared sources and allow undo by source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'text-edits-'));
  writeFileSync(join(root, 'title.text.json'), JSON.stringify(page));
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 1080, h: 1920 }, tracks: [{ clips: [
    { id: 'one', src: 'title.text.json' }, { id: 'two', src: 'title.text.json', at: 5 },
  ] }] }));
  const edited = await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'one', prop: 'overrides', value: [{ at, t: [20,30] }] }] }]);
  const one = edited.doc.tracks[0].clips[0];
  assert.notEqual(one.src, 'title.text.json');
  assert.equal(one.overrides, undefined);
  assert.equal(edited.doc.tracks[0].clips[1].src, 'title.text.json');
  assert.equal(JSON.parse(readFileSync(join(root, one.src))).texts[0].x, 560);
  assert.equal(JSON.parse(readFileSync(join(root, 'title.text.json'))).texts[0].x, 540);
  const undone = await editProjectFilm(root, edited.rev, [{ op: 'props', edits: [{ clip: 'one', prop: 'src', value: 'title.text.json' }] }]);
  assert.equal(undone.doc.tracks[0].clips[0].src, 'title.text.json');
});
