'use strict';

// =============================================================================
// 本地静态资源的缓存策略回归
// 背景：desktop-lyrics.html / wallpaper.html 这类覆盖层页面里装着全部渲染逻辑，
// 曾经落到兜底的 `public, max-age=300`。于是「改完代码 → 重启 → 界面一点没变」，
// 因为 5 分钟内 Chromium 直接用磁盘缓存里的旧页面（连 ETag 都不问）。
// 覆盖：extractFunction 跑 server.js 里的真实 staticCacheControlForPath 源码。
// =============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const serverPath = path.join(appRoot, 'server.js');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('未找到函数 ' + name);
  let i = source.indexOf('{', start);
  if (i < 0) throw new Error('函数 ' + name + ' 缺少函数体');
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', i);
      if (lineEnd < 0) break;
      i = lineEnd;
      continue;
    }
    if (ch === '/' && next === '*') {
      const blockEnd = source.indexOf('*/', i);
      if (blockEnd < 0) break;
      i = blockEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === quote) break;
      }
      continue;
    }
    // 模板串里的 ${...} 不影响本函数，函数体内没有正则字面量
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 括号不配对');
}

const context = vm.createContext({ console: console });
vm.runInContext(
  extractFunction(readSource(serverPath), 'staticCacheControlForPath'),
  context,
  { filename: 'server.static-cache.slice.js' }
);
const policy = context.staticCacheControlForPath;

function staleWindow(policyValue) {
  const m = /max-age\s*=\s*(\d+)/i.exec(String(policyValue || ''));
  return m ? Number(m[1]) : 0;
}

function testOverlayPagesAreRevalidated() {
  // 覆盖层页面是重点：它们承载全部渲染逻辑，绝不能被缓存成「5 分钟内不变」
  ['public/desktop-lyrics.html', 'public/wallpaper.html'].forEach(function (file) {
    const value = policy(path.join(appRoot, file));
    assert.strictEqual(value, 'no-cache', file + ' 必须是 no-cache（每次带 ETag revalidate），实际 ' + value);
    assert.strictEqual(staleWindow(value), 0, file + ' 不能带 max-age 新鲜期');
    assert.ok(!/immutable/.test(value), file + ' 不能 immutable');
  });
  // index.html 仍然用最严格的 no-store
  const indexValue = policy(path.join(appRoot, 'public', 'index.html'));
  assert.ok(/no-store/.test(indexValue), 'index.html 必须 no-store，实际 ' + indexValue);
}

function testModulesAndAssetsRevalidate() {
  const files = [
    'public/js/modules/07-fx/07-bindings-shelf-immersive.js',
    'public/css/07-fx/fx-panel.css',
    'public/assets/cover.png',
    'public/vendor/three.min.js',
  ];
  files.forEach(function (file) {
    const value = policy(path.join(appRoot, file));
    assert.strictEqual(value, 'no-cache', file + ' 应 revalidate，实际 ' + value);
  });
}

function testUnknownBinariesMayCache() {
  // 大文件（音频、字体包以外的二进制）仍然允许短缓存，避免每次全量重传
  const value = policy(path.join(appRoot, 'data', 'cache', 'sample.bin'));
  assert.ok(staleWindow(value) > 0, '未知二进制仍可保留短缓存，实际 ' + value);
}

function testWindowsSeparatorsAreHandled() {
  // 主进程传进来的是平台路径（Windows 上带反斜杠），不能被漏判
  const value = policy('D:\\app\\public\\desktop-lyrics.html');
  assert.strictEqual(value, 'no-cache', 'Windows 反斜杠路径也要识别成 HTML 页面，实际 ' + value);
}

async function run() {
  testOverlayPagesAreRevalidated();
  testModulesAndAssetsRevalidate();
  testUnknownBinariesMayCache();
  testWindowsSeparatorsAreHandled();
  console.log('OK static-asset-cache-policy');
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
