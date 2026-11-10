/* tempera 的每 shot MG 层：拥有入场/漂移状态，几何全部委托给 compositions。
 * 源：src/components/visualizer/tempera/temperaBlocks.ts（168）
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 它是**构造 composition ctx 的那一层**：`add` / `createGroup` / `bleed` / `gradient` 都在这里造。
 * 必须照抄的判据
 * --------------
 * 1. `carry = max(w,h)*0.09`，`bleed = carry + max(w,h)*0.08`。bleed 少一分，整张 shot 一滑就露背景。
 * 2. `add` 的 delay/span 是 **shot 时长的比例**，在这一层才换成秒，且短 shot 要按预算压缩而不是丢掉后到的项。
 * 3. `gradient` 只在调色板有 gradient 时非 null，轴由 seed 定（temperaHash01(seed,3,197)）。
 * 4. 这里**没有出场 ramp**：交接滑动是 shot 容器的事，出去的构图要带着自己的字一起走。
 * 5. `drift`/`grow` 绕自身原点，所以偏心形状必须放在 createGroup 的局部坐标里。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var motion = window.foliaTemperaMotion;
  var mg = window.foliaTemperaMg;
  var program = window.foliaTemperaProgram;
  var compositions = window.foliaTemperaCompositions;
  if (!motion || !mg || !program || !compositions) return;

  var clamp01 = motion.clamp01;
  var easeTemperaEnter = motion.easeTemperaEnter;
  var easeTemperaInOut = motion.easeTemperaInOut;
  var resolveShotPacedDuration = motion.resolveShotPacedDuration;
  var temperaHash01 = mg.hash01;
  var drawTemperaComposition = compositions.draw;

  /* ---- tempera/temperaBlocks.ts ---- */
// src/components/visualizer/tempera/temperaBlocks.ts
// Screentone MG layer per shot: owns enter/exit motion state and delegates all geometry to
// temperaCompositions. Timings are fractions of the shot's own duration, so the graphics
// advance with the lyric rather than finishing in a fixed fraction of a second. Nothing here
// reacts to audio; a seek repaints exactly the same frame.




const buildTemperaBlocks = (
    pixi,
    options,
) => {
    const container = new pixi.Container();
    const items = [];
    const flowX = Math.cos(options.flowAngle);
    const flowY = Math.sin(options.flowAngle);
    // Per-item stagger distance only. The bulk of the hand-off travel belongs to the shot
    // container, which moves the type along with the graphics.
    const carry = Math.max(options.width, options.height) * 0.09;

    const add = (node, blockOptions = {}, parent) => {
        items.push({
            node,
            baseX: node.x,
            baseY: node.y,
            baseAlpha: blockOptions.alpha ?? 1,
            enterDX: blockOptions.enterDX ?? 0,
            enterDY: blockOptions.enterDY ?? 0,
            delayFraction: blockOptions.delay ?? 0,
            spanFraction: blockOptions.span ?? 0.45,
            drift: blockOptions.drift ?? false,
            driftPhase: temperaHash01(options.seed, items.length, 173) * Math.PI * 2,
            grow: blockOptions.grow ?? false,
        });
        (parent ?? container).addChild(node);
    };

    // Tilted sub-groups (poster compositions) keep their children in local coordinates.
    const createGroup = (rotation, x, y) => {
        const group = new pixi.Container();
        group.rotation = rotation;
        group.position.set(x, y);
        container.addChild(group);
        return group;
    };

    const context = {
        pixi,
        kind: options.kind,
        palette: options.palette,
        decor: options.decor,
        width: options.width,
        height: options.height,
        seed: options.seed,
        showDecor: options.showDecor,
        flowAngle: options.flowAngle,
        bleed: carry + Math.max(options.width, options.height) * 0.08,
        // Gradient mode only: a per-shot axis so neighbouring compositions do not all ramp
        // the cover colours the same way.
        gradient: options.palette.gradient
            ? { colors: options.palette.gradient, angle: temperaHash01(options.seed, 3, 197) * Math.PI * 2 }
            : null,
        add,
        createGroup,
    };
    drawTemperaComposition(context);

    // Drives block motion from absolute time so seeks render the same frame. There is no exit
    // ramp here: the shot container owns the hand-off slide, so the outgoing composition
    // leaves as one piece with its own type still attached to it.
    // Each item's stagger in seconds depends only on the lyric's length, which is fixed for the
    // shot, so it is resolved once and reused until a different length comes in.
    let schedulePace = Number.NaN;
    const delays = new Float64Array(items.length);
    const spans = new Float64Array(items.length);
    const resolveSchedule = (paceDuration) => {
        if (paceDuration === schedulePace) return;
        schedulePace = paceDuration;
        const budget = Math.max(0.5, paceDuration);
        items.forEach((item, index) => {
            const rawDelay = resolveShotPacedDuration(paceDuration, item.delayFraction, 0, 1.4);
            const rawSpan = resolveShotPacedDuration(paceDuration, item.spanFraction, 0.7, 2.6);
            // Short shots compress the whole stagger instead of dropping the late items.
            const compress = Math.min(1, budget / (rawDelay + rawSpan));
            delays[index] = rawDelay * compress;
            spans[index] = rawSpan * compress;
        });
    };

    const updateTime = (time, shotStart, shotEnd, lyricEnd) => {
        const duration = Math.max(shotEnd - shotStart, 0.2);
        const paceDuration = Math.max((lyricEnd ?? shotEnd) - shotStart, 0.2);
        const progress = clamp01((time - shotStart) / duration);
        // A steady creep along the flow vector for the whole shot; the camera rides the same
        // axis, so the frame is always already moving when the next composition arrives.
        const creep = easeTemperaInOut(progress) * carry * 0.35;
        resolveSchedule(paceDuration);

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const enter = easeTemperaEnter((time - shotStart - delays[index]) / spans[index]);
            item.node.alpha = item.baseAlpha * enter;
            item.node.visible = enter > 0.001;
            const behind = (1 - enter) * carry - creep;
            item.node.position.set(
                item.baseX + item.enterDX * (1 - enter) - flowX * behind,
                item.baseY + item.enterDY * (1 - enter) - flowY * behind,
            );
            if (item.drift || item.grow) {
                // A slow float replaces the old audio pulse: deterministic, seek-safe, and it
                // keeps decor from looking frozen once the shot has settled.
                const float = item.drift ? 1 + Math.sin(time * 0.5 + item.driftPhase) * 0.02 : 1;
                item.node.scale.set(item.grow ? Math.max(0.0001, enter) * float : float, float);
                if (item.drift) item.node.rotation = Math.sin(time * 0.33 + item.driftPhase) * 0.012;
            }
        }
    };

    return { container, updateTime };
};


  window.foliaTemperaBlocks = {
    buildTemperaBlocks: buildTemperaBlocks
  };
}());
