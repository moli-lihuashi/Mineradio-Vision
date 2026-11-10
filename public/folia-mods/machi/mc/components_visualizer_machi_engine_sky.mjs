/* 移植自 Folia components/visualizer/machi/engine/sky.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
export class MachiSky {
    texture;
    context;
    constructor(){
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        this.context = canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
    }
    paint(top, bottom) {
        const gradient = this.context.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, `#${top.getHexString()}`);
        gradient.addColorStop(1, `#${bottom.getHexString()}`);
        this.context.fillStyle = gradient;
        this.context.fillRect(0, 0, 4, 256);
        this.texture.needsUpdate = true;
    }
    dispose() {
        this.texture.dispose();
    }
}
