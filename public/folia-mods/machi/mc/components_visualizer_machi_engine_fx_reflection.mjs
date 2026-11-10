/* 移植自 Folia components/visualizer/machi/engine/fx/reflection.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { compileInto } from './components_visualizer_machi_engine_programWarmup.mjs';
export const MACHI_REFLECT_LAYER = 1;
export class MachiReflection {
    target;
    textureMatrix = new THREE.Matrix4();
    mirror = new THREE.OrthographicCamera();
    up = new THREE.Vector3();
    lookTarget = new THREE.Vector3();
    forward = new THREE.Vector3();
    scale;
    planeY;
    constructor(planeY, scale){
        this.planeY = planeY;
        this.scale = scale;
        this.target = new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            depthBuffer: true,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.target.texture.name = 'machi:reflection';
        this.mirror.layers.set(MACHI_REFLECT_LAYER);
    }
    setSize(width, height) {
        this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
    }
    setScale(scale, width, height) {
        this.scale = scale;
        this.setSize(width, height);
    }
    compile(renderer, scene) {
        const background = scene.background;
        const fog = scene.fog;
        scene.background = null;
        scene.fog = null;
        try {
            compileInto(renderer, this.target, scene, this.mirror, scene, (object)=>object.layers.test(this.mirror.layers));
        } finally{
            scene.background = background;
            scene.fog = fog;
        }
    }
    render(renderer, scene, camera) {
        const y = this.planeY;
        this.mirror.left = camera.left;
        this.mirror.right = camera.right;
        this.mirror.top = camera.top;
        this.mirror.bottom = camera.bottom;
        this.mirror.near = camera.near;
        this.mirror.far = camera.far;
        this.mirror.zoom = camera.zoom;
        this.mirror.updateProjectionMatrix();
        this.mirror.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z);
        camera.getWorldDirection(this.forward);
        this.lookTarget.copy(camera.position).add(this.forward);
        this.lookTarget.y = 2 * y - this.lookTarget.y;
        this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        this.up.y = -this.up.y;
        this.mirror.up.copy(this.up);
        this.mirror.lookAt(this.lookTarget);
        this.mirror.updateMatrixWorld();
        this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.mirror.projectionMatrix).multiply(this.mirror.matrixWorldInverse);
        const background = scene.background;
        const fog = scene.fog;
        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new THREE.Color());
        const previousAlpha = renderer.getClearAlpha();
        const shadowAuto = renderer.shadowMap.autoUpdate;
        scene.background = null;
        scene.fog = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        renderer.render(scene, this.mirror);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
        renderer.shadowMap.autoUpdate = shadowAuto;
        scene.background = background;
        scene.fog = fog;
    }
    dispose() {
        this.target.dispose();
    }
}
