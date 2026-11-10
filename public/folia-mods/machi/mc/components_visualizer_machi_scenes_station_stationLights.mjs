/* 移植自 Folia components/visualizer/machi/scenes/station/stationLights.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { createSoftEllipseTexture } from './components_visualizer_machi_engine_actors_traffic.mjs';
import { CANOPY, LEVEL, TRUCK_SCREEN } from './components_visualizer_machi_scenes_station_layout.mjs';
export class StationLights {
    blend;
    group = new THREE.Group();
    canopy;
    lamp;
    neon;
    screen;
    pools = [];
    textures = [];
    levels = {
        canopy: 1,
        lamp: 1,
        neon: 1,
        screen: 1,
        pools: 1
    };
    constructor(blend, materials, lampHead, neonAt){
        this.blend = blend;
        this.group.name = 'StationLights';
        const point = (intensity, distance, position, name)=>{
            const light = new THREE.PointLight(0xffffff, intensity, distance, 2);
            light.position.copy(position);
            light.name = name;
            return light;
        };
        this.canopy = [
            CANOPY.x0 + 1.3,
            CANOPY.x1 - 1.3
        ].map((x, index)=>{
            const light = new THREE.SpotLight(0xffffff, 16, 9, 1.15, 0.7, 2);
            light.name = `Lights/canopy${index}`;
            light.position.set(x, CANOPY.under - 0.06, (CANOPY.z0 + CANOPY.z1) / 2);
            light.target.position.set(x, 0, (CANOPY.z0 + CANOPY.z1) / 2 + 0.4);
            return light;
        });
        this.lamp = new THREE.SpotLight(0xffffff, 24, 9, 0.9, 0.6, 2);
        this.lamp.name = 'Lights/lotLamp';
        this.lamp.position.copy(lampHead);
        this.lamp.target.position.set(lampHead.x - 0.4, 0, lampHead.z - 0.6);
        this.neon = point(3, 5, neonAt, 'Lights/motel');
        this.screen = point(2.4, 5.5, new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y - 0.4, TRUCK_SCREEN.z + 1.4), 'Lights/screen');
        const strip = createSoftEllipseTexture();
        this.textures.push(strip);
        const pool = (key, level, source, size, at)=>{
            const material = materials.track(new THREE.MeshBasicMaterial({
                color: 0xffffff,
                map: strip,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }));
            const geometry = new THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2);
            const result = new THREE.Mesh(geometry, material);
            result.position.set(at[0], at[1] + 0.016, at[2]);
            result.renderOrder = 1;
            result.name = `Pool/${source}`;
            this.pools.push({
                mesh: result,
                material,
                key,
                level,
                source
            });
            return result;
        };
        const pools = [
            pool('canopyLight', 0.34, 'canopy', [
                CANOPY.x1 - CANOPY.x0 + 1.2,
                CANOPY.z1 - CANOPY.z0 + 1.4
            ], [
                (CANOPY.x0 + CANOPY.x1) / 2,
                LEVEL.apron,
                (CANOPY.z0 + CANOPY.z1) / 2
            ]),
            pool('streetLight', 0.5, 'lamp', [
                3.4,
                3.4
            ], [
                lampHead.x - 0.4,
                LEVEL.road,
                lampHead.z - 0.6
            ]),
            pool('boardLit', 0.16, 'screen', [
                5.2,
                2.6
            ], [
                TRUCK_SCREEN.x,
                LEVEL.road,
                TRUCK_SCREEN.z + 1.5
            ])
        ];
        this.group.add(...this.canopy, ...this.canopy.map((light)=>light.target), this.lamp, this.lamp.target, this.neon, this.screen, ...pools);
        this.sync();
    }
    setLevels(levels) {
        const previous = this.levels;
        if (previous.canopy === levels.canopy && previous.lamp === levels.lamp && previous.neon === levels.neon && previous.screen === levels.screen && previous.pools === levels.pools) return;
        this.levels = levels;
        this.sync();
    }
    sync() {
        const levels = this.levels;
        this.canopy.forEach((light)=>{
            light.color.copy(this.blend.get('canopyLight'));
            light.intensity = 16 * levels.canopy;
        });
        this.lamp.color.copy(this.blend.get('streetLight'));
        this.lamp.intensity = 24 * levels.lamp;
        this.neon.color.copy(this.blend.get('neon'));
        this.neon.intensity = 3 * levels.neon;
        this.screen.color.copy(this.blend.get('boardLit'));
        this.screen.intensity = 2.4 * levels.screen;
        this.pools.forEach(({ material, key, level, source })=>{
            material.color.copy(this.blend.get(key)).multiplyScalar(level * levels[source] * levels.pools);
        });
    }
    dispose() {
        this.pools.forEach((pool)=>pool.mesh.geometry.dispose());
        this.textures.forEach((texture)=>texture.dispose());
    }
}
