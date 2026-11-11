'use strict';

/**
 * #15 / #16 守卫：汽水验证页不得回退到「关同源策略」+「ACAO 通配」的老写法。
 *
 * 背景：官方接口不发 Access-Control-Allow-Origin，验证页的 XHR 又带自定义头，
 * 于是历史实现用了两道粗暴的绕过：
 *   #15 webSecurity:false   —— 整个 BrowserWindow 关掉同源策略
 *   #16 Access-Control-Allow-Origin: '*' —— 无条件放开所有源
 * 正确做法是在主进程补齐 CORS 头，并且只回显本页自己的 origin。
 *
 * 本测试是纯静态断言（不启动 Electron），用于防止这两个洞被无意改回去。
 * 真实链路验证见 scripts/probe-qishui-websecurity.js --real-module。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_SOURCE = fs.readFileSync(path.join(ROOT, 'qishui-auth-v6.js'), 'utf8');

// 注释里会提到历史写法（例如「原先这里是 webSecurity:false」），
// 断言必须只看真实代码，否则守卫会被自己的说明文字绊倒。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const AUTH_SOURCE = stripComments(RAW_SOURCE);

function extractBlock(source, startPattern) {
  const index = source.search(startPattern);
  if (index < 0) return '';
  // 取从匹配点到下一个 `\n  }` 之间的内容，足以覆盖单个方法体
  const rest = source.slice(index);
  const end = rest.indexOf('\n  }');
  return end < 0 ? rest : rest.slice(0, end);
}

function testWebSecurityIsNotDisabled() {
  const assignments = [...AUTH_SOURCE.matchAll(/webSecurity\s*:\s*([A-Za-z0-9_.$]+)/g)]
    .map(match => match[1]);
  assert.ok(assignments.length > 0, 'qishui-auth-v6.js 必须显式声明 webSecurity，不能依赖默认值');
  for (const value of assignments) {
    assert.notStrictEqual(
      value, 'false',
      '#15 回退：webSecurity:false 会全局关闭同源策略，必须为 true（CORS 由 onHeadersReceived 补齐）',
    );
  }
  console.log('  [OK] webSecurity 未回退为 false');
}

function testAcaoIsNotWildcard() {
  // ACAO 的值是动态的（[selfOrigin]），不能用字面量匹配。
  // 策略：找到所有对 Access-Control-Allow-Origin 的赋值，取出右侧表达式，
  // 断言它既不是字面量 '*'，也不是无来源的变量。
  const assignment = /headers\[\s*['"]Access-Control-Allow-Origin['"]\s*\]\s*=\s*([^;]+);/g;
  const values = [...AUTH_SOURCE.matchAll(assignment)].map(match => match[1].trim());
  assert.ok(values.length > 0, '必须显式设置 Access-Control-Allow-Origin，否则 CORS 必然失败');
  for (const value of values) {
    assert.ok(
      !/^\[\s*['"]\*['"]\s*\]$/.test(value) && value !== "'*'" && value !== '"*"',
      '#16 回退：Access-Control-Allow-Origin 不得为通配 *，必须收窄到本页 origin',
    );
  }
  // 收窄的依据必须是本页 origin，而不是任意请求头回显。
  assert.ok(
    /selfOrigin/.test(AUTH_SOURCE),
    'ACAO 必须收窄到 assetBase 的 origin（selfOrigin），不能回显任意 Origin 请求头',
  );
  console.log('  [OK] Access-Control-Allow-Origin 未回退为通配 *');
}

function testCorsPreflightHeadersAreCompleted() {
  // 官方预检只回 Allow-Methods，不回 Allow-Headers；缺了它带自定义头的 XHR 必被拦。
  assert.ok(
    /headers\[\s*['"]Access-Control-Allow-Headers['"]\s*\]/.test(AUTH_SOURCE),
    '必须补 Access-Control-Allow-Headers，否则带自定义头的预检会失败',
  );
  assert.ok(
    /headers\[\s*['"]Access-Control-Allow-Methods['"]\s*\]/.test(AUTH_SOURCE),
    '必须补 Access-Control-Allow-Methods',
  );
  console.log('  [OK] CORS 预检头已补齐（Allow-Headers / Allow-Methods）');
}

function testNavigationIsGuarded() {
  // webSecurity:true 的安全性依赖「窗口只停留在本地 asset 页」。
  // 没有 will-navigate 守卫时，外部页面也能拿到收窄后的 ACAO，收窄就失去意义。
  assert.ok(
    /_guardNavigation\s*\(/.test(AUTH_SOURCE),
    'webSecurity:true 必须配合 _guardNavigation()，否则外部导航会让 CORS 收窄失效',
  );
  const guard = extractBlock(AUTH_SOURCE, /_guardNavigation\s*\(/);
  assert.ok(/will-navigate/.test(guard), '_guardNavigation 必须拦截 will-navigate');
  assert.ok(/preventDefault/.test(guard), '_guardNavigation 必须 preventDefault 外部导航');
  assert.ok(/setWindowOpenHandler/.test(guard), '必须拒绝 window.open 弹窗');
  assert.ok(/will-attach-webview/.test(guard), '必须拒绝 <webview> 挂载');
  console.log('  [OK] 导航守卫覆盖 will-navigate / window.open / webview');
}

function testNavigationGuardIsInstalled() {
  assert.ok(
    /this\._guardNavigation\s*\(\s*\)/.test(AUTH_SOURCE),
    '_guardNavigation() 必须真的被调用，否则守卫形同虚设',
  );
  console.log('  [OK] _guardNavigation() 已在窗口创建后调用');
}

function main() {
  testWebSecurityIsNotDisabled();
  testAcaoIsNotWildcard();
  testCorsPreflightHeadersAreCompleted();
  testNavigationIsGuarded();
  testNavigationGuardIsInstalled();
  console.log('[OK] Qishui auth websecurity (#15) and CORS scope (#16) guards verified.');
}

main();
