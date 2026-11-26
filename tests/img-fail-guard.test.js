'use strict';

/*
 * 失败图片守卫（2026-11-25）
 *
 * 实测根因：Chromium 给加载失败的 <img> 画白色占位 + 哭脸图标；Home 的玻璃
 * backdrop-filter 会把这块白糊开成整卡发白（壁纸大图坏 src 时最明显）。
 * 约束：
 *  1) 捕获阶段监听 error，失败图片立即隐藏，不允许白色破图出现在界面上；
 *  2) 后续 load 成功必须恢复显示；
 *  3) 壁纸图必须先离线预加载，成功后才把 URL 交给可见 <img>。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API = fs.readFileSync(path.join(ROOT, 'public/js/modules/01-api/00-mineradio-api.js'), 'utf8');
const WE = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');

test('失败图片必须在捕获阶段隐藏，并打标记', () => {
  assert.match(API, /__mineradioImgFailGuard/, '必须有全局失败图片守卫');
  assert.match(API, /addEventListener\('error'[\s\S]{0,300}tagName !== 'IMG'/, '必须只处理 IMG 的 error');
  assert.match(API, /data-img-broken/, '失败图片必须打标记');
  assert.match(API, /style\.visibility = 'hidden'/, '失败图片必须隐藏');
  assert.match(API, /\}, true\);/, '必须在捕获阶段监听（error 不冒泡）');
});

test('失败图片后续加载成功必须恢复显示，且不覆盖原有内联值', () => {
  assert.match(API, /addEventListener\('load'[\s\S]{0,400}data-img-broken/, '必须有 load 恢复逻辑');
  assert.match(API, /data-img-prev-vis/, '必须记录并恢复原有 visibility');
});

test('壁纸图必须先预加载成功，再赋值给可见 img', () => {
  assert.match(WE, /var probeImage = new Image\(\)/, '必须有离线预加载');
  assert.match(WE, /probeImage\.onload[\s\S]{0,1500}image\.src = imageUrl/, '预加载成功后才赋值可见图');
  assert.match(WE, /probeImage\.onerror[\s\S]{0,300}wallpaperEngineLayerFailed/, '预加载失败必须走失败分支');
  // 可见 img 不允许在预加载之前被直接喂 URL
  const preloadIndex = WE.indexOf('var probeImage = new Image()');
  const directAssign = WE.indexOf('image.src = wallpaperEngineMediaUrl', preloadIndex);
  assert.equal(directAssign, -1, '可见 img 不得直接使用未预加载的 URL');
});
