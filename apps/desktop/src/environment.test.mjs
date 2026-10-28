import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childEnvironment, environmentCache, expandWindowsVars, launcherEnvironment, parseRegQuery, shellSubset, shellVariables, windowsFreshPath } from './environment.mjs';

test('the Linux launcher preserves the desktop session without passing agent configuration', { skip: process.platform !== 'linux' }, () => {
  const source = { HOME: '/tmp/example-home', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0',
    XDG_RUNTIME_DIR: '/run/user/1000', XAUTHORITY: '/tmp/example.auth', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    PULSE_SERVER: 'unix:/tmp/pulse', LD_LIBRARY_PATH: '/opt/example/lib', GTK_IM_MODULE: 'fcitx', QT_IM_MODULE: 'fcitx',
    XMODIFIERS: '@im=fcitx', FCITX_DBUS_ADDRESS: 'unix:path=/run/user/1000/fcitx', OPENFILM_DESKTOP_FLAVOR: 'dev',
    CLAUDECODE: '1', ANTHROPIC_API_KEY: 'example', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1' };
  const env = launcherEnvironment(source, '/usr/bin:/bin');
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'PULSE_SERVER', 'LD_LIBRARY_PATH']) {
    assert.equal(env[key], source[key]);
  }
  for (const key of ['GTK_IM_MODULE', 'QT_IM_MODULE', 'XMODIFIERS', 'FCITX_DBUS_ADDRESS']) assert.equal(env[key], source[key]);
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(childEnvironment({ source, shell: { PATH: '/usr/bin:/bin' } }).LD_LIBRARY_PATH, source.LD_LIBRARY_PATH,
    'Studio utility processes need the same dynamic libraries as Electron');
});

const PROFILE = ['C:', 'Users', 'someone'].join('\\');

test('desktop network proxies reach Codex and Studio even when the login shell sets none', () => {
  const source = { HOME: '/tmp/example-home', HTTPS_PROXY: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7897',
    HTTP_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'localhost,127.0.0.1', CODEX_SESSION_ID: 'parent-session',
    OPENAI_API_KEY: 'parent-key', NODE_OPTIONS: '--inspect' };
  const launched = launcherEnvironment(source, '/usr/bin:/bin');
  const child = childEnvironment({ source: launched, shell: { PATH: '/usr/bin:/bin' } });
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'NO_PROXY']) assert.equal(child[key], source[key]);
  for (const key of ['CODEX_SESSION_ID', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(child[key], undefined);
});

test('shell proxy overrides remove stale inherited case variants, including explicitly disabling a proxy', () => {
  const source = { HTTPS_PROXY: 'http://old-proxy', https_proxy: 'http://old-proxy', NO_PROXY: 'old-host', no_proxy: 'old-host' };
  const child = childEnvironment({ source, shell: { PATH: '/usr/bin', HTTPS_PROXY: 'http://shell-proxy', NO_PROXY: '' } });
  assert.equal(child.HTTPS_PROXY, 'http://shell-proxy');
  assert.equal(child.https_proxy, undefined);
  assert.equal(child.NO_PROXY, '');
  assert.equal(child.no_proxy, undefined);
});

const USER = `\r
HKEY_CURRENT_USER\\Environment\r
    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%NVM_HOME%;%NVM_SYMLINK%;C:\\Users\\someone\\AppData\\Roaming\\npm\r
    NVM_HOME    REG_SZ    C:\\Users\\someone\\AppData\\Local\\nvm\r
    NVM_SYMLINK    REG_SZ    C:\\nvm4w\\nodejs\r
    OneDrive Consumer    REG_SZ    C:\\Users\\someone\\OneDrive\r
    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp\r
    Count    REG_DWORD    0x1\r
`;

test('reg query output is read: text values by name, other kinds left out', () => {
  const values = parseRegQuery(USER);
  assert.equal(values.NVM_SYMLINK, 'C:\\nvm4w\\nodejs');
  assert.equal(values['OneDrive Consumer'], 'C:\\Users\\someone\\OneDrive');
  assert.match(values.Path, /^%USERPROFILE%\\AppData/);
  assert.equal(values.Count, undefined);
  assert.deepEqual(parseRegQuery(''), {});
});

test('%VARIABLES% are expanded whatever their case; one not set stays as it is', () => {
  assert.equal(expandWindowsVars('%userprofile%\\bin;%NOPE%\\x', { USERPROFILE: PROFILE }), `${PROFILE}\\bin;%NOPE%\\x`);
});

test("the PATH a program started now gets: the system's, the person's (with their own variables), then the app's own", () => {
  const machine = { Path: '%SystemRoot%\\system32;C:\\Program Files\\nodejs\\', SystemRoot: 'C:\\Windows' };
  const user = parseRegQuery(USER);
  const source = { Path: 'C:\\Windows\\System32;C:\\Old\\stale', USERPROFILE: PROFILE };
  assert.equal(windowsFreshPath({ machine, user, source }), [
    'C:\\Windows\\system32', 'C:\\Program Files\\nodejs\\',
    'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps', 'C:\\Users\\someone\\AppData\\Local\\nvm', 'C:\\nvm4w\\nodejs', 'C:\\Users\\someone\\AppData\\Roaming\\npm',
    'C:\\Old\\stale',
  ].join(';'));
});

test('the environment is read again once it is old, sooner when asked; a failed read keeps the last good one', async () => {
  let clock = 0;
  const reads = [];
  let next = { PATH: '/a' };
  const cache = environmentCache(async () => { reads.push(clock); return next; }, { forMs: 60_000, fallback: () => ({ PATH: '/fallback' }), now: () => clock });
  assert.deepEqual(await cache(), { PATH: '/a' });
  next = { PATH: '/a:/b' };
  clock = 30_000;
  assert.deepEqual(await cache(), { PATH: '/a' }, 'still fresh');
  assert.deepEqual(await cache({ maxAgeMs: 10_000 }), { PATH: '/a:/b' }, 'the agents\' list wants it newer');
  clock = 100_000;
  assert.deepEqual(await cache({ maxAgeMs: 120_000 }), { PATH: '/a:/b' }, 'a caller cannot make it older than its own limit');
  assert.equal(reads.length, 3);
  next = null;
  clock = 200_000;
  assert.deepEqual(await cache(), { PATH: '/a:/b' }, 'the shell failed: the last one read');
  const empty = environmentCache(async () => null, { forMs: 1000, fallback: () => ({ PATH: '/fallback' }), now: () => 0 });
  assert.deepEqual(await empty(), { PATH: '/fallback' });
});

test('reads going on at once are one read', async () => {
  let count = 0;
  let clock = 0;
  const cache = environmentCache(() => new Promise((done) => { count++; setTimeout(() => done({ PATH: '/x' }), 5); }), { forMs: 1000, fallback: () => ({}), now: () => clock });
  const first = cache();
  clock = 5000;
  const second = cache({ maxAgeMs: 0 });
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('an old one can be taken at once, the new one read for whoever asks next', async () => {
  let clock = 0;
  let next = { PATH: '/a' };
  const cache = environmentCache(async () => next, { forMs: 60_000, fallback: () => ({}), now: () => clock });
  await cache();
  next = { PATH: '/b' };
  clock = 100_000;
  assert.deepEqual(await cache({ staleOk: true }), { PATH: '/a' });
  assert.deepEqual(await cache(), { PATH: '/b' });
});

test("the agents get all the person's shell sets, but what the shell and its terminal set for themselves; Studio a part", () => {
  const dump = {
    PATH: '/opt/homebrew/bin:/usr/bin', ANTHROPIC_BASE_URL: 'https://gateway.example', GITHUB_TOKEN: 't', NODE_EXTRA_CA_CERTS: '/ca.pem',
    HTTPS_PROXY: 'http://proxy', PWD: '/x', SHLVL: '2', _: '/usr/bin/env', TERM_PROGRAM: 'iTerm.app', ELECTRON_RUN_AS_NODE: '1', OPENFILM_HOME: '/o',
  };
  const all = shellVariables(dump, '/home/me/');
  assert.deepEqual(Object.keys(all).sort(), ['ANTHROPIC_BASE_URL', 'GITHUB_TOKEN', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'PATH']);
  assert.ok(all.PATH.startsWith('/opt/homebrew/bin:/usr/bin'));
  assert.deepEqual(Object.keys(shellSubset(all, '/home/me/')).sort(), ['HTTPS_PROXY', 'PATH']);
});
