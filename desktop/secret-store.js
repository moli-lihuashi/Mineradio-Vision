const { safeStorage } = require('electron');
const fs = require('fs');

const ENCRYPTED_PREFIX = Buffer.from([0x4d, 0x52]); // "MR"

function readSecretFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf.length) return '';
    if (buf.length > 2 && buf[0] === ENCRYPTED_PREFIX[0] && buf[1] === ENCRYPTED_PREFIX[1]) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[SecretStore] encrypted cookie present but OS encryption unavailable:', filePath);
        return '';
      }
      return safeStorage.decryptString(buf.subarray(2)).trim();
    }
    // 无 "MR" 前缀 = 历史明文文件。
    // 只在「本机加密可用」时接受：这种环境下调用方会立刻把它重写成密文完成迁移，
    // 明文不会长期存在；加密不可用时 fail-closed 返回空（宁可让用户重新登录，
    // 也不把明文文件当成有效凭据无条件信任——那等于加密形同虚设）。
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[SecretStore] plaintext credential file ignored (OS encryption unavailable):', filePath);
      return '';
    }
    console.warn('[SecretStore] legacy plaintext credential file, will re-encrypt on next write:', filePath);
    return buf.toString('utf8').trim();
  } catch (e) {
    console.warn('[SecretStore] read failed:', filePath, e.message);
    return '';
  }
}

function writeSecretFile(filePath, text) {
  if (!filePath) return;
  const value = String(text || '');
  try {
    if (!value) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('ENCRYPTION_UNAVAILABLE');
    }
    const enc = safeStorage.encryptString(value);
    fs.writeFileSync(filePath, Buffer.concat([ENCRYPTED_PREFIX, enc]));
  } catch (e) {
    console.warn('[SecretStore] write failed:', filePath, e.message);
    throw e;
  }
}

module.exports = { readSecretFile, writeSecretFile };
