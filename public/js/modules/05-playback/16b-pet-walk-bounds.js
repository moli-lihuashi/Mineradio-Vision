(function (global) {
  'use strict';

  // ====================================================================
  //  桌宠行走边界（纯函数，无 DOM 依赖，可单测）
  //
  //  坐标约定：画布宽度是 cols 格；宠物按 16 格宽绘制（内置像素伙伴正好 16×16，
  //  petdex 精灵等比后约 14.77 格，居中留 0.6 格余量）。
  //  居中位置 offX = floor((cols - 16) / 2)，实际位置 petX = offX + walkX。
  //
  //  要让宠物始终留在框内：
  //    左：petX >= 0              → walkX >= -offX
  //    右：petX + spriteUnits <= cols → walkX <= cols - spriteUnits - offX
  //
  //  第一版把上限写成 cols - 16（漏了 -offX），cols=24 时右侧溢出 4 格，
  //  而且下限写 0，等于从不往左走。用户看到的就是「一直往右跑然后跑出框」。
  // ====================================================================

  var SPRITE_UNITS = 16;

  /**
   * @param {number} cols        画布宽度（格）
   * @param {number} offX        居中偏移（格）
   * @param {number} [spriteUnits] 宠物宽度（格），默认 16
   * @returns {{left:number, right:number, span:number, canWalk:boolean}}
   */
  function walkLimits(cols, offX, spriteUnits) {
    var c = Math.max(SPRITE_UNITS, Number(cols) || SPRITE_UNITS);
    var o = Math.max(0, Math.min(Number(offX) || 0, c - SPRITE_UNITS));
    var s = Number(spriteUnits) > 0 ? Math.min(SPRITE_UNITS, Number(spriteUnits)) : SPRITE_UNITS;
    // 注意：-0 与 0 在 Object.is / 严格相等下不相等，会在断言与序列化里制造噪音。
    // offX 为 0 时显式返回 0，不让 -0 漏出去。
    var left = o === 0 ? 0 : -o;
    var right = Math.max(left, c - s - o);
    var span = right - left;
    // 可走宽度太窄（如画布正好 16 格）就不散步，免得贴着边框来回抖
    return { left: left, right: right, span: span, canWalk: span > 2 };
  }

  var api = { walkLimits: walkLimits, SPRITE_UNITS: SPRITE_UNITS };
  global.HomePetWalkBounds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
