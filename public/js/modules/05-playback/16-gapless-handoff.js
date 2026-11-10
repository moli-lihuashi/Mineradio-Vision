// ============================================================
//  独立「无缝衔接」Gapless Handoff
// ------------------------------------------------------------
//  与 Cuefield AutoMix 完全无关的一套机制，本文件不引用也不修改 05-cuefield/*
//  下的任何逻辑。对标酷狗的 gapless_playback + audio_preload 行为模型：
//
//    1) 曲末窗口内提前解析下一首播放地址（省掉最慢的 /api/song/url 往返）；
//    2) 用一个隐藏 <audio> 静音预热媒体字节，只 load() 不 play()；
//    3) 当前曲 onended 之后才由既有 nextTrack → playQueueAt 链路交接，
//       新曲走原有的淡入，旧曲由 scheduleTrackEndFade 曲末淡出。
//
//  ★ 全程只有一个音源在发声：预热元素 muted=true / volume=0 / 永不 play()，
//    因此不会出现「歌还在唱下一首自己叠进来」。这是曲末交接，不是交叉淡入。
//
//  边界：浏览器 <audio> 是黑盒解码，无法裁 encoder delay / padding，
//  所以这是「预加载 + 曲末交接近无缝」，不是采样级 gapless。
// ============================================================

var GAPLESS_HANDOFF_STORE_KEY = 'mineradio-gapless-handoff-v1';
var GAPLESS_HANDOFF_TICK_MS = 420;
var GAPLESS_HANDOFF_LEAD_SEC = 18;          // 曲末 18s 起开始预载
var GAPLESS_HANDOFF_MIN_REMAIN_SEC = 2.5;   // 太贴近 ended 不再发起新请求
var GAPLESS_HANDOFF_TTL_MS = 120000;        // 预取地址 2 分钟后视为过期（签名 URL）

var gaplessHandoffEnabled = gaplessHandoffReadPreference();
var gaplessHandoffState = {
  serial: 0,            // 作废在途预取
  token: -1,            // 曲目代（仅用于轮询自检清理，不作为消费硬校验）
  targetIndex: -1,
  targetKey: '',
  data: null,           // resolveProviderPlayUrlData 的结果
  proxyUrl: '',
  pending: false,
  ready: false,
  readyAt: 0,
  blockedKey: '',       // 本曲预取失败后不再重试，避免曲末反复打接口
  lastError: '',
  media: null,          // 隐藏预热元素，永不 play()
  warmedUrl: ''
};
var gaplessHandoffBoundMedia = null;
var gaplessHandoffTimer = 0;
var gaplessHandoffUiText = '';
/* 只读的开关变更序号。18-track-transition 会代开本功能，并凭这个序号判断
 * 「代开之后用户有没有自己动过开关」——动过就不再越权还原。 */
var gaplessHandoffToggleCount = 0;

/* 预载窗口衡量的是「距曲末还剩多少真实时间可以用来打接口」，
   所以要把媒体秒换算成墙钟秒；变速 1.5x 时不用换算会让窗口凭空缩水三分之一。 */
function gaplessHandoffWallRate() {
  if (typeof Mineradio !== 'undefined' && Mineradio.playbackAdvanced
      && typeof Mineradio.playbackAdvanced.getRate === 'function') {
    var r = Number(Mineradio.playbackAdvanced.getRate());
    if (isFinite(r) && r > 0) return r;
  }
  return 1;
}
function gaplessHandoffLeadSec() {
  if (typeof Mineradio !== 'undefined' && Mineradio.playbackAdvanced
      && typeof Mineradio.playbackAdvanced.getGaplessLeadSec === 'function') {
    var v = Number(Mineradio.playbackAdvanced.getGaplessLeadSec());
    if (isFinite(v) && v > 0) return v;
  }
  return GAPLESS_HANDOFF_LEAD_SEC;
}

function gaplessHandoffReadPreference() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(GAPLESS_HANDOFF_STORE_KEY) === '1';
    }
  } catch (_) {}
  return false;   // 默认关闭：不改变任何既有播放行为
}

function gaplessHandoffPersistPreference(value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GAPLESS_HANDOFF_STORE_KEY, value ? '1' : '0');
    }
  } catch (_) {}
}

/* Cuefield 开着时本功能整体让路：两套衔接逻辑同时跑只会互相抢增益。
 * 注意这里只读 Cuefield 的公开开关，不写它、不改它、不重置它。 */
function gaplessHandoffBlockedReason() {
  if (typeof cuefieldAutoMixEnabled !== 'undefined' && cuefieldAutoMixEnabled) return 'cuefield';
  if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return 'cuefield-running';
  if (typeof sleepTimer !== 'undefined' && sleepTimer && sleepTimer.pendingStop) return 'sleep-timer';
  return '';
}

function gaplessHandoffNextIndex() {
  if (typeof playQueue === 'undefined' || !playQueue || playQueue.length < 2) return -1;
  if (typeof currentIdx !== 'number' || !isFinite(currentIdx) || currentIdx < 0 || currentIdx >= playQueue.length) return -1;
  // shuffle 的下一首是随机的、single 会重播当前曲：两者都无法提前确定目标
  if (typeof playMode !== 'undefined' && (playMode === 'shuffle' || playMode === 'single')) return -1;
  return (currentIdx + 1) % playQueue.length;
}

function gaplessHandoffReset(reason) {
  var s = gaplessHandoffState;
  s.serial++;
  s.token = -1;
  s.targetIndex = -1;
  s.targetKey = '';
  s.data = null;
  s.proxyUrl = '';
  s.pending = false;
  s.ready = false;
  s.readyAt = 0;
  s.blockedKey = '';
  s.lastError = String(reason || '');
  // 刻意保留 s.media / s.warmedUrl：预热过的字节留在浏览器缓存里给切歌复用
}

function gaplessHandoffStillValid(serial) {
  return gaplessHandoffEnabled
    && serial === gaplessHandoffState.serial
    && !gaplessHandoffBlockedReason();
}

function gaplessHandoffFail(serial, key, reason) {
  if (serial !== gaplessHandoffState.serial) return;
  var s = gaplessHandoffState;
  s.pending = false;
  s.ready = false;
  s.data = null;
  s.blockedKey = key;
  s.lastError = String(reason || 'prefetch-failed');
  gaplessHandoffUpdateUi();
}

/* 隐藏 <audio> 只负责把媒体字节提前拉进浏览器缓存。
 * muted + volume=0 是双保险：即便将来有别的逻辑扫到这个元素，它也不可闻。
 * 永远不调用 play() —— 这是「绝不重叠」的硬约束。 */
function gaplessHandoffWarm(url) {
  var s = gaplessHandoffState;
  if (!url || s.warmedUrl === url || typeof Audio === 'undefined') return false;
  var media = s.media;
  if (!media) {
    try { media = new Audio(); } catch (_) { return false; }
    try {
      media.preload = 'auto';
      media.muted = true;
      media.volume = 0;
      media.crossOrigin = 'anonymous';
    } catch (_) {}
    s.media = media;
  }
  try {
    media.src = url;
    s.warmedUrl = url;
    media.load();
    return true;
  } catch (_) {
    return false;
  }
}

function gaplessHandoffStart(idx, song, key) {
  var s = gaplessHandoffState;
  var serial = ++s.serial;
  s.pending = true;
  s.ready = false;
  s.data = null;
  s.proxyUrl = '';
  s.targetIndex = idx;
  s.targetKey = key;
  s.token = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : -1;
  s.lastError = '';
  gaplessHandoffUpdateUi();

  // 本地曲库：不存在取址往返，只把媒体字节提前预热
  var isLocal = !!(song && (song.localUrl || song.type === 'local' || song.source === 'local'));
  if (isLocal) {
    var localUrl = String((song && song.localUrl) || '');
    if (localUrl) gaplessHandoffWarm(localUrl);
    if (!gaplessHandoffStillValid(serial)) return;
    s.proxyUrl = localUrl;
    s.ready = true;
    s.pending = false;
    s.readyAt = Date.now();
    gaplessHandoffUpdateUi();
    return;
  }

  var resolvePromise = null;
  try {
    if (typeof resolveProviderPlayUrlData === 'function') {
      resolvePromise = resolveProviderPlayUrlData(song, {});
    }
  } catch (_) {
    resolvePromise = null;
  }
  if (!resolvePromise) {
    gaplessHandoffFail(serial, key, 'no-url-resolver');
    return;
  }

  Promise.resolve(resolvePromise).then(function (data) {
    if (!gaplessHandoffStillValid(serial)) return;
    if (!data || !data.url) {
      gaplessHandoffFail(serial, key, 'no-url');
      return;
    }
    // 用与正式播放完全相同的代理 URL 生成方式预热，保证缓存键一致
    var proxyPromise = (typeof Mineradio !== 'undefined' && Mineradio.api && Mineradio.api.apiMediaProxyUrlAsync)
      ? Mineradio.api.apiMediaProxyUrlAsync('/api/audio', { url: data.url })
      : Promise.resolve('');
    return Promise.resolve(proxyPromise).then(function (proxyUrl) {
      if (!gaplessHandoffStillValid(serial)) return;
      s.data = data;
      s.proxyUrl = String(proxyUrl || '');
      s.ready = true;
      s.pending = false;
      s.readyAt = Date.now();
      if (s.proxyUrl) gaplessHandoffWarm(s.proxyUrl);
      gaplessHandoffUpdateUi();
    });
  }).catch(function (err) {
    if (!gaplessHandoffStillValid(serial)) return;
    gaplessHandoffFail(serial, key, String((err && err.message) || err || 'prefetch-failed'));
  });
}

function gaplessHandoffMaybePrefetch(media) {
  if (!gaplessHandoffEnabled || !media || media.paused || media.ended) return false;
  if (gaplessHandoffBlockedReason()) return false;
  var s = gaplessHandoffState;
  if (s.pending || s.ready) return false;
  var duration = Number(media.duration);
  var currentTime = Number(media.currentTime);
  if (!isFinite(duration) || duration <= 0 || !isFinite(currentTime)) return false;
  var wallRemain = (duration - currentTime) / gaplessHandoffWallRate();
  if (wallRemain > gaplessHandoffLeadSec() || wallRemain < GAPLESS_HANDOFF_MIN_REMAIN_SEC) return false;
  var idx = gaplessHandoffNextIndex();
  if (idx < 0) return false;
  var song = playQueue[idx];
  var key = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  if (!key || key === s.blockedKey) return false;
  gaplessHandoffStart(idx, song, key);
  return true;
}

/* 主 audio 是复用同一个元素的，但 releaseQueuePlaybackMedia 等路径会换源，
 * 所以每次 tick 都确认绑定目标；timeupdate 事件负责即时触发，tick 只做兜底。 */
function gaplessHandoffEnsureBinding() {
  var media = (typeof audio !== 'undefined' && audio) ? audio : null;
  if (media === gaplessHandoffBoundMedia) return;
  if (gaplessHandoffBoundMedia) {
    try { gaplessHandoffBoundMedia.removeEventListener('timeupdate', gaplessHandoffOnTimeUpdate); } catch (_) {}
  }
  gaplessHandoffBoundMedia = media;
  if (!media) return;
  try { media.addEventListener('timeupdate', gaplessHandoffOnTimeUpdate); } catch (_) {}
}

function gaplessHandoffOnTimeUpdate() {
  gaplessHandoffMaybePrefetch(gaplessHandoffBoundMedia);
  gaplessHandoffUpdateUi();
}

function gaplessHandoffTick() {
  gaplessHandoffEnsureBinding();
  var s = gaplessHandoffState;
  var token = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : -1;
  // 曲目已切换：上一首留下的预载作废（消费成功时 reset 会把 token 置 -1，不会重复清）
  if (s.token >= 0 && s.token !== token) gaplessHandoffReset('track-changed');
  if (!gaplessHandoffEnabled) { gaplessHandoffUpdateUi(); return; }
  var media = (typeof audio !== 'undefined' && audio) ? audio : null;
  if (media) gaplessHandoffMaybePrefetch(media);
  gaplessHandoffUpdateUi();
}

/* 供 13-playback-start-audio.js 在 resolveProviderPlayUrlData 之前调用。
 * 返回的对象会被塞进 opts.preResolvedPlaybackData（这是 provider 层既有的
 * 短路入口，sourceFallbackQueuePlaybackOptions 会自动把它删掉）。
 *
 * 这里不做 token 硬相等校验：playQueueAt 入口已经 trackSwitchToken++，
 * 硬校验会永远失败。安全性由「目标 idx + 目标曲目 key + opts 边界 + TTL」
 * 四重校验保证——用户点了别的歌时 key 不匹配，绝不会拿错地址。 */
function consumeGaplessHandoffPreload(idx, song, opts) {
  var s = gaplessHandoffState;
  opts = opts || {};
  if (!gaplessHandoffEnabled || !s.ready || !s.data || !s.data.url) return null;
  if (opts.preResolvedPlaybackData) return null;
  if (opts.cuefieldAutoMix || opts.qualitySwitch || opts.qualityOverride
      || opts.sourceFallbackRecovery || opts.autoRepeat || opts.resumeRecovery
      || opts.fallbackDepth != null) return null;
  if (!s.readyAt || Date.now() - s.readyAt > GAPLESS_HANDOFF_TTL_MS) return null;
  var key = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  if (!key || key !== s.targetKey) return null;
  if (Number(idx) >= 0 && s.targetIndex >= 0 && Number(idx) !== s.targetIndex) return null;
  var data = s.data;
  gaplessHandoffReset('consumed');
  return data;
}

function toggleGaplessHandoff() {
  gaplessHandoffEnabled = !gaplessHandoffEnabled;
  gaplessHandoffToggleCount++;
  gaplessHandoffPersistPreference(gaplessHandoffEnabled);
  if (!gaplessHandoffEnabled) gaplessHandoffReset('disabled');
  gaplessHandoffUiText = '';
  gaplessHandoffUpdateUi();
  if (typeof showToast === 'function') {
    showToast(gaplessHandoffEnabled
      ? '无缝衔接已开启：预载下一首，当前曲播完才交接，不会重叠'
      : '无缝衔接已关闭');
  }
  return gaplessHandoffEnabled;
}

function gaplessHandoffUpdateUi() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  var button = document.getElementById('quick-menu-gapless-toggle');
  var label = document.getElementById('quick-menu-gapless-status');
  var s = gaplessHandoffState;
  var blocked = gaplessHandoffBlockedReason();
  var text;
  if (!gaplessHandoffEnabled) text = '曲末交接 · 默认关闭';
  else if (blocked === 'cuefield' || blocked === 'cuefield-running') text = 'Cuefield 开启时暂不生效';
  else if (blocked === 'sleep-timer') text = '定时关闭待执行 · 暂停预载';
  else if (s.pending) text = '正在预载下一首…';
  else if (s.ready) text = '下一首已预载 · 曲末交接';
  else text = '已开启 · 等待曲末';
  if (button) {
    button.classList.toggle('on', !!gaplessHandoffEnabled);
    button.setAttribute('aria-pressed', gaplessHandoffEnabled ? 'true' : 'false');
  }
  if (label && text !== gaplessHandoffUiText) {
    label.textContent = text;
    gaplessHandoffUiText = text;
  }
}

function gaplessHandoffStatus() {
  var s = gaplessHandoffState;
  return {
    enabled: !!gaplessHandoffEnabled,
    toggleCount: gaplessHandoffToggleCount,
    blocked: gaplessHandoffBlockedReason(),
    pending: !!s.pending,
    ready: !!s.ready,
    targetIndex: s.targetIndex,
    targetKey: s.targetKey,
    warmed: !!s.warmedUrl,
    warmMediaMuted: !!(s.media && s.media.muted),
    warmMediaPlaying: !!(s.media && !s.media.paused),
    lastError: s.lastError
  };
}

gaplessHandoffTimer = setInterval(gaplessHandoffTick, GAPLESS_HANDOFF_TICK_MS);
gaplessHandoffUpdateUi();
if (typeof window !== 'undefined') {
  window.__mineradioGaplessHandoff = {
    toggle: toggleGaplessHandoff,
    reset: gaplessHandoffReset,
    consume: consumeGaplessHandoffPreload,
    tick: gaplessHandoffTick,
    prefetch: gaplessHandoffMaybePrefetch,
    getStatus: gaplessHandoffStatus
  };
}
