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

test('unreadable local credentials lock the workspace and failed replacement preserves the previous state', async () => {
  const state = authorizationController(async () => { throw new Error('unreadable credentials'); });
  await state.activate(async () => {});
  await assert.rejects(state.activate(async () => { throw new Error('invalid code'); }));
  assert.equal(state.get(), true);
  assert.equal((await state.status()).authorized, false);
  assert.throws(() => state.guard('desktop:tabs:new'), /激活/);
});

test('explicit revocation invalidates pending local checks immediately',async()=>{
 let resolve;const changes=[];const state=authorizationController(()=>new Promise(done=>{resolve=done;}),value=>changes.push(value));
 await state.activate(async()=>{});const checking=state.status();await Promise.resolve();state.invalidate();resolve({authorized:true});
 assert.equal((await checking).authorized,false);assert.throws(()=>state.guard('desktop:chat:send'),/激活/);assert.deepEqual(changes,[true,false]);
 assert.equal((await state.status()).authorized,false);await state.activate(async()=>{});assert.equal(state.get(),true);
});
