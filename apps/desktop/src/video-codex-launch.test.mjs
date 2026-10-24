import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoCodexLaunchEnv } from './video-codex-launch.mjs';

test('packaged Electron is re-enabled as Node after the adapter clears its environment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'of-video-launch-'));
  for (const windows of [true, false]) {
    const env = videoCodexLaunchEnv('C:/安装 %data%/codex.exe', { directory, nodeCommand: 'C:/安装 %data%/OpenFilm.exe', nodeArgs: ['C:/安装/as-node.mjs'], windows });
    const script = readFileSync(env.CODEX_PATH, 'utf8');
    assert.match(script, /ELECTRON_RUN_AS_NODE=1/);
    assert.equal(env.OPENFILM_VIDEO_REAL_CODEX, 'C:/安装 %data%/codex.exe');
    if (windows) {
      assert.doesNotMatch(script, /C:\//);
      assert.match(script, /"%OPENFILM_VIDEO_NODE%" "%OPENFILM_VIDEO_BOOTSTRAP%"/);
    } else assert.match(script, /exec 'C:\/安装 %data%\/OpenFilm.exe'/);
  }
});
