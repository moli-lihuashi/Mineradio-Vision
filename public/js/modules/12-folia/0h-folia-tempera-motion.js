/* tempera 的运动求解层：缓动原语、七种入场样式、逐字姿态求解。
 * 源：src/components/visualizer/tempera/temperaMotionEasing.ts（48）+ temperaEnterStyles.ts（118）
 *      + temperaMotion.ts（143） · 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 一切都是绝对时间的纯函数：同一次 seek 必须画出和连续播放完全相同的帧，这里不许有状态。
 * 2. `resolveTemperaGlyphMotion` 的 alpha/echo 走**独立且封顶 1.35s** 的窗口（MAX_REVEAL_WINDOW），
 *    位置与缩放走被拉伸到整行的窗口。把两者合成一个窗口，长句的字会在飞行途中半透明、读不出来。
 * 3. 已唱强调是**缩放**而不是画底色：底色会变成反色滤镜读到的背景，效果就退化成色块。
 * 4. `glyphMotion: 0` 把入场拉回排好的位置（各轴往 1 收敛），不是反向播放。
 * 5. `resolveShotPacedDuration` 夹在 [min,max] 之间：它把 block 动效绑到歌词语速，不是固定秒数。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  /* ---- tempera/temperaMotionEasing.ts ---- */
// src/components/visualizer/tempera/temperaMotionEasing.ts
// The easing primitives, split out so entrance styles and the glyph solver can share them
// without importing each other.
const clamp01 = (value) => Math.min(1, Math.max(0, value));

const cubicCoordinate = (point1, point2, time) => {
    const inverse = 1 - time;
    return 3 * inverse * inverse * time * point1
        + 3 * inverse * time * time * point2
        + time * time * time;
};

// Resolves CSS-style cubic-bezier timing by solving the x curve before sampling y.
const resolveCubicBezier = (
    x1,
    y1,
    x2,
    y2,
    value,
) => {
    const target = clamp01(value);
    if (target === 0 || target === 1) return target;
    let low = 0;
    let high = 1;
    let parameter = target;
    for (let iteration = 0; iteration < 12; iteration += 1) {
        const x = cubicCoordinate(x1, x2, parameter);
        if (x < target) low = parameter;
        else high = parameter;
        parameter = (low + high) / 2;
    }
    return cubicCoordinate(y1, y2, parameter);
};

/**
 * Long, soft deceleration: decisive at the start, then a long creeping tail. Gentler curves
 * were tried here and read as sluggish; the punch of the fast opening is what gives the whole
 * mode its motion, so leave the shape alone.
 */
const easeTemperaEnter = (value) => resolveCubicBezier(0.22, 1, 0.36, 1, value);
const easeTemperaInOut = (value) => resolveCubicBezier(0.62, 0, 0.32, 1, value);

/** Mild anticipation on the way out; used for scale so glyphs settle with a small overshoot. */
const easeTemperaSoftBack = (value) => {
    const t = clamp01(value);
    const c = 1.42;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

  /* ---- tempera/temperaEnterStyles.ts ---- */
// src/components/visualizer/tempera/temperaEnterStyles.ts
// The ways a glyph can arrive. One style is picked per word at layout time, so a word lands as
// a unit while neighbouring words arrive differently — that variety is what keeps a collage
// from reading as one uniform slide-in.
//
// These are direction variants, deliberately. Long-haul fly-ins and single-axis stretches were
// tried and read as gimmicks against the deterministic typesetting: every style here travels
// the modest distance the layout already sized for the shot, and scales uniformly.
const TEMPERA_ENTER_STYLES = [
    'slide',
    'from-left',
    'from-right',
    'from-above',
    'from-below',
    'swing',
    'stamp',
];



// Every direction variant reuses the magnitude the layout already picked for this glyph, so
// switching style changes where a glyph comes from, never how far it has to come.
const directional = (
    input,
    travel,
    uniform,
    dirX,
    dirY,
    rotationScale,
) => {
    const magnitude = Math.hypot(input.enterX, input.enterY);
    // Normalised, so the slight cross-axis lean tilts the approach without lengthening it.
    const length = Math.hypot(dirX, dirY) || 1;
    return {
        x: (dirX / length) * magnitude * travel,
        y: (dirY / length) * magnitude * travel,
        rotation: input.enterRotation * rotationScale * travel,
        scaleX: uniform,
        scaleY: uniform,
        echo: travel,
    };
};

/**
 * Resolves one style's offset/rotation/scale at a point in its entrance.
 * `travel` runs 1 -> 0 across the window and `linear` is the raw 0 -> 1 progress; styles that
 * need their own curve re-ease `linear` rather than reusing the shared travel.
 */
const resolveTemperaEnterFrame = (
    style,
    input,
    travel,
    linear,
) => {
    const settle = easeTemperaSoftBack(linear);
    const uniform = input.enterScale + (1 - input.enterScale) * settle;

    switch (style) {
        case 'from-left':
            return directional(input, travel, uniform, -1, 0.12, 0.4);
        case 'from-right':
            return directional(input, travel, uniform, 1, -0.12, 0.4);
        case 'from-above':
            return directional(input, travel, uniform, 0.12, -1, 0.4);
        case 'from-below':
            return directional(input, travel, uniform, -0.12, 1, 0.4);
        case 'swing':
            // The shot's own approach vector, but the glyph rotates in around its centre.
            return {
                x: input.enterX * 0.6 * travel,
                y: input.enterY * 0.6 * travel,
                rotation: (input.enterRotation + Math.sign(input.enterRotation || 1) * 0.95) * travel,
                scaleX: uniform,
                scaleY: uniform,
                echo: travel * 0.8,
            };
        case 'stamp':
            // The one in-place style: slams down onto the page from oversize. No travel, so
            // no echo trail either.
            return {
                x: 0,
                y: 0,
                rotation: input.enterRotation * 0.6 * travel,
                scaleX: 1 + travel * 0.7,
                scaleY: 1 + travel * 0.7,
                echo: 0,
            };
        case 'slide':
        default:
            // The shot's own fanned vector, straight in.
            return {
                x: input.enterX * travel,
                y: input.enterY * travel,
                rotation: input.enterRotation * travel,
                scaleX: uniform,
                scaleY: uniform,
                echo: travel,
            };
    }
};

  /* ---- tempera/temperaMotion.ts ---- */
// src/components/visualizer/tempera/temperaMotion.ts
// Pure absolute-time motion evaluation for Tempera. Every value is derived from the clock
// and per-glyph constants, so a seek paints exactly the frame continuous playback would.
{ clamp01, easeTemperaEnter, easeTemperaInOut, easeTemperaSoftBack, resolveCubicBezier };



const CURRENT_EMPHASIS = 0.05;
/** How long the sung swell takes to fall away once the glyph is done. */
const EMPHASIS_DECAY = 0.26;
const ECHO_ALPHA = 0.5;
/**
 * Longest window the *reveal* - opacity and the motion echo - is allowed to run over.
 *
 * The settle window itself is stretched to the end of the glyph's line so the block is still
 * easing into place as the line finishes. Fading in and trailing ghost copies over that whole
 * stretch would be a different thing entirely: the type has to be readable while it travels,
 * and an echo that outlives the opening reads as a smear rather than as motion. This is the
 * cap the settle window used to carry, so any entrance short enough to predate the stretch
 * behaves exactly as it did.
 */
const MAX_REVEAL_WINDOW = 1.35;
/** How much wider the sung block gets. Deliberately small: this is tracking, not drift. */
const RELEASE_TRACKING = 0.055;

// Resolves one glyph's entrance plus the post-sung tracking release that keeps a finished
// line alive without breaking its layout.
// `motion` is the tuning/theme-scaled amount; 0 pins glyphs to their layout position.
const resolveTemperaGlyphMotion = (
    glyph,
    time,
    motion,
) => {
    const window = Math.max(glyph.settleTime - glyph.startTime, 0.08);
    const linear = clamp01((time - glyph.startTime) / window);
    const travel = 1 - easeTemperaEnter(linear);
    const entrance = resolveTemperaEnterFrame(glyph.enterStyle, glyph, travel, linear);
    // Opacity and the echo run on their own capped window; position and scale keep the full
    // stretched one, which is what turns a long line into one continuous move.
    const reveal = clamp01((time - glyph.startTime) / Math.min(window, MAX_REVEAL_WINDOW));
    // Alpha resolves faster than position, so the glyph is readable while it is still moving.
    const alpha = easeTemperaInOut(clamp01(reveal * 2.4));

    // Current-glyph emphasis is a small scale swell, not a painted backing block: anything
    // drawn behind the glyph would become the backdrop the inversion filter reads, which is
    // exactly what turns the effect into a colored box instead of a reaction to the artwork.
    //
    // It tracks the sung window itself - rise, hold, decay - rather than counting down from
    // the start over a synthetic length. The old form gave every glyph a pulse whether or not
    // it was ever sung, so each merged punctuation mark (zero-length by construction, since
    // the parser's words do not cover it) popped on its own.
    const sungWindow = glyph.endTime - glyph.startTime;
    const attack = Math.min(0.12, sungWindow * 0.5);
    const emphasis = sungWindow <= 0
        ? 0
        : easeTemperaInOut(clamp01((time - glyph.startTime) / Math.max(attack, 0.02)))
            * (1 - easeTemperaInOut(clamp01((time - glyph.endTime) / EMPHASIS_DECAY)));

    // Release: once a glyph has been sung the block slowly opens its tracking instead of
    // freezing. A line that finished early would otherwise sit dead for the rest of a long
    // shot. This is a rigid, centre-out expansion - no wander, no float, no rotation - because
    // a drifting glyph would contradict the deterministic typesetting the mode is built on.
    // The ramp starts at the later of "sung" and "settled" so it never fights the entrance.
    const releaseStart = Math.max(glyph.endTime, glyph.settleTime);
    const release = easeTemperaInOut(clamp01(
        (time - releaseStart) / Math.max(glyph.releaseTime - releaseStart, 0.001),
    ));
    const spread = release * clamp01(motion) * RELEASE_TRACKING;
    const driftX = glyph.trackingX * spread;
    const driftY = glyph.trackingY * spread;

    // A muted motion setting pulls the entrance back toward the resting pose instead of
    // inverting it, so `glyphMotion: 0` pins every style to its layout position.
    const amount = clamp01(motion);
    const swell = emphasis * CURRENT_EMPHASIS * amount;
    return {
        visible: time >= glyph.startTime,
        alpha,
        x: entrance.x * motion + driftX,
        y: entrance.y * motion + driftY,
        rotation: glyph.rotation + entrance.rotation * motion,
        scaleX: entrance.scaleX + (1 - entrance.scaleX) * (1 - amount) + swell,
        scaleY: entrance.scaleY + (1 - entrance.scaleY) * (1 - amount) + swell,
        echoX: entrance.x * motion,
        echoY: entrance.y * motion,
        echoAlpha: entrance.echo * (1 - easeTemperaEnter(reveal)) * ECHO_ALPHA * amount,
    };
};

/**
 * Maps a shot-relative fraction onto seconds, clamped so a very short or very long shot
 * still animates at a watchable speed. This is what ties block motion to the line's pace
 * instead of to a fixed wall-clock duration.
 */
const resolveShotPacedDuration = (
    shotDuration,
    fraction,
    minSeconds,
    maxSeconds,
) => Math.min(maxSeconds, Math.max(minSeconds, shotDuration * fraction));


  window.foliaTemperaMotion = {
    clamp01: clamp01,
    resolveCubicBezier: resolveCubicBezier,
    easeTemperaEnter: easeTemperaEnter,
    easeTemperaInOut: easeTemperaInOut,
    easeTemperaSoftBack: easeTemperaSoftBack,
    TEMPERA_ENTER_STYLES: TEMPERA_ENTER_STYLES,
    resolveTemperaEnterFrame: resolveTemperaEnterFrame,
    resolveTemperaGlyphMotion: resolveTemperaGlyphMotion,
    resolveShotPacedDuration: resolveShotPacedDuration
  };
}());
