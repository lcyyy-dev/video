import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore, validateUsername } from './profiles.mjs';
import { testLogStore, hasTestDatabase } from './test-log-store.mjs';

test('username accepts at most eight Unicode characters and rejects blank/control input', () => {
  assert.equal(validateUsername(' 用户123456 '), '用户123456');
  assert.equal(validateUsername('😀😀😀😀😀😀😀😀'), '😀😀😀😀😀😀😀😀');
  for (const input of ['', ' ', '123456789', '\u0000test', null, 12]) {
    assert.throws(() => validateUsername(input), { status: 400 });
  }
  assert.throws(() => validateUsername('用\n户'), { status: 400 });
});

test('PostgreSQL profiles persist random unique IDs, isolate licenses and only rename usernames', { skip: !hasTestDatabase }, async t => {
  const logs = await testLogStore(t);
  const schema = logs.schemaName;
  const store = new ProfileStore(logs.pool, schema);
  await store.initialize();
  const same = await Promise.all(Array.from({ length: 8 }, () => store.ensure('alice')));
  assert.ok(same.every(p => p.userId === same[0].userId && p.username === same[0].username));
  assert.match(same[0].username, /^用户\d{6}$/);
  assert.match(same[0].userId, /^0406 2003 \d{4}$/);
  assert.notEqual(same[0].userId, '0406 2003 0000');
  const others = await Promise.all(Array.from({ length: 15 }, (_, i) => store.ensure('license-' + i)));
  assert.equal(new Set([...others, same[0]].map(p => p.userId)).size, 16);
  const renamed = await store.rename('alice', '小源用户');
  assert.deepEqual(renamed, { username: '小源用户', userId: same[0].userId });
  assert.deepEqual(await new ProfileStore(logs.pool, schema).ensure('alice'), renamed);
  assert.deepEqual(await store.ensure('license-0'), others[0]);
  await assert.rejects(store.rename('alice', '123456789'), { status: 400 });
});
