'use strict';

/* LiquidGlass 全链路接线守卫。
 * 「库支持」不等于「用户能调」：以前 5 个宿主各抄 7 行 if、面板少 4 个控件、
 * 7 个 shader 参数永远拿不到非零值、插件 mount 传错构造参数、Folia 镜像缓存锁死。
 * 这里既跑真实源码切片（配置函数 / 光晕绘制），也做源码文本守卫防回退。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const count = (text, re) => (text.match(re) || []).length;
function slice(code, from, to) {
  const a = code.indexOf(from);
  const b = code.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, 'slice markers missing: ' + from + ' -> ' + to);
  return code.slice(a, b);
}

const CFG = read('public/js/modules/06-fx/01-liquidglass-config.js');
const MGR = read('public/js/modules/06-fx/00-liquidglass-manager.js');
const API = read('public/js/modules/06-fx/04-liquidglass-plugin-api.js');
const PERF = read('public/js/modules/06-fx/03-liquidglass-perf.js');
const HTML = read('public/index.html');
const FXSTATE = read('public/js/modules/00-state/12d-fx-runtime-globals.js');
const ARCHIVE = read('public/js/modules/07-fx/00-preset-archive-data.js');
const INPUTS = read('public/js/modules/07-fx/05a-fx-panel-inputs.js');
const BIND = read('public/js/modules/07-fx/07-bindings-shelf-immersive.js');
const MAIN = read('public/js/modules/11-main-loop.js');
/* 外部插件示例放在 _samples/ 子目录：`desktop/liquidglass-plugins.js` 只扫根层，
 * 所以它不会被自动加载（真挂宿主 root 会被 hostOwnsRoot 闸门拒绝）。 */
const PLUGIN = read('public/plugins/liquidglass/_samples/sample-bottom-pill.js');
const VENDOR = read('public/vendor/liquidglass/index.js');
const FOLIA_CSS_JS = read('public/js/modules/06-fx/06-liquidglass-folia-css.js');
const FOLIA_CSS_CSS = read('public/css/06-fx/glass-folia.css');
const LOADER = read('public/js/index-loader.js');

/* ---------- 1. 映射表：每个目标都必须是库真正认识的 config key ---------- */
const vendorDefaults = /var DEFAULTS = \{([\s\S]*?)\n\};/.exec(VENDOR);
assert(vendorDefaults, 'vendor DEFAULTS block');
const vendorKeys = new Set(
  Array.from(vendorDefaults[1].matchAll(/^\s*([A-Za-z]\w*)\s*:/gm), (m) => m[1])
);
const mapBlock = /var LIQUID_GLASS_FX_MAP = \{([\s\S]*?)\n\};/.exec(CFG);
assert(mapBlock, 'LIQUID_GLASS_FX_MAP');
const pairs = Array.from(mapBlock[1].matchAll(/(liquidGlass\w+)\s*:\s*'([A-Za-z]\w*)'/g),
  (m) => [m[1], m[2]]);
assert.strictEqual(pairs.length, 14, '14 fx keys mapped');
for (const [fxKey, cfgKey] of pairs) {
  assert(vendorKeys.has(cfgKey), fxKey + ' -> unknown vendor key ' + cfgKey);
}
assert.strictEqual(new Set(pairs.map((p) => p[1])).size, pairs.length, 'no duplicate config target');

/* 高级分支以前永远为 0，现在必须都在映射里 */
for (const key of ['specular', 'fresnel', 'shadowOpacity', 'shadowSpread',
  'tintStrength', 'distortion', 'bevelMode']) {
  assert(pairs.some((p) => p[1] === key), 'shader branch reachable: ' + key);
}

/* ---------- 2. 真跑配置函数 ---------- */
const configSlice = slice(CFG, 'var LIQUID_GLASS_FX_MAP = {',
  'function getLiquidGlassProfile()');
const sandbox = {
  console,
  window: {},
  fx: {},
  document: { querySelector: () => null, querySelectorAll: () => [] },
  getComputedStyle: () => ({ borderRadius: '26px' }),
};
sandbox.global = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(configSlice + '\n' + slice(CFG,
  'function syncLiquidGlassCornerRadius(host, cfg)',
  'function refreshControlsWebglPreferFlag()'), sandbox);

const allFx = {};
for (const [fxKey] of pairs) allFx[fxKey] = 0.37;
sandbox.fx = allFx;
const cfg = sandbox.liquidGlassFxConfig({ blurAmount: 0.1, keepMe: 7 });
for (const [fxKey, cfgKey] of pairs) {
  assert.strictEqual(cfg[cfgKey], 0.37, fxKey + ' -> ' + cfgKey + ' reaches config');
}
assert.strictEqual(cfg.keepMe, 7, 'preset-only fields survive');
assert.strictEqual(sandbox.getLiquidGlassConfigFromFx().blurAmount, 0.37, 'CSS-glass path reads fx too');

sandbox.fx = { liquidGlassBlur: 'not-a-number', liquidGlassRefraction: '', liquidGlassTint: null };
const safeCfg = sandbox.liquidGlassFxConfig({ blurAmount: 0.7, refraction: 0.18 });
assert.strictEqual(safeCfg.blurAmount, 0.7, 'NaN rejected');
assert.strictEqual(safeCfg.refraction, 0.18, 'empty string rejected');
assert.strictEqual(safeCfg.tintStrength, undefined, 'null rejected, preset/default wins');

const heroCfg = sandbox.syncLiquidGlassCornerRadius({}, { cornerRadius: 18, bevelMode: 1 });
assert.strictEqual(heroCfg.cornerRadius, 26, 'cornerRadius taken from computed style');
assert.strictEqual(heroCfg.bevelMode, 1, 'bevelMode is NOT force-reset to 0');
const initDefaults = sandbox.liquidGlassInitDefaults({ bevelMode: 1, distortion: 0.4, specular: 0.9 });
assert.strictEqual(initDefaults.bevelMode, 1, 'init defaults carry bevelMode');
assert.strictEqual(initDefaults.distortion, 0.4, 'init defaults carry distortion');
assert.strictEqual(initDefaults.specular, 0.9, 'init defaults carry specular');
assert.strictEqual(initDefaults.opacity, 1, 'opacity fallback kept');

/* ---------- 3. 光晕兜底真能画出非纯色像素层 ---------- */
const ambientSlice = slice(MAIN, 'function lgHexToRgba(hex, alpha)',
  'function updateFoliaLiquidGlassBackdropMirror()');
const amb = { console, Math };
vm.createContext(amb);
vm.runInContext(ambientSlice, amb);
let fills = 0;
const stops = [];
const fakeCtx = {
  set fillStyle(v) { this._fill = v; },
  get fillStyle() { return this._fill; },
  createRadialGradient() { return { addColorStop(o, c) { stops.push([o, c]); } }; },
  fillRect() { fills++; },
};
amb.drawFoliaMirrorAmbient(fakeCtx, 800, 600, { primary: '#aabbcc' }, 12345);
assert.strictEqual(fills, 2, 'two ambient gradient passes');
assert.strictEqual(stops.length, 5, 'gradient stops produced (3 accent + 2 highlight)');
assert(stops.some((s) => /0\.22\)/.test(s[1])), 'accent stop is visible, not fully transparent');
assert(stops.some((s) => /170,\s*187,\s*204/.test(s[1])), 'theme colour actually parsed');

/* ---------- 4. 面板 / 存档 / 绑定三处齐全且不重复 ---------- */
const fxKeys = pairs.map((p) => p[0]);
const ids = fxKeys.map((k) => 'fx-' + k.toLowerCase());
for (const id of ids) {
  assert.strictEqual(count(HTML, new RegExp('id="' + id + '"', 'g')), 1, 'HTML has exactly one ' + id);
  assert.strictEqual(count(INPUTS, new RegExp("setRange\\('" + id + "'", 'g')), 1,
    'updateFxInputs has exactly one ' + id);
  assert.strictEqual(count(BIND, new RegExp("\\['" + id + "'", 'g')), 1,
    'bindings has exactly one ' + id);
  assert.strictEqual(count(FXSTATE, new RegExp('\\b' + fxKeys[ids.indexOf(id)] + '\\s*:', 'g')), 2,
    'fxDefaults + packaged snapshot both have ' + fxKeys[ids.indexOf(id)]);
  assert.strictEqual(count(ARCHIVE, new RegExp("archiveNumber\\(raw, '" + fxKeys[ids.indexOf(id)] + "'", 'g')), 1,
    'archive normalises ' + fxKeys[ids.indexOf(id)]);
}
assert(/id="fx-liquidglass-advanced-fold"/.test(HTML), 'advanced fold exists');
for (const fxKey of fxKeys) {
  assert(new RegExp("pair\\[1\\] === '" + fxKey + "'").test(BIND), 'clamp exists for ' + fxKey);
}
assert(/if \(window\.applyAllLiquidGlassConfig\) window\.applyAllLiquidGlassConfig\(\);/.test(BIND),
  'slider change refreshes ALL hosts');
assert(!/\['fx-liquidglassrefraction','liquidGlassRefraction'\][\s\S]{0,400}\['fx-liquidglassrefraction','liquidGlassRefraction'\]/.test(BIND),
  'no duplicate binding');

/* ---------- 5. 五个宿主统一走配置入口，第 6 个预设真的接线 ---------- */
/* 7 = 定义 1 + getLiquidGlassConfigFromFx 1 + 五个宿主；5 = 五个宿主。
 * 写死数量，任一宿主改回手抄 7 行 if 都会判红。 */
assert.strictEqual(count(CFG, /liquidGlassFxConfig\(/g), 7, 'config helper used by every host');
assert.strictEqual(count(CFG, /defaults: liquidGlassInitDefaults\(/g), 5, 'every init gets full defaults');
assert(!/defaults:\s*\{[^}]*?bevelMode: 0/.test(CFG), 'no hardcoded bevelMode left in any init defaults');

/* .home-hero 是独立 CSS 玻璃，绝不能被默认接管：
 * 2026-11-10 曾把它接成第 6 个 WebGL 宿主，用 !important 清掉了原本的渐变背景
 * 和 blur(38px)，还导致拖任意液态玻璃滑块时整块首页跟着变（用户明确指出）。已撤回。 */
assert(!/mgr\.register\('homeHero'/.test(CFG), 'homeHero must NOT be auto-registered');
assert(!/window\.applyHomeHeroLiquidGlassConfig/.test(CFG), 'no homeHero config refresh');
assert(!/setProperty\('backdrop-filter', 'none', 'important'\)/.test(CFG),
  'no host may nuke .home-hero CSS backdrop-filter via !important');
assert(!/homeHero\s*:/.test(MGR), 'stale homeHero preset removed');
assert(!/\.hero-card/.test(MGR), 'stale .hero-card selector removed');
const applyAll = slice(CFG, 'function applyAllLiquidGlassConfig()',
  'window.applyAllLiquidGlassConfig =');
for (const name of ['applyHomeLiquidGlassConfig', 'applyFxLiquidGlassConfig',
  'applySearchLiquidGlassConfig', 'applyBottomLiquidGlassConfig',
  'applyHomeLiquidGlassCardConfig', 'applyFoliaCssGlass']) {
  assert(applyAll.indexOf("'" + name + "'") >= 0, 'applyAll covers ' + name);
}
assert(applyAll.indexOf('applyHomeHero') < 0, 'applyAll must NOT touch .home-hero');

/* ---------- 6. 插件 API 死接线 ---------- */
assert(/typeof global\.getLiquidGlassPerfInfo === 'function'\) return global\.getLiquidGlassPerfInfo\(\)/
  .test(API), 'getPerf wired to real perf monitor');
assert(/glassElements: elements/.test(API), 'plugin mount uses glassElements');
assert(!/root: root,\s*\n\s*elements: elements/.test(API), 'old wrong constructor arg gone');
assert(/instance\._start\(\)/.test(API), 'plugin instance actually starts its pipeline');
assert(/ensureLiquidGlassBackdropShell\(root\)/.test(API), 'plugin auto-creates backdrop shell');
assert(/sample-bottom-pill-external/.test(PLUGIN), 'external sample no longer collides with builtin id');
assert(/api\.mount\(PRESET/.test(PLUGIN) && /api\.unmount\(PRESET\)/.test(PLUGIN),
  'external sample really mounts and unmounts');

/* ---------- 7. 性能注释与常量一致 ---------- */
assert(/P95 > 55ms/.test(PERF) && /DEGRADE_P95_MS = 55/.test(PERF), 'degrade threshold documented correctly');
assert(/P95 < 34ms/.test(PERF) && /RECOVER_P95_MS = 34/.test(PERF), 'recover threshold documented correctly');
assert(/持续 5 秒/.test(PERF) && /DEGRADE_HOLD_MS = 5000/.test(PERF), 'degrade hold documented correctly');
assert(/持续 6 秒/.test(PERF) && /RECOVER_HOLD_MS = 6000/.test(PERF), 'recover hold documented correctly');

/* ---------- 8. Folia 镜像缓存不再被共用时间戳锁死 ---------- */
assert(/var _foliaMirrorCanvasesAt = 0;/.test(MAIN), 'canvas cache has its own timestamp');
assert(/\(nowMs - _foliaMirrorCanvasesAt\) > 1000/.test(MAIN), 'canvas cache expires independently');
assert(!/nowMs0 - _foliaMirrorRectAt\) <= 1000/.test(MAIN), 'root-rect timestamp no longer gates canvas cache');
assert(/_foliaMirrorCanvasesAt = nowMs;/.test(MAIN), 'canvas cache timestamp refreshed');
assert(/drawFoliaMirrorAmbient\(_lgMirrorCtx, W, H, theme, nowMs\)/.test(MAIN),
  'ambient layer actually drawn into the mirror');
assert(/updateFoliaLiquidGlassBackdropMirror\(\);/.test(MAIN), 'Folia frame still feeds the mirror');

/* ---------- 9. Folia 世界：切 CSS 玻璃桥 ---------- */
assert.strictEqual(count(HTML, /glass-folia\.css/g), 1, 'glass-folia.css linked exactly once');
const fxGlassAt = HTML.indexOf('css/06-fx/fx-glass.css');
const foliaCssAt = HTML.indexOf('css/06-fx/glass-folia.css');
assert(fxGlassAt >= 0 && foliaCssAt > fxGlassAt, 'glass-folia.css must load after fx-glass.css');
assert.strictEqual(count(LOADER, /06-liquidglass-folia-css\.js/g), 1, 'bridge module registered in loader');
assert(/folia-world-active/.test(FOLIA_CSS_JS), 'bridge watches folia-world-active');
assert(/lg-folia-css/.test(FOLIA_CSS_JS) && /lg-folia-css/.test(FOLIA_CSS_CSS),
  'body class shared by JS and CSS');
assert(/visibility:\s*hidden\s*!important/.test(FOLIA_CSS_CSS), 'WebGL canvas hidden in Folia mode');
assert(/--lg-folia-filter/.test(FOLIA_CSS_CSS) && /--lg-folia-bg/.test(FOLIA_CSS_CSS),
  'CSS variables drive the fallback glass');
assert(/_running = false/.test(FOLIA_CSS_JS), 'bridge pauses instance rAF');
assert(/ensureLiquidGlassRunning/.test(FOLIA_CSS_JS), 'bridge resumes instances on exit');
/* 只断言「文件里有 ensureLiquidGlassRunning」不够：把 disable() 里的调用删掉测试仍会绿。
 * 单独切出 disable() 函数体，确认退出世界时真的调用了 resumeInstances()。 */
const disableFn = slice(FOLIA_CSS_JS, '  function disable() {', '  function sync() {');
assert(/resumeInstances\(\);/.test(disableFn), 'disable() actually calls resumeInstances()');
assert(/classList\.remove\(CSS_CLASS\)/.test(disableFn), 'disable() clears the body class');
assert(/stopGuard\(\);/.test(disableFn), 'disable() stops the suppression guard');

/* 宿主的可见性观察器会在 body class 变化时把停掉的 rAF 又拉起来：
 * 只停一次拦不住，Folia 期间必须持续压制。 */
const enableFn = slice(FOLIA_CSS_JS, '  function enable() {', '  function disable() {');
assert(/startGuard\(\);/.test(enableFn), 'enable() starts the suppression guard');
assert(/setInterval\(stopAllInstances, 600\)/.test(FOLIA_CSS_JS), 'guard re-stops instances periodically');

/* 面板提示：Folia 下只有模糊/饱和/亮度生效，必须写清楚，否则会被当成控件坏了 */
assert(/id="fx-folia-glass-hint"/.test(HTML), 'panel hint element exists');
assert(/fx-folia-glass-hint/.test(FOLIA_CSS_JS), 'bridge toggles the panel hint');
assert(/setHint\(true\)/.test(enableFn), 'enable() shows the hint');
assert(/setHint\(false\)/.test(disableFn), 'disable() hides the hint');
assert(/window\.applyFoliaCssGlass = applyFoliaCssGlass/.test(FOLIA_CSS_JS),
  'bridge exposes applyFoliaCssGlass for slider refresh');

const foliaSandbox = {
  console,
  window: null,
  document: {
    readyState: 'complete',
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    body: { classList: { add() {}, remove() {}, contains() { return false; } } },
    addEventListener() {},
  },
  MutationObserver: function () { this.observe = function () {}; },
  setTimeout: function () { return 0; },
  clearTimeout() {},
  setInterval: function () { return 0; },
  clearInterval() {},
};
foliaSandbox.window = foliaSandbox;
vm.createContext(foliaSandbox);
vm.runInContext(FOLIA_CSS_JS, foliaSandbox);
assert.strictEqual(typeof foliaSandbox.buildFoliaGlassVars, 'function', 'vars builder exposed to tests');

const dflt = foliaSandbox.buildFoliaGlassVars({});
assert.strictEqual(dflt.filter, 'blur(24px) saturate(1.68) brightness(0.98)', 'default filter from fx defaults');
assert.strictEqual(dflt.bg, 'rgba(20,22,28,0.39)', 'default bg alpha follows blur');
const maxed = foliaSandbox.buildFoliaGlassVars({
  liquidGlassBlur: 9, liquidGlassSaturation: 9, liquidGlassBrightness: -9,
});
assert.strictEqual(maxed.filter, 'blur(32px) saturate(3.00) brightness(0.44)', 'out-of-range fx clamped');

console.log('[OK] LiquidGlass wiring: 14 fx params, 5 WebGL hosts, .home-hero CSS glass untouched, plugin SDK, Folia mirror + CSS fallback.');
