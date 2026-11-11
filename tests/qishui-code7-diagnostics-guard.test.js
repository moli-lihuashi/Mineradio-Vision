'use strict';

/**
 * 汽水 error_code 7 取证与诊断守卫。
 *
 * 背景（重要，避免后人重复误诊）：
 *   前两轮都把 error_code 7 当成「上游限流（rate_limited）」，前端文案写死
 *   「扫码过于频繁，60 秒后自动重试」。但实测把这条路全部排除了：
 *
 *     probe-qishui-rate-threshold.js  200ms 连打 60 次  → 全是 0
 *     probe-qishui-code7-semantics.js 伪造/作废/空 token → 0 / 0 / 3
 *     probe-qishui-mfa-resend.js      _mfaDone 态轮询    → 全是 0（但请求数翻倍）
 *
 *   即：7 与频率、累计配额、token 状态、设备身份都无关，离线复现不出来。
 *   它只在「真实扫码 + 二次验证」这条路上出现，因此**必须靠真实链路取证**，
 *   不能继续靠猜。本守卫锁住三件事：
 *
 *   1) 服务端 /api/qishui/login/check 必须保留 error_code 取证埋点
 *      —— 否则下次再复现，仍然没有任何证据可用；
 *   2) 埋点必须记录 error_code / status / elapsed 三个判据
 *      —— 只记 error_code 无法区分「上游真返回 7」和「本地映射出错」；
 *   3) cookieDebugLog 必须经由 routeCtx 注入
 *      —— 路由文件位于 server/routes/，无法直接 require server.js 的私有函数。
 *
 * 纯静态断言，不启动 Electron、不联网。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const ROUTE = readSource('server/routes/qishui.js');
const SERVER = readSource('server.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (err) {
    failures.push({ name, message: err && err.message });
    console.log('FAIL ' + name + ' — ' + (err && err.message));
  }
}

// ---- 1. routeCtx 必须注入 cookieDebugLog ----
check('server.js 的 routeCtx 注入 cookieDebugLog', () => {
  assert.ok(
    /\bcookieDebugLog\b\s*,?\s*\n\s*\};/.test(SERVER) || /^\s*cookieDebugLog,\s*$/m.test(SERVER),
    'routeCtx 聚合表里必须带上 cookieDebugLog，否则路由拿不到日志出口',
  );
});

// ---- 2. 汽水路由必须从 ctx 解构出 cookieDebugLog ----
check('server/routes/qishui.js 从 ctx 解构 cookieDebugLog', () => {
  assert.ok(
    /cookieDebugLog\s*,/.test(ROUTE),
    'qishui 路由必须从 ctx 解构 cookieDebugLog',
  );
});

// ---- 3. check 接口必须保留取证埋点 ----
check('/api/qishui/login/check 保留 error_code 取证埋点', () => {
  const idx = ROUTE.indexOf("'/api/qishui/login/check'");
  assert.ok(idx >= 0, '必须保留 check 接口');
  const block = ROUTE.slice(idx, idx + 2600);
  assert.ok(
    /\[QishuiCheck\]/.test(block),
    'check 接口必须写 [QishuiCheck] 取证日志：7 的真实触发条件只能靠真实链路留痕',
  );
});

// ---- 4. 埋点必须记录三个核心判据 ----
check('取证埋点记录 error_code / status / elapsed', () => {
  const idx = ROUTE.indexOf('[QishuiCheck]');
  assert.ok(idx >= 0, '找不到取证埋点');
  const block = ROUTE.slice(idx, idx + 900);
  assert.ok(/error_code=/.test(block), '必须记录 error_code');
  assert.ok(/status=/.test(block), '必须记录上游 status（区分 new/scanned/confirmed）');
  assert.ok(/elapsed=/.test(block), '必须记录耗时（区分「上游慢」与「被限流」）');
});

// ---- 5. 埋点不得泄露完整 token / cookie ----
check('取证埋点不记录完整 token 或 cookie 明文', () => {
  const idx = ROUTE.indexOf('[QishuiCheck]');
  const block = ROUTE.slice(idx, idx + 900);
  assert.ok(
    /slice\(0,\s*8\)/.test(block),
    'token 必须截断（slice(0,8)），只用于对齐同一次登录，不能落全量明文',
  );
  assert.ok(
    !/cookie=/.test(block),
    '取证日志不得写入 cookie',
  );
});

// ---- 6. 埋点必须能标出 code7 ----
check('error_code===7 时埋点有显式标记', () => {
  const idx = ROUTE.indexOf('[QishuiCheck]');
  const block = ROUTE.slice(idx, idx + 900);
  assert.ok(
    /errorCode\s*===\s*7/.test(block),
    '必须在 7 时打显式标记，方便直接在日志里 grep 定位',
  );
});

// ---- 7. 埋点不能吞掉主流程异常 ----
check('取证埋点自身异常不影响登录流程', () => {
  const idx = ROUTE.indexOf('[QishuiCheck]');
  assert.ok(idx >= 0, '找不到取证埋点');
  const before = ROUTE.slice(Math.max(0, idx - 900), idx);
  assert.ok(
    /try\s*\{/.test(before),
    '埋点必须包在 try 里：日志失败绝不能打断登录',
  );
});

// ---- 8. 不得把 7 的语义写成「确定是限流」 ----
check('7 的语义标注为待确认（不得再断言就是限流）', () => {
  // 定位「映射成 rate_limited」的那个分支，而不是埋点里的判断。
  const idx = ROUTE.indexOf("status = 'rate_limited'");
  assert.ok(idx >= 0, "必须保留 7 → rate_limited 的映射（前端文案依赖它）");
  const block = ROUTE.slice(Math.max(0, idx - 600), idx + 200);
  // 允许保留 rate_limited 映射，但旁边必须有「待确认/复现不出/需真实链路取证」说明
  assert.ok(
    /(复现|取证|待确认|真实链路)/.test(block),
    '7 的语义尚未确认，代码里必须保留「需真实链路取证」的说明，避免后人再次直接当成限流',
  );
});

const total = passed + failures.length;
console.log('');
console.log(`${passed} passed, ${failures.length} failed (共 ${total} 项)`);
if (failures.length) {
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
  process.exit(1);
}
