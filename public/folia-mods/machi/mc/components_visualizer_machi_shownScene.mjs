/* 移植自 Folia components/visualizer/machi/shownScene.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const shown = new Map();
const listeners = new Set();
const notify = ()=>listeners.forEach((listener)=>listener());
export const reportMachiShownScene = (owner, id)=>{
    if (shown.get(owner) === id) return;
    shown.set(owner, id);
    notify();
};
export const withdrawMachiShownScene = (owner)=>{
    if (shown.delete(owner)) notify();
};
export const subscribeMachiShownScene = (listener)=>{
    listeners.add(listener);
    return ()=>{
        listeners.delete(listener);
    };
};
export const getMachiShownScene = ()=>{
    let latest = null;
    shown.forEach((id)=>{
        latest = id;
    });
    return latest;
};
