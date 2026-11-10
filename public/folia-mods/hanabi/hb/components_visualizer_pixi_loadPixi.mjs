/* 手写覆盖：Folia 的 pixi/loadPixi.ts。
 *
 * 官方是 `await import('pixi.js')` 拿 ESM 命名空间；项目里 pixi 是 UMD 全局（8.21.0，同一个版本），
 * 所以直接返回 `window.PIXI` 本身 —— 不能用 pixi_shim 的命名空间，
 * 因为兼容层要读 `TexturePool` / `Texture.EMPTY` 这些没被具名导出的内部量
 * （第一版就是这么炸的：`Cannot read properties of undefined (reading '_dropTextures')`）。
 *
 * 真正要保留的副作用只有一个：把 pixi 的默认片元精度抬到 highp，
 * 否则 NVIDIA Linux 驱动上中值噪声会溢出成 NaN、整块画面发黑（官方注释写得很细）。
 */
import { installPixiFilterPoolCompat } from './components_visualizer_pixi_pixiFilterPoolCompat.mjs';

export const loadPixi = async () => {
  const pixi = window.PIXI;
  if (!pixi) throw new Error('花火需要 pixi.js（vendor/folia/pixi/pixi.min.js 未加载）');
  if (pixi.GlProgram && pixi.GlProgram.defaultOptions) {
    pixi.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';
  }
  installPixiFilterPoolCompat(pixi);
  return pixi;
};
