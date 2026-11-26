'use strict';

/*
 * 宠物画布等比守卫（2026-11-25）
 *
 * 故障：卡片高度在紧凑断点从 152 缩到 104 后，宠物变成「扁的」。
 * 原因：画布纵向只有 16 个精灵格（backing store 高 = px*16），而 px 下限是 4，
 * 卡片矮时可用高度只有 40px，backing 却是 64px —— 浏览器把它压到 0.625，
 * 宠物就横向拉长、纵向压扁。
 *
 * 现在：px 下限降到 2，且 homePetResize 会把 CSS 尺寸写成 backing store / dpr，
 * 让两者永远严格等比。
 *
 * 这组测试直接把源码里的 homePetResize 抽出来跑，用假画布模拟各种卡片高度。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../public/js/modules/05-playback/14-home-pet.js'),
  'utf8'
);

function extractFn(name) {
  const start = SRC.indexOf('function ' + name);
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') { depth++; opened = true; }
    else if (SRC[i] === '}') { depth--; if (opened && depth === 0) return SRC.slice(start, i + 1); }
  }
  return '';
}

// 假画布：parentElement 代表卡片，rect 由测试给定
function makeCanvas(cardW, cardH) {
  const style = {};
  const canvas = {
    width: 300,
    height: 96,
    style,
    parentElement: { getBoundingClientRect: () => ({ width: cardW, height: cardH }) },
    getBoundingClientRect: () => ({ width: canvas.width, height: canvas.height }),
    getContext: () => ({ imageSmoothingEnabled: true })
  };
  return canvas;
}

function runResize(cardW, cardH, dpr) {
  const homePet = { canvas: makeCanvas(cardW, cardH), ctx: null };
  const fn = new Function('homePet', 'window', extractFn('homePetResize') + '; return homePetResize;')(
    homePet,
    { devicePixelRatio: dpr }
  );
  fn();
  return {
    backingW: homePet.canvas.width,
    backingH: homePet.canvas.height,
    cssW: Number(String(homePet.canvas.style.width).replace('px', '')) || 0,
    cssH: Number(String(homePet.canvas.style.height).replace('px', '')) || 0,
    px: homePet.px,
    cardW,
    cardH
  };
}

test('抽得到 homePetResize', () => {
  assert.ok(extractFn('homePetResize').length > 200, 'homePetResize 源码没抽到');
});

test('各卡片高度下，backing store 与 CSS 尺寸严格等比（宠物不会被压扁）', () => {
  // 152/148/122/104 分别对应基础值与三个紧凑断点
  for (const cardH of [152, 148, 122, 104]) {
    for (const dpr of [1, 1.25, 2]) {
      const r = runResize(460, cardH, dpr);
      assert.ok(r.px >= 2, `px 下限应允许到 2（cardH=${cardH}）`);
      assert.ok(r.backingW > 0 && r.backingH > 0, `backing store 不能为 0（cardH=${cardH}）`);
      // 关键：CSS 尺寸 == backing / dpr，比例不一致就会拉伸
      assert.ok(Math.abs(r.cssW - r.backingW / dpr) < 0.01,
        `宽度没等比（cardH=${cardH} dpr=${dpr}）：css=${r.cssW} backing=${r.backingW}`);
      assert.ok(Math.abs(r.cssH - r.backingH / dpr) < 0.01,
        `高度没等比（cardH=${cardH} dpr=${dpr}）：css=${r.cssH} backing=${r.backingH}`);
    }
  }
});

test('宠物不超出卡片，且高度约为卡片的 55%~72%（2026-11-25 按用户要求放大 20%）', () => {
  for (const cardH of [152, 148, 122, 104]) {
    const r = runResize(460, cardH, 1);
    assert.ok(r.cssH <= cardH - 12 + 0.01,
      `宠物高 ${r.cssH} 顶出卡片（cardH=${cardH}，底部需留 12px）`);
    const ratio = r.cssH / cardH;
    assert.ok(ratio >= 0.55 && ratio <= 0.72,
      `宠物占卡片高度比例 ${ratio.toFixed(2)} 不在 0.55~0.72（cardH=${cardH}，实测高 ${r.cssH}）`);
    assert.ok(r.cssW <= 460 - 12 + 0.01, `宠物宽 ${r.cssW} 超出可用宽度`);
  }
});

test('卡片很矮时 backing 不会被逼到 64px（px 下限是 2）', () => {
  // 80 高的极端卡片：用比例算出来是 px=3（48px），不会因为下限 4 被抬到 64
  const r = runResize(460, 80, 1);
  assert.ok(r.backingH < 64, `80 高卡片下 backing 高应小于 64，实际 ${r.backingH}`);
  const src = extractFn('homePetResize');
  assert.ok(src.includes('Math.max(2,'), 'px 下限必须是 2');
  assert.ok(!src.includes('Math.max(4,'), '不能再回到下限 4');
});
