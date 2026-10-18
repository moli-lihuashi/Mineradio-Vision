'use strict';

// QQ 音乐（QQMusic）会话层：
//   · JSONP 解析 / musicu.fcg 请求封装（qqMusicRequest / qqGetJSON）
//   · VIP 探测与合并：本地缓存 → 插件探测（qq-vip-api）→ 过期判定 / 保留陈旧正值
//   · cookie 刷新链：refreshQQCookieSession 带 write-lock + 代际校验，手动保存/登出即作废在途写回
//   · 登录态：getQQLoginInfo / normalizeQQProfile / 歌单页 musicKey 回填
// 从 server.js 抽出（原 server.js 1120–1125 常量与 1274–1819 函数）。不 require server.js，避免循环依赖。
//
// deps 里三个必须「调用期」取值，不能按值注入：
//   getQQCookie()        —— qqCookie 是 server.js 的 let，持久化层会整体替换
//   setQQCookie(v)       —— 唯一的写入点（refreshQQConfiguredCookieStore 重新读盘后写回）
//   getQQCookieEpoch()   —— 同上，登出/手动保存会 ++
//   readCookieFile       —— 也是 let，configureCookieStorage 会换成 Electron safeStorage 版

module.exports = function createQQSession(deps) {
  const {
    QQ_COOKIE_FILE,
    UA,
    getQQCookie,
    setQQCookie,
    getQQCookieEpoch,
    readCookieFile,
    saveQQCookie,
    serializeCookieObject,
    withQQCookieWriteLock,
    qqCookieObject,
    qqCookieUin,
    qqCookieMusicKey,
    qqCookiePlaybackKey,
    qqCookieNickname,
    qqCookieAvatar,
    decodeQQCookieValue,
    requestText,
    normalizeQQVipPayloadStrict,
    resolveQQVipFromProbes,
    qqVipSessionCacheKey,
    qqVipCacheTtlMs,
    qqVipEntitlementRights,
    preserveQQVipStalePositive,
    qqVipObjectLooksExpiredStrict,
  } = deps || {};

  const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
  const QQ_HEADERS = {
    Referer: 'https://y.qq.com/',
    'User-Agent': UA,
  };

  function parseJSONText(text) {
    const raw = String(text || '').trim();
    const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1');
    return JSON.parse(json);
  }

  async function qqMusicRequest(payload, opts) {
    opts = opts || {};
    const body = JSON.stringify(payload);
    const headers = {
      ...QQ_HEADERS,
      'Content-Type': 'application/json;charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
    };
    if (opts.cookie && getQQCookie()) headers.Cookie = getQQCookie();
    const text = await requestText(QQ_MUSICU_URL, {
      method: 'POST',
      headers,
    }, body);
    return parseJSONText(text);
  }


  const QQ_VIP_INFO_CACHE_TTL_MS = 2 * 60 * 1000;
  const qqVipInfoCache = new Map();

  function qqVipObjectLooksExpired(obj) {
    return qqVipObjectLooksExpiredStrict(obj);
  }

  function normalizeQQVipPayload(payload, fallback) {
    return normalizeQQVipPayloadStrict(payload, fallback || {});
  }

  function withQQVipSyncState(info, probeAvailable) {
    info = info || {};
    const authIncomplete = !!(info.loggedIn && !info.playbackKeyReady);
    const membershipUnknown = !!(info.loggedIn && info.membershipKnown !== true);
    const stalePositive = !!(info.loggedIn && info.membershipStale && info.isVip);
    const membershipStale = !!(info.loggedIn && (
      authIncomplete
      || membershipUnknown
      || stalePositive
      || (info.profileUnavailable && !probeAvailable)
    ));
    const normalized = {
      ...info,
      membershipStale,
      authorizationIncomplete: authIncomplete,
      vipSyncState: authIncomplete
        ? 'authorization_incomplete'
        : (stalePositive ? 'stale_positive' : (membershipUnknown ? 'unknown' : (probeAvailable ? 'checked' : (membershipStale ? 'stale' : 'profile')))),
    };
    return {
      ...normalized,
      membershipRights: qqVipEntitlementRights(normalized),
    };
  }

  function mergeQQVipStatus(info, vip, source) {
    info = info || {};
    const profilePositive = !!(
      info.isVip ||
      info.isSvip ||
      info.vipLevel === 'vip' ||
      info.vipLevel === 'svip' ||
      Number(info.vipType || 0) > 0 ||
      Number(info.svipType || 0) > 0
    );
    const probeKnown = !!(vip && vip.resolved && vip.membershipKnown !== false);
    if (!probeKnown) {
      return withQQVipSyncState({
        ...info,
        vipCheckedAt: Date.now(),
        vipProbeAvailable: false,
        vipSource: info.vipSource || 'profile',
      }, false);
    }
    if (profilePositive && !vip.isVip && vip.authoritativeNegative !== true) {
      return withQQVipSyncState({
        ...info,
        membershipKnown: true,
        vipCheckedAt: Date.now(),
        vipProbeAvailable: true,
        vipEvidenceConflict: true,
        vipSource: info.vipSource || 'qq-profile-vip',
      }, true);
    }
    if (info.loggedIn && info.playbackKeyReady === false && !vip.isVip) {
      return withQQVipSyncState({
        ...info,
        vipCheckedAt: Date.now(),
        vipProbeAvailable: false,
        vipSource: source || vip.vipSource || info.vipSource || 'qq-vip-probe-untrusted',
      }, false);
    }
    return withQQVipSyncState({
      ...info,
      vipType: vip.vipType || 0,
      svipType: vip.svipType || 0,
      vipLevel: vip.vipLevel || 'none',
      isVip: !!vip.isVip,
      isSvip: !!vip.isSvip,
      vipLabel: vip.vipLabel || (vip.isVip ? 'VIP' : '无VIP'),
      membershipKnown: true,
      membershipStale: !!vip.membershipStale,
      vipEvidenceConflict: !!vip.vipEvidenceConflict,
      probeDecision: vip.probeDecision || '',
      authoritativeNegative: vip.authoritativeNegative === true,
      probeIncomplete: vip.probeIncomplete === true,
      negativeProbeCount: Math.max(0, Number(vip.negativeProbeCount) || 0),
      negativeQuorum: Math.max(0, Number(vip.negativeQuorum) || 0),
      staleUntil: Number(vip.staleUntil) || 0,
      expiresAt: Number(vip.expiresAt) || 0,
      vipCheckedAt: Date.now(),
      vipProbeAvailable: true,
      vipSource: source || vip.vipSource || 'qq-vip-probe',
    }, true);
  }

  async function fetchQQVipStatus(cookieObj, opts) {
    opts = opts || {};
    cookieObj = cookieObj || qqCookieObject();
    const uin = qqCookieUin(cookieObj);
    const musicKey = qqCookiePlaybackKey(cookieObj);
    if (!uin || !musicKey) return null;
    const cacheKey = qqVipSessionCacheKey(uin, musicKey, cookieObj);
    const cached = cacheKey ? qqVipInfoCache.get(cacheKey) : null;
    if (!opts.force && cached && Date.now() < cached.expiresAt) return cached.value;
    const comm = { uin, format: 'json', ct: 24, cv: 0 };
    if (musicKey) comm.authst = musicKey;
    const probes = [
      {
        source: 'qq-vip-query-v2-list',
        responseKey: 'req_1',
        uin: String(uin),
        body: {
          comm,
          req_1: {
            module: 'userInfo.VipQueryServer',
            method: 'SRFVipQuery_V2',
            param: { uin_list: [String(uin)] },
          },
        },
      },
      {
        source: 'qq-vip-query-v1-list',
        responseKey: 'req_1',
        uin: String(uin),
        body: {
          comm,
          req_1: {
            module: 'userInfo.VipQueryServer',
            method: 'SRFVipQuery',
            param: { uin_list: [String(uin)] },
          },
        },
      },
      {
        source: 'qq-vip-query-v2-single',
        responseKey: 'vip',
        uin: String(uin),
        body: {
          comm,
          vip: {
            module: 'userInfo.VipQueryServer',
            method: 'SRFVipQuery_V2',
            param: { uin: String(uin), uin_list: [String(uin)] },
          },
        },
      },
    ];
    const value = await resolveQQVipFromProbes(probes, async probe => {
      return qqMusicRequest(probe.body, { cookie: true, timeoutMs: 4200 });
    });
    const now = Date.now();
    const stableValue = preserveQQVipStalePositive(cached, value, { now });
    if (stableValue && stableValue.membershipStale) {
      return stableValue;
    }
    if (value && value.resolved) {
      const ttlMs = qqVipCacheTtlMs(value, {
        positiveTtlMs: QQ_VIP_INFO_CACHE_TTL_MS,
        negativeTtlMs: 30 * 1000,
      });
      if (cacheKey && ttlMs > 0) {
        qqVipInfoCache.set(cacheKey, {
          expiresAt: now + ttlMs,
          staleUntil: value.isVip
            ? Math.min(
              now + ttlMs + 10 * 60 * 1000,
              Number(value.expiresAt) > 0 ? Number(value.expiresAt) : Number.MAX_SAFE_INTEGER
            )
            : 0,
          value,
        });
      }
      return value;
    }
    if (opts.force && value && value.errorCount) {
      console.warn('[QQLogin] VIP probe incomplete:', value.errorCount + '/' + probes.length);
    }
    return null;
  }

  function normalizeQQProfile(body, cookieObj) {
    cookieObj = cookieObj || qqCookieObject();
    const uin = qqCookieUin(cookieObj);
    const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
    const creator = (data.creator || data.user || data.profile || data) || {};
    const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
    const profileNick = decodeQQCookieValue(creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '');
    const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
    const cookieNick = qqCookieNickname(cookieObj, uin);
    const nick = profileNick || cookieNick || '';
    const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin);
    // Cookie labels may survive a membership downgrade, so only current
    // official profile fields are allowed to become profile membership proof.
    const profileVip = normalizeQQVipPayload({ data, creator, vipInfo }, {});
    return {
      provider: 'qq',
      loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
      preview: false,
      userId: uin,
      nickname: nick || (uin ? ('QQ ' + uin) : 'QQ 音乐'),
      avatar,
      vipType: profileVip.vipType || 0,
      svipType: profileVip.svipType || 0,
      vipLevel: profileVip.vipLevel || 'none',
      isVip: !!profileVip.isVip,
      isSvip: !!profileVip.isSvip,
      vipLabel: profileVip.vipLabel || '无VIP',
      membershipKnown: !!profileVip.membershipKnown,
      expiresAt: Number(profileVip.expiresAt) || 0,
      hasCookie: !!getQQCookie(),
      playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
      profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
      vipSource: profileVip.resolved ? 'qq-profile-vip' : 'profile',
    };
  }


  function getQQCookieFile() {
    return QQ_COOKIE_FILE;
  }

  function refreshQQConfiguredCookieStore() {
    setQQCookie(readCookieFile(QQ_COOKIE_FILE));
    return getQQCookie();
  }

  function applyQQMusicKeyFields(obj, musicKey, extra) {
    const next = Object.assign({}, obj || {});
    const key = String(musicKey || '').trim();
    if (key) {
      next.qm_keyst = key;
      next.qqmusic_key = key;
      next.music_key = key;
    }
    const patch = extra || {};
    if (patch.refresh_token || patch.refreshToken) {
      next.psrf_qqrefresh_token = String(patch.refresh_token || patch.refreshToken);
    }
    if (patch.access_token || patch.accessToken) {
      next.psrf_qqaccess_token = String(patch.access_token || patch.accessToken);
    }
    if (patch.openid || patch.openId) {
      next.psrf_qqopenid = String(patch.openid || patch.openId);
    }
    if (patch.expired_in || patch.expiredIn) {
      next.login_expired_in = String(patch.expired_in || patch.expiredIn);
    }
    if (patch.login_type != null) next.login_type = String(patch.login_type);
    return next;
  }

  function extractQQRefreshPayload(body) {
    if (!body || typeof body !== 'object') return null;
    const candidates = [
      body.req_0 && body.req_0.data,
      body.req1 && body.req1.data,
      body.req0 && body.req0.data,
      body.data,
      body,
    ].filter(Boolean);
    for (let i = 0; i < candidates.length; i++) {
      const data = candidates[i];
      const musicKey = data.musickey || data.musicKey || data.qm_keyst || data.qqmusic_key || data.key || '';
      if (!musicKey) continue;
      return {
        musicKey: String(musicKey),
        refresh_token: data.refresh_token || data.refreshToken || data.refresh_key || '',
        access_token: data.access_token || data.accessToken || '',
        openid: data.openid || data.openId || '',
        expired_in: data.expired_in || data.expiredIn || data.expire || '',
        raw: data,
      };
    }
    return null;
  }

  let qqCookieRefreshPromise = null;
  let qqCookieLastRefreshAt = 0;
  const QQ_COOKIE_REFRESH_COOLDOWN_MS = 45000;

  async function refreshQQCookieSession(opts) {
    opts = opts || {};
    const force = !!opts.force;
    const now = Date.now();
    if (!force && qqCookieLastRefreshAt && (now - qqCookieLastRefreshAt) < QQ_COOKIE_REFRESH_COOLDOWN_MS) {
      const current = await getQQLoginInfo({ autoRenew: false, skipStoreReload: true });
      return {
        ok: !!(current && current.loggedIn && !current.authExpired),
        skipped: true,
        reason: 'cooldown',
        refreshed: false,
        info: current,
      };
    }
    if (qqCookieRefreshPromise) return qqCookieRefreshPromise;

    qqCookieRefreshPromise = (async () => {
      refreshQQConfiguredCookieStore();
      const epochAtStart = getQQCookieEpoch(); // 代际基线：期间发生手动保存/登出则放弃写回
      const cookieObj = qqCookieObject();
      const uin = qqCookieUin(cookieObj);
      const musicKey = qqCookiePlaybackKey(cookieObj) || qqCookieMusicKey(cookieObj);
      if (!uin || !musicKey) {
        return {
          ok: false,
          reason: 'missing_credentials',
          reauthRequired: true,
          info: { provider: 'qq', loggedIn: false, hasCookie: !!getQQCookie(), stale: true, reauthRequired: true },
        };
      }

      const attempts = [];
      attempts.push({
        label: 'musickey',
        payload: {
          comm: { g_tk: 5381, uin, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, platform: 'h5', needNewCode: 1, ct: 23, cv: 0 },
          req_0: {
            module: 'QQConnectLogin.LoginServer',
            method: 'QQLogin',
            param: {
              expired_in: 7776000,
              musicid: Number(uin) || uin,
              musickey: musicKey,
            },
          },
        },
      });

      const refreshToken = cookieObj.psrf_qqrefresh_token || cookieObj.wxrefresh_token || '';
      const accessToken = cookieObj.psrf_qqaccess_token || '';
      if (refreshToken) {
        attempts.push({
          label: 'refresh_token',
          payload: {
            comm: { g_tk: 5381, uin, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, platform: 'h5', needNewCode: 1, ct: 23, cv: 0 },
            req_0: {
              module: 'QQConnectLogin.LoginServer',
              method: 'QQLogin',
              param: {
                expired_in: 7776000,
                forceRefreshToken: 1,
                musicid: Number(uin) || uin,
                musickey: musicKey,
                refresh_token: refreshToken,
                access_token: accessToken || undefined,
              },
            },
          },
        });
      }

      let lastError = '';
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          const body = await qqMusicRequest(attempt.payload, { cookie: true });
          const extracted = extractQQRefreshPayload(body);
          if (!extracted || !extracted.musicKey) {
            lastError = 'empty_musickey';
            continue;
          }
          if (extracted.musicKey === musicKey && attempt.label === 'musickey' && refreshToken && i === 0) {
            // Same key from musickey path — still accept, but try refresh_token next if available.
            // Prefer a changed key when possible; accept same key as soft renew.
          }
          if (epochAtStart !== getQQCookieEpoch()) {
            // 刷新在途期间用户手动保存或登出过：放弃写回，别把用户新状态覆盖掉
            console.log('[QQLogin] cookie refresh superseded by newer manual save/logout; write-back skipped');
            const current = await getQQLoginInfo({ autoRenew: false, skipStoreReload: true });
            return {
              ok: !!(current && current.loggedIn && !current.authExpired),
              refreshed: false,
              reason: 'superseded',
              info: current,
            };
          }
          // 锁内重读最新 cookie 再合并写入，防旧读取值冲掉手动保存的新值
          let supersededWhileQueued = false;
          await withQQCookieWriteLock(async () => {
            // 上面校验完到拿到锁之间若发生手动保存/登出（代际已变），同样放弃写回
            if (epochAtStart !== getQQCookieEpoch()) {
              supersededWhileQueued = true;
              return;
            }
            const freshCookieObj = qqCookieObject();
            const mergedFresh = applyQQMusicKeyFields(freshCookieObj, extracted.musicKey, extracted);
            saveQQCookie(serializeCookieObject(mergedFresh));
          });
          if (supersededWhileQueued) {
            console.log('[QQLogin] cookie refresh superseded while queued on write lock; write-back skipped');
            const current = await getQQLoginInfo({ autoRenew: false, skipStoreReload: true });
            return {
              ok: !!(current && current.loggedIn && !current.authExpired),
              refreshed: false,
              reason: 'superseded',
              info: current,
            };
          }
          qqCookieLastRefreshAt = Date.now();
          const info = await getQQLoginInfo({ autoRenew: false, skipStoreReload: true });
          const ok = !!(info && info.loggedIn && !info.authExpired);
          console.log('[QQLogin] cookie refreshed via', attempt.label, ok ? 'ok' : 'soft', 'uin=' + uin);
          return {
            ok,
            refreshed: true,
            via: attempt.label,
            musicKeyChanged: extracted.musicKey !== musicKey,
            info: ok
              ? Object.assign({}, info, { refreshed: true, refreshVia: attempt.label })
              : Object.assign({}, info || {}, { stale: true, authExpired: true, reauthRequired: true, refreshed: false }),
          };
        } catch (e) {
          lastError = e && e.message ? e.message : String(e);
          console.warn('[QQLogin] cookie refresh attempt failed (' + attempt.label + '):', lastError);
        }
      }

      qqCookieLastRefreshAt = Date.now();
      return {
        ok: false,
        reason: lastError || 'refresh_failed',
        reauthRequired: true,
        info: Object.assign({}, normalizeQQProfile(null, cookieObj), {
          stale: true,
          authExpired: true,
          profileUnavailable: true,
          reauthRequired: true,
        }),
      };
    })();

    try {
      return await qqCookieRefreshPromise;
    } finally {
      qqCookieRefreshPromise = null;
    }
  }

  async function getQQLoginInfo(opts) {
    opts = opts || {};
    if (!opts.skipStoreReload || opts.forceCookie) refreshQQConfiguredCookieStore();
    const cookieObj = qqCookieObject();
    const uin = qqCookieUin(cookieObj);
    const musicKey = qqCookieMusicKey(cookieObj);
    if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, hasCookie: !!getQQCookie(), stale: !!getQQCookie(), reauthRequired: !!getQQCookie() };
    const fallback = normalizeQQProfile(null, cookieObj);
    const vipProbePromise = fetchQQVipStatus(cookieObj, { force: !!opts.forceVip }).catch(e => {
      if (opts.forceVip) console.warn('[QQLogin] VIP probe skipped:', e.message);
      return null;
    });
    try {
      const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
      u.searchParams.set('cid', '205360838');
      u.searchParams.set('userid', uin);
      u.searchParams.set('reqfrom', '1');
      u.searchParams.set('g_tk', '5381');
      u.searchParams.set('loginUin', uin);
      u.searchParams.set('hostUin', '0');
      u.searchParams.set('format', 'json');
      u.searchParams.set('inCharset', 'utf8');
      u.searchParams.set('outCharset', 'utf-8');
      u.searchParams.set('notice', '0');
      u.searchParams.set('platform', 'yqq.json');
      u.searchParams.set('needNewCode', '0');
      const text = await requestText(u.toString(), {
        headers: { ...QQ_HEADERS, Cookie: getQQCookie() },
        timeoutMs: opts.forceVip ? 6500 : 10000,
      });
      const body = parseJSONText(text);
      const info = normalizeQQProfile(body, cookieObj);
      const authExpired = !!(body && (body.code === 1000 || body.result === 301));
      if (authExpired) {
        if (opts.autoRenew !== false) {
          const renew = await refreshQQCookieSession({ reason: 'profile-auth-fail', force: !!opts.forceRenew || !!opts.forceVip });
          if (renew && renew.ok && renew.info) {
            const vipProbe = await vipProbePromise;
            return mergeQQVipStatus(renew.info, vipProbe, vipProbe && vipProbe.vipSource);
          }
          const vipProbe = await vipProbePromise;
          return mergeQQVipStatus(Object.assign({}, (renew && renew.info) || fallback, {
            profileUnavailable: true,
            stale: true,
            authExpired: true,
            reauthRequired: true,
            refreshAttempted: true,
            refreshOk: false,
          }), vipProbe, vipProbe && vipProbe.vipSource);
        }
        const vipProbe = await vipProbePromise;
        return mergeQQVipStatus(Object.assign({}, fallback, {
          profileUnavailable: true,
          stale: true,
          authExpired: true,
          reauthRequired: true,
        }), vipProbe, vipProbe && vipProbe.vipSource);
      }
      let mergedInfo = info;
      if (!info.playbackKeyReady && opts.autoRenew !== false) {
        const renew = await refreshQQCookieSession({ reason: 'missing-playback-key' });
        if (renew && renew.ok && renew.info && renew.info.playbackKeyReady) mergedInfo = renew.info;
      }
      const vipProbe = await vipProbePromise;
      return mergeQQVipStatus(mergedInfo, vipProbe, vipProbe && vipProbe.vipSource);
    } catch (e) {
      console.warn('[QQLogin] profile check failed:', e.message);
      const vipProbe = await vipProbePromise;
      return mergeQQVipStatus(Object.assign({}, fallback, { profileUnavailable: true, stale: true }), vipProbe, vipProbe && vipProbe.vipSource);
    }
  }


  async function qqGetJSON(targetUrl, params, opts) {
    opts = opts || {};
    const u = new URL(targetUrl);
    Object.keys(params || {}).forEach(k => {
      if (params[k] != null) u.searchParams.set(k, String(params[k]));
    });
    const headers = { ...QQ_HEADERS, ...(opts.headers || {}) };
    if (opts.cookie !== false && getQQCookie()) headers.Cookie = getQQCookie();
    const text = await requestText(u.toString(), { headers });
    return parseJSONText(text);
  }

  return {
    parseJSONText,
    qqMusicRequest,
    qqGetJSON,
    qqVipObjectLooksExpired,
    normalizeQQVipPayload,
    withQQVipSyncState,
    mergeQQVipStatus,
    fetchQQVipStatus,
    normalizeQQProfile,
    getQQCookieFile,
    refreshQQConfiguredCookieStore,
    applyQQMusicKeyFields,
    extractQQRefreshPayload,
    refreshQQCookieSession,
    getQQLoginInfo,
    QQ_HEADERS,
    QQ_MUSICU_URL,
    QQ_SMARTBOX_URL,
  };
};
