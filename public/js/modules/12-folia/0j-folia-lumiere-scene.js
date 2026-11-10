/* lumiere 的场景：把光、线、字编成一场。
 *
 * 从 Folia lumiere 的 4 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  var foliaLumiereLight = window.foliaLumiereLight;
  var foliaLumiereLineart = window.foliaLumiereLineart;
  var foliaLumiereProgram = window.foliaLumiereProgram;
  var foliaLumiereText = window.foliaLumiereText;
  if (!foliaLumiereCore || !foliaLumiereLight || !foliaLumiereLineart || !foliaLumiereProgram || !foliaLumiereText) return;

  var createRng = foliaLumiereCore.createRng;
  var resolveThemeFontStack = (typeof foliaResolveThemeFontStack === 'function') ? foliaResolveThemeFontStack : null;
  var resolveThemeFontWeight = (typeof foliaResolveThemeFontWeight === 'function') ? foliaResolveThemeFontWeight : null;
  var createBloomFilter = foliaLumiereLight.createBloomFilter;
  var BURST_DURATION = foliaLumiereLight.BURST_DURATION;
  var burstLightBoost = foliaLumiereLight.burstLightBoost;
  var createCrossBurst = foliaLumiereLight.createCrossBurst;
  var MAX_BURSTS = foliaLumiereLight.MAX_BURSTS;
  var planBursts = foliaLumiereLight.planBursts;
  var createLightField = foliaLumiereLight.createLightField;
  var createMotes = foliaLumiereLight.createMotes;
  var MAX_BEAMS = foliaLumiereLight.MAX_BEAMS;
  var resolveBeams = foliaLumiereLight.resolveBeams;
  var createStarfall = foliaLumiereLight.createStarfall;
  var starfallIgnition = foliaLumiereLight.starfallIgnition;
  var createLineArt = foliaLumiereLineart.createLineArt;
  var showLineArtLayer = foliaLumiereLineart.showLineArtLayer;
  var buildShotIconArts = foliaLumiereLineart.buildShotIconArts;
  var keywordBurstColor = foliaLumiereText.keywordBurstColor;
  var prepareLumiereKeywords = foliaLumiereText.prepareLumiereKeywords;
  var createLyricEcho = foliaLumiereText.createLyricEcho;
  var createLyricWindow = foliaLumiereText.createLyricWindow;
  var CHAMPAGNE = foliaLumiereCore.CHAMPAGNE;
  var hexOf = foliaLumiereCore.hexOf;
  var mixRgb = foliaLumiereCore.mixRgb;
  var rgbOf = foliaLumiereCore.rgbOf;
  var scaleRgb = foliaLumiereCore.scaleRgb;
  var WHITE = foliaLumiereCore.WHITE;
  var createLumiereCamera = foliaLumiereProgram.createLumiereCamera;
  var lumiereTypographyOfLine = foliaLumiereProgram.lumiereTypographyOfLine;
  var resolveLumiereLeadShot = foliaLumiereProgram.resolveLumiereLeadShot;
  var LUMIERE_BLOOM = foliaLumiereCore.LUMIERE_BLOOM;
  var frameInsets = foliaLumiereText.frameInsets;
  var luminance = foliaLumiereCore.luminance;

  /* 裸函数缺失（核心模块没加载）时整块退出，不把后续模块带崩。 */
  if (!resolveThemeFontStack || !resolveThemeFontWeight) return;

  /* ---- scene.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/scene.ts
// 一个场景单元（一个段落里的一串连续镜头）的画面：七层叠放（lumisynth docs/LUMIERE.md 第一节），每帧只由 t 决定。
//   图形组（bloom）：光场（烟雾 + 体积光 + 眩光）→ 背景分词碎片 → 星空 → 线稿 → 浮尘
//   素材插入层（mid，空容器，运行时可以往里放素材，在场景之上、歌词之下）
//   文字组（bloom）：十字爆闪 → 窗口里的几行字（径迹、光晕、字、闪点）
//   前景：散景
// 整个单元只建一份的：歌词窗口、背景碎片、浮尘、星空、运镜（按第一个镜头的光位）。
// 随镜头换的：光位（镜头边界处两套光束在同一个光场里交叉渐变）与线稿（下一个提前描、上一个随后淡出）。
// 主题：关键字（wordColors）点亮时带关键字色（字、光晕、闪点、落在上面的十字爆闪、背景碎片）；
// 主题图标（lyricsIcons）每个镜头散落几枚在文字区外，和线稿同样描出、同样随镜头交叉渐变。
// 容器本身透明，背景归 folia 的共享背景层；暗场底由运行时铺在所有场景之下（lumiereDarkField.ts），
// 不随段落转场变化，场景里的光场不再画它（uDark 恒为 0）。
// Pixi 模块由调用方传入（运行时经 loadPixi 取得），这里只用它的类型。

/** 单元里的一个镜头：光位、时间、覆盖哪几行（options.lines 的下标）。 */



/** 镜头边界处光位交叉渐变多久（秒）。 */
const HANDOFF = 0.9;
/** 光源（眩光）从上一个光位的位置移到新位置用多久（秒）：比光束的交叉渐变长，走三次缓入缓出。 */
const GLARE_MOVE = 1.6;

const easeInOutCubic = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
const lerp = (a, b, k) => a + (b - a) * k;


/**
 * 光场着色器的暗场底（预乘）：folia 里恒为 0。暗场底由运行时画在所有场景之下（见 lumiereDarkField.ts），
 * 着色器的 uDark 通路保留给 lumisynth 那样由场景自己铺底的宿主。
 */
const LUMIERE_SHADER_NO_DARK  = [0, 0, 0, 0];

/** 未唱字偏向的冷灰蓝。 */
const UNLIT_COOL = [0.62, 0.68, 0.8];

/** 按最亮通道拉到 1：保留色相、去掉暗度，深色的主题色（浅色主题的字色）也能当发光色用；近黑时退回 fallback。 */
const glowOf = (rgb, fallback) => {
    const peak = Math.max(...rgb);
    return peak < 0.04 ? fallback : scaleRgb(rgb, 1 / peak);
};

/**
 * 光色与字色。themeMix（「主题色占比」，0..1）为 0 时是原来的香槟金光（里面掺 18% 强调色）；
 * 越高越跟随主题：光色（光束、烟雾、辉光、线稿、画框）→ 强调色，点亮的字 → 主色，未唱的字 → 次色（没有就用主色）。
 * 主题色都先按最亮通道拉满再混，所以占比再高画面也还是「发光」的，不会画成暗块。
 */
const resolveLumierePalette = (theme, themeMix = 0) => {
    const mix = Math.min(1, Math.max(0, themeMix));
    const accent = rgbOf(theme.accentColor, CHAMPAGNE);
    let light = mixRgb(mixRgb(CHAMPAGNE, accent, 0.18), glowOf(accent, CHAMPAGNE), mix);
    const peak = Math.max(...light, 1e-3);
    light = scaleRgb(light, 1 / peak);
    const warmLit = mixRgb(light, WHITE, 0.2);
    const primary = glowOf(rgbOf(theme.primaryColor, warmLit), warmLit);
    const secondary = theme.secondaryColor ? glowOf(rgbOf(theme.secondaryColor, primary), primary) : primary;
    return {
        light,
        lit: mixRgb(warmLit, mixRgb(primary, WHITE, 0.2), mix),
        unlit: mixRgb(mixRgb(light, UNLIT_COOL, 0.55), mixRgb(secondary, UNLIT_COOL, 0.35), mix),
    };
};

/** 两套光位之间的烟雾与眩光（光束另算：两套都进光场，按强度交叉渐变）。 */
const blendRig = (from, to, k, glareK) => ({
    beams: [],
    fog: {
        density: lerp(from.fog.density, to.fog.density, k),
        tyndallBase: lerp(from.fog.tyndallBase, to.fog.tyndallBase, k),
        scale: lerp(from.fog.scale, to.fog.scale, k),
        driftX: lerp(from.fog.driftX, to.fog.driftX, k),
        driftY: lerp(from.fog.driftY, to.fog.driftY, k),
        warp: lerp(from.fog.warp, to.fog.warp, k),
        ambient: lerp(from.fog.ambient, to.fog.ambient, k),
    },
    // 光源移动走自己的缓动曲线（glareK），起步与到位都慢，不是匀速滑过去。
    glare: from.glare && to.glare
        ? {
            x: lerp(from.glare.x, to.glare.x, glareK),
            y: lerp(from.glare.y, to.glare.y, glareK),
            radius: lerp(from.glare.radius, to.glare.radius, glareK),
            intensity: lerp(from.glare.intensity, to.glare.intensity, glareK),
            streak: lerp(from.glare.streak, to.glare.streak, glareK),
        }
        : (k < 0.5 ? from.glare && { ...from.glare, intensity: from.glare.intensity * (1 - k * 2) } : to.glare && { ...to.glare, intensity: to.glare.intensity * (k * 2 - 1) }),
    // 焦散与干涉：前半段是上一个光位的（渐弱），后半段是新光位的（渐强）。
    caustic: fadeCaustic(k < 0.5 ? from.caustic : to.caustic, k < 0.5 ? 1 - k * 2 : k * 2 - 1),
    wave: k < 0.5
        ? from.wave && { ...from.wave, strength: from.wave.strength * (1 - k * 2) }
        : to.wave && { ...to.wave, strength: to.wave.strength * (k * 2 - 1) },
});

const fadeCaustic = (caustic, k) => caustic && {
    ...caustic,
    inBeam: caustic.inBeam * k,
    floor: caustic.floor && { ...caustic.floor, strength: caustic.floor.strength * k },
};

const createLumiereScene = (pixi, options) => {
    const { width, height, tuning, sprites } = options;
    const aspect = width / height;
    const palette = resolveLumierePalette(options.theme, tuning.themeColorMix);
    const shots = options.shots.length > 0 ? options.shots : [];
    // 领头光位（文字区、字号、运镜、浮尘、星空按它）：第一个有歌词的镜头（lumiereUnitLayout.ts）。
    const lead = resolveLumiereLeadShot(shots).profile;

    // 每个镜头的光位（按单元与镜头播种）。
    const rigs = shots.map((shot, index) => shot.profile.light({ aspect, random: createRng(`${options.seed}:${index}:${shot.profile.kind}:light`) }));

    const view = new pixi.Container();
    const stage = new pixi.Container();
    view.addChild(stage);

    // 图形组
    const graphics = new pixi.Container();
    // 运镜最多把边缘露出约 1.4%（手持浮动 0.6% + 呼吸缩放 0.4% + 平移超出推近的部分 + 旋转），外扩 2% 盖住。
    const overscan = Math.ceil(Math.max(width, height) * 0.02);
    const field = createLightField(pixi, width, height, overscan);
    const lineArts = shots.map((shot, index) => createLineArt(pixi, {
        height,
        spec: shot.profile.lineArt({ aspect, random: createRng(`${options.seed}:${index}:${shot.profile.kind}:art`) }),
        starTexture: sprites.star,
    }));
    const lineArtHolder = new pixi.Container();
    lineArts.forEach(layer => lineArtHolder.addChild(layer.view));
    lineArtHolder.visible = tuning.lineArt;
    // 文字区（高度单位）：整个单元按领头光位排字，图标避开它。
    const textRegion = { cx: lead.region.cx * aspect, cy: lead.region.cy, w: lead.region.w * aspect, h: lead.region.h };
    // 主题图标：每个镜头一组（没有图标或开关关掉时一组都没有，不退回默认图标），独立于线稿开关。
    const iconArts = buildShotIconArts({
        icons: options.theme.lyricsIcons,
        enabled: tuning.themeIcons && !tuning.textOnly,
        shotKinds: shots.map(shot => shot.profile.kind),
        seed: options.seed,
        aspect,
        avoid: textRegion,
    }).map(spec => createLineArt(pixi, { height, spec, starTexture: sprites.star }));
    const iconHolder = new pixi.Container();
    iconArts.forEach(layer => iconHolder.addChild(layer.view));
    const motes = createMotes(pixi, {
        width, height, seed: `${options.seed}:motes`, texture: sprites.dot,
        spec: { ...lead.motes, count: Math.round(lead.motes.count * tuning.moteAmount) },
    });
    const baseStarfall = lead.starfall ?? null;
    // 开场最多占单元的 40%；单元太短（< 2 秒）就不播开场，直接从星空已亮开始。
    const unitDuration = options.endTime - options.startTime;
    // 只画字（textOnly）时没有开场（光一开始就是满的，字按满光算明暗）。
    const canOpen = options.opening && unitDuration >= 2 && !tuning.textOnly;
    const starfallSpec = baseStarfall && canOpen
        ? { ...baseStarfall, opening: Math.min(baseStarfall.opening, Math.max(0.8, unitDuration * 0.4)) }
        : baseStarfall;
    const starfall = starfallSpec
        ? createStarfall(pixi, {
            width, height, seed: options.seed, spec: starfallSpec,
            dot: sprites.dot, star: sprites.star, streak: sprites.streak,
        })
        : null;
    // 开场：主光柱在倾泻到一半左右才点亮（光源处闪一下）。段内后续单元没有开场，星空一开始就是落定的。
    const opening = canOpen && starfallSpec !== null;
    const ignition = opening ? starfallIgnition(starfallSpec) : 0;
    const starOffset = starfallSpec && !opening ? starfallSpec.opening + 20 : 0;
    // 背景歌词：唱到的词被采集成巨大的空心字碎片，沿主光束漂下去；在光场之上、星空与线稿之下。
    const echoSpec = lead.echo ?? { size: 0.34 };
    // 关键字：匹配器整个单元一份，每行在构建时匹配一次。
    const keywords = prepareLumiereKeywords(options.theme.wordColors, tuning.keywordColors);
    const echo = tuning.echo > 0 && !tuning.textOnly
        ? createLyricEcho(pixi, {
            width,
            height,
            lines: options.lines,
            font: resolveThemeFontStack(options.theme),
            weight: resolveThemeFontWeight(options.theme, 500),
            resolution: options.resolution,
            seed: options.seed,
            size: echoSpec.size,
            opacity: tuning.echo,
            keywords,
        })
        : null;
    graphics.addChild(
        field.view,
        ...(echo ? [echo.view] : []),
        ...(starfall ? [starfall.view] : []),
        lineArtHolder,
        iconHolder,
        motes.view,
    );
    graphics.filterArea = new pixi.Rectangle(-overscan, -overscan, width + overscan * 2, height + overscan * 2);

    // 素材插入层
    const mid = new pixi.Container();

    // 文字组。第 i 行成为当前行时，用它所在镜头的排版（不在任何镜头里的行跟随前一个镜头）。
    const typographyOfLine = lumiereTypographyOfLine(shots);
    const window = createLyricWindow(pixi, {
        width,
        height,
        lines: options.lines,
        font: resolveThemeFontStack(options.theme),
        weight: resolveThemeFontWeight(options.theme, 500),
        resolution: options.resolution,
        region: {
            cx: lead.region.cx * aspect,
            cy: lead.region.cy,
            w: lead.region.w * aspect,
            h: lead.region.h,
        },
        heroPx: lead.heroSize * height,
        neighbors: tuning.windowNeighbors,
        typography: options.typography ?? lead.typography,
        typographyOf: options.typography ? undefined : typographyOfLine,
        decay: { ...lead.decay, strength: lead.decay.strength * tuning.decay },
        alwaysFly: tuning.trails,
        seed: options.seed,
        sprites,
        letterSpacing: 0.04,
        keywords,
    });
    // 十字爆闪在字的下面（字压在光上才读得清），与字共用文字组的 bloom。只在声明了 burst 的镜头覆盖的行里引爆。
    const burstTriggers = shots.flatMap((shot, shotIndex) => {
        const spec = shot.profile.burst ?? null;
        if (!spec) return [];
        const covered = new Set(shot.lines);
        const color = mixRgb(palette.light, spec.tint, 0.85);
        return planBursts(
            spec,
            options.lines.map((_, lineIndex) => ({ glyphs: covered.has(lineIndex) ? window.glyphTimes(lineIndex) : [] })),
            `${options.seed}:${shotIndex}`,
        ).map(trigger => {
            // 落在关键字上的十字用关键字的颜色。
            const keyword = window.glyphKeyword(trigger.lineIndex, trigger.glyphIndex);
            return { ...trigger, size: trigger.size * spec.size, color: keyword ? keywordBurstColor(color, palette.light, keyword) : color };
        });
    }).sort((a, b) => a.time - b.time);
    const burst = burstTriggers.length > 0 ? createCrossBurst(pixi, { sprites }) : null;
    const text = new pixi.Container();
    if (burst) text.addChild(burst.view);
    text.addChild(window.view);

    // 前景
    const front = new pixi.Container();
    let frontMotes = null;
    if (lead.front && tuning.frontBokeh && !tuning.textOnly) {
        frontMotes = createMotes(pixi, {
            width, height, seed: `${options.seed}:front`, texture: sprites.bokeh, spec: lead.front,
        });
        front.addChild(frontMotes.view);
    }

    stage.addChild(graphics, mid, text, front);
    // 仅显示歌词文字：图形组整个不画（光束只在 CPU 上算，给字定明暗）。
    graphics.renderable = !tuning.textOnly;

    const bloomOf = (preset, multiplier, padding) => createBloomFilter(pixi, {
        ...preset,
        strength: preset.strength * multiplier,
        padding,
        tint: [1, 1, 1],
    });
    const graphicsBloom = bloomOf(LUMIERE_BLOOM.graphics, tuning.bloom, 0);
    const textBloom = bloomOf(LUMIERE_BLOOM.text, tuning.textBloom, 0);
    // 文字组的 bloom 区域必须固定在画面上：不给 filterArea 时 Pixi 每帧按内容包围盒取区域（取整到像素），
    // 字一动，降采样金字塔的网格原点与纹理尺寸就跟着跳，1/32 级的光晕相对字来回错位，看起来一直在抖。
    // 给一块远大于画面的区域，经运镜变换后被视口裁剪，结果每帧都正好是整个视口。区域已覆盖全画面，所以不再加 padding。
    text.filterArea = new pixi.Rectangle(-width, -height, width * 3, height * 3);
    graphics.filters = tuning.bloom > 0 ? [graphicsBloom] : [];
    text.filters = tuning.textBloom > 0 ? [textBloom] : [];

    const lightHex = hexOf(palette.light);
    const rest = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 };

    /** 运镜：整个单元（轨迹过渡时按原段落往返）缓慢推近 + 平移，再叠持续的手持感浮动。只由 time 决定。 */
    const camera = createLumiereCamera({
        width,
        height,
        camera: lead.camera,
        startTime: options.startTime,
        endTime: options.endTime,
        sections: options.sections,
        animationIntensity: options.theme.animationIntensity,
    });

    const activeShot = (time) => {
        let index = 0;
        for (let i = 0; i < shots.length; i += 1) if (shots[i].startTime <= time) index = i;
        return index;
    };

    const update = (time) => {
        const local = time - options.startTime;
        // 开场各段交叠：光柱在点亮前 0.4 秒就开始慢慢升起、1.6 秒才到满，不是「星落完 → 光亮 → 线稿」一段段来。
        // 没有开场的单元一开始就是满光（衔接交给运行时的转场），不从暗处升起。
        const enter = opening ? smooth((local - ignition + 0.4) / 1.6) : 1;
        // 点亮的一瞬光源处闪一下。
        const ignite = opening && local >= ignition ? 1.8 * Math.exp(-(local - ignition) / 0.35) : 0;
        const fadeOut = options.fadeOut;
        const exit = fadeOut ? 1 - smooth((time - fadeOut.start) / Math.max(fadeOut.end - fadeOut.start, 0.05)) : 1;
        const intensity = enter * exit;

        const transform = camera(time);
        stage.pivot.set(transform.pivotX, transform.pivotY);
        stage.position.set(transform.x, transform.y);
        stage.scale.set(transform.scale);
        stage.rotation = transform.rotation;

        // 正在进行的爆闪（最多 MAX_BURSTS 个），以及它们给整个光场的一下提亮。
        const events = [];
        let boost = 0;
        for (const trigger of burstTriggers) {
            const age = time - trigger.time;
            if (age < 0 || age > BURST_DURATION) continue;
            boost += burstLightBoost(age);
            if (events.length < MAX_BURSTS) {
                const anchor = window.glyphAnchor(trigger.lineIndex, trigger.glyphIndex, time);
                events.push({
                    age,
                    x: anchor.x,
                    y: anchor.y + anchor.fontPx * trigger.dy,
                    length: anchor.fontPx * trigger.size,
                    color: trigger.color,
                });
            }
        }
        // 一串小十字连着炸时提亮会叠加，封个顶。
        boost = Math.min(boost, 0.45);
        burst?.update(events);

        // 光位：当前镜头的光束渐强、上一个镜头的渐弱，两套都进光场（超过上限时留最亮的）。
        const audio = options.audioAt?.(time) ?? { bass: 0, treble: 0, power: 0 };
        const response = tuning.audioResponse;
        const index = activeShot(time);
        const sinceShot = time - shots[index].startTime;
        const handoff = index > 0 ? smooth(sinceShot / HANDOFF) : 1;
        const glareK = index > 0 ? easeInOutCubic(sinceShot / GLARE_MOVE) : 1;
        const drive = (shotIndex, weight) => ({
            intensity: intensity * tuning.lightIntensity * (1 + boost) * weight,
            bass: Math.min(1, audio.bass) * response,
            color: palette.light,
            local: time - shots[shotIndex].startTime,
        });
        let beams = resolveBeams(rigs[index], time, aspect, drive(index, handoff));
        let rig = rigs[index];
        if (handoff < 1) {
            const previous = resolveBeams(rigs[index - 1], time, aspect, drive(index - 1, 1 - handoff));
            beams = [...beams, ...previous].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_BEAMS);
        }
        if (handoff < 1 || glareK < 1) rig = blendRig(rigs[index - 1], rigs[index], handoff, glareK);
        // 仅显示歌词文字（textOnly）：图形组整个不画，这些层也不必每帧更新；光束照常算（上面），字的明暗靠它。
        if (!tuning.textOnly) {
            field.update({
                beams,
                rig,
                time,
                // 整体响度让烟雾浓一点（最多 +20%）。
                fogScale: tuning.fogDensity * (1 + boost * 0.5) * (1 + 0.2 * Math.min(1, audio.power) * response),
                color: palette.light,
                glareScale: intensity * tuning.lightIntensity * (1 + boost * 1.5 + ignite),
                dark: LUMIERE_SHADER_NO_DARK,
                octaves: tuning.fogOctaves,
                // 字排在领头光位的文字区里（整个单元一份）。
                textRegion: lead.region,
            });
            echo?.update({ time, beams, color: lightHex, intensity: smooth(local / 1.2) * exit });
            starfall?.update(local + starOffset, time, beams, lightHex, exit);
            // 线稿：每个镜头提前 0.6 秒开始描（第一个镜头在开场时与星落、光起交叠），镜头结束后 0.8 秒淡出——
            // 上一个的淡出与下一个的描出交叠。主题图标跟着同一个镜头的节奏（不乘线稿的亮度倍率）。
            lineArts.forEach((layer, shotIndex) => {
                const shot = shots[shotIndex];
                const begin = shotIndex === 0 ? options.startTime + ignition - 0.6 : shot.startTime - 0.6;
                const out = shotIndex === shots.length - 1 ? 1 : 1 - smooth((time - shot.endTime) / 0.8);
                const base = smooth((time - begin) / 1.2) * out * exit;
                const draw = (time - begin) / 3.6;
                const fade = base * (shot.profile.artGain ?? 1);
                // 下次出现：还没开始描就是 begin，窗口里就是现在；淡出之后顺放不会再出现（回拖回来会重新 update）。
                // 藏着的线稿交给 idle 按滞回放掉 GPU 数据——轨迹过渡整首一个单元时，画过的镜头线稿不然会一直占着缓冲。
                const nextUse = time < begin ? begin : time <= shot.endTime + 0.8 ? time : Number.POSITIVE_INFINITY;
                const artShown = fade > 0.003;
                showLineArtLayer(lineArtHolder, lineArts, shotIndex, artShown);
                if (artShown) layer.update(time, draw, fade, beams, lightHex);
                else layer.idle(time, nextUse);
                const icons = iconArts[shotIndex];
                if (icons) {
                    const iconsShown = base > 0.003;
                    showLineArtLayer(iconHolder, iconArts, shotIndex, iconsShown);
                    if (iconsShown) icons.update(time, draw, base, beams, lightHex);
                    else icons.idle(time, nextUse);
                }
            });
            // 高频让浮尘闪得更亮（最多 +50%）。
            motes.update(time, beams, lightHex, exit * (1 + 0.5 * Math.min(1, audio.treble) * response));
            frontMotes?.update(time, beams, lightHex, exit);
        }
        window.update({
            time,
            beams,
            litColor: palette.lit,
            unlitColor: palette.unlit,
            unlitAlpha: tuning.unlitOpacity,
            intensity: smooth(local / 0.6) * exit,
            hideTrails: tuning.hideTrails,
        });
    };

    return {
        view,
        graphics,
        mid,
        text,
        front,
        burstTimes: burstTriggers.map(trigger => trigger.time),
        lineAnchor: window.lineAnchor,
        camera,
        rest,
        update,
        destroy: () => {
            graphics.filters = [];
            text.filters = [];
            graphicsBloom.destroy();
            textBloom.destroy();
            field.destroy();
            lineArts.forEach(layer => layer.destroy());
            iconArts.forEach(layer => layer.destroy());
            motes.destroy();
            frontMotes?.destroy();
            burst?.destroy();
            starfall?.destroy();
            echo?.destroy();
            window.destroy();
            view.destroy({ children: true });
        },
    };
};

  /* ---- overlay.ts ---- */
// Copyright (c) 2026 chthollyphile



// src/components/visualizer/lumiere/overlay.ts
// 绘光的画框装饰：像取景器 / 光学台上的标记——四角括号、左右两个对位十字、顶边两段虚线。
// 静态、很淡的香槟金细线，不抢画面里的光。


/** 画框容器（静态，只建一次；尺寸或主题变了就重建）。 */
const buildLumiereOverlay = (pixi, options) => {
    const { width, height, theme } = options;
    const container = new pixi.Container();
    const g = new pixi.Graphics();
    const color = hexOf(resolveLumierePalette(theme, options.themeColorMix ?? 0).light);
    const unit = Math.min(width, height);
    // 边距留足：画面边缘可能被运镜推近、后处理的镜头畸变往外推（歌词窗口按同一个边距避开画框）。
    const { padX, padY } = frameInsets(width, height);
    const arm = unit * (0.045);
    const line = Math.max(1.2, unit / 600);
    const alpha = 0.5;

    // 四角括号。
    for (const [x, y, sx, sy] of [[padX, padY, 1, 1], [width - padX, padY, -1, 1], [width - padX, height - padY, -1, -1], [padX, height - padY, 1, -1]]) {
        g.moveTo(x, y + sy * arm).lineTo(x, y).lineTo(x + sx * arm, y).stroke({ color, width: line, alpha });
    }

    // 左右边中点的对位十字（圆 + 十字）。
    const mark = unit * 0.012;
    for (const x of [padX, width - padX]) {
        const y = height / 2;
        g.circle(x, y, mark * 0.6).stroke({ color, width: line, alpha: alpha * 0.8 });
        g.moveTo(x - mark, y).lineTo(x + mark, y).stroke({ color, width: line, alpha: alpha * 0.8 });
        g.moveTo(x, y - mark).lineTo(x, y + mark).stroke({ color, width: line, alpha: alpha * 0.8 });
    }

    // 顶边两小段虚线（像取景器上沿的对焦点）。
    const dashY = padY;
    for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k += 1) {
            const x = width / 2 + side * (unit * 0.1 + k * unit * 0.018);
            g.moveTo(x, dashY).lineTo(x + side * unit * 0.009, dashY).stroke({ color, width: line, alpha: alpha * 0.55 });
        }
    }

    container.addChild(g);
    return container;
};

  /* ---- lumiereDarkField.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereDarkField.ts
// 暗场底：光后面铺一整块主题背景色压暗的底，压住 folia 的共享背景层，光束才像打在烟里的光。
// 它由运行时画在所有段落场景（和片尾卡）之下，不随段落转场的透明度 / 模糊 / 缩放变化——
// 放在场景里时，出场帧的透明度、边界后的交叉渐变（两层各半透明，叠起来盖不满）和片尾交接都会让背景透出来闪一下。
// 光场着色器仍保留 uDark 通路，folia 里恒传 0。

/** 主题背景亮度超过它就算浅色主题。 */
const BRIGHT_BACKGROUND_LUMINANCE = 0.18;
/** 浅色主题的暗场保底（lumisynth 定的「绘光始终在暗场里」）：亮背景透出来光就不成立了。 */
const LUMIERE_BRIGHT_DARK_FIELD_FLOOR = 0.94;
/** 暗场颜色 = 主题背景色 × 这个系数。 */
const DARK_FIELD_SHADE = 0.06;


/** 生效的暗场：深色主题 alpha = darkField；浅色主题取 max(darkField, 0.94)。颜色是主题背景色压暗。 */
const resolveLumiereDarkField = (theme, darkField) => {
    const background = rgbOf(theme.backgroundColor, [0, 0, 0]);
    const strength = Number.isFinite(darkField) ? Math.min(1, Math.max(0, darkField)) : 0;
    const bright = luminance(background) > BRIGHT_BACKGROUND_LUMINANCE;
    return {
        color: scaleRgb(background, DARK_FIELD_SHADE),
        alpha: bright ? Math.max(strength, LUMIERE_BRIGHT_DARK_FIELD_FLOOR) : strength,
    };
};

/** 运行时的暗场层：一块整屏的纯色 sprite，每帧按当前主题、尺寸和 tuning 现算（只在变化时写属性）。 */
class LumiereDarkFieldLayer {
    view;
    sprite;
    theme = null;
    darkField = Number.NaN;
    width = 0;
    height = 0;

    constructor(pixi) {
        this.sprite = new pixi.Sprite(pixi.Texture.WHITE);
        this.sprite.visible = false;
        this.view = this.sprite;
    }

    update(theme, darkField, width, height) {
        if (theme !== this.theme || darkField !== this.darkField) {
            this.theme = theme;
            this.darkField = darkField;
            const field = resolveLumiereDarkField(theme, darkField);
            this.sprite.tint = hexOf(field.color);
            this.sprite.alpha = field.alpha;
            this.sprite.visible = field.alpha > 0.002;
        }
        if (width !== this.width || height !== this.height) {
            this.width = width;
            this.height = height;
            this.sprite.setSize(width, height);
        }
    }

    destroy() {
        this.sprite.destroy();
    }
}

  /* ---- lumiereGroupFilters.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereGroupFilters.ts
// 运行时对场景 / 片尾卡的图形组、文字组 filter 做的就地调整：bloom 强度（滑块拖动时不重建场景）、
// 图形组的画质分辨率与相应减掉的 bloom 级数。bloom filter 由场景自己建、自己销毁，这里只改它的参数。

const isBloomFilter = (filter) => (
    typeof (filter).options?.strength === 'number'
);

const bloomOf = (group) => (group.filters ?? []).find(isBloomFilter) ?? null;


/** 把画质与 bloom 倍率写到一个组上。重复调用是幂等的。 */
const applyLumiereGroupQuality = (group, quality) => {
    const bloom = bloomOf(group);
    if (bloom) {
        bloom.options.strength = quality.preset.strength * quality.multiplier;
        bloom.options.levels = Math.max(1, quality.preset.levels - quality.levelDrop);
        bloom.resolution = quality.resolution ?? 'inherit';
        return;
    }
    const { passthrough, resolution } = quality;
    if (!passthrough) return;
    const attached = (group.filters ?? []).includes(passthrough);
    if (resolution === null) {
        if (attached) group.filters = [];
        return;
    }
    passthrough.resolution = resolution;
    if (!attached) group.filters = [passthrough];
};

/** 摘掉运行时挂上的直通 filter（场景销毁前调用，免得场景的 destroy 把共享 filter 一起处理掉）。 */
const detachLumierePassthrough = (group, passthrough) => {
    if (passthrough && (group.filters ?? []).includes(passthrough)) group.filters = [];
};

  window.foliaLumiereScene = {
    LUMIERE_SHADER_NO_DARK: LUMIERE_SHADER_NO_DARK,
    LumiereDarkFieldLayer: LumiereDarkFieldLayer,
    applyLumiereGroupQuality: applyLumiereGroupQuality,
    buildLumiereOverlay: buildLumiereOverlay,
    createLumiereScene: createLumiereScene,
    detachLumierePassthrough: detachLumierePassthrough,
    resolveLumierePalette: resolveLumierePalette
  };
}());
