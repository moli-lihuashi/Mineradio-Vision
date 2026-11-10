/* 移植自 Folia components/visualizer/machi/engine/snow.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
export const MACHI_SNOW_MAX_ROOFS = 4;
export const createMachiSnowUniforms = ()=>({
        uMachiSnow: {
            value: 0
        },
        uMachiSnowColor: {
            value: new THREE.Color(0xf2f5fa)
        },
        uMachiViewUp: {
            value: new THREE.Vector3(0, 1, 0)
        },
        uMachiRoofs: {
            value: Array.from({
                length: MACHI_SNOW_MAX_ROOFS
            }, ()=>new THREE.Vector4())
        },
        uMachiRoofY: {
            value: Array.from({
                length: MACHI_SNOW_MAX_ROOFS
            }, ()=>-100)
        },
        uMachiWet: {
            value: 0
        }
    });
export const setMachiSnowRoofs = (uniforms, roofs)=>{
    for(let index = 0; index < MACHI_SNOW_MAX_ROOFS; index += 1){
        const roof = roofs[index];
        uniforms.uMachiRoofs.value[index].set(roof?.x0 ?? 0, roof?.z0 ?? 0, roof?.x1 ?? 0, roof?.z1 ?? 0);
        uniforms.uMachiRoofY.value[index] = roof?.y ?? -100;
    }
};
const VERTEX_PARS = `
varying vec3 vMachiWorld;
`;
const VERTEX = `
{
    vec4 machiLocal = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
        machiLocal = instanceMatrix * machiLocal;
    #endif
    vMachiWorld = (modelMatrix * machiLocal).xyz;
}
`;
const FRAGMENT_PARS = `
uniform float uMachiSnow;
uniform vec3 uMachiSnowColor;
uniform vec3 uMachiViewUp;
uniform vec4 uMachiRoofs[${MACHI_SNOW_MAX_ROOFS}];
uniform float uMachiRoofY[${MACHI_SNOW_MAX_ROOFS}];
varying vec3 vMachiWorld;
float machiSnowHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
float machiSnowNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(machiSnowHash(i), machiSnowHash(i + vec2(1.0, 0.0)), u.x), mix(machiSnowHash(i + vec2(0.0, 1.0)), machiSnowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float machiSheltered(vec3 p) {
    for (int i = 0; i < ${MACHI_SNOW_MAX_ROOFS}; i++) {
        vec4 r = uMachiRoofs[i];
        if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y < uMachiRoofY[i] - 0.05) return 1.0;
    }
    return 0.0;
}
`;
const FRAGMENT = `
if (uMachiSnow > 0.001) {
    float machiUp = dot(normalize(normal), uMachiViewUp);
    float machiNoise = machiSnowNoise(vMachiWorld.xz * 2.6) * 0.65 + machiSnowNoise(vMachiWorld.xz * 7.1) * 0.35;
    // 积得越多，噪声的门槛越低：先是一块块的，后来连成一片。
    float machiCover = smoothstep(0.5, 0.85, machiUp) * smoothstep(1.0 - uMachiSnow * 0.9, 1.16 - uMachiSnow * 0.9, machiNoise + 0.25);
    machiCover *= 1.0 - machiSheltered(vMachiWorld);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMachiSnowColor, machiCover * min(1.0, uMachiSnow * 1.4));
}
`;
export const injectMachiSnow = (shader, uniforms)=>{
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT}`);
};
