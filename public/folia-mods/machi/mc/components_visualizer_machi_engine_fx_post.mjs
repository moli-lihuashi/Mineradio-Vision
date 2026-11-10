/* 移植自 Folia components/visualizer/machi/engine/fx/post.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { EffectComposer } from '../../../vendor/folia/three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from '../../../vendor/folia/three/examples/jsm/postprocessing/FXAAPass.js';
import { SMAAPass } from '../../../vendor/folia/three/examples/jsm/postprocessing/SMAAPass.js';
import { compileInto } from './components_visualizer_machi_engine_programWarmup.mjs';
import { MachiBloomPass } from './components_visualizer_machi_engine_fx_bloomPass.mjs';
import { MachiLensPass } from './components_visualizer_machi_engine_fx_lensPass.mjs';
import { createGlowUniforms, halfFloatTarget, MachiAtmospherePass, MachiStreakPass } from './components_visualizer_machi_engine_fx_postPasses.mjs';
const BLOOM_SCALE = 4;
const passMaterials = (pass)=>{
    const materials = new Set();
    Object.values(pass).forEach((value)=>{
        if (value instanceof THREE.Material) materials.add(value);
        else if (Array.isArray(value)) value.forEach((item)=>{
            if (item instanceof THREE.Material) materials.add(item);
        });
    });
    return materials;
};
const createSceneTarget = (width, height, samples)=>{
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.UnsignedIntType;
    const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        samples,
        depthTexture
    });
    target.texture.name = 'machi:scene';
    return target;
};
export class MachiPost {
    renderer;
    sceneGraph;
    camera;
    composer;
    scene;
    atmosphere;
    bloom;
    streaks;
    lens;
    fxaa;
    smaa;
    glow = createGlowUniforms();
    black = new THREE.DataTexture(new Uint8Array([
        0,
        0,
        0,
        255
    ]), 1, 1);
    bufferSize = new THREE.Vector2();
    bloomAllowed = true;
    streaksAllowed = true;
    bloomStrength = 0.5;
    streakStrength = 0.55;
    constructor(renderer, sceneGraph, camera, quality, cutout = false){
        this.renderer = renderer;
        this.sceneGraph = sceneGraph;
        this.camera = camera;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const lit = halfFloatTarget();
        lit.texture.name = 'machi:lit';
        lit.setSize(size.x, size.y);
        this.scene = {
            target: createSceneTarget(size.x, size.y, quality.samples),
            lit
        };
        this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.UnsignedByteType,
            depthBuffer: false
        }));
        this.black.needsUpdate = true;
        this.atmosphere = new MachiAtmospherePass(this.scene, cutout);
        this.composer.addPass(this.atmosphere);
        this.bloom = new MachiBloomPass(this.scene, BLOOM_SCALE, 0.5, 0.62, 0.86);
        this.composer.addPass(this.bloom);
        this.streaks = new MachiStreakPass(this.scene, this.glow);
        this.composer.addPass(this.streaks);
        this.lens = new MachiLensPass(this.scene, this.glow, {
            neutralToneMapping: renderer.toneMapping === THREE.NeutralToneMapping,
            srgb: THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer
        }, cutout);
        this.composer.addPass(this.lens);
        this.fxaa = new FXAAPass();
        this.composer.addPass(this.fxaa);
        this.smaa = new SMAAPass();
        const smaaTargets = this.smaa;
        [
            smaaTargets._edgesRT,
            smaaTargets._weightsRT
        ].forEach((target)=>{
            if (target) target.texture.type = THREE.UnsignedByteType;
        });
        this.composer.addPass(this.smaa);
        this.setQuality(quality);
    }
    get sceneTarget() {
        return this.scene.target;
    }
    setSize() {
        const { x: width, y: height } = this.renderer.getDrawingBufferSize(this.bufferSize);
        this.composer.setPixelRatio(1);
        this.composer.setSize(width, height);
        this.scene.target.setSize(width, height);
        this.scene.lit.setSize(width, height);
    }
    setQuality(quality) {
        const current = this.scene.target;
        if (current.samples !== quality.samples) {
            this.scene.target = createSceneTarget(current.width, current.height, quality.samples);
            current.depthTexture?.dispose();
            current.dispose();
        }
        this.atmosphere.material.uniforms.uInkScale.value = quality.inkScale;
        this.bloomAllowed = quality.bloom;
        this.streaksAllowed = quality.streaks;
        this.lens.dofEnabled = quality.dof;
        this.fxaa.enabled = quality.postAA === 'fxaa';
        this.smaa.enabled = quality.postAA === 'smaa';
        this.applyGlow();
    }
    compile() {
        const passes = this.composer.passes.filter((pass)=>pass !== this.fxaa && pass !== this.smaa || pass.enabled);
        const last = passes[passes.length - 1];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1,
            3,
            0,
            -1,
            -1,
            0,
            3,
            -1,
            0
        ], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
            0,
            2,
            0,
            0,
            2,
            0
        ], 2));
        const quad = new THREE.Mesh(geometry);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const empty = new THREE.Scene();
        passes.forEach((pass)=>{
            passMaterials(pass).forEach((material)=>{
                quad.material = material;
                compileInto(this.renderer, this.composer.renderTarget1, quad, camera, empty);
                if (pass === last) compileInto(this.renderer, null, quad, camera, empty);
            });
        });
        quad.geometry.dispose();
    }
    setGlow(bloom, streaks) {
        if (bloom === this.bloomStrength && streaks === this.streakStrength) return;
        this.bloomStrength = bloom;
        this.streakStrength = streaks;
        this.applyGlow();
    }
    applyGlow() {
        this.bloom.strength = this.bloomStrength;
        this.bloom.enabled = this.bloomAllowed && this.bloomStrength > 0.005;
        this.streaks.enabled = this.streaksAllowed && this.streakStrength > 0.005;
        this.glow.tBloom.value = this.bloom.enabled ? this.bloom.texture : this.black;
        this.glow.tStreak.value = this.streaks.enabled ? this.streaks.texture : this.black;
        this.glow.uStreakStrength.value = this.streakStrength;
    }
    render(pixelWorldSize, centerDistance, atmosphere, lens) {
        const camera = this.camera;
        const range = camera.far - camera.near;
        const uniforms = this.atmosphere.material.uniforms;
        uniforms.uDepthRange.value = range;
        uniforms.uThreshold.value = Math.max(0.004, pixelWorldSize * uniforms.uInkScale.value * 0.7);
        uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
        uniforms.uCamWorld.value.copy(camera.matrixWorld);
        uniforms.uTime.value = atmosphere.time;
        uniforms.uMistColor.value.copy(atmosphere.mistColor);
        uniforms.uMistAmount.value = atmosphere.mistAmount;
        uniforms.uCloudColor.value.copy(atmosphere.cloudColor);
        uniforms.uCloudAmount.value = atmosphere.cloudAmount;
        uniforms.uHaze.value = atmosphere.haze;
        uniforms.uHazeRange.value.set(centerDistance - camera.near - 8, centerDistance - camera.near + 14);
        uniforms.uLightning.value = atmosphere.lightning;
        uniforms.uGlowA.value.copy(atmosphere.glowA);
        uniforms.uGlowColorA.value.copy(atmosphere.glowColorA);
        uniforms.uGlowB.value.copy(atmosphere.glowB);
        uniforms.uGlowColorB.value.copy(atmosphere.glowColorB);
        uniforms.uWind.value.copy(atmosphere.wind);
        this.lens.configure({
            ...lens,
            focus: lens.focus - camera.near,
            stars: atmosphere.stars
        }, range, atmosphere.time);
        this.renderer.setRenderTarget(this.scene.target);
        this.renderer.clear();
        this.renderer.render(this.sceneGraph, camera);
        this.composer.render();
    }
    dispose() {
        this.atmosphere.dispose();
        this.bloom.dispose();
        this.streaks.dispose();
        this.lens.dispose();
        this.black.dispose();
        this.fxaa.dispose();
        this.smaa.dispose();
        this.composer.dispose();
        this.scene.target.depthTexture?.dispose();
        this.scene.target.dispose();
        this.scene.lit.dispose();
    }
}
