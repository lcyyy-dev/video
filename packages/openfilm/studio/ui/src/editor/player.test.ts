import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fadeSteps } from './player.ts';

test('a sound\'s fades as ramps: where it is now, then each corner after it', () => {
  /* 4 s long, 1 s in, 2 s out */
  assert.deepEqual(fadeSteps(0, 4, [1, 2]), [[0, 0], [1, 1], [2, 1], [4, 0]]);
  assert.deepEqual(fadeSteps(0.5, 4, [1, 2]), [[0.5, 0.5], [1, 1], [2, 1], [4, 0]]);
  /* played from inside the fade out */
  assert.deepEqual(fadeSteps(3, 4, [1, 2]), [[3, 0.5], [4, 0]]);
  assert.deepEqual(fadeSteps(1, 4, undefined), [[1, 1]]);
  /* only a fade out: full until it starts */
  assert.deepEqual(fadeSteps(0, 2, [0, 0.5]), [[0, 1], [1.5, 1], [2, 0]]);
});

class AudioNodeMock {
  buffer: unknown;
  playbackRate = { value: 1 };
  gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} };
  fftSize = 2048;
  started = false;
  connect(node: AudioNodeMock) { return node; }
  start() { this.started = true; }
  stop() { this.started = false; }
}
class AudioContextMock extends EventTarget {
  state = 'suspended';
  currentTime = 0;
  destination = new AudioNodeMock();
  sources: AudioNodeMock[] = [];
  decodeFailures = 0;
  resumeCalls = 0;
  createGain() { return new AudioNodeMock(); }
  createChannelSplitter() { return new AudioNodeMock(); }
  createAnalyser() { return new AudioNodeMock(); }
  createBufferSource() { const source = new AudioNodeMock(); this.sources.push(source); return source; }
  async decodeAudioData() {
    if (this.decodeFailures-- > 0) throw new Error('decoder temporarily unavailable');
    return { duration: 10 };
  }
  async resume() { this.resumeCalls++; this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
  async close() { this.state = 'closed'; }
}

import { Player } from './player.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sound = { src: '/voice.mp3', at: 0, from: 0, to: 10, volume: 1, speed: 1, clip: 'voice' };
function audioEnvironment(t: import('node:test').TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let ctx: AudioContextMock;
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class extends AudioContextMock {
    constructor() { super(); ctx = this; }
  } });
  const player = new Player();
  t.after(() => {
    player.close();
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  return { player, context: () => ctx };
}

test('a transient audio request failure recovers during playback without restarting the clock', async t => {
  const { player, context } = audioEnvironment(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1])));
  player.load('http://film.test', [sound], 10);
  await player.play();
  await sleep(350);
  assert.equal(requests, 2);
  assert.equal(context().sources.filter(source => source.started).length, 1);
  assert.equal(context().resumeCalls, 1, 'resume statechange does not start overlapping play calls');
});

test('a decoding failure recovers and a genuinely silent file stays cached', async t => {
  const { player, context } = audioEnvironment(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new Uint8Array([1])); });
  player.load('http://film.test', [sound], 10);
  context().decodeFailures = 1;
  await player.play();
  await sleep(350);
  assert.equal(requests, 2);
  assert.equal(context().sources.filter(source => source.started).length, 1);
  player.pause();
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(null, { status: 204 }); });
  player.load('http://film.test', [{ ...sound, src: '/silent.mov' }], 10);
  await sleep(10);
  const before = requests;
  await player.play();
  await sleep(10);
  assert.equal(requests, before, '204 means no audio, rather than a transient failure');
});

test('exhausted failures can be retried by play, while mute, volume and solo remain effective', async t => {
  const { player, context } = audioEnvironment(t);
  let failing = true, requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return failing ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1])); });
  player.load('http://film.test', [sound], 10);
  await sleep(850);
  assert.equal(requests, 3, 'recovery is bounded');
  failing = false;
  player.setVolume(0.4);
  player.setMuted(true);
  player.setHeard(new Set());
  await player.play();
  await sleep(10);
  assert.equal(requests, 4);
  assert.equal(context().sources.length, 0, 'solo excludes this sound');
  player.setMuted(false);
  player.setHeard(null);
  await sleep(10);
  assert.equal(context().sources.filter(source => source.started).length, 1);
  assert.equal(player.volume, 0.4);
  assert.equal(player.muted, false);
});
