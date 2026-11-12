'use strict';

/* =============================================================================
 * 酷狗「第三方拿不到地址」的正确分类（2026-11-12 第三个报障）
 *
 * 用户：「为什么这些歌曲在 kg 可以正常播放，在我们的播放器就不可以？」
 * 目标曲目（从用户真实 Local Storage/leveldb 取证）：
 *   Phone Kisses (雨声)   hash=0340CCD98FC51CFE226057ADC75E2395 albumAudioId=438093215
 *   罗生门 (Follow)       hash=A3294EF23A6FEE092BC7A72269730AAE albumAudioId=288989998
 *
 * 真机（真实 profile + 用户登录态，loggedIn:true / 2 个歌单 / 四通道查到 VIP）取证：
 *   trackercdn 原始响应（cookie-debug.log [KugouTracker]）：
 *     {"status":3,"trans_param":{"classmap":{"attr0":1311768584},"display":65,"display_rate":5}}
 *     {"status":3,"trans_param":{"classmap":{"attr0":234881032},"display":1,"display_rate":0}}
 *     既无 url 也无错误消息；四通道明确回 message:"无版权"。
 *   同歌单另外 8 首（尘埃 / 不潮不用花钱 / A.I.N.Y. …）全部 status:1 + playable:true。
 *   => 不是登录态、不是会员、不是播放器取址链路故障；是酷狗对这两首
 *      UGC/二创曲目不给第三方播放地址（官方客户端用私有协议能播）。
 *
 * 真 BUG：handleKugouSongUrl 在「已登录 + 没 url」时一律硬编码 paid_required，
 *   于是提示「需要会员/购买」并触发登录/VIP 引导 —— 用户明明是 VIP，提示是错的，
 *   还会白跑一轮换源与重管线。前端其实早就支持 copyright_unavailable
 *   （「当前平台版权不可播 · 可以换一个平台版本」+ switch_source）。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'server', 'lib', 'kugou-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function sliceHandler(text) {
  const start = text.indexOf('  async function handleKugouSongUrl');
  const end = text.indexOf('\n  /* 歌单内容变了', start);
  assert.ok(start > 0, '找不到 handleKugouSongUrl');
  assert.ok(end > start, '找不到函数结束边界');
  return text.slice(start, end);
}
const handlerSource = sliceHandler(source);

function makeHandler(opts) {
  const o = opts || {};
  const sandbox = {
    String, Number, Boolean, Object,
    getKugouLoginInfo() { return { loggedIn: o.loggedIn !== false, vipType: 0, vipLevel: 'none' }; },
    kugouHashForQuality(h) { return { hash: h, level: 'standard' }; },
    normalizeQualityPreference(q) { return String(q || 'standard'); },
    kugouTrackercdnPlayUrl() { return Promise.resolve(o.response); },
    kugouPlayableUrlFromResponse(json) {
      const d = json && (json.data || json);
      const raw = d && (d.play_url || d.play_backup_url || d.url || d.src || d.backup_url);
      return (Array.isArray(raw) ? raw[0] : raw) || '';
    },
    playbackRestriction(provider, category, message, action, extra) {
      return Object.assign({ provider, category, message, action }, extra || {});
    },
  };
  vm.runInNewContext(handlerSource, sandbox, { filename: sourcePath });
  return sandbox.handleKugouSongUrl;
}

const REAL_BLOCK = { status: 3, trans_param: { classmap: { attr0: 1311768584 }, display: 65, display_rate: 5 } };
const HASH = '0340CCD98FC51CFE226057ADC75E2395';

test('① 静态守卫：status:3 无地址必须归成 copyright_unavailable', () => {
  const body = sliceHandler(source);
  assert.match(body, /Number\(code\) === 3/, '必须识别 trackercdn 的 status:3');
  assert.match(body, /copyright_unavailable/, '必须走前端已支持的版权分类');
  assert.match(body, /switch_source/, '动作必须是换源，不是升级会员/登录');
  assert.match(body, /upstreamMessage/, '上游有明确错误消息时不能被覆盖');
});

test('② 真实 status:3 响应：不再误报「需要会员/购买」', async () => {
  const fn = makeHandler({ response: REAL_BLOCK });
  const d = await fn(HASH, '438093215', '', '', null);
  assert.equal(d.playable, false);
  assert.equal(d.kugouCode, 3);
  assert.equal(d.reason, 'copyright_unavailable');
  assert.equal(d.restriction.category, 'copyright_unavailable');
  assert.equal(d.restriction.action, 'switch_source');
  assert.match(d.message, /第三方/);
  assert.doesNotMatch(d.message, /需要会员|购买/, '用户已登录且是 VIP，不该再提示会员/购买');
});

test('③ 正常曲目 status:1 + url：零回归', async () => {
  const fn = makeHandler({ response: { status: 1, url: 'https://cdn.example/a.mp3', data: { play_url: 'https://cdn.example/a.mp3' } } });
  const d = await fn('60D651F826', '', '', '', null);
  assert.equal(d.playable, true);
  assert.ok(d.url);
  assert.equal(d.reason, '');
  assert.equal(d.restriction, null);
  assert.equal(d.kugouCode, 1);
});

test('④ 上游明确说「付费/会员」时保持 paid_required，不被覆盖', async () => {
  const fn = makeHandler({ response: { status: 3, error: '该歌曲需要付费购买' } });
  const d = await fn(HASH, '', '', '', null);
  assert.equal(d.reason, 'paid_required');
  assert.equal(d.restriction.action, 'upgrade');
});

test('⑤ 未登录时的 status:3 仍算版权不可播，不弹登录引导', async () => {
  const fn = makeHandler({ response: REAL_BLOCK, loggedIn: false });
  const d = await fn(HASH, '', '', '', null);
  assert.equal(d.reason, 'copyright_unavailable');
  assert.equal(d.restriction.action, 'switch_source');
});

test('⑥ 其它失败码（status:2 等）保持原有分类，零回归', async () => {
  const fn = makeHandler({ response: { status: 2 } });
  const d = await fn(HASH, '', '', '', null);
  assert.equal(d.playable, false);
  assert.equal(d.reason, 'paid_required');
  assert.equal(d.restriction.action, 'upgrade');

  const fnGuest = makeHandler({ response: { status: 2 }, loggedIn: false });
  const dg = await fnGuest(HASH, '', '', '', null);
  assert.equal(dg.reason, 'login_required');
  assert.equal(dg.restriction.action, 'login');
});

test('⑦ 空 hash 早退，不起取址', async () => {
  const fn = makeHandler({ response: REAL_BLOCK });
  const d = await fn('', '', '', '', null);
  assert.equal(d.playable, false);
  assert.equal(d.error, 'Missing Kugou hash');
});
