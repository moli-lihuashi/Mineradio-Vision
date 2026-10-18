'use strict';

// 酷狗：搜索。
//
// 第 2 刀从 kugou-api.js 抽出。只做「关键词 → 上游请求 → 映射成前端结构」，
// 不碰登录态、不碰收藏。

const {
  KUGOU_HEADERS,
  KUGOU_SEARCH_URL,
  KUGOU_WEB_APPID,
  kugouDebug,
} = require('./config');

const {
  buildKugouRequestCookie,
  extractKugouAuth,
  kugouSearchCache,
  requestJson,
} = require('./http');

const {
  mapKugouSearchItem,
} = require('./mapping');

// 网关失败：把酷狗返回体压缩进错误信息，否则前端/日志只见裸 KUGOU_GATEWAY_FAILED 无法确诊

// ===== Cloudlist 设备注册（dfid） =====
// web 扫码登录的 cookie 只有 KUGOU_API_GUID/MID 与 token/userid，没有 dfid；
// cloudlist 服务（歌单读写）要求「已注册设备的 dfid」，缺失时一律返回 error_code=20017。
// 首次使用 cloudlist 时向酷狗风控接口注册设备（AES+RSA，协议对齐 KuGouMusicApi register_dev），
// 取回 dfid 后进程内缓存，并注入到后续 cloudlist 请求的 cookie/参数里。
// server.js 启动时注入：注册得到新 dfid 后写回 cookie 存档，避免每次启动重复注册
// 与 server.js 登录注册一致：使用 lite（酷狗概念版）RSA 公钥






// ===== Cloudlist 专用通道（酷狗概念版 lite 客户端身份） =====
// 登录会话（token）是在 lite 客户端身份下签发的（appid=3116 / clientver=11440 / lite 盐 / UA 11440，
// 与 server.js 的登录、歌单列表链路一致）。cloudlist 服务校验「请求客户端身份 == token 签发身份」，
// 用标准版身份（1005/20489）访问会一律返回 error_code=20017——无论签名正确与否。











async function kugouSearch(keywords, limit, cookie, offset) {
  const auth = extractKugouAuth(cookie);
  offset = Math.max(0, Number(offset) || 0);
  const pageSize = Math.max(1, Math.min(limit || 8, 20));
  const u = new URL(KUGOU_SEARCH_URL);
  u.searchParams.set('keyword', keywords);
  u.searchParams.set('page', String(Math.floor(offset / pageSize) + 1));
  u.searchParams.set('pagesize', String(pageSize));
  u.searchParams.set('userid', auth.userid || '-1');
  u.searchParams.set('clientver', '2000');
  u.searchParams.set('platform', 'WebFilter');
  u.searchParams.set('tag', 'em');
  u.searchParams.set('filter', '2');
  u.searchParams.set('iscorrection', '1');
  u.searchParams.set('privilege_filter', '0');
  u.searchParams.set('filter_ver', '2');
  u.searchParams.set('appid', String(KUGOU_WEB_APPID));
  u.searchParams.set('token', auth.token || '');
  u.searchParams.set('mid', auth.mid);
  const json = await requestJson(u.toString(), {
    headers: { ...KUGOU_HEADERS, Cookie: buildKugouRequestCookie(cookie) },
  });
  const list = json && json.data && Array.isArray(json.data.lists) ? json.data.lists : [];
  return list.map(mapKugouSearchItem).filter(s => s.name && (s.hash || s.id));
}

async function handleKugouSearch(keywords, limit, cookie, offset) {
  const kw = String(keywords || '').trim();
  const lim = Math.max(1, Math.min(Number(limit) || 10, 20));
  const start = Math.max(0, Number(offset) || 0);
  if (!kw) return [];
  const cacheKey = kw.toLowerCase() + ':' + lim + ':' + start;
  return kugouSearchCache.wrap(cacheKey, null, async () => {
    kugouDebug('[KugouSearch]', kw, 'limit:', lim, 'offset:', start);
    return kugouSearch(kw, lim, cookie, start);
  });
}

module.exports = {
  kugouSearch,
  handleKugouSearch,
};
