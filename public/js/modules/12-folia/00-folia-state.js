/* Folia 世界 — 状态、持久化、数据适配
 *
 * 「Folia 世界」与现有预设互斥：开启时画面交给 Folia 的歌词样式，
 * 原有 Three.js 场景 / 3D 歌词 / 预设专属子系统全部停画，但音频分析、
 * 歌词推进与校时、封面取色、播放状态继续跑（Folia 靠它们吃饭）。
 *
 * 本文件只放状态与纯函数，不碰 DOM 结构（渲染在 03-folia-world-runtime.js）。
 * 新增函数一律带 foliaWorld / Folia 前缀，避免与本项目 125 模块合并作用域重名。
 */
'use strict';

var FOLIA_WORLD_STORE_KEY = 'mineradio-folia-world-v1';

var foliaWorld = {
  active: false,        // 是否真的在渲染（由 enter/exit 维护，不来自存档）
  wantActive: false,    // 存档里的「用户希望开着」，只在开屏结束后由 restore 消费
  mode: 'classic',      // 歌词样式 id（Folia DEFAULT_VISUALIZER_MODE = classic / 流光）
  background: 'none',   // 背景 id
  intensity: 'normal',  // Folia 主题级动效强度：calm / normal / chaotic
  supported: null,      // WebGL2 探测结果：null=未探测
  failReason: '',
  root: null,           // #folia-world-root
  instance: null,       // 当前模式的运行时实例
  bgHost: null,         // 背景宿主（root 的第一个子节点，模式宿主盖在它上面）
  bgInstance: null,     // 当前背景实例
  bgDef: null           // 当前背景的注册项
};

var FOLIA_WORLD_INTENSITIES = ['calm', 'normal', 'chaotic'];

function readFoliaWorldPrefs() {
  try {
    var raw = JSON.parse(localStorage.getItem(FOLIA_WORLD_STORE_KEY) || '{}') || {};
    /* active 只表示「想开」，不能直接写进 foliaWorld.active：
     * 那样会造出「开关是开的、但实例没建、画面是原生」的半死状态，
     * 而且 foliaWorldEnter 见到 active 就早退，永远补不上实例。 */
    if (typeof raw.active === 'boolean') foliaWorld.wantActive = raw.active;
    if (typeof raw.mode === 'string' && raw.mode) foliaWorld.mode = raw.mode;
    if (typeof raw.background === 'string' && raw.background) foliaWorld.background = raw.background;
    if (FOLIA_WORLD_INTENSITIES.indexOf(raw.intensity) >= 0) foliaWorld.intensity = raw.intensity;
    /* 存档里的 id 可能指向已经不存在的样式/背景（棱镜、星潮已移除）。
     * 运行时对未知 id 有兜底（模式→still，背景→none），但那样面板里会
     * 「实际在画 A、卡片高亮却是 B」。这里在读档时就校正回默认值。 */
    if (typeof getFoliaMode === 'function' && !getFoliaMode(foliaWorld.mode)) foliaWorld.mode = 'classic';
    if (typeof hasFoliaBackground === 'function' && !hasFoliaBackground(foliaWorld.background)) foliaWorld.background = 'none';
  } catch (_) {}
  return foliaWorld;
}

function saveFoliaWorldPrefs() {
  try {
    localStorage.setItem(FOLIA_WORLD_STORE_KEY, JSON.stringify({
      active: !!foliaWorld.active,
      mode: foliaWorld.mode || 'classic',
      background: foliaWorld.background || 'none',
      intensity: foliaWorld.intensity || 'normal'
    }));
  } catch (_) {}
}

function foliaWorldSetIntensity(level) {
  if (FOLIA_WORLD_INTENSITIES.indexOf(level) < 0) return;
  foliaWorld.intensity = level;
  saveFoliaWorldPrefs();
  if (typeof refreshFoliaWorldUi === 'function') refreshFoliaWorldUi();
}

/* Folia 的 Pixi 类模式要 WebGL2；DOM/Canvas 类模式不需要。
 * 这里只在开启前探测一次并缓存结果，失败时给出明确原因（回落必须可见）。 */
function foliaWorldSupportsWebGL2() {
  if (foliaWorld.supported !== null) return foliaWorld.supported;
  var ok = false;
  try {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext && canvas.getContext('webgl2');
    ok = !!gl;
    if (gl && gl.getExtension) {
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (_) {
    ok = false;
  }
  foliaWorld.supported = ok;
  return ok;
}

function foliaWorldActive() {
  return !!(foliaWorld.active && foliaWorld.supported !== false);
}

/* ---- 主题适配：把本项目的歌词配色/字体转换成 Folia 的 theme 形状 ---- */

/* Folia 的 Theme 里每个模式都会读的字段：
 *   primaryColor / secondaryColor / accentColor / backgroundColor / fontStack /
 *   weight / fontStyle / animationIntensity / wordColors
 * 每帧都会取一次，所以按「输入指纹」缓存，避免每帧重新解析调色板与字体栈。 */
var foliaWorldThemeCache = { key: '', theme: null };

function foliaWorldTheme() {
  var pal = { primary: '#d6f8ff', secondary: '#9cffdf', highlight: '#eef7ff' };
  try {
    if (typeof effectiveLyricPalette === 'function') {
      var live = effectiveLyricPalette(null);
      if (live) pal = live;
    }
  } catch (_) {}

  var fontStack = 'system-ui, "Noto Sans SC", "Microsoft YaHei", sans-serif';
  try {
    if (typeof lyricFontStackForKey === 'function') {
      var stack = lyricFontStackForKey(fx && fx.lyricFont);
      if (stack) fontStack = stack;
    }
  } catch (_) {}

  var weight = 700;
  try {
    var w = Number(fx && fx.lyricWeight);
    if (isFinite(w)) weight = Math.max(100, Math.min(900, Math.round(w / 10) * 10));
  } catch (_) {}

  var bg = '#05070b';
  try {
    if (fx && fx.backgroundColorMode === 'solid' && /^#[0-9a-fA-F]{6}$/.test(String(fx.backgroundColor || ''))) {
      bg = fx.backgroundColor;
    }
  } catch (_) {}

  /* 字体类别只用来选译文栈（Folia 的 sans/serif/mono 三套），从实际字体栈里猜一次即可。 */
  var fontStyle = 'sans';
  if (/serif|Songti|SimSun|Georgia|宋/i.test(fontStack)) fontStyle = 'serif';
  else if (/mono|Consolas|Menlo|Mono/i.test(fontStack)) fontStyle = 'mono';

  var intensity = FOLIA_WORLD_INTENSITIES.indexOf(foliaWorld.intensity) >= 0 ? foliaWorld.intensity : 'normal';
  var key = [pal.primary, pal.secondary, pal.highlight, fontStack, weight, bg, intensity].join('|');
  if (foliaWorldThemeCache.key === key && foliaWorldThemeCache.theme) return foliaWorldThemeCache.theme;

  var theme = {
    primaryColor: pal.primary || '#d6f8ff',
    secondaryColor: pal.secondary || '#9cffdf',
    accentColor: pal.highlight || '#eef7ff',
    backgroundColor: bg,
    fontStack: fontStack,
    translationFontStack: foliaTranslationFontStack(fontStyle),
    weight: weight,
    fontStyle: fontStyle,
    animationIntensity: intensity,
    /* 本项目没有「关键词着色」映射表，交给 resolveWordColor 走 accentColor 兜底。 */
    wordColors: []
  };
  foliaWorldThemeCache = { key: key, theme: theme };
  return theme;
}

/* Folia 译文栈（utils/fontStacks.ts 的 TRANSLATION_FONT_STACKS.sans / serif / mono）。 */
function foliaTranslationFontStack(fontStyle) {
  if (fontStyle === 'serif') {
    return '"Iowan Old Style", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif';
  }
  if (fontStyle === 'mono') {
    return 'Consolas, "IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, "Sarasa Mono SC", "Noto Sans Mono CJK SC", monospace';
  }
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
}


/* ---- 歌词适配：本项目 { t, text, translation, words:{t,d} } → Folia Line ---- */
var foliaWorldLineCache = { ref: null, len: 0, lines: [] };

function foliaWorldLines() {
  var src = (typeof lyricsLines !== 'undefined' && lyricsLines) ? lyricsLines : [];
  if (foliaWorldLineCache.ref === src && foliaWorldLineCache.len === src.length) {
    return foliaWorldLineCache.lines;
  }
  var out = [];
  var i, j;
  for (i = 0; i < src.length; i++) {
    var line = src[i] || {};
    var start = Number(line.startTime != null ? line.startTime : line.t);
    if (!isFinite(start)) start = 0;
    var words = [];
    if (line.words && line.words.length) {
      for (j = 0; j < line.words.length; j++) {
        var w = line.words[j] || {};
        var ws = Number(w.startTime != null ? w.startTime : w.t);
        if (!isFinite(ws)) ws = start;
        var we = Number(w.endTime);
        if (!isFinite(we)) {
          var wd = Number(w.d);
          we = ws + (isFinite(wd) ? Math.max(0.08, wd) : 0.24);
        }
        words.push({ text: String(w.text || ''), startTime: ws, endTime: we });
      }
    }
    out.push({
      startTime: start,
      endTime: 0,
      fullText: String(line.fullText != null ? line.fullText : (line.text || '')),
      translation: String(line.translation || ''),
      words: words
    });
  }
  for (i = 0; i < out.length; i++) {
    if (out[i + 1]) {
      out[i].endTime = out[i + 1].startTime;
    } else {
      var dur = Number(src[i] && src[i].duration);
      out[i].endTime = out[i].startTime + (isFinite(dur) && dur > 0 ? dur : 4.8);
    }
  }
  foliaWorldLineCache = { ref: src, len: src.length, lines: out };
  return out;
}

/* ---- 时钟：复用原生歌词同一条时间轴（含歌词校时偏移） ---- */
function foliaWorldPlaybackTime() {
  try {
    if (typeof getAdjustedLyricPlaybackTime === 'function' && typeof stageLyricPlaybackSeconds === 'function') {
      var t = Number(getAdjustedLyricPlaybackTime(stageLyricPlaybackSeconds()));
      if (isFinite(t)) return t;
    }
  } catch (_) {}
  try {
    if (typeof audio !== 'undefined' && audio && isFinite(Number(audio.currentTime))) {
      return Number(audio.currentTime);
    }
  } catch (_) {}
  return 0;
}

function foliaWorldLineIndexAt(time, lines) {
  var idx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].startTime <= time + 0.05) idx = i;
    else break;
  }
  return idx;
}

/* ---- 音频适配：主循环每帧算好的低/中/高与能量 ---- */
function foliaWorldAudio() {
  var safe = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  /* Folia 的 audioBands 是 5 段（bass/lowMid/mid/vocal/treble）+ 一条原始频谱。
   * 本项目 legacy 三段里没有 lowMid：优先取 sonicBandSmooth.lowMid（11-main-loop 的
   * 七段平滑），没有时用 bass/mid 的几何均值兜底 —— 直接抄 bass 会让音频条中段塌陷。 */
  var lowMid = 0;
  try {
    if (typeof sonicBandSmooth !== 'undefined' && sonicBandSmooth) lowMid = safe(sonicBandSmooth.lowMid);
  } catch (_) {}
  if (!(lowMid > 0)) lowMid = Math.sqrt(Math.max(safe(typeof bass !== 'undefined' ? bass : 0), 0) * Math.max(safe(typeof mid !== 'undefined' ? mid : 0), 0));
  var spectrum = null;
  try {
    if (typeof frequencyData !== 'undefined' && frequencyData && frequencyData.length) spectrum = frequencyData;
  } catch (_) {}
  return {
    power: safe(typeof audioEnergy !== 'undefined' ? audioEnergy : 0),
    beat: safe(typeof beatPulse !== 'undefined' ? beatPulse : 0),
    spectrum: spectrum,
    bands: {
      bass: safe(typeof bass !== 'undefined' ? bass : 0),
      lowMid: lowMid,
      mid: safe(typeof mid !== 'undefined' ? mid : 0),
      treble: safe(typeof treble !== 'undefined' ? treble : 0),
      /* Folia 的 audioBands 是 5 段（bass/lowMid/mid/vocal/treble）。本项目只有 legacy 三段，
       * 人声段单独存成 audioVocal（200-3000Hz 归一化，见 00-state/12a 与 11-main-loop）。 */
      vocal: safe(typeof audioVocal !== 'undefined' ? audioVocal : 0)
    }
  };
}
