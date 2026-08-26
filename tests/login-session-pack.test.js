'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildLoginPack,
  applyLoginPack,
  PACK_MAGIC,
} = require('../desktop/login-session-pack');

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-login-pack-'));
  const cookieFile = path.join(root, '.kugou-cookie');
  const qishuiCookie = path.join(root, '.qishui-cookie');
  fs.writeFileSync(cookieFile, 'kugou-session=abc', 'utf8');
  fs.writeFileSync(qishuiCookie, 'sessionid=qs', 'utf8');
  const secretStore = {
    readSecretFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''),
    writeSecretFile: (file, text) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(text || ''), 'utf8');
    },
  };
  const meta = (provider) => {
    if (provider === 'kugou') return { label: '酷狗音乐', files: [cookieFile] };
    if (provider === 'qishui') return { label: '汽水音乐', files: [qishuiCookie, path.join(root, '.qishui-token')] };
    return null;
  };
  const built = buildLoginPack({
    providers: ['kugou', 'qishui'],
    password: 'world-peace',
    loginCookieExportMeta: meta,
    secretStore,
  });
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.envelope.magic, PACK_MAGIC);
  assert.deepStrictEqual(built.providers.sort(), ['kugou', 'qishui']);

  fs.unlinkSync(cookieFile);
  fs.unlinkSync(qishuiCookie);
  const applied = applyLoginPack({
    envelope: built.envelope,
    password: 'world-peace',
    loginCookieExportMeta: meta,
    secretStore,
  });
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(fs.readFileSync(cookieFile, 'utf8'), 'kugou-session=abc');
  assert.strictEqual(fs.readFileSync(qishuiCookie, 'utf8'), 'sessionid=qs');

  const bad = applyLoginPack({
    envelope: built.envelope,
    password: 'wrong',
    loginCookieExportMeta: meta,
    secretStore,
  });
  assert.strictEqual(bad.ok, false);

  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  assert(main.includes("ipcMain.handle('mineradio-export-login-pack'"));
  assert(main.includes("ipcMain.handle('mineradio-import-login-pack'"));
  const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  assert(preload.includes('exportLoginSessionPack'));
  assert(preload.includes('importLoginSessionPack'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('[OK] Login session pack encrypt/export/import verified.');
}

run();
