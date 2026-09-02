function readProviderVipAuditState() {
  try {
    var raw = localStorage.getItem(PROVIDER_VIP_AUDIT_STORE_KEY) || '{}';
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}
function writeProviderVipAuditState(state) {
  try { localStorage.setItem(PROVIDER_VIP_AUDIT_STORE_KEY, JSON.stringify(state || {})); } catch (e) { }
}
var QQ_PLAYBACK_VIP_EVIDENCE_TTL_MS = 12 * 60 * 60 * 1000;
function qqPlaybackVipEvidenceUserKey(status) {
  return String(status && (status.userId || status.uin || status.uid || status.openId || status.id) || '').trim();
}
function readQQPlaybackVipEvidence() {
  try {
    var raw = localStorage.getItem(QQ_PLAYBACK_VIP_EVIDENCE_STORE_KEY) || '{}';
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}
function writeQQPlaybackVipEvidence(evidence) {
  try { localStorage.setItem(QQ_PLAYBACK_VIP_EVIDENCE_STORE_KEY, JSON.stringify(evidence || {})); } catch (e) { }
}
function clearQQPlaybackVipEvidence() {
  try { localStorage.removeItem(QQ_PLAYBACK_VIP_EVIDENCE_STORE_KEY); } catch (e) { }
}
function qqPlaybackVipEvidenceApplies(evidence, status) {
  if (!evidence || !status || !status.loggedIn) return false;
  var checkedAt = Number(evidence.checkedAt || evidence.vipCheckedAt || 0) || 0;
  if (!checkedAt || Date.now() - checkedAt > QQ_PLAYBACK_VIP_EVIDENCE_TTL_MS) return false;
  var evidenceUser = qqPlaybackVipEvidenceUserKey(evidence);
  var statusUser = qqPlaybackVipEvidenceUserKey(status);
  return !!(evidenceUser && statusUser && evidenceUser === statusUser);
}
function mergeQQPlaybackVipEvidence(status) {
  if (!status || !status.loggedIn) return status;
  var evidence = readQQPlaybackVipEvidence();
  if (!qqPlaybackVipEvidenceApplies(evidence, status)) return status;
  var svip = providerVipLevel('qq', status) === 'svip' || providerVipLevel('qq', evidence) === 'svip' || !!status.isSvip || !!evidence.isSvip;
  return Object.assign({}, status, {
    provider: 'qq',
    loggedIn: true,
    vipType: Math.max(Number(status.vipType || status.vip_type || 0) || 0, Number(evidence.vipType || evidence.vip_type || 0) || 0, 1),
    svipType: Math.max(Number(status.svipType || status.svip_type || 0) || 0, Number(evidence.svipType || evidence.svip_type || 0) || 0),
    vipLevel: svip ? 'svip' : 'vip',
    isVip: true,
    isSvip: svip,
    playbackKeyReady: true,
    vipCheckedAt: Math.max(Number(status.vipCheckedAt || 0) || 0, Number(evidence.checkedAt || evidence.vipCheckedAt || 0) || 0),
    vipSource: evidence.vipSource || status.vipSource || 'qq-playback-evidence',
    vipProbeAvailable: true,
    membershipStale: false,
    authorizationIncomplete: false,
    vipSyncState: 'playback_evidence'
  });
}
function providerVipAuditSnapshot(provider, status) {
  status = status || {};
  var level = providerVipLevel(provider, status);
  return {
    provider: provider,
    loggedIn: !!status.loggedIn,
    userId: String(status.userId || status.uid || status.uin || status.openId || status.id || ''),
    vipLevel: level,
    isVip: level !== 'none',
    checkedAt: Date.now()
  };
}
function providerVipAuditLabel(provider, snapshot) {
  var meta = platformMeta(provider);
  var label = meta && meta.label || provider;
  var level = snapshot && snapshot.vipLevel === 'svip' ? 'SVIP' : 'VIP';
  return label + ' ' + level;
}
function providerVipAuditSameUser(previous, current) {
  if (!previous || !current) return true;
  if (!previous.userId || !current.userId) return true;
  return String(previous.userId) === String(current.userId);
}
function auditProviderVipState(provider, status) {
  if (!status) return;
  var state = readProviderVipAuditState();
  var previous = state[provider] || null;
  var current = providerVipAuditSnapshot(provider, status);
  var sameUser = providerVipAuditSameUser(previous, current);
  if (previous && sameUser && previous.loggedIn && previous.isVip && current.loggedIn && !current.isVip) {
    var title = providerVipAuditLabel(provider, previous) + ' 状态掉了';
    var body = '本次启动复验时已变为普通账号，会员曲目可能只能试听或需要换源。';
    if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice(title, body);
    else showToast(title);
  }
  if (previous && sameUser && previous.loggedIn && !previous.isVip && current.loggedIn && current.isVip) {
    var syncTitle = providerVipAuditLabel(provider, current) + ' 已同步';
    var syncBody = '已重新检查到当前账号会员状态，会员曲目会按新的平台权限继续尝试播放。';
    if (typeof showToast === 'function') showToast(syncTitle);
    else if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice(syncTitle, syncBody);
  }
  state[provider] = current;
  writeProviderVipAuditState(state);
}

async function refreshLoginStatus(force) {
  try {
    var info = await apiJson('/api/login/status?t=' + Date.now());
    loginStatusChecked = true;
    loginStatusCheckFailed = false;
    loginStatus = info || { loggedIn: false };
    auditProviderVipState('netease', loginStatus);
    if (loginStatus.loggedIn && !hasPlatformLogin(activeAccountProvider)) activeAccountProvider = 'netease';
    renderUserBtn();
    if (info && info.loggedIn) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
      syncLikeStatusForSongs(playQueue.concat(playlist || []));
      if (typeof maybeRestorePlaybackSessionAfterLogin === 'function') maybeRestorePlaybackSessionAfterLogin();
    } else {
      var neteasePlaylists = [];
      userPlaylists = qqPlaylists.concat(kugouPlaylists || [], qishuiPlaylists || [], spotifyPlaylists || []);
      playlistCatalogRevision += 1;
      myPodcastCollections = [];
      myPodcastItems = {};
      likedSongMap = {};
      updateLikeButtons();
    }
    return info;
  } catch (e) {
    console.warn(e);
    loginStatusChecked = true;
    loginStatusCheckFailed = true;
    renderUserBtn();
    return null;
  }
}

function normalizeQQLoginStatus(info) {
  var fallback = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0, svipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, playbackKeyReady: false, vipCheckedAt: 0, vipSource: '', vipProbeAvailable: false, membershipKnown: false, membershipStale: false, authorizationIncomplete: false, vipSyncState: '' };
  if (!info || !info.loggedIn) return Object.assign({}, fallback, info || {}, {
    provider: 'qq',
    loggedIn: false,
    nickname: info && info.nickname || fallback.nickname,
    userId: info && (info.userId || info.uin) || '',
    avatar: info && info.avatar || '',
    vipType: Number(info && (info.vipType || info.vip_type) || 0) || 0,
    svipType: Number(info && (info.svipType || info.svip_type) || 0) || 0,
    vipLevel: info && (info.vipLevel || info.vip_level) || 'none',
    isVip: !!(info && info.isVip),
    isSvip: !!(info && info.isSvip),
    stale: !!(info && info.stale),
    vipCheckedAt: Number(info && info.vipCheckedAt || 0) || 0,
    vipSource: info && info.vipSource || '',
    vipProbeAvailable: !!(info && info.vipProbeAvailable),
    membershipKnown: !!(info && info.membershipKnown),
    membershipStale: !!(info && info.membershipStale),
    authorizationIncomplete: !!(info && info.authorizationIncomplete),
    vipSyncState: info && info.vipSyncState || ''
  });
  return Object.assign({}, fallback, info, {
    provider: 'qq',
    loggedIn: true,
    nickname: info.nickname || fallback.nickname,
    userId: info.userId || info.uin || '',
    avatar: info.avatar || '',
    vipType: Number(info.vipType || info.vip_type || 0) || 0,
    svipType: Number(info.svipType || info.svip_type || 0) || 0,
    vipLevel: info.vipLevel || info.vip_level || 'none',
    isVip: !!info.isVip,
    isSvip: !!info.isSvip,
    playbackKeyReady: !!info.playbackKeyReady,
    stale: !!info.stale || !!(info.profileUnavailable && !(info.nickname && info.avatar)),
    vipCheckedAt: Number(info.vipCheckedAt || 0) || 0,
    vipSource: info.vipSource || '',
    vipProbeAvailable: !!info.vipProbeAvailable,
    membershipKnown: !!info.membershipKnown,
    membershipStale: !!info.membershipStale,
    authorizationIncomplete: !!info.authorizationIncomplete,
    vipSyncState: info.vipSyncState || ''
  });
}

function qqLoginNeedsAuthorizationRefresh(status) {
  status = status || qqLoginStatus;
  return !!(status && status.loggedIn && (
    status.authorizationIncomplete ||
    status.playbackKeyReady === false
  ));
}
function qqMembershipNeedsSync(status) {
  status = status || qqLoginStatus;
  return !!(status && status.loggedIn && (
    status.membershipKnown === false ||
    status.membershipKnown !== true ||
    status.membershipStale
  ));
}
function qqMembershipLabel(status) {
  if (qqMembershipNeedsSync(status)) return '会员待同步';
  var level = providerVipLevel('qq', status);
  return level === 'svip' ? 'SVIP 会员' : (level === 'vip' ? 'VIP 会员' : '普通账号');
}
function qqLoginStatusText(info) {
  info = normalizeQQLoginStatus(info || qqLoginStatus);
  if (!info.loggedIn) return '点击“扫码登录”打开 QQ 音乐官方窗口';
  if (qqLoginNeedsAuthorizationRefresh(info)) return 'QQ 网页会话已连接 · 播放授权尚未完成';
  if (qqMembershipNeedsSync(info)) return '已保存 QQ 音乐播放授权 · 会员状态待同步';
  var syncText = info.vipCheckedAt ? ' · 会员已复验' : '';
  return '已保存 QQ 音乐会话 · ' + (info.nickname || 'QQ 音乐') + ' · ' + qqMembershipLabel(info) + syncText;
}

async function refreshQQLoginStatus(options) {
  if (options === true) options = { forceVip: true };
  options = options || {};
  try {
    var prevLogged = !!qqLoginStatus.loggedIn;
    var prevStatus = qqLoginStatus || {};
    var prevAuthKey = [
      !!prevStatus.loggedIn,
      !!prevStatus.authExpired,
      !!prevStatus.reauthRequired,
      !!prevStatus.stale,
      !!prevStatus.playbackKeyReady
    ].join('|');

    var query = '/api/qq/login/status?t=' + Date.now()
      + (options.forceVip ? '&forceVip=1' : '')
      + (options.forceRenew ? '&renew=1' : '');
    var info = await apiJson(query);
    qqLoginStatus = normalizeQQLoginStatus(info);

    // Keep last-known membership on transient unknown probes for the same user.
    if (
      qqLoginStatus.loggedIn &&
      qqLoginStatus.membershipKnown === false &&
      prevStatus.loggedIn &&
      prevStatus.membershipKnown === true &&
      String(prevStatus.userId || '') === String(qqLoginStatus.userId || '')
    ) {
      qqLoginStatus = Object.assign({}, qqLoginStatus, {
        vipType: prevStatus.vipType,
        svipType: prevStatus.svipType,
        vipLevel: prevStatus.vipLevel,
        isVip: prevStatus.isVip,
        isSvip: prevStatus.isSvip,
        vipLabel: prevStatus.vipLabel,
        membershipKnown: true,
        membershipStale: true,
        vipSyncState: 'stale'
      });
    }

    var needsExtraRenew = !!(
      options.forceRenew ||
      (qqLoginStatus && qqLoginStatus.loggedIn && !qqLoginStatus.playbackKeyReady && !qqLoginStatus.refreshSkipped) ||
      (qqLoginStatus && (qqLoginStatus.authExpired || qqLoginStatus.reauthRequired) && options.allowAuthRenew)
    );
    if (needsExtraRenew && typeof canAttemptQQCookieRenew === 'function' && canAttemptQQCookieRenew()) {
      try {
        var renewInfo = await apiJson('/api/qq/login/refresh' + (options.forceRenew || options.forceVip ? '?force=1' : ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: !!(options.forceRenew || options.forceVip) })
        });
        markQQCookieRenewAttempt(!!(renewInfo && renewInfo.refreshOk));
        if (renewInfo) {
          qqLoginStatus = normalizeQQLoginStatus(renewInfo);
          if (renewInfo.refreshOk && renewInfo.refreshed && (prevLogged || qqLoginWasLoggedIn)) {
            showToast('QQ 音乐登录已自动续期');
          }
        }
      } catch (renewErr) {
        markQQCookieRenewAttempt(false);
        console.warn('QQ cookie auto renew failed:', renewErr);
      }
    }

    // Soft-restore transient logout before toasting
    if (!qqLoginStatus.loggedIn && (prevLogged || qqLoginWasLoggedIn) && prevStatus.loggedIn && !qqLoginStatus.authExpired && !qqLoginStatus.reauthRequired) {
      qqLoginStatus = Object.assign({}, prevStatus, { stale: true, membershipStale: true });
    }

    auditProviderVipState('qq', qqLoginStatus);

    var nextAuthKey = [
      !!qqLoginStatus.loggedIn,
      !!qqLoginStatus.authExpired,
      !!qqLoginStatus.reauthRequired,
      !!qqLoginStatus.stale,
      !!qqLoginStatus.playbackKeyReady
    ].join('|');
    var authChanged = nextAuthKey !== prevAuthKey;

    if (!qqLoginStatus.loggedIn) {
      if (authChanged && (prevLogged || qqLoginWasLoggedIn)) {
        showToast(qqLoginStatus.stale || qqLoginStatus.authExpired ? 'QQ 音乐登录已失效' : 'QQ 音乐已掉登录');
      }
      qqPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qq'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'qq'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      loadHomeDiscover(true);
      refreshUserPlaylists(true);
    } else if (authChanged && (qqLoginStatus.reauthRequired || qqLoginStatus.authExpired)) {
      if (prevLogged || qqLoginWasLoggedIn) showToast('QQ 音乐授权已失效，请重新登录续期');
    }

    qqLoginWasLoggedIn = !!qqLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return qqLoginStatus;
  } catch (e) {
    console.warn('QQ login status failed:', e);
    if (qqLoginStatus && qqLoginStatus.loggedIn) {
      qqLoginStatus = Object.assign({}, qqLoginStatus, {
        stale: true,
        membershipStale: true,
        vipProbeAvailable: false,
        vipSyncState: 'stale'
      });
      renderUserBtn();
      return qqLoginStatus;
    }
    qqLoginStatus = normalizeQQLoginStatus(null);
    renderUserBtn();
    return qqLoginStatus;
  }
}

var _qqCookieRenewFailUntil = 0;
var _qqCookieRenewFailStreak = 0;
var _qqPlayRenewOnceKey = '';
function canAttemptQQCookieRenew() {
  return Date.now() >= (_qqCookieRenewFailUntil || 0);
}
function markQQCookieRenewAttempt(ok) {
  if (ok) {
    _qqCookieRenewFailStreak = 0;
    _qqCookieRenewFailUntil = 0;
    return;
  }
  _qqCookieRenewFailStreak = Math.min(6, (_qqCookieRenewFailStreak || 0) + 1);
  var wait = Math.min(10 * 60 * 1000, 15000 * Math.pow(2, Math.max(0, _qqCookieRenewFailStreak - 1)));
  _qqCookieRenewFailUntil = Date.now() + wait;
}
async function ensureQQSessionBeforePlay(reason) {
  if (!(qqLoginStatus && (qqLoginStatus.loggedIn || qqLoginWasLoggedIn))) return qqLoginStatus;
  var needs = !!(
    qqLoginStatus.authExpired ||
    qqLoginStatus.reauthRequired ||
    qqLoginStatus.playbackKeyReady === false ||
    qqLoginStatus.authorizationIncomplete ||
    qqLoginNeedsAuthorizationRefresh(qqLoginStatus)
  );
  if (!needs) return qqLoginStatus;
  var onceKey = String((qqLoginStatus && qqLoginStatus.userId) || 'qq') + '|' + String(reason || 'play');
  if (_qqPlayRenewOnceKey === onceKey && !canAttemptQQCookieRenew()) return qqLoginStatus;
  _qqPlayRenewOnceKey = onceKey;
  return refreshQQLoginStatus({
    forceRenew: true,
    allowAuthRenew: true,
    reason: reason || 'pre-play'
  });
}
function refreshQQVipStatusNow(reason) {
  var now = Date.now();
  if (now - qqLoginStatusLastForcedAt < 8000) return Promise.resolve(qqLoginStatus);
  qqLoginStatusLastForcedAt = now;
  return refreshQQLoginStatus({ forceVip: true, reason: reason || 'manual' });
}
function startQQLoginStatusAutoRefresh() {
  if (qqLoginAutoRefreshTimer) clearInterval(qqLoginAutoRefreshTimer);
  qqLoginAutoRefreshTimer = setInterval(function () {
    refreshQQLoginStatus({ reason: 'auto' }).catch(function (e) { console.warn('QQ login auto refresh failed:', e); });
  }, 45000);
  if (startQQLoginStatusAutoRefresh._boundFocusRefresh) return;
  startQQLoginStatusAutoRefresh._boundFocusRefresh = true;
  function refreshOnVisible(reason) {
    if (document.hidden) return;
    if (!qqLoginStatus.loggedIn && !qqLoginWasLoggedIn) return;
    refreshQQVipStatusNow(reason).catch(function (e) { console.warn('QQ VIP foreground refresh failed:', e); });
  }
  window.addEventListener('focus', function () { refreshOnVisible('window-focus'); });
  document.addEventListener('visibilitychange', function () { refreshOnVisible('visibility'); });
}

function normalizeKugouLoginStatus(info) {
  var fallback = { provider: 'kugou', loggedIn: false, preview: false, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0, svipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, playbackKeyReady: false };
  var normalizedLevel = info && info.loggedIn ? providerVipLevel('kugou', info) : (info && (info.vipLevel || info.vip_level) || 'none');
  if (!info || !info.loggedIn) return Object.assign({}, fallback, info || {}, {
    provider: 'kugou',
    loggedIn: false,
    nickname: info && info.nickname || fallback.nickname,
    userId: info && (info.userId || info.userid) || '',
    avatar: info && info.avatar || '',
    vipType: Number(info && (info.vipType || info.vip_type) || 0) || 0,
    svipType: Number(info && (info.svipType || info.svip_type) || 0) || 0,
    vipLevel: normalizedLevel,
    isVip: normalizedLevel !== 'none' || !!(info && info.isVip),
    isSvip: normalizedLevel === 'svip' || !!(info && info.isSvip),
    stale: !!(info && info.stale),
    playbackKeyReady: !!(info && (info.playbackReady || info.playbackKeyReady))
  });
  return Object.assign({}, fallback, info, {
    provider: 'kugou',
    loggedIn: true,
    nickname: info.nickname || fallback.nickname,
    userId: info.userId || info.userid || '',
    avatar: info.avatar || '',
    vipType: Number(info.vipType || info.vip_type || 0) || 0,
    svipType: Number(info.svipType || info.svip_type || 0) || 0,
    vipLevel: normalizedLevel,
    isVip: normalizedLevel !== 'none' || !!info.isVip,
    isSvip: normalizedLevel === 'svip' || !!info.isSvip,
    playbackKeyReady: !!(info.playbackReady || info.playbackKeyReady),
    stale: !!info.stale
  });
}
function applyKugouPlaybackStatusEvidence(info) {
  if (!info || info.provider !== 'kugou' || !info.loggedIn) return false;
  var existing = kugouLoginStatus || {};
  var verifiedMembership = info.membershipVerified === true &&
    (info.membershipSource === 'kugou-vip-api' ||
      info.membershipSource === 'kugou-web-roleinfo' ||
      info.membershipSource === 'kugou-cookie-explicit');
  var safeUpdate = {
    provider: 'kugou',
    loggedIn: true,
    playbackKeyReady: !!(info.playbackReady || info.playbackKeyReady || existing.playbackKeyReady)
  };
  if (verifiedMembership) {
    safeUpdate.vipType = Number(info.vipType || 0) || 0;
    safeUpdate.svipType = Number(info.svipType || 0) || 0;
    safeUpdate.vipLevel = info.vipLevel === 'svip' ? 'svip' : (info.vipLevel === 'vip' ? 'vip' : 'none');
    safeUpdate.isVip = info.isVip === true;
    safeUpdate.isSvip = info.isSvip === true;
    safeUpdate.membershipVerified = true;
    safeUpdate.membershipSource = info.membershipSource;
  }
  kugouLoginStatus = normalizeKugouLoginStatus(Object.assign({}, existing, safeUpdate));
  kugouLoginWasLoggedIn = true;
  renderUserBtn();
  return true;
}
function qqPlaybackShowsMemberAccess(info, song) {
  // A playable URL plus a song-level VIP hint proves that this request worked;
  // it does not prove the account owns a subscription.
  return false;
}
function applyQQPlaybackStatusEvidence(info, song) {
  return false;
}
async function refreshKugouLoginStatus() {
  try {
    var info = await apiJson('/api/kugou/login/status?t=' + Date.now());
    var prevLogged = !!kugouLoginStatus.loggedIn;
    kugouLoginStatus = normalizeKugouLoginStatus(info);
    auditProviderVipState('kugou', kugouLoginStatus);
    if (!kugouLoginStatus.loggedIn) {
      if (prevLogged || kugouLoginWasLoggedIn) showToast(kugouLoginStatus.stale ? '酷狗音乐登录已失效' : '酷狗音乐已掉登录');
      kugouPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'kugou'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'kugou'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
    } else if (kugouLoginStatus.stale) {
      showToast('酷狗音乐登录状态可能已失效');
    }
    kugouLoginWasLoggedIn = !!kugouLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return kugouLoginStatus;
  } catch (e) {
    console.warn('Kugou login status failed:', e);
    kugouLoginStatus = normalizeKugouLoginStatus(null);
    renderUserBtn();
    return kugouLoginStatus;
  }
}
function startKugouLoginStatusAutoRefresh() {
  if (kugouLoginAutoRefreshTimer) clearInterval(kugouLoginAutoRefreshTimer);
  kugouLoginAutoRefreshTimer = setInterval(function () {
    refreshKugouLoginStatus().catch(function (e) { console.warn('Kugou login auto refresh failed:', e); });
  }, 45000);
}

function normalizeQishuiLoginStatus(info) {
  var fallback = { provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, playbackKeyReady: false, playbackMode: 'recommend-match', searchReady: false, publicCatalog: false };
  var configured = !!(info && (info.configured || info.loggedIn));
  var webSession = !!(info && info.webSession);
  var capabilities = info && info.capabilities || {};
  var searchReady = !!(configured || capabilities.search || info && info.publicCatalog);
  return Object.assign({}, fallback, info || {}, {
    provider: 'qishui',
    loggedIn: configured,
    configured: configured,
    oauthConfigured: !!(info && (info.oauthConfigured || (info.oauth && info.oauth.configured))),
    oauthMissing: info && Array.isArray(info.oauthMissing) ? info.oauthMissing : [],
    userId: info && (info.userId || info.openId || info.open_id || info.tokenSource || info.scope || '') || '',
    nickname: info && info.nickname ? info.nickname : (webSession ? '汽水音乐账号' : (configured ? '汽水开放平台' : fallback.nickname)),
    avatar: info && info.avatar || '',
    vipType: Number(info && (info.vipType || info.vip_type) || 0) || 0,
    vipLevel: info && (info.vipLevel || info.vip_level) || 'none',
    isVip: !!(info && info.isVip),
    isSvip: !!(info && info.isSvip),
    playbackKeyReady: !!(webSession && capabilities.playableUrl),
    playbackMode: info && info.playbackMode || 'recommend-match',
    searchReady: searchReady,
    webSession: webSession,
    cookieReady: !!(info && info.cookieReady),
    tokenConfigured: !!(info && info.tokenConfigured),
    publicCatalog: !!(!configured && searchReady),
    stale: false
  });
}
async function refreshQishuiLoginStatus() {
  try {
    var info = await apiJson('/api/qishui/status?t=' + Date.now());
    var prevLogged = !!qishuiLoginStatus.loggedIn;
    qishuiLoginStatus = normalizeQishuiLoginStatus(info);
    auditProviderVipState('qishui', qishuiLoginStatus);
    if (!qishuiLoginStatus.loggedIn) {
      if (prevLogged || qishuiLoginWasLoggedIn) showToast('汽水音乐授权已清除');
      qishuiPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qishui'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'qishui'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    qishuiLoginWasLoggedIn = !!qishuiLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return qishuiLoginStatus;
  } catch (e) {
    console.warn('Qishui login status failed:', e);
    qishuiLoginStatus = normalizeQishuiLoginStatus(null);
    renderUserBtn();
    return qishuiLoginStatus;
  }
}
function startQishuiLoginStatusAutoRefresh() {
  if (qishuiLoginAutoRefreshTimer) clearInterval(qishuiLoginAutoRefreshTimer);
  qishuiLoginAutoRefreshTimer = setInterval(function () {
    refreshQishuiLoginStatus().catch(function (e) { console.warn('Qishui login auto refresh failed:', e); });
  }, 45000);
}

function normalizeSpotifyLoginStatus(info) {
  var fallback = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', accountId: '', avatar: '', product: '', membershipKnown: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, reauthRequired: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false, searchReady: false };
  var loggedIn = !!(info && info.loggedIn);
  var product = String(info && info.product || '').toLowerCase();
  var isPremium = loggedIn && product === 'premium';
  var capabilities = info && info.capabilities || {};
  return Object.assign({}, fallback, info || {}, {
    provider: 'spotify',
    loggedIn: loggedIn,
    configured: !!(info && (info.configured || loggedIn)),
    oauthConfigured: !!(info && info.oauthConfigured),
    oauthMissing: info && Array.isArray(info.oauthMissing) ? info.oauthMissing : [],
    nickname: info && (info.nickname || info.displayName || info.display_name) || fallback.nickname,
    userId: info && (info.userId || info.id) || '',
    accountId: info && (info.accountId || info.account_id) || '',
    avatar: info && info.avatar || '',
    product: product,
    membershipKnown: !!(info && (info.membershipKnown || product)),
    vipType: isPremium ? 1 : 0,
    vipLevel: isPremium ? 'vip' : 'none',
    isVip: isPremium,
    isSvip: false,
    tokenConfigured: !!(info && info.tokenConfigured),
    tokenFileExists: !!(info && info.tokenFileExists),
    credentialsFileExists: !!(info && info.credentialsFileExists),
    localConfigMissing: !!(info && info.localConfigMissing),
    playbackKeyReady: loggedIn,
    playbackMode: 'recommend-match',
    searchReady: !!(capabilities.search || info && info.searchReady),
    stale: !!(info && info.stale),
    reauthRequired: !!(info && info.reauthRequired)
  });
}
async function refreshSpotifyLoginStatus() {
  try {
    var info = await apiJson('/api/spotify/status?t=' + Date.now());
    var prevLogged = !!spotifyLoginStatus.loggedIn;
    spotifyLoginStatus = normalizeSpotifyLoginStatus(info);
    auditProviderVipState('spotify', spotifyLoginStatus);
    if (!spotifyLoginStatus.loggedIn) {
      if (prevLogged || spotifyLoginWasLoggedIn) showToast(spotifyLoginStatus.stale ? 'Spotify 登录已失效' : 'Spotify 已退出');
      spotifyPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'spotify'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'spotify'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    spotifyLoginWasLoggedIn = !!spotifyLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return spotifyLoginStatus;
  } catch (e) {
    console.warn('Spotify login status failed:', e);
    spotifyLoginStatus = normalizeSpotifyLoginStatus(null);
    renderUserBtn();
    return spotifyLoginStatus;
  }
}
function startSpotifyLoginStatusAutoRefresh() {
  if (spotifyLoginAutoRefreshTimer) clearInterval(spotifyLoginAutoRefreshTimer);
  spotifyLoginAutoRefreshTimer = setInterval(function () {
    refreshSpotifyLoginStatus().catch(function (e) { console.warn('Spotify login auto refresh failed:', e); });
  }, 45000);
}

function renderUserBtn() {
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  var topRight = document.getElementById('top-right');
  var loggedCount = 0;
  ['netease', 'qq', 'kugou', 'qishui', 'spotify'].forEach(function (p) {
    if (hasPlatformLogin(p)) loggedCount += 1;
  });
  if (topRight) topRight.classList.toggle('account-pill-stack', loggedCount > 1);
  btn.classList.remove('multi-account', 'external-account-pills', 'login-eye-avatar', 'logged-in', 'logged-out');
  if (dualAccountMode && hasAnyPlatformLogin()) {
    activeAccountProvider = firstLoggedProvider();
    btn.classList.add('logged-in', 'multi-account', 'external-account-pills');
    btn.title = '账号信息 · 双平台登录状态';
    btn.innerHTML = renderTopAccountPill('netease') + renderTopAccountPill('qq') + renderTopAccountPill('kugou') + renderTopAccountPill('qishui') + renderTopAccountPill('spotify');
  } else if (hasAnyPlatformLogin()) {
    activeAccountProvider = firstLoggedProvider();
    var st = platformStatus(activeAccountProvider);
    var meta = platformMeta(activeAccountProvider);
    btn.classList.add('logged-in');
    if (loggedCount > 1) btn.classList.add('multi-account', 'external-account-pills');
    btn.title = dualAccountMode ? '账号信息 · 已启用双平台展示' : ((st.nickname || meta.label) + ' · 账号信息');
    if (loggedCount > 1) {
      btn.innerHTML = ['netease', 'qq', 'kugou', 'qishui', 'spotify'].map(function (provider) {
        return hasPlatformLogin(provider) ? renderTopAccountPill(provider) : '';
      }).join('');
    } else {
      btn.innerHTML = imgTagFromSrc(providerAvatarSrc(activeAccountProvider, st), 'id="user-avatar"') +
                      '<span>' + escHtml(st.nickname || meta.label) + '</span>' +
                      providerVipBadge(activeAccountProvider, st, 'user-vip-tag');
    }
  } else {
    btn.classList.add('logged-out');
    btn.title = '登录账号';
    btn.innerHTML = typeof loginEasterEggEyeMarkup === 'function'
      ? loginEasterEggEyeMarkup(true)
      : '<span class="login-word">登录</span>';
  }
  if (typeof updateAccountPillGlassDisplacementMap === 'function') {
    requestAnimationFrame(updateAccountPillGlassDisplacementMap);
  }
  if (typeof updatePlaybackQualityUi === 'function') updatePlaybackQualityUi();
}

