'use strict';

/* 死模块守卫：防止「文件存在但没被加载」的陷阱再次出现。
 * 背景：05-prismal-fill.js / 09b-playback-core.js 都是磁盘上存在、编辑器能改，
 * 但根本不在任何加载通道里 —— 改了不生效，且让人误以为修好了。
 *
 * 判定：public/js/modules 下每个 .js 必须满足其一：
 *   1) 在 index-loader 的 modulePaths / deferredModulePaths 里；
 *   2) 被某个 public/*.html 的 <script src> 直接加载；
 *   3) 在 DYNAMIC_ASSETS 白名单（按 URL 动态加载，如 AudioWorklet）。
 * 反向也要查：加载表里的路径必须真实存在。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const DYNAMIC_ASSETS = [
  // 由 03-beat/08-audio-worklet-bridge.js 通过 audioCtx.audioWorklet.addModule(url) 加载
  'js/modules/03-beat/07-audio-analysis-processor.js',
];

function parseLoaderPaths(loaderText) {
  const coreStart = loaderText.indexOf('const modulePaths');
  const deferredStart = loaderText.indexOf('const deferredModulePaths');
  assert.ok(coreStart >= 0 && deferredStart > coreStart, 'loader lists missing');
  const coreSrc = loaderText.slice(coreStart, deferredStart);
  const deferredSrc = loaderText.slice(deferredStart, loaderText.indexOf('];', deferredStart) + 2);
  const pick = (src) => [...src.matchAll(/'(js\/modules\/[^']+)'/g)].map((m) => m[1]);
  return { core: pick(coreSrc), deferred: pick(deferredSrc) };
}

function listHtmlScripts() {
  const htmls = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/vendor|node_modules/.test(p.replace(/\\/g, '/'))) walk(p);
      } else if (e.name.endsWith('.html')) htmls.push(p);
    }
  })(PUBLIC);
  const out = [];
  for (const file of htmls) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<script[^>]+src="([^"]+\.js)(?:\?[^"]*)?"/g)) {
      out.push(m[1].replace(/^\.?\//, ''));
    }
  }
  return out;
}

function listDiskModules() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(path.relative(PUBLIC, p).replace(/\\/g, '/'));
    }
  })(path.join(PUBLIC, 'js/modules'));
  return out;
}

function audit({ loaderPaths, htmlScripts, diskModules, dynamicAssets }) {
  const loaded = new Set([...loaderPaths, ...htmlScripts, ...dynamicAssets]);
  const orphans = diskModules.filter((p) => !loaded.has(p));
  const missing = [...loaded].filter((p) => p.startsWith('js/') && !fs.existsSync(path.join(PUBLIC, p)));
  return { orphans, missing };
}

test('index-loader 与 HTML 脚本通道并集覆盖全部模块，无死文件、无缺失文件', () => {
  const loader = fs.readFileSync(path.join(PUBLIC, 'js/index-loader.js'), 'utf8');
  const { core, deferred } = parseLoaderPaths(loader);
  // 2026-11-21：+1 = 10-shell/09-wallpaper-stage-sync.js（壁纸模式播放镜像）
  // 2026-11-22：+1 = 10-shell/30-floating-widget-bridge.js（悬浮小组件桥接）
  // 2026-11-23：+1 = 10-shell/31-settings-page.js（设置页开合 / 搜索 / 菜单摘要同步）
  // 2026-11-23：+1 = 10-shell/32-widget-settings-inline.js（皮肤面板里的挂件设置）
  assert.equal(core.length, 136, 'core module count changed — update expectation deliberately');
  assert.equal(deferred.length, 80, 'deferred module count changed — update expectation deliberately');
  const overlap = deferred.filter((p) => core.includes(p));
  assert.deepEqual(overlap, [], 'same module must not load twice across waves');

  const htmlScripts = listHtmlScripts();
  assert.ok(htmlScripts.length >= 15, 'HTML direct-load channel unexpectedly empty');

  const result = audit({
    loaderPaths: [...core, ...deferred],
    htmlScripts,
    diskModules: listDiskModules(),
    dynamicAssets: DYNAMIC_ASSETS,
  });
  assert.deepEqual(result.orphans, [],
    'module files exist but are not loaded by any channel (edit would have no effect): ' + result.orphans.join(', '));
  assert.deepEqual(result.missing, [],
    'loader/HTML references files that do not exist: ' + result.missing.join(', '));
});

test('动态资产白名单仍被真实引用（否则应移除白名单，让它重新受检查）', () => {
  const bridge = fs.readFileSync(path.join(PUBLIC, 'js/modules/03-beat/08-audio-worklet-bridge.js'), 'utf8');
  assert.match(bridge, /07-audio-analysis-processor\.js/);
  assert.match(bridge, /audioWorklet\.addModule/);
  for (const p of DYNAMIC_ASSETS) {
    assert.ok(fs.existsSync(path.join(PUBLIC, p)), 'dynamic asset must exist: ' + p);
  }
});

test('已删除的死模块不得复活，也不得被加载表引用', () => {
  const loader = fs.readFileSync(path.join(PUBLIC, 'js/index-loader.js'), 'utf8');
  for (const dead of ['05-playback/09b-playback-core.js', '06-fx/05-prismal-fill.js']) {
    assert.ok(!fs.existsSync(path.join(PUBLIC, 'js/modules', dead)),
      'dead module must stay deleted: ' + dead);
    assert.ok(!loader.includes(dead), 'loader must not reference deleted module: ' + dead);
  }
});

test('守卫能拦住新增孤儿与缺失引用（突变验证）', () => {
  const loaderPaths = ['js/modules/a.js'];
  const htmlScripts = ['js/modules/b.js'];
  const dynamicAssets = ['js/modules/worklet.js'];
  const base = { loaderPaths, htmlScripts, dynamicAssets };
  const clean = audit({ ...base, diskModules: ['js/modules/a.js', 'js/modules/b.js', 'js/modules/worklet.js'] });
  assert.deepEqual(clean.orphans, []);
  const dirty = audit({ ...base, diskModules: ['js/modules/a.js', 'js/modules/b.js', 'js/modules/new-dead.js'] });
  assert.deepEqual(dirty.orphans, ['js/modules/new-dead.js']);
});
