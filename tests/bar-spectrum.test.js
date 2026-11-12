'use strict';

// 「控制条底层频谱」回归守。
//
// 用户确认后的最终形态：只留迷幻水波 / 动感律动 / 流光丝带三套（+ 关闭），
// 选择放在顶栏「皮肤」弹层，且只在 LiquidGlass（#bottom-bar.lg-active）下显示。
//
// 守八件事：
//   ① 样式白名单恰好三套 + off，节奏音阶 / 镜面光柱不能复活；
//   ② 模式读取：fx 优先、缺 fx 时回落 fxDefaults、脏值回落默认；
//   ③ 门控：visible 与 lg-active 必须同时成立；
//   ④ 数据：只读已刷新的 frequencyData，做对数取样与平滑，绝不新建 analyser；
//   ⑤ 贴底：柱状的基线钉在 h-6，波形不越出控制条下沿；
//   ⑥ 存档：fxDefaults 与打包快照两处默认、03c 归一化与保存两处白名单；
//   ⑦ 接线：皮肤弹层四格、index-loader 延迟波、05e 补刷、canvas 在 shell 之后、CSS 层级；
//   ⑧ 点格落盘：写 fx.barSpectrum 并调 saveLyricLayout，关闭时立刻清空画布。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const engineSrc = read('public/js/modules/07-fx/05f-bar-spectrum.js');
const globalsSrc = read('public/js/modules/00-state/12d-fx-runtime-globals.js');
const layoutSrc = read('public/js/modules/02-visual/03c-lyrics-layout-settings.js');
const loaderSrc = read('public/js/index-loader.js');
const skinSrc = read('public/js/modules/07-fx/05e-skin-popover.js');
const htmlSrc = read('public/index.html');
const cssSrc = read('public/css/index.css');
const glassSrc = read('public/css/06-fx/fx-glass.css');
const lgCfgSrc = read('public/js/modules/06-fx/01-liquidglass-config.js');
const layoutTabSrc = read('public/js/modules/07-fx/05b-fx-panel-layout.js');
const heartFxPanelSrc = read('public/js/modules/07-fx/05d-heart-fx-panel.js');
const heartFxEngineSrc = read('public/js/modules/05-playback/06e-heart-fx.js');
const fxPanelCssSrc = read('public/css/07-fx/fx-panel.css');
const foliaGlassSrc = read('public/css/06-fx/glass-folia.css');

/* 按大括号配对取顶层函数（函数体里有嵌套花括号，不能用正则截断） */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 没有闭合');
}

function runSlice(fns, ctxObj, callExpr) {
  const src = fns.map((n) => extractFunction(engineSrc, n)).join('\n');
  const sandbox = Object.assign({
    console,
    document: { getElementById: () => null, body: { classList: { remove() {}, add() {}, contains() { return false; } } } },
    window: { devicePixelRatio: 1 },
    requestAnimationFrame: () => {},
    BAR_SPECTRUM_COLORS: { a: '#8ff7e4', b: '#37a9cf' },
    barSpectrumBins: new Float64Array(64),
    barSpectrumFloatData: null,
    barSpectrumTestData: null,
    barSpectrumShown: false,
    barSpectrumIdleFrames: 0,
    barSpectrumClear: () => {},
    paintBarSpectrumSelection: () => {},
    fx: undefined,
    fxDefaults: undefined,
    frequencyData: undefined,
    saveLyricLayout: undefined
  }, ctxObj || {});
  return vm.runInNewContext(src + '\n' + callExpr, sandbox);
}

/* 去掉注释后再查「禁止调用的 API」：注释里会提到这些名字做说明，直接搜全文会假阳性 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ctxStub() {
  const calls = { rects: [], arcs: [], lines: 0 };
  const g = { addColorStop() {} };
  const c = {
    calls,
    clearRect() {}, setTransform() {}, createLinearGradient() { return g; },
    fillRect(x, y, w, h) { calls.rects.push([x, y, w, h]); },
    beginPath() {}, arc(x, y, r) { calls.arcs.push([x, y, r]); }, fill() {},
    moveTo() {}, lineTo() { calls.lines++; }, stroke() {}, closePath() {}, setLineDash() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1
  };
  return c;
}

function classListStub(classes) {
  return { contains: (c) => classes.indexOf(c) >= 0, add() {}, remove() {}, toggle() {} };
}

const NORMALIZE = extractFunction(engineSrc, 'barSpectrumNormalize');

/* ---------------------------------------------------------------- ① 白名单 */
test('① 样式白名单恰好三套 + 关闭，节奏音阶 / 镜面光柱不得复活', () => {
  assert.match(NORMALIZE, /var allowed = \['ripple', 'pulse', 'ribbon', 'off'\]/, '白名单必须写在函数体内');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('ripple', null)"), 'ripple');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('pulse', null)"), 'pulse');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('ribbon', null)"), 'ribbon');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('off', null)"), 'off');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('rhythm', 'pulse')"), 'pulse', '被移除的样式不能通过');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('mirror', 'pulse')"), 'pulse');
  assert.equal(runSlice(['barSpectrumNormalize'], {}, "barSpectrumNormalize('garbage', 'garbage')"), 'ripple');
  const tiles = engineSrc.slice(engineSrc.indexOf('var BAR_SPECTRUM_TILES'), engineSrc.indexOf('/* 配色'));
  assert.ok((tiles.match(/id: '/g) || []).length === 4, '皮肤弹层必须是四格');
  assert.doesNotMatch(tiles, /rhythm|mirror/, '另外两套不能出现在格子里');
});

/* ---------------------------------------------------------------- ② 模式读取 */
test('② barSpectrumMode：fx 优先、缺 fx 回落 fxDefaults、脏值回落 ripple', () => {
  assert.equal(runSlice(['barSpectrumNormalize', 'barSpectrumMode'], { fx: { barSpectrum: 'pulse' }, fxDefaults: { barSpectrum: 'ribbon' } }, 'barSpectrumMode()'), 'pulse');
  assert.equal(runSlice(['barSpectrumNormalize', 'barSpectrumMode'], { fx: undefined, fxDefaults: { barSpectrum: 'ribbon' } }, 'barSpectrumMode()'), 'ribbon');
  assert.equal(runSlice(['barSpectrumNormalize', 'barSpectrumMode'], { fx: { barSpectrum: 'mirror' }, fxDefaults: { barSpectrum: 'pulse' } }, 'barSpectrumMode()'), 'pulse');
  assert.equal(runSlice(['barSpectrumNormalize', 'barSpectrumMode'], { fx: { barSpectrum: 'nope' }, fxDefaults: { barSpectrum: 'nope' } }, 'barSpectrumMode()'), 'ripple');
});

/* ---------------------------------------------------------------- ③ 液态玻璃门控 */
test('③ 只要控制条可见就激活：CSS 玻璃与 LiquidGlass 都要生效', () => {
  const active = extractFunction(engineSrc, 'barSpectrumActive');
  assert.match(active, /classList\.contains\('visible'\)/, '必须认控制条可见类');
  assert.doesNotMatch(active, /lg-active/, 'CSS 玻璃分支也要生效，不能再把液态玻璃当作必要条件');
  const run = (classes) => runSlice(['barSpectrumActive'], {
    document: { getElementById: () => ({ classList: classListStub(classes) }) }
  }, 'barSpectrumActive()');
  assert.equal(run(['visible', 'lg-active']), true);
  assert.equal(run(['visible']), true, 'CSS 玻璃（未进液态玻璃态）也要显示频谱');
  assert.equal(run(['lg-active']), false, '控制条隐藏时不能画');
  assert.equal(run([]), false);
  assert.match(glassSrc, /#bottom-bar\.lg-active[\s\S]{0,240}background: transparent !important/, 'lg-active 会清掉背景，频谱不能依赖 CSS 背景压暗');
  assert.match(lgCfgSrc, /insertBefore\(shell, host\.firstChild\)/, 'shell 必须是控制条首个子元素');
});

/* ---------------------------------------------------------------- ④ 数据来源 */
test('④ 只读 frequencyData，不新建 analyser、不碰 gainNode', () => {
  const engineCode = codeOnly(engineSrc);
  assert.doesNotMatch(engineCode, /getByteFrequencyData|createAnalyser|gainNode|setTargetAtTime/, '禁止自建或改动音频链');
  assert.match(engineCode, /typeof frequencyData !== 'undefined'/, '必须兜住全局未定义的情况');
  const bins = new Float64Array(64);
  runSlice(['barSpectrumReadData'], {
    barSpectrumBins: bins,
    frequencyData: new Uint8Array(256).fill(200)
  }, 'barSpectrumReadData()');
  const arr = Array.from(bins);
  assert.ok(arr.every((v) => v > 0 && v <= 1), '有数据时应产生 0..1 的能量');
  assert.ok(arr[0] > arr[63] * 0.5, '对数采样不能把低频抹平');

  /* 真实音乐形状：低频高、高频有底噪。右半条不能变成一条死线（用户看到的「右侧完全不动」） */
  const music = new Uint8Array(256);
  for (let i = 0; i < 256; i++) music[i] = Math.round(40 + 170 * Math.exp(-i / 60));
  const bins3 = new Float64Array(64);
  runSlice(['barSpectrumReadData'], { barSpectrumBins: bins3, frequencyData: music }, 'barSpectrumReadData()');
  const right = Array.from(bins3).slice(32).reduce((a, b) => a + b, 0) / 32;
  assert.ok(right > 0.08, '右半段必须有可见能量（单点取样 + 不做归一化时右侧长期贴地）');
  const readFn4 = extractFunction(engineSrc, 'barSpectrumReadData');
  assert.match(readFn4, /getFloatFrequencyData/, '优先读真实 dB：字节数据在 -30dB 就饱和，会把整条压平');
  assert.match(readFn4, /fMin \* Math\.pow\(fRatio/, '频率必须按对数等比分组');

  /* 对数分组按段平均：交替 200/0 的梳状数据，绝大多数段都要有值 */
  const comb = new Uint8Array(256);
  for (let i = 0; i < 256; i++) comb[i] = i % 2 === 0 ? 200 : 0;
  const bins4 = new Float64Array(64);
  runSlice(['barSpectrumReadData'], { barSpectrumBins: bins4, frequencyData: comb }, 'barSpectrumReadData()');
  const alive = Array.from(bins4).filter((v) => v > 0.05).length;
  assert.ok(alive >= 50, '对数分组按段平均，绝大多数段要有值（当前 ' + alive + '/64）');

  const bins2 = new Float64Array(64);
  bins2.fill(0.8);
  runSlice(['barSpectrumReadData'], { barSpectrumBins: bins2, frequencyData: undefined }, 'barSpectrumReadData()');
  assert.ok(Array.from(bins2).every((v) => v < 0.8), '没有音频数据时应衰减到静默');
});

/* ---------------------------------------------------------------- ⑤ 真贴底 + 只画柱阵（透明叠加） */
test('⑤ 三套都贴底画柱阵，且不铺背景、不画进度线、不改控制条颜色', () => {
  const h = 96;
  const drawFns = [
    'barSpectrumBinAt', 'barSpectrumKgTheme', 'barSpectrumKgGradient',
    'barSpectrumKgParticles', 'barSpectrumKgBars',
    'barSpectrumDrawRipple', 'barSpectrumDrawPulse', 'barSpectrumDrawRibbon',
    'barSpectrumPaint'
  ];
  /* 只取柱宽 <=4 的窄 rect；任何全幅 / 宽扁 rect 都是不该出现的卡片装饰 */
  const barsOf = (c) => c.calls.rects.filter((r) => r[2] <= 4);
  const densities = {};

  ['ripple', 'pulse', 'ribbon'].forEach((mode) => {
    const c = ctxStub();
    runSlice(drawFns, { barSpectrumBins: new Float64Array(64).fill(0.6), ctx: c },
      "barSpectrumPaint(ctx, 1080, " + h + ", 2.4, '" + mode + "')");
    const bars = barsOf(c);
    densities[mode] = bars.length;
    assert.ok(bars.length > 100, mode + ' 必须画出足量细柱（实际 ' + bars.length + '）');
    const bottoms = bars.map((r) => r[1] + r[3]);
    assert.ok(Math.max.apply(null, bottoms) <= h - 5 + 0.001, mode + ' 柱底不能超出 h-6');
    assert.ok(Math.max.apply(null, bottoms) >= h - 7, mode + ' 柱底必须真的贴到底沿');
    /* 11-12 修正：官方预览卡片的整幅渐变底色不能搬进控制条，否则控制台会变色 */
    assert.ok(!c.calls.rects.some((r) => r[2] >= 1000 && r[3] >= h - 1),
      mode + ' 禁止整幅背景填充（控制条颜色必须保持原样）');
    /* 11-12 修正：卡片自带的白色播放进度线不能重画，播放器已有 #progress-bar */
    assert.ok(!c.calls.rects.some((r) => r[2] > 100 && r[3] <= 4 && r[1] >= h - 5),
      mode + ' 禁止底部宽扁进度线（播放器已有自己的进度条）');
    assert.ok(c.calls.rects.every((r) => r[2] <= 4), mode + ' 画布上只允许窄柱，其余像素保持透明');
  });
  /* 三套柱距必须各不相同（官方 wave 7px / beat 8px / rhythm 3px），不能退化成同一形态 */
  assert.ok(densities.pulse > densities.ripple && densities.ripple > densities.ribbon,
    '三套疏密必须依次不同，实际 ' + JSON.stringify(densities));

  /* 三个制造过 bug 的函数必须整体移除，不是「不调用」——防止日后被重新接回来 */
  assert.doesNotMatch(engineSrc, /barSpectrumKgBackground|barSpectrumKgBaseline|barSpectrumKgPlayed/,
    '整幅背景 / 进度线 / 进度读取相关代码必须删除');
  const paintFn = extractFunction(engineSrc, 'barSpectrumPaint');
  assert.doesNotMatch(paintFn, /Background|Baseline|Progress|fillRect\(0, 0, w, h\)/,
    'paint 里不能再出现背景或进度线');
  assert.match(paintFn, /ctx\.clearRect\(0, 0, w, h\)/, '每帧先清空，保证非柱体像素全透明');
  assert.doesNotMatch(engineSrc, /currentTime\s*\/\s*duration/, '频谱不得自己算播放进度');
  /* 卡片底色只属于预览卡片，绝不能出现在绘制代码里 */
  assert.doesNotMatch(engineSrc, /#3c4d47|#7f5c2e|#816359/, '预览卡片底色不得进入播放器');

  const pulseCtx = ctxStub();
  runSlice(drawFns, { barSpectrumBins: new Float64Array(64).fill(0.6), ctx: pulseCtx },
    "barSpectrumPaint(ctx, 1080, " + h + ", 2.4, 'pulse')");
  assert.ok(barsOf(pulseCtx).length > 200, '动感律动是最密的一套（3px 间距），不能只剩 64 根粗柱');
  assert.match(extractFunction(engineSrc, 'barSpectrumDrawPulse'), /ctx\.globalAlpha = 0\.86;/,
    '整条柱子必须同透明度，不能按播放进度分深浅（用户看到「颜色深度不统一」）');
  assert.doesNotMatch(engineSrc, /barSpectrumProgress/, '进度亮度逻辑已移除，避免左亮右暗');

  const ribbonCtx = ctxStub();
  runSlice(drawFns, { barSpectrumBins: new Float64Array(64).fill(0.6), ctx: ribbonCtx },
    "barSpectrumPaint(ctx, 1080, " + h + ", 2.4, 'ribbon')");
  assert.ok(ribbonCtx.calls.arcs.length >= 12, '流光丝带要有白色光晕粒子');

  /* 柱色取自官方卡里柱体像素反解的本色（近白），不是卡片底色 */
  assert.match(engineSrc, /#a9c3bb/, '迷幻水波柱体色');
  assert.match(engineSrc, /#d8cdbb/, '动感律动柱体色');
  assert.match(engineSrc, /#b2a4a6/, '流光丝带柱体色');
  assert.match(extractFunction(engineSrc, 'barSpectrumKgBars'), /theme\.env\(xn\)/,
    '柱高必须由固定包络主导（酷狗「形态稳定、跟着音乐呼吸」的关键）');
  assert.match(extractFunction(engineSrc, 'barSpectrumKgBars'),
    /barSpectrumKgGradient\(ctx, theme\.bar, w\)/, '柱子必须用各自的水平渐变柱色');
});

/* ---------------------------------------------------------------- ⑥ 存档接线 */
test('⑥ fxDefaults 与打包快照两处默认、03c 归一化与保存两处白名单', () => {
  assert.equal((globalsSrc.match(/barSpectrum: 'ripple'/g) || []).length, 2, '两处默认快照都要有');
  assert.match(layoutSrc, /function normalizeBarSpectrumMode\(value, fallback\)/, '归一化函数必须存在');
  const norm = extractFunction(layoutSrc, 'normalizeBarSpectrumMode');
  assert.match(norm, /var allowed = \['ripple', 'pulse', 'ribbon', 'off'\]/, '存档白名单同样写在函数体内');
  assert.equal((layoutSrc.match(/barSpectrum: normalizeBarSpectrumMode\(/g) || []).length, 2, '读取与保存两处都要归一化');
  assert.match(layoutSrc, /heartScene: normalizeHeartSceneMode\(raw\.heartScene[\s\S]{0,200}barSpectrum: normalizeBarSpectrumMode\(raw\.barSpectrum/, '读取路径');
  assert.match(layoutSrc, /heartScene: normalizeHeartSceneMode\(fx\.heartScene[\s\S]{0,200}barSpectrum: normalizeBarSpectrumMode\(fx\.barSpectrum/, '保存路径');
});

/* ---------------------------------------------------------------- ⑦ 接线与层级 */
test('⑦ 皮肤弹层四格 / 延迟波 / 05e 补刷 / canvas 排在 shell 之后 / CSS 层级', () => {
  const deferredStart = loaderSrc.indexOf('const deferredModulePaths = [');
  const deferredEnd = loaderSrc.indexOf('];', deferredStart);
  const deferred = loaderSrc.slice(deferredStart, deferredEnd);
  assert.match(deferred, /07-fx\/05f-bar-spectrum\.js/, '必须挂在延迟波');
  assert.ok(deferred.indexOf('05e-skin-popover.js') < deferred.indexOf('05f-bar-spectrum.js'), '皮肤弹层要排在频谱模块之前');
  assert.match(skinSrc, /typeof syncBarSpectrumGrid === 'function'/, '打开弹层时要补刷四格');
  assert.match(htmlSrc, /id="skin-bar-spectrum-grid"/, '皮肤弹层里要有四格容器');
  assert.match(htmlSrc, /贴在控制条底沿，随音乐起伏/, '弹层说明要跟上「可见即显示」的新语义');
  assert.match(engineSrc, /bar\.querySelector\(':scope > \.lg-glass-shell'\)/, '必须显式找玻璃 shell');
  assert.match(engineSrc, /bar\.insertBefore\(el, shell\.nextSibling\)/, '画布要排在 shell 之后');
  assert.match(cssSrc, /#bottom-bar > \.bar-spectrum-canvas\{position:absolute;inset:0;width:100%;height:100%;z-index:1/, '画布层级与铺满');
  assert.match(cssSrc, /pointer-events:none;border-radius:inherit;clip-path:inset\(0 round 50px\)/, '不能挡点击、不能越出圆角');
  assert.match(cssSrc, /body\.bar-spectrum-on #bottom-bar > \.bar-spectrum-canvas\{opacity:1\}/, '默认不显示，激活才淡入');
  /* Folia 世界的 CSS 玻璃会隐藏 WebGL shell canvas，不能连频谱一起隐藏 */
  const foliaGlassCode = foliaGlassSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(foliaGlassCode, /body\.lg-folia-css \.lg-host > \.lg-glass-shell canvas/, '只隐藏 shell 里的 WebGL canvas');
  assert.doesNotMatch(foliaGlassCode, /#(bottom-bar|fx-panel|search-box)[^{]*\.lg-active canvas/,
    '禁止用后代选择器隐藏所有 canvas —— 会把控制条频谱和面板预览一起藏掉');
});

/* ---------------------------------------------------------------- ⑧ 点格落盘 */
test('⑧ pickBarSpectrum 写存档并即时生效，关闭时清空画布', () => {
  let saved = 0, cleared = 0;
  const fx = { barSpectrum: 'ripple' };
  const base = {
    fx,
    fxDefaults: { barSpectrum: 'ripple' },
    saveLyricLayout: () => { saved++; },
    paintBarSpectrumSelection: () => {},
    barSpectrumClear: () => { cleared++; }
  };
  assert.equal(runSlice(['barSpectrumNormalize', 'pickBarSpectrum'], base, "pickBarSpectrum('pulse')"), true);
  assert.equal(fx.barSpectrum, 'pulse');
  assert.equal(saved, 1, '点一格必须落盘');
  assert.equal(runSlice(['barSpectrumNormalize', 'pickBarSpectrum'], base, "pickBarSpectrum('off')"), true);
  assert.equal(fx.barSpectrum, 'off');
  assert.equal(cleared, 1, '关闭要立刻清空画布');
  assert.equal(runSlice(['barSpectrumNormalize', 'pickBarSpectrum'], base, "pickBarSpectrum('mirror')"), false, '已移除的样式不能选中');
  assert.equal(saved, 2, '非法值不能触发落盘');
});

/* ---------------------------------------------------------------- ⑨ FX 面板红心动效已删 */
test('⑨ FX 面板的红心动效区块已删除，皮肤弹层六格仍保留', () => {
  assert.doesNotMatch(htmlSrc, /id="heart-fx-grid"/, 'FX 面板那组并排预览格必须删掉');
  assert.doesNotMatch(htmlSrc, /<div class="fx-section-label">红心动效<\/div>/, 'FX 面板的「红心动效」区块标题必须删掉');
  assert.match(htmlSrc, /id="skin-heart-fx-grid"/, '皮肤弹层里的六格是唯一入口，不能一起删');
  assert.match(skinSrc, /if \(typeof syncHeartFxGrid === 'function'\) syncHeartFxGrid\(\)/, '皮肤弹层打开时仍要懒渲染六格');
  assert.doesNotMatch(layoutTabSrc, /syncHeartFxGrid|id === 'heart-fx-grid'/, 'FX 外观页不该再同步一个不存在的宿主');
  assert.match(heartFxPanelSrc, /document\.querySelectorAll\('\.heart-fx-grid'\)/, '05d 仍按 class 遍历，别写死 id');
  assert.match(fxPanelCssSrc, /\.heart-fx-grid\{/, '六格样式要留给皮肤弹层，不能连 CSS 一起删');
  assert.match(heartFxEngineSrc, /入口在顶栏「皮肤」弹层的红心动效六格/, '动效引擎的入口说明要跟上');
});

/* ---------------------------------------------------------------- ⑩ 响度动态 */
test('⑩ 柱高必须跟着响度变化，不能长期顶在同一高度', () => {
  const read = extractFunction(engineSrc, 'barSpectrumReadData');
  const code = read + `
    var peaks = [];
    for (var f = 0; f < 150; f++) {
      var loud = 0.35 + 0.65 * Math.abs(Math.sin(f / 9));
      if (f % 15 === 0) loud = 1;                 /* 每 0.5s 一个鼓点 */
      var d = new Uint8Array(256);
      for (var i = 0; i < 256; i++) d[i] = Math.round((40 + 170 * Math.exp(-i / 60)) * loud);
      frequencyData = d;
      barSpectrumReadData();
      var mx = 0;
      for (var k = 0; k < barSpectrumBins.length; k++) if (barSpectrumBins[k] > mx) mx = barSpectrumBins[k];
      peaks.push(mx);
    }
    peaks;
  `;
  const peaks = Array.from(vm.runInNewContext(code, {
    barSpectrumBins: new Float64Array(64),
    barSpectrumFloatData: null,
    barSpectrumTestData: null,
    frequencyData: null,
    Math, Number, Array, Uint8Array, Float64Array, isFinite
  }));
  const avg = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  const sd = Math.sqrt(peaks.reduce((a, b) => a + (b - avg) * (b - avg), 0) / peaks.length);
  const range = Math.max.apply(null, peaks) - Math.min.apply(null, peaks);
  assert.ok(sd > 0.12, '柱高标准差 ' + sd.toFixed(3) + ' 太小 → 又变成「大部分时间同一个高度」');
  assert.ok(range > 0.4, '动态范围 ' + range.toFixed(3) + ' 太小 → 响度变化没有传到柱高');
  assert.ok(avg < 0.92, '平均高度 ' + avg.toFixed(3) + ' 贴着满格 → 没有给鼓点留余量');
  const readFn = extractFunction(engineSrc, 'barSpectrumReadData');
  assert.match(readFn, /getFloatFrequencyData/, '优先用真实 dB 数据，避免字节在 -30dB 就饱和');
  assert.match(readFn, /fMin \* Math\.pow\(fRatio, i \/ n\)/, '频率必须按对数等比分组');
  assert.match(readFn, /sum \/ cnt \+ 80\) \/ 60/, '高度按 dB 区间（-80~-20dB）映射');
  assert.doesNotMatch(readFn, /255 \/ peak/, '禁止逐帧把峰值归一化到满格');
});

/* ---------------------------------------------------------------- ⑪ 暂停收尾 */
test('⑪ 暂停 / 播完时柱子要落下去，不能停在最后一帧', () => {
  const bins = new Float64Array(64).fill(0.8);
  const sandbox = { barSpectrumBins: bins, audio: { paused: true, ended: false }, console };
  vm.runInNewContext(
    extractFunction(engineSrc, 'barSpectrumPlaying') + '\n' +
    extractFunction(engineSrc, 'barSpectrumIdleDecay') + '\n' +
    'var pausedNow = barSpectrumPlaying(); barSpectrumIdleDecay();',
    sandbox
  );
  assert.equal(sandbox.pausedNow, false, '暂停时 barSpectrumPlaying 必须返回 false');
  assert.ok(Array.from(bins).every((v) => v < 0.7), '暂停后每一帧都要衰减');
  assert.match(extractFunction(engineSrc, 'barSpectrumTick'), /else barSpectrumIdleDecay\(\)/,
    '绘制循环里必须接上暂停衰减，否则会冻结在最后一帧');
});
