/* 移植自 Folia components/visualizer/machi/scenes/konbini/konbiniScene.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { mixHexColors } from './utils_themeColorMath.mjs';
import { resolveMachiCar } from './components_visualizer_machi_engine_actors_schedules.mjs';
import { MachiNobori } from './components_visualizer_machi_engine_actors_nobori.mjs';
import { createBaseClippingPlanes, MachiTraffic } from './components_visualizer_machi_engine_actors_traffic.mjs';
import { machiNeonGroup } from './components_visualizer_machi_engine_beatFx.mjs';
import { resolveMachiFlicker } from './components_visualizer_machi_engine_director.mjs';
import { MachiLightCones } from './components_visualizer_machi_engine_fx_lightCones.mjs';
import { MACHI_REFLECT_LAYER } from './components_visualizer_machi_engine_fx_reflection.mjs';
import { MachiSteam } from './components_visualizer_machi_engine_fx_steam.mjs';
import { bakeStatic, withGeometryCache } from './components_visualizer_machi_engine_geometry_shapes.mjs';
import { seedIndex } from './components_visualizer_machi_engine_palette.mjs';
import { buildKonbiniBase } from './components_visualizer_machi_scenes_konbini_base.mjs';
import { buildKonbiniInterior } from './components_visualizer_machi_scenes_konbini_interior.mjs';
import { buildKonbiniDoorEvents, resolveKonbiniDoorOpenness } from './components_visualizer_machi_scenes_konbini_konbiniDoor.mjs';
import { KonbiniLights } from './components_visualizer_machi_scenes_konbini_konbiniLights.mjs';
import { resolveKonbiniVariation } from './components_visualizer_machi_scenes_konbini_konbiniSeed.mjs';
import { KonbiniSigns } from './components_visualizer_machi_scenes_konbini_konbiniSigns.mjs';
import { BASE, BOARD, FASCIA, KONBINI_VIEW, LEVEL, PROPS, ROAD, STORE } from './components_visualizer_machi_scenes_konbini_layout.mjs';
import { buildKonbiniProps, buildKonbiniSongProps } from './components_visualizer_machi_scenes_konbini_props.mjs';
import { buildKonbiniStore } from './components_visualizer_machi_scenes_konbini_store.mjs';
const KONBINI_ART = {
    wall: '#cfc9bd',
    trim: '#7f8898',
    roof: '#3a404d',
    frame: '#272c35',
    interiorFloor: '#d6d0c3',
    interiorWall: '#ece6d9',
    shelf: '#c6ccd4',
    counter: '#e6dfcf',
    fridgeBody: '#d3d8de',
    acUnit: '#d4d6d0',
    mirrorPole: '#e5702a',
    spillLight: '#ffcf92'
};
const BIKE_COLORS = [
    '#c8423a',
    '#2f6db0',
    '#e7c64a',
    '#3f8f5a',
    '#e9e6dc',
    '#2a2d34'
];
const UMBRELLA_COLORS = [
    '#e8ecf2',
    '#2f6db0',
    '#d24d6e',
    '#3e4655',
    '#f0b23e'
];
const resolveKonbiniArt = (_theme, seed, base)=>({
        ...KONBINI_ART,
        spillLight: mixHexColors(KONBINI_ART.spillLight, base.interiorLight, 0.5),
        bike: BIKE_COLORS[seedIndex(seed, 'bike', BIKE_COLORS.length)],
        umbrella: UMBRELLA_COLORS[seedIndex(seed, 'umbrella', UMBRELLA_COLORS.length)]
    });
const DOOR_SHADOW_STEP = 0.06;
const KONBINI_GLOWS = {
    ceilingLight: {
        key: 'interiorLight',
        level: 2.4
    },
    fridgeGlow: {
        key: 'vendingLight',
        level: 1.5
    },
    vendingGlow: {
        key: 'vendingLight',
        level: 1.7
    },
    lampHead: {
        key: 'streetLight',
        level: 3.2
    },
    warmWindow: {
        key: 'interiorLight',
        level: 0.42
    },
    snackCase: {
        key: 'spillLight',
        level: 1.6
    },
    screen: {
        key: 'led',
        level: 1.3
    },
    redLamp: {
        key: 'brand0',
        level: 1.0
    },
    neonRim: {
        key: 'neon',
        level: 1.4
    }
};
const LANE_REACH = 8;
const KONBINI_LANES = [
    {
        from: [
            -LANE_REACH,
            ROAD.inner + 0.92
        ],
        to: [
            LANE_REACH,
            ROAD.inner + 0.92
        ]
    },
    {
        from: [
            LANE_REACH,
            ROAD.outer - 1.12
        ],
        to: [
            -LANE_REACH,
            ROAD.outer - 1.12
        ]
    },
    {
        from: [
            ROAD.inner + 0.92,
            LANE_REACH
        ],
        to: [
            ROAD.inner + 0.92,
            -LANE_REACH
        ]
    },
    {
        from: [
            ROAD.outer - 1.12,
            -LANE_REACH
        ],
        to: [
            ROAD.outer - 1.12,
            LANE_REACH
        ]
    }
];
const framingPoints = ()=>{
    const h = BASE.half;
    const points = [];
    [
        -h,
        h
    ].forEach((x)=>[
            -h,
            h
        ].forEach((z)=>{
            points.push(new THREE.Vector3(x, 0, z));
            if (x !== z || x < 0) points.push(new THREE.Vector3(x, -BASE.depth, z));
        }));
    const boardTop = BOARD.y0 + BOARD.faceHeight + 0.6;
    const r = BOARD.faceWidth / Math.sqrt(3);
    for(let k = 0; k < 3; k += 1){
        const a = BOARD.azimuth + Math.PI / 3 + k * 2 * Math.PI / 3;
        points.push(new THREE.Vector3(BOARD.cx + Math.sin(a) * r, boardTop, BOARD.cz + Math.cos(a) * r));
    }
    points.push(new THREE.Vector3(PROPS.pylon.x, PROPS.pylon.height + 0.3, PROPS.pylon.z));
    points.push(new THREE.Vector3(STORE.x0, STORE.parapetTop, STORE.z0));
    return points;
};
const konbiniDrips = ()=>{
    const drips = [];
    const frontZ = STORE.z1 + FASCIA.depth + 0.07;
    const rightX = STORE.x1 + FASCIA.depth + 0.07;
    for(let x = STORE.x0 + 0.3; x < STORE.x1; x += 0.42){
        drips.push({
            x: x + (Math.random() - 0.5) * 0.12,
            z: frontZ,
            from: FASCIA.y0 - 0.02,
            to: LEVEL.lot,
            period: 1.1 + Math.random() * 1.8,
            phase: Math.random()
        });
    }
    for(let z = STORE.z1; z > STORE.z0 + 0.5; z -= 0.45){
        drips.push({
            x: rightX,
            z: z + (Math.random() - 0.5) * 0.12,
            from: FASCIA.y0 - 0.02,
            to: LEVEL.lot,
            period: 1.1 + Math.random() * 1.8,
            phase: Math.random()
        });
    }
    for(let index = 0; index < 4; index += 1){
        drips.push({
            x: STORE.x0 - 0.12 + (Math.random() - 0.5) * 0.04,
            z: STORE.z1 + 0.06,
            from: LEVEL.lot + 0.08,
            to: LEVEL.lot,
            period: 0.32 + Math.random() * 0.12,
            phase: index / 4
        });
    }
    return drips;
};
const isInside = (object, ancestor)=>{
    for(let node = object; node; node = node.parent)if (node === ancestor) return true;
    return false;
};
class KonbiniScene {
    context;
    root = new THREE.Group();
    framing;
    weather;
    reflectionPlaneY = 0.06;
    surfaces;
    puddles;
    focusPoint = new THREE.Vector3(BOARD.cx + Math.sin(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3)), BOARD.y0 + BOARD.faceHeight / 2, BOARD.cz + Math.cos(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3)));
    world = new THREE.Group();
    songProps;
    productBatches;
    doorPanels;
    fans;
    lights;
    signs;
    traffic;
    nobori;
    lightCones;
    steam;
    glowA;
    glowB;
    variation;
    song;
    doorEvents;
    doorOpenness = 0;
    shadowDoorOpenness = 0;
    constructor(context){
        this.context = context;
        const { materials, blend, geometryCache } = context;
        this.song = context.song;
        const variation = resolveKonbiniVariation(context.song.seed);
        this.variation = variation;
        this.doorEvents = buildKonbiniDoorEvents(context.song.lines, variation);
        materials.defineGlows(KONBINI_GLOWS);
        this.root.name = 'Konbini';
        const { base, interior, store, props, songProps } = withGeometryCache(geometryCache, ()=>{
            const builtInterior = buildKonbiniInterior(materials, variation.shelfSeed);
            return {
                base: buildKonbiniBase(materials),
                interior: builtInterior,
                store: buildKonbiniStore(materials, builtInterior.group),
                props: buildKonbiniProps(materials),
                songProps: buildKonbiniSongProps(materials, variation)
            };
        });
        this.productBatches = [
            ...interior.productBatches,
            ...props.productBatches
        ];
        this.doorPanels = store.doorPanels;
        this.fans = props.fans;
        this.world.name = 'Konbini/world';
        this.world.add(base.group, store.group, props.group, songProps);
        this.world.traverse((object)=>{
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('machi:glow');
            const isStoreBody = !object.material.transparent && object.parent !== null && isInside(object, store.group);
            if (isGlow || isStoreBody) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.surfaces = {
            road: [
                base.roadSurface
            ],
            lot: base.lotSurfaces
        };
        this.puddles = {
            offset: variation.puddleOffset,
            amount: variation.puddleAmount
        };
        bakeStatic(this.world);
        this.songProps = songProps;
        this.lights = new KonbiniLights(blend, materials, props.streetLampHead);
        this.signs = new KonbiniSigns(materials, blend, {
            boardFaces: store.boardFaces,
            fasciaFaces: store.fasciaFaces,
            pylonFaces: props.pylonFaces,
            aFrameFaces: props.aFrameFaces,
            boardLid: store.boardLid
        });
        this.signs.group.traverse((object)=>{
            if (object instanceof THREE.Mesh && !object.name.startsWith('Poster') && !object.name.startsWith('AFrame') && object.name !== 'Board/roofLogo') object.layers.enable(MACHI_REFLECT_LAYER);
        });
        const clipping = createBaseClippingPlanes(BASE.half);
        this.traffic = withGeometryCache(geometryCache, ()=>new MachiTraffic(materials, blend, clipping, KONBINI_LANES, LEVEL.road));
        this.nobori = new MachiNobori(materials, [
            -3.25,
            -2.5,
            -1.78
        ].map((x)=>({
                x,
                y: LEVEL.lot,
                z: 1.9,
                rotationY: 0.35
            })));
        const lamp = props.streetLampHead;
        this.lightCones = new MachiLightCones(materials, blend, [
            {
                apex: lamp,
                target: new THREE.Vector3(lamp.x - 0.2, LEVEL.road, lamp.z),
                radius: 1.65,
                gain: 1
            }
        ]);
        this.steam = new MachiSteam(materials, blend, [
            {
                position: new THREE.Vector3(-2.4, LEVEL.road + 0.02, (ROAD.inner + ROAD.outer) / 2 + 0.3),
                puffs: 7,
                period: 4.4,
                size: 1
            },
            {
                position: new THREE.Vector3(PROPS.roofAc[0].x - 0.12, STORE.roofTop + 0.68, PROPS.roofAc[0].z + 0.2),
                puffs: 5,
                period: 3.3,
                size: 0.6
            }
        ]);
        this.root.add(this.world, this.lights.group, this.signs.group, this.traffic.group, this.nobori.group, this.lightCones.mesh, this.steam.mesh);
        const boardFront = new THREE.Vector3(Math.sin(BOARD.azimuth), 0, Math.cos(BOARD.azimuth)).multiplyScalar(BOARD.faceWidth / (2 * Math.sqrt(3)) + 0.8);
        this.weather = {
            half: BASE.half,
            groundY: LEVEL.lot * 0.5,
            roofs: [
                {
                    x0: STORE.x0 - STORE.overhang,
                    z0: STORE.z0 - STORE.overhang,
                    x1: STORE.x1 + STORE.overhang,
                    z1: STORE.z1 + STORE.overhang,
                    y: STORE.roofTop
                }
            ],
            drips: konbiniDrips(),
            glints: [
                {
                    position: new THREE.Vector3(lamp.x - 0.2, 2.4, lamp.z),
                    radius: 1.7
                },
                {
                    position: new THREE.Vector3((STORE.frontPillarEnd + STORE.x1) / 2, 1.5, STORE.z1 + 0.9),
                    radius: 2.0
                },
                {
                    position: new THREE.Vector3(BOARD.cx + boardFront.x, BOARD.y0 + BOARD.faceHeight * 0.55, BOARD.cz + boardFront.z),
                    radius: 2.1
                }
            ],
            windYaw: variation.windYaw,
            windSlant: variation.windSlant
        };
        this.framing = {
            points: framingPoints(),
            view: {
                ...KONBINI_VIEW
            }
        };
        this.glowA = new THREE.Vector4((STORE.frontPillarEnd + STORE.x1) / 2 + 0.6, 0, STORE.z1 + 0.9, 3.4);
        this.glowB = new THREE.Vector4(lamp.x, 0, lamp.z, 2.3);
        this.syncColors();
        context.invalidateShadows();
    }
    setContent(content) {
        this.signs.setContent(content);
        const icons = content.icons;
        const { palette } = content;
        this.nobori.paint({
            font: content.font,
            fallbacks: content.fallbacks,
            faces: [
                {
                    background: palette.brand[0],
                    ink: '#ffffff',
                    text: content.song.title || content.song.album || '町景'
                },
                {
                    background: palette.brand[2],
                    ink: '#ffffff',
                    text: (content.theme.provider === 'AI' ? content.theme.name : '') || '新発売',
                    icon: icons[0]
                },
                {
                    background: palette.brand[1],
                    ink: palette.signText,
                    text: 'おでん'
                }
            ]
        });
    }
    swapSong(song, content) {
        const seedChanged = song.seed !== this.song.seed;
        this.song = song;
        this.variation = resolveKonbiniVariation(song.seed);
        if (seedChanged) this.rebuildSongProps();
        this.doorEvents = buildKonbiniDoorEvents(song.lines, this.variation);
        this.setContent(content);
    }
    rebuildSongProps() {
        const shared = new Set(this.context.geometryCache.values());
        this.songProps.removeFromParent();
        this.songProps.traverse((object)=>{
            if (object instanceof THREE.Mesh && !shared.has(object.geometry)) object.geometry.dispose();
        });
        const holder = new THREE.Group();
        const next = withGeometryCache(this.context.geometryCache, ()=>buildKonbiniSongProps(this.context.materials, this.variation));
        holder.add(next);
        bakeStatic(holder);
        next.removeFromParent();
        this.world.add(next);
        this.songProps = next;
        this.context.invalidateShadows();
    }
    direct(frame) {
        const { songTime, ambientTime, chorus, staticMode } = frame;
        if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText);
        else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText);
        const { environment, look } = frame;
        const streetFlicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 3.1, `${frame.seed}:street`, 0.45);
        const street = look.streetLamps * (0.75 + 0.25 * streetFlicker);
        const openness = resolveKonbiniDoorOpenness(this.doorEvents, songTime, this.variation, this.song.isInstrumental || frame.lines.length === 0);
        if (Math.abs(openness - this.doorOpenness) > 1e-4) {
            this.doorOpenness = openness;
            const settled = openness === 0 || openness === 1;
            if (Math.abs(openness - this.shadowDoorOpenness) >= DOOR_SHADOW_STEP || settled && openness !== this.shadowDoorOpenness) {
                this.shadowDoorOpenness = openness;
                this.context.invalidateShadows();
            }
        }
        const { beat } = frame;
        const interiorLevel = (1 + 0.1 * chorus + 0.06 * this.doorOpenness) * look.artificial * beat.warm;
        this.lights.setLevels({
            interior: interiorLevel,
            street,
            pools: (1 - 0.85 * environment.daylight) * (1 + beat.thump)
        });
        this.context.materials.setGlowLevel('neonRim', (0.75 + 0.25 * frame.flicker) * (1 + 0.4 * chorus) * look.artificial * machiNeonGroup(beat, 1));
        this.context.materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps);
        this.traffic.group.visible = !staticMode;
        this.traffic.update(ambientTime, frame.seed, frame.trafficChance);
        this.nobori.update(ambientTime, 0.35 + 0.65 * Math.min(1, frame.rain));
        this.lightCones.update(ambientTime, street * (1 - 0.6 * environment.daylight));
        this.steam.update(ambientTime, frame.atmosphere.wind);
        const atmosphere = frame.atmosphere;
        atmosphere.glowA.copy(this.glowA);
        atmosphere.glowB.copy(this.glowB);
        const night = 1 - 0.85 * environment.daylight;
        atmosphere.glowColorA.copy(this.context.blend.get('interiorLight')).multiplyScalar(0.55 * interiorLevel * night);
        atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.42 * street * night);
        this.signs.update({
            songTime,
            ambientTime,
            delta: frame.delta,
            staticMode,
            chorus,
            audio: frame.audio,
            flicker: frame.flicker,
            beat
        });
        this.fans.forEach((fan, index)=>{
            fan.rotation.z = -ambientTime * (this.variation.fanSpeed + index * 0.37) * Math.PI * 2;
        });
        this.doorPanels.forEach((panel)=>{
            panel.object.position.x = panel.closedX + panel.direction * 0.86 * this.doorOpenness;
        });
    }
    syncColors() {
        this.context.materials.syncColors();
        this.lights.sync();
        this.traffic.syncColors();
        this.lightCones.syncColors();
        this.steam.syncColors();
        const color = new THREE.Color();
        this.productBatches.forEach((batch)=>{
            for(let index = 0; index < batch.colorIndex.length; index += 1){
                color.copy(this.context.blend.get(`product${batch.colorIndex[index]}`)).multiplyScalar(batch.shade[index]);
                batch.mesh.setColorAt(index, color);
            }
            if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
        });
    }
    get busy() {
        return this.signs.busy;
    }
    nextCar(from, seed, chance) {
        for(let t = from; t < from + 120; t += 0.04){
            const car = resolveMachiCar(t, seed, KONBINI_LANES, chance);
            if (car && Math.abs(car.distance - LANE_REACH) < 0.3) return t;
        }
        return null;
    }
    dispose() {
        const geometries = new Set(this.context.geometryCache.values());
        this.root.traverse((object)=>{
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry);
        });
        geometries.forEach((geometry)=>geometry.dispose());
        this.lights.dispose();
        this.signs.dispose();
        this.traffic.dispose();
        this.nobori.dispose();
        this.lightCones.dispose();
        this.steam.dispose();
        this.context.materials.dispose();
        this.root.removeFromParent();
    }
}
export const KONBINI_SCENE = {
    resolveArt: resolveKonbiniArt,
    create: (context)=>new KonbiniScene(context)
};
