import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createGateway } from '../../../services/auth-gateway/server.mjs';
import { createGatewayFetch, signedHeaders } from './gateway-auth.mjs';
import { generateNarration } from './narration.mjs';
import { saveTemplate } from './edit-workflow.mjs';
import { initialTemplate } from './edit-template.mjs';
import { filmHtml } from 'openfilm/film-doc';
import { createExports } from '../../../packages/openfilm/studio/server/exports.mjs';

test('signed gateway → sentence MP3 → native timeline → MP4, portable draft and project folder', { skip: process.env.OPENFILM_TEST_TTS_EXPORT !== '1', timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'narration-e2e-'));
  const project = join(root, 'project'); mkdirSync(project);
  const sample = join(root, 'sample.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', sample]);
  const audio = readFileSync(sample).toString('base64');
  const mappings = join(root, 'mappings.json'); writeFileSync(mappings, '{"license":{}}');
  let speechCalls = 0;
  const gateway = createGateway({ secret: 'test'.repeat(16), mappingFile: mappings, keygenUrl: 'https://keygen.test/v1', keygenToken: 'private', ttsKey: 'speech-private', fetchImpl: async (url, options) => {
    if (url.startsWith('https://keygen.test/')) return Response.json({ data: { id: 'license' }, meta: { valid: true } });
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    assert.equal(options.headers['X-Api-Key'], 'speech-private'); speechCalls++;
    return new Response(JSON.stringify({ code: 0, data: audio, sentence: { words: [{ word: JSON.parse(options.body).req_params.text, startTime: 0, endTime: 0.9 }] } }) + '\n{"code":20000000}\n');
  } });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const identity = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const body = JSON.stringify({ activationCode: 'license', publicKey: identity.publicKey });
    const activated = await fetch(`${origin}/auth/activate`, { method: 'POST', headers: signedHeaders(identity, 'POST', '/auth/activate', body), body });
    assert.equal(activated.status, 200);
    const { refreshToken } = await activated.json();
    const hosted = { baseUrl: `${origin}/v1`, fetchImpl: createGatewayFetch({ baseUrl: `${origin}/v1`, refreshToken, identity }) };
    saveTemplate(project, { ...initialTemplate(), narration: true, bodyText: '欢迎光临。现在出发！' });
    const narration = await generateNarration(project, hosted);
    assert.equal(speechCalls, 2);
    const video = join(project, 'source.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=320x180:r=10:d=${narration.duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    writeFileSync(join(project, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [{ id: 'source', src: 'source.mp4', time: [0, narration.duration], volume: 0.15 }] },
      { clips: narration.sentences.map(s => ({ id: s.id, src: s.src, at: s.start, time: [0, s.duration] })) },
    ] }));
    const exports = createExports({ drafts: () => null });
    const output = async ask => {
      const job = exports.start({ id: 'tts', name: 'Narration', path: project }, ask, { folder: join(root, 'exports') });
      for (let i = 0; i < 1200; i++) {
        const current = exports.list('tts').find(item => item.id === job.id);
        if (['done', 'failed', 'cancelled'].includes(current.status)) { assert.equal(current.status, 'done', current.error); return current.out; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('export timed out');
    };
    const mp4 = await output({ kind: 'video', fps: 10, shortEdge: 180 });
    const facts = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', mp4]));
    assert.ok(facts.streams.some(stream => stream.codec_type === 'audio'));
    const draftFile = await output({ kind: 'nle', format: 'jianying', fps: 30, audio: 'clips', media: 'copy', subtitles: false });
    const draft = JSON.parse(readFileSync(draftFile, 'utf8'));
    assert.equal(draft.materials.audios.length, 2);
    for (const material of draft.materials.audios) {
      assert.ok(readFileSync(join(dirname(draftFile), 'Resources/local', basename(material.path))).length > 0);
    }
    const backup = await output({ kind: 'project', as: 'folder' });
    for (const sentence of narration.sentences) assert.ok(readFileSync(join(backup, sentence.src)).length > 0);
  } finally {
    gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
