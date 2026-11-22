'use strict';
// 守卫：桌面歌词帧率与壁纸帧率是两套设置，必须视觉分组清楚、显隐同步。
// 历史缺陷：壁纸帧率的标题和选项条分别设 hidden，只露出选项条时看起来像
// 「桌面歌词帧率」的第二行，用户误以为两者是同一个设置。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const HTML = 'public/index.html';
const JS = 'public/js/modules/07-fx/05a-fx-panel-inputs.js';
const CSS = 'public/css/07-fx/fx-panel.css';

function blockBetween(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  assert.ok(a >= 0 && b > a, '找不到区间 ' + startMark + ' .. ' + endMark);
  return src.slice(a, b);
}

test('两组帧率都保留原有档位，按钮语义不变', () => {
  const html = read(HTML);
  const dl = blockBetween(html, 'id="desktop-lyrics-fps-seg"', '</div>');
  ['24', '30', '60', '120', '无上限'].forEach(v => {
    assert.ok(dl.includes('data-desktop-lyrics-fps="' + (v === '无上限' ? '0' : v) + '"'),
      '桌面歌词帧率缺少档位 ' + v);
  });
  const wp = blockBetween(html, 'id="wallpaper-fps-seg"', '</div>');
  ['24', '30', '60'].forEach(v => {
    assert.ok(wp.includes('data-wallpaper-fps="' + v + '"'), '壁纸帧率缺少档位 ' + v);
  });
  assert.ok(!/id="wallpaper-fps-seg"[^>]*hidden/.test(html),
    '壁纸帧率选项条不能再单独带 hidden（必须随统一容器显隐）');
});

test('壁纸设置收进统一容器：标题 / 帧率 / 透明度一起显隐', () => {
  const html = read(HTML);
  const group = blockBetween(html, 'id="wallpaper-settings-group"', '<div class="fx-fold"');
  ['wallpaper-settings-label', 'wallpaper-fps-label', 'wallpaper-fps-seg', 'fx-wallpaperopacity'].forEach(id => {
    assert.ok(group.includes('id="' + id + '"'), '壁纸设置容器缺少 ' + id);
  });
  assert.ok(/id="wallpaper-settings-group"[^>]*hidden/.test(html), '壁纸设置容器默认应隐藏');

  const js = read(JS);
  const fn = blockBetween(js, 'function updateWallpaperPanelVisibility()', '\n}');
  assert.match(fn, /getElementById\('wallpaper-settings-group'\)/, '显隐函数必须操作统一容器');
  assert.match(fn, /group\.hidden = !on/, '显隐函数必须用容器 hidden 统一控制');
  ['wallpaper-settings-label', 'wallpaper-fps-label', 'wallpaper-fps-seg', 'fx-wallpaperopacity'].forEach(id => {
    assert.ok(!fn.includes(id), '显隐函数不该再单独操作 ' + id + '（会重新造成标题/选项条不同步）');
  });
  // 合并 script 里同名函数后声明者胜出，这个函数只能有一份
  const defs = (js.match(/function updateWallpaperPanelVisibility\s*\(/g) || []).length;
  assert.equal(defs, 1, 'updateWallpaperPanelVisibility 只能有一个定义，实际 ' + defs);
});

test('两组标题都写明作用范围，且有视觉分隔', () => {
  const html = read(HTML);
  assert.ok(html.includes('桌面歌词帧率 <small class="fx-label-scope">只影响桌面歌词窗口</small>'),
    '桌面歌词帧率要写清作用范围');
  assert.ok(html.includes('壁纸帧率 <small class="fx-label-scope">只影响壁纸窗口，与桌面歌词无关</small>'),
    '壁纸帧率要写清「只影响壁纸窗口，与桌面歌词无关」');
  const css = read(CSS);
  // 2026-11-23 起这条规则同时服务视觉控制台与设置页，前缀是 :is(#fx-panel,#settings-modal)
  assert.match(css, /\.wallpaper-settings-group\[hidden\]\{display:none\}/,
    '容器 hidden 必须真的生效（.fx-seg 自带 display 会盖掉 UA 规则）');
  assert.ok(css.includes('.wallpaper-settings-group{margin-top:16px;padding-top:14px;border-top:'),
    '壁纸设置与桌面歌词帧率之间要有分隔线');
});

test('运行时重写标题不能删掉作用范围小字', () => {
  const js = read('public/js/modules/07-fx/05b-fx-panel-layout.js');
  assert.ok(js.includes('function fxSetLabelTextKeepChildren'),
    '必须有保留子元素的标题写入函数');
  assert.ok(!/prev\.textContent\s*=\s*text/.test(js),
    'setFxSectionBefore 用 textContent 整体覆盖会删掉 <small> 说明');
  const fn = blockBetween(js, 'function setFxSectionBefore(', '\n}');
  assert.ok(fn.includes('fxSetLabelTextKeepChildren(prev, text)'),
    '标题重写必须走保留子元素的函数');
});
