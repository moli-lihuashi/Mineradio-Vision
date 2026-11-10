/* 移植自 Folia components/visualizer/machi/cameraControls.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { times } from './_stubs.mjs';
import { MACHI_APERTURE_STOPS } from './components_visualizer_machi_types.mjs';
export const MACHI_CAMERA_LABEL_KEYS = {
    default: 'options.machiCameraDefault',
    custom: 'options.machiCameraCustom'
};
export const MACHI_FOCUS_LABEL_KEYS = {
    center: 'options.machiFocusCenter',
    lyrics: 'options.machiFocusLyrics',
    manual: 'options.machiFocusManual'
};
export const signedReadout = (unit, digits = 0)=>(value)=>{
        const text = Math.abs(value).toFixed(digits);
        const sign = Number(text) === 0 ? '' : value > 0 ? '+' : '−';
        return `${sign}${text}${unit}`;
    };
export const MACHI_VIEW_SLIDERS = [
    {
        key: 'azimuth',
        labelKey: 'options.machiViewAzimuth',
        step: 1,
        format: signedReadout('°')
    },
    {
        key: 'elevation',
        labelKey: 'options.machiViewElevation',
        step: 1,
        format: signedReadout('°')
    },
    {
        key: 'zoom',
        labelKey: 'options.machiViewZoom',
        step: 0.05,
        format: times
    },
    {
        key: 'panX',
        labelKey: 'options.machiViewPanX',
        step: 0.1,
        format: signedReadout(' m', 1)
    },
    {
        key: 'panZ',
        labelKey: 'options.machiViewPanZ',
        step: 0.1,
        format: signedReadout(' m', 1)
    }
];
const APERTURE_TRACK = [
    ...MACHI_APERTURE_STOPS
].reverse();
export const MACHI_APERTURE_TRACK_MAX = APERTURE_TRACK.length - 1;
export const machiApertureToTrack = (aperture)=>APERTURE_TRACK.reduce((best, stop, index)=>Math.abs(Math.log(stop / aperture)) < Math.abs(Math.log(APERTURE_TRACK[best] / aperture)) ? index : best, 0);
export const machiApertureFromTrack = (index)=>APERTURE_TRACK[Math.min(MACHI_APERTURE_TRACK_MAX, Math.max(0, Math.round(index)))];
export const apertureReadout = (aperture)=>`f/${aperture}`;
