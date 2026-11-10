/* Folia 世界 — 底部字幕层（译文 / 下一句预览）
 *
 * 对应 Folia components/visualizer/VisualizerSubtitleOverlay.tsx。
 * 12 个模式共用这一层（still / monet 自带字幕，不挂这一层），所以它建在模式实例之外、
 * 由模式在自己的 create 里调用 foliaCreateSubtitleOverlay(host, theme) 挂上。
 *
 * 关键数值全部照搬：
 *   底距 112px（Folia: PLAYER_BOTTOM_BAR_BASE_OFFSET_PX 32 + 字幕净空 80）
 *   整体透明度 0.6，入场 opacity 0→0.6 / y 20→0，0.24s easeOut
 *   译文字号 clamp(1.125rem, 2.6vw, 1.25rem)，下一句 clamp(0.875rem, 2vw, 1rem)
 *   译文行有 radial-gradient 垫底（背景色 0.96 / 0.78 / 透明），外圈 blur(40px)
 */
'use strict';

var FOLIA_SUBTITLE_BOTTOM_PX = 112;
var FOLIA_SUBTITLE_OPACITY = 0.6;
var FOLIA_READABLE_RE = /[\p{L}\p{N}]/u;

function foliaHasReadableText(text) {
  return !!text && FOLIA_READABLE_RE.test(String(text));
}

function foliaCreateSubtitleOverlay(host, theme, sizesOverride) {
  var fallbackTheme = theme;
  var sizes = sizesOverride || foliaResolveSubtitleFontSizes(1);

  var el = document.createElement('div');
  el.className = 'folia-subtitle';
  el.style.bottom = FOLIA_SUBTITLE_BOTTOM_PX + 'px';
  el.style.opacity = '0';
  el.style.transform = 'translate3d(0, 20px, 0)';

  var wrap = document.createElement('div');
  wrap.className = 'folia-subtitle-wrap';
  el.appendChild(wrap);

  var anim = foliaAnimCreate();
  anim.snap('opacity', 0);
  anim.snap('y', 20);

  var signature = '';
  var visible = false;

  function buildGlow(theme) {
    var glow = document.createElement('div');
    glow.className = 'folia-subtitle-glow';
    glow.setAttribute('aria-hidden', 'true');
    glow.style.background = 'radial-gradient(ellipse 115% 130% at center, '
      + foliaColorWithAlpha(theme.backgroundColor, 0.96) + ' 0%, '
      + foliaColorWithAlpha(theme.backgroundColor, 0.78) + ' 62%, transparent 100%)';
    return glow;
  }

  function render(ctx) {
    var theme = ctx.theme || fallbackTheme;
    var textShadow = '0 1px 2px ' + foliaColorWithAlpha(theme.backgroundColor, 0.24);
    var activeLine = ctx.index >= 0 ? ctx.lines[ctx.index] : null;
    var recentLine = foliaGetRecentCompletedLine(ctx);
    var nextLines = foliaGetUpcomingLines(ctx, 2);

    var translation = '';
    if (!ctx.showTranslation) translation = '';
    else if (activeLine && foliaHasReadableText(activeLine.translation)) translation = activeLine.translation;
    else if (recentLine && foliaHasReadableText(recentLine.translation)) translation = recentLine.translation;

    var upcoming = [];
    if (!translation && activeLine) {
      for (var i = 0; i < nextLines.length; i++) {
        if (foliaHasReadableText(nextLines[i].fullText)) upcoming.push(nextLines[i].fullText);
      }
    }

    var sig = [
      translation ? ('t:' + translation) : ('u:' + upcoming.join('\u0001')),
      theme.secondaryColor,
      theme.backgroundColor,
      theme.translationFontStack,
      ctx.showText ? 1 : 0
    ].join('|');
    if (sig === signature) return;
    signature = sig;

    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

    if (translation) {
      var content = document.createElement('div');
      content.className = 'folia-subtitle-content';
      content.appendChild(buildGlow(theme));
      var block = document.createElement('div');
      block.className = 'folia-subtitle-block';
      var row = document.createElement('div');
      row.className = 'folia-subtitle-row';
      row.style.color = theme.secondaryColor;
      row.style.fontSize = sizes.translationFontSize;
      row.style.fontFamily = theme.translationFontStack;
      row.style.fontWeight = String(foliaResolveThemeFontWeight(theme, 500));
      row.style.textShadow = textShadow;
      row.textContent = translation;
      block.appendChild(row);
      content.appendChild(block);
      wrap.appendChild(content);
      return;
    }

    if (upcoming.length) {
      var content2 = document.createElement('div');
      content2.className = 'folia-subtitle-content';
      content2.appendChild(buildGlow(theme));
      var block2 = document.createElement('div');
      block2.className = 'folia-subtitle-block folia-subtitle-block-upcoming';
      for (var k = 0; k < upcoming.length; k++) {
        var p = document.createElement('p');
        p.className = 'folia-subtitle-upcoming';
        p.style.color = theme.secondaryColor;
        p.style.fontSize = sizes.upcomingFontSize;
        p.style.fontWeight = String(foliaResolveThemeFontWeight(theme, 400));
        p.style.textShadow = textShadow;
        p.textContent = upcoming[k];
        block2.appendChild(p);
      }
      content2.appendChild(block2);
      wrap.appendChild(content2);
    }
  }

  function update(ctx, dt) {
    render(ctx);

    var shouldShow = !!wrap.firstChild && ctx.showText;
    if (shouldShow !== visible) {
      visible = shouldShow;
      anim.to('opacity', shouldShow ? FOLIA_SUBTITLE_OPACITY : 0, { duration: 0.24, ease: 'easeOut' });
      anim.to('y', shouldShow ? 0 : 20, { duration: 0.24, ease: 'easeOut' });
    }

    anim.step(dt);
    el.style.opacity = String(anim.v.opacity);
    el.style.transform = 'translate3d(0, ' + (anim.v.y || 0).toFixed(2) + 'px, 0)';
  }

  host.appendChild(el);

  return {
    el: el,
    update: update,
    destroy: function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
