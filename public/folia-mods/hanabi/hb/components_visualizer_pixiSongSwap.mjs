/* 移植自 Folia components/visualizer/pixiSongSwap.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export class PixiSongSwap {
    hooks;
    pending = null;
    constructor(hooks){
        this.hooks = hooks;
    }
    get active() {
        return this.pending !== null;
    }
    get song() {
        return this.pending?.song ?? null;
    }
    get staged() {
        return this.pending?.staged ?? null;
    }
    dropStaged() {
        const pending = this.pending;
        if (!pending?.staged) return;
        this.hooks.discard(pending.staged);
        pending.staged = null;
    }
    begin(song, signal) {
        return new Promise((resolve)=>{
            const onAbort = ()=>this.settle(true);
            this.pending = {
                song,
                staged: null,
                prepared: false,
                settle: resolve,
                detachAbort: ()=>signal?.removeEventListener('abort', onAbort)
            };
            signal?.addEventListener('abort', onAbort, {
                once: true
            });
        });
    }
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
    settle(commit) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        pending.detachAbort();
        if (commit) this.hooks.commit(pending.song, pending.staged);
        else if (pending.staged) this.hooks.discard(pending.staged);
        pending.settle();
    }
}
