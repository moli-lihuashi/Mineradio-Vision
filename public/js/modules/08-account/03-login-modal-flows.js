/* ===== Spotify Login ===== */
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
function spotifyLoginStatusText(info) {
  info = info || spotifyLoginStatus || {};
  if (info.loggedIn) return 'Spotify 已连接 / ' + (info.product === 'premium' ? 'Premium' : (info.product ? String(info.product).toUpperCase() : '方案未知')) + ' / 可同步歌单和 Liked Songs';
  if (info.reauthRequired) return 'Spotify 长期授权已到期，请重新连接官方 OAuth';
  if (info.stale) return 'Spotify 登录已过期，请重新连接官方 OAuth';
  if (info.localConfigMissing) return 'Spotify 未连接：粘贴 Spotify Client ID 后点击"保存并授权"';
  if (info.oauthConfigured) return 'Spotify Client ID 已保存，点击"连接 Spotify"打开官方授权窗口';
  if (info.configured || info.searchReady) return 'Spotify 搜索已可用；登录后可同步会员状态、歌单和红心歌单';
  var missing = info.oauthMissing && info.oauthMissing.length ? (' 缺少: ' + info.oauthMissing.join(', ')) : '';
  return '粘贴 Spotify Client ID，并在 Spotify Developer Dashboard 登记回调地址 ' + SPOTIFY_REDIRECT_URI + missing;
}
function parseSpotifyConfigInput(text) {
  text = String(text || '').trim();
  if (!text) return {};
  var parsed = null;
  if (/^\s*\{/.test(text)) {
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  }
  if (parsed && typeof parsed === 'object') {
    var source = parsed.spotify && typeof parsed.spotify === 'object' ? parsed.spotify : parsed;
    return {
      clientId: source.clientId || source.client_id || source.id || '',
      redirectUri: source.redirectUri || source.redirect_uri || source.callbackUrl || source.callback_url || '',
      market: source.market || source.country || '',
      scope: source.scope || source.scopes || ''
    };
  }
  var payload = {};
  var loose = [];
  text.split(/[\r\n;]+/).forEach(function (part) {
    part = String(part || '').trim();
    if (!part) return;
    var pair = part.match(/^([A-Za-z0-9_\\-\\s]+)\\s*[:=]\\s*(.+)$/);
    if (!pair) {
      loose.push(part);
      return;
    }
    var key = pair[1].toLowerCase().replace(/[\s_-]+/g, '');
    var value = pair[2].trim();
    if (key === 'clientid' || key === 'spotifyclientid' || key === 'id') payload.clientId = value;
    else if (key === 'redirecturi' || key === 'callbackurl' || key === 'callback') payload.redirectUri = value;
    else if (key === 'market' || key === 'country') payload.market = value;
    else if (key === 'scope' || key === 'scopes') payload.scope = value;
  });
  if (!payload.clientId && loose.length) payload.clientId = loose[0];
  return payload;
}
function openSpotifyDeveloperDashboard() {
  try { window.open(SPOTIFY_DEVELOPER_DASHBOARD_URL, '_blank'); } catch (e) { }
  showToast('已打开 Spotify 开发者网页');
}
async function copySpotifyRedirectUri() {
  var ok = false;
  try {
    var api = window.desktopWindow;
    if (api && typeof api.copyText === 'function') {
      var res = await Promise.resolve(api.copyText(SPOTIFY_REDIRECT_URI));
      ok = !res || res.ok !== false;
    }
  } catch (e) { ok = false; }
  if (!ok && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI);
      ok = true;
    } catch (e) { ok = false; }
  }
  if (!ok) {
    var helper = document.createElement('textarea');
    helper.value = SPOTIFY_REDIRECT_URI;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    document.body.appendChild(helper);
    helper.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(helper);
  }
  showToast(ok ? '已复制 Spotify 回调地址' : '复制失败，请手动复制回调地址');
}
async function openSpotifyWebLogin() {
  if (spotifyOAuthBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openSpotifyMusicLogin !== 'function') {
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持 Spotify 本地授权桥，请使用 Mineradio 桌面版。'; statusEl.className = 'fail'; }
    return;
  }
  if (!spotifyLoginStatus.oauthConfigured && !spotifyLoginStatus.tokenConfigured) {
    var latestStatus = await refreshSpotifyLoginStatus();
    if (!latestStatus.oauthConfigured && !latestStatus.tokenConfigured) {
      updateLoginProviderUi();
      if (statusEl) { statusEl.textContent = '先粘贴 Spotify Client ID，然后点击"保存并授权"。'; statusEl.className = 'fail'; }
      return;
    }
  }
  spotifyOAuthBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '正在打开 Spotify 官方授权窗口…'; statusEl.className = 'preview'; }
  var failText = '';
  try {
    var result = await api.openSpotifyMusicLogin();
    if (!result || !result.ok) {
      if (result && result.error === 'SPOTIFY_OAUTH_NOT_CONFIGURED') {
        throw new Error((result.message || '请先保存 Spotify Client ID') + (result.redirectUri ? (' / 回调地址: ' + result.redirectUri) : ''));
      }
      throw new Error((result && (result.message || result.error)) || 'Spotify 授权未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步 Spotify 账号、会员状态和歌单…'; statusEl.className = 'preview'; }
    var info = await refreshSpotifyLoginStatus();
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'Spotify 登录态不可用');
    activeAccountProvider = 'spotify';
    renderUserBtn();
    await refreshUserPlaylists(true);
    loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = 'Spotify 已连接'; statusEl.className = 'scan'; }
    setTimeout(function () {
      closeLoginModal();
      showToast('Spotify 已连接: ' + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    failText = e && e.message ? e.message : 'Spotify 授权失败';
    if (statusEl) { statusEl.textContent = failText; statusEl.className = 'fail'; }
  } finally {
    spotifyOAuthBusy = false;
    updateLoginProviderUi();
    if (failText && statusEl) { statusEl.textContent = failText; statusEl.className = 'fail'; }
  }
}
async function submitSpotifyConfigLogin() {
  if (spotifyConfigBusy || spotifyOAuthBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var config = parseSpotifyConfigInput(input ? input.value : '');
  if (!config.clientId && spotifyLoginStatus.oauthConfigured) return openSpotifyWebLogin();
  if (!config.clientId) {
    if (statusEl) { statusEl.textContent = '先粘贴 Spotify Client ID'; statusEl.className = 'fail'; }
    if (input) {
      try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (_) { } }
    }
    return;
  }
  spotifyConfigBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = '正在保存 Spotify Client ID…'; statusEl.className = 'preview'; }
  updateLoginProviderUi();
  var shouldOpenOAuth = false;
  try {
    var info = await apiJson('/api/spotify/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!info || info.error || info.ok === false) throw new Error((info && (info.message || info.error)) || 'Spotify Client ID 保存失败');
    spotifyLoginStatus = normalizeSpotifyLoginStatus(info);
    if (input) input.value = '';
    if (statusEl) { statusEl.textContent = 'Spotify Client ID 已保存，正在打开官方授权…'; statusEl.className = 'preview'; }
    shouldOpenOAuth = true;
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : 'Spotify Client ID 保存失败'; statusEl.className = 'fail'; }
  } finally {
    spotifyConfigBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
    updateLoginProviderUi();
  }
  if (shouldOpenOAuth) await openSpotifyWebLogin();
}
/* ===== 登录页平台布景：背景渐变层 + 中心光晕 + 头部文案（参考稿风格） ===== */
var loginSceneryMeta = {
  netease: { title: '网易云音乐 · 听见好时光', sub: '海量曲库，个性化推荐，与百万乐迷一起发现音乐。', glow: 'radial-gradient(circle,rgba(230,90,105,.12) 0%,transparent 70%)' },
  qq: { title: 'QQ音乐 · 让生活充满音乐', sub: '千万级正版曲库，无损音质，陪你度过每个日常。', glow: 'radial-gradient(circle,rgba(191,214,107,.13) 0%,transparent 70%)' },
  kugou: { title: '酷狗音乐 · 就是歌多', sub: '超全曲库，听歌识曲，直播互动，音乐不止于听。', glow: 'radial-gradient(circle,rgba(68,199,255,.13) 0%,transparent 70%)' },
  qishui: { title: '汽水音乐 · 新鲜好歌', sub: '短视频热歌、新歌首发，让音乐像汽水一样清爽。', glow: 'radial-gradient(circle,rgba(29,185,84,.12) 0%,transparent 70%)' },
  spotify: { title: 'Spotify · 全球音乐流媒体', sub: '数亿曲库，智能推荐，与世界同步聆听。', glow: 'radial-gradient(circle,rgba(29,185,84,.13) 0%,transparent 70%)' }
};
function syncLoginPlatformScenery(provider, withCopy) {
  var meta = loginSceneryMeta[provider] || loginSceneryMeta.netease;
  document.querySelectorAll('#login-modal .login-bg-layer').forEach(function (layer) {
    layer.classList.toggle('active', layer.getAttribute('data-login-bg') === provider);
  });
  var glow = document.getElementById('login-glow');
  if (glow) glow.style.background = meta.glow;
  if (!withCopy) return;
  var title = document.getElementById('login-intro-title');
  var body = document.getElementById('login-intro-body');
  if (!title || !body) return;
  if (title.textContent === meta.title) return;
  // 文案淡出 → 换字 → 淡入（参考稿 80ms 节奏）
  title.style.opacity = '0';
  body.style.opacity = '0';
  title.style.transform = 'translateY(4px)';
  body.style.transform = 'translateY(4px)';
  setTimeout(function () {
    title.textContent = meta.title;
    body.textContent = meta.sub;
    title.style.opacity = '1';
    body.style.opacity = '1';
    title.style.transform = 'translateY(0)';
    body.style.transform = 'translateY(0)';
  }, 80);
  if (!title.style.transition) {
    title.style.transition = 'opacity .4s ease,transform .4s ease';
    body.style.transition = 'opacity .4s ease,transform .4s ease';
  }
}
function updateLoginProviderUi() {
  syncLoginPlatformScenery(loginProvider, false);
  if (typeof syncLoginModeUi === 'function') syncLoginModeUi();
  var meta = platformMeta(loginProvider);
  var isQQ = loginProvider === 'qq';
  var isKugou = loginProvider === 'kugou';
  var isQishui = loginProvider === 'qishui';
  var isSpotify = loginProvider === 'spotify';
  var isLoggedIn = renderLoginAccountCard(loginProvider);
  var modal = document.querySelector('#login-modal .dual-login-modal');
  var title = document.getElementById('login-modal-title');
  var desc = document.getElementById('login-modal-desc');
  var shell = document.getElementById('qr-shell');
  var st = document.getElementById('qr-status');
  var refreshBtn = document.getElementById('refresh-qr-btn');
  var qqPanel = document.getElementById('qq-cookie-panel');
  var qqCookieInput = document.getElementById('qq-cookie-input');
  var qqCookieNote = document.querySelector('.qq-cookie-note');
  var qqCookieToggle = document.getElementById('qq-cookie-toggle-btn');
  var qqCookieSaveBtn = document.getElementById('qq-cookie-save-btn');
  var qqCard = document.getElementById('qq-web-login-card');
  var neteaseBtn = document.getElementById('login-provider-netease');
  var qqBtn = document.getElementById('login-provider-qq');
  var kugouBtn = document.getElementById('login-provider-kugou');
  var qishuiBtn = document.getElementById('login-provider-qishui');
  var spotifyBtn = document.getElementById('login-provider-spotify');
  var canOpenNeteaseWeb = !!(window.desktopWindow && typeof window.desktopWindow.openNeteaseMusicLogin === 'function');
  var canOpenQishuiLocal = !!(window.desktopWindow && typeof window.desktopWindow.openQishuiMusicLogin === 'function');
  var canOpenSpotifyOAuth = !!(window.desktopWindow && typeof window.desktopWindow.openSpotifyMusicLogin === 'function');
  var spotifyBusy = !!(spotifyConfigBusy || spotifyOAuthBusy);
  var qishuiBusy = !!(qishuiOAuthBusy || qishuiTokenBusy);
  if (modal) modal.classList.toggle('login-provider-spotify', isSpotify);
  if (shell && !isSpotify) shell.style.display = '';
  if (qqCookieSaveBtn && !isSpotify) qqCookieSaveBtn.style.display = '';
  if (qqCookieInput && !isSpotify && !isQishui) qqCookieInput.rows = 3;

  /* ===== Qishui Branch ===== */
  if (isQishui) {
    if (neteaseBtn) neteaseBtn.classList.toggle('active', false);
    if (qqBtn) qqBtn.classList.toggle('active', false);
    if (kugouBtn) kugouBtn.classList.toggle('active', false);
    if (qishuiBtn) qishuiBtn.classList.toggle('active', true);
    if (spotifyBtn) spotifyBtn.classList.toggle('active', false);
    if (title) title.textContent = isLoggedIn ? '汽水音乐已登录' : '导入汽水音乐登录态';
    if (desc) desc.innerHTML = canOpenQishuiLocal
      ? '优先<strong>读取本机汽水音乐 PC 客户端</strong>登录态；也可粘贴 OpenAPI access-token 作为匹配源。'
      : '当前环境不支持读取本机汽水会话；请在 Mineradio 桌面版中导入，或粘贴 OpenAPI access-token。';
    if (shell) {
      shell.classList.add('web-login-preview');
      shell.classList.remove('qq-preview', 'netease-preview');
    }
    if (qqPanel) qqPanel.classList.toggle('show', !isLoggedIn && qishuiManualCookieOpen);
    if (qqCookieToggle) {
      qqCookieToggle.classList.toggle('show', !isLoggedIn);
      qqCookieToggle.textContent = qishuiManualCookieOpen ? '收起 Token' : 'Token 导入';
    }
    if (qqCookieInput) qqCookieInput.placeholder = '粘贴汽水 OpenAPI access-token';
    if (qqCookieNote) qqCookieNote.textContent = 'Token 仅作为匹配源；完整歌单直连播放请用本机汽水会话。';
    if (qqCookieSaveBtn) {
      qqCookieSaveBtn.disabled = qishuiBusy;
      qqCookieSaveBtn.textContent = qishuiTokenBusy ? '保存中…' : '保存 Token';
    }
    if (qqCard) {
      qqCard.style.display = !isLoggedIn ? '' : 'none';
      qqCard.disabled = qishuiBusy || !canOpenQishuiLocal;
      var qsMark = qqCard.querySelector('b');
      var qsLabel = qqCard.querySelector('span');
      if (qsMark) qsMark.textContent = 'QS';
      if (qsLabel) qsLabel.textContent = qishuiOAuthBusy ? '正在读取本机汽水…' : '读取本机汽水';
      qqCard.onclick = openQishuiWebLogin;
    }
    if (st) {
      st.style.display = '';
      st.className = 'preview';
      st.textContent = qishuiLoginStatusText();
    }
    if (refreshBtn) {
      refreshBtn.disabled = qishuiBusy || (!canOpenQishuiLocal && !isLoggedIn);
      refreshBtn.textContent = isLoggedIn
        ? '退出汽水'
        : (qishuiOAuthBusy ? '读取中…' : (canOpenQishuiLocal ? '读取本机汽水' : '仅支持 Token'));
      refreshBtn.onclick = isLoggedIn
        ? function () { logoutLoginProvider('qishui'); }
        : (canOpenQishuiLocal ? openQishuiWebLogin : function () { qishuiManualCookieOpen = true; updateLoginProviderUi(); });
    }
    return;
  }

  /* ===== Spotify Branch ===== */
  if (isSpotify) {
    if (neteaseBtn) neteaseBtn.classList.toggle('active', false);
    if (qqBtn) qqBtn.classList.toggle('active', false);
    if (kugouBtn) kugouBtn.classList.toggle('active', false);
    if (qishuiBtn) qishuiBtn.classList.toggle('active', false);
    if (spotifyBtn) spotifyBtn.classList.toggle('active', true);
    if (title) title.textContent = spotifyLoginStatus.oauthConfigured ? '授权 Spotify' : '接入 Spotify';
    if (desc) desc.innerHTML = canOpenSpotifyOAuth
      ? '用 Client ID 完成 OAuth，同步歌单与 Liked Songs；播放仍按匹配源换源。'
      : '当前环境不支持桌面授权，请在 Mineradio 桌面版连接。';
    if (shell) {
      shell.classList.remove('web-login-preview', 'qq-preview', 'netease-preview');
      shell.style.display = 'none';
    }
    if (qqPanel) {
      qqPanel.classList.add('show', 'spotify-guide-panel');
      qqPanel.style.display = '';
    }
    if (qqCookieToggle) qqCookieToggle.classList.remove('show');
    if (qqCookieInput) {
      qqCookieInput.rows = 1;
      qqCookieInput.placeholder = spotifyLoginStatus.oauthConfigured
        ? '已保存 Client ID，可粘贴新的覆盖'
        : '粘贴 Spotify Client ID';
    }
    if (qqCookieNote) qqCookieNote.innerHTML =
      '<div class="spotify-guide-title">三步接入</div>' +
      '<div class="spotify-guide-steps">' +
        '<span><i>1</i>打开开发者页，创建 App</span>' +
        '<span><i>2</i>回调填 <code title="' + SPOTIFY_REDIRECT_URI + '">' + SPOTIFY_REDIRECT_URI + '</code></span>' +
        '<span><i>3</i>复制 Client ID，粘贴到上方</span>' +
      '</div>' +
      '<div class="spotify-guide-actions">' +
        '<button type="button" class="spotify-guide-link" onclick="openSpotifyDeveloperDashboard()">打开网页</button>' +
        '<button type="button" class="spotify-guide-link" onclick="copySpotifyRedirectUri()">复制回调</button>' +
        '<em>PKCE · 不用 Client Secret</em>' +
      '</div>';
    if (qqCookieSaveBtn) {
      qqCookieSaveBtn.style.display = 'none';
      qqCookieSaveBtn.disabled = true;
    }
    if (qqCard) qqCard.style.display = 'none';
    if (st) {
      st.className = 'preview';
      st.textContent = spotifyLoginStatusText();
    }
    if (refreshBtn) {
      refreshBtn.disabled = spotifyBusy || !canOpenSpotifyOAuth;
      refreshBtn.textContent = spotifyConfigBusy ? '保存中…' : (spotifyOAuthBusy ? '等待授权…' : (spotifyLoginStatus.oauthConfigured ? '打开授权' : '保存并授权'));
      refreshBtn.onclick = spotifyLoginStatus.oauthConfigured ? openSpotifyWebLogin : submitSpotifyConfigLogin;
    }
    return;
  }
  if (qqPanel) qqPanel.classList.remove('spotify-guide-panel');
  if (spotifyBtn) spotifyBtn.classList.toggle('active', false);
  if (neteaseBtn) neteaseBtn.classList.toggle('active', loginProvider === 'netease');
  if (qqBtn) qqBtn.classList.toggle('active', isQQ);
  if (kugouBtn) kugouBtn.classList.toggle('active', isKugou);
  if (modal) modal.classList.toggle('login-modal-logged-in', isLoggedIn);
  if (title) title.textContent = isLoggedIn ? (meta.label + '已登录') : ('扫码登录' + meta.label);
  if (desc) {
    desc.innerHTML = isLoggedIn
      ? '当前已保存 <b>' + meta.label + '</b> 登录会话，可继续同步歌单和会员信息；需要换号时请先退出登录。'
      : (isKugou
        ? '使用 <b>酷狗音乐 App</b> 扫码登录，成功后会同步账号信息和酷狗歌单。'
        : isQQ
        ? '打开 <b>QQ 音乐官方扫码窗口</b> 登录，成功后会自动同步账号会话和歌单。'
        : '使用 <b>网易云音乐 App</b> 扫码，可同步歌单、红心与播客。');
  }
  if (shell) {
    shell.classList.toggle('web-login-preview', (isQQ && !isLoggedIn));
    shell.classList.toggle('qq-preview', isQQ && !isLoggedIn);
  }
  if (qqPanel) qqPanel.classList.toggle('show', !isLoggedIn && (isQQ || isKugou) && qqManualCookieOpen);
  if (qqCookieToggle) {
    qqCookieToggle.classList.toggle('show', !isLoggedIn && (isQQ || isKugou));
    qqCookieToggle.textContent = qqManualCookieOpen ? '收起导入' : '手动导入';
  }
  if (qqCookieInput) qqCookieInput.placeholder = isKugou ? 'KuGoo=...; kg_mid=...; userid=...; token=...' : 'uin=...; qqmusic_key=...; qm_keyst=...';
  if (qqCookieNote) qqCookieNote.textContent = isKugou ? '从 kugou.com 的登录会话导入。' : '从 y.qq.com 的登录会话导入。';
  if (qqCard) {
    qqCard.style.display = (!isLoggedIn && isQQ) ? '' : 'none';
    qqCard.disabled = loginProviderBusy(loginProvider);
    var cardMark = qqCard.querySelector('b');
    var cardLabel = qqCard.querySelector('span');
    if (cardMark) cardMark.textContent = 'QQ';
    if (cardLabel) cardLabel.textContent = qqWebLoginBusy ? '等待扫码确认' : '打开官方扫码窗口';
    qqCard.onclick = openQQWebLogin;
  }
  if (st) {
    st.style.display = isLoggedIn ? 'none' : '';
    st.className = isQQ ? 'preview' : '';
    st.textContent = isQQ
      ? '点击二维码区域或下方按钮打开 QQ 音乐官方扫码窗口'
      : '正在生成二维码…';
  }
  if (refreshBtn) {
    refreshBtn.disabled = loginProviderBusy(loginProvider);
    refreshBtn.textContent = isLoggedIn
      ? ('退出' + meta.label)
      : (isQQ ? (qqWebLoginBusy ? '等待扫码…' : '扫码登录') : (loginProviderBusy(loginProvider) ? '等待登录…' : '刷新二维码'));
    refreshBtn.onclick = isLoggedIn ? function(){ logoutLoginProvider(loginProvider); } : (isQQ ? openQQWebLogin : refreshQr);
  }
}
async function refreshQr() {
  stopQrPoll();
  qrKey = null;
  if (loginProvider === 'qq') {
    var info = await refreshQQLoginStatus();
    updateLoginProviderUi();
    if (!(info && info.loggedIn)) {
      var qqImg = document.getElementById('qr-img');
      if (qqImg) qqImg.src = '';
    }
    return;
  }
  if (loginProvider === 'spotify') {
    var spInfo = await refreshSpotifyLoginStatus();
    updateLoginProviderUi();
    return;
  }
  if (loginProvider === 'qishui') {
    await refreshQishuiLoginStatus();
    updateLoginProviderUi();
    return;
  }
  if (loginProvider === 'kugou') {
    var kgInfo = await refreshKugouLoginStatus();
    updateLoginProviderUi();
    if (kgInfo && kgInfo.loggedIn) return;
    var kgImg = document.getElementById('qr-img');
    var kgStatus = document.getElementById('qr-status');
    if (kgImg) {
      kgImg.style.display = '';
      kgImg.src = '';
    }
    try {
      if (kgStatus) {
        kgStatus.style.display = '';
        kgStatus.textContent = '正在生成酷狗登录二维码...';
        kgStatus.className = 'preview';
      }
      var kgKey = await apiJson('/api/kugou/login/qr/key?t=' + Date.now());
      if (!kgKey || !kgKey.key || !kgKey.img) throw new Error((kgKey && (kgKey.message || kgKey.error)) || '酷狗二维码生成失败');
      qrKey = kgKey.key;
      if (kgImg) kgImg.src = kgKey.img;
      if (kgStatus) {
        kgStatus.textContent = '请使用酷狗音乐 App 扫码登录';
        kgStatus.className = '';
      }
      startQrPoll();
    } catch (e) {
      if (kgStatus) {
        kgStatus.textContent = '酷狗二维码生成失败: ' + (e && e.message ? e.message : e);
        kgStatus.className = 'fail';
      }
    }
    return;
  }
  var neInfo = await refreshLoginStatus(true);
  updateLoginProviderUi();
  if (neInfo && neInfo.loggedIn) return;
  try {
    var neKey = await apiJson('/api/login/qr/key?t=' + Date.now());
    if (!neKey.key) throw new Error('获取 key 失败');
    qrKey = neKey.key;
    var q = await apiJson('/api/login/qr/create?key=' + encodeURIComponent(qrKey) + '&t=' + Date.now());
    if (!q.img) throw new Error('生成二维码失败');
    var neImg = document.getElementById('qr-img');
    var neStatus = document.getElementById('qr-status');
    if (neImg) {
      neImg.style.display = '';
      neImg.src = q.img;
    }
    if (neStatus) {
      neStatus.style.display = '';
      neStatus.textContent = '请使用网易云音乐 App 扫码';
      neStatus.className = '';
    }
    startQrPoll();
  } catch (e) {
    var errStatus = document.getElementById('qr-status');
    if (errStatus) {
      errStatus.style.display = '';
      errStatus.textContent = '出错: ' + e.message;
      errStatus.className = 'fail';
    }
  }
}
function startQrPoll() { if (qrPollTimer) clearInterval(qrPollTimer); qrPollTimer = setInterval(checkQr, 2000); }
function stopQrPoll() { if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; } }
async function logoutLoginProvider(provider) {
  provider = provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'spotify' ? 'spotify' : 'netease'));
  stopQrPoll();
  var statusEl = document.getElementById('qr-status');
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = '正在退出' + platformMeta(provider).label + '...';
    statusEl.className = 'preview';
  }
  try {
    if (provider === 'kugou') {
      try { await apiJson('/api/kugou/logout'); } catch (e) {}
      try {
        if (window.desktopWindow && typeof window.desktopWindow.clearKugouMusicLogin === 'function') {
          await window.desktopWindow.clearKugouMusicLogin();
        }
      } catch (e) {}
      kugouLoginStatus = normalizeKugouLoginStatus(null);
      kugouPlaylists = [];
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'kugou'; });
    } else if (provider === 'qq') {
      try { await apiJson('/api/qq/logout'); } catch (e) {}
      try {
        if (window.desktopWindow && typeof window.desktopWindow.clearQQMusicLogin === 'function') {
          await window.desktopWindow.clearQQMusicLogin();
        }
      } catch (e) {}
      qqLoginStatus = normalizeQQLoginStatus(null);
      qqPlaylists = [];
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qq'; });
    } else if (provider === 'spotify') {
      try { await apiJson('/api/spotify/logout'); } catch (e) {}
      try {
        if (window.desktopWindow && typeof window.desktopWindow.clearSpotifyMusicLogin === 'function') {
          await window.desktopWindow.clearSpotifyMusicLogin();
        }
      } catch (e) {}
      spotifyLoginStatus = normalizeSpotifyLoginStatus(null);
      spotifyPlaylists = [];
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'spotify'; });
    } else if (provider === 'qishui') {
      await logoutQishuiAccount();
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qishui'; });
    } else {
      await apiJson('/api/logout');
      try {
        if (window.desktopWindow && typeof window.desktopWindow.clearNeteaseMusicLogin === 'function') {
          await window.desktopWindow.clearNeteaseMusicLogin();
        }
      } catch (e) {}
      loginStatus = { loggedIn: false };
      myPodcastCollections = [];
      myPodcastItems = {};
      likedSongMap = {};
      userPlaylists = qqPlaylists.concat(kugouPlaylists).concat(qishuiPlaylists).concat(spotifyPlaylists);
      updateLikeButtons();
    }
    dualAccountMode = false;
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    safeRenderQueuePanel('login-modal-logout', { scrollCurrent: miniQueueOpen });
    safeShelfRebuild('login-modal-logout');
    showToast('已退出' + platformMeta(provider).label);
    await refreshQr();
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = e && e.message ? e.message : '退出登录失败';
      statusEl.className = 'fail';
    }
  }
}
function toggleQQCookiePanel() {
  if (loginProvider === 'qishui') {
    qishuiManualCookieOpen = !qishuiManualCookieOpen;
    updateLoginProviderUi();
    return;
  }
  qqManualCookieOpen = !qqManualCookieOpen;
  updateLoginProviderUi();
}
function openProviderWebLogin() {
  if (loginProvider === 'qishui') return openQishuiWebLogin();
  if (loginProvider === 'kugou') return openKugouWebLogin();
  if (loginProvider === 'qq') return openQQWebLogin();
  if (loginProvider === 'spotify') return openSpotifyWebLogin();
  return openNeteaseWebLogin();
}
async function openNeteaseWebLogin() {
  if (neteaseWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openNeteaseMusicLogin !== 'function') {
    if (statusEl) { statusEl.textContent = '当前环境不支持官方网页登录，正在尝试旧二维码…'; statusEl.className = 'fail'; }
    return refreshQr();
  }

  neteaseWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开网易云窗口，请在官方页面扫码登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openNeteaseMusicLogin();
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || '网易云登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步网易云会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '网易云会话不可用');
    loginStatus = info;
    activeAccountProvider = 'netease';
    renderUserBtn();
    refreshUserPlaylists(true);
    loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = '网易云会话已保存'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast('网易云已登录: ' + (info.nickname || info.userId || ''));
      maybeRestorePlaybackSessionAfterLogin();
    }, 420);
  } catch (e) {
    neteaseWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '网易云登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (neteaseWebLoginBusy) {
      neteaseWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}
async function openQQWebLogin(options) {
  if (qqWebLoginBusy) return;
  options = options || {};
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openQQMusicLogin !== 'function') {
    qqManualCookieOpen = true;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持自动网页登录，可先使用手动导入。'; statusEl.className = 'fail'; }
    return;
  }

  var forceReauth = !!options.forceReauth || !!(qqLoginStatus && qqLoginStatus.loggedIn);
  qqWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) {
    statusEl.textContent = forceReauth ? '正在重新打开 QQ 音乐官方窗口以续期…' : '已打开 QQ 音乐窗口，请扫码并确认登录…';
    statusEl.className = 'preview';
  }
  try {
    var result = await api.openQQMusicLogin({ forceReauth: !!(qqLoginStatus && qqLoginStatus.loggedIn) || !!options.forceReauth });
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || 'QQ 登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步 QQ 音乐会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'QQ 会话不可用');
    qqLoginStatus = info;
    activeAccountProvider = 'qq';
    qqManualCookieOpen = false;
    renderUserBtn();
    refreshUserPlaylists(true);
    var qqPlaybackReady = !!info.playbackKeyReady && !result.partial;
    if (statusEl) { statusEl.textContent = qqPlaybackReady ? 'QQ 音乐会话已保存' : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast((qqPlaybackReady ? 'QQ 音乐已登录: ' : 'QQ 账号已同步: ') + (info.nickname || info.userId || ''));
      maybeRestorePlaybackSessionAfterLogin();
    }, 420);
  } catch (e) {
    qqWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : 'QQ 登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (qqWebLoginBusy) {
      qqWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}
async function openKugouWebLogin() {
  if (kugouWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openKugouMusicLogin !== 'function') {
    qqManualCookieOpen = true;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持自动网页登录，可先使用手动导入酷狗 cookie。'; statusEl.className = 'fail'; }
    return;
  }

  kugouWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开酷狗音乐窗口，请在官方页面完成登录…'; statusEl.className = 'preview'; }
  try {
    try { await apiJson('/api/kugou/logout'); } catch (_) {}
    try {
      if (typeof api.clearKugouMusicLogin === 'function') await api.clearKugouMusicLogin();
    } catch (_) {}
    kugouLoginStatus = normalizeKugouLoginStatus(null);
    kugouPlaylists = [];
    renderUserBtn();
    var result = await api.openKugouMusicLogin();
    if (!result || !result.ok) {
      throw new Error((result && (result.message || result.error)) || '酷狗登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步酷狗音乐会话…'; statusEl.className = 'preview'; }
    var info = result.loggedIn
      ? result
      : await apiJson('/api/kugou/login/cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: result.cookie || '' })
        });
    if (info && info.loggedIn && !info.saved) {
      try {
        var freshInfo = await apiJson('/api/kugou/login/status?t=' + Date.now());
        if (freshInfo && freshInfo.loggedIn) info = freshInfo;
      } catch (_) {}
    }
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '酷狗会话不可用');
    kugouLoginStatus = normalizeKugouLoginStatus(info);
    activeAccountProvider = 'kugou';
    qqManualCookieOpen = false;
    renderUserBtn();
    refreshUserPlaylists(true);
    if (statusEl) { statusEl.textContent = '酷狗音乐会话已保存'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast('酷狗音乐已同步: ' + (info.nickname || info.userId || ''));
      maybeRestorePlaybackSessionAfterLogin();
    }, 420);
  } catch (e) {
    kugouWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '酷狗登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (kugouWebLoginBusy) {
      kugouWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}
async function submitQQCookieLogin() {
  if (loginProvider === 'spotify') return submitSpotifyConfigLogin();
  if (loginProvider === 'qishui') return submitQishuiTokenLogin();
  if (qqCookieBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var cookie = input ? input.value.trim() : '';
  var isKugouCookie = loginProvider === 'kugou';
  if (!cookie) {
    if (statusEl) { statusEl.textContent = isKugouCookie ? '先粘贴酷狗音乐 cookie' : '先粘贴 QQ 音乐 cookie'; statusEl.className = 'fail'; }
    return;
  }
  qqCookieBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = isKugouCookie ? '正在保存酷狗会话…' : '正在保存 QQ 会话…'; statusEl.className = 'preview'; }
  try {
    var info = await apiJson(isKugouCookie ? '/api/kugou/login/cookie' : '/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || (isKugouCookie ? '酷狗会话不可用' : 'QQ 会话不可用'));
    if (isKugouCookie) {
      kugouLoginStatus = normalizeKugouLoginStatus(info);
      activeAccountProvider = 'kugou';
    } else {
      qqLoginStatus = info;
      activeAccountProvider = 'qq';
    }
    if (input) input.value = '';
    renderUserBtn();
    refreshUserPlaylists(true);
    var manualQQPlaybackReady = !!info.playbackKeyReady;
    if (statusEl) { statusEl.textContent = isKugouCookie ? '酷狗音乐会话已保存' : (manualQQPlaybackReady ? 'QQ 音乐会话已保存' : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'); statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast(isKugouCookie ? ('酷狗音乐已同步: ' + (info.nickname || info.userId || '')) : ((manualQQPlaybackReady ? 'QQ 音乐已登录: ' : 'QQ 账号已同步: ') + (info.nickname || info.userId || '')));
      maybeRestorePlaybackSessionAfterLogin();
    }, 420);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : (isKugouCookie ? '酷狗会话保存失败' : 'QQ 会话保存失败'); statusEl.className = 'fail'; }
  } finally {
    qqCookieBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
  }
}
async function checkQr() {
  if (!qrKey) return;
  try {
    var r = await apiJson('/api/login/qr/check?key=' + encodeURIComponent(qrKey));
    var $st = document.getElementById('qr-status');
    if (r.code === 800) { $st.textContent = '二维码已过期, 请刷新'; $st.className = 'fail'; stopQrPoll(); }
    else if (r.code === 801) { $st.textContent = '请在 App 中扫码'; $st.className = ''; }
    else if (r.code === 802) { $st.textContent = '已扫码, 请在手机确认…'; $st.className = 'scan'; }
    else if (r.code === 803 && (r.loggedIn || r.hasCookie)) {
      $st.textContent = r.pendingProfile ? '登录成功，正在同步账号资料…' : '登录成功！'; $st.className = 'scan';
      stopQrPoll();
      loginStatus = r.loggedIn ? r : Object.assign({}, r, { loggedIn: true, pendingProfile: true, nickname: r.nickname || '网易云用户' });
      activeAccountProvider = 'netease';
      renderUserBtn();
      setTimeout(async function(){
        var fresh = await refreshLoginStatus(true);
        if (!fresh || !fresh.loggedIn) {
          loginStatus = Object.assign({}, loginStatus, { loggedIn: true, pendingProfile: true });
          renderUserBtn();
          fresh = loginStatus;
        }
        closeLoginModal();
        showToast('欢迎 ' + (fresh && fresh.nickname ? fresh.nickname : ''));
      }, r.pendingProfile ? 1200 : 500);
    } else if (r.code === 803) {
      $st.textContent = '扫码已确认，但没有拿到登录凭证，请刷新二维码重试'; $st.className = 'fail';
      stopQrPoll();
    }
  } catch (e) { console.warn(e); }
}
var baseCheckQr = checkQr;
checkQr = async function() {
  if (loginProvider !== 'kugou') return baseCheckQr();
  if (!qrKey) return;
  var st = document.getElementById('qr-status');
  try {
    var r = await apiJson('/api/kugou/login/qr/check?key=' + encodeURIComponent(qrKey) + '&t=' + Date.now());
    if (r.code === 800) {
      if (st) { st.textContent = 'Kugou QR expired, refresh and try again'; st.className = 'fail'; }
      stopQrPoll();
    } else if (r.code === 801) {
      if (st) { st.textContent = 'Use Kugou Music App to scan'; st.className = ''; }
    } else if (r.code === 802) {
      if (st) { st.textContent = 'Scanned. Confirm login on your phone'; st.className = 'scan'; }
    } else if (r.code === 803 && r.loggedIn) {
      stopQrPoll();
      kugouLoginStatus = normalizeKugouLoginStatus(r);
      activeAccountProvider = 'kugou';
      qqManualCookieOpen = false;
      if (st) { st.textContent = 'Kugou login success, syncing playlists...'; st.className = 'scan'; }
      renderUserBtn();
      await refreshUserPlaylists(true);
      setTimeout(function(){
        closeLoginModal();
        showToast('Kugou synced: ' + (kugouLoginStatus.nickname || kugouLoginStatus.userId || ''));
      }, 420);
    } else if (r.code === 803) {
      if (st) { st.textContent = r.message || 'Kugou login confirmed but token missing'; st.className = 'fail'; }
      stopQrPoll();
    }
  } catch (e) {
    console.warn(e);
  }
};
