import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { filmHtml, readFilmFile } from 'openfilm/film-doc';
import { readTextPage } from 'openfilm/text-page';
import { VideoExecutor } from './video-executor.mjs';
import { validateVideoPlan } from './video-plan.mjs';

const ffmpegDir = process.env.OPENFILM_TEST_FFMPEG_DIR;
const media = { skip: !ffmpegDir, timeout: 30_000 };
const rootOf = () => {
  const root = mkdtempSync(join(tmpdir(), 'of-video-exec-')); mkdirSync(join(root, 'assets'));
  execFileSync(join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'assets', 'footage.mp4')]);
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [] }));
  return root;
};
const clip = (assetId, rest = {}) => ({ id: 'shot-one', assetId, text: null, start: 0, end: 2, at: 0, speed: 1, volume: 0, muted: true, box: null, ...rest });
const planOf = assetId => ({ status: 'edit', message: 'A video edit', export: 'none', film: { stage: { w: 320, h: 180, fps: 24 }, tracks: [
  { id: 'track-one', locked: false, hidden: false, muted: false, clips: [clip(assetId)] },
  { id: 'track-two', locked: false, hidden: false, muted: false, clips: [clip(null, { id: 'title-one', volume: 1, muted: false, text: { text: '安全剪辑', x: 160, y: 30, width: 280, fontSize: 24, color: '#ffffff', bold: true, align: 'center' } })] },
] } });

test('a playlist renamed as footage cannot follow external file references', media, async () => {
  const root = rootOf(), outside = rootOf();
  writeFileSync(join(root, 'assets', 'playlist.mp4'), `ffconcat version 1.0\nfile '${join(outside, 'assets', 'footage.mp4')}'\n`);
  const executor = new VideoExecutor({ root, ffmpegDir });
  await assert.rejects(executor.inspect('assets/playlist.mp4'), /素材无法安全解析/);
});

test('real media inspection, frame sampling and native two-track editing work without a command tool', media, async () => {
  const root = rootOf();
  const executor = new VideoExecutor({ root, ffmpegDir });
  const snapshot = await executor.snapshot();
  assert.equal(snapshot.assets[0].duration, 2); assert.equal(snapshot.assets[0].fps, 24);
  assert.equal((await executor.frames()).length, 2);
  const result = await executor.apply(planOf(snapshot.assets[0].id));
  assert.equal(result.clips, 2); assert.equal(result.tracks, 2);
  const film = readFilmFile(readFileSync(join(root, 'film.html'), 'utf8'));
  assert.ok(film.doc, film.problems?.join('\n'));
  assert.equal(film.value.tracks[0].clips[0].volume, 0);
  const page = readTextPage(readFileSync(join(root, film.value.tracks[1].clips[0].src), 'utf8'));
  assert.equal(page.texts[0].text, '安全剪辑');
  const next = await executor.snapshot();
  const changed = { status: 'edit', message: '', export: 'none', film: structuredClone(next.film) };
  changed.film.tracks[1].clips[0].text.color = '#ff0000';
  await executor.apply(changed);
  const revised = readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value;
  assert.equal(readTextPage(readFileSync(join(root, revised.tracks[1].clips[0].src), 'utf8')).texts[0].color, '#ff0000');
  assert.equal(revised.tracks[0].clips[0].src, 'assets/footage.mp4');
});

test('forged assets, raw code, extra file/command fields and invalid edits cannot write any film', media, async () => {
  const root = rootOf(), executor = new VideoExecutor({ root, ffmpegDir });
  const snapshot = await executor.snapshot();const valid = planOf(snapshot.assets[0].id);
  const before = readFileSync(join(root, 'film.html'), 'utf8');
  const attacks = [
    plan => { plan.command = 'read credentials'; },
    plan => { plan.outputPath = '../../app.asar'; },
    plan => { plan.film.tracks[0].clips[0].assetId = '../../.codex/auth.json'; },
    plan => { plan.film.tracks[1].clips[0].text.html = '<script>fetch("/secrets")</script>'; },
    plan => { plan.film.tracks[1].clips[0].text.fontPath = '../../auth.json'; },
    plan => { plan.film.tracks[0].clips[0].end = 3; },
    plan => { plan.film.tracks[0].clips[0].speed = Infinity; },
  ];
  for (const attack of attacks) { const plan = structuredClone(valid);attack(plan);await assert.rejects(executor.apply(plan));assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), before); }
  assert.deepEqual(readdirSync(root).sort(), ['.film', 'assets', 'film.html']);
  const literal = structuredClone(valid);literal.film.tracks[1].clips[0].text.text = '</script><script>unsafe()</script>';
  await executor.apply(literal);
  const film = readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value;
  const html = readFileSync(join(root, film.tracks[1].clips[0].src), 'utf8');
  assert.doesNotMatch(html, /<script>unsafe\(\)<\/script>/);
  assert.equal(readTextPage(html).texts[0].text, literal.film.tracks[1].clips[0].text.text);
});

test('manual revisions, locked tracks and locked clips cannot be silently replaced', media, async () => {
  const root = rootOf(), executor = new VideoExecutor({ root, ffmpegDir });
  const snapshot = await executor.snapshot();const plan = planOf(snapshot.assets[0].id);
  writeFileSync(join(root, 'film.html'), readFileSync(join(root, 'film.html'), 'utf8')+'\n<!-- manual revision -->');
  await assert.rejects(executor.apply(plan), /手工修改/);
  const locked = structuredClone(plan.film); locked.tracks[0].locked = true;
  const snapshotLocked = { assets: snapshot.assets, film: locked };
  const edited = { ...structuredClone(plan), film: structuredClone(locked) };edited.film.tracks[0].clips[0].at = 1;
  assert.throws(() => validateVideoPlan(edited, snapshotLocked), /锁定轨道/);
  const clipLocked = { assets: snapshot.assets, film: plan.film, lockedClipIds: ['shot-one'] };
  assert.throws(() => validateVideoPlan(edited, clipLocked), /锁定片段/);
});
