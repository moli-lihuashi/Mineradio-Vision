'use strict';

/*
 * 立体环绕（M/S + 侧声道早期反射）守卫 —— 2026-11-26
 *
 * 设计约束（都是踩过坑的）：
 *   1. 只处理 side，mid 原地不动。整体加延迟会触发 Haas 效应把幻象中心拉偏
 *      （ViPER 单边延迟式差分环绕的人声偏左就是这么来的）；
 *      3D 丽音级是另一件事：双侧对称交叉延迟后相减，幻象中心不偏移，
 *      见 01-audio-tuning.js 里「3D 丽音」段的注释与本文件 F 组用例；
 *   2. width=1、ambience=0 时必须与直通逐样本等价（关掉效果不能偷偷改声音）；
 *   3. 低频不进反射支路（反射前有 highpass），否则低频糊成一团；
 *   4. 插在 loudness 之后、限幅器之前，宽度拉满多出来的峰值由限幅器兜住。
 *      2026-11-27 起限幅器前面又多了一级 3D 丽音（交叉差分延迟），
 *      环绕级仍然在限幅器之前，只是中间隔了 3D 级。
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
  /* 2026-11-27：环绕之后是「虚拟低音（并联）→ 3D 丽音（差分延迟）」，限幅器仍必须在最后。
     两级都在限幅器之前，因为 EQ/环绕/谐波叠加都可能把峰值顶出去。 */
  assert.match(JS, /surBassComp\.connect\(vbSum\)/, '低音补偿之后进虚拟低音的求和节点');
  assert.match(JS, /vbSum\.connect\(haasSplitter\)/, '虚拟低音之后进 3D 级');
  assert.match(JS, /haasMerger\.connect\(safetyLimiter\)/, '3D 级合流后过限幅器（峰值兜底）');
  assert.match(JS, /haasMerger\.connect\(antiClick\)/, '没有限幅器时 3D 级直连 antiClick');
  assert.ok(!/surBassComp\.connect\(antiClick\)/.test(JS), '不能绕过两级直连 antiClick');
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
  assert.match(INDEX, /id="audio-tuning-surround-toggle"/, '开关按钮');
  assert.match(INDEX, /id="at-surround-width"/, '声场滑块');
  assert.match(INDEX, /id="at-surround-ambience"/, '反射滑块');
  assert.match(INDEX, /id="audio-tuning-surround-sliders"[^>]*class="at-collapse"|class="at-collapse"[^>]*id="audio-tuning-surround-sliders"/,
    '滑块要包在可折叠容器里（开关控制展开/收起）');
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
  // 中置分离必须复用环绕级的 splitter，不能另建一套 M/S 矩阵。
  // （3D 丽音级有自己的 splitter，但那是 L/R 交叉延迟、不做 mid/side 变换，
  //   所以只限定在「环绕级」这一段里数，不能按全文件数。）
  const surroundBlock = JS.slice(JS.indexOf('var surSplitter'), JS.indexOf('haasSplitter'));
  assert.equal((surroundBlock.match(/createChannelSplitter/g) || []).length, 1, '中置分离不能另建 M/S 矩阵');
  assert.match(surroundBlock, /surSplitter\.connect\(surMidL, 0\)/, 'mid 从环绕的 splitter 取');
  assert.match(surroundBlock, /surSplitter\.connect\(surSideR, 1\)/, 'side 也从同一个 splitter 取');
});

test('低音补偿与 midGain 联动，默认 0dB', () => {
  assert.match(JS, /setParam\(chain\.surround\.bassComp\.gain, \(1 - effMid\) \* 4, ramp\)/,
    '补偿量 = (1 - 生效mid) × 4dB；开关关闭时 effMid=1 → 0dB');
  assert.match(JS, /surBassComp\.type = 'lowshelf'/);
});

test('设置页有「人声 / 伴奏」两个推子', () => {
  assert.match(INDEX, /id="at-center-mid"/, '人声滑块');
  assert.match(INDEX, /id="at-center-side"/, '伴奏滑块');
  assert.match(INDEX, /id="audio-tuning-center-toggle"/, '人声/伴奏也要有开关，否则没有「收起」的依据');
  assert.match(INDEX, /id="audio-tuning-center-sliders"/, '人声/伴奏也要能折叠');
  assert.match(INDEX, /不是真分轨/, '要写明这是 M/S 分离的局限，别让人误以为是多音轨');
});

test('开关控制展开/收起：两组的折叠类由 syncUi 按开关状态切换', () => {
  assert.match(JS, /surSliders\.classList\.toggle\('is-open', !!settings\.surroundEnabled\)/, '环绕：开→展开');
  assert.match(JS, /cenSliders\.classList\.toggle\('is-open', !!settings\.centerEnabled\)/, '人声伴奏：开→展开');
  assert.match(JS, /toggleButton\('audio-tuning-center-toggle', settings\.centerEnabled\)/, '开关态要同步到按钮');
  const CSS = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/eq-rack.css'), 'utf8');
  assert.ok(CSS.includes('grid-template-rows: 0fr'), '折叠用 grid 行高过渡，别用会截断内容的固定 max-height');
  assert.ok(CSS.includes('.at-collapse.is-open'), '要有展开态');
  assert.ok(CSS.includes('prefers-reduced-motion'), '减弱动效时不做过渡');
});
