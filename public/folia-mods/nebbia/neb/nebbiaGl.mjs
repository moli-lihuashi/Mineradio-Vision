/* 移植自 Folia「雾笺」 nebbiaGl.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { FOG_DIV, NEBBIA_FIXED } from './nebbiaConstants.mjs';
const raindropSpriteUrl = new URL('../assets/raindrop.png', import.meta.url).href;
import { BLD_FILL_UNIFORMS, NebbiaBuildingCache } from './nebbiaBuildingCache.mjs';
import { NebbiaFogGl } from './nebbiaFogGl.mjs';
import { NebbiaNoiseTex } from './nebbiaNoiseTex.mjs';
import { makeTex } from './nebbiaGlUtils.mjs';
import { NebbiaMaskGl } from './nebbiaMaskGl.mjs';
import { canRenderFogToFloat, NebbiaProgramBuild } from './nebbiaPrograms.mjs';
import { NebbiaSnowGl } from './nebbiaSnowGl.mjs';
const PALETTE_UNIFORMS = [
    'uSky0',
    'uSky1',
    'uLa',
    'uLb',
    'uLc'
];
const SCENE_UNIFORMS = [
    'uRes',
    'uSceneShift',
    'uTime',
    'uBus',
    'uNeon',
    ...PALETTE_UNIFORMS,
    'uSpotSrc',
    'uSpotSrc2',
    'uSpotTgt',
    'uSpotR',
    'uSpotI',
    'uScenery',
    'uBldOn',
    'uBldGeo',
    'uJelly',
    'uJellyC',
    'uJellyN',
    'uBubbles',
    'uSway',
    'uBurst',
    'uBurstN',
    'uBeatRows'
];
const MAIN_UNIFORMS = [
    ...SCENE_UNIFORMS,
    'uDewGlint',
    'uMist',
    'uEdge',
    'uRefract',
    'uGlint',
    'uGlassShift',
    'uBreathOn',
    'uBreathThick',
    'uNoiseOn',
    'uSeeThrough',
    'uMistTint'
];
const SCN_BUILDINGS = 1;
const NO_BUILDINGS = {
    on: [
        0,
        0,
        0
    ],
    geo: [
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1
    ]
};
const locate = (gl, prog, names)=>Object.fromEntries(names.map((n)=>[
            n,
            gl.getUniformLocation(prog, n)
        ]));
export class NebbiaGl {
    canvas;
    seeThrough;
    gl;
    build;
    quadVao;
    spriteVao;
    instBuf;
    U = {};
    F = {};
    B = {};
    bld;
    uView = null;
    uFogB = null;
    linked = false;
    mask;
    drop;
    field;
    sprite;
    breath;
    fogGl;
    fogOK;
    noise;
    snow;
    W = 1;
    H = 1;
    spriteReady = false;
    breathVersion = -1;
    breathW = 0;
    breathH = 0;
    fieldValid = false;
    instData = new Float32Array(0);
    palette = null;
    mistTint = [
        0.07,
        0.08,
        0.1
    ];
    onSpriteReady = null;
    constructor(canvas, seeThrough = false, scene = 'night', glass = 'rain'){
        this.canvas = canvas;
        this.seeThrough = seeThrough;
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            alpha: seeThrough,
            preserveDrawingBuffer: false
        });
        if (!gl) throw new Error('Nebbia: WebGL2 unavailable');
        this.gl = gl;
        this.fogOK = canRenderFogToFloat(gl);
        this.build = new NebbiaProgramBuild(gl, this.fogOK, scene, glass);
        this.quadVao = gl.createVertexArray();
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1,
            -1,
            1,
            -1,
            -1,
            1,
            1,
            1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.mask = new NebbiaMaskGl(gl, 2);
        this.drop = makeTex(gl, 3);
        this.field = makeTex(gl, 4);
        this.sprite = makeTex(gl, 5);
        this.fogGl = new NebbiaFogGl(gl, 6, this.fogOK, glass === 'dew' && !seeThrough ? 1 : null);
        this.breath = makeTex(gl, 8);
        this.bld = scene === 'night' ? new NebbiaBuildingCache(gl, 9) : null;
        this.noise = new NebbiaNoiseTex(gl, 15);
        this.snow = glass === 'snow' ? new NebbiaSnowGl(gl, 1) : null;
        this.spriteVao = gl.createVertexArray();
        gl.bindVertexArray(this.spriteVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0,
            0,
            1,
            0,
            0,
            1,
            1,
            1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.instBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
        gl.vertexAttribDivisor(2, 1);
        gl.bindVertexArray(null);
        this.loadSprite();
    }
    get isContextLost() {
        return this.gl.isContextLost();
    }
    get ready() {
        if (this.linked) return true;
        if (!this.build.poll()) return false;
        const { gl } = this;
        const { main, fog, sprite, mask, bldFill, flake } = this.build.programs;
        this.mask.attach(mask);
        this.U = locate(gl, main, MAIN_UNIFORMS);
        gl.useProgram(main);
        const [fogBlur, fogGlow, fogSharp] = this.fogGl.layers;
        const samplers = [
            [
                'uMask',
                this.mask.tex
            ],
            [
                'uDrop',
                this.drop
            ],
            [
                'uField',
                this.field
            ],
            [
                'uFogBlur',
                fogBlur.tex
            ],
            [
                'uFogGlow',
                fogGlow.tex
            ],
            [
                'uBreath',
                this.breath
            ],
            [
                'uNoise',
                this.noise.tex
            ]
        ];
        if (fogSharp) samplers.push([
            'uFogSharp',
            fogSharp.tex
        ]);
        for (const [name, tex] of samplers)gl.uniform1i(gl.getUniformLocation(main, name), tex.unit);
        gl.uniform1f(this.U.uBreathThick, NEBBIA_FIXED.breathThick);
        gl.uniform1i(this.U.uSeeThrough, this.seeThrough ? 1 : 0);
        this.bld?.bindSamplers(main);
        if (fog) {
            this.F = locate(gl, fog, SCENE_UNIFORMS);
            this.uFogB = gl.getUniformLocation(fog, 'uFogB');
            this.bld?.bindSamplers(fog);
        }
        if (bldFill) this.B = locate(gl, bldFill, [
            ...PALETTE_UNIFORMS,
            ...BLD_FILL_UNIFORMS
        ]);
        if (flake) this.snow?.attach(flake, fogGlow.tex.unit, fogBlur.tex.unit, this.fogOK && !this.seeThrough);
        gl.useProgram(sprite);
        this.uView = gl.getUniformLocation(sprite, 'uView');
        gl.uniform1i(gl.getUniformLocation(sprite, 'uSprite'), this.sprite.unit);
        this.linked = true;
        if (this.palette) this.applyPalette(this.palette);
        return true;
    }
    loadSprite() {
        const img = new Image();
        img.onload = ()=>{
            const { gl } = this;
            if (gl.isContextLost()) return;
            gl.activeTexture(gl.TEXTURE0 + this.sprite.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.sprite.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            this.spriteReady = true;
            this.onSpriteReady?.();
        };
        img.src = raindropSpriteUrl;
    }
    setPalette(sky0, sky1, la, lb, lc) {
        this.palette = [
            sky0,
            sky1,
            la,
            lb,
            lc
        ];
        if (this.linked) this.applyPalette(this.palette);
    }
    applyPalette([sky0, sky1, la, lb, lc]) {
        const { gl } = this;
        const { main, fog, bldFill } = this.build.programs;
        for (const [prog, L] of [
            [
                main,
                this.U
            ],
            [
                fog,
                this.F
            ],
            [
                bldFill,
                this.B
            ]
        ]){
            if (!prog) continue;
            gl.useProgram(prog);
            gl.uniform3fv(L.uSky0, sky0);
            gl.uniform3fv(L.uSky1, sky1);
            gl.uniform3fv(L.uLa, la);
            gl.uniform3fv(L.uLb, lb);
            gl.uniform3fv(L.uLc, lc);
        }
        this.bld?.invalidate();
    }
    resize(W, H, dpr) {
        const { gl } = this;
        this.W = Math.max(1, Math.round(W));
        this.H = Math.max(1, Math.round(H));
        this.canvas.width = Math.max(1, Math.round(W * dpr));
        this.canvas.height = Math.max(1, Math.round(H * dpr));
        this.mask.resize(W, H);
        this.fieldValid = false;
        for (const tex of [
            this.drop,
            this.field
        ]){
            gl.activeTexture(gl.TEXTURE0 + tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            if (!tex.fb) tex.fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.fogGl.resize(this.canvas.width, this.canvas.height);
        this.noise.resize(this.canvas.width, this.canvas.height);
        this.bld?.resize(this.canvas.width, this.canvas.height, Math.max(1, Math.ceil(this.canvas.height / FOG_DIV)));
    }
    renderDrops(tex, inst) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
        gl.viewport(0, 0, this.W, this.H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (inst.length && this.spriteReady) {
            let data;
            if (inst instanceof Float32Array) data = inst;
            else {
                if (this.instData.length < inst.length) this.instData = new Float32Array(Math.ceil(inst.length * 1.5));
                this.instData.set(inst);
                data = this.instData.subarray(0, inst.length);
            }
            gl.useProgram(this.build.programs.sprite);
            gl.bindVertexArray(this.spriteVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uView, this.W, this.H);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.length / 6);
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    setScene(L, u) {
        const { gl } = this;
        gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(L.uTime, u.time);
        gl.uniform1f(L.uBus, u.bus);
        gl.uniform1f(L.uNeon, u.neon);
        gl.uniform2fv(L.uSceneShift, u.sceneShift);
        gl.uniform2fv(L.uSpotSrc, u.spotSrc);
        gl.uniform2fv(L.uSpotSrc2, u.spotSrc2);
        gl.uniform2fv(L.uSpotTgt, u.spotTgt);
        gl.uniform1f(L.uSpotR, u.spotR);
        gl.uniform1f(L.uSpotI, u.spotI);
        gl.uniform1i(L.uScenery, u.scenery);
        gl.uniform1f(L.uDewGlint, u.dewGlint);
        if (u.aqua) {
            gl.uniform4fv(L.uJelly, u.aqua.jelly);
            gl.uniform4fv(L.uJellyC, u.aqua.jellyColor);
            gl.uniform1i(L.uJellyN, u.aqua.count);
            gl.uniform1f(L.uBubbles, u.aqua.bubbles);
            gl.uniform4fv(L.uSway, u.aqua.sway);
            gl.uniform4fv(L.uBurst, u.aqua.bursts);
            gl.uniform1i(L.uBurstN, u.aqua.burstCount);
            gl.uniform1f(L.uBeatRows, u.aqua.beatRows);
        }
    }
    setBuildings(L, s) {
        const { gl } = this;
        gl.uniform3i(L.uBldOn, s.on[0], s.on[1], s.on[2]);
        gl.uniform3fv(L.uBldGeo, s.geo);
    }
    render(mask, breath, drops, field, u, fieldChanged = true) {
        const { gl, U } = this;
        const { main, fog, bldFill, noise } = this.build.programs;
        this.mask.draw(mask);
        if (breath && breath.version !== this.breathVersion) {
            const { canvas: c } = breath;
            gl.activeTexture(gl.TEXTURE0 + this.breath.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.breath.t);
            if (c.width === this.breathW && c.height === this.breathH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
            else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            this.breathVersion = breath.version;
            this.breathW = c.width;
            this.breathH = c.height;
        }
        this.renderDrops(this.drop, drops);
        if (fieldChanged || !this.fieldValid) {
            this.renderDrops(this.field, field);
            this.fieldValid = this.spriteReady;
        }
        gl.bindVertexArray(this.quadVao);
        const buildings = u.scenery & SCN_BUILDINGS && !this.seeThrough && bldFill && this.bld ? this.bld.update(u.time * u.bus, bldFill, this.B) : NO_BUILDINGS;
        const noiseOn = this.noise.update(noise);
        if (fog && !this.seeThrough) {
            gl.useProgram(fog);
            this.setScene(this.F, u);
            this.setBuildings(this.F, buildings);
            this.fogGl.draw(this.uFogB);
        }
        gl.useProgram(main);
        this.setScene(U, u);
        this.setBuildings(U, buildings);
        gl.uniform1f(U.uMist, u.mist);
        gl.uniform1f(U.uEdge, u.edge);
        gl.uniform1f(U.uRefract, u.refract);
        gl.uniform1f(U.uGlint, u.glint);
        gl.uniform2fv(U.uGlassShift, u.glassShift);
        gl.uniform1i(U.uBreathOn, breath ? 1 : 0);
        gl.uniform1i(U.uNoiseOn, noiseOn ? 1 : 0);
        gl.uniform3fv(U.uMistTint, this.mistTint);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }
    setFlakeAtlas(canvas, rows) {
        this.snow?.setAtlas(canvas, rows);
    }
    drawFlakes(data, count, shift) {
        this.snow?.draw(data, count, this.W, this.H, [
            -shift[0] * this.W,
            -shift[1] * this.H
        ]);
    }
    destroy() {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
