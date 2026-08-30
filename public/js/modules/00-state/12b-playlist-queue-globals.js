var queueViewTab = 'queue', playMode = 'loop', miniQueueOpen = false;
var miniQueueRenderSeq = 0, queueRenderSeq = 0, playlistRenderSeq = 0;
var queuePanelDirty = false;
var PLAYLIST_PANEL_BATCH_SIZE = 28;
var playlistPanelRenderLimit = PLAYLIST_PANEL_BATCH_SIZE;
var playlistPanelLazyBound = false;
var PLAYLIST_DETAIL_INITIAL_RENDER = 64;
var PLAYLIST_DETAIL_BATCH_SIZE = 48;
var PLAYLIST_DETAIL_ROW_STEP = 56;
var PLAYLIST_DETAIL_VIRTUAL_OVERSCAN = 7;
var PLAYLIST_DETAIL_OUTER_CHROME_HEIGHT = 142;
var PLAYLIST_DETAIL_OUTER_FOOTER_HEIGHT = 44;
var playlistPanelDetailVirtualState = { raf: 0 };
// 队列虚拟化：行高 ≈ padding+封面+gap（.queue-list gap:6 / .queue-item ~54）
var QUEUE_ROW_STEP = 60;
var QUEUE_VIRTUAL_OVERSCAN = 8;
var MINI_QUEUE_ROW_STEP = 58;
var MINI_QUEUE_VIRTUAL_OVERSCAN = 6;
var queueVirtualState = { raf: 0, start: -1, end: -1 };
var miniQueueVirtualState = { raf: 0, start: -1, end: -1 };
var smoothWheelScrollBound = false;
var coverProcessToken = 0, aiDepthPipeline = null, aiDepthReady = false, aiDepthBusy = false, aiDepthFailUntil = 0;
var coverDepthCache = Object.create(null), coverDepthCacheKeys = [];
var aiDepthLastRunAt = 0, aiDepthMinGapMs = 18000;
var updatePreviewState = {
  visible: false,
  open: false,
  status: 'idle',
  progress: 0,
  timer: null,
  pollTimer: null,
  downloadJobId: '',
  patchJobId: '',
  mode: 'installer',
  installerPath: '',
  installerOpened: false,
  cached: false,
  currentVersion: '0.9.11',
  version: '1.1.0',
  configured: false,
  preview: true,
  updateAvailable: false,
  releaseUrl: '',
  downloadUrl: '',
  patchAvailable: false,
  patchUrl: '',
  received: 0,
  total: 0,
  speedBps: 0,
  etaSeconds: 0,
  sourceLabel: '',
  attempt: 0,
  attempts: 0,
  errorReason: '',
  errorDetail: '',
  failedAttempts: [],
  message: '',
  restartRequired: false,
  patchFallbackTried: false,
  hero: '当前版本，更新检测已就绪。',
  notes: [
    '安装包文字对比修复',
    '安装目录可自由选择',
    '单实例与快捷方式修复'
  ]
};