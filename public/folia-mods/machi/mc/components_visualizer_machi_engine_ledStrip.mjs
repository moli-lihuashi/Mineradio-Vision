/* 移植自 Folia components/visualizer/machi/engine/ledStrip.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { createCanvas, paintMachiLedStrip } from './components_visualizer_machi_engine_signRaster.mjs';
const TEXTURE = {
    width: 4096,
    height: 96
};
const VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uLed;
uniform float uScroll;
uniform float uUsed;
uniform float uWindow;
uniform float uDots;
uniform float uAspect;
uniform float uBright;
varying vec2 vUv;
void main() {
    vec2 grid = vec2(floor(uDots * uAspect), uDots);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid) - 0.5;
    vec2 sampleUv = (cell + 0.5) / grid;
    float u = fract(uScroll + sampleUv.x * uWindow) * uUsed;
    float a = texture2D(uMap, vec2(u, sampleUv.y)).r;
    float dotMask = 1.0 - smoothstep(0.28, 0.42, length(f));
    vec3 off = vec3(0.025, 0.022, 0.03);
    vec3 color = mix(off, mix(uLed * 0.08, uLed * 2.2, a) * uBright, dotMask);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;
export class MachiLedStrip {
    blend;
    width;
    height;
    colorKey;
    material;
    canvas = createCanvas(TEXTURE.width, TEXTURE.height);
    texture;
    geometries = [];
    text = '';
    scroll = 0;
    constructor(materials, blend, width, height, dots = 18, colorKey = 'led'){
        this.blend = blend;
        this.width = width;
        this.height = height;
        this.colorKey = colorKey;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.NoColorSpace;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uMap: {
                    value: this.texture
                },
                uLed: {
                    value: new THREE.Color()
                },
                uScroll: {
                    value: 0
                },
                uUsed: {
                    value: 1
                },
                uWindow: {
                    value: 0.3
                },
                uDots: {
                    value: dots
                },
                uAspect: {
                    value: width / height
                },
                uBright: {
                    value: 1
                }
            }
        }));
        this.material.name = 'machi:led';
    }
    createFace(position, rotationY, name) {
        const geometry = new THREE.PlaneGeometry(this.width, this.height);
        this.geometries.push(geometry);
        const face = new THREE.Mesh(geometry, this.material);
        face.name = name;
        face.position.copy(position);
        face.rotation.y = rotationY;
        return face;
    }
    setText(text, font) {
        if (text === this.text) return;
        this.text = text;
        const used = paintMachiLedStrip(this.canvas, font, text);
        this.texture.needsUpdate = true;
        const uniforms = this.material.uniforms;
        uniforms.uUsed.value = used / TEXTURE.width;
        const dots = uniforms.uDots.value;
        const aspect = uniforms.uAspect.value;
        uniforms.uWindow.value = Math.min(4, Math.floor(dots * aspect) * (TEXTURE.height / dots) / Math.max(1, used));
    }
    invalidate() {
        this.text = '';
    }
    get hasText() {
        return this.text !== '';
    }
    update(frame) {
        const speed = (frame.staticMode ? 0 : 70) * frame.speed;
        const used = this.material.uniforms.uUsed.value * TEXTURE.width;
        this.scroll = (this.scroll + frame.delta * speed / Math.max(1, used)) % 1;
        this.material.uniforms.uScroll.value = this.scroll;
        this.material.uniforms.uLed.value.copy(this.blend.get(this.colorKey));
        this.material.uniforms.uBright.value = 0.9 + 0.2 * frame.audio;
    }
    dispose() {
        this.texture.dispose();
        this.geometries.forEach((geometry)=>geometry.dispose());
    }
}
