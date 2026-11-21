'use strict';

// Folium 模组宿主兼容层守卫（2026-11-21）
//
// 当前接入的样式：MiSide / 52Hz / 花笺（+ 原有的 nebbia / hanabi / machi）。
// 这三类比老的跳一跳多用了 ctx.onFrame / onResize / every / isPaused / getCoverUrl /
// getDuration / subscribe，以及 folium.host / env / storage / secrets / playback /
// settingsSections。这里钉住：清单里有哪些、宿主确实提供了这些面、
// 效果层页面必须被告知「面是透明的」（花笺的灰底就是这么来的）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modsDir = path.join(root, 'public/folia-mods');
const manifest = JSON.parse(fs.readFileSync(path.join(modsDir, 'manifest.json'), 'utf8'));
const host = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/17-folia-mod-host.js'), 'utf8');

test('清单包含当前接入的模组，已删除的不许回来', () => {
  for (const id of ['miside-drop', 'visualizer52hz', 'huajian']) {
    const item = manifest.mods.find((m) => m && m.dir === id);
    assert.ok(item, 'manifest 缺少 ' + id);
    assert.equal(item.enabled, true, id + ' 未启用');
    for (const file of ['mod.json', 'client.mjs']) {
      assert.ok(fs.existsSync(path.join(modsDir, id, file)), id + ' 缺少 ' + file);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(modsDir, id, 'mod.json'), 'utf8'));
    assert.equal(meta.folium, 1, id + ' 的 mod.json folium 版本不对');
  }
  for (const id of ['stardrift', 'visualizer-jump', 'spectrum-visualizer']) {
    assert.ok(!manifest.mods.some((m) => m && m.dir === id), 'manifest 里还留着已删除的 ' + id);
    assert.ok(!fs.existsSync(path.join(modsDir, id)), '目录里还留着已删除的 ' + id);
  }
});

test('宿主 ctx 补齐新模组依赖的能力', () => {
  const ctxStart = host.indexOf('function foliaModBuildContext');
  const ctxEnd = host.indexOf('function foliaModNotify', ctxStart);
  const ctx = host.slice(ctxStart, ctxEnd);
  for (const api of ['isPaused', 'getCoverUrl', 'getDuration', 'onFrame', 'onResize', 'every', 'subscribe', 'get seed', 'get isPreview']) {
    assert.ok(ctx.includes(api), 'ctx 缺少 ' + api);
  }
  assert.match(ctx, /audio: inst\.audioFacade/, 'ctx.audio 不是稳定门面');
  assert.match(ctx, /lyricsFontScale/, 'getDisplay 没给 lyricsFontScale（模组用它算字号）');
});

test('效果层页面的 getSurface 必须声明透明（否则花笺铺灰底）', () => {
  const fn = host.slice(host.indexOf('getSurface: function ()'), host.indexOf('getSurface: function ()') + 420);
  assert.match(fn, /isWallpaperStagePage\(\)/, 'getSurface 没看效果层页面');
  assert.match(fn, /transparent: true/, '效果层页面没有返回 transparent:true');
  assert.match(fn, /transparent: false/, '普通页面仍应返回不透明面');
});

test('宿主 folium 面补齐 host/env/storage/secrets/playback/settingsSections', () => {
  const apiStart = host.indexOf('function foliaModBuildHostApi');
  const api = host.slice(apiStart, apiStart + 5200);
  for (const key of ['host:', 'env:', 'storage:', 'secrets:', 'net:', 'playback:', 'experimental:']) {
    assert.ok(api.includes(key), 'folium 缺少 ' + key);
  }
  assert.match(api, /settingsSections:\s*\{[\s\S]{0,200}register/, '缺少 settingsSections.register');
  assert.match(api, /stageLayers:/, '缺少 stageLayers 占位（新模组会摸）');
  assert.match(host, /function foliaModRegisterSettingsSection/, '缺少设置分区实现');
  assert.match(host, /onChange: function \(cb\)/, '设置分区没有 onChange');
});

test('帧循环与尺寸：onFrame 在 tick 驱动，onResize 走 ResizeObserver', () => {
  assert.match(host, /frameListeners\.push\(cb\)/, 'onFrame 没有登记回调');
  const tick = host.slice(host.indexOf('tick: function (inst, foliaCtx)'), host.indexOf('destroy: function (inst)'));
  assert.match(tick, /frameListeners/, 'tick 没有驱动帧回调');
  assert.match(tick, /everyTimers/, 'tick 没有驱动 ctx.every 定时器');
  assert.match(host, /new ResizeObserver/, 'onResize 没有观察容器尺寸');
  assert.match(host, /foliaModNotifyResize\(inst, true\)/, '注册 onResize 时没有补一次当前尺寸');
  const destroy = host.slice(host.indexOf('destroy: function (inst)'), host.indexOf('var reg = registerFoliaMode'));
  assert.match(destroy, /resizeObserver\.disconnect/, '销毁时没有断开 ResizeObserver');
  assert.match(destroy, /everyTimers\.length = 0/, '销毁时没有清空定时器');
});

test('音频门面给 getPower/getBands/getSpectrum', () => {
  const fn = host.slice(host.indexOf('function foliaModBuildAudioFacade'), host.indexOf('function foliaModBuildClock'));
  for (const name of ['getPower', 'getBeat', 'getBands', 'getSpectrum']) {
    assert.ok(fn.includes(name), '音频门面缺少 ' + name);
  }
});
