/* 移植自 Folia components/visualizer/machi/scenes/kowloon/blocks.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { createVisualizerRng } from './components_visualizer_visualizerSeedHash.mjs';
import { boxAt, boxSpan, cylinderAt, group, mesh, roundedBox } from './components_visualizer_machi_engine_geometry_shapes.mjs';
import { BLOCKS, FLOORS, LEVEL } from './components_visualizer_machi_scenes_kowloon_layout.mjs';
const WINDOW_LIGHTS = [
    '#ffc47a',
    '#ffd39a',
    '#cfe2f5',
    '#b4f0cf',
    '#ff8fd0',
    '#8fc8f5'
];
const WINDOW_WEIGHTS = [
    0.3,
    0.16,
    0.22,
    0.12,
    0.1,
    0.1
];
const CLOTHES = [
    '#f1efe8',
    '#a9c8e8',
    '#d0463c',
    '#e8c24a',
    '#f0a3c0',
    '#2c3d63',
    '#9a9fa6',
    '#6fb08a'
];
const UP = new THREE.Vector3(0, 1, 0);
const facesOf = (block)=>[
        {
            block,
            origin: new THREE.Vector3(block.x0, 0, block.z1),
            along: new THREE.Vector3(1, 0, 0),
            normal: new THREE.Vector3(0, 0, 1),
            width: block.x1 - block.x0,
            rotationY: 0
        },
        {
            block,
            origin: new THREE.Vector3(block.x1, 0, block.z1),
            along: new THREE.Vector3(0, 0, -1),
            normal: new THREE.Vector3(1, 0, 0),
            width: block.z1 - block.z0,
            rotationY: Math.PI / 2
        },
        {
            block,
            origin: new THREE.Vector3(block.x0, 0, block.z0),
            along: new THREE.Vector3(0, 0, 1),
            normal: new THREE.Vector3(-1, 0, 0),
            width: block.z1 - block.z0,
            rotationY: -Math.PI / 2
        }
    ];
const insideAnyBlock = (point, eps = 0.01)=>BLOCKS.some((block)=>point.x > block.x0 + eps && point.x < block.x1 - eps && point.z > block.z0 + eps && point.z < block.z1 - eps && point.y < block.height - eps);
const insideAny = (point, boxes)=>boxes.some((box)=>box.containsPoint(point));
const facePoint = (face, s, y, out = 0)=>face.origin.clone().addScaledVector(face.along, s).addScaledVector(UP, y).addScaledVector(face.normal, out);
const faceBounds = (face, s0, s1, y0, y1, out0, out1)=>new THREE.Box3().setFromPoints([
        facePoint(face, s0, y0, out0),
        facePoint(face, s1, y1, out1)
    ]);
const hitsAny = (box, boxes)=>boxes.some((other)=>other.intersectsBox(box));
const faceBox = (material, face, s, y, size, out, name)=>{
    const result = mesh(roundedBox(size[0], size[1], size[2], 0), material, {
        name
    });
    result.position.copy(facePoint(face, s, y + size[1] / 2, out));
    result.rotation.y = face.rotationY;
    return result;
};
const pickWeighted = (random, weights)=>{
    let roll = random() * weights.reduce((sum, weight)=>sum + weight, 0);
    for(let index = 0; index < weights.length; index += 1){
        roll -= weights[index];
        if (roll <= 0) return index;
    }
    return weights.length - 1;
};
const instanced = (geometry, material, slots, name, castShadow = false)=>{
    const result = new THREE.InstancedMesh(geometry, material, Math.max(1, slots.length));
    result.name = name;
    result.count = slots.length;
    result.castShadow = castShadow;
    result.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();
    slots.forEach((slot, index)=>{
        quaternion.setFromAxisAngle(UP, slot.rotationY);
        matrix.compose(slot.position, quaternion, slot.scale);
        result.setMatrixAt(index, matrix);
        if (slot.color) result.setColorAt(index, color.set(slot.color));
    });
    result.instanceMatrix.needsUpdate = true;
    if (result.instanceColor) result.instanceColor.needsUpdate = true;
    return result;
};
export const buildKowloonBlocks = (materials, seed, avoid, signs, footing = [])=>{
    const random = createVisualizerRng(`kowloon:blocks:${seed}`);
    const frame = materials.toon('windowFrame');
    const slab = materials.toon('slab');
    const cageMaterials = [
        materials.toon('cage'),
        materials.toon('rust')
    ];
    const ac = materials.toon('ac');
    const acGrille = materials.toon('acGrille');
    const pipe = materials.toon('pipe');
    const bamboo = materials.toon('bamboo');
    const stain = materials.toon('stain');
    const blocks = [];
    const lit = [];
    const dark = [];
    const clothes = [];
    const drips = [];
    const outward = [];
    const claim = (box)=>{
        if (hitsAny(box, outward)) return false;
        outward.push(box);
        return true;
    };
    const overhead = [
        ...signs,
        ...avoid
    ];
    const ground = [
        ...footing,
        ...BLOCKS.flatMap((block)=>block.hollow ? [
                new THREE.Box3(new THREE.Vector3(block.hollow.x0, 0, block.z1 - 0.05), new THREE.Vector3(block.hollow.x1, block.hollow.y1, block.z1 + 0.5))
            ] : [])
    ];
    const glass = (face, s, y, w, h, out)=>{
        const slot = {
            position: facePoint(face, s, y, out),
            rotationY: face.rotationY,
            scale: new THREE.Vector3(w, h, 1)
        };
        if (random() < 0.46) lit.push({
            ...slot,
            color: WINDOW_LIGHTS[pickWeighted(random, WINDOW_WEIGHTS)]
        });
        else dark.push(slot);
    };
    BLOCKS.forEach((block)=>{
        const parts = [];
        const wall = materials.toon(block.wall);
        const hollow = block.hollow;
        if (hollow) {
            parts.push(boxSpan(wall, block.x0, block.x1, hollow.y1, block.height, block.z0, block.z1, {
                radius: 0.02,
                name: 'Body'
            }), boxSpan(wall, block.x0, block.x1, 0, hollow.y1, block.z0, hollow.z0, {
                radius: 0.02,
                name: 'Body'
            }), boxSpan(wall, block.x0, hollow.x0, 0, hollow.y1, hollow.z0, block.z1, {
                radius: 0.02,
                name: 'Body'
            }), boxSpan(wall, hollow.x1, block.x1, 0, hollow.y1, hollow.z0, block.z1, {
                radius: 0.02,
                name: 'Body'
            }));
        } else {
            parts.push(boxSpan(wall, block.x0, block.x1, 0, block.height, block.z0, block.z1, {
                radius: 0.02,
                name: 'Body'
            }));
        }
        facesOf(block).forEach((face)=>{
            const probe = facePoint(face, face.width / 2, block.height - 0.5, 0.2);
            const outer = Math.abs(probe.x) > 6 || Math.abs(probe.z) > 6;
            for(let y = FLOORS.ground; y < block.height - 0.3; y += FLOORS.height){
                parts.push(faceBox(slab, face, face.width / 2, y - 0.03, [
                    face.width,
                    0.06,
                    0.1
                ], 0.0, 'Slab'));
                if (!outer && random() < 0.14) {
                    const length = Math.min(face.width - 0.2, 0.9 + random() * 1.6);
                    const s = 0.1 + length / 2 + random() * (face.width - 0.2 - length);
                    if (!insideAnyBlock(facePoint(face, s, y + 0.1, 0.15)) && !insideAny(facePoint(face, s, y, 0.1), avoid)) {
                        parts.push(faceBox(materials.glow(random() < 0.55 ? 'stripPink' : 'stripCyan'), face, s, y + 0.03, [
                            length,
                            0.035,
                            0.03
                        ], 0.06, 'Strip'));
                    }
                }
            }
            const columns = Math.max(1, Math.floor((face.width - 0.2) / 0.64));
            const spacing = face.width / columns;
            const pipes = 1 + Math.floor(random() * 2);
            for(let index = 0; index < pipes; index += 1){
                const pick = random();
                const s = columns > 1 ? (1 + Math.floor(pick * (columns - 1))) * spacing : pick < 0.5 ? 0.12 : face.width - 0.12;
                if (insideAnyBlock(facePoint(face, s, block.height - 0.4, 0.12))) continue;
                const top = block.height - 0.1;
                const bottom = hitsAny(faceBounds(face, s - 0.05, s + 0.05, 0, FLOORS.ground, 0.04, 0.14), ground) ? FLOORS.ground - 0.03 : 0;
                const bounds = faceBounds(face, s - 0.05, s + 0.05, bottom, top, 0.04, 0.14);
                if (hitsAny(bounds, overhead) || !claim(bounds)) continue;
                const at = facePoint(face, s, 0, 0.09);
                parts.push(cylinderAt(pipe, 0.045, top - bottom, [
                    at.x,
                    bottom,
                    at.z
                ], {
                    name: 'Pipe',
                    segments: 6
                }));
            }
            for(let y = FLOORS.ground; y + 0.85 <= block.height - 0.15; y += FLOORS.height){
                for(let column = 0; column < columns; column += 1){
                    const s = (column + 0.5) * spacing + (random() - 0.5) * 0.08;
                    const center = y + 0.55;
                    const probes = [
                        -0.27,
                        0,
                        0.27
                    ].map((ds)=>facePoint(face, s + ds, center, 0.12));
                    if (probes.some((point)=>insideAnyBlock(point))) continue;
                    if (probes.some((point)=>insideAny(point, avoid))) continue;
                    const blocked = [
                        ...signs,
                        ...avoid
                    ];
                    const nearSign = (out, dy = 0)=>[
                            -0.26,
                            0,
                            0.26
                        ].some((ds)=>insideAny(facePoint(face, s + ds, center + dy, out), blocked));
                    const roll = random();
                    if (!outer && roll < 0.08 && !nearSign(0.3) && claim(faceBounds(face, s - 0.3, s + 0.3, y + 0.06, y + 0.92, 0, 0.4))) {
                        const color = random() < 0.5 ? 'wallD' : 'wallB';
                        parts.push(faceBox(materials.toon(color), face, s, y + 0.06, [
                            0.6,
                            0.86,
                            0.4
                        ], 0.2, 'Addition'));
                        parts.push(faceBox(frame, face, s, y + 0.3, [
                            0.42,
                            0.44,
                            0.04
                        ], 0.41, 'Frame'));
                        glass(face, s, center + 0.02, 0.32, 0.34, 0.435);
                        continue;
                    }
                    parts.push(faceBox(frame, face, s, center - 0.3, [
                        0.46,
                        0.6,
                        0.06
                    ], 0.0, 'Frame'));
                    parts.push(faceBox(slab, face, s, center - 0.33, [
                        0.52,
                        0.04,
                        0.12
                    ], 0.02, 'Sill'));
                    glass(face, s, center, 0.36, 0.48, 0.035);
                    if (outer) continue;
                    if (roll < 0.36 && !nearSign(0.15) && claim(faceBounds(face, s - 0.27, s + 0.27, center - 0.37, center + 0.37, 0, 0.25))) {
                        const material = cageMaterials[random() < 0.35 ? 1 : 0];
                        const depth = 0.24;
                        const bottom = center - 0.34;
                        const top = center + 0.34;
                        parts.push(faceBox(material, face, s, top, [
                            0.54,
                            0.03,
                            depth
                        ], depth / 2, 'Cage'));
                        parts.push(faceBox(material, face, s, bottom - 0.03, [
                            0.54,
                            0.03,
                            depth
                        ], depth / 2, 'Cage'));
                        [
                            -0.25,
                            -0.125,
                            0,
                            0.125,
                            0.25
                        ].forEach((ds)=>parts.push(faceBox(material, face, s + ds, bottom, [
                                0.02,
                                top - bottom,
                                0.02
                            ], depth, 'Cage')));
                        parts.push(faceBox(material, face, s, center, [
                            0.54,
                            0.02,
                            0.02
                        ], depth, 'Cage'));
                        [
                            -0.25,
                            0.25
                        ].forEach((ds)=>parts.push(faceBox(material, face, s + ds, center, [
                                0.02,
                                0.02,
                                depth
                            ], depth / 2, 'Cage')));
                        if (random() < 0.4) parts.push(faceBox(materials.toon('plant'), face, s + (random() - 0.5) * 0.24, bottom, [
                            0.14,
                            0.14,
                            0.14
                        ], 0.14, 'Plant'));
                    } else if (roll < 0.7 && !nearSign(0.2, -0.4) && claim(faceBounds(face, s - 0.21, s + 0.21, center - 0.72, center - 0.42, 0, 0.33))) {
                        const acY = center - 0.72;
                        parts.push(faceBox(ac, face, s, acY, [
                            0.42,
                            0.3,
                            0.32
                        ], 0.16, 'AC'));
                        parts.push(faceBox(acGrille, face, s - 0.04, acY + 0.05, [
                            0.28,
                            0.2,
                            0.02
                        ], 0.325, 'AC'));
                        if (random() < 0.45) {
                            const length = 0.45 + random() * 0.7;
                            parts.push(faceBox(stain, face, s + (random() - 0.5) * 0.2, acY - length, [
                                0.08 + random() * 0.08,
                                length,
                                0.012
                            ], 0.006, 'Stain'));
                        }
                        if (drips.length < 28 && random() < 0.6) {
                            const at = facePoint(face, s + 0.12, acY, 0.3);
                            drips.push({
                                x: at.x,
                                z: at.z,
                                from: acY,
                                to: LEVEL.ground,
                                period: 1.4 + random() * 2.2,
                                phase: random()
                            });
                        }
                    } else if (roll < 0.82 && !nearSign(0.6, 0.35) && claim(faceBounds(face, s - 0.03, s + 0.03, center - 0.08, center + 0.4, 0, 0.96))) {
                        const poleY = center + 0.38;
                        const from = facePoint(face, s, poleY, 0.02);
                        const to = facePoint(face, s, poleY, 0.95);
                        const result = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.93, 5), bamboo, {
                            name: 'Bamboo',
                            castShadow: false
                        });
                        result.position.copy(from).add(to).multiplyScalar(0.5);
                        result.quaternion.setFromUnitVectors(UP, face.normal);
                        parts.push(result);
                        const count = 2 + Math.floor(random() * 2);
                        const pieces = Array.from({
                            length: count
                        }, ()=>({
                                w: 0.16 + random() * 0.12,
                                h: 0.26 + random() * 0.18,
                                shift: random(),
                                color: CLOTHES[Math.floor(random() * CLOTHES.length)]
                            }));
                        const [near, far, gap] = [
                            0.12,
                            0.92,
                            0.03
                        ];
                        const room = far - near - gap * (count - 1);
                        const total = pieces.reduce((sum, piece)=>sum + piece.w, 0);
                        const narrow = Math.min(1, room / total);
                        const slack = (room - total * narrow) / count;
                        let out = near;
                        pieces.forEach((piece)=>{
                            const w = piece.w * narrow;
                            out += slack * piece.shift;
                            clothes.push({
                                position: facePoint(face, s, poleY - piece.h / 2 - 0.01, out + w / 2),
                                rotationY: face.rotationY + Math.PI / 2,
                                scale: new THREE.Vector3(w, piece.h, 0.018),
                                color: piece.color
                            });
                            out += w + gap + slack * (1 - piece.shift);
                        });
                    }
                }
            }
        });
        const top = block.height;
        parts.push(boxSpan(materials.toon('roofTar'), block.x0 + 0.06, block.x1 - 0.06, top, top + 0.03, block.z0 + 0.06, block.z1 - 0.06, {
            radius: 0.01,
            name: 'Roof'
        }));
        const parapet = materials.toon('slab');
        parts.push(boxSpan(parapet, block.x0, block.x1, top, top + 0.26, block.z1 - 0.08, block.z1, {
            radius: 0.01,
            name: 'Parapet'
        }));
        parts.push(boxSpan(parapet, block.x0, block.x1, top, top + 0.26, block.z0, block.z0 + 0.08, {
            radius: 0.01,
            name: 'Parapet'
        }));
        parts.push(boxSpan(parapet, block.x0, block.x0 + 0.08, top, top + 0.26, block.z0, block.z1, {
            radius: 0.01,
            name: 'Parapet'
        }));
        parts.push(boxSpan(parapet, block.x1 - 0.08, block.x1, top, top + 0.26, block.z0, block.z1, {
            radius: 0.01,
            name: 'Parapet'
        }));
        parts.push(...buildRoofClutter(materials, block, random, avoid));
        blocks.push(group(`Block/${block.name}`, ...parts));
    });
    const glassGeometry = new THREE.PlaneGeometry(1, 1);
    const litMaterial = materials.track(new THREE.MeshBasicMaterial({
        color: 0xffffff
    }));
    litMaterial.name = 'machi:glow:windows';
    const litWindows = instanced(glassGeometry, litMaterial, lit, 'Windows/lit');
    const darkWindows = instanced(glassGeometry, materials.toon('windowDark'), dark, 'Windows/dark');
    const clothesMesh = instanced(new THREE.BoxGeometry(1, 1, 1), materials.product, clothes, 'Laundry', true);
    return {
        group: group('Blocks', ...blocks, litWindows, darkWindows, clothesMesh),
        litWindows: {
            mesh: litWindows,
            material: litMaterial
        },
        darkWindows,
        clothes: clothesMesh,
        drips
    };
};
const buildRoofClutter = (materials, block, random, avoid)=>{
    const parts = [];
    const top = block.height + 0.03;
    const tank = materials.toon('tank');
    const metal = materials.toon('antenna');
    const fits = (x, z, r, h)=>{
        const corners = [
            [
                x - r,
                z - r
            ],
            [
                x + r,
                z - r
            ],
            [
                x - r,
                z + r
            ],
            [
                x + r,
                z + r
            ]
        ];
        return corners.every(([cx, cz])=>{
            if (cx < block.x0 + 0.15 || cx > block.x1 - 0.15 || cz < block.z0 + 0.15 || cz > block.z1 - 0.15) return false;
            const point = new THREE.Vector3(cx, top + h * 0.5, cz);
            return !insideAnyBlock(point) && !insideAny(point, avoid);
        });
    };
    const step = 0.95;
    for(let x = block.x0 + 0.6; x < block.x1 - 0.4; x += step){
        for(let z = block.z0 + 0.6; z < block.z1 - 0.4; z += step){
            const px = x + (random() - 0.5) * 0.4;
            const pz = z + (random() - 0.5) * 0.4;
            const roll = random();
            if (roll < 0.22 && fits(px, pz, 0.4, 1.0)) {
                [
                    [
                        -0.22,
                        -0.22
                    ],
                    [
                        0.22,
                        -0.22
                    ],
                    [
                        -0.22,
                        0.22
                    ],
                    [
                        0.22,
                        0.22
                    ]
                ].forEach(([dx, dz])=>{
                    parts.push(boxAt(metal, [
                        0.05,
                        0.36,
                        0.05
                    ], [
                        px + dx,
                        top,
                        pz + dz
                    ], {
                        radius: 0,
                        name: 'TankLeg'
                    }));
                });
                parts.push(cylinderAt(tank, 0.33, 0.6, [
                    px,
                    top + 0.36,
                    pz
                ], {
                    name: 'Tank',
                    segments: 14
                }));
            } else if (roll < 0.36 && fits(px, pz, 0.55, 1.0)) {
                const color = random() < 0.5 ? 'wallD' : 'shutter';
                parts.push(boxAt(materials.toon(color), [
                    1.0,
                    0.85,
                    0.85
                ], [
                    px,
                    top,
                    pz
                ], {
                    radius: 0.02,
                    name: 'Shack'
                }));
                parts.push(boxAt(materials.toon('roofTar'), [
                    1.12,
                    0.05,
                    0.98
                ], [
                    px,
                    top + 0.85,
                    pz
                ], {
                    radius: 0.01,
                    name: 'Shack'
                }));
                parts.push(boxAt(materials.toon('windowDark'), [
                    0.32,
                    0.62,
                    0.04
                ], [
                    px + 0.2,
                    top,
                    pz + 0.43
                ], {
                    radius: 0,
                    name: 'Shack'
                }));
            } else if (roll < 0.68 && fits(px, pz, 0.32, 1.4)) {
                const height = 0.9 + random() * 0.6;
                parts.push(cylinderAt(metal, 0.018, height, [
                    px,
                    top,
                    pz
                ], {
                    name: 'Antenna',
                    segments: 5
                }));
                const yaw = random() * Math.PI;
                [
                    0.55,
                    0.75,
                    0.92
                ].forEach((t, index)=>{
                    const bar = boxAt(metal, [
                        0.62 - index * 0.12,
                        0.016,
                        0.016
                    ], [
                        px,
                        top + height * t,
                        pz
                    ], {
                        radius: 0,
                        name: 'Antenna'
                    });
                    bar.rotation.y = yaw;
                    parts.push(bar);
                });
            } else if (roll < 0.76 && fits(px, pz, 0.3, 0.8)) {
                parts.push(cylinderAt(metal, 0.025, 0.35, [
                    px,
                    top,
                    pz
                ], {
                    name: 'Dish',
                    segments: 5
                }));
                const dish = mesh(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), materials.toon('ac'), {
                    name: 'Dish'
                });
                dish.position.set(px, top + 0.42, pz);
                dish.rotation.set(-0.9 - random() * 0.4, random() * Math.PI * 2, 0, 'YXZ');
                parts.push(dish);
            } else if (roll < 0.86 && fits(px, pz, 0.36, 0.6)) {
                parts.push(boxAt(materials.toon('ac'), [
                    0.62,
                    0.48,
                    0.48
                ], [
                    px,
                    top,
                    pz
                ], {
                    radius: 0.02,
                    name: 'RoofAC'
                }));
                parts.push(boxAt(materials.toon('acGrille'), [
                    0.4,
                    0.04,
                    0.4
                ], [
                    px,
                    top + 0.48,
                    pz
                ], {
                    radius: 0,
                    name: 'RoofAC'
                }));
            }
        }
    }
    return parts;
};
