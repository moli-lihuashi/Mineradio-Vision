'use strict';

// ============================================================
//  Global State
// ============================================================
var audio = null, audioCtx = null, source = null, analyser = null, beatAnalyser = null, gainNode = null, audioReady = false;
var uiSfxCtx = null, lastShelfSelectSfxAt = 0;
var FFT_SIZE = 2048;
var frequencyData = new Uint8Array(FFT_SIZE / 2);
var timeDomainData = new Uint8Array(FFT_SIZE);
var BEAT_FFT_SIZE = 2048;
var beatFrequencyData = new Uint8Array(BEAT_FFT_SIZE / 2);
var beatTimeDomainData = new Uint8Array(BEAT_FFT_SIZE);
var bass = 0, mid = 0, treble = 0, audioEnergy = 0, beatPulse = 0, prevEnergy = 0;
var lyricSunEnergy = 0, lyricSunTarget = 0, lyricSunHold = 0, lyricSunAvg = 0, lyricSunPeak = 0.55;
var smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
var bassPeak = 0.12, midPeak = 0.10, treblePeak = 0.08, energyPeak = 0.10;
var beatOnsetFlag = false;        // beat 上升沿瞬时标志,每帧消费一次
var lastStrongDrop = 0;           // 用于 burst 预设的强 drop 时刻
var beatGlowIntensity = 0;        // 鼓点全局反馈：边缘光晕强度 0..1
var beatGlowEl = null;            // #beat-glow-overlay 元素缓存
var beatGlowCoverRGB = '143,233,255';  // 封面主色 RGB 字符串，随封面更新
var presetTransitionOverlayEl = null;  // #preset-transition-overlay 元素缓存（预设转场闪光）
// 缩略图脉动元素缓存 + 上次缩放值，避免每帧 getElementById 与重复字符串写入
var _thumbCoverEl = null;
var _thumbCoverLastScaleStr = '';
// ripple 颜色解析缓存：仅在颜色源变化时重新 parseColorToHex
var _rippleTintCache = { hex: null, norm: null };
// 专辑封面情绪映射：根据封面主色暖冷/明度自动调节粒子运动基调与色彩饱和
// warmth 0..1（暖→1），brightness 0..1（亮→1），energy 0..1（活跃→1）
var coverMood = { warmth:0.5, brightness:0.5, energy:0.5, applied:false };

var lyricsLines = [], lyricsTransLines = [], lyricsTranslationLines = [], lyricsVisible = false, lyricsHasNativeKaraoke = false, lyricsTimingSource = 'none';
var playlist = [], playQueue = [], currentIdx = -1, playing = false, playToggleBusy = false;
var searchMode = 'song', podcastResults = [], podcastPrograms = [], podcastCurrentRadio = null;
var loginStatus = { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
var qqLoginStatus = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0 };
var kugouLoginStatus = { provider: 'kugou', loggedIn: false, preview: true, nickname: '酷狗音乐', userId: '', avatar: '', vipType: 0 };
var qqLoginAutoRefreshTimer = null;
var qqLoginWasLoggedIn = false;
var kugouLoginWasLoggedIn = false;
var loginProvider = 'netease';
var activeAccountProvider = 'netease';
var dualAccountMode = false;
var qqCookieBusy = false;
var neteaseWebLoginBusy = false;
var qqWebLoginBusy = false;
var kugouWebLoginBusy = false;
var qqManualCookieOpen = false;
var SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43879/callback';
var SPOTIFY_DEVELOPER_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
var spotifyLoginStatus = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', avatar: '', product: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false };
var spotifyConfigBusy = false;
var spotifyOAuthBusy = false;
var spotifyLoginWasLoggedIn = false;
var spotifyLoginAutoRefreshTimer = null;
var loginStatusChecked = false, loginStatusCheckFailed = false;
var startupLoginStatusPromise = null;
Mineradio.auth.configure({
  onNeteaseSynced: function(info) {
    loginStatus = info || loginStatus;
    loginStatusChecked = true;
    loginStatusCheckFailed = false;
  },
  onQQSynced: function(info) {
    qqLoginStatus = Mineradio.auth.normalizeQQ(info);
  },
  onKugouSynced: function(info) {
    kugouLoginStatus = Mineradio.auth.normalizeKugou(info);
  },
  onAllSynced: function(payload) {
    loginStatus = payload.netease || loginStatus;
    qqLoginStatus = payload.qq || qqLoginStatus;
    kugouLoginStatus = payload.kugou || kugouLoginStatus;
    if (!Mineradio.auth.hasLogin(activeAccountProvider)) activeAccountProvider = Mineradio.auth.firstLoggedProvider(activeAccountProvider);
    renderUserBtn();
    if (typeof refreshQishuiLoginStatus === 'function') {
      refreshQishuiLoginStatus().then(function () {
        if (typeof startQishuiLoginStatusAutoRefresh === 'function') startQishuiLoginStatusAutoRefresh();
        renderUserBtn();
      }).catch(function () {});
    }
    if (typeof refreshSpotifyLoginStatus === 'function') {
      refreshSpotifyLoginStatus().catch(function () {});
    }
  }
});
var qrPollTimer = null, qrKey = null;
var volumeTween = null, trackSwitchToken = 0;
var audioFadeTimer = null, audioElementFadeFrame = 0, audioFadeSerial = 0;
var AUDIO_FADE_IN_MS = 460;
var AUDIO_FADE_OUT_MS = 420;
var AUDIO_SILENCE_GAIN = 0.0001;
// 播放中途卡顿 / 长暂停后重新取链恢复
var playbackResumeRecovery = {
  serial: 0,
  pending: false,
  lastAttemptAt: 0,
  lastReason: '',
  pausedAt: 0,
  pausedSongKey: '',
  pausedSrc: '',
  pausedPosition: 0,
  freshUrlSongKey: '',
  freshUrlAttemptCount: 0,
  softRetryCount: 0,
  buffering: false,
  timerIds: []
};
var PLAYBACK_RESUME_STALL_DELAYS = [1600, 3600];
var PLAYBACK_RESUME_LONG_PAUSE_MS = 8 * 60 * 1000;
var PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS = {
  qishui: 3 * 60 * 1000,
  qq: 8 * 60 * 1000,
  kugou: 8 * 60 * 1000,
  netease: 12 * 60 * 1000,
  spotify: 8 * 60 * 1000
};
// AudioWorklet：从 PCM 自算 FFT（真离主线程）；失败自动回退主线程路径
var ENABLE_AUDIO_WORKLET_ANALYSIS = true;
// row-layers：3.2.11 Step D 默开；一次性 force_3210 清 force_326 的 '0'；?lyricRows=0 / localStorage=0 / eco 可退
var ENABLE_LYRIC_ROW_LAYERS = (function () {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('mineradio_lyric_row_layers_force_3210') !== '1') {
        localStorage.setItem('mineradio_lyric_row_layers', '1');
        localStorage.setItem('mineradio_lyric_row_layers_force_3210', '1');
        localStorage.removeItem('mineradio_lyric_row_layers_force_326');
        localStorage.removeItem('mineradio_lyric_row_layers_force_325');
        localStorage.removeItem('mineradio_lyric_row_layers_force_322');
      }
      var stored = localStorage.getItem('mineradio_lyric_row_layers');
      if (stored === '0' || stored === 'false') return false;
      if (stored === '1' || stored === 'true') return true;
    }
  } catch (_) {}
  try {
    var q = (typeof location !== 'undefined' && location.search) || '';
    if (q.indexOf('lyricRows=0') >= 0) return false;
    if (q.indexOf('lyricRows=1') >= 0) return true;
  } catch (_) {}
  return true;
})();
/** fail-open 后本会话不再进 track，避免切行又空白 */
var STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
var userPlaylists = [], qqPlaylists = [], kugouPlaylists = [], qishuiPlaylists = [], spotifyPlaylists = [], myPodcastCollections = [], myPodcastItems = {}, playlistCoverCache = {};
var playlistCatalogRevision = 0;
var CUSTOM_COVER_STORE_KEY = 'mineradio-custom-covers';
var CUSTOM_LYRIC_STORE_KEY = 'mineradio-custom-lyrics-v1';
var CUSTOM_LYRIC_PREF_STORE_KEY = 'mineradio-custom-lyric-prefs-v1';
var LYRIC_LAYOUT_STORE_KEY = 'mineradio-lyric-layout-v1';
var VISUAL_PRESET_SCHEMA = 'skull-preset-v2';
var VISUAL_PRESET_MAX_INDEX = 11;
var PLAYBACK_QUALITY_STORE_KEY = 'mineradio-playback-quality-v1';
var SLEEP_TIMER_STORE_KEY = 'mineradio-sleep-timer-v1';
var PLAYBACK_SESSION_STORE_KEY = 'mineradio-playback-session-v1';
var sleepTimer = {
  active: false,
  endsAt: 0,
  durationMin: 30,
  finishSong: false,
  closeApp: false,
  pendingStop: false,
  tickTimer: null,
  lastUiAt: 0
};
var playbackSessionRestoreAttempted = false;
var playbackSessionSaveTimer = 0;
var UPLOAD_TIP_STORE_KEY = 'mineradio-upload-tip-seen';
var DIY_MODE_STORE_KEY = 'mineradio-diy-player-mode-v1';
var PLAYLIST_PANEL_PIN_STORE_KEY = 'mineradio-playlist-panel-pinned-v1';
var USER_CAPSULE_AUTO_HIDE_STORE_KEY = 'mineradio-user-capsule-auto-hide-v1';
var FX_FAB_AUTO_HIDE_STORE_KEY = 'mineradio-fx-fab-auto-hide-v1';
var CONTROLS_AUTO_HIDE_STORE_KEY = 'mineradio-controls-auto-hide-v1';
var FREE_CAMERA_STORE_KEY = 'mineradio-free-camera-v1';
var HOTKEY_SETTINGS_STORE_KEY = 'mineradio-hotkey-settings-v1';
var VISUAL_GUIDE_SEEN_STORE_KEY = 'mineradio-visual-guide-seen-v2';
var LOCAL_BEATMAP_STORE_KEY = 'mineradio-local-beatmaps-v1';
var LOCAL_BEAT_PREF_STORE_KEY = 'mineradio-local-beatmap-prefs-v1';
var LOCAL_BEAT_COMBOS = ['', 'downbeat', 'push', 'drop', 'rebound', 'accent'];
var HOTKEY_ACTIONS = [
  { key:'togglePlay', label:'播放 / 暂停', category:'播放', local:'Space', global:'Ctrl+Alt+Space' },
  { key:'prevTrack', label:'上一首', category:'播放', local:'ArrowLeft', global:'Ctrl+Alt+ArrowLeft' },
  { key:'nextTrack', label:'下一首', category:'播放', local:'ArrowRight', global:'Ctrl+Alt+ArrowRight' },
  { key:'volumeUp', label:'音量增加', category:'音量', local:'ArrowUp', global:'Ctrl+Alt+ArrowUp' },
  { key:'volumeDown', label:'音量降低', category:'音量', local:'ArrowDown', global:'Ctrl+Alt+ArrowDown' },
  { key:'toggleFullscreen', label:'全屏', category:'窗口', local:'KeyF', global:'Ctrl+Alt+KeyF' },
  { key:'toggleDesktopLyrics', label:'桌面歌词', category:'歌词', local:'Alt+KeyL', global:'Ctrl+Alt+KeyL' }
];
var hotkeyCaptureState = null;
var hotkeyGlobalStatus = {};
var diyPlayerMode = readDiyModePreference();
var customCoverMap = readCustomCoverMap();
var customLyricMap = readCustomLyricMap();
var customLyricPrefs = readCustomLyricPrefs();
var localBeatMapCache = readLocalBeatMapCache();
var localBeatMapPrefs = readLocalBeatPrefs();
var playbackQuality = readPlaybackQualityPreference();
var qqPlaybackQualityCeiling = '';
var coverCropState = null, coverCropBound = false;
var currentLocalSong = null;
var lyricSourceMode = 'original';
var originalLyricsState = { lines: [], hasNativeKaraoke: false, timingSource: 'none', translationLines: [], translationSource: 'none' };
var localBeatAnalysis = { song:null, audioUrl:'', mode:'mr', active:false, token:0 };
var likedSongMap = {}, likeBusyMap = {}, likeStatusToken = 0;
var collectTargetSong = null, collectBusy = false;
var uploadTipTimer = null, uploadTipAttempts = 0;
var visualGuideActive = false, visualGuideStep = 0, visualGuideResizeBound = false;
var visualGuideState = { bottomWasVisible: false, searchWasPeek: false, manual: false };
var emptyHomeActive = false;
var homeForcedOpen = false;
var homeSuppressed = false;
var homeDiscoverState = { loading: false, loaded: false, loggedIn: false, mode: 'starter', songs: [], playlists: [], podcasts: [], error: '', updatedAt: 0 };
var homeDiscoverToken = 0;
var homeVisualPresetActive = false;
var homeVisualPrevPreset = 0;
var HOME_LISTEN_STATS_KEY = 'mineradio-listen-stats-v1';
var HOME_WEATHER_CITY_KEY = 'mineradio-weather-city';
var HOME_WEATHER_MANUAL_KEY = 'mineradio-weather-city-manual-v1';
var HOME_WEATHER_LOCATE_KEY = 'mineradio-weather-locate-v1';
var homeWeatherAutoLocateAttempted = false;
var homeWeatherLabelResolveAttempted = 0;
var homeWeatherRadioState = { loading: false, loaded: false, city: localStorage.getItem(HOME_WEATHER_CITY_KEY) || '上海', weather: null, radio: null, error: '', updatedAt: 0 };
var homeSceneRadioState = { loading: false, loaded: false, sceneId: '', weather: null, radio: null, error: '', updatedAt: 0 };
var scenePresentationSnapshot = null;
var scenePresetsBootstrapped = false;
var SCENE_RESUME_HINT_KEY = 'mineradio-scene-resume-hint-v1';
var homeWeatherToken = 0;
var homeWeatherLoadTimer = null;
var homePresetLayerSnapshot = null;
var homeWeatherLoadPromise = null;
var homeRadioStartBusy = false;
var activeRadioContext = null;
var listenStatsState = loadListenStatsState();
var listenSession = null;
var appPerfMarks = [];
function markAppPerf(name) {
  try {
    var value = performance.now();
    appPerfMarks.push({ name: name, value: Math.round(value) });
    if (performance && performance.mark) performance.mark('mineradio:' + name);
    if (appPerfMarks.length <= 16) console.debug('[MineradioPerf]', name, Math.round(value) + 'ms');
  } catch (e) {}
}
markAppPerf('script-start');
function installStartupLongTaskObserver() {
  try {
    if (!('PerformanceObserver' in window)) return;
    var observer = new PerformanceObserver(function(list){
      list.getEntries().forEach(function(entry){
        if (entry.startTime > 15000) return;
        console.debug('[MineradioPerf] longtask', Math.round(entry.startTime) + 'ms', Math.round(entry.duration) + 'ms');
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
    setTimeout(function(){ try { observer.disconnect(); } catch (e) {} }, 16000);
  } catch (e) {}
}
installStartupLongTaskObserver();