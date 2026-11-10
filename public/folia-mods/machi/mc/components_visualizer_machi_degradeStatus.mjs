/* 移植自 Folia components/visualizer/machi/degradeStatus.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
const degraded = new Map();
const listeners = new Set();
const notify = ()=>listeners.forEach((listener)=>listener());
export const reportMachiDegrade = (owner, steps)=>{
    if (degraded.get(owner) === steps) return;
    degraded.set(owner, steps);
    notify();
};
export const withdrawMachiDegrade = (owner)=>{
    if (degraded.delete(owner)) notify();
};
export const subscribeMachiDegrade = (listener)=>{
    listeners.add(listener);
    return ()=>{
        listeners.delete(listener);
    };
};
export const getMachiDegrade = ()=>{
    let most = 0;
    degraded.forEach((steps)=>{
        most = Math.max(most, steps);
    });
    return most;
};
