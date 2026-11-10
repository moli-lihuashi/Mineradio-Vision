/* 花火的「应用侧依赖」桩。
 *
 * 这些在 Folia 里是全局服务（节拍分析、图标解析、渲染质量挡位、主题字体），
 * Mineradio 的模组宿主不提供，也不该为了一个样式去接进来。全部退化到「没有节拍、没有图标」，
 * 花火自己的画面不依赖它们（夜景、文字块、烟花、拼贴都照常画，只是不跟着鼓点开花）。
 *
 * 每个函数的返回值都是按调用点推出来的，不是随便填的：
 *   getBeatFxIntensities()  → 调用点读 .beat / .downbeat
 *   beatImpact/downbeatImpact → 调用点用 .get()，是 MotionValue 形状
 */

/* ---- 节拍（智能动感「随拍开花 / 随拍推镜」）---- */
export const BEAT_EFFECT_IDS = {
  hanabiBeatBursts: 'hanabiBeatBursts',
  hanabiBeatPulse: 'hanabiBeatPulse',
};

/** MotionValue 形状的最小替身：永远停在 0。 */
const still = () => ({ get: () => 0, on: () => () => {}, off: () => {} });

export const beatImpact = still();
export const downbeatImpact = still();

export const isBeatFxReady = () => false;
export const getBeatEffectStrength = () => 0;
export const getBeatFxEvents = () => [];
export const getBeatFxTrackScale = () => 1;
export const getBeatFxRotationSign = () => 1;
export const getBeatFxIntensities = () => ({ beat: 0, downbeat: 0, bar: 0, phrase: 0 });
export const resolveBeatFxAccentGain = () => 1;

/* ---- 图标（画框 / 拼贴里的 lucide 贴纸）----
 * 没有图标数据时花火会退到字体字形（collagePainters 里 `?? resolveLucideIconNode(FALLBACK)` 之后还有字形兜底）。 */
export const resolveLucideIconNames = () => null;
export const resolveLucideIconNode = () => null;

/* ---- 渲染质量 ----
 * 官方把「全局挡位 × 本样式覆盖」合起来算像素比；这里直接按设备像素比，倍数 >1 时封顶 3。 */
export const resolveLyricPixelRatio = (ratio, scale) => {
  const n = Number(scale && typeof scale === 'object' ? scale.scale : scale);
  const mul = isFinite(n) && n > 1 ? Math.min(3, n) : 1;
  const base = isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : 1;
  return base * mul;
};
export const normalizeLyricRenderOverride = (raw) => {
  const ok = (v) => v === 'global' || typeof v === 'number';
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    scale: ok(input.scale) ? input.scale : 'global',
    antialias: ok(input.antialias) ? input.antialias : 'global',
  };
};
export const resolveLyricAntialias = () => false;

/* ---- 主题字体 ---- */
export const resolveThemeFontStack = (theme) =>
  (theme && (theme.fontStack || theme.fontFamily)) || '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export const resolveThemeFontWeight = (theme, fallback) => {
  const w = Number(theme && theme.weight);
  return isFinite(w) ? Math.max(100, Math.min(900, Math.round(w / 100) * 100)) : fallback;
};
