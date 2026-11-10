/* 移植自 Folia components/visualizer/machi/engine/sheen.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
export const MACHI_GLOSS = {
    matte: [
        0,
        0.16
    ],
    paint: [
        0.3,
        0.65
    ],
    glass: [
        0.45,
        0.8
    ],
    chrome: [
        0.5,
        0.85
    ],
    metal: [
        0.16,
        0.42
    ],
    ground: [
        0.03,
        0.85
    ]
};
const PAINT_KEYS = /^(car|taxiBody|truckCab|truckBox|vendingBody|pumpBody|fridgeBody|jukebox|bike|scooter|stool)/;
const GLASS_KEYS = /(glass|Glass|windowDark)/;
const CHROME_KEYS = /^(chrome|mirrorPole)/;
const METAL_KEYS = /^(metal|darkMetal|pole|motelPole|antenna|tank|canopyColumn|acUnit|ac$|pipe|wire|signBox|screenFrame|cage|drain)/;
const GROUND_KEYS = /^(asphalt|roadPaint|curb|roofTar|roof$|canopyTop|slab)/;
export const machiGlossFor = (key)=>{
    if (PAINT_KEYS.test(key)) return MACHI_GLOSS.paint;
    if (GLASS_KEYS.test(key)) return MACHI_GLOSS.glass;
    if (CHROME_KEYS.test(key)) return MACHI_GLOSS.chrome;
    if (METAL_KEYS.test(key)) return MACHI_GLOSS.metal;
    if (GROUND_KEYS.test(key)) return MACHI_GLOSS.ground;
    return MACHI_GLOSS.matte;
};
const PARS = `
uniform vec2 uMachiGloss;
uniform float uMachiWet;
// 点光、聚光在前，平行光在后：进平行光那段之前改成 0（见下面对 lights_fragment_begin 的改动）。
float machiLocalLight = 1.0;
void RE_Direct_Machi( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
    RE_Direct_Toon( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    float wet = uMachiWet * (1.0 - machiSheltered(vMachiWorld));
    float gloss = mix(uMachiGloss.x, uMachiGloss.y, wet);
    if (gloss > 0.001) {
        vec3 halfDir = normalize(directLight.direction + geometryViewDir);
        float nh = saturate(dot(geometryNormal, halfDir));
        // 越湿越亮、越集中。灯离得很近时光很强，高光按亮度压一压，不至于一片死白。
        float soft = pow(nh, mix(14.0, 40.0, wet)) * 0.4;
        float core = smoothstep(mix(0.955, 0.975, wet), mix(0.968, 0.985, wet), nh) * machiLocalLight;
        vec3 color = directLight.color / (1.0 + dot(directLight.color, vec3(0.3333)) * 0.8);
        reflectedLight.directDiffuse += color * gloss * (soft * mix(0.5, 1.0, machiLocalLight) + core);
    }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Machi
`;
const DIRECTIONAL = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
export const injectMachiSheen = (shader, uniforms, gloss)=>{
    shader.uniforms.uMachiWet = uniforms.uMachiWet;
    shader.uniforms.uMachiGloss = {
        value: new THREE.Vector2(gloss[0], gloss[1])
    };
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', `#include <lights_toon_pars_fragment>\n${PARS}`).replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(DIRECTIONAL, `machiLocalLight = 0.0;\n${DIRECTIONAL}`));
};
