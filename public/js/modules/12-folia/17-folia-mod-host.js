/* Folia 世界 — Folium v1 模组宿主
 *
 * Folia 的歌词样式可以通过「Folium 模组」外挂：一个目录里放 mod.json + client.mjs，
 * client.mjs 是 ESM，默认导出 activate(folium)，在里面调
 *   folium.registries.visualizers.register({ id, label, order, settings, mount })
 * mount(container, ctx) 返回一个清理函数；模组自己不跑 rAF，靠
 *   ctx.onLyricTime(cb) / ctx.onChange(cb) 被宿主推着走。
 *
 * 本文件把这条契约桥到本项目已有的 registerFoliaMode()：
 *   - 模组目录放在 public/folia-mods/<dir>/，清单见 public/folia-mods/manifest.json；
 *   - 注册出来的样式和原生 14 个样式完全同权，直接出现在「歌词样式」网格里；
 *   - 模组崩了只影响它自己那张卡：create 抛错会在舞台里画一行可见原因，不拖垮整个世界。
 *
 * 刻意没做的（v1）：
 *   - 模组设置表单（settings schema 只用来取默认值，暂不渲染旋钮）；
 *   - 模组背景（folium.registries.backgrounds 静默忽略）；
 *   - folium.sig.json 验签（本地目录安装，无公钥；digest 由清单侧自行保证）。
 */
'use strict';

var FOLIUM_HOST_VERSION = '0.7.23'; // 模组声明 folia ">=0.7.21 <0.8.0"，宿主能力对齐到这一档

var foliaModHost = {
  loading: null,
  loaded: [],   // [{ id, modeId, dir, name }]
  errors: []    // [{ id, error }]
};

function foliaModLabelText(label, fallback) {
  if (typeof label === 'string' && label) return label;
  if (label && typeof label === 'object') {
    return String(label['zh-CN'] || label.zh || label.en || fallback || '');
  }
  return String(fallback || '');
}

/* ---------------- 模组参数：归一化 / 持久化 / 面板 ----------------
 *
 * 约定（与 Folia 一致）：宿主渲染表单、钳制、落盘；模组只走 ctx.getSettings() 读值。
 * 所以「面板显示的数」与「画面用的数」只有一份来源 —— 归一化后存进
 * foliaModSettingsState，getSettings() 直接返回它。
 */
var FOLIA_MOD_SETTINGS_KEY = 'mineradio-folia-mod-settings-v1';

var foliaModSchemas = Object.create(null);       // modeId → schema 数组
var foliaModMetas = Object.create(null);         // modeId → { name, desc }
var foliaModSettingsState = Object.create(null); // modeId → 归一化后的值（唯一真源）
var foliaModInstances = Object.create(null);     // modeId → 当前实例（推 onChange 用）

function foliaModReadStore() {
  try { return JSON.parse(localStorage.getItem(FOLIA_MOD_SETTINGS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

function foliaModWriteStore(store) {
  try { localStorage.setItem(FOLIA_MOD_SETTINGS_KEY, JSON.stringify(store)); } catch (_) {}
}

/* 单项归一化：类型不对回落缺省、数值钳区间、按 step 对齐（消掉 1.2000000000000002
 * 这类浮点残渣）、枚举只认 schema 里列出的值。 */
function foliaModNormalizeValue(spec, value) {
  if (!spec || typeof spec.key !== 'string') return value;

  if (spec.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return spec.defaultValue === true;
  }

  if (spec.type === 'select') {
    var options = Array.isArray(spec.options) ? spec.options : [];
    for (var i = 0; i < options.length; i++) {
      if (options[i] && options[i].value === value) return value;
    }
    return spec.defaultValue;
  }

  var n = Number(value);
  if (!isFinite(n)) n = Number(spec.defaultValue);
  if (!isFinite(n)) n = 0;
  if (isFinite(Number(spec.min))) n = Math.max(Number(spec.min), n);
  if (isFinite(Number(spec.max))) n = Math.min(Number(spec.max), n);
  var step = Number(spec.step);
  if (isFinite(step) && step > 0) {
    n = Math.round(n / step) * step;
    var dot = String(step).indexOf('.');
    var decimals = dot >= 0 ? Math.min(6, String(step).length - dot - 1) : 0;
    n = Number(n.toFixed(decimals));
    if (isFinite(Number(spec.min))) n = Math.max(Number(spec.min), n);
    if (isFinite(Number(spec.max))) n = Math.min(Number(spec.max), n);
  }
  return n;
}

function foliaModNormalizeSettings(schema, raw) {
  var out = {};
  if (!Array.isArray(schema)) return out;
  for (var i = 0; i < schema.length; i++) {
    var spec = schema[i];
    if (!spec || typeof spec.key !== 'string' || !spec.key) continue;
    var v = raw && raw[spec.key] !== undefined ? raw[spec.key] : spec.defaultValue;
    out[spec.key] = foliaModNormalizeValue(spec, v);
  }
  return out;
}

function foliaModSettingsFor(modeId) {
  if (foliaModSettingsState[modeId]) return foliaModSettingsState[modeId];
  var store = foliaModReadStore();
  var next = foliaModNormalizeSettings(foliaModSchemas[modeId] || [], store[modeId] || {});
  foliaModSettingsState[modeId] = next;
  return next;
}

function foliaModPersistSettings(modeId) {
  var store = foliaModReadStore();
  store[modeId] = foliaModSettingsFor(modeId);
  foliaModWriteStore(store);
}

/* persist=false 用于拖动中途：只改内存、画面立刻跟手，松手再落盘
 * （与原生调参面板的 set/commit 语义一致，省掉拖动期间几十次序列化）。 */
function foliaModSetSettings(modeId, patch, persist) {
  var merged = Object.assign({}, foliaModSettingsFor(modeId), patch || {});
  foliaModSettingsState[modeId] = foliaModNormalizeSettings(foliaModSchemas[modeId] || [], merged);
  if (persist !== false) foliaModPersistSettings(modeId);
  var inst = foliaModInstances[modeId];
  if (inst && !inst.disposed) foliaModNotify(inst.changeListeners, undefined, inst);
  return foliaModSettingsState[modeId];
}

function foliaModResetSettings(modeId) {
  var store = foliaModReadStore();
  delete store[modeId];
  foliaModWriteStore(store);
  delete foliaModSettingsState[modeId];
  var inst = foliaModInstances[modeId];
  if (inst && !inst.disposed) foliaModNotify(inst.changeListeners, undefined, inst);
  return foliaModSettingsFor(modeId);
}

/* 描述是一整段（常常中英双语、还带 **强调**）：整段铺进面板会把面板撑成文档。
 * 行内只留第一句，全文挂到行元素的 title 上，鼠标停一下就能读全。 */
function foliaModDescText(spec) {
  return foliaModLabelText(spec && spec.description, '').replace(/\*\*/g, '').trim();
}

function foliaModDescBrief(spec) {
  var full = foliaModDescText(spec);
  if (!full) return '';
  var cut = full.search(/[。！？]/);
  var brief = cut >= 0 ? full.slice(0, cut + 1) : full;
  if (brief.length > 90) brief = brief.slice(0, 88) + '…';
  return brief;
}

function foliaModFieldRow(spec, binding) {
  var label = foliaModLabelText(spec.label, spec.key);
  var brief = foliaModDescBrief(spec);
  var row;

  if (spec.type === 'boolean') {
    row = foliaBuildSwitchRow({ key: spec.key, label: label, desc: brief }, binding);
  } else if (spec.type === 'select') {
    var options = [];
    var raw = Array.isArray(spec.options) ? spec.options : [];
    for (var i = 0; i < raw.length; i++) {
      if (!raw[i]) continue;
      options.push({ value: raw[i].value, label: foliaModLabelText(raw[i].label, String(raw[i].value)) });
    }
    row = foliaBuildTuningPills(label, options, spec.key, binding);
    if (brief) row.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint fx-folia-mod-desc', brief));
  } else {
    /* 0/1 且步长 1 的「数字」其实是开关（跳一跳的 preferPair 就是），给两粒药丸更好读。 */
    var isTinySwitch = Number(spec.min) === 0 && Number(spec.max) === 1 && Number(spec.step) === 1;
    if (isTinySwitch) {
      row = foliaBuildTuningPills(label, [
        { value: 1, label: '开' },
        { value: 0, label: '关' }
      ], spec.key, binding);
    } else {
      var step = Number(spec.step);
      row = foliaBuildTuningSlider({
        key: spec.key,
        label: label,
        min: isFinite(Number(spec.min)) ? Number(spec.min) : 0,
        max: isFinite(Number(spec.max)) ? Number(spec.max) : 1,
        step: isFinite(step) && step > 0 ? step : 0.05,
        /* 步长 >= 1 的值都是整数（俯角 18~60、每块字数 1~4），别显示成 34.00。 */
        format: isFinite(step) && step >= 1 ? 'integer' : ''
      }, binding);
    }
    if (brief) row.appendChild(foliaTuningEl('p', 'fx-folia-tuning-hint fx-folia-mod-desc', brief));
  }

  var full = foliaModDescText(spec);
  if (full) row.title = full;
  return row;
}

/* 由 mod 的 schema 生成面板。分组按 schema 里第一次出现的顺序（镜头 → 跳台 → 文字 → …），
 * 与模组文档写的阅读顺序一致。 */
function foliaModBuildSettingsPanel(host, opts, modeId) {
  var schema = foliaModSchemas[modeId];
  if (!host || !Array.isArray(schema) || !schema.length) return;
  if (typeof foliaTuningEl !== 'function' || typeof foliaBuildTuningSlider !== 'function') return;

  var meta = foliaModMetas[modeId] || {};
  var title = (meta.name || modeId) + '参数';
  var desc = '由模组自带 schema 生成 · 共 ' + schema.length + ' 项，改完立即生效';
  if (!(opts && opts.useFoldHeader === false)) foliaSetTuningFoldHeader(title, desc);
  else host.appendChild(foliaBuildPanelIntro(title, desc));

  var binding = {
    get: function () { return foliaModSettingsFor(modeId); },
    set: function (patch) { return foliaModSetSettings(modeId, patch, false); },
    commit: function () { foliaModPersistSettings(modeId); }
  };

  var order = [];
  var buckets = Object.create(null);
  for (var i = 0; i < schema.length; i++) {
    var spec = schema[i];
    if (!spec || typeof spec.key !== 'string' || !spec.key) continue;
    var groupKey = foliaModLabelText(spec.group, '') || '参数';
    if (!buckets[groupKey]) { buckets[groupKey] = []; order.push(groupKey); }
    buckets[groupKey].push(spec);
  }

  for (var g = 0; g < order.length; g++) {
    var section = foliaTuningEl('div', 'fx-folia-tuning-section');
    section.appendChild(foliaTuningEl('div', 'fx-folia-tuning-section-title', order[g]));
    var items = buckets[order[g]];
    for (var k = 0; k < items.length; k++) {
      section.appendChild(foliaModFieldRow(items[k], binding));
    }
    host.appendChild(section);
  }

  var footer = foliaTuningEl('div', 'fx-folia-tuning-footer');
  var reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'fx-folia-tuning-reset';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', function () {
    foliaModResetSettings(modeId);
    if (typeof foliaRefreshTuningPanel === 'function') foliaRefreshTuningPanel();
  });
  footer.appendChild(reset);
  host.appendChild(footer);
}


function foliaModFail(inst, err) {
  var msg = String((err && err.message) || err || '未知错误');
  console.warn('[FoliaMod] 模组渲染失败:', msg, err);
  if (!inst || !inst.container || inst.errorShown) return;   // 每帧都报的话别刷屏
  inst.errorShown = true;
  try {
    var box = document.createElement('div');
    box.className = 'folia-mod-error';
    box.style.cssText = 'position:absolute;left:24px;bottom:24px;max-width:70%;padding:10px 14px;'
      + 'border-radius:10px;background:rgba(120,20,20,.72);color:#ffdede;'
      + 'font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;z-index:2';
    box.textContent = '模组 ' + (inst.modId || '') + ' 渲染失败：' + msg;
    inst.container.appendChild(box);
  } catch (_) {}
}

/* Folia 的时钟是一个对象，不是数字：ctx.currentTime.get() 取当前秒，
 * ctx.currentTime.on('change', cb) 订阅并返回退订函数（巨幕用的是这个）。
 * 逐字歌词那一路叫 ctx.lyricTime，接口同形（跳一跳用的是这个）。
 * 两个指向同一条时间轴，共用一个订阅表 —— 以前这里错写成返回数字，
 * 巨幕的 ctx.currentTime.get() 会直接 TypeError。 */
function foliaModBuildClock(inst) {
  return {
    get: function () {
      var live = inst.live || {};
      var t = Number(live.time);
      return isFinite(t) ? t : 0;
    },
    /* event 只支持 'change'（Folia 也只有这一种）；未知事件给个空退订，不抛。 */
    on: function (event, cb) {
      if (event !== 'change' || typeof cb !== 'function') return function () {};
      inst.timeListeners.push(cb);
      return function () {
        var i = inst.timeListeners.indexOf(cb);
        if (i >= 0) inst.timeListeners.splice(i, 1);
      };
    }
  };
}

/* 模组侧的 ctx：只在需要「跟着宿主变」的字段上用 getter，其余是稳定方法。 */
function foliaModBuildContext(inst) {
  var clock = foliaModBuildClock(inst);
  var ctx = {
    lyricTime: clock,
    get currentTime() { return clock; },
    get lines() { return (inst.live && inst.live.lines) || []; },
    get song() { return (inst.live && inst.live.song) || {}; },
    get staticMode() { return !!(inst.live && inst.live.staticMode); },
    get staticLineIndex() {
      var live = inst.live || {};
      return isFinite(Number(live.staticLineIndex)) ? Number(live.staticLineIndex) : -1;
    },
    getTheme: function () { return (inst.live && inst.live.theme) || {}; },
    /* 音频能量（0..1）与频谱段：町景的雨量、霓虹呼吸跟着它走。
     * 宿主没采到（没在播 / 分析没跑）时给 power:0，样式侧自己兜。 */
    getAudio: function () { return (inst.live && inst.live.audio) || { power: 0, beat: 0, bands: {} }; },
    /* 永远读归一化后的那一份（面板改完立刻生效），不是 mount 时的快照。 */
    getSettings: function () { return foliaModSettingsFor(inst.modeId); },
    getLineIndex: function () {
      var live = inst.live || {};
      return isFinite(Number(live.index)) ? Number(live.index) : -1;
    },
    getDisplay: function () {
      var live = inst.live || {};
      return {
        showText: live.showText !== false,
        showTranslation: live.showTranslation !== false,
        fontScale: isFinite(Number(live.fontScale)) ? Number(live.fontScale) : 1
      };
    },
    /* 本项目的世界自己画背景，舞台对模组来说永远不透明、且宿主已铺背景。 */
    getSurface: function () { return { transparent: false, hostBackground: true }; },
    onLyricTime: function (cb) {
      if (typeof cb !== 'function') return function () {};
      inst.timeListeners.push(cb);
      return function () {
        var i = inst.timeListeners.indexOf(cb);
        if (i >= 0) inst.timeListeners.splice(i, 1);
      };
    },
    onChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      inst.changeListeners.push(cb);
      return function () {
        var i = inst.changeListeners.indexOf(cb);
        if (i >= 0) inst.changeListeners.splice(i, 1);
      };
    }
  };
  return ctx;
}

function foliaModNotify(list, arg, inst) {
  for (var i = 0; i < list.length; i++) {
    try { list[i](arg); } catch (err) { foliaModFail(inst, err); }
  }
}

/* 每帧由 registerFoliaMode 的 tick 驱动：时间变了就推 onLyricTime，输入变了就推 onChange。
 * 主题对象本身是引用稳定的（foliaWorldTheme 有 key 缓存），所以直接比引用，
 * 不用拼字符串——这是每帧都要跑的路径。 */
function foliaModDriveInstance(inst) {
  if (!inst || inst.disposed) return;
  var live = inst.live || {};

  var t = Number(live.time);
  if (isFinite(t) && t !== inst.lastTime) {
    inst.lastTime = t;
    foliaModNotify(inst.timeListeners, t, inst);
  }

  var theme = live.theme || null;
  var count = live.lines ? live.lines.length : 0;
  if (live.index !== inst.lastIndex || count !== inst.lastCount || theme !== inst.lastTheme
      || live.showText !== inst.lastShowText || live.showTranslation !== inst.lastShowTranslation
      || live.fontScale !== inst.lastFontScale) {
    inst.lastIndex = live.index;
    inst.lastCount = count;
    inst.lastTheme = theme;
    inst.lastShowText = live.showText;
    inst.lastShowTranslation = live.showTranslation;
    inst.lastFontScale = live.fontScale;
    foliaModNotify(inst.changeListeners, undefined, inst);
  }
}

/* 把模组的参数面板挂进原生调参面板的注册表（FOLIA_TUNING_PANEL_REGISTRY.mode）。
 * 挂进去之后：切到这个样式 → foliaBuildTuningPanel 自动铺出这张表；
 * 没挂的样式（含所有模组以外、还没移植面板的原生样式）照旧整块藏起来。 */
function foliaModRegisterSettingsPanel(modeId) {
  var schema = foliaModSchemas[modeId];
  if (!Array.isArray(schema) || !schema.length) return;
  if (typeof FOLIA_TUNING_PANEL_REGISTRY === 'undefined' || !FOLIA_TUNING_PANEL_REGISTRY
      || !FOLIA_TUNING_PANEL_REGISTRY.mode) {
    console.warn('[FoliaMod] 找不到调参面板注册表，参数面板未挂载:', modeId);
    return;
  }
  FOLIA_TUNING_PANEL_REGISTRY.mode[modeId] = {
    build: function (host, opts) { foliaModBuildSettingsPanel(host, opts, modeId); }
  };
}

/* 把模组登记的一条 visualizer 映射成本项目的模式定义。 */
function foliaModRegisterVisualizer(entry, modMeta) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.mount !== 'function') {
    foliaModHost.errors.push({ id: (modMeta && modMeta.id) || '?', error: 'visualizer 条目缺少 id/mount' });
    return null;
  }
  if (getFoliaMode(entry.id)) {
    console.warn('[FoliaMod] 样式 id 与已有样式冲突，已跳过:', entry.id);
    return null;
  }
  var schema = Array.isArray(entry.settings) ? entry.settings : [];
  var modId = (modMeta && modMeta.id) || entry.id;

  var def = {
    id: entry.id,
    name: foliaModLabelText(entry.label, entry.id),
    desc: String((modMeta && modMeta.description) || '') || ('Folium 模组 · ' + modId),
    order: isFinite(Number(entry.order)) ? Number(entry.order) : 500,
    create: function (host, foliaCtx) {
      var container = document.createElement('div');
      container.className = 'folia-mod-mount';
      container.setAttribute('data-folium-mode', entry.id);
      container.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
      host.appendChild(container);

      var inst = {
        modId: modId,
        modeId: entry.id,
        container: container,
        cleanup: null,
        /* create 阶段就要把 ctx 挂上：模组在 mount 里读 ctx.lines 建程序，
         * 等到第一次 tick 才赋值的话，它拿到的是空歌词 —— 巨幕只订阅时钟、
         * 不订阅 onChange，于是永远停在空程序上，画出一片黑。 */
        live: foliaCtx || null,
        settings: null,
        timeListeners: [],
        changeListeners: [],
        lastTime: NaN,
        lastIndex: undefined,
        lastCount: -1,
        lastTheme: null,
        lastShowText: undefined,
        lastShowTranslation: undefined,
        lastFontScale: undefined,
        errorShown: false,
        disposed: false
      };
      inst.settings = foliaModSettingsFor(entry.id);
      foliaModInstances[entry.id] = inst;
      try {
        /* ctx 留在实例上：模组自己基本用不到，但排查「面板改了画面没变」时
         * 能直接问一句 ctx.getSettings() 看读到的是什么。 */
        inst.ctx = foliaModBuildContext(inst);
        inst.cleanup = entry.mount(container, inst.ctx);
      } catch (err) {
        foliaModFail(inst, err);
      }
      return inst;
    },
    tick: function (inst, foliaCtx) {
      if (!inst || inst.disposed) return;
      inst.live = foliaCtx;
      foliaModDriveInstance(inst);
    },
    destroy: function (inst) {
      if (!inst) return;
      inst.disposed = true;
      if (foliaModInstances[inst.modeId] === inst) delete foliaModInstances[inst.modeId];
      try { if (typeof inst.cleanup === 'function') inst.cleanup(); } catch (err) {
        console.warn('[FoliaMod] 清理失败:', err);
      }
      inst.cleanup = null;
      try {
        if (inst.container && inst.container.parentNode) inst.container.parentNode.removeChild(inst.container);
      } catch (_) {}
      inst.container = null;
      inst.timeListeners.length = 0;
      inst.changeListeners.length = 0;
    }
  };

  var reg = registerFoliaMode(entry.id, def);
  if (reg) {
    foliaModSchemas[entry.id] = schema;
    foliaModMetas[entry.id] = { name: def.name, desc: def.desc };
    foliaModSettingsState[entry.id] = foliaModNormalizeSettings(schema, foliaModReadStore()[entry.id] || {});
    foliaModRegisterSettingsPanel(entry.id);
    foliaModHost.loaded.push({ id: modId, modeId: entry.id, dir: (modMeta && modMeta.dir) || '', name: def.name });
    console.log('[FoliaMod] 已注册样式', entry.id, '←', modId, '（' + schema.length + ' 项参数）');
  }
  return reg;
}

/* 分词：folium.lyrics.segmentWords(line) 返回 [{ segment, startTime?, endTime? }]。
 * 有逐字时间轴就照着切（跳一跳靠它逐字起跳），没有就用 Intl.Segmenter 按词切，
 * 连 Intl.Segmenter 都没有就整行一段 —— 跳一跳自己有「并碎字」的兜底，退化得下去。 */
var foliaModSegCache = new WeakMap();

function foliaModSegmentWords(line) {
  if (!line || typeof line !== 'object') return [];
  var cached = foliaModSegCache.get(line);
  if (cached) return cached;

  var out = [];
  var words = line.words;
  if (Array.isArray(words) && words.length) {
    for (var i = 0; i < words.length; i++) {
      var w = words[i] || {};
      var text = String(w.text != null ? w.text : (w.segment != null ? w.segment : ''));
      if (!text) continue;
      var item = { segment: text };
      if (isFinite(Number(w.startTime))) item.startTime = Number(w.startTime);
      if (isFinite(Number(w.endTime))) item.endTime = Number(w.endTime);
      out.push(item);
    }
  }

  if (!out.length) {
    var full = String(line.fullText || '');
    if (full) {
      try {
        if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
          var it = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(full);
          var parts = Array.from(it, function (s) { return { segment: s.segment }; });
          if (parts.length) out = parts;
        }
      } catch (_) {}
      if (!out.length) out = [{ segment: full }];
    }
  }

  foliaModSegCache.set(line, out);
  return out;
}

/* 给模组的 folium 对象。只实现这两个模组实际用到的面：visualizers.register / lyrics / log / theme。 */
function foliaModBuildHostApi(modMeta) {
  return {
    version: FOLIUM_HOST_VERSION,
    mod: { id: modMeta.id, version: modMeta.version, dir: modMeta.dir },
    lyrics: {
      segmentWords: foliaModSegmentWords,
      segmentGraphemes: function (text) {
        var s = String(text || '');
        if (!s) return [];
        try {
          if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
            return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s),
              function (g) { return { segment: g.segment }; });
          }
        } catch (_) {}
        return Array.from(s, function (ch) { return { segment: ch }; });
      }
    },
    log: {
      info: function () { console.log.apply(console, arguments); },
      warn: function () { console.warn.apply(console, arguments); },
      error: function () { console.error.apply(console, arguments); }
    },
    theme: {
      resolveFontStack: function (theme) {
        return (theme && (theme.fontStack || theme.fontFamily)) || 'system-ui, "Noto Sans SC", sans-serif';
      },
      resolveTranslationFontStack: function (theme) {
        return (theme && (theme.translationFontStack || theme.fontStack || theme.fontFamily))
          || 'system-ui, "Noto Sans SC", sans-serif';
      },
      /* 模组（跳一跳）用 resolveFontWeight(theme, 兜底) 取字重；本项目的主题把字重放在 theme.weight。 */
      resolveFontWeight: function (theme, fallback) {
        var w = Number(theme && (theme.weight != null ? theme.weight : theme.fontWeight));
        if (isFinite(w) && w > 0) return Math.max(100, Math.min(900, Math.round(w)));
        var f = Number(fallback);
        return isFinite(f) && f > 0 ? f : 600;
      }
    },
    registries: {
      visualizers: {
        register: function (entry) { return foliaModRegisterVisualizer(entry, modMeta); }
      },
      /* v1 不支持模组背景：静默忽略，别让模组因为缺能力而报错。 */
      backgrounds: {
        register: function () { return null; }
      }
    }
  };
}

/* 模组目录 → 绝对 URL。
 * 动态 import() 的说明符规则和 fetch 不同：'folia-mods/x/client.mjs' 这种既不以 ./
 * 开头、也不是绝对路径的写法会被当成裸包名，直接 "Failed to resolve module specifier"。
 * 统一用 document.baseURI 拼绝对地址，两个模组和清单都走这里。 */
function foliaModUrl(rel) {
  try { return new URL(rel, document.baseURI).href; } catch (_) { return rel; }
}

function foliaModLoadOne(item) {
  if (!item || !item.dir || item.enabled === false) return Promise.resolve();
  var dir = 'folia-mods/' + item.dir + '/';
  var meta = null;
  return fetch(foliaModUrl(dir + 'mod.json'), { cache: 'no-cache' })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('mod.json HTTP ' + (r && r.status));
      return r.json();
    })
    .then(function (m) {
      meta = Object.assign({}, m || {});
      meta.dir = (item && item.dir) || '';
      if (!meta.id) meta.id = String(item.dir);
      return import(foliaModUrl(dir + (meta.client || 'client.mjs')));
    })
    .then(function (mod) {
      var activate = mod && (mod.default || mod.activate);
      if (typeof activate !== 'function') throw new Error('client 未导出 activate()');
      activate(foliaModBuildHostApi(meta));
    })
    .catch(function (err) {
      var msg = String((err && err.message) || err);
      foliaModHost.errors.push({ id: (item && item.dir) || '?', error: msg });
      console.warn('[FoliaMod] 加载失败', item && item.dir, msg);
    });
}

/* 读档比模组注册早：存档里存的是 'jump-course' 时，readFoliaWorldPrefs() 那一刻
 * 这个样式还不存在，会被当成「已移除的样式」校正回 classic。等模组加载完再把
 * 用户的选择捡回来 —— 否则「选了跳一跳，重启后变回流光」看着像模组没生效。 */
function foliaModRestoreSavedMode() {
  try {
    var raw = JSON.parse(localStorage.getItem(FOLIA_WORLD_STORE_KEY) || '{}') || {};
    var want = raw.mode;
    if (!want || typeof want !== 'string') return;
    if (typeof foliaWorld === 'undefined' || !foliaWorld) return;
    if (foliaWorld.mode === want) return;
    if (typeof getFoliaMode !== 'function' || !getFoliaMode(want)) return;
    if (foliaWorld.active && typeof foliaWorldSetMode === 'function') {
      foliaWorldSetMode(want);
    } else {
      foliaWorld.mode = want;
      if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
    }
    console.log('[FoliaMod] 已恢复存档样式', want);
  } catch (_) {}
}

/* 依次加载清单里的模组（串行：顺序稳定，报错好定位）。 */
function foliaModHostLoad() {
  if (foliaModHost.loading) return foliaModHost.loading;
  foliaModHost.loading = fetch(foliaModUrl('folia-mods/manifest.json'), { cache: 'no-cache' })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('manifest HTTP ' + (r && r.status));
      return r.json();
    })
    .then(function (manifest) {
      var list = (manifest && manifest.mods) || [];
      var chain = Promise.resolve();
      for (var i = 0; i < list.length; i++) {
        (function (item) {
          chain = chain.then(function () { return foliaModLoadOne(item); });
        })(list[i]);
      }
      return chain;
    })
    .then(function () {
      foliaModRestoreSavedMode();
      if (typeof foliaWorldBuildModeGrid === 'function') {
        try { foliaWorldBuildModeGrid(); } catch (_) {}
      }
      /* 模组样式可能已经开着（存档恢复），参数面板要立刻补上。 */
      if (typeof foliaRefreshTuningPanel === 'function') {
        try { foliaRefreshTuningPanel(); } catch (_) {}
      }
      console.log('[FoliaMod] 就绪：' + foliaModHost.loaded.length + ' 个样式，'
        + foliaModHost.errors.length + ' 个失败');
      return foliaModHost.loaded;
    })
    .catch(function (err) {
      var msg = String((err && err.message) || err);
      foliaModHost.errors.push({ id: '(manifest)', error: msg });
      console.warn('[FoliaMod] 模组清单加载失败:', msg);
      return [];
    });
  return foliaModHost.loading;
}

/* 启动：让出首屏之后再去拉模组文件（ESM 下载 + 求值不该压在进入主界面的主线程上）。
 *
 * 但不能只挂在 window load 上。首页那张带 token 的封面图来自上游 CDN，实测偶尔要 26 秒
 * 才 load 完：DOMContentLoaded 在 2.4s 就到了，load 却被拖到 30.3s（实测 loadAt=30280）。
 * 模组等 load 于是 30 秒后才注册，用户打开面板只看到 14 个原生样式，看着就像「接入的样式
 * 被删了」。改成 DOMContentLoaded 后就开始，load 只当兜底，谁先到谁触发（go 自带闸门，
 * 重复调用无害）。 */
(function foliaModScheduleLoad() {
  var started = false;
  function go() {
    if (started) return;
    started = true;
    try { foliaModHostLoad(); } catch (err) { console.warn('[FoliaMod] 启动失败', err); }
  }
  function armAfter(ms) { setTimeout(go, ms); }
  if (document.readyState === 'complete') { armAfter(1200); return; }
  /* 已经是 interactive：DOMContentLoaded 早就过去了，直接排。 */
  if (document.readyState !== 'loading') { armAfter(2000); return; }
  document.addEventListener('DOMContentLoaded', function () { armAfter(2000); }, { once: true });
  /* 兜底：DOMContentLoaded 万一被同步脚本压住，load 到了也照样起。 */
  window.addEventListener('load', function () { armAfter(600); }, { once: true });
})();

window.foliaModHostLoad = foliaModHostLoad;
window.foliaModHostState = foliaModHost;
