'use strict';

// 合并 script 重名守卫。
//
// 背景：public/js/modules 下所有模块被拼进同一个 script 求值（保留函数提升），
// 同作用域重名 function **后声明者胜出**。也就是说：
//   · 改先加载的那份同名实现完全不会生效（本仓库已踩过：07/10 调色板、08/10 动效档位）；
//   · 新增重名会静默覆盖旧实现，没有任何报错。
//
// 这个守卫做三件事：
//   ① 未登记的重名一律失败（新增遮蔽必须显式登记并写清谁胜出）；
//   ② 已登记的重名必须仍然存在，且涉及的仍是同一对文件（已清理的条目要从基线删掉，基线只减不增）；
//   ③ 07-lyrics-palette-three.js 里那 3 份「有意保留」的副本与注释不能被悄悄删掉。
//
// 清理掉一条后，请同步从 BASELINE 删除对应 names，否则 ② 会红。
// 2026-11-25：13 条"待清理"的复制漂移已删除（10/12、10/10b、10/08、10/11、01-gpu/03b、
// 09/06、01-cover/03a、05-track-detail/06、07-search/09d），基线从 43 条降到 30 条，剩余全是设计内。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulesDir = path.join(root, 'public/js/modules');

function listModules(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listModules(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const BASELINE = [
  {
    files: ['07-fx/00-panel-lazy-stubs.js', '07-fx/05a-fx-panel-inputs.js'],
    reason: 'FX 面板延迟波惰性桩：stub 先占位，05a 真实现加载后覆盖（设计如此）',
    names: [
      'updateFxInputs', 'updateSonicFxInputs', 'updateDevelopmentFxControls', 'updateDesktopLyricsFpsControls', 'updatePerformanceControls', 'setPerformanceBackgroundMode', 'setPerformanceQualityMode', 'setForegroundFpsMode', 'setGpuThrottleMode', 'migratePerformanceQualityTowardAutoOnce', 'getFxSliderRow', 'ensureFxSliderResetButton', 'resetFxSliderValue', 'animateFxResetButton', 'setRange', 'updateHomeAudioVisual'
    ]
  },
  {
    files: ['07-fx/00-panel-lazy-stubs.js', '07-fx/05c-fx-particle-fire.js'],
    reason: '同上：05c 延迟波惰性桩',
    names: [
      'initFxParticleFireSlider', 'scheduleFxParticleFireRefresh', 'updateFxParticleFireSliderVisual', 'refreshFxParticleFireSlider', 'applyFxParticleFireMask', 'runFxParticleFireMaskReveal'
    ]
  },
  {
    files: ['07-fx/00-panel-lazy-stubs.js', '07-fx/05b-fx-panel-layout.js'],
    reason: '同上：05b 延迟波惰性桩',
    names: [
      'organizeFxPanel', 'relabelFxPanelControls', 'repairFxParticleCountPlacement', 'applyBackgroundMediaHint', 'setFxPanelTab'
    ]
  },
  {
    files: ['02-visual/07-lyrics-palette-three.js', '02-visual/10-lyrics-mask-shaders.js'],
    reason: '作者有意保留的双份实现：加载顺序若变化（退 legacy 合并）语义不退化，改动必须两份同步',
    names: [
      'applyLyricPaletteToMesh', 'effectiveLyricPalette', 'setStageLyricPalette'
    ]
  }
];

test('① 未登记的顶层函数重名必须失败（防静默覆盖）', () => {
  const seen = new Map();
  for (const file of listModules(modulesDir, [])) {
    const rel = path.relative(modulesDir, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) {
      const name = match[1];
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(rel);
    }
  }
  const actual = new Map();
  for (const [name, files] of seen) {
    if (files.size > 1) actual.set(name, [...files].sort());
  }
  const registered = new Map();
  for (const group of BASELINE) {
    const files = [...group.files].sort();
    for (const name of group.names) {
      registered.set(name, { files, reason: group.reason });
    }
  }
  const unexpected = [];
  for (const [name, files] of actual) {
    if (!registered.has(name)) unexpected.push('  ' + name + ' -> ' + files.join(' | '));
  }
  assert.deepEqual(unexpected, [],
    '发现未登记的重名顶层函数（后加载的实现会静默覆盖先加载的）：\n' + unexpected.join('\n') +
    '\n如果是有意为之（惰性桩 / 双份实现），请登记到 BASELINE 并写明谁胜出；否则请改名。');
});

test('② 已登记的重名必须仍然存在，且不得更换文件（基线只减不增）', () => {
  const seen = new Map();
  for (const file of listModules(modulesDir, [])) {
    const rel = path.relative(modulesDir, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) {
      const name = match[1];
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(rel);
    }
  }
  const stale = [];
  for (const group of BASELINE) {
    const expected = [...group.files].sort();
    for (const name of group.names) {
      const files = seen.get(name);
      if (!files || files.size < 2) {
        stale.push('  ' + name + ' —— 已不再重名，请从 BASELINE 删除（' + group.reason + '）');
        continue;
      }
      const actual = [...files].sort();
      if (actual.join('|') !== expected.join('|')) {
        stale.push('  ' + name + ' —— 涉及文件已变化：期望 ' + expected.join(' | ') + '，实际 ' + actual.join(' | '));
      }
    }
  }
  assert.deepEqual(stale, [], '基线已过期（清理完成后必须同步删掉对应条目）：\n' + stale.join('\n'));
});

test('③ 07 调色板的 3 份有意保留副本与说明不能被悄悄删掉', () => {
  const source = fs.readFileSync(path.join(modulesDir, '02-visual/07-lyrics-palette-three.js'), 'utf8');
  for (const name of ['applyLyricPaletteToMesh', 'effectiveLyricPalette', 'setStageLyricPalette']) {
    assert.match(source, new RegExp('function ' + name + '\\s*\\('), name + ' 的保底实现被删了？');
  }
  assert.match(source, /死代码/, '保留这 3 份的原因（加载顺序兜底）必须在注释里写清楚');
});
