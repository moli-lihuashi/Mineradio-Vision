/* 移植自 Folia components/visualizer/hanabi/mg/burstPlan.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { clamp01, EMBER, GOLD, hash01, hashString, lerp, mixColor, TAU, WHITE } from './components_visualizer_hanabi_mg_mgMath.mjs';
const GOLDEN = 0.6180339887498949;
const GOLDEN_ANGLE = 2.399963229728653;
const sparkColor = (palette, colors, i)=>{
    const sparks = palette.sparks.length > 0 ? palette.sparks : [
        WHITE
    ];
    const n = sparks.length;
    const index = colors.length > 0 ? colors[(i % colors.length + colors.length) % colors.length] : i;
    return sparks[(Math.round(index) % n + n) % n];
};
export const planBurst = (event, palette, env)=>{
    const { spec } = event;
    const kind = spec.kind;
    const rng = createRng(`${event.seed}:${kind}`);
    const R = Math.max(4, spec.radius * env.unit * (event.scale || 1));
    const D = Math.max(0.2, spec.duration);
    const at = event.at;
    const n = Math.max(0, Math.round(spec.count * Math.max(0, env.amount)));
    const trailK = clamp01(spec.trail);
    const twinkleK = clamp01(spec.twinkle);
    const squash = event.squash ?? 1;
    const rotation = event.rotation ?? 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const c = (i)=>sparkColor(palette, spec.colors, i);
    const stars = [];
    const flashes = [];
    const minSize = Math.max(1.4, env.unit * 0.0022);
    const add = (input)=>{
        const delay = input.start ?? 0;
        const life = Math.min(input.life, D - delay - 0.02);
        if (life <= 0.05) return;
        stars.push({
            x0: event.x + (input.x0 ?? 0),
            y0: event.y + (input.y0 ?? 0),
            vx: input.vx,
            vy: input.vy,
            drag: input.drag,
            fall: input.fall ?? 0,
            start: at + delay,
            life,
            size: Math.max(minSize, input.size),
            color: input.color,
            endColor: input.endColor ?? input.color,
            shift: input.shift ?? 1,
            trailColor: input.trailColor ?? mixColor(input.color, EMBER, 0.3),
            trail: input.trail ?? 0,
            segments: input.trail && input.trail > 0 ? Math.max(1, input.segments ?? 3) : 0,
            fadeTail: input.fadeTail ?? 0.3,
            strobe: input.strobe ?? 0,
            strobeFrom: input.strobeFrom ?? 0,
            twinkle: input.twinkle ?? 0,
            glitter: input.glitter ?? 0,
            spiral: input.spiral ?? 0,
            spin: input.spin ?? 0,
            phase: input.phase ?? rng() * TAU,
            depth: input.depth ?? 1,
            rank: 0,
            tex: input.tex ?? 0
        });
    };
    const flash = (x, y, delay, size, color, life = 0.32)=>{
        if (delay >= D) return;
        flashes.push({
            x: event.x + x,
            y: event.y + y,
            at: at + delay,
            size,
            color: mixColor(color, WHITE, 0.7),
            life: Math.min(life, D - delay)
        });
    };
    const tiltA = rng() * TAU;
    const tiltCos = Math.cos(tiltA);
    const tiltSin = Math.sin(tiltA);
    const sphere = (i, count, jitter = 0.25)=>{
        const z = 1 - 2 * (i + 0.5) / count;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        const phi = i * GOLDEN_ANGLE + (rng() - 0.5) * jitter;
        const x = r * Math.cos(phi);
        const y0 = r * Math.sin(phi);
        return [
            x,
            y0 * tiltCos - z * tiltSin,
            y0 * tiltSin + z * tiltCos
        ];
    };
    const planar = (x, y)=>{
        const sy = y * squash;
        return [
            x * cosR - sy * sinR,
            x * sinR + sy * cosR
        ];
    };
    const depthOf = (z)=>0.62 + 0.38 * (z + 1) / 2;
    const life = (low, high)=>D * lerp(low, high, rng());
    const c0 = c(0);
    const c1 = c(1);
    const c2 = c(2);
    switch(kind){
        case 'kiku':
            {
                const core = Math.round(n * 0.2);
                const main = n - core;
                const k = 3.2;
                for(let i = 0; i < main; i += 1){
                    const [dx, dy, dz] = sphere(i, main);
                    const speed = R * k * (0.94 + rng() * 0.12);
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.3,
                        life: life(0.78, 0.98),
                        size: R * 0.02,
                        color: c0,
                        endColor: mixColor(c0, WHITE, 0.65),
                        shift: 0.7,
                        trail: 0.1 + trailK * 0.38,
                        segments: 3,
                        trailColor: mixColor(c0, EMBER, 0.3),
                        twinkle: twinkleK,
                        depth: depthOf(dz)
                    });
                }
                for(let i = 0; i < core; i += 1){
                    const [dx, dy, dz] = sphere(i, core);
                    const speed = R * 3.6 * 0.42 * (0.95 + rng() * 0.1);
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: 3.6,
                        fall: R * 0.2,
                        life: life(0.4, 0.55),
                        size: R * 0.017,
                        color: c1,
                        trail: 0.04 + trailK * 0.08,
                        segments: 1,
                        fadeTail: 0.2,
                        depth: depthOf(dz)
                    });
                }
                flash(0, 0, 0, R * 1.1, c0, 0.36);
                break;
            }
        case 'botan':
            {
                const core = Math.round(n * 0.22);
                const main = n - core;
                const k = 3.6;
                for(let i = 0; i < main; i += 1){
                    const [dx, dy, dz] = sphere(i, main, 0.12);
                    const speed = R * k * (0.97 + rng() * 0.06);
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.24,
                        life: life(0.85, 0.97),
                        size: R * 0.034,
                        color: c0,
                        endColor: c1,
                        shift: 0.48,
                        fadeTail: 0.12,
                        twinkle: twinkleK * 0.6,
                        depth: depthOf(dz)
                    });
                }
                for(let i = 0; i < core; i += 1){
                    const [dx, dy, dz] = sphere(i, core, 0.12);
                    const speed = R * k * 0.5;
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.2,
                        life: life(0.6, 0.72),
                        size: R * 0.03,
                        color: c2,
                        endColor: mixColor(c2, WHITE, 0.5),
                        shift: 0.55,
                        fadeTail: 0.12,
                        depth: depthOf(dz)
                    });
                }
                flash(0, 0, 0, R * 1.2, c0, 0.3);
                break;
            }
        case 'yanagi':
            {
                const k = 2.5;
                const gold = mixColor(c0, GOLD, 0.6);
                for(let i = 0; i < n; i += 1){
                    const [dx, dy, dz] = sphere(i, n, 0.4);
                    const speed = R * k * 0.72 * (0.9 + rng() * 0.2);
                    add({
                        vx: dx * speed,
                        vy: dy * speed - R * 0.25,
                        drag: k,
                        fall: R * 0.95,
                        life: life(0.88, 0.99),
                        size: R * 0.013,
                        color: gold,
                        endColor: mixColor(gold, EMBER, 0.6),
                        shift: 0.6,
                        trail: 0.35 + trailK * 0.95,
                        segments: 4,
                        trailColor: mixColor(gold, EMBER, 0.35),
                        fadeTail: 0.45,
                        glitter: 0.25 + twinkleK * 0.5,
                        depth: depthOf(dz) * 0.9
                    });
                }
                flash(0, 0, 0, R * 0.8, gold, 0.3);
                break;
            }
        case 'kamuro':
            {
                const k = 3.0;
                const gold = mixColor(c0, GOLD, 0.78);
                for(let i = 0; i < n; i += 1){
                    const [dx, dy, dz] = sphere(i, n, 0.2);
                    const speed = R * k * 1.05 * (0.95 + rng() * 0.1);
                    add({
                        vx: dx * speed,
                        vy: dy * speed - R * 0.12,
                        drag: k,
                        fall: R * 0.55,
                        life: life(0.9, 0.99),
                        size: R * 0.017,
                        color: gold,
                        endColor: mixColor(gold, EMBER, 0.5),
                        shift: 0.55,
                        trail: 0.45 + trailK * 0.8,
                        segments: 4,
                        trailColor: mixColor(gold, EMBER, 0.25),
                        fadeTail: 0.5,
                        glitter: 0.55 + twinkleK * 0.45,
                        depth: depthOf(dz)
                    });
                }
                flash(0, 0, 0, R * 1.3, gold, 0.42);
                break;
            }
        case 'senrin':
            {
                const flowers = Math.max(4, Math.min(10, Math.round(n / 14)));
                const per = Math.max(6, Math.round(n / flowers));
                const k = 4.4;
                for(let f = 0; f < flowers; f += 1){
                    const angle = f * GOLDEN_ANGLE + rng() * 0.6;
                    const dist = R * 0.78 * Math.sqrt((f + 0.5) / flowers);
                    const ox = Math.cos(angle) * dist;
                    const oy = Math.sin(angle) * dist;
                    const delay = 0.06 + f / flowers * D * 0.42 + rng() * 0.05;
                    const r = R * (0.2 + rng() * 0.08);
                    const color = c(f);
                    for(let i = 0; i < per; i += 1){
                        const [dx, dy, dz] = sphere(i, per, 0.3);
                        const speed = r * k * (0.92 + rng() * 0.16);
                        add({
                            x0: ox,
                            y0: oy,
                            start: delay,
                            vx: dx * speed,
                            vy: dy * speed,
                            drag: k,
                            fall: R * 0.16,
                            life: D * (0.32 + rng() * 0.12),
                            size: R * 0.017,
                            color,
                            endColor: mixColor(color, WHITE, 0.6),
                            shift: 0.65,
                            trail: trailK * 0.08,
                            segments: 1,
                            fadeTail: 0.25,
                            twinkle: 0.3 + twinkleK * 0.7,
                            depth: depthOf(dz)
                        });
                    }
                    flash(ox, oy, delay, r * 1.4, color, 0.22);
                }
                break;
            }
        case 'ring':
            {
                const k = 3.4;
                const outer = Math.round(n * 0.7);
                const inner = Math.round(n * 0.2);
                const core = n - outer - inner;
                const ringOf = (count, reach, color, size, lifeLow)=>{
                    for(let i = 0; i < count; i += 1){
                        const [dx, dy] = planar(Math.cos(TAU * i / count), Math.sin(TAU * i / count));
                        const speed = R * k * reach * (0.99 + rng() * 0.02);
                        add({
                            vx: dx * speed,
                            vy: dy * speed,
                            drag: k,
                            fall: R * 0.18,
                            life: life(lifeLow, lifeLow + 0.12),
                            size,
                            color,
                            endColor: mixColor(color, WHITE, 0.5),
                            shift: 0.75,
                            trail: 0.05 + trailK * 0.2,
                            segments: 2,
                            twinkle: twinkleK
                        });
                    }
                };
                ringOf(outer, 1, c0, R * 0.022, 0.85);
                ringOf(inner, 0.58, c1, R * 0.018, 0.7);
                for(let i = 0; i < core; i += 1){
                    const [dx, dy, dz] = sphere(i, Math.max(1, core));
                    const speed = R * k * 0.18;
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.15,
                        life: life(0.45, 0.6),
                        size: R * 0.02,
                        color: c2,
                        depth: depthOf(dz)
                    });
                }
                flash(0, 0, 0, R * 0.9, c0, 0.3);
                break;
            }
        case 'heart':
        case 'star':
            {
                const k = 3.4;
                const outline = Math.max(12, Math.round(n * 0.88));
                for(let i = 0; i < outline; i += 1){
                    const u = i / outline;
                    let x;
                    let y;
                    if (kind === 'heart') {
                        const t = u * TAU;
                        x = 16 * Math.sin(t) ** 3 / 17;
                        y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
                    } else {
                        const edge = u * 10;
                        const e = Math.floor(edge);
                        const f = edge - e;
                        const vertex = (index)=>{
                            const radius = index % 2 === 0 ? 1 : 0.4;
                            const a = -Math.PI / 2 + index * Math.PI / 5;
                            return [
                                Math.cos(a) * radius,
                                Math.sin(a) * radius
                            ];
                        };
                        const [ax, ay] = vertex(e);
                        const [bx, by] = vertex(e + 1);
                        x = lerp(ax, bx, f);
                        y = lerp(ay, by, f);
                    }
                    const [dx, dy] = planar(x, y);
                    const speed = R * k * (0.99 + rng() * 0.02);
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.1,
                        life: life(0.8, 0.92),
                        size: R * 0.024,
                        color: c0,
                        endColor: mixColor(c0, WHITE, 0.55),
                        shift: 0.7,
                        trail: 0.04 + trailK * 0.1,
                        segments: 1,
                        fadeTail: 0.25,
                        twinkle: twinkleK
                    });
                }
                const core = n - outline;
                for(let i = 0; i < core; i += 1){
                    const [dx, dy, dz] = sphere(i, Math.max(1, core));
                    const speed = R * k * 0.15;
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.1,
                        life: life(0.4, 0.55),
                        size: R * 0.018,
                        color: c1,
                        depth: depthOf(dz)
                    });
                }
                flash(0, 0, 0, R * 0.8, c0, 0.28);
                break;
            }
        case 'palm':
            {
                const branches = Math.max(6, Math.min(14, Math.round(n / 9)));
                const crumbs = Math.max(0, Math.min(6, Math.floor((n - branches) / branches)));
                const k = 2.3;
                const gold = mixColor(c0, GOLD, 0.45);
                for(let b = 0; b < branches; b += 1){
                    const angle = TAU * b / branches + (rng() - 0.5) * 0.35;
                    const up = -Math.sin(angle);
                    const reach = 1 + up * 0.15 + (rng() - 0.5) * 0.1;
                    const dx = Math.cos(angle);
                    const dy = Math.sin(angle);
                    const speed = R * k * reach;
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.7,
                        life: life(0.88, 0.98),
                        size: R * 0.05,
                        color: gold,
                        endColor: mixColor(gold, EMBER, 0.55),
                        shift: 0.55,
                        trail: 0.4 + trailK * 0.55,
                        segments: 5,
                        trailColor: mixColor(gold, EMBER, 0.3),
                        fadeTail: 0.4,
                        glitter: 0.3 + twinkleK * 0.4
                    });
                    for(let j = 0; j < crumbs; j += 1){
                        const f = 0.9 - j * 0.1;
                        add({
                            vx: dx * speed * f + (rng() - 0.5) * R * 0.3,
                            vy: dy * speed * f + (rng() - 0.5) * R * 0.3,
                            drag: k,
                            fall: R * 0.75,
                            life: life(0.55, 0.85),
                            size: R * 0.014,
                            color: mixColor(gold, WHITE, 0.3),
                            trail: 0.08,
                            segments: 1,
                            fadeTail: 0.5,
                            glitter: 0.8
                        });
                    }
                }
                flash(0, 0, 0, R * 1.0, gold, 0.4);
                break;
            }
        case 'crossette':
            {
                const parents = Math.max(6, Math.min(16, Math.round(n / 5)));
                const k = 2.8;
                const kc = 3.4;
                const fall = R * 0.32;
                for(let p = 0; p < parents; p += 1){
                    const angle = TAU * p / parents + (rng() - 0.5) * 0.4;
                    const speed = R * k * 0.72 * (0.9 + rng() * 0.2);
                    const vx = Math.cos(angle) * speed;
                    const vy = Math.sin(angle) * speed;
                    const split = D * (0.28 + rng() * 0.08);
                    add({
                        vx,
                        vy,
                        drag: k,
                        fall,
                        life: split,
                        size: R * 0.024,
                        color: c0,
                        trail: 0.08 + trailK * 0.2,
                        segments: 2,
                        fadeTail: 0.05
                    });
                    const e = Math.exp(-k * split);
                    const f = (1 - e) / k;
                    const sx = vx * f;
                    const sy = vy * f + fall * (split - f);
                    const svx = vx * e;
                    const svy = (vy - fall) * e + fall;
                    const turn = angle + Math.PI / 4 + (rng() - 0.5) * 0.3;
                    for(let q = 0; q < 4; q += 1){
                        const a = turn + q * Math.PI / 2;
                        const cs = R * kc * 0.36;
                        add({
                            x0: sx,
                            y0: sy,
                            start: split,
                            vx: svx * 0.35 + Math.cos(a) * cs,
                            vy: svy * 0.35 + Math.sin(a) * cs,
                            drag: kc,
                            fall: R * 0.38,
                            life: D * (0.45 + rng() * 0.12),
                            size: R * 0.018,
                            color: c1,
                            endColor: mixColor(c1, WHITE, 0.5),
                            shift: 0.7,
                            trail: 0.06 + trailK * 0.18,
                            segments: 2,
                            twinkle: twinkleK
                        });
                    }
                    flash(sx, sy, split, R * 0.2, c1, 0.16);
                }
                flash(0, 0, 0, R * 0.8, c0, 0.3);
                break;
            }
        case 'strobe':
            {
                const k = 4;
                const white = mixColor(c0, WHITE, 0.55);
                for(let i = 0; i < n; i += 1){
                    const [dx, dy, dz] = sphere(i, n, 0.6);
                    const speed = R * k * 0.88 * (0.8 + rng() * 0.3);
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: k,
                        fall: R * 0.12,
                        life: life(0.85, 0.99),
                        size: R * 0.028,
                        color: white,
                        endColor: c(i),
                        shift: 0.25,
                        strobe: 7 + rng() * 7,
                        strobeFrom: 0.3 + rng() * 0.25,
                        fadeTail: 0.15,
                        depth: depthOf(dz),
                        tex: rng() < 0.3 ? 1 : 0
                    });
                }
                flash(0, 0, 0, R * 0.9, white, 0.3);
                break;
            }
        case 'hachi':
            {
                const k = 2.5;
                const silver = mixColor(c0, WHITE, 0.7);
                for(let i = 0; i < n; i += 1){
                    const angle = rng() * TAU;
                    const speed = R * k * (0.3 + rng() * 0.6);
                    add({
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        drag: k,
                        fall: R * 0.25,
                        life: life(0.5, 0.98),
                        size: R * 0.013,
                        color: silver,
                        endColor: c(i),
                        shift: 0.6,
                        trail: 0.08 + trailK * 0.14,
                        segments: 2,
                        trailColor: mixColor(silver, EMBER, 0.3),
                        spiral: R * (0.05 + rng() * 0.11),
                        spin: (rng() < 0.5 ? -1 : 1) * (9 + rng() * 12),
                        twinkle: 0.4 + twinkleK * 0.6,
                        fadeTail: 0.3
                    });
                }
                flash(0, 0, 0, R * 0.6, silver, 0.24);
                break;
            }
        case 'willow-ring':
            {
                const inner = Math.round(n * 0.35);
                const outer = n - inner;
                const gold = mixColor(c1, GOLD, 0.7);
                for(let i = 0; i < inner; i += 1){
                    const [dx, dy] = planar(Math.cos(TAU * i / inner), Math.sin(TAU * i / inner));
                    const speed = R * 3.6 * 0.46;
                    add({
                        vx: dx * speed,
                        vy: dy * speed,
                        drag: 3.6,
                        fall: R * 0.15,
                        life: life(0.45, 0.55),
                        size: R * 0.03,
                        color: c0,
                        endColor: mixColor(c0, WHITE, 0.5),
                        shift: 0.6,
                        fadeTail: 0.1
                    });
                }
                for(let i = 0; i < outer; i += 1){
                    const [dx, dy, dz] = sphere(i, outer, 0.4);
                    const speed = R * 2.6 * (0.92 + rng() * 0.12);
                    add({
                        vx: dx * speed,
                        vy: dy * speed - R * 0.2,
                        drag: 2.6,
                        fall: R * 0.9,
                        life: life(0.88, 0.99),
                        size: R * 0.013,
                        color: gold,
                        endColor: mixColor(gold, EMBER, 0.6),
                        shift: 0.6,
                        trail: 0.35 + trailK * 0.9,
                        segments: 4,
                        trailColor: mixColor(gold, EMBER, 0.3),
                        fadeTail: 0.45,
                        glitter: 0.3 + twinkleK * 0.4,
                        depth: depthOf(dz) * 0.9
                    });
                }
                flash(0, 0, 0, R * 1.0, c0, 0.34);
                break;
            }
        case 'mine':
            {
                const volleys = Math.max(4, Math.min(8, Math.round(D * 2.6)));
                const per = Math.max(4, Math.round(n / volleys));
                const k = 1.7;
                for(let v = 0; v < volleys; v += 1){
                    const delay = v / volleys * D * 0.55;
                    const lean = (v % 2 === 0 ? -1 : 1) * (0.12 + rng() * 0.2);
                    const color = c(v);
                    const lifeV = Math.min(0.9 + rng() * 0.5, D * 0.6);
                    for(let i = 0; i < per; i += 1){
                        const angle = -Math.PI / 2 + lean + ((i + 0.5) / per - 0.5) * 1.3 + (rng() - 0.5) * 0.12;
                        const speed = R * k * (1.45 + rng() * 0.45);
                        add({
                            start: delay,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            drag: k,
                            fall: R * 0.9,
                            life: lifeV * (0.8 + rng() * 0.2),
                            size: R * 0.02,
                            color,
                            endColor: mixColor(color, WHITE, 0.6),
                            shift: 0.7,
                            trail: 0.1 + trailK * 0.3,
                            segments: 3,
                            fadeTail: 0.3,
                            twinkle: twinkleK
                        });
                    }
                    flash(0, 0, delay, R * 0.35, color, 0.18);
                }
                break;
            }
        default:
            {
                const never = kind;
                return never;
            }
    }
    for(let i = 0; i < stars.length; i += 1)stars[i].rank = (i + 1) * GOLDEN % 1;
    let end = at;
    for (const star of stars)end = Math.max(end, star.start + star.life);
    for (const item of flashes)end = Math.max(end, item.at + item.life);
    return {
        at,
        end,
        stars,
        flashes
    };
};
export const starPosition = (star, tau, out)=>{
    const t = tau < 0 ? 0 : tau;
    const e = Math.exp(-star.drag * t);
    const f = (1 - e) / star.drag;
    let x = star.x0 + star.vx * f;
    let y = star.y0 + star.vy * f + star.fall * (t - f);
    if (star.spiral > 0) {
        const r = star.spiral * (1 - Math.exp(-3 * t));
        const a = star.phase + star.spin * t;
        x += r * Math.cos(a);
        y += r * Math.sin(a);
    }
    out.x = x;
    out.y = y;
    return out;
};
const starBase = (star, tau)=>{
    if (tau < 0 || tau > star.life) return 0;
    const u = tau / star.life;
    let b = star.depth * clamp01(tau / 0.035);
    if (u > 1 - star.fadeTail) {
        const k = (1 - u) / star.fadeTail;
        b *= k * k * (3 - 2 * k);
    }
    return b;
};
export const starBrightness = (star, tau)=>{
    let b = starBase(star, tau);
    if (b <= 0) return 0;
    if (star.strobe > 0 && tau > star.strobeFrom) {
        const on = (tau * star.strobe + star.phase) % 1 < 0.42;
        b *= on ? 1 : 0.05;
    }
    const u = tau / star.life;
    if (star.twinkle > 0 && u > 0.5) {
        const n = hash01(Math.floor(tau * 24), star.phase * 97);
        b *= 1 - star.twinkle * clamp01((u - 0.5) / 0.2) * (n < 0.45 ? 0.85 : 0);
    }
    return b;
};
export const starColor = (star, tau)=>{
    const u = tau / star.life;
    let color = star.shift < 1 ? mixColor(star.color, star.endColor, (u - star.shift) / 0.1) : star.color;
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) color = mixColor(color, WHITE, 0.75);
    return color;
};
export const starSize = (star, tau)=>{
    const u = clamp01(tau / star.life);
    let size = star.size * (1 - 0.45 * u);
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) size *= 1.6;
    return size;
};
export const burstActive = (plan, time)=>time >= plan.at && time <= plan.end;
const scratchA = {
    x: 0,
    y: 0
};
const scratchB = {
    x: 0,
    y: 0
};
const emitSegment = (emit, a, b, thickness, alpha, tint)=>{
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.6 || alpha < 0.01) return true;
    const rotation = Math.atan2(dy, dx) + Math.PI / 2;
    return emit('streak', (a.x + b.x) / 2, (a.y + b.y) / 2, thickness, length + thickness * 0.5, rotation, alpha, tint);
};
export const burstDemand = (plans, time)=>{
    let stars = 0;
    let flashes = 0;
    for (const plan of plans){
        if (!burstActive(plan, time)) continue;
        for (const item of plan.flashes)if (time >= item.at && time < item.at + item.life) flashes += 2;
        for (const star of plan.stars){
            const tau = time - star.start;
            if (tau >= 0 && tau <= star.life) stars += 1 + star.segments;
        }
    }
    return {
        stars,
        flashes
    };
};
export const drawBursts = (plans, time, budget, emit)=>{
    const demand = burstDemand(plans, time);
    if (demand.stars + demand.flashes === 0 || budget <= 0) return 0;
    const keep = demand.stars + demand.flashes <= budget ? 2 : Math.max(0, (budget - demand.flashes) * 0.97) / Math.max(1, demand.stars);
    let used = 0;
    const put = (texture, x, y, w, h, r, a, tint)=>{
        if (used >= budget) return false;
        if (!emit(texture, x, y, w, h, r, a, tint)) return false;
        used += 1;
        return true;
    };
    for (const plan of plans){
        if (!burstActive(plan, time)) continue;
        for (const item of plan.flashes){
            const age = time - item.at;
            if (age < 0 || age >= item.life) continue;
            const k = age / item.life;
            const alpha = clamp01(age / 0.02) * (1 - k) ** 2;
            const halo = item.size * (0.55 + 0.6 * Math.sqrt(k));
            if (!put('flash', item.x, item.y, halo, halo, 0, alpha * 0.55, item.color)) return used;
            const core = item.size * 0.35 * (1 - k * 0.6);
            if (!put('flash', item.x, item.y, core, core, 0, alpha, WHITE)) return used;
        }
    }
    for (const plan of plans){
        if (!burstActive(plan, time)) continue;
        for (const star of plan.stars){
            const tau = time - star.start;
            if (tau < 0 || tau > star.life || star.rank >= keep) continue;
            const base = starBase(star, tau);
            if (base <= 0) continue;
            const head = starPosition(star, tau, scratchA);
            const hx = head.x;
            const hy = head.y;
            const size = starSize(star, tau);
            if (star.segments > 0) {
                const step = star.trail / star.segments;
                let prevX = hx;
                let prevY = hy;
                for(let j = 1; j <= star.segments; j += 1){
                    const back = Math.max(0, tau - step * j);
                    const old = starPosition(star, back, scratchB);
                    const fade = (1 - (j - 1) / star.segments) ** 1.3;
                    const thickness = Math.max(1.2, size * 0.75 * (1 - 0.45 * (j / star.segments)));
                    scratchA.x = prevX;
                    scratchA.y = prevY;
                    if (!emitSegment(put, scratchA, old, thickness, base * fade * 0.95, star.trailColor)) return used;
                    prevX = old.x;
                    prevY = old.y;
                    if (back <= 0) break;
                }
            }
            const alpha = starBrightness(star, tau);
            if (alpha < 0.01) continue;
            const tint = starColor(star, tau);
            const drawn = star.tex === 1 ? size * 3.4 : size * 3.4;
            if (!put(star.tex === 1 ? 'star4' : 'glow', hx, hy, drawn, drawn, star.phase, alpha, tint)) return used;
        }
    }
    return used;
};
export const LAUNCH_EMBER_LIFE = 0.6;
const LAUNCH_EMBER_STEP = 0.032;
const LAUNCH_TRAIL_SEGMENTS = 5;
export const launchEnd = (launch)=>launch.at + launch.duration + LAUNCH_EMBER_LIFE;
export const launchHead = (launch, p, salt, out)=>{
    const k = clamp01(p);
    const rise = 1 - (1 - k) ** 2;
    const span = Math.hypot(launch.toX - launch.fromX, launch.toY - launch.fromY);
    const freq = 2.2 + hash01(1, salt) * 1.6;
    const phase = hash01(2, salt) * TAU;
    const sway = Math.sin(k * freq * TAU + phase) * span * 0.018 * (1 - k * 0.7);
    out.x = lerp(launch.fromX, launch.toX, rise) + sway;
    out.y = lerp(launch.fromY, launch.toY, rise);
    return out;
};
export const drawLaunch = (launch, time, unit, emit)=>{
    const age = time - launch.at;
    if (age < 0 || time > launchEnd(launch)) return true;
    const salt = hashString(launch.seed) % 100000;
    const duration = Math.max(0.05, launch.duration);
    const color = launch.color;
    const ember = mixColor(color, GOLD, 0.55);
    const size = unit * 0.009;
    const firstJ = Math.max(0, Math.ceil((age - LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP));
    const lastJ = Math.floor(Math.min(age, duration) / LAUNCH_EMBER_STEP);
    for(let j = firstJ; j <= lastJ; j += 1){
        const born = j * LAUNCH_EMBER_STEP;
        const tau = age - born;
        if (tau < 0 || tau > LAUNCH_EMBER_LIFE) continue;
        const from = launchHead(launch, born / duration, salt, scratchB);
        const vx = (hash01(j * 3 + 1, salt) - 0.5) * unit * 0.12;
        const vy = (hash01(j * 3 + 2, salt) - 0.2) * unit * 0.05;
        const drag = 2.4;
        const fall = unit * 0.09;
        const e = Math.exp(-drag * tau);
        const f = (1 - e) / drag;
        const x = from.x + vx * f;
        const y = from.y + vy * f + fall * (tau - f);
        const k = tau / LAUNCH_EMBER_LIFE;
        const flicker = hash01(j * 7 + Math.floor(tau * 20), salt) < 0.3 ? 0.4 : 1;
        const alpha = (1 - k) ** 1.5 * flicker * 0.85;
        const s = size * (0.35 + hash01(j * 5, salt) * 0.35) * (1 - k * 0.5);
        if (!emit('glow', x, y, s * 2.6, s * 2.6, 0, alpha, ember)) return false;
    }
    if (age > duration) return true;
    const p = age / duration;
    const head = launchHead(launch, p, salt, scratchA);
    const hx = head.x;
    const hy = head.y;
    let prevX = hx;
    let prevY = hy;
    for(let j = 1; j <= LAUNCH_TRAIL_SEGMENTS; j += 1){
        const old = launchHead(launch, Math.max(0, p - 0.07 * j / duration), salt, scratchB);
        const fade = 1 - (j - 1) / LAUNCH_TRAIL_SEGMENTS;
        scratchA.x = prevX;
        scratchA.y = prevY;
        if (!emitSegment(emit, scratchA, old, Math.max(1, size * 0.9 * fade), 0.8 * fade, mixColor(color, EMBER, 0.3))) return false;
        prevX = old.x;
        prevY = old.y;
    }
    const pulse = 0.85 + 0.15 * Math.sin(age * 40 + salt);
    const dim = 1 - 0.35 * clamp01((p - 0.8) / 0.2);
    if (!emit('glow', hx, hy, size * 4.2 * pulse, size * 4.2 * pulse, 0, 0.9 * dim, color)) return false;
    return emit('dot', hx, hy, size * 0.9, size * 0.9, 0, dim, mixColor(color, WHITE, 0.8));
};
export const launchDemand = (launch, time)=>{
    const age = time - launch.at;
    if (age < 0 || time > launchEnd(launch)) return 0;
    const embers = Math.floor(Math.min(age, LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP) + 1;
    return embers + (age <= launch.duration ? LAUNCH_TRAIL_SEGMENTS + 2 : 0);
};
