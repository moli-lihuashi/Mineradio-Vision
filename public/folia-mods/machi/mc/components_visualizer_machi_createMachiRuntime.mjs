/* 移植自 Folia components/visualizer/machi/createMachiRuntime.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { getDrumHits } from './_stubs.mjs';
import { BEAT_EFFECT_IDS } from './_stubs.mjs';
import { getBeatEffectStrength, getBeatFxHeard, getBeatFxEvents, getBeatFxTrackScale, isBeatFxReady } from './_stubs.mjs';
import { resolveLucideIconNames } from './_stubs.mjs';
import { resolveThemeFontStack, resolveThemeFontWeight } from './_stubs.mjs';
import { createMachiBeatFrame, MACHI_BEAT, machiDrumHitsAt, machiRippleWetness, resetMachiBeatFrame, resolveMachiDrumRipples, resolveMachiNeonPulse, resolveMachiScreenFlash } from './components_visualizer_machi_engine_beatFx.mjs';
import { MachiCamera } from './components_visualizer_machi_engine_camera.mjs';
import { MachiClock } from './components_visualizer_machi_engine_clock.mjs';
import { buildMachiLightningTimes, MachiAudioFollower, resolveMachiBoardTarget, resolveMachiChorus, resolveMachiFlicker, resolveMachiLightning, sameBoardTarget } from './components_visualizer_machi_engine_director.mjs';
import { createMachiEnvironmentState, MACHI_DAYLIGHT, resolveMachiDaylight, resolveMachiEnvironmentLook, resolveMachiEnvironmentTarget, resolveMachiWeatherKind, sameMachiEnvironment, stepMachiEnvironment } from './components_visualizer_machi_engine_environment.mjs';
import { MachiGround } from './components_visualizer_machi_engine_fx_ground.mjs';
import { MachiPost } from './components_visualizer_machi_engine_fx_post.mjs';
import { resolveMachiLens } from './components_visualizer_machi_engine_lens.mjs';
import { createMachiDegradeState, resolveMachiRenderQuality, stepMachiDegrade } from './components_visualizer_machi_engine_quality.mjs';
import { MachiReflection } from './components_visualizer_machi_engine_fx_reflection.mjs';
import { compileInto, reportBrokenPrograms, waitForPrograms, yieldToMain } from './components_visualizer_machi_engine_programWarmup.mjs';
import { MachiWeather } from './components_visualizer_machi_engine_fx_weather.mjs';
import { MachiColorBlend, MachiMaterials } from './components_visualizer_machi_engine_materials.mjs';
import { resolveMachiPalette } from './components_visualizer_machi_engine_palette.mjs';
import { MachiSky } from './components_visualizer_machi_engine_sky.mjs';
import { MachiSkyLights } from './components_visualizer_machi_engine_skyLights.mjs';
import { createMachiSnowUniforms, setMachiSnowRoofs } from './components_visualizer_machi_engine_snow.mjs';
import { resolveMachiSceneId } from './components_visualizer_machi_machiTuning.mjs';
import { MACHI_SCENES } from './components_visualizer_machi_scenes_index.mjs';
import { isGpuAnalysisActive } from './_stubs.mjs';
import { useVisualizerSettingsStore } from './_stubs.mjs';
import { reportMachiDegrade, withdrawMachiDegrade } from './components_visualizer_machi_degradeStatus.mjs';
import { reportMachiShownScene, withdrawMachiShownScene } from './components_visualizer_machi_shownScene.mjs';
const throwIfAborted = (signal)=>{
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};
const themeKey = (theme)=>[
        theme.backgroundColor,
        theme.primaryColor,
        theme.accentColor,
        theme.secondaryColor,
        (theme.wordColors ?? []).map((entry)=>`${entry.word}=${entry.color}`).join(','),
        (theme.lyricsIcons ?? []).join(','),
        theme.fontStyle,
        theme.fontFamily ?? '',
        (theme.fontFamilyStack ?? []).join(','),
        String(theme.fontWeight ?? ''),
        theme.name ?? '',
        theme.description ?? '',
        theme.animationIntensity
    ].join('|');
const INTENSITY_SCALE = {
    calm: 0.7,
    normal: 1,
    chaotic: 1.3
};
const TRAFFIC_CHANCE = {
    calm: 0.4,
    normal: 0.6,
    chaotic: 0.78
};
const DEGRADE_WINDOW_MS = 2500;
const DEGRADE_SETTLE_MS = 10000;
const SIGN_REPAINT_DEBOUNCE_MS = 150;
const PREHEAT_LEAD_SECONDS = 2.5;
const DEG = Math.PI / 180;
const CLOCK_CHECK_MS = 30_000;
const SCENE_FADE_OUT = 0.18;
const SCENE_FADE_IN = 0.32;
const WHITE = new THREE.Color(1, 1, 1);
const lerpColor = (out, a, b, t)=>out.copy(a).lerp(b, t);
const qualityKey = (quality)=>[
        quality.renderScale,
        quality.antialias,
        quality.shadows,
        quality.reflections,
        quality.glow,
        quality.adaptive
    ].join('|');
export class MachiRuntime {
    options;
    renderer;
    scene = new THREE.Scene();
    camera = new MachiCamera();
    clock = new MachiClock();
    blend;
    materials;
    skyLights;
    sky = new MachiSky();
    ground;
    reflection;
    post;
    stage;
    stageContext;
    stageId;
    weather;
    snow = createMachiSnowUniforms();
    environmentTarget;
    environment;
    look;
    environmentDirty = true;
    clockTimer = 0;
    fade = 1;
    fadePhase = 'idle';
    pendingScene = null;
    holding = true;
    songChangedWhileBuilding = false;
    lifetime = new AbortController();
    scratchColor = new THREE.Color();
    scratchColorB = new THREE.Color();
    lightningTimes = [];
    beat = createMachiBeatFrame();
    kickRings = new Float32Array(MACHI_BEAT.ripple.max * 2);
    debugDrumHits = null;
    degrade = 0;
    renderQuality;
    qualityCheckedAt = 0;
    degradeState = createMachiDegradeState();
    degradeScreen = '';
    settleUntil = Number.NaN;
    analysisSeenAt = Number.NEGATIVE_INFINITY;
    size = {
        width: 1,
        height: 1
    };
    audio = new MachiAudioFollower();
    boardTarget = null;
    chorus = 0;
    signRepaintTimer = 0;
    atmosphere = {
        time: 0,
        mistColor: new THREE.Color(),
        mistAmount: 0.2,
        cloudColor: new THREE.Color(),
        cloudAmount: 1,
        stars: 0,
        haze: 0,
        lightning: 0,
        glowA: new THREE.Vector4(),
        glowColorA: new THREE.Color(),
        glowB: new THREE.Vector4(),
        glowColorB: new THREE.Color(),
        wind: new THREE.Vector2()
    };
    resizeObserver;
    raf = 0;
    disposed = false;
    paused;
    staticMode;
    showText;
    song;
    theme;
    tuning;
    globalQuality;
    themeSignature;
    pixelRatio;
    wantsFrame = true;
    frameTimes = [];
    lastFrameAt = 0;
    lastCalls = 0;
    checkedProgramCount = 0;
    lastTriangles = 0;
    static async create(options) {
        throwIfAborted(options.signal);
        const runtime = new MachiRuntime(options);
        try {
            await yieldToMain();
            throwIfAborted(options.signal);
            const loaded = await runtime.loadScene(resolveMachiSceneId(options.tuning, options.song.seed), options.signal);
            throwIfAborted(options.signal);
            if (!loaded) throw new DOMException('Aborted', 'AbortError');
            runtime.start();
        } catch (error) {
            runtime.destroy();
            throw error;
        }
        return runtime;
    }
    constructor(options){
        this.options = options;
        this.paused = options.paused;
        this.staticMode = options.staticMode;
        this.showText = options.showText;
        this.song = options.song;
        this.theme = options.theme;
        this.tuning = options.tuning;
        this.globalQuality = options.renderQuality;
        this.themeSignature = themeKey(options.theme);
        this.renderQuality = this.resolveQuality();
        this.pixelRatio = this.renderQuality.pixelRatio;
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: options.transparent,
            powerPreference: 'high-performance',
            stencil: false
        });
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.info.autoReset = false;
        this.renderer.debug.checkShaderErrors = false;
        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.visibility = 'hidden';
        canvas.addEventListener('webglcontextlost', this.onContextLost);
        options.host.appendChild(canvas);
        const sceneId = resolveMachiSceneId(options.tuning, options.song.seed);
        this.blend = new MachiColorBlend(resolveMachiPalette(options.theme, options.song.seed, MACHI_SCENES[sceneId].resolveArt));
        this.materials = new MachiMaterials(this.blend, this.snow);
        this.lightningTimes = buildMachiLightningTimes(options.song.lines);
        this.environmentTarget = this.resolveEnvironmentTarget();
        this.environment = createMachiEnvironmentState(this.environmentTarget);
        this.look = resolveMachiEnvironmentLook(this.environment);
        this.ground = new MachiGround(this.materials, this.blend, this.snow);
        const quality = this.renderQuality;
        this.skyLights = new MachiSkyLights(this.blend, quality.shadowMapSize);
        this.scene.add(this.skyLights.group);
        this.reflection = new MachiReflection(0.06, quality.reflectionScale || 0.3);
        this.ground.uniforms.uReflection.value = this.reflection.target.texture;
        this.ground.setReflections(quality.reflectionScale > 0);
        this.post = new MachiPost(this.renderer, this.scene, this.camera.camera, quality, options.transparent);
        this.scene.background = options.transparent ? null : this.sky.texture;
        this.camera.onCommit = (view)=>this.options.onViewChange?.(view, this.stageId);
        this.camera.onWake = ()=>this.wake();
        this.camera.setMotion(options.tuning.motion, options.tuning.motionSpeed);
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(options.host);
        this.resize(options.host.clientWidth, options.host.clientHeight);
        this.clock.paused = this.paused || this.staticMode;
    }
    start() {
        this.holding = false;
        this.reportDegrade();
        if (!this.options.previewMode) this.camera.attach(this.renderer.domElement);
        this.clockTimer = window.setInterval(this.onClockCheck, CLOCK_CHECK_MS);
        this.renderFrame(performance.now());
        this.renderer.domElement.style.visibility = '';
        this.wake();
        if (false) this.installDebugHook();
    }
    sceneContent(palette = resolveMachiPalette(this.theme, this.song.seed, MACHI_SCENES[this.stageId].resolveArt)) {
        return {
            song: this.song,
            theme: this.theme,
            palette,
            font: {
                stack: resolveThemeFontStack(this.theme),
                weight: resolveThemeFontWeight(this.theme, 700)
            },
            icons: resolveLucideIconNames(this.theme.lyricsIcons),
            fallbacks: this.options.fallbackIcons
        };
    }
    mountScene(id) {
        this.buildStage(id);
        this.fillStage();
    }
    async loadScene(id, signal = this.lifetime.signal) {
        this.buildStage(id);
        await yieldToMain();
        if (this.disposed) return false;
        throwIfAborted(signal);
        this.fillStage();
        await yieldToMain();
        if (this.disposed) return false;
        throwIfAborted(signal);
        this.compilePrograms();
        await waitForPrograms(this.renderer, signal);
        if (this.disposed) return false;
        reportBrokenPrograms(this.renderer);
        return true;
    }
    compilePrograms() {
        const camera = this.camera.camera;
        compileInto(this.renderer, this.post.sceneTarget, this.scene, camera, this.scene, (object)=>object.layers.test(camera.layers));
        if (this.renderQuality.reflectionScale > 0) this.reflection.compile(this.renderer, this.scene);
        this.post.compile();
    }
    buildStage(id) {
        if (this.stage) {
            this.stage.dispose();
            this.weather.group.removeFromParent();
            this.weather.dispose();
        }
        const definition = MACHI_SCENES[id];
        const palette = resolveMachiPalette(this.theme, this.song.seed, definition.resolveArt);
        this.blend.setTarget(palette, !this.stage || this.staticMode);
        this.stageId = id;
        this.songChangedWhileBuilding = false;
        this.stageContext = {
            materials: new MachiMaterials(this.blend, this.snow, id),
            blend: this.blend,
            geometryCache: new Map(),
            song: this.song,
            previewMode: this.options.previewMode,
            invalidateShadows: ()=>this.skyLights.invalidateShadows()
        };
        const stage = definition.create(this.stageContext);
        this.stage = stage;
        stage.surfaces.road.forEach((surface)=>{
            surface.material = this.ground.asphalt;
        });
        stage.surfaces.lot.forEach((surface)=>{
            surface.material = this.ground.concrete;
        });
        this.ground.uniforms.uPuddleOffset.value.set(stage.puddles.offset[0], stage.puddles.offset[1]);
        this.ground.uniforms.uPuddleAmount.value = stage.puddles.amount;
        this.scene.add(stage.root);
        this.weather = new MachiWeather(this.stageContext.materials, this.blend, stage.weather, this.options.previewMode ? {
            rain: 800,
            splash: 160,
            snow: 500
        } : {
            rain: 2000,
            splash: 560,
            snow: 1400
        });
        this.scene.add(this.weather.group);
        setMachiSnowRoofs(this.snow, stage.weather.roofs);
        this.atmosphere.wind.set(Math.sin(stage.weather.windYaw), Math.cos(stage.weather.windYaw)).multiplyScalar(0.06);
        this.reflection.planeY = stage.reflectionPlaneY;
        this.camera.setFraming(stage.framing, this.customView(id));
    }
    fillStage() {
        const id = this.stageId;
        reportMachiShownScene(this, id);
        this.options.onSceneShown?.(id);
        this.stage.setContent(this.sceneContent());
        this.boardTarget = null;
        this.environmentDirty = true;
        this.syncColors();
        this.skyLights.invalidateShadows();
        this.wantsFrame = true;
    }
    requestScene(id, immediate = this.options.previewMode) {
        if (immediate && this.fadePhase !== 'building') {
            this.pendingScene = null;
            this.fadePhase = 'idle';
            this.fade = 1;
            this.mountScene(id);
            this.compilePrograms();
            return;
        }
        this.pendingScene = id;
        if (this.fadePhase === 'building') return;
        this.fadePhase = 'out';
        this.wantsFrame = true;
        this.wake();
    }
    async switchScene() {
        try {
            await yieldToMain();
            while(this.pendingScene && !this.disposed){
                const id = this.pendingScene;
                this.pendingScene = null;
                if (!await this.loadScene(id)) return;
            }
        } catch (error) {
            if (this.disposed) return;
            console.warn('[Machi] scene switch failed', error);
            this.pendingScene = null;
        }
        if (this.disposed) return;
        if (this.songChangedWhileBuilding) {
            this.songChangedWhileBuilding = false;
            const palette = resolveMachiPalette(this.theme, this.song.seed, MACHI_SCENES[this.stageId].resolveArt);
            this.blend.setTarget(palette, this.staticMode);
            this.stage.swapSong(this.song, this.sceneContent(palette));
            this.boardTarget = null;
        }
        this.fadePhase = 'in';
        this.wantsFrame = true;
        this.wake();
    }
    stepFade(delta) {
        const step = Math.min(delta, 1 / 30);
        if (this.fadePhase === 'out') {
            this.fade = Math.max(0, this.fade - step / SCENE_FADE_OUT);
            if (this.fade === 0) {
                if (this.pendingScene) {
                    this.fadePhase = 'building';
                    void this.switchScene();
                } else {
                    this.fadePhase = 'in';
                }
            }
        } else if (this.fadePhase === 'in') {
            this.fade = Math.min(1, this.fade + step / SCENE_FADE_IN);
            if (this.fade === 1) this.fadePhase = 'idle';
        }
    }
    customView(id) {
        return this.tuning.camera === 'custom' ? this.tuning.views[id] : null;
    }
    get targetSceneId() {
        return this.pendingScene ?? this.stageId;
    }
    onContextLost = (event)=>{
        event.preventDefault();
        console.warn('[Machi] WebGL context lost, rebuilding the runtime');
        this.stopLoop();
        this.options.onContextLost();
    };
    onResize = (entries)=>{
        const entry = entries[0];
        if (!entry) return;
        this.resize(entry.contentRect.width, entry.contentRect.height);
        this.wake();
    };
    resize(width, height) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        this.size = {
            width: w,
            height: h
        };
        this.renderer.setSize(w, h, false);
        this.camera.setAspect(w, h);
        this.post.setSize();
        this.reflection.setSize(w * this.pixelRatio, h * this.pixelRatio);
        this.wantsFrame = true;
    }
    resolveQuality(degrade = this.degrade) {
        return resolveMachiRenderQuality(this.tuning.quality, {
            degrade,
            devicePixelRatio: window.devicePixelRatio || 1,
            previewMode: this.options.previewMode,
            global: this.globalQuality
        });
    }
    applyQuality() {
        const quality = this.resolveQuality();
        this.renderQuality = quality;
        this.pixelRatio = quality.pixelRatio;
        this.renderer.setPixelRatio(quality.pixelRatio);
        if (quality.reflectionScale > 0) this.reflection.setScale(quality.reflectionScale, this.size.width * quality.pixelRatio, this.size.height * quality.pixelRatio);
        this.ground.setReflections(quality.reflectionScale > 0);
        this.skyLights.setShadowMapSize(quality.shadowMapSize);
        this.post.setQuality(quality);
        this.resize(this.size.width, this.size.height);
        this.frameTimes.length = 0;
        this.degradeState = {
            ...this.degradeState,
            slowChecks: 0
        };
        this.settleUntil = performance.now() + DEGRADE_SETTLE_MS;
        this.reportDegrade();
        this.wake();
    }
    adaptQuality(now) {
        if (this.options.previewMode || !this.tuning.quality.adaptive) return;
        if (isGpuAnalysisActive(now)) this.analysisSeenAt = now;
        if (Number.isNaN(this.settleUntil)) this.settleUntil = now + DEGRADE_SETTLE_MS;
        if (now < this.settleUntil || this.clock.paused || document.visibilityState !== 'visible' || now - this.analysisSeenAt < DEGRADE_WINDOW_MS) {
            this.frameTimes.length = 0;
            if (this.degradeState.slowChecks !== 0) this.degradeState = {
                ...this.degradeState,
                slowChecks: 0
            };
            this.qualityCheckedAt = now;
            return;
        }
        if (now - this.qualityCheckedAt < DEGRADE_WINDOW_MS || this.frameTimes.length < 60) return;
        this.qualityCheckedAt = now;
        const { screen } = window;
        const frameRate = useVisualizerSettingsStore.getState().visualizerFrameRate;
        const screenKey = `${screen.width}x${screen.height}@${window.devicePixelRatio}:${screen.availLeft ?? 0},${screen.availTop ?? 0}|${frameRate}`;
        if (screenKey !== this.degradeScreen) {
            const changed = this.degradeScreen !== '';
            this.degradeScreen = screenKey;
            this.degradeState = createMachiDegradeState();
            if (changed) {
                this.frameTimes.length = 0;
                return;
            }
        }
        const { state, degrade, average, threshold } = stepMachiDegrade(this.degradeState, this.frameTimes);
        this.degradeState = state;
        if (!degrade) return;
        if (this.resolveQuality(this.degrade + 1).degrade <= this.renderQuality.degrade) return;
        this.degrade += 1;
        this.applyQuality();
        console.info(`[Machi] frame time ${average.toFixed(1)} ms (threshold ${threshold.toFixed(1)} ms), degraded ${this.degrade} step(s)`);
    }
    applyEnvironmentColors() {
        const { daylight, snowCover } = this.environment;
        const { overcast } = this.look;
        const color = this.scratchColor;
        const other = this.scratchColorB;
        const dusk = MACHI_DAYLIGHT.dusk;
        [
            'skyTop',
            'skyBottom',
            'hemiSky',
            'hemiGround',
            'moon'
        ].forEach((key)=>{
            if (daylight <= dusk) lerpColor(color, this.blend.raw(key), this.blend.raw(`${key}Dusk`), daylight / dusk);
            else lerpColor(color, this.blend.raw(`${key}Dusk`), this.blend.raw(`${key}Day`), (daylight - dusk) / (1 - dusk));
            const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
            other.setRGB(luminance, luminance, luminance).multiplyScalar(key === 'moon' ? 1 : 0.9 + 0.35 * daylight);
            color.lerp(other, overcast * (key === 'moon' ? 0.45 : 0.7));
            if (key === 'hemiGround') color.lerp(other.setRGB(0.55, 0.6, 0.7).multiplyScalar(0.35 + 0.65 * daylight), snowCover * 0.5);
            this.blend.setDerived(key, color);
        });
    }
    syncColors() {
        this.applyEnvironmentColors();
        this.materials.syncColors();
        this.skyLights.sync();
        this.sky.paint(this.blend.get('skyTop'), this.blend.get('skyBottom'));
        this.ground.syncColors();
        this.weather.syncColors();
        this.stage.syncColors();
    }
    wake() {
        if (this.disposed || this.raf || this.holding || this.fadePhase === 'building') return;
        this.clock.resync();
        this.raf = requestAnimationFrame(this.frame);
    }
    stopLoop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }
    frame = (now)=>{
        this.raf = 0;
        if (this.disposed || this.holding || this.fadePhase === 'building') return;
        this.renderFrame(now);
        if (this.raf) return;
        const animating = !this.clock.paused;
        if (animating || this.camera.busy || this.stage.busy || this.wantsFrame || this.environmentMoving || this.fadePhase !== 'idle') {
            this.raf = requestAnimationFrame(this.frame);
        }
    };
    renderFrame(now) {
        this.clock.tick(now);
        this.wantsFrame = false;
        if (this.lastFrameAt > 0) {
            const interval = now - this.lastFrameAt;
            if (interval > 0 && interval < 100) {
                this.frameTimes.push(interval);
                if (this.frameTimes.length > 120) this.frameTimes.shift();
            }
        }
        this.lastFrameAt = now;
        this.stepFade(this.clock.realDelta);
        this.camera.update(this.clock.realDelta, this.clock.delta);
        this.stepEnvironment(this.clock.realDelta);
        if (this.blend.step(this.clock.realDelta) || this.environmentDirty) {
            this.environmentDirty = false;
            this.syncColors();
            this.wantsFrame = true;
        }
        this.direct();
        this.renderer.info.reset();
        if (this.skyLights.moon.shadow.needsUpdate) this.renderer.shadowMap.needsUpdate = true;
        const camera = this.camera.camera;
        if (this.environment.wetness > 0.02 && this.renderQuality.reflectionScale > 0) {
            this.reflection.render(this.renderer, this.scene, camera);
            this.ground.uniforms.uReflectMatrix.value.copy(this.reflection.textureMatrix);
        }
        const pixelWorldSize = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.size.height * this.pixelRatio);
        const zoom = camera.zoom / this.camera.defaultView.zoom;
        this.post.render(pixelWorldSize, this.camera.focusDistance, this.atmosphere, {
            focus: this.focusDepth(),
            ...resolveMachiLens(this.tuning, zoom),
            aberration: 0.014,
            vignette: 0.55,
            grain: 0.032,
            fade: this.fade
        });
        this.adaptQuality(now);
        const programCount = this.renderer.info.programs?.length ?? 0;
        if (programCount !== this.checkedProgramCount) {
            this.checkedProgramCount = programCount;
            reportBrokenPrograms(this.renderer);
        }
        this.lastCalls = this.renderer.info.render.calls;
        this.lastTriangles = this.renderer.info.render.triangles;
        this.camera.rendered();
    }
    resolveEnvironmentTarget() {
        return resolveMachiEnvironmentTarget(resolveMachiDaylight(this.tuning.timeOfDay, new Date()), resolveMachiWeatherKind(this.tuning.weather, this.song.seed));
    }
    refreshEnvironmentTarget(immediate = this.staticMode) {
        this.environmentTarget = this.resolveEnvironmentTarget();
        if (immediate) {
            this.environment = createMachiEnvironmentState(this.environmentTarget);
            this.look = resolveMachiEnvironmentLook(this.environment);
            this.skyLights.invalidateShadows();
        }
        this.environmentDirty = true;
        this.wantsFrame = true;
        this.wake();
    }
    onClockCheck = ()=>{
        if (this.tuning.timeOfDay !== 'auto' || this.disposed) return;
        const daylight = resolveMachiDaylight('auto', new Date());
        if (Math.abs(daylight - this.environmentTarget.daylight) > 1e-3) this.refreshEnvironmentTarget();
    };
    stepEnvironment(delta) {
        const next = stepMachiEnvironment(this.environment, this.environmentTarget, Math.min(delta, 0.1));
        if (sameMachiEnvironment(next, this.environment)) return;
        this.environment = next;
        this.look = resolveMachiEnvironmentLook(next);
        this.environmentDirty = true;
        if (next.daylight === this.environmentTarget.daylight) this.skyLights.settleShadows();
    }
    get environmentMoving() {
        const target = this.environmentTarget;
        const state = this.environment;
        return state.daylight !== target.daylight || state.rain !== target.rain || state.snow !== target.snow || state.fog !== target.fog || state.wetness !== Math.max(target.rain, target.fog * 0.35) || state.snowCover !== target.snow;
    }
    direct() {
        const songTime = this.options.currentTime.get();
        const beat = this.stepBeat(songTime);
        const lines = this.song.lines;
        const target = this.showText ? resolveMachiBoardTarget(lines, songTime) : {
            kind: 'card'
        };
        const targetChanged = !sameBoardTarget(this.boardTarget, target);
        let preheat = null;
        if (targetChanged) {
            this.boardTarget = target;
            this.wantsFrame = true;
        } else if (target.kind === 'line' && !this.clock.paused) {
            const next = lines[target.index + 1];
            if (next && next.startTime - songTime < PREHEAT_LEAD_SECONDS) preheat = {
                kind: 'line',
                index: target.index + 1
            };
        }
        const chorusTarget = resolveMachiChorus(lines, target);
        this.chorus += (chorusTarget - this.chorus) * (1 - Math.exp(-this.clock.delta * 2.5));
        if (this.staticMode) this.chorus = chorusTarget;
        const audio = this.clock.paused ? this.audio.step(0, 0) : this.audio.step(this.options.audioPower.get(), this.clock.delta);
        const flicker = this.staticMode ? 1 : resolveMachiFlicker(this.clock.elapsed, this.song.seed);
        const intensity = INTENSITY_SCALE[this.theme.animationIntensity] ?? 1;
        const environment = this.environment;
        const look = this.look;
        const rain = environment.rain * (0.62 + 0.22 * audio + 0.12 * this.chorus) * intensity;
        const camera = this.camera.camera;
        const pixelsPerUnit = this.size.height * this.pixelRatio / ((camera.top - camera.bottom) / camera.zoom);
        this.weather.update({
            time: this.clock.elapsed,
            rain,
            snow: environment.snow * (0.75 + 0.25 * intensity),
            wetness: environment.wetness,
            glint: 1 - 0.9 * environment.daylight,
            pixelsPerUnit
        });
        const lightning = this.staticMode || environment.rain < 0.5 ? 0 : resolveMachiLightning(this.lightningTimes, songTime) * environment.rain;
        this.skyLights.update({
            daylight: environment.daylight,
            sunIntensity: look.sunIntensity,
            hemiIntensity: look.hemiIntensity,
            flash: lightning
        });
        this.post.setGlow(look.bloom * beat.bloom, look.streaks);
        const atmosphere = this.atmosphere;
        atmosphere.lightning = lightning;
        atmosphere.time = this.clock.elapsed;
        const skyBottom = this.blend.get('skyBottom');
        atmosphere.mistColor.copy(skyBottom).multiplyScalar(1.35 - 0.4 * environment.daylight);
        atmosphere.mistAmount = look.mist + 0.06 * Math.min(1, rain);
        lerpColor(this.scratchColor, skyBottom, this.blend.get('moon'), 0.25).multiplyScalar(0.7);
        this.scratchColorB.copy(skyBottom).lerp(WHITE, 0.55 - 0.25 * look.overcast).multiplyScalar(0.55);
        atmosphere.cloudColor.copy(this.scratchColor).lerp(this.scratchColorB, environment.daylight);
        atmosphere.cloudAmount = look.clouds;
        atmosphere.stars = look.stars;
        atmosphere.haze = look.haze;
        this.ground.uniforms.uTime.value = this.clock.elapsed;
        this.ground.uniforms.uRain.value = environment.rain > 0.02 ? Math.min(1, 0.45 + 0.5 * rain) : 0;
        this.ground.uniforms.uWet.value = environment.wetness;
        this.snow.uMachiSnow.value = environment.snowCover;
        this.snow.uMachiWet.value = environment.wetness;
        this.snow.uMachiViewUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
        this.stage.direct({
            songTime,
            ambientTime: this.clock.elapsed,
            delta: this.clock.delta,
            staticMode: this.staticMode,
            immediate: this.staticMode || this.clock.paused,
            showText: this.showText,
            seed: this.song.seed,
            lines,
            target,
            targetChanged,
            preheat,
            chorus: this.chorus,
            audio,
            flicker,
            rain,
            trafficChance: TRAFFIC_CHANCE[this.theme.animationIntensity] ?? 0.6,
            environment,
            look,
            pixelsPerUnit,
            atmosphere,
            beat
        });
    }
    stepBeat(songTime) {
        const beat = resetMachiBeatFrame(this.beat);
        const idle = this.clock.paused;
        const neonStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiNeonPulse);
        const rippleStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiDrumRipple);
        const flashStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiScreenFlash);
        const heard = getBeatFxHeard();
        const time = heard.time ?? songTime;
        if (neonStrength > 0 && isBeatFxReady()) {
            resolveMachiNeonPulse(getBeatFxEvents(), time, neonStrength, getBeatFxTrackScale(), beat);
        }
        let hits = null;
        if (rippleStrength > 0 || flashStrength > 0) {
            hits = machiDrumHitsAt(this.debugDrumHits ?? getDrumHits(heard.key), time);
        }
        beat.thump = resolveMachiDrumRipples(hits, time, rippleStrength, this.kickRings) * (1 - machiRippleWetness(this.environment.wetness));
        resolveMachiScreenFlash(hits, time, flashStrength, beat);
        const focus = this.stage.focusPoint;
        this.ground.setKicks(focus.x, focus.z, this.kickRings);
        return beat;
    }
    repaintSigns() {
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = 0;
        this.stage.setContent(this.sceneContent());
        this.boardTarget = null;
        this.wantsFrame = true;
    }
    swapSong(song) {
        const seedChanged = song.seed !== this.song.seed;
        this.song = song;
        this.lightningTimes = buildMachiLightningTimes(song.lines);
        this.refreshEnvironmentTarget();
        const sceneId = resolveMachiSceneId(this.tuning, song.seed);
        if (sceneId !== this.targetSceneId || seedChanged && this.stage.rebuildsForSeed) {
            this.requestScene(sceneId);
        } else if (this.fadePhase === 'building') {
            this.songChangedWhileBuilding = true;
        } else if (!this.pendingScene) {
            const palette = resolveMachiPalette(this.theme, song.seed, MACHI_SCENES[sceneId].resolveArt);
            this.blend.setTarget(palette, this.staticMode);
            this.stage.swapSong(song, this.sceneContent(palette));
            this.boardTarget = null;
        }
        this.wantsFrame = true;
        this.wake();
    }
    setTheme(theme) {
        const signature = themeKey(theme);
        this.theme = theme;
        if (signature === this.themeSignature) return;
        this.themeSignature = signature;
        this.blend.setTarget(resolveMachiPalette(theme, this.song.seed, MACHI_SCENES[this.stageId].resolveArt), this.staticMode);
        if (this.staticMode) this.syncColors();
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = window.setTimeout(()=>{
            if (this.disposed) return;
            this.repaintSigns();
            this.wake();
        }, SIGN_REPAINT_DEBOUNCE_MS);
        this.wake();
    }
    focusDepth() {
        const tuning = this.tuning;
        if (tuning.focus === 'lyrics') return this.camera.depthOf(this.stage.focusPoint);
        const center = this.camera.focusDistance;
        return tuning.focus === 'manual' ? center + tuning.focusOffset : center;
    }
    setTuning(tuning) {
        const previous = this.tuning;
        if (previous === tuning) return;
        this.tuning = tuning;
        if (previous.scene !== tuning.scene) {
            const sceneId = resolveMachiSceneId(tuning, this.song.seed);
            if (sceneId !== this.targetSceneId) this.requestScene(sceneId);
        }
        if (previous.timeOfDay !== tuning.timeOfDay || previous.weather !== tuning.weather) this.refreshEnvironmentTarget();
        this.camera.setCustom(this.customView(this.stageId));
        this.camera.setMotion(tuning.motion, tuning.motionSpeed);
        if (qualityKey(previous.quality) !== qualityKey(tuning.quality)) {
            this.degrade = 0;
            this.degradeState = {
                ...this.degradeState,
                degradedAverage: 0
            };
            this.applyQuality();
        }
        this.wantsFrame = true;
        this.wake();
    }
    setRenderQuality(renderQuality) {
        const previous = this.globalQuality;
        if (previous.scale === renderQuality.scale && previous.antialias === renderQuality.antialias) return;
        this.globalQuality = renderQuality;
        const { renderScale, antialias } = this.tuning.quality;
        if (renderScale !== 'global' && antialias !== 'global') return;
        this.degrade = 0;
        this.degradeState = {
            ...this.degradeState,
            degradedAverage: 0
        };
        this.applyQuality();
    }
    reportDegrade() {
        if (!this.options.previewMode) reportMachiDegrade(this, this.renderQuality.degrade);
    }
    setPaused(paused) {
        this.paused = paused;
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }
    setStaticMode(staticMode) {
        this.staticMode = staticMode;
        if (staticMode) this.refreshEnvironmentTarget(true);
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }
    setShowText(showText) {
        if (this.showText === showText) return;
        this.showText = showText;
        this.boardTarget = null;
        this.wantsFrame = true;
        this.wake();
    }
    renderOnce() {
        this.wantsFrame = true;
        this.wake();
    }
    installDebugHook() {
        window.__machiDebug = {
            setView: (azimuthDeg, elevationDeg, zoom)=>{
                this.camera.placeAt({
                    azimuth: azimuthDeg * DEG,
                    elevation: elevationDeg * DEG,
                    zoom: zoom ?? this.camera.defaultView.zoom
                });
                this.renderFrame(performance.now());
            },
            resetView: ()=>{
                this.camera.placeAtRest();
                this.renderFrame(performance.now());
            },
            cameraOffset: ()=>this.camera.offset(),
            renderAt: (songSeconds, ambientSeconds)=>{
                this.options.currentTime.set(songSeconds);
                if (ambientSeconds !== undefined) this.clock.elapsed = ambientSeconds;
                this.renderFrame(performance.now());
            },
            nextCar: (from)=>this.stage.nextCar?.(from, this.song.seed, TRAFFIC_CHANCE[this.theme.animationIntensity] ?? 0.6) ?? null,
            setTuning: (patch, transition = false)=>{
                const sceneId = resolveMachiSceneId({
                    ...this.tuning,
                    ...patch
                }, this.song.seed);
                if (!transition && sceneId !== this.targetSceneId) this.requestScene(sceneId, true);
                this.setTuning({
                    ...this.tuning,
                    ...patch
                });
                if (!transition) this.refreshEnvironmentTarget(true);
                this.renderFrame(performance.now());
            },
            environment: ()=>({
                    ...this.environment
                }),
            setDrumHits: (hits)=>{
                this.debugDrumHits = hits;
                this.renderFrame(performance.now());
            },
            stats: ()=>{
                const average = this.frameTimes.length ? this.frameTimes.reduce((sum, value)=>sum + value, 0) / this.frameTimes.length : 0;
                return {
                    scene: this.stageId,
                    daylight: Math.round(this.environment.daylight * 100) / 100,
                    weather: resolveMachiWeatherKind(this.tuning.weather, this.song.seed),
                    calls: this.lastCalls,
                    triangles: this.lastTriangles,
                    geometries: this.renderer.info.memory.geometries,
                    textures: this.renderer.info.memory.textures,
                    programs: this.renderer.info.programs?.length ?? 0,
                    frameMs: Math.round(average * 100) / 100,
                    pixelRatio: this.pixelRatio,
                    antialias: this.renderQuality.antialias,
                    samples: this.renderQuality.samples,
                    degrade: this.renderQuality.degrade,
                    showText: this.showText ? 1 : 0
                };
            },
            runtime: this
        };
    }
    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        this.lifetime.abort();
        this.stopLoop();
        window.clearTimeout(this.signRepaintTimer);
        window.clearInterval(this.clockTimer);
        this.resizeObserver.disconnect();
        this.camera.dispose();
        withdrawMachiShownScene(this);
        withdrawMachiDegrade(this);
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('webglcontextlost', this.onContextLost);
        this.stage?.dispose();
        this.weather?.dispose();
        this.materials.dispose();
        this.skyLights.dispose();
        this.reflection.dispose();
        this.post.dispose();
        this.sky.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        canvas.remove();
        if (window.__machiDebug?.runtime === this) delete window.__machiDebug;
    }
}
