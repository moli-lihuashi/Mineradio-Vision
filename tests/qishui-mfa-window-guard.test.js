'use strict';

/**
 * 汽水二次验证（2046）窗口生命周期守卫。
 *
 * 用户实测症状：验证窗口反复「一闪而过」，随后提示「扫码过于频繁，请稍后再试」。
 * 根因链（四处叠加，缺一不可）：
 *   1) security_host.html 给组件 <script> 设了 crossOrigin='anonymous'
 *      → 脚本加载变成 CORS 请求，而 CORS 头只对固定域名注入，白名单里
 *        其余宿主拿不到 ACAO → 脚本必加载失败；
 *   2) secondVerify() 的 finally 无条件 window.hide()
 *      → 脚本一失败就 show 后立刻 hide，用户只看到「一闪」；
 *   3) checkQrConnect() 只在成功时记 _mfaDone，失败后没有任何终止标记
 *      → 每 2 秒轮询都会重新 show 一次窗口；
 *   4) 每次重弹都重新请求 check_qrconnect（带 2046）→ 上游按频率判
 *      error_code 7（rate_limited）；前端 rate_limited 分支又不停轮询
 *      → 限流窗口永远不结束。
 *
 * 纯静态断言，不启动 Electron。真实链路验证见
 * scripts/probe-qishui-websecurity.js --real-module。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const RAW_AUTH = readSource('qishui-auth-v6.js');
const AUTH = stripComments(RAW_AUTH);
const RAW_HOST = readSource('qishui-auth-v6/security_host.html');
const HOST = stripComments(RAW_HOST);
const RAW_FLOWS = readSource('public/js/modules/08-account/03-login-modal-flows.js');
const FLOWS = stripComments(RAW_FLOWS);

function extractBlock(source, startPattern, endMarker = '\n  }') {
  const index = source.search(startPattern);
  if (index < 0) return '';
  const rest = source.slice(index);
  const end = rest.indexOf(endMarker);
  return end < 0 ? rest : rest.slice(0, end);
}

// ---------------------------------------------------------------------------
// 1) 组件脚本必须是经典脚本加载，不能变成 CORS 请求
// ---------------------------------------------------------------------------
function testVerifyScriptIsNotCorsRequest() {
  assert.ok(
    /loadVerifyScript\s*\(/.test(HOST),
    'security_host.html 必须保留 loadVerifyScript()（域名白名单校验入口）',
  );
  assert.ok(
    !/crossOrigin\s*=/.test(HOST),
    '验证组件 <script> 不得设 crossOrigin：那会把它变成 CORS 请求，' +
    '而 CORS 头只对固定域名注入，白名单里的其余宿主会加载失败 → 窗口一闪而过',
  );
  // 安全边界不能因此消失：https + 域名白名单必须还在。
  assert.ok(
    /parsed\.protocol\s*!==\s*'https:'/.test(HOST),
    '去掉 crossOrigin 后必须保留 https 协议校验，否则等于放开任意脚本来源',
  );
  assert.ok(
    /verifyScriptHostAllowed\s*\(/.test(HOST),
    '去掉 crossOrigin 后必须保留域名白名单校验',
  );
  console.log('  [OK] 验证组件脚本按经典脚本加载，且 https + 白名单校验仍在');
}

// ---------------------------------------------------------------------------
// 2) 失败时不得立刻收起窗口
// ---------------------------------------------------------------------------
function testWindowNotHiddenOnFailure() {
  const block = extractBlock(AUTH, /async secondVerify\s*\(/);
  assert.ok(block, 'qishui-auth-v6.js 必须保留 secondVerify()');
  assert.ok(
    /this\.window\.hide\s*\(/.test(block),
    'secondVerify 仍然需要在验证完成/取消后收起窗口',
  );
  // 关键：hide() 必须被条件保护，不能是无条件 finally。
  const finallyIndex = block.indexOf('finally');
  assert.ok(finallyIndex >= 0, 'secondVerify 必须保留 finally 用于收尾');
  const finallyBlock = block.slice(finallyIndex, block.indexOf('}', finallyIndex) + 1);
  assert.ok(
    /if\s*\(/.test(finallyBlock),
    'secondVerify 不得在 finally 里无条件 hide()：组件加载失败时窗口会 show 后立刻消失，' +
    '用户只看到「一闪」，既读不到错误也来不及操作',
  );
  assert.ok(
    /if\s*\(\s*!failed\s*&&/.test(block),
    'secondVerify 的 hide() 必须由失败标记保护（失败时保留窗口展示原因）',
  );
  console.log('  [OK] 验证失败时窗口保持可见，不再「一闪而过」');
}

// ---------------------------------------------------------------------------
// 3) 同一 token 必须有终止态，杜绝反复弹窗
// ---------------------------------------------------------------------------
function testMfaTerminalStateStopsReprompting() {
  assert.ok(
    /_markMfaStop\s*\(/.test(AUTH),
    '必须有 _markMfaStop()：记录二次验证终止态，否则轮询会反复弹窗',
  );
  const block = extractBlock(AUTH, /async checkQrConnect\s*\(/, '\n  async persistSessionCookies');
  assert.ok(block, 'qishui-auth-v6.js 必须保留 checkQrConnect()');

  assert.ok(
    /_mfaStopToken/.test(block),
    'checkQrConnect 必须检查 _mfaStopToken，命中时直接返回失败、不再弹窗',
  );
  assert.ok(
    /_mfaStopToken\s*===\s*tokenKey/.test(block),
    '终止态必须按 token 比对：换二维码后应重新允许验证',
  );

  // 两条终止路径都必须登记：组件失败 + 用户取消。
  const stopCalls = [...block.matchAll(/_markMfaStop\s*\(/g)].length;
  assert.ok(
    stopCalls >= 2,
    `组件失败与用户取消都必须登记终止态（当前只有 ${stopCalls} 处调用）；` +
    '只记失败的话，用户点「取消验证」后 2 秒又会弹出',
  );
  assert.ok(
    /QISHUI_MFA_FAILED/.test(block) && /QISHUI_MFA_CANCELLED/.test(block),
    '终止态必须区分 QISHUI_MFA_FAILED 与 QISHUI_MFA_CANCELLED，前端提示文案不同',
  );
  console.log('  [OK] 组件失败/用户取消均登记终止态，同一 token 不再反复弹窗');
}

// ---------------------------------------------------------------------------
// 4) 终止态必须在换码 / 清理时重置
// ---------------------------------------------------------------------------
function testMfaTerminalStateResets() {
  const getQr = extractBlock(AUTH, /async getQrCode\s*\(/, '\n  // 记录二次验证的终止态');
  assert.ok(getQr, 'qishui-auth-v6.js 必须保留 getQrCode()');
  assert.ok(
    /_mfaStopToken\s*=\s*''/.test(getQr),
    'getQrCode() 必须重置 _mfaStopToken：换新二维码后要允许重新验证',
  );
  const clearBlock = extractBlock(AUTH, /async clear\s*\(/, '\n}');
  assert.ok(clearBlock, 'qishui-auth-v6.js 必须保留 clear()');
  assert.ok(
    /_mfaStopToken\s*=\s*''/.test(clearBlock),
    'clear() 必须重置 _mfaStopToken',
  );
  console.log('  [OK] 换码 / 清理时终止态被重置');
}

// ---------------------------------------------------------------------------
// 5) CORS 注入必须覆盖验证组件白名单里的全部宿主
// ---------------------------------------------------------------------------
function testCorsCoversVerifyScriptHosts() {
  const hostsBlock = AUTH.slice(
    AUTH.indexOf('onHeadersReceived'),
    AUTH.indexOf('onBeforeSendHeaders', AUTH.indexOf('onHeadersReceived')),
  );
  assert.ok(hostsBlock, '必须保留 onHeadersReceived 的 CORS 注入');
  for (const host of ['api.qishui.com', 'bff-pc.qishui.com', 'verify.zijieapi.com', 'auth.zijieapi.com']) {
    assert.ok(
      hostsBlock.includes(host),
      `CORS 注入必须覆盖 ${host}：它出现在验证组件域名白名单里，` +
      '漏掉会让该宿主上的请求/脚本拿不到 ACAO',
    );
  }
  console.log('  [OK] CORS 注入覆盖验证组件白名单全部宿主');
}

// ---------------------------------------------------------------------------
// 6) 前端必须真的能收到 mfa_* 状态，并在限流时停轮询
// ---------------------------------------------------------------------------
function testFrontendHandlesMfaStatuses() {
  const block = extractBlock(FLOWS, /if \(loginProvider === 'qishui'\)/, '\n  return baseCheckQr');
  assert.ok(block, '前端必须保留 qishui 扫码轮询分支');

  // 服务端 mfa_cancelled / mfa_failed 用 HTTP 409，apiJson 在 !res.ok 时直接 throw。
  // 不还原 err.data 的话，下面两个分支是永远走不到的死代码。
  assert.ok(
    /checkErr\s*&&\s*checkErr\.data/.test(block),
    '必须从 apiJson 抛出的 err.data 还原 mfa_* 状态：' +
    '服务端用 HTTP 409 返回，不还原则 mfa_cancelled / mfa_failed 分支永远是死代码',
  );
  assert.ok(
    /'mfa_failed'/.test(block) && /'mfa_cancelled'/.test(block),
    '前端必须保留 mfa_failed / mfa_cancelled 两个分支',
  );

  // rate_limited 必须停轮询，否则每 2 秒继续打上游，限流窗口永不结束。
  const rateBlock = block.slice(
    block.indexOf("qsStatus === 'rate_limited'"),
    block.indexOf("qsStatus === 'mfa_cancelled'"),
  );
  assert.ok(rateBlock, '前端必须保留 rate_limited 分支');
  assert.ok(
    /stopQrPoll\s*\(/.test(rateBlock),
    'rate_limited 分支必须 stopQrPoll()：否则每 2 秒继续请求上游，' +
    'retryAfterMs 60000 的限流窗口永远不结束',
  );
  console.log('  [OK] 前端能收到 mfa_* 状态，且限流时停止轮询');
}

// ---------------------------------------------------------------------------
// 7) 组件 URL 无 .js 后缀时必须补后缀重试
//
// 用户实测：二维码已能正常显示，但状态栏报
//   「安全验证组件加载失败：https://auth.zijieapi.com/.../index.umd.production?<aid,...>」
// 实测该地址返回 404（571B HTML），真实文件是同目录 index.umd.production.js
// （200，555005B）。<script> 遇 404 只触发 onerror，拿不到原因，于是整条
// 二次验证链路被判死。因此加载必须按候选序列尝试。
// ---------------------------------------------------------------------------
function testVerifyScriptSuffixFallback() {
  assert.ok(
    /function verifyScriptCandidates\s*\(/.test(HOST),
    '必须有 verifyScriptCandidates()：上游决策里的组件 url 可能没有 .js 后缀，' +
    '直接加载会 404（实测 index.umd.production → 404，index.umd.production.js → 200）',
  );
  assert.ok(
    /\\\.js\$\/i\.test\(parsed\.pathname\)/.test(HOST) || /\.js\$\/i/.test(HOST),
    '候选生成必须判断路径是否已带 .js，避免重复追加',
  );
  assert.ok(
    /pathname\s*=\s*[^;]*\+\s*'\.js'/.test(HOST),
    '候选生成必须通过追加 .js 构造第二个候选（只改 pathname，保留 query）',
  );

  // 每个候选都要单独过安全校验：补后缀不能成为绕过 https / 白名单的后门。
  const loadBlock = HOST.slice(
    HOST.indexOf('async function loadVerifyScript'),
    HOST.indexOf('async function expandVerifyCenterDecision'),
  );
  assert.ok(loadBlock, '必须保留 loadVerifyScript()');
  assert.ok(
    /for\s*\(const candidate of candidates\)/.test(loadBlock),
    'loadVerifyScript 必须遍历候选，不能只试第一个',
  );
  assert.ok(
    /verifyScriptHostAllowed\(parsed\.hostname\)/.test(loadBlock),
    '每个候选都必须单独过域名白名单校验',
  );
  assert.ok(
    /parsed\.protocol\s*!==\s*'https:'/.test(loadBlock),
    '每个候选都必须单独过 https 校验',
  );
  assert.ok(
    /script\.remove\s*\(\)/.test(HOST),
    '加载失败的 <script> 节点必须移除，否则残留节点会干扰后续候选与重试',
  );
  console.log('  [OK] 组件 URL 缺 .js 后缀时会补后缀重试，且每个候选都过 https + 白名单');
}

// ---------------------------------------------------------------------------
// 8) host 页版本自愈：修复无需重启应用即可生效
//
// _initialize() 只在首次建窗口时 loadURL 一次，之后页面 JS 常驻内存。
// 因此磁盘上 security_host.html 的修复对「已运行实例」完全无效——用户会
// 继续看到旧报错（本次实测踩到：14:01 启动的实例读不到 15:21 落盘的修复）。
// 必须按页面版本号按需重载。
// ---------------------------------------------------------------------------
function testHostPageVersionSelfHeal() {
  assert.ok(
    /__qishuiHostVersion\s*=\s*\d+/.test(HOST),
    'security_host.html 必须声明 __qishuiHostVersion：主进程靠它判断驻留页面是否过期',
  );
  assert.ok(
    /ensureHostPageFresh\s*\(/.test(AUTH),
    'qishui-auth-v6.js 必须有 ensureHostPageFresh()：否则 host 页修复对已运行实例无效，' +
    '用户必须重启应用才能生效',
  );
  const initBlock = extractBlock(AUTH, /async initialize\s*\(/);
  assert.ok(
    /ensureHostPageFresh\s*\(/.test(initBlock),
    'initialize() 必须在「窗口已就绪」的提前 return 分支里调用 ensureHostPageFresh()',
  );
  const freshBlock = extractBlock(AUTH, /async ensureHostPageFresh\s*\(/, '\n  async _initialize');
  assert.ok(
    /loadURL\s*\([^)]*security_host\.html/.test(freshBlock),
    '版本落后时必须重新 loadURL security_host.html',
  );
  assert.ok(
    /waitForBdms\s*\(/.test(freshBlock),
    '重载后必须重新 waitForBdms()：否则后续 request() 没有签名能力',
  );
  assert.ok(
    /_hostVersionChecked\s*=\s*true/.test(freshBlock),
    '比对结果必须置位缓存：initialize() 每次 request 都调用，不能每次都走 IPC',
  );
  console.log('  [OK] host 页版本落后时会自愈重载，且比对只做一次');
}

function main() {
  testVerifyScriptIsNotCorsRequest();
  testWindowNotHiddenOnFailure();
  testMfaTerminalStateStopsReprompting();
  testMfaTerminalStateResets();
  testCorsCoversVerifyScriptHosts();
  testFrontendHandlesMfaStatuses();
  testVerifyScriptSuffixFallback();
  testHostPageVersionSelfHeal();
  console.log('[OK] Qishui MFA window lifecycle guards verified.');
}

main();
