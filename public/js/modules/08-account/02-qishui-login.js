// ============================================================
//  汽水音乐登录（扫码登录 + Token 粘贴）
// ============================================================
// qishuiLoginStatus / qishuiLoginWasLoggedIn / qishuiLoginAutoRefreshTimer /
// qishuiOAuthBusy / qishuiTokenBusy / qishuiManualCookieOpen / qishuiQrToken 的 var 声明已挪到
// 主波 00-state/12a-audio-login-globals.js（boot 期急切读写；此处声明会在延迟波
// 求值时把运行态覆盖回默认值，且主波引用会 ReferenceError → 白屏）。
// 扫码流程在 03-login-modal-flows.js（refreshQr 汽水分支 + checkQr 汽水轮询），
// 走 /api/qishui/login/qrcode + /api/qishui/login/check。

function normalizeQishuiLoginStatus(info) {
  var fallback = {
    provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [],
    preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none',
    isVip: false, isSvip: false, stale: false, playbackKeyReady: false, playbackMode: 'recommend-match',
    searchReady: false, publicCatalog: false, webSession: false, cookieReady: false, tokenConfigured: false
  };
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
    if (!qishuiLoginStatus.loggedIn) {
      if (prevLogged || qishuiLoginWasLoggedIn) showToast('汽水音乐登录态已清除');
      qishuiPlaylists = [];
      if (typeof userPlaylists !== 'undefined' && Array.isArray(userPlaylists)) {
        userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qishui'; });
      }
      if (typeof homeDiscoverState !== 'undefined') homeDiscoverState.loaded = false;
    } else if (typeof refreshUserPlaylists === 'function') {
      if (typeof homeDiscoverState !== 'undefined') {
        homeDiscoverState.loaded = false;
        homeDiscoverState.loggedIn = true;
      }
      refreshUserPlaylists(true);
      if (typeof loadHomeDiscover === 'function') loadHomeDiscover(true);
    }
    qishuiLoginWasLoggedIn = !!qishuiLoginStatus.loggedIn;
    if (typeof hasPlatformLogin === 'function' && typeof firstLoggedProvider === 'function' && !hasPlatformLogin(activeAccountProvider)) {
      activeAccountProvider = firstLoggedProvider();
    }
    if (typeof renderUserBtn === 'function') renderUserBtn();
    return qishuiLoginStatus;
  } catch (e) {
    console.warn('Qishui login status failed:', e);
    qishuiLoginStatus = normalizeQishuiLoginStatus(null);
    if (typeof renderUserBtn === 'function') renderUserBtn();
    return qishuiLoginStatus;
  }
}

function startQishuiLoginStatusAutoRefresh() {
  if (qishuiLoginAutoRefreshTimer) clearInterval(qishuiLoginAutoRefreshTimer);
  qishuiLoginAutoRefreshTimer = setInterval(function () {
    refreshQishuiLoginStatus().catch(function (err) { console.warn('Qishui login auto refresh failed:', err); });
  }, 45000);
}

function qishuiLoginStatusText(info) {
  info = info || qishuiLoginStatus || {};
  if (qishuiTokenBusy) return '正在保存汽水 Token…';
  if (info.loggedIn && info.webSession) return '汽水扫码会话已生效 · 可同步歌单并直接播放';
  if (info.loggedIn && info.tokenConfigured) return '汽水 OpenAPI Token 已保存 · 可用作匹配源';
  if (info.loggedIn) return '汽水已登录';
  return '使用抖音 / 汽水音乐 App 扫码登录，或粘贴 OpenAPI access-token';
}

async function submitQishuiTokenLogin() {
  if (qishuiTokenBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var token = input ? input.value.trim() : '';
  if (!token) {
    if (statusEl) { statusEl.textContent = '先粘贴汽水 OpenAPI access-token'; statusEl.className = 'fail'; }
    return;
  }
  qishuiTokenBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = '正在保存汽水授权…'; statusEl.className = 'preview'; }
  if (typeof updateLoginProviderUi === 'function') updateLoginProviderUi();
  try {
    var info = await apiJson('/api/qishui/login/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '汽水授权不可用');
    qishuiLoginStatus = normalizeQishuiLoginStatus(info);
    activeAccountProvider = 'qishui';
    if (input) input.value = '';
    if (typeof renderUserBtn === 'function') renderUserBtn();
    if (typeof refreshUserPlaylists === 'function') refreshUserPlaylists(true);
    if (typeof loadHomeDiscover === 'function') loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = '汽水 OpenAPI 授权已保存'; statusEl.className = 'scan'; }
    qishuiManualCookieOpen = false;
    setTimeout(function () {
      if (typeof closeLoginModal === 'function') closeLoginModal();
      showToast('汽水音乐已授权为匹配源');
    }, 420);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '汽水授权保存失败'; statusEl.className = 'fail'; }
  } finally {
    qishuiTokenBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
    if (typeof updateLoginProviderUi === 'function') updateLoginProviderUi();
  }
}

async function logoutQishuiAccount() {
  try { await apiJson('/api/qishui/logout', { method: 'POST' }); } catch (_) {}
  try {
    var api = window.desktopWindow;
    if (api && typeof api.clearQishuiMusicLogin === 'function') await api.clearQishuiMusicLogin();
  } catch (_) {}
  qishuiLoginStatus = normalizeQishuiLoginStatus(null);
  qishuiLoginWasLoggedIn = false;
  qishuiPlaylists = [];
  if (typeof userPlaylists !== 'undefined' && Array.isArray(userPlaylists)) {
    userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qishui'; });
  }
  showToast('已退出汽水音乐');
}
