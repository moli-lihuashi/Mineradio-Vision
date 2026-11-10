/* 移植自 Folia components/visualizer/pixi/pixiWebGLContext.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const PIXI_EXTENSIONS = [
    'EXT_texture_filter_anisotropic',
    'OES_texture_float_linear',
    'WEBGL_compressed_texture_s3tc',
    'WEBGL_compressed_texture_s3tc_srgb',
    'WEBGL_compressed_texture_etc',
    'WEBGL_compressed_texture_etc1',
    'WEBGL_compressed_texture_pvrtc',
    'WEBKIT_WEBGL_compressed_texture_pvrtc',
    'WEBGL_compressed_texture_atc',
    'WEBGL_compressed_texture_astc',
    'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc',
    'WEBGL_lose_context',
    'EXT_color_buffer_float',
    'WEBGL_provoking_vertex',
    'KHR_parallel_shader_compile'
];
const TASK_MS = 4;
const nextTask = ()=>new Promise((resolve)=>{
        window.setTimeout(resolve);
    });
const cancelled = ()=>new DOMException('Pixi context creation was cancelled', 'AbortError');
export const makePixiContext = async (pixi, options, signal)=>{
    if (pixi.VERSION !== '8.21.0') return {};
    await nextTask();
    if (signal?.aborted) throw cancelled();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
        alpha: (options.backgroundAlpha ?? 1) < 1,
        premultipliedAlpha: true,
        antialias: Boolean(options.antialias) && !options.useBackBuffer,
        stencil: true,
        preserveDrawingBuffer: false,
        powerPreference: options.powerPreference ?? 'default'
    });
    if (!context) return {};
    let started = performance.now();
    for (const name of PIXI_EXTENSIONS){
        if (performance.now() - started > TASK_MS) {
            await nextTask();
            if (signal?.aborted) {
                context.getExtension('WEBGL_lose_context')?.loseContext();
                throw cancelled();
            }
            started = performance.now();
        }
        context.getExtension(name);
    }
    return {
        canvas,
        context
    };
};
