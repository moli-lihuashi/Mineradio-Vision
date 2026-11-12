'use strict';

// QQ 音乐登录窗口的收尾判定（纯函数，无 electron 依赖，可单测）。
//
// 背景（2026-11-13 实号反馈）：QQ 网页登录后只拿到登录 cookie（uin + p_skey/skey），
// 播放态 key（qm_keyst / wxskey）要等播放页补发。原来的窗口逻辑只认播放态 key，
// 拿不到就永不 resolve —— 表现为「QQ 音乐窗口停在 player 页、Mineradio 登录弹窗也不退」。
//
// 判定规则（按顺序）：
//   1. 已拿到播放态 key           → done（完整成功，关窗）
//   2. 还没登录                   → wait（继续等扫码）
//   3. 已登录但还没导航过播放页     → warmup（导航播放页，等它补发 key）
//   4. 已登录 + warmup 后超过宽限  → partial（账号可用就收尾，别把 UI 卡死）
//   5. 其他（宽限内）             → wait

const DEFAULT_PARTIAL_GRACE_MS = 6000;

/**
 * @param {{hasPlaybackKey:boolean, hasLogin:boolean, warmupStarted:boolean, warmupAt:number, now:number, graceMs?:number}} input
 * @returns {'done'|'wait'|'warmup'|'partial'}
 */
function decideQQLoginOutcome(input) {
  const { hasPlaybackKey, hasLogin, warmupStarted, warmupAt, now } = input || {};
  if (hasPlaybackKey) return 'done';
  if (!hasLogin) return 'wait';
  if (!warmupStarted) return 'warmup';
  const graceMs = Number(input && input.graceMs) > 0
    ? Number(input.graceMs)
    : DEFAULT_PARTIAL_GRACE_MS;
  const startedAt = Number(warmupAt) || 0;
  if (startedAt > 0 && (Number(now) || 0) - startedAt >= graceMs) return 'partial';
  return 'wait';
}

module.exports = { decideQQLoginOutcome, DEFAULT_PARTIAL_GRACE_MS };
