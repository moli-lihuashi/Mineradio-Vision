'use strict';

/* 酷狗修改版：无登录彩蛋。本文件只保留登录抽屉辅助与一键退出。 */
function handleLoginEasterEggTap() {}
function dismissLoginEasterEggCinematic() {}
function logoutAllAccountsAndResetEasterEgg() {
  if (typeof apiJson !== 'function') { showToast('API 未就绪'); return; }
  if (!window.confirm('退出全部平台并清除登录 Cookie？')) return;
  var btn = document.getElementById('login-reset-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '清除中…'; }
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
    if (btn) { btn.disabled = false; btn.textContent = '退出全部'; }
  });
}
function syncLoginModeUi() {
  var menu = document.querySelector('#login-modal .login-method-menu');
  var officialBtn = document.getElementById('login-mode-official');
  var cookieBtn = document.getElementById('login-mode-cookie');
  var officialLabel = document.getElementById('login-mode-official-label');
  var cookieLabel = document.getElementById('login-mode-cookie-label');
  var supportsCookie = loginProvider === 'qq' || loginProvider === 'kugou' || loginProvider === 'qishui';
  var cookieOn = loginProvider === 'qishui' ? !!qishuiManualCookieOpen : !!qqManualCookieOpen;
  if (!supportsCookie) {
    cookieOn = false;
    qqManualCookieOpen = false;
    if (typeof qishuiManualCookieOpen !== 'undefined') qishuiManualCookieOpen = false;
  }
  if (menu) {
    menu.classList.toggle('is-single', !supportsCookie);
    menu.classList.toggle('is-hidden', loginProvider === 'spotify');
  }
  if (officialLabel) {
    officialLabel.textContent = loginProvider === 'qishui'
      ? '本机会话'
      : (loginProvider === 'kugou' ? '官方窗口' : (loginProvider === 'spotify' ? 'OAuth' : '扫码登录'));
  }
  if (cookieLabel) {
    cookieLabel.textContent = loginProvider === 'qishui' ? 'Token' : 'Cookie';
  }
  if (officialBtn) {
    officialBtn.classList.toggle('active', !cookieOn);
    officialBtn.setAttribute('aria-selected', cookieOn ? 'false' : 'true');
    officialBtn.disabled = false;
  }
  if (cookieBtn) {
    cookieBtn.classList.toggle('active', cookieOn);
    cookieBtn.setAttribute('aria-selected', cookieOn ? 'true' : 'false');
    cookieBtn.disabled = !supportsCookie;
  }
}
function selectLoginProviderNode(provider) {
  provider = (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') ? provider : 'netease';
  // 切平台时回到主登录方式，避免 Cookie/Token 态串台
  if (provider === 'qishui') qishuiManualCookieOpen = false;
  else qqManualCookieOpen = false;
  setLoginProvider(provider);
  var drawer = document.getElementById('login-auth-drawer');
  if (drawer) drawer.classList.add('show');
  updateLoginProviderUi();
  if (typeof syncLoginPlatformScenery === 'function') syncLoginPlatformScenery(provider, true);
  if (window.MineradioPrismalChrome && typeof window.MineradioPrismalChrome.refresh === 'function') {
    requestAnimationFrame(function () { window.MineradioPrismalChrome.refresh(); });
  }
}
function selectLoginMode(mode) {
  if (loginProvider === 'spotify' || loginProvider === 'netease') {
    mode = 'official';
  }
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
    if (qishuiManualCookieOpen) return; // Token 面板已由方式切换打开，点保存即可
    if (typeof openQishuiWebLogin === 'function') openQishuiWebLogin();
    return;
  }
  if (qqManualCookieOpen && (loginProvider === 'qq' || loginProvider === 'kugou')) {
    return; // Cookie 面板已打开，点保存即可
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
