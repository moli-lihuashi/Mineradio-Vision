/* 移植自 Folia「雾笺」 nebbiaSceneClock.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp } from './nebbiaConstants.mjs';
const SCENE_RESET = 1000;
const SCENE_WRAP = 3600;
export class NebbiaSceneClock {
    time = 0;
    last = 0;
    tick(now, paused) {
        const dt = paused ? 0 : clamp(now - this.last, 0, 0.1);
        this.time = (this.time + dt) % SCENE_WRAP;
        this.last = now;
        return dt;
    }
    songChanged() {
        if (this.time > SCENE_RESET) this.time = 0;
    }
}
