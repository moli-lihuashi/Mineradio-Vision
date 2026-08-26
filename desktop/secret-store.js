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
