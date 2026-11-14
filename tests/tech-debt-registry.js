'use strict';

// ====================================================================
//  未收口技术债 · 单一登记源
//
//  目的：把「写在 CHANGELOG 里等着以后处理」变成「有期限、有下一步、到期会红」。
//  规则（由 tests/tech-debt.test.js 强制）：
//    · status: 'open'     → 必须有 reviewBy（YYYY-MM-DD，过期即判红）+ why + nextStep
//    · status: 'closed'   → 必须有 closedAt + evidence（文件要存在，且包含指定标记，
//                           防止「收口后被人改回去」）
//    · status: 'accepted' → 必须有 acceptedBy + reason（有意接受，不是拖欠）
//
//  加新债时先问自己能不能现在就还；不能，就必须写清 reviewBy 和 nextStep。
// ====================================================================

const TECH_DEBT = [
  {
    id: 'qishui-error-code-7',
    title: '汽水 error_code 7 曾被当成「限流」',
    where: 'server/qishui/qr-status.js',
    status: 'closed',
    closedAt: '2026-11-13',
    note: '「限流」解读已被多轮探针证伪（200ms 连打 60 次 / 伪造作废 token / _mfaDone 态重发都只回 0）。改为中性状态名 upstream_code_7，只保留保守降频，不再断言语义。',
    evidence: [
      { file: 'server/qishui/qr-status.js', mustContain: 'upstream_code_7' },
      { file: 'tests/qishui-qr-status.test.js', mustContain: '不命名语义' },
    ],
  },
  {
    id: 'qishui-status-2',
    title: "routes/qishui.js 的 status === '2' 曾被记为死代码",
    where: 'server/qishui/qr-status.js',
    status: 'closed',
    closedAt: '2026-11-13',
    note: '复核结论：不是死代码，不能删。qishui-auth-v6.js:828 判确认态时同时写过 String(data.status) === "3" 与 === "confirmed"，说明上游数字与字面量两种形态都出现过；删掉 "2" 会让「已扫码」退化成「等待扫码」。改为双形态统一映射 + 单测锁定。',
    evidence: [
      { file: 'server/qishui/qr-status.js', mustContain: "'2': 'scanned'" },
      { file: 'tests/qishui-qr-status.test.js', mustContain: '数字形态' },
    ],
  },
  {
    id: 'media-proxy-acao-star',
    title: '音频流仍回 Access-Control-Allow-Origin: *',
    where: 'server/lib/media-proxy.js',
    status: 'open',
    reviewBy: '2026-12-31',
    why: '播放器创建音频元素时设了 crossOrigin = "anonymous"（09b-playback-core.js:232、13-playback-start-audio.js:200/661），浏览器要求响应的 ACAO 与之匹配，否则音频进不了 AudioContext、整套可视化会哑掉——所以不能直接删。当前风险由 token 门禁（/api/audio 走 ?token= 白名单）+ Host 白名单兜住，属纵深防御缺口而非可利用漏洞。',
    nextStep: '真起壁纸模式，抓 /api/audio 请求的 Origin 头；确认后改成「白名单回显 Origin，非白名单不回首部」，并在壁纸模式下复验有声音。',
  },
  {
    id: 'qishui-mfa-resend',
    title: '_mfaDone 后无条件 isResend 重发，每轮打 2 个上游请求',
    where: 'qishui-auth-v6.js',
    status: 'open',
    reviewBy: '2026-12-31',
    why: '不能简单跳过：跳过会让响应停在 2046，前端退回「请扫码」。',
    nextStep: '真机扫码走完一次二次验证，确认 isResend 是否只在首轮需要；若确实只首轮，加一个 _mfaResent 标记。',
  },
  {
    id: 'qishui-auth-legacy-7',
    title: "server/qishui/auth.js 仍把 error_code 7 当 'wait'",
    where: 'server/qishui/auth.js',
    status: 'open',
    reviewBy: '2026-12-31',
    why: '与路由的中性 upstream_code_7 并存，等于两套语义；该链路未启用、无路由调用。',
    nextStep: '先确认全仓确实没有调用者，然后要么删掉这条链路，要么与 upstream_code_7 对齐——不要两套语义长期并存。',
  },
  {
    id: 'kugou-skip-tests',
    title: '4 个测试列在 KUGOU_SKIP_TESTS',
    where: 'tests/',
    status: 'accepted',
    acceptedBy: '用户（2026-11-12 裁定保持原 Home 布局）',
    reason: '有意跳过，非回归，也不是因为懒得修。',
  },
];

// 已收口项的关键词：这些词不该再出现在 CHANGELOG 的「仍未收口」小节里
const CLOSED_KEYWORDS = ['rate_limited', '死代码'];

module.exports = { TECH_DEBT, CLOSED_KEYWORDS };
