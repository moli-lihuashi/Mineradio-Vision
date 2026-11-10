/* 移植自 Folia「雾笺」 nebbiaSkeleton.ts — AGPL-3.0, chthollyphile/folia-major (lantudou)。仅类型剥离与 import 改写。 */
const SK = 96;
let canvas = null;
let ctx = null;
const thin = (img)=>{
    const at = (x, y)=>x < 0 || y < 0 || x >= SK || y >= SK ? 0 : img[y * SK + x];
    let changed = true;
    while(changed){
        changed = false;
        for(let pass = 0; pass < 2; pass += 1){
            const del = [];
            for(let y = 0; y < SK; y += 1)for(let x = 0; x < SK; x += 1){
                if (!img[y * SK + x]) continue;
                const n = [
                    at(x, y - 1),
                    at(x + 1, y - 1),
                    at(x + 1, y),
                    at(x + 1, y + 1),
                    at(x, y + 1),
                    at(x - 1, y + 1),
                    at(x - 1, y),
                    at(x - 1, y - 1)
                ];
                const b = n.reduce((s, v)=>s + v, 0);
                if (b < 2 || b > 6) continue;
                let a = 0;
                for(let i = 0; i < 8; i += 1)if (!n[i] && n[(i + 1) % 8]) a += 1;
                if (a !== 1) continue;
                if (pass === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue;
                del.push(y * SK + x);
            }
            for (const i of del)img[i] = 0;
            if (del.length) changed = true;
        }
    }
};
const trace = (img)=>{
    const N = [
        [
            1,
            0
        ],
        [
            0,
            1
        ],
        [
            -1,
            0
        ],
        [
            0,
            -1
        ],
        [
            1,
            1
        ],
        [
            -1,
            1
        ],
        [
            -1,
            -1
        ],
        [
            1,
            -1
        ]
    ];
    const on = (x, y)=>x >= 0 && y >= 0 && x < SK && y < SK && img[y * SK + x] === 1;
    const deg = (x, y)=>N.reduce((s, [dx, dy])=>s + (on(x + dx, y + dy) ? 1 : 0), 0);
    const seen = new Uint8Array(SK * SK);
    const polys = [];
    const walk = (sx, sy)=>{
        let x = sx, y = sy;
        const p = [
            [
                x,
                y
            ]
        ];
        seen[y * SK + x] = 1;
        let dir = null;
        for(;;){
            let best = null, bestScore = -9;
            for (const [dx, dy] of N){
                const nx = x + dx, ny = y + dy;
                if (!on(nx, ny) || seen[ny * SK + nx]) continue;
                const score = dir ? (dx * dir[0] + dy * dir[1]) / Math.hypot(dx, dy) : 0;
                if (score > bestScore) {
                    bestScore = score;
                    best = [
                        nx,
                        ny,
                        dx,
                        dy
                    ];
                }
            }
            if (!best) break;
            [x, y] = best;
            dir = [
                best[2],
                best[3]
            ];
            seen[y * SK + x] = 1;
            p.push([
                x,
                y
            ]);
        }
        if (p.length >= 4) polys.push(p);
        else if (isolated(p)) polys.push(p.length > 1 ? p : [
            p[0],
            [
                p[0][0] + 1,
                p[0][1] + 1
            ]
        ]);
    };
    const isolated = (p)=>p.every(([px, py])=>N.every(([dx, dy])=>!on(px + dx, py + dy) || p.some(([qx, qy])=>qx === px + dx && qy === py + dy)));
    for(let y = 0; y < SK; y += 1)for(let x = 0; x < SK; x += 1)if (img[y * SK + x] && deg(x, y) === 1 && !seen[y * SK + x]) walk(x, y);
    for(let y = 0; y < SK; y += 1)for(let x = 0; x < SK; x += 1)if (img[y * SK + x] && !seen[y * SK + x]) walk(x, y);
    return polys;
};
const rdp = (pts, eps)=>{
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let idx = 0, dmax = 0;
    for(let i = 1; i < pts.length - 1; i += 1){
        const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
        if (d > dmax) {
            dmax = d;
            idx = i;
        }
    }
    return dmax > eps ? [
        ...rdp(pts.slice(0, idx + 1), eps).slice(0, -1),
        ...rdp(pts.slice(idx), eps)
    ] : [
        a,
        b
    ];
};
const chaikin = (input, iterations)=>{
    let pts = input;
    for(let k = 0; k < iterations && pts.length > 2; k += 1){
        const o = [
            pts[0]
        ];
        for(let i = 0; i < pts.length - 1; i += 1){
            const p = pts[i], q = pts[i + 1];
            o.push([
                p[0] * 0.75 + q[0] * 0.25,
                p[1] * 0.75 + q[1] * 0.25
            ], [
                p[0] * 0.25 + q[0] * 0.75,
                p[1] * 0.25 + q[1] * 0.75
            ]);
        }
        o.push(pts[pts.length - 1]);
        pts = o;
    }
    return pts;
};
export const skeletonPolys = (ch, fontFamily, fontWeight)=>{
    if (typeof document === 'undefined') return null;
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = SK;
        ctx = canvas.getContext('2d', {
            willReadFrequently: true
        });
    }
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SK, SK);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fontWeight} ${SK * 0.78}px ${fontFamily}`;
    ctx.fillText(ch, SK / 2, SK * 0.8);
    const data = ctx.getImageData(0, 0, SK, SK).data;
    const img = new Uint8Array(SK * SK);
    for(let i = 0; i < SK * SK; i += 1)img[i] = data[i * 4] > 110 ? 1 : 0;
    thin(img);
    const polys = trace(img).map((p)=>chaikin(rdp(p, 1.2), 2).map(([x, y])=>[
                x / SK,
                y / SK
            ]));
    for (const p of polys)if (p[0][1] + p[0][0] * 0.6 > p[p.length - 1][1] + p[p.length - 1][0] * 0.6) p.reverse();
    const minOf = (p, axis)=>p.reduce((m, q)=>Math.min(m, q[axis]), Infinity);
    polys.sort((a, b)=>(minOf(a, 1) - minOf(b, 1)) * 0.6 + (minOf(a, 0) - minOf(b, 0)));
    return polys.length ? polys : null;
};
