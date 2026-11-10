/* 移植自 Folia components/visualizer/machi/engine/fx/lensPass.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { FullScreenQuad, Pass } from '../../../vendor/folia/three/examples/jsm/postprocessing/Pass.js';
import { fullscreenMaterial, GLOW_GLSL, halfFloatTarget } from './components_visualizer_machi_engine_fx_postPasses.mjs';
const LEVEL_MAX_COC = 8;
const LEVELS = 5;
const MAX_TAPS = 48;
const COC_GLSL = `
uniform float uDepthRange;
uniform float uFocus;
uniform float uFocusBand;
uniform float uFocusFalloff;
uniform float uCocRadius;
uniform float uTiltRadius;
// 离焦圆的半径（全分辨率像素）：对焦面之前为负、之后为正；移轴按画面上下另算，当成后景。
float machiCoc(float depth01, vec2 uv) {
    float offset = depth01 * uDepthRange - uFocus;
    float coc = smoothstep(uFocusBand, uFocusBand + uFocusFalloff, abs(offset)) * uCocRadius * (offset < 0.0 ? -1.0 : 1.0);
    float tilt = smoothstep(0.2, 0.55, abs(uv.y - 0.5)) * uTiltRadius;
    return abs(coc) >= tilt ? coc : tilt;
}
`;
const PREFILTER_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uSourceTexel;
varying vec2 vUv;
${COC_GLSL}
${GLOW_GLSL}
float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }
void main() {
    vec2 o = uSourceTexel * 0.5;
    vec2 p0 = vUv + vec2(-o.x, -o.y);
    vec2 p1 = vUv + vec2(o.x, -o.y);
    vec2 p2 = vUv + vec2(-o.x, o.y);
    vec2 p3 = vUv + vec2(o.x, o.y);
#ifdef MACHI_CUTOUT
    float d0 = texture2D(tDepth, p0).x;
    float d1 = texture2D(tDepth, p1).x;
    float d2 = texture2D(tDepth, p2).x;
    float d3 = texture2D(tDepth, p3).x;
    float h0 = step(d0, 0.9999);
    float h1 = step(d1, 0.9999);
    float h2 = step(d2, 0.9999);
    float h3 = step(d3, 0.9999);
    float hits = h0 + h1 + h2 + h3;
    vec3 color = hits > 0.0
        ? (machiGlowed(p0) * h0 + machiGlowed(p1) * h1 + machiGlowed(p2) * h2 + machiGlowed(p3) * h3) / hits
        : (machiGlowed(p0) + machiGlowed(p1) + machiGlowed(p2) + machiGlowed(p3)) * 0.25;
    float coc = widest(
        widest(machiCoc(d0, p0) * h0, machiCoc(d1, p1) * h1),
        widest(machiCoc(d2, p2) * h2, machiCoc(d3, p3) * h3)
    );
#else
    vec3 color = (machiGlowed(p0) + machiGlowed(p1) + machiGlowed(p2) + machiGlowed(p3)) * 0.25;
    float coc = widest(
        widest(machiCoc(texture2D(tDepth, p0).x, p0), machiCoc(texture2D(tDepth, p1).x, p1)),
        widest(machiCoc(texture2D(tDepth, p2).x, p2), machiCoc(texture2D(tDepth, p3).x, p3))
    );
#endif
    gl_FragColor = vec4(color, coc);
}
`;
const DOWNSAMPLE_FRAGMENT = `
uniform sampler2D tSource;
uniform vec2 uSourceTexel;
varying vec2 vUv;
float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }
void main() {
    vec2 o = uSourceTexel * 0.5;
    vec4 s0 = texture2D(tSource, vUv + vec2(-o.x, -o.y));
    vec4 s1 = texture2D(tSource, vUv + vec2(o.x, -o.y));
    vec4 s2 = texture2D(tSource, vUv + vec2(-o.x, o.y));
    vec4 s3 = texture2D(tSource, vUv + vec2(o.x, o.y));
    gl_FragColor = vec4((s0.rgb + s1.rgb + s2.rgb + s3.rgb) * 0.25, widest(widest(s0.a, s1.a), widest(s2.a, s3.a)));
}
`;
const GATHER_FRAGMENT = `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uMaxCoc;
uniform float uLevelScale;
uniform float uTaps;
varying vec2 vUv;
// 每个取样点比上一个多转一个黄金角：方向用转一个黄金角的矩阵一路乘下去，不用每个点算一次 cos、sin。
const mat2 GOLDEN_TURN = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);
const float MARGIN = 1.2;
void main() {
    vec4 center = texture2D(tSource, vUv);
    float centerCoc = center.a / uLevelScale;
    vec4 far = vec4(0.0);
    vec4 near = vec4(0.0);
    vec2 direction = vec2(1.0, 0.0);
    for (int i = 0; i < ${MAX_TAPS}; i++) {
        if (float(i) >= uTaps) break;
        float radius = sqrt((float(i) + 0.5) / uTaps) * uMaxCoc;
        vec4 tap = texture2D(tSource, vUv + direction * radius * uTexel);
        direction = GOLDEN_TURN * direction;
        float tapCoc = tap.a / uLevelScale;
        // 后景：取样点的圆与中心的圆里小的那个盖得到这里才收（清楚的前景不被身后的虚景糊上）。
        float farCoc = max(min(centerCoc, tapCoc), 0.0);
        float farWeight = clamp((farCoc - radius + MARGIN) / MARGIN, 0.0, 1.0);
        // 前景：自己的圆盖得到这里就收；清楚的点不算前景。
        float nearWeight = clamp((-tapCoc - radius + MARGIN) / MARGIN, 0.0, 1.0) * step(1.0, -tapCoc);
        far += vec4(tap.rgb, 1.0) * farWeight;
        near += vec4(tap.rgb, 1.0) * nearWeight;
    }
    vec3 farColor = far.a > 0.0 ? far.rgb / far.a : center.rgb;
    vec3 nearColor = near.a > 0.0 ? near.rgb / near.a : center.rgb;
    // 前景盖住的比例：圆盘约三分之一的样是前景时就算全盖住。
    float nearAlpha = clamp(near.a * 3.14159 / uTaps, 0.0, 1.0);
    gl_FragColor = vec4(mix(farColor, nearColor, nearAlpha), nearAlpha);
}
`;
const TENT_FRAGMENT = `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
    vec2 o = uTexel * 0.5;
    gl_FragColor = (texture2D(tSource, vUv + vec2(-o.x, -o.y)) + texture2D(tSource, vUv + vec2(o.x, -o.y))
        + texture2D(tSource, vUv + vec2(-o.x, o.y)) + texture2D(tSource, vUv + vec2(o.x, o.y))) * 0.25;
}
`;
const LENS_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tBokeh;
uniform sampler2D tDepth;
uniform sampler2D tCoverage;
uniform float uDofMix;
uniform vec2 uBlend;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uStars;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
${COC_GLSL}
${GLOW_GLSL}
#include <tonemapping_pars_fragment>
float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 centered = vUv - 0.5;
    float edge = dot(centered, centered);
    // 边缘色差：红蓝沿径向错开，中间不动。
    vec2 shift = centered * edge * uAberration;
    vec3 sharp = vec3(
        machiGlowed(vUv + shift).r,
        machiGlowed(vUv).g,
        machiGlowed(vUv - shift).b
    );
    // 景深：这个像素自己离焦够多（超过散景那一层一两个像素）就用散景；虚掉的前景盖到这里也用散景。
    vec4 bokeh = texture2D(tBokeh, vUv);
    float depth01 = texture2D(tDepth, vUv).x;
    float own = smoothstep(uBlend.x, uBlend.y, abs(machiCoc(depth01, vUv)));
    float amount = (own + bokeh.a - own * bokeh.a) * uDofMix;
    vec3 color = mix(sharp, bokeh.rgb, clamp(amount, 0.0, 1.0));
#ifndef MACHI_CUTOUT
    // 晴夜的星星：天空像素上格子里稀疏的亮点，各自慢慢闪。
    if (uStars > 0.001 && depth01 > 0.9999) {
        vec2 sp = vec2(vUv.x * uAspect, vUv.y) * 140.0;
        vec2 cell = floor(sp);
        float starSeed = gHash(cell);
        vec2 starAt = vec2(gHash(cell + 3.7), gHash(cell + 9.1)) * 0.6 + 0.2;
        float star = step(0.984, starSeed) * smoothstep(0.24, 0.0, length(fract(sp) - starAt))
            * (0.55 + 0.45 * sin(uTime * (0.8 + starSeed * 3.0) + starSeed * 60.0));
        color += vec3(0.85, 0.9, 1.0) * star * uStars * 1.3 * smoothstep(0.1, 0.55, vUv.y);
    }
#endif
    // 暗角。
    vec2 v = centered * vec2(uAspect, 1.0);
    float vignette = smoothstep(1.15, 0.35, length(v) * 1.15);
    color *= mix(1.0, vignette, uVignette);
    // 颗粒：跟亮度走，暗部更细。
    float grain = gHash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.31)) - 0.5;
    color += grain * uGrain * (0.25 + dot(color, vec3(0.3333)));
#ifdef MACHI_CUTOUT
    float alpha = depth01 > 0.9999 ? 0.0 : clamp(texture2D(tCoverage, vUv).a, 0.0, 1.0);
    gl_FragColor = vec4(max(color, 0.0), alpha) * uFade;
#else
    gl_FragColor = vec4(max(color, 0.0) * uFade, 1.0);
#endif
    // 色调映射与 sRGB 编码（和 three 的 OutputPass 一样，defines 由 MachiPost 按渲染器的设置给）。
#ifdef NEUTRAL_TONE_MAPPING
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
#endif
#ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
#endif
}
`;
export const resolveMachiBokehLevel = (maxCocPx)=>{
    let level = 0;
    let levelCoc = maxCocPx / 2;
    while(levelCoc > LEVEL_MAX_COC && level < LEVELS - 1){
        level += 1;
        levelCoc /= 2;
    }
    const taps = Math.min(MAX_TAPS, Math.max(12, Math.ceil(Math.PI * levelCoc * levelCoc / 4)));
    return {
        level,
        levelCoc,
        taps,
        scale: 2 ** (level + 1)
    };
};
export class MachiLensPass extends Pass {
    scene;
    chain = Array.from({
        length: LEVELS
    }, halfFloatTarget);
    work = [
        halfFloatTarget(),
        halfFloatTarget()
    ];
    prefilter;
    downsample;
    gather;
    tent;
    material;
    quad = new FullScreenQuad();
    fullSize = new THREE.Vector2(1, 1);
    dofEnabled = true;
    dofActive = true;
    bokeh = resolveMachiBokehLevel(0);
    constructor(scene, glow, output, cutout = false){
        super(), this.scene = scene;
        const coc = {
            uDepthRange: {
                value: 100
            },
            uFocus: {
                value: 60
            },
            uFocusBand: {
                value: 3
            },
            uFocusFalloff: {
                value: 7
            },
            uCocRadius: {
                value: 0
            },
            uTiltRadius: {
                value: 0
            }
        };
        this.prefilter = fullscreenMaterial({
            uniforms: {
                ...coc,
                ...glow,
                tDiffuse: {
                    value: null
                },
                tDepth: {
                    value: null
                },
                uSourceTexel: {
                    value: new THREE.Vector2()
                }
            },
            fragmentShader: PREFILTER_FRAGMENT,
            defines: cutout ? {
                MACHI_CUTOUT: ''
            } : {}
        });
        this.downsample = fullscreenMaterial({
            uniforms: {
                tSource: {
                    value: null
                },
                uSourceTexel: {
                    value: new THREE.Vector2()
                }
            },
            fragmentShader: DOWNSAMPLE_FRAGMENT
        });
        this.gather = fullscreenMaterial({
            uniforms: {
                tSource: {
                    value: null
                },
                uTexel: {
                    value: new THREE.Vector2()
                },
                uMaxCoc: {
                    value: 1
                },
                uLevelScale: {
                    value: 2
                },
                uTaps: {
                    value: 12
                }
            },
            fragmentShader: GATHER_FRAGMENT
        });
        this.tent = fullscreenMaterial({
            uniforms: {
                tSource: {
                    value: null
                },
                uTexel: {
                    value: new THREE.Vector2()
                }
            },
            fragmentShader: TENT_FRAGMENT
        });
        this.material = fullscreenMaterial({
            uniforms: {
                ...coc,
                ...glow,
                tDiffuse: {
                    value: null
                },
                tBokeh: {
                    value: null
                },
                tDepth: {
                    value: null
                },
                tCoverage: {
                    value: null
                },
                uDofMix: {
                    value: 0
                },
                uBlend: {
                    value: new THREE.Vector2(1, 3)
                },
                uAberration: {
                    value: 0.012
                },
                uVignette: {
                    value: 0.55
                },
                uGrain: {
                    value: 0.035
                },
                uStars: {
                    value: 0
                },
                uFade: {
                    value: 1
                },
                uTime: {
                    value: 0
                },
                uAspect: {
                    value: 16 / 9
                }
            },
            fragmentShader: LENS_FRAGMENT,
            defines: {
                ...cutout ? {
                    MACHI_CUTOUT: ''
                } : {},
                ...output.neutralToneMapping ? {
                    NEUTRAL_TONE_MAPPING: ''
                } : {},
                ...output.srgb ? {
                    SRGB_TRANSFER: ''
                } : {}
            },
            toneMapped: false
        });
    }
    setSize(width, height) {
        this.fullSize.set(Math.max(1, width), Math.max(1, height));
        this.chain.forEach((target, index)=>{
            const divisor = 2 ** (index + 1);
            target.setSize(Math.max(1, Math.round(width / divisor)), Math.max(1, Math.round(height / divisor)));
        });
        this.material.uniforms.uAspect.value = width / Math.max(1, height);
    }
    configure(settings, depthRange, time) {
        const uniforms = this.material.uniforms;
        const height = this.fullSize.y;
        const cocPx = Math.max(0, settings.coc) * height;
        const tiltPx = Math.max(0, settings.tilt) * height;
        this.dofActive = this.dofEnabled && (cocPx > 0.5 || tiltPx > 0.5);
        this.bokeh = resolveMachiBokehLevel(Math.max(cocPx, tiltPx));
        uniforms.uDepthRange.value = depthRange;
        uniforms.uFocus.value = settings.focus;
        uniforms.uFocusBand.value = settings.focusBand;
        uniforms.uFocusFalloff.value = settings.focusFalloff;
        uniforms.uCocRadius.value = this.dofActive ? cocPx : 0;
        uniforms.uTiltRadius.value = this.dofActive ? tiltPx : 0;
        uniforms.uDofMix.value = this.dofActive ? 1 : 0;
        uniforms.uBlend.value.set(0.5 * this.bokeh.scale, 1.5 * this.bokeh.scale);
        uniforms.uAberration.value = settings.aberration;
        uniforms.uVignette.value = settings.vignette;
        uniforms.uGrain.value = settings.grain;
        uniforms.uStars.value = settings.stars ?? 0;
        uniforms.uFade.value = settings.fade ?? 1;
        uniforms.uTime.value = time;
    }
    draw(renderer, material, target) {
        this.quad.material = material;
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
    }
    render(renderer, writeBuffer) {
        const uniforms = this.material.uniforms;
        const depth = this.scene.target.depthTexture;
        const lit = this.scene.lit.texture;
        uniforms.tBokeh.value = lit;
        if (this.dofActive) {
            const { level, levelCoc, taps, scale } = this.bokeh;
            const [first] = this.chain;
            this.prefilter.uniforms.tDiffuse.value = lit;
            this.prefilter.uniforms.tDepth.value = depth;
            this.prefilter.uniforms.uSourceTexel.value.set(1 / this.fullSize.x, 1 / this.fullSize.y);
            this.draw(renderer, this.prefilter, first);
            for(let index = 1; index <= level; index += 1){
                const source = this.chain[index - 1];
                this.downsample.uniforms.tSource.value = source.texture;
                this.downsample.uniforms.uSourceTexel.value.set(1 / source.width, 1 / source.height);
                this.draw(renderer, this.downsample, this.chain[index]);
            }
            const source = this.chain[level];
            const [gathered, smoothed] = this.work;
            gathered.setSize(source.width, source.height);
            smoothed.setSize(source.width, source.height);
            const gather = this.gather.uniforms;
            gather.tSource.value = source.texture;
            gather.uTexel.value.set(1 / source.width, 1 / source.height);
            gather.uMaxCoc.value = levelCoc;
            gather.uLevelScale.value = scale;
            gather.uTaps.value = taps;
            this.draw(renderer, this.gather, gathered);
            this.tent.uniforms.tSource.value = gathered.texture;
            this.tent.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
            this.draw(renderer, this.tent, smoothed);
            uniforms.tBokeh.value = smoothed.texture;
        }
        uniforms.tDiffuse.value = lit;
        uniforms.tDepth.value = depth;
        uniforms.tCoverage.value = this.scene.target.texture;
        this.draw(renderer, this.material, this.renderToScreen ? null : writeBuffer);
    }
    dispose() {
        this.chain.forEach((target)=>target.dispose());
        this.work.forEach((target)=>target.dispose());
        this.prefilter.dispose();
        this.downsample.dispose();
        this.gather.dispose();
        this.tent.dispose();
        this.material.dispose();
        this.quad.dispose();
    }
}
