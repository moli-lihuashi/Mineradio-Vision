/* 移植自 Folia components/visualizer/machi/engine/clock.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const MAX_STEP_SECONDS = 0.1;
export class MachiClock {
    elapsed = 0;
    delta = 0;
    realDelta = 0;
    paused = false;
    timeScale = 1;
    last = -1;
    tick(now) {
        const real = this.last < 0 ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.realDelta = real;
        this.delta = this.paused ? 0 : real * this.timeScale;
        this.elapsed += this.delta;
    }
    resync() {
        this.last = -1;
    }
}
