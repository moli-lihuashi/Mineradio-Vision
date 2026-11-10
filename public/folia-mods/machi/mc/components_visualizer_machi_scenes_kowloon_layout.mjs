/* 移植自 Folia components/visualizer/machi/scenes/kowloon/layout.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const DEG = Math.PI / 180;
export const LEVEL = {
    ground: 0.02,
    floor: 0.06
};
export const FLOORS = {
    ground: 3.0,
    height: 1.0
};
export const BLOCKS = [
    {
        name: 'L0',
        x0: -6,
        x1: -3.0,
        z0: -6,
        z1: -1.8,
        height: 6.9,
        wall: 'wallA'
    },
    {
        name: 'L1',
        x0: -6,
        x1: -3.35,
        z0: -1.8,
        z1: -0.2,
        height: 7.3,
        wall: 'wallB'
    },
    {
        name: 'L2',
        x0: -6,
        x1: -3.6,
        z0: -0.2,
        z1: 1.3,
        height: 6.6,
        wall: 'wallD'
    },
    {
        name: 'L3',
        x0: -6,
        x1: -3.2,
        z0: 1.3,
        z1: 2.9,
        height: 6.2,
        wall: 'wallC'
    },
    {
        name: 'L4',
        x0: -6,
        x1: -3.45,
        z0: 2.9,
        z1: 4.5,
        height: 5.2,
        wall: 'wallE'
    },
    {
        name: 'L5',
        x0: -6,
        x1: -3.75,
        z0: 4.5,
        z1: 6,
        height: 4.0,
        wall: 'wallD'
    },
    {
        name: 'B0',
        x0: -3.0,
        x1: -1.6,
        z0: -6,
        z1: -1.8,
        height: 6.4,
        wall: 'wallE'
    },
    {
        name: 'B0b',
        x0: -1.6,
        x1: -0.3,
        z0: -6,
        z1: -2.05,
        height: 7.0,
        wall: 'wallC'
    },
    {
        name: 'B1',
        x0: -0.3,
        x1: 4.5,
        z0: -6,
        z1: -1.5,
        height: 6.2,
        wall: 'wallA',
        hollow: {
            x0: -0.1,
            x1: 4.3,
            z0: -4.2,
            y1: 2.95
        }
    },
    {
        name: 'B2',
        x0: 4.5,
        x1: 6,
        z0: -6,
        z1: -2.3,
        height: 5.4,
        wall: 'wallB'
    }
];
export const leftFaceAt = (z)=>{
    const block = BLOCKS.find((candidate)=>candidate.name.startsWith('L') && z >= candidate.z0 && z < candidate.z1);
    return block ? block.x1 : -3.4;
};
export const BAR = {
    x0: -0.1,
    x1: 4.3,
    front: -1.5,
    glass: -1.62,
    back: -4.2,
    ceiling: 2.95,
    door: [
        3.3,
        4.2
    ],
    counter: {
        x0: 0.2,
        x1: 3.0,
        z0: -3.4,
        z1: -2.85,
        height: 1.05
    }
};
export const BAR_SIGN = {
    x: 2.1,
    y: 2.68,
    z: -1.38,
    width: 3.9,
    height: 0.46
};
export const TICKER = {
    x: 2.1,
    y: 3.09,
    z: -1.41,
    width: 4.2,
    height: 0.17
};
export const SCREEN = {
    x: 2.1,
    y: 4.22,
    z: -1.38,
    width: 4.2,
    height: 1.8
};
export const HANGING_SIGNS = [
    {
        axis: 'x',
        wall: -3.45,
        tip: -2.65,
        y0: 2.95,
        y1: 4.75,
        at: 3.65,
        vertical: true,
        role: 'artist'
    },
    {
        axis: 'x',
        wall: -3.6,
        tip: -1.35,
        y0: 5.15,
        y1: 5.95,
        at: 0.55,
        vertical: false,
        role: 'shop'
    },
    {
        axis: 'x',
        wall: -3.35,
        tip: -2.67,
        y0: 3.3,
        y1: 5.5,
        at: -0.85,
        vertical: true,
        role: 'shop'
    },
    {
        axis: 'x',
        wall: -3.2,
        tip: -1.45,
        y0: 3.45,
        y1: 4.2,
        at: 2.25,
        vertical: false,
        role: 'shop'
    },
    {
        axis: 'x',
        wall: -3.2,
        tip: -1.95,
        y0: 4.45,
        y1: 5.05,
        at: 1.5,
        vertical: false,
        role: 'shop'
    },
    {
        axis: 'x',
        wall: -3.75,
        tip: -3.1,
        y0: 2.6,
        y1: 3.75,
        at: 5.25,
        vertical: true,
        role: 'shop'
    },
    {
        axis: 'z',
        wall: -2.05,
        tip: -1.3,
        y0: 3.4,
        y1: 5.7,
        at: -0.72,
        vertical: true,
        role: 'shop'
    },
    {
        axis: 'z',
        wall: -1.8,
        tip: -1.25,
        y0: 4.0,
        y1: 5.5,
        at: -2.2,
        vertical: true,
        role: 'shop'
    }
];
export const SIGN_DEPTH = 0.16;
export const ROOF_BILLBOARD = {
    x0: -0.05,
    x1: 2.45,
    z: -2.15,
    y0: 6.6,
    y1: 7.5
};
export const HOLOGRAM = {
    x: 0.9,
    z: 2.3,
    y: 3.0,
    width: 3.0,
    height: 1.1,
    rotationY: 30 * DEG
};
export const STALL = {
    x0: 4.1,
    x1: 5.85,
    z0: 1.3,
    z1: 2.25,
    counter: 1.0,
    back: 2.1,
    canopy: 2.35
};
export const STALL_TABLE = {
    x: 4.85,
    z: 3.25
};
export const POLE = {
    x: 5.55,
    z: -1.15,
    height: 7.0,
    lampArm: 1.25,
    lampY: 5.05
};
export const VENDING = {
    x: 4.95,
    z: -1.95
};
export const KOWLOON_VIEW = {
    azimuth: 30 * DEG,
    elevation: 30 * DEG,
    zoom: 1.55
};
