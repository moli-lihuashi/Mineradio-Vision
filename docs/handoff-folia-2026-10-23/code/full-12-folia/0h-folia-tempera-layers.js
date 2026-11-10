/* tempera 的画框 / 擦除块 / 用户图片层 / 图片纹理池，以及 pixi 显示树的释放工具。
 * 源：src/components/visualizer/tempera/temperaImageLayer.ts（175）+ temperaImageTextures.ts（76）
 *      + temperaOverlay.ts（93）+ src/components/visualizer/pixiDisplayResources.ts（55）
 * 生成：node .workbuddy/tmp/extract-tempera-render.js
 *
 * 必须照抄的判据
 * --------------
 * 1. 销毁一律**逐节点不带参数 destroy()**。`destroy({children:true})` 会把选项原样传给子节点，
 *    Pixi 8 的 Graphics 收到选项却没写 `context:true` 就不销毁自建 context，GPU 批数据要等 60 秒 GC；
 *    写 `context:true` 又会把共享 context 一起销毁。
 * 2. 图片入场按 `lyricEndTime` 排、漂移按 `shotEnd` 走：两个时间点故意不同（见 §4.2）。
 * 3. 纹理**解码一次**、所有场景共用，运行时销毁时统一释放；不用 Assets.load（blob URL 没有扩展名，它会直接拒载）。
 * 4. 擦除块的几何只跟画框尺寸与颜色有关，travel 只是沿自身轴平移 —— 所以是变换，不是每帧重建几何。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var motion = window.foliaTemperaMotion;
  var mg = window.foliaTemperaMg;
  if (!motion || !mg) return;

  var clamp01 = motion.clamp01;
  var easeTemperaEnter = motion.easeTemperaEnter;
  var easeTemperaInOut = motion.easeTemperaInOut;
  var temperaHash01 = mg.hash01;

  /* ---- pixiDisplayResources.ts ---- */
// src/components/visualizer/pixiDisplayResources.ts
// Releases renderer-owned data without discarding display trees that must remain seekable.

const unloadPixiDisplayTree = (root) => {
    const stack = [...(root.children ?? [])];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node.children?.length) stack.push(...node.children);
        // Graphics.unload() 只放视图自己的批数据，缓冲挂在 context 上，要单独 unload；再画到它时 Pixi 自动重建、重传。
        // 共享的 context 也只是被迫重传一次，不会画错。
        node.context?.unload?.();
        node.unload?.();
    }
};

/** Unloads descendants exactly once when a retained Pixi tree leaves the visible set. */
const setPixiDisplayTreeVisibility = (root, visible) => {
    const wasVisible = root.visible !== false;
    root.visible = visible;
    if (wasVisible && !visible) unloadPixiDisplayTree(root);
};

/**
 * 销毁整棵显示树，Graphics 自建的 GraphicsContext 一并销毁，构造时传进来的共享 context 不动。
 * 不能用 destroy({ children: true })：Container 会把这份选项原样传给子节点，而 Pixi 8 的 Graphics.destroy
 * 只要收到选项对象、却没写 context: true，就不销毁自建的 context，它的 GPU 批数据要等 Pixi 的 GC 空闲 60 秒才收；
 * 写 context: true 又会把共享的 context 一起销毁。所以逐个节点不带参数 destroy()——Graphics 只在这时按归属销毁
 * 自建的 context；其余节点不带参数与 { children: true } 一样，都不动纹理。
 */
const destroyPixiDisplayTree = (root) => {
    // 先序收集再倒着销毁：子节点总在父节点之前，父节点 destroy() 时已经没有子节点要处理。
    const order = [];
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        order.push(node);
        if (node.children?.length) stack.push(...node.children);
    }
    for (let index = order.length - 1; index >= 0; index -= 1) order[index].destroy?.();
};

// removeChildren() only detaches nodes; explicitly unload and destroy detached subtrees.
const destroyPixiContainerChildren = (container) => {
    container.removeChildren().forEach(destroyPixiDisplayTree);
};

  /* ---- tempera/temperaImageLayer.ts ---- */
// src/components/visualizer/tempera/temperaImageLayer.ts
// The user's image pool on the canvas. Each shot picks one picture and places it itself, so an
// image carries only a tendency: hand-placing every one of them would defeat the pool. The
// sprite rides the same entrance stagger and flow creep as the composition, so a cut-out
// belongs to the shot rather than floating over it, and a `back` image sits among the artwork
// the lyric inverts against - the type then cuts across it the way it cuts across a tone block.

/** Horizontal bands each tendency draws from, as fractions of the viewport. */
const ALIGN_BANDS = {
    left: { from: 0.14, to: 0.32 },
    center: { from: 0.4, to: 0.6 },
    right: { from: 0.68, to: 0.86 },
    free: { from: 0.12, to: 0.88 },
};

/** Vertical bands mirror the horizontal grid so fixed positions read as a true 3x3 layout. */
const VERTICAL_ALIGN_BANDS = {
    top: { from: 0.14, to: 0.32 },
    center: { from: 0.4, to: 0.6 },
    bottom: { from: 0.68, to: 0.86 },
    free: { from: 0.12, to: 0.88 },
};


/**
 * Resolves where one picture lands in one shot. Pure and seed-driven, so a seek repaints the
 * identical frame and the same song always composes the same way.
 */
const resolveTemperaImagePlacement = (
    image,
    seed,
) => {
    const horizontalBand = ALIGN_BANDS[image.align] ?? ALIGN_BANDS.free;
    const verticalBand = VERTICAL_ALIGN_BANDS[image.verticalAlign] ?? VERTICAL_ALIGN_BANDS.bottom;
    return {
        x: horizontalBand.from
            + (horizontalBand.to - horizontalBand.from) * temperaHash01(seed, 1, 251),
        y: verticalBand.from
            + (verticalBand.to - verticalBand.from) * temperaHash01(seed, 2, 257),
        scale: image.scale * (0.9 + temperaHash01(seed, 3, 263) * 0.2),
        rotation: (temperaHash01(seed, 4, 269) - 0.5) * 0.08,
        opacity: image.opacity,
        flip: temperaHash01(seed, 5, 271) > 0.5,
    };
};

/**
 * Picks the picture for a shot, or none at all. `previousId` keeps two neighbouring shots from
 * landing on the same one while the pool has alternatives.
 */
const resolveTemperaShotImage = (
    pool,
    frequency,
    seed,
    previousId,
) => {
    if (pool.length === 0) return null;
    if (temperaHash01(seed, 6, 277) >= clamp01(frequency)) return null;
    const start = Math.floor(temperaHash01(seed, 7, 281) * pool.length) % pool.length;
    for (let offset = 0; offset < pool.length; offset += 1) {
        const candidate = pool[(start + offset) % pool.length];
        if (candidate.id !== previousId) return candidate;
    }
    return pool[start];
};



const buildTemperaImageLayer = (
    pixi,
    options,
) => {
    const back = new pixi.Container();
    const front = new pixi.Container();
    const flowX = Math.cos(options.flowAngle);
    const flowY = Math.sin(options.flowAngle);
    const carry = Math.max(options.width, options.height) * 0.09;

    const chosen = resolveTemperaShotImage(options.pool, options.frequency, options.seed, options.previousId);
    const texture = chosen ? options.textures.get(chosen.id) : undefined;
    if (!chosen || !texture) {
        return {
            back,
            front,
            updateTime: () => undefined,
            applyPool: () => undefined,
            chosenId: chosen?.id ?? null,
        };
    }

    const sprite = new pixi.Sprite(texture);
    sprite.anchor.set(0.5);
    (options.depth === 'front' ? front : back).addChild(sprite);
    const creepScale = 0.6 + temperaHash01(options.seed, 8, 283) * 0.8;
    let baseX = 0;
    let baseY = 0;
    let baseAlpha = 1;

    // Height drives the scale so a cut-out keeps its proportions on any viewport.
    const place = (image) => {
        const placement = resolveTemperaImagePlacement(image, options.seed);
        const uniform = texture.height > 0 ? (options.height * placement.scale) / texture.height : 1;
        sprite.scale.set(uniform * (placement.flip ? -1 : 1), uniform);
        sprite.rotation = placement.rotation;
        baseX = placement.x * options.width;
        baseY = placement.y * options.height;
        baseAlpha = placement.opacity;
    };
    place(chosen);
    sprite.position.set(baseX, baseY);

    const applyPool = (pool) => {
        const next = pool.find(image => image.id === chosen.id);
        if (next) place(next);
    };

    const updateTime = (time, shotStart, shotEnd, lyricEnd) => {
        const duration = Math.max(shotEnd - shotStart, 0.2);
        const paceDuration = Math.max((lyricEnd ?? shotEnd) - shotStart, 0.2);
        const progress = clamp01((time - shotStart) / duration);
        // Images creep a little slower than the blocks, which reads as depth rather than as
        // the whole frame sliding as one slab.
        const creep = easeTemperaInOut(progress) * carry * 0.35 * creepScale;
        const enter = easeTemperaEnter((time - shotStart - paceDuration * 0.1) / (paceDuration * 0.5));
        sprite.alpha = baseAlpha * enter;
        sprite.visible = enter > 0.001;
        sprite.position.set(baseX + flowX * creep, baseY + flowY * creep);
    };

    return { back, front, updateTime, applyPool, chosenId: chosen.id };
};

  /* ---- tempera/temperaImageTextures.ts ---- */
// src/components/visualizer/tempera/temperaImageTextures.ts
// 用户放置图片的纹理池：运行时创建时从 blob 解码一次，所有段落场景共用，运行时销毁时一起释放。

/**
 * Decodes an image blob to something Pixi can wrap. `createImageBitmap` handles every raster
 * format; SVG is the one it commonly refuses, so that falls back to an image element.
 */
const decodeImageBlob = async (blob) => {
    try {
        return await createImageBitmap(blob);
    } catch {
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.decoding = 'async';
            await new Promise((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('Tempera layer image failed to decode'));
                image.src = url;
            });
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
};

const closeImageBitmap = (source) => {
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
};

class TemperaImageTextures {
    /** Placement id -> texture, handed to every scene build as-is. */
    textures = new Map();

    constructor(pixi) {
    this.pixi = pixi; }

    /**
     * Decodes the user's images straight from their blobs. `Assets.load` is deliberately not
     * used: it chooses a parser from the URL's file extension, and a blob URL has none, so it
     * refuses the load outright. Decoding here also means there is no object URL to leak.
     */
    async load(blobs, isDestroyed) {
        if (!blobs || blobs.size === 0) return;
        await Promise.all([...blobs].map(async ([id, blob]) => {
            try {
                const source = await decodeImageBlob(blob);
                if (isDestroyed()) {
                    closeImageBitmap(source);
                    return;
                }
                this.textures.set(id, this.pixi.Texture.from(source));
            } catch {
                // A corrupt or unsupported file simply leaves that placement unrendered.
            }
        }));
    }

    /**
     * These textures were built here rather than owned by a scene, so they are released
     * here too; app.destroy only walks what is still on the stage.
     */
    destroy() {
        this.textures.forEach(texture => {
            const source = texture.source.resource;
            texture.destroy(true);
            closeImageBitmap(source);
        });
        this.textures.clear();
    }
}

  /* ---- tempera/temperaOverlay.ts ---- */
// src/components/visualizer/tempera/temperaOverlay.ts
// 场景之上的画框层：角标（随 showCornerMarks）与段落转场的擦除块。容器由运行时挂到舞台最上层。

class TemperaOverlay {
    container;
    wipeGraphics = null;
    /** The size and colour the wipe geometry was last built for. */
    wipeKey = '';

    constructor(pixi) {
    this.pixi = pixi;
        this.container = new pixi.Container();
    }

    draw(width, height, tuning, theme) {
        // 画框与擦除块都是自建 context 的 Graphics，逐节点销毁才会连 GPU 批数据一起放掉。
        destroyPixiContainerChildren(this.container);
        // The wipe block lives in the overlay so it sweeps above the scene during cuts.
        this.wipeGraphics = new this.pixi.Graphics();
        this.wipeGraphics.visible = false;
        this.wipeKey = '';
        this.container.addChild(this.wipeGraphics);

        if (!tuning.showCornerMarks) return;
        const g = new this.pixi.Graphics();
        const primary = this.pixi.Color.shared.setValue(theme.primaryColor).toNumber();
        const paddingX = Math.max(28, width * 0.045);
        const paddingY = Math.max(28, height * 0.045);
        // Minimal corner registration marks echo the print-like block aesthetic.
        g.moveTo(paddingX, paddingY + 14).lineTo(paddingX, paddingY).lineTo(paddingX + 14, paddingY)
            .stroke({ color: primary, width: 1.5, alpha: 0.5 });
        g.moveTo(width - paddingX - 14, height - paddingY).lineTo(width - paddingX, height - paddingY).lineTo(width - paddingX, height - paddingY - 14)
            .stroke({ color: primary, width: 1.5, alpha: 0.5 });
        this.container.addChild(g);
    }

    // Slides a screen-sized block along `angle`. `travel` runs 0..2: at 1 the block covers the
    // frame exactly, which is the instant the scene underneath is allowed to swap.
    drawWipe(travel, angle, width, height, color) {
        const wipe = this.wipeGraphics;
        if (!wipe) return;
        if (travel <= 0.001 || travel >= 1.999) {
            wipe.visible = false;
            return;
        }
        // Drawn in a rotated local frame sized to the screen diagonal so it stays full-bleed at
        // any angle. Both edges carry the same chevron, which keeps it in the diamond language
        // of the compositions. The shape depends only on the frame size and colour; travel just
        // slides it along its own axis, so that is a transform rather than new geometry.
        const span = Math.hypot(width, height);
        const notch = span * 0.08;
        const length = span + notch * 2;
        const key = `${width}x${height}|${color}`;
        if (key !== this.wipeKey) {
            this.wipeKey = key;
            const start = -span / 2 - notch;
            const end = start + length;
            const half = span / 2;
            wipe.clear();
            wipe
                .poly([
                    start, -half,
                    end, -half,
                    end + notch, 0,
                    end, half,
                    start, half,
                    start + notch, 0,
                ])
                .fill({ color: this.pixi.Color.shared.setValue(color).toNumber() });
        }
        const offset = (travel - 1) * length;
        wipe.pivot.set(0, 0);
        wipe.position.set(
            width / 2 + Math.cos(angle) * offset,
            height / 2 + Math.sin(angle) * offset,
        );
        wipe.rotation = angle;
        wipe.scale.set(1, 1);
        wipe.visible = true;
    }

    /** Forgets the wipe block; its Graphics goes down with the stage in app.destroy. */
    release() {
        this.wipeGraphics = null;
    }
}


  window.foliaTemperaLayers = {
    destroyPixiDisplayTree: destroyPixiDisplayTree,
    destroyPixiContainerChildren: destroyPixiContainerChildren,
    unloadPixiDisplayTree: unloadPixiDisplayTree,
    setPixiDisplayTreeVisibility: setPixiDisplayTreeVisibility,
    buildTemperaImageLayer: buildTemperaImageLayer,
    resolveTemperaImagePlacement: resolveTemperaImagePlacement,
    resolveTemperaShotImage: resolveTemperaShotImage,
    TemperaImageTextures: TemperaImageTextures,
    TemperaOverlay: TemperaOverlay
  };
}());
