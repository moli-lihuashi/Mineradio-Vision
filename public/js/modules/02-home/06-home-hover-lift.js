// ============================================================
//  Home 卡片悬浮抬起迟滞（修复边缘 hover 抖动）
//  根因：.home-card / .home-tile 的 hover 抬起用 translateY(-3px)，
//  光标停在底边 3px 内时会反复进出 hover 命中区（抬起→移出→落回→再触发），
//  卡片持续上下抖动；玻璃卡边缘是软边，光标更容易恰好停在翻转带上。
//  方案：hover 样式改由 .lg-hover 类驱动（pointer 事件控制），
//  底边留 6px 缓冲带——指针在带内保持抬起，真正离开带才落下，
//  翻转带被彻底移出可视边缘，数学上不存在往复区间。
// ============================================================
(function () {
  'use strict';
  var HOVER_CLASS = 'lg-hover';
  var BAND = 6; // 底边缓冲带（px）：抬起位移 3px + 指针容差
  var bandHoldCard = null;

  function cardFromEvent(e) {
    var t = e.target;
    return (t && t.closest) ? t.closest('.home-card, .home-tile') : null;
  }

  function releaseCard(card) {
    if (bandHoldCard) {
      document.removeEventListener('pointermove', onBandMove, true);
      bandHoldCard = null;
    }
    if (card) card.classList.remove(HOVER_CLASS);
  }

  function onBandMove(e) {
    var card = bandHoldCard;
    if (!card) { document.removeEventListener('pointermove', onBandMove, true); return; }
    if (!card.isConnected) { releaseCard(card); return; }
    var r = card.getBoundingClientRect();
    var inside = e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
      e.clientY >= r.top && e.clientY <= r.bottom + BAND;
    if (!inside) releaseCard(card);
  }

  document.addEventListener('pointerover', function (e) {
    var card = cardFromEvent(e);
    if (!card || card.classList.contains(HOVER_CLASS)) return;
    if (bandHoldCard && bandHoldCard !== card) releaseCard(bandHoldCard);
    card.classList.add(HOVER_CLASS);
  });

  document.addEventListener('pointerout', function (e) {
    var card = cardFromEvent(e);
    if (!card || !card.classList.contains(HOVER_CLASS)) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return; // 卡片内部移动
    var r = card.getBoundingClientRect();
    var inBottomBand = e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
      e.clientY > r.bottom - 3 && e.clientY <= r.bottom + BAND;
    if (!inBottomBand) { releaseCard(card); return; }
    // 指针落在底边缓冲带：保持抬起，跟踪下一次移动，真正离开带才释放
    if (bandHoldCard !== card) {
      bandHoldCard = card;
      document.addEventListener('pointermove', onBandMove, true);
    }
  });
})();
