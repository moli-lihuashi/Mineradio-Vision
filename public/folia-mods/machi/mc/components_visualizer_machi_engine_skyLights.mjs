/* 移植自 Folia components/visualizer/machi/engine/skyLights.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { MACHI_DAYLIGHT } from './components_visualizer_machi_engine_environment.mjs';
const DIRECTIONS = {
    night: new THREE.Vector3(-6.5, 14, -5).normalize(),
    dusk: new THREE.Vector3(-11, 5.5, 6).normalize(),
    day: new THREE.Vector3(-6, 16, 8).normalize()
};
const LIGHT_DISTANCE = 17;
const SHADOW_REDRAW_STEP = 0.012;
export class MachiSkyLights {
    blend;
    group = new THREE.Group();
    moon;
    hemi;
    direction = new THREE.Vector3().copy(DIRECTIONS.night);
    shadowDirection = new THREE.Vector3().copy(DIRECTIONS.night);
    constructor(blend, shadowMapSize){
        this.blend = blend;
        this.group.name = 'SkyLights';
        this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.1);
        this.hemi.name = 'Lights/hemi';
        this.moon = new THREE.DirectionalLight(0xffffff, 1.35);
        this.moon.name = 'Lights/moon';
        this.moon.position.copy(this.direction).multiplyScalar(LIGHT_DISTANCE);
        this.moon.target.position.set(0, 0, 0);
        this.moon.castShadow = shadowMapSize > 0;
        this.moon.shadow.mapSize.setScalar(shadowMapSize > 0 ? shadowMapSize : 1024);
        const shadowCamera = this.moon.shadow.camera;
        shadowCamera.left = -9.5;
        shadowCamera.right = 9.5;
        shadowCamera.top = 9.5;
        shadowCamera.bottom = -9.5;
        shadowCamera.near = 1;
        shadowCamera.far = 40;
        this.moon.shadow.bias = -0.0006;
        this.moon.shadow.normalBias = 0.025;
        this.moon.shadow.radius = 3;
        this.moon.shadow.autoUpdate = false;
        this.group.add(this.hemi, this.moon, this.moon.target);
        this.sync();
    }
    sync() {
        this.hemi.color.copy(this.blend.get('hemiSky'));
        this.hemi.groundColor.copy(this.blend.get('hemiGround'));
        this.moon.color.copy(this.blend.get('moon'));
    }
    update(frame) {
        const d = frame.daylight;
        if (d <= MACHI_DAYLIGHT.dusk) this.direction.lerpVectors(DIRECTIONS.night, DIRECTIONS.dusk, d / MACHI_DAYLIGHT.dusk);
        else this.direction.lerpVectors(DIRECTIONS.dusk, DIRECTIONS.day, (d - MACHI_DAYLIGHT.dusk) / (1 - MACHI_DAYLIGHT.dusk));
        this.direction.normalize();
        this.moon.position.copy(this.direction).multiplyScalar(LIGHT_DISTANCE);
        if (this.direction.distanceTo(this.shadowDirection) > SHADOW_REDRAW_STEP) {
            this.shadowDirection.copy(this.direction);
            this.invalidateShadows();
        }
        this.hemi.intensity = frame.hemiIntensity * (1 + 1.5 * frame.flash);
        this.moon.intensity = frame.sunIntensity * (1 + 1.2 * frame.flash);
    }
    invalidateShadows() {
        this.moon.shadow.needsUpdate = true;
    }
    settleShadows() {
        if (this.direction.equals(this.shadowDirection)) return;
        this.shadowDirection.copy(this.direction);
        this.invalidateShadows();
    }
    setShadowMapSize(size) {
        const cast = size > 0;
        if (this.moon.castShadow !== cast) {
            this.moon.castShadow = cast;
            this.invalidateShadows();
        }
        if (!cast || this.moon.shadow.mapSize.x === size) return;
        this.moon.shadow.mapSize.set(size, size);
        this.moon.shadow.map?.dispose();
        this.moon.shadow.map = null;
        this.invalidateShadows();
    }
    dispose() {
        this.moon.shadow.map?.dispose();
    }
}
