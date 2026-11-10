/* 移植自 Folia components/visualizer/machi/engine/fx/ground.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { MACHI_BEAT } from './components_visualizer_machi_engine_beatFx.mjs';
import { injectMachiSheen, MACHI_GLOSS } from './components_visualizer_machi_engine_sheen.mjs';
import { injectMachiSnow } from './components_visualizer_machi_engine_snow.mjs';
const PARS = `
uniform float uTime;
uniform sampler2D uReflection;
uniform mat4 uReflectMatrix;
uniform vec2 uPuddleOffset;
uniform float uPuddleAmount;
uniform float uRain;
uniform float uWet;
uniform vec3 uSky;
uniform float uReflectStrength;
uniform float uPuddleBias;
uniform vec2 uKickCenter;
uniform vec4 uKickAge;
uniform vec4 uKickAmp;
varying vec3 vKWorld;

float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(kHash(i), kHash(i + vec2(1.0, 0.0)), u.x), mix(kHash(i + vec2(0.0, 1.0)), kHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float kPuddle(vec2 p) {
    float n = kNoise(p * 0.62 + uPuddleOffset) * 0.62 + kNoise(p * 1.7 - uPuddleOffset * 1.3) * 0.38;
    float threshold = mix(0.78, 0.46, uPuddleAmount) + uPuddleBias;
    return smoothstep(threshold, threshold + 0.05, n);
}
// 一层涟漪：每格一个随机中心的扩散圆环，返回 xz 方向的法线扰动与环的亮度。
vec3 kRippleLayer(vec2 p, float scale, float t, float salt) {
    vec2 q = p * scale;
    vec2 cell = floor(q);
    vec2 center = cell + 0.22 + 0.56 * vec2(kHash(cell + salt), kHash(cell + salt + 7.13));
    float period = 0.75 + 0.9 * kHash(cell + salt + 3.31);
    float phase = fract(t / period + kHash(cell + salt + 11.7));
    float alive = step(kHash(cell + salt + floor(t / period + kHash(cell + salt + 11.7)) * 0.37), uRain);
    vec2 d = q - center;
    float dist = length(d);
    float radius = phase * 0.46;
    float band = 1.0 - smoothstep(0.0, 0.07, abs(dist - radius));
    float fade = (1.0 - phase) * alive;
    float wave = sin((dist - radius) * 48.0) * band * fade;
    return vec3(normalize(d + 1e-4) * wave, band * fade);
}
// 鼓点涟漪的一圈：从 uKickCenter 荡开、越走越宽越淡的环（按剩余寿命的平方淡），返回 xz 方向的法线扰动与环的亮度。
// 空的一圈年龄是 -1：先夹到 0，smoothstep 的两端不会倒过来。
vec3 kKick(vec2 p, float age, float amp) {
    float a = max(age, 0.0);
    vec2 d = p - uKickCenter;
    float dist = length(d);
    float radius = a * ${MACHI_BEAT.ripple.speed.toFixed(2)};
    float band = 1.0 - smoothstep(0.0, 0.18 + 0.3 * a, abs(dist - radius));
    float left = clamp(1.0 - a / ${MACHI_BEAT.ripple.life.toFixed(2)}, 0.0, 1.0);
    float fade = amp * left * left * step(0.0, age);
    float wave = sin((dist - radius) * 7.0) * band * fade;
    return vec3(normalize(d + 1e-4) * wave, band * fade);
}
// 倒影取样：湿路面不是镜子。灯和字在湿路面上拉成竖着的一道道光（倒影贴图和画面同一个朝向，竖向就是 v），
// 横向只糊一点。rough 0 是水洼（短一点、清楚一点），1 是水洼外的湿膜（长、糊）。
vec3 kReflect(vec2 uv, float rough) {
    float bias = mix(0.6, 1.8, rough);
    float reach = mix(10.0, 26.0, rough) / float(textureSize(uReflection, 0).y);
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = -4; i <= 4; i++) {
        float t = float(i) / 4.0;
        float w = 1.0 - abs(t) * 0.75;
        sum += texture2D(uReflection, uv + vec2(0.0, t * reach), bias).rgb * w;
        total += w;
    }
    // 一盏灯摊成一道光以后不该暗那么多：按 0.6 倍的权重和归一，光带比平均更亮一点。
    return sum / (total * 0.6);
}
// 雨点打在路面上的闪光：约 7cm 一格，格里随机一点，每隔一阵（雨点打下来）亮一下再暗下去。
float kGlint(vec2 p, float t) {
    vec2 q = p * 14.0;
    vec2 cell = floor(q);
    float h = kHash(cell + 3.7);
    float period = 0.5 + h * 1.1;
    float beat = t / period + h * 7.0;
    float drop = floor(beat);
    vec2 center = cell + 0.2 + 0.6 * vec2(kHash(cell + drop * 0.71), kHash(cell + drop * 1.37 + 9.1));
    float d = length(q - center);
    float aa = fwidth(d) + 1e-4;
    return (1.0 - smoothstep(0.16 - aa, 0.16 + aa, d)) * (1.0 - fract(beat)) * step(0.45, h);
}
`;
const OUTPUT = `
// 干且没下雨时下面整段（水洼、涟漪、倒影取样、雨点闪光、鼓点涟漪）都乘成 0：直接跳过，路面照常是 outgoingLight。
if (uWet > 0.0 || uRain > 0.0) {
    vec2 kp = vKWorld.xz;
    // 干的时候没有水洼；积雪盖住水洼。
    float puddle = kPuddle(kp) * smoothstep(0.15, 0.85, uWet) * (1.0 - min(1.0, uMachiSnow * 1.5));
    vec3 ripple = kRippleLayer(kp, 2.3, uTime, 0.0) + kRippleLayer(kp, 3.9, uTime * 1.13, 19.0) * 0.7;
    // 鼓点涟漪：湿的地方才有，积雪盖住就没有。
    vec3 kick = vec3(0.0);
    if (any(greaterThan(uKickAmp, vec4(0.0)))) {
        kick = kKick(kp, uKickAge.x, uKickAmp.x) + kKick(kp, uKickAge.y, uKickAmp.y)
            + kKick(kp, uKickAge.z, uKickAmp.z) + kKick(kp, uKickAge.w, uKickAmp.w);
        kick *= smoothstep(${MACHI_BEAT.ripple.wet[0].toFixed(2)}, ${MACHI_BEAT.ripple.wet[1].toFixed(2)}, uWet) * (1.0 - min(1.0, uMachiSnow * 1.5));
    }
    vec4 rc = uReflectMatrix * vec4(vKWorld, 1.0);
    // 路面不平：一层低频的扰动让倒影的轮廓弯一弯，水洼里弯得少。
    vec2 wobble = vec2(kNoise(kp * 2.7 + 3.1), kNoise(kp * 2.7 - 11.4)) - 0.5;
    vec2 ruv = rc.xy / rc.w + ripple.xy * mix(0.004, 0.018, puddle) + wobble * mix(0.012, 0.005, puddle) + kick.xy * mix(0.09, 0.15, puddle);
    vec3 reflection = kReflect(ruv, 1.0 - puddle);
    // 灯底下才闪：按这一点受的直射光（含高光）亮度。
    float lit = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114));
    float glint = kGlint(kp, uTime) * uRain * smoothstep(0.03, 0.4, lit) * (1.0 - min(1.0, uMachiSnow * 1.5));
    // 水洼：压暗、映天空、映倒影；水洼外：一层湿膜，整片都映得出灯（拉长、糊开）。
    vec3 wet = outgoingLight * mix(1.0, 0.62, uWet) + reflection * uReflectStrength * 0.7 * uWet;
    vec3 pool = outgoingLight * 0.36 + uSky * 0.16 + reflection * uReflectStrength * 1.35 + ripple.z * uSky * 0.6;
    outgoingLight = mix(wet, pool, puddle) + glint * (vec3(lit) * 3.0 + reflection);
    outgoingLight += kick.z * (reflection * uReflectStrength * 3.6 + uSky * 2.4 + 0.24) * mix(0.6, 1.0, puddle);
}
`;
const REFLECT_STRENGTH = 0.75;
export class MachiGround {
    blend;
    snow;
    uniforms = {
        uTime: {
            value: 0
        },
        uReflection: {
            value: null
        },
        uReflectMatrix: {
            value: new THREE.Matrix4()
        },
        uPuddleOffset: {
            value: new THREE.Vector2()
        },
        uPuddleAmount: {
            value: 0.6
        },
        uRain: {
            value: 0.75
        },
        uWet: {
            value: 1
        },
        uSky: {
            value: new THREE.Color()
        },
        uReflectStrength: {
            value: REFLECT_STRENGTH
        },
        uKickCenter: {
            value: new THREE.Vector2()
        },
        uKickAge: {
            value: new THREE.Vector4(-1, -1, -1, -1)
        },
        uKickAmp: {
            value: new THREE.Vector4()
        }
    };
    asphalt;
    concrete;
    gradient;
    constructor(materials, blend, snow){
        this.blend = blend;
        this.snow = snow;
        this.gradient = materials.gradient;
        this.asphalt = materials.track(this.create('asphalt', 0));
        this.concrete = materials.track(this.create('concrete', 0.08));
    }
    create(key, puddleBias) {
        const material = new THREE.MeshToonMaterial({
            color: this.blend.get(key),
            gradientMap: this.gradient
        });
        material.name = `machi:wet:${key}`;
        material.onBeforeCompile = (shader)=>{
            injectMachiSnow(shader, this.snow);
            injectMachiSheen(shader, this.snow, MACHI_GLOSS.ground);
            Object.assign(shader.uniforms, this.uniforms, {
                uPuddleBias: {
                    value: puddleBias
                }
            });
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKWorld;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PARS}`).replace('#include <opaque_fragment>', `${OUTPUT}\n#include <opaque_fragment>`);
        };
        material.customProgramCacheKey = ()=>`machi-wet-${puddleBias}`;
        return material;
    }
    setKicks(centerX, centerZ, rings) {
        this.uniforms.uKickCenter.value.set(centerX, centerZ);
        this.uniforms.uKickAge.value.set(rings[0], rings[2], rings[4], rings[6]);
        this.uniforms.uKickAmp.value.set(rings[1], rings[3], rings[5], rings[7]);
    }
    setReflections(enabled) {
        this.uniforms.uReflectStrength.value = enabled ? REFLECT_STRENGTH : 0;
    }
    syncColors() {
        this.asphalt.color.copy(this.blend.get('asphalt'));
        this.concrete.color.copy(this.blend.get('concrete'));
        this.uniforms.uSky.value.copy(this.blend.get('skyBottom'));
    }
}
