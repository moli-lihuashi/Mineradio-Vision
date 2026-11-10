/* 移植自 Folia components/visualizer/hanabi/createHanabiPixiRuntime.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { BEAT_EFFECT_IDS } from './_stubs.mjs';
import { getBeatEffectStrength, getBeatFxEvents, getBeatFxIntensities, getBeatFxRotationSign, getBeatFxTrackScale, isBeatFxReady } from './_stubs.mjs';
import { resolveLucideIconNames } from './_stubs.mjs';
import { resolveLyricPixelRatio } from './_stubs.mjs';
import { beatImpact, downbeatImpact } from './_stubs.mjs';
import { loadPixi } from './components_visualizer_pixi_loadPixi.mjs';
import { linkPixiPrograms } from './components_visualizer_pixi_pixiProgramLinks.mjs';
import { makePixiContext } from './components_visualizer_pixi_pixiWebGLContext.mjs';
import { destroyPixiContainerChildren } from './components_visualizer_pixi_pixiDisplayResources.mjs';
import { PixiSceneCache } from './components_visualizer_pixiSceneCache.mjs';
import { PixiSongSwap } from './components_visualizer_pixiSongSwap.mjs';
import { HanabiCreditsLayer } from './components_visualizer_hanabi_hanabiCreditsLayer.mjs';
import { findHanabiParagraphIndexAtTime } from './components_visualizer_hanabi_hanabiProgram.mjs';
import { applyHanabiLayerFrame, buildHanabiSceneEntry, destroyHanabiSceneEntry, hanabiSpinDirection } from './components_visualizer_hanabi_hanabiSceneEntry.mjs';
import { resolveHanabiSceneFrames } from './components_visualizer_hanabi_hanabiSceneFrames.mjs';
import { HanabiSkyLayer } from './components_visualizer_hanabi_hanabiSky.mjs';
import { changedHanabiKeys, HANABI_OVERLAY_KEYS, requiresHanabiSceneRebuild, resolveHanabiBaseResolution } from './components_visualizer_hanabi_hanabiTuning.mjs';
import { createBloomFilter } from './components_visualizer_pixi_bloomFilter.mjs';
import { rescaleBeatEnvelope, resolveHanabiBeatPulse } from './components_visualizer_hanabi_hanabiBeatFx.mjs';
import { resolveHanabiChorusWeight, resolveHanabiScreenBloomStrength } from './components_visualizer_hanabi_hanabiScreenBloom.mjs';
import { createHanabiTextures } from './components_visualizer_hanabi_mg_textures.mjs';
import { setHanabiGlyphTextureLimit } from './components_visualizer_hanabi_text_glyphs.mjs';
import { buildHanabiOverlay } from './components_visualizer_hanabi_overlay.mjs';
const REBUILD_DEBOUNCE_MS = 220;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const DARK_SKY = 0.5;
const NIGHT_BACKGROUND = '#0b0d24';
const resolveRenderResolution = (devicePixelRatio, scale)=>resolveLyricPixelRatio(resolveHanabiBaseResolution(devicePixelRatio), scale);
export class HanabiPixiRuntime {
    pixi;
    options;
    app;
    sceneCache = new PixiSceneCache({
        count: ()=>this.options.song.program.paragraphs.length,
        build: (index)=>{
            const entry = this.buildEntry(this.options.song, index);
            this.sceneLayer.addChild(entry.holder);
            return entry;
        },
        destroy: (entry)=>destroyHanabiSceneEntry(entry),
        detach: (entry)=>entry.holder.parent?.removeChild(entry.holder)
    });
    songSwap = new PixiSongSwap({
        stage: (song)=>this.stageSong(song),
        commit: (song, staged)=>this.commitSong(song, staged),
        discard: (entry)=>destroyHanabiSceneEntry(entry)
    });
    activeIndex = -1;
    destroyed = false;
    resizeObserver = null;
    width = 0;
    height = 0;
    renderResolution = 1;
    rebuildTimer = null;
    rebuildDue = false;
    sceneTheme = null;
    textures = null;
    texturesResolution = 0;
    retiredTextures = [];
    texturesReleasable = false;
    screenBloom = null;
    screenBloomArea = null;
    beatSource = {
        events: [],
        strength: 0,
        trackScale: 1
    };
    sky;
    sceneLayer;
    overlayLayer;
    credits;
    constructor(pixi, options, app){
        this.pixi = pixi;
        this.options = options;
        this.app = app;
    }
    static async create(options) {
        const pixi = await loadPixi();
        const contextOptions = {
            backgroundAlpha: 0,
            antialias: options.antialias,
            powerPreference: 'high-performance'
        };
        const context = await makePixiContext(pixi, contextOptions, options.signal);
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveRenderResolution(window.devicePixelRatio, options.renderScale);
        await app.init({
            width,
            height,
            ...contextOptions,
            ...context,
            autoDensity: true,
            resolution,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl'
        });
        if (app.renderer.type !== pixi.RendererType.WEBGL) {
            app.destroy({
                removeView: true
            });
            throw new Error('Hanabi requires WebGL');
        }
        const gl = app.renderer.gl;
        if (gl) setHanabiGlyphTextureLimit(gl.getParameter(gl.MAX_TEXTURE_SIZE));
        const runtime = new HanabiPixiRuntime(pixi, options, app);
        runtime.renderResolution = resolution;
        runtime.sky = new HanabiSkyLayer(pixi);
        runtime.sceneLayer = new pixi.Container();
        runtime.sceneLayer.sortableChildren = true;
        runtime.overlayLayer = new pixi.Container();
        runtime.credits = new HanabiCreditsLayer(pixi);
        app.stage.addChild(runtime.sky.view, runtime.sceneLayer, runtime.credits.holder, runtime.overlayLayer);
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Hanabi runtime creation was cancelled', 'AbortError');
        }
        await runtime.install();
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Hanabi runtime creation was cancelled', 'AbortError');
        }
        return runtime;
    }
    async install() {
        await new Promise((resolve)=>{
            window.setTimeout(resolve);
        });
        if (this.options.signal?.aborted) return;
        this.resizeToHost(true);
        this.renderFrame();
        await linkPixiPrograms(this.pixi, this.app.renderer, this.app.stage, 'Hanabi', this.options.signal);
        if (this.options.signal?.aborted) return;
        this.options.host.appendChild(this.app.canvas);
        this.app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(()=>{
            if (this.destroyed || !this.resizeToHost(false)) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.app.renderer.render(this.app.stage);
        if (!this.options.paused) this.app.start();
    }
    resizeToHost(immediate) {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(this.options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveRenderResolution(window.devicePixelRatio, this.options.renderScale);
        if (width === this.width && height === this.height && resolution === this.renderResolution) return false;
        this.width = width;
        this.height = height;
        this.renderResolution = resolution;
        this.app.renderer.resize(width, height, resolution);
        this.drawOverlay();
        if (immediate) this.rebuildDue = true;
        else this.scheduleRebuild();
        return true;
    }
    scheduleRebuild() {
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(()=>{
            this.rebuildTimer = null;
            if (this.destroyed) return;
            this.rebuildDue = true;
            if (this.options.paused) this.renderOnce();
        }, REBUILD_DEBOUNCE_MS);
    }
    themeFor(theme) {
        const dark = !this.options.tuning.textOnly && this.options.tuning.sky >= DARK_SKY;
        if (this.sceneTheme?.source !== theme || this.sceneTheme.dark !== dark) {
            this.sceneTheme = {
                source: theme,
                dark,
                theme: dark ? {
                    ...theme,
                    backgroundColor: NIGHT_BACKGROUND
                } : theme
            };
        }
        return this.sceneTheme.theme;
    }
    texturesNow() {
        if (!this.textures || this.texturesResolution !== this.renderResolution) {
            if (this.textures) this.retiredTextures.push(this.textures);
            this.textures = createHanabiTextures(this.pixi, this.renderResolution);
            this.texturesResolution = this.renderResolution;
        }
        return this.textures;
    }
    drawOverlay() {
        destroyPixiContainerChildren(this.overlayLayer);
        const { tuning } = this.options;
        if (!tuning.overlayFrame || tuning.textOnly || this.width === 0) return;
        this.overlayLayer.addChild(buildHanabiOverlay(this.pixi, this.width, this.height, this.themeFor(this.options.song.theme), tuning.colorMode, this.renderResolution));
    }
    buildEntry(song, index) {
        return buildHanabiSceneEntry(this.pixi, {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            program: song.program,
            theme: this.themeFor(song.theme),
            tuning: this.options.tuning,
            textures: this.texturesNow(),
            showText: this.options.showText,
            motifs: this.motifs(),
            songTitle: this.options.metadata.title?.trim() || null,
            songArtist: this.options.metadata.artist?.trim() || null,
            icons: this.iconsFor(song.theme)
        }, index);
    }
    motifs() {
        const title = this.options.metadata.title?.trim();
        return [
            ...title ? [
                title
            ] : [],
            'HANABI',
            '花火'
        ];
    }
    iconsFor(theme) {
        return resolveLucideIconNames(theme.lyricsIcons);
    }
    clearScenes() {
        this.sceneCache.clear();
        this.activeIndex = -1;
    }
    releaseRetiredTextures() {
        if (!this.texturesReleasable || this.sceneCache.hasRetired || this.songSwap.active) return;
        this.texturesReleasable = false;
        this.retiredTextures.splice(0).forEach((textures)=>textures.destroy());
    }
    renderFrame = ()=>{
        if (this.destroyed) return;
        const time = this.options.currentTime.get();
        this.songSwap.advance();
        if (this.rebuildDue) {
            this.rebuildDue = false;
            this.songSwap.dropStaged();
            this.clearScenes();
            this.credits.invalidate();
            this.texturesNow();
            if (this.retiredTextures.length > 0) this.texturesReleasable = true;
        }
        const { program, theme } = this.options.song;
        const { tuning } = this.options;
        this.sky.update(theme, tuning.textOnly ? 0 : tuning.sky, this.width, this.height);
        const frames = resolveHanabiSceneFrames(program, time, !this.options.staticMode);
        let builtThisFrame = false;
        if (frames.activeIndex !== this.activeIndex) {
            this.activeIndex = frames.activeIndex;
            this.sceneCache.prune(frames.activeIndex, new Set(frames.layers.map((layer)=>layer.index)));
        }
        frames.layers.forEach((layer)=>{
            if (!this.sceneCache.has(layer.index)) {
                this.sceneCache.ensure(layer.index);
                builtThisFrame = true;
            }
        });
        const creditsFrame = this.credits.resolveFrame(time, program, this.options.metadata);
        if (!builtThisFrame && !this.songSwap.active) {
            const next = frames.activeIndex + 1;
            const previous = frames.activeIndex - 1;
            if (this.sceneCache.hasRetired) {
                this.sceneCache.drainRetired();
            } else if (this.prepareShots(time)) {} else if (next < program.paragraphs.length && !this.sceneCache.has(next)) {
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
        this.releaseRetiredTextures();
        const beats = this.readBeatSource();
        this.applyBeatPulse();
        this.applyScreenBloom(time);
        const lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1;
        const lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0;
        const blurResolution = this.renderResolution * 0.5;
        const spinTurn = tuning.textOnly ? 0 : tuning.spin * hanabiSpinDirection(program.seed);
        this.sceneCache.forEach((entry, index)=>{
            const layer = frames.layers.find((candidate)=>candidate.index === index);
            const alpha = (layer?.alpha ?? 0) * lyricAlpha;
            entry.holder.visible = alpha > 0.002;
            if (!entry.holder.visible || !layer) return;
            entry.scene.update(time, beats);
            applyHanabiLayerFrame(this.pixi, entry, {
                alpha,
                scale: layer.scale,
                blur: Math.max(layer.blur, lyricBlur),
                y: layer.y,
                rotation: layer.rotation * spinTurn
            }, {
                width: this.width,
                height: this.height
            }, blurResolution);
        });
        this.credits.update(time, creditsFrame, this.width, this.height);
    };
    prepareShots(time) {
        let done = false;
        this.sceneCache.forEach((entry)=>{
            if (!done) done = entry.scene.prepare(time);
        });
        return done;
    }
    readBeatSource() {
        if (this.options.staticMode || this.options.tuning.textOnly || !isBeatFxReady()) return null;
        const strength = getBeatEffectStrength(BEAT_EFFECT_IDS.hanabiBeatBursts);
        if (strength <= 0) return null;
        this.beatSource.events = getBeatFxEvents();
        this.beatSource.strength = strength;
        this.beatSource.trackScale = getBeatFxTrackScale();
        return this.beatSource;
    }
    applyScreenBloom(time) {
        const { tuning, song } = this.options;
        const strength = resolveHanabiScreenBloomStrength(tuning.bloom, tuning.chorusBloom, resolveHanabiChorusWeight(song.program.chorus, time));
        if (strength <= 0.01) {
            if (this.sceneLayer.filters?.length) this.sceneLayer.filters = [];
            return;
        }
        if (!this.screenBloom) {
            this.screenBloom = createBloomFilter(this.pixi, {
                strength,
                threshold: 0.5,
                knee: 0.3,
                levels: 5,
                spread: 0.85,
                tint: [
                    1,
                    0.95,
                    0.98
                ],
                padding: 0
            });
            this.screenBloom.resolution = 'inherit';
            this.screenBloomArea = new this.pixi.Rectangle();
        }
        this.screenBloom.options.strength = strength;
        this.screenBloomArea.x = 0;
        this.screenBloomArea.y = 0;
        this.screenBloomArea.width = this.width;
        this.screenBloomArea.height = this.height;
        this.sceneLayer.filterArea = this.screenBloomArea;
        if (!this.sceneLayer.filters?.includes(this.screenBloom)) this.sceneLayer.filters = [
            this.screenBloom
        ];
    }
    applyBeatPulse() {
        const strength = this.options.staticMode || this.options.tuning.textOnly || !isBeatFxReady() ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.hanabiBeatPulse);
        this.sceneLayer.pivot.set(this.width / 2, this.height / 2);
        this.sceneLayer.position.set(this.width / 2, this.height / 2);
        if (strength <= 0) {
            this.sceneLayer.scale.set(1);
            this.sceneLayer.rotation = 0;
            return;
        }
        const clock = getBeatFxIntensities();
        const pulse = resolveHanabiBeatPulse(rescaleBeatEnvelope(beatImpact.get(), clock.beat, strength), rescaleBeatEnvelope(downbeatImpact.get(), clock.downbeat, strength), getBeatFxRotationSign());
        this.sceneLayer.scale.set(pulse.scale);
        this.sceneLayer.rotation = pulse.rotation;
    }
    creditBuildContext(theme) {
        return {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            theme: this.themeFor(theme),
            metadata: this.options.metadata,
            tuning: this.options.tuning,
            textures: this.texturesNow(),
            icons: this.iconsFor(theme)
        };
    }
    renderOnce() {
        if (this.destroyed || !this.app.canvas.isConnected) return;
        this.renderFrame();
        if (this.destroyed) return;
        this.app.renderer.render(this.app.stage);
    }
    swapSong(next, signal) {
        if (this.destroyed) return Promise.resolve();
        if (next.seed === this.options.song.seed || this.songSwap.active || this.width === 0 || this.sceneCache.size === 0 || this.options.paused || signal?.aborted) {
            this.commitSong(next, null);
            if (this.options.paused) this.renderOnce();
            return Promise.resolve();
        }
        return this.songSwap.begin(next, signal);
    }
    stageSong(song) {
        const index = findHanabiParagraphIndexAtTime(song.program, this.options.currentTime.get());
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
    setTuning(tuning) {
        if (this.destroyed || tuning === this.options.tuning) return;
        const previous = this.options.tuning;
        this.options.tuning = tuning;
        const darkChanged = previous.sky >= DARK_SKY !== tuning.sky >= DARK_SKY;
        if (changedHanabiKeys(previous, tuning, HANABI_OVERLAY_KEYS) || darkChanged) this.drawOverlay();
        if (requiresHanabiSceneRebuild(previous, tuning) || darkChanged) this.scheduleRebuild();
        if (this.options.paused) this.renderOnce();
    }
    setRenderScale(scale) {
        if (this.destroyed || scale === this.options.renderScale) return;
        this.options.renderScale = scale;
        if (this.width === 0) return;
        if (this.resizeToHost(false) && this.options.paused) this.renderOnce();
    }
    setShowText(showText) {
        if (this.destroyed || showText === this.options.showText) return;
        this.options.showText = showText;
        const apply = (entry)=>entry.scene.setLayerVisibility({
                graphics: true,
                text: showText,
                mid: false
            });
        this.sceneCache.forEach(apply);
        if (this.songSwap.staged) apply(this.songSwap.staged);
        if (this.options.paused) this.renderOnce();
    }
    setStaticMode(staticMode) {
        if (this.destroyed || staticMode === this.options.staticMode) return;
        this.options.staticMode = staticMode;
        if (this.options.paused) this.renderOnce();
    }
    setSongMetadata(metadata) {
        if (this.destroyed) return;
        const current = this.options.metadata;
        if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return;
        const titleChanged = current.title?.trim() !== metadata.title?.trim() || current.artist?.trim() !== metadata.artist?.trim();
        this.options.metadata = {
            ...metadata
        };
        this.credits.invalidate();
        if (titleChanged) this.scheduleRebuild();
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
        this.songSwap.settle(false);
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.sceneCache.destroyAll();
        this.credits?.destroy();
        this.sky?.destroy();
        if (this.sceneLayer) this.sceneLayer.filters = [];
        this.screenBloom?.destroy();
        this.screenBloom = null;
        if (this.overlayLayer) destroyPixiContainerChildren(this.overlayLayer);
        this.textures?.destroy();
        this.retiredTextures.splice(0).forEach((textures)=>textures.destroy());
        this.app.destroy({
            removeView: true
        }, {
            children: true
        });
    }
}
