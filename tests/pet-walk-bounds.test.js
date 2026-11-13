'use strict';

// 桌宠行走边界的单测。
//
// 守的是什么：第一版上限写成 cols-16（漏了 -offX），cols=24 时宠物右缘到 28 格、
// 溢出 4 格（卡片 overflow:hidden 会直接裁掉）；下限写 0 又让它从不往左走。
// 用户看到的就是「一直往右跑，最后跑出框」。

const test = require('node:test');
const assert = require('node:assert/strict');
const { walkLimits } = require('../public/js/modules/05-playback/16b-pet-walk-bounds');

test('常见画布宽度：可走范围左右对称，且覆盖到两侧贴边', () => {
  // cols=24 → offX=4：walkX ∈ [-4, 4]，petX ∈ [0, 8]，精灵右缘 8+16=24 = cols
  const b = walkLimits(24, 4, 16);
  assert.equal(b.left, -4);
  assert.equal(b.right, 4);
  assert.equal(b.span, 8);
  assert.equal(b.canWalk, true);
});

test('无论 cols 与 offX 取什么，边界处都不会溢出画布', () => {
  for (let cols = 16; cols <= 64; cols++) {
    const offX = Math.floor((cols - 16) / 2);
    const b = walkLimits(cols, offX, 16);
    // 左端点
    const petXLeft = offX + b.left;
    assert.ok(petXLeft >= 0, 'cols=' + cols + ' 左缘溢出: ' + petXLeft);
    // 右端点
    const petXRight = offX + b.right;
    assert.ok(petXRight + 16 <= cols + 1e-9,
      'cols=' + cols + ' 右缘溢出: ' + (petXRight + 16) + ' > ' + cols);
  }
});

test('第一版的错误算法会溢出（把这组数字留在测试里当对照）', () => {
  // 旧: walkX ∈ [0, cols-16]，petX = offX + walkX
  const cols = 24;
  const offX = Math.floor((cols - 16) / 2);
  const oldRightEdge = offX + (cols - 16) + 16;
  assert.ok(oldRightEdge > cols, '旧算法在 cols=24 时确实溢出 ' + (oldRightEdge - cols) + ' 格');
  // 新算法同一组参数不溢出
  const b = walkLimits(cols, offX, 16);
  assert.ok(offX + b.right + 16 <= cols);
});

test('画布刚好 16 格时不散步（避免贴边抖动）', () => {
  const b = walkLimits(16, 0, 16);
  assert.equal(b.span, 0);
  assert.equal(b.canWalk, false);
});

test('画布很窄（17 格）时仍给一点点活动空间但不溢出', () => {
  const b = walkLimits(17, 0, 16);
  assert.equal(b.left, 0);
  assert.equal(b.right, 1);
  assert.equal(b.canWalk, false, '1 格宽不该判定为可散步');
  assert.ok(0 + b.right + 16 <= 17);
});

test('offX 越界时被夹到合法范围，不会算出反向边界', () => {
  const b1 = walkLimits(24, 999, 16);
  assert.ok(b1.left <= 0 && b1.right >= b1.left, 'offX 过大不能产生 right < left');
  const b2 = walkLimits(24, -50, 16);
  assert.equal(b2.left, 0, '负 offX 应夹到 0');
});

test('spriteUnits 小于 16 时右边可以多走一点（petdex 精灵 14.77 格）', () => {
  const wide = walkLimits(24, 4, 16);
  const petdex = walkLimits(24, 4, 14.77);
  assert.ok(petdex.right > wide.right, '精灵更窄时右边界应更宽松');
  assert.ok(4 + petdex.right + 14.77 <= 24 + 1e-9, '但仍不许溢出');
});

test('非法参数有兜底，不返回 NaN', () => {
  [walkLimits(undefined, undefined, undefined), walkLimits(NaN, NaN, NaN)].forEach(b => {
    assert.ok(Number.isFinite(b.left) && Number.isFinite(b.right), '边界必须是有限数');
    assert.ok(b.left <= b.right);
  });
});
