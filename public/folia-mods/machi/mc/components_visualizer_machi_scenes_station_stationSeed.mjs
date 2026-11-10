/* 移植自 Folia components/visualizer/machi/scenes/station/stationSeed.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createVisualizerRng } from './components_visualizer_visualizerSeedHash.mjs';
const STALL_PATTERNS = [
    [
        'taxi',
        'sedan',
        'taxi'
    ],
    [
        'sedan',
        'taxi',
        'taxi'
    ],
    [
        'taxi',
        'taxi',
        'sedan'
    ],
    [
        'taxi',
        'empty',
        'taxi'
    ],
    [
        'sedan',
        'taxi',
        'empty'
    ],
    [
        'empty',
        'taxi',
        'sedan'
    ]
];
export const resolveStationVariation = (seed, colorCount, liveryCount)=>{
    const random = createVisualizerRng(`station:${seed}`);
    const pick = (min, max)=>min + (max - min) * random();
    const stalls = STALL_PATTERNS[Math.floor(random() * STALL_PATTERNS.length)];
    const occupied = stalls.map((kind, index)=>kind === 'sedan' ? index : -1).filter((index)=>index >= 0);
    return {
        stalls,
        carColors: stalls.map(()=>Math.floor(random() * colorCount)),
        pumpColor: Math.floor(random() * colorCount),
        keiColor: Math.floor(random() * colorCount),
        taxiLivery: Math.floor(random() * liveryCount),
        pumpCar: random() < 0.7,
        keiTruck: random() < 0.6,
        hazardStall: occupied.length && random() < 0.75 ? occupied[Math.floor(random() * occupied.length)] : -1,
        windYaw: pick(-0.6, 0.6),
        windSlant: pick(0.06, 0.2),
        puddleOffset: [
            pick(-40, 40),
            pick(-40, 40)
        ],
        puddleAmount: pick(0.45, 0.75)
    };
};
