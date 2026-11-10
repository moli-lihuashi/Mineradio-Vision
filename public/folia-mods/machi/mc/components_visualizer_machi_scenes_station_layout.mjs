/* 移植自 Folia components/visualizer/machi/scenes/station/layout.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const DEG = Math.PI / 180;
export const LEVEL = {
    road: 0,
    lot: 0.02,
    apron: 0.1
};
export const ROAD = {
    z0: 2.35,
    z1: 6,
    curb: 0.16,
    lanes: [
        3.36,
        4.99
    ],
    gaps: [
        [
            -1.2,
            0.8
        ],
        [
            1.8,
            3.6
        ]
    ]
};
export const CANOPY = {
    x0: 1.4,
    x1: 5.9,
    z0: -5.6,
    z1: -1.4,
    under: 3.85,
    top: 4.3,
    columns: [
        [
            2.05,
            -2.1
        ],
        [
            5.25,
            -2.1
        ],
        [
            2.05,
            -4.9
        ],
        [
            5.25,
            -4.9
        ]
    ]
};
export const ISLANDS = {
    x0: 2.45,
    x1: 4.85,
    z: [
        -4.35,
        -2.75
    ],
    width: 0.5,
    height: 0.16,
    pumps: [
        3.05,
        4.25
    ]
};
export const APRON = {
    x0: 1.2,
    x1: 6,
    z0: -6,
    z1: 0.4
};
export const TRUCK = {
    rear: -5.85,
    front: 1.1,
    z0: -5.7,
    z1: -3.6,
    deck: 1.0,
    boxTop: 3.4,
    boxFront: -0.7,
    cabBack: -0.55,
    cabTop: 2.75
};
export const TRUCK_SCREEN = {
    x: (TRUCK.rear + TRUCK.boxFront) / 2,
    y: (TRUCK.deck + 0.22 + TRUCK.boxTop - 0.16) / 2,
    z: TRUCK.z1 + 0.03,
    width: TRUCK.boxFront - TRUCK.rear - 0.36,
    height: TRUCK.boxTop - 0.16 - (TRUCK.deck + 0.22)
};
export const STALLS = {
    x: [
        -4.75,
        -2.85,
        -0.95
    ],
    z: -0.3,
    width: 1.9,
    depth: 3.6
};
export const CAR = {
    length: 3.2,
    width: 1.42,
    height: 1.38
};
export const PUMP_CAR = {
    x: 3.65,
    z: -0.95
};
export const KEI_TRUCK = {
    x: 3.1,
    z: 1.1
};
export const APRON_PROPS = {
    airPump: {
        x: 1.6,
        z: -0.75,
        width: 0.36,
        depth: 0.3
    },
    bins: {
        x: 1.6,
        z: [
            -1.2,
            -1.57
        ],
        size: 0.34
    },
    tires: {
        x: 5.6,
        z: -2.9,
        radius: 0.37
    }
};
export const PYLON = {
    x: 5.35,
    z: 1.75,
    height: 4.1,
    width: 1.0
};
export const MOTEL_SIGN = {
    x: -5.25,
    z: 1.85,
    height: 6.4
};
export const LOT_LAMP = {
    x: 0.9,
    z: 1.85,
    height: 5.0,
    arm: 1.2
};
export const STATION_VIEW = {
    azimuth: 25 * DEG,
    elevation: 30 * DEG,
    zoom: 1.48
};
