/* lumiere 的线稿：图标路径解析、配方、图示、主题图标散布。
 *
 * 从 Folia lumiere 的 5 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  var foliaLumiereLight = window.foliaLumiereLight;
  if (!foliaLumiereCore || !foliaLumiereLight) return;

  var compressLight = foliaLumiereLight.compressLight;
  var lightAt = foliaLumiereLight.lightAt;
  var resolveLucideIcon = (typeof foliaResolveLucideIcon === 'function') ? foliaResolveLucideIcon : null;
  var resolveLucideIconNames = (typeof foliaResolveLucideIconNames === 'function') ? foliaResolveLucideIconNames : null;
  var createRng = foliaLumiereCore.createRng;

  /* 裸函数缺失（核心模块没加载）时整块退出，不把后续模块带崩。 */
  if (!resolveLucideIcon || !resolveLucideIconNames) return;

  /* ---- lineart/lineArt.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/lineart/lineArt.ts
// 光学线稿：一组折线（高度单位坐标），按进度描出来，节点上有闪点。每条线一个 Graphics：
// 描线进度变化时才重建几何，受光强弱只改 alpha（光柱扫过时，照到的线更亮）。







/** 藏起来多少秒（歌曲时间）之后才放 GPU 数据：刚淡出的线可能被回拖一下又要画。 */
const LINE_ART_UNLOAD_AFTER = 2;
/** 下次出现在这么多秒之内就不放：马上又要画，放了只是白传一遍。 */
const LINE_ART_UNLOAD_LEAD = 4;

/**
 * 藏着的线稿这一帧该不该放掉 GPU 数据（滞回：藏够 LINE_ART_UNLOAD_AFTER 秒，且离下次出现至少 LINE_ART_UNLOAD_LEAD 秒）。
 * 起因：轨迹过渡把整首歌并成一个单元，每个镜头的线稿都活到单元销毁，画过一次的每条线都留着一个 batcher 和两块缓冲。
 */
const shouldUnloadLineArt = (hiddenSince, time, nextUse) =>
    time - hiddenSince >= LINE_ART_UNLOAD_AFTER && nextUse - time >= LINE_ART_UNLOAD_LEAD;

const cumulative = (points) => {
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    return lengths;
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const createLineArt = (
    pixi,
    options,
) => {
    const { height, spec } = options;
    const view = new pixi.Container();
    const pathsHolder = new pixi.Container();
    const nodesHolder = new pixi.Container();
    view.addChild(pathsHolder, nodesHolder);

    const paths = spec.paths.filter(path => path.points.length > 1).map(path => {
        const graphics = new pixi.Graphics();
        pathsHolder.addChild(graphics);
        const lengths = cumulative(path.points);
        const mid = path.points[Math.floor(path.points.length / 2)];
        return { spec: path, graphics, lengths, total: lengths[lengths.length - 1], drawn: -1, midpoint: mid };
    });

    const nodes = spec.nodes.map(node => {
        const sprite = new pixi.Sprite(options.starTexture);
        sprite.anchor.set(0.5);
        sprite.position.set(node.at[0] * height, node.at[1] * height);
        nodesHolder.addChild(sprite);
        return { spec: node, sprite };
    });

    /** 画出一条线的前 amount 长度（考虑虚线）。 */
    const redraw = (path, amount) => {
        const g = path.graphics;
        g.clear();
        if (amount <= 0) return;
        const { points, dash } = path.spec;
        const limit = Math.min(amount, path.total);
        const period = dash ? dash[0] + dash[1] : 0;
        const at = (index, distance) => {
            const [ax, ay] = points[index - 1];
            const [bx, by] = points[index];
            const segment = path.lengths[index] - path.lengths[index - 1];
            const f = segment > 0 ? (distance - path.lengths[index - 1]) / segment : 0;
            return [(ax + (bx - ax) * f) * height, (ay + (by - ay) * f) * height];
        };
        g.moveTo(points[0][0] * height, points[0][1] * height);
        for (let i = 1; i < points.length; i += 1) {
            const start = path.lengths[i - 1];
            const end = Math.min(path.lengths[i], limit);
            if (start >= limit) break;
            if (!dash) {
                const [x, y] = at(i, end);
                g.lineTo(x, y);
                continue;
            }
            // 虚线：按周期的整数下标取出落在本段里的每一截实线（不用浮点游标，避免卡在边界上）。
            for (let k = Math.floor(start / period); k * period < end; k += 1) {
                const from = Math.max(start, k * period);
                const to = Math.min(end, k * period + dash[0]);
                if (to <= from) continue;
                const [ax, ay] = at(i, from);
                const [bx, by] = at(i, to);
                g.moveTo(ax, ay);
                g.lineTo(bx, by);
            }
        }
        const px = path.spec.width * height;
        g.stroke({ width: px * 3.2, color: 0xffffff, alpha: 0.12, cap: 'round', join: 'round' });
        g.stroke({ width: px, color: 0xffffff, alpha: 1, cap: 'round', join: 'round' });
    };

    // resident：画过、GPU 数据可能还在；hiddenSince：这次藏起来的时刻（NaN 表示正在画）。
    let resident = false;
    let hiddenSince = Number.NaN;

    const update = (time, draw, fade, beams, color) => {
        resident = true;
        hiddenSince = Number.NaN;
        for (const path of paths) {
            const { delay, span } = path.spec;
            const local = clamp01((draw - delay) / Math.max(span, 1e-3));
            const eased = 1 - (1 - local) ** 3;
            const amount = eased * path.total;
            if (Math.abs(amount - path.drawn) > 1e-5) {
                redraw(path, amount);
                path.drawn = amount;
            }
            const lit = compressLight(lightAt(beams, path.midpoint[0], path.midpoint[1]));
            // 光束外的线也要看得见（参考图里取景框、叶片都在暗处），受光的部分再亮一截。
            path.graphics.alpha = Math.min(1, path.spec.alpha * fade * (0.55 + 0.9 * lit));
            path.graphics.tint = color;
        }
        for (const { spec: node, sprite } of nodes) {
            const appear = clamp01((draw - node.delay) / 0.08);
            const lit = compressLight(lightAt(beams, node.at[0], node.at[1]));
            const twinkle = 0.55 + 0.45 * Math.sin(time * 2.3 + node.twinklePhase);
            const alpha = appear * fade * (0.25 + 0.75 * lit) * twinkle;
            sprite.visible = alpha > 0.004;
            if (!sprite.visible) continue;
            const pop = 1 + (1 - appear) * 1.5;
            const px = node.size * height * pop * (0.8 + 0.2 * twinkle);
            sprite.width = px;
            sprite.height = px;
            sprite.alpha = alpha;
            sprite.tint = color;
        }
    };

    const idle = (time, nextUse) => {
        if (!resident) return;
        // 刚藏起来，或回拖到了藏起来之前：从这一刻重新计时。
        if (!(hiddenSince <= time)) hiddenSince = time;
        if (!shouldUnloadLineArt(hiddenSince, time, nextUse)) return;
        // 只放 GPU 数据，几何指令留在 context 里；再画到时 Pixi 按指令重建、重传，和描线期间每帧重画走的是同一条路。
        // context 都是各条线自建的，没有别人共用。
        for (const path of paths) path.graphics.context.unload();
        resident = false;
    };

    return {
        view,
        update,
        idle,
        // context: true 必须带上：Pixi 8 的 Graphics.destroy 只要收到选项对象、却没写 context: true，就不销毁它自己建的
        // GraphicsContext。那个 context 还挂在渲染器的 GraphicsContextSystem 里，连同它的 GPU 批数据（一个 batcher、
        // 两块顶点 / 索引缓冲）要等 Pixi 的 GC 空闲 60 秒后才回收；单元换得勤时，WebGL 缓冲会一直涨到那个窗口的量。
        destroy: () => view.destroy({ children: true, context: true }),
    };
};

/**
 * 线稿 / 图标组藏起来时从显示树上摘下，而不是只设 visible = false：Pixi 每帧会把动过的容器整棵子树
 * （包括藏着的节点）的变换都走一遍，整首一个单元时几十组线稿、每组上百条线，大半在白走。
 * 挂回去时按镜头顺序插回原位，叠放次序与一直挂着时相同。
 */
const showLineArtLayer = (holder, layers, index, shown) => {
    const view = layers[index].view;
    if (shown === (view.parent === holder)) return;
    if (!shown) {
        holder.removeChild(view);
        return;
    }
    let position = 0;
    for (let k = 0; k < index; k += 1) if (layers[k].view.parent === holder) position += 1;
    holder.addChildAt(view, position);
};

  /* ---- lineart/recipes.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/lineart/recipes.ts
// 线稿配方：几何图元（弧、辐条、刻度、取景框、叶片）→ LineArtSpec。坐标一律高度单位，aspect 为宽高比。
const arcPoints = (cx, cy, r, from, to, steps = 64) => (
    Array.from({ length: steps + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / steps;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    })
);

const cubicPoints = (p0, p1, p2, p3, steps = 40) => (
    Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        return [
            a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
        ];
    })
);

const line = (a, b) => [a, b];

const mergeSpecs = (...specs) => ({
    paths: specs.flatMap(spec => spec.paths),
    nodes: specs.flatMap(spec => spec.nodes),
});

/**
 * 量角器似的光环：以光源为圆心的下半圆（外弧 + 内弧），辐条，外弧上的细刻度。参考图顶部那一圈。
 */
const protractorHalo = (options) => {
    const { cx, cy, radius } = options;
    const delay = options.delay ?? 0;
    const alpha = options.alpha ?? 0.5;
    const from = Math.PI * 0.04;
    const to = Math.PI * 0.96;
    const inner = radius * 0.62;
    const paths = [
        { points: arcPoints(cx, cy, radius, to, from, 96), width: 0.0016, alpha, delay, span: 0.45 },
        { points: arcPoints(cx, cy, inner, from, to, 72), width: 0.0013, alpha: alpha * 0.8, delay: delay + 0.08, span: 0.4 },
        { points: arcPoints(cx, cy, radius * 1.18, from + 0.1, to - 0.1, 80), width: 0.0011, alpha: alpha * 0.45, delay: delay + 0.2, span: 0.4, dash: [0.004, 0.009] },
    ];
    const step = options.spokeStep ?? Math.PI / 12;
    const nodes = [];
    let index = 0;
    for (let a = Math.PI / 2 - step * 5; a <= Math.PI / 2 + step * 5 + 1e-6; a += step) {
        const long = index % 2 === 0;
        const r0 = inner * 0.2;
        const r1 = radius * (long ? 1.12 : 1.02);
        paths.push({
            points: line([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]),
            width: long ? 0.0013 : 0.0009,
            alpha: alpha * (long ? 0.7 : 0.45),
            delay: delay + 0.12 + Math.abs(a - Math.PI / 2) * 0.12,
            span: 0.3,
        });
        if (long) nodes.push({ at: [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius], size: 0.022, delay: delay + 0.45, twinklePhase: index * 1.7 });
        index += 1;
    }
    // 外弧上的细刻度。
    for (let a = from; a <= to; a += Math.PI / 72) {
        paths.push({
            points: line([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius], [cx + Math.cos(a) * radius * 0.975, cy + Math.sin(a) * radius * 0.975]),
            width: 0.0008,
            alpha: alpha * 0.4,
            delay: delay + 0.25 + (a - from) * 0.05,
            span: 0.15,
        });
    }
    return { paths, nodes };
};

/** 取景框：一个大矩形、四角加粗的角标、边上的刻度、两侧竖直的点线。 */
const viewfinderFrame = (options) => {
    const { aspect, top, bottom } = options;
    const left = options.left * aspect;
    const right = options.right * aspect;
    const delay = options.delay ?? 0;
    const alpha = options.alpha ?? 0.3;
    const corner = 0.03;
    const paths = [
        { points: [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]], width: 0.0009, alpha: alpha * 0.55, delay, span: 0.6 },
    ];
    const corners = [
        [[left, top + corner], [left, top], [left + corner, top]],
        [[right - corner, top], [right, top], [right, top + corner]],
        [[right, bottom - corner], [right, bottom], [right - corner, bottom]],
        [[left + corner, bottom], [left, bottom], [left, bottom - corner]],
    ];
    corners.forEach((points, i) => paths.push({ points, width: 0.0018, alpha, delay: delay + 0.1 + i * 0.05, span: 0.2 }));
    const ticks = 12;
    for (let i = 1; i < ticks; i += 1) {
        const x = left + ((right - left) * i) / ticks;
        const y = top + ((bottom - top) * i) / ticks;
        const len = i % 3 === 0 ? 0.014 : 0.007;
        paths.push({ points: line([x, top], [x, top + len]), width: 0.0008, alpha: alpha * 0.6, delay: delay + 0.3 + i * 0.01, span: 0.1 });
        paths.push({ points: line([x, bottom], [x, bottom - len]), width: 0.0008, alpha: alpha * 0.6, delay: delay + 0.3 + i * 0.01, span: 0.1 });
        paths.push({ points: line([left, y], [left + len, y]), width: 0.0008, alpha: alpha * 0.6, delay: delay + 0.3 + i * 0.01, span: 0.1 });
        paths.push({ points: line([right, y], [right - len, y]), width: 0.0008, alpha: alpha * 0.6, delay: delay + 0.3 + i * 0.01, span: 0.1 });
    }
    const guideX = [left + (right - left) * 0.14, right - (right - left) * 0.14];
    guideX.forEach((x, i) => paths.push({
        points: line([x, top + 0.06], [x, bottom - 0.06]), width: 0.001, alpha: alpha * 0.5,
        delay: delay + 0.35 + i * 0.05, span: 0.4, dash: [0.003, 0.012],
    }));
    return { paths, nodes: [] };
};

/**
 * 萌芽：从画面底部升起的茎，顶端两片叶（外轮廓 + 主脉 + 侧脉），叶尖与叶缘有闪点。参考图底部的两片叶。
 * baseY 为茎顶（叶的起点），size 为叶长。
 */
const sprout = (options) => {
    const { cx, baseY, size } = options;
    const delay = options.delay ?? 0;
    const alpha = options.alpha ?? 0.55;
    const open = options.open ?? 1;
    const paths = [
        { points: cubicPoints([cx, 1.04], [cx + 0.01, 0.94], [cx - 0.008, baseY + 0.08], [cx, baseY]), width: 0.0016, alpha, delay, span: 0.3 },
    ];
    const nodes = [];
    const leaf = (side, index) => {
        // 叶子主轴：与竖直方向夹 lean 角，左叶向左上、右叶向右上（y 向下）。
        const lean = (0.2 + 0.2 * open) * Math.PI;
        const d = [Math.sin(lean) * side, -Math.cos(lean)];
        const n = [-d[1], d[0]];
        const base = [cx, baseY];
        const tip = [base[0] + d[0] * size, base[1] + d[1] * size - size * 0.12];
        const bulge = size * 0.34;
        const at = (along, across) => [
            base[0] + d[0] * size * along + n[0] * across,
            base[1] + d[1] * size * along + n[1] * across - size * 0.12 * along * along,
        ];
        const leafDelay = delay + 0.22 + index * 0.08;
        // 叶的外轮廓是这组线稿的主体，比其他线粗一些。
        paths.push({ points: cubicPoints(base, at(0.3, bulge), at(0.78, bulge * 0.9), tip, 48), width: 0.0026, alpha, delay: leafDelay, span: 0.35 });
        paths.push({ points: cubicPoints(base, at(0.3, -bulge * 0.95), at(0.8, -bulge * 0.6), tip, 48), width: 0.0026, alpha, delay: leafDelay + 0.04, span: 0.35 });
        paths.push({ points: cubicPoints(base, at(0.35, bulge * 0.08), at(0.7, bulge * 0.05), tip, 32), width: 0.0011, alpha: alpha * 0.7, delay: leafDelay + 0.12, span: 0.3 });
        for (let v = 1; v <= 4; v += 1) {
            const f = v / 5.2;
            const start = at(f, bulge * 0.04);
            for (const s of [1, -1]) {
                const end = at(f + 0.14, s * bulge * (0.72 - f * 0.35));
                paths.push({ points: cubicPoints(start, at(f + 0.04, s * bulge * 0.25), at(f + 0.1, s * bulge * 0.5), end, 16), width: 0.0008, alpha: alpha * 0.45, delay: leafDelay + 0.2 + v * 0.03, span: 0.18 });
            }
        }
        nodes.push({ at: tip, size: 0.03, delay: leafDelay + 0.3, twinklePhase: index * 2.1 });
        nodes.push({ at: at(0.45, bulge * 0.86), size: 0.014, delay: leafDelay + 0.33, twinklePhase: index * 2.1 + 1 });
        nodes.push({ at: at(0.6, -bulge * 0.8), size: 0.012, delay: leafDelay + 0.36, twinklePhase: index * 2.1 + 2 });
    };
    leaf(-1, 0);
    leaf(1, 1);
    nodes.push({ at: [cx, baseY], size: 0.02, delay: delay + 0.3, twinklePhase: 0.5 });
    return { paths, nodes };
};

/** 散落的小闪点（参考图里画面各处零星的亮点）。 */
const scatteredSparks = (options) => {
    const [x0, y0, x1, y1] = options.region ?? [0.05, 0.08, 0.95, 0.92];
    const nodes = Array.from({ length: options.count }, (_, i) => ({
        at: [(x0 + (x1 - x0) * options.random()) * options.aspect, y0 + (y1 - y0) * options.random()],
        size: 0.006 + options.random() * 0.012,
        delay: (options.delay ?? 0) + options.random() * 0.5,
        twinklePhase: i * 2.399,
    }));
    return { paths: [], nodes };
};

/** 百叶窗：窗框 + 一排横向叶片（窗隙族）。x、y、w、h 为高度单位。 */
const blindsWindow = (options) => {
    const { x, y, w, h, slats } = options;
    const delay = options.delay ?? 0;
    const alpha = options.alpha ?? 0.5;
    const paths = [
        { points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], width: 0.0018, alpha, delay, span: 0.5 },
    ];
    for (let i = 1; i < slats; i += 1) {
        const sy = y + (h * i) / slats;
        paths.push({ points: line([x, sy], [x + w, sy]), width: 0.001, alpha: alpha * 0.6, delay: delay + 0.1 + i * 0.03, span: 0.2 });
    }
    return { paths, nodes: [{ at: [x + w, y + h], size: 0.018, delay: delay + 0.4, twinklePhase: 1 }] };
};

/** 三棱镜：正三角形轮廓（棱镜族），cx、cy 为中心，size 为边长（高度单位）。 */
const prismTriangle = (options) => {
    const { cx, cy, size } = options;
    const h = (size * Math.sqrt(3)) / 2;
    const top = [cx, cy - (h * 2) / 3];
    const left = [cx - size / 2, cy + h / 3];
    const right = [cx + size / 2, cy + h / 3];
    const alpha = options.alpha ?? 0.7;
    const delay = options.delay ?? 0;
    return {
        paths: [
            { points: [top, right, left, top], width: 0.0022, alpha, delay, span: 0.5 },
            { points: [top, [cx, cy + h / 3]], width: 0.0008, alpha: alpha * 0.4, delay: delay + 0.3, span: 0.3, dash: [0.004, 0.008] },
        ],
        nodes: [top, left, right].map((at, i) => ({ at, size: 0.02, delay: delay + 0.4 + i * 0.05, twinklePhase: i * 1.3 })),
    };
};

/** 双缝挡板：一条横线中间开两个缝（衍射族）。y 为挡板高度，gap 为缝宽，separation 为两缝间距（高度单位）。 */
const slitBarrier = (options) => {
    const { cx, y, width, gap, separation } = options;
    const alpha = options.alpha ?? 0.6;
    const delay = options.delay ?? 0;
    const a = cx - separation / 2;
    const b = cx + separation / 2;
    const segments = [[cx - width / 2, a - gap / 2], [a + gap / 2, b - gap / 2], [b + gap / 2, cx + width / 2]];
    return {
        paths: segments.map(([from, to], i) => ({ points: line([from, y], [to, y]), width: 0.0026, alpha, delay: delay + i * 0.08, span: 0.3 })),
        nodes: [a, b].map((x, i) => ({ at: [x, y], size: 0.022, delay: delay + 0.35 + i * 0.05, twinklePhase: i * 2 })),
    };
};

  /* ---- lineart/iconPaths.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lineart/iconPaths.ts
// Lucide 图标 → 折线：取图标的 SVG 节点（path / circle / ellipse / line / rect / polyline / polygon），
// 弧与贝塞尔按角度 / 分段展平成折线，坐标留在图标自己的 24×24 viewBox 里，交给描线引擎再缩放摆放。
// 每个图标名只展平一次（模块级缓存），场景构建时直接取。

/** lucide 的 viewBox 边长。 */
const ICON_VIEWBOX = 24;


/** 曲线展平的精度：整圆 48 段，贝塞尔每段 12 段。 */
const CIRCLE_STEPS = 48;
const CURVE_STEPS = 12;

const num = (value, fallback = 0) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const ellipsePoints = (cx, cy, rx, ry, steps = CIRCLE_STEPS) => (
    Array.from({ length: steps + 1 }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    })
);

/** 圆角矩形：四条边 + 四个四分之一圆弧，顺时针闭合。 */
const rectPoints = (x, y, w, h, rxIn, ryIn) => {
    const rx = Math.min(Math.max(0, rxIn), w / 2);
    const ry = Math.min(Math.max(0, ryIn), h / 2);
    if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    const corner = (cx, cy, from) => Array.from({ length: 7 }, (_, i) => {
        const a = from + (i / 6) * (Math.PI / 2);
        return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    });
    const points = [
        ...corner(x + w - rx, y + ry, -Math.PI / 2),
        ...corner(x + w - rx, y + h - ry, 0),
        ...corner(x + rx, y + h - ry, Math.PI / 2),
        ...corner(x + rx, y + ry, Math.PI),
    ];
    points.push(points[0]);
    return points;
};

const pointList = (value) => {
    const numbers = String(value ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const points = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
    return points;
};

/** SVG 椭圆弧（端点参数化）→ 折线（不含起点）。按 SVG 规范换成圆心参数化，半径不够时等比放大。 */
const arcToPoints = (
    from, rxIn, ryIn, angleDeg, largeArc, sweep, to,
) => {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [to];
    const phi = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (from[0] - to[0]) / 2;
    const dy = (from[1] - to[1]) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / Math.max(denominator, 1e-12)));
    const cx1 = (factor * rx * y1) / ry;
    const cy1 = (-factor * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
    const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
    const angleOf = (ux, uy) => Math.atan2(uy, ux);
    const start = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start;
    if (sweep && delta < 0) delta += Math.PI * 2;
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * CIRCLE_STEPS));
    const points = [];
    for (let i = 1; i <= steps; i += 1) {
        const a = start + (delta * i) / steps;
        const ex = Math.cos(a) * rx;
        const ey = Math.sin(a) * ry;
        points.push(i === steps ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
    }
    return points;
};

const cubicTo = (p0, p1, p2, p3) => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
});

const quadTo = (p0, p1, p2) => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS;
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
});

/**
 * SVG path 的 d → 折线（每个子路径一条）。支持全部命令（M L H V C S Q T A Z，大小写）；
 * 弧的两个标志位可以不带分隔符紧挨着写（lucide 的压缩写法「a4.5 4.5 0 1 1 7.5 12」「a2 2 0 012 2」）。
 */
const svgPathToPolylines = (d) => {
    const result = [];
    let index = 0;
    const skip = () => {
        while (index < d.length && /[\s,]/.test(d[index])) index += 1;
    };
    const readNumber = () => {
        skip();
        const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(index));
        if (!match) return null;
        index += match[0].length;
        return Number(match[0]);
    };
    const readFlag = () => {
        skip();
        const char = d[index];
        if (char !== '0' && char !== '1') return null;
        index += 1;
        return char === '1';
    };
    const hasNumber = () => {
        skip();
        return index < d.length && /[+\-.\d]/.test(d[index]);
    };

    let current = [0, 0];
    let start = [0, 0];
    let points = [];
    let lastControl = null;
    let lastKind = '';
    const flush = (closed) => {
        if (points.length > 1) result.push({ points, closed });
        points = [];
    };

    while (index < d.length) {
        skip();
        if (index >= d.length) break;
        const command = d[index];
        if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command)) break;
        index += 1;
        const relative = command === command.toLowerCase();
        const kind = command.toUpperCase();
        const abs = (x, y) => (relative ? [current[0] + x, current[1] + y] : [x, y]);
        if (kind === 'Z') {
            if (points.length > 0) {
                points.push(start);
                flush(true);
            }
            current = start;
            lastControl = null;
            lastKind = kind;
            continue;
        }
        let first = true;
        do {
            if (kind === 'M') {
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                const target = abs(x, y);
                // M 后面的坐标对按 L 处理。
                if (first) {
                    flush(false);
                    start = target;
                    points = [target];
                } else {
                    points.push(target);
                }
                current = target;
                lastControl = null;
            } else if (kind === 'L') {
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                current = abs(x, y);
                points.push(current);
                lastControl = null;
            } else if (kind === 'H') {
                const x = readNumber();
                if (x === null) break;
                current = [relative ? current[0] + x : x, current[1]];
                points.push(current);
                lastControl = null;
            } else if (kind === 'V') {
                const y = readNumber();
                if (y === null) break;
                current = [current[0], relative ? current[1] + y : y];
                points.push(current);
                lastControl = null;
            } else if (kind === 'C' || kind === 'S') {
                let c1;
                if (kind === 'C') {
                    const x1 = readNumber(); const y1 = readNumber();
                    if (x1 === null || y1 === null) break;
                    c1 = abs(x1, y1);
                } else {
                    c1 = lastControl && (lastKind === 'C' || lastKind === 'S')
                        ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
                        : current;
                }
                const x2 = readNumber(); const y2 = readNumber(); const x = readNumber(); const y = readNumber();
                if (x2 === null || y2 === null || x === null || y === null) break;
                const c2 = abs(x2, y2);
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...cubicTo(current, c1, c2, end));
                current = end;
                lastControl = c2;
            } else if (kind === 'Q' || kind === 'T') {
                let c;
                if (kind === 'Q') {
                    const x1 = readNumber(); const y1 = readNumber();
                    if (x1 === null || y1 === null) break;
                    c = abs(x1, y1);
                } else {
                    c = lastControl && (lastKind === 'Q' || lastKind === 'T')
                        ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
                        : current;
                }
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...quadTo(current, c, end));
                current = end;
                lastControl = c;
            } else if (kind === 'A') {
                const rx = readNumber(); const ry = readNumber(); const angle = readNumber();
                const large = readFlag(); const sweep = readFlag();
                const x = readNumber(); const y = readNumber();
                if (rx === null || ry === null || angle === null || large === null || sweep === null || x === null || y === null) break;
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...arcToPoints(current, rx, ry, angle, large, sweep, end));
                current = end;
                lastControl = null;
            }
            // 同一命令后面可以连着多组参数。
            lastKind = kind;
            first = false;
        } while (hasNumber());
    }
    flush(false);
    return result;
};

/** 一个 lucide 节点 → 折线。未知元素忽略。 */
const nodeToPolylines = (tag, attrs) => {
    switch (tag) {
        case 'path':
            return svgPathToPolylines(String(attrs.d ?? ''));
        case 'circle': {
            const r = num(attrs.r);
            return r > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), r, r), closed: true }] : [];
        }
        case 'ellipse': {
            const rx = num(attrs.rx);
            const ry = num(attrs.ry);
            return rx > 0 && ry > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), rx, ry), closed: true }] : [];
        }
        case 'line':
            return [{ points: [[num(attrs.x1), num(attrs.y1)], [num(attrs.x2), num(attrs.y2)]], closed: false }];
        case 'rect': {
            const w = num(attrs.width);
            const h = num(attrs.height);
            if (w <= 0 || h <= 0) return [];
            // SVG：只给 rx 或 ry 之一时另一个取同值。
            const rx = attrs.rx !== undefined ? num(attrs.rx) : num(attrs.ry);
            const ry = attrs.ry !== undefined ? num(attrs.ry) : rx;
            return [{ points: rectPoints(num(attrs.x), num(attrs.y), w, h, rx, ry), closed: true }];
        }
        case 'polyline':
        case 'polygon': {
            const points = pointList(attrs.points);
            if (tag === 'polygon' && points.length > 2) points.push(points[0]);
            return points.length > 1 ? [{ points, closed: tag === 'polygon' }] : [];
        }
        default:
            return [];
    }
};

/** 图标节点（lucide 的 IconNode：[tag, attrs, children?][]）→ 折线，坐标在 24×24 viewBox 里；带子节点的（g）递归展开。 */
const iconNodeToPolylines = (node) => (
    node.flatMap(entry => {
        const [tag, attrs, children] = entry;
        return [
            ...nodeToPolylines(tag, attrs),
            ...(Array.isArray(children) ? iconNodeToPolylines(children) : []),
        ];
    })
);

/**
 * 取 lucide-react 图标组件里的 IconNode：组件是 forwardRef，它的 render 只是
 * createElement(Icon, { iconNode, ... })（1.48 起是 { icon: { node, ... } }），不跑 hooks，直接调用即可拿到节点数据，
 * 不必渲染 SVG 再解析。
 */
const readIconNode = (name) => {
    const icon = resolveLucideIcon(name);
    if (!icon || typeof icon.render !== 'function') return null;
    try {
        const element = icon.render({}, null);
        const node = element?.props?.iconNode ?? element?.props?.icon?.node;
        return Array.isArray(node) ? node: null;
    } catch {
        return null;
    }
};

const cache = new Map();

/** 按图标名（lucide 的 PascalCase 导出名）取折线；未知图标返回 null。结果按名字缓存。 */
const lucideIconPolylines = (name) => {
    if (cache.has(name)) return cache.get(name);
    const node = readIconNode(name);
    const polylines = node ? iconNodeToPolylines(node).filter(polyline => polyline.points.length > 1) : null;
    const value = polylines && polylines.length > 0 ? polylines : null;
    cache.set(name, value);
    return value;
};

  /* ---- lineart/themeIcons.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/lineart/themeIcons.ts
// 主题图标线稿：theme.lyricsIcons（已解析成 lucide 名）按种子散落在构图的空处——避开文字区、画面边缘和
// 彼此——每枚按图标自己的折线描出来，和量角器光环、叶片同一种金色细线，节点上有闪点。
// 一个镜头一组（场景按镜头交叉渐变）；没有可用图标时返回空的线稿。坐标一律高度单位。

/** 文字区（高度单位，中心 + 宽高）。 */



/** 图标边长范围、与文字区 / 彼此之间留的空、离画面边缘的距离（高度单位）。 */
const ICON_SIZE  = [0.085, 0.13];
const TEXT_PAD = 0.05;
const EDGE = 0.05;
const ATTEMPTS = 48;

const overlapsRegion = (cx, cy, half, region, pad) => (
    Math.abs(cx - region.cx) < half + region.w / 2 + pad
    && Math.abs(cy - region.cy) < half + region.h / 2 + pad
);

/**
 * 按种子给图标找落点：在画面内（留边）随机取位置，拒绝与文字区（外扩 TEXT_PAD）或已放下的图标重叠的候选。
 * 找不到空处的图标就不放（文字区占满画面时可能一枚都没有）。
 */
const placeThemeIcons = (options) => {
    const names = options.names.filter(name => lucideIconPolylines(name) !== null);
    if (names.length === 0) return [];
    const { aspect, avoid, random } = options;
    const count = options.count ?? 2 + (random() < 0.5 ? 1 : 0);
    const offset = options.offset ?? 0;
    const placed = [];
    for (let i = 0; i < count; i += 1) {
        const name = names[(offset + i) % names.length];
        const size = ICON_SIZE[0] + random() * (ICON_SIZE[1] - ICON_SIZE[0]);
        const rotation = (random() - 0.5) * 0.3;
        const half = size * 0.72; // 转动后的外接半径（留一点余量）
        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
            const cx = EDGE + half + random() * Math.max(0, aspect - 2 * (EDGE + half));
            const cy = EDGE + half + random() * Math.max(0, 1 - 2 * (EDGE + half));
            if (overlapsRegion(cx, cy, half, avoid, TEXT_PAD)) continue;
            if (placed.some(other => Math.hypot(other.cx - cx, other.cy - cy) < (other.size + size) * 0.9)) continue;
            placed.push({ name, cx, cy, size, rotation });
            break;
        }
    }
    return placed;
};

/** 图标折线（viewBox 坐标）→ 画面折线：以图标中心为原点缩放、转动、平移。 */
const transformPolyline = (polyline, icon) => {
    const scale = icon.size / ICON_VIEWBOX;
    const cos = Math.cos(icon.rotation);
    const sin = Math.sin(icon.rotation);
    const half = ICON_VIEWBOX / 2;
    return polyline.points.map(([x, y]) => {
        const lx = (x - half) * scale;
        const ly = (y - half) * scale;
        return [icon.cx + lx * cos - ly * sin, icon.cy + lx * sin + ly * cos];
    });
};

const polylineLength = (points) => {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return length;
};

/**
 * 摆好的图标 → 线稿：每枚依次开始描（错开 0.12），图标内的笔画再各错开一点；最长那一笔的起点与
 * 另一个按种子挑的端点上各有一个闪点，笔画描到时出现。
 */
const themeIconsArt = (icons, random, delay = 0.18, alpha = 0.5) => {
    const paths = [];
    const nodes = [];
    icons.forEach((icon, iconIndex) => {
        const polylines = lucideIconPolylines(icon.name);
        if (!polylines) return;
        const start = delay + iconIndex * 0.12;
        const strokes = polylines.map(polyline => transformPolyline(polyline, icon));
        strokes.forEach((points, strokeIndex) => {
            paths.push({
                points,
                width: 0.0013,
                alpha,
                delay: start + Math.min(strokeIndex, 8) * 0.035,
                span: 0.32,
            });
        });
        const longest = strokes.reduce((best, points, index) => (polylineLength(points) > polylineLength(strokes[best]) ? index : best), 0);
        nodes.push({ at: strokes[longest][0], size: 0.02, delay: start + 0.08, twinklePhase: random() * Math.PI * 2 });
        const other = strokes[Math.floor(random() * strokes.length)];
        if (strokes.length > 1) {
            nodes.push({ at: other[other.length - 1], size: 0.015, delay: start + 0.3, twinklePhase: random() * Math.PI * 2 });
        }
    });
    return { paths, nodes };
};

/** 一个镜头的主题图标线稿：找落点 + 画成线稿。没有可用图标时是空的。 */
const buildThemeIconArt = (options) => {
    const icons = placeThemeIcons(options);
    return themeIconsArt(icons, options.random, options.delay, options.alpha);
};

/**
 * 场景单元里每个镜头的主题图标线稿（与镜头一一对应）。开关关掉、主题没有图标或图标名都无效时返回空数组——
 * 不退回默认图标。每个镜头按 `${seed}:${镜头序号}:${光位}:icons` 播种，并轮到不同的图标。
 */
const buildShotIconArts = (options) => {
    if (!options.enabled) return [];
    const names = resolveLucideIconNames(options.icons).filter(name => lucideIconPolylines(name) !== null);
    if (names.length === 0) return [];
    return options.shotKinds.map((kind, index) => buildThemeIconArt({
        names,
        aspect: options.aspect,
        avoid: options.avoid,
        random: createRng(`${options.seed}:${index}:${kind}:icons`),
        offset: index * 2,
    }));
};

  /* ---- lineart/diagrams.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/lineart/diagrams.ts
// L3 各族的线稿图解：窗、棱镜、焦散、光路、干涉、植物、天体、舞台。坐标一律高度单位（x 在 0..aspect），
// 每个函数返回 LineArtSpec，按 delay 错开描线。风格统一：主线 0.0016–0.0024、辅助线 0.0008–0.0012、
// 虚线用于光轴 / 法线 / 虚像。
const TAU = Math.PI * (2);

// ---------------------------------------------------------------------------------------------
// 积木


const path = (points, style = {}) => ({
    points,
    width: style.width ?? 0.0016,
    alpha: style.alpha ?? 0.55,
    delay: style.delay ?? 0,
    span: style.span ?? 0.4,
    ...(style.dash ? { dash: style.dash } : {}),
});

const node = (at, size = 0.018, delay = 0.4, twinklePhase = 0) => ({ at, size, delay, twinklePhase });

const segment = (a, b, style = {}) => path([a, b], style);

/** 圆 / 椭圆（可旋转）。 */
const ellipsePath = (cx, cy, rx, ry, rotation = 0, from = 0, to = TAU, steps = 96) => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return arcPoints(0, 0, 1, from, to, steps).map(([x, y]) => [cx + x * rx * cos - y * ry * sin, cy + x * rx * sin + y * ry * cos]);
};

const circle = (cx, cy, r, style = {}) => path(ellipsePath(cx, cy, r, r), style);

const merge = (...specs) => ({
    paths: specs.flatMap(spec => spec.paths),
    nodes: specs.flatMap(spec => spec.nodes),
});

/** 放射线：从 r0 到 r1、在 from..to 角度之间均匀 count 条。 */
const rays = (cx, cy, r0, r1, count, from = 0, to = TAU, style = {}) => ({
    paths: Array.from({ length: count }, (_, i) => {
        const a = from + ((to - from) * (i + (to - from >= TAU - 1e-6 ? 0 : 0.5))) / count;
        return segment([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], {
            width: 0.001, alpha: 0.4, ...style, delay: (style.delay ?? 0) + (i / count) * 0.3, span: style.span ?? 0.2,
        });
    }),
    nodes: [],
});

const concentric = (cx, cy, radii, style = {}) => ({
    paths: radii.map((r, i) => circle(cx, cy, r, { width: 0.0011, alpha: 0.45, ...style, delay: (style.delay ?? 0) + i * 0.06 })),
    nodes: [],
});

// ---------------------------------------------------------------------------------------------
// 窗隙

/** 十字窗：窗框 + 十字窗棂。 */
const crossWindow = (x, y, w, h, style = {}) => ({
    paths: [
        path([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], { width: 0.002, alpha: 0.55, ...style }),
        segment([x + w / 2, y], [x + w / 2, y + h], { width: 0.0014, alpha: 0.45, delay: (style.delay ?? 0) + 0.15 }),
        segment([x, y + h / 2], [x + w, y + h / 2], { width: 0.0014, alpha: 0.45, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([x + w / 2, y + h / 2], 0.02, (style.delay ?? 0) + 0.4)],
});

/** 拱窗：矩形窗身 + 半圆拱顶。 */
const archWindow = (x, y, w, h, style = {}) => {
    const r = w / 2;
    const top = y + r;
    return {
        paths: [
            path([[x, y + h], [x, top], ...arcPoints(x + r, top, r, Math.PI, TAU, 40), [x + w, y + h], [x, y + h]], { width: 0.0018, alpha: 0.55, ...style }),
            segment([x + r, y], [x + r, y + h], { width: 0.001, alpha: 0.35, delay: (style.delay ?? 0) + 0.2 }),
        ],
        nodes: [node([x + r, y + 0.01], 0.018, (style.delay ?? 0) + 0.4)],
    };
};

/** 玫瑰窗：外圈、内圈、辐条与花瓣。 */
const roseWindow = (cx, cy, r, style = {}) => merge(
    concentric(cx, cy, [r, r * 0.62, r * 0.22], { width: 0.0016, alpha: 0.55, ...style }),
    rays(cx, cy, r * 0.22, r, 12, 0, TAU, { delay: (style.delay ?? 0) + 0.2 }),
    {
        paths: Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * TAU;
            return circle(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, r * 0.14, { width: 0.0009, alpha: 0.35, delay: (style.delay ?? 0) + 0.35 + i * 0.02 });
        }),
        nodes: [node([cx, cy], 0.028, (style.delay ?? 0) + 0.5)],
    },
);

/** 门缝：两扇门的边线，中间一道缝。 */
const doorSlit = (cx, top, bottom, gap, style = {}) => ({
    paths: [
        segment([cx - gap / 2, top], [cx - gap / 2, bottom], { width: 0.0018, alpha: 0.55, ...style }),
        segment([cx + gap / 2, top], [cx + gap / 2, bottom], { width: 0.0018, alpha: 0.55, ...style, delay: (style.delay ?? 0) + 0.05 }),
        segment([cx - gap / 2 - 0.25, bottom], [cx + gap / 2 + 0.25, bottom], { width: 0.001, alpha: 0.35, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([cx, top + 0.02], 0.02, (style.delay ?? 0) + 0.4)],
});

/** 方格：障子、格栅（diagonal 为斜向菱格）。 */
const gridPanel = (x, y, w, h, cols, rows, diagonal = false, style = {}) => {
    const paths = [path([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], { width: 0.0018, alpha: 0.5, ...style })];
    const inner = { width: 0.0009, alpha: 0.32, delay: (style.delay ?? 0) + 0.15, span: 0.25 };
    if (diagonal) {
        const n = cols + rows;
        for (let i = 1; i < n; i += 1) {
            const t = i / n;
            paths.push(segment([x + w * Math.min(1, t * 2), y + h * Math.max(0, t * 2 - 1)], [x + w * Math.max(0, t * 2 - 1), y + h * Math.min(1, t * 2)], inner));
            paths.push(segment([x + w * (1 - Math.min(1, t * 2)), y + h * Math.max(0, t * 2 - 1)], [x + w * (1 - Math.max(0, t * 2 - 1)), y + h * Math.min(1, t * 2)], inner));
        }
    } else {
        for (let i = 1; i < cols; i += 1) paths.push(segment([x + (w * i) / cols, y], [x + (w * i) / cols, y + h], inner));
        for (let j = 1; j < rows; j += 1) paths.push(segment([x, y + (h * j) / rows], [x + w, y + (h * j) / rows], inner));
    }
    return { paths, nodes: [] };
};

/** 殿堂：一排高窗。 */
const tallWindows = (x0, x1, y, h, count, style = {}) => merge(
    ...Array.from({ length: count }, (_, i) => {
        const w = ((x1 - x0) / count) * 0.45;
        const x = x0 + ((x1 - x0) * (i + 0.5)) / count - w / 2;
        return archWindow(x, y, w, h, { alpha: 0.45, ...style, delay: (style.delay ?? 0) + i * 0.07 });
    }),
);

// ---------------------------------------------------------------------------------------------
// 棱镜

/** 碎晶：散落的小三角晶片。 */
const shards = (aspect, random, count, style = {}) => ({
    paths: Array.from({ length: count }, (_, i) => {
        const cx = (0.1 + random() * 0.8) * aspect;
        const cy = 0.12 + random() * 0.76;
        const r = 0.025 + random() * 0.05;
        const a = random() * TAU;
        const points = [0, 1, 2, 0].map(k => [cx + Math.cos(a + (k * TAU) / 3) * r, cy + Math.sin(a + (k * TAU) / 3) * r * (0.7 + random() * 0.6)]);
        return path(points, { width: 0.0014, alpha: 0.5, ...style, delay: (style.delay ?? 0) + i * 0.04, span: 0.25 });
    }),
    nodes: [],
});

/** 发射谱线：一排长短不一的竖线（下面一条刻度基线）。 */
const spectrumLines = (x0, x1, y, h, random, count, style = {}) => ({
    paths: [
        segment([x0, y + h / 2], [x1, y + h / 2], { width: 0.001, alpha: 0.35, ...style }),
        ...Array.from({ length: count }, (_, i) => {
            const x = x0 + (x1 - x0) * (0.05 + 0.9 * random());
            const k = 0.3 + random() * 0.7;
            return segment([x, y + h / 2], [x, y + h / 2 - h * k], { width: 0.0012 + random() * 0.0012, alpha: 0.4 + k * 0.3, delay: (style.delay ?? 0) + 0.1 + i * 0.03, span: 0.2 });
        }),
    ],
    nodes: [],
});

/** 立方分光镜：正方形 + 对角的分光面。 */
const cubeSplitter = (cx, cy, size, style = {}) => ({
    paths: [
        path([[cx - size / 2, cy - size / 2], [cx + size / 2, cy - size / 2], [cx + size / 2, cy + size / 2], [cx - size / 2, cy + size / 2], [cx - size / 2, cy - size / 2]], { width: 0.002, alpha: 0.6, ...style }),
        segment([cx - size / 2, cy + size / 2], [cx + size / 2, cy - size / 2], { width: 0.0012, alpha: 0.45, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([cx, cy], 0.022, (style.delay ?? 0) + 0.35)],
});

/** 虹与霓：两道同心弧。 */
const rainbowArcs = (cx, cy, r, style = {}) => ({
    paths: [
        path(arcPoints(cx, cy, r, Math.PI * 1.08, Math.PI * 1.92, 72), { width: 0.0018, alpha: 0.5, ...style }),
        path(arcPoints(cx, cy, r * 1.18, Math.PI * 1.1, Math.PI * 1.9, 72), { width: 0.001, alpha: 0.3, delay: (style.delay ?? 0) + 0.15, dash: [0.006, 0.01] }),
        circle(cx, cy - r * 0.4, 0.03, { width: 0.0012, alpha: 0.45, delay: (style.delay ?? 0) + 0.3 }),
    ],
    nodes: [],
});

// ---------------------------------------------------------------------------------------------
// 焦散

/** 玻璃杯：杯口椭圆 + 杯身。 */
const glassCup = (cx, top, w, h, style = {}) => ({
    paths: [
        path(ellipsePath(cx, top, w / 2, w * 0.12), { width: 0.0016, alpha: 0.5, ...style }),
        path([[cx - w / 2, top], [cx - w * 0.4, top + h], [cx + w * 0.4, top + h], [cx + w / 2, top]], { width: 0.0016, alpha: 0.5, delay: (style.delay ?? 0) + 0.1 }),
        path(ellipsePath(cx, top + h, w * 0.4, w * 0.09, 0, 0, Math.PI), { width: 0.001, alpha: 0.35, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([cx - w * 0.3, top + h * 0.3], 0.016, (style.delay ?? 0) + 0.35)],
});

/** 涟漪：同心圆（扁）。 */
const ripples = (cx, cy, r, count, style = {}) => ({
    paths: Array.from({ length: count }, (_, i) => path(ellipsePath(cx, cy, r * (i + 1) / count, r * 0.3 * (i + 1) / count), {
        width: 0.0012, alpha: 0.5 - i * 0.07, ...style, delay: (style.delay ?? 0) + i * 0.08,
    })),
    nodes: [node([cx, cy], 0.02, (style.delay ?? 0) + 0.3)],
});

/** 水面：一条起伏的线（从下往上看的水面）。 */
const waterline = (aspect, y, amplitude, waves, style = {}) => ({
    paths: [path(Array.from({ length: 121 }, (_, i) => {
        const x = (i / 120) * aspect;
        return [x, y + Math.sin((i / 120) * waves * TAU) * amplitude];
    }), { width: 0.0014, alpha: 0.45, ...style, span: 0.6 })],
    nodes: [],
});

/** 放大镜：镜片圆 + 手柄。 */
const magnifier = (cx, cy, r, style = {}) => ({
    paths: [
        circle(cx, cy, r, { width: 0.0022, alpha: 0.6, ...style }),
        circle(cx, cy, r * 0.9, { width: 0.0009, alpha: 0.3, delay: (style.delay ?? 0) + 0.1 }),
        segment([cx + r * 0.7, cy + r * 0.7], [cx + r * 1.6, cy + r * 1.6], { width: 0.004, alpha: 0.5, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [],
});

/** 水晶：六边形晶面与内部的刻面线。 */
const crystal = (cx, cy, r, style = {}) => {
    const outer = Array.from({ length: 7 }, (_, i) => [cx + Math.cos((i * TAU) / 6) * r, cy + Math.sin((i * TAU) / 6) * r * 1.3]);
    return {
        paths: [
            path(outer, { width: 0.002, alpha: 0.55, ...style }),
            ...[0, 1, 2].map(i => segment(outer[i], outer[i + 3], { width: 0.0009, alpha: 0.3, delay: (style.delay ?? 0) + 0.15 + i * 0.05 })),
        ],
        nodes: outer.slice(0, 6).filter((_, i) => i % 2 === 0).map((at, i) => node(at, 0.016, (style.delay ?? 0) + 0.4, i)),
    };
};

// ---------------------------------------------------------------------------------------------
// 光路

/** 透镜：双凸（convex）或双凹（concave）的轮廓 + 贯穿的光轴虚线。 */
const lens = (cx, cy, h, convex, aspect, style = {}) => {
    const bulge = h * 0.18;
    const top = [cx, cy - h / 2];
    const bottom = [cx, cy + h / 2];
    const side = (sign) => cubicPoints(top, [cx + sign * (convex ? bulge : -bulge * 0.2) + (convex ? 0 : sign * bulge * 0.6), cy - h / 4], [cx + sign * (convex ? bulge : -bulge * 0.2) + (convex ? 0 : sign * bulge * 0.6), cy + h / 4], bottom, 32);
    const outline = convex ? [...side(1), ...side(-1).reverse()] : [
        [cx - bulge * 0.7, cy - h / 2], [cx + bulge * 0.7, cy - h / 2],
        ...cubicPoints([cx + bulge * 0.7, cy - h / 2], [cx + bulge * 0.1, cy - h / 4], [cx + bulge * 0.1, cy + h / 4], [cx + bulge * 0.7, cy + h / 2], 24),
        [cx - bulge * 0.7, cy + h / 2],
        ...cubicPoints([cx - bulge * 0.7, cy + h / 2], [cx - bulge * 0.1, cy + h / 4], [cx - bulge * 0.1, cy - h / 4], [cx - bulge * 0.7, cy - h / 2], 24),
    ];
    return {
        paths: [
            path(outline, { width: 0.002, alpha: 0.6, ...style }),
            segment([aspect * 0.05, cy], [aspect * 0.95, cy], { width: 0.0009, alpha: 0.3, delay: (style.delay ?? 0) + 0.1, dash: [0.008, 0.008], span: 0.5 }),
        ],
        nodes: [],
    };
};

/** 一条光线（折线），终点有闪点。 */
const rayPath = (points, style = {}) => ({
    paths: [path(points, { width: 0.0014, alpha: 0.6, span: 0.5, ...style })],
    nodes: [node(points[points.length - 1], 0.016, (style.delay ?? 0) + (style.span ?? 0.5), points.length)],
});

/** 焦点标记：小十字 + 标签位置的短横。 */
const focusMark = (x, y, style = {}) => ({
    paths: [
        segment([x - 0.012, y], [x + 0.012, y], { width: 0.0012, alpha: 0.55, ...style }),
        segment([x, y - 0.012], [x, y + 0.012], { width: 0.0012, alpha: 0.55, ...style }),
    ],
    nodes: [node([x, y], 0.024, (style.delay ?? 0) + 0.3)],
});

/** 平面镜：一条粗线、背面的斜线阴影、法线虚线与入射 / 反射角的小弧。 */
const mirror = (cx, cy, length, angle, style = {}) => {
    const dx = Math.cos(angle) * length / 2;
    const dy = Math.sin(angle) * length / 2;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const hatches = Array.from({ length: 10 }, (_, i) => {
        const t = -0.45 + (i / 9) * 0.9;
        const bx = cx + dx * 2 * t;
        const by = cy + dy * 2 * t;
        return segment([bx, by], [bx + nx * 0.015 - dx * 0.04, by + ny * 0.015 - dy * 0.04], { width: 0.0008, alpha: 0.3, delay: (style.delay ?? 0) + 0.2 + i * 0.01, span: 0.1 });
    });
    return {
        paths: [
            segment([cx - dx, cy - dy], [cx + dx, cy + dy], { width: 0.003, alpha: 0.6, ...style }),
            ...hatches,
            segment([cx, cy], [cx - nx * length * 0.5, cy - ny * length * 0.5], { width: 0.0009, alpha: 0.35, delay: (style.delay ?? 0) + 0.25, dash: [0.006, 0.006] }),
            path(arcPoints(cx, cy, length * 0.12, Math.atan2(-ny, -nx) - 0.5, Math.atan2(-ny, -nx) + 0.5, 20), { width: 0.0009, alpha: 0.4, delay: (style.delay ?? 0) + 0.35 }),
        ],
        nodes: [],
    };
};

/** 介质界面：一条横线，下半部分用细斜线表示另一种介质。 */
const interfaceLine = (aspect, y, style = {}) => ({
    paths: [
        segment([aspect * 0.06, y], [aspect * 0.94, y], { width: 0.002, alpha: 0.55, ...style, span: 0.5 }),
        ...Array.from({ length: 24 }, (_, i) => {
            const x = aspect * (0.08 + (i / 23) * 0.84);
            return segment([x, y + 0.01], [x - 0.02, y + 0.04], { width: 0.0008, alpha: 0.22, delay: (style.delay ?? 0) + 0.2 + i * 0.01, span: 0.1 });
        }),
    ],
    nodes: [],
});

/** 光具座：一条长刻度尺。 */
const ruler = (x0, x1, y, ticks, style = {}) => ({
    paths: [
        segment([x0, y], [x1, y], { width: 0.0016, alpha: 0.5, ...style, span: 0.5 }),
        ...Array.from({ length: ticks + 1 }, (_, i) => {
            const x = x0 + ((x1 - x0) * i) / ticks;
            const long = i % 5 === 0;
            return segment([x, y], [x, y + (long ? 0.02 : 0.01)], { width: 0.0008, alpha: 0.4, delay: (style.delay ?? 0) + 0.2 + i * 0.005, span: 0.08 });
        }),
    ],
    nodes: [],
});

/** 光纤：一条弯曲的双线管道。 */
const fiber = (points, thickness, style = {}) => {
    const center = cubicPoints(...points, 60);
    const offset = (sign) => center.map(([x, y], i) => {
        const [nx0, ny0] = center[Math.max(0, i - 1)];
        const [nx1, ny1] = center[Math.min(center.length - 1, i + 1)];
        const dx = nx1 - nx0;
        const dy = ny1 - ny0;
        const len = Math.hypot(dx, dy) || 1;
        return [x - (dy / len) * thickness * sign, y + (dx / len) * thickness * sign];
    });
    return {
        paths: [path(offset(1), { width: 0.0014, alpha: 0.5, ...style, span: 0.6 }), path(offset(-1), { width: 0.0014, alpha: 0.5, ...style, delay: (style.delay ?? 0) + 0.05, span: 0.6 })],
        nodes: [node(center[center.length - 1], 0.024, (style.delay ?? 0) + 0.6)],
    };
};

/** 暗箱：一个盒子，正面开小孔，背面有倒立的箭头像。 */
const pinholeBox = (cx, cy, w, h, style = {}) => ({
    paths: [
        path([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]], { width: 0.0018, alpha: 0.5, ...style }),
        segment([cx - w / 2 - 0.25, cy - h * 0.35], [cx - w / 2 - 0.25, cy + h * 0.35], { width: 0.0016, alpha: 0.45, delay: (style.delay ?? 0) + 0.1 }),
        segment([cx + w / 2 - 0.02, cy + h * 0.28], [cx + w / 2 - 0.02, cy - h * 0.28], { width: 0.0014, alpha: 0.4, delay: (style.delay ?? 0) + 0.3, dash: [0.005, 0.005] }),
        segment([cx - w / 2 - 0.25, cy - h * 0.35], [cx + w / 2 - 0.02, cy + h * 0.28], { width: 0.0008, alpha: 0.3, delay: (style.delay ?? 0) + 0.2 }),
        segment([cx - w / 2 - 0.25, cy + h * 0.35], [cx + w / 2 - 0.02, cy - h * 0.28], { width: 0.0008, alpha: 0.3, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([cx - w / 2, cy], 0.02, (style.delay ?? 0) + 0.3)],
});

// ---------------------------------------------------------------------------------------------
// 干涉

const rings = (cx, cy, r, count, style = {}) => concentric(
    cx, cy, Array.from({ length: count }, (_, i) => r * Math.sqrt((i + 1) / count)), style,
);

/** 光栅：一条带密集缝的横线。 */
const grating = (cx, y, width, slits, style = {}) => ({
    paths: [
        segment([cx - width / 2, y], [cx + width / 2, y], { width: 0.0022, alpha: 0.55, ...style }),
        ...Array.from({ length: slits }, (_, i) => {
            const x = cx - width * 0.3 + (width * 0.6 * i) / Math.max(1, slits - 1);
            return segment([x, y - 0.01], [x, y + 0.01], { width: 0.0008, alpha: 0.4, delay: (style.delay ?? 0) + 0.15 + i * 0.01, span: 0.1 });
        }),
    ],
    nodes: [],
});

/** 两个点源和各自的一圈圈波前。 */
const twoSources = (cx, cy, separation, r, style = {}) => merge(
    concentric(cx - separation / 2, cy, [r * 0.25, r * 0.5, r * 0.75, r], { alpha: 0.3, ...style }),
    concentric(cx + separation / 2, cy, [r * 0.25, r * 0.5, r * 0.75, r], { alpha: 0.3, ...style, delay: (style.delay ?? 0) + 0.1 }),
    { paths: [], nodes: [node([cx - separation / 2, cy], 0.024, 0.3), node([cx + separation / 2, cy], 0.024, 0.35, 1)] },
);

/** 莫尔：两组细平行线，第二组略转一个角度。 */
const moire = (cx, cy, size, count, rotation, style = {}) => {
    const set = (angle, delay) => Array.from({ length: count }, (_, i) => {
        const t = -0.5 + i / (count - 1);
        const ox = Math.cos(angle + Math.PI / 2) * t * size;
        const oy = Math.sin(angle + Math.PI / 2) * t * size;
        return segment([cx + ox - Math.cos(angle) * size / 2, cy + oy - Math.sin(angle) * size / 2], [cx + ox + Math.cos(angle) * size / 2, cy + oy + Math.sin(angle) * size / 2], {
            width: 0.0008, alpha: 0.3, ...style, delay: delay + i * 0.008, span: 0.15,
        });
    });
    return { paths: [...set(0, style.delay ?? 0), ...set(rotation, (style.delay ?? 0) + 0.2)], nodes: [] };
};

/** 驻波：几条上下对称的正弦（波腹与波节）。 */
const standingWave = (x0, x1, y, amplitude, loops, style = {}) => ({
    paths: [-1, -0.5, 0.5, 1].map((k, j) => path(Array.from({ length: 121 }, (_, i) => {
        const t = i / 120;
        return [x0 + (x1 - x0) * t, y + Math.sin(t * loops * Math.PI) * amplitude * k];
    }), { width: 0.0012, alpha: 0.35 + Math.abs(k) * 0.2, ...style, delay: (style.delay ?? 0) + j * 0.06, span: 0.5 })),
    nodes: Array.from({ length: loops + 1 }, (_, i) => node([x0 + ((x1 - x0) * i) / loops, y], 0.014, (style.delay ?? 0) + 0.5, i)),
});

/** 偏振片：两个圆，里面各一组平行线（第二组转过一个角度）。 */
const polarizers = (cx, cy, r, gap, rotation, style = {}) => {
    const disc = (x, angle, delay) => [
        circle(x, cy, r, { width: 0.0016, alpha: 0.5, ...style, delay }),
        ...Array.from({ length: 7 }, (_, i) => {
            const t = -0.75 + (i / 6) * 1.5;
            const half = Math.sqrt(Math.max(0, 1 - t * t)) * r;
            const ox = -Math.sin(angle) * t * r;
            const oy = Math.cos(angle) * t * r;
            return segment([x + ox - Math.cos(angle) * half, cy + oy - Math.sin(angle) * half], [x + ox + Math.cos(angle) * half, cy + oy + Math.sin(angle) * half], { width: 0.0008, alpha: 0.3, delay: delay + 0.15 + i * 0.02, span: 0.15 });
        }),
    ];
    return { paths: [...disc(cx - gap / 2, 0, style.delay ?? 0), ...disc(cx + gap / 2, rotation, (style.delay ?? 0) + 0.2)], nodes: [] };
};

// ---------------------------------------------------------------------------------------------
// 叶脉

/** 一片大叶：外轮廓、主脉与多对侧脉。 */
const bigLeaf = (cx, cy, length, angle, style = {}) => {
    const d = [Math.cos(angle), Math.sin(angle)];
    const n = [-d[1], d[0]];
    const at = (along, across) => [cx + d[0] * length * (along - 0.5) + n[0] * across, cy + d[1] * length * (along - 0.5) + n[1] * across];
    const bulge = length * 0.3;
    const paths = [
        path(cubicPoints(at(0, 0), at(0.3, bulge), at(0.75, bulge * 0.8), at(1, 0), 48), { width: 0.002, alpha: 0.6, ...style, span: 0.4 }),
        path(cubicPoints(at(0, 0), at(0.3, -bulge), at(0.75, -bulge * 0.8), at(1, 0), 48), { width: 0.002, alpha: 0.6, ...style, delay: (style.delay ?? 0) + 0.05, span: 0.4 }),
        path([at(-0.12, 0), at(1, 0)], { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.15, span: 0.4 }),
    ];
    for (let v = 1; v <= 6; v += 1) {
        const f = v / 7.5;
        for (const s of [1, -1]) {
            paths.push(path(cubicPoints(at(f, 0), at(f + 0.05, s * bulge * 0.3), at(f + 0.1, s * bulge * 0.55), at(f + 0.15, s * bulge * (0.8 - f * 0.35)), 16), {
                width: 0.0009, alpha: 0.4, delay: (style.delay ?? 0) + 0.25 + v * 0.05, span: 0.18,
            }));
        }
    }
    return { paths, nodes: [node(at(1, 0), 0.026, (style.delay ?? 0) + 0.6)] };
};

/** 林冠：从画面上方垂下的枝条（递归分叉）。 */
const canopy = (aspect, random, style = {}) => {
    const paths = [];
    const grow = (x, y, angle, length, depth, delay) => {
        const x1 = x + Math.cos(angle) * length;
        const y1 = y + Math.sin(angle) * length;
        paths.push(segment([x, y], [x1, y1], { width: 0.0008 + depth * 0.0005, alpha: 0.3 + depth * 0.08, delay, span: 0.2 }));
        if (depth <= 0) return;
        grow(x1, y1, angle - 0.35 - random() * 0.3, length * 0.72, depth - 1, delay + 0.08);
        grow(x1, y1, angle + 0.35 + random() * 0.3, length * 0.72, depth - 1, delay + 0.08);
    };
    [0.08, 0.35, 0.65, 0.92].forEach((fx, i) => grow(fx * aspect, -0.02, Math.PI / 2 + (random() - 0.5) * 0.6, 0.14, 4, (style.delay ?? 0) + i * 0.05));
    return { paths, nodes: [] };
};

/** 蕨卷：对数螺线 + 两侧的小叶片。 */
const fernCurl = (cx, cy, r, style = {}) => {
    const spiral = Array.from({ length: 140 }, (_, i) => {
        const t = i / 139;
        const a = t * TAU * 2.2;
        const rr = r * Math.exp(-t * 2.4);
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    });
    const stem = [[cx + r, cy], [cx + r, cy + r * 2.2]];
    const leaflets = Array.from({ length: 9 }, (_, i) => {
        const [x, y] = spiral[Math.floor((i / 9) * 90)];
        return circle(x, y, 0.008 + (1 - i / 9) * 0.01, { width: 0.0008, alpha: 0.35, delay: (style.delay ?? 0) + 0.4 + i * 0.03, span: 0.1 });
    });
    return { paths: [path(stem, { width: 0.0016, alpha: 0.5, ...style }), path(spiral, { width: 0.0016, alpha: 0.55, ...style, delay: (style.delay ?? 0) + 0.1, span: 0.5 }), ...leaflets], nodes: [] };
};

/** 种子：椭圆种子 + 向下长的须根。 */
const seedRoots = (cx, cy, random, style = {}) => ({
    paths: [
        path(ellipsePath(cx, cy, 0.025, 0.035, 0.3), { width: 0.002, alpha: 0.6, ...style }),
        ...Array.from({ length: 6 }, (_, i) => {
            const spread = (i - 2.5) * 0.05;
            return path(cubicPoints([cx, cy + 0.03], [cx + spread * 0.4, cy + 0.08], [cx + spread, cy + 0.12], [cx + spread * 1.4 + (random() - 0.5) * 0.04, cy + 0.2 + random() * 0.06], 24), {
                width: 0.0009, alpha: 0.4, delay: (style.delay ?? 0) + 0.2 + i * 0.05, span: 0.35,
            });
        }),
    ],
    nodes: [node([cx, cy - 0.04], 0.03, (style.delay ?? 0) + 0.2)],
});

/** 花：以中心为原点的一圈花瓣（每片一条闭合曲线）。 */
const bloom = (cx, cy, r, petals, style = {}) => ({
    paths: [
        ...Array.from({ length: petals }, (_, i) => {
            const a = (i / petals) * TAU;
            const d = [Math.cos(a), Math.sin(a)];
            const n = [-d[1], d[0]];
            const tip = [cx + d[0] * r, cy + d[1] * r];
            const w = r * 0.35;
            return path([
                ...cubicPoints([cx, cy], [cx + d[0] * r * 0.4 + n[0] * w, cy + d[1] * r * 0.4 + n[1] * w], [cx + d[0] * r * 0.9 + n[0] * w * 0.6, cy + d[1] * r * 0.9 + n[1] * w * 0.6], tip, 20),
                ...cubicPoints(tip, [cx + d[0] * r * 0.9 - n[0] * w * 0.6, cy + d[1] * r * 0.9 - n[1] * w * 0.6], [cx + d[0] * r * 0.4 - n[0] * w, cy + d[1] * r * 0.4 - n[1] * w], [cx, cy], 20),
            ], { width: 0.0016, alpha: 0.5, ...style, delay: (style.delay ?? 0) + i * 0.05, span: 0.3 });
        }),
        circle(cx, cy, r * 0.12, { width: 0.0012, alpha: 0.5, delay: (style.delay ?? 0) + 0.4 }),
    ],
    nodes: [node([cx, cy], 0.03, (style.delay ?? 0) + 0.5)],
});

/** 藤：一条向上攀的螺旋（正弦）+ 卷须。 */
const vine = (x, bottom, top, amplitude, turns, style = {}) => ({
    paths: [
        path(Array.from({ length: 161 }, (_, i) => {
            const t = i / 160;
            return [x + Math.sin(t * turns * TAU) * amplitude * (1 - t * 0.4), bottom + (top - bottom) * t];
        }), { width: 0.0016, alpha: 0.55, ...style, span: 0.7 }),
        segment([x, bottom], [x, top], { width: 0.0008, alpha: 0.25, delay: (style.delay ?? 0) + 0.1, dash: [0.005, 0.008], span: 0.5 }),
    ],
    nodes: [node([x, top], 0.024, (style.delay ?? 0) + 0.7)],
});

/** 显微视野：一个大圆视野 + 里面一群细胞（小椭圆）。 */
const cells = (cx, cy, r, random, count, style = {}) => ({
    paths: [
        circle(cx, cy, r, { width: 0.0022, alpha: 0.5, ...style }),
        ...Array.from({ length: count }, (_, i) => {
            const a = random() * TAU;
            const d = Math.sqrt(random()) * r * 0.8;
            return path(ellipsePath(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.012 + random() * 0.012, 0.008 + random() * 0.008, random() * Math.PI), {
                width: 0.0009, alpha: 0.4, delay: (style.delay ?? 0) + 0.15 + i * 0.02, span: 0.15,
            });
        }),
    ],
    nodes: [],
});

/** 分子：一个苯环（六边形 + 内圆）+ 几根键。 */
const molecule = (cx, cy, r, style = {}) => {
    const hex = Array.from({ length: 7 }, (_, i) => [cx + Math.cos((i * TAU) / 6 + Math.PI / 6) * r, cy + Math.sin((i * TAU) / 6 + Math.PI / 6) * r]);
    return {
        paths: [
            path(hex, { width: 0.0018, alpha: 0.55, ...style }),
            circle(cx, cy, r * 0.55, { width: 0.001, alpha: 0.35, delay: (style.delay ?? 0) + 0.2 }),
            ...[0, 2, 4].map((k, i) => {
                const [x, y] = hex[k];
                return segment([x, y], [x + (x - cx) * 0.8, y + (y - cy) * 0.8], { width: 0.0012, alpha: 0.45, delay: (style.delay ?? 0) + 0.3 + i * 0.05 });
            }),
        ],
        nodes: [0, 2, 4].map((k, i) => {
            const [x, y] = hex[k];
            return node([x + (x - cx) * 0.8, y + (y - cy) * 0.8], 0.02, (style.delay ?? 0) + 0.45, i);
        }),
    };
};

// ---------------------------------------------------------------------------------------------
// 星象

/** 轨道：一组同心椭圆（倾斜），每条上有一颗行星（闪点）。 */
const orbits = (cx, cy, radii, tilt, flatten, random, style = {}) => ({
    paths: radii.map((r, i) => path(ellipsePath(cx, cy, r, r * flatten, tilt), { width: 0.0012, alpha: 0.45, ...style, delay: (style.delay ?? 0) + i * 0.07, span: 0.5 })),
    nodes: [
        node([cx, cy], 0.04, (style.delay ?? 0) + 0.2),
        ...radii.map((r, i) => {
            const a = random() * TAU;
            const [x, y] = ellipsePath(cx, cy, r, r * flatten, tilt, a, a, 1)[0];
            return node([x, y], 0.018 + random() * 0.012, (style.delay ?? 0) + 0.5 + i * 0.05, i);
        }),
    ],
});

/** 星轨：围绕天极的一圈圈弧。 */
const starTrails = (cx, cy, random, count, maxR, style = {}) => ({
    paths: Array.from({ length: count }, (_, i) => {
        const r = maxR * (0.1 + random() * 0.9);
        const a = random() * TAU;
        const span = 0.4 + random() * 0.8;
        return path(arcPoints(cx, cy, r, a, a + span, 24), { width: 0.0008 + random() * 0.0008, alpha: 0.25 + random() * 0.3, ...style, delay: (style.delay ?? 0) + (i / count) * 0.4, span: 0.3 });
    }),
    nodes: [node([cx, cy], 0.03, (style.delay ?? 0) + 0.1)],
});

/** 六分仪：60° 的刻度弧、两条半径与一条视线。 */
const sextant = (cx, cy, r, style = {}) => merge(
    {
        paths: [
            path(arcPoints(cx, cy, r, Math.PI * 0.33, Math.PI * 0.67, 48), { width: 0.002, alpha: 0.6, ...style }),
            segment([cx, cy], [cx + Math.cos(Math.PI * 0.33) * r, cy + Math.sin(Math.PI * 0.33) * r], { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.1 }),
            segment([cx, cy], [cx + Math.cos(Math.PI * 0.67) * r, cy + Math.sin(Math.PI * 0.67) * r], { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.12 }),
            segment([cx, cy], [cx + Math.cos(Math.PI * 0.45) * r * 1.1, cy + Math.sin(Math.PI * 0.45) * r * 1.1], { width: 0.001, alpha: 0.45, delay: (style.delay ?? 0) + 0.3, dash: [0.006, 0.006] }),
            segment([cx - r * 0.9, cy - r * 0.2], [cx + r * 0.2, cy - r * 0.05], { width: 0.0009, alpha: 0.35, delay: (style.delay ?? 0) + 0.35, dash: [0.004, 0.006] }),
        ],
        nodes: [node([cx, cy], 0.022, (style.delay ?? 0) + 0.3)],
    },
    rays(cx, cy, r * 0.94, r, 30, Math.PI * 0.33, Math.PI * 0.67, { delay: (style.delay ?? 0) + 0.2, alpha: 0.4 }),
);

/** 星座：几颗星（闪点）连成折线。 */
const constellation = (aspect, random, count, region, style = {}) => {
    const [x0, y0, x1, y1] = region;
    const stars = Array.from({ length: count }, () => [(x0 + random() * (x1 - x0)) * aspect, y0 + random() * (y1 - y0)]);
    stars.sort((a, b) => a[0] - b[0]);
    return {
        paths: stars.slice(1).map((star, i) => segment(stars[i], star, { width: 0.001, alpha: 0.4, ...style, delay: (style.delay ?? 0) + 0.2 + i * 0.06, span: 0.2 })),
        nodes: stars.map((at, i) => node(at, 0.018 + random() * 0.016, (style.delay ?? 0) + i * 0.05, i)),
    };
};

/** 日冕 / 日食：一个圆盘（黑盘的边）+ 一圈长短不一的放射丝。 */
const corona = (cx, cy, r, random, style = {}) => ({
    paths: [
        circle(cx, cy, r, { width: 0.0024, alpha: 0.65, ...style }),
        ...Array.from({ length: 40 }, (_, i) => {
            const a = (i / 40) * TAU + random() * 0.05;
            const len = r * (0.25 + random() * 0.9);
            return segment([cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05], [cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len)], {
                width: 0.0008, alpha: 0.25 + random() * 0.3, delay: (style.delay ?? 0) + 0.2 + (i / 40) * 0.3, span: 0.15,
            });
        }),
    ],
    nodes: [node([cx + r * 0.7, cy - r * 0.7], 0.03, (style.delay ?? 0) + 0.5)],
});

/** 新月：两段弧围成的月牙。 */
const crescent = (cx, cy, r, style = {}) => ({
    paths: [
        path(arcPoints(cx, cy, r, Math.PI * 0.35, Math.PI * 1.65, 60), { width: 0.002, alpha: 0.6, ...style }),
        path(arcPoints(cx + r * 0.45, cy, r * 0.85, Math.PI * 0.58, Math.PI * 1.42, 60), { width: 0.0012, alpha: 0.4, delay: (style.delay ?? 0) + 0.15 }),
    ],
    nodes: [],
});

/** 浑天仪：几个倾斜的环 + 一根轴。 */
const armillary = (cx, cy, r, style = {}) => ({
    paths: [
        circle(cx, cy, r, { width: 0.002, alpha: 0.55, ...style }),
        path(ellipsePath(cx, cy, r, r * 0.3, 0), { width: 0.0014, alpha: 0.45, delay: (style.delay ?? 0) + 0.1 }),
        path(ellipsePath(cx, cy, r, r * 0.3, 0.41), { width: 0.0014, alpha: 0.45, delay: (style.delay ?? 0) + 0.15 }),
        path(ellipsePath(cx, cy, r * 0.3, r, 0), { width: 0.0012, alpha: 0.4, delay: (style.delay ?? 0) + 0.2 }),
        segment([cx - Math.sin(0.41) * r * 1.25, cy - Math.cos(0.41) * r * 1.25], [cx + Math.sin(0.41) * r * 1.25, cy + Math.cos(0.41) * r * 1.25], { width: 0.0012, alpha: 0.45, delay: (style.delay ?? 0) + 0.3 }),
    ],
    nodes: [node([cx, cy], 0.03, (style.delay ?? 0) + 0.3)],
});

/** 流星：几条斜向的光迹（头上有闪点）。 */
const meteors = (aspect, random, count, style = {}) => {
    const paths = [];
    const nodes = [];
    for (let i = 0; i < count; i += 1) {
        const x = (0.2 + random() * 0.8) * aspect;
        const y = random() * 0.5;
        const len = 0.12 + random() * 0.25;
        const head = [x - len * 0.8, y + len * 0.6];
        paths.push(segment([x, y], head, { width: 0.0012 + random() * 0.001, alpha: 0.45, ...style, delay: (style.delay ?? 0) + i * 0.08, span: 0.2 }));
        nodes.push(node(head, 0.02, (style.delay ?? 0) + i * 0.08 + 0.2, i));
    }
    return { paths, nodes };
};

// ---------------------------------------------------------------------------------------------
// 追光

/** 灯头：光源处的小梯形灯罩（朝向光束方向）。 */
const lampHead = (x, y, angle, size, style = {}) => {
    const d = [Math.cos(angle), Math.sin(angle)];
    const n = [-d[1], d[0]];
    const back = [x - d[0] * size, y - d[1] * size];
    const corners = [
        [back[0] + n[0] * size * 0.35, back[1] + n[1] * size * 0.35],
        [x + n[0] * size * 0.6, y + n[1] * size * 0.6],
        [x - n[0] * size * 0.6, y - n[1] * size * 0.6],
        [back[0] - n[0] * size * 0.35, back[1] - n[1] * size * 0.35],
    ];
    return { paths: [path([...corners, corners[0]], { width: 0.0018, alpha: 0.55, span: 0.3, ...style })], nodes: [] };
};

/** 帷幕：两侧各一片带褶皱的幕布（竖向波浪线）。 */
const curtains = (aspect, gap, style = {}) => ({
    paths: [-1, 1].flatMap(side => Array.from({ length: 6 }, (_, i) => {
        const base = aspect / 2 + side * (gap / 2 + i * 0.05);
        return path(Array.from({ length: 41 }, (_, k) => {
            const t = k / 40;
            return [base + Math.sin(t * 5 + i) * 0.008 * side, -0.02 + t * 1.04];
        }), { width: 0.001 + (5 - i) * 0.0002, alpha: 0.2 + (5 - i) * 0.05, ...style, delay: (style.delay ?? 0) + i * 0.05, span: 0.5 });
    })),
    nodes: [],
});

/** 放映机：侧面的机身、两个片盘。 */
const projector = (x, y, size, style = {}) => ({
    paths: [
        path([[x - size, y - size * 0.3], [x, y - size * 0.3], [x, y + size * 0.3], [x - size, y + size * 0.3], [x - size, y - size * 0.3]], { width: 0.0018, alpha: 0.55, ...style }),
        circle(x - size * 0.75, y - size * 0.65, size * 0.33, { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.1 }),
        circle(x - size * 0.25, y - size * 0.65, size * 0.33, { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.15 }),
        path([[x, y - size * 0.12], [x + size * 0.18, y - size * 0.18], [x + size * 0.18, y + size * 0.18], [x, y + size * 0.12]], { width: 0.0014, alpha: 0.5, delay: (style.delay ?? 0) + 0.2 }),
    ],
    nodes: [node([x + size * 0.18, y], 0.024, (style.delay ?? 0) + 0.3)],
});

// ---------------------------------------------------------------------------------------------
// 通用

/** 一条地平线（带短刻度）。 */
const horizon = (aspect, y, style = {}) => ({
    paths: [
        segment([0, y], [aspect, y], { width: 0.0014, alpha: 0.4, ...style, span: 0.6 }),
        ...Array.from({ length: 16 }, (_, i) => segment([aspect * (i + 0.5) / 16, y], [aspect * (i + 0.5) / 16, y + 0.012], { width: 0.0008, alpha: 0.3, delay: (style.delay ?? 0) + 0.3 + i * 0.01, span: 0.08 })),
    ],
    nodes: [],
});


  window.foliaLumiereLineart = {
    arcPoints: arcPoints,
    archWindow: archWindow,
    armillary: armillary,
    bigLeaf: bigLeaf,
    blindsWindow: blindsWindow,
    bloom: bloom,
    buildShotIconArts: buildShotIconArts,
    canopy: canopy,
    cells: cells,
    circle: circle,
    constellation: constellation,
    corona: corona,
    createLineArt: createLineArt,
    crescent: crescent,
    crossWindow: crossWindow,
    crystal: crystal,
    cubeSplitter: cubeSplitter,
    curtains: curtains,
    doorSlit: doorSlit,
    fernCurl: fernCurl,
    fiber: fiber,
    focusMark: focusMark,
    glassCup: glassCup,
    grating: grating,
    gridPanel: gridPanel,
    horizon: horizon,
    interfaceLine: interfaceLine,
    lampHead: lampHead,
    lens: lens,
    magnifier: magnifier,
    mergeDiagrams: merge,
    mergeSpecs: mergeSpecs,
    meteors: meteors,
    mirror: mirror,
    moire: moire,
    molecule: molecule,
    orbits: orbits,
    pinholeBox: pinholeBox,
    polarizers: polarizers,
    prismTriangle: prismTriangle,
    projector: projector,
    protractorHalo: protractorHalo,
    rainbowArcs: rainbowArcs,
    rayPath: rayPath,
    rings: rings,
    ripples: ripples,
    roseWindow: roseWindow,
    ruler: ruler,
    scatteredSparks: scatteredSparks,
    seedRoots: seedRoots,
    segment: segment,
    sextant: sextant,
    shards: shards,
    showLineArtLayer: showLineArtLayer,
    slitBarrier: slitBarrier,
    spectrumLines: spectrumLines,
    sprout: sprout,
    standingWave: standingWave,
    starTrails: starTrails,
    tallWindows: tallWindows,
    twoSources: twoSources,
    viewfinderFrame: viewfinderFrame,
    vine: vine,
    waterline: waterline
  };
}());
