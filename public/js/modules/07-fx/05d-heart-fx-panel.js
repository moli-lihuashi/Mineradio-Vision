// ====================================================================
//  红心动效 · 六格并排预览（唯一宿主：顶栏皮肤弹层）
//  ------------------------------------------------------------------
//  视觉控制台「外观」页那一组 #heart-fx-grid 已按用户要求删除；
//  现在只剩 #skin-heart-fx-grid（由 05e 负责开关与懒渲染），
//  选中态真值仍是一份 fx.heartFx。
//  六格是「随机 / 纸片扇 / 油墨 / 冲击波 / 星芒 / 关闭」，不用下拉：
//  点哪格 = 选中哪套 + 就地用格子里那颗心把动效放一遍，选和看是同一个动作。
//  动效本体在 05-playback/06e-heart-fx.js，这里只负责渲染 + 写存档 + 触发预览。
//
//  为什么仍用 JS 渲染而不是写死在 index.html：
//  由同一份逻辑生成格子，宿主增减时不会出现两套走样的 DOM；
//  遍历仍按 class 而不是写死 id（历史上有过两个宿主，别把这条经验丢掉）。
// ====================================================================

var HEART_FX_TILE_META = [
  ['random', '随机', '每首换一套'],
  ['folia', '纸片扇', 'Folia 楔形'],
  ['riso', '油墨', '灌色 + 半调'],
  ['ring', '冲击波', '环 + 粒子'],
  ['star', '星芒', '380ms'],
  ['off', '关闭', '只变色']
];

function heartFxTileHeartMarkup() {
  // 路径常量在 05-playback/06e 里，先于本模块加载；兜底写空串只是防御，正常不会走到。
  var d = typeof HEART_FX_HEART_PATH === 'string' ? HEART_FX_HEART_PATH : '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"></path></svg>';
}

/* 6 格现在只有一个宿主：顶栏皮肤弹层里的 #skin-heart-fx-grid。
 * 同一个 fx.heartFx 只能有一份选中态，渲染与同步继续按 class 遍历所有宿主，
 * 不写死某一个 id（保留这条经验，将来加减宿主不会走样）。 */
function heartFxGridHosts() {
  return Array.prototype.slice.call(document.querySelectorAll('.heart-fx-grid'));
}

function renderHeartFxGrid() {
  var hosts = heartFxGridHosts();
  if (!hosts.length) return;
  var active = typeof heartFxConfiguredMode === 'function' ? heartFxConfiguredMode() : 'random';
  var mark = heartFxTileHeartMarkup();
  var html = HEART_FX_TILE_META.map(function (row) {
    var on = row[0] === active;
    return '<button type="button" class="heart-fx-tile' + (on ? ' active' : '') + '"' +
      ' data-heart-fx="' + row[0] + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
      ' title="' + row[1] + ' · ' + row[2] + '"' +
      ' onclick="pickHeartFx(\'' + row[0] + '\', this)">' +
      '<span class="hfx-host">' + mark + '</span>' +
      '<span class="hfx-name">' + row[1] + '</span>' +
      '<span class="hfx-sub">' + row[2] + '</span>' +
      '</button>';
  }).join('');
  hosts.forEach(function (grid) { grid.innerHTML = html; });
}

/* 选中态同步：两个宿主一份真值，永远一起改 */
function paintHeartFxSelection(mode) {
  heartFxGridHosts().forEach(function (grid) {
    Array.prototype.forEach.call(grid.querySelectorAll('.heart-fx-tile'), function (tile) {
      var on = tile.getAttribute('data-heart-fx') === mode;
      tile.classList.toggle('active', on);
      tile.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
}

function pickHeartFx(mode, btn) {
  if (HEART_FX_MODES.indexOf(mode) < 0 && mode !== 'off') return;
  try {
    if (typeof fx !== 'undefined' && fx) fx.heartFx = mode;
    saveLyricLayout();
  } catch (err) {
    console.warn('[heartFx] save failed:', err);
  }
  paintHeartFxSelection(mode);
  // 就地预览：锚点用格子里那颗心，幅度缩到 0.55，别让粒子飞出面板
  var host = btn && btn.querySelector ? btn.querySelector('.hfx-host') : null;
  if (host && mode !== 'off' && typeof heartFxPlay === 'function') {
    heartFxPlay(host, { mode: mode, scale: 0.55, preview: true });
  }
}

/* 打开「外观」页 / 皮肤弹层时调用；已渲染就只同步选中态，不重建 DOM（重建会打断正在播的预览） */
function syncHeartFxGrid() {
  var hosts = heartFxGridHosts();
  if (!hosts.length) return;
  var missing = hosts.some(function (grid) { return !grid.childElementCount; });
  if (missing) {
    renderHeartFxGrid();
    return;
  }
  paintHeartFxSelection(typeof heartFxConfiguredMode === 'function' ? heartFxConfiguredMode() : 'random');
}
