/* lumiere 的单镜：镜体、场景入场、逐帧推进。
 *
 * 从 Folia lumiere 的 3 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCore = window.foliaLumiereCore;
  var foliaLumiereProgram = window.foliaLumiereProgram;
  var foliaLumiereRigs = window.foliaLumiereRigs;
  var foliaLumiereScene = window.foliaLumiereScene;
  if (!foliaLumiereCore || !foliaLumiereProgram || !foliaLumiereRigs || !foliaLumiereScene) return;

  var profileOf = foliaLumiereRigs.profileOf;
  var cameraBetween = foliaLumiereCore.cameraBetween;
  var createLumiereScene = foliaLumiereScene.createLumiereScene;
  var applyLumiereGroupQuality = foliaLumiereScene.applyLumiereGroupQuality;
  var detachLumierePassthrough = foliaLumiereScene.detachLumierePassthrough;
  var LUMIERE_BLOOM = foliaLumiereCore.LUMIERE_BLOOM;
  var findLumiereParagraphIndexAtTime = foliaLumiereProgram.findLumiereParagraphIndexAtTime;
  var LUMIERE_TRANSITIONS = foliaLumiereProgram.LUMIERE_TRANSITIONS;
  var resolveLumiereEnterDuration = foliaLumiereProgram.resolveLumiereEnterDuration;

  /* ---- lumiereUnit.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereUnit.ts
// 一个段落 → 一个场景单元：把编译出的 LumiereParagraph 换成 createLumiereScene 的参数（镜头覆盖的行换成
// 单元内的下标、熄灯转场换成场景的收光窗口、按程序种子与段落 id 播种），再给出运镜矩阵与当前镜头。
// 对应 lumisynth 绘光 adapter 的 buildUnit；运行时（phase B）每个可见段落建一个，按播放时间调 update。



/** 段落的镜头 → 场景镜头：行号换成单元内的下标（options.lines = paragraph.lines）。 */
const buildLumiereSceneShots = (paragraph) => {
    const localLine = new Map(paragraph.lineIndices.map((lineIndex, index) => [lineIndex, index]));
    const shots = paragraph.shots.map(shot => ({
        profile: profileOf(shot.kind),
        startTime: shot.startTime,
        endTime: shot.endTime,
        lines: shot.lineIndices.map(index => localLine.get(index)).filter((index) => index !== undefined),
    }));
    if (shots.length === 0) {
        // 编译器保证每段至少一个镜头；防御：给一个覆盖整段的天井。
        shots.push({ profile: profileOf(''), startTime: paragraph.startTime, endTime: paragraph.endTime, lines: [] });
    }
    return shots;
};

const createLumiereUnit = (pixi, options) => {
    const { paragraph } = options;
    const scene = createLumiereScene(pixi, {
        width: options.width,
        height: options.height,
        resolution: options.resolution,
        seed: `${options.programSeed}:${paragraph.id}`,
        theme: options.theme,
        tuning: options.tuning,
        lines: paragraph.lines,
        shots: buildLumiereSceneShots(paragraph),
        startTime: paragraph.startTime,
        endTime: paragraph.endTime,
        sprites: options.sprites,
        opening: paragraph.opening,
        fadeOut: paragraph.transitionOut?.kind === 'lights-out'
            ? { start: paragraph.transitionOut.startTime, end: paragraph.transitionOut.endTime }
            : null,
        audioAt: options.audioAt,
        typography: options.typography,
        sections: paragraph.sections,
    });
    const shotAt = (time) => {
        let found = paragraph.shots[0];
        for (const shot of paragraph.shots) if (shot.startTime <= time) found = shot;
        return found;
    };
    return {
        paragraph,
        scene,
        update: time => scene.update(time),
        cameraMatrix: time => cameraBetween(scene.rest, scene.camera(time)),
        shotAt,
        destroy: () => scene.destroy(),
    };
};

  /* ---- lumiereSceneEntry.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereSceneEntry.ts
// 运行时缓存里的一个段落场景：LumiereUnit 外面再包一层运行时自己的 holder。转场的透明度、缩放和模糊
// 都套在 holder 上——场景自己在内部舞台上做运镜，scene.view 不动，两套变换互不覆盖。


/** 图形组、文字组的画质参数（运行时按 tuning 与画质档算好，所有场景共用）。 */


/** 模糊低于这个强度就摘掉 filter：一个挂着不用的 filter 也要多一次整屏离屏渲染。 */
const BLUR_EPSILON = 0.3;

const applyLumiereSceneQuality = (
    groups,
    quality,
) => {
    applyLumiereGroupQuality(groups.graphics, {
        preset: LUMIERE_BLOOM.graphics,
        multiplier: quality.bloom,
        resolution: quality.graphicsResolution,
        levelDrop: quality.bloomLevelDrop,
        passthrough: quality.passthrough,
    });
    applyLumiereGroupQuality(groups.text, {
        preset: LUMIERE_BLOOM.text,
        multiplier: quality.textBloom,
        resolution: null,
        levelDrop: 0,
        passthrough: null,
    });
};

/** 建一个段落场景（整个运行时里最贵的调用：光栅化这一段的全部歌词）。 */
const buildLumiereSceneEntry = (
    pixi,
    context,
    index,
) => {
    const { width, height } = context;
    const unit = createLumiereUnit(pixi, {
        paragraph: context.program.paragraphs[index],
        width,
        height,
        resolution: context.resolution,
        programSeed: context.program.seed,
        theme: context.theme,
        tuning: context.tuning,
        sprites: context.sprites,
        audioAt: context.audioAt,
    });
    unit.scene.text.visible = context.showText;
    applyLumiereSceneQuality(unit.scene, context.quality);
    const holder = new pixi.Container();
    holder.addChild(unit.scene.view);
    holder.pivot.set(width / 2, height / 2);
    holder.position.set(width / 2, height / 2);
    holder.zIndex = index;
    return { index, unit, holder, blur: null };
};

/** 套转场帧：透明度、以画面中心为原点的缩放、模糊（按需挂 / 摘）。 */
const applyLumiereLayerFrame = (
    pixi,
    entry,
    frame,
    blurResolution,
) => {
    entry.holder.alpha = frame.alpha;
    entry.holder.scale.set(frame.scale);
    if (frame.blur > BLUR_EPSILON) {
        if (!entry.blur) {
            // 模糊的内容不需要满分辨率：半分辨率跑模糊，开销是整屏的四分之一。
            entry.blur = new pixi.BlurFilter({ strength: frame.blur, quality: 3, resolution: blurResolution });
        }
        entry.blur.strength = frame.blur;
        if (!entry.holder.filters?.includes(entry.blur)) entry.holder.filters = [entry.blur];
    } else if (entry.holder.filters?.length) {
        entry.holder.filters = [];
    }
};

const destroyLumiereSceneEntry = (entry, passthrough) => {
    entry.holder.parent?.removeChild(entry.holder);
    entry.holder.filters = [];
    entry.blur?.destroy();
    entry.blur = null;
    // 共享的直通 filter 先摘下来，场景的 destroy 只处理它自己建的 bloom。
    detachLumierePassthrough(entry.unit.scene.graphics, passthrough);
    entry.holder.removeChild(entry.unit.scene.view);
    entry.unit.destroy();
    entry.holder.destroy();
};

  /* ---- lumiereSceneFrames.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereSceneFrames.ts
// 某一时刻哪些段落场景在画、各自套什么帧（透明度 / 缩放 / 模糊）。纯函数，只由 program 与时间决定。
//
// 段落首尾相接，所以任何时刻只有「当前段落」一个场景，外加边界之后的进入窗口里正在退出的上一段：
//   - 出场窗口（transitionOut.startTime..边界）：当前段套 resolveFrame('exit')。熄灯 lights-out 例外，
//     它的变暗交给场景自己的 fadeOut（光、线稿、字全熄，暗场底留着）——外层再压透明度，亮色主题下会把
//     folia 的亮背景露出来，熄灯反倒成了闪白。
//   - 进入窗口（边界之后 resolveLumiereEnterDuration 秒）：新段套 resolveFrame('enter')，同时与停在出场
//     终点帧的上一段交叉渐变，边界两侧的画面是连续的，没有硬切。



const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

const exitFrameOf = (program, index, time) => {
    const out = program.paragraphs[index]?.transitionOut;
    if (!out || time < out.startTime) return { alpha: 1, scale: 1, blur: 0 };
    const progress = (time - out.startTime) / Math.max(out.endTime - out.startTime, 1e-3);
    const frame = LUMIERE_TRANSITIONS[out.kind].resolveFrame('exit', progress);
    return out.kind === 'lights-out' ? { ...frame, alpha: 1 } : frame;
};

/**
 * transitionsEnabled 为 false（静态模式）时段落之间硬切。没有段落时 layers 为空。
 */
const resolveLumiereSceneFrames = (
    program,
    time,
    transitionsEnabled,
) => {
    if (program.paragraphs.length === 0) return { activeIndex: -1, layers: [] };
    const activeIndex = findLumiereParagraphIndexAtTime(program, time);
    if (!transitionsEnabled) {
        return { activeIndex, layers: [{ index: activeIndex, alpha: 1, scale: 1, blur: 0 }] };
    }
    const paragraph = program.paragraphs[activeIndex];
    const current = exitFrameOf(program, activeIndex, time);
    const layers = [];

    const previousOut = activeIndex > 0 ? program.paragraphs[activeIndex - 1].transitionOut : null;
    if (previousOut) {
        const enterDuration = resolveLumiereEnterDuration(previousOut.kind, previousOut.startTime, previousOut.endTime);
        const progress = (time - paragraph.startTime) / enterDuration;
        if (progress >= 0 && progress < 1) {
            const enter = LUMIERE_TRANSITIONS[previousOut.kind].resolveFrame('enter', progress);
            const weight = smooth(progress);
            // 上一段停在出场终点那一帧，随进入进度淡掉。
            const peak = exitFrameOf(program, activeIndex - 1, previousOut.endTime);
            if (peak.alpha * (1 - weight) > 0.002) {
                layers.push({ index: activeIndex - 1, alpha: peak.alpha * (1 - weight), scale: peak.scale, blur: peak.blur });
            }
            layers.push({
                index: activeIndex,
                alpha: Math.min(enter.alpha, weight) * current.alpha,
                scale: enter.scale * current.scale,
                blur: Math.max(enter.blur, current.blur),
            });
            return { activeIndex, layers };
        }
    }
    layers.push({ index: activeIndex, ...current });
    return { activeIndex, layers };
};

  window.foliaLumiereFrame = {
    applyLumiereLayerFrame: applyLumiereLayerFrame,
    applyLumiereSceneQuality: applyLumiereSceneQuality,
    buildLumiereSceneEntry: buildLumiereSceneEntry,
    destroyLumiereSceneEntry: destroyLumiereSceneEntry,
    resolveLumiereSceneFrames: resolveLumiereSceneFrames
  };
}());
