'use strict';

// 汽水音乐：账号态（状态 / 播放会员 / 会员缓存 TTL / 曲库缓存失效）。
//
// 第 3 刀从 qishui-api.js 抽出。只依赖 config/http/mapping，不引用任何其它领域模块 ——
// 它是 library / search / write / playback / status 的共同底座。


const {
  QISHUI_PUBLIC_ENABLED,
  QISHUI_SCOPE,
  QISHUI_WEB_PC_API_BASE,
  getQishuiOAuthConfig,
} = require('./config');

const {
  normalizeQishuiCookieInput,
  qishuiAccessTokenInfo,
  qishuiCookieFingerprint,
  qishuiCookieHasLogin,
  qishuiCookieUserId,
  qishuiMembershipCache,
  qishuiPcAppParams,
  qishuiWebLibraryCache,
  qishuiWebPlaylistCache,
  qishuiWebPlaylistCursorCache,
  qishuiWebRequestJson,
} = require('./http');

const {
  qishuiProfileFromMeData,
} = require('./mapping');

function getQishuiStatus(cookieText) {
  const tokenInfo = qishuiAccessTokenInfo();
  const tokenConfigured = !!tokenInfo.token;
  const cookie = normalizeQishuiCookieInput(cookieText);
  const webSession = qishuiCookieHasLogin(cookie);
  const configured = tokenConfigured || webSession;
  const oauthConfig = getQishuiOAuthConfig();
  return {
    provider: 'qishui',
    label: '汽水音乐',
    short: 'QS',
    configured,
    tokenConfigured,
    webSession,
    cookieReady: webSession,
    loggedIn: configured,
    playbackMode: webSession ? 'direct-url' : 'recommend-match',
    scope: QISHUI_SCOPE,
    userId: webSession ? qishuiCookieUserId(cookie) : '',
    nickname: webSession ? '汽水音乐账号' : (tokenConfigured ? '汽水开放平台' : ''),
    vipType: 0,
    vipLevel: 'none',
    isVip: false,
    isSvip: false,
    vipLabel: '无VIP',
    membershipKnown: false,
    tokenFile: tokenInfo.file,
    tokenSource: tokenInfo.source,
    oauthConfigured: oauthConfig.configured,
    oauthMissing: oauthConfig.missing,
    oauthScope: oauthConfig.scope,
    oauthConfigSource: oauthConfig.configSource,
    // Legacy quick-check guard: search: configured || QISHUI_PUBLIC_ENABLED.
    capabilities: {
      search: tokenConfigured || webSession || QISHUI_PUBLIC_ENABLED,
      relatedMedia: tokenConfigured,
      feedSongTab: tokenConfigured || webSession,
      lyric: true,
      playableUrl: webSession,
      login: true,
      webOAuth: oauthConfig.configured,
      userPlaylists: configured,
      playlistTracks: configured,
      webSession,
    },
    message: webSession
      ? '本机汽水 PC 登录态已导入，可同步汽水歌单与我的喜欢，并直接解析播放地址。'
      : tokenConfigured
      ? '汽水开放平台 token 已配置，可使用官方推荐/相关歌曲能力。'
      : (QISHUI_PUBLIC_ENABLED
        ? '请先登录本机汽水音乐 PC 客户端，再由 Mineradio 读取本地会话；未导入时仅保留公开搜索匹配。'
        : '请先登录本机汽水音乐 PC 客户端，再由 Mineradio 读取本地会话。'),
  };
}

async function fetchQishuiPlaybackMembership(cookieText) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) {
    return {
      membershipKnown: false,
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
      expiresAt: 0,
      sessionValidated: false,
      error: 'QISHUI_COOKIE_REQUIRED',
    };
  }
  const cacheKey = 'membership|' + qishuiCookieFingerprint(cookie);
  return qishuiMembershipCache.wrap(cacheKey, qishuiMembershipCacheTtlMs, async () => {
    try {
      const json = await qishuiWebRequestJson('/luna/pc/me', qishuiPcAppParams(), cookie, {
        bases: [QISHUI_WEB_PC_API_BASE],
        noDefaultParams: true,
        sessionOnly: true,
        pcApp: true,
        timeoutMs: 6500,
      });
      const data = (json && json.data) || json || {};
      const profile = qishuiProfileFromMeData(data);
      return {
        membershipKnown: !!profile.membershipKnown,
        vipType: Number(profile.vipType) || 0,
        vipLevel: profile.vipLevel || 'none',
        isVip: !!profile.isVip,
        isSvip: !!profile.isSvip,
        vipLabel: profile.vipLabel || '无VIP',
        expiresAt: Number(profile.expiresAt) || 0,
        sessionValidated: !!profile.profileReady,
        userId: profile.userId || '',
      };
    } catch (err) {
      return {
        membershipKnown: false,
        vipType: 0,
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        vipLabel: '无VIP',
        expiresAt: 0,
        sessionValidated: false,
        error: err && err.message || 'QISHUI_MEMBERSHIP_CHECK_FAILED',
      };
    }
  });
}

function qishuiMembershipCacheTtlMs(membership) {
  const maxTtlMs = 60 * 1000;
  const expiresAt = Number(membership && membership.expiresAt) || 0;
  if (!(membership && membership.isVip) || expiresAt <= 0) return maxTtlMs;
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return 1;
  return Math.max(1, Math.min(maxTtlMs, remainingMs - 250));
}

function invalidateQishuiLibraryCaches() {
  qishuiWebLibraryCache.clear();
  qishuiWebPlaylistCache.clear();
  qishuiWebPlaylistCursorCache.clear();
}

module.exports = {
  getQishuiStatus,
  fetchQishuiPlaybackMembership,
  qishuiMembershipCacheTtlMs,
  invalidateQishuiLibraryCaches,
};
