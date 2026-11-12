'use strict';

/**
 * 汽水 host 页「版本自愈重载」探针（真 Electron）。
 *
 * 背景：本次实测踩到的坑——主进程 14:01 启动，15:21 才把
 * security_host.html 的「组件 URL 补 .js」修复同步进 dist，结果已运行实例
 * 仍报旧的「二次验证组件加载失败」。原因是 _initialize() 只在首次建窗口时
 * loadURL 一次，页面 JS 常驻内存，磁盘更新对已运行实例无效。
 *
 * 修法是 initialize() 里按 __qishuiHostVersion 比对，落后就重载。
 * 本探针直接驱动真实模块的 ensureHostPageFresh()：
 *   1) 页面版本 >= EXPECTED 时不得重载（避免每次请求都白重载）；
 *   2) 把页面版本人为改小（模拟旧页面驻留）后，必须触发重载；
 *   3) 重载后页面必须回到新版本，且 bdms 仍就绪（后续 request 才能签名）。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node scripts/probe-qishui-host-reload.js
 *   env -u ELECTRON_RUN_AS_NODE node scripts/probe-qishui-host-reload.js \
 *     --asset-dir dist/Mineradio/resources/app/qishui-auth-v6
 */

const path = require('path');
const { app } = require('electron');

const APP_ROOT = path.join(__dirname, '..');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '');
}
const ASSET_DIR = argValue('--asset-dir')
  ? path.resolve(argValue('--asset-dir'))
  : path.join(APP_ROOT, 'qishui-auth-v6');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  await app.whenReady();

  // 用生产模块本体，而不是复制一份逻辑：探针要验的就是真实代码路径。
  const authPath = path.join(ASSET_DIR, '..', 'qishui-auth-v6.js');
  const auth = require(authPath);
  const config = {};
  auth.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  console.log('=== QISHUI HOST RELOAD PROBE ===');
  console.log('  assetDir: ' + ASSET_DIR);

  // 建立真实窗口（会 loadURL security_host.html 并等 bdms）
  await auth.initSignEngine();
  const runtime = auth.__getRuntime();
  check('初始化后拿到 runtime 实例', !!runtime, runtime ? 'ok' : 'no runtime');
  if (!runtime) {
    console.log('\n0 passed, 1 failed, 1 total');
    app.exit(1);
    return;
  }

  const win = runtime.window;
  check('初始化后窗口已创建', !!(win && !win.isDestroyed()), win ? 'ok' : 'no window');

  const versionAfterInit = await win.webContents.executeJavaScript(
    'Number(window.__qishuiHostVersion) || 0', true,
  );
  check(
    '页面声明了 __qishuiHostVersion',
    versionAfterInit >= 1,
    'version=' + versionAfterInit,
  );

  // 1) 已是最新版本时不得重载
  const reloadedWhenFresh = await runtime.ensureHostPageFresh();
  check(
    '页面已最新时不重载',
    reloadedWhenFresh === false,
    'returned=' + reloadedWhenFresh,
  );

  // 2) 模拟「旧页面驻留」：把版本号改小 + 清掉已比对标记
  await win.webContents.executeJavaScript('window.__qishuiHostVersion = 0; true', true);
  runtime._hostVersionChecked = false;
  const reloadedWhenStale = await runtime.ensureHostPageFresh();
  check(
    '页面版本落后时触发重载',
    reloadedWhenStale === true,
    'returned=' + reloadedWhenStale,
  );

  // 3) 重载后必须回到新版本，且 bdms 仍就绪（否则后续 request 无法签名）
  const afterReload = await win.webContents.executeJavaScript(`({
    version: Number(window.__qishuiHostVersion) || 0,
    bdms: Boolean(window.bdms),
    secondVerify: typeof window.ucWebSecondVerify,
    candidates: typeof verifyScriptCandidates === 'function',
  })`, true);
  check(
    '重载后页面回到新版本',
    afterReload.version >= 1,
    'version=' + afterReload.version,
  );
  check(
    '重载后 bdms 仍就绪',
    afterReload.bdms === true,
    'bdms=' + afterReload.bdms,
  );
  check(
    '重载后补后缀逻辑可用',
    afterReload.candidates === true,
    'verifyScriptCandidates=' + (afterReload.candidates ? 'function' : 'missing'),
  );

  // 4) 缓存生效：再次调用不应重复重载
  const secondCall = await runtime.ensureHostPageFresh();
  check(
    '重载后置位缓存，再次调用不再重载',
    secondCall === false,
    'returned=' + secondCall,
  );

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  try { await auth.clear(); } catch (_) {}
  app.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[probe error]', err && err.stack || err);
  app.exit(1);
});
