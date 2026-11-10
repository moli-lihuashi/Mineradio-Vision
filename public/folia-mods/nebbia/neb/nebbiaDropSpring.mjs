/* 移植自 Folia「雾笺」 nebbiaDropSpring.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp } from './nebbiaConstants.mjs';
const RADII = [
    1.5,
    3,
    5,
    8
];
const FREQ = [
    11,
    8,
    5.5,
    3.6
];
const ZETA = 0.18;
const GLASS = 0.35;
const GAIN = 3;
const PIN_R = 2.5, FREE_R = 6;
const STEP = 1 / 480;
export class NebbiaDropSpring {
    u = RADII.map(()=>[
            0,
            0
        ]);
    v = RADII.map(()=>[
            0,
            0
        ]);
    last = -1;
    step(now, frozen, shakeAt) {
        const from = this.last;
        this.last = now;
        if (frozen || from < 0 || now <= from) return;
        let t = Math.max(from, now - 0.1);
        while(t < now){
            const h = Math.min(STEP, now - t);
            const g0 = shakeAt(t - STEP), g1 = shakeAt(t), g2 = shakeAt(t + STEP);
            for(let axis = 0; axis < 2; axis += 1){
                const acc = -GAIN * GLASS * (g2[axis] - 2 * g1[axis] + g0[axis]) / (STEP * STEP);
                RADII.forEach((_, i)=>{
                    const w = FREQ[i] * Math.PI * 2;
                    const a = acc - 2 * ZETA * w * this.v[i][axis] - w * w * this.u[i][axis];
                    this.v[i][axis] += a * h;
                    this.u[i][axis] += this.v[i][axis] * h;
                });
            }
            t += h;
        }
    }
    offset(r) {
        let i = 0;
        while(i < RADII.length - 2 && r > RADII[i + 1])i += 1;
        const f = clamp((r - RADII[i]) / (RADII[i + 1] - RADII[i]));
        const free = clamp((r - PIN_R) / (FREE_R - PIN_R));
        const dx = (this.u[i][0] + (this.u[i + 1][0] - this.u[i][0]) * f) * free;
        const dy = (this.u[i][1] + (this.u[i + 1][1] - this.u[i][1]) * f) * free;
        const stretch = clamp((Math.abs(dy) - Math.abs(dx) * 0.5) / Math.max(r, 1) * 0.12, -0.25, 0.35);
        return [
            dx,
            dy,
            stretch
        ];
    }
}
