// =============================================================================
// 设置页（2026-11-23）
//
// 三条杠里那些参数面板（淡入淡出 / 均衡器 / 变速 / 歌曲过渡 / 休息提醒）与
// 视觉控制台「高级」页（画质 / GPU / 内存 / 缓存 / 输出）整体搬进了 #settings-modal。
// 搬的是同一批 DOM：id、onclick、aria 全不变，所以这里不需要接管任何一个参数的逻辑，
// 只负责三件事：
//   1. 开合与 tab 切换；
//   2. 「搜索设置项」——建索引、过滤、点结果跳到对应控件并高亮；
//   3. 三条杠菜单的快捷开关状态与摘要文案同步。
//
// 所有对外函数都挂到 window 上（onclick 需要），不在顶层写 function 声明 ——
// 整个前端是 125+ 模块合并成一个 script 求值的，同名 function 后声明者会静默覆盖前者。
// =============================================================================
(function (global) {
  'use strict';

  var TAB_ORDER = ['general', 'playback', 'audio', 'desktop-lyrics', 'sources', 'performance', 'interaction', 'ai', 'storage', 'about'];
  var TAB_LABEL = {
    general: '通用',
    playback: '播放',
    audio: '音频',
    'desktop-lyrics': '歌词',
    sources: '音源',
    performance: '性能',
    interaction: '交互',
    ai: 'AI',
    storage: '存储',
    about: '关于'
  };

  var currentTab = 'general';
  var searchEntries = null;
  var aboutState = 'idle';
  var menuObserverBound = false;
  var lastMenuOpen = false;
  var menuSummaryTimer = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = String(text == null ? '' : text);
  }

  /* ---------------- tab ---------------- */

  function paintTabs(tab) {
    var tabs = document.querySelectorAll('#settings-tabs [data-settings-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-settings-tab') === tab;
      tabs[i].classList.toggle('active', on);
      // 侧栏是一组跳转而不是 tablist（中间夹着分组标题），用 aria-current 表达当前位置
      if (on) tabs[i].setAttribute('aria-current', 'page');
      else tabs[i].removeAttribute('aria-current');
    }
    var pages = document.querySelectorAll('#settings-modal .settings-page');
    for (var j = 0; j < pages.length; j++) {
      pages[j].classList.toggle('active', pages[j].getAttribute('data-settings-page') === tab);
    }
    var modal = el('settings-modal');
    if (modal) modal.setAttribute('data-active-tab', tab);
  }

  function setSettingsPageTab(tab, keepScroll) {
    var next = TAB_ORDER.indexOf(tab) >= 0 ? tab : 'general';
    currentTab = next;
    paintTabs(next);
    if (!keepScroll) {
      var body = el('settings-body');
      if (body) body.scrollTop = 0;
    }
    // 输出设备列表原本只在用户点「刷新」时才枚举；切到音频页先自己填一次，
    // 否则搬过来之后那一块是空的。
    if (next === 'sources') renderSourcesPage();
    if (next === 'interaction') renderHotkeyOverview();
    if (next === 'ai') loadAiSettingsConfig();
    if (next === 'audio' && typeof global.refreshAudioOutputDevices === 'function') {
      try { global.refreshAudioOutputDevices(false); } catch (_) { }
    }
    // 切过来的这一页刚变 display:block，滑块的 clientWidth 才有值；
    // 进度填充要重新量一次，否则新页里的滑块只有轨道没有填充。
    if (global.MineradioPrismalChrome && typeof global.MineradioPrismalChrome.syncFills === 'function') {
      try { global.MineradioPrismalChrome.syncFills(); } catch (_) { }
    }
  }

  /* 设置页里的三块参数在视觉控制台里是折叠的（444px 宽的面板必须收着）。
   * 搬到这里后 summary 已隐藏（见 settings-page.css），把它们展开，
   * 否则用户点进「播放」只看到三个标题。 */
  var SETTINGS_FOLD_IDS = ['audio-tuning-fold', 'playback-advanced-fold', 'track-transition-fold'];
  function expandSettingsFolds() {
    SETTINGS_FOLD_IDS.forEach(function (id) {
      var node = el(id);
      if (node && !node.open) node.open = true;
    });
  }

  /* ---------------- 启动偏好：开关与分段 ----------------
   * 06b 里的 applyStartupAutoplayUi / applyStartupResumeModeUi 与分段绑定都写在
   * 设置页还不存在的时候（脚本在设置卡片之前执行，#startup-resume-mode-seg 取不到，
   * 那次绑定直接落空）。这里在 DOM 就绪后补一次绑定，用同一个
   * _mineradioResumeModeBound 标记，避免与 06b 各绑一遍导致切一次弹两次 toast。 */
  function bindStartupControls() {
    var seg = el('startup-resume-mode-seg');
    if (seg && !seg._mineradioResumeModeBound) {
      seg._mineradioResumeModeBound = true;
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          if (typeof global.setStartupResumeMode === 'function') {
            try { global.setStartupResumeMode(b.getAttribute('data-startup-resume-mode')); } catch (_) { }
          }
        });
      });
    }
    if (typeof global.applyStartupAutoplayUi === 'function') {
      try { global.applyStartupAutoplayUi(); } catch (_) { }
    }
    if (typeof global.applyStartupResumeModeUi === 'function') {
      try { global.applyStartupResumeModeUi(); } catch (_) { }
    }
  }

  /* ---------------- 播放时阻止系统休眠 ----------------
   * 主进程用 powerSaveBlocker 实现（preload: desktopWindow.setPlaybackPowerBlocker）。
   * 只在真正出声时占用：暂停、切歌间隙、已结束都要解除，否则等于把用户的屏幕常亮
   * 偷偷锁死。媒体事件不冒泡，所以在 document 上用捕获阶段收。 */
  var PREVENT_SLEEP_KEY = 'mineradio:prevent-sleep:v1';
  var preventSleepOn = (function () {
    try { return localStorage.getItem(PREVENT_SLEEP_KEY) === 'true'; } catch (_) { return false; }
  })();

  function syncPreventSleepToggle() {
    var node = el('t-preventSleep');
    if (!node) return;
    node.classList.toggle('on', preventSleepOn);
    var dot = node.querySelector('.dot');
    if (dot) dot.classList.toggle('on', preventSleepOn);
  }

  function applyPreventSleep() {
    var api = global.desktopWindow;
    if (!api || typeof api.setPlaybackPowerBlocker !== 'function') return;
    var playing = false;
    try {
      playing = !!(typeof audio !== 'undefined' && audio && !audio.paused && !audio.ended);
    } catch (_) { playing = false; }
    try { api.setPlaybackPowerBlocker(!!(preventSleepOn && playing)); } catch (_) { }
  }

  function togglePreventSleep() {
    preventSleepOn = !preventSleepOn;
    try { localStorage.setItem(PREVENT_SLEEP_KEY, String(preventSleepOn)); } catch (_) { }
    syncPreventSleepToggle();
    applyPreventSleep();
    if (typeof global.showToast === 'function') {
      try { global.showToast(preventSleepOn ? '播放时阻止系统休眠已开启' : '播放时阻止系统休眠已关闭'); } catch (_) { }
    }
  }

  var preventSleepMediaBound = false;
  function bindPreventSleepMediaEvents() {
    if (preventSleepMediaBound) return;
    preventSleepMediaBound = true;
    ['play', 'pause', 'ended', 'emptied'].forEach(function (type) {
      document.addEventListener(type, function () {
        global.setTimeout(applyPreventSleep, 0);
      }, true);
    });
  }

  /* ---------------- 交互：歌词时间粒度 ----------------
   * 决策在 06-lyrics 的 chooseLyricLines()，这里只负责把点击接过去；
   * 脚本早于设置 DOM 执行，06 模块自己绑不上，必须在这里补。 */
  function bindLyricGranularity() {
    var seg = el('lyric-granularity-seg');
    if (seg && !seg._settingsGranularityBound) {
      seg._settingsGranularityBound = true;
      seg.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-lyric-granularity]') : null;
        if (!btn) return;
        if (typeof global.setLyricGranularity !== 'function') return;
        try { global.setLyricGranularity(btn.getAttribute('data-lyric-granularity')); } catch (_) { }
      });
    }
    if (typeof global.applyLyricGranularityUi === 'function') {
      try { global.applyLyricGranularityUi(); } catch (_) { }
    }
    if (typeof global.applyLyricTranslationVisibleUi === 'function') {
      try { global.applyLyricTranslationVisibleUi(); } catch (_) { }
    }
  }

  /* ---------------- 外观主题（深色 / 浅色 / 跟随系统） ----------------
   * 只作用于设置页与皮肤弹层（两者的色都收在 --st-* 令牌里，浅色只换令牌值）。
   * 主界面不在范围内 —— 那边是「深色玻璃盖在封面图上」的设计 + WebGL 调色，
   * 不是换一套变量就能翻过来的。
   * 主题挂在 <html data-theme> 上，CSS 用 html[data-theme="light"] :is(#settings-modal,#skin-popover) 覆盖。 */
  var THEME_STORE_KEY = 'mineradio:theme:v1';
  var themePreference = 'dark';
  var themeMediaQuery = null;

  function readThemePreference() {
    try {
      var value = localStorage.getItem(THEME_STORE_KEY);
      if (value === 'light' || value === 'system' || value === 'dark') return value;
    } catch (_) { }
    return 'dark';
  }

  function effectiveTheme() {
    if (themePreference === 'system') return (themeMediaQuery && themeMediaQuery.matches) ? 'light' : 'dark';
    return themePreference === 'light' ? 'light' : 'dark';
  }

  function updateThemeUi() {
    var seg = el('theme-seg');
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('button[data-theme-pref]'), function (btn) {
      var on = btn.getAttribute('data-theme-pref') === themePreference;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyThemePreference() {
    var theme = effectiveTheme();
    var root = document.documentElement;
    if (root) {
      root.setAttribute('data-theme', theme);
      root.setAttribute('data-theme-pref', themePreference);
      /* 让原生控件（range / 滚动条 / 输入框）也按主题走 */
      try { root.style.colorScheme = theme; } catch (_) { }
    }
    updateThemeUi();
    return theme;
  }

  function setThemePreference(mode) {
    themePreference = (mode === 'light' || mode === 'system') ? mode : 'dark';
    try { localStorage.setItem(THEME_STORE_KEY, themePreference); } catch (_) { }
    var theme = applyThemePreference();
    if (typeof global.showToast === 'function') {
      var label = themePreference === 'system' ? ('跟随系统（当前' + (theme === 'light' ? '浅色' : '深色') + '）')
        : (themePreference === 'light' ? '浅色' : '深色');
      try { global.showToast('外观：' + label); } catch (_) { }
    }
  }

  function bindTheme() {
    var seg = el('theme-seg');
    if (seg && !seg._settingsThemeBound) {
      seg._settingsThemeBound = true;
      seg.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-theme-pref]') : null;
        if (!btn) return;
        setThemePreference(btn.getAttribute('data-theme-pref'));
      });
    }
    updateThemeUi();
  }

  /* 模块加载即生效：脚本在 body 末尾、DOMContentLoaded 之前执行，
   * 两个面板都是 display:none，等用户打开时主题早已就位。 */
  themePreference = readThemePreference();
  try {
    themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    if (themeMediaQuery && themeMediaQuery.addEventListener) {
      themeMediaQuery.addEventListener('change', function () {
        if (themePreference === 'system') applyThemePreference();
      });
    }
  } catch (_) { }
  applyThemePreference();

  /* ---------------- AI 页 ----------------
   * 后端早就有：GET/POST /api/ai/config（DPAPI 加密、不回传密钥、写入前校验 https 与内网地址），
   * 以及 /api/ai/playlist、/api/ai/translate。但没有统一入口 —— 配置藏在「AI 歌单」弹窗的 ⚙ 里，
   * AI 补译文开关在视觉控制台，用户得先知道去另一个功能里找。
   * 这里只做收口，不重复实现：
   *   · 保存仍走 POST /api/ai/config，保存后调 loadAiPlaylistConfig() 同步弹窗那份表单；
   *   · 开关仍调 toggleAiLyricTranslate()（同一个 localStorage 键，两边状态联动）。 */
  var AI_CONFIG_ENDPOINT = '/api/ai/config';

  function setAiStatus(text, tone) {
    var node = el('ai-settings-status');
    if (!node) return;
    node.textContent = String(text == null ? '' : text);
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function loadAiSettingsConfig() {
    if (!el('ai-settings-status')) return Promise.resolve(null);
    if (typeof global.apiJson !== 'function') {
      setAiStatus('接口不可用', 'error');
      return Promise.resolve(null);
    }
    setAiStatus('读取中…');
    return Promise.resolve(global.apiJson(AI_CONFIG_ENDPOINT, { method: 'GET', timeoutMs: 6000 }))
      .then(function (data) {
        var configured = !!(data && data.configured);
        var baseUrlEl = el('ai-settings-baseurl');
        var modelEl = el('ai-settings-model');
        if (baseUrlEl && document.activeElement !== baseUrlEl) baseUrlEl.value = (data && data.baseUrl) || '';
        if (modelEl && document.activeElement !== modelEl) modelEl.value = (data && data.model) || '';
        var model = data && data.model ? String(data.model) : '';
        setAiStatus(configured
          ? ('已配置' + (model ? (' · ' + model) : ''))
          : '未配置 · 当前走本地智能推荐', configured ? 'ok' : '');
        return data;
      })
      .catch(function (err) {
        setAiStatus('读取失败：' + ((err && err.message) || '未知错误'), 'error');
        return null;
      });
  }

  function saveAiSettingsConfig() {
    if (typeof global.apiJson !== 'function') { setAiStatus('接口不可用', 'error'); return; }
    var baseUrlEl = el('ai-settings-baseurl');
    var modelEl = el('ai-settings-model');
    var keyEl = el('ai-settings-apikey');
    var payload = {
      baseUrl: String((baseUrlEl && baseUrlEl.value) || '').trim(),
      model: String((modelEl && modelEl.value) || '').trim()
    };
    /* 服务端只要看到 apiKey 就写盘，空串等于清除 —— 所以留空时**不能**带上这个字段 */
    var apiKey = String((keyEl && keyEl.value) || '').trim();
    if (apiKey) payload.apiKey = apiKey;
    if (!payload.baseUrl) {
      setAiStatus('请先填写服务地址', 'error');
      if (typeof global.showToast === 'function') { try { global.showToast('请填写服务地址'); } catch (_) { } }
      return;
    }
    setAiStatus('正在保存…');
    Promise.resolve(global.apiJson(AI_CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })).then(function (res) {
      if (keyEl) keyEl.value = '';
      if (typeof global.loadAiPlaylistConfig === 'function') {
        try { global.loadAiPlaylistConfig(); } catch (_) { }
      }
      loadAiSettingsConfig();
      if (typeof global.showToast === 'function') { try { global.showToast('AI 配置已保存'); } catch (_) { } }
      return res;
    }).catch(function (err) {
      setAiStatus('保存失败：' + ((err && err.message) || '未知错误'), 'error');
    });
  }

  /* 清除密钥是不可逆的（要重新填一遍），用两段式按钮代替 confirm 弹窗 */
  var aiClearArmTimer = 0;
  function clearAiSettingsKey() {
    var btn = el('ai-settings-clear');
    if (!btn) return;
    if (!btn._aiClearArmed) {
      btn._aiClearArmed = true;
      btn.textContent = '确认清除？';
      setAiStatus('再次点击将删除已保存的 API Key', 'error');
      if (aiClearArmTimer) clearTimeout(aiClearArmTimer);
      aiClearArmTimer = global.setTimeout(function () {
        aiClearArmTimer = 0;
        btn._aiClearArmed = false;
        btn.textContent = '清除密钥';
        loadAiSettingsConfig();
      }, 4000);
      return;
    }
    btn._aiClearArmed = false;
    btn.textContent = '清除密钥';
    if (aiClearArmTimer) { clearTimeout(aiClearArmTimer); aiClearArmTimer = 0; }
    if (typeof global.apiJson !== 'function') return;
    setAiStatus('正在清除…');
    Promise.resolve(global.apiJson(AI_CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: '' })
    })).then(function () {
      if (typeof global.loadAiPlaylistConfig === 'function') {
        try { global.loadAiPlaylistConfig(); } catch (_) { }
      }
      loadAiSettingsConfig();
      if (typeof global.showToast === 'function') { try { global.showToast('已清除 API Key'); } catch (_) { } }
    }).catch(function (err) {
      setAiStatus('清除失败：' + ((err && err.message) || '未知错误'), 'error');
    });
  }

  /* DeepSeek 预设：官方 base_url 是 https://api.deepseek.com（不需要 /v1），
   * V4.1-Flash 的模型名是 deepseek-flash；旧名 deepseek-v4-flash 仍被路由到同一模型。
   * 只填地址与模型 —— 不动已保存的 Key，也不自动保存（用户还要先贴 Key）。 */
  var AI_PRESET_DEEPSEEK = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash'
  };

  function fillAiDeepSeekPreset() {
    var baseUrlEl = el('ai-settings-baseurl');
    var modelEl = el('ai-settings-model');
    if (baseUrlEl) baseUrlEl.value = AI_PRESET_DEEPSEEK.baseUrl;
    if (modelEl) modelEl.value = AI_PRESET_DEEPSEEK.model;
    setAiStatus('已填入 DeepSeek · V4.1-Flash，贴好 Key 后点「保存配置」');
    var keyEl = el('ai-settings-apikey');
    if (keyEl && !keyEl.value) {
      try { keyEl.focus(); } catch (_) { }
    }
  }

  function bindAiSettings() {
    var preset = el('ai-settings-preset-deepseek');
    if (preset && !preset._settingsAiBound) {
      preset._settingsAiBound = true;
      preset.addEventListener('click', fillAiDeepSeekPreset);
    }
    var save = el('ai-settings-save');
    if (save && !save._settingsAiBound) {
      save._settingsAiBound = true;
      save.addEventListener('click', saveAiSettingsConfig);
    }
    var clear = el('ai-settings-clear');
    if (clear && !clear._settingsAiBound) {
      clear._settingsAiBound = true;
      clear.addEventListener('click', clearAiSettingsKey);
    }
    var test = el('ai-settings-test');
    if (test && !test._settingsAiBound) {
      test._settingsAiBound = true;
      test.addEventListener('click', testAiSettingsConnection);
    }
    var open = el('ai-settings-open-playlist');
    if (open && !open._settingsAiBound) {
      open._settingsAiBound = true;
      open.addEventListener('click', function () {
        if (typeof global.openAiPlaylistModal === 'function') {
          try { global.openAiPlaylistModal(); } catch (_) { }
        }
      });
    }
  }

  function testAiSettingsConnection() {
    if (typeof global.apiJson !== 'function') { setAiStatus('接口不可用', 'error'); return; }
    var btn = el('ai-settings-test');
    if (btn) btn.disabled = true;
    setAiStatus('正在测试连接…');
    Promise.resolve(global.apiJson('/api/ai/test', { method: 'POST', timeoutMs: 15000 }))
      .then(function (data) {
        if (data && data.ok) {
          var detail = [];
          if (data.model) detail.push(data.model);
          if (data.latencyMs) detail.push(data.latencyMs + 'ms');
          setAiStatus('连接正常' + (detail.length ? ' · ' + detail.join(' · ') : ''), 'ok');
        } else {
          setAiStatus((data && data.message) || '连接失败', 'error');
        }
      })
      .catch(function (err) {
        setAiStatus('连接失败：' + ((err && err.message) || '未知错误'), 'error');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  /* ---------------- 设置备份 / 迁移 ----------------
   * 只导出「设置」。白名单写死在代码里，导入时同样按白名单过滤 ——
   * 备份文件是外部文件，不能让它往任意 localStorage 键里写东西。
   * 明确排除：登录凭据 / cookie / VIP 证据、歌单与本地库、缓存与节奏分析、
   * 听歌统计、搜索历史、播放进度快照。 */
  var SETTINGS_BACKUP_KIND = 'mineradio-settings';
  var SETTINGS_BACKUP_VERSION = 1;
  var SETTINGS_BACKUP_MAX_BYTES = 2 * 1024 * 1024;
  var SETTINGS_BACKUP_KEYS = [
    // 外观 / 歌词布局 / 界面开关
    'mineradio-lyric-layout-v1',
    'mineradio-custom-lyric-prefs-v1',
    'mineradio-controls-auto-hide-v1',
    'mineradio-user-capsule-auto-hide-v1',
    'mineradio-fx-fab-auto-hide-v1',
    'mineradio-playlist-panel-pinned-v1',
    'mineradio-diy-player-mode-v1',
    'mineradio-scene-v1',
    // 音频
    'mineradio-audio-tuning-v1',
    'mineradio-mood-audio-v1',
    'mineradio-playback-advanced-v1',
    'mineradio-playback-quality-v1',
    'mineradio-track-transition-v1',
    'mineradio-gapless-handoff-v1',
    'mineradio-cuefield-automix-v1',
    'mineradio-local-beatmap-prefs-v1',
    // 行为
    'mineradio-break-reminder-v1',
    'mineradio:startup-autoplay:v1',
    'mineradio:startup-fast-skip:v1',
    'mineradio:startup-resume-mode:v1',
    'mineradio:prevent-sleep:v1',
    'mineradio:shuffle-no-repeat:v1',
    'mineradio:close-behavior:v1',
    'mineradio:close-action:v1',
    'mineradio:ui-zoom:v1',
    'mineradio:lyric-global-offset:v1',
    'mineradio-lyric-timing-offsets-v1',
    'mineradio:update-check-on-start:v1',
    'mineradio:update-auto-download:v1',
    // 热键
    'mineradio-hotkey-settings-v1',
    // Folia 世界与调参
    'mineradio-folia-world-v1',
    'mineradio-folia-tuning-v1',
    'mineradio-folia-common-tuning-v1',
    'mineradio-folia-latent-tuning-v1',
    'mineradio-folia-monet-tuning-v1',
    'mineradio-folia-nomand-tuning-v1',
    'mineradio-folia-sora-tuning-v1',
    'mineradio-folia-url-tuning-v1',
    'mineradio-folia-mod-settings-v1'
  ];

  function settingsBackupStamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function setBackupStatus(text) {
    setText('settings-backup-status', text);
  }

  function collectSettingsBackupValues() {
    var out = {};
    var count = 0;
    for (var i = 0; i < SETTINGS_BACKUP_KEYS.length; i++) {
      var key = SETTINGS_BACKUP_KEYS[i];
      try {
        var value = localStorage.getItem(key);
        if (value != null) { out[key] = value; count++; }
      } catch (_) { }
    }
    return { values: out, count: count };
  }

  function toastIfPossible(text) {
    if (typeof global.showToast === 'function') {
      try { global.showToast(text); } catch (_) { }
    }
  }

  function exportSettingsBackup() {
    var api = global.desktopWindow;
    if (!api || typeof api.exportJsonFile !== 'function') {
      toastIfPossible('导出设置仅在桌面版可用');
      return;
    }
    var collected = collectSettingsBackupValues();
    if (!collected.count) {
      setBackupStatus('没有可导出的设置项。');
      toastIfPossible('没有可导出的设置');
      return;
    }
    var payload = {
      kind: SETTINGS_BACKUP_KIND,
      version: SETTINGS_BACKUP_VERSION,
      savedAt: new Date().toISOString(),
      count: collected.count,
      values: collected.values
    };
    setBackupStatus('正在导出…');
    Promise.resolve(api.exportJsonFile({
      defaultName: 'mineradio-settings-' + settingsBackupStamp() + '.json',
      text: JSON.stringify(payload, null, 2)
    })).then(function (res) {
      if (res && res.ok) {
        setBackupStatus('已导出 ' + collected.count + ' 项设置。');
        toastIfPossible('已导出 ' + collected.count + ' 项设置');
      } else if (res && res.canceled) {
        setBackupStatus('已取消导出。');
      } else {
        setBackupStatus('导出失败' + (res && res.error ? ('：' + res.error) : '') + '。');
      }
    }).catch(function (err) {
      setBackupStatus('导出失败：' + ((err && err.message) || '未知错误'));
    });
  }

  /* 导入只覆盖备份里出现过的键；没有的键保持原样（合并语义）。
   * 这样「只备份了热键」的文件不会顺手把歌词布局清空。 */
  function applyImportedSettingsBackup(data) {
    if (!data || data.kind !== SETTINGS_BACKUP_KIND) {
      return { ok: false, reason: '这不是 Mineradio 设置备份文件' };
    }
    var version = Number(data.version) || 0;
    if (version > SETTINGS_BACKUP_VERSION) {
      return { ok: false, reason: '备份来自更新的版本，当前播放器无法识别' };
    }
    var values = data.values && typeof data.values === 'object' ? data.values : null;
    if (!values) return { ok: false, reason: '备份里没有设置内容' };
    var applied = 0;
    for (var i = 0; i < SETTINGS_BACKUP_KEYS.length; i++) {
      var key = SETTINGS_BACKUP_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      var raw = values[key];
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
      try { localStorage.setItem(key, String(raw)); applied++; } catch (_) { }
    }
    if (!applied) return { ok: false, reason: '备份里没有当前版本认识的设置项' };
    /* 能立即生效的先同步，省得用户以为没导入成功 */
    ['applyStoredClosePrefs', 'applyStoredUiZoom', 'applyUpdatePrefsUi',
      'applyShuffleNoRepeatUi', 'applyGlobalLyricTimingOffsetUi',
      'applyStartupAutoplayUi', 'applyStartupResumeModeUi', 'syncPreventSleepToggle'
    ].forEach(function (name) {
      if (typeof global[name] !== 'function') return;
      try { global[name](); } catch (_) { }
    });
    return { ok: true, applied: applied };
  }

  function importSettingsBackup() {
    var api = global.desktopWindow;
    if (!api || typeof api.importJsonFile !== 'function') {
      toastIfPossible('导入设置仅在桌面版可用');
      return;
    }
    setBackupStatus('正在读取备份…');
    Promise.resolve(api.importJsonFile()).then(function (res) {
      if (!res || res.ok === false) {
        if (res && res.canceled) { setBackupStatus('已取消导入。'); return; }
        setBackupStatus('导入失败' + (res && res.error ? ('：' + res.error) : '') + '。');
        return;
      }
      var text = typeof res.text === 'string' ? res.text : '';
      if (!text) { setBackupStatus('导入失败：文件是空的。'); return; }
      if (text.length > SETTINGS_BACKUP_MAX_BYTES) {
        setBackupStatus('导入失败：文件过大，不像是设置备份。');
        return;
      }
      var data = null;
      try { data = JSON.parse(text); } catch (_) {
        setBackupStatus('导入失败：文件不是合法 JSON。');
        return;
      }
      var result = applyImportedSettingsBackup(data);
      if (!result.ok) {
        setBackupStatus('导入失败：' + result.reason + '。');
        toastIfPossible('导入失败：' + result.reason);
        return;
      }
      setBackupStatus('已导入 ' + result.applied + ' 项设置，重启播放器后完全生效。');
      toastIfPossible('已导入 ' + result.applied + ' 项设置，建议重启播放器');
    }).catch(function (err) {
      setBackupStatus('导入失败：' + ((err && err.message) || '未知错误'));
    });
  }

  function restartForSettingsBackup() {
    var api = global.desktopWindow;
    if (!api || typeof api.restartApp !== 'function') {
      toastIfPossible('重启入口仅在桌面版可用');
      return;
    }
    setBackupStatus('正在重启…');
    try { api.restartApp(); } catch (_) {
      setBackupStatus('重启失败，请手动关闭后重新打开。');
    }
  }

  function bindSettingsBackup() {
    var pairs = [
      ['settings-backup-export', exportSettingsBackup],
      ['settings-backup-import', importSettingsBackup],
      ['settings-backup-restart', restartForSettingsBackup]
    ];
    for (var i = 0; i < pairs.length; i++) {
      var node = el(pairs[i][0]);
      if (!node || node._settingsBackupBound) continue;
      node._settingsBackupBound = true;
      node.addEventListener('click', pairs[i][1]);
    }
  }

  /* ---------------- 性能：减少动效 ----------------
   * 判据收口在 00-state/14-motion-system.js（MineradioMotion.prefersReducedMotion）；
   * 手动模式由它给 <html> 挂 .reduce-motion，CSS 侧一条全局规则收紧。
   * 这里只负责把分段点击接过去 + 回填状态。 */
  function bindMotionReduce() {
    var seg = el('motion-reduce-seg');
    if (seg && !seg._settingsMotionBound) {
      seg._settingsMotionBound = true;
      seg.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-motion-reduce]') : null;
        if (!btn) return;
        if (typeof global.setReduceMotionMode !== 'function') return;
        try { global.setReduceMotionMode(btn.getAttribute('data-motion-reduce')); } catch (_) { }
      });
    }
    if (global.MineradioMotion && typeof global.MineradioMotion.applyReduceMotionUi === 'function') {
      try { global.MineradioMotion.applyReduceMotionUi(); } catch (_) { }
    }
  }

  /* ---------------- 交互页：热键 ----------------
   * 热键系统（07-fx/06-hotkeys.js）本来就写全了：7 个动作、局内 + 全局两套键位、
   * 组合键录入、系统占用冲突检测、主进程注册。但它只提供 ensureHotkeySettingsButton()，
   * 而那个函数从未被调用 —— 整块 UI 是死代码，用户没有任何入口。
   * 这里把它接进设置页：一个入口行 + 一张只读键位表；
   * 改键仍然用原来那个弹窗（z-index 1450，盖在设置页 640 之上，不会看不见）。 */
  function hotkeyBindingText(binding) {
    if (!binding) return '';
    try {
      return typeof global.formatHotkey === 'function' ? global.formatHotkey(binding) : String(binding);
    } catch (_) { return String(binding); }
  }

  function renderHotkeyOverview() {
    var list = el('hotkey-overview');
    if (!list) return;
    var actions = null;
    try { actions = global.HOTKEY_ACTIONS; } catch (_) { actions = null; }
    if (!actions || !actions.length) {
      list.innerHTML = '<div class="st-hk-empty">热键模块未就绪</div>';
      return;
    }
    var settings = null;
    try {
      settings = typeof global.readHotkeySettings === 'function' ? global.readHotkeySettings() : null;
    } catch (_) { settings = null; }
    var html = '';
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      var local = settings && settings.local ? hotkeyBindingText(settings.local[action.key]) : '';
      var globalKey = settings && settings.global ? hotkeyBindingText(settings.global[action.key]) : '';
      html += '<div class="st-hk-row">' +
        '<span class="st-hk-name">' + escText(action.label || action.key) + '</span>' +
        '<span class="st-hk-key' + (local ? '' : ' empty') + '">' + escText(local || '未设置') + '</span>' +
        '<span class="st-hk-key' + (globalKey ? '' : ' empty') + '">' + escText(globalKey || '未设置') + '</span>' +
      '</div>';
    }
    list.innerHTML = html;
  }

  function bindHotkeySection() {
    var opener = el('open-hotkey-settings');
    if (opener && !opener._settingsHotkeyBound) {
      opener._settingsHotkeyBound = true;
      opener.addEventListener('click', function () {
        if (typeof global.openHotkeySettings === 'function') {
          try { global.openHotkeySettings(); } catch (_) { }
        }
      });
    }
    /* 弹窗关掉之后要刷新只读表：热键模块自己不会通知外面 */
    if (typeof global.closeHotkeySettings === 'function' && !global.closeHotkeySettings._settingsHotkeyHook) {
      var original = global.closeHotkeySettings;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        if (currentTab === 'interaction') {
          try { renderHotkeyOverview(); } catch (_) { }
        }
        return result;
      };
      wrapped._settingsHotkeyHook = true;
      global.closeHotkeySettings = wrapped;
    }
  }

  /* ---------------- 音源页 ----------------
   * 列表不写死在 HTML 里：登录状态随时会变（登录弹窗、三条杠退出、别的入口切换账号），
   * 静态 DOM 只会显示打开设置那一刻的快照。这里每次进页都按 platformStatus() 重画，
   * 并把 renderUserBtn 包一层 —— 它是账号态变化的统一出口，任何登录/退出最后都会走到它。 */
  var SOURCE_PROVIDERS = ['kugou', 'qq', 'netease', 'qishui', 'spotify'];
  var SOURCE_FALLBACK_LABEL = {
    kugou: '酷狗音乐',
    qq: 'QQ 音乐',
    netease: '网易云音乐',
    qishui: '汽水音乐',
    spotify: 'Spotify'
  };

  function escText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sourceLabel(provider) {
    try {
      if (typeof global.platformMeta === 'function') {
        var meta = global.platformMeta(provider);
        if (meta && meta.label) return meta.label;
      }
    } catch (_) { }
    return SOURCE_FALLBACK_LABEL[provider] || provider;
  }

  function sourceRowHtml(provider) {
    var status = null;
    try {
      status = typeof global.platformStatus === 'function' ? global.platformStatus(provider) : null;
    } catch (_) { status = null; }
    var logged = !!(status && status.loggedIn);
    var pending = logged && provider === 'qq' && !!status.preview;
    var vip = '';
    if (logged) {
      try {
        vip = typeof global.loginProviderVipText === 'function' ? global.loginProviderVipText(provider, status) : '';
      } catch (_) { vip = ''; }
    }
    var hint;
    if (!logged) hint = '未登录 · 需要登录后才能取址播放';
    else if (pending) hint = '会话已建立 · 会员与音质待同步';
    else if (status.nickname && vip) hint = status.nickname + ' · ' + vip;
    else hint = status.nickname || vip || '已登录';
    var dotClass = pending ? 'st-src-dot pending' : (logged ? 'st-src-dot on' : 'st-src-dot');
    var actions = logged
      ? '<button type="button" class="fx-mini-btn ghost" data-src-login="' + provider + '">切换</button>' +
        '<button type="button" class="fx-mini-btn ghost" data-src-logout="' + provider + '">退出</button>'
      : '<button type="button" class="fx-mini-btn" data-src-login="' + provider + '">登录</button>';
    return '<div class="st-src-row" role="listitem">' +
      '<span class="' + dotClass + '" aria-hidden="true"></span>' +
      '<div class="st-src-main">' +
        '<div class="st-src-name">' + escText(sourceLabel(provider)) + '</div>' +
        '<div class="st-src-hint">' + escText(hint) + '</div>' +
      '</div>' +
      '<div class="st-src-actions">' + actions + '</div>' +
    '</div>';
  }

  function renderSourcesPage() {
    var list = el('sources-list');
    if (!list) return;
    var html = '';
    for (var i = 0; i < SOURCE_PROVIDERS.length; i++) html += sourceRowHtml(SOURCE_PROVIDERS[i]);
    list.innerHTML = html || '<div class="st-src-empty">没有可用的音源</div>';
  }

  /* 「退出全部」不能直接调 doLogout()：那个函数只清网易云的服务端 cookie
   * （server/routes/netease.js 的 /api/logout），酷狗/QQ/汽水/Spotify 的会话原样留着。
   * 这里按平台逐个走 logoutLoginProvider，未登录的跳过，串行执行避免几个平台
   * 同时写 same-site 状态与歌单缓存。 */
  function logoutAllSources() {
    var chain = Promise.resolve();
    for (var i = 0; i < SOURCE_PROVIDERS.length; i++) {
      chain = chain.then((function (provider) {
        return function () {
          var logged = false;
          try {
            logged = typeof global.hasPlatformLogin === 'function' && global.hasPlatformLogin(provider);
          } catch (_) { logged = false; }
          if (!logged || typeof global.logoutLoginProvider !== 'function') return null;
          return Promise.resolve(global.logoutLoginProvider(provider)).catch(function () { });
        };
      })(SOURCE_PROVIDERS[i]));
    }
    return chain.then(function () {
      renderSourcesPage();
      if (typeof global.showToast === 'function') {
        try { global.showToast('已退出全部登录'); } catch (_) { }
      }
    });
  }

  function bindSourcesPage() {
    var list = el('sources-list');
    if (list && !list._settingsSourcesBound) {
      list._settingsSourcesBound = true;
      list.addEventListener('click', function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var loginBtn = target.closest('[data-src-login]');
        if (loginBtn) {
          var provider = loginBtn.getAttribute('data-src-login');
          if (typeof global.showLoginModal === 'function') {
            try { global.showLoginModal({ provider: provider }); } catch (_) { }
          }
          return;
        }
        var outBtn = target.closest('[data-src-logout]');
        if (outBtn) {
          var who = outBtn.getAttribute('data-src-logout');
          outBtn.disabled = true;
          var job = typeof global.logoutLoginProvider === 'function'
            ? global.logoutLoginProvider(who)
            : Promise.resolve();
          Promise.resolve(job).catch(function () { }).then(renderSourcesPage);
        }
      });
    }
    var all = el('sources-logout-all');
    if (all && !all._settingsSourcesBound) {
      all._settingsSourcesBound = true;
      all.addEventListener('click', function () {
        logoutAllSources();
      });
    }
  }

  /* 账号态变化的统一出口：renderUserBtn 在每次登录/退出后都会被调用。
   * 只在音源页可见时才重画，别在后台页面白跑 DOM。 */
  function hookSourcesStateRefresh() {
    if (typeof global.renderUserBtn !== 'function') return;
    if (global.renderUserBtn._settingsSourcesHook) return;
    var original = global.renderUserBtn;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      if (currentTab === 'sources') {
        try { renderSourcesPage(); } catch (_) { }
      }
      return result;
    };
    wrapped._settingsSourcesHook = true;
    global.renderUserBtn = wrapped;
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function closeTransientLayers() {
    if (typeof global.closePlayerQuickMenu === 'function') {
      try { global.closePlayerQuickMenu(); } catch (_) { }
    }
    if (typeof global.closeSkinPopover === 'function') {
      try { global.closeSkinPopover(); } catch (_) { }
    }
    if (typeof global.closeFxPanel === 'function') {
      try { global.closeFxPanel(); } catch (_) { }
    }
  }

  function openSettingsPage(tab, focusId) {
    var modal = el('settings-modal');
    if (!modal) return;
    closeTransientLayers();
    setSettingsPageTab(tab || currentTab || 'general');
    expandSettingsFolds();
    bindStartupControls();
    bindSourcesPage();
    renderSourcesPage();
    bindHotkeySection();
    renderHotkeyOverview();
    bindSettingsBackup();
    bindMotionReduce();
    bindTheme();
    bindAiSettings();
    loadAiSettingsConfig();
    if (typeof global.updateAiLyricTranslateToggle === 'function') {
      try { global.updateAiLyricTranslateToggle(); } catch (_) { }
    }
    bindLyricGranularity();
    syncPreventSleepToggle();
    if (typeof global.applyGlobalLyricTimingOffsetUi === 'function') {
      try { global.applyGlobalLyricTimingOffsetUi(); } catch (_) { }
    }
    if (typeof global.applyShuffleNoRepeatUi === 'function') {
      try { global.applyShuffleNoRepeatUi(); } catch (_) { }
    }
    if (typeof global.applyUpdatePrefsUi === 'function') {
      try { global.applyUpdatePrefsUi(); } catch (_) { }
    }
    document.body.classList.add('settings-page-open');
    modal.setAttribute('aria-hidden', 'false');
    ensureSearchIndex();
    loadSettingsAbout();
    if (focusId) {
      // 等 tab 页先 display:block，再滚到目标控件
      requestAnimationFrame(function () { focusSettingsTarget(focusId); });
    }
  }

  function closeSettingsPage() {
    var modal = el('settings-modal');
    document.body.classList.remove('settings-page-open');
    if (modal) modal.setAttribute('aria-hidden', 'true');
    hideSearchResults();
  }

  function closeSettingsPageIfMask(event) {
    if (!event || !event.target) return;
    if (event.target.id === 'settings-modal') closeSettingsPage();
  }

  /* ---------------- 定位到某个控件 ---------------- */

  function expandAncestorDetails(node) {
    var det = node && node.closest ? node.closest('details') : null;
    while (det) {
      det.open = true;
      var parent = det.parentElement;
      det = parent && parent.closest ? parent.closest('details') : null;
    }
  }

  function highlightNode(node) {
    if (!node) return;
    /* 只能用自己算的偏移滚 .settings-body。
     * scrollIntoView 会连同 document 一起滚 —— 设置页是 fixed 覆盖层，
     * 外层一滚就把「标题 + tab」顶出可视区，底部还会露出窗口底色（实测截到过）。 */
    var body = el('settings-body');
    if (body && body.contains(node)) {
      var bodyRect = body.getBoundingClientRect();
      var nodeRect = node.getBoundingClientRect();
      var delta = (nodeRect.top - bodyRect.top) - Math.max(0, (body.clientHeight - nodeRect.height) / 2);
      var next = Math.max(0, body.scrollTop + delta);
      try { body.scrollTo({ top: next, behavior: 'smooth' }); }
      catch (_) { body.scrollTop = next; }
    } else {
      try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (_) { try { node.scrollIntoView(); } catch (__) { } }
    }
    node.classList.remove('settings-hit');
    // 重启动画：读一次布局让浏览器认账
    void node.offsetWidth;
    node.classList.add('settings-hit');
    setTimeout(function () { node.classList.remove('settings-hit'); }, 1700);
  }

  function focusSettingsTarget(id) {
    if (!id) return;
    var node = el(id);
    if (!node) return;
    var page = node.closest ? node.closest('.settings-page') : null;
    if (page) {
      var tab = page.getAttribute('data-settings-page');
      if (tab && tab !== currentTab) setSettingsPageTab(tab, true);
    }
    expandAncestorDetails(node);
    var block = node.closest ? (node.closest('.fx-slider') || node.closest('.fx-seg') || node.closest('.fx-toggle') || node) : node;
    highlightNode(block);
  }

  /* ---------------- 搜索 ---------------- */

  function entryText(node) {
    if (!node) return '';
    if (node.classList.contains('settings-group-title')) return node.textContent.trim();
    if (node.tagName === 'SUMMARY') {
      return node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    /* 分段控件自己不带标签，名字写在它上面那行 .fx-section-label 里 */
    if (node.classList.contains('fx-seg')) {
      var prevLabel = node.previousElementSibling;
      if (prevLabel && prevLabel.classList.contains('fx-section-label')) {
        return prevLabel.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      }
      return node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    if (node.classList.contains('st-link-row')) {
      var linkLabel = node.querySelector('.st-link-label');
      if (linkLabel && linkLabel.textContent.trim()) return linkLabel.textContent.trim();
    }
    var label = node.querySelector('label');
    if (label && label.textContent.trim()) return label.textContent.trim();
    var firstSpan = node.querySelector('span');
    if (firstSpan && firstSpan.textContent.trim()) {
      return firstSpan.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    var strong = node.querySelector('strong');
    if (strong && strong.textContent.trim()) return strong.textContent.trim();
    return '';
  }

  function ensureSearchIndex() {
    if (searchEntries) return searchEntries;
    var selector = '.fx-slider, .fx-toggle, .fx-seg, .st-link-row, .fade-control-row, .at-control-row, ' +
      '.tt-param-row, .lyric-color-row, .settings-fact, .settings-group-title, details > summary, .quick-menu-toggle';
    var list = [];
    var seen = {};
    var pages = document.querySelectorAll('#settings-modal .settings-page');
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      var tab = page.getAttribute('data-settings-page') || 'general';
      var nodes = page.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        // 折叠区里的 summary 已经能代表整块，里面的行不再重复登记
        if (node.tagName !== 'SUMMARY' && node.closest && node.closest('details') && !node.closest('.fx-slider')) {
          var summary = node.closest('details').querySelector('summary');
          if (summary && summary !== node) continue;
        }
        var text = entryText(node);
        if (!text || text.length < 2) continue;
        var key = tab + '|' + text;
        if (seen[key]) continue;
        seen[key] = 1;
        list.push({ tab: tab, text: text, node: node });
      }
    }
    searchEntries = list;
    return list;
  }

  function hideSearchResults() {
    var box = el('settings-search-results');
    if (box) {
      box.hidden = true;
      box.textContent = '';
    }
  }

  function renderSearchResults(query) {
    var box = el('settings-search-results');
    if (!box) return;
    var q = String(query || '').trim().toLowerCase();
    if (!q) { hideSearchResults(); return; }
    var entries = ensureSearchIndex();
    var hits = [];
    for (var i = 0; i < entries.length && hits.length < 14; i++) {
      if (entries[i].text.toLowerCase().indexOf(q) >= 0) hits.push(entries[i]);
    }
    box.textContent = '';
    if (!hits.length) {
      var empty = document.createElement('div');
      empty.className = 'settings-empty';
      empty.textContent = '没有匹配「' + query + '」的设置项';
      box.appendChild(empty);
      box.hidden = false;
      return;
    }
    hits.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-search-result';
      var name = document.createElement('span');
      name.textContent = entry.text;
      var where = document.createElement('small');
      where.textContent = TAB_LABEL[entry.tab] || entry.tab;
      btn.appendChild(name);
      btn.appendChild(where);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        focusSettingsEntry(entry);
      });
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function focusSettingsEntry(entry) {
    if (!entry) return;
    if (entry.tab && entry.tab !== currentTab) setSettingsPageTab(entry.tab, true);
    hideSearchResults();
    var input = el('settings-search-input');
    if (input) input.value = entry.text;
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.add('has-value');
    requestAnimationFrame(function () {
      expandAncestorDetails(entry.node);
      highlightNode(entry.node);
    });
  }

  function clearSettingsSearch() {
    var input = el('settings-search-input');
    if (input) input.value = '';
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.remove('has-value');
    hideSearchResults();
    input && input.focus();
  }

  /* ---------------- 关于 ---------------- */

  function readApiToken() {
    try {
      if (global.desktopWindow && typeof global.desktopWindow.getApiToken === 'function') {
        var t = global.desktopWindow.getApiToken();
        if (t) return String(t);
      }
    } catch (_) { }
    return global.__MINERADIO_API_TOKEN__ ? String(global.__MINERADIO_API_TOKEN__) : '';
  }

  function formatBuiltAt(iso) {
    if (!iso) return '未记录（源码树直接运行）';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try { return d.toLocaleString('zh-CN', { hour12: false }); } catch (_) { return String(iso); }
  }

  function loadSettingsAbout(force) {
    if (aboutState === 'loading') return;
    if (aboutState === 'ready' && !force) return;
    aboutState = 'loading';
    setText('settings-about-version', '读取中…');
    setText('settings-about-commit', '读取中…');
    setText('settings-about-built-at', '读取中…');
    var headers = {};
    var token = readApiToken();
    if (token) headers['X-Mineradio-Token'] = token;
    global.fetch('/api/debug/build', { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var build = (data && data.build) || {};
        setText('settings-about-version', 'v' + (build.version || (data && data.version) || '—'));
        var sha = build.commit && build.commit !== 'unknown' ? String(build.commit) : '';
        setText('settings-about-commit', sha ? sha.slice(0, 12) : '—');
        if (sha) el('settings-about-commit').title = sha;
        setText('settings-about-built-at', formatBuiltAt(build.builtAt));
        aboutState = 'ready';
      })
      .catch(function (err) {
        setText('settings-about-version', '读取失败');
        setText('settings-about-commit', '—');
        setText('settings-about-built-at', '接口不可用：' + String(err && err.message || err));
        aboutState = 'idle';
      });
  }

  /* ---------------- 三条杠：快捷开关与摘要 ---------------- */

  function markShortcut(id, on) {
    var node = el(id);
    if (node) node.classList.toggle('on', !!on);
  }

  function shortSummary(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var cut = s.indexOf(' · ');
    return cut > 0 ? s.slice(0, cut) : s;
  }

  function copySummary(fromId, toId) {
    var from = el(fromId);
    var to = el(toId);
    if (!from || !to) return;
    var text = shortSummary(from.textContent);
    if (text && to.textContent !== text) to.textContent = text;
  }

  function syncQuickMenuQuickStates() {
    var state = (typeof fx !== 'undefined') ? fx : null;
    if (!state && global.fx) state = global.fx;
    markShortcut('qm-shortcut-desktopLyrics', state && state.desktopLyrics);
    markShortcut('qm-shortcut-wallpaper', state && state.wallpaperMode);
    // 小组件窗口的可见状态由 30-floating-widget-bridge 维护
    var floatingVisible = false;
    try { floatingVisible = typeof floatingWidgetBridgeVisible !== 'undefined' && !!floatingWidgetBridgeVisible; } catch (_) { }
    markShortcut('qm-shortcut-floating', floatingVisible);
    var panel = el('fx-panel');
    markShortcut('qm-shortcut-fx', !!(panel && (panel.classList.contains('show') || panel.classList.contains('peek'))));
    copySummary('audio-tuning-summary', 'qm-eq-summary');
    copySummary('playback-advanced-summary', 'qm-playback-summary');
    copySummary('track-transition-summary', 'qm-transition-summary');
    copySummary('sleep-timer-remain', 'qm-sleep-summary');
    // 未登录时「退出登录」不该出现
    var logout = el('qm-logout-btn');
    if (logout) {
      var logged = false;
      try { logged = typeof global.hasAnyPlatformLogin === 'function' ? !!global.hasAnyPlatformLogin() : false; } catch (_) { }
      logout.hidden = !logged;
    }
  }

  function startMenuSummaryTick() {
    if (menuSummaryTimer) return;
    menuSummaryTimer = setInterval(syncQuickMenuQuickStates, 2000);
  }

  function stopMenuSummaryTick() {
    if (!menuSummaryTimer) return;
    clearInterval(menuSummaryTimer);
    menuSummaryTimer = 0;
  }

  function bindMenuObserver() {
    if (menuObserverBound || !global.MutationObserver || !document.body) return;
    menuObserverBound = true;
    new global.MutationObserver(function () {
      var open = document.body.classList.contains('player-quick-menu-open');
      if (open === lastMenuOpen) return;
      lastMenuOpen = open;
      if (open) {
        syncQuickMenuQuickStates();
        startMenuSummaryTick();
      } else {
        stopMenuSummaryTick();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------------- 退出 ---------------- */

  function quitMineradioFromMenu() {
    closeSettingsPage();
    if (typeof global.closePlayerQuickMenu === 'function') {
      try { global.closePlayerQuickMenu(); } catch (_) { }
    }
    try {
      if (global.desktopWindow && typeof global.desktopWindow.close === 'function') {
        global.desktopWindow.close('exit');
        return;
      }
    } catch (_) { }
    try { global.close(); } catch (_) { }
  }

  /* ---------------- 初始化 ---------------- */

  function onSearchInput(e) {
    var value = e && e.target ? e.target.value : '';
    var wrap = el('settings-search-wrap');
    if (wrap) wrap.classList.toggle('has-value', !!String(value || '').trim());
    renderSearchResults(value);
  }

  function bindSettingsPage() {
    var tabs = el('settings-tabs');
    if (tabs && !tabs._settingsBound) {
      tabs._settingsBound = true;
      tabs.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-settings-tab]') : null;
        if (!btn) return;
        setSettingsPageTab(btn.getAttribute('data-settings-tab'));
      });
    }
    var input = el('settings-search-input');
    if (input && !input._settingsBound) {
      input._settingsBound = true;
      input.addEventListener('input', onSearchInput);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          clearSettingsSearch();
        }
        if (e.key === 'Enter') {
          var first = document.querySelector('#settings-search-results .settings-search-result');
          if (first) first.click();
        }
      });
      input.addEventListener('focus', function () {
        if (input.value.trim()) renderSearchResults(input.value);
      });
    }
    // 点空白收掉搜索结果，但别把设置页关掉
    document.addEventListener('click', function (e) {
      var wrap = el('settings-search-wrap');
      if (!wrap || !wrap.contains(e.target)) hideSearchResults();
    }, true);

    // 跳转行是 div（沿用全站写法），补一个键盘回车/空格的等价操作
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var row = e.target && e.target.closest ? e.target.closest('#settings-modal .st-link-row') : null;
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!document.body.classList.contains('settings-page-open')) return;
      var about = el('about-modal');
      if (about && about.classList.contains('show')) return;
      var update = el('update-modal');
      if (update && update.classList.contains('modal-mask') && global.getComputedStyle(update).display !== 'none') return;
      closeSettingsPage();
    });

    bindMenuObserver();
    bindStartupControls();
    bindSourcesPage();
    hookSourcesStateRefresh();
    bindHotkeySection();
    bindSettingsBackup();
    bindLyricGranularity();
    bindMotionReduce();
    bindAiSettings();
    bindTheme();
    if (typeof global.updateAiLyricTranslateToggle === 'function') {
      try { global.updateAiLyricTranslateToggle(); } catch (_) { }
    }
    if (typeof global.applyGlobalLyricTimingOffsetUi === 'function') {
      try { global.applyGlobalLyricTimingOffsetUi(); } catch (_) { }
    }
    if (typeof global.applyShuffleNoRepeatUi === 'function') {
      try { global.applyShuffleNoRepeatUi(); } catch (_) { }
    }
    if (typeof global.applyUpdatePrefsUi === 'function') {
      try { global.applyUpdatePrefsUi(); } catch (_) { }
    }
    bindPreventSleepMediaEvents();
    syncPreventSleepToggle();
    // audio 元素由播放链在就绪后创建，这里先排一次，避免设置开着但没人通知主进程
    global.setTimeout(applyPreventSleep, 1500);
    if (document.body && document.body.classList.contains('player-quick-menu-open')) {
      syncQuickMenuQuickStates();
      startMenuSummaryTick();
    }
  }

  global.openSettingsPage = openSettingsPage;
  global.closeSettingsPage = closeSettingsPage;
  global.closeSettingsPageIfMask = closeSettingsPageIfMask;
  global.setSettingsPageTab = setSettingsPageTab;
  global.clearSettingsSearch = clearSettingsSearch;
  global.syncQuickMenuQuickStates = syncQuickMenuQuickStates;
  global.quitMineradioFromMenu = quitMineradioFromMenu;
  global.loadSettingsAbout = loadSettingsAbout;
  global.togglePreventSleep = togglePreventSleep;
  global.syncPreventSleepToggle = syncPreventSleepToggle;
  global.applyPreventSleep = applyPreventSleep;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSettingsPage);
  } else {
    bindSettingsPage();
  }
})(window);
