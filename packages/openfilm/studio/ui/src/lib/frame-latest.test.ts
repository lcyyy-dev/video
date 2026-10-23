import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameLatest } from './frame-latest.ts';
function harness() {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const seen: number[] = [];
  const queue = frameLatest<number>(value => seen.push(value), fn => { frames.set(++id, fn); return id; }, key => { frames.delete(key); });
  return { queue, seen, frames, tick: () => { const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(0)); } };
}
test('many pointer inputs commit only the latest value in a display frame', () => {
  const h = harness();for (let i = 0; i < 100; i++) h.queue.enqueue(i);
  assert.equal(h.frames.size, 1);h.tick();assert.deepEqual(h.seen, [99]);
});
test('pointer release flushes the final value without leaving a stale frame', () => {
  const h = harness();h.queue.enqueue(1);h.queue.enqueue(2);h.queue.flush();h.tick();assert.deepEqual(h.seen, [2]);
});
test('unmount cancels pending work, and a later gesture can schedule again', () => {
  const h = harness();h.queue.enqueue(1);h.queue.cancel();h.tick();assert.deepEqual(h.seen, []);
  h.queue.enqueue(2);h.tick();assert.deepEqual(h.seen, [2]);
});
