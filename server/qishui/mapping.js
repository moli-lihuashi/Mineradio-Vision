'use strict';

// 汽水音乐：资源映射层（上游 JSON → 前端结构）。
// 从 qishui-api.js 抽出（第 2 刀）。全是纯函数：歌词归一、图片/profile、会员判定、
// 音质与流候选、媒体/曲目、歌单卡片、公开搜索评分、评论、track_v2 归一。
//
// 这里不做任何 I/O —— 唯一的「状态」是 lyrics 缓存（cacheQishuiLyric 写 http 层的
// qishuiLyricCache），所以本模块单向依赖 ./http，不知道任何网络细节。

const {
  qishuiLyricCache,
  normalizeText,
  qishuiRestriction,
} = require('./http');

function normalizeLyricBody(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function qishuiLyricTimestamp(ms) {
  ms = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return '[' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(centiseconds).padStart(2, '0') +
    ']';
}

function qishuiConvertLyric(value) {
  const input = normalizeLyricBody(value);
  if (!input) return { lyric: '', yrc: '' };
  const lrcLines = [];
  const yrcLines = [];
  let converted = false;
  input.split('\n').forEach(rawLine => {
    const line = String(rawLine || '').trim();
    const timed = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!timed) return;
    const lineStart = Math.max(0, Number(timed[1]) || 0);
    const lineDuration = Math.max(0, Number(timed[2]) || 0);
    const body = timed[3] || '';
    const wordPattern = /([<(])(\d+),(\d+),(\d+)[>)]([^<(]*)/g;
    let wordMatch;
    let text = '';
    let yrcBody = '';
    while ((wordMatch = wordPattern.exec(body))) {
      const rawStart = Math.max(0, Number(wordMatch[2]) || 0);
      const wordDuration = Math.max(0, Number(wordMatch[3]) || 0);
      const wordText = String(wordMatch[5] || '');
      if (!wordText) continue;
      const absoluteStart = wordMatch[1] === '<'
        ? lineStart + rawStart
        : (rawStart >= Math.max(0, lineStart - 500) ? rawStart : lineStart + rawStart);
      text += wordText;
      yrcBody += '(' + absoluteStart + ',' + wordDuration + ',' + (Number(wordMatch[4]) || 0) + ')' + wordText;
    }
    if (!text) text = body.replace(/[<(]\d+,\d+,\d+[>)]/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    converted = true;
    lrcLines.push(qishuiLyricTimestamp(lineStart) + text);
    yrcLines.push('[' + lineStart + ',' + lineDuration + ']' + (yrcBody || text));
  });
  if (!converted) return { lyric: input, yrc: '' };
  return {
    lyric: lrcLines.join('\n'),
    yrc: yrcLines.join('\n'),
  };
}

function qishuiLyricTextFromNode(value) {
  value = qishuiMaybeParseJson(value);
  if (typeof value === 'string') {
    const text = normalizeLyricBody(value);
    return /^https?:\/\//i.test(text) ? '' : text;
  }
  if (!value || typeof value !== 'object') return '';
  const entity = pickObject(
    value.lyric_entity,
    value.lyricEntity,
    value.original_lyric,
    value.originalLyric,
    value
  );
  for (const key of ['content', 'lyric_text', 'lyricText', 'text', 'original_content', 'originalContent']) {
    const text = qishuiLyricTextFromNode(entity[key]);
    if (text) return text;
  }
  if (entity !== value) return qishuiLyricTextFromNode(entity);
  return '';
}

function extractQishuiLyrics(payload) {
  const found = { lyric: '', tlyric: '' };
  const seen = new Set();
  let visitedNodes = 0;
  function visit(node, pathText, depth) {
    if (!node || depth > 7 || visitedNodes >= 600 || (found.lyric && found.tlyric)) return;
    node = qishuiMaybeParseJson(node);
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    visitedNodes += 1;
    Object.keys(node).slice(0, 120).forEach(key => {
      const child = node[key];
      const childPath = pathText ? pathText + '.' + key : key;
      if (/lyric|lyrics|tlyric|translation/i.test(key)) {
        const text = qishuiLyricTextFromNode(child);
        if (text) {
          if (/translat|tlyric|lang_translation|translated/i.test(childPath)) {
            if (!found.tlyric) found.tlyric = text;
          } else if (!found.lyric) {
            found.lyric = text;
          }
        }
      }
      if (/^(album_tracks|artist_tracks|chart_tracks|comments|prompts|recommend_media_list)$/i.test(key)) return;
      visit(child, childPath, depth + 1);
    });
  }
  visit(payload, '', 0);
  return found;
}

function firstUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(firstUrl).find(Boolean) || '';
  if (typeof value === 'object') {
    return firstUrl(value.url_list || value.urls || value.url || value.uri || value.main_url || value.cover_url || value.download_url);
  }
  return '';
}

function qishuiImageUrl(value, suffix) {
  if (!value) return '';
  if (typeof value === 'string') {
    const text = normalizeText(value);
    if (!/^https?:\/\//i.test(text)) return '';
    return suffix && !text.includes('~') ? text + suffix : text;
  }
  if (Array.isArray(value)) return value.map(item => qishuiImageUrl(item, suffix)).find(Boolean) || '';
  if (typeof value !== 'object') return '';
  const cover = normalizeText(firstUrl(value.urls || value.url_list || value.urlList || value.url || value.main_url || value.cover_url || value.image_url || ''));
  const uri = normalizeText(value.uri || value.url_key || value.image_uri || value.cover_uri || '');
  let out = cover;
  if (out && uri && !out.includes(uri)) out += uri;
  if (!out && /^https?:\/\//i.test(uri)) out = uri;
  if (!/^https?:\/\//i.test(out)) return '';
  return suffix && !out.includes('~') ? out + suffix : out;
}

function qishuiFirstImageUrl(suffix) {
  for (let i = 1; i < arguments.length; i++) {
    const url = qishuiImageUrl(arguments[i], suffix);
    if (url) return url;
  }
  return '';
}

function pickObject() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function qishuiProfileFromUser(user) {
  user = user && typeof user === 'object' ? user : {};
  const nickname = normalizeText(
    user.nickname ||
    user.nick_name ||
    user.nickName ||
    user.display_name ||
    user.displayName ||
    user.name ||
    user.public_name ||
    user.publicName ||
    user.douyin_id ||
    ''
  );
  const userId = normalizeText(
    user.id ||
    user.user_id ||
    user.userId ||
    user.uid ||
    user.sec_uid ||
    user.secUid ||
    user.open_id ||
    ''
  );
  const avatar = qishuiFirstImageUrl('~c5_300x300.jpg',
    user.larger_avatar_url,
    user.medium_avatar_url,
    user.avatar_url,
    user.avatarUrl,
    user.avatar,
    user.user_avatar,
    user.pic,
    user.icon
  );
  return {
    userId,
    nickname,
    avatar,
    douyinId: normalizeText(user.douyin_id || user.unique_id || user.short_id || ''),
    profileReady: !!(userId || nickname || avatar),
  };
}

function qishuiProfileFromMeData(meData) {
  const data = (meData && meData.data) || meData || {};
  const user = pickObject(data.my_info, data.myInfo, data.user, data.user_info, data.userInfo, data.account, data.me, data);
  const profile = qishuiProfileFromUser(user);
  if (!profile.userId) {
    profile.userId = normalizeText(data.user_id || data.userId || data.uid || data.id || '');
  }
  if (!profile.nickname) {
    profile.nickname = normalizeText(data.nickname || data.nick_name || data.name || data.douyin_id || '');
  }
  if (!profile.avatar) {
    profile.avatar = qishuiFirstImageUrl('~c5_300x300.jpg',
      data.larger_avatar_url,
      data.medium_avatar_url,
      data.avatar_url,
      data.avatar,
      data.pic
    );
  }
  Object.assign(profile, qishuiMembershipFromData(data));
  profile.profileReady = !!(profile.userId || profile.nickname || profile.avatar);
  return profile;
}

function pickArray() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function qishuiObjectString(obj, keys) {
  obj = obj && typeof obj === 'object' ? obj : {};
  for (const key of keys || []) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const text = value.map(item => normalizeText(item)).find(Boolean);
      if (text) return text;
      continue;
    }
    if (typeof value !== 'object') {
      const text = normalizeText(value);
      if (text) return text;
    }
  }
  return '';
}

function qishuiObjectNumber(obj, keys) {
  const text = qishuiObjectString(obj, keys);
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

const QISHUI_VIP_NUMBER_KEYS = new Set([
  'viptype', 'viplevel', 'membertype', 'memberlevel', 'musicviptype', 'musicviplevel',
]);

const QISHUI_SVIP_NUMBER_KEYS = new Set([
  'sviptype', 'sviplevel', 'superviptype', 'superviplevel',
]);

const QISHUI_VIP_FLAG_KEYS = new Set([
  'isvip', 'ismember', 'hasvip', 'hasmembership', 'vipactive', 'vipenabled',
]);

const QISHUI_SVIP_FLAG_KEYS = new Set([
  'issvip', 'issupervip', 'hassvip', 'hassupervip', 'svipactive', 'svipenabled',
]);

const QISHUI_MEMBERSHIP_LABEL_KEYS = new Set([
  'viplevelname', 'vipname', 'memberlevelname', 'membername', 'membershiplevel', 'membershiptype',
]);

const QISHUI_VIP_CONTAINER_KEYS = new Set([
  'vipinfo', 'vipdetail', 'vipbenefit', 'vippackage', 'memberinfo', 'memberdetail',
  'memberbenefit', 'memberpackage', 'membershipinfo', 'membershipdetail',
]);

const QISHUI_SVIP_CONTAINER_KEYS = new Set([
  'svipinfo', 'svipdetail', 'svipbenefit', 'svippackage', 'supervipinfo',
  'supervipdetail', 'supervipbenefit', 'supervippackage',
]);

const QISHUI_MEMBERSHIP_STATUS_KEYS = new Set([
  'status', 'state', 'active', 'valid', 'enabled', 'isactive', 'isvalid', 'isenabled',
]);

const QISHUI_MEMBERSHIP_EXPIRY_KEYS = new Set([
  'expiretime', 'expiresat', 'expirationtime', 'expiredat', 'endtime', 'validuntil',
  'vipexpiretime', 'vipexpiresat', 'vipexpiredat', 'vipendtime',
  'memberexpiretime', 'memberexpiresat', 'memberexpiredat', 'memberendtime',
  'svipexpiretime', 'svipexpiresat', 'svipexpiredat', 'svipendtime',
]);

function qishuiNormalizedFieldKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function qishuiExplicitPositive(value) {
  if (value === true) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) > 0;
  return /^(true|yes|active|valid|enabled|opened|vip|svip|premium|member|会员|已开通|有效)$/.test(text);
}

function qishuiExplicitNegative(value) {
  if (value === false || value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value <= 0;
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) <= 0;
  return /^(false|no|inactive|invalid|disabled|closed|expired|none|free|normal|ordinary|非会员|普通用户|未开通|无vip|已过期|过期)$/.test(text);
}

function qishuiMembershipLevelValue(value) {
  const text = normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (/^(svip|supervip|超级会员|超级vip|豪华会员)$/.test(text)) return 'svip';
  if (/^(vip|premium|member|会员|普通会员)$/.test(text)) return 'vip';
  if (/^(none|free|normal|ordinary|novip|非会员|普通用户|未开通|无vip|已过期|过期)$/.test(text)) return 'none';
  return '';
}

function qishuiMembershipExpiryMillis(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number < 100000000000 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function qishuiMembershipObjectState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { known: false, active: null, expiresAt: 0 };
  }
  let known = false;
  let statusPositive = false;
  let statusNegative = false;
  let expiryExpired = false;
  let futureExpiry = 0;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = qishuiNormalizedFieldKey(key);
    if (QISHUI_MEMBERSHIP_EXPIRY_KEYS.has(normalizedKey)) {
      const expiresAt = qishuiMembershipExpiryMillis(item);
      if (expiresAt > 0) {
        known = true;
        if (expiresAt <= Date.now()) {
          expiryExpired = true;
        } else if (!futureExpiry || expiresAt < futureExpiry) {
          futureExpiry = expiresAt;
        }
      } else if (item !== '' && item !== null && item !== undefined && Number.isFinite(Number(item)) && Number(item) <= 0) {
        known = true;
        expiryExpired = true;
      }
      continue;
    }
    if (!QISHUI_MEMBERSHIP_STATUS_KEYS.has(normalizedKey)) continue;
    if (qishuiExplicitNegative(item)) {
      known = true;
      statusNegative = true;
    } else if (qishuiExplicitPositive(item)) {
      known = true;
      statusPositive = true;
    }
  }
  const active = expiryExpired || statusNegative
    ? false
    : (futureExpiry > 0 || statusPositive ? true : null);
  return {
    known,
    active,
    expiresAt: active === true ? futureExpiry : 0,
  };
}

function qishuiMembershipFromData(value) {
  value = value && typeof value === 'object' ? value : {};
  let membershipKnown = false;
  let isVip = false;
  let isSvip = false;
  let vipType = 0;
  let svipType = 0;
  let vipExpiresAt = 0;
  let svipExpiresAt = 0;
  let visited = 0;

  const rememberExpiry = (level, expiresAt) => {
    expiresAt = Number(expiresAt) || 0;
    if (expiresAt <= Date.now()) return;
    if (level === 'svip') {
      if (!svipExpiresAt || expiresAt < svipExpiresAt) svipExpiresAt = expiresAt;
      return;
    }
    if (level === 'vip' && (!vipExpiresAt || expiresAt < vipExpiresAt)) vipExpiresAt = expiresAt;
  };

  const applyLevel = (level, numericValue, active, expiresAt) => {
    if (active === false || !level) return;
    if (level === 'svip') {
      isSvip = true;
      isVip = true;
      svipType = Math.max(svipType, Number(numericValue) || 1);
      rememberExpiry('svip', expiresAt);
      return;
    }
    if (level === 'vip') {
      isVip = true;
      vipType = Math.max(vipType, Number(numericValue) || 1);
      rememberExpiry('vip', expiresAt);
    }
  };

  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6 || visited > 600) return;
    visited += 1;
    if (Array.isArray(node)) {
      node.slice(0, 120).forEach(item => visit(item, depth + 1));
      return;
    }
    const objectState = qishuiMembershipObjectState(node);
    for (const [key, item] of Object.entries(node).slice(0, 160)) {
      const normalizedKey = qishuiNormalizedFieldKey(key);
      if (QISHUI_SVIP_NUMBER_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        const number = Number(item);
        if (Number.isFinite(number) && number > 0) applyLevel('svip', number, objectState.active, objectState.expiresAt);
      } else if (QISHUI_VIP_NUMBER_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        const number = Number(item);
        if (Number.isFinite(number) && number > 0) applyLevel('vip', number, objectState.active, objectState.expiresAt);
      } else if (QISHUI_SVIP_FLAG_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        if (qishuiExplicitPositive(item)) applyLevel('svip', 1, objectState.active, objectState.expiresAt);
      } else if (QISHUI_VIP_FLAG_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        if (qishuiExplicitPositive(item)) applyLevel('vip', 1, objectState.active, objectState.expiresAt);
      } else if (QISHUI_MEMBERSHIP_LABEL_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        applyLevel(qishuiMembershipLevelValue(item), 1, objectState.active, objectState.expiresAt);
      } else if (QISHUI_SVIP_CONTAINER_KEYS.has(normalizedKey) || QISHUI_VIP_CONTAINER_KEYS.has(normalizedKey)) {
        membershipKnown = true;
        const state = qishuiMembershipObjectState(item);
        if (state.active === true) {
          applyLevel(
            QISHUI_SVIP_CONTAINER_KEYS.has(normalizedKey) ? 'svip' : 'vip',
            1,
            true,
            state.expiresAt
          );
        }
      }
      if (item && typeof item === 'object') visit(item, depth + 1);
    }
  };

  visit(value, 0);
  if (isSvip) isVip = true;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  const activeExpiries = [vipExpiresAt, svipExpiresAt].filter(item => item > Date.now());
  return {
    membershipKnown,
    vipType: isSvip ? svipType : vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
    expiresAt: activeExpiries.length ? Math.min(...activeExpiries) : 0,
  };
}

function qishuiPlaybackMembershipFromPayload(payload) {
  const data = (payload && payload.data) || payload || {};
  const trustedCandidates = [
    data.user_membership,
    data.userMembership,
    data.account_membership,
    data.accountMembership,
    data.user && data.user.membership,
    data.account && data.account.membership,
    data.me && data.me.membership,
  ].filter(item => item && typeof item === 'object');
  if (trustedCandidates.length) {
    const trusted = qishuiMembershipFromData({ membership_sources: trustedCandidates });
    if (trusted.membershipKnown) return trusted;
  }
  const ambiguousCandidates = [
    data.membership,
    data.membership_info,
    data.membershipInfo,
  ].filter(item => item && typeof item === 'object');
  // Generic membership blocks are ambiguous: track_v2 may use them for the
  // media item's own restriction instead of the current account. Neither a
  // positive nor a negative value here may grant or revoke account rights.
  // Keep the read so future schema diagnostics can distinguish "absent" from
  // "present but untrusted" without changing the authorization boundary.
  void ambiguousCandidates;
  return {
    membershipKnown: false,
    vipType: 0,
    vipLevel: 'none',
    isVip: false,
    isSvip: false,
    vipLabel: '无VIP',
    expiresAt: 0,
  };
}

function qishuiNormalizeDurationSeconds(value) {
  const num = Number(value) || 0;
  if (!num) return 0;
  return num > 1000 ? Math.round(num / 1000) : Math.round(num);
}

function qishuiNormalizeBitrateKbps(value) {
  const num = Number(value) || 0;
  if (!num) return 0;
  return num > 1000 ? Math.round(num / 1000) : Math.round(num);
}

function qishuiBitrateForUi(value) {
  const kbps = qishuiNormalizeBitrateKbps(value);
  return kbps > 0 ? kbps * 1000 : 0;
}

function qishuiQualityRank(quality, format, bitrate) {
  const q = normalizeText(quality).toLowerCase().replace(/[-_\s]/g, '');
  const f = normalizeText(format).toLowerCase();
  const br = qishuiNormalizeBitrateKbps(bitrate);
  const losslessFormat = /flac|alac|wav/.test(f);
  const losslessLabel = /lossless|flac|sq|svip/.test(q);
  const hiresLabel = /hires|master/.test(q);
  if (hiresLabel && (losslessFormat || br >= 900)) return 110;
  if (losslessLabel || losslessFormat || br >= 900) return 100;
  if (hiresLabel) return 90;
  if (/atmos|dolby|spatial/.test(q)) return 88;
  if (/highest|excellent|superhigh|hq/.test(q)) return 80;
  if (/higher|high|320/.test(q) || br >= 320) return 70;
  if (/standard|medium|normal|128/.test(q) || br >= 128) return 50;
  if (/low|preview/.test(q)) return 10;
  return br > 0 ? 20 : 0;
}

function qishuiPlaybackLevel(quality, format, bitrate) {
  const rank = qishuiQualityRank(quality, format, bitrate);
  if (rank >= 100) return 'lossless';
  if (rank >= 80) return 'hires';
  if (rank >= 65) return 'exhigh';
  return 'standard';
}

function qishuiBetterStreamCandidate(a, b) {
  if (!b) return true;
  const ad = qishuiNormalizeDurationSeconds(a && a.duration);
  const bd = qishuiNormalizeDurationSeconds(b && b.duration);
  if (ad > 0 || bd > 0) {
    if (ad > bd + 1) return true;
    if (bd > ad + 1) return false;
  }
  const ar = qishuiQualityRank(a && a.quality, a && a.format, a && a.bitrate);
  const br = qishuiQualityRank(b && b.quality, b && b.format, b && b.bitrate);
  if (ar !== br) return ar > br;
  const ab = qishuiNormalizeBitrateKbps(a && a.bitrate);
  const bb = qishuiNormalizeBitrateKbps(b && b.bitrate);
  if (ab !== bb) return ab > bb;
  return (Number(a && a.size) || 0) > (Number(b && b.size) || 0);
}

function qishuiBestStreamCandidate(candidates) {
  let best = null;
  (candidates || []).forEach(item => {
    if (!item || !item.url) return;
    if (qishuiBetterStreamCandidate(item, best)) best = item;
  });
  return best;
}

const QISHUI_TRACK_VIP_KEYS = new Set([
  'onlyvipplayable', 'viprequired', 'needvip', 'isvip', 'isviponly', 'viponly', 'onlyvip',
  'onlymemberplayable', 'memberrequired', 'needmember', 'payplay',
]);

const QISHUI_TRACK_ACCOUNT_CONTAINER_KEYS = new Set([
  'membership', 'membershipinfo', 'usermembership', 'accountmembership',
  'account', 'userinfo', 'userprofile', 'me',
]);

// quality_map 是「按音质档」的权益表（{play_detail:{need_vip}, download_detail:{need_vip}}），
// 描述的是**某一档音质**能不能播/能不能下载，不是整曲要不要会员。实测汽水 UGC 曲目
// （如 7657031609262819354）medium/higher 的 play_detail.need_vip 都是 false，只有
// download_detail.need_vip=true、lossless/spatial/hi_res 的 play_detail.need_vip=true；
// 把它算进整曲判定会把免费曲目误判成「需要会员」而拒绝播放。
// 音质档权益由下游已有的三道机制负责：流级 qishuiStreamAllowedForMembership 过滤、
// resolveQishuiDownloadInfo 的 QISHUI_STANDARD_AUDIO_SOURCE_EMPTY、
// 以及 handleQishuiSongUrl 的 trial（流时长 + 5s < 曲目时长 → 试听片段 + 前端横幅）。
// 整曲级旗标（label_info.only_vip_playable 等）不在这个容器里，不受影响。
const QISHUI_TRACK_PER_QUALITY_CONTAINER_KEYS = new Set([
  'qualitymap', 'qualitydetailmap',
]);

function qishuiTrackPlaybackRestriction(value) {
  let vipRequired = false;
  let membershipHintKnown = false;
  let visited = 0;
  const evidence = [];
  const visit = (node, depth, pathKeys) => {
    if (!node || typeof node !== 'object' || depth > 7 || visited > 800 || vipRequired) return;
    visited += 1;
    if (Array.isArray(node)) {
      node.slice(0, 160).forEach(item => visit(item, depth + 1, pathKeys));
      return;
    }
    for (const [key, item] of Object.entries(node).slice(0, 180)) {
      const normalizedKey = qishuiNormalizedFieldKey(key);
      const nextPath = pathKeys.concat(normalizedKey);
      if (QISHUI_TRACK_ACCOUNT_CONTAINER_KEYS.has(normalizedKey)) continue;
      if (QISHUI_TRACK_PER_QUALITY_CONTAINER_KEYS.has(normalizedKey)) continue;
      if (QISHUI_TRACK_VIP_KEYS.has(normalizedKey)) {
        membershipHintKnown = true;
        if (qishuiExplicitPositive(item)) {
          vipRequired = true;
          evidence.push(nextPath.join('.'));
          return;
        }
      } else if (normalizedKey === 'fee') {
        membershipHintKnown = true;
        if (Number(item) === 1) {
          vipRequired = true;
          evidence.push(nextPath.join('.'));
          return;
        }
      } else if (normalizedKey === 'privilege') {
        membershipHintKnown = true;
        if (Number(item) >= 9) {
          vipRequired = true;
          evidence.push(nextPath.join('.'));
          return;
        }
      }
      if (item && typeof item === 'object') visit(item, depth + 1, nextPath);
      if (vipRequired) return;
    }
  };
  visit(value, 0, []);
  return { vipRequired, membershipHintKnown, evidence };
}

function qishuiTrackRequiresVip(value) {
  return qishuiTrackPlaybackRestriction(value).vipRequired;
}

function qishuiStreamAllowedForMembership(stream, membership) {
  if (!stream || !stream.url) return false;
  if (membership && membership.isVip) return true;
  const rank = qishuiQualityRank(stream.quality, stream.format, stream.bitrate);
  return rank <= 50;
}

function qishuiBestStreamCandidateForMembership(candidates, membership) {
  return qishuiBestStreamCandidate((candidates || []).filter(item => qishuiStreamAllowedForMembership(item, membership)));
}

function qishuiStreamUrlFrom(value) {
  return normalizeText(qishuiObjectString(value, [
    'main_play_url', 'MainPlayUrl', 'main_url', 'MainUrl', 'url', 'URL', 'play_url', 'PlayURL',
    'playable_url', 'PlayableUrl', 'playableUrl',
  ]) || qishuiObjectString(value, [
    'backup_play_url', 'BackupPlayUrl', 'backup_url', 'BackupUrl', 'backup_url_1', 'backup_url_2', 'backup_url_3',
  ]) || firstUrl(value && (value.backup_urls || value.backupUrls || value.url_list || value.UrlList)));
}

function qishuiBitrateFromUrl(value) {
  value = normalizeText(value);
  if (!value) return 0;
  try {
    const parsed = new URL(value);
    for (const key of ['br', 'bitrate', 'bit_rate', 'real_bitrate']) {
      const bitrate = Number(parsed.searchParams.get(key)) || 0;
      if (bitrate > 0) return bitrate;
    }
  } catch (_) {}
  const match = value.match(/(?:^|[/_.-])(\d{2,4})(?:k|kbps)(?:[/_.-]|$)/i);
  return match ? Number(match[1]) || 0 : 0;
}

function qishuiBitrateFromSize(size, duration) {
  size = Number(size) || 0;
  duration = qishuiNormalizeDurationSeconds(duration);
  if (size <= 0 || duration <= 0) return 0;
  const bitrate = Math.round((size * 8) / duration);
  return bitrate >= 32000 && bitrate <= 12000000 ? bitrate : 0;
}

function qishuiStreamFromObject(value, inherited) {
  if (!value || typeof value !== 'object') return null;
  const url = qishuiStreamUrlFrom(value);
  if (!url) return null;
  inherited = inherited || {};
  const meta = pickObject(value.video_meta, value.VideoMeta, value.meta, value.Meta);
  const size = qishuiObjectNumber(value, ['size', 'Size', 'file_size', 'FileSize', 'data_size', 'DataSize']) ||
    qishuiObjectNumber(meta, ['size', 'Size', 'file_size', 'FileSize']);
  const duration = qishuiNormalizeDurationSeconds(qishuiObjectNumber(value, ['duration', 'Duration']) || inherited.duration || 0);
  const bitrate = qishuiObjectNumber(value, ['bitrate', 'Bitrate', 'real_bitrate', 'RealBitrate', 'br', 'BR', 'bit_rate', 'BitRate']) ||
    qishuiObjectNumber(meta, ['bitrate', 'Bitrate', 'real_bitrate', 'RealBitrate', 'bit_rate', 'BitRate']) ||
    qishuiBitrateFromUrl(url) ||
    qishuiBitrateFromSize(size, duration);
  return {
    url,
    auth: qishuiObjectString(value, ['play_auth', 'PlayAuth', 'spade_a', 'SpadeA']) || qishuiVideoModelPlayAuth(value) || inherited.auth || '',
    size,
    format: qishuiObjectString(value, ['format', 'Format', 'vtype', 'VType', 'file_format', 'FileFormat']) ||
      qishuiObjectString(meta, ['format', 'Format', 'vtype', 'VType', 'codec_type', 'CodecType']),
    bitrate,
    quality: qishuiObjectString(value, ['quality', 'Quality', 'definition', 'Definition', 'quality_type', 'QualityType']) ||
      qishuiVideoModelQualityHint(qishuiObjectString(value, ['gear_des_key', 'GearDesKey']) || inherited.keyHint || ''),
    duration,
  };
}

function qishuiMaybeParseJson(value) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (!text) return value;
  for (let i = 0; i < 3 && text.charAt(0) === '"'; i++) {
    try { text = JSON.parse(text); }
    catch (_) { break; }
    if (typeof text !== 'string') return text;
    text = text.trim();
  }
  try { return JSON.parse(text); }
  catch (_) { return value; }
}

function qishuiCollectVideoModelStreams(value, keyHint, inherited, out) {
  value = qishuiMaybeParseJson(value);
  inherited = inherited || {};
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => qishuiCollectVideoModelStreams(item, keyHint, inherited, out));
    return;
  }
  if (typeof value !== 'object') return;
  const ownAuth = qishuiVideoModelPlayAuth(value) || inherited.auth || '';
  const ownDuration = qishuiNormalizeDurationSeconds(qishuiObjectNumber(value, ['video_duration', 'duration', 'Duration'])) || inherited.duration || 0;
  const entry = qishuiStreamFromObject(value, { auth: ownAuth, duration: ownDuration, keyHint });
  if (entry) out.push(entry);
  Object.keys(value).forEach(key => {
    qishuiCollectVideoModelStreams(value[key], key, { auth: ownAuth, duration: ownDuration }, out);
  });
}

function qishuiVideoModelPlayAuth(value) {
  value = value && typeof value === 'object' ? value : {};
  const child = pickObject(value.encrypt_info, value.EncryptInfo, value.encryptInfo);
  return qishuiObjectString(child, ['spade_a', 'SpadeA', 'spadeA', 'play_auth', 'PlayAuth']);
}

function qishuiVideoModelQualityHint(key) {
  const normalized = normalizeText(key).toLowerCase().replace(/[-_\s]/g, '');
  if (!normalized) return '';
  return ['hires', 'lossless', 'sq', 'flac', 'highest', 'higher', 'standard', 'normal'].find(token => normalized.includes(token)) || '';
}

function extractQishuiMediaList(payload) {
  const data = (payload && payload.data) || payload || {};
  const direct = pickArray(
    data.media_resources,
    data.media_list,
    data.related_media,
    data.medias,
    data.media,
    data.tracks,
    data.track_list,
    data.songs,
    data.items,
    data.list,
    data.result,
    data.song_list,
    data.recommend_media_list
  );
  if (direct.length) return direct;
  const candidates = [];
  function walk(node, depth) {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) {
      const mediaLike = node.filter(item => item && typeof item === 'object' && (item.media || item.track_entity || item.entity || item.base_info || item.id || item.media_id));
      if (mediaLike.length > candidates.length) candidates.splice(0, candidates.length, ...mediaLike);
      node.forEach(item => walk(item, depth + 1));
    } else if (typeof node === 'object') {
      Object.keys(node).slice(0, 80).forEach(key => walk(node[key], depth + 1));
    }
  }
  walk(data, 0);
  return candidates;
}

function qishuiArtists(related, base, display, track, media) {
  const links = pickArray(
    related.artist_links,
    related.artists,
    base.artist_links,
    base.artists,
    display.artist_links,
    display.artists,
    track && track.artists,
    media && media.artists
  );
  const out = [];
  links.forEach(item => {
    const name = normalizeText(item && (item.name || item.display_name || item.simple_display_name || item.title || item.artist_name));
    if (!name || out.some(a => a.name === name)) return;
    out.push({
      id: String((item && (item.id || item.artist_id || item.open_id)) || ''),
      name,
      mid: String((item && (item.id || item.artist_id || item.open_id)) || ''),
    });
  });
  const fallback = normalizeText(base.artist_name || display.artist_name || related.artist_name || track && track.artist_name || media && media.artist_name);
  if (fallback && !out.length) {
    fallback.split(/\s*\/\s*|\s*,\s*|\s*&\s*/).forEach(name => {
      name = normalizeText(name);
      if (name) out.push({ id: '', name, mid: '' });
    });
  }
  return out;
}

function qishuiLyricPayload(display, track, base, id) {
  const lyricInfo = pickObject(display.lyric_info, track.lyric_info, base.lyric_info);
  const lyricEntity = pickObject(lyricInfo.lyric_entity, lyricInfo.lyric, lyricInfo.original_lyric);
  const lyric = normalizeLyricBody(lyricEntity.content || lyricInfo.content || lyricInfo.lyric || lyricInfo.lyric_text || '');
  const translations = pickArray(lyricInfo.lang_translations, lyricInfo.translations, lyricInfo.translation);
  let tlyric = '';
  for (const item of translations) {
    const entity = pickObject(item && item.lyric_entity, item);
    const text = normalizeLyricBody(entity.content || item && (item.content || item.lyric || item.lyric_text));
    if (text) {
      tlyric = text;
      break;
    }
  }
  cacheQishuiLyric(id, lyric, tlyric, 'qishui-openapi-cache');
  return { lyric, tlyric };
}

function cacheQishuiLyric(id, lyric, tlyric, source) {
  id = normalizeText(id);
  const primary = qishuiConvertLyric(lyric);
  const translated = qishuiConvertLyric(tlyric);
  lyric = primary.lyric;
  tlyric = translated.lyric;
  if (!id || (!lyric && !tlyric)) return null;
  const payload = {
    provider: 'qishui',
    lyric,
    tlyric,
    yrc: primary.yrc,
    ytlrc: translated.yrc,
    source: source || 'qishui-cache',
    cachedAt: Date.now(),
  };
  qishuiLyricCache.set(id, payload);
  return payload;
}

function mapQishuiMedia(raw, index, query, opts) {
  opts = opts || {};
  raw = raw || {};
  const entity = pickObject(raw.entity, raw.data, raw);
  const media = pickObject(entity.media, raw.media, entity);
  const wrapper = pickObject(entity.track_wrapper, media.track_wrapper, raw.track_wrapper);
  const track = pickObject(wrapper.track, media.track_entity, raw.track_entity, media.track, raw.track, media);
  const base = pickObject(track.base_info, media.base_info, raw.base_info, track);
  const display = pickObject(track.display_info, media.display_info, raw.display_info);
  const related = pickObject(track.related_info, media.related_info, raw.related_info);
  const id = normalizeText(
    base.id || track.id || media.id || raw.id || raw.media_id || raw.item_id || raw.song_id || raw.vid || ('qishui-' + index + '-' + query)
  );
  const name = normalizeText(base.name || base.title || track.name || track.title || media.name || raw.name || raw.title);
  if (!id || !name) return null;
  const artists = qishuiArtists(related, base, display, track, media);
  const artist = artists.map(a => a.name).filter(Boolean).join(' / ') || normalizeText(base.author || raw.author || '');
  const albumLink = pickObject(related.album_link, related.album, base.album, display.album, track.album, media.album);
  const album = normalizeText(albumLink.name || albumLink.title || base.album_name || display.album_name || '');
  const cover = qishuiFirstImageUrl('~c5_375x375.jpg',
    display.cover_url,
    display.url_cover,
    base.cover_url,
    base.url_cover,
    albumLink.cover_url,
    albumLink.url_cover,
    track.url_cover,
    track.cover_url,
    media.cover_url,
    media.url_cover,
    raw.cover_url,
    raw.cover,
    raw.url_cover
  );
  const durationMs = Number(base.duration_ms || base.duration || track.duration_ms || track.duration || media.duration_ms || media.duration || raw.duration || 0) || 0;
  const lyricData = qishuiLyricPayload(display, track, base, id);
  const directPlayable = !!opts.directPlayable;
  return {
    provider: 'qishui',
    source: 'qishui',
    type: 'qishui',
    id,
    providerSongId: id,
    name,
    artist,
    artists,
    album,
    cover,
    duration: qishuiNormalizeDurationSeconds(durationMs),
    popularity: Number(raw.popularity || raw.hot || raw.heat || raw.play_count || raw.playCount || related.play_count || related.playCount || 0) || 0,
    fee: track.label_info && track.label_info.only_vip_playable ? 1 : 0,
    playable: directPlayable,
    playbackMode: directPlayable ? 'direct-url' : 'recommend-match',
    recommendationSource: directPlayable ? 'qishui-pc-session' : 'qishui-openapi',
    qishuiRank: index,
    qishuiQuery: query || '',
    lyric: lyricData.lyric,
    tlyric: lyricData.tlyric,
    restriction: qishuiRestriction('provider_limited', '汽水音乐当前作为推荐/匹配源接入，播放时会自动寻找其它可播版本。', 'switch_source'),
  };
}

function dedupeQishuiSongs(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    if (!song || !song.id) return;
    const key = String(song.providerSongId || song.id);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function mapQishuiMediaList(rawItems, query, opts) {
  return dedupeQishuiSongs((rawItems || []).map((item, index) => mapQishuiMedia(item, index, query, opts)).filter(Boolean));
}

function qishuiPlaylistLikeName(name) {
  const text = String(name || '');
  return /喜欢|收藏|favorite|liked/i.test(text) ||
    text.indexOf('\u559c\u6b22') >= 0 ||
    text.indexOf('\u6536\u85cf') >= 0;
}

function qishuiPlaylistPrimaryLikeName(name) {
  const text = String(name || '');
  return /favorite|liked/i.test(text) || text.indexOf('\u559c\u6b22') >= 0;
}

// 上游「我喜欢的音乐 / Ta喜欢的音乐」与我们合成的虚拟卡片 qishui-liked 是**同一条歌单**，
// 两条都下发就是 UI 上两张一模一样的卡片（同封面、同曲数）。
// 判定策略：
//   - 拿得到 likedCard.id 时**只按 id 精确匹配** → 不可能误杀别的歌单（id 唯一）。
//   - 拿不到 id 的降级路径才按名字，且只认汽水官方 likes 歌单的固定命名形态，
//     不认「我喜欢的歌」这类用户自建名，避免把用户自建歌单吞掉。
function qishuiPlaylistIsLikedCard(pl, likedCardId) {
  if (!pl || !pl.id) return false;
  const id = normalizeText(likedCardId || '');
  if (id) return String(pl.id) === id;
  const name = String(pl.name || '').trim();
  return !!pl.isLiked && /^(?:Ta|TA|ta|我|他|她)?(?:的)?喜欢的音乐$/.test(name);
}

function qishuiPlaylistIdFromItem(item) {
  item = item || {};
  return normalizeText(
    item.playlist_id ||
    item.playlistId ||
    item.collection_id ||
    item.collectionId ||
    item.id ||
    item.item_id ||
    item.resource_id ||
    item.object_id ||
    item.server_id ||
    ''
  );
}

function qishuiPlaylistNameFromItem(item) {
  item = item || {};
  return normalizeText(
    item.title ||
    item.public_title ||
    item.publicTitle ||
    item.name ||
    item.display_title ||
    item.display_name ||
    item.playlist_name ||
    item.collection_name ||
    ''
  );
}

function qishuiPlaylistCoverFromItem(item) {
  item = item || {};
  return qishuiFirstImageUrl('~c5_300x300.jpg',
    item.cover_url,
    item.cover,
    item.cover_uri,
    item.image,
    item.image_url,
    item.url_cover,
    item.icon,
    item.avatar
  );
}

function qishuiPlaylistTrackCountFromItem(item) {
  item = item || {};
  return Number(
    item.count_tracks ||
    item.track_count ||
    item.media_count ||
    item.count ||
    item.total ||
    item.song_count ||
    0
  ) || 0;
}

function extractQishuiPlaylistCards(payload) {
  const data = (payload && payload.data) || payload || {};
  const out = [];
  const seen = new Set();
  function visit(node, depth) {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const candidates = [
      node.playlist,
      node.playlist_info,
      node.collection,
      node.collect_playlist,
      node.fav_playlist,
      node.resource,
      node,
    ].filter(item => item && typeof item === 'object' && !Array.isArray(item));
    candidates.forEach(item => {
      const id = qishuiPlaylistIdFromItem(item);
      const name = qishuiPlaylistNameFromItem(item);
      const count = qishuiPlaylistTrackCountFromItem(item);
      const type = normalizeText(item.type || item.card_type || item.resource_type || node.type || '');
      if (!id || !name) return;
      if (!count && !qishuiPlaylistLikeName(name) && !/playlist|collection|fav|songlist|歌单/i.test(type + ' ' + name)) return;
      const key = id + '|' + name;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        provider: 'qishui',
        source: 'qishui',
        type: 'playlist',
        id,
        name,
        cover: qishuiPlaylistCoverFromItem(item),
        trackCount: count,
        playCount: Number(item.play_count || item.playCount || 0) || 0,
        creator: normalizeText(item.creator_name || item.author_name || item.owner_name || item.owner && (item.owner.nickname || item.owner.public_name) || '汽水音乐'),
        subscribed: true,
        virtual: false,
        webSession: true,
        isLiked: qishuiPlaylistLikeName(name),
        playbackMode: 'recommend-match',
      });
    });
    Object.keys(node).slice(0, 80).forEach(key => visit(node[key], depth + 1));
  }
  visit(data, 0);
  return out;
}

function buildQishuiVirtualPlaylist(id, name, songs, extra) {
  songs = Array.isArray(songs) ? songs : [];
  extra = extra || {};
  return {
    provider: 'qishui',
    source: 'qishui',
    type: 'playlist',
    id,
    name,
    cover: extra.cover || songs.map(song => song && song.cover).find(Boolean) || '',
    trackCount: Number(extra.trackCount || songs.length || 0) || 0,
    playCount: Number(extra.playCount || 0) || 0,
    creator: extra.creator || '汽水音乐',
    subscribed: !!extra.subscribed,
    shelfPane: extra.shelfPane || '',
    owned: !!extra.owned,
    virtual: true,
    webSession: !!extra.webSession,
    playbackMode: 'recommend-match',
  };
}

// 汽水公共目录（volcengine api-vehicle）是 UGC 目录：`author_info.name` 是**上传者**，不是原唱
// （实测「晴天」的 36 条里 author 是 季星白 / 球球想睡觉 / J.sheoy / DJ三秒心动 等），上游根本没有
// 「原唱」字段。原唱只可能被上传者写进标题的括号里：「晴天 (鋼琴版) [原唱: 周杰倫]」
// 「搁浅(Cover 周杰伦)」「擱淺 (原唱：周杰倫)」。播放侧的回退是按「同名同歌手」找可播版本，
// 所以必须把这两条信息解析出来，否则这批行永远匹配不到任何音源（用户侧表现为「无法播放」）。
const QISHUI_PUBLIC_ORIGINAL_ARTIST_RULES = [
  /(?:原唱|原曲|原歌手)\s*[:：]\s*(.+)/i,
  /cover\s*(?:by)?\s*[:：]?\s*(.+)/i,
  /(?:翻自|翻唱自)\s*[:：]?\s*(.+)/i,
];

const QISHUI_PUBLIC_TITLE_BRACKET_RE = /[（(【\[][^）)】\]]*[）)】\]]/g;

const QISHUI_PUBLIC_BRACKET_RE = /[（(【\[][^）)】\]]*[）)】\]]/;

function parseQishuiPublicOriginalInfo(title) {
  const raw = normalizeText(title || '');
  const brackets = raw.match(QISHUI_PUBLIC_TITLE_BRACKET_RE) || [];
  let originalArtist = '';
  for (const part of brackets) {
    const inner = normalizeText(String(part).replace(/^[（(【\[]/, '').replace(/[）)】\]]$/, ''));
    if (!inner) continue;
    for (const rule of QISHUI_PUBLIC_ORIGINAL_ARTIST_RULES) {
      const matched = inner.match(rule);
      if (matched && matched[1]) {
        const hint = normalizeText(matched[1]);
        if (hint) { originalArtist = hint; break; }
      }
    }
    if (originalArtist) break;
  }
  const stripped = normalizeText(raw.replace(QISHUI_PUBLIC_TITLE_BRACKET_RE, ' '));
  return { originalArtist, originalTitle: stripped || raw };
}

function mapQishuiPublicItem(raw, index, query) {
  raw = raw || {};
  const author = pickObject(raw.author_info, raw.author, raw.artist);
  const album = pickObject(raw.album_info, raw.album);
  const id = normalizeText(raw.item_id || raw.id || raw.song_id || raw.music_id || ('qishui-public-' + index + '-' + query));
  const name = normalizeText(raw.title || raw.name || raw.song_name);
  if (!id || !name) return null;
  const artistName = normalizeText(author.name || raw.author_name || raw.artist_name || raw.singer || '');
  const originalInfo = parseQishuiPublicOriginalInfo(name);
  const lyricInfo = pickObject(raw.lyric_info, raw.lyric);
  const lyric = normalizeLyricBody(lyricInfo.lyric_text || lyricInfo.content || lyricInfo.lyric || raw.lyric_text || '');
  cacheQishuiLyric(id, lyric, '', 'qishui-public-search-cache');
  return {
    provider: 'qishui',
    source: 'qishui',
    type: 'qishui',
    id,
    providerSongId: id,
    name,
    artist: artistName,
    artists: artistName ? [{ id: normalizeText(author.id || author.author_id), name: artistName, mid: normalizeText(author.id || author.author_id) }] : [],
    album: normalizeText(album.name || raw.album_name || ''),
    cover: firstUrl(raw.cover_url || raw.cover || raw.artwork || album.cover_url),
    duration: Number(raw.duration || raw.duration_ms || 0) > 10000 ? Math.round(Number(raw.duration || raw.duration_ms) / 1000) : (Number(raw.duration || raw.duration_ms || 0) || 0),
    fee: raw.qishui_label_info && raw.qishui_label_info.only_vip_playable ? 1 : 0,
    playable: false,
    playbackMode: 'recommend-match',
    recommendationSource: 'qishui-public-catalog',
    // 供播放回退使用：上传者不是原唱，匹配只能靠这两个字段。
    originalTitle: originalInfo.originalTitle,
    originalArtist: originalInfo.originalArtist,
    uploader: artistName || '',
    qishuiRank: index,
    qishuiQuery: query || '',
    lyric,
    tlyric: '',
    restriction: qishuiRestriction('provider_limited', '汽水音乐当前作为搜索/匹配源接入，播放时会自动寻找其它可播版本。', 'switch_source'),
  };
}

function qishuiSearchComparable(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function qishuiPublicSearchScore(song, keywords) {
  song = song || {};
  const query = qishuiSearchComparable(keywords);
  if (!query) return 0;
  const name = qishuiSearchComparable(song.name);
  const artist = qishuiSearchComparable(song.artist);
  const album = qishuiSearchComparable(song.album);
  let score = 0;
  if (name === query) score += 180;
  else if (name.includes(query)) score += 120;
  else if (name && query.includes(name) && name.length >= 2) score += 70;
  if (artist === query) score += 150;
  else if (artist.includes(query)) score += 105;
  if (album === query) score += 80;
  else if (album.includes(query)) score += 45;
  const tokens = normalizeText(keywords).split(/\s+/).map(qishuiSearchComparable).filter(token => token.length >= 2);
  tokens.forEach(token => {
    if (name.includes(token)) score += 28;
    if (artist.includes(token)) score += 22;
    if (album.includes(token)) score += 10;
  });
  return score;
}

function rankQishuiPublicSongs(songs, keywords, limit) {
  const scored = (Array.isArray(songs) ? songs : []).map((song, index) => ({
    song,
    index,
    score: qishuiPublicSearchScore(song, keywords),
  }));
  const matched = scored.filter(item => item.score > 0);
  const source = matched.length ? matched : scored;
  return source
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Number(limit) || 8))
    .map(item => item.song);
}

function extractQishuiCommentList(payload) {
  const data = (payload && payload.data) || payload || {};
  return pickArray(
    data.comments,
    data.comment_list,
    data.commentList,
    data.items,
    data.list,
    payload && payload.comments
  );
}

function mapQishuiComment(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const comment = pickObject(raw.comment, raw.comment_info, raw.commentInfo, raw);
  const user = pickObject(
    comment.user,
    comment.user_info,
    comment.userInfo,
    comment.author,
    raw.user,
    raw.user_info,
    raw.author
  );
  const timeRaw = Number(
    comment.create_time ||
    comment.createTime ||
    comment.created_at ||
    comment.createdAt ||
    comment.time ||
    raw.create_time ||
    raw.time ||
    0
  ) || 0;
  return {
    id: normalizeText(comment.id || comment.comment_id || comment.commentId || raw.id || ''),
    content: normalizeLyricBody(comment.text || comment.content || comment.comment_text || comment.commentText || ''),
    likedCount: Number(comment.like_count || comment.likeCount || comment.digg_count || comment.diggCount || comment.liked_count || 0) || 0,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: normalizeText(user.id || user.user_id || user.userId || user.uid || ''),
      nickname: normalizeText(user.nickname || user.nick_name || user.nickName || user.name || ''),
      avatar: qishuiFirstImageUrl('~c5_100x100.jpg',
        user.avatar_url,
        user.avatarUrl,
        user.avatar,
        user.medium_avatar_url,
        user.larger_avatar_url
      ),
    },
  };
}

function qishuiPrimaryTrackFromV2(payload) {
  const data = (payload && payload.data) || payload || {};
  return pickObject(data.track, data.track_info, data.trackInfo, payload && payload.track, payload && payload.track_info, payload && payload.trackInfo);
}

function qishuiTrackPlayerFromV2(payload, track) {
  const data = (payload && payload.data) || payload || {};
  return pickObject(
    data.track_player,
    data.trackPlayer,
    payload && payload.track_player,
    payload && payload.trackPlayer,
    track && track.track_player,
    track && track.trackPlayer
  );
}

// seo_track 把内容嵌在 seo_track 下；统一成 { track, track_player } 形状，
// 让 qishuiPrimaryTrackFromV2 / qishuiTrackPlayerFromV2 / resolveQishuiDownloadInfo 原样复用。
function normalizeQishuiH5TrackPayload(payload) {
  if (payload && payload.seo_track && typeof payload.seo_track === 'object') {
    const seo = payload.seo_track;
    return Object.assign({}, payload, {
      track: seo.track || payload.track,
      track_player: seo.track_player || payload.track_player,
    });
  }
  return payload;
}

function collectQishuiTrackV2Streams(payload) {
  const track = qishuiPrimaryTrackFromV2(payload);
  const player = qishuiTrackPlayerFromV2(payload, track);
  const audioInfo = pickObject(track.audio_info, track.audioInfo, payload && payload.audio_info, payload && payload.audioInfo);
  const playInfoList = pickArray(audioInfo.play_info_list, audioInfo.PlayInfoList, audioInfo.playInfoList);
  const streams = playInfoList.map(item => qishuiStreamFromObject(item)).filter(Boolean);
  const videoModel = player.video_model || player.VideoModel || player.videoModel || track.video_model || track.VideoModel || '';
  qishuiCollectVideoModelStreams(videoModel, '', {}, streams);
  const bitRates = pickArray(
    track.bit_rates,
    track.bitRates,
    audioInfo.bit_rates,
    audioInfo.bitRates,
    payload && payload.bit_rates,
    payload && payload.bitRates
  );
  const fallbackStreams = bitRates.map(item => qishuiStreamFromObject(item)).filter(Boolean);
  return { track, player, streams, fallbackStreams };
}

// 整曲级权益旗标（label_info.only_vip_playable 等）只挂在 track 对象上。
// 直接扫整个 payload 会把响应里嵌着的**其它实体**误算成这首也要会员：
// H5 seo_track 一次返回 200KB，里面有 album_tracks / artist_tracks / chart_tracks /
// relation_media，其中真有 only_vip_playable=true 的会员曲（实测强制走 seo_track 时，
// 免费曲 7657031609262819354 被误判成 vip_required）。
// payload 里取不到有内容的 track 时退回整包扫描，保持 PC 链路原行为。
function qishuiRestrictionScopeFromPayload(payload) {
  const track = qishuiPrimaryTrackFromV2(payload);
  if (track && typeof track === 'object' && Object.keys(track).length) return track;
  return payload;
}

function extractQishuiPcSearchItems(payload) {
  const data = (payload && payload.data) || payload || {};
  const groups = pickArray(
    data.result_groups,
    data.resultGroups,
    data.search_result && data.search_result.result_groups,
    payload && payload.result_groups
  );
  const items = [];
  groups.forEach(group => {
    const groupData = group && (group.data || group.items || group.list || group.result);
    if (Array.isArray(groupData)) items.push(...groupData);
    else items.push(...extractQishuiMediaList(groupData));
  });
  return items.length ? items : extractQishuiMediaList(data);
}

module.exports = {
  normalizeLyricBody,
  qishuiLyricTimestamp,
  qishuiConvertLyric,
  qishuiLyricTextFromNode,
  extractQishuiLyrics,
  firstUrl,
  qishuiImageUrl,
  qishuiFirstImageUrl,
  pickObject,
  qishuiProfileFromUser,
  qishuiProfileFromMeData,
  pickArray,
  qishuiObjectString,
  qishuiObjectNumber,
  QISHUI_VIP_NUMBER_KEYS,
  QISHUI_SVIP_NUMBER_KEYS,
  QISHUI_VIP_FLAG_KEYS,
  QISHUI_SVIP_FLAG_KEYS,
  QISHUI_MEMBERSHIP_LABEL_KEYS,
  QISHUI_VIP_CONTAINER_KEYS,
  QISHUI_SVIP_CONTAINER_KEYS,
  QISHUI_MEMBERSHIP_STATUS_KEYS,
  QISHUI_MEMBERSHIP_EXPIRY_KEYS,
  qishuiNormalizedFieldKey,
  qishuiExplicitPositive,
  qishuiExplicitNegative,
  qishuiMembershipLevelValue,
  qishuiMembershipExpiryMillis,
  qishuiMembershipObjectState,
  qishuiMembershipFromData,
  qishuiPlaybackMembershipFromPayload,
  qishuiNormalizeDurationSeconds,
  qishuiNormalizeBitrateKbps,
  qishuiBitrateForUi,
  qishuiQualityRank,
  qishuiPlaybackLevel,
  qishuiBetterStreamCandidate,
  qishuiBestStreamCandidate,
  QISHUI_TRACK_VIP_KEYS,
  QISHUI_TRACK_ACCOUNT_CONTAINER_KEYS,
  QISHUI_TRACK_PER_QUALITY_CONTAINER_KEYS,
  qishuiTrackPlaybackRestriction,
  qishuiTrackRequiresVip,
  qishuiStreamAllowedForMembership,
  qishuiBestStreamCandidateForMembership,
  qishuiStreamUrlFrom,
  qishuiBitrateFromUrl,
  qishuiBitrateFromSize,
  qishuiStreamFromObject,
  qishuiMaybeParseJson,
  qishuiCollectVideoModelStreams,
  qishuiVideoModelPlayAuth,
  qishuiVideoModelQualityHint,
  extractQishuiMediaList,
  qishuiArtists,
  qishuiLyricPayload,
  cacheQishuiLyric,
  mapQishuiMedia,
  dedupeQishuiSongs,
  mapQishuiMediaList,
  qishuiPlaylistLikeName,
  qishuiPlaylistPrimaryLikeName,
  qishuiPlaylistIsLikedCard,
  qishuiPlaylistIdFromItem,
  qishuiPlaylistNameFromItem,
  qishuiPlaylistCoverFromItem,
  qishuiPlaylistTrackCountFromItem,
  extractQishuiPlaylistCards,
  buildQishuiVirtualPlaylist,
  QISHUI_PUBLIC_ORIGINAL_ARTIST_RULES,
  QISHUI_PUBLIC_TITLE_BRACKET_RE,
  QISHUI_PUBLIC_BRACKET_RE,
  parseQishuiPublicOriginalInfo,
  mapQishuiPublicItem,
  qishuiSearchComparable,
  qishuiPublicSearchScore,
  rankQishuiPublicSongs,
  extractQishuiCommentList,
  mapQishuiComment,
  qishuiPrimaryTrackFromV2,
  qishuiTrackPlayerFromV2,
  normalizeQishuiH5TrackPayload,
  collectQishuiTrackV2Streams,
  qishuiRestrictionScopeFromPayload,
  extractQishuiPcSearchItems,
};
