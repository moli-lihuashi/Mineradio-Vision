'use strict';

/*
 * LiquidGlass 折射源失效守卫（2026-11-22）
 *
 * 现象：切换壁纸/切歌后，玻璃里透出来的还是上一张图（用户截图：卡片内是旧封面，
 * 背景已经是新的）。
 * 根因：`liquidGlassDrawCustomBgImage()` 对 `--custom-bg-image` 有 2 秒 TTL，
 * 壁纸变了但缓存没过期前仍画旧图；另外 `#custom-bg::before` 还给
 * `background-image` 写了一个无法插值的 transition，进一步拖后切换。
 * 修法：壁纸/底色变化时由 `applyCustomBackground()` 主动失效镜像缓存，并去掉
 * `background-image` 的 transition。这里守三件事，防止回退。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_LOOP = fs.readFileSync(path.join(ROOT, 'public/js/modules/11-main-loop.js'), 'utf8');
const ACCENT = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/01-lyric-color-accent.js'), 'utf8');
const INDEX_CSS = fs.readFileSync(path.join(ROOT, 'public/css/index.css'), 'utf8');

test('镜像缓存必须提供主动失效入口', () => {
  assert.match(MAIN_LOOP, /function invalidateLiquidGlassBackdropCache\(\)/, '必须有失效函数');
  const fn = MAIN_LOOP.slice(
    MAIN_LOOP.indexOf('function invalidateLiquidGlassBackdropCache()'),
    MAIN_LOOP.indexOf('function invalidateLiquidGlassBackdropCache()') + 400,
  );
  assert.match(fn, /_lgBgImageStyleAt\s*=\s*0/, '必须清掉背景图 TTL');
  assert.match(fn, /_lgMirrorBgColorAt\s*=\s*0/, '必须清掉底色 TTL');
  assert.match(MAIN_LOOP, /window\.__lgInvalidateBackdropCache\s*=\s*invalidateLiquidGlassBackdropCache/, '必须挂到 window 供其它模块调用');
});

test('写背景变量后必须立刻失效镜像缓存', () => {
  const start = ACCENT.indexOf('function applyCustomBackground()');
  assert.ok(start > 0, '必须存在 applyCustomBackground');
  const body = ACCENT.slice(start, start + 3400);
  const setAt = body.indexOf("setProperty('--custom-bg-image'");
  const invalidateAt = body.indexOf('invalidateLiquidGlassBackdropCache()');
  assert.ok(setAt > 0, '必须设置 --custom-bg-image');
  assert.ok(invalidateAt > setAt, '失效调用必须在写完变量之后');
});

test('CSS：background-image 不得参与 transition', () => {
  const rule = INDEX_CSS.split(/\r?\n/).find((l) => l.startsWith('#custom-bg::before{'));
  assert.ok(rule, '必须存在 #custom-bg::before 规则');
  assert.ok(!/transition:[^;}]*background-image/.test(rule), 'background-image 无法插值，不能放进 transition');
  assert.match(rule, /transition:opacity/, 'opacity 过渡保留');
});

test('封面模式空源不得把壁纸清成 none', () => {
  // 返回 home / 退出 Folia 世界的瞬间，封面源可能暂时取不到；
  // 此时把 --custom-bg-image 写成 none 会让壁纸消失且不再恢复（用户实测）。
  assert.match(ACCENT, /var keepAlbumArt = albumMode && !image;/, '必须有空源保护判断');
  const start = ACCENT.indexOf('var keepAlbumArt');
  const body = ACCENT.slice(start, start + 400);
  assert.match(body, /if \(!keepAlbumArt\)/, '空源时必须跳过 image/opacity 的覆盖');
  assert.match(body, /setProperty\('--custom-bg-image'/, '非空源仍要正常写入');
});
