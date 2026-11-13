'use strict';

// 汽水音乐「扫码状态」收敛（纯函数，无网络、无副作用）。
//
// 为什么需要这个文件（2026-11-13 清理「仍未收口」时查证）：
//   CHANGELOG 曾把 routes/qishui.js 的 `status === '2' → scanned` 记为「死代码」，
//   理由是上游只回字面量 new/scanned/confirmed/expired。但这条断言没有出处，且有反证：
//   qishui-auth-v6.js:828 判确认态时同时写了 `String(data.status) === '3'` 与
//   `=== 'confirmed'`——如果上游只回字面量，就不会去比 '3'。
//   也就是说上游**数字与字面量两种形态都出现过**，删掉 '2' 会把「已扫码」退化成
//   「等待扫码」（用户扫了码但界面不动），属于引入缺陷而不是清理。
//
// 所以这里的做法是：不删分支，把两种形态收敛成同一套前端状态词，未知值原样透传，
// 每条规则由 tests/qishui-qr-status.test.js 锁住。

// error_code 7 的降频间隔。语义未确认时仍然保守降频（避免打爆上游），
// 但**不再断言它是「限流」**——那种解读已被多轮探针证伪。
const QR_RETRY_AFTER_MS = 60000;

// 数字形态：1 新 / 2 已扫 / 3 已确认
const NUMERIC_STATUS = { '1': 'waiting', '2': 'scanned', '3': 'confirmed' };

// 字面量形态（含大小写与常见别名）
const LITERAL_STATUS = {
  new: 'waiting',
  wait: 'waiting',
  waiting: 'waiting',
  scan: 'scanned',
  scanned: 'scanned',
  confirm: 'confirmed',
  confirmed: 'confirmed',
  success: 'confirmed',
  login: 'confirmed',
  expire: 'expired',
  expired: 'expired',
};

/**
 * 把上游扫码返回归一成前端状态词。
 * @param {{status?: unknown, errorCode?: unknown}} input
 * @returns {{status: string, retryAfterMs: number, unknown: boolean, rawStatus: string}}
 */
function mapQishuiQrStatus(input) {
  const raw = input || {};
  const errorCode = Number(raw.errorCode) || 0;
  const status = String(raw.status == null ? '' : raw.status).trim().toLowerCase();

  // 上游明确给「过期」错误码时优先于文本状态
  if (errorCode === 2) {
    return { status: 'expired', retryAfterMs: 0, unknown: false, rawStatus: status };
  }

  // error_code 7：只降频，不命名语义
  if (errorCode === 7) {
    return { status: 'upstream_code_7', retryAfterMs: QR_RETRY_AFTER_MS, unknown: false, rawStatus: status };
  }

  if (!status) {
    return { status: 'waiting', retryAfterMs: 0, unknown: false, rawStatus: status };
  }
  if (NUMERIC_STATUS[status]) {
    return { status: NUMERIC_STATUS[status], retryAfterMs: 0, unknown: false, rawStatus: status };
  }
  if (LITERAL_STATUS[status]) {
    return { status: LITERAL_STATUS[status], retryAfterMs: 0, unknown: false, rawStatus: status };
  }

  // 未知值原样透传：界面能看见上游到底说了什么，不吞掉
  return { status, retryAfterMs: 0, unknown: true, rawStatus: status };
}

module.exports = {
  mapQishuiQrStatus,
  QR_RETRY_AFTER_MS,
  NUMERIC_STATUS,
  LITERAL_STATUS,
};
