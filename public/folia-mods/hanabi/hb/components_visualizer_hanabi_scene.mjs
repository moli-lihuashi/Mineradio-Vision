/* 移植自 Folia components/visualizer/hanabi/scene.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { firstBeatAtOrAfter, HANABI_BEAT_SHELL_LIFE, resolveHanabiBeatShell } from './components_visualizer_hanabi_hanabiBeatFx.mjs';
import { createRng } from './components_visualizer_hanabi_hanabiRandom.mjs';
import { burstPreset } from './components_visualizer_hanabi_catalog.mjs';
import { planShotCollage, pickCollageKeyword } from './components_visualizer_hanabi_collage_collagePlan.mjs';
import { createCollageTextureCache } from './components_visualizer_hanabi_collage_collagePainters.mjs';
import { createShotCollage } from './components_visualizer_hanabi_collage_collageViews.mjs';
import { createUnitCollage } from './components_visualizer_hanabi_collage_unitCollage.mjs';
import { keywordColorOf, resolveHanabiPalette } from './components_visualizer_hanabi_color.mjs';
import { HANABI_QUALITY_PROFILES, resolveHanabiGlowQuality } from './components_visualizer_hanabi_hanabiTuning.mjs';
import { createAmbient } from './components_visualizer_hanabi_mg_ambient.mjs';
import { createFireworks } from './components_visualizer_hanabi_mg_fireworks.mjs';
import { createHanabiGlow } from './components_visualizer_hanabi_mg_glow.mjs';
import { createOrnament } from './components_visualizer_hanabi_mg_ornaments.mjs';
import { resolveThemeFontStack } from './_stubs.mjs';
import { createHanabiText } from './components_visualizer_hanabi_text_lyricText.mjs';
import { buildTimeline, LAUNCH_DURATION, planSpin } from './components_visualizer_hanabi_timeline.mjs';
const SHOT_PARTICLES = 750;
const PREPARE_AHEAD = 1.5;
const MAX_SUNG_BURSTS = 28;
const MAX_DISSOLVE_BURSTS = 24;
const DISSOLVE_SPARK = {
    kind: 'botan',
    count: 10,
    radius: 0.03,
    duration: 0.65,
    colors: [
        0,
        1,
        2
    ],
    trail: 0.25,
    twinkle: 0.6
};
const BRIDGE_KINDS = [
    'mine',
    'senrin',
    'kiku',
    'botan',
    'ring',
    'crossette',
    'willow-ring',
    'strobe'
];
const MOTION = {
    calm: 0.6,
    normal: 1,
    chaotic: 1.4
};
const toShot = (view, x, y)=>{
    const px = (x - view.pivot.x) * view.scale.x;
    const py = (y - view.pivot.y) * view.scale.y;
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    return {
        x: view.position.x + px * cos - py * sin,
        y: view.position.y + px * sin + py * cos
    };
};
const sungRange = (line)=>{
    const words = (line?.words ?? []).filter((word)=>word.text.trim().length > 0);
    if (words.length === 0) return {
        first: line?.startTime ?? null,
        last: line?.endTime ?? null
    };
    return {
        first: words[0].startTime,
        last: Math.max(...words.map((word)=>word.endTime))
    };
};
const thin = (items, max)=>{
    if (items.length <= max) return items;
    const step = items.length / max;
    return Array.from({
        length: max
    }, (_, k)=>items[Math.floor(k * step)]);
};
export const createHanabiScene = (pixi, options)=>{
    const { width, height, tuning, theme, textures } = options;
    const unit = Math.min(width, height);
    const motion = MOTION[theme.animationIntensity] ?? 1;
    const fontScale = options.fontScale ?? 1;
    const graphicsOn = !tuning.textOnly;
    const keywordColor = keywordColorOf(theme);
    const paletteCache = new Map();
    const paletteOf = (profile)=>{
        let palette = paletteCache.get(profile.palette);
        if (!palette) {
            palette = resolveHanabiPalette(profile.palette, theme, tuning.colorMode);
            paletteCache.set(profile.palette, palette);
        }
        return palette;
    };
    const timelineShots = options.shots.map((shot)=>{
        const sung = sungRange(shot.line);
        return {
            startTime: shot.startTime,
            endTime: shot.endTime,
            firstSung: shot.isBridge ? null : sung.first,
            lastSungEnd: shot.isBridge ? null : sung.last,
            isBridge: shot.isBridge,
            camera: shot.profile.camera
        };
    });
    const { angles: spinAngles, drift: spinDrift } = planSpin(options.shots.map((shot)=>shot.endTime - shot.startTime), {
        amount: graphicsOn ? Math.max(0, tuning.spin) : 0,
        direction: options.spinDirection ?? 1,
        random: createRng(`${options.seed}:spin`)
    });
    const timeline = buildTimeline(timelineShots, {
        unitStart: options.startTime,
        unitEnd: options.endTime,
        height,
        riseSpeed: graphicsOn ? Math.max(0, tuning.riseSpeed) : 0,
        motion: motion * Math.max(0, tuning.textMotion),
        exitStart: options.exitStart ?? null,
        spinAngles,
        spinDrift
    });
    const view = new pixi.Container();
    const stage = new pixi.Container();
    const world = new pixi.Container();
    const spin = new pixi.Container();
    spin.pivot.set(width / 2, height / 2);
    spin.position.set(width / 2, height / 2);
    spin.addChild(world);
    view.addChild(stage);
    const lead = options.shots[0];
    const distantRate = options.shots.reduce((sum, shot)=>sum + ({
            quiet: 0.08,
            neutral: 0.2,
            loud: 0.35
        })[shot.profile.mood], 0) / Math.max(options.shots.length, 1);
    const ambient = graphicsOn && tuning.ambient > 0 && lead ? createAmbient({
        pixi,
        textures,
        width,
        height,
        seed: `${options.seed}:ambient`,
        palette: paletteOf(lead.profile),
        startTime: options.startTime,
        endTime: options.endTime,
        density: Math.min(2, tuning.ambient) * (HANABI_QUALITY_PROFILES[tuning.renderQuality] ?? HANABI_QUALITY_PROFILES.full).ambientScale,
        distantBursts: distantRate
    }) : null;
    const collageOn = graphicsOn && tuning.collage > 0;
    const motifs = options.motifs && options.motifs.length > 0 ? options.motifs : [
        'HANABI',
        '花火'
    ];
    const collageCache = collageOn ? createCollageTextureCache(pixi, options.resolution, resolveThemeFontStack(theme)) : null;
    const unitCollage = collageCache && lead ? createUnitCollage(pixi, {
        width,
        height,
        resolution: options.resolution,
        seed: options.seed,
        cache: collageCache,
        paper: paletteOf(lead.profile).paper,
        amount: Math.min(2, tuning.collage),
        startTime: options.startTime
    }) : null;
    if (ambient) stage.addChild(ambient.back);
    if (unitCollage) stage.addChild(unitCollage.back);
    stage.addChild(spin);
    if (ambient) stage.addChild(ambient.front);
    if (unitCollage) stage.addChild(unitCollage.front);
    const glow = graphicsOn && tuning.glow > 0 ? createHanabiGlow(pixi, Math.min(2, tuning.glow), resolveHanabiGlowQuality(width, height, options.resolution, tuning.renderQuality)) : null;
    const screenToShot = (built, sx, sy, time)=>({
            x: sx - built.region.cx * width,
            y: sy - (built.region.cy * height + built.timing.worldY + timeline.rise(time))
        });
    let previousRecipe = null;
    const built = options.shots.map((shot, index)=>{
        const { profile } = shot;
        const timing = timeline.shots[index];
        const palette = paletteOf(profile);
        const region = profile.region;
        const container = new pixi.Container();
        container.position.set(region.cx * width, region.cy * height + timing.worldY);
        const fireworksHolder = new pixi.Container();
        const ornBack = new pixi.Container();
        const ornFront = new pixi.Container();
        const collageBack = new pixi.Container();
        const collageFront = new pixi.Container();
        const mid = new pixi.Container();
        container.addChild(fireworksHolder, ornBack, collageBack);
        const text = shot.line && !shot.isBridge ? createHanabiText({
            pixi,
            width,
            height,
            resolution: options.resolution,
            theme,
            line: shot.line,
            regionWidth: region.w * width,
            regionHeight: region.h * height,
            spec: {
                ...profile.text,
                heroSize: profile.text.heroSize * fontScale
            },
            palette,
            seed: `${options.seed}:${shot.id}:text`,
            enterAt: timing.enterAt,
            exitAt: timing.exitAt,
            exitDuration: timing.exitDuration,
            motion: Math.max(0, tuning.textMotion),
            blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity)),
            keywordColor
        }) : null;
        if (text) {
            container.addChild(text.view);
            const glyphParent = text.glyphs.parent;
            if (glyphParent) glyphParent.addChildAt(mid, glyphParent.getChildIndex(text.glyphs));
            else container.addChild(mid);
        } else {
            container.addChild(mid);
        }
        container.addChild(ornFront, collageFront);
        const holder = new pixi.Container();
        holder.pivot.set(width / 2, height / 2 + timing.worldY);
        holder.position.set(width / 2, height / 2 + timing.worldY);
        holder.rotation = -timing.spin;
        holder.addChild(container);
        world.addChild(holder);
        const { bursts, launches, mains } = graphicsOn ? planShotEvents({
            shot,
            index,
            timing,
            palette,
            text,
            region,
            seed: options.seed,
            screenToShot,
            width,
            height,
            unit,
            tuning
        }) : {
            bursts: [],
            launches: [],
            mains: []
        };
        const burstEnd = Math.max(...bursts.map((event)=>event.at + event.spec.duration), -Infinity);
        const launchEnd = Math.max(...launches.map((event)=>event.at + event.duration + 0.7), -Infinity);
        const regionBounds = {
            x: -region.w * width / 2,
            y: -region.h * height / 2,
            width: region.w * width,
            height: region.h * height
        };
        const collage = collageOn ? planShotCollage({
            seed: `${options.seed}:${shot.id}`,
            family: profile.family,
            mood: profile.mood,
            isBridge: shot.isBridge,
            block: profile.text.block,
            shotNumber: index,
            bounds: text?.bounds ?? regionBounds,
            screen: {
                x: -region.cx * width,
                y: -region.cy * height,
                width,
                height
            },
            screenAt: (time)=>({
                    ...screenToShot({
                        region,
                        timing
                    }, 0, 0, time),
                    width,
                    height
                }),
            unit,
            palette,
            enterAt: timing.enterAt,
            exitAt: timing.exitAt,
            exitDuration: timing.exitDuration,
            start: timing.start,
            end: timing.end,
            keyword: pickCollageKeyword(shot.line),
            motifs,
            bursts: mains.map((event)=>({
                    x: event.x,
                    y: event.y,
                    at: event.at,
                    kind: event.spec.kind,
                    main: true,
                    radius: event.spec.radius * unit * event.scale
                })),
            launches,
            amount: Math.min(2, tuning.collage),
            previous: previousRecipe,
            opening: index === 0 ? options.opening ?? null : null,
            icons: options.icons
        }) : {
            recipe: null,
            items: []
        };
        previousRecipe = collage.recipe;
        const collageEnd = Math.max(...collage.items.map((item)=>item.kind === 'pop' || item.kind === 'floater' ? item.at + item.duration : item.kind === 'whoosh' ? item.at + item.duration + 0.55 : item.exitAt + item.exitDuration), -Infinity);
        return {
            shot,
            timing,
            palette,
            container,
            fireworksHolder,
            ornBack,
            ornFront,
            collageBack,
            collageFront,
            collage,
            mid,
            text,
            bursts,
            launches,
            lifeStart: Math.min(timing.launchAt, timing.enterAt) - 0.25,
            lifeEnd: Math.max(timing.exitAt + timing.exitDuration + 0.3, burstEnd + 0.05, launchEnd, collageEnd + 0.05),
            rig: null
        };
    });
    const buildRig = (item)=>{
        if (!graphicsOn) return {
            fireworks: null,
            ornaments: [],
            collage: null
        };
        const fireworks = createFireworks(pixi, textures, {
            width,
            height,
            palette: item.palette,
            amount: Math.max(0, tuning.sparkAmount),
            maxParticles: SHOT_PARTICLES
        });
        item.fireworksHolder.addChild(fireworks.view);
        if (glow) item.fireworksHolder.filters = [
            glow
        ];
        const region = item.shot.profile.region;
        const bounds = item.text?.bounds ?? {
            x: -region.w * width / 2,
            y: -region.h * height / 2,
            width: region.w * width,
            height: region.h * height
        };
        const text = item.text;
        const anchorsAt = text ? (time)=>text.anchors(time) : ()=>[];
        const ornaments = tuning.ornamentAmount > 0 ? item.shot.profile.ornaments.map((spec, k)=>{
            const ornament = createOrnament(spec, {
                pixi,
                textures,
                width,
                height,
                seed: `${options.seed}:${item.shot.id}:ornament${k}`,
                palette: item.palette,
                bounds,
                anchorsAt,
                enterAt: item.timing.enterAt,
                exitAt: item.timing.exitAt,
                exitDuration: item.timing.exitDuration,
                amount: Math.min(2, tuning.ornamentAmount)
            });
            (spec.layer === 'front' ? item.ornFront : item.ornBack).addChild(ornament.view);
            return ornament;
        }) : [];
        let collage = null;
        if (collageCache && item.collage.items.length > 0) {
            collage = createShotCollage(pixi, item.collage, collageCache, textures);
            item.collageBack.addChild(collage.back);
            item.collageFront.addChild(collage.front);
        }
        return {
            fireworks,
            ornaments,
            collage
        };
    };
    const releaseRig = (item)=>{
        if (!item.rig) return;
        item.fireworksHolder.filters = [];
        item.rig.fireworks?.destroy();
        item.rig.ornaments.forEach((ornament)=>ornament.destroy());
        item.rig.collage?.destroy();
        item.rig = null;
    };
    let layers = {
        graphics: true,
        text: true,
        mid: true
    };
    const applyLayers = ()=>{
        if (ambient) {
            ambient.back.renderable = layers.graphics;
            ambient.front.renderable = layers.graphics;
        }
        if (unitCollage) {
            unitCollage.back.renderable = layers.graphics;
            unitCollage.front.renderable = layers.graphics;
        }
        for (const item of built){
            item.fireworksHolder.renderable = layers.graphics;
            item.ornBack.renderable = layers.graphics;
            item.ornFront.renderable = layers.graphics;
            item.collageBack.renderable = layers.graphics;
            item.collageFront.renderable = layers.graphics;
            item.mid.renderable = layers.mid;
            if (item.text) {
                const shown = layers.text && !item.shot.textHidden;
                item.text.blocks.renderable = shown;
                item.text.glyphs.renderable = shown;
            }
        }
    };
    applyLayers();
    const rest = {
        x: width / 2,
        y: height / 2,
        pivotX: width / 2,
        pivotY: height / 2,
        scale: 1,
        rotation: 0
    };
    const camera = (time)=>{
        const offset = timeline.camera(time);
        return {
            ...rest,
            x: rest.x + offset.dx,
            y: rest.y + offset.dy,
            scale: offset.scale,
            rotation: offset.rotation
        };
    };
    const activeBursts = [];
    const activeLaunches = [];
    const beatCache = new Map();
    let beatCacheEvents = null;
    let beatCacheStrength = -1;
    let beatCacheScale = -1;
    const beatBursts = built.map(()=>[]);
    const beatLaunches = built.map(()=>[]);
    const placeBeat = (event, beats)=>{
        const key = Math.round(event.t * 1000);
        if (beatCache.has(key)) return beatCache.get(key);
        let placed = null;
        const shell = resolveHanabiBeatShell(event, options.seed, beats.strength, beats.trackScale);
        const shot = timeline.shotAt(event.t);
        const item = built[shot];
        if (shell && item && event.t >= options.startTime && event.t <= options.endTime) {
            const located = {
                region: item.shot.profile.region,
                timing: item.timing
            };
            const p = screenToShot(located, shell.sx * width, shell.sy * height, event.t);
            const burst = {
                x: p.x,
                y: p.y,
                at: event.t,
                spec: shell.spec,
                seed: shell.seed,
                scale: 1
            };
            let launch = null;
            if (shell.launch && tuning.launches) {
                const at = event.t - LAUNCH_DURATION;
                const bottom = screenToShot(located, shell.sx * width, height * 1.03, at);
                launch = {
                    fromX: p.x,
                    fromY: Math.max(bottom.y, p.y + height * 0.2),
                    toX: p.x,
                    toY: p.y,
                    at,
                    duration: LAUNCH_DURATION,
                    color: item.palette.glow,
                    seed: `${shell.seed}:launch`
                };
            }
            placed = {
                shot,
                burst,
                launch
            };
        }
        beatCache.set(key, placed);
        return placed;
    };
    const collectBeats = (time, beats)=>{
        beatBursts.forEach((list)=>{
            list.length = 0;
        });
        beatLaunches.forEach((list)=>{
            list.length = 0;
        });
        if (!graphicsOn || !beats || beats.strength <= 0 || beats.events.length === 0) return;
        if (beats.events !== beatCacheEvents || beats.strength !== beatCacheStrength || beats.trackScale !== beatCacheScale) {
            beatCache.clear();
            beatCacheEvents = beats.events;
            beatCacheStrength = beats.strength;
            beatCacheScale = beats.trackScale;
        }
        const until = time + LAUNCH_DURATION;
        for(let index = firstBeatAtOrAfter(beats.events, time - HANABI_BEAT_SHELL_LIFE); index < beats.events.length; index += 1){
            const event = beats.events[index];
            if (event.t > until) break;
            const placed = placeBeat(event, beats);
            if (!placed) continue;
            if (time >= placed.burst.at) beatBursts[placed.shot].push(placed.burst);
            if (placed.launch && time >= placed.launch.at) beatLaunches[placed.shot].push(placed.launch);
        }
    };
    const update = (time, beats)=>{
        const transform = camera(time);
        stage.pivot.set(transform.pivotX, transform.pivotY);
        stage.position.set(transform.x, transform.y);
        stage.scale.set(transform.scale);
        stage.rotation = transform.rotation;
        const rise = timeline.rise(time);
        world.y = rise;
        spin.rotation = timeline.spin(time);
        ambient?.update(time, rise);
        unitCollage?.update(time, rise);
        collectBeats(time, beats);
        built.forEach((item, index)=>{
            const visible = time >= item.lifeStart && time <= item.lifeEnd;
            item.container.visible = visible;
            if (!visible) {
                if (time < item.lifeStart - PREPARE_AHEAD || time > item.lifeEnd) releaseRig(item);
                return;
            }
            if (!item.rig) item.rig = buildRig(item);
            item.text?.update(time);
            if (item.rig.fireworks) {
                activeBursts.length = 0;
                activeLaunches.length = 0;
                for (const event of item.bursts){
                    if (event.at > time) break;
                    if (time <= event.at + event.spec.duration + 0.1) activeBursts.push(event);
                }
                for (const event of item.launches){
                    if (event.at <= time && time <= event.at + event.duration + 0.7) activeLaunches.push(event);
                }
                for (const event of beatBursts[index])activeBursts.push(event);
                for (const event of beatLaunches[index]){
                    if (time <= event.at + event.duration + 0.7) activeLaunches.push(event);
                }
                item.rig.fireworks.update(time, activeBursts, activeLaunches);
            }
            item.rig.ornaments.forEach((ornament)=>ornament.update(time));
            item.rig.collage?.update(time);
        });
    };
    const prepare = (time)=>{
        for (const item of built){
            if (time > item.lifeEnd || time < item.lifeStart - PREPARE_AHEAD) continue;
            if (item.text?.prepare()) return true;
            if (!item.rig) {
                item.rig = buildRig(item);
                return true;
            }
        }
        return false;
    };
    const midLayer = (time)=>built[timeline.shotAt(time)]?.mid ?? null;
    return {
        view,
        timeline,
        events: built.map((item)=>({
                bursts: item.bursts,
                launches: item.launches
            })),
        midLayer,
        camera,
        rest,
        update,
        prepare,
        setLayerVisibility: (next)=>{
            layers = {
                ...next
            };
            applyLayers();
        },
        destroy: ()=>{
            built.forEach((item)=>{
                releaseRig(item);
                item.text?.destroy();
            });
            ambient?.destroy();
            unitCollage?.destroy();
            glow?.destroy();
            view.destroy({
                children: true
            });
            collageCache?.destroy();
        }
    };
};
const planShotEvents = (input)=>{
    const { shot, index, timing, palette, text, region, width, height, unit, tuning } = input;
    const { profile } = shot;
    const random = createRng(`${input.seed}:${shot.id}:${index}:events`);
    const bursts = [];
    const launches = [];
    const locate = (sx, sy, time)=>input.screenToShot({
            region,
            timing
        }, sx, sy, time);
    const launchColor = palette.glow;
    const withLaunch = profile.launch && tuning.launches;
    const launchTo = (x, y, arrive, key)=>{
        const at = arrive - LAUNCH_DURATION;
        const bottom = locate(0, height * 1.03, at).y;
        launches.push({
            fromX: x + (random() - 0.5) * width * 0.08,
            fromY: Math.max(bottom, y + height * 0.2),
            toX: x,
            toY: y,
            at,
            duration: LAUNCH_DURATION,
            color: launchColor,
            seed: `${input.seed}:${shot.id}:${key}:launch`
        });
    };
    const shape = (spec)=>spec.kind === 'ring' || spec.kind === 'willow-ring' || spec.kind === 'heart' || spec.kind === 'star' ? {
            squash: spec.kind === 'ring' ? 0.4 + random() * 0.5 : 1,
            rotation: (random() - 0.5) * 0.6
        } : {};
    if (shot.isBridge) {
        const from = timing.start + 0.15;
        const to = timing.end - 0.3;
        const duration = Math.max(0, to - from);
        const count = Math.max(1, Math.min(10, Math.round(duration / 0.75)));
        const kinds = profile.burst ? [
            profile.burst.kind,
            ...BRIDGE_KINDS
        ] : BRIDGE_KINDS;
        for(let k = 0; k < count; k += 1){
            const at = from + (count === 1 ? 0 : k / (count - 1) * duration * 0.85) + random() * 0.12;
            const kind = kinds[Math.floor(random() * kinds.length)];
            const spec = burstPreset(kind, [
                k % 5,
                (k + 1) % 5,
                (k + 2) % 5
            ]);
            if (kind === 'mine') {
                const p = locate(width * (0.2 + random() * 0.6), height * 0.94, at);
                bursts.push({
                    x: p.x,
                    y: p.y,
                    at,
                    spec,
                    seed: `${input.seed}:${shot.id}:b${k}`,
                    scale: 0.8 + random() * 0.3
                });
                continue;
            }
            const p = locate(width * (0.15 + random() * 0.7), height * (0.14 + random() * 0.34), at);
            bursts.push({
                x: p.x,
                y: p.y,
                at,
                spec,
                seed: `${input.seed}:${shot.id}:b${k}`,
                scale: 0.55 + random() * 0.4,
                ...shape(spec)
            });
            if (tuning.launches) launchTo(p.x, p.y, at, `b${k}`);
        }
        bursts.sort((a, b)=>a.at - b.at);
        return {
            bursts,
            launches,
            mains: [
                ...bursts
            ]
        };
    }
    const bounds = text?.bounds ?? {
        x: -region.w * width / 2,
        y: -region.h * height / 2,
        width: region.w * width,
        height: region.h * height
    };
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const mains = [];
    const main = profile.burst;
    if (main) {
        const radius = main.radius * unit;
        const at = timing.enterAt;
        const key = `${input.seed}:${shot.id}:main`;
        const minY = height * 0.12 - region.cy * height;
        const maxX = width * 0.42;
        const points = [];
        if (main.kind === 'mine') {
            const sx = profile.burstAt === 'sides' ? [
                0.25,
                0.75
            ] : [
                0.3 + random() * 0.4
            ];
            sx.forEach((x, k)=>points.push({
                    x: x * width - region.cx * width,
                    y: height * 0.94 - region.cy * height,
                    at: at + k * 0.15
                }));
        } else if (profile.burstAt === 'behind') {
            points.push({
                x: centerX + (random() - 0.5) * bounds.width * 0.15,
                y: centerY - radius * 0.15,
                at
            });
        } else if (profile.burstAt === 'above') {
            points.push({
                x: centerX + (random() - 0.5) * bounds.width * 0.3,
                y: Math.max(minY, bounds.y - radius * 0.45),
                at
            });
        } else if (profile.burstAt === 'sides') {
            const dx = Math.min(maxX, bounds.width / 2 + radius * 0.35);
            points.push({
                x: centerX - dx,
                y: Math.max(minY, centerY - radius * 0.3),
                at
            });
            points.push({
                x: centerX + dx,
                y: Math.max(minY, centerY - radius * 0.3),
                at: at + 0.15
            });
        } else {
            const settled = timing.enterAt + 0.6;
            const p = locate(width * (0.2 + random() * 0.6), height * (0.12 + random() * 0.22), settled);
            points.push({
                x: p.x,
                y: p.y,
                at
            });
        }
        points.forEach((point, k)=>{
            const x = Math.max(-region.cx * width + width * 0.06, Math.min(width * (1 - region.cx) - width * 0.06, point.x));
            const event = {
                x,
                y: point.y,
                at: point.at,
                spec: main,
                seed: `${key}${k}`,
                scale: 1,
                ...shape(main)
            };
            bursts.push(event);
            mains.push(event);
            if (withLaunch && main.kind !== 'mine') launchTo(x, point.y, point.at, `main${k}`);
        });
    }
    if (text) {
        const glyphs = text.anchors(timing.enterAt).map((anchor, k)=>({
                anchor,
                k
            })).filter(({ anchor })=>!anchor.blank);
        const sung = profile.sungBurst;
        if (sung) {
            const candidates = glyphs.filter(({ anchor })=>anchor.sungAt >= timing.enterAt && anchor.sungAt < timing.exitAt);
            thin(candidates, MAX_SUNG_BURSTS).forEach(({ anchor, k }, n)=>{
                const now = text.anchors(anchor.sungAt)[k] ?? anchor;
                const p = toShot(text.view, now.x, now.y);
                const colors = sung.colors.length > 0 ? sung.colors.map((_, j)=>sung.colors[(j + n) % sung.colors.length]) : [
                    n
                ];
                bursts.push({
                    x: p.x,
                    y: p.y - now.size * 0.1,
                    at: anchor.sungAt,
                    spec: {
                        ...sung,
                        colors
                    },
                    seed: `${input.seed}:${shot.id}:sung${k}`,
                    scale: Math.max(0.6, Math.min(1.6, now.size / (unit * 0.1)))
                });
            });
        }
        if (profile.text.exit === 'dissolve') {
            const chosen = thin(glyphs, MAX_DISSOLVE_BURSTS);
            const step = Math.min(0.05, timing.exitDuration * 0.6 / Math.max(chosen.length, 1));
            chosen.forEach(({ k }, n)=>{
                const at = timing.exitAt + n * step;
                const now = text.anchors(at)[k];
                if (!now) return;
                const p = toShot(text.view, now.x, now.y);
                bursts.push({
                    x: p.x,
                    y: p.y,
                    at,
                    spec: DISSOLVE_SPARK,
                    seed: `${input.seed}:${shot.id}:dissolve${k}`,
                    scale: 1
                });
            });
        }
    }
    bursts.sort((a, b)=>a.at - b.at);
    return {
        bursts,
        launches,
        mains
    };
};
