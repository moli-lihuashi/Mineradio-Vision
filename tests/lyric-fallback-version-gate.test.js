'use strict';

/* 歌词兜底候选的版本/时长闸门（2026-11-28）。
 *
 * 背景：非网易源歌曲缺译文时，会去网易搜索同题歌曲补译文（译文按行序贴到当前歌词上）。
 * 旧的候选筛选只有 `sourceCandidateRejectReason`（标题相等 + 翻唱词 + 艺人交集），
 * 同题同艺人的 Live / 重录 / remaster 会通过，译文整段错位。
 * 新闸门两条：版本标记集合必须完全一致；双方都有时长时差值 ≤ max(5s, 2%) 且 ≤10s。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const lyricPath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '00-lyrics-fetch-parse.js');
const source = fs.readFileSync(lyricPath, 'utf8');

/* 只取闸门这一段：规则表 + 三个纯函数，不拖进歌词模块的其余依赖 */
const start = source.indexOf('var LYRIC_FALLBACK_VERSION_RULES');
const end = source.indexOf('async function findNeteaseLyricFallbackCandidate');
assert.ok(start > 0 && end > start, 'lyric fallback gate block not found');
const block = source.slice(start, end);

const sandbox = { isFinite, Math, String, Number };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);

const reject = sandbox.lyricFallbackCandidateRejectReason;
const tokens = sandbox.lyricFallbackVersionTokens;

function song(name, durationMs) {
  return { name, duration: durationMs };
}
function candidate(name, durationMs) {
  return { name, duration: durationMs };
}

test('同题同艺人同时长：放行', () => {
  assert.equal(reject(song('晴天', 269000), candidate('晴天', 269000)), '');
});

test('Live 版不许供译文（原曲无标记、候选有标记）', () => {
  assert.equal(reject(song('出现又离开', 293000), candidate('出现又离开 (Live)', 293000)), 'version_mismatch');
});

test('Live 标记写成全角括号也认', () => {
  assert.equal(reject(song('出现又离开（Live）', 293000), candidate('出现又离开 (Live)', 293000)), '');
});

test('重录版不许供译文', () => {
  assert.equal(reject(song('漠河舞厅', 260000), candidate('漠河舞厅 (重录版)', 260000)), 'version_mismatch');
});

test('remaster 不许供译文', () => {
  assert.equal(reject(song('Hallelujah', 240000), candidate('Hallelujah - Remastered 2019', 241000)), 'version_mismatch');
});

test('伴奏/纯音乐不许供译文', () => {
  assert.equal(reject(song('起风了', 325000), candidate('起风了 (伴奏)', 325000)), 'version_mismatch');
});

test('时长差超过 max(5s, 2%)：拒绝（4 分钟歌差 15s）', () => {
  assert.equal(reject(song('夜曲', 240000), candidate('夜曲', 255000)), 'duration_mismatch');
});

test('时长差在容差内：放行（4 分钟歌差 4s）', () => {
  assert.equal(reject(song('夜曲', 240000), candidate('夜曲', 244000)), '');
});

test('长曲容差按 2% 放宽但仍封顶 10s（10 分钟歌差 9s 放行 / 差 11s 拒绝）', () => {
  assert.equal(reject(song('长曲', 600000), candidate('长曲', 609000)), '');
  assert.equal(reject(song('长曲', 600000), candidate('长曲', 611000)), 'duration_mismatch');
});

test('任一方缺时长：不因时长拒绝（覆盖率优先，版本标记已挡掉主要错配）', () => {
  assert.equal(reject(song('无名', 0), candidate('无名', 200000)), '');
  assert.equal(reject(song('无名', 200000), candidate('无名', 0)), '');
});

test('没有泛化的 version 词：正式版与专辑版不会被误拒', () => {
  assert.equal(tokens('光年之外 (电影《太空旅客》主题曲)'), '');
  assert.equal(reject(song('光年之外', 235000), candidate('光年之外 (电影《太空旅客》主题曲)', 235000)), '');
});

test('空候选直接拒绝', () => {
  assert.equal(reject(song('晴天', 269000), null), 'no_candidate');
});

test('闸门真的接在候选链上：findNeteaseLyricFallbackCandidate 必须调用它', () => {
  const fnStart = source.indexOf('async function findNeteaseLyricFallbackCandidate');
  assert.ok(fnStart > 0, 'missing findNeteaseLyricFallbackCandidate()');
  const next = source.indexOf('\nasync function ', fnStart + 10);
  const body = source.slice(fnStart, next > 0 ? next : undefined);
  // 只认「活代码」：注释掉闸门不算接线（否则删掉调用、留一行注释也能通过）
  const liveLines = body.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.match(liveLines, /\.filter\(function \(candidate\) \{\s*\n\s*return !lyricFallbackCandidateRejectReason\(song, candidate\);/,
    '候选链没有调用版本/时长闸门 —— 纯函数测试通过也拦不住任何东西');
});
