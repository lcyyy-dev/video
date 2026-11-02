import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getTextElementLibrary } from './text-styles.mjs';
import { readTextElementLibrary, sampleCurrentTextStyle } from './text-elements-node.mjs';

test('Node generation reads updated weights on every call while shared library stays browser-safe', () => {
  const dir=mkdtempSync(join(tmpdir(),'text-weight-refresh-')),file=join(dir,'elements.json');
  const bundled=getTextElementLibrary(),library=structuredClone(bundled);
  try {
    for(const selected of library.elements.fonts){
      for(const font of library.elements.fonts)library.weights.fonts[font.id]=font.id===selected.id?1:0;
      writeFileSync(file,JSON.stringify(library));
      assert.deepEqual(readTextElementLibrary(file).weights,library.weights);
      for(let seed=0;seed<10;seed++)assert.equal(sampleCurrentTextStyle(seed,file).style.fontFamily,selected.family);
    }
    assert.deepEqual(getTextElementLibrary(),bundled,'file overrides never mutate the browser snapshot');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
