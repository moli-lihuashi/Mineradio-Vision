'use strict';

// =============================================================================
// 写进运行日志 / 诊断报告之前，把登录凭据的「值」换成 <redacted>。
// 借 Folia redactCredentials 的原则：只换值，不换名。哪个参数、哪个 Cookie 名在场
// 仍看得出来；IP、错误原文、请求路径全部保留 —— 否则日志就没有排障价值了。
//
// 凭据进日志的路子：平台接口把整串 Cookie 放在请求地址的 cookie= 参数里、
// 日志把整个地址连同解码后的 Cookie 打出来，或直接打出 Cookie 头 / 带 cookie 字段的对象。
// =============================================================================

const REDACTED = '<redacted>';

// Mineradio 实际在用的登录态字段名（酷狗 / 网易 / QQ / 汽水 / Spotify）。
// 按名匹配而不是按目录动态发现：本项目的凭据来源集中在 server.js 的 cookie 持久层。
const CREDENTIAL_COOKIE_NAMES = [
  'KuGoo', 'token', 'userid', 'user_id', 'uid', 'dfid', 'kg_dfid', 'kg_mid', 'mid',
  'MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID', 'MUSIC_R_T', 'MUSIC_R_TT',
  'uin', 'qm_keyst', 'QIMEI', 'musickey', 'refresh_token', 'access_token',
];

const RULES = [
  // 地址里的 ?cookie= / &cookie=：到下一个 & 或空白。
  // 停在空白很关键：日志常把 URL 和「failed at 1.2.3.4」写在同一行，
  // 吃到行尾会把错误原文和 IP 一起吞掉，日志就没有排障价值了。
  [/([?&]cookie=)[^&\s\r\n]*/gi, `$1${REDACTED}`],
  // 其它凭据查询参数（token / access_token / musickey …）。
  [/([?&](?:token|access_token|refresh_token|musickey)=)[^&\s\r\n]*/gi, `$1${REDACTED}`],
  // JSON 或打出来的对象里的 cookie 字段："cookie":"…"、cookie: '…'。hasLoginCookie 之类不算。
  [/((?:^|[^\w])["']?(?:set-)?cookie["']?\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gim, `$1"${REDACTED}"`],
  // 没加引号的 Cookie / Set-Cookie 头：到行尾。加了引号的是上一条字段，已经换过了。
  [/(^|[\s{,;])((?:set-)?cookie:(?!\s*["'])\s*)[^\r\n]*/gim, `$1$2${REDACTED}`],
  // 日志里直接写出来的 cookie=值（前面没有 ? 或 & 也算）。
  [/((?:^|[^\w])cookie=)[^&\s\r\n;,]+/gi, `$1${REDACTED}`],
  // 散落在别处的登录 Cookie：名字=值。
  [new RegExp('(\\b(?:' + CREDENTIAL_COOKIE_NAMES.join('|') + ')=)[^;&\\s"\',]+', 'gi'), `$1${REDACTED}`],
  // 代理地址里的账号密码（保留主机名与端口用于诊断代理链路）。
  [/\/\/([^/@\s]+)@/g, '//***@'],
];

function redactCredentials(text) {
  if (typeof text !== 'string' || !text) return text;
  let result = text;
  for (const [pattern, replacement] of RULES) result = result.replace(pattern, replacement);
  return result;
}

module.exports = { REDACTED, CREDENTIAL_COOKIE_NAMES, redactCredentials };
