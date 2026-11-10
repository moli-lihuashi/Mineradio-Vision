/* 移植自 Folia components/visualizer/machi/engine/actors/schedules.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { hashVisualizerSeed, visualizerHash01 } from './components_visualizer_visualizerSeedHash.mjs';
export const MACHI_CAR_SPEED = 6.5;
const CAR_WINDOW = 9.5;
const laneLength = (lane)=>Math.hypot(lane.to[0] - lane.from[0], lane.to[1] - lane.from[1]);
export const resolveMachiCar = (time, seed, lanes, chance = 0.62)=>{
    if (lanes.length === 0) return null;
    const key = hashVisualizerSeed(`car:${seed}`);
    const window = Math.floor(time / CAR_WINDOW);
    for (const index of [
        window,
        window - 1
    ]){
        if (visualizerHash01(key, index, 0x11) > chance) continue;
        const start = index * CAR_WINDOW + visualizerHash01(key, index, 0x22) * (CAR_WINDOW * 0.5);
        const local = time - start;
        const lane = Math.floor(visualizerHash01(key, index, 0x33) * lanes.length);
        if (local < 0 || local > laneLength(lanes[lane]) / MACHI_CAR_SPEED) continue;
        return {
            lane,
            distance: local * MACHI_CAR_SPEED,
            colorIndex: Math.floor(visualizerHash01(key, index, 0x44) * 1000)
        };
    }
    return null;
};
