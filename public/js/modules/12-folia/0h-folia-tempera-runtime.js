/* tempera 的宿主运行时：pixi 生命周期、段落场景缓存、换歌就地交接、每帧调度。
 * 源：src/components/visualizer/tempera/createTemperaPixiRuntime.ts（651）
 *      + pixiTextureBudget.ts（113）+ pixiSceneCache.ts（111）+ pixiSongSwap.ts（101）
 *      + pixiFilterPoolCompat.ts（68）+ types.ts:674 的 DEFAULT_TEMPERA_TUNING（21 项）
 *      + VisualizerTempera.tsx（291）→ registerFoliaMode('tempera')
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. `backgroundAlpha: 0` + `useBackBuffer: true`：反色滤镜声明 blendRequired，没有 back buffer
 *    WebGL 渲染器会把那一层的整条滤镜栈跳过（于是没有反色）。
 * 2. `textureResolution` 先过 `snapResolutionToTexturePool` 再进 app.init；所有固定分辨率的 pass
 *    从**渲染分辨率**推导，永远不读 tuning 里的原值。
 * 3. 每帧只做一件重活：先清换歌留下的 retired，再预建后一段，再预建前一段。一次全做就是段落切换的卡顿。
 * 4. 换歌**不重建 renderer**：两帧交接（stage → commit），销毁 retired 一帧一个。重挂会丢 WebGL 上下文。
 * 5. 换下的场景先 `detach` 再逐帧 `destroy`；段落边界两段同时在场，所以 sceneContainer 按段落号排序。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. 没有 React / framer-motion：`currentTime` 是裸数值（`options.time`），`MotionValue.get()` 改成直读。
 * 2. 没有 AbortSignal：用 `destroyed` 标志代替（`options.signal` 永远 undefined）。
 * 3. **不起自己的 ticker/raf**（本项目铁律）：`autoStart:false` + `sharedTicker:false`，
 *    由 foliaWorldTick 调 `renderFrame()` + `renderer.render(stage)`。暂停就只画一帧。
 * 4. pixi 走全局 `PIXI`（vendor/folia/pixi/pixi.min.js UMD 8.21.0），不是 `await import('pixi.js')`；
 *    Folia 在 loadPixi 里把 preferredFragmentPrecision 提成 highp，这里**不动全局**（温 8.21 + ANGLE 下
 *    mediump 就是 fp32，与本机实测一致），只把 8.21 的滤镜纹理池补丁装上。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var program = window.foliaTemperaProgram;
  var scene = window.foliaTemperaScene;
  var layers = window.foliaTemperaLayers;
  var filters = window.foliaTemperaFilters;
  var mg = window.foliaTemperaMg;
  var frame = window.foliaTemperaFrame;
  if (!program || !scene || !layers || !filters || !mg || !frame) return;
  /* types.ts:674 DEFAULT_TEMPERA_TUNING —— 21 项原值，逐字照抄 */
  var DEFAULT_TEMPERA_TUNING = {
  cameraIntensity: 1,
  glyphMotion: 1,
  wholeLineLyrics: false,
  glyphSettleStretch: 0.5,
  colorMode: 'duo',
  showBlocks: true,
  showDecor: true,
  showCornerMarks: true,
  textInversion: true,
  layerImages: [],
  layerImageDepth: 'back',
  layerImageFrequency: 0.6,
  enableTransitions: true,
  textureResolution: 1.5,
  postProcessEnabled: true,
  postProcessTextureCompression: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3,
};

  var destroyPixiDisplayTree = layers.destroyPixiDisplayTree;
  var setPixiDisplayTreeVisibility = layers.setPixiDisplayTreeVisibility;
  var unloadPixiDisplayTree = layers.unloadPixiDisplayTree;
  var findTemperaParagraphIndexAtTime = program.findParagraphIndexAtTime;
  var buildTemperaScene = scene.buildTemperaScene;
  var setTemperaTransitionBlur = filters.setTemperaTransitionBlur;
  var destroyTemperaGradientFills = mg.destroyGradientFills;
  var TemperaImageTextures = layers.TemperaImageTextures;
  var TemperaOverlay = layers.TemperaOverlay;
  var resolveTemperaCreditsFrame = scene.resolveTemperaCreditsFrame;
  var TemperaCreditsLayer = scene.TemperaCreditsLayer;
  var resolveTemperaShotExit = frame.resolveTemperaShotExit;
  var updateTemperaShot = frame.updateTemperaShot;
  var findTemperaActiveShotIndex = frame.findTemperaActiveShotIndex;
  var requiresTemperaSceneRebuild = frame.requiresTemperaSceneRebuild;
  var resolveTemperaSceneTransitionFrame = frame.resolveTemperaSceneTransitionFrame;

  /* ---- pixiFilterPoolCompat.ts：Pixi 8.21.0 在 FilterSystem 还绑着最后一趟 pass 时就回收了屏幕大小的纹理 ---- */
  var TEMPERA_PIXI_COMPAT_PATCHED = '__foliaPixi821FilterPoolCompat';

  function installTemperaPixiFilterPoolCompat(pixi) {
    if (!pixi || pixi.VERSION !== '8.21.0') return;
    var prototype = pixi.FilterSystem.prototype;
    if (prototype[TEMPERA_PIXI_COMPAT_PATCHED]) return;
    prototype[TEMPERA_PIXI_COMPAT_PATCHED] = true;

    var groups = new Set();
    var pool = pixi.TexturePool;
    var unbindPassTextures = function () {
      var source = pixi.Texture.EMPTY.source;
      groups.forEach(function (group) {
        group.setResource(source, 1);
        group.setResource(source.style, 2);
        group.setResource(source, 3);
      });
    };

    /* init 会被 Pixi 的 renderer runner 在任何滤镜渲染之前执行 */
    var init = prototype.init;
    prototype.init = function () {
      if (init) init.call(this);
      groups.add(this._globalFilterBindGroup);
    };
    var destroy = prototype.destroy;
    prototype.destroy = function () {
      groups.delete(this._globalFilterBindGroup);
      this._globalFilterBindGroup.destroy();
      destroy.call(this);
    };

    /* resize / renderer 销毁 / clear() 都会从这里丢弃空闲纹理 */
    var dropTextures = pool._dropTextures;
    pool._dropTextures = function (textures, shouldDestroy) {
      if (shouldDestroy && textures.length > 0) unbindPassTextures();
      dropTextures.call(this, textures, shouldDestroy);
    };
    var returnTexture = pool.returnTexture;
    pool.returnTexture = function (texture, resetStyle) {
      var key = this._poolKey[texture.uid];
      if (key !== undefined && !this._buckets.has(key)) unbindPassTextures();
      returnTexture.call(this, texture, resetStyle);
    };
  }

  function resolveTemperaPixi() {
    var pixi = typeof PIXI !== 'undefined' ? PIXI : null;
    if (!pixi) return null;
    installTemperaPixiFilterPoolCompat(pixi);
    return pixi;
  }

  /* ---- pixiTextureBudget.ts ---- */
// src/components/visualizer/pixiTextureBudget.ts
// Snaps a renderer resolution down to Pixi's power-of-two texture pool, so a full-viewport
// filter pass stops paying for pixels nothing ever draws into.
//
// `TexturePool.getOptimalTexture` rounds every render target up to a power of two per axis
// (`nextPow2(ceil(frame * resolution - 1e-6))`) and keys the pool on that pair. A pass is
// therefore billed for the *bucket*, not for the frame: at the default `textureResolution` of
// 1.5 an 781x850 viewport rasterises to 1172x1275 and lands in a 2048x2048 texture - 16 MiB
// holding 5.7 MiB of picture, 71% of it waste. Tempera and sonnet each run several such passes
// plus the pooled copies the inversion filter's backdrop needs, so the waste multiplies.
//
// The cost is a step function, which is the part that is easy to get wrong: measured on an
// Intel iGPU, growing the window from 640x640 to 700x700 (+18% area) raised tempera's resident
// GEM from 628 to 822 MiB (+31%), because 1.5x700 crosses 1024 and every pooled target doubles
// on both axes at once. Nothing about the picture changed to justify that.
//
// So instead of lowering the resolution across the board - which costs sharpness everywhere and
// still lands in whatever bucket it lands in - this gives back only the resolution that buys a
// smaller bucket. On that same 781x850 viewport it returns 1.2047 rather than 1.5: 20% softer,
// but the pooled targets go 2048x2048 -> 1024x1024, a quarter of the memory, and the frame now
// fills 92% of its texture instead of 29%. Sharpness per byte goes up, not down.
//
// Deliberately conservative: it only ever considers a *single* step down per axis, and only
// accepts one inside `TEXTURE_POOL_MAX_RESOLUTION_DROP`. A viewport whose nearest boundary is
// far away (2000x1200 at 1.5 would need 1.024, a 32% drop) keeps the resolution it asked for -
// paying for the bucket is the lesser evil there.

/**
 * Pixi's own `nextPow2` (`maths/misc/pow2`), reproduced rather than imported.
 *
 * The pool's bucket maths is what this module has to predict exactly, so it has to be the same
 * function; but importing it from `pixi.js` would make this module - and the tuning resolvers
 * that call it - drag the whole renderer into any bundle and any test that touches them, while
 * everything else about Pixi here is behind `loadPixi`'s dynamic import.
 */
const nextPow2 = (value) => {
    let v = value + (value === 0 ? 1 : 0);
    v -= 1;
    v |= v >>> 1;
    v |= v >>> 2;
    v |= v >>> 4;
    v |= v >>> 8;
    v |= v >>> 16;
    return v + 1;
};

/**
 * The pooled texture size Pixi allocates for one axis of a full-viewport pass, in device pixels.
 * Mirrors `TexturePool.getOptimalTexture`, epsilon included - that `- 1e-6` is what keeps a
 * candidate landing exactly on a boundary from rounding back up over float error.
 */
const texturePoolAxis = (cssSize, resolution) => (
    nextPow2(Math.ceil((cssSize * resolution) - 1e-6))
);

/**
 * How much resolution a snap may give up, as a fraction of what was asked for.
 *
 * A step down always halves one axis of the bucket, so the memory won is 2x or 4x; 25% is the
 * point past which the softening starts to read as a lower-quality render rather than as the
 * same render costing less. The default 1.5 tolerates anything down to 1.125, which covers the
 * common desktop viewports - a 781x850 one needs 1.2047 - without reaching for 1.0.
 */
const TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25;

/**
 * The highest resolution that puts this axis one pool bucket lower, or null when there is no
 * bucket below (a single-pixel bucket has nothing under it).
 */
const stepDownCandidate = (cssSize, resolution) => {
    const bucket = texturePoolAxis(cssSize, resolution);
    if (bucket < 2) return null;
    return (bucket / 2) / cssSize;
};

/**
 * Returns the resolution to actually render at: `resolution` itself, or the highest value within
 * `maxDrop` of it that lands the pooled render targets in a smaller bucket.
 *
 * Both axes are tried because they are not interchangeable - the axis that needs the *larger*
 * cut can be the one that pays for itself twice, by dropping the other axis on the way past. On
 * 1030x520 at 1.0, snapping for width alone (0.994) halves the bucket to 1024x1024, while
 * snapping for height (0.985) reaches 1024x512: another half, for another 0.9% of resolution.
 * So candidates are ranked by the bucket area they produce, not by how little they give up.
 */
const snapResolutionToTexturePool = (
    cssWidth,
    cssHeight,
    resolution,
    maxDrop = TEXTURE_POOL_MAX_RESOLUTION_DROP,
) => {
    if (![cssWidth, cssHeight, resolution].every(value => Number.isFinite(value) && value > 0)) {
        return resolution;
    }
    const lowest = resolution * (1 - Math.min(Math.max(maxDrop, 0), 1));
    const candidates = [
        stepDownCandidate(cssWidth, resolution),
        stepDownCandidate(cssHeight, resolution),
    ].filter((candidate) => (
        candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest
    ));

    let best = resolution;
    // Bucket area is monotonic in resolution, so the incumbent can only ever be beaten outright.
    let bestArea = texturePoolAxis(cssWidth, resolution) * texturePoolAxis(cssHeight, resolution);
    candidates.forEach(candidate => {
        const area = texturePoolAxis(cssWidth, candidate) * texturePoolAxis(cssHeight, candidate);
        if (area >= bestArea) return;
        bestArea = area;
        best = candidate;
    });
    return best;
};

  /* ---- pixiSceneCache.ts ---- */
// Copyright (c) 2026 chthollyphile
// src/components/visualizer/pixiSceneCache.ts
// 段落场景缓存（sonnet、tempera、lumiere 共用）：按段落下标缓存当前段 ±1 的场景，换歌时整批换下（retire），
// 换下的场景由调用方在空闲帧一帧销毁一个。缓存只管存取与销毁；哪一帧建什么、按什么优先级预建邻段，
// 仍由各运行时自己的 renderFrame 决定。


class PixiSceneCache {
    scenes = new Map();
    /**
     * Scenes the song handover replaced, waiting to be freed. Destroying a scene walks every
     * shot and every glyph's Text, and doing that for the whole cache on the frame the swap
     * lands is exactly the stall the wipe was supposed to hide. They are dropped one per frame
     * once the sweep is over instead.
     *
     * 换歌时换下来的场景，之后一帧销毁一个，免得交接那一帧卡住。
     */
    retired = [];

    constructor(hooks) {
    this.hooks = hooks; }

    get size() {
        return this.scenes.size;
    }

    /** 还有等着销毁的换下场景。 */
    get hasRetired() {
        return this.retired.length > 0;
    }

    has(index) {
        return this.scenes.has(index);
    }

    get(index) {
        return this.scenes.get(index);
    }

    forEach(callback) {
        this.scenes.forEach(callback);
    }

    /** 取缓存里的场景，没有就建；越界返回 null。 */
    ensure(index) {
        if (index < 0 || index >= this.hooks.count()) return null;
        const cached = this.scenes.get(index);
        if (cached) return cached;
        const scene = this.hooks.build(index);
        this.scenes.set(index, scene);
        return scene;
    }

    /** 收下一个在缓存外建好的场景（换歌交接的 staged）。 */
    adopt(index, scene) {
        this.scenes.set(index, scene);
    }

    /** 销毁离 index 超过一段、且不在 keep 里的场景。 */
    prune(index, keep) {
        this.scenes.forEach((scene, sceneIndex) => {
            if (Math.abs(sceneIndex - index) <= 1 || keep?.has(sceneIndex)) return;
            this.hooks.destroy(scene);
            this.scenes.delete(sceneIndex);
        });
    }

    /** 立即销毁全部缓存场景（不含已换下的）。 */
    clear() {
        this.scenes.forEach(scene => this.hooks.destroy(scene));
        this.scenes.clear();
    }

    /** 整批换下：摘离场景层但不销毁，留给 drainRetired 一帧一个地释放。 */
    retireAll() {
        this.scenes.forEach(scene => {
            this.hooks.detach?.(scene);
            this.retired.push(scene);
        });
        this.scenes.clear();
    }

    /**
     * 销毁一个换下的场景；没有可销毁的返回 false。
     *
     * Frees one retired scene. Called on frames that are not doing anything else expensive.
     */
    drainRetired() {
        const scene = this.retired.shift();
        if (scene === undefined) return false;
        // Already detached by retireScenes; destroyScene's removeChild is a no-op here.
        this.hooks.destroy(scene);
        return true;
    }

    /** 运行时销毁：缓存与换下的场景全部释放。 */
    destroyAll() {
        this.clear();
        this.retired.forEach(scene => this.hooks.destroy(scene));
        this.retired.length = 0;
    }
}

  /* ---- pixiSongSwap.ts ---- */
// Copyright (c) 2026 chthollyphile
// src/components/visualizer/pixiSongSwap.ts
// 换歌交接的两帧状态机（tempera、lumiere 共用）：第一帧在旧歌还在画的时候把新歌当前段落的场景建好
// （stage），第二帧切过去（commit）。切的那一帧不做任何重活；中途被取消（abort）或运行时销毁时立即了结，
// 等交接的 promise 一定会 settle，pixiRuntimeHost 的 drain 循环不会挂住。



class PixiSongSwap {
    pending = null;

    constructor(hooks) {
    this.hooks = hooks; }

    get active() {
        return this.pending !== null;
    }

    /** 正在交接的新歌（还没切过去）。 */
    get song() {
        return this.pending?.song ?? null;
    }

    /** 已经建好、还没切过去的场景（tuning / 尺寸变化时需要一起更新或丢弃）。 */
    get staged() {
        return this.pending?.staged ?? null;
    }

    /** 丢掉已建好的 staged（它是按旧的尺寸 / tuning 建的）；交接照常在下一帧切，切的时候重建。 */
    dropStaged() {
        const pending = this.pending;
        if (!pending?.staged) return;
        this.hooks.discard(pending.staged);
        pending.staged = null;
    }

    /** 开始一次交接，两帧之后 resolve。 */
    begin(song, signal){
        return new Promise(resolve => {
            const onAbort = () => this.settle(true);
            this.pending = {
                song,
                staged: null,
                prepared: false,
                settle: resolve,
                detachAbort: () => signal?.removeEventListener('abort', onAbort),
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * 每帧开头调用：第一帧 stage，第二帧 commit。
     *
     * One frame of the handover. First frame builds the incoming scene while the outgoing song
     * still holds the picture; second frame cuts to it. Nothing is drawn over the change - the
     * point is that the cut costs no work, not that it is hidden.
     */
    advance() {
        const pending = this.pending;
        if (!pending) return;
        if (!pending.prepared) {
            pending.prepared = true;
            pending.staged = this.hooks.stage(pending.song);
            return;
        }
        this.settle(true);
    }

    /**
     * 立即了结：commit 为 false（运行时正在销毁）时只丢弃 staged。
     *
     * Finishes an in-flight handover immediately, committing whatever it was still holding.
     */
    settle(commit) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        pending.detachAbort();
        if (commit) this.hooks.commit(pending.song, pending.staged);
        // Never adopted, so nothing else will ever free it.
        else if (pending.staged) this.hooks.discard(pending.staged);
        pending.settle();
    }
}

  /* ---- tempera/createTemperaPixiRuntime.ts ---- */
// src/components/visualizer/tempera/createTemperaPixiRuntime.ts
// Owns Pixi lifecycle and mutates bounded scene views directly from absolute playback time.
// Tempera loads no external textures, so destroy only walks filters -> containers -> app.
// 片尾海报、画框与擦除块、图片纹理池、shot 逐帧姿态和场景转场决策在相邻模块；这里只管生命周期、
// 段落场景缓存、换歌交接和每帧调度。


/**
 * Everything about the runtime that belongs to one track. Swapped in place rather than rebuilt -
 * see `swapSong`.
 */



/** The incoming scene and poster, built a frame before the cut needs them. */

class TemperaPixiRuntime {
    /**
     * Scenes the song handover replaced wait in the cache's retired queue to be freed. Destroying
     * a scene walks every shot and every glyph's Text, and doing that for the whole cache on the
     * frame the swap lands is exactly the stall the wipe was supposed to hide. They are dropped
     * one per frame once the sweep is over instead.
     */
    sceneCache = new PixiSceneCache({
        count: () => this.options.program.paragraphs.length,
        build: index => {
            const scene = this.buildScene(this.liveSong, index);
            this.sceneContainer.addChild(scene.container);
            return scene;
        },
        destroy: scene => this.destroyScene(scene),
        detach: scene => this.sceneContainer.removeChild(scene.container),
    });
    activeParagraphIndex = -1;
    destroyed = false;
    resizeObserver = null;
    lastWidth = 0;
    lastHeight = 0;
    /**
     * What the renderer is actually running at: `textureResolution` after the texture-pool snap.
     * It depends on the viewport as well as the setting, so it is recomputed on every resize and
     * every tuning change rather than read off the tuning - and the fixed-resolution filter
     * passes are derived from this, never from `tuning.textureResolution`.
     */
    renderResolution = 1;

    sceneContainer;
    creditsLayer;
    imageTextures;
    overlay;
    /**
     * An in-flight song handover, spread over exactly two frames. A track change is a plain cut
     * here - no wipe, no dissolve - but a cut must not also be a stall, so the incoming scene is
     * built on the first frame while the outgoing song still holds the picture, and the content
     * changes on the second. What it replaces is freed later, one scene per frame.
     */
    songSwap = new PixiSongSwap({
        stage: song => this.stageSong(song),
        commit: (song, staged) => this.commitSongContext(song, staged),
        discard: staged => this.discardStaged(staged),
    });

    constructor(pixi, options, app) {
    this.pixi = pixi;
    this.options = options;
    this.app = app; }

    static async create(options) {
        /* 项目侧的 pixi 是全局 UMD（index.html:23 的 vendor/folia/pixi/pixi.min.js 8.21.0），
         * 不走 Folia 的动态 import。resolveTemperaPixi 顺带装上 8.21 的滤镜纹理池补丁
         * （见本文件顶部）。 */
        const pixi = resolveTemperaPixi();
        if (!pixi) throw new Error('tempera 需要全局 PIXI');
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, 320);
        const height = Math.max(options.host.clientHeight, 240);
        const resolution = snapResolutionToTexturePool(width, height, options.tuning.textureResolution);
        await app.init({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true,
            // The lyric layer's difference filter declares blendRequired; without the back
            // buffer the WebGL renderer skips the whole filter stack for that container.
            useBackBuffer: true,
        });
        const runtime = new TemperaPixiRuntime(pixi, options, app);
        runtime.renderResolution = resolution;
        runtime.sceneContainer = new pixi.Container();
        // Paragraph scenes overlap during a boundary, so they must stack by paragraph order.
        runtime.sceneContainer.sortableChildren = true;
        runtime.creditsLayer = new TemperaCreditsLayer(pixi);
        runtime.overlay = new TemperaOverlay(pixi);
        app.stage.addChild(runtime.sceneContainer, runtime.creditsLayer.container, runtime.overlay.container);

        // Textures are loaded once and shared by every scene: paragraph scenes are rebuilt as
        // playback moves, and reloading a character cut-out on each one would thrash.
        runtime.imageTextures = new TemperaImageTextures(pixi);
        await runtime.imageTextures.load(options.imageBlobs, () => runtime.destroyed);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Tempera runtime creation was cancelled', 'AbortError');
        }
        options.host.appendChild(app.canvas);
        app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        runtime.install();
        return runtime;
    }

    install() {
        this.resizeToHost();
        /* 本项目铁律：模式自己不启 ticker。每帧由 foliaWorldTick 调 renderOnce() 驱动；
         * 挂到 app.ticker 上等于在世界 tick 之外再静默多画一遍，暂停语义也会被绕开。 */
        this.resizeObserver = new ResizeObserver(() => {
            if (this.destroyed || !this.resizeToHost()) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.renderOnce();
    }

    /**
     * The resolution to render this viewport at. Falls back to the host's own size so it is
     * still right if a tuning change arrives before the first resize pass has run.
     */
    resolveRenderResolution(tuning) {
        const width = this.lastWidth || Math.max(this.options.host.clientWidth, 320);
        const height = this.lastHeight || Math.max(this.options.host.clientHeight, 240);
        return snapResolutionToTexturePool(width, height, tuning.textureResolution);
    }

    resizeToHost() {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, 320);
        const height = Math.max(this.options.host.clientHeight, 240);
        if (width === this.lastWidth && height === this.lastHeight) return false;
        this.lastWidth = width;
        this.lastHeight = height;
        // The snap is a function of the viewport, not just the setting: a resize can move the
        // pass across a pool boundary on its own. Passing it to `resize` keeps the surface and
        // its resolution on one call, and the scenes are dropped below anyway.
        this.renderResolution = this.resolveRenderResolution(this.options.tuning);
        this.app.renderer.resize(width, height, this.renderResolution);
        // Staged against the old viewport, so its layout no longer fits.
        this.songSwap.dropStaged();
        this.clearScenes();
        this.drawCredits(width, height);
        this.drawOverlay(width, height);
        return true;
    }

    /** The incoming or live song's poster, against the metadata and tuning in force right now. */
    buildCreditsView(
        song,
        scenePalette,
        width,
        height,
    ){
        return this.creditsLayer.build({
            theme: song.theme,
            coverColors: song.coverColors,
            tuning: this.options.tuning,
            metadata: {
                title: this.options.songTitle,
                artist: this.options.songArtist,
                album: this.options.songAlbum,
            },
            lyricsFontScale: this.options.lyricsFontScale,
        }, scenePalette, width, height);
    }

    drawCredits(width, height) {
        this.creditsLayer.adopt(
            this.buildCreditsView(
                this.liveSong,
                this.sceneCache.get(Math.max(0, this.activeParagraphIndex))?.palette,
                width,
                height,
            ),
            width,
            height,
        );
    }

    setSongMetadata(metadata) {
        if (this.destroyed) return;
        const changed = this.options.songTitle !== metadata.title
            || this.options.songArtist !== metadata.artist
            || this.options.songAlbum !== metadata.album;
        if (!changed) return;

        this.options.songTitle = metadata.title;
        this.options.songArtist = metadata.artist;
        this.options.songAlbum = metadata.album;
        // Metadata lands in the same React commit as a track change, and the handover already
        // builds the incoming poster on its own frame. Redrawing here would be a second build.
        const swap = this.songSwap;
        if (swap.active) {
            // Unless it changed in the one frame between staging and the cut, in which case the
            // staged card carries the outgoing song's name and has to be rebuilt.
            const pending = swap.song;
            const staged = swap.staged;
            if (pending && staged && this.lastWidth > 0 && this.lastHeight > 0) {
                const stale = staged.credits;
                staged.credits = this.buildCreditsView(
                    pending,
                    staged.scene.palette,
                    this.lastWidth,
                    this.lastHeight,
                );
                if (stale) this.creditsLayer.destroyView(stale);
            }
            return;
        }
        if (this.lastWidth > 0 && this.lastHeight > 0) {
            this.drawCredits(this.lastWidth, this.lastHeight);
            if (this.options.paused) this.renderOnce();
        }
    }

    drawOverlay(width, height) {
        this.overlay.draw(width, height, this.options.tuning, this.options.theme);
    }

    clearScenes() {
        this.sceneCache.clear();
        this.activeParagraphIndex = -1;
    }

    /**
     * Takes the cache off screen without paying for its teardown yet. Used only by the song
     * handover: freeing every glyph's Text on the frame the swap lands is precisely the stall
     * the block was drawn to hide.
     */
    retireScenes() {
        this.sceneCache.retireAll();
        this.activeParagraphIndex = -1;
    }

    destroyScene(scene) {
        this.sceneContainer.removeChild(scene.container);
        unloadPixiDisplayTree(scene.container);
        scene.container.filters = null;
        scene.shots.forEach(shot => {
            shot.textLayer.filters = null;
        });
        scene.postProcessFilters.forEach(filter => filter.destroy());
        destroyTemperaGradientFills(this.pixi, scene.container);
        // 逐节点销毁：destroy({ children: true }) 会留下每个 Graphics 自建的 GraphicsContext 与它的 GPU 缓冲。
        destroyPixiDisplayTree(scene.container);
    }

    /**
     * Builds one paragraph scene. This is the expensive call in the whole runtime: it runs the
     * layout fit loop over every grapheme and then creates a `pixi.Text` per glyph, plus its
     * shadow and echo copies. Nothing here should ever run more than once per frame.
     */
    buildScene(song, index) {
        return buildTemperaScene(this.pixi, {
            programSeed: song.program.seed,
            host: this.options.host,
            theme: song.theme,
            tuning: this.options.tuning,
            renderResolution: this.renderResolution,
            lyricsFontScale: this.options.lyricsFontScale,
            staticMode: this.options.staticMode,
            coverColors: song.coverColors,
            imageTextures: this.imageTextures.textures,
        }, song.program.paragraphs[index]);
    }

    /** The live song as a context, for building scenes against what is currently on screen. */
    get liveSong(){
        return {
            seed: this.options.songSeed,
            program: this.options.program,
            theme: this.options.theme,
            coverColors: this.options.coverColors ?? [],
        };
    }

    renderFrame = () => {
        if (this.destroyed) return;
        const time = this.options.currentTime.get();
        // Advanced before the paragraph lookup so a cut lands on this frame's scene selection
        // instead of leaving one frame of the outgoing program on the incoming one.
        this.songSwap.advance();
        if (this.options.program.paragraphs.length === 0) return;
        const paragraphIndex = findTemperaParagraphIndexAtTime(this.options.program, time);
        if (paragraphIndex !== this.activeParagraphIndex) {
            this.activeParagraphIndex = paragraphIndex;
            this.sceneCache.ensure(paragraphIndex);
            this.sceneCache.prune(paragraphIndex);
        } else if (!this.songSwap.active) {
            // One piece of expensive work per frame, in priority order: free what the last
            // handover left behind, then pre-roll a neighbour. Neighbours are for a boundary
            // that is still ahead, so nothing here is ever needed on this frame - which is the
            // point. Doing all of it at once was the visible hitch at a paragraph cut, and at a
            // song handover it landed right where the block was supposed to hide the swap.
            const next = paragraphIndex + 1;
            const previous = paragraphIndex - 1;
            if (this.sceneCache.hasRetired) {
                this.sceneCache.drainRetired();
            } else if (next < this.options.program.paragraphs.length && !this.sceneCache.has(next)) {
                this.sceneCache.ensure(next);
            } else if (previous >= 0 && !this.sceneCache.has(previous)) {
                this.sceneCache.ensure(previous);
            }
        }
        // The size the renderer was last fitted to. Reading the host here instead would force a
        // synchronous layout every frame, and the ResizeObserver refits both together anyway.
        const width = this.lastWidth || Math.max(this.options.host.clientWidth, 320);
        const height = this.lastHeight || Math.max(this.options.host.clientHeight, 240);
        const finalParagraph = this.options.program.paragraphs.at(-1);
        const creditsFrame = resolveTemperaCreditsFrame(
            time,
            finalParagraph?.endTime ?? Number.POSITIVE_INFINITY,
        );
        const hasCredits = this.creditsLayer.hasPoster;
        let wipeDrawn = false;

        const transitionsEnabled = this.options.tuning.enableTransitions && !this.options.staticMode;
        const outgoingTransition = this.options.program.paragraphs[paragraphIndex]?.transitionOut ?? null;
        /**
         * A translating transition needs something on the other side. Paragraph boundaries
         * often sit in a gap with no lyric at all, and the next scene used to be drawn only
         * once its own paragraph started - so the outgoing one slid away into the bare shell.
         * Pre-rolling the incoming scene through the same window gives the move a far side.
         *
         * `block-wipe` is excluded: its block already covers the swap, and its enter phase is
         * the *uncover*, which has to happen after the boundary, not before it.
         */
        const preRoll = transitionsEnabled
            && outgoingTransition !== null
            && outgoingTransition.kind !== 'block-wipe'
            && time >= outgoingTransition.startTime;

        this.sceneCache.forEach((scene, index) => {
            const isActive = index === paragraphIndex;
            const isIncoming = preRoll && index === paragraphIndex + 1;

            setPixiDisplayTreeVisibility(scene.container, isActive || isIncoming);
            // The arriving scene has to sit above the one it is replacing; cache insertion
            // order says nothing about paragraph order.
            scene.container.zIndex = index;
            if (!scene.container.visible) {
                // The scene-level unload already released every descendant. Reset shot
                // visibility so a later seek only rehydrates the shots it actually shows.
                scene.shots.forEach(shot => {
                    shot.container.visible = false;
                });
                scene.activeShotIndex = -1;
                return;
            }

            const paragraphTransitionFrame = resolveTemperaSceneTransitionFrame(
                this.options.program,
                scene,
                index,
                time,
                isIncoming,
                outgoingTransition,
                transitionsEnabled,
            );
            const activeShotIndex = findTemperaActiveShotIndex(scene, time);

            // Shot boundaries need no scene-level transition any more: the compositions hand
            // off to each other directly, which is what makes a paragraph read as one take.
            const transitionFrame = paragraphTransitionFrame;
            scene.shots.forEach((shot, shotIndex) => {
                // The outgoing shot stays on screen through its hand-off window, so two
                // compositions overlap exactly while one is pushing the other out.
                const isShotActive = shotIndex === activeShotIndex;
                const isHandingOff = shotIndex < activeShotIndex
                    && resolveTemperaShotExit(shot, time) < 1;
                setPixiDisplayTreeVisibility(shot.container, isShotActive || isHandingOff);
                if (!shot.container.visible) return;
                updateTemperaShot(shot, time, width, height, this.options.tuning, this.options.theme);
            });
            scene.activeShotIndex = activeShotIndex;

            const isFinalScene = index === this.options.program.paragraphs.length - 1;
            const lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
            scene.container.alpha = transitionFrame.alpha * lyricAlpha;
            scene.container.pivot.set(width / 2, height / 2);
            scene.container.position.set(
                width / 2 + transitionFrame.x * width,
                height / 2 + transitionFrame.y * height,
            );
            scene.container.scale.set(transitionFrame.scale);
            scene.container.rotation = transitionFrame.rotation;
            // Attached only while it blurs: a parked filter on this container would take
            // over the lyric inversion's backdrop copy (`temperaSceneFilters.ts`).
            setTemperaTransitionBlur(scene, transitionFrame.blur);
            if (transitionFrame.wipe > 0.001 && transitionFrame.wipe < 1.999) {
                this.overlay.drawWipe(
                    transitionFrame.wipe,
                    transitionFrame.wipeAngle,
                    width,
                    height,
                    scene.palette.tone3,
                );
                wipeDrawn = true;
            }
        });

        if (!wipeDrawn) this.overlay.drawWipe(0, 0, width, height, '#000000');
        this.creditsLayer.applyFrame(creditsFrame, hasCredits, time, finalParagraph?.endTime, width, height);
    };

    renderOnce() {
        if (this.destroyed || !this.app.canvas.isConnected) return;
        this.renderFrame();
        if (this.destroyed) return;
        this.app.renderer.render(this.app.stage);
    }

    /**
     * Hands the renderer a new track without rebuilding it. The argument is exactly the one that
     * `setTuning` makes for tuning changes: a rebuild re-initialises WebGL, re-decodes every
     * placed image and re-measures every line, and it does it with the canvas out of the DOM, so
     * the frame goes empty for the whole async build. Here only the scene layer changes, under
     * the block wipe that already exists for paragraph cuts.
     *
     * Resolves when the block has swept back off.
     */
    swapSong(next, signal){
        if (this.destroyed) return Promise.resolve();
        // Straight through when there is nothing to protect - no scene sized yet, an outgoing
        // program with no paragraphs, a swap already running, an abort, or a paused renderer
        // whose ticker is stopped and would never reach the second frame. A hitch none of these
        // can show is not worth a frame of latency. And a swap that is not a track change never
        // gets one either - see TemperaSongContext.seed.
        if (
            next.seed === this.options.songSeed
            || this.songSwap.active
            || this.lastWidth === 0
            || this.options.program.paragraphs.length === 0
            || this.options.paused
            || signal?.aborted
        ) {
            this.commitSongContext(next);
            if (this.options.paused) this.renderOnce();
            return Promise.resolve();
        }

        return this.songSwap.begin(next, signal);
    }

    /** The cut itself. Mirrors `setTuning`'s rebuild branch, minus the synchronous teardown. */
    commitSongContext(
        next,
        staged,
    ) {
        this.options.songSeed = next.seed;
        this.options.program = next.program;
        this.options.theme = next.theme;
        this.options.coverColors = next.coverColors;
        // Neither of these walks a staged scene: it is deliberately not in the cache yet, so it
        // survives the removal of the song it is replacing.
        if (staged) this.retireScenes();
        else this.clearScenes();
        if (staged) {
            staged.scene.container.visible = true;
            this.sceneContainer.addChild(staged.scene.container);
            this.sceneCache.adopt(staged.index, staged.scene);
            // Adopted as the active paragraph so the frame that cuts builds nothing at all.
            this.activeParagraphIndex = staged.index;
        }
        // Before the first resize pass there is nothing sized to redraw; the install pass
        // will draw both against real dimensions.
        if (this.lastWidth > 0 && this.lastHeight > 0) {
            this.drawOverlay(this.lastWidth, this.lastHeight);
            if (staged) this.creditsLayer.adopt(staged.credits, this.lastWidth, this.lastHeight);
            else this.drawCredits(this.lastWidth, this.lastHeight);
        }
    }

    /** Frees a staged scene and poster that will never be adopted. */
    discardStaged(staged) {
        this.destroyScene(staged.scene);
        if (staged.credits) this.creditsLayer.destroyView(staged.credits);
    }

    /**
     * Builds the incoming scene and poster off screen. This is the expensive half of a track
     * change - the layout fit loop over every grapheme, a `pixi.Text` per glyph, and the poster's
     * own filters and discs - and it is spent here so the frame that cuts does none of it.
     */
    stageSong(song){
        const index = findTemperaParagraphIndexAtTime(song.program, this.options.currentTime.get());
        if (index < 0 || index >= song.program.paragraphs.length) return null;
        const scene = this.buildScene(song, index);
        scene.container.visible = false;
        this.sceneContainer.addChild(scene.container);
        const credits = this.buildCreditsView(song, scene.palette, this.lastWidth, this.lastHeight);
        return { scene, index, credits };
    }

    /**
     * Applies a tuning change in place. Rebuilding the renderer for one is ruinous: sliders
     * fire continuously while dragged, and a rebuild re-initialises WebGL, re-decodes every
     * placed image and re-measures every line. Only settings that change what a scene *is*
     * drop the cached scenes; the rest are read live or re-applied to the sprites.
     */
    setTuning(tuning) {
        if (this.destroyed) return;
        const previous = this.options.tuning;
        if (previous === tuning) return;
        this.options.tuning = tuning;
        // Compared on the snapped value, not the setting: two nearby slider positions can share
        // one pool bucket, and re-pointing the surface at the resolution it already has would
        // reallocate it for nothing. `requiresSceneRebuild` still watches the raw setting, so a
        // move inside one bucket costs a scene rebuild but not a surface one.
        const resolution = this.resolveRenderResolution(tuning);
        if (resolution !== this.renderResolution) {
            this.renderResolution = resolution;
            // Pixi can resize the backing surface without recreating the WebGL application or
            // decoding the shared image pool again. The scene rebuild below refreshes text and
            // fixed-resolution filters against that new surface.
            this.app.renderer.resolution = resolution;
        }
        if (requiresTemperaSceneRebuild(previous, tuning)) {
            // Staged against the old tuning, so it can no longer be adopted.
            this.songSwap.dropStaged();
            this.clearScenes();
            // Before the first resize pass there is nothing sized to redraw; the install pass
            // will draw both against real dimensions.
            if (this.lastWidth > 0 && this.lastHeight > 0) {
                this.drawOverlay(this.lastWidth, this.lastHeight);
                this.drawCredits(this.lastWidth, this.lastHeight);
            }
        } else {
            this.sceneCache.forEach(scene => {
                scene.shots.forEach(shot => shot.images.applyPool(tuning.layerImages));
            });
            // The corner marks live only in the overlay, so toggling them needs no scene rebuild.
            if (previous.showCornerMarks !== tuning.showCornerMarks && this.lastWidth > 0 && this.lastHeight > 0) {
                this.drawOverlay(this.lastWidth, this.lastHeight);
            }
        }
        if (this.options.paused) this.renderOnce();
    }

    setPaused(paused) {
        if (this.destroyed) return;
        this.options.paused = paused;
        /* 暂停 = 这一帧画完就停（外部不再调 renderOnce）；恢复 = 什么都不用做。
         * app.stop()/app.start() 在这套驱动里没有意义：ticker 从没被启动过。 */
        if (paused) this.renderOnce();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        // Release whoever is awaiting the handover before tearing the app down, otherwise that
        // promise never settles and the caller's drain loop stays parked on it.
        this.songSwap.settle(false);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.sceneCache.destroyAll();
        this.creditsLayer.dispose();
        this.overlay.release();
        this.imageTextures.destroy();
        this.app.destroy({ removeView: true }, { children: true, texture: true });
    }
}


  window.foliaTemperaRuntime = {
    DEFAULT_TEMPERA_TUNING: DEFAULT_TEMPERA_TUNING,
    snapResolutionToTexturePool: snapResolutionToTexturePool,
    PixiSceneCache: PixiSceneCache,
    PixiSongSwap: PixiSongSwap,
    TemperaPixiRuntime: TemperaPixiRuntime,
    resolveTemperaPixi: resolveTemperaPixi
  };
}());
