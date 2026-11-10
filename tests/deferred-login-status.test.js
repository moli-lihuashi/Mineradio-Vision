'use strict';

// 「重启后只显示酷狗，汽水要点一下登录才回来」回归守。
//
// 根因是加载波次：bootstrapStartupLoginStatus() 在主波顶层跑，里面给每个平台写了
// typeof 守卫；refreshQishuiLoginStatus / refreshSpotifyLoginStatus 却住在延迟波，
// 守卫当时判 false → 这两家整轮启动都不读状态。修法是延迟波注入完成后补刷一次。
//
// 守四件事：
//   ① 波次事实：boot 在主波、两家刷新函数在延迟波（这个陷阱不能悄悄消失/反转）；
//   ② 启动期确实会跳过这两家（复现用户看到的 bug，别把「跳过」当成正常行为抹掉）；
//   ③ 延迟波注入后的钩子接上了，且没有覆盖 __onDeferredModulesReady；
//   ④ 补刷函数真的刷两家、全部落定后再统一 renderUserBtn，且只跑一次、容错。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const loaderSrc = read('public/js/index-loader.js');
const statusSrc = read('public/js/modules/08-account/02-login-status.js');
const bootSrc = read('public/js/modules/10-shell/01-splash-and-boot.js');
const globalsSrc = read('public/js/modules/00-state/12a-audio-login-globals.js');

/* 按大括号配对取顶层函数（函数体里有嵌套花括号，不能用正则截断） */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 没有闭合');
}

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, '未找到起点 ' + from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, '未找到终点 ' + to);
  return source.slice(a, b);
}

const mainStart = loaderSrc.indexOf('const modulePaths = [');
const deferredStart = loaderSrc.indexOf('const deferredModulePaths = [');
const deferredEnd = loaderSrc.indexOf('];', deferredStart);

test('波次事实：boot 在主波，汽水/Spotify 的状态刷新函数确实在延迟波', () => {
  assert.ok(mainStart >= 0 && deferredStart > mainStart, 'index-loader 里两波数组的顺序被改了');
  assert.ok(deferredEnd > deferredStart, '延迟波数组没有闭合');
  const mainWave = loaderSrc.slice(mainStart, deferredStart);
  const deferredWave = loaderSrc.slice(deferredStart, deferredEnd);

  assert.match(mainWave, /js\/modules\/10-shell\/01-splash-and-boot\.js/, 'boot 必须在主波');
  assert.match(mainWave, /js\/modules\/08-account\/02-login-status\.js/, '登录态公共出口必须在主波');
  assert.match(deferredWave, /js\/modules\/08-account\/02-qishui-login\.js/, '汽水刷新函数所在的模块必须在延迟波');
  assert.match(deferredWave, /js\/modules\/08-account\/03-login-modal-flows\.js/, 'Spotify 刷新函数所在的模块必须在延迟波');
  assert.doesNotMatch(mainWave, /02-qishui-login\.js/, '谁把汽水搬进主波了？那 bootstrap 的守卫就会真跑，本测试的复现前提不再成立');
});

test('复现 bug 的前提：主波跑 bootstrap 时，两家刷新函数都还没定义，会被 typeof 守卫跳过', () => {
  const bootFn = extractFunction(bootSrc, 'bootstrapStartupLoginStatus');
  assert.match(bootFn, /typeof refreshQishuiLoginStatus === 'function' \? refreshQishuiLoginStatus\(\) : Promise\.resolve\(null\)/,
    '启动期汽水走的是 typeof 守卫');
  assert.match(bootFn, /typeof refreshSpotifyLoginStatus === 'function' \? refreshSpotifyLoginStatus\(\) : Promise\.resolve\(null\)/,
    '启动期 Spotify 走的是 typeof 守卫');

  const ctx = {
    Promise,
    startupLoginStatusPromise: null,
    refreshLoginStatus: () => Promise.resolve('ne'),
    refreshQQLoginStatus: () => Promise.resolve('qq'),
    refreshKugouLoginStatus: () => Promise.resolve('kg'),
    refreshBuiltInPlaylists: () => Promise.resolve('builtin'),
    restorePersistedLocalLibrary: () => Promise.resolve('local'),
    // 延迟波尚未注入 —— 主波 boot 的真实处境
    refreshQishuiLoginStatus: undefined,
    refreshSpotifyLoginStatus: undefined,
  };
  vm.runInNewContext(bootFn + '\nbootstrapStartupLoginStatus();', ctx);
  return ctx.startupLoginStatusPromise.then((results) => {
    assert.strictEqual(results[0], 'ne');
    assert.strictEqual(results[1], 'qq');
    assert.strictEqual(results[2], 'kg');
    assert.strictEqual(results[3], null, '汽水此刻被跳过（正是用户看到的症状）');
    assert.strictEqual(results[4], null, 'Spotify 此刻被跳过（同一个坑）');
  });
});

test('index-loader 延迟波落地后调用补刷钩子，且不占用已有的 __onDeferredModulesReady', () => {
  const injectFn = extractFunction(loaderSrc, 'injectDeferredCombined');
  assert.match(injectFn, /appendChild\(script\);/, '钩子必须在 script 真正挂进 DOM（即执行完）之后');
  const afterAppend = injectFn.slice(injectFn.indexOf('appendChild(script);'));
  assert.match(afterAppend, /if \(typeof window\.__onDeferredModulesReady === 'function'\) window\.__onDeferredModulesReady\(\);/,
    '原来的 FX 面板钩子必须还在');
  assert.match(afterAppend, /if \(typeof window\.__onDeferredLoginStatusReady === 'function'\) window\.__onDeferredLoginStatusReady\(\);/,
    '延迟波就绪后必须补刷登录态');
  assert.doesNotMatch(loaderSrc, /window\.__onDeferredModulesReady\s*=(?!=)/,
    '别在 loader 里抢占 07-bindings-shelf-immersive.js 的钩子');
});

test('补刷函数：两家都刷、落定后统一重画、只跑一次', async () => {
  const slice = between(statusSrc,
    'var deferredProviderLoginRefreshDone = false;',
    'function startQishuiLoginStatusAutoRefresh()');
  const calls = [];
  const ctx = {
    window: {},
    console: { warn() {} },
    Promise,
    setTimeout,
    // 故意让汽水慢一拍：Promise.race 会在 Spotify 返回时就重画，等不到汽水 —— 正是本项要堵的
    refreshQishuiLoginStatus: () => new Promise((resolve) => {
      setTimeout(() => { calls.push('qishui'); resolve({ loggedIn: true }); }, 25);
    }),
    refreshSpotifyLoginStatus: () => { calls.push('spotify'); return Promise.resolve({ loggedIn: false }); },
    renderUserBtn: () => { calls.push('render'); },
  };
  vm.runInNewContext(slice, ctx);

  assert.strictEqual(typeof ctx.window.__onDeferredLoginStatusReady, 'function',
    '钩子必须挂到 window 上，index-loader 才调得到');
  const first = ctx.window.__onDeferredLoginStatusReady();
  assert.strictEqual(first, true, '首次补刷应真的执行');
  await new Promise((r) => setTimeout(r, 90));

  assert.deepStrictEqual(calls.slice(0, 2).sort(), ['qishui', 'spotify'], '两家登录态都要补刷');
  assert.strictEqual(calls[calls.length - 1], 'render', '最后统一重画，不能谁先返回谁说了算');
  assert.strictEqual(calls.filter((c) => c === 'render').length, 1, '统一重画只做一次');

  const second = ctx.window.__onDeferredLoginStatusReady();
  assert.strictEqual(second, false, '重复注入不能再刷一遍');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 3, '重复调用不得产生额外请求');
});

test('补刷函数：任一家请求抛错也不能拖垮另一家 / 不能漏掉重画', async () => {
  const slice = between(statusSrc,
    'var deferredProviderLoginRefreshDone = false;',
    'function startQishuiLoginStatusAutoRefresh()');
  const calls = [];
  const ctx = {
    window: {},
    console: { warn() {} },
    Promise,
    refreshQishuiLoginStatus: () => Promise.reject(new Error('qishui offline')),
    refreshSpotifyLoginStatus: () => { calls.push('spotify'); return Promise.resolve({ loggedIn: false }); },
    renderUserBtn: () => { calls.push('render'); },
  };
  vm.runInNewContext(slice, ctx);
  ctx.window.__onDeferredLoginStatusReady();
  await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes('spotify'), '一家失败不能连坐另一家');
  assert.strictEqual(calls[calls.length - 1], 'render', '失败也要把顶栏重画一次');
});

test('未补刷时汽水默认就是未登录（守卫跳过 = 顶栏画不出第二颗头像）', () => {
  const decl = between(globalsSrc, 'var qishuiLoginStatus = {', '};');
  assert.match(decl, /loggedIn:\s*false/, '12a 的初始态必须是未登录');
  const renderFn = extractFunction(statusSrc, 'renderUserBtn');
  assert.match(renderFn, /\['netease', 'qq', 'kugou', 'qishui', 'spotify'\]\.forEach\(function \(p\) \{[\s\S]*?hasPlatformLogin\(p\)/,
    '顶栏头像数按五家登录态统计');
  assert.match(renderFn, /if \(loggedCount > 1\)/, '两家登录才画多头像');
});
