/* 移植自 Folia components/visualizer/pixi/pixiFilterPoolCompat.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const PATCHED = Symbol.for('folia.pixi821FilterPoolCompat');
export const installPixiFilterPoolCompat = (pixi)=>{
    if (pixi.VERSION !== '8.21.0') return;
    const prototype = pixi.FilterSystem.prototype;
    if (prototype[PATCHED]) return;
    prototype[PATCHED] = true;
    const groups = new Set();
    const pool = pixi.TexturePool;
    const unbindPassTextures = ()=>{
        const source = pixi.Texture.EMPTY.source;
        groups.forEach((group)=>{
            group.setResource(source, 1);
            group.setResource(source.style, 2);
            group.setResource(source, 3);
        });
    };
    const init = prototype.init;
    prototype.init = function() {
        init?.call(this);
        groups.add(this._globalFilterBindGroup);
    };
    const destroy = prototype.destroy;
    prototype.destroy = function() {
        groups.delete(this._globalFilterBindGroup);
        this._globalFilterBindGroup.destroy();
        destroy.call(this);
    };
    const push = prototype.push;
    prototype.push = function(instruction) {
        const entry = this._filterStack[this._filterStackIndex];
        if (entry) entry.inputTexture = null;
        push.call(this, instruction);
    };
    const dropTextures = pool._dropTextures;
    pool._dropTextures = function(textures, shouldDestroy) {
        if (shouldDestroy && textures.length > 0) unbindPassTextures();
        dropTextures.call(this, textures, shouldDestroy);
    };
    const returnTexture = pool.returnTexture;
    pool.returnTexture = function(texture, resetStyle) {
        const key = this._poolKey[texture.uid];
        if (key !== undefined && !this._buckets.has(key)) unbindPassTextures();
        returnTexture.call(this, texture, resetStyle);
    };
};
