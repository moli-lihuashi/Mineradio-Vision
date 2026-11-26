'use strict';

// 出站 URL 防护（SSRF）：只放行公网 http(s) 目标。
//
// 使用方：
//   · server/lx/source-host.js —— LX 音源导入、lx.request、沙箱 fetch（脚本是第三方代码，
//     链接导入接口此前只校验协议，可被打内网/云元数据）；
//   · server/lib/media-proxy.js —— 媒体代理原有 host 白名单之外，共用本文件的 IP 判定
//     （补齐 CGNAT 100.64/10、0.0.0.0/8、组播/保留段、IPv6 映射地址等此前漏掉的网段）。
//
// 已知边界：DNS 校验与实际连接是两次解析（TOCTOU），彻底解决要在 socket 层锁定解析结果；
// 这里与媒体代理保持同一防护级别，挡住的是「域名解析到内网」这类常规 SSRF。
// dns 可注入（测试用）。

const dns = require('dns');
const net = require('net');

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.in-addr.arpa', '.ip6.arpa'];

const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],       // 本网络
  ['10.0.0.0', 8],      // 私网
  ['100.64.0.0', 10],   // CGNAT
  ['127.0.0.0', 8],     // 回环
  ['169.254.0.0', 16],  // 链路本地（含 169.254.169.254 云元数据）
  ['172.16.0.0', 12],   // 私网
  ['192.0.0.0', 24],    // IETF 协议分配
  ['192.0.2.0', 24],    // TEST-NET-1
  ['192.88.99.0', 24],  // 6to4 中继
  ['192.168.0.0', 16],  // 私网
  ['198.18.0.0', 15],   // 基准测试
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // 组播
  ['240.0.0.0', 4],     // 保留（含 255.255.255.255）
];

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isBlockedHostname(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix));
}

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function intToIpv4(value) {
  const n = value >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value == null) return true;
  for (const [base, bits] of BLOCKED_IPV4_RANGES) {
    const baseValue = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((value & mask) >>> 0) === ((baseValue & mask) >>> 0)) return true;
  }
  return false;
}

// 把 IPv6 展开成 8 个 16 位分组；不合法返回 null
function expandIpv6(ip) {
  let text = String(ip || '').toLowerCase();
  const zoneIndex = text.indexOf('%');
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex);
  if (!text.includes(':')) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part) => (part ? part.split(':') : []);
  let head = parseGroups(halves[0]);
  let tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  // 末尾内嵌 IPv4（::ffff:1.2.3.4）
  const expandTrailingV4 = (groups) => {
    if (!groups.length) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes('.')) return groups;
    const v4 = ipv4ToInt(last);
    if (v4 == null) return null;
    return groups.slice(0, -1).concat([String((v4 >>> 16) & 0xffff), String(v4 & 0xffff)]);
  };
  head = expandTrailingV4(head);
  tail = expandTrailingV4(tail);
  if (!head || !tail) return null;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    head = head.concat(new Array(missing).fill('0'), tail);
  }
  if (head.length !== 8) return null;
  const groups = [];
  for (const group of head) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups;
}

function isBlockedIpv6(ip) {
  const groups = expandIpv6(ip);
  if (!groups) return true;
  const allZeroPrefix = (count) => groups.slice(0, count).every((g) => g === 0);
  if (groups.every((g) => g === 0)) return true;                       // ::
  if (allZeroPrefix(7) && groups[7] === 1) return true;                // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true;                    // fc00::/7 ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true;                    // fe80::/10 链路本地
  if ((groups[0] & 0xff00) === 0xff00) return true;                    // ff00::/8 组播
  if (allZeroPrefix(5) && groups[5] === 0xffff) {                      // ::ffff:a.b.c.d
    const v4 = ((groups[6] << 16) | groups[7]) >>> 0;
    return isBlockedIpv4(intToIpv4(v4));
  }
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {                  // 64:ff9b::/96 NAT64
    const v4 = ((groups[6] << 16) | groups[7]) >>> 0;
    return isBlockedIpv4(intToIpv4(v4));
  }
  if (groups[0] === 0x2002) {                                          // 2002::/16 6to4
    const v4 = ((groups[1] << 16) | groups[2]) >>> 0;
    return isBlockedIpv4(intToIpv4(v4));
  }
  return false;
}

function isBlockedAddress(address) {
  const value = normalizeHostname(address);
  if (!value) return true;
  const family = net.isIP(value);
  if (family === 4) return isBlockedIpv4(value);
  if (family === 6) return isBlockedIpv6(value);
  return true;
}

// 校验并返回规范化 URL；失败抛错（错误码统一为 <TAG>_*，调用方自行映射）
async function assertPublicHttpUrl(raw, label, deps) {
  const tag = String(label || 'URL').toUpperCase();
  const value = String(raw == null ? '' : raw).trim();
  if (!value) throw new Error(tag + '_MISSING');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error(tag + '_INVALID');
  }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error(tag + '_PROTOCOL_NOT_ALLOWED');
  if (parsed.username || parsed.password) throw new Error(tag + '_CREDENTIALS_NOT_ALLOWED');
  const host = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(host)) throw new Error(tag + '_HOST_NOT_ALLOWED');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(tag + '_ADDRESS_NOT_ALLOWED');
    return parsed.toString();
  }
  // dns.lookup 是回调 API；默认走 promises 版本。deps.dns 允许注入（测试/替身）。
  const resolver = (deps && deps.dns) || dns.promises;
  let addrs = [];
  try {
    addrs = await resolver.lookup(host, { all: true, verbatim: true });
  } catch (_) {
    throw new Error(tag + '_DNS_FAILED');
  }
  if (!Array.isArray(addrs) || !addrs.length) throw new Error(tag + '_DNS_FAILED');
  for (const entry of addrs) {
    if (isBlockedAddress(entry && entry.address)) throw new Error(tag + '_ADDRESS_NOT_ALLOWED');
  }
  return parsed.toString();
}

module.exports = {
  normalizeHostname,
  isBlockedHostname,
  isBlockedAddress,
  assertPublicHttpUrl,
};
