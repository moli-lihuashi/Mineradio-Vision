'use strict';

/**
 * 登录弹窗 provider 分支状态守卫。
 *
 * 用户实测症状（截图）：手机端提示登录成功，桌面端提示「扫码过于频繁」，
 * 刷新后弹窗里标题/描述/状态文案都在，但中间二维码区域整片空白。
 *
 * 三个独立缺陷叠加：
 *   1) `login-modal-logged-in` 类只在 updateLoginProviderUi() 的通用尾部 toggle，
 *      而汽水 / Spotify 分支在之前就 return 了 → 该类残留。
 *      account.css 的 `.login-modal-logged-in .qr-shell{display:none!important}`
 *      会把二维码整个容器藏掉（copy 区在另一个 grid 区域，照常显示）
 *      → 表现为「标题正常、中间空白」。
 *   2) logoutLoginProvider() 的 provider 白名单漏了 qishui，会把 'qishui'
 *      归成 'netease' → 点「退出汽水」实际退的是网易云。
 *   3) refreshQr() 汽水分支在请求前就清空 qsImg.src，且上游回 error_code 7 时
 *      直接 stopQrPoll() → 二维码永久空白且手机端确认再也拾取不到。
 *
 * 纯静态断言，不启动 Electron。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const RAW_FLOWS = readSource('public/js/modules/08-account/03-login-modal-flows.js');
const FLOWS = stripComments(RAW_FLOWS);
const RAW_CSS = readSource('public/css/08-account/account.css');
const RAW_GLOBALS = readSource('public/js/modules/00-state/12a-audio-login-globals.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ------------------------------------------------------------------ */
/* 1) login-modal-logged-in 必须在 provider 分支之前同步               */
/* ------------------------------------------------------------------ */

test('login-modal-logged-in 的 toggle 位于汽水分支之前', () => {
  const fnStart = FLOWS.indexOf('function updateLoginProviderUi(');
  assert.ok(fnStart > -1, '找不到 updateLoginProviderUi');

  // 用代码锚点而非注释：stripComments 会把 /* ===== Qishui Branch ===== */ 去掉。
  const qishuiBranch = FLOWS.indexOf("if (isQishui) {", fnStart);
  assert.ok(qishuiBranch > -1, '找不到汽水分支（if (isQishui)）');

  const toggleIdx = FLOWS.indexOf("classList.toggle('login-modal-logged-in'", fnStart);
  assert.ok(toggleIdx > -1, '找不到 login-modal-logged-in 的 toggle');

  assert.ok(
    toggleIdx < qishuiBranch,
    'login-modal-logged-in 的 toggle 必须早于汽水分支 return，否则汽水/Spotify 分支永远清不掉这个类',
  );
});

test('login-modal-logged-in 在函数内只 toggle 一次（避免尾部残留第二处）', () => {
  const fnStart = FLOWS.indexOf('function updateLoginProviderUi(');
  const fnEnd = FLOWS.indexOf('\nfunction ', fnStart + 10);
  const body = FLOWS.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
  const hits = body.match(/classList\.toggle\('login-modal-logged-in'/g) || [];
  assert.strictEqual(hits.length, 1, `期望恰好 1 处 toggle，实际 ${hits.length} 处`);
});

test('CSS 中确实存在依赖该类的隐藏规则（证明必须修 JS 而不是改 CSS）', () => {
  assert.ok(
    /\.login-modal-logged-in \.qr-shell[^{]*\{[^}]*display:\s*none/.test(RAW_CSS),
    'account.css 应存在 .login-modal-logged-in .qr-shell{display:none} 规则',
  );
});

/* ------------------------------------------------------------------ */
/* 2) logoutLoginProvider 白名单必须含 qishui                          */
/* ------------------------------------------------------------------ */

test('logoutLoginProvider 的白名单包含 qishui', () => {
  const fnStart = FLOWS.indexOf('async function logoutLoginProvider(');
  assert.ok(fnStart > -1, '找不到 logoutLoginProvider');

  // 取函数体前 400 字符（归一化那一行就在最前面）
  const head = FLOWS.slice(fnStart, fnStart + 400);

  assert.ok(
    /'qishui'/.test(head),
    "logoutLoginProvider 的 provider 归一化必须显式接受 'qishui'，否则「退出汽水」会退成网易云",
  );
  assert.ok(
    !/provider === 'qq' \? 'qq' : \(provider === 'kugou'/.test(head),
    '不应回退到不含 qishui 的三元链式归一化写法',
  );
});

test('汽水分支确实会调用 logoutQishuiAccount', () => {
  const fnStart = FLOWS.indexOf('async function logoutLoginProvider(');
  const fnEnd = FLOWS.indexOf('\nfunction ', fnStart + 10);
  const body = FLOWS.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
  assert.ok(
    /provider === 'qishui'[\s\S]{0,200}logoutQishuiAccount\(\)/.test(body),
    '汽水分支应调用 logoutQishuiAccount()',
  );
});

/* ------------------------------------------------------------------ */
/* 3) refreshQr 汽水分支不得在请求前清空 src                           */
/* ------------------------------------------------------------------ */

test('refreshQr 汽水分支在请求前不清空 qsImg.src', () => {
  const fnStart = FLOWS.indexOf('async function refreshQr(');
  assert.ok(fnStart > -1, '找不到 refreshQr');

  const qishuiIdx = FLOWS.indexOf("loginProvider === 'qishui'", fnStart);
  assert.ok(qishuiIdx > -1, '找不到 refreshQr 的汽水分支');

  const requestIdx = FLOWS.indexOf('/api/qishui/login/qrcode', qishuiIdx);
  assert.ok(requestIdx > -1, '找不到汽水二维码请求');

  const before = FLOWS.slice(qishuiIdx, requestIdx);
  assert.ok(
    !/qsImg\.src\s*=\s*''/.test(before),
    '请求前不得把 qsImg.src 清空：失败时二维码会永久空白且无恢复路径',
  );
});

test('上游错误码 7 分支保留延迟重试，而非彻底停轮询', () => {
  // 状态名在 2026-11-13 由 rate_limited 改为中性的 upstream_code_7（7 的语义未确认，
  // 不再断言它就是限流）。断言的行为契约不变：停高频轮询 + 按 retryAfterMs 延迟重试一次。
  const idx = FLOWS.indexOf("qsStatus === 'upstream_code_7'");
  assert.ok(idx > -1, '找不到 upstream_code_7 分支（上游回 error_code 7 时的处理分支）');

  // 取该分支到下一个 else if 之间
  const nextBranch = FLOWS.indexOf('else if (qsStatus ===', idx + 10);
  const branch = FLOWS.slice(idx, nextBranch > -1 ? nextBranch : idx + 900);

  assert.ok(/stopQrPoll\(\)/.test(branch), 'error_code 7 仍须停掉高频轮询');
  assert.ok(
    /setTimeout\(/.test(branch) && /startQrPoll\(\)/.test(branch),
    'error_code 7 必须安排一次延迟重试（setTimeout + startQrPoll），否则手机端确认后永远拾取不到',
  );
  assert.ok(/retryAfterMs/.test(branch), '重试间隔应取自服务端 retryAfterMs');
});

test('qrRetryTimer 有全局声明且由 stopQrPoll 清理', () => {
  assert.ok(
    /var qrRetryTimer\s*=\s*null/.test(RAW_GLOBALS),
    'qrRetryTimer 必须在 00-state 里用 var 声明（延迟波脚本共用作用域）',
  );

  const fnStart = FLOWS.indexOf('function stopQrPoll(');
  assert.ok(fnStart > -1, '找不到 stopQrPoll');
  const body = FLOWS.slice(fnStart, fnStart + 300);
  assert.ok(
    /clearTimeout\(qrRetryTimer\)/.test(body),
    'stopQrPoll 必须一并清掉 qrRetryTimer，避免关窗后残留重试',
  );
});

/* ------------------------------------------------------------------ */
/* 4) 反向自证：确保断言真的会失败                                     */
/* ------------------------------------------------------------------ */

test('反向自证：破坏 toggle 顺序后断言应失败', () => {
  const broken = FLOWS.replace(
    /if \(modal\) modal\.classList\.toggle\('login-modal-logged-in', isLoggedIn\);\n/,
    '',
  ) + "\n  if (modal) modal.classList.toggle('login-modal-logged-in', isLoggedIn);\n";

  const fnStart = broken.indexOf('function updateLoginProviderUi(');
  const qishuiBranch = broken.indexOf('if (isQishui) {', fnStart);
  const toggleIdx = broken.indexOf("classList.toggle('login-modal-logged-in'", fnStart);

  assert.ok(toggleIdx > qishuiBranch, '反向样本应让 toggle 落到汽水分支之后');
});

test('反向自证：白名单去掉 qishui 后断言应失败', () => {
  const broken = FLOWS.replace(
    /\(provider === 'qq' \|\| provider === 'kugou' \|\| provider === 'spotify' \|\| provider === 'qishui'\)/,
    "(provider === 'qq' || provider === 'kugou' || provider === 'spotify')",
  );
  const fnStart = broken.indexOf('async function logoutLoginProvider(');
  const head = broken.slice(fnStart, fnStart + 400);
  assert.ok(!/provider === 'qishui'/.test(head), '反向样本应不再接受 qishui');
});

/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log('  ok   ' + t.name);
  } catch (err) {
    failed += 1;
    console.error('  FAIL ' + t.name);
    console.error('       ' + (err && err.message ? err.message : err));
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
if (failed > 0) process.exit(1);
