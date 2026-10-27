import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoFile, videoProjectRoot, videoRelativePath, VideoPolicyError } from './video-policy.mjs';


test('a renderer cannot start a video session in an unregistered, application or authentication directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'of-video-policy-'));
  const project = join(base, 'film'), app = join(base, 'app'), auth = join(base, 'auth');
  for (const dir of [project, app, auth]) mkdirSync(dir);
  assert.equal(videoProjectRoot(project, { projects: [project], protectedRoots: [app, auth] }), project);
  assert.throws(() => videoProjectRoot(project, { projects: [] }), VideoPolicyError);
  for (const path of [app, auth, base]) assert.throws(() => videoProjectRoot(path, { projects: [path], protectedRoots: [app, auth] }), VideoPolicyError);
});

test('portable media paths reject traversal, URLs, UNC paths, alternate streams and hidden files', () => {
  assert.equal(videoRelativePath('assets/upload/镜头 1.mp4'), 'assets/upload/镜头 1.mp4');
  for (const path of ['../secret', 'assets/../auth.json', '/secret', 'C:/auth.json', 'C:\\auth.json', '\\\\host\\share', 'https://host/x.mp4', 'assets/file.mp4:secret', 'assets/%2e%2e/secret', '.codex/auth.json', 'assets/.env', 'assets/NUL.mp4', 'assets/a. ', 'assets//a.mp4', 'assets/x\u200b.mp4']) assert.throws(() => videoRelativePath(path), VideoPolicyError, path);
});

test('read and write boundaries reject both symlinks and hard links', t => {
  const root = mkdtempSync(join(tmpdir(), 'of-video-links-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'one.mp4'), 'media');
  assert.equal(videoFile(root, 'assets/one.mp4'), join(root, 'assets', 'one.mp4'));
  assert.equal(videoFile(root, 'titles/new.html', { optional: true }), join(root, 'titles', 'new.html'));
  linkSync(join(root, 'assets', 'one.mp4'), join(root, 'assets', 'hard.mp4'));
  assert.throws(() => videoFile(root, 'assets/hard.mp4'), VideoPolicyError);
  try { symlinkSync(join(root, 'assets'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('symlink creation requires Windows permission'); return; } throw error; }
  assert.throws(() => videoFile(root, 'linked/new.mp4', { optional: true }), VideoPolicyError);
});
