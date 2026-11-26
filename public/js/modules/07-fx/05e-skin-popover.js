// ====================================================================
//  顶栏「皮肤与外观」（T 恤按钮）
//  ------------------------------------------------------------------
//  2026-11-23 从 296px 弹层升级成整屏面板（对齐酷狗「装扮中心」）：
//  标题 + 一行 tab + 分页，六个分页是 红心 / 收藏演出 / 桌面宠物 / 控制条频谱 /
//  挂件 / 玻璃。卡片容器 id 沿用原来的，渲染由 05d / 06f / 05f / 16c 负责，
//  本文件只管外壳：开合、tab、互斥、遮罩点击。
//
//  为什么「挂件」和「玻璃」放在这里：这两个是外观类需求 —— 挂件是桌面上那扇窗，
//  玻璃是 Home 卡片/控制台/面板的质感参数（原先散在视觉控制台「外观」页）。
//  视觉控制台因此只剩画面预设与歌词。
// ====================================================================

var SKIN_TABS = ['heart', 'scene', 'pet', 'spectrum', 'widget'];
var skinPageTab = 'heart';

function skinPopoverEl() {
  return document.getElementById('skin-popover');
}

function syncSkinPopoverTriggers(opening) {
  ['skin-btn', 'skin-btn-fs'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', !!opening);
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
}

/* 全屏面板不再跟着按钮定位；把旧弹层写的 inline top/right 清掉，
 * 否则 #skin-popover 会被钉在按钮下方而不是铺满窗口。 */
function positionSkinPopover() {
  var pop = skinPopoverEl();
  if (!pop) return;
  pop.style.top = '';
  pop.style.right = '';
  pop.style.left = '';
  pop.style.bottom = '';
}

var skinSpyBound = false;
var skinSpySuppressUntil = 0;

function skinBodyEl() {
  return document.getElementById('skin-body');
}

function skinPageSection(tab) {
  var body = skinBodyEl();
  if (!body) return null;
  return body.querySelector('.skin-page[data-skin-page="' + tab + '"]');
}

/* 只改左导航的选中态，不触发滚动/加载 —— 滚动高亮和点击跳转都复用它 */
function applySkinTabActive(tab) {
  if (!tab) return;
  skinPageTab = tab;
  var tabs = document.querySelectorAll('#skin-tabs [data-skin-tab]');
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].getAttribute('data-skin-tab') === tab;
    tabs[i].classList.toggle('active', on);
    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

/* 把某一段滚到 .skin-body 顶部。
 * 必须自己算偏移：scrollIntoView 会连外层窗口一起滚（fixed 面板里会整页跳）。 */
function scrollSkinBodyToSection(tab, instant) {
  var body = skinBodyEl();
  var section = skinPageSection(tab);
  if (!body || !section) return;
  var top = section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  // 跳转后 ~700ms 内先屏蔽滚动高亮，否则平滑滚动途中会一节一节地闪
  skinSpySuppressUntil = Date.now() + 700;
  var target = Math.max(0, top - 8);
  try {
    if (instant) body.scrollTop = target;
    else body.scrollTo({ top: target, behavior: 'smooth' });
  } catch (_) {
    body.scrollTop = target;
  }
}

/* 滚动高亮：以「距容器顶部 96px」为判定线，取最后一个越过它的分段 */
function syncSkinTabFromScroll() {
  var body = skinBodyEl();
  if (!body) return;
  var sections = body.querySelectorAll('.skin-page');
  if (!sections.length) return;
  var line = body.scrollTop + 96;
  var current = sections[0];
  for (var i = 0; i < sections.length; i++) {
    var top = sections[i].getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    if (top <= line) current = sections[i];
  }
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
    current = sections[sections.length - 1];
  }
  var tab = current.getAttribute('data-skin-page');
  if (tab && tab !== skinPageTab) applySkinTabActive(tab);
}

function bindSkinScrollSpy() {
  var body = skinBodyEl();
  if (!body || skinSpyBound) return;
  skinSpyBound = true;
  body.addEventListener('scroll', function () {
    if (Date.now() < skinSpySuppressUntil) return;
    syncSkinTabFromScroll();
  }, { passive: true });
}

/* 兼容旧调用：切某一段 = 高亮 + 滚过去；keepScroll=true 表示「只高亮不滚」（打开面板时用） */
function setSkinPageTab(tab, keepScroll) {
  var next = SKIN_TABS.indexOf(tab) >= 0 ? tab : 'heart';
  applySkinTabActive(next);
  if (!keepScroll) scrollSkinBodyToSection(next);
  // 导入按钮已删：宠物库在面板打开时就已经展开（见 toggleSkinPopover）
  if (next === 'pet' && typeof openSkinPetDex === 'function') openSkinPetDex();
}

function refreshSkinWidgetStatus() {
  var el = document.getElementById('skin-widget-status');
  if (!el) return;
  var host = null;
  try {
    if (typeof desktopWindow !== 'undefined' && desktopWindow && desktopWindow.floatingWidget) host = desktopWindow.floatingWidget;
  } catch (_) { }
  if (!host || typeof host.status !== 'function') {
    el.textContent = '仅桌面客户端可用';
    el.classList.remove('on');
    return;
  }
  host.status().then(function (res) {
    var visible = !!(res && res.visible);
    el.textContent = visible
      ? ('已开启' + (res && res.alwaysOnTop ? ' · 已置顶' : '') + ' · 可拖到桌面任意位置')
      : '未开启 · 开启后是一个独立小窗，不影响播放器窗口';
    el.classList.toggle('on', visible);
  }).catch(function () {
    el.textContent = '状态读取失败';
    el.classList.remove('on');
  });
}

/* 点遮罩关闭：面板内部的点击由 shell 吞掉，只有落在 #skin-popover 本身才算点空白 */
function handleSkinOverlayClick(event) {
  if (!event || !event.target) return;
  if (event.target.id === 'skin-popover') closeSkinPopover();
}

function toggleSkinPopover(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  var opening = !document.body.classList.contains('skin-popover-open');
  document.body.classList.toggle('skin-popover-open', opening);
  syncSkinPopoverTriggers(opening);
  if (!opening) return;
  /* 兄弟浮层互斥：播放选项、设置页开着时都先收掉，别让两层玻璃叠着。 */
  if (typeof closePlayerQuickMenu === 'function') closePlayerQuickMenu();
  if (typeof closeSettingsPage === 'function') closeSettingsPage();
  positionSkinPopover();
  bindSkinScrollSpy();
  /* 合并成长页后所有分段同时可见：宠物库、小组件状态与 iframe 都要在打开时就位，
   * 不能等到「切到那一页」才加载，否则滚到那一节会看到空白。 */
  if (typeof openSkinPetDex === 'function') openSkinPetDex();
  refreshSkinWidgetStatus();
  if (typeof mountInlineWidgetFrame === 'function') mountInlineWidgetFrame();
  applySkinTabActive(SKIN_TABS.indexOf(skinPageTab) >= 0 ? skinPageTab : 'heart');
  var body = skinBodyEl();
  if (body) body.scrollTop = 0;
  /* 6 格由 05d 渲染：打开时才渲染，省一次 boot 期 DOM 操作；
     已渲染过就只同步选中态，不重建（重建会打断正在播的预览）。 */
  if (typeof syncHeartFxGrid === 'function') syncHeartFxGrid();
  /* 演出一格由 06f 渲染（模块在主波末尾，比本文件晚），同样 typeof 兜住 */
  if (typeof syncHeartSceneGrid === 'function') syncHeartSceneGrid();
  /* 控制条频谱四格由 05f 渲染（同在延迟波、排在本文件之后），同样 typeof 兜住 */
  if (typeof syncBarSpectrumGrid === 'function') syncBarSpectrumGrid();
}

/* 从别处直达某个分页（三条杠的「小组件样式」等）：没开就先开，再切页。 */
function openSkinPage(tab) {
  if (!document.body.classList.contains('skin-popover-open')) {
    toggleSkinPopover();
  }
  setSkinPageTab(tab || 'heart');
}

function closeSkinPopover() {
  if (!document.body.classList.contains('skin-popover-open')) return;
  document.body.classList.remove('skin-popover-open');
  syncSkinPopoverTriggers(false);
  // Petdex 浮层搬回首页原位（这个函数在仓库里已不存在，typeof 兜住，别再抛 ReferenceError）
  if (typeof closeSkinPetDex === 'function') closeSkinPetDex();
}

function closeSkinPopoverUnless(target) {
  if (!document.body.classList.contains('skin-popover-open')) return;
  var pop = skinPopoverEl();
  if (pop && pop.contains(target)) return;
  var btn = document.getElementById('skin-btn');
  var btnFs = document.getElementById('skin-btn-fs');
  if ((btn && btn.contains(target)) || (btnFs && btnFs.contains(target))) return;
  closeSkinPopover();
}

function bindSkinPopover() {
  document.addEventListener('click', function (e) {
    closeSkinPopoverUnless(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSkinPopover();
  });
  /* 玻璃页的参数滑块：拖动时实时重画预览（委托到面板根节点） */
  var tabs = document.getElementById('skin-tabs');
  if (tabs && !tabs._skinTabsBound) {
    tabs._skinTabsBound = true;
    tabs.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-skin-tab]') : null;
      if (!btn) return;
      setSkinPageTab(btn.getAttribute('data-skin-tab'));
    });
  }
  window.addEventListener('resize', function () {
    if (!document.body.classList.contains('skin-popover-open')) return;
    // 尺寸变化后各段位置全变了，重算一次当前高亮
    if (Date.now() >= skinSpySuppressUntil) syncSkinTabFromScroll();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSkinPopover);
} else {
  bindSkinPopover();
}
