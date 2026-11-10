/* tempera 的逐帧姿态（纯函数）：镜头/呼吸、段落转场、单 shot 交接、场景级决策。
 * 源：src/components/visualizer/tempera/temperaCamera.ts（67）+ temperaTransitions.ts（117）
 *      + temperaShotFrame.ts（124）+ temperaSceneFrame.ts（114）
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 镜头只在编译期定下的 camera / cameraEnd 两个 key 之间插值，**从不追踪单个字**。
 * 2. 呼吸（breath）在歌词揭晓完成后才渐入：`resolveTemperaBreathWeight`，否则句子中途会跳一下。
 * 3. 交接窗口 = `resolveShotPacedDuration(shot 时长, 0.3, 0.4, 1.1)`；进出两个 shot 在同一段时间里同时跑，
 *    出去的构图是**被推走**而不是被切掉 —— 入场不淡出，只有出场淡。
 * 4. 段落转场三种：block-wipe（整块扫过，扫到 1 时正好盖满，换场在满盖下发生）、camera-pan、shape-carry。
 *    三种都沿 flowAngle 走，所以边界读成一次连续移动而不是一次剪辑。
 * 5. `block-wipe` 是唯一在边界**之后**才入场的：它的 enter 是"揭开"。其余都在 outgoing 窗口里预卷。
 * 6. `requiresTemperaSceneRebuild` 只列真正改变"场景是什么"的字段：镜头与字动效每帧现读，改它们不该丢场景。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var motion = window.foliaTemperaMotion;
  var mg = window.foliaTemperaMg;
  if (!motion || !mg) return;

  var easeTemperaInOut = motion.easeTemperaInOut;
  var clamp01 = motion.clamp01;
  var hashTemperaSeed = mg.hashSeed;
  var easeTemperaEnter = motion.easeTemperaEnter;
  var resolveShotPacedDuration = motion.resolveShotPacedDuration;
  var resolveTemperaGlyphMotion = motion.resolveTemperaGlyphMotion;

  /* ---- tempera/temperaCamera.ts ---- */
// src/components/visualizer/tempera/temperaCamera.ts
// Shot-level camera: interpolates the compiled start/end keyframes of a shot and layers
// a deterministic breathing float. It never tracks individual glyphs.
const cameraClamp01 = (value) => Math.min(1, Math.max(0, value));

const cameraEaseInOut = (value) => {
    const t = cameraClamp01(value);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const cameraLerp = (from, to, amount) => from + (to - from) * amount;


// Resolves the shot camera path at a progress; progress may exceed 1 slightly during
// inter-line gaps so the frame keeps drifting instead of freezing.
const resolveTemperaCameraFrame = (shot, progress) => {
    const clamped = cameraClamp01(progress);
    // Blend constant velocity into the ease so the middle of the shot never stalls.
    const eased = clamped * 0.5 + cameraEaseInOut(clamped) * 0.5;
    const overshoot = Math.max(0, progress - 1) * 0.35;
    const amount = eased + overshoot;
    const { camera: start, cameraEnd: end } = shot;
    return {
        x: cameraLerp(start.x, end.x, amount),
        y: cameraLerp(start.y, end.y, amount),
        scale: cameraLerp(start.zoom, end.zoom, amount),
        rotation: cameraLerp(start.rotation, end.rotation, amount),
    };
};

const TEMPERA_CAMERA_BREATH_MAX_OFFSET = 0.006;
const TEMPERA_CAMERA_BREATH_MAX_SCALE = 0.002;
const TEMPERA_CAMERA_BREATH_MAX_ROTATION = 0.0015;

// Deterministic hand-held breathing float: layered incommensurate sines keep the drift
// organic, and absolute-time evaluation keeps direct seeks identical to playback.
const resolveTemperaCameraBreath = (time, phase = 0) => {
    const tau = time * Math.PI * 2;
    return {
        x: (Math.sin(tau * 0.13 + phase) * 0.65 + Math.sin(tau * 0.31 + phase * 1.7) * 0.35)
            * TEMPERA_CAMERA_BREATH_MAX_OFFSET,
        y: (Math.cos(tau * 0.11 + phase * 2.3) * 0.65 + Math.sin(tau * 0.29 + phase * 0.9) * 0.35)
            * TEMPERA_CAMERA_BREATH_MAX_OFFSET,
        scale: Math.sin(tau * 0.09 + phase * 1.3) * TEMPERA_CAMERA_BREATH_MAX_SCALE,
        rotation: Math.sin(tau * 0.07 + phase * 2.9) * TEMPERA_CAMERA_BREATH_MAX_ROTATION,
    };
};

// Ramps the breathing float in after the lyric reveal completes so it never pops in mid-line.
const resolveTemperaBreathWeight = (time, revealDoneTime, rampDuration = 1.2) => {
    if (rampDuration <= 0) return time >= revealDoneTime ? 1 : 0;
    return cameraEaseInOut(cameraClamp01((time - revealDoneTime) / rampDuration));
};


  /* ---- tempera/temperaTransitions.ts ---- */
// src/components/visualizer/tempera/temperaTransitions.ts
// Seek-stable transition frames for *paragraph* boundaries. Shot boundaries need none: the
// compositions hand off to each other directly in the runtime. Every kind here is led by the
// large graphics or by the camera and runs along the shot's flow angle, so the outgoing and
// incoming paragraphs travel the same way and the boundary reads as one continuous move.

const IDLE_TEMPERA_TRANSITION_FRAME = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    alpha: 1,
    blur: 0,
    wipe: 0,
    wipeAngle: 0,
};

/**
 * Resolves one side of a boundary. `exit` moves the outgoing composition further along the
 * flow; `enter` starts the incoming one upstream and lets it arrive on the same vector, so
 * across the swap the on-screen motion never changes direction.
 */
const resolveTemperaTransitionEffectFrame = (
    kind,
    phase,
    progress,
    flowAngle,
) => {
    const linear = clamp01(progress);
    const eased = easeTemperaInOut(linear);
    const flowX = Math.cos(flowAngle);
    const flowY = Math.sin(flowAngle);

    if (kind === 'block-wipe') {
        // The scene stays fully opaque and in place; a screen-sized block slides across on the
        // flow vector and the swap happens under full coverage. The sweep is one continuous
        // 0..2 travel: 0..1 brings the block in, 1..2 carries it off the far side, so the
        // block never reverses direction halfway through the boundary.
        return {
            ...IDLE_TEMPERA_TRANSITION_FRAME,
            wipe: phase === 'exit' ? eased : 1 + eased,
            wipeAngle: flowAngle,
        };
    }

    if (kind === 'camera-pan') {
        const travel = 0.5;
        // Alpha is held until the composition is nearly off frame, so the swipe never dips
        // to an empty screen in the middle of the move.
        const offset = phase === 'exit' ? eased * travel : -(1 - eased) * travel;
        const alpha = phase === 'exit'
            ? 1 - clamp01((linear - 0.72) / 0.28)
            : clamp01(linear / 0.3);
        return {
            ...IDLE_TEMPERA_TRANSITION_FRAME,
            x: flowX * offset,
            y: flowY * offset,
            scale: 1 + (phase === 'exit' ? eased : 1 - eased) * 0.03,
            alpha,
            wipeAngle: flowAngle,
        };
    }

    // shape-carry: the composition keeps drifting on the flow vector while it dilates and
    // softens, as if the next graphic were pulling it out of focus. No hard cut, no glitch.
    const drift = (phase === 'exit' ? eased : eased - 1) * 0.09;
    const away = phase === 'exit' ? eased : 1 - eased;
    return {
        ...IDLE_TEMPERA_TRANSITION_FRAME,
        x: flowX * drift,
        y: flowY * drift,
        scale: 1 + away * 0.07,
        alpha: phase === 'exit' ? 1 - clamp01((linear - 0.55) / 0.45) : clamp01(linear / 0.45),
        blur: away * 6,
        wipeAngle: flowAngle,
    };
};

const resolveTemperaExitTransitionFrame = (
    paragraph,
    time,
    enabled,
) => {
    const transition = paragraph.transitionOut;
    if (!enabled || !transition || time < transition.startTime) return IDLE_TEMPERA_TRANSITION_FRAME;
    const progress = (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001);
    const flowAngle = paragraph.shots.at(-1)?.flowAngle ?? 0;
    return resolveTemperaTransitionEffectFrame(transition.kind, 'exit', progress, flowAngle);
};

const resolveTemperaEnterTransitionFrame = (
    kind,
    timeSinceStart,
    duration,
    enabled,
    flowAngle,
) => {
    if (!enabled || !kind || timeSinceStart < 0 || timeSinceStart > duration) {
        return IDLE_TEMPERA_TRANSITION_FRAME;
    }
    return resolveTemperaTransitionEffectFrame(kind, 'enter', timeSinceStart / Math.max(duration, 0.001), flowAngle);
};

  /* ---- tempera/temperaShotFrame.ts ---- */
// src/components/visualizer/tempera/temperaShotFrame.ts
// 单个 shot 的逐帧姿态：镜头位移与呼吸、shot 之间的推入推出交接、图形与图片层时间、逐字运动。
// 只按绝对播放时间写 view，不持有状态。

const resolveAnimationScale = (theme) => (
    theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1
);

/**
 * How long a finished shot keeps sliding out while the next one is already sliding in.
 * The overlap is the whole point: two compositions share the frame and the outgoing one
 * carries the eye into the incoming one instead of being cut away.
 */
const resolveShotHandoff = (view) => (
    resolveShotPacedDuration(view.shot.endTime - view.shot.startTime, 0.3, 0.4, 1.1)
);

const resolveTemperaShotExit = (view, time) => (
    clamp01((time - view.shot.endTime) / resolveShotHandoff(view))
);

const updateTemperaShot = (
    view,
    time,
    width,
    height,
    tuning,
    theme,
) => {
    const duration = Math.max(view.shot.endTime - view.shot.startTime, 0.001);
    const rawProgress = (time - view.shot.startTime) / duration;
    const animationScale = resolveAnimationScale(theme);
    const camera = tuning.cameraIntensity * animationScale;
    const motion = tuning.glyphMotion * animationScale;
    const frame = resolveTemperaCameraFrame(view.shot, rawProgress);

    const breathWeight = resolveTemperaBreathWeight(time, view.revealDoneTime);
    if (breathWeight > 0) {
        const breathPhase = (hashTemperaSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2;
        const breath = resolveTemperaCameraBreath(time, breathPhase);
        frame.x += breath.x * breathWeight;
        frame.y += breath.y * breathWeight;
        frame.scale += breath.scale * breathWeight;
        frame.rotation += breath.rotation * breathWeight;
    }

    // Hand-off: the shot arrives from upstream on its own flow vector and, once it is
    // over, keeps travelling downstream out of frame. Both shots run this at the same
    // time during the overlap, so the outgoing composition visibly pushes past the
    // incoming one rather than being cut away.
    const handoff = resolveShotHandoff(view);
    const span = Math.max(width, height);
    // The arrival is front-loaded on purpose: the glyphs start revealing on the shot's
    // own timeline, so a slow entrance would expose type that is still off frame.
    const enter = easeTemperaEnter(clamp01((time - view.shot.startTime) / (handoff * 0.8)));
    const exit = easeTemperaInOut(resolveTemperaShotExit(view, time));
    const travel = exit * span * 0.55 - (1 - enter) * span * 0.32;
    view.container.position.set(
        view.baseX + frame.x * width * camera + Math.cos(view.shot.flowAngle) * travel,
        view.baseY + frame.y * height * camera + Math.sin(view.shot.flowAngle) * travel,
    );
    // Opaque on the way in: this is a push, not a dissolve. Only the exit fades.
    view.container.alpha = 1 - exit;
    view.container.scale.set((1 + (frame.scale - 1) * camera) * (1 - exit * 0.08));
    view.container.rotation = frame.rotation * camera;

    // Two ends on purpose. The graphics' entrance stagger is paced against the lyric this
    // shot carries; the steady flow creep runs for the shot's whole visible life, which is
    // tiled up to the next shot's start and can be seconds longer.
    view.blocks.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime);
    view.images.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime);

    view.glyphs.forEach(glyph => {
        const frame = resolveTemperaGlyphMotion(glyph.motion, time, motion);
        const x = glyph.baseX + frame.x;
        const y = glyph.baseY + frame.y;
        glyph.display.alpha = frame.alpha;
        glyph.display.visible = frame.visible;
        glyph.display.position.set(x, y);
        glyph.display.scale.set(frame.scaleX, frame.scaleY);
        glyph.display.rotation = frame.rotation;
        if (glyph.shadow) {
            glyph.shadow.alpha = frame.alpha * 0.34;
            glyph.shadow.visible = frame.visible;
            glyph.shadow.position.set(x + glyph.shadowDX, y + glyph.shadowDY);
            glyph.shadow.scale.set(frame.scaleX, frame.scaleY);
            glyph.shadow.rotation = frame.rotation;
        }
        // Echoes trail further back along the entrance vector the deeper they sit.
        const echoVisible = frame.visible && frame.echoAlpha > 0.004;
        glyph.echoes.forEach((echo, index) => {
            echo.visible = echoVisible;
            if (!echoVisible) return;
            const depth = 1 + index * 0.85;
            echo.alpha = frame.echoAlpha / (index + 1.4);
            echo.position.set(
                glyph.baseX + frame.echoX * depth,
                glyph.baseY + frame.echoY * depth,
            );
            echo.scale.set(frame.scaleX, frame.scaleY);
            echo.rotation = frame.rotation;
        });
    });
};

  /* ---- tempera/temperaSceneFrame.ts ---- */
// src/components/visualizer/tempera/temperaSceneFrame.ts
// 段落场景级的逐帧决策（纯函数）：该段这一帧走入场、预卷还是出场转场，场景内哪个 shot 是当前 shot，
// 以及一次设置改动是否要丢掉已建好的场景。

/**
 * The transition frame a visible paragraph scene is posed with this frame. `isIncoming` marks the
 * next paragraph pre-rolled through the outgoing window; `outgoingTransition` is the active
 * paragraph's `transitionOut`.
 */
const resolveTemperaSceneTransitionFrame = (
    program,
    scene,
    index,
    time,
    isIncoming,
    outgoingTransition,
    transitionsEnabled,
) => {
    const previousTransition = index > 0
        ? program.paragraphs[index - 1]?.transitionOut
        : null;
    const enterDuration = previousTransition
        ? Math.max(0.35, Math.min(1, previousTransition.endTime - previousTransition.startTime))
        : 0;
    // Only a wipe still enters after the boundary; everything else has already
    // arrived by then, because it was pre-rolled through the outgoing window.
    const entering = transitionsEnabled
        && previousTransition !== null
        && previousTransition.kind === 'block-wipe'
        && time >= scene.paragraph.startTime
        && time <= scene.paragraph.startTime + enterDuration;
    return isIncoming && outgoingTransition
        ? resolveTemperaEnterTransitionFrame(
            outgoingTransition.kind,
            time - outgoingTransition.startTime,
            Math.max(0.001, outgoingTransition.endTime - outgoingTransition.startTime),
            true,
            // Enter on the incoming paragraph's own flow, so the arrival continues
            // the direction the outgoing composition was already travelling.
            scene.paragraph.shots[0]?.flowAngle ?? 0,
        )
        : entering && previousTransition
            ? resolveTemperaEnterTransitionFrame(
                previousTransition.kind,
                time - scene.paragraph.startTime,
                enterDuration,
                true,
                scene.paragraph.shots[0]?.flowAngle ?? 0,
            )
            : resolveTemperaExitTransitionFrame(
                scene.paragraph,
                time,
                transitionsEnabled,
            );
};

/** Strictly determine the single active shot within this scene to avoid intra-scene residues. */
const findTemperaActiveShotIndex = (scene, time) => {
    let activeShotIndex = 0;
    for (let i = scene.shots.length - 1; i >= 0; i--) {
        if (time >= scene.shots[i].shot.startTime) {
            activeShotIndex = i;
            break;
        }
    }
    return activeShotIndex;
};

/**
 * Which tuning fields change what a scene *is*, as opposed to how it is animated. Camera and
 * glyph motion are read fresh every frame, and image placement is re-applied to the existing
 * sprites, so neither needs the cached scenes thrown away. The image *set* does: a new id has
 * no sprite yet.
 */
const requiresTemperaSceneRebuild = (previous, next) => (
    previous.colorMode !== next.colorMode
    // Renderer resolution and fixed-resolution filter passes must change together.
    || previous.textureResolution !== next.textureResolution
    // Entrance pacing is baked into each glyph's settleTime at layout time, unlike glyphMotion
    // which the solver reads fresh every frame.
    || previous.glyphSettleStretch !== next.glyphSettleStretch
    || previous.showBlocks !== next.showBlocks
    || previous.showDecor !== next.showDecor
    || previous.textInversion !== next.textInversion
    || previous.enableTransitions !== next.enableTransitions
    || previous.postProcessEnabled !== next.postProcessEnabled
    // Baked into every filter on the scene at build time, so it cannot be pushed in place.
    || previous.postProcessTextureCompression !== next.postProcessTextureCompression
    || previous.postProcessGrain !== next.postProcessGrain
    || previous.postProcessContrast !== next.postProcessContrast
    || previous.postProcessRgbShift !== next.postProcessRgbShift
    || previous.postProcessVignette !== next.postProcessVignette
    || previous.postProcessLensDistortion !== next.postProcessLensDistortion
    || previous.layerImageDepth !== next.layerImageDepth
    || previous.layerImageFrequency !== next.layerImageFrequency
    || previous.layerImages.length !== next.layerImages.length
    || previous.layerImages.some((image, index) => (
        image.id !== next.layerImages[index]?.id
        || image.align !== next.layerImages[index]?.align
        || image.verticalAlign !== next.layerImages[index]?.verticalAlign
    ))
);


  window.foliaTemperaFrame = {
    resolveTemperaCameraFrame: resolveTemperaCameraFrame,
    resolveTemperaCameraBreath: resolveTemperaCameraBreath,
    resolveTemperaBreathWeight: resolveTemperaBreathWeight,
    TEMPERA_CAMERA_BREATH_MAX_OFFSET: TEMPERA_CAMERA_BREATH_MAX_OFFSET,
    TEMPERA_CAMERA_BREATH_MAX_SCALE: TEMPERA_CAMERA_BREATH_MAX_SCALE,
    TEMPERA_CAMERA_BREATH_MAX_ROTATION: TEMPERA_CAMERA_BREATH_MAX_ROTATION,
    IDLE_TEMPERA_TRANSITION_FRAME: IDLE_TEMPERA_TRANSITION_FRAME,
    resolveTemperaTransitionEffectFrame: resolveTemperaTransitionEffectFrame,
    resolveTemperaExitTransitionFrame: resolveTemperaExitTransitionFrame,
    resolveTemperaEnterTransitionFrame: resolveTemperaEnterTransitionFrame,
    resolveTemperaShotExit: resolveTemperaShotExit,
    updateTemperaShot: updateTemperaShot,
    resolveTemperaSceneTransitionFrame: resolveTemperaSceneTransitionFrame,
    findTemperaActiveShotIndex: findTemperaActiveShotIndex,
    requiresTemperaSceneRebuild: requiresTemperaSceneRebuild
  };
}());
