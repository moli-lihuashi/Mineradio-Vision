/* 町景（machi）—— Folium v1 模组 · 三套日式/港式夜景 3D 场景：便利店、站台、九龙城寨
 *
 * 官方实现：https://github.com/chthollyphile/folia-major （AGPL-3.0，main）
 * 本目录 `mc/` 里是按 import 闭包机械移植的原文件（只剥类型、改 import），
 * 本文件是宿主适配层：官方那层 React 外壳（VisualizerMachi.tsx）在这里换成 mount/cleanup。
 *
 * 与官方外壳的对应关系（逐条）：
 *   外壳 useVisualizerMachiHost 建运行时 → 这里 mount 建一次，换歌走 swapSong（场景内部自己淡入淡出）
 *   MotionValue currentTime                  → ctx.currentTime 是 { get(), on() }，**没有 set**
 *   外壳的 audioPower（音频能量 0..1）        → ctx.getAudio().power
 *   theme / tuning / showText                → ctx.getTheme() / getSettings() / getDisplay()
 *   节拍、鼓点、图标、渲染质量挡位、设置 store → mc/_stubs.mjs（宿主不提供这些服务）
 *
 * 两个必须注意的点：
 *   1. `MachiRuntime.create` 里第一句就是 `throwIfAborted(options.signal)`，signal 不给直接 TypeError。
 *   2. 运行时里 `options.currentTime.set(...)` 是有的（调试钩子 renderAt 用），宿主 clock 没 set，
 *      所以这里包一层可写时钟：读穿透到宿主，写吞掉（拖进度条由宿主推时间，不需要模组回写）。
 *
 * 为什么 mount 不能返回 Promise：`17-folia-mod-host.js` 是 `inst.cleanup = entry.mount(...)`，
 * 拿到 Promise 就当不成清理函数了。所以同步返回 cleanup，异步建运行时在内部跑，用 disposed 兜住。
 */

import { MachiRuntime } from './mc/components_visualizer_machi_createMachiRuntime.mjs';
import { normalizeMachiTuning } from './mc/components_visualizer_machi_machiTuning.mjs';
import {
  MACHI_QUALITY_PRESETS, MACHI_QUALITY_REVISION,
} from './mc/components_visualizer_machi_types.mjs';

const G = {
  scene: { 'zh-CN': '场景', en: 'Scene' },
  env: { 'zh-CN': '时间与天气', en: 'Time & weather' },
  lens: { 'zh-CN': '镜头', en: 'Camera' },
  dof: { 'zh-CN': '景深', en: 'Depth of field' },
  quality: { 'zh-CN': '画质', en: 'Quality' },
};

const num = (key, group, label, desc, min, max, step, def) => ({
  key, type: 'number', group, label, description: desc, min, max, step, defaultValue: def,
});
const bool = (key, group, label, desc, def) => ({
  key, type: 'boolean', group, label, description: desc, defaultValue: def,
});
const pick = (key, group, label, desc, options, def) => ({
  key, type: 'select', group, label, description: desc, options, defaultValue: def,
});
const opt = (value, zh, en) => ({ value, label: { 'zh-CN': zh, en } });

const SCENE_OPTIONS = [
  opt('auto', '随歌', 'By song'),
  opt('konbini', '便利店', 'Konbini'),
  opt('station', '站台', 'Station'),
  opt('kowloon', '九龙城', 'Kowloon'),
];
const TIME_OPTIONS = [
  opt('auto', '跟随现实', 'Follow clock'),
  opt('day', '白天', 'Day'),
  opt('dusk', '黄昏', 'Dusk'),
  opt('night', '深夜', 'Night'),
];
const WEATHER_OPTIONS = [
  opt('auto', '随歌', 'By song'),
  opt('clear', '晴', 'Clear'),
  opt('rain', '雨', 'Rain'),
  opt('snow', '雪', 'Snow'),
  opt('fog', '雾', 'Fog'),
];
const FOCUS_OPTIONS = [
  opt('center', '对画面中心', 'Screen centre'),
  opt('lyrics', '对歌词招牌', 'Lyric board'),
  opt('manual', '手动', 'Manual'),
];
const QUALITY_OPTIONS = [
  opt('high', '高', 'High'),
  opt('balanced', '均衡', 'Balanced'),
  opt('low', '省电', 'Low'),
];

const SCHEMA = [
  pick('scene', G.scene,
    { 'zh-CN': '取景地', en: 'Location' },
    { 'zh-CN': '便利店、站台、九龙城寨三套夜色街区；「随歌」按歌名散列挑一个，换歌可能换景。', en: 'Three night-time street sets. "By song" hashes the title.' },
    SCENE_OPTIONS, 'auto'),
  pick('timeOfDay', G.env,
    { 'zh-CN': '时段', en: 'Time of day' },
    { 'zh-CN': '天色。「跟随现实」按本机时间自动在白天/黄昏/深夜之间过。', en: 'Sky state; "Follow clock" uses local time.' },
    TIME_OPTIONS, 'auto'),
  pick('weather', G.env,
    { 'zh-CN': '天气', en: 'Weather' },
    { 'zh-CN': '雨雪雾与地面湿反光都从这里走。', en: 'Rain, snow, fog and wet ground reflections.' },
    WEATHER_OPTIONS, 'auto'),

  bool('motion', G.lens,
    { 'zh-CN': '镜头游移', en: 'Camera drift' },
    { 'zh-CN': '镜头自己缓慢漂移；关掉就是固定机位（更省，也更稳）。', en: 'Slow automatic camera drift.' },
    true),
  num('motionSpeed', G.lens,
    { 'zh-CN': '游移速度', en: 'Drift speed' },
    { 'zh-CN': '镜头漂移的快慢。默认 1。', en: 'How fast the camera drifts. Default 1.' },
    0.25, 3, 0.05, 1),
  num('tiltShift', G.lens,
    { 'zh-CN': '移轴', en: 'Tilt-shift' },
    { 'zh-CN': '上下虚化的移轴感，做「微缩模型」的味道。0 关。默认 0.3。', en: 'Tilt-shift miniature look. Default 0.3.' },
    0, 1, 0.05, 0.3),

  num('aperture', G.dof,
    { 'zh-CN': '光圈', en: 'Aperture' },
    { 'zh-CN': '数值越小景深越浅、光斑越大。官方档位 1.4~16，默认 8。', en: 'Lower f-number = shallower focus. Default 8.' },
    1.4, 16, 0.1, 8),
  num('dof', G.dof,
    { 'zh-CN': '虚化强度', en: 'Blur amount' },
    { 'zh-CN': '离焦点远近的虚化力度。0 全清。默认 1。', en: 'Out-of-focus blur strength. Default 1.' },
    0, 2, 0.05, 1),
  num('dofRange', G.dof,
    { 'zh-CN': '清晰范围', en: 'Focus range' },
    { 'zh-CN': '多大一片区域保持清晰。越大越接近全景清晰。默认 1。', en: 'Size of the in-focus band. Default 1.' },
    0.3, 3, 0.05, 1),
  pick('focus', G.dof,
    { 'zh-CN': '对焦点', en: 'Focus point' },
    { 'zh-CN': '镜头对在哪：画面中心、歌词招牌，还是手动微调。', en: 'Where the lens focuses.' },
    FOCUS_OPTIONS, 'center'),
  num('focusOffset', G.dof,
    { 'zh-CN': '对焦偏移', en: 'Focus offset' },
    { 'zh-CN': '只在「手动」对焦时生效：负数往近处拉，正数往远处推。', en: 'Only used with manual focus.' },
    -10, 10, 0.1, 0),

  pick('qualityPreset', G.quality,
    { 'zh-CN': '画质挡位', en: 'Quality preset' },
    { 'zh-CN': '高：全局分辨率 + SMAA + 高阴影高反射；均衡：FXAA + 低阴影低反射；省电：0.75 倍分辨率、关阴影关反射关泛光。', en: 'High / Balanced / Low presets.' },
    QUALITY_OPTIONS, 'high'),
];

/* 主题对象里没有的字段（wordColors / lyricsIcons）运行时都做了 ?? 兜底，直接传即可。 */

/* 宿主设置是扁平的 key→值；折回官方 tuning 形状（normalizeMachiTuning 会补齐和夹值）。
 * camera / views 不开放：自定义机位要每种场景一组旋转滑块，面板放不下，保持官方默认机位。 */
function readTuning(raw) {
  const s = raw || {};
  const n = (k, d) => (isFinite(Number(s[k])) ? Number(s[k]) : d);
  const preset = MACHI_QUALITY_PRESETS[s.qualityPreset] || MACHI_QUALITY_PRESETS.high;
  return normalizeMachiTuning({
    scene: s.scene || 'auto',
    timeOfDay: s.timeOfDay || 'auto',
    weather: s.weather || 'auto',
    motion: s.motion !== false,
    motionSpeed: n('motionSpeed', 1),
    aperture: n('aperture', 8),
    dof: n('dof', 1),
    dofRange: n('dofRange', 1),
    tiltShift: n('tiltShift', 0.3),
    focus: s.focus || 'center',
    focusOffset: n('focusOffset', 0),
    /* adaptive 关掉：邻里的「按帧耗时自动降档」靠 GPU 分析服务的活跃时间戳，
     * 宿主没这服务，桩恒 false → 官方逻辑会一直判「分析没在跑」，开着也没用还多一次分支。 */
    quality: { ...preset, adaptive: false, revision: MACHI_QUALITY_REVISION },
  });
}

/* ctx.lines 已经带 fullText / startTime / endTime / words，但 words 不保证存在；
 * 町景的 graphemeTiming 会直接读 line.words.length，缺一个就白屏。这里补齐并冻结形状。 */
function normalizeLines(lines) {
  const out = [];
  const src = Array.isArray(lines) ? lines : [];
  for (let i = 0; i < src.length; i++) {
    const raw = src[i] || {};
    const startTime = Number(raw.startTime);
    out.push({
      startTime: isFinite(startTime) ? startTime : 0,
      endTime: isFinite(Number(raw.endTime)) ? Number(raw.endTime) : 0,
      fullText: String(raw.fullText != null ? raw.fullText : (raw.text || '')),
      translation: String(raw.translation || ''),
      words: Array.isArray(raw.words) ? raw.words : [],
    });
  }
  return out;
}

function seedOf(song, lines) {
  const s = song || {};
  const base = [s.title, s.artist, s.album].filter(Boolean).join('/');
  if (base) return base;
  const first = lines && lines[0];
  return (first && first.fullText) || 'machi';
}

function mount(container, ctx) {
  const settings = () => ctx.getSettings() || {};
  const theme = () => ctx.getTheme() || {};
  const display = () => ctx.getDisplay() || { showText: true, fontScale: 1 };
  const audioPower = () => {
    try {
      const audio = ctx.getAudio ? ctx.getAudio() : null;
      const p = Number(audio && audio.power);
      return isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    } catch (_) { return 0; }
  };

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;overflow:hidden';
  container.appendChild(host);

  let disposed = false;
  let runtime = null;
  let tuning = readTuning(settings());
  let showText = display().showText !== false;
  let themeRef = theme();
  let songSig = '';
  let abort = null;

  /* 宿主的 clock 是只读的；町景调试钩子会 currentTime.set(...)，所以补一个可写外壳。 */
  const timeSource = {
    get: () => {
      const t = Number(ctx.currentTime && ctx.currentTime.get());
      return isFinite(t) ? t : 0;
    },
    on: (event, cb) => (ctx.currentTime && ctx.currentTime.on ? ctx.currentTime.on(event, cb) : () => {}),
    set: () => {},
  };
  /* 音频能量也是每帧读，同样包成 { get() }。 */
  const powerSource = { get: audioPower };

  const buildSong = () => {
    const lines = normalizeLines(ctx.lines);
    const s = ctx.song || {};
    return {
      seed: seedOf(s, lines),
      lines,
      title: String(s.title || ''),
      artist: String(s.artist || ''),
      album: String(s.album || ''),
    };
  };

  const quality = { scale: 1, antialias: 'fxaa' };

  /* WebGL 上下文丢失后的重建：官方外壳无条件重建。这里加两道保险——
   * ① 只重建 3 次（GPU 反复失联时无限重建会把渲染进程拖死）；
   * ② 每次之间隔 1.2s，给驱动/GPU 进程喘息。
   * 计数留在 window.__machi 上，验收探针与以后排查都看得到。 */
  let rebuilds = 0;

  const createRuntime = async () => {
    const song = buildSong();
    songSig = song.seed + '|' + song.lines.length;
    abort = new AbortController();
    const rt = await MachiRuntime.create({
      host,
      song,
      theme: themeRef,
      tuning,
      currentTime: timeSource,
      audioPower: powerSource,
      paused: false,
      staticMode: false,
      showText,
      previewMode: false,
      transparent: false,
      fallbackIcons: [],
      renderQuality: quality,
      signal: abort.signal,
      onViewChange: () => {},
      onSceneShown: () => {},
      onContextLost: () => {
        if (disposed) return;
        rebuilds += 1;
        const old = runtime;
        runtime = null;
        try { old && old.destroy(); } catch (_) {}
        if (disposed) return;
        if (rebuilds > 3) {
          console.warn('[machi] WebGL 上下文连续丢失 ' + rebuilds + ' 次，停止重建');
          try { container.dataset.machiFailed = 'webgl context lost x' + rebuilds; } catch (_) {}
          return;
        }
        try { window.__machi = { runtime: null, contextLost: rebuilds }; } catch (_) {}
        setTimeout(() => { if (!disposed) void createRuntime().catch(reportFailure); }, 1200);
      },
    });
    if (disposed) { try { rt.destroy(); } catch (_) {} return; }
    runtime = rt;
    runtime.setTuning(tuning);
    runtime.setShowText(showText);
    try { window.__machi = { runtime: rt }; } catch (_) {}
  };

  const reportFailure = (err) => {
    const msg = (err && (err.stack || err.message)) || String(err);
    if (err && err.name === 'AbortError') return;
    console.warn('[machi] 初始化失败:', err);
    /* 探针要看得到原因：console 在真机上不总是抓得到 */
    try { window.__machiError = msg; } catch (_) {}
    try { container.dataset.machiFailed = msg.slice(0, 400); } catch (_) {}
  };

  void createRuntime().catch(reportFailure);

  /* 换歌：官方走 swapSong（场景内部自己决定是重铺招牌还是整套换景）。
   * 签名带上首尾时间，重开同一首歌（时间轴被重算）也能触发。 */
  const applySong = () => {
    const lines = ctx.lines || [];
    const first = lines[0];
    const last = lines[lines.length - 1];
    const seed = seedOf(ctx.song || {}, lines);
    const next = seed + '|' + lines.length + '|' + ((first && first.startTime) || 0) + '|' + ((last && last.startTime) || 0);
    if (next === songSig) return;
    songSig = next;
    if (!runtime) return;
    try {
      runtime.swapSong(buildSong());
    } catch (e) { console.warn('[machi] 换歌失败:', e); }
  };

  /* 面板每帧比签名，变了才往下推（宿主不保证参数改完有通知）。 */
  let sig = '';
  const applySettings = () => {
    const raw = settings();
    const next = JSON.stringify(raw) + '|' + JSON.stringify(display());
    if (next === sig) return;
    sig = next;
    tuning = readTuning(raw);
    const wantText = display().showText !== false;
    const nextTheme = theme();
    if (!runtime) { showText = wantText; themeRef = nextTheme; return; }
    try {
      runtime.setTuning(tuning);
      if (nextTheme !== themeRef) { themeRef = nextTheme; runtime.setTheme(nextTheme); }
      if (wantText !== showText) { showText = wantText; runtime.setShowText(wantText); }
    } catch (e) { console.warn('[machi] 应用参数失败:', e); }
  };

  sig = JSON.stringify(settings()) + '|' + JSON.stringify(display());
  songSig = '';

  const tick = () => {
    if (disposed) return;
    applySong();
    applySettings();
  };
  const offTime = ctx.onLyricTime ? ctx.onLyricTime(tick) : null;
  const offChange = ctx.onChange ? ctx.onChange(() => { if (!disposed) { applySong(); applySettings(); } }) : null;

  return function cleanup() {
    disposed = true;
    try { offTime && offTime(); } catch (_) {}
    try { offChange && offChange(); } catch (_) {}
    try { abort && abort.abort(); } catch (_) {}
    try { if (runtime) runtime.destroy(); } catch (_) {}
    runtime = null;
    try { if (window.__machi) delete window.__machi; } catch (_) {}
    try { host.remove(); } catch (_) {}
  };
}

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'machi',
    label: { 'zh-CN': '町景', en: 'Machi' },
    order: 480,
    settings: SCHEMA,
    mount: (container, ctx) => mount(container, ctx),
  });
}
