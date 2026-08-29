'use strict';

/* 酷狗修改版：无登录彩蛋。本文件只保留登录抽屉辅助与一键退出。 */
function handleLoginEasterEggTap() {}
function dismissLoginEasterEggCinematic() {}
function logoutAllAccountsAndResetEasterEgg() {
  if (typeof apiJson !== 'function') { showToast('API 未就绪'); return; }
  if (!window.confirm('退出全部平台并清除登录 Cookie？')) return;
  var btn = document.getElementById('login-reset-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '正在清除…'; }
  Promise.allSettled([
    apiJson('/api/logout'),
    apiJson('/api/qq/logout'),
    apiJson('/api/kugou/logout'),
    apiJson('/api/qishui/logout'),
    apiJson('/api/spotify/logout')
  ]).then(function () {
    if (typeof window.desktopWindow !== 'undefined' && window.desktopWindow) {
      try { if (typeof window.desktopWindow.clearQishuiMusicLogin === 'function') window.desktopWindow.clearQishuiMusicLogin(); } catch (_) {}
      try { if (typeof window.desktopWindow.clearSpotifyMusicLogin === 'function') window.desktopWindow.clearSpotifyMusicLogin(); } catch (_) {}
    }
    resetAllProviderRendererLoginState();
    if (typeof closeLoginModal === 'function') closeLoginModal();
    showToast('已退出全部账号');
  }).catch(function (e) {
    console.warn('Logout failed:', e);
    showToast('清理未完成，请重启后重试');
  }).finally(function () {
    if (btn) { btn.disabled = false; btn.textContent = '退出登录'; }
  });
}
function selectLoginProviderNode(provider) {
  provider = (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') ? provider : 'netease';
  setLoginProvider(provider);
  var drawer = document.getElementById('login-auth-drawer');
  if (drawer) drawer.classList.add('show');
  updateLoginProviderUi();
  // 用户主动切换平台 → 更新头部平台文案（布景随 updateLoginProviderUi 已同步）
  if (typeof syncLoginPlatformScenery === 'function') syncLoginPlatformScenery(provider, true);
}
function selectLoginMode(mode) {
  if (loginProvider === 'qishui') qishuiManualCookieOpen = (mode === 'cookie');
  else qqManualCookieOpen = (mode === 'cookie');
  updateLoginProviderUi();
  var drawer = document.getElementById('login-auth-drawer');
  if (drawer) drawer.classList.add('show');
}
function startSelectedLoginConnection() {
  var drawer = document.getElementById('login-auth-drawer');
  if (drawer) drawer.classList.add('show');
  if (loginProvider === 'qishui') {
    if (qishuiManualCookieOpen) {
      if (typeof toggleQishuiTokenPanel === 'function') toggleQishuiTokenPanel();
      return;
    }
    if (typeof openQishuiWebLogin === 'function') openQishuiWebLogin();
    return;
  }
  if (qqManualCookieOpen) {
    toggleQQCookiePanel();
    return;
  }
  if (loginProvider === 'qq') { openQQWebLogin(); return; }
  if (loginProvider === 'kugou') { openKugouWebLogin(); return; }
  if (loginProvider === 'spotify') { submitSpotifyConfigLogin(); return; }
  if (window.desktopWindow && typeof window.desktopWindow.openNeteaseMusicLogin === 'function') { openNeteaseWebLogin(); return; }
  refreshQr();
}
function resetAllProviderRendererLoginState() {
  localStorage.removeItem('mineradio-netease-login');
  localStorage.removeItem('mineradio-qq-login');
  localStorage.removeItem('mineradio-kugou-login');
  localStorage.removeItem('mineradio-qishui-login');
  localStorage.removeItem('mineradio-spotify-login');
  if (typeof loginStatus === 'object') Object.assign(loginStatus, { loggedIn: false, nickname: '', userId: '', avatar: '' });
  if (typeof qqLoginStatus === 'object') Object.assign(qqLoginStatus, { loggedIn: false });
  if (typeof kugouLoginStatus === 'object') Object.assign(kugouLoginStatus, { loggedIn: false });
  qishuiLoginStatus = { provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match' };
  qishuiPlaylists = [];
  spotifyLoginStatus = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', avatar: '', product: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false };
  userPlaylists = (qqPlaylists || []).concat(kugouPlaylists || [], spotifyPlaylists || []);
  if (typeof updateLoginProviderUi === 'function') updateLoginProviderUi();
  if (typeof scheduleShelfRebuild === 'function') scheduleShelfRebuild('logout-all', true);
}
