/* 移植自 Folia components/visualizer/hanabi/hanabiCreditsLayer.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { createHanabiCredits, hasHanabiCredits, resolveHanabiCreditsFrame } from './components_visualizer_hanabi_credits.mjs';
const PREBUILD_SECONDS = 4;
const INACTIVE = {
    active: false,
    lyricAlpha: 1,
    lyricBlur: 0,
    posterAlpha: 0,
    posterOffsetY: 0,
    posterScale: 1
};
const toSongMetadata = (metadata)=>({
        title: metadata.title ?? null,
        artist: metadata.artist ?? null,
        album: metadata.album ?? null
    });
export class HanabiCreditsLayer {
    pixi;
    holder;
    credits = null;
    lyricEndTime = 0;
    constructor(pixi){
        this.pixi = pixi;
        this.holder = new pixi.Container();
        this.holder.visible = false;
    }
    get built() {
        return this.credits !== null;
    }
    hasMetadata(metadata) {
        return hasHanabiCredits(toSongMetadata(metadata));
    }
    resolveFrame(time, program, metadata) {
        if (program.lyricEndTime === null || !this.hasMetadata(metadata)) return INACTIVE;
        this.lyricEndTime = program.lyricEndTime;
        return resolveHanabiCreditsFrame(time, program.lyricEndTime);
    }
    needsBuild(time, program, metadata) {
        return !this.credits && program.lyricEndTime !== null && time >= program.lyricEndTime - PREBUILD_SECONDS && this.hasMetadata(metadata);
    }
    build(context) {
        this.invalidate();
        this.credits = createHanabiCredits(this.pixi, {
            width: context.width,
            height: context.height,
            resolution: context.resolution,
            theme: context.theme,
            metadata: toSongMetadata(context.metadata),
            tuning: context.tuning,
            textures: context.textures,
            icons: context.icons
        });
        this.holder.addChild(this.credits.view);
        this.holder.pivot.set(context.width / 2, context.height / 2);
    }
    update(time, frame, width, height) {
        const credits = this.credits;
        this.holder.visible = Boolean(credits) && frame.active && frame.posterAlpha > 0.002;
        if (!credits || !this.holder.visible) return;
        this.holder.alpha = frame.posterAlpha;
        this.holder.position.set(width / 2, height / 2 + frame.posterOffsetY * height);
        this.holder.scale.set(frame.posterScale);
        credits.update(time - this.lyricEndTime);
    }
    invalidate() {
        if (!this.credits) return;
        const credits = this.credits;
        this.credits = null;
        this.holder.removeChild(credits.view);
        credits.destroy();
        this.holder.visible = false;
    }
    destroy() {
        this.invalidate();
        this.holder.destroy({
            children: true
        });
    }
}
