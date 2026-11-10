/* 移植自 Folia components/visualizer/machi/engine/materials.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { injectMachiSheen, MACHI_GLOSS, machiGlossFor } from './components_visualizer_machi_engine_sheen.mjs';
import { injectMachiSnow } from './components_visualizer_machi_engine_snow.mjs';
export const flattenMachiPalette = (palette)=>{
    const flat = {};
    Object.keys(palette).forEach((key)=>{
        const value = palette[key];
        if (typeof value === 'string') flat[key] = value;
    });
    palette.brand.forEach((color, index)=>{
        flat[`brand${index}`] = color;
    });
    palette.products.forEach((color, index)=>{
        flat[`product${index}`] = color;
    });
    Object.entries(palette.art).forEach(([key, color])=>{
        flat[key] = color;
    });
    return flat;
};
export class MachiColorBlend {
    current = new Map();
    target = new Map();
    settled = true;
    constructor(palette){
        Object.entries(flattenMachiPalette(palette)).forEach(([key, value])=>{
            this.current.set(key, new THREE.Color(value));
            this.target.set(key, new THREE.Color(value));
        });
    }
    setTarget(palette, immediate = false) {
        Object.entries(flattenMachiPalette(palette)).forEach(([key, value])=>{
            const target = this.target.get(key) ?? new THREE.Color();
            target.set(value);
            this.target.set(key, target);
            if (immediate || !this.current.has(key)) this.current.set(key, target.clone());
        });
        this.settled = immediate;
    }
    step(deltaSeconds, rate = 2.4) {
        if (this.settled) return false;
        const k = 1 - Math.exp(-rate * deltaSeconds);
        let moving = false;
        this.current.forEach((color, key)=>{
            const target = this.target.get(key);
            color.lerp(target, k);
            if (Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) > 0.002) moving = true;
            else color.copy(target);
        });
        this.settled = !moving;
        return true;
    }
    derived = new Map();
    setDerived(key, color) {
        const held = this.derived.get(key);
        if (held) held.copy(color);
        else this.derived.set(key, color.clone());
    }
    raw(key) {
        return this.current.get(key) ?? this.current.get('concrete');
    }
    get(key) {
        return this.derived.get(key) ?? this.raw(key);
    }
}
const createToonGradient = ()=>{
    const data = new Uint8Array([
        86,
        146,
        206,
        255
    ]);
    const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
};
export class MachiMaterials {
    blend;
    snow;
    prefix;
    gradient = createToonGradient();
    toons = new Map();
    glows = new Map();
    glowSpecs = new Map();
    glowLevels = new Map();
    glass;
    product;
    extra = [];
    constructor(blend, snow, prefix = 'machi'){
        this.blend = blend;
        this.snow = snow;
        this.prefix = prefix;
        this.glass = new THREE.MeshToonMaterial({
            color: blend.get('glass'),
            gradientMap: this.gradient,
            transparent: true,
            opacity: 0.2,
            depthWrite: false
        });
        this.glass.name = `${prefix}:glass`;
        this.snowy(this.glass, MACHI_GLOSS.glass);
        this.product = this.snowy(new THREE.MeshToonMaterial({
            color: 0xffffff,
            gradientMap: this.gradient
        }), MACHI_GLOSS.metal);
        this.product.name = `${prefix}:product`;
    }
    snowy(material, gloss = MACHI_GLOSS.matte) {
        material.onBeforeCompile = (shader)=>{
            injectMachiSnow(shader, this.snow);
            injectMachiSheen(shader, this.snow, gloss);
        };
        material.customProgramCacheKey = ()=>'machi-snow';
        return material;
    }
    toon(key) {
        let material = this.toons.get(key);
        if (!material) {
            material = this.snowy(new THREE.MeshToonMaterial({
                color: key === 'white' ? 0xffffff : this.blend.get(key),
                gradientMap: this.gradient
            }), machiGlossFor(key));
            material.name = `${this.prefix}:${key}`;
            this.toons.set(key, material);
        }
        return material;
    }
    defineGlows(specs) {
        Object.entries(specs).forEach(([role, spec])=>this.glowSpecs.set(role, spec));
    }
    glow(role) {
        let material = this.glows.get(role);
        if (!material) {
            if (!this.glowSpecs.has(role)) throw new Error(`[Machi] glow role "${role}" is not defined`);
            material = new THREE.MeshBasicMaterial({
                color: 0xffffff
            });
            material.name = `machi:glow:${role}`;
            this.glows.set(role, material);
            this.syncGlow(role, material);
        }
        return material;
    }
    setGlowLevel(role, level) {
        if (this.glowLevels.get(role) === level) return;
        this.glowLevels.set(role, level);
        const material = this.glows.get(role);
        if (material) this.syncGlow(role, material);
    }
    track(material) {
        this.extra.push(material);
        return material;
    }
    syncGlow(role, material) {
        const spec = this.glowSpecs.get(role);
        material.color.copy(this.blend.get(spec.key)).multiplyScalar(spec.level * (this.glowLevels.get(role) ?? 1));
    }
    syncColors() {
        this.toons.forEach((material, key)=>{
            if (key !== 'white') material.color.copy(this.blend.get(key));
        });
        this.glass.color.copy(this.blend.get('glass'));
        this.glows.forEach((material, role)=>this.syncGlow(role, material));
    }
    dispose() {
        this.toons.forEach((material)=>material.dispose());
        this.glows.forEach((material)=>material.dispose());
        this.glass.dispose();
        this.product.dispose();
        this.extra.forEach((material)=>material.dispose());
        this.gradient.dispose();
    }
}
