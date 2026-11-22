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

var SKIN_TABS = ['heart', 'scene', 'pet', 'spectrum', 'widget', 'glass'];
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

function setSkinPageTab(tab, keepScroll) {
  var next = SKIN_TABS.indexOf(tab) >= 0 ? tab : 'heart';
  skinPageTab = next;
  var tabs = document.querySelectorAll('#skin-tabs [data-skin-tab]');
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].getAttribute('data-skin-tab') === next;
    tabs[i].classList.toggle('active', on);
    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  var pages = document.querySelectorAll('#skin-popover .skin-page');
  for (var j = 0; j < pages.length; j++) {
    pages[j].classList.toggle('active', pages[j].getAttribute('data-skin-page') === next);
  }
  if (!keepScroll) {
    var body = document.getElementById('skin-body');
    if (body) body.scrollTop = 0;
  }
  // 切到玻璃页时重新量一次滑块填充（隐藏页 clientWidth 为 0，算出来是空的）
  if (next === 'glass' && window.MineradioPrismalChrome && typeof window.MineradioPrismalChrome.syncFills === 'function') {
    try { window.MineradioPrismalChrome.syncFills(); } catch (_) { }
  }
  // 导入按钮已删：进宠物页就把宠物库展开，离开时收回
  if (next === 'pet') openSkinPetDex();
  else closeSkinPetDex();
  if (next === 'glass') syncSkinGlassPreview();
  if (next === 'widget') {
    refreshSkinWidgetStatus();
    // 首次进入才向主进程要快照；之后靠 onSettingsState 的回推刷新
    if (typeof mountInlineWidgetFrame === 'function') mountInlineWidgetFrame();
  }
}

/* 挂件页的状态行：直接问主进程窗口是否可见 */
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
  setSkinPageTab(skinPageTab, true);
  /* 6 格由 05d 渲染：打开时才渲染，省一次 boot 期 DOM 操作；
     已渲染过就只同步选中态，不重建（重建会打断正在播的预览）。 */
  if (typeof syncHeartFxGrid === 'function') syncHeartFxGrid();
  /* 演出一格由 06f 渲染（模块在主波末尾，比本文件晚），同样 typeof 兜住 */
  if (typeof syncHeartSceneGrid === 'function') syncHeartSceneGrid();
  /* 控制条频谱四格由 05f 渲染（同在延迟波、排在本文件之后），同样 typeof 兜住 */
  if (typeof syncBarSpectrumGrid === 'function') syncBarSpectrumGrid();
  if (skinPageTab === 'widget') {
    refreshSkinWidgetStatus();
    if (typeof mountInlineWidgetFrame === 'function') mountInlineWidgetFrame();
  }
}

/* 从别处直达某个分页（三条杠的「小组件样式」等）：没开就先开，再切页。 */
/* 玻璃页的实时预览：调参数时面板挡着 Home 卡片，用户看不到自己在改什么。
 * 这里用与 applyHomeLiquidGlassConfig 完全相同的换算（blurAmount→px、saturation→倍数、
 * brightness→亮度）把样品画出来，折射 / 色散 / 高光 / 厚度 / 染色 / 投影走 CSS 变量。
 * 纯 2D + backdrop-filter：不建 WebGL 上下文，也没有 requestAnimationFrame。 */
function syncSkinGlassPreview() {
  var sample = document.getElementById('skin-glass-sample');
  if (!sample) return;
  var cfg = null;
  try {
    if (typeof getLiquidGlassConfigFromFx === 'function' && typeof applyLiquidGlassProfile === 'function') {
      cfg = applyLiquidGlassProfile(getLiquidGlassConfigFromFx(), 'home');
    }
  } catch (_) { }
  if (!cfg) return;
  var num = function (v, fallback) { return isFinite(Number(v)) ? Number(v) : fallback; };
  var blur = num(cfg.blurAmount, 0.7);
  var sat = num(cfg.saturation, 0.34);
  var bri = num(cfg.brightness, 0.04);
  // 预览舞台只有 150px 高，直接用面板尺度的 px 会把背景糊平；按 .45 缩一档，既看得出模糊又不丢结构
  var blurPx = Math.round((6 + blur * 24) * 0.45);
  var satMul = (1 + sat * 2).toFixed(2);
  var briMul = (0.94 + bri).toFixed(2);
  var filter = 'blur(' + blurPx + 'px) saturate(' + satMul + ') brightness(' + briMul + ')';
  sample.style.setProperty('backdrop-filter', filter);
  sample.style.setProperty('-webkit-backdrop-filter', filter);
  // 必须带 px：CSS 里是 calc(14px + var(--pv-bevel) * .5)，长度加无单位数字是非法表达式，整条 border-radius 会被丢掉
  sample.style.setProperty('--pv-bevel', num(cfg.zRadius, 10) + 'px');
  sample.style.setProperty('--pv-highlight', String(num(cfg.edgeHighlight, 0.12)));
  sample.style.setProperty('--pv-tint', String(num(cfg.tintStrength, 0)));
  sample.style.setProperty('--pv-shadow', String(num(cfg.shadowOpacity, 0.42)));
  sample.style.setProperty('--pv-shadowspread', String(num(cfg.shadowSpread, 22)));
  sample.style.setProperty('--pv-aberration', String(num(cfg.chromAberration, 0)));
  sample.style.setProperty('--pv-refraction', String(num(cfg.refraction, 0.18)));
  var meta = document.getElementById('skin-glass-meta');
  if (meta) {
    meta.textContent = '模糊 ' + blurPx + 'px · 饱和 ' + satMul + ' · 亮度 ' + briMul +
      ' · 折射 ' + num(cfg.refraction, 0.18).toFixed(2) +
      ' · 色散 ' + num(cfg.chromAberration, 0).toFixed(2);
  }
}

/* 面板关掉就把 backdrop-filter 摘掉：合成器不会再采样背后的内容。
 * 元素本身还有 display:none 兜底，这里是第二层保险。 */
function stopSkinGlassPreview() {
  var sample = document.getElementById('skin-glass-sample');
  if (!sample) return;
  sample.style.removeProperty('backdrop-filter');
  sample.style.removeProperty('-webkit-backdrop-filter');
}

/* Petdex 宠物库原来是首页上的一个全屏浮层（#home-pet-dex，fixed + 遮罩），
 * 从皮肤面板宠物页点「从 Petdex 导入」时它被面板盖住，看不见。
 * 这里把那个浮层整块移进面板的槽位，样式由 .in-skin-panel 改写成内嵌块；
 * 关闭面板/切走时连同原来的位置一起还原（它的监听都绑在元素自己身上，move 不会丢）。 */
var skinPetDexHome = null;

function openSkinPetDex() {
  var deck = document.getElementById('home-pet-dex');
  var slot = document.getElementById('skin-pet-dex-slot');
  if (!deck || !slot) return false;
  if (!skinPetDexHome) skinPetDexHome = { parent: deck.parentNode, next: deck.nextSibling };
  if (deck.parentNode !== slot) slot.appendChild(deck);
  deck.classList.add('in-skin-panel');
  deck.hidden = false;
  if (typeof HomePetPetdex !== 'undefined' && HomePetPetdex && typeof HomePetPetdex.openPanel === 'function') {
    try { HomePetPetdex.openPanel(); } catch (_) { }
  }
  return true;
}

function closeSkinPetDex() {
  var deck = document.getElementById('home-pet-dex');
  if (!deck || !deck.classList.contains('in-skin-panel')) return;
  if (typeof HomePetPetdex !== 'undefined' && HomePetPetdex && typeof HomePetPetdex.closePanel === 'function') {
    try { HomePetPetdex.closePanel(); } catch (_) { }
  }
  deck.classList.remove('in-skin-panel');
  if (skinPetDexHome && skinPetDexHome.parent) {
    if (skinPetDexHome.next && skinPetDexHome.next.parentNode === skinPetDexHome.parent) {
      skinPetDexHome.parent.insertBefore(deck, skinPetDexHome.next);
    } else {
      skinPetDexHome.parent.appendChild(deck);
    }
  }
  skinPetDexHome = null;
}

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
  // 关窗之后不能再留 GPU 采样
  stopSkinGlassPreview();
  // Petdex 浮层搬回首页原位
  closeSkinPetDex();
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
  var popRoot = skinPopoverEl();
  if (popRoot) popRoot.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id.indexOf('fx-liquidglass') !== 0 && t.id !== 'fx-glassaberration') return;
    syncSkinGlassPreview();
  });
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
    if (skinPageTab === 'glass' && window.MineradioPrismalChrome && typeof window.MineradioPrismalChrome.syncFills === 'function') {
      try { window.MineradioPrismalChrome.syncFills(); } catch (_) { }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSkinPopover);
} else {
  bindSkinPopover();
}
