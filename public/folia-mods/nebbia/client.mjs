/* 雾笺（nebbia）—— Folium v1 模组 · 雨夜公交车窗上按笔顺写字
 *
 * 这是 Folia 官方「雾笺」歌词样式的 WebGL2 移植版：
 *   原实现 https://github.com/chthollyphile/folia-major （AGPL-3.0）
 *   样式与渲染管线作者 lantudou，0.7.24「Rainy Update」随版发布，0.7.25 做性能热修。
 * 本目录下 neb/ 里是机械移植的原文件（只剥类型、改 import），本文件与 runtime.mjs 是宿主适配层。
 * 依据 AGPL-3.0，本模组同样以 AGPL-3.0 分发，署名保留在上述两处。
 *
 * 一帧里发生什么：
 *   WebGL2 画出窗外雨夜街景（楼群 / 霓虹 / 车灯 / 湿路面 / 光柱里的雨丝），
 *   雾在 1/4 和 1/8 分辨率预渲染后合成；玻璃上手指擦开的通道来自 2D 侧算好的擦痕遮罩；
 *   水珠是 raindrop-fx（MIT）的精灵，按法线折射；两盏聚光灯跟着正在写的那个字走。
 */

import { NebbiaRuntime } from './runtime.mjs';

const number = (key, group, label, description, min, max, step, defaultValue) => ({
  key, type: 'number', group, label, description, min, max, step, defaultValue,
});
const boolean = (key, group, label, description, defaultValue) => ({
  key, type: 'boolean', group, label, description, defaultValue,
});

const G = {
  write: { 'zh-CN': '书写', en: 'Writing' },
  appear: { 'zh-CN': '字怎么出现', en: 'Appear' },
  fade: { 'zh-CN': '字怎么消失', en: 'Fade' },
  layout: { 'zh-CN': '构图', en: 'Layout' },
  window: { 'zh-CN': '窗外', en: 'Outside' },
};

/* 构图九种：一句随机挑一种（官方 NEBBIA_LAYOUTS）。 */
const LAYOUTS = [
  ['ribbon', '横条', '一句话横着写完，最长的那种。'],
  ['lines2', '两行错落', '拆成两行，第二行往右让开一点。'],
  ['lines3', '三行错落', '拆成三行，越往下越窄。'],
  ['cross', '十字', '竖着一列穿过一横，像在玻璃上打个记号。'],
  ['pillar', '竖柱', '整句竖成一柱往下写。'],
  ['header', '刊头', '首字放大做报头，其余小字在下面排队。'],
  ['badge', '徽章', '揉成一小块方章，偏在角落。'],
  ['columns', '竖排几列', '按字拆成两三列竖排，从右往左。'],
  ['orbit', '环绕', '沿一条弧线散开，像绕着什么写。'],
];

const SCHEMA = [
  /* ---- 书写（官方 WRITING_SLIDERS 八项；涂鸦那项以前因缺 lucide 图标字被关成 0，现已接上）---- */
  number('strokeWidth', G.write,
    { 'zh-CN': '笔画粗细', en: 'Stroke width' },
    { 'zh-CN': '手指在玻璃上压出的通道有多宽（× 字号）。太细像针尖划的，太粗字形会糊成一团。默认 0.09。', en: 'How wide the fingertip channel is, as a multiple of the type size. Default 0.09.' },
    0.04, 0.16, 0.005, 0.09),
  number('writeSpeed', G.write,
    { 'zh-CN': '书写速度', en: 'Write speed' },
    { 'zh-CN': '相对自然书写速度的倍率。调快会来不及写完就起雾，所以官方在写不完时会退回「渐显」。默认 1。', en: 'Multiplier on the natural writing speed. Default 1.' },
    0.4, 2.5, 0.05, 1),
  number('jitter', G.write,
    { 'zh-CN': '手写歪斜', en: 'Hand jitter' },
    { 'zh-CN': '整字转动、上下错落、整行倾斜的程度。0 是印刷体一样整齐。默认 0.6。', en: 'Whole-character rotation, vertical stagger and line tilt. 0 is typeset-straight. Default 0.6.' },
    0, 1.5, 0.05, 0.6),
  number('warp', G.write,
    { 'zh-CN': '手写变形', en: 'Hand warp' },
    { 'zh-CN': '字形被写成斜切胖瘦、笔画长短不一、还带点手抖。这是「像人写的」最关键的一项。默认 0.6。', en: 'Shear, weight, per-stroke length offsets and tremor. What makes it read as handwriting. Default 0.6.' },
    0, 1.5, 0.05, 0.6),
  number('mist', G.write,
    { 'zh-CN': '雾气浓度', en: 'Mist density' },
    { 'zh-CN': '冷凝水膜有多厚。越浓，玻璃后面的画面越被揉开、字越跳出来（实测雾与擦痕的亮度差：0.75 时 38 级，0.85 时 42 级，1.0 时 51 级但高光会糊成白块）。默认 0.85。', en: 'How thick the condensation is. Default 0.85.' },
    0.2, 1, 0.01, 0.85),
  number('hold', G.write,
    { 'zh-CN': '写完保持', en: 'Hold' },
    { 'zh-CN': '下一句开始后，写好的字再挂几秒才开始起雾。默认 1.2 秒。', en: 'Seconds the finished words stay before the fog starts eating them. Default 1.2.' },
    0, 6, 0.1, 1.2),
  number('refog', G.write,
    { 'zh-CN': '重新起雾', en: 'Re-fog' },
    { 'zh-CN': '字被雾吞掉要几秒。默认 4 秒。', en: 'How long the fog takes to swallow the words. Default 4s.' },
    0.5, 12, 0.5, 4),
  number('doodle', G.write,
    { 'zh-CN': '句尾随机涂鸦', en: 'Random doodles' },
    { 'zh-CN': '每句写完时，有多大概率顺手在雾上擦出一个小图案（星星、花、月亮、雨伞、笑脸…）。0 关；官方默认 0.05，调成 1 则每句都有。', en: 'Chance of wiping a small doodle (star, flower, moon, umbrella, smile…) at the end of a line. 0 is off; Folia default 0.05; 1 draws one on every line.' },
    0, 1, 0.01, 0.05),

  /* ---- 字怎么出现（官方 appear，至少开一种）---- */
  boolean('appearFade', G.appear,
    { 'zh-CN': '渐显', en: 'Fade in' },
    { 'zh-CN': '整个字从雾里慢慢透出来，不写字。和手写一起开时，只用在来不及写完的句子上。', en: 'The whole glyph fades in through the fog instead of being written. Used for lines that cannot be written in time.' },
    false),
  boolean('appearBreath', G.appear,
    { 'zh-CN': '先哈一口气再写', en: 'Breathe first' },
    { 'zh-CN': '先在玻璃上哈一片白气，再在白气上写。', en: 'Breathe a patch of vapour onto the glass, then write on it.' },
    false),

  /* ---- 字怎么消失（官方 fade）---- */
  boolean('fadeFingers', G.fade,
    { 'zh-CN': '两根手指搓掉', en: 'Rub off' },
    { 'zh-CN': '不用起雾，改成两根手指在字上来回搓，把字搓没。两种都开就每句随机。', en: 'Rub the words off with two fingers instead of letting the fog eat them.' },
    false),

  /* ---- 构图（官方 layouts，九种各一个开关）---- */
  ...LAYOUTS.map(([id, zh, desc]) => boolean('layout_' + id, G.layout,
    { 'zh-CN': zh, en: id },
    { 'zh-CN': desc, en: desc },
    true)),

  /* ---- 窗外（官方 WINDOW_SLIDERS）---- */
  number('busSpeed', G.window,
    { 'zh-CN': '车速', en: 'Bus speed' },
    { 'zh-CN': '窗外街景往后退多快，0 是停站。也决定玻璃颠簸时水珠往哪边偏。默认 1。', en: 'How fast the street scrolls past. 0 is stopped at a stop. Default 1.' },
    0, 3, 0.05, 1),
  number('neon', G.window,
    { 'zh-CN': '霓虹亮度', en: 'Neon' },
    { 'zh-CN': '招牌和路灯的光斑有多亮。默认 1。', en: 'Brightness of signs and street lights. Default 1.' },
    0, 2, 0.05, 1),
  number('bump', G.window,
    { 'zh-CN': '颠簸', en: 'Bumps' },
    { 'zh-CN': '车过坎时玻璃抖一下，大的水珠会被震下来。0 关。默认 1。', en: 'The glass jolts when the bus hits a bump, shaking big beads loose. 0 is off. Default 1.' },
    0, 2.5, 0.05, 1),
  number('spot', G.window,
    { 'zh-CN': '聚光灯', en: 'Spotlights' },
    { 'zh-CN': '两盏从窗外照进来的灯，跟着正在写的那个字走。调高字周围那圈雾会被照得发亮，过高会把雾烧成白块。0 关。默认 0.8。', en: 'Two lamps shining in from outside, following the character being written. 0 is off. Default 0.8.' },
    0, 2, 0.05, 0.8),
  number('spotX', G.window,
    { 'zh-CN': '灯的位置', en: 'Lamp position' },
    { 'zh-CN': '光源在画面横向的哪个位置（另一盏在左右对称处）。默认 0.8。', en: 'Horizontal position of the light source; the other lamp mirrors it. Default 0.8.' },
    0, 1, 0.01, 0.8),
  number('rainHit', G.window,
    { 'zh-CN': '雨点打窗', en: 'Rain hits' },
    { 'zh-CN': '雨点砸在玻璃上的密度。砸上去会溅开一小圈，水珠顺着一路淌下来。0 关。默认 1。', en: 'Density of raindrops striking the glass. 0 is off. Default 1.' },
    0, 3, 0.05, 1),
  number('rainBig', G.window,
    { 'zh-CN': '大雨点', en: 'Big drops' },
    { 'zh-CN': '吐字时砸下来的大雨点有多大。0 不砸。默认 1。', en: 'Size of the heavy drops that land on each sung word. 0 is off. Default 1.' },
    0, 2, 0.05, 1),
];

/* 宿主存的是一张扁平的 key→值；这里折回官方 tuning 的形状。 */
function readTuning(raw) {
  const s = raw || {};
  const num = (k, d) => (isFinite(Number(s[k])) ? Number(s[k]) : d);
  const lay = [];
  for (const [id] of LAYOUTS) if (s['layout_' + id] !== false) lay.push(id);
  const appear = [];
  if (s.appearFade === true) appear.push('fade');
  if (s.appearBreath === true) appear.push('breath');
  appear.push('write');            /* 手写永远在：官方的「至少一种」由它兜底 */
  const fade = s.fadeFingers === true ? ['fog', 'fingers'] : ['fog'];
  return {
    appear,
    fade,
    layouts: lay.length ? lay : ['ribbon', 'lines2', 'lines3'],
    behind: 'night',
    glass: 'rain',
    scenery: ['spot', 'buildings', 'lights', 'cars', 'road'],
    rain: 'slant',
    credits: true,
    jitter: num('jitter', 0.6),
    warp: num('warp', 0.6),
    mist: num('mist', 0.85),
    hold: num('hold', 1.2),
    refog: num('refog', 4),
    strokeWidth: num('strokeWidth', 0.09),
    writeSpeed: num('writeSpeed', 1),
    doodle: num('doodle', 0.05),
    busSpeed: num('busSpeed', 1),
    neon: num('neon', 1),
    spot: num('spot', 0.8),
    spotX: num('spotX', 0.8),
    rainHit: num('rainHit', 1),
    rainBig: num('rainBig', 1),
    bump: num('bump', 1),
  };
}

function mount(container, ctx) {
  const settings = () => ctx.getSettings() || {};
  const theme = () => ctx.getTheme() || {};
  const display = () => ctx.getDisplay() || { fontScale: 1, showText: true };

  const runtime = new NebbiaRuntime({
    host: container,
    time: ctx.currentTime,
    fontFamily: theme().fontStack || theme().fontFamily || '"Noto Sans SC","PingFang SC",sans-serif',
    fontWeight: 600,
    onFailed: () => { try { container.dataset.nebbiaFailed = '1'; } catch (_) {} },
  });

  let disposed = false;
  let sig = '';
  let songSig = '';
  let syncTimer = 0;

  const applySong = () => {
    const song = ctx.song || {};
    const lines = ctx.lines || [];
    const next = String(song.id || song.title || '') + '|' + lines.length + '|' + (lines[0]?.startTime ?? '');
    if (next === songSig) return;
    songSig = next;
    runtime.setSong({ lines, seed: String(song.id || song.title || 'nebbia'), title: song.title, artist: song.artist });
  };

  /* 宿主目前只在「换行 / 换主题 / 显示开关」时推 change，参数面板改完不一定有通知，
   * 所以这里每帧比一次签名（字符串比较，几乎零成本），变了才真的往下推。 */
  const applySettings = () => {
    const raw = settings();
    const next = JSON.stringify(raw) + '|' + JSON.stringify(display());
    if (next === sig) return;
    sig = next;
    runtime.setTuning(readTuning(raw));
    runtime.setFontScale(display().fontScale);
    runtime.setShowText(display().showText);
    runtime.setTheme(theme());
  };

  applySong();
  applySettings();
  runtime.setTheme(theme());

  const tick = () => { if (!disposed) { applySettings(); runtime.requestFrame(); } };
  const offTime = ctx.onLyricTime(tick);
  const offChange = ctx.onChange(() => { if (disposed) return; applySong(); applySettings(); runtime.requestFrame(); });

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (!disposed) runtime.resize(); });
    ro.observe(container);
  }
  runtime.resize();

  /* 探针：真机排查用 */
  const token = Date.now() + Math.random();
  window.__nebbiaState = function () {
    const p = runtime.probe();
    p.sig = sig.length;
    p.disposed = disposed;
    return p;
  };
  window.__nebbiaState.__t = token;

  return function cleanup() {
    disposed = true;
    if (syncTimer) { try { clearTimeout(syncTimer); } catch (_) {} }
    try { offTime && offTime(); } catch (_) {}
    try { offChange && offChange(); } catch (_) {}
    try { ro && ro.disconnect(); } catch (_) {}
    try { if (window.__nebbiaState && window.__nebbiaState.__t === token) delete window.__nebbiaState; } catch (_) {}
    try { runtime.destroy(); } catch (_) {}
  };
}

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'nebbia',
    label: { 'zh-CN': '雾笺', en: 'Nebbia' },
    order: 460,
    settings: SCHEMA,
    mount: (container, ctx) => mount(container, ctx),
  });
}
