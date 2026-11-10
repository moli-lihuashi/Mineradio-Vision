/* 移植自 Folia components/visualizer/machi/scenes/konbini/layout.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const DEG = Math.PI / 180;
export const BASE = {
    half: 6,
    depth: 0.6,
    radius: 0.12
};
export const LEVEL = {
    road: 0,
    lot: 0.12,
    floor: 0.16
};
export const ROAD = {
    inner: 2.2,
    outer: 5.5,
    curbWidth: 0.16,
    edgeLineInset: 0.24
};
export const STORE = {
    x0: -5.4,
    x1: 0.8,
    z0: -5.4,
    z1: 0.4,
    wall: 0.18,
    wallHeight: 3.2,
    roofTop: 3.42,
    parapetTop: 3.62,
    overhang: 0.12,
    rightGlassEnd: -2.6,
    frontPillarEnd: -4.6,
    glassBottom: 0.24,
    glassTop: 2.5
};
export const DOOR = {
    x0: -1.3,
    x1: 0.5,
    height: 2.2,
    panelWidth: 0.92,
    slide: 0.86
};
export const FASCIA = {
    y0: 2.6,
    y1: 3.28,
    depth: 0.16
};
export const BOARD = {
    cx: -2.2,
    cz: -2.65,
    faceWidth: 5.6,
    faceHeight: 2.3,
    y0: 4.0,
    azimuth: 45 * DEG
};
export const KONBINI_VIEW = {
    azimuth: 45 * DEG,
    elevation: 31 * DEG,
    zoom: 1.58
};
export const PROPS = {
    utilityPole: {
        x: -5.3,
        z: 1.96,
        height: 7.6
    },
    streetLamp: {
        x: 5.74,
        z: -1.2,
        height: 5.2,
        arm: 1.3
    },
    pylon: {
        x: 1.62,
        z: -5.4,
        height: 4.6
    },
    curveMirror: {
        x: -1.2,
        z: 5.74,
        height: 2.7
    },
    stopSign: {
        x: 1.95,
        z: 5.74,
        height: 2.4
    },
    vending: {
        x: 0.82,
        z: [
            -3.25,
            -4.3
        ],
        width: 1.0,
        depth: 0.74,
        height: 1.83
    },
    bikeSlots: [
        {
            x: -4.5,
            z: 1.32
        },
        {
            x: -2.85,
            z: 1.36
        }
    ],
    trash: {
        x: -3.55,
        z: 0.68
    },
    umbrellaStand: {
        x: -1.62,
        z: 0.68
    },
    aFrame: {
        x: 0.95,
        z: 1.15
    },
    groundAc: {
        x: -5.7,
        z: [
            -2.0,
            -3.1
        ]
    },
    roofAc: [
        {
            x: -0.1,
            z: -4.75
        },
        {
            x: -4.85,
            z: -0.35
        }
    ]
};
export const groundHeightAt = (x, z)=>{
    if (x >= STORE.x0 - STORE.overhang && x <= STORE.x1 + STORE.overhang && z >= STORE.z0 - STORE.overhang && z <= STORE.z1 + STORE.overhang) {
        return STORE.roofTop;
    }
    const onRoad = x > ROAD.inner && x < ROAD.outer || z > ROAD.inner && z < ROAD.outer;
    return onRoad ? LEVEL.road : LEVEL.lot;
};
