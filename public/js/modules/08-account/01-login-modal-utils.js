// ============================================================
//  登录系统
// ============================================================
function openGsapModal(mask) {
  if (!mask) return;
  var panel = mask.querySelector('.modal');
  mask.classList.add('show');
  var M = window.MineradioMotion;
  if (window.gsap) {
    window.gsap.killTweensOf(mask);
    if (panel) window.gsap.killTweensOf(panel);
    window.gsap.set(mask, { display: 'flex', visibility: 'visible' });
    window.gsap.fromTo(mask,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.38, ease: 'power2.out', overwrite: true }
    );
  } else {
    mask.style.display = 'flex';
    mask.style.visibility = 'visible';
    mask.style.opacity = '1';
  }
  if (panel) {
    // 进场用真 spring（Apple：元素进场用物理弹簧），scale/y/opacity 交弹簧托管；
    // .modal 无 CSS transition，不互踩。blur 是滤镜，保留 GSAP。
    if (M) {
      M.killAll(panel);
      M.springTo(panel, 'scale', 1, { from: 0.965, preset: M.SPRING.standard });
      M.springTo(panel, 'y', 0, { from: 26, preset: M.SPRING.standard });
      M.springTo(panel, 'opacity', 1, { from: 0, preset: M.SPRING.snappy });
    } else if (window.gsap) {
      window.gsap.fromTo(panel,
        { autoAlpha: 0, y: 26, scale: 0.965 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.68, ease: 'expo.out', overwrite: true }
      );
    }
    if (window.gsap) {
      window.gsap.fromTo(panel,
        { filter: 'blur(12px)' },
        { filter: 'blur(0px)', duration: 0.5, ease: 'power2.out', overwrite: false }
      );
    }
  }
}
function closeGsapModal(mask, afterClose) {
  if (!mask || !mask.classList.contains('show')) {
    if (afterClose) afterClose();
    return;
  }
  var panel = mask.querySelector('.modal');
  function finish() {
    mask.classList.remove('show');
    if (window.gsap) {
      window.gsap.set(mask, { clearProps: 'display,visibility,opacity' });
      if (panel) window.gsap.set(panel, { clearProps: 'opacity,visibility,transform,filter' });
    } else {
      mask.style.display = '';
      mask.style.visibility = '';
      mask.style.opacity = '';
    }
    if (afterClose) afterClose();
  }
  if (window.gsap) {
    window.gsap.killTweensOf(mask);
    if (panel) {
      window.gsap.killTweensOf(panel);
      // 离场用 easeIn（Apple：元素离场用缓动）。先停 spring 但保留当前内联值，
      // 让 GSAP 从当前位移接管，避免 mid-open 关闭时跳变。
      if (window.MineradioMotion) window.MineradioMotion.killAll(panel, { release: false });
      window.gsap.to(panel, { autoAlpha: 0, y: 18, scale: 0.976, filter: 'blur(8px)', duration: 0.28, ease: 'power2.in', overwrite: true });
    }
    window.gsap.to(mask, { autoAlpha: 0, duration: 0.34, ease: 'power2.inOut', overwrite: true, onComplete: finish });
  } else {
    finish();
  }
}
function bindModalBackdropClose() {
  [
    ['track-detail-modal', closeTrackDetailModal],
    ['login-modal', closeLoginModal],
    ['user-modal', closeUserModal],
    ['custom-lyric-modal', closeCustomLyricModal],
    ['update-modal', closeUpdatePanel]
  ].forEach(function(pair){
    var mask = document.getElementById(pair[0]);
    var close = pair[1];
    if (!mask || mask.__backdropCloseBound) return;
    mask.__backdropCloseBound = true;
    mask.addEventListener('click', function(e){
      if (e.target === mask) close();
    });
  });
}
function onUserBtnClick() {
  if (hasAnyPlatformLogin()) showUserModal();
  else showLoginModal();
}
function platformMeta(provider) {
  if (provider === 'qq') return { key: 'qq', short: 'QQ', label: 'QQ 音乐', app: 'QQ 音乐 App', dot: 'qq' };
  if (provider === 'kugou') return { key: 'kugou', short: 'KG', label: '酷狗音乐', app: '酷狗音乐 App', dot: 'kugou' };
  if (provider === 'qishui') return { key: 'qishui', short: 'QS', label: '汽水音乐', app: '汽水音乐 PC', dot: 'qishui' };
  if (provider === 'spotify') return { key: 'spotify', short: 'SP', label: 'Spotify', app: 'Spotify App', dot: 'spotify' };
  return { key: 'netease', short: 'NE', label: '网易云音乐', app: '网易云音乐 App', dot: 'netease' };
}
function platformStatus(provider) {
  if (provider === 'qq') return qqLoginStatus;
  if (provider === 'kugou') return kugouLoginStatus;
  if (provider === 'qishui') return qishuiLoginStatus;
  if (provider === 'spotify') return spotifyLoginStatus;
  return loginStatus;
}
function providerVipType(provider, status) {
  status = status || platformStatus(provider) || {};
  return Number(status.vipType || status.vip_type || status.vip || status.isVip || status.is_vip || 0) || 0;
}
function providerVipLevel(provider, status) {
  status = status || platformStatus(provider) || {};
  var raw = String(status.vipLevel || status.vip_level || status.product || '').toLowerCase();
  if (raw === 'svip' || raw === 'premium') return 'svip';
  if (raw === 'vip') return 'vip';
  if (raw === 'none' || raw === 'free') return 'none';
  if (status.isSvip || status.is_svip) return 'svip';
  var vip = providerVipType(provider, status);
  if (provider === 'netease' || provider === 'qq' || provider === 'kugou' || provider === 'qishui') {
    if (vip >= 10) return 'svip';
    if (status.isVip || status.is_vip || vip > 0) return 'vip';
    return 'none';
  }
  if (provider === 'spotify') {
    return (status.product === 'premium' || status.isVip) ? 'svip' : 'none';
  }
  return vip > 0 ? 'vip' : 'none';
}
function hasProviderVip(provider, status) {
  return providerVipLevel(provider, status) !== 'none';
}
function hasProviderSvip(provider, status) {
  return providerVipLevel(provider, status) === 'svip';
}
function providerVipBadge(provider, status, idAttr) {
  status = status || platformStatus(provider) || {};
  if (!(status && status.loggedIn)) return '';
  var id = idAttr ? ' id="' + idAttr + '"' : '';
  var level = providerVipLevel(provider, status);
  var cls = 'top-account-vip ' + level + (provider === 'qq' ? ' qq' : (provider === 'kugou' ? ' kugou' : (provider === 'qishui' ? ' qishui' : (provider === 'spotify' ? ' spotify' : ''))));
  var label = level === 'svip'
    ? (provider === 'spotify' ? 'PREMIUM' : 'SVIP')
    : (level === 'vip' ? 'VIP' : '普通');
  if (provider === 'qq' && level === 'none' && status.profileUnavailable) label = '待同步';
  return '<span' + id + ' class="' + cls + '">' + label + '</span>';
}
function hasPlatformLogin(provider) {
  var st = platformStatus(provider);
  return !!(st && st.loggedIn);
}
function hasAnyPlatformLogin() {
  return hasPlatformLogin('netease') || hasPlatformLogin('qq') || hasPlatformLogin('kugou') || hasPlatformLogin('qishui') || hasPlatformLogin('spotify');
}
function firstLoggedProvider() {
  if (hasPlatformLogin(activeAccountProvider)) return activeAccountProvider;
  if (hasPlatformLogin('netease')) return 'netease';
  if (hasPlatformLogin('qq')) return 'qq';
  if (hasPlatformLogin('kugou')) return 'kugou';
  if (hasPlatformLogin('qishui')) return 'qishui';
  if (hasPlatformLogin('spotify')) return 'spotify';
  return 'netease';
}
function providerAvatarSrc(provider, status) {
  status = status || platformStatus(provider) || {};
  if (status.avatar) return avatarSrc(status.avatar);
  var meta = platformMeta(provider);
  var fill = provider === 'qq' ? '#bfd66b' : (provider === 'kugou' ? '#44c7ff' : (provider === 'qishui' ? '#ff7a45' : (provider === 'spotify' ? '#1ed760' : '#d95b67')));
  var bg = provider === 'qq' ? '#11150b' : (provider === 'kugou' ? '#071520' : (provider === 'qishui' ? '#1a0d08' : (provider === 'spotify' ? '#06140a' : '#180b0f')));
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="' + bg + '"/><circle cx="48" cy="48" r="34" fill="' + fill + '" opacity=".16"/><text x="48" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="' + fill + '">' + meta.short + '</text></svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}
function renderTopAccountPill(provider) {
  var st = platformStatus(provider);
  if (!st || !st.loggedIn) return '';
  var meta = platformMeta(provider);
  var displayName = (provider === 'qq' && st.preview) ? '待接入' : (st.nickname || meta.label);
  var vipTag = providerVipBadge(provider, st);
  return '<span class="top-account-pill">' +
    imgTagFromSrc(providerAvatarSrc(provider, st)) +
    '<span class="top-account-name">' + escHtml(displayName) + '</span>' +
    vipTag +
  '</span>';
}
async function refreshLoginStatus(force) {
  try {
    var info = await Mineradio.auth.syncNetease(apiJson);
    loginStatus = info || { loggedIn: false };
    if (loginStatus.loggedIn && !hasPlatformLogin(activeAccountProvider)) activeAccountProvider = 'netease';
    else if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (info && info.loggedIn) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
      syncLikeStatusForSongs(playQueue.concat(playlist || []));
      maybeRestorePlaybackSessionAfterLogin();
    } else {
      userPlaylists = qqPlaylists.concat(kugouPlaylists).concat(qishuiPlaylists).concat(spotifyPlaylists);
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
  return Mineradio.auth.normalizeQQ(info);
}
async function refreshQQLoginStatus() {
  try {
    var prevLogged = !!qqLoginStatus.loggedIn;
    qqLoginStatus = await Mineradio.auth.syncQQ(apiJson);
    if (!qqLoginStatus.loggedIn) {
      if (prevLogged || qqLoginWasLoggedIn) showToast(qqLoginStatus.stale ? 'QQ 音乐登录已失效' : 'QQ 音乐已掉登录');
      qqPlaylists = [];
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qq'; });
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function(pl){ return pl && pl.provider === 'qq'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      loadHomeDiscover(true);
      refreshUserPlaylists(true);
    } else if (qqLoginStatus.stale) {
      showToast('QQ 音乐登录状态可能已失效');
    }
    qqLoginWasLoggedIn = !!qqLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return qqLoginStatus;
  } catch (e) {
    console.warn('QQ login status failed:', e);
    qqLoginStatus = normalizeQQLoginStatus(null);
    renderUserBtn();
    return qqLoginStatus;
  }
}
function startQQLoginStatusAutoRefresh() {
  if (qqLoginAutoRefreshTimer) clearInterval(qqLoginAutoRefreshTimer);
  qqLoginAutoRefreshTimer = setInterval(function(){
    refreshQQLoginStatus().catch(function(e){ console.warn('QQ login auto refresh failed:', e); });
  }, 45000);
}
function normalizeKugouLoginStatus(info) {
  return Mineradio.auth.normalizeKugou(info);
}
async function refreshKugouLoginStatus(retry) {
  try {
    var prevLogged = !!kugouLoginStatus.loggedIn;
    kugouLoginStatus = await Mineradio.auth.syncKugou(apiJson);
    if (!kugouLoginStatus.loggedIn && (prevLogged || kugouLoginWasLoggedIn)) {
      kugouPlaylists = [];
      showToast('酷狗登录已失效');
    }
    if (kugouLoginStatus.loggedIn) {
      homeDiscoverState.loggedIn = true;
      if (!prevLogged || !userPlaylists.some(function(pl){ return pl && pl.provider === 'kugou'; })) {
        homeDiscoverState.loaded = false;
        loadHomeDiscover(true);
        refreshUserPlaylists(true);
      }
    }
    kugouLoginWasLoggedIn = !!kugouLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return kugouLoginStatus;
  } catch (e) {
    if (!retry) return refreshKugouLoginStatus(true);
    console.warn('Kugou login status failed:', e);
    if (!kugouLoginWasLoggedIn) kugouLoginStatus = normalizeKugouLoginStatus(null);
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return kugouLoginStatus;
  }
}
function renderUserBtn() {
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  btn.classList.remove('multi-account');
  if (dualAccountMode && hasAnyPlatformLogin()) {
    activeAccountProvider = firstLoggedProvider();
    btn.classList.add('logged-in', 'multi-account');
    btn.classList.remove('logged-out');
    btn.title = '账号信息 · 双平台登录状态';
    btn.innerHTML = renderTopAccountPill('netease') + renderTopAccountPill('qq') + renderTopAccountPill('kugou') + renderTopAccountPill('qishui') + renderTopAccountPill('spotify');
  } else if (hasAnyPlatformLogin()) {
    activeAccountProvider = firstLoggedProvider();
    var st = platformStatus(activeAccountProvider);
    var meta = platformMeta(activeAccountProvider);
    btn.classList.add('logged-in');
    btn.classList.remove('logged-out');
    btn.title = dualAccountMode ? '账号信息 · 已启用双平台展示' : ((st.nickname || meta.label) + ' · 账号信息');
    btn.innerHTML = imgTagFromSrc(providerAvatarSrc(activeAccountProvider, st), 'id="user-avatar"') +
                    '<span>' + escHtml(st.nickname || meta.label) + '</span>' +
                    providerVipBadge(activeAccountProvider, st, 'user-vip-tag');
  } else {
    btn.classList.remove('logged-in');
    btn.classList.add('logged-out');
    btn.title = '登录账号';
    btn.innerHTML = '<span class="login-word">登录</span>';
  }
  updatePlaybackQualityUi();
}
async function showLoginModal(opts) {
  opts = opts || {};
  if (opts.provider) loginProvider = (opts.provider === 'qq' || opts.provider === 'kugou' || opts.provider === 'qishui' || opts.provider === 'spotify') ? opts.provider : 'netease';
  var modal = document.getElementById('login-modal');
  openGsapModal(modal);
  var drawer = document.getElementById('login-auth-drawer');
  if (drawer) drawer.classList.add('show');
  updateLoginProviderUi();
  await refreshQr();
}
function closeLoginModal() {
  stopQrPoll();
  closeGsapModal(document.getElementById('login-modal'));
}
function setLoginProvider(provider, silent) {
  loginProvider = (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') ? provider : 'netease';
  updateLoginProviderUi();
  if (!silent && document.getElementById('login-modal').classList.contains('show')) refreshQr();
}
function loginProviderBusy(provider) {
  if (provider === 'qq') return !!qqWebLoginBusy;
  if (provider === 'kugou') return !!kugouWebLoginBusy;
  if (provider === 'qishui') return !!(qishuiOAuthBusy || qishuiTokenBusy);
  if (provider === 'spotify') return !!(spotifyConfigBusy || spotifyOAuthBusy);
  return !!neteaseWebLoginBusy;
}
function loginProviderVipText(provider, st) {
  if (!st || !st.loggedIn) return '';
  if (provider === 'kugou') {
    var kg = providerVipLevel('kugou', st);
    return kg === 'svip' ? '酷狗 SVIP 会员' : (kg === 'vip' ? '酷狗 VIP 会员' : '酷狗音乐会话');
  }
  if (provider === 'qq') {
    if (st.profileUnavailable && !hasProviderVip('qq', st)) return 'QQ 会员待同步';
    var qq = providerVipLevel('qq', st);
    return qq === 'svip' ? 'QQ SVIP 会员' : (qq === 'vip' ? 'QQ VIP 会员' : 'QQ 音乐会话');
  }
  if (provider === 'qishui') {
    var qs = providerVipLevel('qishui', st);
    return qs === 'svip' ? '汽水 SVIP' : (qs === 'vip' ? '汽水 VIP' : (st.webSession ? '汽水本机会话' : '汽水会话'));
  }
  if (provider === 'spotify') {
    return st.product === 'premium' || providerVipLevel('spotify', st) === 'svip'
      ? 'Spotify Premium'
      : (st.product ? ('Spotify ' + String(st.product)) : 'Spotify 免费');
  }
  var level = providerVipLevel('netease', st);
  return level === 'svip' ? '网易云 SVIP' : (level === 'vip' ? '网易云 VIP' : '网易云普通用户');
}
function renderLoginAccountCard(provider) {
  var st = platformStatus(provider);
  var card = document.getElementById('login-account-card');
  var avatar = document.getElementById('login-account-avatar');
  var name = document.getElementById('login-account-name');
  var metaEl = document.getElementById('login-account-meta');
  if (!card) return !!(st && st.loggedIn);
  var loggedIn = !!(st && st.loggedIn);
  card.className = 'login-account-card' + (loggedIn ? ' show ' + provider : '');
  if (loggedIn) {
    var meta = platformMeta(provider);
    if (avatar) avatar.src = providerAvatarSrc(provider, st);
    if (name) name.textContent = st.nickname || meta.label;
    if (metaEl) metaEl.textContent = 'UID: ' + (st.userId || '-') + ' · ' + loginProviderVipText(provider, st);
  }
  return loggedIn;
}
