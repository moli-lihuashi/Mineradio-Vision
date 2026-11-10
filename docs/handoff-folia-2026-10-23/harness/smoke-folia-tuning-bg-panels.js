/* Folia 背景调参面板（latent / sora / common）纯逻辑冒烟：
 * Node vm 沙箱里装最小 DOM 桩，加载 01a/01b/01c/0l 四个模块 + 模式注册表，
 * 断言三个背景的 tuning 存档语义、blank / disable 的运行时行为、面板结构与提交链路。
 *
 * 断言来源互不替代：
 *   1) latent  —— set 合并归一化（钳区间 / 枚举回落）、落盘、reset、对象不可变
 *   2) sora    —— blank 默认 false；blank=true 时不挂 WebGL 画布只渲染纯色帧（entry.tsx:17 语义）、
 *                 昼夜换色、destroy 摘节点
 *   3) common  —— disableVignette 不渲染暗角节点；disableGeometricBackground 同藏图形+浮尘
 *                 （GeometricBackground.tsx:109 的 !hideShapes 包住两个 map）；create 与 rebuild 都门控
 *   4) 面板    —— 注册表双维度（bg+mode）、双面板叠加（背景占折叠标题行 / 模式退面板内标题）、
 *                 分段药丸 3+2、开关行 3、叠色 disabledWhen 联动、percent 格式、
 *                 拖动只改内存 / 松手落盘+重建、开关点击落盘+重建+面板刷新
 *
 * 用法：node .workbuddy/harness/smoke-folia-tuning-bg-panels.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const MOD = process.env.FOLIA_MOD_DIR
  ? path.resolve(process.env.FOLIA_MOD_DIR)
  : path.join(ROOT, 'public', 'js', 'modules', '12-folia');

const out = [];
const ok = (name, cond, detail) => {
  const line = (cond ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + detail);
  out.push(line);
  console.log(line);
  return cond;
};

/* =============================== DOM 桩 ===============================
 * className 语义对齐浏览器：直接赋值 = 整体覆写基类；classList 增删在其上叠加。
 * （模块里两种用法混用：foliaTuningEl 直接赋基类，paint/disabled 用 classList 增删状态类。） */
class FakeClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(c) { this.set.add(c); this.node.__syncClass(); }
  remove(c) { this.set.delete(c); this.node.__syncClass(); }
  contains(c) {
    return this.set.has(c)
      || (this.node.__baseClass || '').split(/\s+/).includes(c);
  }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : !!force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.__baseClass = '';
    this.__extraClass = new Set();
    this.textContent = '';
    this.hidden = false;
    this.value = '';
    this.id = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.disabled = false;
    this._attrs = {};
    this._listeners = {};
    this.style = {
      __props: {},
      setProperty(k, v) { this.__props[k] = String(v); },
      getPropertyValue(k) { return this.__props[k] === undefined ? '' : this.__props[k]; },
    };
    Object.defineProperty(this.style, 'backgroundColor', {
      get() { return this.__props.backgroundColor === undefined ? '' : this.__props.backgroundColor; },
      set(v) { this.__props.backgroundColor = String(v); },
      enumerable: true, configurable: true,
    });
    this.classList = new FakeClassList(this);
  }
  __syncClass() {
    const base = (this.__baseClass || '').split(/\s+/).filter(Boolean);
    this.__className = base.concat([...this.__extraClass]).join(' ');
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  setAttribute(key, value) { this._attrs[key] = String(value); }
  getAttribute(key) { return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null; }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  fire(type) {
    const list = this._listeners[type] || [];
    for (const fn of list) fn({ type, target: this });
    return list.length;
  }
  findAll(pred, acc) {
    const found = acc || [];
    for (const child of this.children) {
      if (pred(child)) found.push(child);
      child.findAll(pred, found);
    }
    return found;
  }
  find(pred) { return this.findAll(pred)[0] || null; }
}

/* className 直赋走 assignClass（保留基类），普通读走 __className。 */
Object.defineProperty(FakeNode.prototype, 'className', {
  get() { return this.__className || ''; },
  set(v) { this.__baseClass = String(v); this.__syncClass(); },
  configurable: true,
});

const makeDocument = (ids) => {
  const registry = ids || {};
  return {
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => registry[id] || null,
    __registry: registry,
  };
};

/* =============================== 沙箱装配 ===============================
 * 每段独立沙箱：01a/01b/01c 的 tuning 缓存在 IIFE 里关着，独立上下文 = 独立缓存。 */
const FILES = [
  '00b-folia-image-pool.js',
  '01-folia-mode-registry.js',
  '01a-folia-bg-sora.js',
  '01b-folia-bg-common.js',
  '01c-folia-bg-latent.js',
  '01d-folia-bg-monet.js',
  '01e-folia-bg-noise-texture.js',
  '01f-folia-bg-nomand.js',
  '01g-folia-bg-url.js',
  '0l0-folia-mode-tuning.js',
  '0l-folia-tuning-panel.js',
  '0l1-folia-mode-panels.js',
];

function loadSandbox(opts) {
  const o = opts || {};
  const store = new Map();
  for (const k of Object.keys(o.store || {})) store.set(k, o.store[k]);

  const host = new FakeNode('div');
  const fold = new FakeNode('div');
  const title = new FakeNode('strong');
  const sub = new FakeNode('small');

  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  /* 01g 的 normalizeUrl 依赖 URL（浏览器全局）：vm 里要显式给。 */
  sandbox.URL = URL;
  sandbox.document = makeDocument({
    'fx-folia-tuning': host,
    'fx-folia-tuning-fold': fold,
    'fx-folia-tuning-title': title,
    'fx-folia-tuning-sub': sub,
  });
  sandbox.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  /* 图片池要真 Blob（File 是 Blob 子类）与 URL.createObjectURL；Node 自带，直接借进去。
   * 沙箱里**不给** indexedDB —— 正好覆盖「DB 不可用时退化成内存表」那条分支。 */
  sandbox.Blob = Blob;
  sandbox.File = File;
  sandbox.foliaWorld = Object.assign({ mode: 'still', background: 'none', active: false }, o.foliaWorld || {});
  sandbox.__rebuildCalls = 0;
  sandbox.foliaWorldRebuildBackground = function () { sandbox.__rebuildCalls += 1; };

  vm.createContext(sandbox);
  for (const file of FILES) {
    const full = path.join(MOD, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
  }
  return { S: sandbox, store, host, fold, title, sub, sandbox };
}

const DARK_THEME = { backgroundColor: '#05070b', primaryColor: '#eef7ff', secondaryColor: '#8fa3b8', accentColor: '#7fe3ff' };
const LIGHT_THEME = { backgroundColor: '#f2f5f8', primaryColor: '#22303c', secondaryColor: '#5b6b7a', accentColor: '#22303c' };

const SORA_KEY = 'mineradio-folia-sora-tuning-v1';
const COMMON_KEY = 'mineradio-folia-common-tuning-v1';
const LATENT_KEY = 'mineradio-folia-latent-tuning-v1';
const NOMAND_KEY = 'mineradio-folia-nomand-tuning-v1';
const MONET_KEY = 'mineradio-folia-monet-tuning-v1';
const URL_KEY = 'mineradio-folia-url-tuning-v1';
/* 模式调参桶与绘光共用一份物理存档（键下按模式 id 分桶）。 */
const MODE_KEY = 'mineradio-folia-tuning-v1';

/* 防御式读存档：键不存在 / JSON 脏都返回空对象，别让断言本身抛错吞掉 FAIL 行。 */
const savedObj = (store, key) => {
  try {
    const t = store.get(key);
    return t ? JSON.parse(t) : {};
  } catch (_) {
    return {};
  }
};

/* =============================== A. latent tuning 运行时 =============================== */
{
  const { S, store } = loadSandbox();

  ok('latent 四个写入口都导出',
    typeof S.foliaLatentTuning === 'function'
    && typeof S.foliaLatentSetTuning === 'function'
    && typeof S.foliaLatentSaveTuning === 'function'
    && typeof S.foliaLatentResetTuning === 'function');

  const d = S.foliaLatentTuning();
  ok('无存档读默认（displayMode=both / overlayOpacity=0.35）',
    d.displayMode === 'both' && d.colorSource === 'cover-theme' && d.overlayOpacity === 0.35
    && d.ditheringSpeed === 0.1 && d.ditheringSize === 2.5 && d.ditheringAudioSpeed === 1.2
    && d.meshSpeed === 0.3 && d.meshAudioSpeed === 2 && d.meshDistortion === 0.8 && d.meshSwirl === 0.1,
    JSON.stringify(d));

  const before = S.foliaLatentTuning();
  const next = S.foliaLatentSetTuning({ ditheringSpeed: 99 });
  ok('set 上越界钳到 2', next.ditheringSpeed === 2);
  ok('set 换新对象（不可变，运行时靠身份早退）', next !== before);
  ok('set 只动这一项', next.meshSpeed === before.meshSpeed && next.overlayOpacity === 0.35);

  ok('displayMode 只认三档（bogus → 默认 both）',
    S.foliaLatentSetTuning({ displayMode: 'bogus' }).displayMode === 'both');
  ok('displayMode 三档都能存（mesh 没被枚举丢掉）',
    S.foliaLatentSetTuning({ displayMode: 'mesh' }).displayMode === 'mesh');
  ok('colorSource 只认两档（bogus → 默认 cover-theme）',
    S.foliaLatentSetTuning({ colorSource: 'bogus' }).colorSource === 'cover-theme');
  ok('ditheringSize 区间 [0.5,8]',
    S.foliaLatentSetTuning({ ditheringSize: 0.1 }).ditheringSize === 0.5
    && S.foliaLatentSetTuning({ ditheringSize: 99 }).ditheringSize === 8);
  ok('meshSwirl 区间 [0,1]',
    S.foliaLatentSetTuning({ meshSwirl: 3 }).meshSwirl === 1);
  ok('布尔不认字符串（dynamicOnlyInPlayer 传字符串 → 默认 true）',
    S.foliaLatentSetTuning({ dynamicOnlyInPlayer: 'x' }).dynamicOnlyInPlayer === true);

  store.delete(LATENT_KEY);
  S.foliaLatentSetTuning({ ditheringSpeed: 1.7 });
  ok('set 后未 save 不落盘', store.get(LATENT_KEY) == null);
  S.foliaLatentSaveTuning();
  const raw = savedObj(store, LATENT_KEY);
  ok('save 落盘的是缓存值（1.7）', raw.ditheringSpeed === 1.7, JSON.stringify(raw.ditheringSpeed));

  S.foliaLatentResetTuning();
  ok('reset 回默认并落盘',
    S.foliaLatentTuning().ditheringSpeed === 0.1
    && savedObj(store, LATENT_KEY).ditheringSpeed === 0.1);
}

/* =============================== B. sora tuning + blank 运行时 =============================== */
{
  const { S, store } = loadSandbox();

  ok('sora 四个写入口都导出',
    typeof S.foliaSoraTuning === 'function' && typeof S.foliaSoraSetTuning === 'function'
    && typeof S.foliaSoraSaveTuning === 'function' && typeof S.foliaSoraResetTuning === 'function');
  ok('blank 默认 false（types.ts:1062）', S.foliaSoraTuning().blank === false);
  ok('blank 不认字符串（传字符串 → false）',
    S.foliaSoraSetTuning({ blank: 'yes' }).blank === false);

  const host = S.document.createElement('div');
  const ctx = { theme: DARK_THEME, seed: 'abc', paused: false, now: 0 };
  const soraDef = S.getFoliaBackground('sora');
  ok('注册表里有 sora（create/tick/destroy 齐全）',
    !!soraDef && typeof soraDef.create === 'function' && typeof soraDef.tick === 'function');

  /* blank=true：整个 SoraBackground 不挂载，只剩一张纯色帧（entry.tsx:17-23）。 */
  S.foliaSoraSetTuning({ blank: true });
  S.foliaSoraSaveTuning();
  ok('blank=true 已落盘', savedObj(store, SORA_KEY).blank === true);

  const inst = (() => {
    try { return soraDef.create(host, ctx); } catch (err) { return { __error: err }; }
  })();
  ok('blank 帧不建 WebGL（inst.gl 为空）',
    !!inst && inst.blankFrame === true && inst.gl == null,
    inst && inst.__error && inst.__error.message);
  ok('blank 帧是 div 不是 canvas',
    !!inst && !inst.__error && inst.canvas.tagName === 'DIV');
  ok('blank 帧夜间纯黑',
    !!inst && !inst.__error && inst.canvas.style.backgroundColor === '#000000',
    inst && !inst.__error && inst.canvas.style.backgroundColor);

  if (inst && !inst.__error) {
    soraDef.tick(inst, { theme: LIGHT_THEME });
    ok('主题换昼间帧变纯白', inst.canvas.style.backgroundColor === '#ffffff',
      inst.canvas.style.backgroundColor);
    soraDef.tick(inst, { theme: LIGHT_THEME });
    ok('同主题不重写（幂等）', inst.canvas.style.backgroundColor === '#ffffff');
  } else {
    ok('主题换昼间帧变纯白', false, 'create 抛错');
    ok('同主题不重写（幂等）', false, 'create 抛错');
  }

  const host2 = S.document.createElement('div');
  try {
    const inst2 = soraDef.create(host2, ctx);
    soraDef.destroy(inst2);
    ok('destroy 摘掉 blank 帧', host2.children.length === 0);
  } catch (err) {
    ok('destroy 摘掉 blank 帧', false, err.message);
  }

  /* blank=false：走 WebGL 星空（桩里没有 getContext，应抛「需要 WebGL」而不是静默黑屏）。 */
  S.foliaSoraResetTuning();
  let threw = null;
  try { soraDef.create(S.document.createElement('div'), ctx); } catch (err) { threw = err; }
  ok('blank=false 走 WebGL 星空路径（桩里抛需要 WebGL）',
    !!threw && String(threw.message).indexOf('WebGL') >= 0, threw && threw.message);

  ok('reset 回默认并落盘',
    S.foliaSoraTuning().blank === false && savedObj(store, SORA_KEY).blank === false);
}

/* =============================== C. common tuning + disable 运行时 =============================== */
{
  const { S, store } = loadSandbox();

  ok('common 四个写入口都导出',
    typeof S.foliaCommonTuning === 'function' && typeof S.foliaCommonSetTuning === 'function'
    && typeof S.foliaCommonSaveTuning === 'function' && typeof S.foliaCommonResetTuning === 'function');
  ok('两项默认 false（CommonBackgroundSettingsCard ?? false）',
    S.foliaCommonTuning().disableVignette === false
    && S.foliaCommonTuning().disableGeometricBackground === false);
  ok('布尔不认字符串',
    S.foliaCommonSetTuning({ disableVignette: 1 }).disableVignette === false);

  const ctx = { theme: DARK_THEME, seed: 'song-a', paused: false, now: 0 };
  const mk = () => S.document.createElement('div');
  const commonDef = S.getFoliaBackground('common');

  /* 默认：暗角在，图形 15 + 浮尘 20 都在几何层里。 */
  const instA = commonDef.create(mk(), ctx);
  ok('默认渲染暗角节点', !!instA.vignette);
  ok('默认图形 15 个', instA.shapes.length === 15, String(instA.shapes.length));
  ok('默认浮尘 20 个', instA.particles.length === 20, String(instA.particles.length));
  ok('几何层子节点 = 15 + 20', instA.layer.children.length === 35,
    String(instA.layer.children.length));

  /* 只藏几何层：暗角还在。 */
  S.foliaCommonSetTuning({ disableGeometricBackground: true });
  S.foliaCommonSaveTuning();
  const instB = commonDef.create(mk(), ctx);
  ok('藏几何层时暗角仍在', !!instB.vignette);
  ok('藏几何层时图形与浮尘都空（!hideShapes 包住两个 map）',
    instB.shapes.length === 0 && instB.particles.length === 0);
  ok('藏几何层时几何层为空', instB.layer.children.length === 0);
  /* 换歌（seed 变化）经 tick 触发 rebuild 时也不能复活图形。 */
  commonDef.tick(instB, Object.assign({}, ctx, { seed: 'song-b' }));
  ok('rebuild 后仍为空（门控同样生效）',
    instB.shapes.length === 0 && instB.particles.length === 0 && instB.layer.children.length === 0);

  /* 浮名面板的「通用几何图形」是背景的共享输入（VisualizerFume.tsx:308 的 OR 语义）：
   * common 自己的开关关着、但当前模式是 fume 且 fume 那边也关着 → 一样不画。 */
  S.foliaCommonSetTuning({ disableGeometricBackground: false });
  S.foliaCommonSaveTuning();
  S.foliaWorld.mode = 'fume';
  S.foliaModeSetTuning('fume', { disableGeometricBackground: true });
  commonDef.tick(instB, Object.assign({}, ctx, { seed: 'song-c' }));
  ok('浮名模式 + 浮名开关关着 → 背景照样不画几何（OR 语义）',
    instB.shapes.length === 0 && instB.particles.length === 0);
  S.foliaWorld.mode = 'classic';
  commonDef.tick(instB, Object.assign({}, ctx, { seed: 'song-d' }));
  ok('切回其它模式后几何回来（15 + 20）',
    instB.shapes.length === 15 && instB.particles.length === 20,
    instB.shapes.length + '+' + instB.particles.length);

  /* 只关暗角：几何层照常。 */
  S.foliaCommonResetTuning();
  S.foliaCommonSetTuning({ disableVignette: true });
  S.foliaCommonSaveTuning();
  const instC = commonDef.create(mk(), ctx);
  ok('关暗角时暗角节点不渲染', instC.vignette == null);
  ok('关暗角时图形照常 15 个', instC.shapes.length === 15);

  ok('save 落盘 / reset 回默认',
    savedObj(store, COMMON_KEY).disableVignette === true
    && (S.foliaCommonResetTuning(), S.foliaCommonTuning().disableVignette === false));
}

/* =============================== D. 面板注册表与双面板叠加 =============================== */
{
  /* latent 背景 + lumiere 模式：两块面板都命中。 */
  const { S, store, host, fold, title, sub } = loadSandbox({
    foliaWorld: { mode: 'lumiere', background: 'latent', active: true },
  });

  S.foliaBuildTuningPanel();
  ok('双面板时折叠区可见', host.hidden === false && fold.hidden === false);
  ok('背景面板占折叠标题行（隐现背景）',
    title.textContent === '隐现背景'
    && sub.textContent === '叠加封面取色的像素与流体着色器，并使用大范围音频速度响应。',
    title.textContent);
  ok('两块面板之间有分隔线',
    !!host.find((n) => n.classList.contains('fx-folia-tuning-divider')));
  ok('模式面板退到面板内标题（绘光参数）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-intro-title')).map((n) => n.textContent).join(',') === '绘光参数');

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  const pillKeys = pills.map((g) => g.getAttribute('data-folia-tuning-key'));
  ok('隐现分段药丸 2 组（显示图层 / 颜色来源）',
    pillKeys.includes('displayMode') && pillKeys.includes('colorSource'),
    pillKeys.join(','));
  ok('显示图层三档：像素/流体/混合',
    pills.find((g) => g.getAttribute('data-folia-tuning-key') === 'displayMode')
      .children.map((b) => b.textContent).join('/') === '像素/流体/混合');
  ok('颜色来源两档：封面与主题/仅封面取色',
    pills.find((g) => g.getAttribute('data-folia-tuning-key') === 'colorSource')
      .children.map((b) => b.textContent).join('/') === '封面与主题/仅封面取色');

  const switches = host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'));
  const switchKeys = switches.map((b) => b.getAttribute('data-folia-tuning-key'));
  ok('开关行 3 个（隐现 2 + 叠色 1，lumiere 用药丸不用开关）',
    switchKeys.join(',') === 'dynamicOnlyInPlayer,enhancedBeatResponse,overlayEnabled',
    switchKeys.join(','));
  ok('开关行带描述（BackgroundToggleRow 语义）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-switch-desc')).length === 3);

  const groups = host.findAll((n) => n.classList.contains('fx-folia-tuning-group'));
  const groupTitles = groups.map((g) => g.firstChild && g.firstChild.textContent);
  ok('子框 3 个（叠色无标题 + 像素背景 + 流体背景）',
    groups.length === 3
    && groupTitles[1] === '像素背景' && groupTitles[2] === '流体背景',
    groupTitles.join('|'));

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  ok('隐现滑块 9 个 + 绘光滑块 12 个 = 21',
    ranges.length === 21, String(ranges.length));
  ok('像素尺寸滑块 step=0.25 / min=0.5 / max=8',
    (() => { const r = ranges.find((x) => x.getAttribute('data-folia-tuning-key') === 'ditheringSize'); return r.step === '0.25' && r.min === '0.5' && r.max === '8'; })());

  ok('叠色透明度百分比格式（默认 0.35 → 35%）',
    ranges.find((r) => r.getAttribute('data-folia-tuning-key') === 'overlayOpacity')
      .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '35%');
  ok('基础速度一位小数格式（默认 0.1 → 0.1）',
    ranges.find((r) => r.getAttribute('data-folia-tuning-key') === 'ditheringSpeed')
      .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '0.1');

  ok('绘光重置按钮仍在面板底部',
    !!host.find((n) => n.id === 'fx-folia-tuning-reset'));

  /* ---- disabledWhen 联动：默认叠色开 → 滑块可用；关掉后滑块禁用 + 行降透明 ---- */
  const overlaySlider = ranges.find((r) => r.getAttribute('data-folia-tuning-key') === 'overlayOpacity');
  ok('叠色开时滑块可用', overlaySlider.disabled === false);

  S.foliaLatentSetTuning({ overlayEnabled: false });
  S.foliaBuildTuningPanel();
  const disabledRows = host.findAll((n) => n.classList.contains('fx-folia-tuning-row') && n.classList.contains('is-disabled'));
  ok('叠色关时滑块禁用且行降透明（is-disabled）', disabledRows.length === 1
    && disabledRows[0].find((n) => n.classList.contains('fx-folia-tuning-range')).disabled === true,
    String(disabledRows.length));

  /* ---- 提交链路：开关点击 = 落盘 + 重建背景 + 面板刷新 ---- */
  S.__rebuildCalls = 0;
  const overlaySwitch = host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))
    .find((b) => b.getAttribute('data-folia-tuning-key') === 'overlayEnabled');
  overlaySwitch.fire('click');
  ok('叠色开关点击后落盘（false → true）',
    savedObj(store, LATENT_KEY).overlayEnabled === true);
  ok('叠色开关点击后触发背景重建', S.__rebuildCalls === 1, String(S.__rebuildCalls));
  ok('点击后面板已刷新（滑块重新可用）',
    host.find((n) => n.classList.contains('fx-folia-tuning-range')
      && n.getAttribute('data-folia-tuning-key') === 'overlayOpacity').disabled === false);

  /* ---- 滑块：拖动只改内存，松手落盘 + 重建 ---- */
  S.__rebuildCalls = 0;
  store.delete(LATENT_KEY);
  const speed = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .find((r) => r.getAttribute('data-folia-tuning-key') === 'ditheringSpeed');
  speed.value = '1.7';
  speed.fire('input');
  ok('拖动改内存不落盘', store.get(LATENT_KEY) == null
    && S.foliaLatentTuning().ditheringSpeed === 1.7);
  speed.fire('change');
  ok('松手落盘且触发重建',
    savedObj(store, LATENT_KEY).ditheringSpeed === 1.7 && S.__rebuildCalls === 1);
}

/* =============================== E. 单面板与无面板 =============================== */
{
  /* sora 背景 + 无调参模式（still）：只有背景面板，占折叠标题行。 */
  const a = loadSandbox({ foliaWorld: { mode: 'still', background: 'sora' } });
  a.S.foliaBuildTuningPanel();
  ok('sora 面板标题（本项目补：空背景参数）',
    a.title.textContent === '空背景参数', a.title.textContent);
  const soraSwitches = a.host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'));
  ok('sora 面板只有 1 个开关（完全空白）',
    soraSwitches.length === 1
    && soraSwitches[0].getAttribute('data-folia-tuning-key') === 'blank'
    && a.host.findAll((n) => n.classList.contains('fx-folia-tuning-switch-desc')).length === 1);
  ok('sora 面板没有分隔线与内嵌标题',
    !a.host.find((n) => n.classList.contains('fx-folia-tuning-divider'))
    && a.host.findAll((n) => n.classList.contains('fx-folia-tuning-intro')).length === 0);

  a.S.__rebuildCalls = 0;
  soraSwitches[0].fire('click');
  ok('sora 开关点击落盘 blank=true + 重建',
    savedObj(a.store, SORA_KEY).blank === true && a.S.__rebuildCalls === 1);
  ok('点击后开关态刷新（aria-pressed=true）',
    a.host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))[0].getAttribute('aria-pressed') === 'true');

  /* common 背景：两个开关，文案逐字。 */
  const b = loadSandbox({ foliaWorld: { mode: 'still', background: 'common' } });
  b.S.foliaBuildTuningPanel();
  ok('common 面板标题（本项目补：通用背景参数）',
    b.title.textContent === '通用背景参数', b.title.textContent);
  const rows = b.host.findAll((n) => n.classList.contains('fx-folia-tuning-switch-row'));
  ok('common 两行开关：禁用暗角 / 隐藏通用几何背景',
    rows.length === 2
    && rows[0].find((n) => n.classList.contains('fx-folia-tuning-switch-label')).textContent === '禁用暗角'
    && rows[1].find((n) => n.classList.contains('fx-folia-tuning-switch-label')).textContent === '隐藏通用几何背景');
  ok('common 描述逐字（zh-CN.ts:1947/1968）',
    rows[0].find((n) => n.classList.contains('fx-folia-tuning-switch-desc')).textContent === '关闭几何背景自带的边缘暗角，建议配合透明背景使用。'
    && rows[1].find((n) => n.classList.contains('fx-folia-tuning-switch-desc')).textContent === '隐藏播放页的通用几何背景图形。');

  /* lumiere 模式 + 无面板背景（none）：只有模式面板，行为与旧版一致（占折叠标题行）。
   * （以前这里用 url 当「无面板」样板，url 补了列表面板后改用 none。） */
  const c = loadSandbox({ foliaWorld: { mode: 'lumiere', background: 'none' } });
  c.S.foliaBuildTuningPanel();
  ok('仅模式面板时仍占折叠标题行（绘光参数）',
    c.title.textContent === '绘光参数'
    && c.host.findAll((n) => n.classList.contains('fx-folia-tuning-intro')).length === 0
    && !c.host.find((n) => n.classList.contains('fx-folia-tuning-divider')));

  /* 两者都无面板：整块藏起来（still 没有任何调参项；classic 补了面板后不能再当样板）。 */
  const d = loadSandbox({ foliaWorld: { mode: 'still', background: 'none' } });
  d.S.foliaBuildTuningPanel();
  ok('无面板时连折叠标题一起藏',
    d.host.hidden === true && d.host.children.length === 0 && d.fold.hidden === true);
}

/* =============================== F. 漫游（nomand）面板 ===============================
 * 断言来源：NomandBackgroundSettingsCard.tsx（来源两档 + 上传按钮禁用语义 + 叠色框）、
 * NomandBackgroundEffectSettings.tsx（五档效果药丸 + 条件渲染一组面板）、
 * 五个 Nomand*Settings.tsx（每档的控件、区间、步长、格式）、zh-CN.ts:2567-2620（文案逐字）。 */
{
  const { S, store, host, title, sub } = loadSandbox({
    foliaWorld: { mode: 'still', background: 'nomand', active: true },
  });

  /* 每次重建面板后旧节点全部作废，所以查询一律走「现查现用」。 */
  const pillGroup = (key) => host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === key);
  const pillLabels = (key) => pillGroup(key).children.map((b) => b.textContent).join('/');
  const ranges = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const rangeOf = (key) => ranges().find((r) => r.getAttribute('data-folia-tuning-key') === key);
  const valueOf = (key) => rangeOf(key).parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  const groups = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-group'));
  const groupTitle = (i) => {
    const g = groups()[i];
    return g && g.firstChild && g.firstChild.classList.contains('fx-folia-tuning-group-title')
      ? g.firstChild.textContent : '(无标题)';
  };
  const switchKeys = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))
    .map((b) => b.getAttribute('data-folia-tuning-key'));
  const clickPill = (key, label) => {
    const btn = pillGroup(key).children.find((b) => b.textContent === label);
    if (!btn) throw new Error('药丸不存在：' + label);
    btn.fire('click');
  };

  S.foliaBuildTuningPanel();
  ok('漫游面板标题占折叠标题行（文案逐字 zh-CN.ts:2567）',
    title.textContent === '漫游背景'
    && sub.textContent === '为歌曲封面或自定义图片应用 Paper 图片效果。',
    title.textContent + ' / ' + sub.textContent);

  ok('来源药丸两档：封面 / 自定义图片（monetBackgroundSourceCover/Uploaded 复用）',
    pillLabels('imageSource') === '封面/自定义图片', pillLabels('imageSource'));
  ok('没有上传图时「自定义图片」禁用（disabled 落在按钮上）',
    pillGroup('imageSource').children[1].disabled === true
    && pillGroup('imageSource').children[0].disabled === false);
  ok('效果药丸五档文案逐字',
    pillLabels('effect') === '像素画/纹理玻璃/纸张纹理/半调网点/镜头畸变',
    pillLabels('effect'));
  ok('效果药丸没有禁用项', pillGroup('effect').children.every((b) => b.disabled === false));

  /* ---- 默认效果 = 像素画：只挂这一组控件 ---- */
  ok('子框 2 个（像素画组 + 叠色组），叠色框无标题',
    groups().length === 2 && groupTitle(0) === '像素画' && groupTitle(1) === '(无标题)',
    groups().length + ' / ' + groupTitle(0) + ' / ' + groupTitle(1));
  ok('像素画图案三档 2x2/4x4/8x8',
    pillLabels('ditheringType') === '2x2/4x4/8x8', pillLabels('ditheringType'));
  ok('像素画只挂当前效果这一组的开关（保留原色 / 反转明度）',
    switchKeys().join(',') === 'originalColors,inverted,overlayEnabled',
    switchKeys().join(','));
  ok('像素画滑块 2 + 叠色 1 = 3', ranges().length === 3, String(ranges().length));

  ok('网点尺寸区间 [0.5,20] 步长 0.5（NomandDitheringSettings 逐字）',
    rangeOf('size').min === '0.5' && rangeOf('size').max === '20' && rangeOf('size').step === '0.5');
  ok('网点尺寸一位小数格式（默认 3 → 3.0）', valueOf('size') === '3.0', valueOf('size'));
  ok('色阶数量区间 [1,7] 步长 1、整数格式（默认 4 → 4）',
    rangeOf('colorSteps').min === '1' && rangeOf('colorSteps').max === '7'
    && rangeOf('colorSteps').step === '1' && valueOf('colorSteps') === '4',
    valueOf('colorSteps'));
  ok('叠色透明度百分比格式（默认 0.35 → 35%）', valueOf('overlayOpacity') === '35%', valueOf('overlayOpacity'));
  ok('叠色开时透明度滑块可用', rangeOf('overlayOpacity').disabled === false);

  /* ---- 换效果：落盘 + 整面板重建（Folia 是条件渲染，这里等价于换一整组） ---- */
  S.__rebuildCalls = 0;
  clickPill('effect', '纹理玻璃');
  ok('点效果药丸落盘（commit 走 save 而不是 preview）',
    savedObj(store, NOMAND_KEY).effect === 'fluted-glass',
    JSON.stringify(savedObj(store, NOMAND_KEY).effect));
  ok('换效果不重建整背景（01f 自己重建画布层，rebuild:false）', S.__rebuildCalls === 0);
  ok('换效果后下半组换成纹理玻璃',
    groupTitle(0) === '纹理玻璃' && ranges().length === 4, groupTitle(0) + ' / ' + ranges().length);
  ok('纹理玻璃三滑块：尺寸两位小数 0.50 / 扭曲 50% / 模糊 8%',
    valueOf('flutedGlassSize') === '0.50'
    && valueOf('flutedGlassDistortion') === '50%'
    && valueOf('flutedGlassBlur') === '8%',
    [valueOf('flutedGlassSize'), valueOf('flutedGlassDistortion'), valueOf('flutedGlassBlur')].join(' '));
  ok('纹理尺寸区间 [0.1,1] 步长 0.05',
    rangeOf('flutedGlassSize').min === '0.1' && rangeOf('flutedGlassSize').max === '1'
    && rangeOf('flutedGlassSize').step === '0.05');

  clickPill('effect', '纸张纹理');
  ok('纸张纹理三滑块 + 全部百分比',
    groupTitle(0) === '纸张纹理'
    && valueOf('paperTextureContrast') === '32%'
    && valueOf('paperTextureRoughness') === '42%'
    && valueOf('paperTextureFiber') === '30%'
    && switchKeys().join(',') === 'overlayEnabled',
    [valueOf('paperTextureContrast'), valueOf('paperTextureRoughness'), valueOf('paperTextureFiber')].join(' '));

  clickPill('effect', '半调网点');
  ok('半调网点三滑块 + 两个开关（原色 / 反转）',
    groupTitle(0) === '半调网点'
    && valueOf('halftoneDotsSize') === '0.50'
    && valueOf('halftoneDotsRadius') === '1.25'
    && valueOf('halftoneDotsContrast') === '40%'
    && switchKeys().join(',') === 'halftoneDotsOriginalColors,halftoneDotsInverted,overlayEnabled',
    switchKeys().join(','));
  ok('网点半径区间 [0.1,2]（比尺寸宽一档）',
    rangeOf('halftoneDotsRadius').min === '0.1' && rangeOf('halftoneDotsRadius').max === '2');

  clickPill('effect', '镜头畸变');
  ok('镜头畸变三滑块（色彩分离 / 膨胀 / 色散）',
    groupTitle(0) === '镜头畸变'
    && valueOf('lensDistortionSpread') === '45%'
    && valueOf('lensDistortionDispersion') === '65%',
    [valueOf('lensDistortionSpread'), valueOf('lensDistortionDispersion')].join(' '));
  ok('镜头膨胀允许负数（min=-1、两位小数 0.30）',
    rangeOf('lensDistortionBulge').min === '-1' && valueOf('lensDistortionBulge') === '0.30',
    rangeOf('lensDistortionBulge').min + ' / ' + valueOf('lensDistortionBulge'));

  /* ---- 叠色 disabledWhen：关掉开关 → 透明度滑块禁用 + 行降透明 ---- */
  S.foliaNomandPreviewTuning({ overlayEnabled: false });
  S.foliaNomandSaveTuning();
  S.foliaBuildTuningPanel();
  const dimRows = host.findAll((n) => n.classList.contains('fx-folia-tuning-row') && n.classList.contains('is-disabled'));
  ok('叠色关时透明度滑块禁用且行降透明',
    dimRows.length === 1 && rangeOf('overlayOpacity').disabled === true,
    String(dimRows.length));

  /* ---- 拖动语义：input 只改内存，change 才落盘 ---- */
  const drag = loadSandbox({ foliaWorld: { mode: 'still', background: 'nomand' } });
  drag.S.foliaBuildTuningPanel();
  const dragSize = drag.host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .find((r) => r.getAttribute('data-folia-tuning-key') === 'size');
  dragSize.value = '7.5';
  dragSize.fire('input');
  ok('拖动只改内存不落盘（preview 不写存档）',
    drag.store.get(NOMAND_KEY) == null && drag.S.foliaNomandTuning().size === 7.5,
    String(drag.store.get(NOMAND_KEY)));
  ok('拖动时数值跟着走（3.0 → 7.5）',
    dragSize.parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '7.5');
  dragSize.fire('change');
  ok('松手落盘（save 写的是缓存里的 7.5）', savedObj(drag.store, NOMAND_KEY).size === 7.5,
    JSON.stringify(savedObj(drag.store, NOMAND_KEY).size));
  ok('拖动与松手都不重建整背景', drag.S.__rebuildCalls === 0, String(drag.S.__rebuildCalls));

  /* ---- 有上传图时「自定义图片」可选并落盘 ---- */
  const up = loadSandbox({ foliaWorld: { mode: 'still', background: 'nomand' } });
  up.S.foliaNomandCustomImage = { id: 'pic-1', url: 'https://cdn.example.com/up.png' };
  up.S.foliaBuildTuningPanel();
  const upPills = up.host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'imageSource');
  ok('有上传图时「自定义图片」可选', upPills.children[1].disabled === false);
  upPills.children[1].fire('click');
  ok('点「自定义图片」落盘 imageSource=uploaded-global',
    savedObj(up.store, NOMAND_KEY).imageSource === 'uploaded-global',
    JSON.stringify(savedObj(up.store, NOMAND_KEY).imageSource));
}

/* =============================== G. 莫奈（monet）面板 ===============================
 * 断言来源：MonetBackgroundSettingsCard.tsx（四个 section + 三处条件渲染 + SliderControl 的
 * valueLabel 格式）、zh-CN.ts:2564-2571 / 2626-2644 / 2664-2667（文案逐字）。 */
{
  const { S, store, host, title, sub } = loadSandbox({
    foliaWorld: { mode: 'still', background: 'monet', active: true },
  });

  const pillGroup = (key) => host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === key);
  const pillLabels = (key) => pillGroup(key).children.map((b) => b.textContent).join('/');
  const clickPill = (key, label) => {
    const btn = pillGroup(key).children.find((b) => b.textContent === label);
    if (!btn) throw new Error('药丸不存在：' + label);
    btn.fire('click');
  };
  const ranges = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const rangeOf = (key) => ranges().find((r) => r.getAttribute('data-folia-tuning-key') === key);
  const valueOf = (key) => rangeOf(key).parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  const switchKeys = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))
    .map((b) => b.getAttribute('data-folia-tuning-key'));
  const groupTitles = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-group-title'))
    .map((n) => n.textContent);
  const colorRow = () => host.find((n) => n.classList.contains('fx-folia-tuning-color-row'));
  const colorInput = () => host.find((n) => n.classList.contains('fx-folia-tuning-color-input'));

  S.foliaBuildTuningPanel();
  ok('莫奈面板标题占折叠标题行（文案逐字 zh-CN.ts:2564）',
    title.textContent === '莫奈背景'
    && sub.textContent === '调整莫奈背景图片来源、布局和后处理。',
    title.textContent + ' / ' + sub.textContent);
  ok('四个分组标题逐字（背景来源 / 布局与对齐 / 视觉增强与滤镜 / 叠色与水洗）',
    groupTitles().join('|') === '背景来源|布局与对齐|视觉增强与滤镜|叠色与水洗',
    groupTitles().join('|'));

  ok('三个药丸组：来源 / 布局 / 水洗色彩',
    [ 'backgroundSource', 'backgroundLayout', 'backgroundWashColorMode' ]
      .every((k) => !!pillGroup(k)));
  ok('来源两档，没有上传图时「自定义图片」禁用',
    pillLabels('backgroundSource') === '封面/自定义图片'
    && pillGroup('backgroundSource').children[1].disabled === true);
  ok('布局两档：半屏渐变 / 全屏叠色（顺序与 Folia 一致）',
    pillLabels('backgroundLayout') === '半屏渐变/全屏叠色', pillLabels('backgroundLayout'));
  ok('水洗色彩两档：主题色 / 自定义',
    pillLabels('backgroundWashColorMode') === '主题色/自定义', pillLabels('backgroundWashColorMode'));

  ok('默认（全屏叠色）没有水平偏移滑块',
    rangeOf('backgroundHalfPaneOffsetX') == null);
  ok('默认两个开关：缓慢漂移 / 竖向纹理（都带描述）',
    switchKeys().join(',') === 'backgroundDriftEnabled,backgroundStreaksEnabled'
    && host.findAll((n) => n.classList.contains('fx-folia-tuning-switch-desc')).length === 2,
    switchKeys().join(','));
  ok('默认滑块 6 个（模糊/饱和度/去色/漂移幅度/叠色强度/水洗）',
    ranges().length === 6, String(ranges().length));

  ok('背景模糊按 px 显示（默认 6 → 6px），区间 [0,60] 步长 2',
    valueOf('backgroundBlurPx') === '6px'
    && rangeOf('backgroundBlurPx').min === '0' && rangeOf('backgroundBlurPx').max === '60'
    && rangeOf('backgroundBlurPx').step === '2', valueOf('backgroundBlurPx'));
  ok('饱和度是百分数格式（1.05 → 105%），区间 [0,2]',
    valueOf('backgroundSaturation') === '105%' && rangeOf('backgroundSaturation').max === '2',
    valueOf('backgroundSaturation'));
  ok('去色 0% / 叠色强度 74% / 水洗 34%（默认值逐项）',
    valueOf('backgroundGrayscale') === '0%'
    && valueOf('backgroundOverlayOpacity') === '74%'
    && valueOf('backgroundWash') === '34%',
    [valueOf('backgroundGrayscale'), valueOf('backgroundOverlayOpacity'), valueOf('backgroundWash')].join(' '));
  ok('漂移幅度是百分数格式（0.5 → 50%）', valueOf('backgroundDriftStrength') === '50%', valueOf('backgroundDriftStrength'));
  ok('去色步长 0.02、漂移幅度步长 0.05（与 Folia 逐字）',
    rangeOf('backgroundGrayscale').step === '0.02' && rangeOf('backgroundDriftStrength').step === '0.05');
  ok('默认水洗色彩=主题色，不出现颜色控件', colorRow() == null);

  /* ---- 条件渲染①：半屏渐变才有水平偏移 ---- */
  clickPill('backgroundLayout', '半屏渐变');
  ok('点「半屏渐变」落盘', savedObj(store, MONET_KEY).backgroundLayout === 'half-pane-gradient',
    JSON.stringify(savedObj(store, MONET_KEY).backgroundLayout));
  /* 用内联判据而不是先 rangeOf 再读值：面板没重建时这里要出 FAIL 行，不能抛异常
   * （抛错会让突变自证判成「没拦住」）。 */
  const offset0 = rangeOf('backgroundHalfPaneOffsetX');
  const offsetValue = (el) => el.parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('切半屏后出现水平偏移滑块（-40~40 步长 2，默认 0%）',
    !!offset0 && offset0.min === '-40' && offset0.max === '40' && offset0.step === '2'
    && offsetValue(offset0) === '0%',
    offset0 ? offsetValue(offset0) : 'null');
  ok('切半屏后滑块 7 个', ranges().length === 7, String(ranges().length));

  /* 非零值才把 pct（12%）与 percent（1200%）分开——0 两边都是 0%。 */
  S.foliaMonetSetTuning({ backgroundHalfPaneOffsetX: 12 });
  S.foliaBuildTuningPanel();
  const offset1 = rangeOf('backgroundHalfPaneOffsetX');
  ok('水平偏移动到 12 显示 12%（不是 1200%）',
    !!offset1 && offsetValue(offset1) === '12%',
    offset1 ? offsetValue(offset1) : 'null');

  /* ---- 条件渲染②：水洗色彩=自定义才有颜色控件 ---- */
  clickPill('backgroundWashColorMode', '自定义');
  ok('点「自定义」落盘', savedObj(store, MONET_KEY).backgroundWashColorMode === 'custom');
  ok('切自定义后出现颜色行（默认 #8FB7FF 大写显示）',
    !!colorRow() && !!colorInput()
    && host.find((n) => n.classList.contains('fx-folia-tuning-color-hex')).textContent === '#8FB7FF',
    host.find((n) => n.classList.contains('fx-folia-tuning-color-hex')) && host.find((n) => n.classList.contains('fx-folia-tuning-color-hex')).textContent);

  const picker = colorInput();
  picker.value = '#00ff88';
  picker.fire('input');
  ok('颜色拖动只改内存（含大小写归一成小写）',
    store.get(MONET_KEY) && savedObj(store, MONET_KEY).backgroundWashCustomColor === '#8fb7ff'
    && S.foliaMonetTuning().backgroundWashCustomColor === '#00ff88',
    JSON.stringify(savedObj(store, MONET_KEY).backgroundWashCustomColor));
  ok('颜色行十六进制码跟着变（#00FF88）',
    host.find((n) => n.classList.contains('fx-folia-tuning-color-hex')).textContent === '#00FF88');
  picker.fire('change');
  ok('松手落盘新颜色', savedObj(store, MONET_KEY).backgroundWashCustomColor === '#00ff88');

  /* ---- 条件渲染③：漂移关掉后没有漂移幅度 ---- */
  host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))
    .find((b) => b.getAttribute('data-folia-tuning-key') === 'backgroundDriftEnabled').fire('click');
  ok('关掉「缓慢漂移」落盘 false 且幅度滑块消失',
    savedObj(store, MONET_KEY).backgroundDriftEnabled === false
    && rangeOf('backgroundDriftStrength') == null
    && ranges().length === 6,
    String(ranges().length));

  /* ---- 拖动语义：input 只改内存，change 才落盘 ---- */
  const drag = loadSandbox({ foliaWorld: { mode: 'still', background: 'monet' } });
  drag.S.foliaBuildTuningPanel();
  const blur = drag.host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .find((r) => r.getAttribute('data-folia-tuning-key') === 'backgroundBlurPx');
  blur.value = '18';
  blur.fire('input');
  ok('拖动模糊只改内存不落盘',
    drag.store.get(MONET_KEY) == null && drag.S.foliaMonetTuning().backgroundBlurPx === 18,
    String(drag.store.get(MONET_KEY)));
  ok('拖动时显示跟着走（6px → 18px）',
    blur.parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '18px');
  blur.fire('change');
  ok('松手落盘 18px', savedObj(drag.store, MONET_KEY).backgroundBlurPx === 18);
  ok('整个拖动过程不重建整背景', drag.S.__rebuildCalls === 0, String(drag.S.__rebuildCalls));

  /* ---- 有上传图时「自定义图片」可选并落盘 ---- */
  const up = loadSandbox({ foliaWorld: { mode: 'still', background: 'monet' } });
  up.S.foliaMonetBackgroundImage = { id: 'bg-1', url: 'https://cdn.example.com/bg.png' };
  up.S.foliaBuildTuningPanel();
  const upPills = up.host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'backgroundSource');
  ok('有上传图时「自定义图片」可选', upPills.children[1].disabled === false);
  upPills.children[1].fire('click');
  ok('点「自定义图片」落盘 backgroundSource=uploaded-global',
    savedObj(up.store, MONET_KEY).backgroundSource === 'uploaded-global',
    JSON.stringify(savedObj(up.store, MONET_KEY).backgroundSource));
}

/* =============================== H. 嵌入（url）列表面板 ===============================
 * 断言来源：UrlBackgroundSettingsCard.tsx（列表/空态/添加表单/行内编辑三块条件渲染、
 * 选中态样式、handleAdd 加完即选中、handleSaveEdit 用 id 合并）+ zh-CN.ts:2088-2092 文案。 */
{
  const { S, store, host, title, sub } = loadSandbox({
    foliaWorld: { mode: 'still', background: 'url', active: true },
  });

  const items = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-url-item'));
  const itemById = (id) => items().find((n) => n.getAttribute('data-folia-url-id') === id);
  const selectedIds = () => items()
    .filter((n) => n.classList.contains('is-selected'))
    .map((n) => n.getAttribute('data-folia-url-id'));
  const addBtn = () => host.find((n) => n.classList.contains('fx-folia-tuning-url-add'));
  const forms = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-url-form'));
  const inputsOf = (form) => form.findAll((n) => n.classList.contains('fx-folia-tuning-url-input'));
  const actIn = (scope, label) => scope.findAll((n) => n.classList.contains('fx-folia-tuning-url-act'))
    .find((b) => b.textContent === label);
  const savedUrl = () => savedObj(store, URL_KEY);

  S.foliaBuildTuningPanel();
  ok('嵌入面板标题占折叠标题行（文案逐字 zh-CN.ts:2088）',
    title.textContent === '嵌入背景' && /将网页显示为播放页背景/.test(sub.textContent || ''),
    title.textContent);
  ok('空列表：显示「暂无 URL」与「添加 URL」按钮，没有列表容器',
    items().length === 0
    && host.find((n) => n.classList.contains('fx-folia-tuning-url-empty')).textContent === '暂无 URL，点击上方按钮添加'
    && !!addBtn() && host.find((n) => n.classList.contains('fx-folia-tuning-url-list')) == null);

  /* ---- 添加：点按钮 → 表单 → 保存（无协议自动补 https://，备注回落地址） ---- */
  addBtn().fire('click');
  ok('点「添加 URL」出现表单（两个输入框 + 取消/保存）',
    forms().length === 1 && inputsOf(forms()[0]).length === 2
    && !!actIn(forms()[0], '×') && !!actIn(forms()[0], '✓'));
  ok('添加态不再显示「添加 URL」按钮（Folia 的 isAdding 分支）',
    addBtn() == null);

  const addForm = forms()[0];
  const [urlInput, noteInput] = inputsOf(addForm);
  ok('地址框 placeholder 是 https://example.com（逐字）', urlInput.placeholder === 'https://example.com',
    urlInput.placeholder);
  urlInput.value = 'example.com/live';
  urlInput.fire('input');
  actIn(addForm, '✓').fire('click');
  const firstId = (savedUrl().items || [])[0] && savedUrl().items[0].id;
  ok('保存后落盘一条：url 补成 https:// 且备注回落成同一个地址',
    (savedUrl().items || []).length === 1
    && savedUrl().items[0].url === 'https://example.com/live'
    && savedUrl().items[0].note === 'https://example.com/live',
    JSON.stringify(savedUrl().items));
  ok('加完立刻选中新项（Folia handleAdd 里调 select）',
    savedUrl().selectedId === firstId && selectedIds().join(',') === firstId,
    savedUrl().selectedId + ' / ' + selectedIds().join(','));
  ok('列表项两行：备注 + 地址，选中项带 is-selected',
    itemById(firstId).find((n) => n.classList.contains('fx-folia-tuning-url-note')).textContent === 'https://example.com/live'
    && itemById(firstId).find((n) => n.classList.contains('fx-folia-tuning-url-addr')).textContent === 'https://example.com/live'
    && itemById(firstId).classList.contains('is-selected'));
  ok('添加成功后表单收起、草稿清空', forms().length === 0 && addBtn() != null);

  /* ---- 非法地址不落库（Folia 的 disabled={!draftUrl.trim()} 同判据） ---- */
  addBtn().fire('click');
  const badForm = forms()[0];
  const [badUrl] = inputsOf(badForm);
  badUrl.value = 'ftp://example.com/x';
  badUrl.fire('input');
  actIn(badForm, '✓').fire('click');
  ok('非法协议（ftp）点保存不新增、也不收起表单',
    (savedUrl().items || []).length === 1 && forms().length === 1,
    String((savedUrl().items || []).length));
  /* 取消：草稿清空、表单收起、库不变。 */
  actIn(forms()[0], '×').fire('click');
  ok('点「×」取消：表单收起回到「添加 URL」', forms().length === 0 && addBtn() != null);
  addBtn().fire('click');
  ok('取消后草稿被清空（重新打开表单两个框都是空的）',
    inputsOf(forms()[0]).every((i) => i.value === ''),
    inputsOf(forms()[0]).map((i) => i.value).join(' | '));
  actIn(forms()[0], '×').fire('click');

  /* ---- 再加一条，验证选中切换 ---- */
  addBtn().fire('click');
  const second = forms()[0];
  const [u2, n2] = inputsOf(second);
  u2.value = 'https://music.example.com/now';
  u2.fire('input');
  n2.value = '在线演出';
  n2.fire('input');
  actIn(second, '✓').fire('click');
  const secondId = (savedUrl().items || [])[1] && savedUrl().items[1].id;
  ok('第二条带自定义备注（note 不被地址覆盖）',
    savedUrl().items[1].note === '在线演出' && savedUrl().items[1].url === 'https://music.example.com/now',
    JSON.stringify(savedUrl().items[1]));
  ok('列表渲染两条、选中仍在最新一条上',
    items().length === 2 && selectedIds().join(',') === secondId);

  /* 点第一条 = 切换选中。 */
  itemById(firstId).find((n) => n.classList.contains('fx-folia-tuning-url-body')).fire('click');
  ok('点另一项切换选中并落盘',
    savedUrl().selectedId === firstId && selectedIds().join(',') === firstId);

  /* ---- 行内编辑：改备注，id 不变 ---- */
  actIn(itemById(secondId), '改').fire('click');
  ok('点「改」出现行内表单，预填该行 url 与备注',
    forms().length === 1
    && inputsOf(forms()[0])[0].value === 'https://music.example.com/now'
    && inputsOf(forms()[0])[1].value === '在线演出',
    inputsOf(forms()[0]).map((i) => i.value).join(' | '));
  const editForm = forms()[0];
  inputsOf(editForm)[1].value = '演出直播';
  inputsOf(editForm)[1].fire('input');
  actIn(editForm, '✓').fire('click');
  const edited = (savedUrl().items || []).find((x) => x.id === secondId);
  ok('保存编辑：备注更新、id 与条数不变（update 用 id 合并）',
    edited && edited.note === '演出直播' && (savedUrl().items || []).length === 2,
    JSON.stringify(edited));
  ok('编辑态收起后仍只有该行被改',
    itemById(secondId).find((n) => n.classList.contains('fx-folia-tuning-url-note')).textContent === '演出直播');

  /* ---- 删除：删选中项 → 选中回落第一项；删空 → null + 空态 ---- */
  actIn(itemById(firstId), '删').fire('click');
  ok('删掉选中项后选中回落到列表第一项',
    (savedUrl().items || []).length === 1
    && savedUrl().selectedId === secondId && selectedIds().join(',') === secondId,
    savedUrl().selectedId);
  actIn(itemById(secondId), '删').fire('click');
  ok('删空后 selectedId 归 null 且回到空态',
    (savedUrl().items || []).length === 0 && savedUrl().selectedId === null
    && items().length === 0
    && !!host.find((n) => n.classList.contains('fx-folia-tuning-url-empty')));
}


/* =============================== I. 歌词样式面板（流光 / 云阶 / 倾诉 / 回环）===============================
 * 断言来源：settingsPanels.tsx:24-129（Classic）/ 130-245（Partita）/ 805-897（Tilt）/ 1142-1270（Claddagh）、
 * types.ts:391-500（默认值）、zh-CN.ts:2124-2200（文案逐字）、0l0 的归一化与跨字段耦合。 */
{
  const { S, store } = loadSandbox({ foliaWorld: { mode: 'classic', background: 'none' } });

  ok('模式调参内核导出五个入口（含归一化）',
    typeof S.foliaModeTuning === 'function' && typeof S.foliaModeSetTuning === 'function'
    && typeof S.foliaModeSaveTuning === 'function' && typeof S.foliaModeResetTuning === 'function'
    && typeof S.foliaModeNormalizeTuning === 'function');

  const c0 = S.foliaModeTuning('classic');
  ok('classic 默认值（types.ts:398：true / 1 / false / 0.7）',
    c0.enableWordRotation === true && c0.breathingFloatMultiplier === 1
    && c0.useLegacyLayout === false && c0.wordSpacing === 0.7, JSON.stringify(c0));
  const c1 = S.foliaModeSetTuning('classic', { breathingFloatMultiplier: 9 });
  ok('classic 呼吸浮动上越界钳到 2（clampClassicBreathingFloatMultiplier）',
    c1.breathingFloatMultiplier === 2);
  ok('set 换新对象（运行时靠对象身份重建当前行）', c1 !== c0);
  ok('set 只动这一项', c1.wordSpacing === 0.7 && c1.enableWordRotation === true);
  ok('布尔不认字符串（useLegacyLayout 传 "yes" → false）',
    S.foliaModeSetTuning('classic', { useLegacyLayout: 'yes' }).useLegacyLayout === false);
  ok('wordSpacing 区间 [0,2]',
    S.foliaModeSetTuning('classic', { wordSpacing: -3 }).wordSpacing === 0
    && S.foliaModeSetTuning('classic', { wordSpacing: 3 }).wordSpacing === 2);

  store.delete(MODE_KEY);
  S.foliaModeSetTuning('classic', { wordSpacing: 1.2 });
  ok('set 后未 save 不落盘（拖动只改内存）', store.get(MODE_KEY) == null);
  S.foliaModeSaveTuning('classic');
  ok('save 把 classic 桶写进同一份存档',
    savedObj(store, MODE_KEY).classic
    && savedObj(store, MODE_KEY).classic.wordSpacing === 1.2,
    JSON.stringify(savedObj(store, MODE_KEY)));
  S.foliaModeResetTuning('classic');
  ok('reset 回默认并落盘',
    S.foliaModeTuning('classic').wordSpacing === 0.7
    && savedObj(store, MODE_KEY).classic.wordSpacing === 0.7);

  /* partita：两个错位值互相顶（settingsPanels.tsx:141-170）。 */
  S.foliaModeResetTuning('partita');
  const p1 = S.foliaModeSetTuning('partita', { staggerMin: 150 });
  ok('抬错位最小值把最大值顶上去', p1.staggerMin === 150 && p1.staggerMax === 150,
    JSON.stringify(p1));
  const p2 = S.foliaModeSetTuning('partita', { staggerMax: 40 });
  ok('压低错位最大值把最小值带下来', p2.staggerMin === 40 && p2.staggerMax === 40,
    JSON.stringify(p2));
  ok('反了就交换（resolvePartitaTuning 的 min/max 归一化）',
    (() => { const n = S.foliaModeNormalizeTuning('partita', { staggerMin: 150, staggerMax: 80 }); return n.staggerMin === 80 && n.staggerMax === 150; })());
  ok('错位值取整（step=5 的滑块给 22.4 → 22）',
    S.foliaModeNormalizeTuning('partita', { staggerMin: 22.4 }).staggerMin === 22);

  /* tilt / claddagh 的枚举与整数。 */
  ok('tilt 配色只认四档（bogus → default）',
    S.foliaModeNormalizeTuning('tilt', { colorScheme: 'rainbow' }).colorScheme === 'default');
  ok('tilt 配色四档都能存（accentAll）',
    S.foliaModeSetTuning('tilt', { colorScheme: 'accentAll' }).colorScheme === 'accentAll');
  ok('claddagh 轨道倾斜度取整（22.6 → 23）',
    S.foliaModeNormalizeTuning('claddagh', { ellipseTiltDeg: 22.6 }).ellipseTiltDeg === 23);
  ok('claddagh 字符间距区间 [-5,20]',
    S.foliaModeNormalizeTuning('claddagh', { letterSpacingOffset: 99 }).letterSpacingOffset === 20
    && S.foliaModeNormalizeTuning('claddagh', { letterSpacingOffset: -99 }).letterSpacingOffset === -5);
  ok('没有规格的模式返回空对象（still 无调参）',
    Object.keys(S.foliaModeTuning('still')).length === 0);
  ok('非法输入等价于全默认（传字符串）',
    (() => { const n = S.foliaModeNormalizeTuning('claddagh', 'x'); return n.focusScaleRatio === 0.65 && n.showAxisLine === true; })());
}

/* ---- I2. 流光面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'classic', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('流光是折叠标题行（单独占位时）',
    title.textContent === '流光参数' && sub.textContent === '控制逐字旋转和整行呼吸浮动范围。',
    title.textContent + '|' + sub.textContent);

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('流光两组药丸（逐字旋转 / 排版模式）',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(',') === 'enableWordRotation,useLegacyLayout',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(','));
  ok('逐字旋转两档文案：启用 / 关闭',
    pills[0].children.map((b) => b.textContent).join('/') === '启用/关闭');
  ok('排版模式两档文案：旧版 / 自适应（顺序也是旧版在前）',
    pills[1].children.map((b) => b.textContent).join('/') === '旧版/自适应');
  ok('自适应时两个药丸的选中态：启用 + 自适应',
    pills[0].children.find((b) => b.classList.contains('active')).textContent === '启用'
    && pills[1].children.find((b) => b.classList.contains('active')).textContent === '自适应');

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  ok('自适应下两个滑块（呼吸浮动范围 / 单词间距）',
    ranges.map((r) => r.getAttribute('data-folia-tuning-key')).join(',') === 'breathingFloatMultiplier,wordSpacing',
    ranges.map((r) => r.getAttribute('data-folia-tuning-key')).join(','));
  const valueOf = (key) => ranges.find((r) => r.getAttribute('data-folia-tuning-key') === key)
    .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('呼吸浮动范围显示 1.00x / 单词间距显示 0.70x（toFixed(2)+x）',
    valueOf('breathingFloatMultiplier') === '1.00x' && valueOf('wordSpacing') === '0.70x',
    valueOf('breathingFloatMultiplier') + '|' + valueOf('wordSpacing'));
  ok('呼吸浮动范围区间与步长照抄（0~2 / 0.05）',
    (() => { const r = ranges[0]; return r.min === '0' && r.max === '2' && r.step === '0.05'; })());

  /* 换「旧版」：单词间距整行消失（条件渲染），并落盘。 */
  pills[1].children.find((b) => b.textContent === '旧版').fire('click');
  const afterKeys = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .map((r) => r.getAttribute('data-folia-tuning-key'));
  ok('点「旧版」后单词间距整行消失（条件渲染换组）',
    afterKeys.join(',') === 'breathingFloatMultiplier', afterKeys.join(','));
  ok('点「旧版」落盘 useLegacyLayout=true',
    savedObj(store, MODE_KEY).classic && savedObj(store, MODE_KEY).classic.useLegacyLayout === true);
  ok('点「旧版」后药丸选中态换成旧版',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))[1]
      .children.find((b) => b.classList.contains('active')).textContent === '旧版');

  /* 拖滑块：只改内存；松手落盘。 */
  store.delete(MODE_KEY);
  const breathe = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .find((r) => r.getAttribute('data-folia-tuning-key') === 'breathingFloatMultiplier');
  breathe.value = '1.5';
  breathe.fire('input');
  ok('拖动只改内存（1.5）且不落盘',
    S.foliaModeTuning('classic').breathingFloatMultiplier === 1.5 && store.get(MODE_KEY) == null);
  ok('拖动时读数跟着变（1.50x）',
    breathe.parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '1.50x');
  breathe.fire('change');
  ok('松手落盘', savedObj(store, MODE_KEY).classic.breathingFloatMultiplier === 1.5);
}

/* ---- I3. 云阶面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'partita', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('云阶是折叠标题行',
    title.textContent === '云阶参数' && sub.textContent === '控制引导线显示和分块横向错位范围。',
    title.textContent + '|' + sub.textContent);

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('云阶两组药丸（引导线 / 语义排列）',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(',') === 'showGuideLines,useSemanticLayout');
  ok('引导线两档：显示 / 隐藏（共用 partitaGuideLinesOn/Off 文案）',
    pills[0].children.map((b) => b.textContent).join('/') === '显示/隐藏');
  ok('语义排列两档：启用 / 关闭',
    pills[1].children.map((b) => b.textContent).join('/') === '启用/关闭');

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const valueOf = (i) => ranges[i].parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('两个错位滑块，默认 20px / 100px（px 格式不是小数）',
    ranges.length === 2 && valueOf(0) === '20px' && valueOf(1) === '100px',
    String(ranges.length) + ':' + valueOf(0) + '|' + valueOf(1));
  ok('错位滑块区间与步长照抄（0~180 / 5）',
    ranges[0].min === '0' && ranges[0].max === '180' && ranges[0].step === '5');

  /* 抬最小值 → 最大值顶上去，且**另一条滑块的读数**跟着变（松手触发整面板重建）。 */
  ranges[0].value = '150';
  ranges[0].fire('input');
  ranges[0].fire('change');
  const after = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const valueAfter = (i) => after[i].parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('抬最小值到 150：内存里最大值也变 150',
    S.foliaModeTuning('partita').staggerMin === 150 && S.foliaModeTuning('partita').staggerMax === 150);
  ok('松手后两条滑块读数都是 150px（面板已重建）',
    valueAfter(0) === '150px' && valueAfter(1) === '150px',
    valueAfter(0) + '|' + valueAfter(1));
  ok('联动结果已落盘',
    savedObj(store, MODE_KEY).partita.staggerMin === 150
    && savedObj(store, MODE_KEY).partita.staggerMax === 150);
}

/* ---- I4. 倾诉面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'tilt', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('倾诉是折叠标题行',
    title.textContent === '倾诉参数' && sub.textContent === '控制歌词分行概率和斜体强调样式的出现频率。',
    title.textContent + '|' + sub.textContent);

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('配色方案四档：双色1/双色2/单色1/单色2',
    pills.length === 1 && pills[0].getAttribute('data-folia-tuning-key') === 'colorScheme'
    && pills[0].children.map((b) => b.textContent).join('/') === '双色1/双色2/单色1/单色2',
    pills[0] && pills[0].children.map((b) => b.textContent).join('/'));
  ok('默认选中双色1', pills[0].children[0].classList.contains('active'));

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const valueOf = (i) => ranges[i].parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('两个概率滑块，默认 75% / 35%（0~1 值按百分比显示）',
    ranges.length === 2 && valueOf(0) === '75%' && valueOf(1) === '35%',
    valueOf(0) + '|' + valueOf(1));
  ok('两个概率滑块 step=0.05 / max=1',
    ranges[0].step === '0.05' && ranges[0].max === '1');

  pills[0].children.find((b) => b.textContent === '单色1').fire('click');
  ok('点「单色1」落盘 colorScheme=accentAll',
    savedObj(store, MODE_KEY).tilt.colorScheme === 'accentAll');
  ok('点「单色1」后选中态跟手（不用整面板重建）',
    pills[0].children.find((b) => b.classList.contains('active')).textContent === '单色1');
}

/* ---- I5. 回环面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'claddagh', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('回环是折叠标题行',
    title.textContent === '回环参数' && sub.textContent === '调整歌词大小对比率、轨道半径及倾斜度。',
    title.textContent + '|' + sub.textContent);

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const keys = ranges.map((r) => r.getAttribute('data-folia-tuning-key'));
  ok('四个滑块顺序照抄（放大倍率 / 轨道半径 / 倾斜度 / 字符间距）',
    keys.join(',') === 'focusScaleRatio,radiusScale,ellipseTiltDeg,letterSpacingOffset', keys.join(','));
  const valueOf = (i) => ranges[i].parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('放大倍率显示 (v+1)x：0.65 → 1.65x',
    valueOf(0) === '1.65x', valueOf(0));
  ok('轨道半径 1.00x / 倾斜度 45° / 字符间距 0.0px',
    valueOf(1) === '1.00x' && valueOf(2) === '45°' && valueOf(3) === '0.0px',
    valueOf(1) + '|' + valueOf(2) + '|' + valueOf(3));

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('轴线在倾斜度之后、字符间距之前（组内顺序）',
    (() => {
      const order = host.children.filter((n) => n.classList && n.classList.contains('fx-folia-tuning-row'));
      const idxPill = order.findIndex((n) => n.find && n.find((c) => c.classList.contains('fx-folia-tuning-pills')));
      const idxSpacing = order.findIndex((n) => {
        const r = n.find && n.find((c) => c.classList.contains('fx-folia-tuning-range'));
        return r && r.getAttribute('data-folia-tuning-key') === 'letterSpacingOffset';
      });
      return idxPill === 3 && idxSpacing === 4;
    })());
  ok('中间轴线两档：显示 / 隐藏', pills[0].children.map((b) => b.textContent).join('/') === '显示/隐藏');
  pills[0].children.find((b) => b.textContent === '隐藏').fire('click');
  ok('点「隐藏」落盘 showAxisLine=false',
    savedObj(store, MODE_KEY).claddagh.showAxisLine === false);

  /* 字符间距带正负号：正数带 +、负数带 -。 */
  S.foliaModeSetTuning('claddagh', { letterSpacingOffset: 3 });
  S.foliaBuildTuningPanel();
  ok('字符间距正数显示 +3.0px',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .find((r) => r.getAttribute('data-folia-tuning-key') === 'letterSpacingOffset')
      .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '+3.0px');
  S.foliaModeSetTuning('claddagh', { letterSpacingOffset: -2 });
  S.foliaBuildTuningPanel();
  ok('字符间距负数显示 -2.0px',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .find((r) => r.getAttribute('data-folia-tuning-key') === 'letterSpacingOffset')
      .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '-2.0px');
}

/* ---- I5b. 时计面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'pendolo', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('时计是折叠标题行',
    title.textContent === '时计参数' && sub.textContent === '调整歌词弧形轮盘圆心位置、轮盘半径、弧度角度与擒纵咬合力度。',
    title.textContent + '|' + sub.textContent);

  /* 内核：默认值逐项抄 types.ts:515。 */
  const d0 = S.foliaModeTuning('pendolo');
  ok('pendolo 默认值（0.42 / 100 / 0 / 2 / 1.25 / subtle）',
    d0.arcRadius === 0.42 && d0.arcAngleDeg === 100 && d0.wheelCenterX === 0
    && d0.tickSnappiness === 2 && d0.activeScale === 1.25 && d0.showGearDecor === 'subtle'
    && d0.showCenterGradient === true && d0.showCoverOnWatchFace === false && d0.enableLineGlow === false,
    JSON.stringify(d0));
  ok('pendolo 轮盘水平位置区间 [-0.2,0.4]（input min/max 照抄）',
    S.foliaModeNormalizeTuning('pendolo', { wheelCenterX: 9 }).wheelCenterX === 0.4
    && S.foliaModeNormalizeTuning('pendolo', { wheelCenterX: -9 }).wheelCenterX === -0.2);
  ok('pendolo 擒纵咬合力度区间 [0.5,2]',
    S.foliaModeNormalizeTuning('pendolo', { tickSnappiness: 0.1 }).tickSnappiness === 0.5
    && S.foliaModeNormalizeTuning('pendolo', { tickSnappiness: 7 }).tickSnappiness === 2);
  ok('pendolo 聚焦句缩放区间 [1,1.6]（下界也是 1，不是 0.5）',
    S.foliaModeNormalizeTuning('pendolo', { activeScale: 9 }).activeScale === 1.6
    && S.foliaModeNormalizeTuning('pendolo', { activeScale: 0.1 }).activeScale === 1);
  ok('pendolo 齿轮饰线只认三档（bogus → subtle）',
    S.foliaModeNormalizeTuning('pendolo', { showGearDecor: 'bogus' }).showGearDecor === 'subtle');
  ok('pendolo 面板上没有的 wheelCenterY 也进规格表（默认 0.5 / 区间 [0,1]）',
    S.foliaModeNormalizeTuning('pendolo', { wheelCenterY: 9 }).wheelCenterY === 1
    && S.foliaModeNormalizeTuning('pendolo', {}).wheelCenterY === 0.5);

  const ranges = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'));
  const keys = ranges.map((r) => r.getAttribute('data-folia-tuning-key'));
  ok('五个滑块顺序照抄（轮盘位置 / 半径 / 弧度 / 咬合力度 / 聚焦缩放）',
    keys.join(',') === 'wheelCenterX,arcRadius,arcAngleDeg,tickSnappiness,activeScale', keys.join(','));
  const valueOf = (i) => ranges[i].parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('轮盘水平位置 0 读作 0%（不带正号）', valueOf(0) === '0%', valueOf(0));
  ok('半径 42% / 弧度 100° / 咬合 2.0x / 缩放 1.25x',
    valueOf(1) === '42%' && valueOf(2) === '100°' && valueOf(3) === '2.0x' && valueOf(4) === '1.25x',
    [valueOf(1), valueOf(2), valueOf(3), valueOf(4)].join('|'));
  ok('滑块区间与步长照抄（-0.2~0.4 / 0.01；0.5~2 / 0.1）',
    (() => {
      const a = ranges[0], b = ranges[3];
      return a.min === '-0.2' && a.max === '0.4' && a.step === '0.01'
        && b.min === '0.5' && b.max === '2' && b.step === '0.1';
    })());

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('四组药丸顺序照抄（饰线 / 中央渐变 / 封面 / 线条发光）',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'showGearDecor,showCenterGradient,showCoverOnWatchFace,enableLineGlow',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(','));
  ok('齿轮饰线三档：无 / 半透明 / 完整',
    pills[0].children.map((b) => b.textContent).join('/') === '无/半透明/完整');
  ok('开关文案各用各的键：开启/关闭、显示/隐藏、开启/关闭',
    pills[1].children.map((b) => b.textContent).join('/') === '开启/关闭'
    && pills[2].children.map((b) => b.textContent).join('/') === '显示/隐藏'
    && pills[3].children.map((b) => b.textContent).join('/') === '开启/关闭');
  ok('默认选中态：半透明 / 开启 / 隐藏 / 关闭',
    pills[0].children.find((b) => b.classList.contains('active')).textContent === '半透明'
    && pills[1].children.find((b) => b.classList.contains('active')).textContent === '开启'
    && pills[2].children.find((b) => b.classList.contains('active')).textContent === '隐藏'
    && pills[3].children.find((b) => b.classList.contains('active')).textContent === '关闭');

  pills[2].children.find((b) => b.textContent === '显示').fire('click');
  ok('点「显示」落盘 showCoverOnWatchFace=true',
    savedObj(store, MODE_KEY).pendolo.showCoverOnWatchFace === true);
  pills[3].children.find((b) => b.textContent === '开启').fire('click');
  ok('点「开启」落盘 enableLineGlow=true',
    savedObj(store, MODE_KEY).pendolo.enableLineGlow === true);

  /* 正数带正号：0.2 → +20%。 */
  S.foliaModeSetTuning('pendolo', { wheelCenterX: 0.2 });
  S.foliaBuildTuningPanel();
  ok('轮盘水平位置正数显示 +20%',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))[0]
      .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent === '+20%');
  S.foliaModeResetTuning('pendolo');
}

/* ---- I5c. 商籁面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'sonnet', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('商籁是折叠标题行',
    title.textContent === '商籁参数'
    && sub.textContent === '调整商籁场景运动、纹理分辨率，以及绘制的图层。建议搭配空 / Sora 背景。',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('sonnet');
  ok('sonnet 默认值（types.ts:560：1/1/1、full、1.5、后期关、grain 0.2、vignette 0.85）',
    d0.cameraIntensity === 1 && d0.typographyMotion === 1 && d0.mgDensity === 1
    && d0.outerFrameMode === 'full' && d0.textureResolution === 1.5
    && d0.postProcessEnabled === false && d0.postProcessGrain === 0.2 && d0.postProcessVignette === 0.85,
    JSON.stringify(d0));
  ok('sonnet 纹理分辨率区间 [0.5,4]',
    S.foliaModeNormalizeTuning('sonnet', { textureResolution: 9 }).textureResolution === 4
    && S.foliaModeNormalizeTuning('sonnet', { textureResolution: 0.1 }).textureResolution === 0.5);
  ok('sonnet 运动三滑块区间 [0,2]',
    S.foliaModeNormalizeTuning('sonnet', { cameraIntensity: -1 }).cameraIntensity === 0
    && S.foliaModeNormalizeTuning('sonnet', { mgDensity: 9 }).mgDensity === 2);
  ok('sonnet 后期两项是 [0,2]（暗角 / 透镜扭曲），其余 [0,1]',
    S.foliaModeNormalizeTuning('sonnet', { postProcessVignette: 9 }).postProcessVignette === 2
    && S.foliaModeNormalizeTuning('sonnet', { postProcessLensDistortion: 9 }).postProcessLensDistortion === 2
    && S.foliaModeNormalizeTuning('sonnet', { postProcessGrain: 9 }).postProcessGrain === 1);
  ok('sonnet 外层边框只认三档（bogus → full）',
    S.foliaModeNormalizeTuning('sonnet', { outerFrameMode: 'bogus' }).outerFrameMode === 'full');

  ok('四个段标题按顺序（渲染质量 / 动态与构图 / 后处理 / 显示内容）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title'))
      .map((n) => n.textContent).join(',')
      === '渲染质量,动态与构图,后处理,显示内容',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title')).map((n) => n.textContent).join(','));

  /* 后期关着：质量 1 + 运动 3 = 4 个滑块；开着：再多 7 个。 */
  const sliderKeys = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .map((r) => r.getAttribute('data-folia-tuning-key'));
  ok('后期关着时只有四个滑块（纹理分辨率 + 三项运动）',
    sliderKeys().join(',') === 'textureResolution,cameraIntensity,typographyMotion,mgDensity',
    sliderKeys().join(','));
  const valueOf = (key) => host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .find((r) => r.getAttribute('data-folia-tuning-key') === key)
    .parentNode.find((n) => n.classList.contains('fx-folia-tuning-value')).textContent;
  ok('纹理分辨率 1.50x / 镜头运动强度 1.00x（toFixed(2)+x）',
    valueOf('textureResolution') === '1.50x' && valueOf('cameraIntensity') === '1.00x',
    valueOf('textureResolution') + '|' + valueOf('cameraIntensity'));

  const postPills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'postProcessEnabled');
  postPills.children.find((b) => b.textContent === '开启').fire('click');
  ok('点「开启」后七项后期滑块出现（顺序照抄）',
    sliderKeys().slice(4).join(',')
      === 'postProcessGrain,postProcessContrast,postProcessRgbShift,postProcessLensDistortion,postProcessLensDispersion,postProcessHalftone,postProcessVignette',
    sliderKeys().join(','));
  ok('点「开启」落盘 postProcessEnabled=true',
    savedObj(store, MODE_KEY).sonnet.postProcessEnabled === true);

  ok('边框三档文案：完全隐藏 / 仅显示框架 / 完全显示',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .find((g) => g.getAttribute('data-folia-tuning-key') === 'outerFrameMode')
      .children.map((b) => b.textContent).join('/') === '完全隐藏/仅显示框架/完全显示');
  ok('七个显示开关按顺序（仅显示文字 → 场景转场）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .filter((g) => g.getAttribute('data-folia-tuning-key') !== 'postProcessEnabled'
        && g.getAttribute('data-folia-tuning-key') !== 'outerFrameMode')
      .map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'showOnlyText,showGuide,showBackgroundMg,showFixedGeo,showGiantDecorativeText,showBackgroundDecor,enableTransitions');
  ok('性能提示与段内说明都在',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-hint'))
      .map((n) => n.textContent).join('|')
      === '提高纹理分辨率会增加 GPU 显存占用和渲染负载，可能影响性能。');
  S.foliaModeResetTuning('sonnet');
}

/* ---- I5d. 凝彩面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'tempera', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('凝彩是折叠标题行',
    title.textContent === '凝彩参数'
    && sub.textContent === '调整凝彩的色块构图、镜头运动与渲染质量。建议搭配空 / Sora 背景。',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('tempera');
  ok('tempera 默认值（types.ts:674：0.5 入场 / duo / 后期开 / 0.85 暗角）',
    d0.cameraIntensity === 1 && d0.glyphMotion === 1 && d0.glyphSettleStretch === 0.5
    && d0.colorMode === 'duo' && d0.postProcessEnabled === true
    && d0.postProcessVignette === 0.85 && d0.layerImageFrequency === 0.6,
    JSON.stringify(d0));
  ok('tempera 逐字入场时序区间 [0,1]',
    S.foliaModeNormalizeTuning('tempera', { glyphSettleStretch: 9 }).glyphSettleStretch === 1
    && S.foliaModeNormalizeTuning('tempera', { glyphSettleStretch: -9 }).glyphSettleStretch === 0);
  ok('tempera 色彩模式只认三档（bogus → duo）',
    S.foliaModeNormalizeTuning('tempera', { colorMode: 'bogus' }).colorMode === 'duo');
  ok('tempera 图片清单透传（数组原样、非数组回落空清单）',
    S.foliaModeNormalizeTuning('tempera', { layerImages: [{ id: 'a' }] }).layerImages.length === 1
    && S.foliaModeNormalizeTuning('tempera', { layerImages: 'x' }).layerImages.length === 0);
  ok('tempera 图片前后层只认 back|front',
    S.foliaModeNormalizeTuning('tempera', { layerImageDepth: 'middle' }).layerImageDepth === 'back');

  ok('五个段标题按顺序（渲染质量 / 动态与调色 / 后处理 / 歌词分镜 / 显示内容）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title'))
      .map((n) => n.textContent).join(',')
      === '渲染质量,动态与调色,后处理,歌词分镜,显示内容',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title')).map((n) => n.textContent).join(','));

  const sliderKeys = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .map((r) => r.getAttribute('data-folia-tuning-key'));
  ok('后期默认开着：九个滑块（纹理 + 两项运动 + 入场时序 + 五项后期）',
    sliderKeys().join(',')
      === 'textureResolution,cameraIntensity,glyphMotion,glyphSettleStretch,'
        + 'postProcessGrain,postProcessContrast,postProcessRgbShift,postProcessVignette,postProcessLensDistortion',
    sliderKeys().join(','));

  const pillsOf = (key) => host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === key);
  ok('色彩模式三档文案：主题双色 / 黑白灰 / 封面渐变',
    pillsOf('colorMode').children.map((b) => b.textContent).join('/') === '主题双色/黑白灰/封面渐变');
  ok('后期里先总开关、再纹理压缩',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .filter((g) => ['postProcessEnabled', 'postProcessTextureCompression'].indexOf(
        g.getAttribute('data-folia-tuning-key')) >= 0)
      .map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'postProcessEnabled,postProcessTextureCompression');
  ok('五条提示都在（性能 / 入场时序 / 纹理压缩 / 整句显示）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-hint')).length === 4,
    String(host.findAll((n) => n.classList.contains('fx-folia-tuning-hint')).length));

  pillsOf('postProcessEnabled').children.find((b) => b.textContent === '关闭').fire('click');
  ok('关掉后期后五项后期滑块整块消失',
    sliderKeys().join(',') === 'textureResolution,cameraIntensity,glyphMotion,glyphSettleStretch',
    sliderKeys().join(','));
  ok('关掉后期落盘 postProcessEnabled=false',
    savedObj(store, MODE_KEY).tempera.postProcessEnabled === false);

  ok('整句显示歌词默认关（关闭时按 2~4 词分镜）',
    pillsOf('wholeLineLyrics').children.find((b) => b.classList.contains('active')).textContent === '关闭');
  ok('五个显示开关按顺序（色块场景 → 场景转场）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .filter((g) => ['showBlocks', 'showDecor', 'showCornerMarks', 'textInversion', 'enableTransitions']
        .indexOf(g.getAttribute('data-folia-tuning-key')) >= 0)
      .map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'showBlocks,showDecor,showCornerMarks,textInversion,enableTransitions');
  S.foliaModeResetTuning('tempera');
}

/* ---- I5e. 镜台（立体）面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'diorama', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('镜台是折叠标题行（Folia 面板没有说明行）',
    title.textContent === '镜台参数' && sub.textContent === '',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('diorama');
  ok('diorama 默认值（types.ts:883：1/1/1、576、0.65、浅层几何全开）',
    d0.cameraSpeed === 1 && d0.motionAmount === 1 && d0.audioReactivity === 1
    && d0.particleDensity === 576 && d0.particleGlowIntensity === 0.65
    && d0.showParticles === true && d0.glowEnabled === true && d0.gradientEnabled === false,
    JSON.stringify(d0));
  ok('diorama 嵌套块按默认补齐（geometryVisibility 六项）',
    d0.geometryVisibility.enabled === true && d0.geometryVisibility.mode === 'clouds'
    && d0.geometryVisibility.strands === true && d0.geometryVisibility.rings === true,
    JSON.stringify(d0.geometryVisibility));
  ok('diorama 嵌套块只改一项、其余保持（{...DEFAULT, ...patch}）',
    (() => {
      const n = S.foliaModeNormalizeTuning('diorama', { geometryVisibility: { rings: false } });
      return n.geometryVisibility.rings === false && n.geometryVisibility.strands === true
        && n.geometryVisibility.mode === 'clouds';
    })());
  ok('diorama 几何形态只认 cloud|corridor（bogus → clouds）',
    S.foliaModeNormalizeTuning('diorama', { geometryVisibility: { mode: 'bogus' } })
      .geometryVisibility.mode === 'clouds');
  ok('diorama 粒子密度取整且钳区间 [96,1536]',
    S.foliaModeNormalizeTuning('diorama', { particleDensity: 500.4 }).particleDensity === 500
    && S.foliaModeNormalizeTuning('diorama', { particleDensity: 9 }).particleDensity === 96);
  ok('diorama 尘埃两轴取整且钳区间',
    S.foliaModeNormalizeTuning('diorama', { backgroundParticleCircumference: 7.6 }).backgroundParticleCircumference === 8
    && S.foliaModeNormalizeTuning('diorama', { backgroundParticleRadial: 9 }).backgroundParticleRadial === 4);

  /* 折叠组展开体里的滑块也带 range 类，所以顶层三滑块要排除 fold-body 后代。 */
  const insideFoldBody = (n) => {
    let p = n.parentNode;
    while (p) {
      if (p.classList.contains('fx-folia-tuning-fold-body')) return true;
      p = p.parentNode;
    }
    return false;
  };
  const topRangeKeys = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .filter((n) => !insideFoldBody(n))
    .map((n) => n.getAttribute('data-folia-tuning-key'));
  ok('折叠组之外只有三个滑块（镜头速度 / 运动幅度 / 点云音频响应）',
    topRangeKeys.join(',') === 'cameraSpeed,motionAmount,audioReactivity',
    topRangeKeys.join(','));
  ok('三个跟唱效果组 + 点云几何 + 背景粒子（共五个可折叠组，顺序照抄）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-fold'))
      .map((n) => n.getAttribute('data-folia-fold')).join(',')
      === 'effect:glow,effect:soul,effect:gradient,geometry,particles',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-fold'))
      .map((n) => n.getAttribute('data-folia-fold')).join(','));
  ok('折叠组默认全收起（React 里是 useState(false)）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-fold'))
      .filter((n) => n.classList.contains('open')).length === 0);

  /* 展开一个组：只改 DOM 类，不重建面板。 */
  const glowFold = host.findAll((n) => n.classList.contains('fx-folia-tuning-fold'))
    .find((n) => n.getAttribute('data-folia-fold') === 'effect:glow');
  glowFold.find((n) => n.classList.contains('fx-folia-tuning-fold-btn')).fire('click');
  ok('点标题按钮把组展开（chevron 旋转靠 .open）', glowFold.classList.contains('open'));

  /* 强度四档：默认 1 → 「中」选中；点「自定义」才出现滑块。 */
  const strength = () => host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'glowIntensityPreset');
  ok('强度四档文案：弱 / 中 / 强 / 自定义',
    strength().children.map((b) => b.textContent).join('/') === '弱/中/强/自定义');
  ok('强度 1.0 默认停在「中」',
    strength().children.find((b) => b.classList.contains('active')).textContent === '中');
  strength().children.find((b) => b.textContent === '自定义').fire('click');
  ok('点「自定义」后出现自定义强度滑块（0.1~1.5）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .some((r) => r.getAttribute('data-folia-tuning-key') === 'glowIntensity'));
  strength().children.find((b) => b.textContent === '强').fire('click');
  ok('点「强」落盘 1.5 且切回档位（自定义滑块消失）',
    S.foliaModeTuning('diorama').glowIntensity === 1.5
    && !host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .some((r) => r.getAttribute('data-folia-tuning-key') === 'glowIntensity'));

  /* 组开关（滑钮，不是药丸）：点一下就落盘。 */
  const glowSwitch = host.findAll((n) => n.classList.contains('fx-folia-tuning-switch'))
    .find((n) => n.getAttribute('role') === 'switch'
      && n.parentNode.classList.contains('fx-folia-tuning-fold-head')
      && n.parentNode.parentNode.getAttribute('data-folia-fold') === 'effect:glow');
  glowSwitch.fire('click');
  ok('点效果组滑钮落盘 glowEnabled=false', S.foliaModeTuning('diorama').glowEnabled === false);

  ok('关键字着色是普通开关行（不是折叠组）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-switch-row'))
      .map((n) => n.find((c) => c.classList.contains('fx-folia-tuning-switch')).getAttribute('data-folia-tuning-key'))
      .join(',') === 'keywordColoringEnabled');
  ok('点云几何组里带形态两档 + 四个子几何 + 粒子外观（展开后）',
    (() => {
      const fold = host.findAll((n) => n.classList.contains('fx-folia-tuning-fold'))
        .find((n) => n.getAttribute('data-folia-fold') === 'geometry');
      const miniKeys = fold.findAll((n) => n.classList.contains('fx-folia-tuning-mini-row'))
        .map((n) => n.getAttribute('data-folia-tuning-key')).join(',');
      const modeBtns = fold.find((n) => n.getAttribute('data-folia-tuning-key') === 'geometryMode');
      return !!modeBtns
        && modeBtns.children.map((b) => b.textContent).join('/') === '点云/长廊'
        && miniKeys === 'strands,blobs,ribbons,rings,particleGlowEnabled'
        && !!fold.find((n) => n.getAttribute('data-folia-tuning-key') === 'particleDensity')
        && !!fold.find((n) => n.getAttribute('data-folia-tuning-key') === 'particleScale');
    })());
  S.foliaModeResetTuning('diorama');
}

/* ---- I5e2. 浮名面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'fume', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('浮名是折叠标题行',
    title.textContent === '浮名参数'
    && sub.textContent === '控制打印方块、镜头节奏、追焦方式、辉光和大标题比例。',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('fume');
  ok('fume 默认值（types.ts:446：打印方块显示 / 通用几何关 / 0.5 / 1 / smooth / 1 / 1 / 1）',
    d0.hidePrintSymbols === false && d0.disableGeometricBackground === true
    && d0.backgroundObjectOpacity === 0.5 && d0.textHoldRatio === 1
    && d0.cameraTrackingMode === 'smooth' && d0.cameraSpeed === 1
    && d0.glowIntensity === 1 && d0.heroScale === 1,
    JSON.stringify(d0));
  ok('fume 五个区间照抄 resolveFumeTuning（[0,1] / [0,1] / [.55,1.85] / [0,1.8] / [.82,1.32]）',
    S.foliaModeNormalizeTuning('fume', { backgroundObjectOpacity: 9 }).backgroundObjectOpacity === 1
    && S.foliaModeNormalizeTuning('fume', { textHoldRatio: -3 }).textHoldRatio === 0
    && S.foliaModeNormalizeTuning('fume', { cameraSpeed: 9 }).cameraSpeed === 1.85
    && S.foliaModeNormalizeTuning('fume', { glowIntensity: 9 }).glowIntensity === 1.8
    && S.foliaModeNormalizeTuning('fume', { heroScale: 0.1 }).heroScale === 0.82);
  ok('fume 追焦方式只认 stepped|smooth（bogus → smooth）',
    S.foliaModeNormalizeTuning('fume', { cameraTrackingMode: 'bogus' }).cameraTrackingMode === 'smooth');

  /* 两组「显示/隐藏」药丸：键名与取值都是**反的**（hide* / disable* 存 true 表示隐藏）。 */
  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('两组可见性药丸在前（隐藏打印方块 / 通用几何图形）',
    pills.slice(0, 2).map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'hidePrintSymbols,disableGeometricBackground',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(','));
  ok('两组可见性药丸文案都是 显示/隐藏',
    pills[0].children.map((b) => b.textContent).join('/') === '显示/隐藏'
    && pills[1].children.map((b) => b.textContent).join('/') === '显示/隐藏');
  ok('反向取值：hidePrintSymbols=false 选中「显示」，disableGeometricBackground=true 选中「隐藏」',
    pills[0].children.find((b) => b.classList.contains('active')).textContent === '显示'
    && pills[1].children.find((b) => b.classList.contains('active')).textContent === '隐藏');

  ok('五个滑块顺序照抄（背景透明度 / 停留比例 / 镜头速度 / 辉光 / 大标题）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .map((n) => n.getAttribute('data-folia-tuning-key')).join(',')
      === 'backgroundObjectOpacity,textHoldRatio,cameraSpeed,glowIntensity,heroScale',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
      .map((n) => n.getAttribute('data-folia-tuning-key')).join(','));
  ok('追焦方式落在镜头速度与大标题之间（组内顺序）',
    (() => {
      const order = host.findAll((n) => n.getAttribute('data-folia-tuning-key') !== null)
        .map((n) => n.getAttribute('data-folia-tuning-key'));
      return order.indexOf('cameraTrackingMode') === order.indexOf('cameraSpeed') + 1
        && order.indexOf('glowIntensity') === order.indexOf('cameraTrackingMode') + 1;
    })(),
    host.findAll((n) => n.getAttribute('data-folia-tuning-key') !== null)
      .map((n) => n.getAttribute('data-folia-tuning-key')).join(','));
  ok('追焦两档文案：定格 / 平滑（默认平滑）',
    pills[2].children.map((b) => b.textContent).join('/') === '定格/平滑'
    && pills[2].children.find((b) => b.classList.contains('active')).textContent === '平滑');
  const fumeReadouts = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
    .map((n) => n.parentNode.find((c) => c.classList.contains('fx-folia-tuning-value')).textContent);
  ok('读数：透明度 50% / 停留 100% / 速度 1.00x / 辉光 1.00x / 大标题 1.00x',
    fumeReadouts.join('/') === '50%/100%/1.00x/1.00x/1.00x', fumeReadouts.join('/'));
  ok('大标题比例是唯一 0.02 步长（区间 0.82~1.32）',
    (() => {
      const r = host.findAll((n) => n.classList.contains('fx-folia-tuning-range'))
        .find((n) => n.getAttribute('data-folia-tuning-key') === 'heroScale');
      return r.step === '0.02' && r.min === '0.82' && r.max === '1.32';
    })());
  ok('点「定格」落盘 cameraTrackingMode=stepped',
    (pills[2].children[0].fire('click'), S.foliaModeTuning('fume').cameraTrackingMode === 'stepped'));
  ok('点「隐藏」落盘 disableGeometricBackground=true（已隐藏时点回显示）',
    (() => {
      const g = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
        .find((n) => n.getAttribute('data-folia-tuning-key') === 'disableGeometricBackground');
      g.children[0].fire('click');
      return S.foliaModeTuning('fume').disableGeometricBackground === false;
    })());
  S.foliaModeResetTuning('fume');
}

/* ---- I5f. 莫奈（样式）面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'monet', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('莫奈样式是折叠标题行',
    title.textContent === '莫奈参数' && sub.textContent === '控制关键字、右侧肖像和底部频谱样式。',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('monet');
  ok('monet 样式默认值（types.ts:1066：1.2 / bar / cover / square）',
    d0.fontScale === 1.2 && d0.audioStyle === 'bar' && d0.portraitSource === 'cover'
    && d0.portraitStyle === 'square' && d0.showPortraitDragHanger === true
    && d0.showDescription === true && d0.showAudioVisualization === true,
    JSON.stringify(d0));
  ok('monet 字体缩放区间 [0.7,1.5]',
    S.foliaModeNormalizeTuning('monet', { fontScale: 9 }).fontScale === 1.5
    && S.foliaModeNormalizeTuning('monet', { fontScale: 0.1 }).fontScale === 0.7);
  ok('monet 三个枚举各只认自己的白名单',
    S.foliaModeNormalizeTuning('monet', { audioStyle: 'bogus' }).audioStyle === 'bar'
    && S.foliaModeNormalizeTuning('monet', { portraitStyle: 'bogus' }).portraitStyle === 'square'
    && S.foliaModeNormalizeTuning('monet', { portraitSource: 'bogus' }).portraitSource === 'cover');

  ok('三段标题按顺序（歌词样式 / 头像来源 / 频谱样式）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title'))
      .map((n) => n.textContent).join(',') === '歌词样式,头像来源,频谱样式',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-section-title')).map((n) => n.textContent).join(','));
  ok('字体缩放显示 1.20x（toFixed(2)+x）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-value'))[0].textContent === '1.20x',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-value'))[0].textContent);

  const pillsOf = (key) => host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === key);
  ok('六组药丸顺序照抄',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'keywordColoringEnabled,showDescription,portraitSource,portraitStyle,showPortraitDragHanger,showAudioVisualization,audioStyle',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
      .map((g) => g.getAttribute('data-folia-tuning-key')).join(','));
  ok('肖像来源两档：封面 / 自定义图片（没有上传图时后者禁用）',
    pillsOf('portraitSource').children.map((b) => b.textContent).join('/') === '封面/自定义图片'
    && pillsOf('portraitSource').children[1].disabled === true);
  ok('封面形状：长方形 / 正方形，默认正方形',
    pillsOf('portraitStyle').children.map((b) => b.textContent).join('/') === '长方形/正方形'
    && pillsOf('portraitStyle').children.find((b) => b.classList.contains('active')).textContent === '正方形');
  ok('频谱样式：柱状 / 线条，默认柱状',
    pillsOf('audioStyle').children.find((b) => b.classList.contains('active')).textContent === '柱状');
  pillsOf('audioStyle').children.find((b) => b.textContent === '线条').fire('click');
  ok('点「线条」落盘 audioStyle=line',
    savedObj(store, MODE_KEY).monet.audioStyle === 'line');
  S.foliaModeResetTuning('monet');
}

/* ---- I5g. 群唱面板 ---- */
{
  const { S, store, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'cappella', background: 'none' } });
  S.foliaBuildTuningPanel();
  ok('群唱是折叠标题行',
    title.textContent === '群唱参数'
    && sub.textContent === '控制头像来源、表情包显示、自定义来源和预览缩略图。',
    title.textContent + '|' + sub.textContent);

  const d0 = S.foliaModeTuning('cappella');
  ok('cappella 默认值（types.ts:482：显示表情包 / 内置 / 封面）',
    d0.showEmoMessages === true && d0.emojiPackSource === 'builtin' && d0.avatarSource === 'cover',
    JSON.stringify(d0));
  ok('cappella 头像来源只认四档（bogus → cover）',
    S.foliaModeNormalizeTuning('cappella', { avatarSource: 'bogus' }).avatarSource === 'cover');
  ok('cappella 表情包来源只认两档',
    S.foliaModeNormalizeTuning('cappella', { emojiPackSource: 'bogus' }).emojiPackSource === 'builtin');

  const pills = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'));
  ok('三组药丸顺序（显示表情包 / 头像来源 / 表情包来源）',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(',')
      === 'showEmoMessages,avatarSource,emojiPackSource',
    pills.map((g) => g.getAttribute('data-folia-tuning-key')).join(','));
  ok('显示表情包：显示 / 隐藏，默认显示',
    pills[0].children.map((b) => b.textContent).join('/') === '显示/隐藏'
    && pills[0].children[0].classList.contains('active'));
  ok('头像来源四档：封面 / 内置头像 / 色块 / 自定义',
    pills[1].children.map((b) => b.textContent).join('/') === '封面/内置头像/色块/自定义');
  ok('没有自定义头像时「自定义」禁用（Folia 同款 disabled）',
    pills[1].children[3].disabled === true);
  ok('表情包来源两档：内置 / 自定义（后者无资源时禁用）',
    pills[2].children.map((b) => b.textContent).join('/') === '内置/自定义'
    && pills[2].children[1].disabled === true);
  pills[1].children.find((b) => b.textContent === '色块').fire('click');
  ok('点「色块」落盘 avatarSource=color',
    savedObj(store, MODE_KEY).cappella.avatarSource === 'color');
  S.foliaModeResetTuning('cappella');
}

/* ---- I6. 背景面板 + 样式面板同时命中 ---- */
{
  const { S, host, title, sub } = loadSandbox({ foliaWorld: { mode: 'claddagh', background: 'latent', active: true } });
  S.foliaBuildTuningPanel();
  ok('双命中时背景面板占折叠标题行（隐现背景）', title.textContent === '隐现背景', title.textContent);
  ok('样式面板退成面板内标题（回环参数）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-intro-title')).map((n) => n.textContent).join(',') === '回环参数');
  ok('样式面板的内嵌副标题也在（回环说明）',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-intro-sub')).map((n) => n.textContent).join(',')
      === '调整歌词大小对比率、轨道半径及倾斜度。');
  ok('两块面板之间有且只有一条分隔线',
    host.findAll((n) => n.classList.contains('fx-folia-tuning-divider')).length === 1);
}


/* =============================== I9. 自定义图上传行（00b 图片池 + 三个面板） ===============================
 * 断言来源：
 *   services/visualizerImageAsset.ts（键名逐字 / 扩展名白名单 / 条目形态）
 *   services/monetBackgroundImage.ts + monetPortraitImage.ts（两张单图槽各自的键）
 *   stores/useVisualizerSettingsStore.ts:681-748（只取第一个文件、来源切换、清空回退）
 *   三张卡片的上传按钮与「文件名」行（MonetBackgroundSettingsCard:236-300 /
 *   NomandBackgroundSettingsCard:95-129 / MonetSettingsPanel:264-330）
 * 这一段是异步的（上传要等 promise），所以单独成函数，由文件末尾统一等它跑完再汇总。
 */
async function runImagePoolSection() {
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const png = (name) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
  const txt = (name) => new File([new Uint8Array([104, 105])], name, { type: 'text/plain' });

  const { S, store, host } = loadSandbox({ foliaWorld: { mode: 'still', background: 'monet' } });
  const assetRow = () => host.find((n) => n.classList.contains('fx-folia-asset'));
  const assetBtns = () => (assetRow() ? assetRow().findAll((n) => n.classList.contains('fx-folia-asset-btn')) : []);
  const assetName = () => {
    const n = assetRow() ? assetRow().find((x) => x.classList.contains('fx-folia-asset-name')) : null;
    return n ? n.textContent : null;
  };
  const assetLabel = () => {
    const n = assetRow() ? assetRow().find((x) => x.classList.contains('fx-folia-tuning-label')) : null;
    return n ? n.textContent : null;
  };
  const assetThumb = () => (assetRow()
    ? assetRow().find((x) => x.classList.contains('fx-folia-asset-thumb')) : null);

  ok('五个资产键名逐字对齐 Folia',
    Object.keys(S.foliaAssetKeys).length === 5
    && S.foliaAssetKeys.background === 'monet_background_image'
    && S.foliaAssetKeys.portrait === 'monet_portrait_image'
    && S.foliaAssetKeys.cappellaAvatar === 'cappella_custom_avatar'
    && S.foliaAssetKeys.cappellaEmoji === 'cappella_custom_emoji'
    && S.foliaAssetKeys.temperaLayers === 'tempera_layer_images',
    JSON.stringify(S.foliaAssetKeys));
  ok('两条校验文案逐字（zh-CN.ts:300-301）',
    S.foliaAssetText.selectFile === '请选择图片文件。'
    && S.foliaAssetText.unsupported === '仅支持 png、jpg、jpeg、gif、webp、svg 图片。',
    S.foliaAssetText.unsupported);
  ok('沙箱里没有 IndexedDB → 明确标记降级，功能仍照常（内存兜底）',
    S.foliaAssetDbUnavailable() === true);

  const none = await S.foliaAssetPutFile('background', null);
  ok('空选被拒：请选择图片文件。', none.ok === false && none.error === '请选择图片文件。', none.error);
  const bad = await S.foliaAssetPutFile('background', txt('note.txt'));
  ok('.txt 被拒：仅支持 png、jpg、jpeg、gif、webp、svg 图片。',
    bad.ok === false && bad.error === '仅支持 png、jpg、jpeg、gif、webp、svg 图片。', bad.error);
  ok('两次失败都没写池、也没桥接全局',
    S.foliaAssetCount('background') === 0
    && !S.foliaMonetBackgroundImage && !S.foliaNomandCustomImage,
    String(S.foliaAssetCount('background')));

  const first = await S.foliaAssetPutFile('background', png('bg-one.png'));
  const snap = S.foliaAssetGet('background');
  ok('上传 PNG：条目带 id / name / mime 与 blob: 地址',
    first.ok === true && snap && snap.name === 'bg-one.png' && snap.mimeType === 'image/png'
    && String(snap.url).indexOf('blob:') === 0,
    JSON.stringify({ ok: first.ok, name: snap && snap.name, url: snap && String(snap.url).slice(0, 12) }));
  ok('资产 id 是「时间戳-文件名」', /^\d+-bg-one\.png$/.test(String(snap && snap.id)), snap && snap.id);
  ok('一张图桥接两个全局入口（莫奈背景 / 漫游共用）',
    S.foliaMonetBackgroundImage && S.foliaNomandCustomImage
    && S.foliaMonetBackgroundImage.id === snap.id && S.foliaNomandCustomImage.id === snap.id,
    JSON.stringify([S.foliaMonetBackgroundImage && S.foliaMonetBackgroundImage.id,
      S.foliaNomandCustomImage && S.foliaNomandCustomImage.id]));

  S.foliaBuildTuningPanel();
  ok('莫奈背景面板长出上传行：上传 / 清空两粒按钮',
    assetBtns().length === 2 && assetBtns()[0].textContent === '上传背景图'
    && assetBtns()[1].textContent === '清空背景图',
    JSON.stringify(assetBtns().map((b) => b.textContent)));
  ok('有图时清空可用、文件名行显示真实文件名',
    assetBtns()[1].disabled === false && assetName() === 'bg-one.png',
    String(assetName()));
  ok('上传行与滑块/开关同一骨相：头行有标签「图片文件」',
    assetLabel() === '图片文件', String(assetLabel()));
  ok('有图时字段里出现缩略图，src 是对象的 blob: 地址',
    !!assetThumb() && String(assetThumb().src || '').indexOf('blob:') === 0,
    assetThumb() && String(assetThumb().src).slice(0, 12));

  const second = await S.foliaAssetPutFile('background', png('bg-two.png'));
  await settle();
  S.foliaBuildTuningPanel();
  const snap2 = S.foliaAssetGet('background');
  ok('再上传一次是替换：只剩一条、id 换新',
    second.ok === true && S.foliaAssetCount('background') === 1 && snap2.name === 'bg-two.png'
    && snap2.id !== snap.id,
    JSON.stringify({ count: S.foliaAssetCount('background'), name: snap2.name }));

  await S.foliaAssetClear('background');
  ok('清空后池归零、两个全局都回到 null',
    S.foliaAssetCount('background') === 0
    && !S.foliaMonetBackgroundImage && !S.foliaNomandCustomImage);
  S.foliaBuildTuningPanel();
  ok('无图时清空按钮禁用、文件名行回「未选择」',
    assetBtns()[1].disabled === true && assetName() === '未选择',
    JSON.stringify({ disabled: assetBtns()[1].disabled, name: assetName() }));
  ok('字段控件恒在：无图时缩略图槽位是虚线占位（提示可上传）',
    !!assetThumb() && assetThumb().classList.contains('is-empty')
    && assetThumb().classList.contains('fx-folia-asset-thumb'),
    assetThumb() && assetThumb().className);

  /* ---- 面板上真选文件：input.files 塞 File + 派发 change（与用户操作同一条路径） ---- */
  const input = assetRow() ? assetRow().find((n) => n.tagName === 'INPUT') : null;
  ok('上传行里留着 file input（accept 与 Folia 同款）',
    !!input && input.accept === '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*' && input.type === 'file',
    input && (input.type + ' / ' + input.accept));
  input.files = [png('panel-bg.png')];
  input.fire('change');
  await settle();
  await settle();
  ok('选文件后：文件名回显、来源切到 uploaded-global 并落盘',
    assetName() === 'panel-bg.png'
    && S.foliaMonetTuning().backgroundSource === 'uploaded-global'
    && savedObj(store, MONET_KEY).backgroundSource === 'uploaded-global',
    JSON.stringify({ name: assetName(), source: S.foliaMonetTuning().backgroundSource }));

  /* ---- 漫游：同一个资产槽，成功文案是「背景图片上传成功」 ---- */
  S.foliaWorld.background = 'nomand';
  S.foliaNomandResetTuning();
  await S.foliaAssetClear('background');
  S.foliaBuildTuningPanel();
  const nomandPill = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'imageSource');
  ok('漫游面板也有同一行上传，「自定义图片」无图时禁用',
    assetBtns().length === 2 && nomandPill && nomandPill.children[1].disabled === true,
    JSON.stringify(assetBtns().map((b) => b.textContent)));
  const nomandInput = assetRow().find((n) => n.tagName === 'INPUT');
  nomandInput.files = [png('nomand-bg.png')];
  nomandInput.fire('change');
  await settle();
  await settle();
  ok('漫游上传后显示成功文案、来源切 uploaded-global 并落盘',
    assetName() === '背景图片上传成功'
    && S.foliaNomandTuning().imageSource === 'uploaded-global'
    && savedObj(store, NOMAND_KEY).imageSource === 'uploaded-global',
    JSON.stringify({ name: assetName(), source: S.foliaNomandTuning().imageSource }));
  ok('背景图两个面板共用：池里仍是同一张 nomand-bg.png',
    S.foliaAssetName('background') === 'nomand-bg.png', S.foliaAssetName('background'));

  /* ---- 莫奈样式面板：肖像槽是另一个键，互不干扰 ---- */
  await S.foliaAssetClear('background');
  S.foliaWorld.background = 'none';
  S.foliaWorld.mode = 'monet';
  if (S.foliaModeResetTuning) S.foliaModeResetTuning('monet');
  S.foliaBuildTuningPanel();
  const facePill = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'portraitSource');
  ok('莫奈样式面板有肖像上传行，无图时「自定义图片」禁用',
    assetBtns().length === 2 && assetBtns()[0].textContent === '上传肖像图'
    && assetBtns()[1].textContent === '清空肖像图' && facePill.children[1].disabled === true,
    JSON.stringify(assetBtns().map((b) => b.textContent)));
  const faceInput = assetRow().find((n) => n.tagName === 'INPUT');
  faceInput.files = [png('me.png')];
  faceInput.fire('change');
  await settle();
  await settle();
  const facePill2 = host.findAll((n) => n.classList.contains('fx-folia-tuning-pills'))
    .find((g) => g.getAttribute('data-folia-tuning-key') === 'portraitSource');
  ok('上传肖像：来源切 custom 并落盘、药丸解禁、背景槽不受影响',
    S.foliaModeTuning('monet').portraitSource === 'custom'
    && savedObj(store, MODE_KEY).monet.portraitSource === 'custom'
    && facePill2.children[1].disabled === false
    && S.foliaAssetCount('background') === 0,
    JSON.stringify({ source: S.foliaModeTuning('monet').portraitSource,
      bg: S.foliaAssetCount('background') }));

  assetBtns()[1].fire('click');
  await settle();
  await settle();
  ok('清空肖像：来源退回 cover 并落盘、池归零',
    S.foliaModeTuning('monet').portraitSource === 'cover'
    && savedObj(store, MODE_KEY).monet.portraitSource === 'cover'
    && S.foliaAssetCount('portrait') === 0,
    JSON.stringify({ source: S.foliaModeTuning('monet').portraitSource }));
}

/* =============================== 汇总 =============================== */
function foliaSmokeSummary() {
  const failed = out.filter((l) => l.startsWith('FAIL'));
  if (failed.length) {
    console.log('\n' + failed.length + ' 项 FAIL');
    process.exit(1);
  }
  console.log('\nALL PASS (' + out.length + ' 项)');
}

/* I9 段是异步的：等它跑完再汇总，别让上传还没落盘就打印 ALL PASS。 */
runImagePoolSection().then(foliaSmokeSummary, (e) => {
  ok('I9 段自身抛错', false, String((e && e.stack) || e));
  foliaSmokeSummary();
});
