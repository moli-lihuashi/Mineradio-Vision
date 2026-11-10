/* 移植自 Folia components/visualizer/machi/engine/camera.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
import * as THREE from '../../../vendor/folia/three/three.module.js';
import { OrbitControls } from '../../../vendor/folia/three/examples/jsm/controls/OrbitControls.js';
const DEG = Math.PI / 180;
export const MACHI_CAMERA_LIMITS = {
    azimuthRange: 75 * DEG,
    minElevation: 20 * DEG,
    maxElevation: 70 * DEG,
    minZoom: 0.75,
    maxZoom: 3.6,
    pan: 5,
    idleReturnSeconds: 8
};
const DRIFT_RAMP_SECONDS = 4;
export const resolveMachiDrift = (time)=>{
    const wave = (period, phase)=>Math.sin(time / period * Math.PI * 2 + phase);
    return {
        azimuth: 15 * wave(67, 0) + 5 * wave(29, 1.3),
        elevation: 4 * wave(47, 0.7),
        zoom: Math.exp(0.08 * wave(41, 2.1)),
        panX: 0.45 * wave(53, 0.4),
        panZ: 0.3 * wave(71, 2.6)
    };
};
const MARGIN = 0.02;
const SUBTITLE_RESERVE = 0.05;
const CAMERA_DISTANCE = 60;
const CROP_FROM_BOTTOM = 0.85;
const orbitDirection = (azimuth, elevation)=>new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
const clamp = (value, min, max)=>Math.min(max, Math.max(min, value));
const sameView = (a, b)=>a === b || !!a && !!b && Math.abs(a.azimuth - b.azimuth) < 1e-4 && Math.abs(a.elevation - b.elevation) < 1e-4 && Math.abs(a.zoom - b.zoom) < 1e-5 && Math.abs(a.panX - b.panX) < 1e-4 && Math.abs(a.panZ - b.panZ) < 1e-4;
export class MachiCamera {
    camera;
    controls = null;
    base = new THREE.Vector3();
    target = new THREE.Vector3();
    framing = {
        points: [
            new THREE.Vector3()
        ],
        view: {
            azimuth: 45 * DEG,
            elevation: 31 * DEG,
            zoom: 1
        }
    };
    fitCenter = new THREE.Vector3();
    fitUp = new THREE.Vector3();
    halfHeight = 8;
    fitHalf = {
        width: 9,
        height: 7
    };
    aspect = 16 / 9;
    custom = null;
    interacting = false;
    idleSince = 0;
    returning = false;
    commitPending = false;
    spherical = new THREE.Spherical();
    motion = false;
    motionSpeed = 1;
    motionTime = 0;
    motionWeight = 0;
    needsRender = true;
    onCommit = null;
    onWake = null;
    constructor(){
        this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200);
        this.camera.name = 'Camera';
    }
    get defaultView() {
        return this.framing.view;
    }
    setFraming(framing, custom) {
        this.framing = framing;
        this.custom = custom;
        this.interacting = false;
        this.returning = false;
        this.commitPending = false;
        this.idleSince = 0;
        this.fitDefault();
        this.applyLimits();
        this.settle();
    }
    setMotion(motion, speed = 1) {
        this.motionSpeed = speed;
        if (motion === this.motion) return;
        this.motion = motion;
        this.needsRender = true;
    }
    setCustom(view) {
        if (sameView(view, this.custom)) return;
        const adopt = view !== null && this.custom === null && this.controls !== null && (this.idleSince > 0 || this.returning);
        this.custom = view;
        this.returning = false;
        this.idleSince = 0;
        this.commitPending = false;
        if (adopt) {
            this.custom = this.offset();
            this.onCommit?.(this.custom);
            return;
        }
        if (this.interacting) return;
        if (view === null && this.controls) {
            this.returning = true;
            this.needsRender = true;
            return;
        }
        this.settle();
    }
    fitDefault() {
        const { view } = this.framing;
        const direction = orbitDirection(view.azimuth, view.elevation);
        const forward = direction.clone().negate();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        let minR = Infinity;
        let maxR = -Infinity;
        let minU = Infinity;
        let maxU = -Infinity;
        this.framing.points.forEach((point)=>{
            const r = point.dot(right);
            const u = point.dot(up);
            minR = Math.min(minR, r);
            maxR = Math.max(maxR, r);
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
        });
        const centerR = (minR + maxR) / 2;
        const centerU = (minU + maxU) / 2;
        this.fitUp.copy(up);
        this.fitCenter.copy(right.multiplyScalar(centerR)).add(up.clone().multiplyScalar(centerU));
        this.fitHalf = {
            width: (maxR - minR) / 2,
            height: (maxU - minU) / 2
        };
        this.applyFrustum();
    }
    applyFrustum() {
        const usable = 1 - MARGIN * 2 - SUBTITLE_RESERVE;
        const halfHeight = Math.max(this.fitHalf.height, this.fitHalf.width / this.aspect) / usable;
        this.halfHeight = halfHeight;
        const overflow = Math.max(0, this.fitHalf.height / usable - halfHeight / this.framing.view.zoom);
        const view = this.view();
        const pan = this.target.clone().sub(this.base);
        this.base.copy(this.fitCenter).addScaledVector(this.fitUp, overflow * (CROP_FROM_BOTTOM - 0.5) * 2);
        this.place(view, this.base.clone().add(pan));
        const shift = halfHeight * SUBTITLE_RESERVE;
        this.camera.left = -halfHeight * this.aspect;
        this.camera.right = halfHeight * this.aspect;
        this.camera.top = halfHeight - shift;
        this.camera.bottom = -halfHeight - shift;
        this.camera.updateProjectionMatrix();
        this.needsRender = true;
    }
    setAspect(width, height) {
        const aspect = width / Math.max(1, height);
        if (Math.abs(aspect - this.aspect) < 1e-4) return;
        this.aspect = aspect;
        this.applyFrustum();
    }
    axes() {
        const azimuth = this.framing.view.azimuth;
        return {
            right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
            back: new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth))
        };
    }
    restView() {
        const home = this.framing.view;
        const custom = this.custom;
        if (!custom) return home;
        return {
            azimuth: home.azimuth + custom.azimuth * DEG,
            elevation: clamp(home.elevation + custom.elevation * DEG, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
            zoom: clamp(home.zoom * custom.zoom, MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom)
        };
    }
    restTarget(extraX = 0, extraZ = 0) {
        const custom = this.custom;
        if (!custom && extraX === 0 && extraZ === 0) return this.base.clone();
        const { right, back } = this.axes();
        const limit = MACHI_CAMERA_LIMITS.pan;
        const x = clamp((custom?.panX ?? 0) + extraX, -limit, limit);
        const z = clamp((custom?.panZ ?? 0) + extraZ, -limit, limit);
        return this.base.clone().addScaledVector(right, x).addScaledVector(back, z);
    }
    settle() {
        const rest = this.restView();
        const weight = this.motionWeight * this.motionWeight * (3 - 2 * this.motionWeight);
        if (weight <= 0) {
            this.place(rest, this.restTarget());
            return;
        }
        const drift = resolveMachiDrift(this.motionTime);
        const home = this.framing.view.azimuth;
        const range = MACHI_CAMERA_LIMITS.azimuthRange;
        const panScale = weight * Math.min(1, this.framing.view.zoom / rest.zoom);
        this.place({
            azimuth: clamp(rest.azimuth + drift.azimuth * DEG * weight, home - range, home + range),
            elevation: clamp(rest.elevation + drift.elevation * DEG * weight, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
            zoom: clamp(rest.zoom * drift.zoom ** weight, MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom)
        }, this.restTarget(drift.panX * panScale, drift.panZ * panScale));
    }
    offset() {
        const home = this.framing.view;
        const view = this.view();
        const pan = this.target.clone().sub(this.base);
        const { right, back } = this.axes();
        return {
            azimuth: (view.azimuth - home.azimuth) / DEG,
            elevation: (view.elevation - home.elevation) / DEG,
            zoom: view.zoom / home.zoom,
            panX: pan.dot(right),
            panZ: pan.dot(back)
        };
    }
    place(view, target) {
        this.target.copy(target);
        this.controls?.target.copy(target);
        this.camera.position.copy(target).addScaledVector(orbitDirection(view.azimuth, view.elevation), CAMERA_DISTANCE);
        this.camera.zoom = view.zoom;
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.controls?.update();
        this.needsRender = true;
    }
    placeAt(view) {
        this.place(view, this.target);
    }
    placeAtRest() {
        this.settle();
    }
    view() {
        this.spherical.setFromVector3(this.camera.position.clone().sub(this.target));
        return {
            azimuth: this.spherical.theta,
            elevation: Math.PI / 2 - this.spherical.phi,
            zoom: this.camera.zoom
        };
    }
    attach(element) {
        if (this.controls) return;
        const controls = new OrbitControls(this.camera, element);
        controls.target.copy(this.target);
        controls.enablePan = true;
        controls.screenSpacePanning = false;
        controls.panSpeed = 0.8;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.55;
        controls.zoomSpeed = 0.8;
        controls.minPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.maxElevation;
        controls.maxPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.minElevation;
        controls.minZoom = MACHI_CAMERA_LIMITS.minZoom;
        controls.maxZoom = MACHI_CAMERA_LIMITS.maxZoom;
        controls.addEventListener('start', this.onStart);
        controls.addEventListener('end', this.onEnd);
        controls.addEventListener('change', this.onChange);
        this.controls = controls;
        this.applyLimits();
        controls.update();
    }
    applyLimits() {
        if (!this.controls) return;
        this.controls.minAzimuthAngle = this.framing.view.azimuth - MACHI_CAMERA_LIMITS.azimuthRange;
        this.controls.maxAzimuthAngle = this.framing.view.azimuth + MACHI_CAMERA_LIMITS.azimuthRange;
    }
    onStart = ()=>{
        this.interacting = true;
        this.motionWeight = 0;
        this.returning = false;
        this.commitPending = false;
        this.onWake?.();
    };
    onEnd = ()=>{
        this.interacting = false;
        if (this.custom) this.commitPending = true;
        else this.idleSince = performance.now();
    };
    onChange = ()=>{
        this.target.copy(this.controls.target);
        this.needsRender = true;
        this.onWake?.();
    };
    clampPan() {
        const controls = this.controls;
        const pan = controls.target.clone().sub(this.base);
        const { right, back } = this.axes();
        const limit = MACHI_CAMERA_LIMITS.pan;
        const x = pan.dot(right);
        const z = pan.dot(back);
        if (Math.abs(x) <= limit && Math.abs(z) <= limit && Math.abs(pan.y) < 1e-6) return;
        const next = this.base.clone().addScaledVector(right, clamp(x, -limit, limit)).addScaledVector(back, clamp(z, -limit, limit));
        this.camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
        this.target.copy(next);
    }
    get still() {
        return !this.interacting && !this.returning && !this.commitPending && this.idleSince === 0;
    }
    get ramping() {
        return this.motion ? this.still && this.motionWeight < 1 : this.motionWeight > 0;
    }
    get busy() {
        return this.interacting || this.returning || this.commitPending || this.needsRender || this.ramping;
    }
    update(realDelta, ambientDelta) {
        const controls = this.controls;
        if (!controls) {
            this.stepMotion(realDelta, ambientDelta);
            return;
        }
        const home = this.framing.view;
        if (!this.custom && !this.interacting && !this.returning && this.idleSince > 0 && performance.now() - this.idleSince > MACHI_CAMERA_LIMITS.idleReturnSeconds * 1000) {
            const view = this.view();
            const off = Math.abs(view.azimuth - home.azimuth) + Math.abs(view.elevation - home.elevation) + Math.abs(view.zoom - home.zoom) + this.target.distanceTo(this.base);
            this.returning = off > 1e-3;
            this.idleSince = 0;
        }
        if (this.returning) {
            const view = this.view();
            const rest = this.restView();
            const k = 1 - Math.exp(-realDelta * 1.6);
            const next = {
                azimuth: view.azimuth + (rest.azimuth - view.azimuth) * k,
                elevation: view.elevation + (rest.elevation - view.elevation) * k,
                zoom: view.zoom + (rest.zoom - view.zoom) * k
            };
            const restTarget = this.restTarget();
            const target = this.target.clone().lerp(restTarget, k);
            const done = Math.abs(next.azimuth - rest.azimuth) < 2e-4 && Math.abs(next.elevation - rest.elevation) < 2e-4 && Math.abs(next.zoom - rest.zoom) < 2e-4 && target.distanceTo(restTarget) < 2e-3;
            this.place(done ? rest : next, done ? restTarget : target);
            if (done) this.returning = false;
        }
        this.stepMotion(realDelta, ambientDelta);
        this.clampPan();
        const moved = controls.update();
        if (moved) this.target.copy(controls.target);
        if (this.commitPending && !this.interacting && !moved) {
            this.commitPending = false;
            this.custom = this.offset();
            this.onCommit?.(this.custom);
        }
    }
    stepMotion(realDelta, ambientDelta) {
        if (!this.still) {
            this.motionWeight = 0;
            return;
        }
        if (this.motion) this.motionTime += ambientDelta * this.motionSpeed;
        const weight = this.motionWeight;
        const step = realDelta / DRIFT_RAMP_SECONDS;
        this.motionWeight = this.motion ? Math.min(1, weight + step) : Math.max(0, weight - step);
        if (weight > 0 || this.motionWeight > 0) {
            if (this.motionWeight !== weight || this.motion && ambientDelta > 0) this.settle();
        }
    }
    rendered() {
        this.needsRender = false;
    }
    get focusDistance() {
        return this.camera.position.distanceTo(this.target);
    }
    depthOf(point) {
        const forward = this.target.clone().sub(this.camera.position).normalize();
        return point.clone().sub(this.camera.position).dot(forward);
    }
    get frustumHalfHeight() {
        return this.halfHeight / this.camera.zoom;
    }
    dispose() {
        if (!this.controls) return;
        this.controls.removeEventListener('start', this.onStart);
        this.controls.removeEventListener('end', this.onEnd);
        this.controls.removeEventListener('change', this.onChange);
        this.controls.dispose();
        this.controls = null;
    }
}
