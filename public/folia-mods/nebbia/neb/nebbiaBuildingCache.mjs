/* 移植自 Folia「雾笺」 nebbiaBuildingCache.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { makeTex } from './nebbiaGlUtils.mjs';
const LEVELS = [
    {
        b: 0.0012,
        y0: 0.03,
        y1: 0.63,
        fog: false
    },
    {
        b: 0.03,
        y0: 0.0,
        y1: 0.66,
        fog: true
    },
    {
        b: 0.09,
        y0: -0.06,
        y1: 0.73,
        fog: true
    }
];
const SPEED = [
    0.02,
    0.035
];
const SHARP_SCALE = 0.5;
const MARGIN = 0.15, SLACK = 0.2;
export const ringColumns = (a, b, span, w)=>{
    const ca = Math.floor(a / span * w), n = Math.min(w, Math.ceil(b / span * w) - ca);
    const start = (ca % w + w) % w, first = Math.min(Math.max(n, 0), w - start);
    const runs = n <= 0 ? [] : n > first ? [
        [
            start,
            first
        ],
        [
            0,
            n - first
        ]
    ] : [
        [
            start,
            n
        ]
    ];
    return {
        x0: ca * span / w,
        runs
    };
};
export const BLD_FILL_UNIFORMS = [
    'uFillB',
    'uFillLayer',
    'uFillX0',
    'uFillGeo',
    'uFillSize'
];
export class NebbiaBuildingCache {
    gl;
    caches = [];
    span = 1;
    aspect = 1;
    constructor(gl, firstUnit){
        this.gl = gl;
        LEVELS.forEach((_, level)=>SPEED.forEach((__, layer)=>{
                const tex = makeTex(gl, firstUnit + level * 2 + layer);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                this.caches.push({
                    tex,
                    fb: gl.createFramebuffer(),
                    level,
                    layer,
                    w: 1,
                    h: 1,
                    lo: 0,
                    hi: 0,
                    valid: false
                });
            }));
    }
    bindSamplers(prog) {
        const { gl } = this;
        gl.useProgram(prog);
        this.caches.forEach((c, i)=>gl.uniform1i(gl.getUniformLocation(prog, `uBld${i}`), c.tex.unit));
    }
    invalidate() {
        for (const c of this.caches)c.valid = false;
    }
    resize(canvasW, canvasH, fogH) {
        const { gl } = this;
        this.aspect = canvasW / canvasH;
        this.span = this.aspect + 2 * MARGIN + SLACK;
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        for (const c of this.caches){
            const L = LEVELS[c.level];
            const dens = Math.min(L.fog ? fogH : canvasH * SHARP_SCALE, maxSize / this.span);
            c.w = Math.max(1, Math.ceil(this.span * dens));
            c.h = Math.max(1, Math.ceil((L.y1 - L.y0) * dens));
            gl.activeTexture(gl.TEXTURE0 + c.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, c.tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, c.w, c.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c.tex.t, 0);
            c.valid = false;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    update(t, prog, F) {
        const { gl } = this;
        let fullLevel = -1, drawing = false;
        for (const c of this.caches){
            const off = t * SPEED[c.layer], lo = off - MARGIN, hi = off + this.aspect + MARGIN;
            if (c.valid && lo >= c.lo && hi <= c.hi) continue;
            const ahead = c.valid && lo >= c.lo && hi - c.hi < this.span / 2;
            if (!ahead && fullLevel >= 0 && fullLevel !== c.level) {
                c.valid = false;
                continue;
            }
            if (!drawing) {
                gl.useProgram(prog);
                gl.enable(gl.SCISSOR_TEST);
                drawing = true;
            }
            if (ahead) {
                const next = hi + SLACK / 4;
                this.fill(c, c.hi, next, F);
                c.hi = next;
                c.lo = next - this.span;
            } else {
                fullLevel = c.level;
                c.lo = lo - SLACK / 4;
                c.hi = c.lo + this.span;
                this.fill(c, c.lo, c.hi, F);
                c.valid = true;
            }
        }
        if (drawing) {
            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        const on = LEVELS.map((_, level)=>this.caches[level * 2].valid && this.caches[level * 2 + 1].valid ? 1 : 0);
        return {
            on: [
                on[0],
                on[1],
                on[2]
            ],
            geo: LEVELS.flatMap((L)=>[
                    L.y0,
                    L.y1,
                    this.span
                ])
        };
    }
    fill(c, a, b, U) {
        const { gl } = this;
        const L = LEVELS[c.level];
        const { x0, runs } = ringColumns(a, b, this.span, c.w);
        if (!runs.length) return;
        gl.activeTexture(gl.TEXTURE0 + c.tex.unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
        gl.viewport(0, 0, c.w, c.h);
        gl.uniform1f(U.uFillB, L.b);
        gl.uniform1f(U.uFillLayer, c.layer);
        gl.uniform1f(U.uFillX0, x0);
        gl.uniform3f(U.uFillGeo, L.y0, L.y1, this.span);
        gl.uniform2f(U.uFillSize, c.w, c.h);
        for (const [start, n] of runs){
            gl.scissor(start, 0, n, c.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindTexture(gl.TEXTURE_2D, c.tex.t);
    }
}
