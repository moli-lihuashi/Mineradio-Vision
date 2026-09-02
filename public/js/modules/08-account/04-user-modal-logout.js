function updateUserModalUi() {
  activeAccountProvider = firstLoggedProvider();
  var st = platformStatus(activeAccountProvider);
  var meta = platformMeta(activeAccountProvider);
  var chip = document.getElementById('account-provider-chip');
  var avatar = document.getElementById('user-modal-avatar');
  var name = document.getElementById('user-modal-name');
  var vipEl = document.getElementById('user-modal-vip');
  var hint = document.getElementById('account-hint');
  var logoutBtn = document.getElementById('account-logout-btn');
  var addNetease = document.getElementById('account-add-netease');
  var addQQ = document.getElementById('account-add-qq');
  var addKugou = document.getElementById('account-add-kugou');
  if (chip) {
    chip.className = 'account-provider-chip ' + activeAccountProvider;
    chip.innerHTML = '<span class="account-source-dot ' + meta.dot + '"></span><span>' + meta.label + '</span>';
  }
  if (avatar) avatar.src = providerAvatarSrc(activeAccountProvider, st);
  if (name) name.textContent = (st && st.nickname) || meta.label;
  if (vipEl) {
    if (activeAccountProvider === 'netease') {
      var neVipLevel = providerVipLevel('netease', st);
      var vipLabel = neVipLevel === 'svip' ? '网易云 SVIP' : (neVipLevel === 'vip' ? '网易云 VIP' : '普通用户');
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + vipLabel;
      vipEl.style.color = hasProviderVip('netease', st) ? 'rgba(244,210,138,0.86)' : 'rgba(255,255,255,0.5)';
    } else if (activeAccountProvider === 'kugou') {
      var kgVipLevel = providerVipLevel('kugou', st);
      var kgVipLabel = kgVipLevel === 'svip' ? '酷狗 SVIP 会员' : (kgVipLevel === 'vip' ? '酷狗 VIP 会员' : '酷狗音乐会话');
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + kgVipLabel;
      vipEl.style.color = hasProviderVip('kugou', st) ? 'rgba(68,199,255,0.86)' : 'rgba(68,199,255,0.58)';
    } else if (activeAccountProvider === 'qishui') {
      var qsVipLevel = providerVipLevel('qishui', st);
      var qsVipLabel = qsVipLevel === 'svip' ? '汽水 SVIP' : (qsVipLevel === 'vip' ? '汽水 VIP' : '汽水本机会话');
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + qsVipLabel;
      vipEl.style.color = hasProviderVip('qishui', st) ? 'rgba(255,120,160,0.86)' : 'rgba(255,120,160,0.58)';
    } else if (activeAccountProvider === 'spotify') {
      var spLabel = (st && st.product === 'premium') || providerVipLevel('spotify', st) === 'svip'
        ? 'Spotify Premium'
        : ((st && st.product) ? ('Spotify ' + st.product) : 'Spotify 免费');
      vipEl.textContent = 'ID: ' + ((st && st.userId) || '-') + '  ·  ' + spLabel;
      vipEl.style.color = hasProviderVip('spotify', st) ? 'rgba(30,215,96,0.9)' : 'rgba(30,215,96,0.55)';
    } else {
      var qqVipLevel = providerVipLevel('qq', st);
      var qqPending = (typeof qqMembershipNeedsSync === 'function' && qqMembershipNeedsSync(st)) ||
        (st && (st.membershipKnown === false || st.membershipStale || (st.profileUnavailable && qqVipLevel === 'none')));
      var qqVipLabel = qqPending
        ? 'QQ 会员待同步'
        : (qqVipLevel === 'svip' ? 'QQ SVIP 会员' : (qqVipLevel === 'vip' ? 'QQ VIP 会员' : 'QQ 音乐会话'));
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + qqVipLabel;
      vipEl.style.color = hasProviderVip('qq', st) ? 'rgba(0,245,212,0.82)' : 'rgba(0,245,212,0.58)';
    }
  }
  ['netease','qq','kugou','both'].forEach(function(key){
    var btn = document.getElementById('user-provider-' + key);
    if (btn) btn.classList.toggle('active', key === 'both' ? dualAccountMode : (!dualAccountMode && activeAccountProvider === key));
  });
  if (addNetease) addNetease.style.display = hasPlatformLogin('netease') ? 'none' : '';
  if (addQQ) addQQ.textContent = hasPlatformLogin('qq') ? 'QQ Music' : 'Add QQ Music';
  if (addKugou) addKugou.textContent = hasPlatformLogin('kugou') ? 'Kugou' : 'Add Kugou';
  if (logoutBtn) logoutBtn.textContent = activeAccountProvider === 'qq' ? 'Logout QQ Music' : (activeAccountProvider === 'kugou' ? 'Logout Kugou' : 'Logout Netease');
  if (hint) hint.textContent = dualAccountMode
    ? 'Showing all logged-in platforms.'
    : 'Switch account provider here, or show all logged-in platforms.';
}
function showUserModal() {
  if (!hasAnyPlatformLogin()) return showLoginModal();
  updateUserModalUi();
  openGsapModal(document.getElementById('user-modal'));
  if (typeof refreshQQVipStatusNow === 'function' && hasPlatformLogin('qq')) {
    refreshQQVipStatusNow('account-modal').then(function () {
      updateUserModalUi();
      if (typeof renderUserBtn === 'function') renderUserBtn();
    }).catch(function (e) {
      console.warn('QQ VIP account-modal refresh failed:', e);
    });
  }
}
function closeUserModal() { closeGsapModal(document.getElementById('user-modal')); }
async function exportActiveLoginSessionPack() {
  var api = window.desktopWindow;
  if (!api || typeof api.exportLoginSessionPack !== 'function') {
    showToast('请在桌面版中导出登录包');
    return;
  }
  var password = window.prompt('设置导出口令（换机导入时需要）');
  if (password == null) return;
  if (!String(password).trim()) { showToast('口令不能为空'); return; }
  var confirmPassword = window.prompt('再输入一次口令确认');
  if (confirmPassword == null) return;
  if (String(password) !== String(confirmPassword)) { showToast('两次口令不一致'); return; }
  try {
    var result = await api.exportLoginSessionPack({
      password: String(password),
      providers: ['netease', 'qq', 'kugou', 'qishui', 'spotify']
    });
    if (result && result.cancelled) return;
    if (!(result && result.ok)) {
      showToast((result && (result.message || result.error)) || '导出失败');
      return;
    }
    showToast('已导出登录包 · ' + (result.providers || []).join('/') );
  } catch (e) {
    showToast('导出失败');
  }
}
async function importLoginSessionPack() {
  var api = window.desktopWindow;
  if (!api || typeof api.importLoginSessionPack !== 'function') {
    showToast('请在桌面版中导入登录包');
    return;
  }
  var password = window.prompt('输入登录包口令');
  if (password == null) return;
  if (!String(password).trim()) { showToast('口令不能为空'); return; }
  try {
    var result = await api.importLoginSessionPack({ password: String(password) });
    if (result && result.cancelled) return;
    if (!(result && result.ok)) {
      showToast((result && (result.message || result.error)) || '导入失败');
      return;
    }
    showToast('已导入 ' + (result.providers || []).join('/') + ' · 正在刷新登录态');
    try { if (typeof refreshLoginStatus === 'function') await refreshLoginStatus(true); } catch (_) {}
    try { if (typeof refreshQQLoginStatus === 'function') await refreshQQLoginStatus(); } catch (_) {}
    try { if (typeof refreshKugouLoginStatus === 'function') await refreshKugouLoginStatus(); } catch (_) {}
    try { if (typeof refreshQishuiLoginStatus === 'function') await refreshQishuiLoginStatus(); } catch (_) {}
    try { if (typeof refreshSpotifyLoginStatus === 'function') await refreshSpotifyLoginStatus(); } catch (_) {}
    if (typeof refreshUserPlaylists === 'function') refreshUserPlaylists(true);
    updateUserModalUi();
  } catch (e) {
    showToast('导入失败');
  }
}
function setActiveAccountProvider(provider) {
  provider = provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'qishui' ? 'qishui' : (provider === 'spotify' ? 'spotify' : 'netease')));
  if (!hasPlatformLogin(provider)) {
    openProviderLogin(provider);
    return;
  }
  activeAccountProvider = provider;
  dualAccountMode = false;
  renderUserBtn();
  updateUserModalUi();
}
function enableDualAccountView() {
  var logged = [hasPlatformLogin('netease'), hasPlatformLogin('qq'), hasPlatformLogin('kugou'), hasPlatformLogin('qishui'), hasPlatformLogin('spotify')].filter(Boolean);
  if (logged.length < 2) {
    if (!hasPlatformLogin('netease')) { openProviderLogin('netease'); return; }
    if (!hasPlatformLogin('qq')) { openProviderLogin('qq'); return; }
    if (!hasPlatformLogin('kugou')) { openProviderLogin('kugou'); return; }
    if (!hasPlatformLogin('qishui')) { openProviderLogin('qishui'); return; }
    if (!hasPlatformLogin('spotify')) { openProviderLogin('spotify'); return; }
    openProviderLogin('netease');
    return;
  }
  dualAccountMode = true;
  renderUserBtn();
  updateUserModalUi();
  showToast('已启用双平台账号展示');
}
function requestDualLoginMode() {
  enableDualAccountView();
}
function openProviderLogin(provider) {
  provider = provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'qishui' ? 'qishui' : (provider === 'spotify' ? 'spotify' : 'netease')));
  closeUserModal();
  loginProvider = provider;
  showLoginModal({ provider: provider });
}
async function logoutActiveAccount() {
  if (activeAccountProvider === 'spotify') {
    try { await apiJson('/api/spotify/logout'); } catch (e) {}
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearSpotifyMusicLogin === 'function') {
        await window.desktopWindow.clearSpotifyMusicLogin();
      }
    } catch (e) {}
    spotifyLoginStatus = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', avatar: '', product: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false };
    spotifyPlaylists = [];
    userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'spotify'; });
    playlistCatalogRevision += 1;
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    safeShelfRebuild('spotify-logout');
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出 Spotify');
    return;
  }
  if (activeAccountProvider === 'qishui') {
    await logoutQishuiAccount();
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    safeShelfRebuild('qishui-logout');
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    return;
  }
  if (activeAccountProvider === 'kugou') {
    try { await apiJson('/api/kugou/logout'); } catch (e) {}
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearKugouMusicLogin === 'function') {
        await window.desktopWindow.clearKugouMusicLogin();
      }
    } catch (e) {}
    kugouLoginStatus = { provider: 'kugou', loggedIn: false, preview: true, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0 };
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出酷狗音乐');
    return;
  }
  if (activeAccountProvider === 'qq') {
    try { await apiJson('/api/qq/logout'); } catch (e) {}
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearQQMusicLogin === 'function') {
        await window.desktopWindow.clearQQMusicLogin();
      }
    } catch (e) {}
    qqLoginStatus = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0 };
    qqPlaylists = [];
    userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qq'; });
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    showToast('已退出 QQ 音乐');
    return;
  }
  doLogout();
}
async function doLogout() {
  await apiJson('/api/logout');
  try {
    if (window.desktopWindow && typeof window.desktopWindow.clearNeteaseMusicLogin === 'function') {
      await window.desktopWindow.clearNeteaseMusicLogin();
    }
  } catch (e) {}
  loginStatus = { loggedIn: false };
  if (!hasPlatformLogin('netease') || !hasPlatformLogin('qq') || !hasPlatformLogin('kugou') || !hasPlatformLogin('spotify')) dualAccountMode = false;
  activeAccountProvider = firstLoggedProvider();
  userPlaylists = qqPlaylists.concat(kugouPlaylists).concat(qishuiPlaylists).concat(spotifyPlaylists);
  myPodcastCollections = [];
  myPodcastItems = {};
  likedSongMap = {};
  closeCollectModal();
  updateLikeButtons();
  safeRenderQueuePanel('logout', { scrollCurrent: miniQueueOpen });
  renderUserBtn();
  safeShelfRebuild('logout');
  closeUserModal();
  showToast('已退出登录');
}
var startupLoginGuideShown = false;
var loginGuideAnimating = false;
var loginGuideRaf = null;
function runLoginGuideParticles(done) {
  var canvas = document.getElementById('login-guide-canvas');
  if (!canvas || reduceSplashMotion) {
    if (done) setTimeout(done, 120);
    return;
  }
  if (loginGuideAnimating) {
    if (done) setTimeout(done, 720);
    return;
  }
  loginGuideAnimating = true;
  document.body.classList.add('login-guide-active');
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 1.8);
  var w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var cx = w * 0.5;
  var cy = h * 0.5 - 10;
  var maxR = Math.max(w, h);
  var particles = [];
  for (var i = 0; i < 92; i++) {
    var ang = Math.random() * Math.PI * 2;
    var ring = maxR * (0.30 + Math.random() * 0.35);
    var arcBias = Math.random() < 0.42 ? Math.PI * 0.5 : 0;
    particles.push({
      sx: cx + Math.cos(ang + arcBias) * ring + (Math.random() - 0.5) * 80,
      sy: cy + Math.sin(ang) * ring * 0.72 + (Math.random() - 0.5) * 80,
      tx: cx + (Math.random() - 0.5) * 172,
      ty: cy + (Math.random() - 0.5) * 172,
      r: 0.8 + Math.random() * 1.9,
      delay: Math.random() * 0.22,
      hue: Math.random(),
      spin: Math.random() * Math.PI * 2
    });
  }
  var started = performance.now();
  var duration = 1050;
  if (loginGuideRaf) cancelAnimationFrame(loginGuideRaf);
  function draw(now) {
    var raw = Math.min(1, (now - started) / duration);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    var centerPulse = Math.sin(Math.PI * raw);
    var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.28);
    halo.addColorStop(0, 'rgba(255,255,255,' + (0.060 * centerPulse) + ')');
    halo.addColorStop(0.55, 'rgba(255,255,255,' + (0.026 * centerPulse) + ')');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      var lt = Math.max(0, Math.min(1, (raw - p.delay) / (1 - p.delay)));
      var e = 1 - Math.pow(1 - lt, 3);
      var wobble = Math.sin(lt * Math.PI * 2 + p.spin) * (1 - lt) * 18;
      var x = p.sx + (p.tx - p.sx) * e + Math.cos(p.spin) * wobble;
      var y = p.sy + (p.ty - p.sy) * e + Math.sin(p.spin) * wobble * 0.6;
      var alpha = Math.sin(Math.PI * lt) * (0.18 + p.hue * 0.18);
      if (alpha <= 0) continue;
      var warm = false;
      ctx.beginPath();
      ctx.arc(x, y, p.r * (0.75 + lt * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fill();
      if (lt > 0.08 && lt < 0.92) {
        var tx = p.sx + (p.tx - p.sx) * Math.max(0, e - 0.045);
        var ty = p.sy + (p.ty - p.sy) * Math.max(0, e - 0.045);
        ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.20) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    if (raw < 1) {
      loginGuideRaf = requestAnimationFrame(draw);
    } else {
      function finish() {
        ctx.clearRect(0, 0, w, h);
        document.body.classList.remove('login-guide-active');
        loginGuideAnimating = false;
        loginGuideRaf = null;
        if (done) done();
      }
      if (window.gsap) {
        window.gsap.to(canvas, { opacity: 0, duration: 0.28, ease: 'power2.out', onComplete: function(){
          finish();
          window.gsap.set(canvas, { clearProps: 'opacity' });
        }});
      } else {
        finish();
      }
    }
  }
  loginGuideRaf = requestAnimationFrame(draw);
}
function maybeRunStartupLoginGuide(source) {
  if (startupLoginGuideShown || loginGuideAnimating) return;
  if (visualGuideActive) return;
  if (document.body.classList.contains('splash-active')) return;
  if (immersiveMode) return;
  if (playing) return;
  if (hasAnyPlatformLogin()) return;
  if (!loginStatusChecked) return;
  var loginModal = document.getElementById('login-modal');
  var userModal = document.getElementById('user-modal');
  if ((loginModal && loginModal.classList.contains('show')) || (userModal && userModal.classList.contains('show'))) return;
  startupLoginGuideShown = true;
  setTimeout(function(){
    if (hasAnyPlatformLogin() || playing || immersiveMode || document.body.classList.contains('splash-active')) return;
    runLoginGuideParticles(function(){ showLoginModal({ guided: true, source: source || 'startup' }); });
  }, source === 'splash' ? 6200 : 2600);
}
function scheduleStartupLoginGuide(source, guideStarted) {
  if (guideStarted) return;
  var run = function() {
    if (!hasAnyPlatformLogin()) maybeRunStartupLoginGuide(source || 'startup');
  };
  if (startupLoginStatusPromise && startupLoginStatusPromise.then) startupLoginStatusPromise.then(run).catch(run);
  else run();
}
