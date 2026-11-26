'use strict';

/*
 * Home 卡片最小高度单一来源守卫（2026-11-25）
 *
 * 故障：110% 界面缩放的窗口模式下，宠物卡（.home-pet-card）明显比同排卡片大，
 * 左侧 hero 也被 grid 拉伸跟着变大；全屏却正常。
 * 原因：卡片高度有两处写死 —— home.css 的 152/126/134/112/108，
 * 以及 playback.css 里桌面版真正生效的 148/128/122/104/102；
 * 而宠物卡只有一句 min-height:152px，永不参与收缩。
 *
 * 现在只有一个来源：--home-card-min-h（.empty-home-shell 上定义，桌面版在 playback.css 覆盖），
 * .home-card 与 .home-pet-card 都读它。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME = fs.readFileSync(path.join(ROOT, 'public/css/02-home/home.css'), 'utf8');
const PLAYBACK = fs.readFileSync(path.join(ROOT, 'public/css/05-playback/playback.css'), 'utf8');

test('普通卡片与宠物卡读同一个变量', () => {
  assert.match(HOME, /\.home-card\{[^}]*min-height:var\(--home-card-min-h,152px\)/,
    '.home-card 的 min-height 必须走变量');
  assert.match(HOME, /\.home-pet-card \{[^}]*min-height:var\(--home-card-min-h,152px\)/,
    '宠物卡必须用同一个变量，否则紧凑断点里它不跟着收缩');
  assert.ok(!/\.home-pet-card \{[^}]*min-height:152px/.test(HOME), '宠物卡不能再写死 152');
});

test('变量有默认值，且各断点只改变量值', () => {
  assert.ok(HOME.includes('--home-card-min-h:152px'), '基础值 152');
  for (const v of ['126', '134', '112', '108']) {
    assert.ok(HOME.includes(`--home-card-min-h:${v}px`), `home.css 断点缺 ${v}`);
  }
  for (const v of ['148', '128', '122', '104', '102']) {
    assert.ok(PLAYBACK.includes(`body.desktop-shell .empty-home-shell{--home-card-min-h:${v}px`),
      `playback.css 桌面版断点缺 ${v}`);
  }
});

test('桌面版不再单独给 .home-card 写死高度', () => {
  const re = /body\.desktop-shell \.home-card\{[^}]*min-height:\d+px[^}]*\}/g;
  const offenders = [...PLAYBACK.matchAll(re)].map((m) => m[0]);
  assert.deepEqual(offenders, [],
    `这些规则会盖掉变量、把宠物卡落下：\n${offenders.join('\n')}`);
});
