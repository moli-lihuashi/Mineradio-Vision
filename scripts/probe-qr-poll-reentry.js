'use strict';

/**
 * 探针：二维码轮询「重入叠加」验证 + 守卫。
 *
 * 症状（用户截图）：汽水扫码页二维码正常，但状态栏一直提示
 * 「扫码过于频繁，60 秒后自动重试…」，永远登不上。
 *
 * 已排除：
 *   - 请求姿势/参数/签名：用随机身份实测 check_qrconnect 全返回 error_code=0。
 *   - 2 秒固定间隔本身：3 次轮询 [0,0,0]，上游并不介意这个频率。
 *
 * 真正怀疑的缺陷：
 *   startQrPoll() = setInterval(checkQr, 2000)，而 checkQr 是 async 且**无防重入锁**。
 *   汽水分支里 apiJson 会同步等主进程完成 check_qrconnect；一旦上游返回 2046
 *   触发二次验证，这次 await 会挂到用户操作完（可达数分钟）。期间 setInterval
 *   每 2 秒继续点火 → 并发叠加 N 个在途请求 → 上游按频率判 error_code 7。
 *   而 7 又会停轮询 + 等 60 秒，用户回来后继续叠加，形成死循环。
 *
 * 本探针用 vm 加载真实的 03-login-modal-flows.js 片段行为不现实（依赖太多 DOM），
 * 改为**直接对源码做结构断言** + 用等价最小模型跑行为验证：
 *   1) 源码里 checkQr 必须有防重入标志；
 *   2) 等价模型：慢响应下，无锁版本会叠加，有锁版本不会。
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const FLOWS = path.join(ROOT, 'public', 'js', 'modules', '08-account', '03-login-modal-flows.js');
const GLOBALS = path.join(ROOT, 'public', 'js', 'modules', '00-state', '12a-audio-login-globals.js');

const results = [];
const check = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const src = fs.readFileSync(FLOWS, 'utf8');
const globals = fs.readFileSync(GLOBALS, 'utf8');

// ---- 1) 结构断言：checkQr 必须有防重入 ----
// 汽水分支（loginProvider === 'qishui'）里必须存在「在途标志」的置位/清除。
const hasInflightFlag =
  /qrCheckInFlight\s*=\s*true/.test(src) && /qrCheckInFlight\s*=\s*false/.test(src);
check(hasInflightFlag, 'checkQr 有 qrCheckInFlight 防重入标志（置位+清除）');

// 标志必须在 checkQr 入口处就 return，而不是事后判断。
// 语义是「防护必须发生在任何 await 之前」——只要先 await 了，锁就已经失效。
// 不要写成匹配具体函数签名（checkQr = async function() 这种赋值式重写会让
// `async function checkQr()` 的正则匹配不到，断言就变成假失败）。
const fnIdx = src.indexOf('checkQr = async function');
const bodyStart = fnIdx >= 0 ? src.indexOf('{', fnIdx) : -1;
const bodySlice = bodyStart >= 0 ? src.slice(bodyStart, bodyStart + 1600) : '';
const guardIdx = bodySlice.search(/if\s*\(\s*qrCheckInFlight\s*\)\s*return/);
// 只匹配真正的 await 表达式（await 后接标识符/括号），避免被注释里
// 出现的「这次 await 会一直挂到…」这类中文说明误判成先 await 了。
const firstAwaitIdx = bodySlice.search(/\bawait\s+[\w$(]/);
const guardAtEntry = guardIdx >= 0 && (firstAwaitIdx < 0 || guardIdx < firstAwaitIdx);
check(guardAtEntry, 'checkQr 入口处立即 return（在任何 await 之前）',
  guardIdx >= 0 ? `guard@${guardIdx} < await@${firstAwaitIdx}` : '未找到入口防护');

// finally 必须清除，否则一次异常就永久卡死轮询。
const clearsInFinally = /finally\s*\{[\s\S]{0,300}?qrCheckInFlight\s*=\s*false/.test(src);
check(clearsInFinally, '标志在 finally 里清除（异常也不会永久卡死）');

// ---- 2) 全局声明存在 ----
const declared = /var\s+qrCheckInFlight\s*=\s*false/.test(globals) || /qrCheckInFlight\s*=\s*false/.test(globals);
check(declared, 'qrCheckInFlight 在 12a-audio-login-globals.js 里声明');

// ---- 2b) 代际保护：单纯一个布尔锁会带来两个反向缺陷 ----
// 缺陷 A（死锁）：某次 checkQr 永久不落定（二次验证窗关了但 promise 没 settle），
//   布尔锁永远 true，用户刷新二维码换了新 token 也被入口 return 掉，界面从此不动。
// 缺陷 B（误清）：用户刷新后旧一轮才落定，finally 无条件清锁，把新一轮的锁抹掉。
const hasSerialDecl = /var\s+qrCheckSerial\s*=\s*0/.test(globals);
check(hasSerialDecl, '声明了 qrCheckSerial 轮询代际计数器');

// stopQrPoll 必须推进代际并主动让出锁，否则永不落定的在途请求会造成死锁。
const stopBody = (() => {
  const i = src.indexOf('function stopQrPoll()');
  return i >= 0 ? src.slice(i, i + 900) : '';
})();
check(/qrCheckSerial\+\+/.test(stopBody) && /qrCheckInFlight\s*=\s*false/.test(stopBody),
  'stopQrPoll() 推进代际并释放锁（防永不落定导致的死锁）');

// finally 必须只释放自己持有的那一代，不能无条件清。
const serialGuard = /if\s*\(\s*qrCheckHolder\s*===\s*mySerial\s*\)/.test(src);
check(serialGuard, 'finally 只释放自己持有的那一代（防旧轮误清新轮的锁）');

// 入口处必须记下自己这一代。
check(/var\s+mySerial\s*=\s*\+\+qrCheckSerial/.test(src), '入口处记录本次轮询的代际');

// await 之后必须丢弃陈旧轮次，否则旧 token 的结果会覆盖新二维码状态，
// 且它内部的 stopQrPoll() 会误停新一轮轮询（「刷新完闪一下就不动了」）。
const staleGuardCount = (src.match(/if\s*\(\s*qrCheckHolder\s*!==\s*mySerial\s*\)\s*return/g) || []).length;
check(staleGuardCount >= 2,
  'await 之后丢弃陈旧轮次（酷狗 / 汽水两条分支都覆盖）',
  `找到 ${staleGuardCount} 处`);

// ---- 3) 行为验证：等价最小模型 ----
// 无锁版：setInterval 每 tick 都发，慢响应必然叠加。
async function runModel(withLock) {
  let inFlight = false;
  let concurrent = 0;
  let peak = 0;
  let started = 0;

  const slowRequest = () => new Promise(r => setTimeout(r, 300)); // 模拟 300ms 慢响应

  const tick = async () => {
    if (withLock && inFlight) return;
    inFlight = true;
    started += 1;
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    try {
      await slowRequest();
    } finally {
      concurrent -= 1;
      inFlight = false;
    }
  };

  // 用 100ms 间隔打 1 秒，模拟「间隔 < 响应耗时」
  const timer = setInterval(tick, 100);
  await new Promise(r => setTimeout(r, 1000));
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 400)); // 等在途的收尾
  return { peak, started };
}

(async () => {
  const noLock = await runModel(false);
  const locked = await runModel(true);

  console.log(`\n无锁模型: peak 并发=${noLock.peak}, 发起=${noLock.started}`);
  console.log(`有锁模型: peak 并发=${locked.peak}, 发起=${locked.started}\n`);

  check(noLock.peak > 1, '无锁模型确实会并发叠加（复现缺陷）', `peak=${noLock.peak}`);
  check(locked.peak === 1, '有锁模型峰值并发恒为 1（修复有效）', `peak=${locked.peak}`);
  check(locked.started < noLock.started, '有锁模型发起次数更少（不再堆积）',
    `${locked.started} < ${noLock.started}`);

  // ---- 4) 行为验证：死锁场景 ----
  // 模拟「某次 checkQr 永不落定 + 用户点刷新二维码」，对比布尔锁与代际锁。
  // 布尔锁：锁永远 true → 刷新后新 token 一次都检查不到 → 界面彻底不动。
  // 代际锁：stopQrPoll() 推进代际并让锁 → 新一轮立刻能跑。
  function runStuckModel(withSerial) {
    let inFlight = false;
    let serial = 0;
    let holder = 0;
    let newRoundRan = 0;

    // 第一次轮询挂死，永不 settle
    const stuck = new Promise(() => {});
    inFlight = true;
    if (withSerial) { holder = ++serial; }

    // 用户点「刷新二维码」→ stopQrPoll()
    if (withSerial) { serial++; inFlight = false; holder = 0; }
    // 布尔锁版本这里什么都不做，inFlight 仍是 true

    // 新一轮轮询
    if (!inFlight) {
      inFlight = true;
      if (withSerial) { const my = ++serial; holder = my; }
      newRoundRan += 1;
    }
    void stuck;
    return { newRoundRan };
  }

  const stuckBool = runStuckModel(false);
  const stuckSerial = runStuckModel(true);
  check(stuckBool.newRoundRan === 0, '【复现】布尔锁在"请求挂死+用户刷新"后彻底停摆',
    `新一轮执行次数=${stuckBool.newRoundRan}`);
  check(stuckSerial.newRoundRan === 1, '【修复】代际锁在同样场景下仍能继续轮询',
    `新一轮执行次数=${stuckSerial.newRoundRan}`);

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
