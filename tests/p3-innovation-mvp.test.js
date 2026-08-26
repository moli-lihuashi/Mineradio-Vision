'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBrowserish(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const sandbox = {
    console,
    playQueue: [],
    currentIdx: -1,
    window: {},
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
    },
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const fp = loadBrowserish('public/js/modules/05-playback/10-queue-content-fingerprint.js');
const a = { name: '测试歌曲 (Live)', artist: 'A / B', duration: 210 };
const b = { name: '测试歌曲', artist: 'B, A', duration: 211 };
assert.strictEqual(fp.queueContentFingerprint(a), fp.queueContentFingerprint(b), 'same content fingerprint');
assert.notStrictEqual(
  fp.queueContentFingerprint(a),
  fp.queueContentFingerprint({ name: '另一首歌', artist: 'A', duration: 210 }),
  'different songs differ'
);

const lyricsCode = fs.readFileSync(path.join(__dirname, '..', 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'), 'utf8');
assert(/function attachLyricTranslations/.test(lyricsCode), 'attachLyricTranslations exists');
assert(/function buildLyricTranslationPayload/.test(lyricsCode), 'buildLyricTranslationPayload exists');
assert(/ytlrc/.test(lyricsCode), 'ytlrc supported');

const neteaseRouteCode = fs.readFileSync(path.join(__dirname, '..', 'server/routes/netease.js'), 'utf8');
assert(/ytlrc:\s*\(body\.ytlrc/.test(neteaseRouteCode), 'netease route returns ytlrc');

const sdk = loadBrowserish('public/js/modules/06-fx/04-liquidglass-plugin-api.js');
assert(sdk.MineradioLiquidGlass, 'MineradioLiquidGlass API');
assert.strictEqual(typeof sdk.MineradioLiquidGlass.definePreset, 'function');
assert.strictEqual(typeof sdk.MineradioLiquidGlass.registerPlugin, 'function');
sdk.MineradioLiquidGlass.definePreset('unitPreset', { rootSelector: 'body', glassSelector: 'body' });
assert(sdk.LiquidGlassPresets.unitPreset, 'preset registered');

console.log('[OK] P3 fingerprint / lyric-align / liquidglass SDK smoke verified.');
