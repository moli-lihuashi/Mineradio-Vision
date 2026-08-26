// ============================================================
//  相机系统 v7.1 — 分离 user offset / cinema offset
//   - userOrbit: 用户拖拽的目标 (永久保留, 不会被电影模式覆盖)
//   - cinemaOffset: 电影模式的微偏移 (始终叠加, 即使用户在拖)
//   - 最终 theta = userOrbit.theta + cinemaOffset.theta
//   - 回正按钮 / 双击屏幕: 让 userOrbit 缓慢归零
// ============================================================
var orbit = {
  userTheta: 0.0, userPhi: 0.08, userRadius: 6.6,
  cineTheta: 0.0, cinePhi: 0.0, cineRadius: 0.0,
  theta: 0.0, phi: 0.08, radius: 6.6,
  minPhi: -Math.PI*0.45, maxPhi: Math.PI*0.45,
  minRadius: 2.4, maxRadius: 14.0,
  baselineTheta: 0.0, baselinePhi: 0.08, baselineRadius: 6.6,
  rotating: false, last:{x:0,y:0},
  recentering: false,
  centerLocked: false,
  // v8: 镜头跟拍 (hover shelf / queue 时)
  lookAt: new THREE.Vector3(0,0,0),
  focus: {
    active: false,
    type: null,        // 'shelf-side' | 'shelf-stage' | 'queue'
    theta: 0.0, phi: 0.08, radius: 6.6,
    lookAt: new THREE.Vector3(0,0,0),
  },
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  beatGlow: 0,
};
var ZERO_VEC = new THREE.Vector3(0,0,0);
var BASE_FOV = 45;
var camPunch = 0;
var cinemaT = 0;
function defaultFreeCameraState() {
  return {
    active: false,
    locked: false,
    position: new THREE.Vector3(0, 0, 6.6),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV,
    velocity: new THREE.Vector3(),
    keys: {},
    resetTween: null
  };
}
function readFreeCameraState() {
  var state = defaultFreeCameraState();
  try {
    var raw = JSON.parse(localStorage.getItem(FREE_CAMERA_STORE_KEY) || '{}') || {};
    if (raw.position) {
      state.position.set(
        clampRange(Number(raw.position.x) || 0, -80, 80),
        clampRange(Number(raw.position.y) || 0, -80, 80),
        clampRange(Number(raw.position.z) || 6.6, -80, 80)
      );
    }
    state.yaw = clampRange(Number(raw.yaw) || 0, -Math.PI * 8, Math.PI * 8);
    state.pitch = clampRange(Number(raw.pitch) || 0, -Math.PI * 0.49, Math.PI * 0.49);
    state.roll = clampRange(Number(raw.roll) || 0, -Math.PI, Math.PI);
    state.fov = clampRange(Number(raw.fov) || BASE_FOV, 26, 72);
    state.locked = !!(raw.locked || raw.active);
    state.active = false;
  } catch (e) {}
  return state;
}
var freeCamera = readFreeCameraState();
var FREE_CAMERA_MOVE = new THREE.Vector3();
var FREE_CAMERA_TARGET_VEL = new THREE.Vector3();
var FREE_CAMERA_SHAKE_DIR = new THREE.Vector3();
var FREE_CAMERA_EULER = new THREE.Euler(0, 0, 0, 'YXZ');
var FREE_CAMERA_RESET_MAT = new THREE.Matrix4();
var FREE_CAMERA_RESET_QUAT = new THREE.Quaternion();
var FREE_CAMERA_UP = new THREE.Vector3(0, 1, 0);
var freeCameraPointer = { seen: false, x: 0, y: 0 };
var freeCameraDeferredSaveTimer = 0;
function saveFreeCameraState() {
  if (!freeCamera) return;
  try {
    localStorage.setItem(FREE_CAMERA_STORE_KEY, JSON.stringify({
      locked: !!freeCamera.locked,
      active: !!freeCamera.active,
      position: { x: freeCamera.position.x, y: freeCamera.position.y, z: freeCamera.position.z },
      yaw: freeCamera.yaw,
      pitch: freeCamera.pitch,
      roll: freeCamera.roll,
      fov: freeCamera.fov
    }));
  } catch (e) {}
}
function scheduleFreeCameraStateSave(delay) {
  if (freeCameraDeferredSaveTimer) return;
  freeCameraDeferredSaveTimer = setTimeout(function(){
    freeCameraDeferredSaveTimer = 0;
    saveFreeCameraState();
  }, delay || 720);
}
function easeOutCubic01(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
function getDefaultFreeCameraResetPose() {
  var pose = {
    position: new THREE.Vector3(0, 0, 6.6),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV
  };
  if (typeof SKULL_PRESET_INDEX !== 'undefined' && fx && fx.preset === SKULL_PRESET_INDEX && typeof setSkullCameraTargetVectors === 'function') {
    var look = new THREE.Vector3();
    var shelfComposition = typeof isSkullShelfCompositionActive === 'function' && isSkullShelfCompositionActive();
    setSkullCameraTargetVectors(pose.position, look, innerHeight > innerWidth * 1.08, shelfComposition, 0);
    FREE_CAMERA_RESET_MAT.lookAt(pose.position, look, FREE_CAMERA_UP);
    FREE_CAMERA_RESET_QUAT.setFromRotationMatrix(FREE_CAMERA_RESET_MAT);
    FREE_CAMERA_EULER.setFromQuaternion(FREE_CAMERA_RESET_QUAT, 'YXZ');
    pose.pitch = FREE_CAMERA_EULER.x;
    pose.yaw = FREE_CAMERA_EULER.y;
    pose.roll = FREE_CAMERA_EULER.z;
  }
  return pose;
}
function captureFreeCameraFromCurrent() {
  if (!freeCamera) freeCamera = defaultFreeCameraState();
  camera.updateMatrixWorld(true);
  freeCamera.position.copy(camera.position);
  FREE_CAMERA_EULER.setFromQuaternion(camera.quaternion, 'YXZ');
  freeCamera.pitch = FREE_CAMERA_EULER.x;
  freeCamera.yaw = FREE_CAMERA_EULER.y;
  freeCamera.roll = FREE_CAMERA_EULER.z;
  freeCamera.fov = clampRange(camera.fov || BASE_FOV, 26, 72);
}
function applyFreeCameraToCamera() {
  if (!freeCamera || !(freeCamera.active || freeCamera.locked)) return false;
  var cameraShake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  camera.position.copy(freeCamera.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    freeCamera.pitch + beatCam.phiKick * cameraShake * 0.45,
    freeCamera.yaw + beatCam.thetaKick * cameraShake * 0.45,
    freeCamera.roll + beatCam.rollKick * cameraShake
  );
  if (cameraShake > 0 && Math.abs(beatCam.radiusKick) > 0.0001) {
    FREE_CAMERA_SHAKE_DIR.set(0, 0, -1).applyEuler(camera.rotation);
    camera.position.addScaledVector(FREE_CAMERA_SHAKE_DIR, beatCam.radiusKick * cameraShake * 0.52);
  }
  var cameraPunch = Math.max(camPunch * 0.55, beatCam.punch * 0.54 + beatCam.radiusKick * 0.16) * cameraShake;
  var targetFov = clampRange(freeCamera.fov || BASE_FOV, 26, 72) - cameraPunch * 1.75;
  camera.fov += (targetFov - camera.fov) * (targetFov < camera.fov ? 0.24 : 0.12);
  camera.updateProjectionMatrix();
  camPunch *= 0.86;
  return true;
}
function updateFreeCameraHint() {
  var el = document.getElementById('free-camera-hint');
  if (el) el.classList.toggle('show', !!(freeCamera && freeCamera.active));
}
function resetFreeCameraToDefault() {
  if (!freeCamera) return;
  if (freeCameraDeferredSaveTimer) {
    clearTimeout(freeCameraDeferredSaveTimer);
    freeCameraDeferredSaveTimer = 0;
  }
  var fromPos = freeCamera.position ? freeCamera.position.clone() : new THREE.Vector3(0, 0, 6.6);
  var resetPose = getDefaultFreeCameraResetPose();
  freeCamera.resetTween = {
    start: performance.now(),
    duration: 620,
    from: {
      position: fromPos,
      yaw: Number(freeCamera.yaw) || 0,
      pitch: Number(freeCamera.pitch) || 0,
      roll: Number(freeCamera.roll) || 0,
      fov: Number(freeCamera.fov) || BASE_FOV
    },
    to: {
      position: resetPose.position,
      yaw: resetPose.yaw,
      pitch: resetPose.pitch,
      roll: resetPose.roll,
      fov: resetPose.fov
    }
  };
  freeCamera.active = false;
  freeCamera.locked = true;
  freeCamera.keys = {};
  if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
  try { if (document.pointerLockElement === renderer.domElement) document.exitPointerLock(); } catch (e) {}
  updateFreeCameraHint();
  showToast('自由镜头正在平滑回正');
}
function toggleFreeCamera() {
  if (!freeCamera) freeCamera = defaultFreeCameraState();
  if (freeCamera.active) {
    freeCamera.active = false;
    freeCamera.locked = true;
    freeCamera.keys = {};
    if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
    try { if (document.pointerLockElement === renderer.domElement) document.exitPointerLock(); } catch (e) {}
    saveFreeCameraState();
    updateFreeCameraHint();
    showToast('自由镜头已固定');
    return;
  }
  captureFreeCameraFromCurrent();
  freeCamera.active = true;
  freeCamera.locked = true;
  freeCamera.resetTween = null;
  freeCamera.keys = {};
  freeCameraPointer.seen = false;
  if (!freeCamera.velocity) freeCamera.velocity = new THREE.Vector3();
  try { renderer.domElement.focus && renderer.domElement.focus({ preventScroll: true }); } catch (e) {
    try { renderer.domElement.focus && renderer.domElement.focus(); } catch (ignore) {}
  }
  saveFreeCameraState();
  updateFreeCameraHint();
  try {
    var lockResult = renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
    if (lockResult && lockResult.catch) lockResult.catch(function(){ freeCameraPointer.seen = false; });
  } catch (e) {
    freeCameraPointer.seen = false;
  }
  showToast('自由镜头: WASD 移动 · 鼠标转向 · K 回正');
}
function updateFreeCamera(dt) {
  if (!freeCamera) return;
  if (freeCamera.resetTween) {
    var tw = freeCamera.resetTween;
    var t = easeOutCubic01((performance.now() - tw.start) / Math.max(1, tw.duration || 620));
    freeCamera.position.copy(tw.from.position).lerp(tw.to.position, t);
    freeCamera.yaw = tw.from.yaw + shortestAngleDelta(tw.from.yaw, tw.to.yaw) * t;
    freeCamera.pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * t;
    freeCamera.roll = tw.from.roll + shortestAngleDelta(tw.from.roll, tw.to.roll) * t;
    freeCamera.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * t;
    if (t >= 0.999) {
      freeCamera.position.copy(tw.to.position);
      freeCamera.yaw = tw.to.yaw;
      freeCamera.pitch = tw.to.pitch;
      freeCamera.roll = tw.to.roll;
      freeCamera.fov = tw.to.fov;
      freeCamera.resetTween = null;
      freeCamera.active = false;
      freeCamera.locked = false;
      saveFreeCameraState();
      updateFreeCameraHint();
      recenterCamera();
      showToast('自由镜头已回正');
    }
    return;
  }
  if (!freeCamera.active) return;
  var keys = freeCamera.keys || {};
  FREE_CAMERA_MOVE.set(0, 0, 0);
  if (keys.KeyW) FREE_CAMERA_MOVE.z -= 1;
  if (keys.KeyS) FREE_CAMERA_MOVE.z += 1;
  if (keys.KeyA) FREE_CAMERA_MOVE.x -= 1;
  if (keys.KeyD) FREE_CAMERA_MOVE.x += 1;
  if (keys.Space) FREE_CAMERA_MOVE.y += 1;
  if (keys.ControlLeft || keys.ControlRight) FREE_CAMERA_MOVE.y -= 1;
  if (!freeCamera.velocity) freeCamera.velocity = new THREE.Vector3();
  var targetVel = FREE_CAMERA_TARGET_VEL.set(0, 0, 0);
  if (FREE_CAMERA_MOVE.lengthSq() > 0) {
    FREE_CAMERA_MOVE.normalize();
    FREE_CAMERA_EULER.set(freeCamera.pitch, freeCamera.yaw, 0, 'YXZ');
    FREE_CAMERA_MOVE.applyEuler(FREE_CAMERA_EULER);
    var speed = (keys.ShiftLeft || keys.ShiftRight ? 6.2 : 2.35);
    targetVel.copy(FREE_CAMERA_MOVE).multiplyScalar(speed);
  }
  var ease = targetVel.lengthSq() > 0 ? 8.2 : 13.5;
  freeCamera.velocity.lerp(targetVel, clampRange(ease * Math.max(0.001, dt || 1 / 60), 0, 1));
  if (freeCamera.velocity.lengthSq() < 0.0004) freeCamera.velocity.set(0, 0, 0);
  freeCamera.position.addScaledVector(freeCamera.velocity, Math.max(0.001, dt || 1 / 60));
  var rollDir = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  if (rollDir) freeCamera.roll = clampRange(freeCamera.roll + rollDir * dt * 0.9, -Math.PI, Math.PI);
  scheduleFreeCameraStateSave(720);
}
