/* lumiere 的宿主运行时：音频分析、调参、pixi 生命周期与每帧调度。
 *
 * 从 Folia lumiere 的 3 个 TS 文件机械抽出（.workbuddy/tmp/extract-lumiere.js）。
 * 只删类型，不改逻辑；每块的 token 都与 node 自带擦除结果比对过。
 * 依赖取法：先决判断 + 局部别名 —— 上游缺失就整块 return，不把后续模块带崩。
 * 导出面 = 其它层 import 过的名字（并集），不凭印象手写。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var foliaLumiereCredits = window.foliaLumiereCredits;
  var foliaTemperaRuntime = window.foliaTemperaRuntime;
  var foliaLumiereFrame = window.foliaLumiereFrame;
  var foliaLumiereLight = window.foliaLumiereLight;
  var foliaLumiereProgram = window.foliaLumiereProgram;
  var foliaLumiereScene = window.foliaLumiereScene;
  if (!foliaLumiereCredits || !foliaTemperaRuntime || !foliaLumiereFrame || !foliaLumiereLight || !foliaLumiereProgram || !foliaLumiereScene) return;

  var loadPixi = function () {
    var tempera = window.foliaTemperaRuntime;
    var pixi = (tempera && typeof tempera.resolveTemperaPixi === "function")
      ? tempera.resolveTemperaPixi()
      : window.PIXI;
    if (!pixi) return Promise.reject(new Error("lumiere 需要全局 PIXI（vendor/folia/pixi UMD）"));
    return Promise.resolve(pixi);
  };

  var snapResolutionToTexturePool = foliaTemperaRuntime.snapResolutionToTexturePool;
  var PixiSceneCache = foliaTemperaRuntime.PixiSceneCache;
  var findLumiereParagraphIndexAtTime = foliaLumiereProgram.findLumiereParagraphIndexAtTime;
  var resolveLumiereSceneFrames = foliaLumiereFrame.resolveLumiereSceneFrames;
  var applyLumiereLayerFrame = foliaLumiereFrame.applyLumiereLayerFrame;
  var applyLumiereSceneQuality = foliaLumiereFrame.applyLumiereSceneQuality;
  var buildLumiereSceneEntry = foliaLumiereFrame.buildLumiereSceneEntry;
  var destroyLumiereSceneEntry = foliaLumiereFrame.destroyLumiereSceneEntry;
  var LumiereCreditsLayer = foliaLumiereCredits.LumiereCreditsLayer;
  var LumiereDarkFieldLayer = foliaLumiereScene.LumiereDarkFieldLayer;
  var PixiSongSwap = foliaTemperaRuntime.PixiSongSwap;
  var buildLumiereOverlay = foliaLumiereScene.buildLumiereOverlay;
  var createLightSprites = foliaLumiereLight.createLightSprites;

  /* ---- lumiereAudio.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereAudio.ts
// folia 的音频 MotionValue → 绘光场景要的 audioAt 帧（bass / treble / power，0..1）。
//
// 量纲：主播放器（usePlaybackVisualizerBridge）写的是 0..255（getByteFrequencyData 的均值再做 pow 压缩），
// 没在出声时是 0..40 的「呼吸」；VisPlayground / ThemePark 的预览时钟与 OBS 的音频桥写的是 0..1。
// 同一个源不会混用两种量纲，所以和 claddagh 一样按「见过 > 1 的值就认定是 0..255」粘住判断——
// 单看当前值会把 0..255 源里安静段的 0.3 当成 0.3 而不是 0.001。
//
// 平滑：原始频段值逐帧抖动，直接推光束亮度会闪。起音快（~60ms）、释放慢（~250ms），跟得上鼓点又不闪。
// 暂停时整帧归零（场景当作安静），不读呼吸值。



const ATTACK_SECONDS = 0.06;
const RELEASE_SECONDS = 0.25;

/** 单个值归一化到 0..1；rawScale 为 true 时按 0..255 换算。 */
const normalizeLumiereAudioValue = (value, rawScale) => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(1, rawScale ? value / 255 : value);
};

/** 一阶低通，起音与释放各自的时间常数；dt 秒。 */
const smoothLumiereAudioValue = (current, target, dt) => {
    const tau = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
    const k = 1 - Math.exp(-Math.max(0, dt) / tau);
    return current + (target - current) * k;
};

const createLumiereAudioSampler = (initial) => {
    let sources = initial;
    let rawScale = false;
    let lastMs = 0;
    const frame = { bass: 0, treble: 0, power: 0 };

    const read = (value) => {
        const raw = value?.get() ?? 0;
        if (raw > 1) rawScale = true;
        return raw;
    };

    return {
        frame,
        setSources: next => {
            if (next.audioPower === sources.audioPower && next.audioBands === sources.audioBands) return;
            sources = next;
            rawScale = false;
        },
        sample: (nowMs, paused) => {
            const dt = lastMs > 0 ? Math.min(0.1, (nowMs - lastMs) / 1000) : 1;
            lastMs = nowMs;
            if (paused) {
                frame.bass = 0;
                frame.treble = 0;
                frame.power = 0;
                return;
            }
            // 三个都先读一遍，量纲判断对三者一致。
            const bass = read(sources.audioBands.bass);
            const treble = read(sources.audioBands.treble);
            const power = read(sources.audioPower);
            frame.bass = smoothLumiereAudioValue(frame.bass, normalizeLumiereAudioValue(bass, rawScale), dt);
            frame.treble = smoothLumiereAudioValue(frame.treble, normalizeLumiereAudioValue(treble, rawScale), dt);
            frame.power = smoothLumiereAudioValue(frame.power, normalizeLumiereAudioValue(power, rawScale), dt);
        },
    };
};

  /* ---- lumiereRuntimeTuning.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/lumiereRuntimeTuning.ts
// 用户 tuning（LumiereTuning）→ 场景 tuning（LumiereSceneTuning）的映射、画质档的数值，以及哪些改动要重建场景。
// 纯函数，不碰 Pixi，运行时与单测共用。
//
// 画质档只动开销最大的那一块：图形组（光场着色器 + 烟雾 fbm + 图形组 bloom 的整条降采样链）。
// 图形组本来就是整屏的柔光与烟雾，低频为主，降分辨率几乎看不出来；文字组、画框和片尾卡的字仍按满分辨率
// 光栅化与合成，所以歌词保持清晰。见 resolveLumiereGraphicsResolution。


/**
 * 三档的数值：
 * - full：图形组与屏幕同分辨率，倍频按用户设置（2..6）。
 * - balanced：图形组每轴 0.7（像素约 49%），倍频 ≤ 4。bloom 按对数就近减一级（不减会宽 1.43 倍，
 *   减一级窄到 0.71 倍，后者更近），辉光略收、开销再降一截。
 * - low（省电）：图形组每轴 0.5（像素 25%），倍频 ≤ 3，浮尘 ×0.6。分辨率正好减半，bloom 少降一级，
 *   最小一级与 full 完全同尺寸，辉光宽度不变。
 */
const LUMIERE_QUALITY_PROFILES = {
    full: { graphicsScale: 1, maxFogOctaves: 6, moteScale: 1 },
    balanced: { graphicsScale: 0.7, maxFogOctaves: 4, moteScale: 1 },
    low: { graphicsScale: 0.5, maxFogOctaves: 3, moteScale: 0.6 },
};

/** 渲染分辨率上限：再高的屏幕也按 2 倍画，4K / 高 DPI 下整屏光场的开销是按像素数涨的。 */
const LUMIERE_MAX_RENDER_RESOLUTION = 2;

/** 画布（文字、画框）的渲染分辨率：devicePixelRatio 钳在 1..2。 */
const resolveLumiereRenderResolution = (devicePixelRatio) => {
    const ratio = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
    return Math.min(LUMIERE_MAX_RENDER_RESOLUTION, Math.max(1, ratio));
};

/**
 * 图形组 filter 的分辨率：满画质时就是渲染分辨率；降档时乘上倍率，再按 Pixi 纹理池的 2 的幂分桶往下吸附
 * （pixiTextureBudget.ts：最多再让 25%，换一个小一号的桶）。吸附只对图形组做——它是柔光，软一点看不出来；
 * 文字不吸附，保证清晰。
 */
const resolveLumiereGraphicsResolution = (
    width,
    height,
    renderResolution,
    quality,
) => {
    const { graphicsScale } = LUMIERE_QUALITY_PROFILES[quality];
    if (graphicsScale >= 1) return renderResolution;
    return snapResolutionToTexturePool(width, height, renderResolution * graphicsScale);
};

/**
 * 图形组分辨率降了多少，bloom 就少降几级：bloom 每级是上一级的一半分辨率，输入已经降了 2^k 倍时去掉 k 级，
 * 最小一级的纹素（决定辉光有多宽）才和满画质一样大。
 */
const resolveLumiereBloomLevelDrop = (renderResolution, graphicsResolution) => (
    graphicsResolution > 0 && graphicsResolution < renderResolution
        ? Math.max(0, Math.round(Math.log2(renderResolution / graphicsResolution)))
        : 0
);


/** 用户 tuning → 场景 tuning。画质档在这里折进倍频与浮尘；「仅显示歌词文字」即场景的 textOnly。 */
const toLumiereSceneTuning = (
    tuning,
    context,
) => {
    const profile = LUMIERE_QUALITY_PROFILES[tuning.renderQuality] ?? LUMIERE_QUALITY_PROFILES.full;
    return {
        lightIntensity: tuning.lightIntensity,
        audioResponse: tuning.audioResponse,
        fogDensity: tuning.fogDensity,
        darkField: tuning.darkField,
        moteAmount: tuning.moteAmount * profile.moteScale,
        bloom: tuning.bloom,
        textBloom: tuning.textBloom,
        unlitOpacity: tuning.unlitOpacity,
        windowNeighbors: tuning.windowNeighbors,
        decay: tuning.decay,
        echo: context.showText ? tuning.echo : 0,
        fogOctaves: Math.min(tuning.fogOctaves, profile.maxFogOctaves),
        lineArt: tuning.lineArt,
        frontBokeh: tuning.frontBokeh,
        trails: tuning.trails,
        hideTrails: tuning.hideTrails,
        overlayFrame: tuning.overlayFrame,
        textOnly: tuning.textOnly,
        keywordColors: tuning.keywordColors,
        themeIcons: tuning.themeIcons,
        themeColorMix: tuning.themeColorMix,
    };
};

/**
 * 每帧才读的字段：直接改运行时持有的那份 tuning 对象就生效，不必重建。
 * （光强、随音乐、烟雾浓度、未唱字透明度、倍频在 scene.update 里现读；暗场强度由运行时的暗场层每帧现读。）
 */
const LUMIERE_LIVE_SCENE_KEYS = [
    'lightIntensity',
    'audioResponse',
    'fogDensity',
    'darkField',
    'unlitOpacity',
    'fogOctaves',
    'hideTrails',
];

/**
 * 改变编译结果的字段：既不是每帧现读，也不是场景重建——程序本身要重新编译（VisualizerLumiere 的 useMemo），
 * 新程序经 swapSong 的同曲替换路径交给运行时（commitSong 清掉场景缓存，下一帧按新程序建），不重建 WebGL 上下文。
 * 轨迹过渡把整首歌编成一个单元，所以它在这里，不在场景 tuning 里。
 */
const LUMIERE_COMPILE_KEYS = ['seamlessTransitions'];

/** 用户 tuning → 编译选项（只取 LUMIERE_COMPILE_KEYS 里的字段）。 */
const resolveLumiereCompileOptions = (
    tuning,
) => ({ seamless: tuning.seamlessTransitions });

/** 两个 bloom 倍率：强度直接写进现有 filter 的 options；只有跨过 0（要挂 / 摘 filter）时才重建。 */
const crossesZero = (previous, next) => (previous > 0) !== (next > 0);

/**
 * 场景构建时烘焙进去的字段变了，缓存的场景就得重建（运行时会防抖）。画框只在 overlay 里，不算。
 */
const requiresLumiereSceneRebuild = (previous, next) => (
    previous.moteAmount !== next.moteAmount
    || previous.windowNeighbors !== next.windowNeighbors
    || previous.decay !== next.decay
    || previous.echo !== next.echo
    || previous.lineArt !== next.lineArt
    || previous.frontBokeh !== next.frontBokeh
    || previous.trails !== next.trails
    || previous.textOnly !== next.textOnly
    || previous.keywordColors !== next.keywordColors
    || previous.themeIcons !== next.themeIcons
    // 调色盘在建场景时算好（光色、字色、线稿与关键字的混色都从它来）。
    || previous.themeColorMix !== next.themeColorMix
    || crossesZero(previous.bloom, next.bloom)
    || crossesZero(previous.textBloom, next.textBloom)
);

  /* ---- createLumierePixiRuntime.ts ---- */
// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/createLumierePixiRuntime.ts
// 绘光的 Pixi 运行时：建一次，换歌就地交接（pixiRuntimeHost.ts）。每帧只读 currentTime 这个 MotionValue，
// 按 lumiereSceneFrames 决定画哪几个段落场景，场景缓存当前段 ±1（同 tempera），一帧最多做一件贵的事
// （建一个场景 / 建片尾卡 / 销毁一个被换下的场景）。帧率跟随全局限帧（Pixi ticker 走被 frameRateLimiter
// 接管的 requestAnimationFrame）。只支持 WebGL：光场、bloom 都是 GLSL。


/** 一首歌的全部输入；identity 变了就交给 swapSong。 */


/** 场景要重建时等多久（滑块拖动、窗口拖拽缩放时不每帧重建）。 */
const REBUILD_DEBOUNCE_MS = 220;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

class LumierePixiRuntime {
    /** 换歌时换下来的场景进缓存的 retired 队列，之后一帧销毁一个，免得交接那一帧卡住。 */
    sceneCache = new PixiSceneCache({
        count: () => this.options.song.program.paragraphs.length,
        build: index => {
            const entry = this.buildEntry(this.options.song, index);
            this.sceneLayer.addChild(entry.holder);
            return entry;
        },
        destroy: entry => this.destroyEntry(entry),
        detach: entry => entry.holder.parent?.removeChild(entry.holder),
    });
    activeIndex = -1;
    destroyed = false;
    resizeObserver = null;
    width = 0;
    height = 0;
    renderResolution = 1;
    quality = {
        bloom: 1, textBloom: 1, graphicsResolution: null, bloomLevelDrop: 0, passthrough: null,
    };
    /** 所有场景共用、就地修改的场景 tuning：每帧现读的字段改了立刻生效（见 LUMIERE_LIVE_SCENE_KEYS）。 */
    sceneTuning;
    rebuildTimer = null;
    rebuildDue = false;
    songSwap = new PixiSongSwap({
        stage: song => this.stageSong(song),
        commit: (song, staged) => this.commitSong(song, staged),
        discard: entry => this.destroyEntry(entry),
    });
    audio;
    audioAt = () => this.audio.frame;

    /** 暗场底：在所有场景与片尾卡之下，不随段落转场变（见 lumiereDarkField.ts）。 */
    darkField;
    sceneLayer;
    overlayLayer;
    credits;
    sprites;
    passthrough;

    constructor(pixi, options, app) {
    this.pixi = pixi;
    this.options = options;
    this.app = app;
        this.sceneTuning = toLumiereSceneTuning(options.tuning, { showText: options.showText });
        this.audio = createLumiereAudioSampler({ audioPower: options.audioPower, audioBands: options.audioBands });
    }

    static async create(options) {
        const pixi = await loadPixi();
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveLumiereRenderResolution(window.devicePixelRatio);
        await app.init({
            width,
            height,
            // 画布透明：folia 的共享背景层要透出来，由运行时的暗场层按暗场强度压暗。
            backgroundAlpha: 0,
            // 大头（图形组）画进 filter 纹理，MSAA 管不到；只剩画框细线，不值得整屏多重采样的解析开销。
            antialias: false,
            autoDensity: true,
            resolution,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true,
        });
        if (app.renderer.type !== pixi.RendererType.WEBGL) {
            app.destroy({ removeView: true });
            throw new Error('Lumiere requires WebGL');
        }
        const runtime = new LumierePixiRuntime(pixi, options, app);
        runtime.renderResolution = resolution;
        runtime.sprites = createLightSprites(pixi);
        runtime.passthrough = new pixi.AlphaFilter({ alpha: 1 });
        runtime.quality.passthrough = runtime.passthrough;
        runtime.darkField = new LumiereDarkFieldLayer(pixi);
        runtime.sceneLayer = new pixi.Container();
        // 交叉渐变时两个段落场景叠放，按段落顺序排。
        runtime.sceneLayer.sortableChildren = true;
        runtime.overlayLayer = new pixi.Container();
        runtime.credits = new LumiereCreditsLayer(pixi, runtime.sprites);
        app.stage.addChild(runtime.darkField.view, runtime.sceneLayer, runtime.credits.holder, runtime.overlayLayer);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Lumiere runtime creation was cancelled', 'AbortError');
        }
        options.host.appendChild(app.canvas);
        app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        runtime.install();
        return runtime;
    }

    install() {
        this.resizeToHost(true);
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.destroyed || !this.resizeToHost(false)) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.renderOnce();
        if (!this.options.paused) this.app.start();
    }

    /** 尺寸没变返回 false。渲染器立刻跟上，场景（尺寸烘焙在里面）防抖重建。 */
    resizeToHost(immediate) {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(this.options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveLumiereRenderResolution(window.devicePixelRatio);
        if (width === this.width && height === this.height && resolution === this.renderResolution) return false;
        this.width = width;
        this.height = height;
        this.renderResolution = resolution;
        this.app.renderer.resize(width, height, resolution);
        this.refreshQuality();
        this.drawOverlay();
        if (immediate) this.rebuildDue = true;
        else this.scheduleRebuild();
        return true;
    }

    /** 画质档 + 视口 → 图形组分辨率与 bloom 减级，写到所有现存场景与片尾卡上。 */
    refreshQuality() {
        const graphicsResolution = resolveLumiereGraphicsResolution(
            this.width, this.height, this.renderResolution, this.options.tuning.renderQuality,
        );
        this.quality.bloom = this.sceneTuning.bloom;
        this.quality.textBloom = this.sceneTuning.textBloom;
        this.quality.graphicsResolution = graphicsResolution < this.renderResolution ? graphicsResolution : null;
        this.quality.bloomLevelDrop = resolveLumiereBloomLevelDrop(this.renderResolution, graphicsResolution);
        this.sceneCache.forEach(entry => applyLumiereSceneQuality(entry.unit.scene, this.quality));
        if (this.songSwap.staged) applyLumiereSceneQuality(this.songSwap.staged.unit.scene, this.quality);
        this.credits.applyQuality(this.quality);
    }

    scheduleRebuild() {
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = null;
            if (this.destroyed) return;
            this.rebuildDue = true;
            if (this.options.paused) this.renderOnce();
        }, REBUILD_DEBOUNCE_MS);
    }

    drawOverlay() {
        // 画框是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
        this.overlayLayer.removeChildren().forEach(child => child.destroy({ children: true, context: true }));
        // 仅显示歌词文字时画框也是装饰，不画。
        if (!this.options.tuning.overlayFrame || this.options.tuning.textOnly || this.width === 0) return;
        this.overlayLayer.addChild(buildLumiereOverlay(this.pixi, {
            width: this.width,
            height: this.height,
            theme: this.options.song.theme,
            themeColorMix: this.options.tuning.themeColorMix,
        }));
    }

    buildEntry(song, index) {
        return buildLumiereSceneEntry(this.pixi, {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            program: song.program,
            theme: song.theme,
            tuning: this.sceneTuning,
            sprites: this.sprites,
            audioAt: this.audioAt,
            showText: this.options.showText,
            quality: this.quality,
        }, index);
    }

    destroyEntry(entry) {
        destroyLumiereSceneEntry(entry, this.passthrough);
    }

    clearScenes() {
        this.sceneCache.clear();
        this.activeIndex = -1;
    }

    renderFrame = () => {
        if (this.destroyed) return;
        const time = this.options.currentTime.get();
        this.audio.sample(performance.now(), this.options.paused);
        this.songSwap.advance();
        if (this.rebuildDue) {
            this.rebuildDue = false;
            this.songSwap.dropStaged();
            this.clearScenes();
            this.credits.invalidate();
        }
        const { program, theme } = this.options.song;
        // 暗场强度每帧从共享 tuning 现读：拖滑块不重建场景；场景还没建好的第一帧也已经铺上。
        this.darkField.update(theme, this.sceneTuning.darkField, this.width, this.height);
        const frames = resolveLumiereSceneFrames(program, time, !this.options.staticMode);
        let builtThisFrame = false;
        if (frames.activeIndex !== this.activeIndex) {
            this.activeIndex = frames.activeIndex;
            this.sceneCache.prune(frames.activeIndex, new Set(frames.layers.map(layer => layer.index)));
        }
        frames.layers.forEach(layer => {
            if (!this.sceneCache.has(layer.index)) {
                this.sceneCache.ensure(layer.index);
                builtThisFrame = true;
            }
        });

        const creditsFrame = this.credits.resolveFrame(time, program, this.options.metadata);
        if (!builtThisFrame && !this.songSwap.active) {
            // 一帧只做一件贵的事，按优先级：释放换下的场景 → 预建下一段 → 片尾卡 → 预建上一段。
            const next = frames.activeIndex + 1;
            const previous = frames.activeIndex - 1;
            if (this.sceneCache.hasRetired) {
                this.sceneCache.drainRetired();
            } else if (next < program.paragraphs.length && !this.sceneCache.has(next)) {
                this.sceneCache.ensure(next);
            } else if (this.credits.needsBuild(time, program, this.options.metadata)) {
                this.credits.build(this.creditBuildContext(theme));
            } else if (previous >= 0 && !this.sceneCache.has(previous)) {
                this.sceneCache.ensure(previous);
            }
        }
        if (creditsFrame.active && !this.credits.built && this.credits.hasMetadata(this.options.metadata)) {
            this.credits.build(this.creditBuildContext(theme));
        }

        const lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1;
        const lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0;
        const blurResolution = this.renderResolution * 0.5;
        this.sceneCache.forEach((entry, index) => {
            // 同时在画的段落最多两三个，直接找，不必每帧建一张表。
            const layer = frames.layers.find(candidate => candidate.index === index);
            const alpha = (layer?.alpha ?? 0) * lyricAlpha;
            entry.holder.visible = alpha > 0.002;
            if (!entry.holder.visible || !layer) return;
            entry.unit.update(time);
            applyLumiereLayerFrame(this.pixi, entry, {
                alpha,
                scale: layer.scale,
                blur: Math.max(layer.blur, lyricBlur),
            }, blurResolution);
        });
        this.credits.update(time, creditsFrame, this.width, this.height);
    };

    creditBuildContext(theme) {
        return {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            theme,
            metadata: this.options.metadata,
            tuning: this.sceneTuning,
            quality: this.quality,
        };
    }

    renderOnce() {
        if (this.destroyed || !this.app.canvas.isConnected) return;
        this.renderFrame();
        if (this.destroyed) return;
        this.app.renderer.render(this.app.stage);
    }

    /**
     * 换歌：新歌当前段落的场景在第一帧建好（旧歌还在画），第二帧切过去；换下的场景之后一帧销毁一个。
     * 不是真正的换歌（同一个 seed：主题改了、歌词晚到）、暂停中、还没有画面时直接替换。
     */
    swapSong(next, signal){
        if (this.destroyed) return Promise.resolve();
        if (
            next.seed === this.options.song.seed
            || this.songSwap.active
            || this.width === 0
            || this.sceneCache.size === 0
            || this.options.paused
            || signal?.aborted
        ) {
            this.commitSong(next, null);
            if (this.options.paused) this.renderOnce();
            return Promise.resolve();
        }
        return this.songSwap.begin(next, signal);
    }

    /** 交接的第一帧：离屏建好新歌当前段落的场景（不进缓存，旧歌的场景被换下时它不受影响）。 */
    stageSong(song) {
        const index = findLumiereParagraphIndexAtTime(song.program, this.options.currentTime.get());
        if (index < 0 || index >= song.program.paragraphs.length) return null;
        const entry = this.buildEntry(song, index);
        entry.holder.visible = false;
        this.sceneLayer.addChild(entry.holder);
        return entry;
    }

    commitSong(next, staged) {
        const themeChanged = next.theme !== this.options.song.theme;
        this.options.song = next;
        if (staged) {
            this.sceneCache.retireAll();
            this.sceneCache.adopt(staged.index, staged);
            this.activeIndex = staged.index;
        } else {
            this.clearScenes();
        }
        this.credits.invalidate();
        if (themeChanged) this.drawOverlay();
    }

    /** 就地应用 tuning：每帧现读的字段直接改，bloom 强度写进 filter，烘焙进场景的字段防抖重建。 */
    setTuning(tuning) {
        if (this.destroyed || tuning === this.options.tuning) return;
        const previousTuning = this.options.tuning;
        this.options.tuning = tuning;
        this.applySceneTuning();
        if (
            previousTuning.overlayFrame !== tuning.overlayFrame
            || previousTuning.textOnly !== tuning.textOnly
            || previousTuning.themeColorMix !== tuning.themeColorMix
        ) this.drawOverlay();
        if (this.options.paused) this.renderOnce();
    }

    setShowText(showText) {
        if (this.destroyed || showText === this.options.showText) return;
        this.options.showText = showText;
        this.sceneCache.forEach(entry => {
            entry.unit.scene.text.visible = showText;
        });
        if (this.songSwap.staged) this.songSwap.staged.unit.scene.text.visible = showText;
        this.applySceneTuning();
        if (this.options.paused) this.renderOnce();
    }

    applySceneTuning() {
        const previous = { ...this.sceneTuning };
        const next = toLumiereSceneTuning(this.options.tuning, { showText: this.options.showText });
        Object.assign(this.sceneTuning, next);
        this.refreshQuality();
        if (requiresLumiereSceneRebuild(previous, next)) this.scheduleRebuild();
    }

    setStaticMode(staticMode) {
        if (this.destroyed || staticMode === this.options.staticMode) return;
        this.options.staticMode = staticMode;
        if (this.options.paused) this.renderOnce();
    }

    setAudioSources(audioPower, audioBands) {
        this.audio.setSources({ audioPower, audioBands });
    }

    setSongMetadata(metadata) {
        if (this.destroyed) return;
        const current = this.options.metadata;
        if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return;
        this.options.metadata = { ...metadata };
        this.credits.invalidate();
        if (this.options.paused) this.renderOnce();
    }

    setPaused(paused) {
        if (this.destroyed) return;
        this.options.paused = paused;
        if (paused) {
            this.app.stop();
            this.renderOnce();
        } else {
            this.app.start();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        // 先放掉等交接的人，否则 pixiRuntimeHost 的 drain 循环会一直停在这个 promise 上。
        this.songSwap.settle(false);
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.sceneCache.destroyAll();
        this.credits?.destroy();
        this.darkField?.destroy();
        this.overlayLayer?.removeChildren().forEach(child => child.destroy({ children: true, context: true }));
        // 光点纹理与直通 filter 由运行时持有，场景与片尾卡都已销毁，这里最后释放。
        this.sprites?.destroy();
        this.passthrough?.destroy();
        this.app.destroy({ removeView: true }, { children: true });
    }
}

  window.foliaLumiereRuntime = {
    LumierePixiRuntime: LumierePixiRuntime,
    resolveLumiereCompileOptions: resolveLumiereCompileOptions
  };
}());
