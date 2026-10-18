'use strict';

// 酷狗：资源映射（上游 JSON → 前端结构，纯函数）。
//
// 第 1 刀从 kugou-api.js 抽出。零依赖：文本/HTML 归一、封面、音质档位、
// 会员载荷归一、搜索项/歌单项/曲目映射、KRC 歌词解密、歌单元数据。

const crypto = require('crypto');
const zlib = require('zlib');

function stripKugouHtml(text) {
  return decodeKugouDisplayText(String(text || '').replace(/<[^>]+>/g, '').trim());
}

function decodeKugouDisplayText(text) {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (/%u[0-9a-fA-F]{4}/.test(raw)) {
    raw = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (/%[0-9a-fA-F]{2}/.test(raw) && !/[\u3400-\u9fff]/.test(raw)) {
    try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (_) {}
  }
  return raw.trim();
}

function stripKugouFileName(raw, fallbackArtist) {
  let name = stripKugouHtml(raw || '');
  name = name.replace(/\.(mp3|flac|m4a|wav|ape|ogg)$/i, '').trim();
  const artist = stripKugouHtml(fallbackArtist || '');
  if (artist && name.indexOf(artist) === 0) {
    name = name.slice(artist.length).replace(/^[\s\-–—]+/, '').trim();
  }
  return name || stripKugouHtml(raw || '');
}

function resolveKugouAlbumAudioId(params) {
  params = params || {};
  const candidates = [params.mixSongId, params.mixsongid, params.albumAudioId, params.album_audio_id];
  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return 0;
}

function pickKugouPlayUrl(json) {
  if (!json) return '';
  const pick = (val) => {
    if (Array.isArray(val)) return val.find(Boolean) || '';
    return val || '';
  };
  const data = json.data || {};
  return String(
    pick(json.url) || pick(json.play_url) || pick(json.backupUrl) ||
    pick(data.url) || pick(data.play_url) || pick(data.backupUrl) || ''
  ).replace(/\\\//g, '/').trim();
}

function kugouCoverUrl(raw, size) {
  const url = String(raw || '').trim();
  if (!url) return '';
  const px = size || 240;
  return url.replace(/\{size\}/g, String(px));
}

function parseKugouListId(playlistId) {
  const id = String(playlistId || '').trim();
  if (!id) return '';
  if (/^\d+$/.test(id)) return id;
  if (id.indexOf('collection_') === 0) {
    const parts = id.split('_');
    if (parts.length >= 5 && parts[3]) return parts[3];
  }
  const matched = id.match(/collection_\d+_\d+_(\d+)_\d+/);
  return matched ? matched[1] : id;
}

function firstPositiveKugouNumber(objects, keys) {
  for (const obj of objects || []) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys || []) {
      const raw = obj[key];
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) return value;
      if (raw === true || /^(true|yes|active|valid|enabled|vip|svip|premium|member)$/i.test(String(raw || '').trim())) {
        return 1;
      }
    }
  }
  return 0;
}

const KUGOU_VIP_SIGNAL_KEYS = new Set([
  'vip', 'viptype', 'isvip', 'viplevel', 'vipstatus', 'membertype', 'memberlevel',
  'musicviplevel', 'mtype', 'ptype', 'vipytype', 'unionviptype', 'userviptype',
]);

const KUGOU_SVIP_SIGNAL_KEYS = new Set([
  'svip', 'sviptype', 'issvip', 'sviplevel', 'svipstatus', 'supervip',
  'superviplevel', 'superviptype', 'luxuryviptype', 'vipluxurytype',
]);

const KUGOU_VIP_EXPIRY_KEYS = new Set([
  'vipendtime', 'vipexpiretime', 'vipexpire', 'musicvipendtime',
  'svipendtime', 'svipexpiretime', 'supervipendtime', 'luxuryvipendtime',
]);

const KUGOU_WEB_MEMBERSHIP_SIGNAL_KEYS = new Set([
  'role', 'producttype', 'usertype', 'userytype', 'ytype',
]);

const KUGOU_WEB_ROLE_KEYS = [
  'role', 'user_type', 'userType', 'usertype',
  'user_y_type', 'userYType', 'userytype', 'y_type', 'yType', 'ytype',
];

const KUGOU_WEB_VIP_ROLES = new Set([1, 2]);

const KUGOU_WEB_SVIP_ROLES = new Set([6, 11, 13]);

const KUGOU_WEB_MUSIC_PACKAGE_ROLES = new Set([31, 33]);

function normalizeKugouMembershipKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function kugouObjectHasMembershipSignal(value, allowWebSignals) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (item && typeof item === 'object') return false;
    const normalizedKey = normalizeKugouMembershipKey(key);
    return KUGOU_VIP_SIGNAL_KEYS.has(normalizedKey) ||
      KUGOU_SVIP_SIGNAL_KEYS.has(normalizedKey) ||
      KUGOU_VIP_EXPIRY_KEYS.has(normalizedKey) ||
      (allowWebSignals === true && KUGOU_WEB_MEMBERSHIP_SIGNAL_KEYS.has(normalizedKey));
  });
}

function kugouTimeState(objects, keys) {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  let present = false;
  let future = false;
  for (const obj of objects || []) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys || []) {
      const value = Number(obj[key]);
      if (!isFinite(value) || value <= 0) continue;
      if (value > 100000000000) {
        present = true;
        if (value > nowMs) future = true;
      } else if (value > 1000000000) {
        present = true;
        if (value > nowSec) future = true;
      }
    }
  }
  return { present, future };
}

function kugouNumberFieldState(objects, keys) {
  for (const obj of objects || []) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys || []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const raw = obj[key];
      if (raw == null || String(raw).trim() === '') continue;
      const value = Number(raw);
      return {
        present: true,
        valid: Number.isFinite(value) && value >= 0,
        value: Number.isFinite(value) && value >= 0 ? value : 0,
      };
    }
  }
  return { present: false, valid: false, value: 0 };
}

function collectKugouVipObjects(value, out, depth) {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectKugouVipObjects(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push(value);
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (child && typeof child === 'object') {
      collectKugouVipObjects(child, out, depth + 1);
    }
  });
  return out;
}

function normalizeKugouVipPayloadV2(payload, fallback) {
  fallback = fallback || {};
  const membershipOrigin = String(payload && payload.__kugouMembershipOrigin || '');
  const isWebRolePayload = membershipOrigin === 'kugou-web-roleinfo';
  const data = payload && (payload.data || payload.result || payload.vip || payload) || {};
  const expectedUserId = String(fallback.userid || fallback.userId || '').replace(/\D/g, '');
  const payloadObjects = collectKugouVipObjects(data, [], 0).filter(obj => {
    if (!expectedUserId || !obj || typeof obj !== 'object') return true;
    const objectUserId = String(obj.userid || obj.user_id || obj.userId || obj.uid || obj.KugooID || '').replace(/\D/g, '');
    return !objectUserId || objectUserId === expectedUserId;
  });
  const apiMembershipKnown = payloadObjects.some(kugouObjectHasMembershipSignal);
  const fallbackMembershipKnown = fallback.membershipKnown === true;
  const objects = apiMembershipKnown ? payloadObjects : (fallbackMembershipKnown ? [fallback] : []);
  const membershipKnown = apiMembershipKnown || fallbackMembershipKnown;
  const vipType = firstPositiveKugouNumber(objects, [
    'vipType', 'vip_type', 'VIPType', 'isVIP', 'isVip', 'is_vip', 'vip_level', 'vipLevel',
    'music_vip_level', 'musicVipLevel', 'm_type', 'p_type', 'vip_y_type', 'union_vip_type',
    'user_vip_type', 'vip_status', 'member_type', 'member_level', 'vip'
  ]);
  const svipType = firstPositiveKugouNumber(objects, [
    'svipType', 'svip_type', 'SVIPType', 'isSVIP', 'isSvip', 'is_svip', 'superVip', 'super_vip',
    'superVipLevel', 'super_vip_level', 'super_vip_type', 'luxury_vip_type', 'vip_luxury_type',
    'svip_level', 'svip_status', 'svip'
  ]);
  const vipExpiry = kugouTimeState(objects, [
    'vip_end_time', 'vipEndTime', 'vip_expire_time', 'vipExpireTime', 'vip_expire', 'vipExpire',
    'music_vip_end_time', 'musicVipEndTime'
  ]);
  const svipExpiry = kugouTimeState(objects, [
    'svip_end_time', 'svipEndTime', 'svip_expire_time', 'svipExpireTime',
    'super_vip_end_time', 'superVipEndTime', 'luxury_vip_end_time', 'luxuryVipEndTime'
  ]);
  const isSvip = svipExpiry.future || (svipType > 0 && !svipExpiry.present) ||
    (objects.some(obj => obj && obj.isSvip === true) && !svipExpiry.present);
  const isVip = isSvip || vipExpiry.future || (vipType > 0 && !vipExpiry.present) ||
    (objects.some(obj => obj && obj.isVip === true) && !vipExpiry.present);
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  if (isWebRolePayload) {
    const roleState = kugouNumberFieldState(payloadObjects, KUGOU_WEB_ROLE_KEYS);
    if (roleState.present && roleState.valid) {
      const webRole = roleState.value;
      const roleIsSvip = KUGOU_WEB_SVIP_ROLES.has(webRole);
      const roleIsVip = roleIsSvip || KUGOU_WEB_VIP_ROLES.has(webRole);
      const roleHasMusicPackage = KUGOU_WEB_MUSIC_PACKAGE_ROLES.has(webRole);
      if (roleIsVip || roleHasMusicPackage) {
        const outIsVip = roleIsVip;
        const outIsSvip = roleIsSvip;
        const outLevel = outIsSvip ? 'svip' : (outIsVip ? 'vip' : 'none');
        return {
          vipType: outIsVip ? webRole : 0,
          svipType: outIsSvip ? webRole : 0,
          vipLevel: outLevel,
          isVip: outIsVip,
          isSvip: outIsSvip,
          membershipKnown: true,
          membershipVerified: true,
          membershipSource: 'kugou-web-roleinfo',
        };
      }
    }
    return {
      vipType: 0, svipType: 0, vipLevel: 'none', isVip: false, isSvip: false,
      membershipKnown: false, membershipVerified: false, membershipSource: 'none',
    };
  }
  return {
    vipType: isSvip ? Math.max(vipType, svipType) : vipType,
    svipType,
    vipLevel,
    isVip,
    isSvip,
    membershipKnown,
    membershipVerified: membershipKnown,
    membershipSource: apiMembershipKnown
      ? 'kugou-vip-api'
      : (fallbackMembershipKnown ? 'kugou-cookie-explicit' : 'none'),
  };
}

function kugouUnknownWebMembershipPayload() {
  return {
    __kugouMembershipUnknown: true,
    __kugouMembershipOrigin: 'kugou-web-roleinfo',
  };
}

function normalizeKugouWebRoleInfoPayload(payload, auth) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return kugouUnknownWebMembershipPayload();
  }
  const data = payload.data || payload.result || payload;
  const errorObjects = [payload, data].filter(value => value && typeof value === 'object');
  const hasErrorCode = errorObjects.some(value => [
    value.errno, value.error_code, value.errorCode, value.errcode, value.err_code,
  ].some(code => Number.isFinite(Number(code)) && Number(code) > 0));
  const explicitlyFailed = errorObjects.some(value =>
    value.success === false ||
    (Object.prototype.hasOwnProperty.call(value, 'status') && Number(value.status) === 0) ||
    /^(-1|false|fail|failed|error)$/i.test(String(value.status == null ? '' : value.status).trim()) ||
    (typeof value.error === 'string' && value.error.trim() !== '')
  );
  if (hasErrorCode || explicitlyFailed) return kugouUnknownWebMembershipPayload();

  const expectedUserId = String(auth && auth.userid || '').replace(/\D/g, '');
  const objects = collectKugouVipObjects(payload, [], 0);
  const roleInfoRecord = objects.find(value =>
    kugouNumberFieldState([value], KUGOU_WEB_ROLE_KEYS).present
  ) || objects.find(value => kugouObjectHasMembershipSignal(value, true));
  if (!roleInfoRecord) return kugouUnknownWebMembershipPayload();
  return {
    data: Object.assign({}, roleInfoRecord),
    __kugouMembershipOrigin: 'kugou-web-roleinfo',
  };
}

function truthyParam(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'vip' || text === 'svip';
}

function kugouPlaybackParamsRequireVip(params) {
  params = params || {};
  const privilege = Number(params.privilege || params.Privilege || params.mediaPrivilege || params.media_privilege || 0) || 0;
  const fee = Number(params.fee || params.Fee || 0) || 0;
  return truthyParam(params.vipRequired) || truthyParam(params.needVip) || truthyParam(params.onlyVipPlayable) || fee > 0 || privilege >= 9;
}

function kugouPlaybackCacheScope(auth, membership) {
  auth = auth || {};
  membership = membership || {};
  const identity = [
    String(auth.userid || 'guest'),
    String(auth.token || ''),
    String(auth.mid || ''),
    membership.isSvip ? 'svip' : (membership.isVip ? 'vip' : 'none'),
  ].join('|');
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
}

function normalizeQualityPreference(q) {
  q = String(q || 'standard').toLowerCase();
  if (['jymaster', 'hires', 'lossless', 'exhigh', 'standard'].includes(q)) return q;
  return 'standard';
}

function kugouQualityParam(requestedQuality) {
  const level = normalizeQualityPreference(requestedQuality);
  if (level === 'jymaster') return 'viper_tape';
  if (level === 'hires') return 'hires';
  if (level === 'lossless') return 'flac';
  if (level === 'exhigh') return 320;
  return 128;
}

function kugouQualityFromParam(param, fallbackLevel) {
  const raw = param;
  const text = String(raw == null ? '' : raw).toLowerCase();
  if (text === 'viper_tape' || text === 'jymaster') return 'jymaster';
  if (text === 'hires' || text === 'hi_res') return 'hires';
  if (text === 'flac' || text === 'lossless' || text === 'sq') return 'lossless';
  if (Number(raw) >= 320 || text === '320' || text === 'exhigh' || text === 'hq') return 'exhigh';
  if (Number(raw) >= 192) return 'exhigh';
  return normalizeQualityPreference(fallbackLevel || 'standard');
}

function mapKugouArtists(item) {
  item = item || {};
  const singers = Array.isArray(item.Singers) ? item.Singers : [];
  if (singers.length) {
    return singers.map(s => ({
      id: s.id || s.SingerId,
      name: stripKugouHtml(s.name || s.SingerName || ''),
    })).filter(a => a.name);
  }
  const names = String(item.SingerName || '').split(/、|\/|,| feat\.? /i).map(stripKugouHtml).filter(Boolean);
  const ids = Array.isArray(item.SingerId) ? item.SingerId : [];
  return names.map((name, i) => ({ id: ids[i] || '', name }));
}

function mapKugouSearchItem(item) {
  item = item || {};
  const artists = mapKugouArtists(item);
  const hash = item.FileHash || '';
  const albumId = item.AlbumID != null ? String(item.AlbumID) : '';
  const mixSongId = item.MixSongID != null ? String(item.MixSongID) : (item.mixsongid != null ? String(item.mixsongid) : '');
  const albumAudioIdRaw = item.EMixSongID || item.AlbumAudioID || item.album_audio_id || '';
  const albumAudioId = (/^\d+$/.test(mixSongId) ? mixSongId : '') || albumAudioIdRaw || mixSongId;
  const name = stripKugouHtml(item.SongName || item.FileName || item.OriSongName || '');
  const artist = artists.map(a => a.name).join(' / ') || stripKugouHtml(item.SingerName || '');
  const privilege = Number(item.Privilege || 0) || 0;
  return {
    provider: 'kugou',
    source: 'kugou',
    type: 'kugou',
    id: hash || mixSongId || albumAudioId,
    hash,
    fileHash: hash,
    albumId,
    album_id: albumId,
    mixSongId,
    albumAudioId,
    album_audio_id: albumAudioId,
    audioId: item.Audioid || item.Scid || '',
    name,
    artist,
    artists,
    artistId: artists[0] && artists[0].id,
    album: stripKugouHtml(item.AlbumName || ''),
    cover: kugouCoverUrl(
      item.Image || item.AlbumImage || item.cover || item.img || item.album_cover || item.album_img || item.pic ||
      (item.albuminfo && (item.albuminfo.img || item.albuminfo.cover || item.albuminfo.sizable_cover)) ||
      (item.trans_param && item.trans_param.union_cover) || '', 240
    ),
    duration: (Number(item.Duration) || 0) * 1000,
    popularity: Number(item.Heat || item.heat || item.Hot || item.hot || item.Score || item.score || 0) || 0,
    kugouRank: item.rank === null || item.rank === undefined || item.rank === ''
      ? (item.Rank === null || item.Rank === undefined || item.Rank === '' ? null : Number(item.Rank))
      : Number(item.rank),
    fee: privilege >= 10 ? 1 : 0,
    privilege,
    playable: privilege <= 8,
    hqHash: item.HQFileHash || '',
    sqHash: item.SQFileHash || '',
    resHash: item.ResFileHash || '',
  };
}

function mapKugouPlaylistItem(item) {
  item = item || {};
  const id = item.global_collection_id || item.specialid || item.listid || item.list_id || item.id || '';
  const listId = item.list_create_listid || item.listid || parseKugouListId(id) || '';
  return {
    provider: 'kugou',
    source: 'kugou',
    id: String(id || listId),
    listId: String(listId || ''),
    name: stripKugouHtml(item.name || item.listname || item.specialname || item.title || '酷狗歌单'),
    cover: kugouCoverUrl(item.pic || item.img || item.imgurl || item.sizable_cover || item.create_user_pic || '', 240),
    trackCount: Number(item.count || item.m_count || item.song_count || item.total || item.list_count || 0) || 0,
    creator: stripKugouHtml(item.nickname || item.username || item.user_name || item.list_create_username || ''),
  };
}

function mapKugouPlaylistTrack(item) {
  item = item || {};
  const singers = Array.isArray(item.singerinfo) ? item.singerinfo : (Array.isArray(item.Singers) ? item.Singers : []);
  const artistLabel = singers.map(s => s.name || s.SingerName).filter(Boolean).join(' / ');
  const mixSongId = item.mixsongid != null ? String(item.mixsongid) : (item.MixSongID != null ? String(item.MixSongID) : (item.album_audio_id != null ? String(item.album_audio_id) : ''));
  const mapped = mapKugouSearchItem(Object.assign({}, item, {
    FileHash: item.hash || item.FileHash,
    SongName: stripKugouFileName(item.name || item.SongName || item.filename, artistLabel),
    SingerName: item.SingerName || artistLabel,
    Singers: singers,
    AlbumID: (item.albuminfo && item.albuminfo.id) || item.album_id || item.AlbumID,
    MixSongID: mixSongId,
    EMixSongID: (/^\d+$/.test(mixSongId) ? mixSongId : '') || item.album_audio_id || item.EMixSongID,
    AlbumName: (item.albuminfo && item.albuminfo.name) || item.album_name || item.AlbumName,
    Image: item.cover || item.img || item.Image || (item.trans_param && item.trans_param.union_cover),
    Duration: item.duration || (item.timelen ? Math.round(Number(item.timelen) / 1000) : 0) || item.Duration,
    Privilege: item.media_privilege != null ? item.media_privilege : (item.privilege != null ? item.privilege : item.Privilege),
  }));
  if (!mapped.hash && item.hash) mapped.hash = item.hash;
  if (!mapped.albumAudioId && item.album_audio_id) mapped.albumAudioId = String(item.album_audio_id);
  if (!mapped.albumId && item.album_id) mapped.albumId = String(item.album_id);
  if (item.fileid != null || item.file_id != null) mapped.fileId = String(item.fileid != null ? item.fileid : item.file_id);
  return mapped;
}

function decodeKugouLyricContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '');
    if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) return decoded;
  } catch (_) {}
  return raw;
}

function decryptKrcContent(content) {
  let raw;
  try { raw = Buffer.from(String(content || '').trim(), 'base64'); } catch (_) { return ''; }
  if (raw.length < 8 || raw.slice(0, 4).toString('latin1') !== 'krc1') return '';
  const key = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);
  const body = Buffer.from(raw.slice(4).map((b, i) => b ^ key[i % 16]));
  try { return zlib.inflateSync(body).toString('utf8'); } catch (_) { return body.toString('utf8'); }
}

function isKugouTranslationCreditLine(text) {
  return /歌词翻译|翻译由|机译|AI生成|机器翻译|本翻译作品|翻译作品|著作权/.test(String(text || ''));
}

function krcLanguageTranslationsToLrc(krcText, mainLrc) {
  const m = String(krcText || '').match(/\[language:([^\]]*)\]/);
  if (!m) return '';
  let payload;
  try { payload = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch (_) { return ''; }
  const groups = payload && Array.isArray(payload.content) ? payload.content : [];
  const groupRows = groups.map((g) => {
    const lc = g && Array.isArray(g.lyricContent) ? g.lyricContent : [];
    return {
      type: Number(g && g.type) || 0,
      rows: lc.map((row) => (Array.isArray(row) ? row.join('') : String(row || ''))),
    };
  });
  // [language:] 里可能同时带多条轨：type=0 是**音译**（汉字谐音，如「弄 那诶 A N G E L」），
  // type=1 才是**真正的中文翻译**（如「你是我的天使」）。
  // 旧实现把所有轨按顺序首尾拼成一个数组，等于只取第一条（音译），真译文被整条丢弃
  // → 韩语歌的「双语翻译」显示成谐音乱码。优先取 type=1，取不到再退回旧行为。
  const usable = (rows) => rows.some((t) => String(t || '').trim());
  const preferred = groupRows.find((entry) => entry.type === 1 && usable(entry.rows));
  const rows = [];
  if (preferred) {
    rows.push(...preferred.rows);
  } else {
    for (const entry of groupRows) rows.push(...entry.rows);
  }
  if (!rows.length) return '';
  const mainLines = String(mainLrc || '').split(/\r?\n/).filter((l) => /^\[\d{2,}:\d{2}/.test(l.trim()));
  const out = [];
  for (let i = 0; i < mainLines.length && i < rows.length; i++) {
    const text = String(rows[i] || '').trim().replace(/^\/+\s*/, '');
    if (!text || isKugouTranslationCreditLine(text)) continue;
    const tm = mainLines[i].match(/^\[(\d{2,}):(\d{2}(?:\.\d{1,3})?)\]/);
    if (!tm) continue;
    out.push('[' + tm[1] + ':' + tm[2] + ']' + text);
  }
  return out.join('\n');
}

function extractKugouGatewayPlaylistLists(data) {
  data = (data && data.data) || data || {};
  if (Array.isArray(data.info)) return data.info;
  const info = data.info || data;
  return []
    .concat(Array.isArray(info.collect) ? info.collect : [])
    .concat(Array.isArray(info.love) ? info.love : [])
    .concat(Array.isArray(info.self) ? info.self : [])
    .concat(Array.isArray(info.list) ? info.list : [])
    .concat(Array.isArray(data.list) ? data.list : []);
}

function isKugouFavoritePlaylistName(name) {
  return /我喜欢|我的收藏|favorite|liked/i.test(String(name || '').trim());
}

function isKugouPrimaryFavoritePlaylistName(name) {
  return /我喜欢|liked music|my favorites?/i.test(String(name || '').trim());
}

function kugouPlaylistDisplayName(item) {
  item = item || {};
  return String(item.name || item.listname || item.specialname || '').trim();
}

function pickKugouFavoritePlaylist(lists) {
  lists = Array.isArray(lists) ? lists : [];
  let fav = lists.find(item => isKugouPrimaryFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => Number(item.type) === 0 && isKugouPrimaryFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => isKugouFavoritePlaylistName(kugouPlaylistDisplayName(item)));
  if (!fav) fav = lists.find(item => Number(item.is_default) === 1 || Number(item.default) === 1);
  return fav || null;
}

function resolveKugouFavoriteListIdFromItem(item) {
  if (!item) return '';
  return String(item.list_create_listid || item.listid || item.list_id || parseKugouListId(item.global_collection_id) || item.id || '').trim();
}

function kugouProfileCacheKey(auth) {
  auth = auth || {};
  return 'profile|' + String(auth.userid || '0') + '|' + String(auth.token || '').slice(-10);
}

function extractKugouGuessSongList(json) {
  const data = json && json.data;
  const candidates = [
    data && data.info,
    data && data.song_list,
    data && data.songs,
    data && data.list,
    data && data.songlist,
    data && data.fm_song,
    data && data.fm_list,
    data && data.radio_song_list,
    data && data.recommend_song_list,
    data && data.everyday_song,
    data && data.class_song_list,
    Array.isArray(data) && data,
    json && json.info,
    json && json.list,
    json && json.songs,
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i]) && candidates[i].length) return candidates[i];
  }
  // 深度搜索：遍历 data 对象的所有一级属性，找到第一个非空数组
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val) && val.length) return val;
    }
  }
  return [];
}

function kugouAudioReferer(audioUrl) {
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes('kugou.com')) return 'https://www.kugou.com/';
  } catch (_) {}
  return '';
}

module.exports = {
  stripKugouHtml,
  decodeKugouDisplayText,
  stripKugouFileName,
  resolveKugouAlbumAudioId,
  pickKugouPlayUrl,
  kugouCoverUrl,
  parseKugouListId,
  firstPositiveKugouNumber,
  KUGOU_VIP_SIGNAL_KEYS,
  KUGOU_SVIP_SIGNAL_KEYS,
  KUGOU_VIP_EXPIRY_KEYS,
  KUGOU_WEB_MEMBERSHIP_SIGNAL_KEYS,
  KUGOU_WEB_ROLE_KEYS,
  KUGOU_WEB_VIP_ROLES,
  KUGOU_WEB_SVIP_ROLES,
  KUGOU_WEB_MUSIC_PACKAGE_ROLES,
  normalizeKugouMembershipKey,
  kugouObjectHasMembershipSignal,
  kugouTimeState,
  kugouNumberFieldState,
  collectKugouVipObjects,
  normalizeKugouVipPayloadV2,
  kugouUnknownWebMembershipPayload,
  normalizeKugouWebRoleInfoPayload,
  truthyParam,
  kugouPlaybackParamsRequireVip,
  kugouPlaybackCacheScope,
  normalizeQualityPreference,
  kugouQualityParam,
  kugouQualityFromParam,
  mapKugouArtists,
  mapKugouSearchItem,
  mapKugouPlaylistItem,
  mapKugouPlaylistTrack,
  decodeKugouLyricContent,
  decryptKrcContent,
  isKugouTranslationCreditLine,
  krcLanguageTranslationsToLrc,
  extractKugouGatewayPlaylistLists,
  isKugouFavoritePlaylistName,
  isKugouPrimaryFavoritePlaylistName,
  kugouPlaylistDisplayName,
  pickKugouFavoritePlaylist,
  resolveKugouFavoriteListIdFromItem,
  kugouProfileCacheKey,
  extractKugouGuessSongList,
  kugouAudioReferer,
};
