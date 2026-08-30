(function (global) {
  'use strict';

  var DEFAULTS = {
    netease: { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' },
    qq: { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', stale: false, playbackKeyReady: false, reauthRequired: false, authExpired: false },
    kugou: { provider: 'kugou', loggedIn: false, preview: true, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无 VIP', playbackKeyReady: false },
  };

  var state = {
    netease: Object.assign({}, DEFAULTS.netease),
    qq: Object.assign({}, DEFAULTS.qq),
    kugou: Object.assign({}, DEFAULTS.kugou),
    checked: false,
    checkFailed: false,
    syncPromise: null,
  };

  var hooks = {};

  function configure(nextHooks) {
    hooks = nextHooks || {};
  }

  function normalizeQQ(info) {
    var fallback = DEFAULTS.qq;
    if (!info || !info.loggedIn) {
      return Object.assign({}, fallback, info || {}, {
        provider: 'qq',
        loggedIn: false,
        nickname: (info && info.nickname) || fallback.nickname,
        userId: (info && (info.userId || info.uin)) || '',
        avatar: (info && info.avatar) || '',
        vipType: Number((info && (info.vipType || info.vip_type)) || 0) || 0,
        stale: !!(info && info.stale),
        reauthRequired: !!(info && info.reauthRequired),
        authExpired: !!(info && info.authExpired),
      });
    }
    var vipType = Number(info.vipType || info.vip_type || 0) || 0;
    var vipLevel = String(info.vipLevel || info.vip_level || '').toLowerCase();
    if (vipLevel !== 'svip' && vipLevel !== 'vip' && vipLevel !== 'none') {
      vipLevel = (info.isSvip || info.is_svip || vipType >= 10) ? 'svip' : ((info.isVip || info.is_vip || vipType > 0) ? 'vip' : 'none');
    }
    return Object.assign({}, fallback, info, {
      provider: 'qq',
      loggedIn: true,
      nickname: info.nickname || fallback.nickname,
      userId: info.userId || info.uin || '',
      avatar: info.avatar || '',
      vipType: vipType,
      vipLevel: vipLevel,
      isVip: vipLevel !== 'none',
      isSvip: vipLevel === 'svip',
      vipLabel: info.vipLabel || (vipLevel === 'svip' ? 'QQ SVIP' : (vipLevel === 'vip' ? 'QQ VIP' : '无VIP')),
      playbackKeyReady: !!info.playbackKeyReady,
      stale: !!info.stale || !!(info.profileUnavailable && !(info.nickname && info.avatar)) || !!info.authExpired,
      profileUnavailable: !!info.profileUnavailable,
      reauthRequired: !!info.reauthRequired || !!info.authExpired,
      authExpired: !!info.authExpired,
    });
  }

  function normalizeKugou(info) {
    var fallback = DEFAULTS.kugou;
    if (!info || !info.loggedIn) {
      return Object.assign({}, fallback, info || {}, {
        provider: 'kugou',
        loggedIn: false,
        preview: true,
        playbackKeyReady: false,
      });
    }
    var vipType = Number(info.vipType || info.vip_type || info.viptype || 0) || 0;
    var vipLevel = String(info.vipLevel || info.vip_level || '').toLowerCase();
    if (vipLevel !== 'svip' && vipLevel !== 'vip' && vipLevel !== 'none') {
      vipLevel = (info.isSvip || vipType >= 10) ? 'svip' : ((info.isVip || vipType > 0) ? 'vip' : 'none');
    }
    var isVip = vipLevel !== 'none';
    return Object.assign({}, fallback, info, {
      provider: 'kugou',
      loggedIn: true,
      preview: false,
      vipType: vipType,
      vipLevel: vipLevel,
      isVip: isVip,
      isSvip: vipLevel === 'svip',
      vipLabel: info.vipLabel || (vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无 VIP')),
      playbackKeyReady: info.playbackKeyReady !== false && info.playbackReady !== false,
    });
  }

  function getStatus(provider) {
    if (provider === 'qq') return state.qq;
    if (provider === 'kugou') return state.kugou;
    return state.netease;
  }

  function hasLogin(provider) {
    var st = getStatus(provider);
    return !!(st && st.loggedIn);
  }

  function hasAnyLogin() {
    return hasLogin('netease') || hasLogin('qq') || hasLogin('kugou');
  }

  function firstLoggedProvider(preferred) {
    if (preferred && hasLogin(preferred)) return preferred;
    if (hasLogin('netease')) return 'netease';
    if (hasLogin('qq')) return 'qq';
    if (hasLogin('kugou')) return 'kugou';
    return preferred || 'netease';
  }

  async function syncNetease(apiJson) {
    var info = await apiJson('/api/login/status?t=' + Date.now());
    state.netease = info || Object.assign({}, DEFAULTS.netease);
    state.checked = true;
    state.checkFailed = false;
    if (typeof hooks.onNeteaseSynced === 'function') hooks.onNeteaseSynced(state.netease);
    return state.netease;
  }

  async function syncQQ(apiJson, retry) {
    try {
      var info = await apiJson('/api/qq/login/status?t=' + Date.now());
      state.qq = normalizeQQ(info);
      if (typeof hooks.onQQSynced === 'function') hooks.onQQSynced(state.qq);
      return state.qq;
    } catch (e) {
      if (!retry) {
        await new Promise(function (resolve) { setTimeout(resolve, 450); });
        return syncQQ(apiJson, true);
      }
      state.qq = normalizeQQ(null);
      if (typeof hooks.onQQSynced === 'function') hooks.onQQSynced(state.qq);
      return state.qq;
    }
  }

  async function syncKugou(apiJson, retry) {
    try {
      var info = await apiJson('/api/kugou/login/status?t=' + Date.now());
      state.kugou = normalizeKugou(info);
      if (typeof hooks.onKugouSynced === 'function') hooks.onKugouSynced(state.kugou);
      return state.kugou;
    } catch (e) {
      if (!retry) {
        await new Promise(function (resolve) { setTimeout(resolve, 450); });
        return syncKugou(apiJson, true);
      }
      state.kugou = normalizeKugou(null);
      if (typeof hooks.onKugouSynced === 'function') hooks.onKugouSynced(state.kugou);
      return state.kugou;
    }
  }

  async function syncAll(apiJson) {
    if (state.syncPromise) return state.syncPromise;
    state.syncPromise = Promise.all([
      syncNetease(apiJson).catch(function (e) {
        state.checkFailed = true;
        state.checked = true;
        state.netease = Object.assign({}, DEFAULTS.netease);
        if (typeof hooks.onNeteaseSynced === 'function') hooks.onNeteaseSynced(state.netease);
        return state.netease;
      }),
      syncQQ(apiJson),
      syncKugou(apiJson),
    ]).then(function (results) {
      state.syncPromise = null;
      var payload = { netease: results[0], qq: results[1], kugou: results[2] };
      if (typeof hooks.onAllSynced === 'function') hooks.onAllSynced(payload);
      return payload;
    }).catch(function (e) {
      state.syncPromise = null;
      throw e;
    });
    return state.syncPromise;
  }

  global.Mineradio = global.Mineradio || {};
  global.Mineradio.auth = {
    configure: configure,
    syncAll: syncAll,
    syncNetease: syncNetease,
    syncQQ: syncQQ,
    syncKugou: syncKugou,
    normalizeQQ: normalizeQQ,
    normalizeKugou: normalizeKugou,
    getStatus: getStatus,
    hasLogin: hasLogin,
    hasAnyLogin: hasAnyLogin,
    firstLoggedProvider: firstLoggedProvider,
    getState: function () { return state; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
