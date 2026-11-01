import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { credentialStorage } from './credential-storage.mjs';
import { activateGateway, gatewayConfig } from './sub2api-config.mjs';

const noKeyring = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: () => { throw new Error('basic_text must never be used'); } };
const mockOS = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: value => Buffer.from(`os:${value}`), decryptString: bytes => bytes.toString().slice(3) };

test('WSL without a keyring activates with authenticated encrypted device credentials and restores them after restart', { skip: process.platform !== 'linux' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-storage-'));
  try {
    const storage = credentialStorage({ safeStorage: noKeyring, dataDir: dir, platform: 'linux' });
    const value = 'private credential';
    const first = storage.encrypt(value), second = storage.encrypt(value);
    assert.notEqual(first, second);
    assert.equal(storage.decrypt(first), value);
    const tampered = Buffer.from(first.slice('local-v1:'.length), 'base64'); tampered[tampered.length - 1] ^= 1;
    assert.throws(() => storage.decrypt(`local-v1:${tampered.toString('base64')}`));
    await activateGateway(dir, { baseUrl: 'http://127.0.0.1:8188/v1', activationCode: 'code' }, storage, async () => Response.json({ refreshToken: 'private-refresh' }));
    const device = JSON.parse(readFileSync(join(dir, 'gateway-device.json')));
    const session = JSON.parse(readFileSync(join(dir, 'gateway-session.json')));
    assert.ok(device.privateKeyEncrypted.startsWith('local-v1:'));
    assert.ok(session.refreshTokenEncrypted.startsWith('local-v1:'));
    assert.ok(!JSON.stringify(session).includes('private-refresh'));
    assert.equal(statSync(join(dir, 'gateway-storage.key')).mode & 0o777, 0o600);
    const restarted = credentialStorage({ safeStorage: noKeyring, dataDir: dir, platform: 'linux' });
    assert.equal(restarted.decrypt(session.refreshTokenEncrypted), 'private-refresh');
    assert.ok(gatewayConfig(dir, restarted));
    assert.equal(credentialStorage({ safeStorage: mockOS, dataDir: dir, platform: 'linux' }).decrypt(first), value);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OS encryption remains preferred, legacy credentials readable, and unavailable stores never silently replace existing keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-os-storage-'));
  try {
    const storage = credentialStorage({ safeStorage: mockOS, dataDir: dir, platform: 'win32' });
    const encrypted = storage.encrypt('secret');
    assert.ok(encrypted.startsWith('os-v1:'));
    assert.equal(storage.decrypt(encrypted), 'secret');
    assert.equal(storage.decrypt(Buffer.from('os:legacy').toString('base64')), 'legacy');
    const unavailable = credentialStorage({ safeStorage: noKeyring, dataDir: dir, platform: 'linux' });
    assert.throws(() => unavailable.decrypt(encrypted), /恢复或解锁系统密钥环/);
    assert.throws(() => credentialStorage({ safeStorage: { isEncryptionAvailable: () => false }, dataDir: dir, platform: 'win32' }).encrypt('secret'), /系统安全存储不可用/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Linux fallback rejects shared-readable and linked master keys, and never regenerates a missing decryption key', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-key-permissions-'));
  try {
    const storage = credentialStorage({ safeStorage: noKeyring, dataDir: dir, platform: 'linux' });
    const encrypted = storage.encrypt('secret');
    const key = join(dir, 'gateway-storage.key');
    chmodSync(key, 0o644); assert.throws(() => storage.decrypt(encrypted), /权限或格式/);
    chmodSync(key, 0o600);
    unlinkSync(key); assert.throws(() => storage.decrypt(encrypted), /密钥丢失/);
    symlinkSync('/etc/passwd', key); assert.throws(() => storage.encrypt('secret'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
