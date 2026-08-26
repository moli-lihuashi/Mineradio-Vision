'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PACK_MAGIC = 'MINERADIO_LOGIN_PACK_V1';
const PROVIDER_FILE_KEYS = {
  netease: ['cookie'],
  qq: ['cookie'],
  kugou: ['cookie'],
  qishui: ['cookie', 'token'],
  spotify: ['token'],
};

function resolveProviderFiles(meta) {
  const files = (meta && meta.files || []).filter(Boolean);
  const out = {};
  if (!files.length) return out;
  if (meta.label && /汽水|qishui/i.test(meta.label)) {
    out.cookie = files.find((f) => /\.qishui-cookie$/i.test(f) || String(f).includes('QISHUI_COOKIE')) || files[0];
    out.token = files.find((f) => /\.qishui-token$/i.test(f) || String(f).includes('QISHUI_TOKEN')) || files[1] || '';
  } else if (meta.label && /spotify/i.test(meta.label)) {
    out.token = files[0];
  } else {
    out.cookie = files[0];
  }
  return out;
}

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password || ''), salt, 32);
}

function encryptPackPayload(payload, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    magic: PACK_MAGIC,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptPackPayload(envelope, password) {
  if (!envelope || envelope.magic !== PACK_MAGIC) throw new Error('INVALID_LOGIN_PACK');
  const salt = Buffer.from(String(envelope.salt || ''), 'base64');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const data = Buffer.from(String(envelope.data || ''), 'base64');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function readProviderSecrets(provider, meta, secretStore) {
  const mapped = resolveProviderFiles(meta);
  const secrets = {};
  Object.keys(mapped).forEach((key) => {
    const file = mapped[key];
    if (!file) return;
    let text = '';
    try {
      text = secretStore && typeof secretStore.readSecretFile === 'function'
        ? secretStore.readSecretFile(file)
        : (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
    } catch (_) {
      text = '';
    }
    if (text) secrets[key] = text;
  });
  return secrets;
}

function writeProviderSecrets(provider, secrets, meta, secretStore) {
  const mapped = resolveProviderFiles(meta);
  let written = 0;
  Object.keys(secrets || {}).forEach((key) => {
    const file = mapped[key];
    const value = String(secrets[key] || '');
    if (!file || !value) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (secretStore && typeof secretStore.writeSecretFile === 'function') {
      secretStore.writeSecretFile(file, value);
    } else {
      fs.writeFileSync(file, value, 'utf8');
    }
    written += 1;
  });
  return written;
}

function buildLoginPack(options) {
  const {
    providers,
    password,
    loginCookieExportMeta,
    secretStore,
  } = options;
  const list = Array.isArray(providers) && providers.length
    ? providers
    : ['netease', 'qq', 'kugou', 'qishui', 'spotify'];
  const payload = {
    v: 1,
    createdAt: Date.now(),
    providers: {},
  };
  list.forEach((provider) => {
    const meta = loginCookieExportMeta(provider);
    if (!meta) return;
    const secrets = readProviderSecrets(provider, meta, secretStore);
    if (!Object.keys(secrets).length) return;
    payload.providers[provider] = {
      label: meta.label,
      secrets,
    };
  });
  if (!Object.keys(payload.providers).length) {
    return { ok: false, error: 'NO_LOGIN_SECRETS', message: '当前没有可导出的登录态' };
  }
  if (!String(password || '').trim()) {
    return { ok: false, error: 'PASSWORD_REQUIRED', message: '请设置导出口令' };
  }
  return {
    ok: true,
    envelope: encryptPackPayload(payload, password),
    providers: Object.keys(payload.providers),
  };
}

function applyLoginPack(options) {
  const {
    envelope,
    password,
    loginCookieExportMeta,
    secretStore,
  } = options;
  if (!String(password || '').trim()) {
    return { ok: false, error: 'PASSWORD_REQUIRED', message: '请输入导入口令' };
  }
  let payload;
  try {
    payload = decryptPackPayload(envelope, password);
  } catch (error) {
    return { ok: false, error: 'DECRYPT_FAILED', message: '口令错误或登录包已损坏' };
  }
  const imported = [];
  Object.keys(payload.providers || {}).forEach((provider) => {
    const meta = loginCookieExportMeta(provider);
    const entry = payload.providers[provider];
    if (!meta || !entry || !entry.secrets) return;
    const count = writeProviderSecrets(provider, entry.secrets, meta, secretStore);
    if (count > 0) imported.push(provider);
  });
  if (!imported.length) {
    return { ok: false, error: 'EMPTY_PACK', message: '登录包里没有可用平台凭证' };
  }
  return { ok: true, providers: imported };
}

module.exports = {
  PACK_MAGIC,
  PROVIDER_FILE_KEYS,
  buildLoginPack,
  applyLoginPack,
  encryptPackPayload,
  decryptPackPayload,
};
