/* 花火（hanabi）—— Folium v1 模组 · 日式歌词 PV：字块弹入、烟花沿词升空、镜头一路往上抬
 *
 * 官方实现：https://github.com/chthollyphile/folia-major （AGPL-3.0，v0.7.25 之后的 main）
 * 本目录 `hb/` 里是按 import 闭包机械移植的原文件（只剥类型、改 import），
 * 本文件是宿主适配层：官方那层 React 外壳（VisualizerHanabi.tsx）在这里换成 mount/tick/cleanup。
 *
 * 与官方外壳的对应关系（逐条）：
 *   外壳把 lines + seed 编译成 HanabiProgram  → 这里 setSong 时编译
 *   外壳把 theme 一起塞进 SongContext         → 这里 ctx.getTheme()
 *   外壳用 useVisualizerPixiHost 建运行时      → 这里 mount 里建一次，换歌走 swapSong
 *   MotionValue currentTime                   → ctx.currentTime 本身就是 { get(), on() } 同形
 *   节拍/图标/渲染质量挡位                     → hb/_stubs.mjs（宿主不提供这些服务）
 *
 * 为什么 mount 不能返回 Promise：`17-folia-mod-host.js` 是 `inst.cleanup = entry.mount(...)`，
 * 拿到 Promise 就当不成清理函数了。所以这里同步返回 cleanup，异步建运行时在内部跑，用 disposed 兜住。
 */

import { HanabiPixiRuntime } from './hb/components_visualizer_hanabi_createHanabiPixiRuntime.mjs';
import { compileHanabiProgram } from './hb/components_visualizer_hanabi_hanabiProgram.mjs';
import { normalizeHanabiTuning } from './hb/components_visualizer_hanabi_hanabiTuning.mjs';

const G = {
  look: { 'zh-CN': '画面', en: 'Look' },
  text: { 'zh-CN': '文字', en: 'Text' },
  fx: { 'zh-CN': '烟花与光', en: 'Fireworks' },
  motion: { 'zh-CN': '运动', en: 'Motion' },
};

const num = (key, group, label, desc, min, max, step, def) => ({
  key, type: 'number', group, label, description: desc, min, max, step, defaultValue: def,
});
const bool = (key, group, label, desc, def) => ({
  key, type: 'boolean', group, label, description: desc, defaultValue: def,
});

const SCHEMA = [
  num('sparkAmount', G.fx,
    { 'zh-CN': '火星', en: 'Sparks' },
    { 'zh-CN': '升空尾迹和爆开时溅出的火星多少。0 关。默认 1。', en: 'Sparks in the trails and bursts. Default 1.' },
    0, 2, 0.05, 1),
  num('ornamentAmount', G.fx,
    { 'zh-CN': '贴纸', en: 'Stickers' },
    { 'zh-CN': '沿词飞出的 MG 小贴纸多少。0 关。默认 1。', en: 'MG stickers flying along the words. Default 1.' },
    0, 2, 0.05, 1),
  num('launches', G.fx,
    { 'zh-CN': '升空', en: 'Launches' },
    { 'zh-CN': '烟花一路升空的密度。0 关。默认 1。', en: 'How often shells launch. Default 1.' },
    0, 2, 0.05, 1),
  num('glow', G.fx,
    { 'zh-CN': '辉光', en: 'Glow' },
    { 'zh-CN': '字块和烟花的光晕强度。默认 1。', en: 'Glow around blocks and fireworks. Default 1.' },
    0, 2, 0.05, 1),
  num('bloom', G.fx,
    { 'zh-CN': '泛光', en: 'Bloom' },
    { 'zh-CN': '全屏泛光强度。默认 1。', en: 'Screen bloom. Default 1.' },
    0, 2, 0.05, 1),
  num('chorusBloom', G.fx,
    { 'zh-CN': '副歌泛光', en: 'Chorus bloom' },
    { 'zh-CN': '到副歌时泛光额外加多少。默认 1。', en: 'Extra bloom on the chorus. Default 1.' },
    0, 2, 0.05, 1),
  num('ambient', G.fx,
    { 'zh-CN': '环境光', en: 'Ambient' },
    { 'zh-CN': '夜空里飘的光点多少。默认 1。', en: 'Ambient motes in the night sky. Default 1.' },
    0, 2, 0.05, 1),

  num('blockOpacity', G.text,
    { 'zh-CN': '色块浓度', en: 'Block opacity' },
    { 'zh-CN': '字后面那块纯色底的浓度。0 是只有字。默认 1。', en: 'Opacity of the colour block behind each word. Default 1.' },
    0, 1, 0.05, 1),
  num('textMotion', G.text,
    { 'zh-CN': '文字动作', en: 'Text motion' },
    { 'zh-CN': '字块弹出、位移的幅度。默认 1。', en: 'How much the words pop and slide. Default 1.' },
    0, 2, 0.05, 1),
  bool('textOnly', G.text,
    { 'zh-CN': '只要文字', en: 'Text only' },
    { 'zh-CN': '纯文字模式：连夜空、烟花、贴纸、拼贴和画框一起关掉，只剩白字浮在黑底上。默认关。', en: 'Text-only mode: also hides the night sky, fireworks, stickers, collage and frame, leaving white words on a black background. Default off.' },
    false),
  num('collage', G.text,
    { 'zh-CN': '拼贴', en: 'Collage' },
    { 'zh-CN': '镜头里的照片拼贴密度。0 关。默认 1。', en: 'Photo collage density. 0 is off. Default 1.' },
    0, 2, 0.05, 1),

  num('riseSpeed', G.motion,
    { 'zh-CN': '上升速度', en: 'Rise speed' },
    { 'zh-CN': '整场镜头往上抬的速度。默认 1。', en: 'How fast the whole scene rises. Default 1.' },
    0, 2, 0.05, 1),
  num('spin', G.motion,
    { 'zh-CN': '倾斜', en: 'Spin' },
    { 'zh-CN': '镜头左右倾斜的程度。默认 1。', en: 'How much the camera tilts. Default 1.' },
    0, 2, 0.05, 1),
  num('sky', G.motion,
    { 'zh-CN': '夜空', en: 'Night sky' },
    { 'zh-CN': '夜空底色不透明度。默认 1。', en: 'Night sky opacity. Default 1.' },
    0, 1, 0.05, 1),

  bool('overlayFrame', G.look,
    { 'zh-CN': '画框', en: 'Frame' },
    { 'zh-CN': '画面四周那圈画框和角标。', en: 'The frame and corner marks around the shot.' },
    true),
];

const COLORS = ['theme', 'vivid', 'mixed'];
const QUALITY = ['full', 'balanced', 'low'];

/* 宿主设置是扁平的 key→值；折回官方 tuning 形状（normalizeHanabiTuning 会补齐和夹值）。 */
function readTuning(raw) {
  const s = raw || {};
  const n = (k, d) => (isFinite(Number(s[k])) ? Number(s[k]) : d);
  return normalizeHanabiTuning({
    sparkAmount: n('sparkAmount', 1),
    ornamentAmount: n('ornamentAmount', 1),
    launches: n('launches', 1),
    glow: n('glow', 1),
    bloom: n('bloom', 1),
    chorusBloom: n('chorusBloom', 1),
    ambient: n('ambient', 1),
    blockOpacity: n('blockOpacity', 1),
    textMotion: n('textMotion', 1),
    textOnly: s.textOnly === true,
    collage: n('collage', 1),
    riseSpeed: n('riseSpeed', 1),
    spin: n('spin', 1),
    sky: n('sky', 1),
    overlayFrame: s.overlayFrame !== false,
    colorMode: COLORS.includes(s.colorMode) ? s.colorMode : 'theme',
    renderQuality: QUALITY.includes(s.renderQuality) ? s.renderQuality : 'full',
  });
}

function seedOf(song) {
  return String((song && (song.id || song.title)) || 'hanabi');
}

function mount(container, ctx) {
  const settings = () => ctx.getSettings() || {};
  const theme = () => ctx.getTheme() || {};
  const display = () => ctx.getDisplay() || { showText: true, fontScale: 1 };
  const song = () => ctx.song || {};

  /* 官方外壳把画布铺满 shell；这里同样要一个自己做尺寸的宿主 div。 */
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;overflow:hidden';
  container.appendChild(host);

  let disposed = false;
  let runtime = null;
  let tuning = readTuning(settings());
  let showText = display().showText !== false;
  let songSig = '';
  let pendingSwap = null;

  const buildProgram = (lines, seed) => compileHanabiProgram(lines || [], seed);

  const makeSong = () => {
    const s = song();
    const seed = seedOf(s);
    return {
      seed,
      program: buildProgram(ctx.lines || [], seed),
      theme: theme(),
    };
  };

  (async () => {
    const s = makeSong();
    songSig = s.seed + '|' + (ctx.lines || []).length;
    const rt = await HanabiPixiRuntime.create({
      host,
      song: s,
      tuning,
      currentTime: ctx.currentTime,
      staticMode: false,
      showText,
      paused: false,
      metadata: { title: song().title, artist: song().artist, album: song().album },
      renderScale: 1,
      antialias: false,
    });
    if (disposed) { try { rt.destroy(); } catch (_) {} return; }
    runtime = rt;
    runtime.setTuning(tuning);
    runtime.setShowText(showText);
    /* 只读诊断钩子（同雾笺 __nebbiaState）：查「哪一层没画」时不用翻局部变量。
     * 只返回标量，绝不把 Pixi 对象漏出去造成循环引用。 */
    try {
      window.__hanabiState = function () {
        const r = runtime;
        if (!r || r.destroyed) return null;
        const p = r.options.song.program || {};
        const scenes = [];
        try {
          r.sceneCache.forEach((entry, index) => scenes.push({
            index,
            visible: !!(entry && entry.holder && entry.holder.visible),
            children: entry && entry.holder && entry.holder.children
              ? entry.holder.children.length : -1,
          }));
        } catch (_) {}
        return {
          canvas: [r.app.canvas.width, r.app.canvas.height],
          stageChildren: r.app.stage.children.length,
          sky: { visible: !!(r.sky && r.sky.view && r.sky.view.visible),
                 children: r.sky && r.sky.view && r.sky.view.children ? r.sky.view.children.length : -1 },
          sceneLayerChildren: r.sceneLayer && r.sceneLayer.children ? r.sceneLayer.children.length : -1,
          overlayChildren: r.overlayLayer && r.overlayLayer.children ? r.overlayLayer.children.length : -1,
          creditsChildren: r.credits && r.credits.holder && r.credits.holder.children
            ? r.credits.holder.children.length : -1,
          cacheSize: typeof r.sceneCache.size === 'number' ? r.sceneCache.size : -1,
          activeIndex: r.activeIndex,
          scenes: scenes.slice(0, 6),
          tuning: { textOnly: r.options.tuning.textOnly, sky: r.options.tuning.sky,
                    collage: r.options.tuning.collage, colorMode: r.options.tuning.colorMode },
          program: { paragraphs: p.paragraphs ? p.paragraphs.length : -1,
                     shots: p.paragraphs ? p.paragraphs.map((x) => x.shots ? x.shots.length : -1).slice(0, 8) : [],
                     duration: p.duration, instrumental: p.instrumental,
                     time: r.options.currentTime.get() },
          themeBg: r.options.song.theme && r.options.song.theme.backgroundColor,
        };
      };
    } catch (_) {}
  })().catch((err) => {
    const msg = (err && (err.stack || err.message)) || String(err);
    console.warn('[hanabi] 初始化失败:', err);
    /* 探针要看得到原因：console 在真机上不总是抓得到 */
    try { window.__hanabiError = msg; } catch (_) {}
    try { container.dataset.hanabiFailed = msg.slice(0, 400); } catch (_) {}
  });

  /* 换歌：官方走 swapSong 就地交接（不重建 WebGL 上下文）。 */
  const applySong = () => {
    const lines = ctx.lines || [];
    const next = seedOf(song()) + '|' + lines.length + '|' + ((lines[0] && lines[0].startTime) || 0);
    if (next === songSig) return;
    songSig = next;
    if (!runtime) return;
    const s = makeSong();
    try {
      const p = runtime.swapSong(s);
      if (p && typeof p.catch === 'function') p.catch((e) => console.warn('[hanabi] 换歌失败:', e));
    } catch (e) { console.warn('[hanabi] 换歌失败:', e); }
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
    if (!runtime) { showText = wantText; return; }
    runtime.setTuning(tuning);
    if (wantText !== showText) { showText = wantText; runtime.setShowText(wantText); }
    runtime.setSongMetadata({ title: song().title, artist: song().artist, album: song().album });
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

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (runtime) { try { runtime.renderOnce(); } catch (_) {} } });
    ro.observe(container);
  }

  return function cleanup() {
    disposed = true;
    try { offTime && offTime(); } catch (_) {}
    try { offChange && offChange(); } catch (_) {}
    try { ro && ro.disconnect(); } catch (_) {}
    try { if (runtime) runtime.destroy(); } catch (_) {}
    runtime = null;
    try { host.remove(); } catch (_) {}
  };
}

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'hanabi',
    label: { 'zh-CN': '花火', en: 'Hanabi' },
    order: 470,
    settings: SCHEMA,
    mount: (container, ctx) => mount(container, ctx),
  });
}
