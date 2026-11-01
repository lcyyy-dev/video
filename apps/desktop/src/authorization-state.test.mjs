import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizationState, authorizationController } from './authorization-state.mjs';

test('workspace IPC stays locked until activation and locks again after revocation', () => {
  const changes = [];
  const state = authorizationState(value => changes.push(value));
  const workspace = ['desktop:pick-folder', 'desktop:chat:send', 'desktop:tabs:new', 'unknown'];
  for (const channel of workspace) assert.throws(() => state.guard(channel), /激活/);
  for (const channel of ['desktop:hello', 'desktop:sub2api:status', 'desktop:sub2api:set']) state.guard(channel);
  state.set(true);
  for (const channel of workspace) state.guard(channel);
  state.set(true);
  state.set(false);
  for (const channel of workspace) assert.throws(() => state.guard(channel), /激活/);
  assert.deepEqual(changes, [true, false]);
});

test('a stale status check cannot revoke a newly activated session', async () => {
  let resolve;
  const state = authorizationController(() => new Promise(done => { resolve = done; }));
  const pending = state.status();
  assert.equal(state.status(), pending);
  await Promise.resolve();
  await state.activate(async () => 'activated');
  resolve({ authorized: false });
  assert.equal((await pending).authorized, true);
  assert.equal(state.get(), true);
});

test('network failures lock the workspace and failed replacement preserves the previous state', async () => {
  const state = authorizationController(async () => { throw new Error('offline'); });
  await state.activate(async () => {});
  await assert.rejects(state.activate(async () => { throw new Error('invalid code'); }));
  assert.equal(state.get(), true);
  assert.equal((await state.status()).authorized, false);
  assert.throws(() => state.guard('desktop:tabs:new'), /激活/);
});
