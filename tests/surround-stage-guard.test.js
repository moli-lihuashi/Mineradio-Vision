'use strict';

/*
 * 立体环绕（M/S + 侧声道早期反射）守卫 —— 2026-11-26
 *
 * 设计约束（都是踩过坑的）：
 *   1. 只处理 side，mid 原地不动。整体加延迟会触发 Haas 效应把幻象中心拉偏，
 *      ViPER 的「差分环绕」人声偏左就是这么来的；
 *   2. width=1、ambience=0 时必须与直通逐样本等价（关掉效果不能偷偷改声音）；
 *   3. 低频不进反射支路（反射前有 highpass），否则低频糊成一团；
 *   4. 插在 loudness 之后、限幅器之前，宽度拉满多出来的峰值由限幅器兜住。
 *
 * 数值验证不在这个文件里（node 没有 Web Audio）：
 *   scripts/probes/surround-dsp.html 用 OfflineAudioContext 渲染真实信号量输出，
 *   实测结论见 _debug-archive/2026-11-26-surround-dsp/。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/js/modules/04-mood/01-audio-tuning.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('M/S 矩阵：mid 与 side 分别取，side 在右声道反相', () => {
  assert.ok(JS.includes('createChannelSplitter(2)'), '需要声道拆分');
  assert.match(JS, /surMidL\.gain\.value = 0\.5/, 'mid = (L+R)/2 的一半系数');
  assert.match(JS, /surMidR\.gain\.value = 0\.5/);
  assert.match(JS, /surSideL\.gain\.value = 0\.5/, 'side = (L-R)/2 的一半系数');
  assert.match(JS, /surSideR\.gain\.value = -0\.5/, 'side 的 R 路必须反相');
  assert.match(JS, /surSumNeg\.gain\.value = -1/, '右声道输出要减 side');
  assert.ok(JS.includes('createChannelMerger(2)'), '重建立体声');
});

test('反射只作用于侧声道，且低频先被切掉', () => {
  const refBlock = JS.slice(JS.indexOf('surSideGain.connect(surHp)'), JS.indexOf('surMerger.connect(surBassComp)'));
  assert.ok(refBlock.includes('surHp.connect(surD1)'), '延迟支路要从 highpass 之后取');
  assert.ok(JS.includes("surHp.type = 'highpass'"), '反射前必须 highpass');
  assert.ok(!/surMid\.connect\(surHp\)/.test(JS), '不能把人声/中置送进反射支路');
});

test('插在 loudness 之后、限幅器之前', () => {
  assert.match(JS, /loudness\.connect\(surSplitter\)/, '环绕级接在响度对齐之后');
  assert.match(JS, /surBassComp\.connect\(safetyLimiter\)/, '宽度拉满的峰值要过限幅器（低音补偿之后）');
  assert.match(JS, /surBassComp\.connect\(antiClick\)/, '没有限幅器时直连 antiClick');
});

test('关闭态与 unity 参数必须中性', () => {
  assert.match(JS, /setParam\(chain\.surround\.width\.gain, surOn \? settings\.surroundWidth : 1, ramp\)/,
    '关闭时宽度必须回 1（M/S 重建才是恒等）');
  assert.match(JS, /setParam\(chain\.surround\.g1\.gain, surOn \? 0\.55 \* settings\.surroundAmbience : 0, ramp\)/,
    '关闭时反射归零');
  assert.match(JS, /setParam\(chain\.surround\.g2\.gain, surOn \? 0\.35 \* settings\.surroundAmbience : 0, ramp\)/);
});

test('参数有上下限，且写盘/回读一致', () => {
  assert.match(JS, /out\.surroundWidth = clamp\(raw\.surroundWidth, 0, 2\)/, '宽度 0~2（0=单声道，2=最宽）');
  assert.match(JS, /out\.surroundAmbience = clamp\(raw\.surroundAmbience, 0, 1\)/, '反射 0~1');
  assert.match(JS, /settings\.surroundWidth = clamp\(e\.target\.value, 0, 200\) \/ 100/, '滑块 0~200% 映射');
  assert.match(JS, /setSurround: function \(cfg\)/, '要有关闭页之外的设置接口');
});

test('设置页有入口，且拖滑块会自动开启', () => {
  assert.match(INDEX, /id="audio-tuning-surround-toggle"/, '开关按钮（静态）');
  /* 滑块改成与十段 EQ 同一套竖向推子后由 buildUi 生成，这里改断言容器 + 生成器 */
  assert.match(INDEX, /id="audio-tuning-spatial-rows"/, '推子容器');
  assert.match(JS, /id: 'at-surround-width'/, '声场推子由 spatialRack 生成');
  assert.match(JS, /id: 'at-surround-ambience'/, '反射推子由 spatialRack 生成');
  assert.match(JS, /class="at-eq-rack at-eq-rack-spatial"/, '必须复用十段 EQ 的推子样式');
  assert.match(JS, /if \(!settings\.surroundEnabled && settings\.surroundWidth !== 1\) settings\.surroundEnabled = true/,
    '拖了滑块就自动打开，避免「拖了没反应」');
});

test('拆卸时环绕节点一并断开', () => {
  assert.match(JS, /if \(chain\.surround && chain\.surround\.nodes\) nodes = nodes\.concat\(chain\.surround\.nodes\)/,
    'detach 必须收走环绕节点，否则旧 ctx 上会泄漏');
});

test('打开开关必须有可听变化：中性参数下自动给默认强度', () => {
  /* 用户实测反馈：「开了没区别」。原因是默认 100% / 0% 下这一级严格直通。
     现在首次打开会给 130% / 12%（实测侧向能量 +32.6%）。 */
  assert.match(JS, /if \(key === 'surroundEnabled' && settings\.surroundEnabled &&/,
    'toggle 里要有「中性参数则给默认值」的分支');
  assert.match(JS, /settings\.surroundWidth = 1\.3/);
  assert.match(JS, /settings\.surroundAmbience = 0\.12/);
  assert.match(INDEX, /130% \/ 12%/, '设置页要把这个默认行为写出来');
});

test('中置分离双推子：复用 M/S 矩阵，不另建一套', () => {
  assert.match(JS, /var surMidGain = ctx\.createGain\(\)/, 'mid 增益');
  assert.match(JS, /var surSideGain = ctx\.createGain\(\)/, 'side 增益');
  assert.match(JS, /surSide\.connect\(surWidth\);\n    surWidth\.connect\(surSideGain\);/, '反射也要跟着 side 增益走');
  assert.match(JS, /surMid\.connect\(surMidGain\);/, 'mid 走自己的增益');
  // 只允许一套 splitter/merger
  assert.equal((JS.match(/createChannelSplitter\(2\)/g) || []).length, 1, '不能重复建 M/S 矩阵');
});

test('低音补偿与 midGain 联动，默认 0dB', () => {
  assert.match(JS, /setParam\(chain\.surround\.bassComp\.gain, \(1 - settings\.midGain\) \* 4, ramp\)/,
    '补偿量 = (1 - mid) × 4dB，mid=100% 时为 0');
  assert.match(JS, /surBassComp\.type = 'lowshelf'/);
});

test('设置页有「人声 / 伴奏」两个推子', () => {
  assert.match(INDEX, /id="audio-tuning-center-rows"/, '推子容器');
  assert.match(JS, /id: 'at-center-mid'/, '人声推子由 spatialRack 生成');
  assert.match(JS, /id: 'at-center-side'/, '伴奏推子由 spatialRack 生成');
  assert.match(INDEX, /不是真分轨/, '要写明这是 M/S 分离的局限，别让人误以为是多音轨');
});
