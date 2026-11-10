/* 移植自 Folia components/visualizer/machi/engine/lyricScreen.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { buildWordColorRangesFromMatchers } from './components_visualizer_wordColoring.mjs';
import { layoutMachiBoardCard, layoutMachiBoardLine, resolveMachiBoardReveal } from './components_visualizer_machi_engine_boardLayout.mjs';
import { createCanvas, MACHI_REFERENCE_PX, paintMachiBoard } from './components_visualizer_machi_engine_signRaster.mjs';
const TEXTURE_WIDTH = 1280;
const SWITCH_SECONDS = 0.3;
const CELLS_X = 150;
const PEAK = {
    dark: 0.95,
    light: 0.8
};
const POOL_SIZE = 3;
const VERTEX = `
varying vec2 vUv;
varying vec3 vViewNormal;
void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uBase;
uniform float uBright;
uniform float uLitGain;
uniform float uUnlitGain;
uniform vec3 uRowBottom;
uniform vec3 uReveal;
uniform float uSoft;
uniform vec2 uCells;
uniform float uTime;
uniform float uGlitch;
uniform float uPeak;
uniform vec3 uSheen;
uniform vec4 uSwellAt;
uniform vec4 uSwellAmp;
varying vec2 vUv;
varying vec3 vViewNormal;
float bHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
    // 换行时的信号切换：几条横带错开、色散变大、亮度掉一下。
    vec2 uv = vUv;
    float tear = bHash(floor(vUv.y * 22.0) + floor(uTime * 24.0) * 7.0);
    uv.x += (tear - 0.5) * 0.08 * uGlitch * step(0.62, tear);
    // 像素格：贴图按原分辨率取（字不糊），点亮的边界对齐到格；格子小到约 2.5 个屏幕像素以下就把网格淡掉，免得出摩尔纹。
    vec2 cellUv = vUv * uCells;
    vec2 perPixel = fwidth(cellUv);
    float grid = 1.0 - smoothstep(0.3, 0.55, max(perPixel.x, perPixel.y));
    float y = 1.0 - vUv.y;
    float split = 0.0008 + 0.006 * uGlitch;
    vec4 unlit = texture2D(uMap, vec2(uv.x, 0.5 + uv.y * 0.5));
    vec4 litR = texture2D(uMap, vec2(uv.x + split, uv.y * 0.5));
    vec4 litG = texture2D(uMap, vec2(uv.x, uv.y * 0.5));
    vec4 litB = texture2D(uMap, vec2(uv.x - split, uv.y * 0.5));
    float reveal = y < uRowBottom.x ? uReveal.x : (y < uRowBottom.y ? uReveal.y : uReveal.z);
    float snapped = (floor(vUv.x * uCells.x) + 0.5) / uCells.x;
    float on = 1.0 - smoothstep(reveal - uSoft, reveal + uSoft, mix(vUv.x, snapped, grid));
    // 屏幕的底：边缘一圈略暗（像素老化 / 边框阴影）。
    float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    vec3 base = uBase * (0.92 + 0.08 * smoothstep(1.0, 0.0, y)) * (0.8 + 0.2 * edge);
    vec3 color = mix(base, unlit.rgb * uUnlitGain, unlit.a);
    color = mix(color, vec3(litR.r, litG.g, litB.b) * uLitGain, vec3(litR.a, litG.a, litB.a) * on);
    // 像素之间的黑缝与 RGB 子像素条（按格的可见度淡入淡出），平均亮度不变。
    vec2 f = fract(cellUv) - 0.5;
    float gap = smoothstep(0.5, 0.38, abs(f.x)) * smoothstep(0.5, 0.36, abs(f.y));
    vec3 stripe = clamp(1.6 - abs(vec3(fract(cellUv.x) * 3.0) - vec3(0.5, 1.5, 2.5)) * 1.1, 0.0, 1.0) * 2.0;
    vec3 mask = gap * mix(vec3(1.0), stripe, 0.35) / 0.78;
    color *= mix(vec3(1.0), mask, grid * 0.8);
    // 慢慢往下走的刷新带，切换时的雪花点。
    float roll = fract(vUv.y + uTime * 0.07);
    color *= (1.0 + 0.045 * exp(-pow((roll - 0.5) * 9.0, 2.0))) * (1.0 - 0.3 * uGlitch);
    color += (bHash(dot(floor(cellUv), vec2(1.0, 157.0)) + floor(uTime * 30.0)) - 0.5) * 0.12 * uGlitch;
    color = max(color * uBright, 0.0);
    // 大屏闪拍：几处宽的亮斑（整块也带一点），叠起来按 1 - e^-x 收住，军鼓再密也不过亮；字和底色一起提亮。
    vec4 swellDx = vec4(vUv.x) - uSwellAt;
    float swell = 1.0 - exp(-dot(uSwellAmp, 0.2 + 0.8 * exp(-swellDx * swellDx * 10.0)));
    color = color * (1.0 + 0.85 * swell) + uBase * 0.5 * swell;
    // 最亮的通道压到 uPeak（保色相）：字清楚，不被 bloom 晕开。
    float peak = max(max(color.r, color.g), color.b);
    color *= min(1.0, (uPeak + 0.55 * swell) / max(peak, 1e-4));
    // 面板玻璃：一点天光反射，侧着看更明显，再加一道斜的柔光。
    float fresnel = pow(1.0 - clamp(vViewNormal.z, 0.0, 1.0), 3.0);
    float glare = smoothstep(0.22, 0.0, abs(vUv.x * 0.7 + vUv.y * 0.9 - 1.05));
    color += uSheen * (0.035 + 0.22 * fresnel + 0.05 * glare);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;
export class MachiLyricScreen {
    blend;
    width;
    height;
    material;
    pool;
    slot = null;
    pendingSlot = null;
    switchElapsed = SWITCH_SECONDS;
    target = null;
    box;
    content = null;
    lines = [];
    chorusGlow = 0;
    geometries = [];
    constructor(materials, blend, width, height){
        this.blend = blend;
        this.width = width;
        this.height = height;
        const half = Math.round(TEXTURE_WIDTH * (height / width));
        this.box = {
            width: TEXTURE_WIDTH,
            height: half,
            paddingX: 0.05,
            referencePx: MACHI_REFERENCE_PX
        };
        this.pool = Array.from({
            length: POOL_SIZE
        }, ()=>{
            const canvas = createCanvas(TEXTURE_WIDTH, half * 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            return {
                canvas,
                texture,
                key: '',
                layout: null,
                usedAt: 0
            };
        });
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uMap: {
                    value: this.pool[0].texture
                },
                uBase: {
                    value: new THREE.Color()
                },
                uBright: {
                    value: 1
                },
                uLitGain: {
                    value: 1.25
                },
                uUnlitGain: {
                    value: 0.9
                },
                uRowBottom: {
                    value: new THREE.Vector3(1, 1, 1)
                },
                uReveal: {
                    value: new THREE.Vector3(0, 0, 0)
                },
                uSoft: {
                    value: 0.004
                },
                uCells: {
                    value: new THREE.Vector2(CELLS_X, Math.round(CELLS_X * height / width))
                },
                uTime: {
                    value: 0
                },
                uGlitch: {
                    value: 0
                },
                uPeak: {
                    value: PEAK.dark
                },
                uSheen: {
                    value: new THREE.Color()
                },
                uSwellAt: {
                    value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5)
                },
                uSwellAmp: {
                    value: new THREE.Vector4()
                }
            }
        }));
        this.material.name = 'machi:lyricScreen';
    }
    createFace(position, rotationY, name) {
        const geometry = new THREE.PlaneGeometry(this.width, this.height);
        this.geometries.push(geometry);
        const face = new THREE.Mesh(geometry, this.material);
        face.name = name;
        face.position.copy(position);
        face.rotation.y = rotationY;
        return face;
    }
    setContent(content) {
        this.content = content;
        this.pool.forEach((slot)=>{
            slot.key = '';
        });
        const target = this.target;
        this.target = null;
        if (target) this.show(target, this.lines, true);
    }
    slotKey(target, showText) {
        return target.kind === 'line' && showText ? `line:${target.index}` : 'card';
    }
    prepare(target, lines, showText) {
        const content = this.content;
        if (!content) return null;
        const key = this.slotKey(target, showText);
        const hit = this.pool.find((slot)=>slot.key === key);
        if (hit) {
            hit.usedAt = performance.now();
            return hit;
        }
        const slot = this.pool.filter((candidate)=>candidate !== this.slot && candidate !== this.pendingSlot).sort((a, b)=>a.usedAt - b.usedAt)[0];
        if (!slot) return null;
        const line = target.kind === 'line' ? lines[target.index] : undefined;
        const card = !line || !showText;
        const layout = card ? layoutMachiBoardCard(content.cardTitle, content.cardSubtitle, this.box, content.measure) : layoutMachiBoardLine(line, this.box, content.measure);
        const keywordRanges = card ? [] : buildWordColorRangesFromMatchers(line.fullText, content.matchers);
        paintMachiBoard(slot.canvas, {
            layout,
            font: content.font,
            unlit: content.palette.boardUnlit,
            lit: content.palette.boardLit,
            keywordRanges,
            card
        });
        slot.texture.needsUpdate = true;
        slot.key = key;
        slot.layout = layout;
        slot.usedAt = performance.now();
        return slot;
    }
    show(target, lines, immediate, showText = true) {
        this.lines = lines;
        const sameKey = this.target && this.slotKey(this.target, showText) === this.slotKey(target, showText);
        this.target = target;
        const slot = this.prepare(target, lines, showText);
        if (!slot) return;
        if (sameKey && this.slot === slot) return;
        if (immediate || !this.slot) {
            this.apply(slot);
            this.switchElapsed = SWITCH_SECONDS;
            this.pendingSlot = null;
        } else {
            this.pendingSlot = slot;
            this.switchElapsed = 0;
        }
    }
    preheat(target, lines, showText) {
        const key = this.slotKey(target, showText);
        if (this.pool.some((slot)=>slot.key === key)) return;
        this.prepare(target, lines, showText);
    }
    apply(slot) {
        this.slot = slot;
        this.material.uniforms.uMap.value = slot.texture;
        const layout = slot.layout;
        const bottoms = [
            1,
            1,
            1
        ];
        if (layout) {
            layout.rows.forEach((row, index)=>{
                if (index < 3) bottoms[index] = index === layout.rows.length - 1 ? 1 : row.bottom / layout.height;
            });
        }
        this.material.uniforms.uRowBottom.value.set(bottoms[0], bottoms[1], bottoms[2]);
    }
    update(frame) {
        const content = this.content;
        if (!content) return;
        const palette = content.palette;
        let glitch = 0;
        if (this.switchElapsed < SWITCH_SECONDS) {
            this.switchElapsed += frame.staticMode ? SWITCH_SECONDS : Math.max(frame.delta, 1 / 120);
            const t = Math.min(1, this.switchElapsed / SWITCH_SECONDS);
            if (t >= 0.45 && this.pendingSlot) {
                this.apply(this.pendingSlot);
                this.pendingSlot = null;
            }
            glitch = t >= 1 ? 0 : Math.sin(Math.PI * t) ** 0.7;
        }
        this.chorusGlow += (frame.chorus - this.chorusGlow) * (1 - Math.exp(-frame.delta * 3));
        const layout = this.slot?.layout;
        const reveal = layout ? resolveMachiBoardReveal(layout, frame.songTime) : [];
        this.material.uniforms.uReveal.value.set((reveal[0] ?? 0) / this.box.width, (reveal[1] ?? 0) / this.box.width, (reveal[2] ?? 0) / this.box.width);
        const uniforms = this.material.uniforms;
        uniforms.uBase.value.copy(this.blend.get('boardBase')).multiplyScalar(palette.boardIsLight ? 0.98 : 1.0);
        uniforms.uLitGain.value = palette.boardIsLight ? 1.0 : 1.25 + 0.2 * this.chorusGlow;
        uniforms.uUnlitGain.value = palette.boardIsLight ? 1.0 : 0.9;
        uniforms.uBright.value = 1 + 0.05 * frame.audio + 0.06 * this.chorusGlow;
        uniforms.uPeak.value = palette.boardIsLight ? PEAK.light : PEAK.dark;
        uniforms.uGlitch.value = glitch;
        uniforms.uTime.value = frame.ambientTime;
        uniforms.uSheen.value.copy(this.blend.get('moon')).multiplyScalar(0.35);
        uniforms.uSwellAt.value.fromArray(frame.beat.swellAt);
        uniforms.uSwellAmp.value.fromArray(frame.beat.swellAmp);
    }
    get chorus() {
        return this.chorusGlow;
    }
    get busy() {
        return this.switchElapsed < SWITCH_SECONDS;
    }
    dispose() {
        this.pool.forEach((slot)=>slot.texture.dispose());
        this.geometries.forEach((geometry)=>geometry.dispose());
    }
}
