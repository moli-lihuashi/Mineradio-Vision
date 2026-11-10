/* Folia 世界 — 歌词样式：静止（still）
 *
 * 移植自 Folia src/components/visualizer/still/VisualizerStill.tsx。
 * 行为完全对齐：
 *   - 上/中/下三行，当前行 40px 不透明，其余 30px 透明度 0.3
 *   - 译文：当前 24px / 0.8，其余 20px / 0.3
 *   - 空行占 80px 高度（Folia 的 h-20）
 *   - 四周径向暗角（radial-gradient，透明度 0.65）
 *   - 不挂背景（Folia 的 renderBackground={false}）
 * 差异：React 固定字号改为受主题字体栈与字重影响；per-frame 只在「行/配色/字体/译文」
 * 变化时重建 DOM，静止模式本身没有逐帧动画。
 */
'use strict';

(function registerFoliaStillMode() {
  if (typeof registerFoliaMode !== 'function') return;

  function foliaStillLineAt(ctx) {
    var lines = ctx.lines || [];
    if (!lines.length) return null;
    var idx = ctx.index;
    if (idx < 0) idx = 0;
    if (idx >= lines.length) idx = lines.length - 1;
    return { line: lines[idx], index: idx };
  }

  function foliaStillRow(line, offset, ctx) {
    var row = document.createElement('div');
    row.className = 'folia-still-row';
    if (!line) {
      row.className += ' folia-still-spacer';
      return row;
    }
    var isCurrent = offset === 0;
    if (line.fullText) {
      var text = document.createElement('div');
      text.className = 'folia-still-text ' + (isCurrent ? 'is-current' : 'is-other');
      text.style.color = ctx.theme.primaryColor;
      text.style.fontFamily = ctx.theme.fontStack;
      text.style.fontWeight = String(isCurrent ? 700 : 600);
      text.textContent = line.fullText;
      row.appendChild(text);
    }
    if (line.translation && ctx.showTranslation) {
      var trans = document.createElement('div');
      trans.className = 'folia-still-trans ' + (isCurrent ? 'is-current' : 'is-other');
      trans.style.color = ctx.theme.secondaryColor;
      trans.style.fontFamily = ctx.theme.fontStack;
      trans.style.fontWeight = String(isCurrent ? 500 : 400);
      trans.textContent = line.translation;
      row.appendChild(trans);
    }
    return row;
  }

  function foliaStillSignature(ctx, hit) {
    var line = hit ? hit.line : null;
    return [
      hit ? hit.index : -1,
      (ctx.lines && ctx.lines.length) || 0,
      ctx.theme.primaryColor,
      ctx.theme.secondaryColor,
      ctx.theme.fontStack,
      ctx.showText ? 1 : 0,
      ctx.showTranslation ? 1 : 0,
      line ? line.fullText : '',
      line ? line.translation : ''
    ].join('|');
  }

  function foliaStillRender(inst, ctx) {
    var hit = foliaStillLineAt(ctx);
    var sig = foliaStillSignature(ctx, hit);
    if (sig === inst.sig) return;
    inst.sig = sig;
    var linesEl = inst.linesEl;
    while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
    if (!ctx.showText) return;
    var base = hit ? hit.index : 0;
    var offsets = [-1, 0, 1];
    for (var i = 0; i < offsets.length; i++) {
      var lineIndex = base + offsets[i];
      var line = ctx.lines && ctx.lines[lineIndex];
      linesEl.appendChild(foliaStillRow(line || null, offsets[i], ctx));
    }
  }

  registerFoliaMode('still', {
    /* 名字/描述/排序取 Folia 权威值：ui.visualizerStill = 静止，entry.tsx order 130。 */
    name: '静止',
    desc: '歌词静止在画面中央，不做动画也不渲染背景，最省资源',
    order: 130,

    create: function (host, ctx) {
      var el = document.createElement('div');
      el.className = 'folia-still';
      var vignette = document.createElement('div');
      vignette.className = 'folia-still-vignette';
      var linesEl = document.createElement('div');
      linesEl.className = 'folia-still-lines';
      el.appendChild(vignette);
      el.appendChild(linesEl);
      host.appendChild(el);

      var inst = { el: el, linesEl: linesEl, sig: '' };
      foliaStillRender(inst, ctx);
      return inst;
    },

    tick: function (inst, ctx) {
      foliaStillRender(inst, ctx);
    },

    destroy: function (inst) {
      if (inst && inst.el && inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
      if (inst) { inst.el = null; inst.linesEl = null; }
    }
  });
})();
