import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = 'local-v1:';
const OS = 'os-v1:';
const AAD = Buffer.from('OpenFilm device credential v1');

/** Prefer the OS store. Linux without a keyring uses an owner-only random key, never Chromium basic_text. */
export function credentialStorage({ safeStorage, dataDir, platform = process.platform }) {
  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable()
        && !(platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
    } catch { return false; }
  };
  const localKey = create => {
    if (platform !== 'linux') throw new Error('系统安全存储不可用，请解锁系统账户后重试。');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const directory = lstatSync(dataDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o022)) throw new Error('应用凭据目录权限无效。');
    const file = join(dataDir, 'gateway-storage.key');
    let fd;
    try {
      if (create) {
        try {
          fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          writeFileSync(fd, randomBytes(32)); closeSync(fd); fd = undefined;
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size !== 32) throw new Error('应用凭据密钥权限或格式无效。');
      return readFileSync(fd);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('本机凭据密钥丢失，无法解密设备授权；请恢复应用数据备份。');
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  };
  return {
    encrypt(value) {
      if (available()) return OS + safeStorage.encryptString(value).toString('base64');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', localKey(true), iv);
      cipher.setAAD(AAD);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return LOCAL + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value) {
      if (typeof value !== 'string' || !value) throw new Error('设备凭据格式无效。');
      if (value.startsWith(LOCAL)) {
        const bytes = Buffer.from(value.slice(LOCAL.length), 'base64');
        if (bytes.length < 29) throw new Error('设备凭据格式无效。');
        const decipher = createDecipheriv('aes-256-gcm', localKey(false), bytes.subarray(0, 12));
        decipher.setAAD(AAD); decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
      }
      if (!available()) throw new Error('已有授权由系统密钥环加密，请先恢复或解锁系统密钥环。');
      // Accept credentials written before versioned envelopes were introduced.
      return safeStorage.decryptString(Buffer.from(value.startsWith(OS) ? value.slice(OS.length) : value, 'base64'));
    },
  };
}
