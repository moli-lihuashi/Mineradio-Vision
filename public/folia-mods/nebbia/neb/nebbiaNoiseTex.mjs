/* 移植自 Folia「雾笺」 nebbiaNoiseTex.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { makeTex } from './nebbiaGlUtils.mjs';
export class NebbiaNoiseTex {
    gl;
    tex;
    fb;
    w = 1;
    h = 1;
    ok = false;
    dirty = false;
    constructor(gl, unit){
        this.gl = gl;
        this.tex = makeTex(gl, unit);
        this.fb = gl.createFramebuffer();
    }
    resize(w, h) {
        const { gl } = this;
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.w = w;
        this.h = h;
        this.ok = w <= max && h <= max;
        if (!this.ok) return;
        gl.activeTexture(gl.TEXTURE0 + this.tex.unit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.t, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.dirty = true;
    }
    update(prog) {
        const { gl } = this;
        if (this.ok && this.dirty) {
            gl.activeTexture(gl.TEXTURE0 + this.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.useProgram(prog);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
            gl.viewport(0, 0, this.w, this.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, this.tex.t);
            this.dirty = false;
        }
        return this.ok;
    }
}
