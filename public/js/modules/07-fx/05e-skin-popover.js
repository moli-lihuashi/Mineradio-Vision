// ====================================================================
//  顶栏「皮肤」弹层（T 恤按钮）
//  ------------------------------------------------------------------
//  和「播放选项」是兄弟弹层：同一层级、同一套玻璃材质、互斥打开。
//  红心动效六格现在是唯一入口：视觉控制台「外观」页那一组已按用户要求删除，
//  所以「皮肤」弹层同时管「点亮红心时怎么呈现」和后面几个皮肤区块。
//
//  为什么 6 格由 05d 用 JS 渲染、这里只管外壳：
//  选中的档位只有一份真值（fx.heartFx），渲染与同步都按 .heart-fx-grid 遍历，
//  不写死 id；弹层打开时调 syncHeartFxGrid() 懒渲染，已渲染过就只刷选中态，
//  不会打断正在播的预览。这里只负责开关、定位、互斥与关闭手势。
//
//  定位：跟着被点的那颗按钮走（顶栏 #skin-btn / 全屏 #skin-btn-fs 共用本函数），
//  用 inline style 写 top/right，避免和 body.desktop-shell 那套 top 覆盖打架。
// ====================================================================

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

function positionSkinPopover(anchor) {
  var pop = skinPopoverEl();
  if (!pop) return;
  var btn = (anchor && anchor.getBoundingClientRect)
    ? anchor
    : (document.getElementById('skin-btn') || document.getElementById('skin-btn-fs'));
  var rect = (btn && btn.getBoundingClientRect) ? btn.getBoundingClientRect() : null;
  var top = 24;
  var right = 24;
  if (rect && rect.width > 0) {
    top = Math.round(rect.bottom + 8);
    right = Math.round(Math.max(12, window.innerWidth - rect.right));
  }
  pop.style.top = top + 'px';
  pop.style.right = right + 'px';
  pop.style.left = 'auto';
  pop.style.bottom = 'auto';
}

function toggleSkinPopover(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  var opening = !document.body.classList.contains('skin-popover-open');
  document.body.classList.toggle('skin-popover-open', opening);
  syncSkinPopoverTriggers(opening);
  if (!opening) return;
  /* 兄弟弹层互斥：播放选项开着时点皮肤，先把播放选项收掉，别让两块玻璃叠着。
     00b 在主波、本模块在延迟波，typeof 兜住加载时序。 */
  if (typeof closePlayerQuickMenu === 'function') closePlayerQuickMenu();
  positionSkinPopover(e && e.currentTarget);
  /* 6 格由 05d 渲染：打开时才渲染，省一次 boot 期 DOM 操作；
     已渲染过就只同步选中态，不重建（重建会打断正在播的预览）。 */
  if (typeof syncHeartFxGrid === 'function') syncHeartFxGrid();
  /* 演出一格由 06f 渲染（模块在主波末尾，比本文件晚），同样 typeof 兜住 */
  if (typeof syncHeartSceneGrid === 'function') syncHeartSceneGrid();
  /* 控制条频谱四格由 05f 渲染（同在延迟波、排在本文件之后），同样 typeof 兜住 */
  if (typeof syncBarSpectrumGrid === 'function') syncBarSpectrumGrid();
}

function closeSkinPopover() {
  if (!document.body.classList.contains('skin-popover-open')) return;
  document.body.classList.remove('skin-popover-open');
  syncSkinPopoverTriggers(false);
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
  window.addEventListener('resize', function () {
    if (!document.body.classList.contains('skin-popover-open')) return;
    positionSkinPopover();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSkinPopover);
} else {
  bindSkinPopover();
}
