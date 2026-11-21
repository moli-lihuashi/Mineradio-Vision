'use strict';

/* =============================================================================
 * issue #1 问题 3：SVIP（黑钻）被误判为普通 VIP
 *
 * 根因：fetchKugouVipInfo() 里 unionVip 回「已知会员」（is_vip=1, vip_type=1）后
 * 直接 return，永远不去查 roleinfo；而 roleinfo 的 role=11 实测才是 SVIP。
 *
 * 这里钉两件事：
 *   1) 映射层：role 6/11/13 → SVIP（含 vipType/svipType/vipLevel 具体值）
 *   2) 探测层：unionVip 报已知普通 VIP 时，必须再补一次 roleinfo，
 *      且只在 roleinfo 识别出 SVIP 时升级，不推翻主结论
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const mapping = require(path.join(appRoot, 'server/kugou/mapping.js'));

function read(rel) { return fs.readFileSync(path.join(appRoot, rel), 'utf8').replace(/\r\n/g, '\n'); }

test('roleinfo 的 role=11 必须识别为 SVIP（issue 实测值）', () => {
  const roleinfoPayload = {
    errno: 0,
    y_type: 3,
    role: 11,
    vipEndTime: '2026-11-29',
  };
  const normalized = mapping.normalizeKugouWebRoleInfoPayload(roleinfoPayload, { userid: '123456' });
  assert.equal(normalized.__kugouMembershipOrigin, 'kugou-web-roleinfo',
    '必须标记来源，否则 normalizeKugouVipPayloadV2 不会走 role 分支');

  const membership = mapping.normalizeKugouVipPayloadV2(normalized, { userid: '123456' });
  assert.equal(membership.membershipKnown, true);
  assert.equal(membership.isSvip, true, 'role=11 必须是 SVIP');
  assert.equal(membership.vipLevel, 'svip');
  assert.equal(membership.vipType, 11);
  assert.equal(membership.svipType, 11);
  assert.equal(membership.membershipSource, 'kugou-web-roleinfo');
});

test('role 6 / 13 同样是 SVIP，role 1 / 2 是普通 VIP', () => {
  for (const role of [6, 13]) {
    const m = mapping.normalizeKugouVipPayloadV2(
      mapping.normalizeKugouWebRoleInfoPayload({ errno: 0, role }, { userid: '1' }),
      { userid: '1' });
    assert.equal(m.isSvip, true, 'role=' + role + ' 应为 SVIP');
  }
  for (const role of [1, 2]) {
    const m = mapping.normalizeKugouVipPayloadV2(
      mapping.normalizeKugouWebRoleInfoPayload({ errno: 0, role }, { userid: '1' }),
      { userid: '1' });
    assert.equal(m.isVip, true, 'role=' + role + ' 应为 VIP');
    assert.equal(m.isSvip, false, 'role=' + role + ' 不是 SVIP');
  }
});

test('unionVip 报已知普通 VIP 时，必须补查 roleinfo 再返回（不许直接 return）', () => {
  const src = read('server/kugou/account.js');
  // 定位 membershipKnown 分支：return primary 之前必须有 isSvip 补查
  const branch = src.match(/if \(primaryMembership\.membershipKnown\) \{[\s\S]{0,900}?\n    \}/);
  assert.ok(branch, 'fetchKugouVipInfo 里应有 membershipKnown 分支');

  const block = branch[0];
  assert.ok(/if \(!primaryMembership\.isSvip\)/.test(block),
    '非 SVIP 时必须补查 roleinfo（否则 SVIP 永远走不到）');
  assert.ok(/fetchKugouWebVipInfo\(/.test(block), '补查必须走 fetchKugouWebVipInfo');
  assert.ok(/svipMembership\.isSvip\)\s*return/.test(block),
    '只有 roleinfo 确认 SVIP 时才替换返回值，不许推翻主探测结论');

  // 反向：直接 `if (primaryMembership.membershipKnown) return primary;` 是不允许的
  assert.ok(!/if \(primaryMembership\.membershipKnown\) return primary;/.test(src),
    '不许退回「已知即直接返回」的旧写法');
});

test('取址前若同步登录态缺会员等级，必须补一次 fresh 探测', () => {
  const src = read('server/lib/kugou-service.js');
  const start = src.indexOf('async function handleKugouSongUrl');
  assert.ok(start > 0, '找不到 handleKugouSongUrl');
  const nextFn = src.indexOf('\n  async function', start + 10);
  const body = src.slice(start, nextFn > start ? nextFn : start + 6000);
  assert.ok(body.length > 400, '函数体切片异常');
  assert.ok(/let loginInfo = getKugouLoginInfo\(\)/.test(body),
    'loginInfo 必须可重新赋值');
  assert.ok(/loginInfo\.loggedIn && !loginInfo\.isSvip && !\(Number\(loginInfo\.vipType\) > 0\)/.test(body),
    '已登录但 vipType 未确认时必须触发 fresh 探测');
  assert.ok(/await getKugouLoginInfoFresh\(\)/.test(body),
    'fresh 探测必须 await，否则拿到的是 Promise');
  // 取址必须用探测后的 loginInfo，不能再用同步旧值
  assert.ok(/vipType: loginInfo\.vipType/.test(body), 'trackercdn 必须用最终确认的 vipType');
});

/* ---- 行为验证：把 fetchKugouVipInfo 抽到 vm 里跑，注入上游响应 ---- */

const vm = require('node:vm');

function sliceTopLevelAsyncFn(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  if (start < 0) return '';
  const rest = src.slice(start + 10);
  const m = rest.match(/\n(?:async )?function /);
  return m ? src.slice(start, start + 10 + m.index) : src.slice(start);
}

function runFetchVip(opts) {
  const src = read('server/kugou/account.js');
  const fnSrc = sliceTopLevelAsyncFn(src, 'fetchKugouVipInfo');
  assert.ok(fnSrc.length > 500, '无法从 account.js 抽出 fetchKugouVipInfo');

  const auth = { playbackReady: true, loggedIn: true, userid: '123456', token: 'tok123' };
  const future = '2099-01-01 00:00:00';
  const context = vm.createContext({
    console, Promise, Number, String, Object, Array, Date, isFinite,
    setTimeout, clearTimeout,
    extractKugouAuth: () => auth,
    kugouVipCache: { wrap: (key, ttlFn, fn) => fn() },
    normalizeKugouVipPayloadV2: mapping.normalizeKugouVipPayloadV2,
    kugouUnknownWebMembershipPayload: () => ({ __kugouMembershipUnknown: true }),
    // unionVip：只报主会员 = 普通 VIP（issue 实测 is_vip=1, vip_type=1）
    kugouGatewayRequest: async () => ({
      data: { main_vip: { '123456': { is_vip: 1, vip_type: 1, vip_end_time: future } } },
    }),
    fetchKugouWebVipInfo: async () => opts.roleInfo,
  });
  vm.runInContext(fnSrc, context, { filename: 'account.fetchKugouVipInfo.slice.js' });
  return context.fetchKugouVipInfo('cookie', auth);
}

test('行为：unionVip 报普通 VIP、roleinfo 报 role=11 → 最终识别为 SVIP', async () => {
  const roleInfo = mapping.normalizeKugouWebRoleInfoPayload(
    { errno: 0, y_type: 3, role: 11, vipEndTime: '2026-11-29' }, { userid: '123456' });
  const result = await runFetchVip({ roleInfo });
  const m = mapping.normalizeKugouVipPayloadV2(result, { userid: '123456' });
  assert.equal(m.isSvip, true, 'issue 场景：应升级为 SVIP');
  assert.equal(m.vipLevel, 'svip');
  assert.equal(m.membershipSource, 'kugou-web-roleinfo');
});

test('行为：roleinfo 只是普通 VIP → 保留 unionVip 主结论，不被覆盖', async () => {
  const roleInfo = mapping.normalizeKugouWebRoleInfoPayload(
    { errno: 0, role: 1 }, { userid: '123456' });
  const result = await runFetchVip({ roleInfo });
  const m = mapping.normalizeKugouVipPayloadV2(result, { userid: '123456' });
  assert.equal(m.isVip, true);
  assert.equal(m.isSvip, false, '普通 VIP 不该被误升级');
  assert.notEqual(m.membershipSource, 'kugou-web-roleinfo', '不该改用 roleinfo 的结果');
});

test('行为：roleinfo 请求失败 → 原样返回 unionVip 结果（不因补查失败而丢会员）', async () => {
  const result = await runFetchVip({ roleInfo: null });
  const m = mapping.normalizeKugouVipPayloadV2(result, { userid: '123456' });
  assert.equal(m.isVip, true, '补查失败必须保留主探测的会员结论');
  assert.equal(m.isSvip, false);
});

/* ---- 真实字段：酷狗 unionVip 用 su_vip_* 表示超级会员（2026-11-21 实测） ---- */

function realUnionVipPayload(overrides) {
  const uid = '123456';
  const main = Object.assign({
    is_vip: 1,
    vip_type: 1,
    vip_end_time: '2099-12-03 12:40:13',
    su_vip_end_time: '2099-12-02 16:04:39',
    su_vip_y_endtime: '2099-12-02 16:04:39',
    userid: uid,
    y_type: 1,
  }, overrides || {});
  return { data: { time: 1, main_vip: { [uid]: main }, busi_vip: {} }, status: 1, error_code: 0 };
}

test('unionVip 的 su_vip_end_time（字符串未来）必须识别为 SVIP', () => {
  const m = mapping.normalizeKugouVipPayloadV2(realUnionVipPayload(), { userid: '123456' });
  assert.equal(m.isVip, true);
  assert.equal(m.isSvip, true, 'su_vip_end_time 未来 = SVIP；这是本账号显示 VIP 的根因');
  assert.equal(m.vipLevel, 'svip');
});

test('su_vip_end_time 已过期时不得误判为 SVIP', () => {
  const m = mapping.normalizeKugouVipPayloadV2(
    realUnionVipPayload({ su_vip_end_time: '2020-01-02 16:04:39', su_vip_y_endtime: '' }),
    { userid: '123456' });
  assert.equal(m.isVip, true, '主会员仍有效');
  assert.equal(m.isSvip, false, '过期的超级会员不能再判 SVIP');
  assert.equal(m.vipLevel, 'vip');
});

test('su_vip_end_time 为毫秒/秒时间戳时同样识别', () => {
  const futureMs = Date.now() + 30 * 24 * 3600 * 1000;
  for (const value of [futureMs, Math.floor(futureMs / 1000)]) {
    const m = mapping.normalizeKugouVipPayloadV2(realUnionVipPayload({ su_vip_end_time: value }), { userid: '123456' });
    assert.equal(m.isSvip, true, '时间戳形式也必须识别: ' + value);
  }
});

test('su_vip_type 正数也要计入 svipType', () => {
  const m = mapping.normalizeKugouVipPayloadV2(
    realUnionVipPayload({ su_vip_end_time: '', su_vip_y_endtime: '', su_vip_type: 11 }),
    { userid: '123456' });
  assert.ok(m.svipType > 0, 'su_vip_type 必须被读到');
  assert.equal(m.isSvip, true);
});

test('回归：只有 vip_end_time、没有 su_vip 字段时仍是普通 VIP', () => {
  const m = mapping.normalizeKugouVipPayloadV2(
    realUnionVipPayload({ su_vip_end_time: '', su_vip_y_endtime: '' }),
    { userid: '123456' });
  assert.equal(m.isVip, true);
  assert.equal(m.isSvip, false);
  assert.equal(m.vipLevel, 'vip');
});
