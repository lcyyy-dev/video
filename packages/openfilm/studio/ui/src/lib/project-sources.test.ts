import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathCrumbs } from './project-sources.ts';

test('breadcrumbs from the home folder, on macOS, Linux and Windows paths', () => {
  assert.deepEqual(pathCrumbs('/Volumes/work/Movies/Films', '/Volumes/work'), [
    { name: '~', path: '/Volumes/work' }, { name: 'Movies', path: '/Volumes/work/Movies' }, { name: 'Films', path: '/Volumes/work/Movies/Films' },
  ]);
  assert.deepEqual(pathCrumbs('/srv/me', '/srv/me', 'me'), [{ name: 'me', path: '/srv/me' }]);
  assert.deepEqual(pathCrumbs('D:\\work\\Videos', 'D:\\work').map((c) => c.path), ['D:\\work', 'D:\\work\\Videos']);
  /* a folder beside the root that starts with its name is not in it */
  assert.deepEqual(pathCrumbs('/Volumes/work/Films-old/x', '/Volumes/work/Films'), [{ name: '/Volumes/work/Films-old/x', path: '/Volumes/work/Films-old/x' }]);
});
