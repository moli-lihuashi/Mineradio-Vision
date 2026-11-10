/* 移植自 Folia components/visualizer/machi/scenes/konbini/interior.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { createVisualizerRng } from './components_visualizer_visualizerSeedHash.mjs';
import { LEVEL, STORE } from './components_visualizer_machi_scenes_konbini_layout.mjs';
import { boxSpan, group, mesh, roundedBox } from './components_visualizer_machi_engine_geometry_shapes.mjs';
const SHELF_ROWS = [
    -1.75,
    -3.15
];
const SHELF_X = [
    -4.5,
    -1.4
];
const SHELF_DEPTH = 0.86;
const SHELF_HEIGHT = 1.45;
const SHELF_LEVELS = [
    0.12,
    0.45,
    0.78,
    1.1
];
const FRIDGE = {
    x0: -4.92,
    x1: -1.32,
    z0: -5.2,
    z1: -4.58,
    height: 2.05,
    doors: 5
};
const buildGondola = (materials, z, index)=>{
    const shelf = materials.toon('shelf');
    const dark = materials.toon('darkMetal');
    const [xa, xb] = SHELF_X;
    const y = LEVEL.floor;
    const half = SHELF_DEPTH / 2;
    const parts = [
        boxSpan(dark, xa, xb, y, y + 0.1, z - half, z + half, {
            radius: 0.015,
            name: 'Kick'
        }),
        boxSpan(shelf, xa, xb, y + 0.1, y + SHELF_HEIGHT, z - 0.03, z + 0.03, {
            radius: 0.01,
            name: 'Spine'
        }),
        boxSpan(shelf, xa - 0.04, xa, y, y + SHELF_HEIGHT + 0.05, z - half, z + half, {
            radius: 0.015,
            name: 'End'
        }),
        boxSpan(shelf, xb, xb + 0.04, y, y + SHELF_HEIGHT + 0.05, z - half, z + half, {
            radius: 0.015,
            name: 'End'
        }),
        boxSpan(materials.toon('brand0'), xb + 0.04, xb + 0.06, y + SHELF_HEIGHT - 0.3, y + SHELF_HEIGHT, z - half + 0.05, z + half - 0.05, {
            radius: 0.005,
            name: 'EndCapSign'
        })
    ];
    SHELF_LEVELS.slice(1).forEach((level)=>{
        parts.push(boxSpan(shelf, xa, xb, y + level - 0.025, y + level, z - half, z + half, {
            radius: 0.008,
            name: 'Board'
        }));
    });
    return group(`Shelf${index}`, ...parts);
};
const fillGondola = (z, random, into)=>{
    const [xa, xb] = SHELF_X;
    [
        -1,
        1
    ].forEach((side)=>{
        SHELF_LEVELS.forEach((level)=>{
            let x = xa + 0.06;
            while(x < xb - 0.12){
                const w = 0.1 + random() * 0.14;
                const h = 0.12 + random() * 0.16;
                const d = 0.18 + random() * 0.14;
                if (random() > 0.08) {
                    into.push({
                        x: x + w / 2,
                        y: LEVEL.floor + level,
                        z: z + side * (SHELF_DEPTH / 2 - d / 2 - 0.04),
                        w,
                        h,
                        d,
                        color: Math.floor(random() * 8),
                        shade: 0.82 + random() * 0.3
                    });
                }
                x += w + 0.015 + random() * 0.03;
            }
        });
    });
};
const buildFridge = (materials)=>{
    const body = materials.toon('fridgeBody');
    const frame = materials.toon('frame');
    const { x0, x1, z0, z1, height } = FRIDGE;
    const y = LEVEL.floor;
    const parts = [
        boxSpan(body, x0, x1, y, y + height, z0, z0 + 0.06, {
            radius: 0.01,
            name: 'Back'
        }),
        boxSpan(body, x0, x0 + 0.06, y, y + height, z0, z1, {
            radius: 0.01,
            name: 'Side'
        }),
        boxSpan(body, x1 - 0.06, x1, y, y + height, z0, z1, {
            radius: 0.01,
            name: 'Side'
        }),
        boxSpan(body, x0, x1, y + height - 0.22, y + height, z0, z1, {
            radius: 0.015,
            name: 'Header'
        }),
        boxSpan(body, x0, x1, y, y + 0.16, z0, z1, {
            radius: 0.015,
            name: 'Base'
        })
    ];
    const glow = mesh(new THREE.PlaneGeometry(x1 - x0 - 0.14, height - 0.42), materials.glow('fridgeGlow'), {
        name: 'Glow',
        castShadow: false,
        receiveShadow: false
    });
    glow.position.set((x0 + x1) / 2, y + 0.16 + (height - 0.38) / 2, z0 + 0.065);
    parts.push(glow);
    for(let level = 1; level <= 4; level += 1){
        const ly = y + 0.16 + level * 0.33;
        parts.push(boxSpan(materials.toon('metal'), x0 + 0.06, x1 - 0.06, ly - 0.012, ly, z0 + 0.06, z1 - 0.05, {
            radius: 0.004,
            name: 'Rack'
        }));
    }
    const doorWidth = (x1 - x0) / FRIDGE.doors;
    for(let index = 0; index <= FRIDGE.doors; index += 1){
        const x = x0 + doorWidth * index;
        parts.push(boxSpan(frame, x - 0.025, x + 0.025, y + 0.16, y + height - 0.22, z1 - 0.03, z1 + 0.01, {
            radius: 0.008,
            name: 'Mullion'
        }));
        if (index < FRIDGE.doors) {
            parts.push(boxSpan(frame, x + doorWidth - 0.1, x + doorWidth - 0.08, y + 0.8, y + 1.3, z1 + 0.01, z1 + 0.04, {
                radius: 0.006,
                name: 'Handle'
            }));
        }
    }
    const pane = mesh(new THREE.PlaneGeometry(x1 - x0 - 0.08, height - 0.4), materials.glass, {
        name: 'Glass',
        castShadow: false,
        receiveShadow: false
    });
    pane.position.set((x0 + x1) / 2, y + 0.16 + (height - 0.38) / 2, z1 - 0.005);
    pane.renderOrder = 2;
    parts.push(pane);
    return group('Fridge', ...parts);
};
const fillFridge = (random, into)=>{
    const { x0, x1, z0 } = FRIDGE;
    for(let level = 0; level < 5; level += 1){
        const ly = LEVEL.floor + 0.16 + level * 0.33;
        let x = x0 + 0.1;
        while(x < x1 - 0.14){
            const tall = 0.18 + random() * 0.07;
            into.push({
                x: x + 0.04,
                y: ly,
                z: z0 + 0.32,
                w: 0.075,
                h: tall,
                d: 0.075,
                color: Math.floor(random() * 8),
                shade: 0.85 + random() * 0.3
            });
            x += 0.11 + random() * 0.02;
        }
    }
};
const buildCounter = (materials)=>{
    const counter = materials.toon('counter');
    const dark = materials.toon('darkMetal');
    const xa = -0.38;
    const xb = 0.18;
    const za = -2.55;
    const zb = -1.05;
    const y = LEVEL.floor;
    const parts = [
        boxSpan(counter, xa, xb, y, y + 0.95, za, zb, {
            radius: 0.03,
            name: 'Body'
        }),
        boxSpan(materials.toon('brand2'), xa - 0.01, xa + 0.01, y + 0.62, y + 0.72, za + 0.05, zb - 0.05, {
            radius: 0.004,
            name: 'Stripe'
        }),
        boxSpan(materials.toon('trim'), xa - 0.04, xb + 0.02, y + 0.95, y + 0.99, za - 0.02, zb + 0.02, {
            radius: 0.015,
            name: 'Top'
        }),
        boxSpan(dark, xa + 0.12, xa + 0.42, y + 0.99, y + 1.13, zb - 0.42, zb - 0.12, {
            radius: 0.02,
            name: 'Register'
        }),
        boxSpan(dark, xa + 0.4, xa + 0.43, y + 1.1, y + 1.34, zb - 0.38, zb - 0.16, {
            radius: 0.01,
            name: 'Display'
        }),
        boxSpan(dark, xa + 0.08, xa + 0.38, y + 0.99, y + 1.36, za + 0.12, za + 0.42, {
            radius: 0.02,
            name: 'CoffeeMachine'
        })
    ];
    const screen = mesh(new THREE.PlaneGeometry(0.2, 0.14), materials.glow('screen'), {
        name: 'Screen',
        castShadow: false,
        receiveShadow: false
    });
    screen.position.set(xa + 0.395, y + 1.22, zb - 0.27);
    screen.rotation.y = -Math.PI / 2;
    parts.push(screen);
    parts.push(boxSpan(materials.glow('snackCase'), xa + 0.06, xa + 0.5, y + 0.99, y + 1.3, za + 0.58, za + 1.02, {
        radius: 0.03,
        name: 'SnackCase',
        castShadow: false
    }));
    parts.push(boxSpan(dark, xa + 0.04, xa + 0.52, y + 1.3, y + 1.34, za + 0.56, za + 1.04, {
        radius: 0.012,
        name: 'SnackLid'
    }));
    return group('Counter', ...parts);
};
const buildFixtures = (materials, slots, random)=>{
    const shelf = materials.toon('shelf');
    const dark = materials.toon('darkMetal');
    const y = LEVEL.floor;
    const parts = [
        boxSpan(shelf, -4.45, -1.65, y, y + 0.9, 0.02, 0.28, {
            radius: 0.02,
            name: 'MagazineRack'
        }),
        boxSpan(materials.toon('acUnit'), -5.18, -4.62, y, y + 1.12, -0.72, -0.08, {
            radius: 0.04,
            name: 'Copier'
        }),
        boxSpan(dark, -5.2, -4.72, y, y + 1.5, -1.72, -1.02, {
            radius: 0.04,
            name: 'Atm'
        }),
        boxSpan(materials.toon('frame'), -0.92, -0.08, y, y + 2.05, STORE.z0 + STORE.wall, STORE.z0 + STORE.wall + 0.04, {
            radius: 0.01,
            name: 'StaffDoor'
        })
    ];
    const atmScreen = mesh(new THREE.PlaneGeometry(0.3, 0.22), materials.glow('screen'), {
        name: 'AtmScreen',
        castShadow: false,
        receiveShadow: false
    });
    atmScreen.position.set(-4.715, y + 1.12, -1.37);
    atmScreen.rotation.y = Math.PI / 2;
    parts.push(atmScreen);
    for(let x = -4.38; x < -1.75; x += 0.2 + random() * 0.04){
        slots.push({
            x,
            y: y + 0.9,
            z: 0.15,
            w: 0.17,
            h: 0.24,
            d: 0.02,
            color: Math.floor(random() * 8),
            shade: 0.9 + random() * 0.2
        });
    }
    return group('Fixtures', ...parts);
};
const buildCeilingLights = (materials)=>{
    const positions = [];
    [
        -0.7,
        -2.45,
        -4.0
    ].forEach((z)=>{
        [
            -3.9,
            -2.2,
            -0.5
        ].forEach((x)=>positions.push([
                x,
                z
            ]));
    });
    const lights = new THREE.InstancedMesh(roundedBox(1.25, 0.05, 0.22, 0.02), materials.glow('ceilingLight'), positions.length);
    lights.name = 'CeilingLights';
    lights.castShadow = false;
    const matrix = new THREE.Matrix4();
    positions.forEach(([x, z], index)=>{
        matrix.makeTranslation(x, STORE.wallHeight - 0.06, z);
        lights.setMatrixAt(index, matrix);
    });
    return lights;
};
const productBatch = (materials, slots, geometry, name, tilt = 0)=>{
    const batch = new THREE.InstancedMesh(geometry, materials.product, slots.length);
    batch.name = name;
    batch.castShadow = false;
    batch.receiveShadow = true;
    const colorIndex = new Uint8Array(slots.length);
    const shade = new Float32Array(slots.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4().makeRotationX(tilt);
    slots.forEach((slot, index)=>{
        matrix.makeScale(slot.w, slot.h, slot.d).premultiply(rotation);
        matrix.setPosition(slot.x, slot.y + slot.h / 2, slot.z);
        batch.setMatrixAt(index, matrix);
        colorIndex[index] = slot.color;
        shade[index] = slot.shade;
        batch.setColorAt(index, new THREE.Color(1, 1, 1));
    });
    return {
        mesh: batch,
        colorIndex,
        shade
    };
};
export const buildKonbiniInterior = (materials, shelfSeed)=>{
    const random = createVisualizerRng(shelfSeed);
    const shelfSlots = [];
    const bottleSlots = [];
    const magazineSlots = [];
    const gondolas = SHELF_ROWS.map((z, index)=>{
        fillGondola(z, random, shelfSlots);
        return buildGondola(materials, z, index);
    });
    fillFridge(random, bottleSlots);
    const fixtures = buildFixtures(materials, magazineSlots, random);
    const boxes = productBatch(materials, shelfSlots, roundedBox(1, 1, 1, 0), 'Products');
    const bottles = productBatch(materials, bottleSlots, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), 'Bottles');
    const magazines = productBatch(materials, magazineSlots, roundedBox(1, 1, 1, 0), 'Magazines', -0.25);
    const interior = group('Store/Interior', ...gondolas, buildFridge(materials), buildCounter(materials), fixtures, buildCeilingLights(materials), boxes.mesh, bottles.mesh, magazines.mesh);
    return {
        group: interior,
        productBatches: [
            boxes,
            bottles,
            magazines
        ]
    };
};
