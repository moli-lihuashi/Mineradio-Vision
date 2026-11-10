/* 町景（machi）的「应用侧依赖」桩。语义与花火的 `_stubs.mjs` 一致：
 * Folia 的全局服务（节拍分析、图标解析、渲染质量挡位、设置 store）宿主不提供，全部退到默认值。
 * 返回值都按调用点推的：
 *   useVisualizerSettingsStore.getState().visualizerFrameRate → 帧率上限，0 = 不设限（官方默认值）
 *   getBeatFxHeard() → 调用点只取 .key 传给 getDrumHits
 *   DRUM_KICK / DRUM_SNARE → 底鼓/军鼓的音轨号（beatFx.ts 的 pickDrumHits 用它挑轨）
 */

/* ---- 节拍 ---- */
export const BEAT_EFFECT_IDS = {
  machiBeatBoard: 'machiBeatBoard',
  machiBeatNeon: 'machiBeatNeon',
  machiBeatScreenFlash: 'machiBeatScreenFlash',
};

export const isBeatFxReady = () => false;
export const getBeatEffectStrength = () => 0;
export const getBeatFxEvents = () => [];
export const getBeatFxTrackScale = () => 1;
export const getBeatFxRotationSign = () => 1;
export const getBeatFxHeard = () => ({ key: 'none' });
export const resolveBeatFxAccentGain = () => 1;

/* ---- 鼓点（疏雨轻车同源的音轨分析；没有就退回随机颠簸）---- */
export const DRUM_KICK = 0;
export const DRUM_SNARE = 1;
export const getDrumHits = () => ({ hits: [], ready: false });
export const isGpuAnalysisActive = () => false;

/* ---- 歌词行分类 ----
 * 间奏行：宿主没给段落结构，按「不是间奏」处理，镜头节奏照常走。 */
export const isInterludeLine = () => false;

/* ---- 图标 ----
 * 必须是 []，不能是 null：招牌绘制里有 `content.icons.length ? … : fallbacks[…]`，
 * null 会在建场景时就 TypeError（`町景` 第一次跑就是这么白屏的）。 */
export const resolveLucideIconNames = () => [];
export const resolveLucideIconNode = () => null;

/* ---- 渲染质量 ---- */
export const MAX_LYRIC_PIXEL_RATIO = 2;
export const DEFAULT_LYRIC_RENDER_QUALITY = { scale: 1, antialias: 'fxaa' };
export const resolveLyricPixelRatio = (ratio, scale) => {
  const n = Number(scale && typeof scale === 'object' ? scale.scale : scale);
  const mul = isFinite(n) && n > 1 ? Math.min(3, n) : 1;
  const base = isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : 1;
  return base * mul;
};

/* ---- 主题字体 ---- */
export const resolveThemeFontStack = (theme) =>
  (theme && (theme.fontStack || theme.fontFamily)) || '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export const resolveThemeFontWeight = (theme, fallback) => {
  const w = Number(theme && theme.weight);
  return isFinite(w) ? Math.max(100, Math.min(900, Math.round(w / 100) * 100)) : fallback;
};

/* ---- 设置 store（只被读一个字段）---- */
export const useVisualizerSettingsStore = {
  getState: () => ({ visualizerFrameRate: 0 }),
};

/* ---- 面板排版工具（panelRows.tsx 里的一个纯函数）----
 * cameraControls 的设置面板用它把一个值均分成 n 份；运行时只用得到这一个。 */
export const times = (n, fn) => {
  const out = [];
  const count = Math.max(0, Math.floor(Number(n) || 0));
  for (let i = 0; i < count; i++) out.push(fn(i));
  return out;
};
