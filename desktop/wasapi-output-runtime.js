'use strict';
// 阶段 3A：主进程 WASAPI 共享输出运行时（默认不启用）
const path = require('path');

let bpm = null;
let sink = null;
let mutedGainRestore = null;

function loadNative() {
  if (bpm) return bpm;
  try {
    bpm = require(path.join(__dirname, '..', 'native', 'mineradio-bpm'));
  } catch (e) {
    bpm = null;
  }
  return bpm;
}

function isAvailable() {
  const n = loadNative();
  return !!(n && typeof n.wasapiAvailable === 'function' && n.wasapiAvailable());
}

function status() {
  const n = loadNative();
  if (!n) return { available: false, running: false, enabled: false, lastError: 'native missing' };
  const st = n.wasapiStatus(sink);
  return Object.assign({ enabled: !!sink }, st || {});
}

function open(sampleRate, channels) {
  close();
  const n = loadNative();
  if (!n || typeof n.wasapiCreate !== 'function') {
    return { ok: false, error: 'wasapi API missing' };
  }
  try {
    sink = n.wasapiCreate(sampleRate || 48000, channels || 2);
    n.wasapiStart(sink);
    return { ok: true, status: status() };
  } catch (e) {
    sink = null;
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function writeInterleaved(float32Array) {
  const n = loadNative();
  if (!n || !sink) return 0;
  try {
    return n.wasapiWrite(sink, float32Array) || 0;
  } catch (_) {
    return 0;
  }
}

function setVolume(v) {
  const n = loadNative();
  if (!n || !sink) return false;
  try {
    return !!n.wasapiSetVolume(sink, v);
  } catch (_) {
    return false;
  }
}

function close() {
  const n = loadNative();
  if (n && sink) {
    try { n.wasapiStop(sink); } catch (_) {}
    try { n.wasapiClose(sink); } catch (_) {}
  }
  sink = null;
  return { ok: true };
}

function registerIpc(ipcMain) {
  if (!ipcMain || registerIpc._done) return;
  registerIpc._done = true;
  ipcMain.handle('mineradio-wasapi-available', async () => isAvailable());
  ipcMain.handle('mineradio-wasapi-status', async () => status());
  ipcMain.handle('mineradio-wasapi-open', async (_e, payload) => {
    payload = payload || {};
    return open(payload.sampleRate, payload.channels);
  });
  ipcMain.handle('mineradio-wasapi-close', async () => close());
  ipcMain.handle('mineradio-wasapi-set-volume', async (_e, volume) => setVolume(Number(volume)));
  // 高频写用 send（非 invoke），避免 Promise 开销
  ipcMain.on('mineradio-wasapi-write', (_e, payload) => {
    if (!payload) return;
    if (payload instanceof Float32Array) {
      writeInterleaved(payload);
      return;
    }
    if (payload && payload.buffer && payload.byteLength) {
      try {
        writeInterleaved(new Float32Array(payload.buffer, payload.byteOffset || 0, (payload.byteLength || 0) / 4));
      } catch (_) {}
    }
  });
}

module.exports = {
  isAvailable,
  status,
  open,
  close,
  writeInterleaved,
  setVolume,
  registerIpc,
};
