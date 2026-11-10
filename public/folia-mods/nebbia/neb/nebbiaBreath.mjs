/* 移植自 Folia「雾笺」 nebbiaBreath.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
import { clamp, NEBBIA_FIXED, smooth } from './nebbiaConstants.mjs';
import { lineRect } from './nebbiaScene.mjs';
import { createVisualizerRng } from './visualizerSeedHash.mjs';
const BREATH_SCALE = 0.25;
export const buildBreath = (line, idx)=>{
    const rnd = createVisualizerRng(idx * 6151 + 29 >>> 0);
    const { x0, x1, y0, y1, S } = lineRect(line);
    if (!Number.isFinite(x0)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + S * 0.3, ry = (y1 - y0) / 2 + S * 0.3;
    const lobes = [
        {
            x: cx,
            y: cy,
            rx: rx * 0.95,
            ry: ry * 0.95
        }
    ];
    const n = 5 + Math.floor(rnd() * 2), r0 = Math.min(rx, ry);
    for(let k = 0; k < n; k += 1){
        const a = (k + rnd() * 0.6) / n * Math.PI * 2, r = r0 * (0.45 + rnd() * 0.25);
        lobes.push({
            x: cx + Math.cos(a) * rx * 0.6,
            y: cy + Math.sin(a) * ry * 0.6,
            rx: r,
            ry: r
        });
    }
    return {
        lobes,
        cx,
        cy,
        ry
    };
};
const samePuffs = (a, b)=>a.length === b.length && a.every((p, i)=>p.b === b[i].b && p.c0 === b[i].c0 && p.g0 === b[i].g0 && p.b0 === b[i].b0 && p.u === b[i].u);
export class NebbiaBreathMask {
    canvas = document.createElement('canvas');
    ctx;
    active = false;
    version = 0;
    puffs = [];
    drawn = [];
    constructor(){
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Nebbia: no 2D context for the breath mask');
        this.ctx = ctx;
    }
    resize(W, H) {
        this.canvas.width = Math.max(1, Math.round(W * BREATH_SCALE));
        this.canvas.height = Math.max(1, Math.round(H * BREATH_SCALE));
        this.drawn = [];
        this.version += 1;
    }
    begin() {
        this.puffs = [];
    }
    drawLine(line, idx, T, t0, until, spread, melt) {
        const { breathFade } = NEBBIA_FIXED;
        if (T < t0) return;
        const s = 1 - smooth(clamp((T - Math.max(until, t0 + spread)) / breathFade));
        if (s <= 0.002) return;
        if (line.breath === undefined) line.breath = buildBreath(line, idx);
        const b = line.breath;
        if (!b) return;
        const u = clamp((T - t0) / spread);
        const g0 = Math.round(255 * smooth(clamp(u * 1.4)));
        const b0 = melt ? Math.round(255 * smooth(clamp(u * 2.5)) * (1 - smooth(clamp((u - 0.8) / 0.2)))) : 0;
        this.puffs.push({
            b,
            c0: Math.round(255 * s),
            g0,
            b0,
            u
        });
    }
    end() {
        const { puffs } = this;
        this.active = puffs.length > 0;
        if (samePuffs(puffs, this.drawn)) return;
        const { ctx } = this;
        if (this.drawn.length) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        for (const p of puffs)this.paint(p);
        this.drawn = puffs;
        this.version += 1;
    }
    paint({ b, c0, g0, b0, u }) {
        const e = 1 - (1 - u) ** 3;
        const kx = 0.7 + 0.3 * e, ky = 0.08 + 0.92 * e;
        const { ctx } = this;
        ctx.globalCompositeOperation = 'lighten';
        for (const lb of b.lobes){
            const x = b.cx + (lb.x - b.cx) * kx, y = b.cy + (lb.y - b.cy) * ky;
            ctx.setTransform(BREATH_SCALE * lb.rx * kx, 0, 0, BREATH_SCALE * Math.max(lb.ry * ky, 4), BREATH_SCALE * x, BREATH_SCALE * y);
            const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gr.addColorStop(0, `rgb(${c0},${g0},${b0})`);
            gr.addColorStop(0.45, `rgb(${Math.round(c0 * 0.7)},${g0},${b0})`);
            gr.addColorStop(0.999, `rgb(0,${g0},${b0})`);
            gr.addColorStop(1, 'rgb(0,0,0)');
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
