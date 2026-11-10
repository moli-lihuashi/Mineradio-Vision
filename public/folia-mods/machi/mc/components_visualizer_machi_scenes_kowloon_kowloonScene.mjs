/* 移植自 Folia components/visualizer/machi/scenes/kowloon/kowloonScene.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { mixHexColors } from './utils_themeColorMath.mjs';
import { createVisualizerRng } from './components_visualizer_visualizerSeedHash.mjs';
import { machiNeonGroup } from './components_visualizer_machi_engine_beatFx.mjs';
import { resolveMachiFlicker } from './components_visualizer_machi_engine_director.mjs';
import { MachiLightCones } from './components_visualizer_machi_engine_fx_lightCones.mjs';
import { MACHI_REFLECT_LAYER } from './components_visualizer_machi_engine_fx_reflection.mjs';
import { MachiSteam } from './components_visualizer_machi_engine_fx_steam.mjs';
import { MACHI_BASE } from './components_visualizer_machi_engine_geometry_plinth.mjs';
import { bakeStatic, withGeometryCache } from './components_visualizer_machi_engine_geometry_shapes.mjs';
import { vivid } from './components_visualizer_machi_engine_palette.mjs';
import { buildKowloonBar } from './components_visualizer_machi_scenes_kowloon_bar.mjs';
import { buildKowloonBlocks } from './components_visualizer_machi_scenes_kowloon_blocks.mjs';
import { KowloonLights } from './components_visualizer_machi_scenes_kowloon_kowloonLights.mjs';
import { KowloonSigns } from './components_visualizer_machi_scenes_kowloon_kowloonSigns.mjs';
import { BAR, BAR_SIGN, BLOCKS, HOLOGRAM, KOWLOON_VIEW, LEVEL, SCREEN, STALL, TICKER } from './components_visualizer_machi_scenes_kowloon_layout.mjs';
import { buildKowloonStreet, kowloonFramingPoints, kowloonScreenFront, kowloonWindowAvoid } from './components_visualizer_machi_scenes_kowloon_street.mjs';
const KOWLOON_ART = {
    wallA: '#6b6660',
    wallB: '#7a6e62',
    wallC: '#5d666e',
    wallD: '#857a6b',
    wallE: '#6e6a73',
    slab: '#4c4a47',
    stain: '#3f3a36',
    windowFrame: '#383c43',
    windowDark: '#1c222b',
    cage: '#5a6068',
    rust: '#7a4a33',
    ac: '#c6c4bb',
    acGrille: '#55595e',
    pipe: '#666a70',
    bamboo: '#b9a06a',
    plant: '#4f8a46',
    roofTar: '#3a393b',
    tank: '#557282',
    antenna: '#2b2f35',
    shutter: '#8d9095',
    shutterDark: '#62656a',
    drain: '#1d2026',
    barFrame: '#25222a',
    barFloor: '#2a2426',
    barWall: '#2d2533',
    counter: '#3b2620',
    counterTop: '#6b4a3a',
    chrome: '#aab1b9',
    stool: '#c2384a',
    jukebox: '#8a2f3c',
    signBox: '#1d1a22',
    screenFrame: '#26282d',
    stallGreen: '#2e6a55',
    tarpRed: '#c8423a',
    tarpWhite: '#efe9df',
    table: '#d9d3c5',
    plastic: '#d23a3a',
    stoolBlue: '#2f6fc0',
    crate: '#8a6a45',
    crateBlue: '#2f6fb0',
    scooterA: '#c43c3c',
    scooterB: '#e3dfd2',
    bag: '#22282a',
    gas: '#c9452f',
    holoBase: '#2b2f36',
    neonPink: '#ff4fb0',
    neonCyan: '#3fe8ff',
    neonAmber: '#ffb547',
    shopGlow: '#d6ecff',
    cafeLight: '#ffd2a0',
    cityGlow: '#5a4688',
    pharmacy: '#c9ffe0',
    tube: '#c8f4ff',
    lampCool: '#e2f2ff'
};
const resolveKowloonArt = (_theme, _seed, base)=>({
        ...KOWLOON_ART,
        barBack: vivid(base.brand[0], 0.7, 0.55, 0.66),
        barLight: mixHexColors('#ff9fd0', base.interiorLight, 0.45),
        holo: mixHexColors('#62f2ff', base.led, 0.3)
    });
const KOWLOON_GLOWS = {
    barBacklight: {
        key: 'barBack',
        level: 1.2
    },
    barStrip: {
        key: 'neonCyan',
        level: 1.6
    },
    barWindow: {
        key: 'barLight',
        level: 0.9
    },
    pendant: {
        key: 'interiorLight',
        level: 2.0
    },
    jukebox: {
        key: 'neonAmber',
        level: 1.5
    },
    shopGlow: {
        key: 'shopGlow',
        level: 0.72
    },
    cafe: {
        key: 'cafeLight',
        level: 0.8
    },
    stripPink: {
        key: 'neonPink',
        level: 1.3
    },
    stripCyan: {
        key: 'neonCyan',
        level: 1.3
    },
    pharmacy: {
        key: 'pharmacy',
        level: 0.72
    },
    shopWarm: {
        key: 'interiorLight',
        level: 0.9
    },
    tube: {
        key: 'tube',
        level: 1.5
    },
    stallBulb: {
        key: 'interiorLight',
        level: 2.6
    },
    lampHead: {
        key: 'lampCool',
        level: 3.0
    },
    vending: {
        key: 'vendingLight',
        level: 0.75
    },
    holoLens: {
        key: 'holo',
        level: 2.2
    }
};
const blockOf = (name)=>BLOCKS.find((block)=>block.name === name);
const kowloonRoofs = ()=>{
    const span = (names)=>{
        const blocks = names.map(blockOf);
        return {
            x0: Math.min(...blocks.map((block)=>block.x0)),
            z0: Math.min(...blocks.map((block)=>block.z0)),
            x1: Math.min(...blocks.map((block)=>block.x1)),
            z1: Math.max(...blocks.map((block)=>block.z1)),
            y: Math.min(...blocks.map((block)=>block.height))
        };
    };
    return [
        span([
            'L0',
            'L1',
            'L2'
        ]),
        span([
            'L3',
            'L4',
            'L5'
        ]),
        {
            ...span([
                'B0',
                'B0b'
            ]),
            x0: -3.0,
            x1: -0.3,
            z1: -2.05
        },
        span([
            'B1'
        ])
    ];
};
const smoothNight = (daylight)=>{
    const t = Math.min(1, Math.max(0, (0.65 - daylight) / 0.45));
    return t * t * (3 - 2 * t);
};
class KowloonScene {
    context;
    root = new THREE.Group();
    framing;
    weather;
    reflectionPlaneY = LEVEL.ground;
    surfaces;
    puddles;
    focusPoint = new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z);
    rebuildsForSeed = true;
    world = new THREE.Group();
    lights;
    signs;
    steam;
    lightCones;
    windows;
    glowA;
    glowB;
    constructor(context){
        this.context = context;
        const { materials, blend, geometryCache } = context;
        const seed = context.song.seed;
        const random = createVisualizerRng(`kowloon:${seed}`);
        materials.defineGlows(KOWLOON_GLOWS);
        this.root.name = 'Kowloon';
        const built = withGeometryCache(geometryCache, ()=>{
            const street = buildKowloonStreet(materials, seed);
            return {
                street,
                blocks: buildKowloonBlocks(materials, seed, kowloonWindowAvoid(), [
                    ...street.signBoxes,
                    kowloonScreenFront()
                ], street.footing),
                bar: buildKowloonBar(materials, seed)
            };
        });
        const { street, blocks, bar } = built;
        this.windows = blocks.litWindows;
        this.world.name = 'Kowloon/world';
        this.world.add(street.group, blocks.group, bar.group);
        this.world.traverse((object)=>{
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('machi:glow');
            const isOccluder = object.name === 'Body' || object.name.startsWith('Sign');
            if (isGlow || isOccluder) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.surfaces = {
            road: [],
            lot: [
                street.surface
            ]
        };
        this.puddles = {
            offset: [
                random() * 80 - 40,
                random() * 80 - 40
            ],
            amount: 0.5 + random() * 0.25
        };
        bakeStatic(this.world);
        this.signs = new KowloonSigns(materials, blend, {
            screen: {
                position: new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z),
                rotationY: 0,
                width: SCREEN.width,
                height: SCREEN.height
            },
            ticker: {
                position: new THREE.Vector3(TICKER.x, TICKER.y, TICKER.z),
                rotationY: 0,
                width: TICKER.width,
                height: TICKER.height
            },
            barSign: {
                position: new THREE.Vector3(BAR_SIGN.x, BAR_SIGN.y, BAR_SIGN.z),
                rotationY: 0,
                width: BAR_SIGN.width,
                height: BAR_SIGN.height
            },
            boards: street.signs,
            hologram: {
                base: new THREE.Vector3(HOLOGRAM.x, 0.27, HOLOGRAM.z),
                panel: {
                    position: new THREE.Vector3(HOLOGRAM.x, HOLOGRAM.y, HOLOGRAM.z),
                    rotationY: HOLOGRAM.rotationY,
                    width: HOLOGRAM.width,
                    height: HOLOGRAM.height
                }
            }
        }, seed);
        this.signs.group.traverse((object)=>{
            if (object instanceof THREE.Mesh) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.lights = new KowloonLights(blend, materials, street.lampHead, street.stallBulb);
        this.steam = new MachiSteam(materials, blend, [
            {
                position: street.wok,
                puffs: 5,
                period: 2.6,
                size: 0.45
            },
            {
                position: street.manhole.clone().setY(LEVEL.ground + 0.02),
                puffs: 6,
                period: 4.4,
                size: 0.85
            }
        ]);
        this.lightCones = new MachiLightCones(materials, blend, [
            {
                apex: street.lampHead,
                target: new THREE.Vector3(street.lampHead.x - 0.25, LEVEL.ground, street.lampHead.z + 0.1),
                radius: 1.3,
                gain: 1
            }
        ], 'lampCool');
        this.root.add(this.world, this.signs.group, this.lights.group, this.steam.mesh, this.lightCones.mesh);
        const drips = [
            ...blocks.drips
        ];
        for(let x = STALL.x0; x <= STALL.x1 + 0.1; x += 0.45){
            drips.push({
                x: x + (random() - 0.5) * 0.1,
                z: STALL.z1 + 0.62,
                from: 1.95,
                to: LEVEL.ground,
                period: 1.0 + random() * 1.4,
                phase: random()
            });
        }
        for(let x = BAR_SIGN.x - BAR_SIGN.width / 2; x < BAR_SIGN.x + BAR_SIGN.width / 2; x += 0.6){
            drips.push({
                x: x + random() * 0.2,
                z: BAR.front + 0.12,
                from: BAR_SIGN.y - BAR_SIGN.height / 2 - 0.08,
                to: LEVEL.ground,
                period: 1.3 + random() * 1.8,
                phase: random()
            });
        }
        this.weather = {
            half: MACHI_BASE.half,
            groundY: LEVEL.ground,
            roofs: kowloonRoofs(),
            drips,
            glints: [
                {
                    position: new THREE.Vector3(-2.0, 3.0, 1.0),
                    radius: 2.0
                },
                {
                    position: new THREE.Vector3(SCREEN.x, 1.9, BAR.front + 1.0),
                    radius: 2.0
                },
                {
                    position: new THREE.Vector3(street.lampHead.x - 0.25, 2.6, street.lampHead.z + 0.1),
                    radius: 1.6
                }
            ],
            windYaw: (random() - 0.5) * 1.2,
            windSlant: 0.06 + random() * 0.12
        };
        this.framing = {
            points: kowloonFramingPoints(),
            view: {
                ...KOWLOON_VIEW
            }
        };
        this.glowA = new THREE.Vector4(-2.0, 0, 1.0, 3.4);
        this.glowB = new THREE.Vector4(SCREEN.x, 0, BAR.front + 0.8, 3.0);
        this.syncColors();
        context.invalidateShadows();
    }
    setContent(content) {
        this.signs.setContent(content);
    }
    swapSong(_song, content) {
        this.setContent(content);
    }
    direct(frame) {
        const { songTime, ambientTime, chorus, staticMode, environment, look } = frame;
        if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText);
        else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText);
        const daylight = environment.daylight;
        const night = 1 - daylight;
        const lampFlicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 4.2, `${frame.seed}:lamp`, 0.45);
        const tubeFlicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 0.6, `${frame.seed}:tube`, 2.2);
        const lamp = look.streetLamps * (0.75 + 0.25 * lampFlicker);
        const { beat } = frame;
        const artificial = look.artificial * beat.warm;
        const neon = (0.25 + 0.75 * night) * (0.85 + 0.15 * frame.flicker);
        this.lights.setLevels({
            bar: artificial * (1 + 0.1 * chorus),
            screen: (1 - 0.8 * daylight) * (1 + 0.2 * chorus),
            neon: neon * beat.neon,
            holo: 1 - 0.85 * daylight,
            stall: 0.3 + 0.7 * look.streetLamps,
            lamp,
            pools: (1 - 0.85 * daylight) * (1 + beat.thump)
        });
        const materials = this.context.materials;
        materials.setGlowLevel('barBacklight', artificial * (1 + 0.15 * chorus));
        materials.setGlowLevel('barStrip', artificial);
        materials.setGlowLevel('barWindow', artificial);
        materials.setGlowLevel('pendant', artificial);
        materials.setGlowLevel('jukebox', artificial * (0.65 + 0.6 * frame.audio));
        materials.setGlowLevel('shopGlow', artificial);
        materials.setGlowLevel('cafe', artificial);
        materials.setGlowLevel('stripPink', neon * machiNeonGroup(beat, 1));
        materials.setGlowLevel('stripCyan', neon * machiNeonGroup(beat, 2));
        materials.setGlowLevel('pharmacy', artificial);
        materials.setGlowLevel('shopWarm', artificial);
        materials.setGlowLevel('tube', artificial * tubeFlicker * tubeFlicker);
        materials.setGlowLevel('stallBulb', 0.4 + 0.6 * look.streetLamps);
        materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps);
        materials.setGlowLevel('vending', artificial);
        materials.setGlowLevel('holoLens', 0.4 + 0.6 * night);
        this.windows.material.color.setScalar((0.28 + 0.6 * smoothNight(daylight)) * beat.warm);
        this.signs.update({
            songTime,
            ambientTime,
            delta: frame.delta,
            staticMode,
            chorus,
            audio: frame.audio,
            flicker: frame.flicker,
            artificial: look.artificial,
            daylight,
            beat
        });
        this.steam.update(ambientTime, frame.atmosphere.wind);
        this.lightCones.update(ambientTime, lamp * (1 - 0.6 * daylight));
        const atmosphere = frame.atmosphere;
        const glow = 1 - 0.85 * daylight;
        atmosphere.glowA.copy(this.glowA);
        atmosphere.glowB.copy(this.glowB);
        atmosphere.glowColorA.copy(this.context.blend.get('neonPink')).multiplyScalar(0.42 * neon * beat.neon * glow);
        atmosphere.glowColorB.copy(this.context.blend.get('barLight')).multiplyScalar(0.36 * artificial * glow);
    }
    syncColors() {
        this.context.materials.syncColors();
        this.lights.sync();
        this.steam.syncColors();
        this.lightCones.syncColors();
    }
    get busy() {
        return this.signs.busy;
    }
    dispose() {
        const geometries = new Set(this.context.geometryCache.values());
        this.world.traverse((object)=>{
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry);
        });
        geometries.forEach((geometry)=>geometry.dispose());
        this.signs.dispose();
        this.lights.dispose();
        this.steam.dispose();
        this.lightCones.dispose();
        this.context.materials.dispose();
        this.root.removeFromParent();
    }
}
export const KOWLOON_SCENE = {
    resolveArt: resolveKowloonArt,
    create: (context)=>new KowloonScene(context)
};
