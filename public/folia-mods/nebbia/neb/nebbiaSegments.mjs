/* 移植自 Folia「雾笺」 nebbiaSegments.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
export const SEGMENT_FLOATS = 6;
export const segDist = (x, y, segs, p)=>{
    const ax = segs[p], ay = segs[p + 1], dx = segs[p + 2] - ax, dy = segs[p + 3] - ay, l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return Math.hypot(x - ax - dx * u, y - ay - dy * u);
};
export class NebbiaSegments {
    data = new Float32Array(SEGMENT_FLOATS * 4096);
    count = 0;
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    k = 1;
    path = [];
    clear() {
        this.count = 0;
        this.path.length = 0;
    }
    setTransform(a, b, c, d, e, f) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        this.f = f;
        this.k = Math.hypot(a, b);
    }
    moveTo(x, y) {
        if (this.path.length) this.path.push(NaN, NaN);
        this.lineTo(x, y);
    }
    lineTo(x, y) {
        this.path.push(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
    }
    stroke(width, v) {
        const p = this.path, w = width * this.k;
        for(let i = 2; i < p.length; i += 2){
            if (Number.isNaN(p[i]) || Number.isNaN(p[i - 2])) continue;
            this.push(p[i - 2], p[i - 1], p[i], p[i + 1], w, v);
        }
        p.length = 0;
    }
    push(x0, y0, x1, y1, w, v) {
        if ((this.count + 1) * SEGMENT_FLOATS > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const o = this.count * SEGMENT_FLOATS, dt = this.data;
        dt[o] = x0;
        dt[o + 1] = y0;
        dt[o + 2] = x1;
        dt[o + 3] = y1;
        dt[o + 4] = w;
        dt[o + 5] = v;
        this.count += 1;
    }
}
