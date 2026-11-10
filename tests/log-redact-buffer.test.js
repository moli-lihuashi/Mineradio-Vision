'use strict';

/* =============================================================================
 * A4 日志脱敏 + 运行日志缓冲 — 行为测试
 * 脱敏的原则：只换「值」不换「名」，IP / 错误原文 / 请求路径都要留着查问题。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const { REDACTED, redactCredentials } = require(path.join(appRoot, 'server/lib/log-redact'));
const logBuffer = require(path.join(appRoot, 'server/lib/log-buffer'));

test('地址里的 cookie / token 值被换掉，路径与其它参数保留', () => {
  const out = redactCredentials('GET /api/kugou/user/playlists?cookie=MUSIC_U%3Dabc&page=1&token=LONGSECRET failed');
  assert.ok(out.includes(`cookie=${REDACTED}`));
  assert.ok(out.includes(`token=${REDACTED}`));
  assert.ok(out.includes('/api/kugou/user/playlists'), '路径必须保留');
  assert.ok(out.includes('page=1'), '非凭据参数必须保留');
  assert.ok(out.includes('failed'), '错误原文必须保留');
  assert.ok(!out.includes('LONGSECRET'));
});

test('URL 凭据是最后一个参数时，也不吞掉同一行后面的诊断信息', () => {
  const out = redactCredentials('GET /x?cookie=KuGoo%3D7%3Btoken%3Dabc failed at 192.168.1.7');
  assert.ok(out.includes(`cookie=${REDACTED}`));
  assert.ok(out.includes('/x'), '路径必须保留');
  assert.ok(out.includes('failed at 192.168.1.7'), 'URL 后面的错误原文与 IP 不能被吃到行尾');
});

test('IP、代理主机与凭据名本身都保留，只有值被替换', () => {
  const out = redactCredentials('ECONNRESET from 192.168.1.7 via http://user:pw@proxy.local:8080 token=ABC123');
  assert.ok(out.includes('192.168.1.7'));
  assert.ok(out.includes('proxy.local:8080'));
  assert.ok(out.includes('//***@'));
  assert.ok(out.includes(`token=${REDACTED}`));
  assert.ok(!out.includes('ABC123'));
  assert.ok(!out.includes('user:pw'));
});

test('JSON 字段、裸 Cookie 头、散落的登录 Cookie 都能脱敏', () => {
  assert.ok(redactCredentials('{"cookie":"token=aaa; userid=7"}').includes(`"${REDACTED}"`));
  assert.ok(redactCredentials('Cookie: KuGoo=KugooID%3D7; token=abcdefgh').includes(`Cookie: ${REDACTED}`));
  const scattered = redactCredentials('KuGoo=RAWVALUE MUSIC_U=OTHERVALUE dfid=DEVICE123');
  assert.ok(scattered.includes(`KuGoo=${REDACTED}`));
  assert.ok(scattered.includes(`MUSIC_U=${REDACTED}`));
  assert.ok(scattered.includes(`dfid=${REDACTED}`));
  assert.ok(!scattered.includes('RAWVALUE'));
});

test('非字符串原样返回，空串不炸', () => {
  assert.equal(redactCredentials(null), null);
  assert.equal(redactCredentials(42), 42);
  assert.equal(redactCredentials(''), '');
});

test('formatValue 处理循环引用和 Error 原型属性，绝不抛异常', () => {
  const node = { name: 'audio' };
  node.self = node;
  const out = logBuffer.formatValue(node);
  assert.ok(out.includes('[circular]'));
  assert.ok(out.includes('audio'));
  assert.ok(logBuffer.formatValue(new Error('boom')).includes('boom'));
  const nested = logBuffer.formatValue({ err: new DOMException('nope', 'AbortError') });
  assert.ok(nested.includes('nope') || nested.includes('AbortError'));
});

test('readScope 从 [Prefix] 读取模块名', () => {
  assert.equal(logBuffer.readScope('[KugouSelfHeal] re-register'), 'KugouSelfHeal');
  assert.equal(logBuffer.readScope('no prefix here'), null);
});

test('缓冲默认开、有上限、按 scope / level 过滤', () => {
  let now = 1000;
  const buf = logBuffer.createLogBuffer({ limit: 3, now: () => now++ });
  assert.equal(buf.isEnabled(), true);
  buf.push('warn', ['[Playlists]', 'first']);
  buf.push('info', ['[Audio]', 'second']);
  buf.push('warn', ['[Playlists]', 'third']);
  buf.push('error', ['[Audio]', 'fourth']);
  assert.equal(buf.size(), 3);
  assert.equal(buf.snapshot()[0].text, '[Audio] second');
  assert.equal(buf.snapshot({ scope: 'Playlists' }).length, 1);
  assert.equal(buf.snapshot({ level: 'error' }).length, 1);
  assert.ok(buf.snapshot()[0].text.includes('[Audio]'));
});

test('写进缓冲的文本已经脱敏', () => {
  const buf = logBuffer.createLogBuffer();
  buf.push('warn', ['[Kugou]', 'cookie=SUPERSECRETVALUE', 'token=OTHERSECRET']);
  const text = buf.snapshot()[0].text;
  assert.ok(text.includes(`cookie=${REDACTED}`));
  assert.ok(!text.includes('SUPERSECRETVALUE'));
  assert.ok(!text.includes('OTHERSECRET'));
});

test('install 包装 console 后仍调用原函数，且不会递归；uninstall 能还原', () => {
  const buf = logBuffer.createLogBuffer();
  const originalLog = console.log;
  assert.equal(buf.install(), true);
  assert.equal(buf.install(), false, '重复安装必须幂等');
  try {
    console.log('[UnitTest] install smoke');
    const last = buf.snapshot().at(-1);
    assert.ok(last && last.text.includes('[UnitTest] install smoke'));
    assert.equal(last.scope, 'UnitTest');
    assert.equal(buf.isInstalled(), true);
  } finally {
    assert.equal(buf.uninstall(), true);
    assert.equal(console.log, originalLog);
    assert.equal(buf.isInstalled(), false);
  }
});
