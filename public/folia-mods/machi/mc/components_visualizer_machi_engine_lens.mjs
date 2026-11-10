/* 移植自 Folia components/visualizer/machi/engine/lens.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const MACHI_BASE_COC = 0.012;
export const MACHI_REFERENCE_APERTURE = 8;
export const resolveMachiLens = (tuning, zoom)=>{
    const open = MACHI_REFERENCE_APERTURE / tuning.aperture;
    const depth = tuning.dofRange / Math.max(1e-3, zoom);
    return {
        focusBand: 3.4 * depth / open,
        focusFalloff: 7.5 * depth / Math.sqrt(open),
        coc: MACHI_BASE_COC * tuning.dof * open,
        tilt: MACHI_BASE_COC * Math.max(1, tuning.dof) * tuning.tiltShift
    };
};
