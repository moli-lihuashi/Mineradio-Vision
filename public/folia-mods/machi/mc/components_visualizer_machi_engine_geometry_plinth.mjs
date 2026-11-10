/* 移植自 Folia components/visualizer/machi/engine/geometry/plinth.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { group, mesh, roundedBox } from './components_visualizer_machi_engine_geometry_shapes.mjs';
export const MACHI_BASE = {
    half: 6,
    depth: 0.6,
    radius: 0.12
};
export const buildMachiPlinth = (materials)=>{
    const size = MACHI_BASE.half * 2;
    const layers = [
        {
            role: 'plinthTop',
            y0: -0.1,
            y1: 0,
            inset: 0
        },
        {
            role: 'plinthMid',
            y0: -0.3,
            y1: -0.1,
            inset: 0.012
        },
        {
            role: 'plinthLow',
            y0: -0.52,
            y1: -0.3,
            inset: 0.006
        }
    ];
    const parts = layers.map((layer)=>{
        const width = size - layer.inset * 2;
        const part = mesh(roundedBox(width, layer.y1 - layer.y0, width, MACHI_BASE.radius, 3), materials.toon(layer.role), {
            name: `Plinth/${layer.role}`
        });
        part.position.set(0, (layer.y0 + layer.y1) / 2, 0);
        return part;
    });
    const trim = mesh(roundedBox(size + 0.08, 0.1, size + 0.08, MACHI_BASE.radius + 0.04, 3), materials.toon('plinthTrim'), {
        name: 'Plinth/trim'
    });
    trim.position.set(0, -MACHI_BASE.depth + 0.05, 0);
    return group('Base/Plinth', ...parts, trim);
};
const SURFACE_LIFT = 0.002;
export const machiSurface = (material, x0, x1, z0, z1, y, name)=>{
    const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const result = mesh(geometry, material, {
        name,
        castShadow: false,
        receiveShadow: true,
        dynamic: true
    });
    result.position.set((x0 + x1) / 2, y + SURFACE_LIFT, (z0 + z1) / 2);
    return result;
};
