/* 移植自 Folia「雾笺」 nebbiaPrograms.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { checkLinked, compileShader, startProgram } from './nebbiaGlUtils.mjs';
import { NEBBIA_MASK_FS, NEBBIA_MASK_VS } from './nebbiaMaskGl.mjs';
import { NEBBIA_BLD_FILL_FS, NEBBIA_NOISE_FS, NEBBIA_SPRITE_FS, NEBBIA_SPRITE_VS, NEBBIA_VS, nebbiaSceneShaders } from './nebbiaShaders.mjs';
import { NEBBIA_FLAKE_FS, NEBBIA_FLAKE_VS } from './nebbiaSnowGl.mjs';
export const canRenderFogToFloat = (gl)=>{
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    if (!ok) console.warn('[Nebbia] fog prepass framebuffer incomplete, computing the fog in the main pass');
    return ok;
};
export class NebbiaProgramBuild {
    gl;
    programs;
    parallel;
    done = false;
    constructor(gl, fogToFloat, scene = 'night', glass = 'rain'){
        this.gl = gl;
        this.parallel = gl.getExtension('KHR_parallel_shader_compile');
        const vs = compileShader(gl, gl.VERTEX_SHADER, NEBBIA_VS);
        const frag = (src)=>compileShader(gl, gl.FRAGMENT_SHADER, src);
        const shaders = nebbiaSceneShaders(scene, glass);
        this.programs = {
            fog: fogToFloat ? startProgram(gl, vs, frag(shaders.fog), {
                aPos: 0
            }) : null,
            main: startProgram(gl, vs, frag(fogToFloat ? shaders.main : shaders.mainFallback), {
                aPos: 0
            }),
            sprite: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_SPRITE_VS), frag(NEBBIA_SPRITE_FS), {
                aCorner: 0,
                aRect: 1,
                aParam: 2
            }),
            mask: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_MASK_VS), frag(NEBBIA_MASK_FS), {
                aCorner: 0,
                aSeg: 1,
                aParam: 2
            }),
            bldFill: scene === 'night' ? startProgram(gl, vs, frag(NEBBIA_BLD_FILL_FS), {
                aPos: 0
            }) : null,
            noise: startProgram(gl, vs, frag(NEBBIA_NOISE_FS), {
                aPos: 0
            }),
            flake: glass === 'snow' ? startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_FLAKE_VS), frag(NEBBIA_FLAKE_FS), {
                aCorner: 0,
                aA: 1,
                aB: 2,
                aC: 3
            }) : null
        };
    }
    poll() {
        if (this.done) return true;
        const { gl, parallel } = this;
        const list = [
            this.programs.fog,
            this.programs.main,
            this.programs.sprite,
            this.programs.mask,
            this.programs.bldFill,
            this.programs.noise,
            this.programs.flake
        ].filter((p)=>!!p);
        if (parallel && !list.every((p)=>gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR))) return false;
        for (const p of list)checkLinked(gl, p);
        for (const p of list)for (const s of gl.getAttachedShaders(p) ?? [])gl.deleteShader(s);
        this.done = true;
        return true;
    }
}
