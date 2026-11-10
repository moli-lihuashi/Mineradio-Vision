/* Folia 世界 — 调参面板（模式维度：绘光 lumiere；背景维度：隐现/空/通用）
 *
 * 源文件（Folia: src/components/visualizer/lumiere/）：
 *   LumiereSettingsPanel.tsx（178）→ 五组控件规格表 + 分段控件 + hint
 *   tuning.ts（11）              → settingsKey 'lumiereTuning' / 归一化适配器
 *   utils/lumiereTuning.ts（52） → normalizeLumiereTuning：钳制 / 回落 / 枚举校验
 *   stores/visualizerSettingsPersistence.ts:459 → LUMIERE_TUNING_STORAGE_KEY = 'lumiere_tuning'
 *   stores/useVisualizerSettingsStore.ts:517-529 → handleSetLumiereTuning / handleResetLumiereTuning
 *   i18n/locales/zh-CN.ts:2334-2378 → options.lumiere* 全部文案（逐字抄）
 * 背景面板源文件见「背景调参面板」段注释（LatentBackgroundSettingsCard 等）。
 *
 * 必须照抄的判据
 * --------------
 * 1. 五组的**分组顺序与组内顺序**就是面板的语义：光(4) → 氛围(4+3 开关) → 文字(开关+滑块, 邻行分段,
 *    5 项) → 主题(1+2 开关) → 性能(画质分段)。邻行是二选一的分段控件，夹在未唱字透明度与崩解强度之间，
 *    所以文字组拆成前后两段（TEXT_CONTROLS_LEAD / TEXT_CONTROLS_TAIL），不能把邻行挪到组尾图省事。
 * 2. 滑块区间与步长逐项照抄：默认 step 0.05，darkField / unlitOpacity / themeColorMix 为 0.01，
 *    fogOctaves 为 1 且**整数显示**（toFixed(0)），其余两位小数（toFixed(2)）。
 * 3. 归一化只有一套（normalizeLumiereTuning）：localStorage 读入、面板拖动、重置三处共用同一份钳制，
 *    数值钳区间、类型不对回落默认、fogOctaves 取整、windowNeighbors 只认 1|2、renderQuality 只认三档。
 * 4. 布尔开关用「开启 / 关闭」两粒药丸（options.lumiereToggleOn/Off），不是复选框。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 没有 React：规格表是普通数组，控件是 DOM 节点，重建面板 = 清空宿主再铺一遍。
 * 2. 草稿 / 提交语义：拖动时 `input` 事件只改内存（画面立刻跟手），`change` / `pointerup` 才落盘。
 *    Folia 的 handleSetLumiereTuning 每步都写 localStorage；这里合并成松手写一次，效果等价，
 *    少掉拖动期间几十次 JSON 序列化（onSliderPointerDown / onSliderCommit 在 Folia 侧就是干这个的）。
 * 3. tuning 对象是**不可变**的：每次修改换一个新对象，运行时靠 `tuning === options.tuning` 早退，
 *    原地改字段会让 setTuning 静默失效。
 */
'use strict';

var FOLIA_TUNING_STORE_KEY = 'mineradio-folia-tuning-v1';

/* types.ts:761 DEFAULT_LUMIERE_TUNING —— 23 项原值，逐字照抄。
 * （0k-folia-mode-lumiere-stage.js 里的那份是同一份常量；面板这份是「归一化基准」，两边必须一致。） */
var FOLIA_LUMIERE_TUNING_DEFAULT = {
  lightIntensity: 1,
  audioResponse: 1,
  fogDensity: 1,
  darkField: 0.75,
  moteAmount: 1,
  bloom: 1,
  textBloom: 1,
  unlitOpacity: 0.22,
  windowNeighbors: 2,
  decay: 1,
  echo: 1,
  fogOctaves: 5,
  lineArt: true,
  frontBokeh: true,
  trails: true,
  hideTrails: false,
  seamlessTransitions: true,
  overlayFrame: true,
  textOnly: false,
  keywordColors: true,
  themeIcons: true,
  themeColorMix: 0.3,
  renderQuality: 'full'
};

/* utils/lumiereTuning.ts 的钳制区间，逐项照抄（fogOctaves 另有 Math.round）。 */
var FOLIA_LUMIERE_RANGES = {
  lightIntensity: [0.3, 2],
  audioResponse: [0, 2],
  fogDensity: [0, 2],
  darkField: [0, 1],
  moteAmount: [0, 2],
  bloom: [0, 2],
  textBloom: [0, 2],
  unlitOpacity: [0.05, 0.6],
  decay: [0, 2],
  echo: [0, 2],
  fogOctaves: [2, 6],
  themeColorMix: [0, 1]
};

var FOLIA_LUMIERE_QUALITIES = ['full', 'balanced', 'low'];

/* 面板文案：zh-CN.ts:2334-2378 逐字抄（键名保留 Folia 的 options.* 原名，方便对照）。 */
var FOLIA_LUMIERE_TEXT = {
  settings: '绘光参数',
  settingsDesc: '调整绘光的体积光、烟雾、光学线稿与歌词被照亮的方式。',
  lightSection: '光',
  atmosphereSection: '氛围',
  textSection: '文字',
  themeSection: '主题',
  performanceSection: '性能',
  lightIntensity: '光强',
  audioResponse: '随音乐变亮',
  audioResponseHint: '0 = 光强不随音乐变化；数值越大，光束随音乐起伏越明显。',
  bloom: '图形辉光',
  textBloom: '文字辉光',
  darkField: '暗场强度',
  darkFieldHint: '暗场强度压暗光后面的共享背景，让光束像打在烟里的光；0 = 背景原样透出。浅色主题始终保留暗场。',
  fogDensity: '烟雾浓度',
  fogOctaves: '烟雾细节',
  moteAmount: '浮尘数量',
  frontBokeh: '前景散景',
  lineArt: '线稿',
  overlayFrame: '画框',
  unlitOpacity: '未唱字透明度',
  windowNeighbors: '邻行',
  windowNeighborsPrev: '上一行 + 当前行',
  windowNeighborsBoth: '上一行 + 当前行 + 下一行',
  decay: '崩解强度',
  echo: '背景歌词',
  echoHint: '背景歌词调到 0 即关闭光束里漂下的分词碎片。',
  textOnly: '仅显示歌词文字',
  textOnlyHint: '仅显示歌词文字：只画歌词和字上的点亮、光晕、闪点等效果，光源、烟雾、星空、线稿、浮尘、背景歌词、主题图标与画框都不画。字的明暗仍随（不可见的）光束变化。',
  trails: '所有换位都走轨迹线',
  hideTrails: '隐藏轨迹线',
  hideTrailsHint: '隐藏所有歌词换位的轨迹线，包括纵横交错和横竖切换。字仍沿原路径飞行，轨迹过渡照常生效。',
  seamlessTransitions: '轨迹过渡',
  seamlessTransitionsHint: '轨迹过渡：段落之间也像段内换镜头一样在同一束光里交接（光束摆到新角度、线稿擦除重描、字沿轨迹飞到新位置），不再熄灯、闪白或交叉渐变。「所有换位都走轨迹线」让字在每次换行时都沿曲线飞行；是否显示轨迹线由「隐藏轨迹线」决定。',
  themeColorMix: '主题色占比',
  themeColorMixHint: '主题色占比：0 是绘光原本的香槟金光；调高后光束、烟雾与线稿跟随主题强调色，点亮的字跟随主色，未唱的字跟随次色。',
  keywordColors: '关键字着色',
  themeIcons: '主题图标',
  renderQuality: '画质',
  renderQualityFull: '全分辨率',
  renderQualityBalanced: '均衡',
  renderQualityLow: '省电',
  renderQualityHint: '均衡 / 省电会降低光场与辉光的分辨率并限制烟雾细节，画面略软但更省电。',
  toggleOn: '开启',
  toggleOff: '关闭',
  reset: '重置参数',
  resetToast: '绘光参数已重置'
};

/* 控件规格表：LumiereSettingsPanel.tsx:23-58 逐行照抄。
 * kind='slider' → { key, label, min, max, step?, integer? }；kind='toggle' → { key, label }。 */
var FOLIA_LUMIERE_LIGHT_CONTROLS = [
  { kind: 'slider', key: 'lightIntensity', label: FOLIA_LUMIERE_TEXT.lightIntensity, min: 0.3, max: 2 },
  { kind: 'slider', key: 'audioResponse', label: FOLIA_LUMIERE_TEXT.audioResponse, min: 0, max: 2 },
  { kind: 'slider', key: 'bloom', label: FOLIA_LUMIERE_TEXT.bloom, min: 0, max: 2 },
  { kind: 'slider', key: 'textBloom', label: FOLIA_LUMIERE_TEXT.textBloom, min: 0, max: 2 }
];

var FOLIA_LUMIERE_ATMOSPHERE_CONTROLS = [
  { kind: 'slider', key: 'darkField', label: FOLIA_LUMIERE_TEXT.darkField, min: 0, max: 1, step: 0.01 },
  { kind: 'slider', key: 'fogDensity', label: FOLIA_LUMIERE_TEXT.fogDensity, min: 0, max: 2 },
  { kind: 'slider', key: 'fogOctaves', label: FOLIA_LUMIERE_TEXT.fogOctaves, min: 2, max: 6, step: 1, integer: true },
  { kind: 'slider', key: 'moteAmount', label: FOLIA_LUMIERE_TEXT.moteAmount, min: 0, max: 2 },
  { kind: 'toggle', key: 'frontBokeh', label: FOLIA_LUMIERE_TEXT.frontBokeh },
  { kind: 'toggle', key: 'lineArt', label: FOLIA_LUMIERE_TEXT.lineArt },
  { kind: 'toggle', key: 'overlayFrame', label: FOLIA_LUMIERE_TEXT.overlayFrame }
];

var FOLIA_LUMIERE_TEXT_CONTROLS_LEAD = [
  { kind: 'toggle', key: 'textOnly', label: FOLIA_LUMIERE_TEXT.textOnly },
  { kind: 'slider', key: 'unlitOpacity', label: FOLIA_LUMIERE_TEXT.unlitOpacity, min: 0.05, max: 0.6, step: 0.01 }
];

var FOLIA_LUMIERE_TEXT_CONTROLS_TAIL = [
  { kind: 'slider', key: 'decay', label: FOLIA_LUMIERE_TEXT.decay, min: 0, max: 2 },
  { kind: 'slider', key: 'echo', label: FOLIA_LUMIERE_TEXT.echo, min: 0, max: 2 },
  { kind: 'toggle', key: 'trails', label: FOLIA_LUMIERE_TEXT.trails },
  { kind: 'toggle', key: 'hideTrails', label: FOLIA_LUMIERE_TEXT.hideTrails },
  { kind: 'toggle', key: 'seamlessTransitions', label: FOLIA_LUMIERE_TEXT.seamlessTransitions }
];

var FOLIA_LUMIERE_THEME_CONTROLS = [
  { kind: 'slider', key: 'themeColorMix', label: FOLIA_LUMIERE_TEXT.themeColorMix, min: 0, max: 1, step: 0.01 },
  { kind: 'toggle', key: 'keywordColors', label: FOLIA_LUMIERE_TEXT.keywordColors },
  { kind: 'toggle', key: 'themeIcons', label: FOLIA_LUMIERE_TEXT.themeIcons }
];

/* ---------------- 归一化（utils/lumiereTuning.ts 逐条照抄） ---------------- */

function foliaLumiereClampNumber(value, fallback, min, max) {
  return (typeof value === 'number' && isFinite(value))
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function foliaLumierePickBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/* 把任意输入收敛成合法 tuning：数值钳区间、缺失或类型不对回落默认、fogOctaves 取整、
 * windowNeighbors 只认 1|2、renderQuality 只认三档。输入不是对象时等价于「全默认」。 */
function foliaLumiereNormalize(value) {
  var raw = (value && typeof value === 'object') ? value : {};
  var d = FOLIA_LUMIERE_TUNING_DEFAULT;
  var fogOctaves = foliaLumiereClampNumber(raw.fogOctaves, d.fogOctaves, 2, 6);
  return {
    lightIntensity: foliaLumiereClampNumber(raw.lightIntensity, d.lightIntensity, 0.3, 2),
    audioResponse: foliaLumiereClampNumber(raw.audioResponse, d.audioResponse, 0, 2),
    fogDensity: foliaLumiereClampNumber(raw.fogDensity, d.fogDensity, 0, 2),
    darkField: foliaLumiereClampNumber(raw.darkField, d.darkField, 0, 1),
    moteAmount: foliaLumiereClampNumber(raw.moteAmount, d.moteAmount, 0, 2),
    bloom: foliaLumiereClampNumber(raw.bloom, d.bloom, 0, 2),
    textBloom: foliaLumiereClampNumber(raw.textBloom, d.textBloom, 0, 2),
    unlitOpacity: foliaLumiereClampNumber(raw.unlitOpacity, d.unlitOpacity, 0.05, 0.6),
    windowNeighbors: (raw.windowNeighbors === 1 || raw.windowNeighbors === 2) ? raw.windowNeighbors : d.windowNeighbors,
    decay: foliaLumiereClampNumber(raw.decay, d.decay, 0, 2),
    echo: foliaLumiereClampNumber(raw.echo, d.echo, 0, 2),
    fogOctaves: Math.round(fogOctaves),
    lineArt: foliaLumierePickBoolean(raw.lineArt, d.lineArt),
    frontBokeh: foliaLumierePickBoolean(raw.frontBokeh, d.frontBokeh),
    trails: foliaLumierePickBoolean(raw.trails, d.trails),
    hideTrails: foliaLumierePickBoolean(raw.hideTrails, d.hideTrails),
    seamlessTransitions: foliaLumierePickBoolean(raw.seamlessTransitions, d.seamlessTransitions),
    overlayFrame: foliaLumierePickBoolean(raw.overlayFrame, d.overlayFrame),
    textOnly: foliaLumierePickBoolean(raw.textOnly, d.textOnly),
    keywordColors: foliaLumierePickBoolean(raw.keywordColors, d.keywordColors),
    themeIcons: foliaLumierePickBoolean(raw.themeIcons, d.themeIcons),
    themeColorMix: foliaLumiereClampNumber(raw.themeColorMix, d.themeColorMix, 0, 1),
    renderQuality: FOLIA_LUMIERE_QUALITIES.indexOf(raw.renderQuality) >= 0 ? raw.renderQuality : d.renderQuality
  };
}

/* ---------------- 状态与持久化 ---------------- */

/* 缓存的是「当前生效的那一份」：运行时靠对象身份判断要不要重新应用，
 * 所以每次修改必须换新对象（原地改字段会让 setTuning 静默早退）。 */
var foliaLumiereTuningCache = null;

function foliaLumiereReadAll() {
  try {
    var all = JSON.parse(localStorage.getItem(FOLIA_TUNING_STORE_KEY) || '{}');
    return (all && typeof all === 'object') ? all : {};
  } catch (_) {
    return {};
  }
}

function foliaLumiereTuning() {
  if (!foliaLumiereTuningCache) {
    foliaLumiereTuningCache = foliaLumiereNormalize(foliaLumiereReadAll().lumiere);
  }
  return foliaLumiereTuningCache;
}

function foliaLumiereCopyTuning(base) {
  var out = {};
  var k;
  for (k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  }
  return out;
}

/* 改一项（或一组）：合并后整份再过一遍归一化 —— 拖动、重置、外部写入都走这条路径。 */
function foliaSetLumiereTuning(patch) {
  var merged = foliaLumiereCopyTuning(foliaLumiereTuning());
  if (patch) {
    var k;
    for (k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
    }
  }
  foliaLumiereTuningCache = foliaLumiereNormalize(merged);
  return foliaLumiereTuningCache;
}

function foliaSaveLumiereTuning() {
  try {
    var all = foliaLumiereReadAll();
    all.lumiere = foliaLumiereTuning();
    localStorage.setItem(FOLIA_TUNING_STORE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function foliaResetLumiereTuning() {
  foliaLumiereTuningCache = foliaLumiereNormalize(FOLIA_LUMIERE_TUNING_DEFAULT);
  foliaSaveLumiereTuning();
  foliaRefreshTuningPanel();
  if (typeof showToast === 'function') showToast(FOLIA_LUMIERE_TEXT.resetToast);
}

/* ---------------- 面板构建 ---------------- */

function foliaTuningEl(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function foliaTuningPatch(key, value) {
  var patch = {};
  patch[key] = value;
  return patch;
}

/* 数值显示（LumiereSettingsPanel.tsx:60-61 + LatentBackgroundSettingsCard 的 SliderRow 默认值）：
 * integer → toFixed(0)（绘光的烟雾细节）；one → toFixed(1)（隐现滑块的 Folia 默认格式）；
 * percent → Math.round(v*100)%（0~1 的强度）；pct → Math.round(v)%（本身就是百分数的值，
 * 如莫奈的水平偏移 -40~40）；px → Math.round(v)px（模糊像素）；times → toFixed(2)x
 * （流光/回环的倍率，spec.offset 先加再格式化，回环的放大倍率显示的是 v+1）；
 * deg → Math.round(v)°（回环的轨道倾斜度）；spacing → 带正负号的 toFixed(1)px
 * （回环的字符间距，Folia 是 `+0.5px` / `-1.0px`）；signPercent → 带正号的
 * Math.round(v*100)%（时计的轮盘水平位置，Folia 是 `+20%`，0 读作 `0%`）；
 * times1 → toFixed(1)x（时计的擒纵咬合力度，Folia 是 `2.0x`）；其余 toFixed(2)（绘光默认）。 */
function foliaTuningFormatValue(spec, value) {
  var n = Number(value);
  if (!isFinite(n)) n = 0;
  var format = spec && spec.format;
  if ((spec && spec.integer) || format === 'integer') return String(Math.round(n));
  if (format === 'one') return n.toFixed(1);
  if (format === 'percent') return Math.round(n * 100) + '%';
  if (format === 'signPercent') return (n > 0 ? '+' : '') + Math.round(n * 100) + '%';
  if (format === 'pct') return Math.round(n) + '%';
  if (format === 'px') return Math.round(n) + 'px';
  if (format === 'times') return (n + (Number(spec.offset) || 0)).toFixed(2) + 'x';
  if (format === 'times1') return n.toFixed(1) + 'x';
  if (format === 'deg') return Math.round(n) + '°';
  if (format === 'spacing') return (n > 0 ? '+' : '') + n.toFixed(1) + 'px';
  return n.toFixed(2);
}

/* 旧名别名：绘光冒烟（smoke-folia-tuning-logic.js）直接引用。 */
function foliaLumiereFormatValue(spec, value) {
  return foliaTuningFormatValue(spec, value);
}

/* disabledWhen：{ key, equals } —— 读当前 tuning 的另一项，相等即禁用（隐现的叠色透明度联动）。 */
function foliaTuningResolveDisabled(spec, binding) {
  if (!spec || !spec.disabledWhen) return false;
  var tuning = binding.get();
  return tuning[spec.disabledWhen.key] === spec.disabledWhen.equals;
}

/* ---- binding 约定 ----
 * get() → 当前 tuning（归一化后的只读快照）
 * set(patch) → 合并 + 归一化，返回新 tuning（对象不可变，运行时靠身份早退）
 * commit() → 松手/点选后落盘；rebuild=true 的背景面板再 foliaWorldRebuildBackground
 *             （latent/sora/common 的 tuning 都在创建背景时读一次，见各自文件的差异注释）
 * 绘光运行时按对象身份就地生效，不重建（rebuild: false）。 */

function foliaBuildTuningSlider(spec, binding) {
  var tuning = binding.get();
  var row = foliaTuningEl('div', 'fx-folia-tuning-row');
  var head = foliaTuningEl('div', 'fx-folia-tuning-head');
  var label = foliaTuningEl('span', 'fx-folia-tuning-label', spec.label);
  var value = foliaTuningEl('span', 'fx-folia-tuning-value', foliaTuningFormatValue(spec, tuning[spec.key]));
  head.appendChild(label);
  head.appendChild(value);

  var input = document.createElement('input');
  input.type = 'range';
  input.className = 'fx-folia-tuning-range';
  input.setAttribute('data-folia-tuning-key', spec.key);
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step == null ? 0.05 : spec.step);
  input.value = String(tuning[spec.key]);

  /* 蓝色进度填充：与主面板的 --prism-fill 同一套做法，变量名分开（--folia-fill），
   * 不依赖 06-fx 的全局同步器 —— 它只监听 .fx-slider，且面板重建后没人补 sync。
   * builder 里每次建好就同步一次，拖动时跟着 input 走。 */
  var syncFill = function () {
    var min = Number(input.min);
    var max = Number(input.max);
    var v = Number(input.value);
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 100;
    if (!isFinite(v)) v = min;
    var pct = max === min ? 0 : ((v - min) / (max - min)) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    input.style.setProperty('--folia-fill', pct.toFixed(3) + '%');
  };
  syncFill();

  /* 拖动只改内存（画面立刻跟手），松手 commit（落盘，背景面板再重建实例）。 */
  input.addEventListener('input', function () {
    var raw = Number(input.value);
    var next = binding.set(foliaTuningPatch(spec.key, raw));
    value.textContent = foliaTuningFormatValue(spec, next[spec.key]);
    syncFill();
  });
  input.addEventListener('change', function () { binding.commit(); });
  input.addEventListener('pointerup', function () { binding.commit(); });

  if (foliaTuningResolveDisabled(spec, binding)) {
    input.disabled = true;
    row.classList.add('is-disabled');
  }

  /* disabledAlways：整组开关关着时**恒**禁用（镜台的「点云几何 / 背景粒子」两组：
   * Folia 是 `disabled={!enabled}` + `disabled:opacity-35`，与 disabledWhen 的联动是两条来源）。 */
  if (spec.disabledAlways) {
    input.disabled = true;
    row.classList.add('is-disabled');
  }

  row.appendChild(head);
  row.appendChild(input);
  return row;
}

/* 药丸按钮组（VisualizerPresetGroup）：选中项读 accentColor 描边 + 底色。
 * option.disabled：单项禁用（漫游的「自定义图片」在没有上传图时不可选，Folia 同款）；
 * opts.refresh：点击后整面板重建（换效果要换掉下半组控件）。 */
function foliaBuildTuningPills(labelText, options, key, binding, opts) {
  var row = foliaTuningEl('div', 'fx-folia-tuning-row');
  var head = foliaTuningEl('div', 'fx-folia-tuning-head');
  head.appendChild(foliaTuningEl('span', 'fx-folia-tuning-label', labelText));
  var group = foliaTuningEl('div', 'fx-folia-tuning-pills');
  group.setAttribute('data-folia-tuning-key', key);
  /* 布尔开关对（true/false 两值，文案是 开启/关闭、启用/关闭、显示/隐藏…）：
   * 走分段容器样式（is-toggle），与普通多选 chips 区分开。 */
  if (options.length === 2
    && typeof options[0].value === 'boolean'
    && typeof options[1].value === 'boolean') {
    group.classList.add('is-toggle');
  }

  var buttons = [];
  var paint = function (value) {
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var active = b.__foliaValue === value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };
  for (var i = 0; i < options.length; i++) {
    (function (option) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fx-folia-tuning-pill';
      btn.textContent = option.label;
      btn.__foliaValue = option.value;
      if (option.disabled) btn.disabled = true;
      btn.addEventListener('click', function () {
        if (option.disabled) return;
        binding.set(foliaTuningPatch(key, option.value));
        paint(option.value);
        binding.commit();
        if (opts && opts.refresh) foliaRefreshTuningPanel();
      });
      buttons.push(btn);
      group.appendChild(btn);
    })(options[i]);
  }
  paint(binding.get()[key]);

  row.appendChild(head);
  row.appendChild(group);
  return row;
}

/* 开关行（BackgroundToggleRow.tsx 逐条照抄）：label+描述在左、圆形滑钮在右。
 * 点击后整面板重建一次 —— 既刷新 aria-pressed，也让 disabledWhen 联动重新求值。 */
function foliaBuildSwitchRow(spec, binding) {
  var row = foliaTuningEl('div', 'fx-folia-tuning-switch-row');
  var text = foliaTuningEl('div', 'fx-folia-tuning-switch-text');
  text.appendChild(foliaTuningEl('div', 'fx-folia-tuning-switch-label', spec.label));
  if (spec.desc) text.appendChild(foliaTuningEl('div', 'fx-folia-tuning-switch-desc', spec.desc));

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-folia-tuning-switch';
  btn.setAttribute('data-folia-tuning-key', spec.key);
  var knob = foliaTuningEl('span', 'fx-folia-tuning-switch-knob');
  btn.appendChild(knob);

  var paint = function (checked) {
    btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
    btn.classList.toggle('is-on', checked);
  };
  paint(binding.get()[spec.key]);
  btn.addEventListener('click', function () {
    var next = !binding.get()[spec.key];
    binding.set(foliaTuningPatch(spec.key, next));
    binding.commit();
    foliaRefreshTuningPanel();
  });

  row.appendChild(text);
  row.appendChild(btn);
  return row;
}

function foliaLumiereToggleOptions() {
  return [
    { value: true, label: FOLIA_LUMIERE_TEXT.toggleOn },
    { value: false, label: FOLIA_LUMIERE_TEXT.toggleOff }
  ];
}

/* 颜色行（莫奈的自定义水洗色）：Folia 用 react-colorful 的 HexColorPicker，
 * 这里用原生 <input type="color"> 等价替代——同一份 hex 值，拖动只改内存、松手 commit。 */
function foliaBuildTuningColor(spec, binding) {
  var tuning = binding.get();
  var row = foliaTuningEl('div', 'fx-folia-tuning-color-row');
  row.appendChild(foliaTuningEl('span', 'fx-folia-tuning-color-label', spec.label));

  var controls = foliaTuningEl('div', 'fx-folia-tuning-color-controls');
  var hex = foliaTuningEl('span', 'fx-folia-tuning-color-hex',
    String((tuning && tuning[spec.key]) || '').toUpperCase());
  var input = document.createElement('input');
  input.type = 'color';
  input.className = 'fx-folia-tuning-color-input';
  input.setAttribute('data-folia-tuning-key', spec.key);
  input.value = String((tuning && tuning[spec.key]) || '#000000');

  input.addEventListener('input', function () {
    var next = binding.set(foliaTuningPatch(spec.key, input.value));
    hex.textContent = String((next && next[spec.key]) || input.value).toUpperCase();
  });
  input.addEventListener('change', function () { binding.commit(); });

  controls.appendChild(hex);
  controls.appendChild(input);
  row.appendChild(controls);
  return row;
}

function foliaBuildTuningControl(spec, binding) {
  if (spec.kind === 'slider') return foliaBuildTuningSlider(spec, binding);
  if (spec.kind === 'switch') return foliaBuildSwitchRow(spec, binding);
  if (spec.kind === 'color') return foliaBuildTuningColor(spec, binding);
  if (spec.kind === 'pills') {
    return foliaBuildTuningPills(spec.label, spec.options, spec.key, binding, { refresh: spec.refreshPanel === true });
  }
  return foliaBuildTuningPills(spec.label, foliaLumiereToggleOptions(), spec.key, binding);
}

function foliaBuildTuningSection(title, controls, binding, hints) {
  var section = foliaTuningEl('div', 'fx-folia-tuning-section');
  section.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', title));
  for (var i = 0; i < controls.length; i++) section.appendChild(foliaBuildTuningControl(controls[i], binding));
  if (hints) {
    for (var h = 0; h < hints.length; h++) {
      section.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', hints[h]));
    }
  }
  return section;
}

/* 子框分组（LatentBackgroundSettingsCard.tsx:177/200 的 rounded-2xl border p-3）。 */
function foliaBuildTuningGroup(title, children) {
  var group = foliaTuningEl('div', 'fx-folia-tuning-group');
  if (title) group.appendChild(foliaTuningEl('div', 'fx-folia-tuning-group-title', title));
  for (var i = 0; i < children.length; i++) group.appendChild(children[i]);
  return group;
}

/* 双面板时的第二块标题（背景面板占折叠标题行，模式面板退到面板内标题）。 */
function foliaBuildPanelIntro(title, desc) {
  var intro = foliaTuningEl('div', 'fx-folia-tuning-intro');
  intro.appendChild(foliaTuningEl('div', 'fx-folia-tuning-intro-title', title));
  if (desc) intro.appendChild(foliaTuningEl('div', 'fx-folia-tuning-intro-sub', desc));
  return intro;
}

function foliaTuningDivider() {
  return foliaTuningEl('div', 'fx-folia-tuning-divider');
}

/* 标题与说明写在折叠标题行（#fx-folia-tuning-title / -sub）：合上时也能读到「这组参数是什么」，
 * 展开后直接进分组，不再在面板里多一层标题块。双面板时后一块改用面板内标题（foliaBuildPanelIntro）。 */
function foliaSetTuningFoldHeader(title, desc) {
  var titleEl = document.getElementById('fx-folia-tuning-title');
  if (titleEl) titleEl.textContent = title;
  var subEl = document.getElementById('fx-folia-tuning-sub');
  if (subEl) subEl.textContent = desc;
}

/* ---------------- 自定义图上传行（莫奈背景 / 漫游 / 莫奈肖像共用） ----------------
 *
 * 源文件（Folia）：
 *   MonetBackgroundSettingsCard.tsx:208-300 → 「上传背景图 / 清空背景图 / 文件名」
 *   NomandBackgroundSettingsCard.tsx:52-129 → 同一套按钮，成功后多一句「背景图片上传成功」
 *   MonetSettingsPanel.tsx:200-330        → 「上传肖像图 / 清空肖像图 / 文件名」
 *   落盘与回退语义：useVisualizerSettingsStore.ts:681-748
 *
 * 判据：上传成功 → 反馈行显示文件名（漫游显示成功文案）+ 把来源切到「自定义」；
 * 清空 → 来源退回「封面」并且反馈行回到 `-`；失败只改反馈行，不落盘、不动来源。
 * 按钮的 disabled 也照抄：上传中禁用上传；没有图时禁用清空。
 */
/* 反馈按 **作用域** 分桶（不是按资产键）：莫奈背景与漫游共用 background 槽，
 * 若按 key 存，漫游那句「背景图片上传成功」会跟着串到莫奈背景面板上。
 * Folia 那边是各组件自己的 useState，切面板自然复位。 */
var foliaAssetFeedback = Object.create(null);

function foliaAssetFeedbackScope(key, opts) {
  return (opts && opts.scope) || key;
}

function foliaAssetToast(text) {
  if (!text) return;
  if (typeof showToast === 'function') { try { showToast(text); } catch (_) {} }
}

function foliaBuildAssetUploadRow(key, opts) {
  var options = opts || {};
  var uploadLabels = options.uploadLabel || '上传图片';
  var clearLabels = options.clearLabel || '清空图片';
  var entry = window.foliaAssetGet ? window.foliaAssetGet(key) : null;
  var hasAsset = Array.isArray(entry) ? entry.length > 0 : !!entry;

  var scope = foliaAssetFeedbackScope(key, options);
  var entryName = (entry && !Array.isArray(entry)) ? String(entry.name || '') : '';
  var entryUrl = (entry && !Array.isArray(entry) && entry.url) ? String(entry.url) : '';

  /* 布局：头行只留标签（与药丸组同款），控件本体是一整条「文件字段」——
   * 缩略图 + 文件名 + 两粒药丸收进同一个圆角框。上一版把缩略图塞进头行、
   * 药丸散在下一行左边、右半条全空，看上去不像一个控件。 */
  var row = foliaTuningEl('div', 'fx-folia-tuning-row fx-folia-asset');
  row.setAttribute('data-folia-asset-key', key);
  row.setAttribute('data-folia-asset-scope', scope);

  var head = foliaTuningEl('div', 'fx-folia-tuning-head');
  head.appendChild(foliaTuningEl('span', 'fx-folia-tuning-label', options.label || '图片文件'));

  var field = foliaTuningEl('div', 'fx-folia-asset-field');

  /* 缩略图槽位恒在：有图是 blob: 缩略图，无图是虚线「+」占位（提示「点上传添加」）。 */
  var thumb;
  if (entryUrl) {
    thumb = document.createElement('img');
    thumb.className = 'fx-folia-asset-thumb';
    thumb.src = entryUrl;
    thumb.alt = '';
  } else {
    thumb = foliaTuningEl('div', 'fx-folia-asset-thumb is-empty');
  }
  thumb.setAttribute('data-folia-asset-thumb', key);
  field.appendChild(thumb);

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = window.foliaAssetAccept || 'image/*';
  input.className = 'fx-folia-asset-input';
  input.setAttribute('data-folia-asset-input', key);

  var upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'fx-folia-tuning-pill fx-folia-asset-btn is-primary';
  upload.textContent = uploadLabels;
  upload.setAttribute('data-folia-asset-upload', key);

  var clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'fx-folia-tuning-pill fx-folia-asset-btn';
  clear.textContent = clearLabels;
  clear.setAttribute('data-folia-asset-clear', key);
  clear.disabled = !hasAsset;

  /* 占位文案不用 Folia 那个裸 '-'（在面板里像渲染坏了），本地化成「未选择」并压暗一档。 */
  var nameText = foliaAssetFeedback[scope] || entryName || '未选择';
  var isEmptyName = nameText === '未选择';
  var name = foliaTuningEl('span', 'fx-folia-asset-name' + (isEmptyName ? ' is-empty' : ''), nameText);
  name.setAttribute('data-folia-asset-name', key);
  name.title = isEmptyName ? '' : nameText;
  field.appendChild(name);

  upload.addEventListener('click', function () {
    try { input.click(); } catch (_) {}
  });

  input.addEventListener('change', function () {
    var files = input.files ? Array.prototype.slice.call(input.files) : [];
    input.value = '';
    foliaAssetFeedback[scope] = '';
    if (!files.length || !window.foliaAssetPutFile) return;
    upload.disabled = true;
    window.foliaAssetPutFile(key, files[0]).then(function (result) {
      upload.disabled = false;
      if (result && result.ok) {
        /* 反馈行：漫游显示成功文案，其余显示文件名（与三张卡片的 setFeedback 一一对应）。 */
        var text = options.successText || (files[0] && files[0].name) || '';
        foliaAssetFeedback[scope] = text;
        if (typeof options.onUploaded === 'function') options.onUploaded(result, text);
        foliaAssetToast(options.successToast);
      } else {
        var message = (result && result.error) || options.failedText || '';
        foliaAssetFeedback[scope] = message;
        if (typeof options.onFailed === 'function') options.onFailed(message);
      }
      foliaRefreshTuningPanel();
    });
  });

  clear.addEventListener('click', function () {
    if (!window.foliaAssetClear) return;
    clear.disabled = true;
    window.foliaAssetClear(key).then(function () {
      foliaAssetFeedback[scope] = '';
      if (typeof options.onCleared === 'function') options.onCleared();
      foliaAssetToast(options.clearToast);
      foliaRefreshTuningPanel();
    });
  });

  field.appendChild(upload);
  field.appendChild(clear);
  row.appendChild(head);
  row.appendChild(field);
  row.appendChild(input);
  return row;
}

/* ---------------- 绘光（lumiere）面板 ---------------- */

var FOLIA_LUMIERE_BINDING = {
  rebuild: false,
  get: function () { return foliaLumiereTuning(); },
  set: function (patch) { return foliaSetLumiereTuning(patch); },
  commit: function () { foliaSaveLumiereTuning(); }
};

function foliaBuildLumiereControl(spec) {
  return foliaBuildTuningControl(spec, FOLIA_LUMIERE_BINDING);
}

function foliaBuildLumiereSection(title, controls, hints) {
  return foliaBuildTuningSection(title, controls, FOLIA_LUMIERE_BINDING, hints);
}

/* 邻行 / 画质都是分段控件，选项文案来自 zh-CN（options.lumiereWindowNeighbors* / RenderQuality*）。 */
function foliaBuildLumiereNeighborRow() {
  return foliaBuildTuningPills(FOLIA_LUMIERE_TEXT.windowNeighbors, [
    { value: 1, label: FOLIA_LUMIERE_TEXT.windowNeighborsPrev },
    { value: 2, label: FOLIA_LUMIERE_TEXT.windowNeighborsBoth }
  ], 'windowNeighbors', FOLIA_LUMIERE_BINDING);
}

function foliaBuildLumiereQualityRow() {
  return foliaBuildTuningPills(FOLIA_LUMIERE_TEXT.renderQuality, [
    { value: 'full', label: FOLIA_LUMIERE_TEXT.renderQualityFull },
    { value: 'balanced', label: FOLIA_LUMIERE_TEXT.renderQualityBalanced },
    { value: 'low', label: FOLIA_LUMIERE_TEXT.renderQualityLow }
  ], 'renderQuality', FOLIA_LUMIERE_BINDING);
}

function foliaBuildLumierePanel(host, opts) {
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_LUMIERE_TEXT.settings, FOLIA_LUMIERE_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_LUMIERE_TEXT.settings, FOLIA_LUMIERE_TEXT.settingsDesc));
  }

  host.appendChild(foliaBuildLumiereSection(FOLIA_LUMIERE_TEXT.lightSection, FOLIA_LUMIERE_LIGHT_CONTROLS, [
    FOLIA_LUMIERE_TEXT.audioResponseHint
  ]));

  host.appendChild(foliaBuildLumiereSection(FOLIA_LUMIERE_TEXT.atmosphereSection, FOLIA_LUMIERE_ATMOSPHERE_CONTROLS, [
    FOLIA_LUMIERE_TEXT.darkFieldHint
  ]));

  /* 文字组：前段（仅文字 / 未唱字透明度）→ 邻行分段 → 后段 → 四条 hint。 */
  var text = foliaTuningEl('div', 'fx-folia-tuning-section');
  text.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', FOLIA_LUMIERE_TEXT.textSection));
  for (var i = 0; i < FOLIA_LUMIERE_TEXT_CONTROLS_LEAD.length; i++) {
    text.appendChild(foliaBuildLumiereControl(FOLIA_LUMIERE_TEXT_CONTROLS_LEAD[i]));
  }
  text.appendChild(foliaBuildLumiereNeighborRow());
  for (var j = 0; j < FOLIA_LUMIERE_TEXT_CONTROLS_TAIL.length; j++) {
    text.appendChild(foliaBuildLumiereControl(FOLIA_LUMIERE_TEXT_CONTROLS_TAIL[j]));
  }
  var textHints = [
    FOLIA_LUMIERE_TEXT.textOnlyHint,
    FOLIA_LUMIERE_TEXT.echoHint,
    FOLIA_LUMIERE_TEXT.hideTrailsHint,
    FOLIA_LUMIERE_TEXT.seamlessTransitionsHint
  ];
  for (var k = 0; k < textHints.length; k++) {
    text.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', textHints[k]));
  }
  host.appendChild(text);

  host.appendChild(foliaBuildLumiereSection(FOLIA_LUMIERE_TEXT.themeSection, FOLIA_LUMIERE_THEME_CONTROLS, [
    FOLIA_LUMIERE_TEXT.themeColorMixHint
  ]));

  var perf = foliaTuningEl('div', 'fx-folia-tuning-section');
  perf.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', FOLIA_LUMIERE_TEXT.performanceSection));
  perf.appendChild(foliaBuildLumiereQualityRow());
  perf.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint', FOLIA_LUMIERE_TEXT.renderQualityHint));
  host.appendChild(perf);

  var footer = foliaTuningEl('div', 'fx-folia-tuning-footer');
  var reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'fx-folia-tuning-reset';
  /* 只有绘光面板有 footer（Folia 的背景卡片不带重置），id 保持旧名以兼容冒烟。 */
  reset.id = 'fx-folia-tuning-reset';
  reset.textContent = FOLIA_LUMIERE_TEXT.reset;
  reset.addEventListener('click', function () { foliaResetLumiereTuning(); });
  footer.appendChild(reset);
  host.appendChild(footer);
}

/* ================= 背景调参面板（latent / sora / common）=================
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/）：
 *   latent/LatentBackgroundSettingsCard.tsx（288）→ 两分段 + 两开关 + 叠色子框 + 像素/流体两组滑块
 *   sora/SoraBackgroundSettingsCard.tsx（46）     → 一个「完全空白」开关
 *   common/CommonBackgroundSettingsCard.tsx（81） → 两开关（useCoverColorBg/opacity 依赖未移植的
 *                                                   FluidBackground，本轮不做）
 *   i18n/locales/zh-CN.ts:1946/1967/2597-2620/2733 → 文案逐字（键名保留 options.* 原名）
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. Folia 的背景卡片**没有重置按钮**（resetSettings 走全局设置），这里同样不给 footer；
 *    绘光面板的 footer 是 Folia 自带的（LumiereSettingsPanel）。
 * 2. 开关行照抄 BackgroundToggleRow：label+描述在左、圆形滑钮在右。绘光面板的
 *    「开启/关闭」药丸是 LumiereSettingsPanel 自己的控件，两款并存、各归各的源。
 * 3. latent/sora/common 的 tuning 都在**创建背景时读一次**（见各自文件的差异注释），
 *    所以每次 commit 落盘后 foliaWorldRebuildBackground 整实例重建；
 *    Folia 由 React 重渲染把新 config 实时下发，视觉结果一致。
 * 4. 叠色透明度的 disabled 联动：Folia 靠重渲染求值，这里点开关后整面板重建
 *    （foliaRefreshTuningPanel，见 foliaBuildSwitchRow）。
 */

var FOLIA_LATENT_TEXT = {
  settings: '隐现背景',
  settingsDesc: '叠加封面取色的像素与流体着色器，并使用大范围音频速度响应。',
  displayMode: '显示图层',
  displayDithering: '像素',
  displayMesh: '流体',
  displayBoth: '混合',
  colorSource: '颜色来源',
  colorSourceCoverTheme: '封面与主题',
  colorSourceCoverOnly: '仅封面取色',
  dynamicOnlyInPlayer: '仅在播放页启用动态效果',
  dynamicOnlyInPlayerDesc: '在主页保持隐现背景静止，以降低 GPU 资源占用。',
  enhancedBeatResponse: '增强节拍响应',
  enhancedBeatResponseDesc: '让像素和流体速度在宽频能量上升沿产生更明显的节拍脉冲。',
  overlay: '可读性叠色',
  overlayDesc: '在图片效果前叠加当前主题背景色，提升歌词可读性。',
  overlayOpacity: '叠色透明度',
  ditheringGroup: '像素背景',
  meshGroup: '流体背景',
  baseSpeed: '基础速度',
  audioSpeed: '音频响应最大速度',
  ditheringSize: '像素尺寸',
  ditheringOpacity: '像素层透明度',
  meshDistortion: '流体扭曲',
  meshSwirl: '流体旋涡'
};

var FOLIA_SORA_TEXT = {
  /* Folia 的 sora 卡片没有标题（SoraBackgroundSettingsCard 只有一行开关），
   * 折叠标题行是本项目补的，写法沿用「背景名 + 参数」。 */
  settings: '空背景参数',
  settingsDesc: '「空」背景的可调项。',
  blank: '完全空白',
  blankDesc: '不再渲染 WebGL 星空，只显示静态纯色画面：夜间纯黑，日间纯白。适合搭配视频层使用。'
};

var FOLIA_COMMON_TEXT = {
  settings: '通用背景参数',
  settingsDesc: '通用背景（纯色底 / 几何层 / 暗角）的可调项。',
  disableVignette: '禁用暗角',
  disableVignetteDesc: '关闭几何背景自带的边缘暗角，建议配合透明背景使用。',
  disableGeometric: '隐藏通用几何背景',
  disableGeometricDesc: '隐藏播放页的通用几何背景图形。'
};

function foliaLatentBinding() {
  return {
    rebuild: true,
    get: function () { return window.foliaLatentTuning(); },
    set: function (patch) { return window.foliaLatentSetTuning(patch); },
    commit: function () {
      window.foliaLatentSaveTuning();
      foliaRebuildTuningBackground();
    }
  };
}

function foliaSoraBinding() {
  return {
    rebuild: true,
    get: function () { return window.foliaSoraTuning(); },
    set: function (patch) { return window.foliaSoraSetTuning(patch); },
    commit: function () {
      window.foliaSoraSaveTuning();
      foliaRebuildTuningBackground();
    }
  };
}

function foliaCommonBinding() {
  return {
    rebuild: true,
    get: function () { return window.foliaCommonTuning(); },
    set: function (patch) { return window.foliaCommonSetTuning(patch); },
    commit: function () {
      window.foliaCommonSaveTuning();
      foliaRebuildTuningBackground();
    }
  };
}

/* 背景实例重建：03-folia-world-runtime.js 提供；harness 里没加载 03 时静默跳过。 */
function foliaRebuildTuningBackground() {
  if (typeof foliaWorldRebuildBackground === 'function') foliaWorldRebuildBackground();
}

function foliaBuildLatentPanel(host, opts) {
  var binding = foliaLatentBinding();
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_LATENT_TEXT.settings, FOLIA_LATENT_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_LATENT_TEXT.settings, FOLIA_LATENT_TEXT.settingsDesc));
  }

  /* 分段 + 开关：卡片主体（LatentBackgroundSettingsCard.tsx:115-175）。 */
  var lead = foliaTuningEl('div', 'fx-folia-tuning-section');
  lead.appendChild(foliaBuildTuningControl({
    kind: 'pills', key: 'displayMode', label: FOLIA_LATENT_TEXT.displayMode,
    options: [
      { value: 'dithering', label: FOLIA_LATENT_TEXT.displayDithering },
      { value: 'mesh', label: FOLIA_LATENT_TEXT.displayMesh },
      { value: 'both', label: FOLIA_LATENT_TEXT.displayBoth }
    ]
  }, binding));
  lead.appendChild(foliaBuildTuningControl({
    kind: 'pills', key: 'colorSource', label: FOLIA_LATENT_TEXT.colorSource,
    options: [
      { value: 'cover-theme', label: FOLIA_LATENT_TEXT.colorSourceCoverTheme },
      { value: 'cover-only', label: FOLIA_LATENT_TEXT.colorSourceCoverOnly }
    ]
  }, binding));
  lead.appendChild(foliaBuildTuningControl({
    kind: 'switch', key: 'dynamicOnlyInPlayer',
    label: FOLIA_LATENT_TEXT.dynamicOnlyInPlayer, desc: FOLIA_LATENT_TEXT.dynamicOnlyInPlayerDesc
  }, binding));
  lead.appendChild(foliaBuildTuningControl({
    kind: 'switch', key: 'enhancedBeatResponse',
    label: FOLIA_LATENT_TEXT.enhancedBeatResponse, desc: FOLIA_LATENT_TEXT.enhancedBeatResponseDesc
  }, binding));
  host.appendChild(lead);

  /* 叠色子框（:177-198）：开关 + disabled 联动的百分比滑块。 */
  host.appendChild(foliaBuildTuningGroup(null, [
    foliaBuildTuningControl({
      kind: 'switch', key: 'overlayEnabled',
      label: FOLIA_LATENT_TEXT.overlay, desc: FOLIA_LATENT_TEXT.overlayDesc
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'overlayOpacity', label: FOLIA_LATENT_TEXT.overlayOpacity,
      min: 0, max: 1, step: 0.05, format: 'percent',
      disabledWhen: { key: 'overlayEnabled', equals: false }
    }, binding)
  ]));

  /* 像素组 / 流体组（:200-283）：滑块默认格式 toFixed(1)，透明度是百分比。 */
  host.appendChild(foliaBuildTuningGroup(FOLIA_LATENT_TEXT.ditheringGroup, [
    foliaBuildTuningControl({ kind: 'slider', key: 'ditheringSpeed', label: FOLIA_LATENT_TEXT.baseSpeed, min: 0, max: 2, step: 0.1, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'ditheringAudioSpeed', label: FOLIA_LATENT_TEXT.audioSpeed, min: 0, max: 2, step: 0.1, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'ditheringSize', label: FOLIA_LATENT_TEXT.ditheringSize, min: 0.5, max: 8, step: 0.25, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'ditheringOpacity', label: FOLIA_LATENT_TEXT.ditheringOpacity, min: 0, max: 1, step: 0.05, format: 'percent' }, binding)
  ]));
  host.appendChild(foliaBuildTuningGroup(FOLIA_LATENT_TEXT.meshGroup, [
    foliaBuildTuningControl({ kind: 'slider', key: 'meshSpeed', label: FOLIA_LATENT_TEXT.baseSpeed, min: 0, max: 2, step: 0.1, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'meshAudioSpeed', label: FOLIA_LATENT_TEXT.audioSpeed, min: 0, max: 2, step: 0.1, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'meshDistortion', label: FOLIA_LATENT_TEXT.meshDistortion, min: 0, max: 2, step: 0.05, format: 'one' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'meshSwirl', label: FOLIA_LATENT_TEXT.meshSwirl, min: 0, max: 1, step: 0.05, format: 'one' }, binding)
  ]));
}

function foliaBuildSoraPanel(host, opts) {
  var binding = foliaSoraBinding();
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_SORA_TEXT.settings, FOLIA_SORA_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_SORA_TEXT.settings, FOLIA_SORA_TEXT.settingsDesc));
  }
  host.appendChild(foliaBuildTuningControl({
    kind: 'switch', key: 'blank',
    label: FOLIA_SORA_TEXT.blank, desc: FOLIA_SORA_TEXT.blankDesc
  }, binding));
}

function foliaBuildCommonPanel(host, opts) {
  var binding = foliaCommonBinding();
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_COMMON_TEXT.settings, FOLIA_COMMON_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_COMMON_TEXT.settings, FOLIA_COMMON_TEXT.settingsDesc));
  }
  host.appendChild(foliaBuildTuningControl({
    kind: 'switch', key: 'disableVignette',
    label: FOLIA_COMMON_TEXT.disableVignette, desc: FOLIA_COMMON_TEXT.disableVignetteDesc
  }, binding));
  host.appendChild(foliaBuildTuningControl({
    kind: 'switch', key: 'disableGeometricBackground',
    label: FOLIA_COMMON_TEXT.disableGeometric, desc: FOLIA_COMMON_TEXT.disableGeometricDesc
  }, binding));
}

/* ================= 漫游（nomand）背景面板 =================
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/nomand/）：
 *   NomandBackgroundSettingsCard.tsx（175）→ 标题/来源/效果/叠色四段
 *   NomandBackgroundEffectSettings.tsx（72）→ 五档效果选择 + 只挂当前效果的设置
 *   NomandBackgroundEffectPanel.tsx（73）    → 共用 SliderRow：**默认 toFixed(2)**、percent 助手
 *   Nomand{Dithering,FlutedGlass,PaperTexture,HalftoneDots,LensDistortion}Settings.tsx → 各效果控件
 *   i18n/locales/zh-CN.ts:2567-2599 → 文案逐字
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 上传/清除按钮与「文件名」一行由 00b 的图片池 + foliaBuildAssetUploadRow 落地。
 *    资产槽是 **共享** 的（Folia 里莫奈背景与漫游读的是同一个 monetBackgroundImage），
 *    上传成功这里把 imageSource 切到 uploaded-global；清空时若正停在该档则退回封面。
 *    01f 仍然读 window.foliaNomandCustomImage，只是这个全局现在由图片池桥接写入。
 * 2. 效果选择点击后整面板重建：下半组控件按当前效果换一整块（Folia 是条件渲染，等价）。
 * 3. 运行时只多一个 preview 入口：01f 的 foliaNomandSetTuning 是「改内存 + 落盘 + 就地生效」
 *    三合一，面板拖动中改用 foliaNomandPreviewTuning（同一条路径但不写存档），松手
 *    foliaNomandSaveTuning 落盘 —— 与 Folia 的 draft / pointerup 两段提交等价。
 * 4. 控制台的「漫游」画布是 key={sourceUrl:effect} 重挂语义，01f 已在 SetTuning 里处理。
 */

var FOLIA_NOMAND_TEXT = {
  settings: '漫游背景',
  settingsDesc: '为歌曲封面或自定义图片应用 Paper 图片效果。',
  source: '图片来源',
  sourceCover: '封面',
  sourceUploaded: '自定义图片',
  effect: '效果',
  effectDithering: '像素画',
  effectFlutedGlass: '纹理玻璃',
  effectPaperTexture: '纸张纹理',
  effectHalftoneDots: '半调网点',
  effectLensDistortion: '镜头畸变',
  ditheringType: '像素画图案',
  size: '网点尺寸',
  colorSteps: '色阶数量',
  originalColors: '保留图片原色',
  inverted: '反转图片明度',
  flutedGlassSize: '纹理尺寸',
  flutedGlassDistortion: '扭曲',
  flutedGlassBlur: '模糊',
  paperContrast: '对比度',
  paperRoughness: '粗糙度',
  paperFiber: '纤维',
  halftoneSize: '网点尺寸',
  halftoneRadius: '网点半径',
  halftoneContrast: '对比度',
  lensSpread: '色彩分离',
  lensBulge: '镜头膨胀',
  lensDispersion: '色彩色散',
  overlay: '可读性叠色',
  overlayDesc: '在图片效果前叠加当前主题背景色，提升歌词可读性。',
  overlayOpacity: '叠色透明度',
  /* NomandBackgroundSettingsCard 的按钮用的是莫奈那组键（zh-CN.ts:2569-2570），
   * 成功/失败文案是本卡片自己的（zh-CN.ts:2621-2622），提示走 store 的 notifications。 */
  uploadBackground: '上传背景图',
  clearBackground: '清空背景图',
  uploadSuccess: '背景图片上传成功',
  uploadFailed: '背景图片上传失败',
  uploadSuccessToast: 'Monet 背景图已更新',
  clearToast: 'Monet 背景图已清空'
};

function foliaNomandBinding() {
  return {
    /* 01f 的 SetTuning 自己就地生效（含换效果重建画布），不需要再重建整背景。 */
    rebuild: false,
    get: function () { return window.foliaNomandTuning(); },
    /* 拖动中只改内存 + 就地重画（preview，不写存档），松手 commit 落盘 ——
     * 与隐现/通用同语义，也避免拖动时每帧写一次 localStorage。 */
    set: function (patch) { return window.foliaNomandPreviewTuning(patch); },
    commit: function () { if (window.foliaNomandSaveTuning) window.foliaNomandSaveTuning(); }
  };
}

/* 五档效果各自那一组控件（Nomand*Settings.tsx 逐项照抄；format 缺省 = 两位小数）。 */
function foliaBuildNomandEffectControls(effect, binding) {
  if (effect === 'dithering') {
    return foliaBuildTuningGroup(FOLIA_NOMAND_TEXT.effectDithering, [
      foliaBuildTuningControl({
        kind: 'pills', key: 'ditheringType', label: FOLIA_NOMAND_TEXT.ditheringType,
        options: [
          { value: '2x2', label: '2x2' },
          { value: '4x4', label: '4x4' },
          { value: '8x8', label: '8x8' }
        ]
      }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'size', label: FOLIA_NOMAND_TEXT.size, min: 0.5, max: 20, step: 0.5, format: 'one' }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'colorSteps', label: FOLIA_NOMAND_TEXT.colorSteps, min: 1, max: 7, step: 1, format: 'integer' }, binding),
      foliaBuildTuningControl({ kind: 'switch', key: 'originalColors', label: FOLIA_NOMAND_TEXT.originalColors }, binding),
      foliaBuildTuningControl({ kind: 'switch', key: 'inverted', label: FOLIA_NOMAND_TEXT.inverted }, binding)
    ]);
  }
  if (effect === 'fluted-glass') {
    return foliaBuildTuningGroup(FOLIA_NOMAND_TEXT.effectFlutedGlass, [
      foliaBuildTuningControl({ kind: 'slider', key: 'flutedGlassSize', label: FOLIA_NOMAND_TEXT.flutedGlassSize, min: 0.1, max: 1, step: 0.05 }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'flutedGlassDistortion', label: FOLIA_NOMAND_TEXT.flutedGlassDistortion, min: 0, max: 1, step: 0.05, format: 'percent' }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'flutedGlassBlur', label: FOLIA_NOMAND_TEXT.flutedGlassBlur, min: 0, max: 1, step: 0.05, format: 'percent' }, binding)
    ]);
  }
  if (effect === 'paper-texture') {
    return foliaBuildTuningGroup(FOLIA_NOMAND_TEXT.effectPaperTexture, [
      foliaBuildTuningControl({ kind: 'slider', key: 'paperTextureContrast', label: FOLIA_NOMAND_TEXT.paperContrast, min: 0, max: 1, step: 0.05, format: 'percent' }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'paperTextureRoughness', label: FOLIA_NOMAND_TEXT.paperRoughness, min: 0, max: 1, step: 0.05, format: 'percent' }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'paperTextureFiber', label: FOLIA_NOMAND_TEXT.paperFiber, min: 0, max: 1, step: 0.05, format: 'percent' }, binding)
    ]);
  }
  if (effect === 'halftone-dots') {
    return foliaBuildTuningGroup(FOLIA_NOMAND_TEXT.effectHalftoneDots, [
      foliaBuildTuningControl({ kind: 'slider', key: 'halftoneDotsSize', label: FOLIA_NOMAND_TEXT.halftoneSize, min: 0.1, max: 1, step: 0.05 }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'halftoneDotsRadius', label: FOLIA_NOMAND_TEXT.halftoneRadius, min: 0.1, max: 2, step: 0.05 }, binding),
      foliaBuildTuningControl({ kind: 'slider', key: 'halftoneDotsContrast', label: FOLIA_NOMAND_TEXT.halftoneContrast, min: 0, max: 1, step: 0.05, format: 'percent' }, binding),
      foliaBuildTuningControl({ kind: 'switch', key: 'halftoneDotsOriginalColors', label: FOLIA_NOMAND_TEXT.originalColors }, binding),
      foliaBuildTuningControl({ kind: 'switch', key: 'halftoneDotsInverted', label: FOLIA_NOMAND_TEXT.inverted }, binding)
    ]);
  }
  return foliaBuildTuningGroup(FOLIA_NOMAND_TEXT.effectLensDistortion, [
    foliaBuildTuningControl({ kind: 'slider', key: 'lensDistortionSpread', label: FOLIA_NOMAND_TEXT.lensSpread, min: 0, max: 1, step: 0.05, format: 'percent' }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'lensDistortionBulge', label: FOLIA_NOMAND_TEXT.lensBulge, min: -1, max: 1, step: 0.05 }, binding),
    foliaBuildTuningControl({ kind: 'slider', key: 'lensDistortionDispersion', label: FOLIA_NOMAND_TEXT.lensDispersion, min: 0, max: 1, step: 0.05, format: 'percent' }, binding)
  ]);
}

function foliaBuildNomandPanel(host, opts) {
  var binding = foliaNomandBinding();
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_NOMAND_TEXT.settings, FOLIA_NOMAND_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_NOMAND_TEXT.settings, FOLIA_NOMAND_TEXT.settingsDesc));
  }

  var tuning = binding.get();
  /* 来源与效果：卡片顶部的两组分段（NomandBackgroundSettingsCard.tsx:70-68 / EffectSettings:40-61）。 */
  var lead = foliaTuningEl('div', 'fx-folia-tuning-section');
  var hasUploaded = !!(typeof window !== 'undefined' && window.foliaNomandCustomImage
    && window.foliaNomandCustomImage.url);
  lead.appendChild(foliaBuildTuningControl({
    kind: 'pills', key: 'imageSource', label: FOLIA_NOMAND_TEXT.source,
    options: [
      { value: 'cover-derived', label: FOLIA_NOMAND_TEXT.sourceCover },
      /* Folia：没有上传图时「自定义图片」禁用（disabled={... && !monetBackgroundImage}）。 */
      { value: 'uploaded-global', label: FOLIA_NOMAND_TEXT.sourceUploaded, disabled: !hasUploaded }
    ]
  }, binding));
  /* 上传 / 清空 / 文件名（NomandBackgroundSettingsCard.tsx:95-129）。
   * 与莫奈背景共用同一个资产槽：Folia 里两张卡片拿的都是 `monetBackgroundImage`。 */
  lead.appendChild(foliaBuildAssetUploadRow('background', {
    scope: 'nomand-bg',
    label: '图片文件',
    uploadLabel: FOLIA_NOMAND_TEXT.uploadBackground,
    clearLabel: FOLIA_NOMAND_TEXT.clearBackground,
    successText: FOLIA_NOMAND_TEXT.uploadSuccess,
    failedText: FOLIA_NOMAND_TEXT.uploadFailed,
    successToast: FOLIA_NOMAND_TEXT.uploadSuccessToast,
    clearToast: FOLIA_NOMAND_TEXT.clearToast,
    onUploaded: function () {
      binding.set(foliaTuningPatch('imageSource', 'uploaded-global'));
      binding.commit();
      foliaRebuildTuningBackground();
    },
    onCleared: function () {
      if (binding.get().imageSource === 'uploaded-global') {
        binding.set(foliaTuningPatch('imageSource', 'cover-derived'));
        binding.commit();
      }
      foliaRebuildTuningBackground();
    }
  }));
  lead.appendChild(foliaBuildTuningControl({
    kind: 'pills', key: 'effect', label: FOLIA_NOMAND_TEXT.effect,
    refreshPanel: true,
    options: [
      { value: 'dithering', label: FOLIA_NOMAND_TEXT.effectDithering },
      { value: 'fluted-glass', label: FOLIA_NOMAND_TEXT.effectFlutedGlass },
      { value: 'paper-texture', label: FOLIA_NOMAND_TEXT.effectPaperTexture },
      { value: 'halftone-dots', label: FOLIA_NOMAND_TEXT.effectHalftoneDots },
      { value: 'lens-distortion', label: FOLIA_NOMAND_TEXT.effectLensDistortion }
    ]
  }, binding));
  host.appendChild(lead);

  /* 只挂当前效果的一组（EffectSettings 的条件渲染）。 */
  var effect = (tuning && tuning.effect) || 'dithering';
  host.appendChild(foliaBuildNomandEffectControls(effect, binding));

  /* 叠色子框：与隐现同名同语义（zh-CN 也是同一组键的复用）。 */
  host.appendChild(foliaBuildTuningGroup(null, [
    foliaBuildTuningControl({
      kind: 'switch', key: 'overlayEnabled',
      label: FOLIA_NOMAND_TEXT.overlay, desc: FOLIA_NOMAND_TEXT.overlayDesc
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'overlayOpacity', label: FOLIA_NOMAND_TEXT.overlayOpacity,
      min: 0, max: 1, step: 0.05, format: 'percent',
      disabledWhen: { key: 'overlayEnabled', equals: false }
    }, binding)
  ]));
}

/* ---------------- 莫奈（monet）面板 ----------------
 * 源文件（Folia: src/components/visualizer/backgrounds/monet/MonetBackgroundSettingsCard.tsx 457）
 *   SectionLabel / PresetGroup / SliderControl 三个局部组件 → 本文件的药丸组 / 滑块 / 开关行
 *   四个 group 标题：monetGroup{BackgroundSource,LayoutPosition,FiltersPostProcessing,ColorTintWash}
 *   i18n/locales/zh-CN.ts:2564-2571 / 2626-2644 / 2664-2667 → 文案逐字
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 「上传背景图 / 清空背景图 / 文件名」三件由 00b 的图片池 + foliaBuildAssetUploadRow 落地
 *    （IndexedDB 键 monet_background_image，与 Folia 同名）；来源两档的禁用逻辑不变——
 *    池里没图时「自定义图片」不可选。01d 读的 window.foliaMonetBackgroundImage 由池桥接写入。
 * 2. 自定义水洗色用原生 <input type="color"> 替代 react-colorful 的 HexColorPicker：
 *    同一份 hex 值，面板里显示十六进制码（Folia 那个圆角小徽章）。
 * 3. 条件渲染照搬：水平偏移只在「半屏渐变」出现、漂移幅度只在「缓慢漂移」开时出现、
 *    自定义色只在「自定义」档出现 —— 都靠 refreshPanel 整面板重建落地。
 * 4. 运行时零重建：01d 的 SetTuning 自己就地生效（布局/漂移立即、位图字段 180ms 防抖重烘焙），
 *    所以 rebuild:false；拖动走 preview 不落盘，松手 save。
 */

var FOLIA_MONET_TEXT = {
  settings: '莫奈背景',
  settingsDesc: '调整莫奈背景图片来源、布局和后处理。',
  groupSource: '背景来源',
  source: '背景来源',
  sourceCover: '封面',
  sourceUploaded: '自定义图片',
  groupLayout: '布局与对齐',
  layout: '布局模式',
  layoutHalfPane: '半屏渐变',
  layoutFullOverlay: '全屏叠色',
  halfPaneOffset: '图片水平偏移',
  driftEnabled: '缓慢漂移',
  driftEnabledDesc: '让背景图缓慢缩放漂移。图片会预先放大一点，保证移动时不会露出边缘。',
  driftStrength: '漂移幅度',
  groupFilters: '视觉增强与滤镜',
  blur: '背景模糊',
  saturation: '饱和度',
  grayscale: '去色',
  groupTint: '叠色与水洗',
  overlayOpacity: '主题叠色强度',
  wash: '水洗重着色',
  streaksEnabled: '竖向纹理',
  streaksDesc: '在背景上绘制细竖线纹理。',
  washColorMode: '水洗色彩',
  washTheme: '主题色',
  washCustom: '自定义',
  washCustomColor: '自定义水洗色',
  uploadBackground: '上传背景图',
  clearBackground: '清空背景图',
  uploadSuccessToast: 'Monet 背景图已更新',
  clearToast: 'Monet 背景图已清空'
};

function foliaMonetBinding() {
  return {
    /* 01d 自己就地生效（布局/漂移立即、位图字段防抖重烘焙），不需要重建整背景。 */
    rebuild: false,
    get: function () { return window.foliaMonetTuning(); },
    /* 拖动中只改内存 + 就地重画（preview），松手 commit 落盘。 */
    set: function (patch) { return window.foliaMonetPreviewTuning(patch); },
    commit: function () { if (window.foliaMonetSaveTuning) window.foliaMonetSaveTuning(); }
  };
}

function foliaBuildMonetPanel(host, opts) {
  var binding = foliaMonetBinding();
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_MONET_TEXT.settings, FOLIA_MONET_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_MONET_TEXT.settings, FOLIA_MONET_TEXT.settingsDesc));
  }

  var tuning = binding.get();
  var hasUploaded = !!(typeof window !== 'undefined' && window.foliaMonetBackgroundImage
    && window.foliaMonetBackgroundImage.url);

  /* 组 1：背景来源 + 上传/清空/文件名（MonetBackgroundSettingsCard.tsx:236-300 都在同一段里）。 */
  var sourceChildren = [
    foliaBuildTuningControl({
      kind: 'pills', key: 'backgroundSource', label: FOLIA_MONET_TEXT.source,
      options: [
        { value: 'cover-derived', label: FOLIA_MONET_TEXT.sourceCover },
        /* Folia：没有上传图时禁用（disabled={!monetBackgroundImage && !isLoading}）。 */
        { value: 'uploaded-global', label: FOLIA_MONET_TEXT.sourceUploaded, disabled: !hasUploaded }
      ]
    }, binding),
    foliaBuildAssetUploadRow('background', {
      scope: 'monet-bg',
      label: '图片文件',
      uploadLabel: FOLIA_MONET_TEXT.uploadBackground,
      clearLabel: FOLIA_MONET_TEXT.clearBackground,
      successToast: FOLIA_MONET_TEXT.uploadSuccessToast,
      clearToast: FOLIA_MONET_TEXT.clearToast,
      onUploaded: function () {
        binding.set(foliaTuningPatch('backgroundSource', 'uploaded-global'));
        binding.commit();
        foliaRebuildTuningBackground();
      },
      onCleared: function () {
        if (binding.get().backgroundSource === 'uploaded-global') {
          binding.set(foliaTuningPatch('backgroundSource', 'cover-derived'));
          binding.commit();
        }
        foliaRebuildTuningBackground();
      }
    })
  ];
  host.appendChild(foliaBuildTuningGroup(FOLIA_MONET_TEXT.groupSource, sourceChildren));

  /* 组 2：布局与对齐（半屏渐变才有水平偏移；漂移开了才有幅度）。 */
  var layoutChildren = [
    foliaBuildTuningControl({
      kind: 'pills', key: 'backgroundLayout', label: FOLIA_MONET_TEXT.layout,
      refreshPanel: true,
      options: [
        { value: 'half-pane-gradient', label: FOLIA_MONET_TEXT.layoutHalfPane },
        { value: 'full-overlay', label: FOLIA_MONET_TEXT.layoutFullOverlay }
      ]
    }, binding)
  ];
  if (tuning.backgroundLayout === 'half-pane-gradient') {
    layoutChildren.push(foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundHalfPaneOffsetX', label: FOLIA_MONET_TEXT.halfPaneOffset,
      min: -40, max: 40, step: 2, format: 'pct'
    }, binding));
  }
  layoutChildren.push(foliaBuildTuningControl({
    kind: 'switch', key: 'backgroundDriftEnabled',
    label: FOLIA_MONET_TEXT.driftEnabled, desc: FOLIA_MONET_TEXT.driftEnabledDesc
  }, binding));
  if (tuning.backgroundDriftEnabled) {
    layoutChildren.push(foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundDriftStrength', label: FOLIA_MONET_TEXT.driftStrength,
      min: 0, max: 1, step: 0.05, format: 'percent'
    }, binding));
  }
  host.appendChild(foliaBuildTuningGroup(FOLIA_MONET_TEXT.groupLayout, layoutChildren));

  /* 组 3：视觉增强与滤镜。 */
  host.appendChild(foliaBuildTuningGroup(FOLIA_MONET_TEXT.groupFilters, [
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundBlurPx', label: FOLIA_MONET_TEXT.blur,
      min: 0, max: 60, step: 2, format: 'px'
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundSaturation', label: FOLIA_MONET_TEXT.saturation,
      min: 0, max: 2, step: 0.05, format: 'percent'
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundGrayscale', label: FOLIA_MONET_TEXT.grayscale,
      min: 0, max: 1, step: 0.02, format: 'percent'
    }, binding)
  ]));

  /* 组 4：叠色与水洗（自定义色只在「自定义」档出现）。 */
  var tintChildren = [
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundOverlayOpacity', label: FOLIA_MONET_TEXT.overlayOpacity,
      min: 0, max: 1, step: 0.02, format: 'percent'
    }, binding),
    foliaBuildTuningControl({
      kind: 'slider', key: 'backgroundWash', label: FOLIA_MONET_TEXT.wash,
      min: 0, max: 1, step: 0.02, format: 'percent'
    }, binding),
    foliaBuildTuningControl({
      kind: 'switch', key: 'backgroundStreaksEnabled',
      label: FOLIA_MONET_TEXT.streaksEnabled, desc: FOLIA_MONET_TEXT.streaksDesc
    }, binding),
    foliaBuildTuningControl({
      kind: 'pills', key: 'backgroundWashColorMode', label: FOLIA_MONET_TEXT.washColorMode,
      refreshPanel: true,
      options: [
        { value: 'theme', label: FOLIA_MONET_TEXT.washTheme },
        { value: 'custom', label: FOLIA_MONET_TEXT.washCustom }
      ]
    }, binding)
  ];
  if (tuning.backgroundWashColorMode === 'custom') {
    tintChildren.push(foliaBuildTuningControl({
      kind: 'color', key: 'backgroundWashCustomColor', label: FOLIA_MONET_TEXT.washCustomColor
    }, binding));
  }
  host.appendChild(foliaBuildTuningGroup(FOLIA_MONET_TEXT.groupTint, tintChildren));
}

/* ---------------- 嵌入（url）面板 ----------------
 * 源文件（Folia: src/components/visualizer/backgrounds/url/UrlBackgroundSettingsCard.tsx 278）
 *   列表（每项 = 备注 + 地址 + 改/删）→ 选中态 accent 描边与底色源自 item.id === selectedId
 *   空态文案 / 添加表单 / 行内编辑表单三块条件渲染
 *   i18n/locales/zh-CN.ts:2088-2092 → 文案逐字
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 这不是「调参」而是**列表 CRUD**：没有 tuning binding，直接调 01g 的
 *    foliaUrlAdd/Update/Delete/Select（与 Folia store 的 handle* 一一对应）。
 * 2. 草稿（正在添加/正在编辑的 url 与备注）放在模块级 `foliaUrlPanelDraft`：
 *    面板每次操作后整块重建，草稿必须活过重建（React 里是 useState）。
 * 3. 表单的取消/保存按钮用「× / ✓」文字代替 lucide 图标；空态少了 Globe 图标
 *    （两侧都是纯装饰，不影响行为）。
 * 4. 保存按钮不做 disabled 态：Folia 是 `disabled={!draftUrl.trim()}`，这里点下去
 *    由 normalizeUrl 拒绝（空串与非法协议都不写库），落库与否的判据完全一样。
 */

var FOLIA_URL_TEXT = {
  settings: '嵌入背景',
  settingsDesc: '将网页显示为播放页背景。注意：部分网站禁止被嵌入其他页面中显示，可能无法正常加载。',
  urlPlaceholder: 'https://example.com',
  notePlaceholder: '备注（方便查看）',
  add: '添加 URL',
  empty: '暂无 URL，点击上方按钮添加',
  edit: '改',
  remove: '删',
  save: '✓',
  cancel: '×'
};

/* 草稿：adding=true 表示底部展开添加表单；editingId 非空表示某一行在行内编辑。 */
var foliaUrlPanelDraft = { adding: false, editingId: null, url: '', note: '' };

function foliaUrlPanelResetDraft() {
  foliaUrlPanelDraft.adding = false;
  foliaUrlPanelDraft.editingId = null;
  foliaUrlPanelDraft.url = '';
  foliaUrlPanelDraft.note = '';
}

function foliaUrlPanelButton(kind, label, onClick) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-folia-tuning-url-act' + (kind ? ' is-' + kind : '');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function foliaUrlPanelTextInput(cls, placeholder, value, onInput) {
  var input = document.createElement('input');
  input.className = cls;
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener('input', function () { onInput(input.value); });
  return input;
}

/* 添加/编辑共用的表单块：地址 + 备注 + 取消/保存。save 决定落到 add 还是 update。 */
function foliaUrlBuildDraftForm(mode) {
  var draft = foliaUrlPanelDraft;
  var form = foliaTuningEl('div', 'fx-folia-tuning-url-form');

  form.appendChild(foliaUrlPanelTextInput(
    'fx-folia-tuning-url-input', FOLIA_URL_TEXT.urlPlaceholder, draft.url,
    function (value) { draft.url = value; }
  ));
  form.appendChild(foliaUrlPanelTextInput(
    'fx-folia-tuning-url-input', FOLIA_URL_TEXT.notePlaceholder, draft.note,
    function (value) { draft.note = value; }
  ));

  var actions = foliaTuningEl('div', 'fx-folia-tuning-url-form-actions');
  actions.appendChild(foliaUrlPanelButton('ghost', FOLIA_URL_TEXT.cancel, function () {
    foliaUrlPanelResetDraft();
    foliaRefreshTuningPanel();
  }));
  actions.appendChild(foliaUrlPanelButton('primary', FOLIA_URL_TEXT.save, function () {
    /* 规范化（无协议补 https://，非 http(s) 一律拒绝）——与 Folia handleAdd/handleSaveEdit 同判据。 */
    var normalized = typeof window.foliaUrlNormalize === 'function'
      ? window.foliaUrlNormalize(draft.url) : null;
    if (!normalized) return;
    var note = draft.note.trim() || normalized;
    if (mode === 'add') {
      var id = 'url-bg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      if (window.foliaUrlAdd({ id: id, url: normalized, note: note })) {
        /* Folia handleAdd：加完立刻选中新项。 */
        window.foliaUrlSelect(id);
      }
    } else if (draft.editingId && window.foliaUrlUpdate) {
      window.foliaUrlUpdate(draft.editingId, { url: normalized, note: note });
    }
    foliaUrlPanelResetDraft();
    foliaRefreshTuningPanel();
  }));
  form.appendChild(actions);
  return form;
}

function foliaUrlBuildItem(item, selectedId) {
  var selected = item.id === selectedId;
  var row = foliaTuningEl('div', 'fx-folia-tuning-url-item' + (selected ? ' is-selected' : ''));
  row.setAttribute('data-folia-url-id', item.id);

  if (foliaUrlPanelDraft.editingId === item.id) {
    row.appendChild(foliaUrlBuildDraftForm('edit'));
    return row;
  }

  var body = document.createElement('button');
  body.type = 'button';
  body.className = 'fx-folia-tuning-url-body';
  body.appendChild(foliaTuningEl('div', 'fx-folia-tuning-url-note', item.note));
  body.appendChild(foliaTuningEl('div', 'fx-folia-tuning-url-addr', item.url));
  body.addEventListener('click', function () {
    if (window.foliaUrlSelect) window.foliaUrlSelect(item.id);
    foliaUrlPanelResetDraft();
    foliaRefreshTuningPanel();
  });

  var actions = foliaTuningEl('div', 'fx-folia-tuning-url-actions');
  actions.appendChild(foliaUrlPanelButton('ghost', FOLIA_URL_TEXT.edit, function () {
    foliaUrlPanelDraft.adding = false;
    foliaUrlPanelDraft.editingId = item.id;
    foliaUrlPanelDraft.url = item.url;
    foliaUrlPanelDraft.note = item.note;
    foliaRefreshTuningPanel();
  }));
  actions.appendChild(foliaUrlPanelButton('danger', FOLIA_URL_TEXT.remove, function () {
    if (window.foliaUrlDelete) window.foliaUrlDelete(item.id);
    foliaUrlPanelResetDraft();
    foliaRefreshTuningPanel();
  }));

  row.appendChild(body);
  row.appendChild(actions);
  return row;
}

function foliaBuildUrlPanel(host, opts) {
  var useFoldHeader = !(opts && opts.useFoldHeader === false);
  if (useFoldHeader) {
    foliaSetTuningFoldHeader(FOLIA_URL_TEXT.settings, FOLIA_URL_TEXT.settingsDesc);
  } else {
    host.appendChild(foliaBuildPanelIntro(FOLIA_URL_TEXT.settings, FOLIA_URL_TEXT.settingsDesc));
  }

  /* 存档即真值：没进过嵌入背景时内存表是空的，这里先灌一遍。 */
  var tuning = typeof window.foliaUrlLoadTuning === 'function'
    ? window.foliaUrlLoadTuning()
    : (window.foliaUrlTuning || { items: [], selectedId: null });
  var items = (tuning && tuning.items) || [];
  var selectedId = (tuning && tuning.selectedId) || null;

  var list = foliaTuningEl('div', 'fx-folia-tuning-url-list');
  for (var i = 0; i < items.length; i++) list.appendChild(foliaUrlBuildItem(items[i], selectedId));
  if (items.length > 0) host.appendChild(list);

  if (foliaUrlPanelDraft.adding) {
    host.appendChild(foliaUrlBuildDraftForm('add'));
  } else {
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fx-folia-tuning-url-add';
    addBtn.textContent = FOLIA_URL_TEXT.add;
    addBtn.addEventListener('click', function () {
      foliaUrlPanelDraft.adding = true;
      foliaUrlPanelDraft.editingId = null;
      foliaUrlPanelDraft.url = '';
      foliaUrlPanelDraft.note = '';
      foliaRefreshTuningPanel();
    });
    host.appendChild(addBtn);
  }

  if (items.length === 0 && !foliaUrlPanelDraft.adding) {
    var empty = foliaTuningEl('div', 'fx-folia-tuning-url-empty', FOLIA_URL_TEXT.empty);
    host.appendChild(empty);
  }
}

/* 面板注册表：bg 维度查当前背景（foliaWorld.background），mode 维度查当前样式（foliaWorld.mode）。
 * 两个面板都命中时：背景面板占折叠标题行，模式面板退到面板内标题，中间一条分隔线。 */
var FOLIA_TUNING_PANEL_REGISTRY = {
  bg: {
    latent: { build: foliaBuildLatentPanel },
    sora: { build: foliaBuildSoraPanel },
    common: { build: foliaBuildCommonPanel },
    nomand: { build: foliaBuildNomandPanel },
    monet: { build: foliaBuildMonetPanel },
    url: { build: foliaBuildUrlPanel }
  },
  mode: {
    lumiere: { build: foliaBuildLumierePanel }
  }
};

function foliaTuningPanelModeId(mode) {
  return FOLIA_TUNING_PANEL_REGISTRY.mode[mode] ? mode : '';
}

/* 面板只在「当前背景或当前样式有调参项」时出现；没有就整块藏起来（still / classic 等还没移植）。
 * 连折叠标题一起藏 —— 只剩一个空标题行比不显示更迷惑。 */
function foliaBuildTuningPanel() {
  var host = document.getElementById('fx-folia-tuning');
  if (!host) return;
  var fold = document.getElementById('fx-folia-tuning-fold');
  var bgBuilder = null;
  var modeBuilder = null;
  if (typeof foliaWorld !== 'undefined' && foliaWorld) {
    var bgDef = FOLIA_TUNING_PANEL_REGISTRY.bg[foliaWorld.background];
    if (bgDef) bgBuilder = bgDef.build;
    var modeDef = FOLIA_TUNING_PANEL_REGISTRY.mode[foliaTuningPanelModeId(foliaWorld.mode)];
    if (modeDef) modeBuilder = modeDef.build;
  }
  while (host.firstChild) host.removeChild(host.firstChild);
  if (!bgBuilder && !modeBuilder) {
    host.hidden = true;
    if (fold) fold.hidden = true;
    return;
  }
  if (fold) fold.hidden = false;
  host.hidden = false;
  if (bgBuilder) bgBuilder(host, { useFoldHeader: true });
  if (modeBuilder) {
    if (bgBuilder) {
      host.appendChild(foliaTuningDivider());
      modeBuilder(host, { useFoldHeader: false });
    } else {
      modeBuilder(host, { useFoldHeader: true });
    }
  }
}

function foliaRefreshTuningPanel() {
  foliaBuildTuningPanel();
}
