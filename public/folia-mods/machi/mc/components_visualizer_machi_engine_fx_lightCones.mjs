/* 移植自 Folia components/visualizer/machi/engine/fx/lightCones.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { mergeGeometries } from '../../../vendor/folia/three/examples/jsm/utils/BufferGeometryUtils.js';
const VERTEX = `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vWorld;
attribute float aGain;
varying float vGain;
void main() {
    vUv = uv;
    vGain = aGain;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vNormalView = normalize(normalMatrix * normal);
    // 正交投影：视线方向处处一样。
    vViewDir = vec3(0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * view;
}
`;
const FRAGMENT = `
uniform vec3 uColor;
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vWorld;
varying float vGain;
float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
    float facing = abs(dot(normalize(vNormalView), vViewDir));
    // 插值出来的 uv 可能是极小的负数，pow 的底必须夹到非负，否则 D3D 下得到 NaN，bloom 会把它铺满全屏。
    float axial = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
    float haze = 0.7 + 0.6 * cNoise(vec2(vWorld.x * 1.3 + vWorld.z, vWorld.y * 2.0 - uTime * 0.6));
    float alpha = facing * facing * axial * haze * vGain * uLevel;
    gl_FragColor = vec4(uColor * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;
const cone = (apex, target, radius, gain)=>{
    const height = apex.distanceTo(target);
    const geometry = new THREE.ConeGeometry(radius, height, 20, 1, true);
    geometry.translate(0, -height / 2, 0);
    const direction = target.clone().sub(apex).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    geometry.applyQuaternion(quaternion);
    geometry.translate(apex.x, apex.y, apex.z);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('aGain', new THREE.Float32BufferAttribute(new Float32Array(count).fill(gain), 1));
    return geometry;
};
export class MachiLightCones {
    blend;
    colorKey;
    mesh;
    material;
    constructor(materials, blend, cones, colorKey = 'streetLight'){
        this.blend = blend;
        this.colorKey = colorKey;
        const parts = cones.map((spec)=>cone(spec.apex, spec.target, spec.radius, spec.gain));
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        if (parts.length > 1) parts.forEach((part)=>part.dispose());
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uColor: {
                    value: new THREE.Color()
                },
                uTime: {
                    value: 0
                },
                uLevel: {
                    value: 0.55
                }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        }));
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.name = 'LightCones';
        this.mesh.renderOrder = 6;
        this.syncColors();
    }
    syncColors() {
        this.material.uniforms.uColor.value.copy(this.blend.get(this.colorKey));
    }
    update(time, level) {
        this.material.uniforms.uTime.value = time;
        this.material.uniforms.uLevel.value = 0.55 * level;
    }
    dispose() {
        this.mesh.geometry.dispose();
    }
}
