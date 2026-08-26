// ============================================================
//  toast
// ============================================================
var toastTimer = null;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}

var visualGuideSteps = [
  {
    target: 'stage',
    kicker: '01 / Welcome',
    title: 'Mineradio 是用来听歌的视觉播放器',
    body: '它不是单纯歌单页：搜索或导入一首歌后，封面、歌词、粒子和镜头会跟着音乐一起动。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Play',
    title: '从搜索或导入开始',
    body: '输入歌名、歌手或关键词即可播放；如果有本地音乐，也可以用导入入口直接放进舞台。'
  },
  {
    selector: '#bottom-bar',
    kicker: '03 / Control',
    title: '播放以后看底部控制台',
    body: '播放、切歌、进度、队列和歌词都集中在底部，先把它当作一个正常播放器使用就可以。'
  },
  {
    selector: '#user-btn',
    kicker: '04 / Account',
    title: '登录只是为了同步你的音乐库',
    body: '登录后会同步歌单、红心和播客；不登录也可以搜索和播放，不会强制卡住你。'
  },
  {
    target: 'shelf',
    kicker: '05 / Visual',
    title: '进阶视觉都放在舞台周围',
    body: '右侧 3D 歌单架和 DIY 玩家模式是进阶入口；先播放一首歌，再慢慢调视觉效果。'
  },
  {
    selector: '#diy-mode-btn',
    kicker: '06 / DIY',
    title: '高级功能在 DIY 玩家模式',
    body: '视觉控制台、上传/封面、自定义歌词、音质和更多面板都会在这里展开。'
  }
];
var visualGuideStepsDiy = [
  {
    selector: '#diy-mode-btn',
    kicker: '01 / DIY',
    title: 'DIY 玩家模式已展开',
    body: '这里可以随时切回默认模式。DIY 模式会显示完整控制台、上传、视觉面板和高级调参。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Search',
    title: '搜索源和导入入口会展开',
    body: '顶部搜索支持更多来源切换，上传歌曲、封面等入口也会在 DIY 模式中显示。'
  },
  {
    selector: '#playlist-panel',
    kicker: '03 / Library',
    title: '左侧是完整歌单和队列',
    body: '靠近左侧边缘可以打开歌单/队列面板，在这里管理队列、个人歌单和播客。'
  },
  {
    selector: '#fx-panel',
    kicker: '04 / Visual Lab',
    title: '右侧是视觉控制台',
    body: '靠近右下角或点击视觉按钮，可以调节粒子、歌词、镜头、3D 歌单架和更多视觉参数。'
  },
  {
    selector: '#quality-control',
    kicker: '05 / Controls',
    title: '高级播放控制会补全',
    body: '音质、播放顺序、收藏、歌词源和更多按钮会在 DIY 模式中完整显示。'
  },
  {
    target: 'shelf',
    kicker: '06 / Shelf',
    title: '3D 歌单架支持直接打开',
    body: '右侧的 3D 歌单架会在靠近时半透明浮现，点击卡片可打开歌单，点卡片里的播放按钮可直接播放整张歌单。'
  }
];
function activeVisualGuideSteps() {
  return diyPlayerMode ? visualGuideStepsDiy : visualGuideSteps;
}
function visualGuideWasSeen() {
  try { return localStorage.getItem(VISUAL_GUIDE_SEEN_STORE_KEY) === '1'; } catch (e) { return true; }
}
function markVisualGuideSeen() {
  try { localStorage.setItem(VISUAL_GUIDE_SEEN_STORE_KEY, '1'); } catch (e) {}
}
function updateVisualGuideButtonVisibility() {
  var btn = document.getElementById('visual-guide-btn');
  if (!btn) return;
  if (visualGuideWasSeen()) btn.classList.add('visual-guide-btn-hidden');
  else btn.classList.remove('visual-guide-btn-hidden');
}
function maybeRunStartupVisualGuide(source) {
  if (visualGuideWasSeen() || visualGuideActive || immersiveMode || playing) return false;
  if (source !== 'manual' && !hasAnyPlatformLogin()) return false;
  setTimeout(function(){
    if (!visualGuideWasSeen() || source === 'manual') {
      startVisualGuide({ source: source || 'startup' });
      if (source !== 'manual') {
        markVisualGuideSeen();
        updateVisualGuideButtonVisibility();
      }
    }
  }, source === 'splash' ? 3600 : 1400);
  return true;
}
function startVisualGuide(opts) {
  opts = opts || {};
  if (document.body.classList.contains('splash-active')) {
    setTimeout(function(){ startVisualGuide(opts); }, 700);
    return;
  }
  if (immersiveMode) setImmersiveMode(false);
  closeMiniQueue();
  closeUploadTip(false);
  visualGuideActive = true;
  document.body.classList.add('visual-guide-active');
  visualGuideStep = 0;
  visualGuideState = {
    bottomWasVisible: !!(document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('visible')),
    searchWasPeek: !!(document.getElementById('search-area') && document.getElementById('search-area').classList.contains('peek')),
    fxWasPeek: !!(document.getElementById('fx-panel') && document.getElementById('fx-panel').classList.contains('peek')),
    plWasPeek: !!(document.getElementById('playlist-panel') && document.getElementById('playlist-panel').classList.contains('peek')),
    mode: diyPlayerMode ? 'diy' : 'simple',
    manual: !!opts.manual
  };
  var guide = document.getElementById('visual-guide');
  if (guide) {
    guide.classList.add('show');
    guide.setAttribute('aria-hidden', 'false');
  }
  if (!visualGuideResizeBound) {
    visualGuideResizeBound = true;
    window.addEventListener('resize', positionVisualGuideStep);
    window.addEventListener('scroll', positionVisualGuideStep, true);
  }
  showVisualGuideStep(0);
}
function prepareVisualGuideStep(step) {
  var search = document.getElementById('search-area');
  var bottom = document.getElementById('bottom-bar');
  var fxPanel = document.getElementById('fx-panel');
  var playlistPanel = document.getElementById('playlist-panel');
  if (typeof setShelfGuideCueActive === 'function') setShelfGuideCueActive(step && step.target === 'shelf');
  if (step && step.selector === '#search-box') setPeek(search, true, 'search');
  if (step && step.selector === '#playlist-panel') setPeek(playlistPanel, true, 'pl');
  else if (playlistPanel && !visualGuideState.plWasPeek) setPeek(playlistPanel, false, 'pl');
  if (step && step.selector === '#fx-panel') setPeek(fxPanel, true, 'fx');
  else if (fxPanel && !visualGuideState.fxWasPeek) setPeek(fxPanel, false, 'fx');
  if (step && (step.selector === '#bottom-bar' || step.selector === '#mini-queue-btn' || step.selector === '#immersive-btn' || step.selector === '#quality-control')) {
    if (bottom) bottom.classList.add('visible');
    revealBottomControls(1500);
  }
}
function scheduleVisualGuidePositioning() {
  requestAnimationFrame(positionVisualGuideStep);
  setTimeout(positionVisualGuideStep, 180);
  setTimeout(positionVisualGuideStep, 620);
}
function showVisualGuideStep(index) {
  var steps = activeVisualGuideSteps();
  visualGuideStep = Math.max(0, Math.min(steps.length - 1, index));
  var step = steps[visualGuideStep];
  prepareVisualGuideStep(step);
  var title = document.getElementById('visual-guide-title');
  var body = document.getElementById('visual-guide-body');
  var kicker = document.getElementById('visual-guide-kicker');
  var hint = document.getElementById('visual-guide-hint');
  var progress = document.getElementById('visual-guide-progress');
  var next = document.getElementById('visual-guide-next');
  if (title) title.textContent = step.title;
  if (body) body.textContent = step.body;
  if (kicker) kicker.textContent = step.kicker;
  if (hint) hint.textContent = visualGuideStep === steps.length - 1 ? '点击空白处完成引导' : '点击空白处也可以继续';
  if (progress) progress.textContent = (visualGuideStep + 1) + ' / ' + steps.length;
  if (next) next.textContent = visualGuideStep === steps.length - 1 ? '完成' : '下一步';
  scheduleVisualGuidePositioning();
}
function guideTargetRect(step) {
  if (step && step.target === 'stage') {
    var stageW = Math.min(620, Math.max(260, innerWidth - 72));
    var stageH = Math.min(310, Math.max(178, innerHeight * 0.34));
    var stageLeft = innerWidth * 0.5 - stageW * 0.5;
    var stageTop = Math.max(116, innerHeight * 0.32 - stageH * 0.5);
    return { left: stageLeft, top: stageTop, width: stageW, height: stageH, right: stageLeft + stageW, bottom: stageTop + stageH };
  }
  if (step && step.target === 'shelf' && typeof shelfCueRect === 'function') {
    var shelfRect = shelfCueRect();
    var shelfLeft = shelfRect.left;
    var shelfTop = shelfRect.top - 26;
    var shelfRight = Math.min(innerWidth - 12, shelfRect.right + 18);
    var shelfBottom = shelfRect.bottom + 26;
    return { left: shelfLeft, top: shelfTop, width: shelfRight - shelfLeft, height: shelfBottom - shelfTop, right: shelfRight, bottom: shelfBottom };
  }
  if (step && step.selector === '#bottom-bar') {
    var bar = document.getElementById('bottom-bar');
    var progress = document.getElementById('progress-bar');
    var controls = document.getElementById('controls');
    if (bar) {
      var br = bar.getBoundingClientRect();
      var left = br.left, top = br.top, right = br.right, bottom = br.bottom;
      [progress, controls].forEach(function(el){
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      });
      return { left: left, top: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
    }
  }
  var isFullscreenDiyStep = !!(step && step.selector === '#diy-mode-btn' && (desktopRuntimeState.fullscreen || desktopFullscreenActive || document.fullscreenElement || document.body.classList.contains('desktop-fullscreen')));
  var useFullscreenDiyTarget = isFullscreenDiyStep && !shouldSuppressFullscreenDiyPeek();
  if (useFullscreenDiyTarget) {
    layoutFullscreenDiyZone();
    document.body.classList.add('fullscreen-diy-peek');
  }
  var target = step && step.selector ? document.querySelector(useFullscreenDiyTarget ? '#fullscreen-diy-btn' : step.selector) : null;
  if (target) {
    var style = window.getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') return rect;
  }
  if (step && step.selector === '#diy-mode-btn') {
    var fallbackRight = Math.max(116, innerWidth - 26);
    var fallbackTop = 16;
    return { left: fallbackRight - 88, top: fallbackTop, width: 88, height: 38, right: fallbackRight, bottom: fallbackTop + 38 };
  }
  return { left: innerWidth * 0.5 - 120, top: innerHeight * 0.5 - 40, width: 240, height: 80, right: innerWidth * 0.5 + 120, bottom: innerHeight * 0.5 + 40 };
}
function positionVisualGuideStep() {
  if (!visualGuideActive) return;
  var guide = document.getElementById('visual-guide');
  var ring = document.getElementById('visual-guide-ring');
  var card = document.getElementById('visual-guide-card');
  if (!guide || !ring || !card) return;
  var step = activeVisualGuideSteps()[visualGuideStep];
  var rect = guideTargetRect(step);
  ring.classList.toggle('shelf-target', !!(step && step.target === 'shelf'));
  var pad = step && step.target === 'shelf' ? 14 : (step && step.selector === '#bottom-bar' ? 10 : 8);
  var left = Math.max(12, rect.left - pad);
  var top = Math.max(12, rect.top - pad);
  var width = Math.min(innerWidth - left - 12, rect.width + pad * 2);
  var height = Math.min(innerHeight - top - 12, rect.height + pad * 2);
  ring.style.left = left + 'px';
  ring.style.top = top + 'px';
  ring.style.width = Math.max(44, width) + 'px';
  ring.style.height = Math.max(38, height) + 'px';
  ring.style.borderRadius = step && step.target === 'shelf' ? '28px' : ((step && step.selector === '#bottom-bar') ? '20px' : '16px');
  var scrim = guide.querySelector('.visual-guide-scrim');
  if (scrim) {
    scrim.style.setProperty('--gx', ((rect.left + rect.width / 2) / Math.max(1, innerWidth) * 100).toFixed(2) + '%');
    scrim.style.setProperty('--gy', ((rect.top + rect.height / 2) / Math.max(1, innerHeight) * 100).toFixed(2) + '%');
  }
  var cardW = Math.min(326, innerWidth - 32);
  var cardH = card.offsetHeight || 170;
  var cardLeft = rect.left + rect.width / 2 - cardW / 2;
  cardLeft = Math.max(16, Math.min(innerWidth - cardW - 16, cardLeft));
  var below = rect.bottom + 18;
  var above = rect.top - cardH - 18;
  var cardTop = below + cardH < innerHeight - 16 ? below : Math.max(16, above);
  card.style.left = cardLeft + 'px';
  card.style.top = cardTop + 'px';
}
function nextVisualGuideStep() {
  var steps = activeVisualGuideSteps();
  if (visualGuideStep >= steps.length - 1) {
    closeVisualGuide(true);
    return;
  }
  showVisualGuideStep(visualGuideStep + 1);
}
function closeVisualGuide(markSeen) {
  var guide = document.getElementById('visual-guide');
  visualGuideActive = false;
  if (markSeen) {
    markVisualGuideSeen();
    updateVisualGuideButtonVisibility();
  }
  if (guide) {
    guide.classList.remove('show');
    guide.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('visual-guide-active');
  document.body.classList.remove('fullscreen-diy-peek');
  var search = document.getElementById('search-area');
  var bottom = document.getElementById('bottom-bar');
  var fxPanel = document.getElementById('fx-panel');
  var playlistPanel = document.getElementById('playlist-panel');
  if (typeof setShelfGuideCueActive === 'function') setShelfGuideCueActive(false);
  if (search && !visualGuideState.searchWasPeek && document.activeElement !== $input) setPeek(search, false, 'search');
  if (fxPanel && !visualGuideState.fxWasPeek) setPeek(fxPanel, false, 'fx');
  if (playlistPanel && !visualGuideState.plWasPeek) setPeek(playlistPanel, false, 'pl');
  if (bottom && !visualGuideState.bottomWasVisible && !playing) bottom.classList.remove('visible', 'soft-hidden');
}
function handleVisualGuideSurfaceClick(e) {
  if (!visualGuideActive) return;
  if (e && e.target && e.target.closest && e.target.closest('button')) return;
  if (e && e.preventDefault) e.preventDefault();
  nextVisualGuideStep();
}
(function bindVisualGuideSurfaceClick(){
  var guide = document.getElementById('visual-guide');
  if (guide) guide.addEventListener('click', handleVisualGuideSurfaceClick);
})();
