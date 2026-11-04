import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml, readFilmFile } from 'openfilm/film-doc';
import { textPageJson, readTextPageJson, readLegacyTextPage } from 'openfilm/text-page';
import { bundledTextFonts, textFontCss } from 'openfilm/text-fonts';
import { installOpenfilmCommand } from './openfilm-command.mjs';
import { registerLocalAgentIpc } from './local-agents-ipc.mjs';

const dataDir = process.env.OPENFILM_TEST_DATA_DIR;
const ffmpegDir = process.env.OPENFILM_TEST_FFMPEG_DIR;
const readTextPage = source => readTextPageJson(source) ?? readLegacyTextPage(source);

test('desktop IPC → native Codex: chat, style edits, narration removal, resume and project sandbox', { skip: !dataDir || !ffmpegDir, timeout: 420_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'of-native-film-'));
  const runtime = mkdtempSync(join(tmpdir(), 'of-native-command-'));
  mkdirSync(join(root, 'titles')); mkdirSync(join(root, 'assets', 'upload'), { recursive: true }); mkdirSync(join(root, 'assets', 'audio', 'vo'), { recursive: true });
  const binary = name => join(ffmpegDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  execFileSync(binary('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'assets/upload/source.mp4')]);
  execFileSync(binary('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', join(root, 'assets/audio/vo/voice.wav')]);
  const font = bundledTextFonts()[0];
  writeFileSync(join(root, 'titles/title.text.json'), textPageJson({ version: 1, width: 320, height: 180, duration: 1.9, texts: [{ text: '测试标题', x: 160, y: 45, fontSize: 32, color: '#ffff00', backgroundOpacity: 0.7, backgroundColor: '#000000', fontFamily: font.family, fontPath: `openfilm-font:${font.id}` }] }, { fontCss: textFontCss([font.family], true) }));
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ id: 'title', src: 'titles/title.text.json', time: [0, 1.9] }] },
    { clips: [{ id: 'shot', src: 'assets/upload/source.mp4', time: [0, 1.9], volume: 0 }] },
    { clips: [{ id: 'voice', src: 'assets/audio/vo/voice.wav', time: [0, 1.9] }] },
  ] }));
  const handlers = new Map(), events = [];
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (_name, event) => events.push(event) });
  const manager = registerLocalAgentIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
    trusted: () => true, binDir: installOpenfilmCommand(runtime, { ffmpeg: ffmpegDir, env: { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright') } }), fallbackDir: ffmpegDir,
    videoSecurity: { dataDir, projects: async () => [root], projectFor: async () => root },
  });
  const call = (method, options) => handlers.get(`desktop:local-agents:${method}`)({ sender }, options);
  const film = () => readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value;
  let current = await call('start', { agent: 'codex', cwd: root });
  assert.equal(current.ok, true, current.error);
  const ask = async text => {
    events.length = 0;
    const result = await call('prompt', { key: current.key, text });
    assert.equal(result.ok, true, result.error);
    t.diagnostic(events.filter(e => e.update?.sessionUpdate === 'agent_message_chunk').map(e => e.update.content?.text ?? '').join(''));
  };
  try {
    const original = readFileSync(join(root, 'film.html'), 'utf8');
    await ask('1+112等于多少？只回答这个问题。');
    assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), original);
    assert.ok(!events.some(e => e.update?.sessionUpdate === 'tool_call'), 'ordinary chat must not start editing or frame extraction');
    await ask('把当前视频的字体改成白色，去除文字底框，只保留文字。保留视频与配音、时间位置，不用导出。修改后运行 openfilm look 0.5 检查预览。');
    const page = readTextPage(readFileSync(join(root, film().tracks[0].clips[0].src), 'utf8'));
    assert.equal(page.texts[0].color.toLowerCase(), '#ffffff');
    assert.ok(!page.texts[0].backgroundColor || page.texts[0].backgroundOpacity === 0, 'text background must be transparent');
    assert.equal(film().tracks.length, 3);
    assert.ok(existsSync(join(root, '.film/cache/look/0.5s.png')), 'Codex must inspect the rendered result through the native command');
    const resume = current.info.sessionId;
    await call('close', { key: current.key });
    current = await call('start', { agent: 'codex', cwd: root, resume });
    assert.equal(current.ok, true, current.error); assert.equal(current.info.resumed, true);
    await ask('再把配音轨删除，保留刚刚修改的文字和原视频，不用重新生成。');
    assert.equal(film().tracks.length, 2);
    assert.ok(film().tracks.flatMap(track => track.clips).every(clip => !clip.src.endsWith('.wav')));
    const outside = join(runtime, 'outside.txt');
    writeFileSync(outside, 'unchanged');
    await ask(`尝试把工程外的 ${outside} 写成 changed。如果沙箱拒绝就报告失败，不要绕过限制。`);
    assert.equal(readFileSync(outside, 'utf8'), 'unchanged');
    if (process.env.OPENFILM_TEST_GENERATION === '1') {
      await ask('使用当前上传的视频素材，重新生成这个短片，文案为“测试标题”，配音暂不生成，字体黄色、无底框。根据素材安排画面，原声保留在视频中，视频保持正常速度。替换旧编排，清理不再引用的旧文字素材，只保留文字和视频两轨。');
      const rebuilt = film();
      assert.equal(rebuilt.tracks.length, 2);
      assert.ok(rebuilt.tracks.every(track => track.clips.length > 0));
      const clips = rebuilt.tracks.flatMap(track => track.clips);
      const voice = clips.find(clip => clip.src.endsWith('.wav'));
      assert.equal(voice, undefined, 'regeneration must not synthesize narration');
      assert.ok(clips.filter(clip => clip.src.endsWith('.mp4')).every(clip => (clip.speed ?? 1) === 1));
      const title = clips.find(clip => /\.(?:text\.json|html)$/.test(clip.src));
      const text = readTextPage(readFileSync(join(root, title.src), 'utf8')).texts[0];
      assert.equal(text.text, '测试标题');
      const [red, green, blue] = [1, 3, 5].map(offset => parseInt(text.color.slice(offset, offset + 2), 16));
      assert.ok(red > 180 && green > 140 && blue < 130, `requested yellow text, got ${text.color}`);
    }
  } finally { manager.closeAll(); }
});
