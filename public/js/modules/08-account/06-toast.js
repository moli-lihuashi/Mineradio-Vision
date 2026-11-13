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

// 新手引导（2026-11-13 重写）
// 旧版停在「搜索 / 底栏 / 登录 / 3D 歌单架 / DIY」五件老事上，这一批新增的
// 平台推荐 + 平台能力面板、我的歌单（本地库/爱心星标）、播放受限说明都没提到。
// 现在按「找歌 → 平台推荐 → 我的音乐 → 控制台 → 账号 → 进阶」重排，每步一句话。
// 说明：selector 必须指向真实可见元素，找不到时 guideTargetRect 会回落到屏幕中央，
// 所以这里只写启动空场下一定存在的入口。
var visualGuideSteps = [
  {
    target: 'stage',
    kicker: '01 / 你好',
    title: 'Mineradio 是「边听边看」的播放器',
    body: '搜索或导入一首歌之后，封面、歌词、粒子和镜头会跟着音乐动起来。下面几处是新手最常用的入口。'
  },
  {
    selector: '#search-box',
    kicker: '02 / 找歌',
    title: '顶部搜索，多平台一起找',
    body: '输入歌名、歌手或关键词就能播放。同一首歌会给出多个平台版本，哪家能播就用哪家；本地文件也能直接拖进窗口。'
  },
  {
    selector: '.home-card[data-card-id="discover"]',
    kicker: '03 / 平台推荐',
    title: '四个平台的热门集中在这里',
    body: '「平台推荐」里可以看网易云、汽水、酷狗、Spotify 的热门与个性化推荐；底部的「平台能力」还能直接调各家的歌单、会员与推荐功能。'
  },
  {
    selector: '.home-card[data-card-id="library"]',
    kicker: '04 / 我的音乐',
    title: '登录后的歌单都在「我的歌单」',
    body: '各平台歌单、红心和播客集中在一处。没有封面的歌单会显示爱心或星标；本地音乐也能从这里的「导入歌单」进来。'
  },
  {
    selector: '#bottom-bar',
    kicker: '05 / 播放控制',
    title: '播放以后看底部控制台',
    body: '播放、切歌、进度、音量、音质、队列和歌词都在底部。歌曲需要登录或会员才能播时，这里会直接写明原因，不会只剩一个 0:00。'
  },
  {
    selector: '#user-btn',
    kicker: '06 / 账号',
    title: '登录只为同步，不登录也能听',
    body: '登录后同步歌单、红心、播客和会员状态；不登录照样搜索播放，只是有些平台的曲目会提示需要登录。'
  },
  {
    selector: '#diy-mode-btn',
    kicker: '07 / 进阶',
    title: '视觉与歌词动效在 DIY 模式',
    body: '右侧视觉控制台、3D 歌单架、歌词排版和镜头都在 DIY 模式下展开，随时可以切回简洁界面。'
  }
];
var visualGuideStepsDiy = [
  {
    selector: '#diy-mode-btn',
    kicker: '01 / DIY',
    title: 'DIY 玩家模式已展开',
    body: '这里可以随时切回默认模式。DIY 会显示完整控制台、上传入口、视觉面板和高级调参。'
  },
  {
    selector: '#search-box',
    kicker: '02 / 搜索',
    title: '搜索源和导入入口会展开',
    body: '顶部搜索支持更多来源切换，上传歌曲、替换封面等入口也只在 DIY 模式里出现。'
  },
  {
    selector: '#playlist-panel',
    kicker: '03 / 音乐库',
    title: '左侧是完整歌单和队列',
    body: '靠近左侧边缘可以打开歌单/队列面板：管理队列、各平台歌单、本地音乐（「导入歌单」）和播客。'
  },
  {
    selector: '#fx-panel',
    kicker: '04 / 视觉控制台',
    title: '右侧是视觉与歌词工作台',
    body: '粒子、歌词排版与配色、镜头、3D 歌单架等参数都在这里调；改坏了可以随时载入预设。'
  },
  {
    selector: '#quality-control',
    kicker: '05 / 播放控制',
    title: '高级播放控制会补全',
    body: '音质、播放顺序、收藏、歌词源和更多按钮会在 DIY 模式中完整显示。'
  },
  {
    target: 'shelf',
    kicker: '06 / 歌单架',
    title: '3D 歌单架支持直接打开',
    body: '右侧 3D 歌单架会在靠近时半透明浮现，点击卡片打开歌单，卡片里的播放按钮可以直接播放整张。'
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
  // 看过就收起入口 —— 产品有意如此（首启提示一次即可，不让「?」长期占位）。
  // 需要重看的用户仍然可以在看过之后手动执行 startVisualGuide({ manual: true })。
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
