/* 移植自 Folia components/visualizer/machi/engine/programWarmup.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
const POLL_MS = 12;
const GIVE_UP_MS = 8000;
export const yieldToMain = ()=>{
    const scheduler = globalThis.scheduler;
    if (typeof scheduler?.yield === 'function') return scheduler.yield();
    return new Promise((resolve)=>setTimeout(resolve, 0));
};
export const compileInto = (renderer, target, root, camera, lightsFrom, only)=>{
    const subject = only ? {
        traverse: (visit)=>root.traverse((object)=>{
                if (only(object)) visit(object);
            }),
        traverseVisible: ()=>{}
    } : root;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
        renderer.compile(subject, camera, lightsFrom);
    } finally{
        renderer.setRenderTarget(previous);
    }
};
const programsOf = (renderer)=>renderer.info.programs ?? [];
const checkedPrograms = new WeakSet();
export const reportBrokenPrograms = (renderer)=>{
    if (renderer.debug.checkShaderErrors) return;
    const gl = renderer.getContext();
    programsOf(renderer).forEach((entry)=>{
        if (checkedPrograms.has(entry) || !entry.isReady()) return;
        checkedPrograms.add(entry);
        if (gl.getProgramParameter(entry.program, gl.LINK_STATUS)) return;
        const shaderLogs = (gl.getAttachedShaders(entry.program) ?? []).filter((shader)=>!gl.getShaderParameter(shader, gl.COMPILE_STATUS)).map((shader)=>gl.getShaderInfoLog(shader));
        console.error(`[Machi] shader program ${entry.name || entry.type} failed to link`, {
            link: gl.getProgramInfoLog(entry.program),
            shaders: shaderLogs
        });
    });
};
export const waitForPrograms = (renderer, signal)=>new Promise((resolve, reject)=>{
        const startedAt = performance.now();
        const check = ()=>{
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            if (programsOf(renderer).every((program)=>program.isReady())) {
                resolve();
                return;
            }
            if (performance.now() - startedAt > GIVE_UP_MS) {
                console.warn(`[Machi] shader programs still compiling after ${GIVE_UP_MS} ms, drawing anyway`);
                resolve();
                return;
            }
            setTimeout(check, POLL_MS);
        };
        check();
    });
