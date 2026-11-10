/* lumiere 的光：舞台灯架、精灵、泛光、浮尘、星落、十字光爆、光场着色器。
 *
 * 从 Folia lumiere 的 7 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  if (!foliaLumiereCore) return;

  /* pixiFilterVertex.ts：Pixi 8 自定义滤镜共用的顶点着色器（逐字节照抄） */
  var PIXI_FILTER_VERTEX = "\nin vec2 aPosition;\nout vec2 vTextureCoord;\n\nuniform vec4 uInputSize;\nuniform vec4 uOutputFrame;\nuniform vec4 uOutputTexture;\n\nvoid main(void) {\n    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;\n    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;\n    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;\n    gl_Position = vec4(position, 0.0, 1.0);\n    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);\n}\n"

  var bloomVertex = PIXI_FILTER_VERTEX;
  var createRng = foliaLumiereCore.createRng;
  var hexOf = foliaLumiereCore.hexOf;
  var mixRgb = foliaLumiereCore.mixRgb;
  var WHITE = foliaLumiereCore.WHITE;

  /* ---- light/rig.ts ---- */
// Copyright (c) 2026 chthollyphile


// src/components/visualizer/lumiere/light/rig.ts
// 光位（rig）：一个镜头的光束、烟雾、光源眩光的声明式描述，以及光束强度的 CPU 算法。
// 着色器（lightFieldShader.ts）与这里用同一个公式：字与浮尘的亮度按 CPU 这一份算，光场按 GLSL 那一份画，
// 两边一致，光柱扫到哪里，哪里的字就亮。
//
// 坐标：光场内部一律用「以画面高度为 1」的单位（u = 像素 / 高度），y 向下；角度 0 = 向右，π/2 = 向下。
// 声明里的位置用画面比例（x 占宽、y 占高），解析时换算。
const MAX_BEAMS = 6;



/**
 * 窗影图样，在光束截面坐标里算：u = 横向位置（−1..1，光束两边），v = 沿光束的距离（高度单位）。
 * blinds：平行光带；cross：中间一道窗棂；lattice：斜交的菱格；leaves：斑驳的叶隙光斑。
 */


/** 焦散：水面焦散的光网，调制光束亮度，也可以在一块区域（池底）单独发亮。 */

/**
 * 干涉与衍射：在一块区域里发光的条纹。rings：牛顿环；slits：双缝条纹；sources：两个点源的圆波干涉；
 * airy：艾里斑（中心亮斑 + 外环）。
 */




const GOBO_PATTERN_ID = { blinds: 1, cross: 2, lattice: 3, leaves: 4 };
const WAVE_MODE_ID = { rings: 1, slits: 2, sources: 3, airy: 4 };

/** 解析到某一时刻、换算到高度单位的光束。 */


/** 低频把光束抬亮的上限（低频打满时亮 15%）。 */
const AUDIO_GAIN = 0.15;

/** 低频 → 光束亮度倍率：取 1.5 次方，弱的起伏几乎不动，只有重拍才抬起来。 */
const audioLift = (bass) => 1 + AUDIO_GAIN * Math.max(0, bass) ** 1.5;

const oscillate = (osc, time) => (
    osc ? osc.amplitude * Math.sin((time / Math.max(osc.period, 0.001) + osc.phase) * Math.PI * 2) : 0
);

const resolveBeams = (rig, time, aspect, drive) => (
    rig.beams.slice(0, MAX_BEAMS).map(beam => {
        const angle = beam.angle + oscillate(beam.sway, time);
        const pulse = 1 + oscillate(beam.pulse, time);
        const tint = beam.tint ?? [1, 1, 1];
        const reveal = beam.reveal && drive.local !== undefined
            ? 0.06 + 0.94 * smoothstep(0, 1, drive.local / beam.reveal)
            : 1;
        return {
            ox: beam.x * aspect,
            oy: beam.y,
            dx: Math.cos(angle),
            dy: Math.sin(angle),
            halfWidth: (beam.width ?? 0) / 2,
            tanSpread: Math.tan(beam.spread),
            softness: beam.softness,
            length: beam.length * reveal,
            intensity: beam.intensity * pulse * drive.intensity * audioLift(drive.bass),
            streaks: beam.streaks,
            streakFreq: beam.streakFreq,
            streakPhase: time * beam.streakSpeed,
            core: beam.core ?? 0.5,
            r: tint[0] * drive.color[0],
            g: tint[1] * drive.color[1],
            b: tint[2] * drive.color[2],
            goboPattern: beam.gobo ? GOBO_PATTERN_ID[beam.gobo.pattern] : 0,
            goboFreq: beam.gobo?.frequency ?? 0,
            goboDuty: beam.gobo?.duty ?? 1,
            goboPhase: (beam.gobo?.drift ?? 0) * time,
            spectrum: beam.spectrum ?? 0,
            reach: beam.reach ?? 0,
        };
    })
);

// ---------------------------------------------------------------------------------------------
// 与 GLSL 一致的噪声（Dave Hoskins 的 hash11，不用 sin，单精度下两边差得不多）

const fract = (value) => value - Math.floor(value);

const hash11 = (input) => {
    let p = fract(input * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
};

const valueNoise1 = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash11(i) * (1 - u) + hash11(i + 1) * u;
};

const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** GLSL 的 hash12（Dave Hoskins）。 */
const hash12 = (x, y) => {
    let a = fract(x * 0.1031);
    let b = fract(y * 0.1031);
    let c = fract(x * 0.1031);
    const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
    a += d;
    b += d;
    c += d;
    return fract((a + b) * c);
};

const valueNoise2 = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash12(ix, iy);
    const b = hash12(ix + 1, iy);
    const c = hash12(ix, iy + 1);
    const d = hash12(ix + 1, iy + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
};

/** 透光条：fract(x) 落在 [0, duty) 里为 1，边缘柔化。 */
const band = (x, duty) => {
    const f = fract(x);
    return 1 - smoothstep(duty - 0.06, duty + 0.06, f) + smoothstep(1 - 0.06, 1, f);
};

/** 窗影的影子里仍透过的散射光（全黑的条纹像条形码）。 */
const GOBO_LEAK = 0.12;

/** 窗影图样在截面坐标 (u, v) 上的透光率（GLSL 里的 goboMask 与此相同）。 */
const goboMask = (pattern, frequency, duty, phase, u, v) => (
    pattern > 0 ? GOBO_LEAK + (1 - GOBO_LEAK) * goboPattern(pattern, frequency, duty, phase, u, v) : 1
);

const goboPattern = (pattern, frequency, duty, phase, u, v) => {
    if (pattern === 1) return Math.min(1, band(u * frequency * 0.5 + phase, duty));
    if (pattern === 2) return smoothstep(duty * 0.5, duty * 0.5 + 0.08, Math.abs(u));
    if (pattern === 3) {
        return Math.min(1, band(u * frequency * 0.5 + v * frequency * 0.8 + phase, duty))
            * Math.min(1, band(u * frequency * 0.5 - v * frequency * 0.8 - phase, duty));
    }
    if (pattern === 4) return smoothstep(duty - 0.12, duty + 0.12, valueNoise2(u * frequency, v * frequency * 0.6 + phase));
    return 1;
};

/** 一束光在点 (x, y)（高度单位）处的强度（不含烟雾与颜色）。GLSL 里的 beamMask 与此相同。 */
const beamMask = (beam, x, y) => {
    const px = x - beam.ox;
    const py = y - beam.oy;
    const along = px * beam.dx + py * beam.dy;
    if (along <= 0) return 0;
    const perp = Math.abs(px * -beam.dy + py * beam.dx);
    // 取绝对值：会聚的光束过了焦点再散开。
    const half = Math.abs(beam.halfWidth + along * beam.tanSpread) + 1e-4;
    const s = perp / half;
    const edge = smoothstep(1, 1 - Math.max(beam.softness, 0.02), s);
    if (edge <= 0) return 0;
    const signed = s * Math.sign(px * -beam.dy + py * beam.dx);
    const streak = 1 - beam.streaks + beam.streaks * valueNoise1(signed * beam.streakFreq + beam.streakPhase);
    const core = 1 - beam.core + beam.core * (1 - s * s);
    const falloff = Math.exp(-along / Math.max(beam.length, 0.001));
    const gobo = beam.goboPattern > 0 ? goboMask(beam.goboPattern, beam.goboFreq, beam.goboDuty, beam.goboPhase, signed, along) : 1;
    // 射程末端的收尾随光束宽度变长：宽光束一刀切会变成方头。
    const reach = beam.reach > 0 ? 1 - smoothstep(beam.reach - Math.max(0.04, half * 2.5), beam.reach, along) : 1;
    // 从光源处平滑渐起：光源背后没有光，光源处的光束又有宽度，不渐起就会在光源处留一条硬直边。
    const start = smoothstep(0, Math.abs(beam.halfWidth) * 2 + 0.01, along);
    return edge * streak * core * falloff * gobo * reach * start * beam.intensity;
};

/** 所有光束在 (x, y) 处的总强度（高度单位坐标）。 */
const lightAt = (beams, x, y) => {
    let sum = 0;
    for (const beam of beams) sum += beamMask(beam, x, y);
    return sum;
};

/** 与着色器相同的柔和压缩（着色器按最大通道压，这里只有标量强度），避免交叠处爆白。 */
const compressLight = (value) => 1 - Math.exp(-value);

  /* ---- light/sprites.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/light/sprites.ts
// 程序生成的光学小贴图：柔光点（浮尘、字下光晕）、四芒星闪点、散景圆斑、横向拉丝。
// 画在 Canvas 2D 上、白色预乘，着色靠 tint。整个运行时建一份（各段落场景、片尾卡共用），运行时销毁时释放。


const canvasOf = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext('2d') };
};

const drawDot = (size) => {
    const { canvas, context } = canvasOf(size, size);
    const r = size / (2);
    const gradient = context.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.72)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
};

const drawStar = (size) => {
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const halo = context.createRadialGradient(r, r, 0, r, r, r * 0.5);
    halo.addColorStop(0, 'rgba(255,255,255,1)');
    halo.addColorStop(0.12, 'rgba(255,255,255,0.8)');
    halo.addColorStop(0.4, 'rgba(255,255,255,0.14)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);
    // 四条芒：细长的菱形，中间亮两端尖。
    context.globalCompositeOperation = 'lighter';
    const ray = (angle, length, thickness, alpha) => {
        context.save();
        context.translate(r, r);
        context.rotate(angle);
        const gradient = context.createLinearGradient(0, 0, length, 0);
        gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(0, -thickness);
        context.lineTo(length, 0);
        context.lineTo(0, thickness);
        context.closePath();
        context.fill();
        context.restore();
    };
    for (let i = 0; i < 4; i += 1) ray((Math.PI / 2) * i, r * 0.98, size * 0.018, 0.95);
    for (let i = 0; i < 4; i += 1) ray((Math.PI / 2) * i + Math.PI / 4, r * 0.42, size * 0.01, 0.45);
    return canvas;
};

const drawBokeh = (size) => {
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const gradient = context.createRadialGradient(r, r, 0, r, r, r * 0.96);
    gradient.addColorStop(0, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(0.9, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(r, r, r * 0.96, 0, Math.PI * 2);
    context.fill();
    return canvas;
};

const drawStreak = (width, height) => {
    const { canvas, context } = canvasOf(width, height);
    const horizontal = context.createLinearGradient(0, 0, width, 0);
    horizontal.addColorStop(0, 'rgba(255,255,255,0)');
    horizontal.addColorStop(0.5, 'rgba(255,255,255,1)');
    horizontal.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = horizontal;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    const vertical = context.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, 'rgba(255,255,255,0)');
    vertical.addColorStop(0.5, 'rgba(255,255,255,1)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = vertical;
    context.fillRect(0, 0, width, height);
    return canvas;
};

const createLightSprites = (pixi) => {
    const textures = {
        dot: pixi.Texture.from(drawDot(128)),
        star: pixi.Texture.from(drawStar(256)),
        bokeh: pixi.Texture.from(drawBokeh(128)),
        streak: pixi.Texture.from(drawStreak(512, 32)),
    };
    return {
        ...textures,
        destroy: () => Object.values(textures).forEach(texture => texture.destroy(true)),
    };
};

  /* ---- light/bloomFilter.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/light/bloomFilter.ts
// 绘光自己的 bloom：挂在场景自己的子容器上（图形组、文字组），不作用于共享背景层与素材层。
// 亮部提取（阈值 + 软膝）→ 逐级半分辨率降采样（dual filter）→ 逐级上采样并叠加同级 → 与原图相加。
//
// 每一级的临时纹理都与输入同样的逻辑尺寸、只降分辨率：Pixi 的 filter 按逻辑尺寸铺满输出，
// 这样 applyFilter 天然就是缩放。第二张纹理（同级 / 最终的 bloom）按两张源纹理的逻辑尺寸比换算 UV。

const downFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uParams; // threshold, knee, prefilter(0/1), 0

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv) * 4.0;
    sum += tap(uv - hp);
    sum += tap(uv + hp);
    sum += tap(uv + vec2(hp.x, -hp.y));
    sum += tap(uv - vec2(hp.x, -hp.y));
    vec4 c = sum / 8.0;
    if (uParams.z > 0.5) {
        float br = max(c.r, max(c.g, c.b));
        float knee = max(uParams.y, 1e-4);
        float soft = clamp(br - uParams.x + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee);
        float contrib = max(soft, br - uParams.x) / max(br, 1e-4);
        c *= clamp(contrib, 0.0, 1.0);
    }
    finalColor = c;
}
`;

const upFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、同级权重、0
uniform vec4 uAddClamp;

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv + vec2(-hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(-hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, hp.y * 2.0));
    sum += tap(uv + vec2(hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(hp.x, -hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, -hp.y * 2.0));
    sum += tap(uv + vec2(-hp.x, -hp.y)) * 2.0;
    vec4 up = sum / 12.0;
    vec4 same = texture(uAdd, clamp(uv * uAddMap.xy, uAddClamp.xy, uAddClamp.zw));
    finalColor = up + same * uAddMap.z;
}
`;

const combineFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、强度、0
uniform vec4 uAddClamp;
uniform vec4 uTint;     // 乘在 bloom 上的颜色

void main(void) {
    vec4 base = texture(uTexture, clamp(vTextureCoord, uInputClamp.xy, uInputClamp.zw));
    vec4 glow = texture(uAdd, clamp(vTextureCoord * uAddMap.xy, uAddClamp.xy, uAddClamp.zw)) * uAddMap.z;
    vec3 g = glow.rgb * uTint.rgb;
    // 加上去的辉光也是光：预乘、alpha 取最大通道（与光场一致，近似 screen）。
    vec3 rgb = base.rgb + g * (1.0 - base.a * 0.5);
    // 超过 1 时按最大通道整体缩回（保持金色），只让一小部分变白；逐通道截断会把亮字烧成白块。
    float peak = max(max(rgb.r, rgb.g), rgb.b);
    if (peak > 1.0) rgb = mix(rgb / peak, vec3(1.0), 0.2 * (1.0 - 1.0 / peak));
    float a = base.a + max(max(g.r, g.g), g.b) * (1.0 - base.a);
    finalColor = vec4(rgb, min(max(a, max(max(rgb.r, rgb.g), rgb.b)), 1.0));
}
`;



const createBloomFilter = (pixi, initial) => {
    const { Filter, GlProgram, TexturePool, UniformGroup } = pixi;
    /* 键名必须是 pixi 的 vertex（本文件的顶点源为避免与光场着色器的 vertex 重名而叫 bloomVertex，
     * 显式写键，不能写成简写——简写会把键名一起改成 bloomVertex，pixi 读 options.vertex 就是 undefined）。 */
    const program = (fragment, name) => GlProgram.from({ vertex: bloomVertex, fragment, name });

    const downUniforms = new UniformGroup({ uParams: { value: new Float32Array(4), type: 'vec4<f32>' } });
    const down = new Filter({ glProgram: program(downFragment, 'lumiere-bloom-down'), resources: { bloomDown: downUniforms } });

    const upUniforms = new UniformGroup({
        uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
        uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const up = new Filter({
        glProgram: program(upFragment, 'lumiere-bloom-up'),
        resources: { bloomUp: upUniforms, uAdd: pixi.Texture.EMPTY.source },
    });

    const combineUniforms = new UniformGroup({
        uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
        uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
        uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
    });
    const combine = new Filter({
        glProgram: program(combineFragment, 'lumiere-bloom-combine'),
        resources: { bloomCombine: combineUniforms, uAdd: pixi.Texture.EMPTY.source },
    });

    const mapFor = (from, to, target, clamp, weight) => {
        target[0] = from.source.width / to.source.width;
        target[1] = from.source.height / to.source.height;
        target[2] = weight;
        clamp[0] = 0.5 / to.source.pixelWidth;
        clamp[1] = 0.5 / to.source.pixelHeight;
        clamp[2] = to.frame.width / to.source.width - 0.5 / to.source.pixelWidth;
        clamp[3] = to.frame.height / to.source.height - 0.5 / to.source.pixelHeight;
    };

    class LumiereBloomFilter extends Filter {
        options;

        constructor(options) {
            super({ resources: {}, compatibleRenderers: pixi.RendererType.BOTH });
            this.options = { ...options };
            this.padding = options.padding;
        }

        apply(filterManager, input, output, clearMode) {
            const { strength, threshold, knee, levels, spread, tint } = this.options;
            if (strength <= 0) {
                mapFor(input, input, combineUniforms.uniforms.uAddMap, combineUniforms.uniforms.uAddClamp, 0);
                combineUniforms.update();
                combine.resources.uAdd = input.source;
                combine.blendMode = this.blendMode;
                filterManager.applyFilter(combine, input, output, clearMode);
                return;
            }
            const width = input.frame.width;
            const height = input.frame.height;
            const baseResolution = input.source.resolution;
            const chain = [];
            let source = input;
            const count = Math.max(1, Math.min(8, Math.round(levels)));
            for (let level = 1; level <= count; level += 1) {
                const resolution = baseResolution / 2 ** level;
                if (Math.min(width, height) * resolution < 2) break;
                // 用位置参数的签名：folia 装的 Pixi 8.20 还没有对象形式（8.21 起对象形式为主、位置参数仍可用）。
                const target = TexturePool.getOptimalTexture(width, height, resolution, false);
                const params = downUniforms.uniforms.uParams;
                params[0] = threshold;
                params[1] = knee;
                params[2] = level === 1 ? 1 : 0;
                downUniforms.update();
                down.blendMode = 'normal';
                filterManager.applyFilter(down, source, target, true);
                chain.push(target);
                source = target;
            }

            // 上采样：从最小一级往上，每一级叠加同级的降采样结果。
            let current = chain[chain.length - 1];
            const scratch = [];
            for (let index = chain.length - 2; index >= 0; index -= 1) {
                const same = chain[index];
                const target = TexturePool.getOptimalTexture(width, height, same.source.resolution, false);
                mapFor(current, same, upUniforms.uniforms.uAddMap, upUniforms.uniforms.uAddClamp, spread);
                upUniforms.update();
                up.resources.uAdd = same.source;
                up.blendMode = 'normal';
                filterManager.applyFilter(up, current, target, true);
                scratch.push(target);
                current = target;
            }

            mapFor(input, current, combineUniforms.uniforms.uAddMap, combineUniforms.uniforms.uAddClamp, strength);
            const tintUniform = combineUniforms.uniforms.uTint;
            tintUniform[0] = tint[0];
            tintUniform[1] = tint[1];
            tintUniform[2] = tint[2];
            combineUniforms.update();
            combine.resources.uAdd = current.source;
            combine.blendMode = this.blendMode;
            filterManager.applyFilter(combine, input, output, clearMode);

            chain.forEach(texture => TexturePool.returnTexture(texture));
            scratch.forEach(texture => TexturePool.returnTexture(texture));
        }

        destroy() {
            down.destroy();
            up.destroy();
            combine.destroy();
            super.destroy();
        }
    }

    return new LumiereBloomFilter(initial);
};

  /* ---- light/motes.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/light/motes.ts
// 浮尘与前景散景。位置是 (种子, t) 的闭式函数：基点 + 漂移 × t + 两个正弦叠成的涡动，按画面取模回绕，
// 不做逐帧积分，所以 renderAt(t) 与播放历史无关。亮度按光场的 CPU 公式取：进了光束才亮，出光束就熄。




const wrap = (value, min, max) => {
    const span = max - min;
    return min + ((((value - min) % span) + span) % span);
};

const createMotes = (
    pixi,
    options,
) => {
    const { width, height, spec, texture } = options;
    const aspect = width / height;
    const rng = createRng(options.seed);
    const view = new pixi.Container();
    const margin = 0.08;
    const motes = Array.from({ length: spec.count }, () => {
        const sprite = new pixi.Sprite(texture);
        sprite.anchor.set(0.5);
        view.addChild(sprite);
        const depth = rng();
        return {
            sprite,
            bx: rng() * (aspect + margin * 2) - margin,
            by: rng() * (1 + margin * 2) - margin,
            depth,
            size: spec.sizeMin + (spec.sizeMax - spec.sizeMin) * depth * depth,
            phaseA: rng() * Math.PI * 2,
            phaseB: rng() * Math.PI * 2,
            freqA: 0.6 + rng() * 0.8,
            freqB: 0.5 + rng() * 0.9,
            twinklePhase: rng() * Math.PI * 2,
            twinkleFreq: 0.8 + rng() * 2.2,
        };
    });

    const update = (time, beams, color, intensity) => {
        const omega = (Math.PI * 2) / Math.max(spec.swirlPeriod, 0.1);
        for (const mote of motes) {
            const speed = 0.45 + mote.depth * 0.9;
            const swirl = spec.swirl * (0.5 + mote.depth);
            const x = wrap(
                mote.bx + spec.driftX * speed * time + swirl * Math.sin(time * omega * mote.freqA + mote.phaseA),
                -margin, aspect + margin,
            );
            const y = wrap(
                mote.by + spec.driftY * speed * time + swirl * Math.cos(time * omega * mote.freqB + mote.phaseB),
                -margin, 1 + margin,
            );
            const lit = compressLight(lightAt(beams, x, y)) * spec.gain;
            const twinkle = 1 - spec.twinkle + spec.twinkle * (0.5 + 0.5 * Math.sin(time * mote.twinkleFreq * Math.PI * 2 + mote.twinklePhase));
            const alpha = Math.min(1, (lit + spec.ambient) * twinkle * intensity);
            const sprite = mote.sprite;
            sprite.visible = alpha > 0.004;
            if (!sprite.visible) continue;
            sprite.position.set(x * height, y * height);
            const px = mote.size * height;
            sprite.width = px;
            sprite.height = px;
            sprite.alpha = alpha;
            sprite.tint = color;
        }
    };

    return {
        view,
        update,
        destroy: () => view.destroy({ children: true }),
    };
};

  /* ---- light/starfall.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/light/starfall.ts
// 星空点亮：镜头开始时全黑，数百个光点从画面顶部上方倾泻而下（带拖尾，落定前减速），落定的一瞬闪一下，
// 之后留在原处成为闪烁的星空（上密下疏）；主光柱在倾泻到一半左右时点亮（由场景按 ignitionAt 驱动）。
// 开场之后还有持续的光雨：稀疏的光点沿光柱附近落下，进了光束更亮。
// 全部是 (种子, t) 的闭式函数。


/** 主光柱在开场的什么时刻点亮（相对镜头开始，秒）。 */
const starfallIgnition = (spec) => spec.opening * (0.45);




const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value) => 1 - (1 - clamp01(value)) ** 3;

const createStarfall = (
    pixi,
    options,
) => {
    const { width, height, spec } = options;
    const aspect = width / height;
    const rng = createRng(`${options.seed}:starfall`);
    const view = new pixi.Container();
    const trails = new pixi.Container();
    const points = new pixi.Container();
    view.addChild(trails, points);

    const makeTrail = () => {
        const trail = new pixi.Sprite(options.streak);
        trail.anchor.set(1, 0.5);
        trail.rotation = Math.PI / 2;
        trails.addChild(trail);
        return trail;
    };

    const stars = Array.from({ length: spec.stars }, () => {
        const bright = rng() < 0.08;
        const sprite = new pixi.Sprite(bright ? options.star : options.dot);
        sprite.anchor.set(0.5);
        points.addChild(sprite);
        return {
            sprite,
            trail: makeTrail(),
            x: rng() * aspect,
            // 上密下疏。
            y: 0.02 + rng() ** 1.7 * 0.9,
            fromY: -0.05 - rng() * 0.25,
            // 倾泻：大多数在开场前段落下，少数拖到后段。
            delay: spec.opening * (0.02 + 0.7 * rng() ** 1.4),
            fall: 0.45 + rng() * 0.7,
            size: bright ? 0.018 + rng() * 0.02 : 0.003 + rng() * 0.006,
            bright,
            twinklePhase: rng() * Math.PI * 2,
            twinkleFreq: 0.4 + rng() * 1.8,
        };
    });

    const drops = Array.from({ length: spec.rain }, () => {
        const sprite = new pixi.Sprite(options.dot);
        sprite.anchor.set(0.5);
        points.addChild(sprite);
        // 横向：集中在画面中线（光柱）附近，近似正态。
        const spread = (rng() + rng() + rng() - 1.5) / 1.5;
        return {
            sprite,
            trail: makeTrail(),
            x: aspect * (0.5 + spread * spec.rainSpread * 0.5),
            period: (1.25 / Math.max(spec.rainSpeed, 0.01)) * (0.7 + rng() * 0.6),
            phase: rng(),
            size: 0.003 + rng() * 0.005,
            sway: (rng() - 0.5) * 0.02,
        };
    });

    const place = (sprite, trail, x, y, size, alpha, speed, color) => {
        sprite.visible = alpha > 0.004;
        trail.visible = sprite.visible && speed > 0.05;
        if (!sprite.visible) return;
        sprite.position.set(x * height, y * height);
        sprite.width = size * height;
        sprite.height = size * height;
        sprite.alpha = alpha;
        sprite.tint = color;
        if (trail.visible) {
            // 拖尾长度随速度，朝上（锚点在尾端 = 光点处）。
            trail.position.set(x * height, y * height);
            trail.width = Math.min(0.25, speed * 0.09) * height;
            trail.height = Math.max(1.5, size * height * 0.7);
            trail.alpha = alpha * 0.6;
            trail.tint = color;
        }
    };

    const update = (local, time, beams, color, fade) => {
        for (const star of stars) {
            const progress = (local - star.delay) / star.fall;
            if (progress <= 0) {
                star.sprite.visible = false;
                star.trail.visible = false;
                continue;
            }
            const eased = easeOutCubic(progress);
            const y = star.fromY + (star.y - star.fromY) * eased;
            // 下落速度（高度单位 / 秒）：easeOutCubic 的导数。
            const speed = progress < 1 ? ((star.y - star.fromY) * 3 * (1 - progress) ** 2) / star.fall : 0;
            const landedAt = star.delay + star.fall;
            const flash = local >= landedAt ? Math.exp(-(local - landedAt) / 0.25) : 0;
            const twinkle = 0.55 + 0.45 * Math.sin(time * star.twinkleFreq * Math.PI * 2 + star.twinklePhase);
            const lit = compressLight(lightAt(beams, star.x, y));
            const base = progress < 1 ? 0.9 : (star.bright ? 0.7 : 0.45) * twinkle;
            const alpha = clamp01((base + lit * 0.8 + flash) * spec.brightness * fade);
            place(star.sprite, star.trail, star.x, y, star.size * (1 + flash * 1.5), alpha, speed, color);
        }
        // 光雨：开场之后才开始，渐强。
        const rainIn = clamp01((local - spec.opening * 0.6) / 1.5);
        for (const drop of drops) {
            const cycle = (time / drop.period + drop.phase) % 1;
            const y = -0.1 + cycle * 1.25;
            const x = drop.x + Math.sin(time * 0.7 + drop.phase * 6) * drop.sway;
            const lit = compressLight(lightAt(beams, x, y));
            const edge = clamp01(cycle / 0.08) * clamp01((1 - cycle) / 0.15);
            const alpha = clamp01((0.18 + lit * 1.1) * edge * rainIn * fade * spec.brightness);
            place(drop.sprite, drop.trail, x, y, drop.size, alpha, 1.25 / drop.period, color);
        }
    };

    return {
        view,
        update,
        destroy: () => view.destroy({ children: true }),
    };
};

  /* ---- light/crossBurst.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/light/crossBurst.ts
// 十字爆闪（EVA 式），行内的一串小十字：沿着一行，按种子挑出一部分字，在字被唱到的一瞬（或行首一口气
// 扫过整行）各冒出一个小十字——白闪、竖直光柱急速拉长、横条展开、小冲击环——很快消散。
// 只在光位声明了 burst 的镜头里出现。每一帧的画面只由「引爆后的秒数 age」决定。

/** 同时存在的小十字上限。 */
const MAX_BURSTS = 14;
/** 一个小十字持续多久（秒）。 */
const BURST_DURATION = 0.6;
/** 「扫过」方式里相邻两个十字的间隔（秒）。 */
const SWEEP_STEP = 0.07;



/** 按光位的 burst 规则挑出引爆的字与时刻（纯函数，按种子确定）。 */
const planBursts = (spec, lines, seed) => {
    const triggers = [];
    lines.forEach((line, lineIndex) => {
        if (lineIndex < spec.offset || (lineIndex - spec.offset) % Math.max(1, spec.every) !== 0) return;
        const rng = createRng(`${seed}:burst:${lineIndex}`);
        const chosen = line.glyphs.filter(() => rng() < spec.density);
        // 至少一个：密度低、行又短时也要有。
        if (chosen.length === 0 && line.glyphs.length > 0) chosen.push(line.glyphs[Math.floor(rng() * line.glyphs.length)]);
        const sweepStart = line.glyphs[0]?.start ?? 0;
        chosen.forEach((glyph, order) => triggers.push({
            lineIndex,
            glyphIndex: glyph.glyphIndex,
            time: spec.mode === 'sweep' ? sweepStart + order * SWEEP_STEP : glyph.start,
            size: 0.7 + rng() * 0.6,
            dy: (rng() - 0.5) * 0.9,
        }));
    });
    return triggers.sort((a, b) => a.time - b.time);
};




const burstClamp01 = (value) => Math.min(1, Math.max(0, value));
const easeOutExpo = (value) => {
    const t = burstClamp01(value);
    return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
};
const burstEaseOutCubic = (value) => 1 - (1 - burstClamp01(value)) ** 3;

/** 一个小十字给光场的提亮（多个叠加时由调用方封顶）。 */
const burstLightBoost = (age) => (age < 0 ? 0 : 0.18 * Math.exp(-age / 0.1));

const createCrossBurst = (pixi, options) => {
    const { sprites } = options;
    const view = new pixi.Container();
    const pool = Array.from({ length: MAX_BURSTS }, () => {
        const holder = new pixi.Container();
        const make = (texture) => {
            const sprite = new pixi.Sprite(texture);
            sprite.anchor.set(0.5);
            holder.addChild(sprite);
            return sprite;
        };
        const ring = make(sprites.bokeh);
        const verticalGlow = make(sprites.streak);
        const horizontalGlow = make(sprites.streak);
        const verticalCore = make(sprites.streak);
        const horizontalCore = make(sprites.streak);
        const flash = make(sprites.dot);
        verticalGlow.rotation = Math.PI / 2;
        verticalCore.rotation = Math.PI / 2;
        holder.visible = false;
        view.addChild(holder);
        return { holder, flash, verticalGlow, verticalCore, horizontalGlow, horizontalCore, ring };
    });

    const update = (events) => {
        pool.forEach((burst, index) => {
            const event = events[index];
            if (!event || event.age < 0 || event.age > BURST_DURATION) {
                burst.holder.visible = false;
                return;
            }
            burst.holder.visible = true;
            const { age } = event;
            const L = event.length;
            const glowColor = hexOf(event.color);
            const coreColor = hexOf(mixRgb(event.color, WHITE, 0.75));
            // 30ms 点亮，之后快速衰减（0.16s 常数），0.6s 内基本消失。
            const envelope = burstClamp01(age / 0.03) * Math.exp(-Math.max(0, age - 0.03) / 0.16);
            const spread = 1 + age * 2;

            burst.holder.position.set(event.x, event.y);

            // 竖直光柱：从字脚下 0.3L 到字上方 0.7L（拉丁十字），80ms 内拉满。
            const verticalLength = L * easeOutExpo(age / 0.08);
            for (const [sprite, thickness, alpha, tint] of [
                [burst.verticalGlow, L * 0.1 * spread, 0.6, glowColor],
                [burst.verticalCore, L * 0.02 * spread, 1, coreColor],
            ]) {
                sprite.position.set(0, -L * 0.2);
                sprite.width = Math.max(1, verticalLength);
                sprite.height = thickness;
                sprite.alpha = alpha * envelope;
                sprite.tint = tint;
            }

            // 横条：晚 20ms，100ms 内展开，交点在光柱上段。
            const horizontalLength = L * 0.62 * easeOutExpo((age - 0.02) / 0.1);
            for (const [sprite, thickness, alpha, tint] of [
                [burst.horizontalGlow, L * 0.09 * spread, 0.55, glowColor],
                [burst.horizontalCore, L * 0.018 * spread, 0.95, coreColor],
            ]) {
                sprite.position.set(0, -L * 0.42);
                sprite.width = Math.max(1, horizontalLength);
                sprite.height = thickness;
                sprite.alpha = alpha * envelope * burstClamp01((age - 0.02) / 0.03);
                sprite.tint = tint;
            }

            // 引爆的白闪。
            const flashSize = L * (0.35 + age * 0.8);
            burst.flash.position.set(0, -L * 0.42);
            burst.flash.width = flashSize;
            burst.flash.height = flashSize;
            burst.flash.alpha = Math.exp(-age / 0.07);
            burst.flash.tint = coreColor;

            // 小冲击环。
            const ring = burstEaseOutCubic(age / 0.4);
            const ringSize = L * 0.9 * ring;
            burst.ring.position.set(0, -L * 0.42);
            burst.ring.width = ringSize;
            burst.ring.height = ringSize;
            burst.ring.alpha = 0.35 * (1 - ring) * burstClamp01(age / 0.03);
            burst.ring.tint = glowColor;
        });
    };

    return {
        view,
        update,
        destroy: () => view.destroy({ children: true }),
    };
};

  /* ---- light/lightFieldShader.ts ---- */
// Copyright (c) 2026 chthollyphile




// src/components/visualizer/lumiere/light/lightFieldShader.ts
// 光场：一个覆盖画面的 Mesh，片元着色器里算多束体积光 × 烟雾密度（丁达尔）、烟雾底色、光源眩光、暗场底。
// 光束公式与 rig.ts 的 beamMask 一字不差（改一边要改另一边，单测对拍）。
//
// 输出是合法的预乘颜色、alpha = 三通道最大值：普通混合下 = c + dst·(1 - max(c))，近似 screen，
// 不依赖 add 混合，场景容器挂了淡入淡出 / 模糊 filter、叠在透明底上时都一样（见 lumisynth docs/LUMIERE.md 第七节）。

const vertex = `
in vec2 aPosition;
out vec2 vPos;
out float vAlpha;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vPos = aPosition;
    vAlpha = uColor.a * uWorldColorAlpha.a;
}
`;

const fragment = `
precision highp float;
in vec2 vPos;
in float vAlpha;
out vec4 finalColor;

#define MAX_BEAMS ${MAX_BEAMS}

uniform vec4 uBeamA[MAX_BEAMS]; // ox, oy, dx, dy
uniform vec4 uBeamB[MAX_BEAMS]; // halfWidth, tanSpread, softness, length
uniform vec4 uBeamC[MAX_BEAMS]; // intensity, streaks, streakFreq, streakPhase
uniform vec4 uBeamD[MAX_BEAMS]; // r, g, b, core
uniform vec4 uBeamE[MAX_BEAMS]; // 窗影：pattern, frequency, duty, phase
uniform vec4 uBeamF[MAX_BEAMS]; // 色散, 射程, 0, 0
uniform vec4 uFrame;            // width, height, time, beamCount
uniform vec4 uFogA;             // density, tyndallBase, scale, warp
uniform vec4 uFogB;             // driftX, driftY, ambient, octaves
uniform vec3 uFogColor;
uniform vec4 uGlare;            // x, y, radius, intensity
uniform vec4 uGlareB;           // streak, 0, 0, 0
uniform vec3 uGlareColor;
uniform vec4 uDark;             // 暗场底：预乘颜色 rgb、alpha
uniform vec4 uCaustic;          // 焦散：scale, speed, inBeam, enabled
uniform vec4 uCausticFloor;     // 池底：cx, cy, rx, ry（高度单位）
uniform vec4 uCausticB;         // 池底亮度, 0, 0, 0
uniform vec4 uWave;             // 干涉：mode, frequency, speed, strength
uniform vec4 uWaveB;            // cx, cy, radius, separation（高度单位）
uniform vec4 uShield;           // 文字区：cx, cy, rx, ry（高度单位）
uniform vec4 uShieldB;          // x：文字区里条纹压暗多少

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise1(float x) {
    float i = floor(x);
    float f = x - i;
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u);
}

float valueNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float octaves) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        if (float(i) >= octaves) break;
        sum += amp * valueNoise2(p);
        norm += amp;
        p = rot * p * 2.03 + vec2(17.1, 9.2);
        amp *= 0.5;
    }
    return sum / max(norm, 1e-4);
}

float fog(vec2 p, float t) {
    vec2 drift = uFogB.xy * t;
    vec2 q = (p - drift) * uFogA.z;
    float octaves = uFogB.w;
    vec2 w = vec2(
        fbm(q + vec2(0.0, t * 0.07), 3.0),
        fbm(q + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0), 3.0)
    );
    float n = fbm(q + uFogA.w * (w - 0.5) * 2.0, octaves);
    // 拉开对比：烟是一缕一缕的，不是均匀的灰。
    return smoothstep(0.28, 0.82, n);
}

// 透光条：fract(x) 落在 [0, duty) 里为 1，边缘柔化（与 rig.ts 的 band 相同）。
float band(float x, float duty) {
    float f = fract(x);
    return min(1.0, 1.0 - smoothstep(duty - 0.06, duty + 0.06, f) + smoothstep(0.94, 1.0, f));
}

// 窗影图样：u 为截面横向位置 -1..1，v 为沿光束的距离。
float goboPattern(vec4 E, float u, float v) {
    float pattern = E.x;
    if (pattern < 1.5) return band(u * E.y * 0.5 + E.w, E.z);
    if (pattern < 2.5) return smoothstep(E.z * 0.5, E.z * 0.5 + 0.08, abs(u));
    if (pattern < 3.5) return band(u * E.y * 0.5 + v * E.y * 0.8 + E.w, E.z) * band(u * E.y * 0.5 - v * E.y * 0.8 - E.w, E.z);
    return smoothstep(E.z - 0.12, E.z + 0.12, valueNoise2(vec2(u * E.y, v * E.y * 0.6 + E.w)));
}

// 窗影（与 rig.ts 的 goboMask 相同）：影子里仍透过 12% 的散射光。
float goboMask(vec4 E, float u, float v) {
    if (E.x < 0.5) return 1.0;
    return 0.12 + 0.88 * goboPattern(E, u, v);
}

// 数组下标只能用循环变量（GLSL ES 1.0 的限制），所以按分量传进来。返回 (强度, 截面横向位置 -1..1)。
vec2 beamMask(vec4 A, vec4 B, vec4 C, float coreAmount, vec4 E, float reach, vec2 p) {
    vec2 d = p - A.xy;
    float along = dot(d, A.zw);
    if (along <= 0.0) return vec2(0.0);
    float signedPerp = d.x * -A.w + d.y * A.z;
    // 取绝对值：会聚的光束过了焦点再散开。
    float half_ = abs(B.x + along * B.y) + 1e-4;
    float s = abs(signedPerp) / half_;
    float edge = smoothstep(1.0, 1.0 - max(B.z, 0.02), s);
    if (edge <= 0.0) return vec2(0.0);
    float signedS = s * sign(signedPerp);
    float streak = 1.0 - C.y + C.y * valueNoise1(signedS * C.z + C.w);
    float core = 1.0 - coreAmount + coreAmount * (1.0 - s * s);
    float falloff = exp(-along / max(B.w, 0.001));
    float reachMask = reach > 0.0 ? 1.0 - smoothstep(reach - max(0.04, half_ * 2.5), reach, along) : 1.0;
    float start = smoothstep(0.0, abs(B.x) * 2.0 + 0.01, along);
    return vec2(edge * streak * core * falloff * goboMask(E, signedS, along) * reachMask * start * C.x, signedS);
}

// 色散：截面横向位置 -> 光谱色（红在一侧、紫在另一侧）。
vec3 spectrumColor(float u) {
    float h = clamp(0.5 + 0.5 * u, 0.0, 1.0) * 0.8;
    vec3 k = clamp(abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    return mix(vec3(1.0), k, 0.85);
}

// 焦散（水面焦散的经典迭代，去掉取模，连续不接缝）。
float causticField(vec2 p, float t) {
    vec2 q = p * uCaustic.x * 6.2831853 - 250.0;
    vec2 i = q;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
        float tt = t * (1.0 - (3.5 / float(n + 1)));
        i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 3.0);
}

// 干涉与衍射：在一块圆形区域里发光的条纹。
float wavePattern(vec2 p, float t) {
    vec2 d = p - uWaveB.xy;
    float radius = max(uWaveB.z, 1e-3);
    float r = length(d) / radius;
    float mask = smoothstep(1.0, 0.55, r);
    float mode = uWave.x;
    float f = uWave.y;
    float phase = t * uWave.z;
    float v;
    if (mode < 1.5) {
        v = 0.5 + 0.5 * cos(r * r * f * 6.0 - phase);
    } else if (mode < 2.5) {
        // 双缝：条纹离中心越远越弯（双曲线），包络是椭圆，不是矩形。
        float x = d.x / radius;
        float y = d.y / radius;
        float xc = x * (1.0 + 0.35 * y * y);
        v = pow(cos(xc * f * 3.0 - phase * 0.3), 2.0) * exp(-xc * xc * 2.5);
        mask = smoothstep(1.0, 0.25, length(vec2(x * 0.85, y * 1.5)));
    } else if (mode < 3.5) {
        vec2 s1 = vec2(-uWaveB.w * 0.5, 0.0);
        float d1 = length(d - s1);
        float d2 = length(d + s1);
        v = (0.5 + 0.5 * cos((d1 - d2) * f * 20.0)) * (0.5 + 0.5 * cos((d1 + d2) * f * 6.0 - phase));
    } else {
        float x = r * f * 4.0 + 1e-3;
        float sc = sin(x) / x;
        v = min(sc * sc * 4.0, 1.5);
    }
    // 文字区里压暗，字压在条纹上还读得清。
    vec2 q = (p - uShield.xy) / max(uShield.zw, vec2(1e-3));
    float shield = 1.0 - uShieldB.x * smoothstep(1.0, 0.35, length(q));
    return v * mask * shield * uWave.w;
}

void main(void) {
    float H = uFrame.y;
    float t = uFrame.z;
    vec2 p = vPos / H;

    float density = fog(p, t);
    float tyndall = uFogA.y + (1.0 - uFogA.y) * density * uFogA.x;

    float caustic = uCaustic.w > 0.5 ? causticField(p, t * uCaustic.y + 23.0) : 0.0;
    float causticLift = mix(1.0, 0.25 + 1.5 * caustic, uCaustic.w > 0.5 ? uCaustic.z : 0.0);

    vec3 light = vec3(0.0);
    int count = int(uFrame.w + 0.5);
    for (int i = 0; i < MAX_BEAMS; i++) {
        if (i >= count) break;
        vec4 D = uBeamD[i];
        vec2 m = beamMask(uBeamA[i], uBeamB[i], uBeamC[i], D.w, uBeamE[i], uBeamF[i].y, p);
        vec3 color = D.rgb;
        float spectrum = uBeamF[i].x;
        if (spectrum > 0.0) color = mix(color, spectrumColor(m.y) * max(max(color.r, color.g), color.b), spectrum);
        light += color * m.x;
    }
    light *= tyndall * causticLift;

    // 池底的焦散光斑（不靠烟，直接亮）。
    if (uCaustic.w > 0.5 && uCausticB.x > 0.0) {
        vec2 e = (p - uCausticFloor.xy) / max(uCausticFloor.zw, vec2(1e-3));
        light += uFogColor * caustic * uCausticB.x * smoothstep(1.0, 0.6, length(e));
    }
    // 干涉条纹。
    if (uWave.x > 0.5) light += uFogColor * wavePattern(p, t);

    // 光束之外的烟：很淡，只给暗场一点空间感。
    light += uFogColor * density * uFogB.z;

    // 光源眩光：亮核 + 大半径柔光 + 横向拉丝。
    if (uGlare.w > 0.0) {
        vec2 g = p - uGlare.xy;
        float r = max(uGlare.z, 1e-3);
        float dist = length(g);
        float glare = exp(-dist / r) * 0.55 + exp(-(dist * dist) / (r * r * 0.03));
        float streak = exp(-abs(g.y) / (r * 0.035)) * exp(-abs(g.x) / (r * 7.0)) * uGlareB.x;
        light += uGlareColor * (glare + streak) * uGlare.w;
    }

    // 保持色相的压缩：按最大通道压到 0..1，只在极亮处微微发白（逐通道压缩会把金色压成白色）。
    float peak = max(max(light.r, light.g), light.b);
    float mapped = 1.0 - exp(-peak);
    vec3 c = peak > 1e-5 ? light / peak * mapped : vec3(0.0);
    c = mix(c, vec3(mapped), 0.3 * mapped * mapped * mapped);
    // 抖动，免得暗部渐变在 8 位视频里出色带（按像素坐标，确定性）。
    c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
    c = clamp(c, 0.0, 1.0);
    float a = max(max(c.r, c.g), c.b);

    // 叠在暗场底上（预乘的 over）。
    vec3 rgb = c + uDark.rgb * (1.0 - a);
    float alpha = a + uDark.a * (1.0 - a);
    finalColor = vec4(rgb, alpha) * vAlpha;
}
`;



/**
 * margin：四边各外扩多少逻辑像素。场景的运镜（手持浮动、呼吸缩放可以略小于 1、平移）会把画框边缘露出来，
 * 亮色主题下暗场底一露边就是一条亮缝；外扩的部分按同样的像素坐标继续算光场，接缝看不出来。
 */
const createLightField = (pixi, width, height, margin = 0) => {
    const x0 = -margin;
    const y0 = -margin;
    const x1 = width + margin;
    const y1 = height + margin;
    const geometry = new pixi.Geometry({
        attributes: {
            aPosition: [x0, y0, x1, y0, x1, y1, x0, y1],
        },
        indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const uniforms = new pixi.UniformGroup({
        uBeamA: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uBeamB: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uBeamC: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uBeamD: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uBeamE: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uBeamF: { value: new Float32Array(MAX_BEAMS * 4), type: 'vec4<f32>', size: MAX_BEAMS },
        uFrame: { value: new Float32Array([width, height, 0, 0]), type: 'vec4<f32>' },
        uFogA: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFogB: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFogColor: { value: new Float32Array(3), type: 'vec3<f32>' },
        uGlare: { value: new Float32Array(4), type: 'vec4<f32>' },
        uGlareB: { value: new Float32Array(4), type: 'vec4<f32>' },
        uGlareColor: { value: new Float32Array(3), type: 'vec3<f32>' },
        uDark: { value: new Float32Array(4), type: 'vec4<f32>' },
        uCaustic: { value: new Float32Array(4), type: 'vec4<f32>' },
        uCausticFloor: { value: new Float32Array(4), type: 'vec4<f32>' },
        uCausticB: { value: new Float32Array(4), type: 'vec4<f32>' },
        uWave: { value: new Float32Array(4), type: 'vec4<f32>' },
        uWaveB: { value: new Float32Array(4), type: 'vec4<f32>' },
        uShield: { value: new Float32Array(4), type: 'vec4<f32>' },
        uShieldB: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const shader = new pixi.Shader({
        glProgram: pixi.GlProgram.from({ vertex, fragment, name: 'lumiere-light-field' }),
        resources: { lightUniforms: uniforms },
    });
    const mesh = new pixi.Mesh({ geometry, shader });

    const u = uniforms.uniforms;

    const update = (frame) => {
        const { beams, rig, time } = frame;
        const A = u.uBeamA, B = u.uBeamB, C = u.uBeamC, D = u.uBeamD, E = u.uBeamE, F = u.uBeamF;
        A.fill(0); B.fill(0); C.fill(0); D.fill(0); E.fill(0); F.fill(0);
        beams.forEach((beam, index) => {
            const o = index * (4);
            A[o] = beam.ox; A[o + 1] = beam.oy; A[o + 2] = beam.dx; A[o + 3] = beam.dy;
            B[o] = beam.halfWidth; B[o + 1] = beam.tanSpread; B[o + 2] = beam.softness; B[o + 3] = beam.length;
            C[o] = beam.intensity; C[o + 1] = beam.streaks; C[o + 2] = beam.streakFreq; C[o + 3] = beam.streakPhase;
            D[o] = beam.r; D[o + 1] = beam.g; D[o + 2] = beam.b; D[o + 3] = beam.core;
            E[o] = beam.goboPattern; E[o + 1] = beam.goboFreq; E[o + 2] = beam.goboDuty; E[o + 3] = beam.goboPhase;
            F[o] = beam.spectrum;
            F[o + 1] = beam.reach;
        });
        u.uFrame[0] = width;
        u.uFrame[1] = height;
        u.uFrame[2] = time;
        u.uFrame[3] = beams.length;
        const fog = rig.fog;
        u.uFogA[0] = fog.density * frame.fogScale;
        u.uFogA[1] = fog.tyndallBase;
        u.uFogA[2] = fog.scale;
        u.uFogA[3] = fog.warp;
        u.uFogB[0] = fog.driftX;
        u.uFogB[1] = fog.driftY;
        u.uFogB[2] = fog.ambient * frame.fogScale;
        u.uFogB[3] = frame.octaves;
        u.uFogColor[0] = frame.color[0];
        u.uFogColor[1] = frame.color[1];
        u.uFogColor[2] = frame.color[2];
        const glare = rig.glare;
        const aspect = width / height;
        u.uGlare[0] = glare ? glare.x * aspect : 0;
        u.uGlare[1] = glare ? glare.y : 0;
        u.uGlare[2] = glare ? glare.radius : 0;
        u.uGlare[3] = glare ? glare.intensity * frame.glareScale : 0;
        u.uGlareB[0] = glare ? glare.streak : 0;
        u.uGlareColor[0] = frame.color[0];
        u.uGlareColor[1] = frame.color[1];
        u.uGlareColor[2] = frame.color[2];
        u.uDark.set(frame.dark);
        const caustic = rig.caustic;
        u.uCaustic[0] = caustic?.scale ?? 0;
        u.uCaustic[1] = caustic?.speed ?? 0;
        u.uCaustic[2] = caustic?.inBeam ?? 0;
        u.uCaustic[3] = caustic ? 1 : 0;
        u.uCausticFloor[0] = (caustic?.floor?.cx ?? 0) * aspect;
        u.uCausticFloor[1] = caustic?.floor?.cy ?? 0;
        u.uCausticFloor[2] = (caustic?.floor?.rx ?? 0) * aspect;
        u.uCausticFloor[3] = caustic?.floor?.ry ?? 0;
        u.uCausticB[0] = (caustic?.floor?.strength ?? 0) * frame.glareScale;
        const wave = rig.wave;
        u.uWave[0] = wave ? WAVE_MODE_ID[wave.mode] : 0;
        u.uWave[1] = wave?.frequency ?? 0;
        u.uWave[2] = wave?.speed ?? 0;
        u.uWave[3] = (wave?.strength ?? 0) * frame.glareScale;
        u.uWaveB[0] = (wave?.cx ?? 0) * aspect;
        u.uWaveB[1] = wave?.cy ?? 0;
        u.uWaveB[2] = wave?.radius ?? 0;
        u.uWaveB[3] = wave?.separation ?? 0;
        const region = frame.textRegion;
        u.uShield[0] = region ? region.cx * aspect : 0;
        u.uShield[1] = region ? region.cy : 0;
        u.uShield[2] = region ? (region.w * aspect) / 2 : 1;
        u.uShield[3] = region ? region.h / 2 : 1;
        u.uShieldB[0] = region && wave ? wave.shield ?? 0.45 : 0;
        uniforms.update();
    };

    return {
        view: mesh,
        update,
        destroy: () => {
            mesh.destroy();
            // 传 true 连顶点 / 索引缓冲一起销毁；Geometry.destroy() 默认不动缓冲，要等 Pixi 的 GC 空闲 60 秒才删。
            geometry.destroy(true);
            shader.destroy();
        },
    };
};

  window.foliaLumiereLight = {
    BURST_DURATION: BURST_DURATION,
    MAX_BEAMS: MAX_BEAMS,
    MAX_BURSTS: MAX_BURSTS,
    burstLightBoost: burstLightBoost,
    compressLight: compressLight,
    createBloomFilter: createBloomFilter,
    createCrossBurst: createCrossBurst,
    createLightField: createLightField,
    createLightSprites: createLightSprites,
    createMotes: createMotes,
    createStarfall: createStarfall,
    lightAt: lightAt,
    planBursts: planBursts,
    resolveBeams: resolveBeams,
    starfallIgnition: starfallIgnition
  };
}());
