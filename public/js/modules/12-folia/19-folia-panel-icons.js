/* 听歌档案面板 · 按钮图标升级（2026-11-25）
 *
 * 模组自己画的那批内联 SVG 是 16×16 网格、路径手写，和项目其他地方的
 * Lucide/morphicons 图标不是一套。这里把它们统一成 morphicons 的 24×24 图标。
 *
 * 复用项目已有的 window.Morphicons（public/vendor/morphicons/morphicons.global.js，
 * 控制台播放/音量/循环已用它做 spring morph），不引第二份库。
 *
 * 为什么改属性而不是换节点：这些 svg 由模组自己的 React 管理，替换节点会在下一次
 * render 时让 React 抛 removeChild / insertBefore；而 viewBox 与 path 的 d 在它的
 * vdom 里是常量，React 不会回写。所以只改这两个属性 + 绑定 morph 实例。
 *
 * 匹配方式是「原 path 的 d 字符串」精确命中 —— 模组写死的常量，比按类名猜稳。
 */
'use strict';

var foliaPanelIconMap = {
  /* chevron-down：来源下拉 */
  'm4 6 4 4 4-4': { name: 'chevron-down', d: 'm6 9 6 6 6-6' },
  /* chevron-right / left：上一周期 / 下一周期 */
  'm9 5 7 7-7 7': { name: 'chevron-right', d: 'm9 18 7-7-7-7' },
  'm15 5-7 7 7 7': { name: 'chevron-left', d: 'm15 18-7-7 7-7' },
  /* 关闭 */
  'm6 6 12 12M6 18 18 6': { name: 'x', d: 'M18 6 6 18M6 6l12 12' },
  /* 播放三角 */
  'M4 2.5 13 8l-9 5.5Z': { name: 'play', d: 'M8 5 19 12 8 19Z' },
  /* 加入队列的加号 */
  'M8 2v12M2 8h12': { name: 'plus', d: 'M5 12h14M12 5v14' },
  /* 设置齿轮 */
  'm12 3 2 3 4 .5.5 4 2.5 2-2.5 2-.5 4-4 .5-2 3-2-3-4-.5-.5-4L2 12.5l2.5-2 .5-4L9 6Z': {
    name: 'settings',
    d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z'
  },
  /* 对勾（已选/完成态） */
  'm5 12 4 4L20 5': { name: 'check', d: 'M20 6 9 17l-5-5' },
  /* 时钟表针：原图标只有针没有圈，补上外圈 */
  'M12 7v5l3 2': { name: 'clock', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2' }
};

var foliaPanelIconState = {
  insts: new WeakMap(),   // pathEl -> morph 实例
  observed: false,
  timer: 0,
  count: 0
};

function foliaPanelUpgradeSvg(svg) {
  if (!svg || svg.getAttribute('data-mi') === 'up') return false;
  var path = svg.querySelector('path');
  if (!path) return false;
  var key = String(path.getAttribute('d') || '');
  var spec = foliaPanelIconMap[key];
  if (!spec) return false;

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('data-mi', 'up');
  svg.setAttribute('data-mi-name', spec.name);
  /* 16 网格上的 1px 描边搬到 24 网格会显得更细，抬到 1.7 才和周围文字同重 */
  if (!svg.getAttribute('stroke-width')) svg.setAttribute('stroke-width', '1.7');
  path.setAttribute('d', spec.d);

  if (window.Morphicons && typeof window.Morphicons.createMorph === 'function') {
    try { foliaPanelIconState.insts.set(path, window.Morphicons.createMorph(path, spec.d)); }
    catch (err) { console.warn('[FoliaPanelIcons] createMorph failed:', err); }
  }
  return true;
}

/* 模组的排行画布会按「可视区域能放多少格」把格子铺满，每格用 index % 数据数 取数据。
 * 只有 1 首歌时就是同一张卡拉 85 遍（实测），看起来像重复 bug。
 * 这里不动它的渲染逻辑（改取模会让 React 越界崩），只在 DOM 层把重复位次隐藏：
 * 每个 .canvas-cell 的 data-rank 就是数据位次，同位次只留第一格。 */
function foliaPanelDedupeCards() {
  var canvas = document.querySelector('#folia-panel .archive-canvas');
  if (!canvas) return 0;
  var cells = canvas.querySelectorAll('.canvas-cell');
  if (!cells.length) return 0;

  /* 第一格不等于可见格：画布有相机位移，填充是从可视区外两格开始铺的，
   * 直接「保留第一个」会把屏幕上的卡藏掉、留下屏幕外那张（实测卡片区全空）。
   * 所以按 data-rank 分组，优先保留与画布可视区相交的那一格。 */
  var box = canvas.getBoundingClientRect();
  var groups = Object.create(null);
  for (var i = 0; i < cells.length; i++) {
    var rank = cells[i].getAttribute('data-rank');
    if (!rank) continue;
    (groups[rank] || (groups[rank] = [])).push(cells[i]);
  }

  var hidden = 0;
  Object.keys(groups).forEach(function (rank) {
    var list = groups[rank];
    var keep = null;
    for (var k = 0; k < list.length; k++) {
      var rect = list[k].getBoundingClientRect();
      if (rect.right > box.left + 4 && rect.left < box.right - 4
        && rect.bottom > box.top + 4 && rect.top < box.bottom - 4) { keep = list[k]; break; }
    }
    if (!keep) keep = list[0];
    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      if (el === keep) { if (el.style.display === 'none') el.style.display = ''; }
      else if (el.style.display !== 'none') { el.style.display = 'none'; hidden++; }
    }
  });
  return hidden;
}

/* 扫一遍面板里的 svg。返回本次升级数量（0 表示没有新图标）。 */
function foliaPanelUpgradeIcons(root) {
  var panel = root || document.getElementById('folia-panel');
  if (!panel) return 0;
  var list = panel.querySelectorAll('svg');
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    if (foliaPanelUpgradeSvg(list[i])) n++;
  }
  if (n) {
    foliaPanelIconState.count += n;
    console.log('[FoliaPanelIcons] 升级图标', n, '个（累计', foliaPanelIconState.count + '）');
  }
  return n;
}

/* React 每次重渲染列表都会插回原始 svg，所以要盯着。防抖 60ms，
 * 且只观察 #folia-panel 子树的新增节点，不做全量重扫。 */
function foliaPanelObserveIcons() {
  if (foliaPanelIconState.observed) return;
  var panel = document.getElementById('folia-panel');
  if (!panel || typeof MutationObserver !== 'function') return;
  foliaPanelIconState.observed = true;
  var observer = new MutationObserver(function () {
    /* 画布滚动/换维度都会持续增删格子，不做命中筛选：统一防抖后一起去重 + 补图标。
     * 60ms 内合并，滚动时最多 16 次/秒，去重本身是几次 getAttribute，开销可忽略。 */
    if (foliaPanelIconState.timer) clearTimeout(foliaPanelIconState.timer);
    foliaPanelIconState.timer = setTimeout(function () {
      foliaPanelIconState.timer = 0;
      foliaPanelDedupeCards();
      foliaPanelUpgradeIcons();
    }, 60);
  });
  observer.observe(panel, { childList: true, subtree: true });
  foliaPanelIconState.observer = observer;
}

function foliaPanelStartIcons() {
  foliaPanelUpgradeIcons();
  foliaPanelObserveIcons();
  foliaPanelDedupeCards();
}

window.foliaPanelUpgradeIcons = foliaPanelUpgradeIcons;
window.foliaPanelDedupeCards = foliaPanelDedupeCards;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', foliaPanelStartIcons, { once: true });
} else {
  foliaPanelStartIcons();
}
