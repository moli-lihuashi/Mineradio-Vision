/* 移植自 Folia components/visualizer/pixiSceneCache.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export class PixiSceneCache {
    hooks;
    scenes = new Map();
    retired = [];
    constructor(hooks){
        this.hooks = hooks;
    }
    get size() {
        return this.scenes.size;
    }
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
    ensure(index) {
        if (index < 0 || index >= this.hooks.count()) return null;
        const cached = this.scenes.get(index);
        if (cached) return cached;
        const scene = this.hooks.build(index);
        this.scenes.set(index, scene);
        return scene;
    }
    adopt(index, scene) {
        this.scenes.set(index, scene);
    }
    prune(index, keep) {
        this.scenes.forEach((scene, sceneIndex)=>{
            if (Math.abs(sceneIndex - index) <= 1 || keep?.has(sceneIndex)) return;
            this.hooks.destroy(scene);
            this.scenes.delete(sceneIndex);
        });
    }
    clear() {
        this.scenes.forEach((scene)=>this.hooks.destroy(scene));
        this.scenes.clear();
    }
    retireAll() {
        this.scenes.forEach((scene)=>{
            this.hooks.detach?.(scene);
            this.retired.push(scene);
        });
        this.scenes.clear();
    }
    drainRetired() {
        const scene = this.retired.shift();
        if (scene === undefined) return false;
        this.hooks.destroy(scene);
        return true;
    }
    destroyAll() {
        this.clear();
        this.retired.forEach((scene)=>this.hooks.destroy(scene));
        this.retired.length = 0;
    }
}
