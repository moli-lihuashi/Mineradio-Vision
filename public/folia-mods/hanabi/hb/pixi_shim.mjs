/* pixi.js 的具名导入 → 全局 UMD。
 *
 * 项目里 pixi 是 `index.html` 的 `vendor/folia/pixi/pixi.min.js`（UMD，8.21.0），
 * 和 Folia 用的版本完全一致，所以不需要再打一份 ESM 包。
 * tempera / sonnet 两个原生样式也是这么接的（见 0h-folia-tempera-runtime.js 的注释）。
 *
 * 这里只导出花火真正用到的名字；pure type 的那些（Renderer / BindGroup / RenderSurface 等）
 * 剥类型后不会出现在代码里，列在这里只是为了让 `import { X }` 不炸。
 */
const P = (typeof window !== 'undefined' && window.PIXI) || {};

export const VERSION = P.VERSION;
export const Application = P.Application;
export const Container = P.Container;
export const Sprite = P.Sprite;
export const Graphics = P.Graphics;
export const GraphicsContext = P.GraphicsContext;
export const Texture = P.Texture;
export const TilingSprite = P.TilingSprite;
export const RenderTexture = P.RenderTexture;
export const Filter = P.Filter;
export const BlurFilter = P.BlurFilter;
export const FilterSystem = P.FilterSystem;
export const GlProgram = P.GlProgram;
export const Shader = P.Shader;
export const BindGroup = P.BindGroup;
export const Renderer = P.Renderer;
export const WebGLRenderer = P.WebGLRenderer;
export const RenderSurface = P.RenderSurface;

export default P;
