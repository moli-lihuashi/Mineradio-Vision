'use strict';

// Petdex 接入的地址/标识校验（纯函数，无网络无 IO，可单测）。
//
// 这两条规则是安全边界，不能散落在路由里靠肉眼保证：
//   · slug 直接参与磁盘路径（<petsRoot>/<slug>/），必须防路径穿越
//   · 下载地址来自客户端 POST body，必须限定在 petdex 资源域，防 SSRF

// 小写字母数字与连字符，必须以字母数字开头，最长 64。
// 这样 '..' / '/' / '\\' / 绝对路径 / Windows 保留名都被排除在外。
const PET_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const PETDEX_ASSET_HOST = 'assets.petdex.dev';

function isSafePetSlug(value) {
  const slug = String(value == null ? '' : value).trim();
  if (!PET_SLUG_RE.test(slug)) return false;
  // 双保险：即使正则被改动，也不接受路径分隔符与上跳段
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) return false;
  return true;
}

/**
 * 校验并归一 Petdex 精灵表地址。
 * 只接受 https + assets.petdex.dev + .webp/.png；其余返回 ''（调用方据此拒绝）。
 * @param {unknown} rawUrl
 * @returns {string} 归一后的 href，或空串
 */
function resolvePetdexAssetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl == null ? '' : rawUrl));
  } catch (_) {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  if (parsed.hostname.toLowerCase() !== PETDEX_ASSET_HOST) return '';
  if (parsed.port && parsed.port !== '443') return '';
  if (parsed.username || parsed.password) return '';
  if (!/\.(webp|png)$/i.test(parsed.pathname)) return '';
  return parsed.href;
}

/**
 * 解析用户粘贴的内容 → { slug } 或 null。
 *
 * 支持两种形态（其余一律拒绝，避免把任意字符串当路径用）：
 *   · 宠物页地址：https://petdex.dev/pets/hachiware-2 或 /zh/pets/hachiware-2
 *   · 纯 slug：hachiware-2
 *
 * 注意：**不按宠物名解析**。petdex 的搜索接口是按显示名/标签匹配的，
 * 用 slug 去搜反而搜不到（实测 q=hachiware-2 返回 total=0，而 q=小八 能搜到它），
 * 所以名单匹配这条路不可靠，这里只做地址/slug 解析。
 *
 * @param {unknown} raw
 * @returns {{slug: string, source: 'url'|'slug'} | null}
 */
function parsePetdexPetInput(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;

  // 纯 slug
  if (isSafePetSlug(text)) return { slug: text, source: 'slug' };

  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'petdex.dev' && host !== 'www.petdex.dev') return null;

  // /pets/<slug> 与 /<lang>/pets/<slug> 两种路径
  const m = parsed.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?pets\/([a-z0-9][a-z0-9-]{0,63})\/?$/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  if (!isSafePetSlug(slug)) return null;
  return { slug, source: 'url' };
}

function decodeHtmlEntities(text) {
  return String(text == null ? '' : text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 从宠物页 HTML 里抽出精灵表地址与展示信息。
 *
 * 为什么不用官方 API：`/api/pets/<slug>` 需要登录（401），
 * 而 `/api/pets/search` 是按显示名匹配的——用 slug 搜不到目标（实测）。
 * 页面 HTML 里反而有权威信息：`.pet-sprite` 元素的 `--sprite-url` CSS 变量。
 *
 * @param {unknown} html
 * @returns {{spriteUrl: string, displayName: string, description: string} | null}
 */
function extractPetFromHtml(html) {
  const text = String(html == null ? '' : html);

  const spriteMatch = text.match(/--sprite-url:\s*url\((?:&quot;|"|')?([^)"']+\.(?:webp|png))/i);
  if (!spriteMatch) return null;
  const spriteUrl = resolvePetdexAssetUrl(decodeHtmlEntities(spriteMatch[1]).trim());
  if (!spriteUrl) return null;

  const h1 = text.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
  let displayName = h1 ? decodeHtmlEntities(h1[1]).trim() : '';
  if (!displayName) {
    // og:title 形如 "小八: Animated Codex pet"，切掉后缀
    const og = text.match(/property="og:title"\s+content="([^"]{1,120})"/i);
    if (og) displayName = decodeHtmlEntities(og[1]).split(':')[0].trim();
  }

  // RSC payload 里的 description 字段（转义过引号）
  const descMatch = text.match(/\\?"description\\?":\\?"((?:[^"\\]|\\.){0,400})\\?"/);
  const description = descMatch ? decodeHtmlEntities(descMatch[1]).slice(0, 300) : '';

  return { spriteUrl, displayName: displayName.slice(0, 80), description };
}

module.exports = {
  isSafePetSlug,
  resolvePetdexAssetUrl,
  parsePetdexPetInput,
  extractPetFromHtml,
  decodeHtmlEntities,
  PET_SLUG_RE,
  PETDEX_ASSET_HOST,
};
