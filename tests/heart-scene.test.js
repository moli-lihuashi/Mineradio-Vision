'use strict';

// 收藏演出（2026-11-08）回归守：
// 整屏场景动画 snow / birds / off，选择存在 fx.heartScene，入口在顶栏「皮肤」弹层的「收藏演出」。
// 守六件事：
//   ① 存档白名单：12d 的默认值、03c 的归一化、06f 的读取器三处口径必须一致，脏值不落到 fx 上；
//   ② 触发面收窄：只有主红心（传 anchor 的那条路）触发，取消红心不放演出；
//   ③ 图层：画布挂 body、z-index 必须压在心形粒子层（14）以下，否则整屏暗场会吞掉粒子反馈；
//   ④ 自清理：跑完必须取消 rAF、清画布、摘 .on，不留常驻图层；
//   ⑤ 雪窗这一版是「融化消失」—— 不许再有水珠横向偏移 / 水痕离屏层（用户明确否掉了流下那段）；
//   ⑥ 面板：皮肤弹层里有 #skin-scene-fx-grid，打开弹层时才同步。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sceneSrc = read('public/js/modules/05-playback/06f-heart-scene.js');
const accountSrc = read('public/js/modules/05-playback/06c-account-actions.js');
const settingsSrc = read('public/js/modules/02-visual/03c-lyrics-layout-settings.js');
const globalsSrc = read('public/js/modules/00-state/12d-fx-runtime-globals.js');
const popoverSrc = read('public/js/modules/07-fx/05e-skin-popover.js');
const loaderSrc = read('public/js/index-loader.js');
const html = read('public/index.html');
const playbackCss = read('public/css/05-playback/playback.css');
const indexCss = read('public/css/index.css');

/* 按大括号配对取出一个顶层函数声明（函数体里有嵌套花括号，不能用正则截断） */
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

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, '未找到起点 ' + from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, '未找到终点 ' + to);
  return source.slice(a, b);
}

test('收藏演出：三处白名单口径一致，脏值一律回落到 snow', () => {
  const ctx = {};
  vm.runInNewContext(
    extractFunction(sceneSrc, 'heartSceneNormalize') +
    '\nthis.normalize = heartSceneNormalize;',
    ctx
  );
  assert.strictEqual(ctx.normalize('snow'), 'snow');
  assert.strictEqual(ctx.normalize('birds'), 'birds');
  assert.strictEqual(ctx.normalize('off'), 'off');
  ['', null, undefined, 'SNOW', 'rain', '  ', 0, {}].forEach((bad) => {
    assert.strictEqual(ctx.normalize(bad), 'snow', '脏值 ' + String(bad) + ' 应回落到 snow');
  });
  assert.strictEqual(ctx.normalize('rain', 'birds'), 'birds', '有合法 fallback 时用 fallback');
  assert.strictEqual(ctx.normalize(undefined, 'nope'), 'snow', 'fallback 也不合法时兜底 snow');

  // 03c 里那份（启动早期就要用，不能引用 06f 的常量）必须与 06f 完全同口径
  const ctx2 = {};
  vm.runInNewContext(
    extractFunction(settingsSrc, 'normalizeHeartSceneMode') +
    '\nthis.normalize = normalizeHeartSceneMode;',
    ctx2
  );
  ['snow', 'birds', 'off', '', null, 'rain', 'SNOW', 3].forEach((v) => {
    assert.strictEqual(ctx2.normalize(v), ctx.normalize(v), '两处归一化对 ' + String(v) + ' 的结论不一致');
  });
});

test('收藏演出：默认值 default + packaged 快照都是 snow', () => {
  const hits = globalsSrc.match(/heartScene:\s*'snow'/g) || [];
  assert.strictEqual(hits.length, 2, 'fxDefaults 与 PACKAGED_DEFAULT_FX_SNAPSHOT 两处都要有 heartScene');
  assert.ok(/heartScene:\s*normalizeHeartSceneMode\(raw\.heartScene/.test(settingsSrc),
    '读存档时必须过 normalizeHeartSceneMode（raw 那条路径）');
  assert.ok(/heartScene:\s*normalizeHeartSceneMode\(fx\.heartScene/.test(settingsSrc),
    '写回/归一化时也必须过 normalizeHeartSceneMode（fx 那条路径）');
});

test('收藏演出：只认主红心，取消红心不放演出', () => {
  const block = between(accountSrc, 'async function toggleLikeSong', 'refreshSearchResultActionStates();');
  assert.match(block, /if \(opts && opts\.anchor\) heartFxFeedback\(opts\.anchor, next\);/);
  assert.match(block, /if \(opts && opts\.anchor && next && typeof heartScenePlay === 'function'\) heartScenePlay\(\);/,
    '演出必须同时挂在锚点与 next（点亮）上，且用 typeof 兜住加载时序');
  // 全文件只许出现这一处调用：回滚（catch）与「取消」都不放演出
  const calls = accountSrc.match(/heartScenePlay\s*\(/g) || [];
  assert.strictEqual(calls.length, 1, 'heartScenePlay 只允许在点亮分支里被调用一次，实际 ' + calls.length + ' 次');
  const dipped = accountSrc.slice(accountSrc.indexOf('请求失败 ='));
  assert.ok(dipped.indexOf('heartScenePlay') < 0, '请求失败回滚那条路不许放演出');
});

test('收藏演出：画布挂 body、z-index 压在粒子层之下、不吃点击', () => {
  assert.match(sceneSrc, /document\.body\.appendChild\(c\)/, '画布必须挂 body，挂底栏会被 backdrop-filter 裁掉');
  const canvasRule = playbackCss.match(/\.heart-scene-canvas\{[^}]*\}/);
  assert.ok(canvasRule, '缺少 .heart-scene-canvas 样式');
  const z = Number((canvasRule[0].match(/z-index:\s*(\d+)/) || [])[1]);
  const layerZ = Number((playbackCss.match(/\.heart-fx-layer\{[^}]*z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z < layerZ, '.heart-scene-canvas 的 z-index(' + z + ') 必须小于粒子层(' + layerZ + ')');
  assert.match(canvasRule[0], /pointer-events:\s*none/, '整屏画布不许吃鼠标');
  assert.match(canvasRule[0], /position:\s*fixed/);
});

test('收藏演出：一场演完自己清干净', () => {
  const stopFn = extractFunction(sceneSrc, 'heartSceneStop');
  assert.match(stopFn, /cancelAnimationFrame\(state\.raf\)/, '必须取消 rAF');
  assert.match(stopFn, /clearRect\(/, '必须清画布');
  assert.match(stopFn, /classList\.remove\('on'\)/, '必须摘掉 .on 类');
  const tickFn = extractFunction(sceneSrc, 'heartSceneTick');
  assert.match(tickFn, /if \(!alive\) \{ heartSceneStop\(\); return; \}/, '场景结束必须停');
  assert.match(tickFn, /catch \(err\) \{\s*console\.warn\('\[heartScene\] frame failed:', err\);\s*heartSceneStop\(\);\s*return;\s*\}/,
    '单帧异常也要收场（catch 里必须 heartSceneStop 后 return，不能把 rAF 挂死）');
  // 再点一次红心时先停上一场，避免两场叠着画
  const playFn = extractFunction(sceneSrc, 'heartScenePlay');
  assert.match(playFn, /heartSceneStop\(\);\s*\n\s*var canvas = heartSceneCanvas\(\);/, '开演前要先停掉上一场');
});

test('收藏演出：雪窗是「融化消失」，不许再有流下的水痕', () => {
  const snowFn = extractFunction(sceneSrc, 'heartSceneBuildSnow');
  assert.match(snowFn, /VANISH/, '必须有「融化后消失」的相位');
  assert.ok(snowFn.indexOf('drop.x +=') < 0, '水珠不许再横向移动（流下那一版已否掉）');
  assert.ok(snowFn.indexOf('FadeLayer') < 0, '雪窗不许再用离屏水痕层');
  assert.ok(snowFn.indexOf('layers') < 0 && snowFn.indexOf('layer.g') < 0, '雪窗不该再建离屏画布');
  // 收尾必须是缩小 + 淡出，而不是一路流到画面底部
  assert.match(snowFn, /drop\.r = 12\.5 \* \(1 - v \* 0\.94\)/, '结尾水珠要缩没');
  assert.match(snowFn, /drop\.a = 1 - v/, '结尾水珠要淡出');
});

test('收藏演出：皮肤弹层里的三格与打开时机', () => {
  assert.match(html, /id="skin-scene-fx-grid"/, '皮肤弹层里要有 #skin-scene-fx-grid');
  assert.match(html, /收藏演出/, '要有「收藏演出」小标题');
  const popover = extractFunction(popoverSrc, 'toggleSkinPopover');
  assert.match(popover, /if \(typeof syncHeartSceneGrid === 'function'\) syncHeartSceneGrid\(\);/,
    '打开皮肤弹层时要同步演出格（typeof 兜住加载时序）');
  assert.match(sceneSrc, /HEART_SCENE_MODES = \['snow', 'birds', 'off'\]/, '档位只有 snow/birds/off');
  assert.match(indexCss, /\.scene-fx-grid\{[^}]*grid-template-columns:repeat\(3/, '三格并排');
  assert.match(indexCss, /\.scene-fx-tile\.active\{/, '选中态样式要在');
});

test('收藏演出：模块排在红心粒子之后加载', () => {
  const iE = loaderSrc.indexOf("'js/modules/05-playback/06e-heart-fx.js'");
  const iF = loaderSrc.indexOf("'js/modules/05-playback/06f-heart-scene.js'");
  assert.ok(iE > 0 && iF > 0, '两个模块都要在 modulePaths 里');
  assert.ok(iF > iE, '06f 必须排在 06e 之后');
});
