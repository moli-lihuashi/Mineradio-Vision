'use strict';

/*
 * 界面缩放守卫（2026-11-25）
 *
 * 对应 Folia 的 `uiZoom`。做法是 webContents.setZoomFactor，不是给 body 加 CSS zoom：
 * Chromium 的 zoom 会同步缩小 CSS 视口（innerWidth 变小），绝对定位、媒体查询、
 * canvas 尺寸都跟着走；CSS zoom 只改绘制，WebGL 画布与指针坐标换算会错位。
 *
 * 四个容易翻车的点：
 *   1) setZoomFactor 之后不能再 setZoomLevel(0) —— 那等于重置回 100%，缩放永远不生效；
 *   2) showMainWindowSafely 以前每次都 reset 到 1，必须改成「按设置应用」；
 *   3) 壁纸模式是销毁重建窗口 + 页面重载，缩放要在 did-finish-load 重放，否则切一次就回到 100%；
 *   4) 落盘不能写 app.getPath('userData')：setPath('cache') 会把它篡改成缓存目录
 *      （cache-settings.json 那次踩过），必须用 _STABLE_USER_DATA。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'desktop/preload.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/08-cache-storage-settings.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const fnBody = (source, marker) => {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return '';
};

test('缩放值钳在 90%–120%，并按 0.01 取整', () => {
  const normalize = fnBody(MAIN, 'function normalizeUiZoom');
  assert.ok(normalize, '必须有 normalizeUiZoom');
  assert.match(normalize, /UI_ZOOM_MIN/, '要有下限');
  assert.match(normalize, /UI_ZOOM_MAX/, '要有上限');
  assert.match(normalize, /Math\.round\(n \* 100\) \/ 100/, '要按 0.01 取整，避免 1.1000000000000001');
  assert.match(MAIN, /const UI_ZOOM_MIN = 0\.9/);
  assert.match(MAIN, /const UI_ZOOM_MAX = 1\.2/);
});

test('normalizeUiZoom 的实际行为：越界钳制、脏值回 1', () => {
  /* 直接把源码里的函数体拿出来执行，避免只靠正则「看起来对了」。 */
  const src = fnBody(MAIN, 'function normalizeUiZoom');
  const fn = new Function('UI_ZOOM_MIN', 'UI_ZOOM_MAX', src + '; return normalizeUiZoom;')(0.9, 1.2);
  assert.equal(fn(9), 1.2);
  assert.equal(fn(-3), 0.9);
  assert.equal(fn('1.1000000000000001'), 1.1);
  assert.equal(fn('abc'), 1);
  assert.equal(fn(undefined), 1);
  assert.equal(fn(1), 1);
});

test('落盘走 _STABLE_USER_DATA，不能用会被 setPath 篡改的 userData', () => {
  const pathFn = fnBody(MAIN, 'function uiZoomPath');
  assert.match(pathFn, /_STABLE_USER_DATA/, '必须用稳定路径');
  assert.doesNotMatch(pathFn, /app\.getPath\('userData'\)/,
    'setPath(cache) 之后 getPath(userData) 指向缓存目录，偏好会跟着搬家');
  const save = fnBody(MAIN, 'function saveUiZoom');
  assert.match(save, /\.tmp/, '写临时文件再 rename，避免半截 JSON');
});

test('应用缩放只调 setZoomFactor，不能顺手续一个 setZoomLevel(0)', () => {
  const apply = fnBody(MAIN, 'function applyMainWindowZoom');
  assert.ok(apply, '必须有 applyMainWindowZoom');
  assert.match(apply, /setZoomFactor\(/, '必须真正设置缩放');
  assert.doesNotMatch(apply, /setZoomLevel\(0\)/,
    'setZoomLevel(0) 等于把缩放重置回 100%，会让设置永远不生效');
});

test('显示窗口与页面加载完成都按设置应用缩放', () => {
  const show = fnBody(MAIN, 'function showMainWindowSafely');
  assert.match(show, /applyMainWindowZoom\(win\)/, '每次显示都要按设置应用');
  assert.doesNotMatch(show, /resetMainWindowZoom/, '不能每次显示又打回 100%');
  const load = MAIN.slice(MAIN.indexOf("mainWindow.webContents.on('did-finish-load'"), MAIN.indexOf("mainWindow.webContents.on('did-finish-load'") + 500);
  assert.match(load, /applyMainWindowZoom\(mainWindow\)/,
    '壁纸模式会重载页面，did-finish-load 必须重放缩放');
});

test('IPC 与 preload 三段齐全，差值只在主窗上应用', () => {
  assert.match(MAIN, /ipcMain\.handle\('mineradio-get-ui-zoom'/);
  assert.match(MAIN, /ipcMain\.handle\('mineradio-set-ui-zoom'/);
  assert.match(PRELOAD, /setUiZoom:\s*\(factor\)/);
  assert.match(PRELOAD, /getUiZoom:\s*\(\)/);
  const setter = fnBody(MAIN, "ipcMain.handle('mineradio-set-ui-zoom'");
  assert.match(setter, /win === mainWindow/, '只对主窗应用，别去动桌面歌词/小组件');
});

test('设置页有 4 档，并在启动时把已存值推给主进程', () => {
  assert.match(INDEX, /id="ui-zoom-seg"/);
  for (const v of ['0.9', '1', '1.1', '1.2']) {
    assert.match(INDEX, new RegExp(`data-ui-zoom="${v.replace('.', '\\.')}"`), `缺少 ${v} 档`);
  }
  assert.match(INDEX, /<button data-ui-zoom="1" class="active"/, '默认选中 100%');
  assert.match(SETTINGS_JS, /mineradio:ui-zoom:v1/, '前端也要存一份，重启后推给主进程');
  assert.match(SETTINGS_JS, /applyStoredUiZoom\(\)/, '初始化时要推一次');
});
