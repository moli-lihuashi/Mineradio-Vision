/* 移植自 Folia components/visualizer/machi/scenes/konbini/store.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { MACHI_REFLECT_LAYER } from './components_visualizer_machi_engine_fx_reflection.mjs';
import { BOARD, DOOR, FASCIA, LEVEL, STORE } from './components_visualizer_machi_scenes_konbini_layout.mjs';
import { boxSpan, cylinderAt, group, mesh, roundedBox, tubeBetween } from './components_visualizer_machi_engine_geometry_shapes.mjs';
const { x0, x1, z0, z1, wall } = STORE;
const buildShell = (materials)=>{
    const outer = materials.toon('wall');
    const lining = materials.toon('interiorWall');
    const floor = materials.toon('interiorFloor');
    const frame = materials.toon('frame');
    const h = STORE.wallHeight;
    const parts = [
        boxSpan(floor, x0, x1, LEVEL.lot - 0.02, LEVEL.floor, z0, z1, {
            radius: 0.01,
            name: 'Floor'
        }),
        boxSpan(outer, x0, x1, LEVEL.floor, h, z0, z0 + wall, {
            name: 'Wall/back'
        }),
        boxSpan(outer, x0, x0 + wall, LEVEL.floor, h, z0, z1, {
            name: 'Wall/left'
        }),
        boxSpan(outer, x1 - wall, x1, LEVEL.floor, h, z0, STORE.rightGlassEnd, {
            name: 'Wall/rightSolid'
        }),
        boxSpan(outer, x0, STORE.frontPillarEnd, LEVEL.floor, h, z1 - wall, z1, {
            name: 'Wall/frontPillar'
        }),
        boxSpan(outer, x0, x1, STORE.glassTop, h, z1 - wall, z1, {
            name: 'Wall/frontTransom'
        }),
        boxSpan(outer, x1 - wall, x1, STORE.glassTop, h, STORE.rightGlassEnd, z1, {
            name: 'Wall/rightTransom'
        }),
        boxSpan(lining, x0 + wall, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, z0 + wall + 0.02, {
            radius: 0.005,
            name: 'Lining/back'
        }),
        boxSpan(lining, x0 + wall, x0 + wall + 0.02, LEVEL.floor, h - 0.05, z0 + wall, z1 - wall, {
            radius: 0.005,
            name: 'Lining/left'
        }),
        boxSpan(lining, x1 - wall - 0.02, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, STORE.rightGlassEnd, {
            radius: 0.005,
            name: 'Lining/right'
        }),
        boxSpan(frame, x1 - 0.12, x1, LEVEL.floor, STORE.glassTop, z1 - 0.12, z1, {
            radius: 0.015,
            name: 'CornerPost'
        }),
        boxSpan(frame, STORE.frontPillarEnd, x1, LEVEL.floor, STORE.glassBottom, z1 - 0.1, z1, {
            radius: 0.01,
            name: 'Kick/front'
        }),
        boxSpan(frame, x1 - 0.1, x1, LEVEL.floor, STORE.glassBottom, STORE.rightGlassEnd, z1, {
            radius: 0.01,
            name: 'Kick/right'
        }),
        boxSpan(frame, STORE.frontPillarEnd, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, z1 - 0.1, z1, {
            radius: 0.01,
            name: 'Head/front'
        }),
        boxSpan(frame, x1 - 0.1, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, STORE.rightGlassEnd, z1, {
            radius: 0.01,
            name: 'Head/right'
        })
    ];
    return group('Store/Shell', ...parts);
};
const buildGlazing = (materials)=>{
    const glass = materials.glass;
    const frame = materials.toon('frame');
    const bottom = STORE.glassBottom;
    const top = STORE.glassTop - 0.05;
    const height = top - bottom;
    const parts = [];
    const pane = (width, x, z, rotationY, name)=>{
        const geometry = new THREE.PlaneGeometry(width, height);
        const result = mesh(geometry, glass, {
            name,
            castShadow: false,
            receiveShadow: false
        });
        result.position.set(x, bottom + height / 2, z);
        result.rotation.y = rotationY;
        result.renderOrder = 2;
        return result;
    };
    const frontSpans = [
        [
            STORE.frontPillarEnd,
            DOOR.x0 - 0.08
        ],
        [
            DOOR.x1 + 0.08,
            x1 - 0.12
        ]
    ];
    frontSpans.forEach(([a, b], index)=>{
        parts.push(pane(b - a, (a + b) / 2, z1 - 0.05, 0, `Glass/front${index}`));
        const count = Math.max(1, Math.round((b - a) / 1.25));
        for(let i = 0; i <= count; i += 1){
            const x = a + (b - a) * i / count;
            parts.push(boxSpan(frame, x - 0.03, x + 0.03, bottom, top, z1 - 0.09, z1 - 0.01, {
                radius: 0.01,
                name: 'Mullion'
            }));
        }
    });
    const windowGlow = materials.glow('warmWindow');
    const standIn = (width, x, z, rotationY)=>{
        const plane = mesh(new THREE.PlaneGeometry(width, height * 0.92), windowGlow, {
            name: 'ReflectionWindow',
            castShadow: false,
            receiveShadow: false
        });
        plane.position.set(x, bottom + height * 0.5, z);
        plane.rotation.y = rotationY;
        plane.layers.set(MACHI_REFLECT_LAYER);
        parts.push(plane);
    };
    standIn(x1 - STORE.frontPillarEnd - 0.2, (STORE.frontPillarEnd + x1) / 2, z1 - 0.2, 0);
    standIn(z1 - STORE.rightGlassEnd - 0.2, x1 - 0.2, (z1 + STORE.rightGlassEnd) / 2, Math.PI / 2);
    const rightSpan = [
        STORE.rightGlassEnd,
        z1 - 0.12
    ];
    parts.push(pane(rightSpan[1] - rightSpan[0], x1 - 0.05, (rightSpan[0] + rightSpan[1]) / 2, Math.PI / 2, 'Glass/right'));
    const rightCount = Math.max(1, Math.round((rightSpan[1] - rightSpan[0]) / 1.25));
    for(let i = 0; i <= rightCount; i += 1){
        const z = rightSpan[0] + (rightSpan[1] - rightSpan[0]) * i / rightCount;
        parts.push(boxSpan(frame, x1 - 0.09, x1 - 0.01, bottom, top, z - 0.03, z + 0.03, {
            radius: 0.01,
            name: 'Mullion'
        }));
    }
    return group('Store/Glazing', ...parts);
};
const buildDoor = (materials)=>{
    const frame = materials.toon('frame');
    const darkMetal = materials.toon('darkMetal');
    const glass = materials.glass;
    const panelHeight = DOOR.height - LEVEL.floor - 0.02;
    const mid = (DOOR.x0 + DOOR.x1) / 2;
    const z = z1 + 0.035;
    const parts = [
        boxSpan(frame, DOOR.x0 - 0.08, DOOR.x0, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, {
            radius: 0.01,
            name: 'Jamb/left'
        }),
        boxSpan(frame, DOOR.x1, DOOR.x1 + 0.08, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, {
            radius: 0.01,
            name: 'Jamb/right'
        }),
        boxSpan(frame, DOOR.x0 - 0.9, DOOR.x1 + 0.9, DOOR.height, DOOR.height + 0.16, z1 - 0.02, z1 + 0.1, {
            radius: 0.015,
            name: 'Header'
        }),
        boxSpan(darkMetal, mid - 0.18, mid + 0.18, DOOR.height - 0.07, DOOR.height, z1 + 0.04, z1 + 0.11, {
            radius: 0.012,
            name: 'Sensor'
        }),
        boxSpan(materials.toon('rubber'), DOOR.x0 - 0.1, DOOR.x1 + 0.1, LEVEL.lot, LEVEL.lot + 0.012, z1 + 0.12, z1 + 0.85, {
            radius: 0.006,
            name: 'Mat/out'
        }),
        boxSpan(materials.toon('rubber'), DOOR.x0, DOOR.x1, LEVEL.floor, LEVEL.floor + 0.01, z1 - 0.9, z1 - 0.12, {
            radius: 0.006,
            name: 'Mat/in'
        })
    ];
    const transom = mesh(new THREE.PlaneGeometry(DOOR.x1 - DOOR.x0, STORE.glassTop - DOOR.height - 0.16), glass, {
        name: 'Glass/transom',
        castShadow: false,
        receiveShadow: false
    });
    transom.position.set(mid, (DOOR.height + 0.16 + STORE.glassTop) / 2, z1 - 0.05);
    transom.renderOrder = 2;
    parts.push(transom);
    const panels = [];
    [
        -1,
        1
    ].forEach((direction)=>{
        const w = DOOR.panelWidth;
        const panelGlass = mesh(new THREE.PlaneGeometry(w - 0.1, panelHeight - 0.14), glass, {
            name: 'Glass',
            castShadow: false,
            receiveShadow: false
        });
        panelGlass.position.set(0, panelHeight / 2 + 0.02, 0);
        panelGlass.renderOrder = 2;
        const rails = [
            boxSpan(frame, -w / 2, -w / 2 + 0.05, 0, panelHeight, -0.025, 0.025, {
                radius: 0.01,
                name: 'Stile'
            }),
            boxSpan(frame, w / 2 - 0.05, w / 2, 0, panelHeight, -0.025, 0.025, {
                radius: 0.01,
                name: 'Stile'
            }),
            boxSpan(frame, -w / 2, w / 2, 0, 0.09, -0.025, 0.025, {
                radius: 0.01,
                name: 'Rail'
            }),
            boxSpan(frame, -w / 2, w / 2, panelHeight - 0.05, panelHeight, -0.025, 0.025, {
                radius: 0.01,
                name: 'Rail'
            }),
            boxSpan(darkMetal, -0.02, 0.02, 0.9, 1.25, 0.025, 0.045, {
                radius: 0.008,
                name: 'Pull'
            })
        ];
        const panel = group(direction < 0 ? 'Door/left' : 'Door/right', ...rails, panelGlass);
        panel.userData.dynamic = true;
        const closedX = mid + direction * (w / 2 - 0.02);
        panel.position.set(closedX, LEVEL.floor + 0.01, z);
        panels.push({
            object: panel,
            closedX,
            direction
        });
        parts.push(panel);
    });
    return {
        group: group('Store/Door', ...parts),
        panels
    };
};
const buildRoof = (materials)=>{
    const roof = materials.toon('roof');
    const trim = materials.toon('trim');
    const o = STORE.overhang;
    const top = STORE.roofTop;
    const p = STORE.parapetTop;
    const t = 0.1;
    const parts = [
        boxSpan(roof, x0 - o, x1 + o, STORE.wallHeight, top, z0 - o, z1 + o, {
            radius: 0.025,
            name: 'Slab'
        }),
        boxSpan(trim, x0 - o, x1 + o, top, p, z0 - o, z0 - o + t, {
            radius: 0.02,
            name: 'Parapet/back'
        }),
        boxSpan(trim, x0 - o, x1 + o, top, p, z1 + o - t, z1 + o, {
            radius: 0.02,
            name: 'Parapet/front'
        }),
        boxSpan(trim, x0 - o, x0 - o + t, top, p, z0 - o, z1 + o, {
            radius: 0.02,
            name: 'Parapet/left'
        }),
        boxSpan(trim, x1 + o - t, x1 + o, top, p, z0 - o, z1 + o, {
            radius: 0.02,
            name: 'Parapet/right'
        })
    ];
    const pipe = materials.toon('metal');
    const px = x0 - 0.06;
    const pz = z1 - 0.12;
    parts.push(cylinderAt(pipe, 0.045, top - LEVEL.lot - 0.2, [
        px,
        LEVEL.lot + 0.2,
        pz
    ], {
        segments: 10,
        name: 'Downspout'
    }));
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, LEVEL.lot + 0.22, pz), new THREE.Vector3(px - 0.05, LEVEL.lot + 0.06, pz + 0.2), 0.045, {
        name: 'Downspout/elbow'
    }));
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, top - 0.02, pz), new THREE.Vector3(px + 0.18, top - 0.02, pz + 0.2), 0.04, {
        name: 'Downspout/head'
    }));
    return group('Store/Roof', ...parts);
};
const buildFascia = (materials)=>{
    const base = materials.toon('signBase');
    const d = FASCIA.depth;
    const parts = [
        boxSpan(base, x0 - 0.02, x1 + d, FASCIA.y0, FASCIA.y1, z1, z1 + d, {
            radius: 0.03,
            name: 'Board/front'
        }),
        boxSpan(base, x1, x1 + d, FASCIA.y0, FASCIA.y1, z0 + 0.4, z1 + d - 0.01, {
            radius: 0.03,
            name: 'Board/right'
        })
    ];
    const stripes = [
        [
            'brand0',
            FASCIA.y1 - 0.07,
            FASCIA.y1 - 0.01
        ],
        [
            'brand2',
            FASCIA.y0 + 0.1,
            FASCIA.y0 + 0.15
        ],
        [
            'brand0',
            FASCIA.y0 + 0.03,
            FASCIA.y0 + 0.08
        ]
    ];
    stripes.forEach(([role, y0, y1], index)=>{
        const material = materials.toon(role);
        parts.push(boxSpan(material, x0 - 0.01, x1 + d + 0.01, y0, y1, z1 + d - 0.02, z1 + d + 0.008, {
            radius: 0.006,
            name: `Stripe/front${index}`
        }));
        parts.push(boxSpan(material, x1 + d - 0.02, x1 + d + 0.008, y0, y1, z0 + 0.41, z1 + d, {
            radius: 0.006,
            name: `Stripe/right${index}`
        }));
    });
    const textHeight = FASCIA.y1 - 0.08 - (FASCIA.y0 + 0.16);
    const textY = (FASCIA.y1 - 0.08 + FASCIA.y0 + 0.16) / 2;
    const faces = [
        {
            position: new THREE.Vector3((x0 + x1) / 2, textY, z1 + d + 0.006),
            rotationY: 0,
            width: x1 - x0 - 0.2,
            height: textHeight
        },
        {
            position: new THREE.Vector3(x1 + d + 0.006, textY, (z0 + 0.4 + z1) / 2),
            rotationY: Math.PI / 2,
            width: z1 - z0 - 0.6,
            height: textHeight
        }
    ];
    return {
        group: group('Store/Fascia', ...parts),
        faces
    };
};
const buildBoardTower = (materials)=>{
    const steel = materials.toon('darkMetal');
    const trim = materials.toon('trim');
    const W = BOARD.faceWidth;
    const H = BOARD.faceHeight;
    const inradius = W / (2 * Math.sqrt(3));
    const circumradius = W / Math.sqrt(3);
    const center = new THREE.Vector3(BOARD.cx, 0, BOARD.cz);
    const parts = [];
    const faces = [];
    const vertices = [];
    for(let k = 0; k < 3; k += 1){
        const a = BOARD.azimuth + k * 2 * Math.PI / 3;
        const normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const position = center.clone().addScaledVector(normal, inradius + 0.012);
        position.y = BOARD.y0 + H / 2;
        faces.push({
            position,
            rotationY: a
        });
        const va = a + Math.PI / 3;
        vertices.push(center.clone().add(new THREE.Vector3(Math.sin(va) * circumradius, 0, Math.cos(va) * circumradius)));
    }
    for(let k = 0; k < 3; k += 1){
        const a = BOARD.azimuth + k * 2 * Math.PI / 3;
        const normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const panelCenter = center.clone().addScaledVector(normal, inradius - 0.07);
        const panel = mesh(roundedBox(W + 0.06, H + 0.16, 0.14, 0.03), steel, {
            name: `Panel${k}`
        });
        panel.position.set(panelCenter.x, BOARD.y0 + H / 2, panelCenter.z);
        panel.rotation.y = a;
        parts.push(panel);
        [
            BOARD.y0 + H + 0.1,
            BOARD.y0 - 0.1
        ].forEach((y, index)=>{
            const beam = mesh(roundedBox(W + 0.14, 0.09, 0.2, 0.02), trim, {
                name: index === 0 ? 'TopBeam' : 'BottomBeam'
            });
            const beamCenter = center.clone().addScaledVector(normal, inradius - 0.04);
            beam.position.set(beamCenter.x, y, beamCenter.z);
            beam.rotation.y = a;
            parts.push(beam);
        });
        const rim = mesh(roundedBox(W + 0.1, 0.04, 0.04, 0.012), materials.glow('neonRim'), {
            name: 'NeonRim',
            castShadow: false,
            receiveShadow: false
        });
        const rimCenter = center.clone().addScaledVector(normal, inradius + 0.075);
        rim.position.set(rimCenter.x, BOARD.y0 + H + 0.1, rimCenter.z);
        rim.rotation.y = a;
        parts.push(rim);
    }
    const lidShape = new THREE.Shape();
    vertices.forEach((vertex, index)=>{
        const local = vertex.clone().sub(center).multiplyScalar(1.01);
        if (index === 0) lidShape.moveTo(local.x, -local.z);
        else lidShape.lineTo(local.x, -local.z);
    });
    lidShape.closePath();
    const lidGeometry = new THREE.ExtrudeGeometry(lidShape, {
        depth: 0.06,
        bevelEnabled: true,
        bevelSize: 0.03,
        bevelThickness: 0.015,
        bevelSegments: 1
    });
    lidGeometry.rotateX(-Math.PI / 2);
    const lid = mesh(lidGeometry, materials.toon('metal'), {
        name: 'Lid'
    });
    lid.position.set(center.x, BOARD.y0 + H + 0.08, center.z);
    parts.push(lid);
    vertices.forEach((vertex, index)=>{
        const inward = center.clone().sub(vertex).setY(0).normalize();
        const foot = vertex.clone().addScaledVector(inward, 0.18);
        parts.push(cylinderAt(steel, 0.06, BOARD.y0 + H + 0.1 - STORE.roofTop, [
            foot.x,
            STORE.roofTop,
            foot.z
        ], {
            segments: 8,
            name: `Post${index}`
        }));
        const brace = foot.clone().addScaledVector(inward, 0.9);
        parts.push(tubeBetween(steel, new THREE.Vector3(brace.x, STORE.roofTop, brace.z), new THREE.Vector3(foot.x, BOARD.y0 - 0.1, foot.z), 0.03, {
            name: 'Brace'
        }));
        parts.push(boxSpan(trim, brace.x - 0.14, brace.x + 0.14, STORE.roofTop, STORE.roofTop + 0.06, brace.z - 0.14, brace.z + 0.14, {
            radius: 0.01,
            name: 'BracePad'
        }));
    });
    const lidTop = BOARD.y0 + H + 0.08 + 0.06 + 0.015;
    const lidShapePoints = vertices.map((vertex)=>{
        const local = vertex.clone().sub(center).multiplyScalar(1.01);
        return new THREE.Vector2(local.x, -local.z);
    });
    return {
        group: group('Store/BoardTower', ...parts),
        faces,
        lid: {
            center,
            shape: lidShapePoints,
            topY: lidTop
        }
    };
};
export const buildKonbiniStore = (materials, interior)=>{
    const door = buildDoor(materials);
    const fascia = buildFascia(materials);
    const tower = buildBoardTower(materials);
    const store = group('Store', buildShell(materials), buildGlazing(materials), door.group, buildRoof(materials), fascia.group, tower.group, interior);
    return {
        group: store,
        doorPanels: door.panels,
        boardFaces: tower.faces,
        fasciaFaces: fascia.faces,
        boardLid: tower.lid
    };
};
