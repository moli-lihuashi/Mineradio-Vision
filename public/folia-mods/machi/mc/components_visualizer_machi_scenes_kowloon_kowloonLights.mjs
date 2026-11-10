/* 移植自 Folia components/visualizer/machi/scenes/kowloon/kowloonLights.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { createSoftEllipseTexture } from './components_visualizer_machi_engine_actors_traffic.mjs';
import { BAR, HOLOGRAM, LEVEL, SCREEN, STALL } from './components_visualizer_machi_scenes_kowloon_layout.mjs';
export class KowloonLights {
    blend;
    group = new THREE.Group();
    points = [];
    lamp;
    glow = new THREE.AmbientLight(0xffffff, 0);
    pools = [];
    texture = createSoftEllipseTexture();
    levels = {
        bar: 1,
        screen: 1,
        neon: 1,
        holo: 1,
        stall: 1,
        lamp: 1,
        pools: 1
    };
    constructor(blend, materials, lampHead, stallBulb){
        this.blend = blend;
        this.group.name = 'KowloonLights';
        const point = (key, intensity, distance, at, source, name)=>{
            const light = new THREE.PointLight(0xffffff, intensity, distance, 2);
            light.position.copy(at);
            light.name = `Lights/${name}`;
            this.points.push({
                light,
                key,
                intensity,
                source
            });
            this.group.add(light);
        };
        point('barLight', 4.2, 6, new THREE.Vector3((BAR.x0 + BAR.x1) / 2, 2.3, (BAR.back + BAR.glass) / 2 + 0.3), 'bar', 'bar');
        point('boardLit', 2.2, 6, new THREE.Vector3(SCREEN.x, SCREEN.y - 0.6, SCREEN.z + 1.6), 'screen', 'screen');
        point('neonPink', 3.6, 6.5, new THREE.Vector3(-2.4, 4.3, 1.4), 'neon', 'neonPink');
        point('neonCyan', 2.6, 5.5, new THREE.Vector3(-1.7, 4.9, -0.9), 'neon', 'neonCyan');
        point('holo', 1.6, 4, new THREE.Vector3(HOLOGRAM.x, HOLOGRAM.y - 0.3, HOLOGRAM.z + 0.3), 'holo', 'holo');
        point('interiorLight', 3.0, 4.5, stallBulb.clone().add(new THREE.Vector3(0, -0.1, 0)), 'stall', 'stall');
        this.lamp = new THREE.SpotLight(0xffffff, 20, 9, 0.85, 0.6, 2);
        this.lamp.name = 'Lights/lamp';
        this.lamp.position.copy(lampHead);
        this.lamp.target.position.set(lampHead.x - 0.25, 0, lampHead.z + 0.1);
        this.glow.name = 'Lights/cityGlow';
        this.group.add(this.lamp, this.lamp.target, this.glow);
        const pool = (key, level, source, size, at)=>{
            const material = materials.track(new THREE.MeshBasicMaterial({
                color: 0xffffff,
                map: this.texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }));
            const geometry = new THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2);
            const result = new THREE.Mesh(geometry, material);
            result.position.set(at[0], LEVEL.ground + 0.008, at[1]);
            result.renderOrder = 1;
            result.name = `Pool/${source}`;
            this.pools.push({
                mesh: result,
                material,
                key,
                level,
                source
            });
            this.group.add(result);
        };
        pool('barLight', 0.34, 'bar', [
            4.8,
            2.4
        ], [
            (BAR.x0 + BAR.x1) / 2,
            BAR.front + 1.0
        ]);
        pool('neonPink', 0.3, 'neon', [
            3.6,
            4.2
        ], [
            -2.3,
            1.4
        ]);
        pool('neonCyan', 0.22, 'neon', [
            2.6,
            2.4
        ], [
            -1.6,
            -0.6
        ]);
        pool('holo', 0.26, 'holo', [
            2.4,
            1.8
        ], [
            HOLOGRAM.x,
            HOLOGRAM.z + 0.2
        ]);
        pool('interiorLight', 0.32, 'stall', [
            2.6,
            2.4
        ], [
            (STALL.x0 + STALL.x1) / 2,
            STALL.z1 + 0.7
        ]);
        pool('lampCool', 0.4, 'lamp', [
            3.0,
            3.0
        ], [
            lampHead.x - 0.25,
            lampHead.z + 0.1
        ]);
        this.sync();
    }
    setLevels(levels) {
        const previous = this.levels;
        if (Object.keys(levels).every((key)=>previous[key] === levels[key])) return;
        this.levels = levels;
        this.sync();
    }
    sync() {
        const levels = this.levels;
        this.points.forEach(({ light, key, intensity, source })=>{
            light.color.copy(this.blend.get(key));
            light.intensity = intensity * levels[source];
        });
        this.glow.color.copy(this.blend.get('cityGlow'));
        this.glow.intensity = 1.1 * levels.neon * levels.pools;
        this.lamp.color.copy(this.blend.get('lampCool'));
        this.lamp.intensity = 20 * levels.lamp;
        this.pools.forEach(({ material, key, level, source })=>{
            material.color.copy(this.blend.get(key)).multiplyScalar(level * levels[source] * levels.pools);
        });
    }
    dispose() {
        this.pools.forEach((pool)=>pool.mesh.geometry.dispose());
        this.texture.dispose();
    }
}
