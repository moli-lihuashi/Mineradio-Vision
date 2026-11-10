/* 移植自 Folia components/visualizer/machi/scenes/index.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import { KONBINI_SCENE } from './components_visualizer_machi_scenes_konbini_konbiniScene.mjs';
import { KOWLOON_SCENE } from './components_visualizer_machi_scenes_kowloon_kowloonScene.mjs';
import { STATION_SCENE } from './components_visualizer_machi_scenes_station_stationScene.mjs';
export const MACHI_SCENES = {
    konbini: KONBINI_SCENE,
    station: STATION_SCENE,
    kowloon: KOWLOON_SCENE
};
