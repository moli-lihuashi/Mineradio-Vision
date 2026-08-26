// ============================================================
//  舞台歌词系统 v9 — Three.js 文字平面, 跟随专辑粒子 3D 运动
// ============================================================
var stageLyrics = {
  group: null,
  current: null,
  next: null,
  next2: null,
  outgoing: [],
  currentIdx: -1,
  nextIdx: -1,
  next2Idx: -1,
  currentText: '',
  nextText: '',
  next2Text: '',
  highBloom: 0,
  beatGlow: 0,
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  palette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  coverPalette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  starRiver: null,
  starRiverWidth: 4.2,
  starRiverHeight: 0.58,
  lockFitScale: 1,
  snapCameraLockFrames: 0,
};
var lyricSunColor = new THREE.Color(0xffe6a4);
var lyricSunHotColor = new THREE.Color(0xfff4cc);
var lyricCameraDir = new THREE.Vector3();
var lyricCameraRight = new THREE.Vector3();
var lyricCameraUp = new THREE.Vector3();
var lyricCameraTarget = new THREE.Vector3();
var lyricLayoutBase = new THREE.Vector3();
var lyricLayoutTarget = new THREE.Vector3();
var lyricCoverWorldPos = new THREE.Vector3();
var lyricCoverWorldQuat = new THREE.Quaternion();
var lyricBaseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
var lyricTiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');
var lyricBaseQuat = new THREE.Quaternion();
var lyricTiltQuat = new THREE.Quaternion();
var lyricTargetQuat = new THREE.Quaternion();
var LYRIC_CAMERA_LOCK_MAX_SCALE = 0.80;
function setStageLyricViewBasisFromCameraOrQuaternion(fallbackQuat) {
  if (fallbackQuat) {
    lyricCameraDir.set(0, 0, 1).applyQuaternion(fallbackQuat);
    lyricCameraRight.set(1, 0, 0).applyQuaternion(fallbackQuat);
    lyricCameraUp.set(0, 1, 0).applyQuaternion(fallbackQuat);
  } else if (camera) {
    camera.getWorldDirection(lyricCameraDir);
    lyricCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    lyricCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  } else {
    lyricCameraDir.set(0, 0, 1);
    lyricCameraRight.set(1, 0, 0);
    lyricCameraUp.set(0, 1, 0);
  }
  lyricCameraDir.normalize();
  lyricCameraRight.normalize();
  lyricCameraUp.normalize();
}
function applyStageLyricLayoutOffset(target, x, y, z) {
  return target
    .addScaledVector(lyricCameraRight, x || 0)
    .addScaledVector(lyricCameraUp, y || 0)
    .addScaledVector(lyricCameraDir, z || 0);
}
function stageLyricTargetQuaternion(baseQuat, tiltX, tiltY) {
  lyricTiltEuler.set((tiltX || 0) * Math.PI / 180, (tiltY || 0) * Math.PI / 180, 0, 'YXZ');
  lyricTiltQuat.setFromEuler(lyricTiltEuler);
  return lyricTargetQuat.copy(baseQuat || lyricBaseQuat).multiply(lyricTiltQuat);
}
function getStageLyricLockBounds() {
  var maxW = 0, minY = Infinity, maxY = -Infinity, hasMesh = false;
  function take(mesh) {
    if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
    var d = mesh.userData.lyric;
    var meshScale = Math.max(mesh.scale && isFinite(mesh.scale.x) ? mesh.scale.x : 1, mesh.scale && isFinite(mesh.scale.y) ? mesh.scale.y : 1);
    var w = (d.textWorldW || d.worldW || 6.1) * meshScale;
    var h = (d.textWorldH || d.worldH || 1.0) * meshScale;
    maxW = Math.max(maxW, w);
    var y = mesh.position && isFinite(mesh.position.y) ? mesh.position.y : 0;
    minY = Math.min(minY, y - h * 0.52);
    maxY = Math.max(maxY, y + h * 0.52);
    hasMesh = true;
  }
  take(stageLyrics.current);
  take(stageLyrics.next);
  take(stageLyrics.next2);
  for (var i = 0; i < stageLyrics.outgoing.length; i++) take(stageLyrics.outgoing[i]);
  if (!stageLyrics.next && isLyricDualLine() && stageLyrics.current) {
    var currentOff = lyricMeshRoleOffsets('current');
    var nextOff = lyricMeshRoleOffsets('next');
    var currentH = 0.78;
    if (stageLyrics.current.userData && stageLyrics.current.userData.lyric) {
      var cd = stageLyrics.current.userData.lyric;
      var cs = Math.max(stageLyrics.current.scale && isFinite(stageLyrics.current.scale.x) ? stageLyrics.current.scale.x : 1, 1);
      currentH = (cd.textWorldH || cd.worldH || 0.78) * cs;
    }
    minY = Math.min(minY, nextOff.y - currentH * 0.52);
    maxY = Math.max(maxY, currentOff.y + currentH * 0.52);
    hasMesh = true;
  }
  var stackH = hasMesh ? Math.max(0.78, maxY - minY) : 0.78;
  return { w: maxW || 5.4, h: stackH };
}
function lyricDualLineStackActive() {
  // 仅依赖 tickLyricsParticles 已缓存的 next 状态，避免每帧调用 getUpcomingLyricText
  return isLyricDualLine() && !!(stageLyrics.next || stageLyrics.nextText || stageLyrics.next2 || stageLyrics.next2Text);
}
function lyricCameraLockFit(layoutScale, layoutX, layoutY, distance) {
  if (!camera || !camera.isPerspectiveCamera) return 1;
  layoutScale = Math.max(0.1, layoutScale || 1);
  var fov = (camera.fov || 45) * Math.PI / 180;
  var dist = Math.max(1.4, distance || 4.85);
  var visibleH = 2 * Math.tan(fov * 0.5) * dist;
  var visibleW = visibleH * (camera.aspect || (innerWidth / Math.max(1, innerHeight)) || 1.78);
  var bounds = getStageLyricLockBounds();
  var skullSafe = !!(fx && fx.preset === SKULL_PRESET_INDEX);
  var dualStack = lyricDualLineStackActive();
  var safeW = Math.max(visibleW * (skullSafe ? 0.36 : 0.42), visibleW * (skullSafe ? 0.70 : 0.84) - Math.abs(layoutX || 0) * (skullSafe ? 1.36 : 1.22));
  var safeH = Math.max(visibleH * (dualStack ? 0.24 : (skullSafe ? 0.16 : 0.18)), visibleH * (dualStack ? 0.56 : (skullSafe ? 0.34 : 0.44)) - Math.abs(layoutY || 0) * (skullSafe ? 0.98 : 0.82));
  var scaledW = Math.max(0.01, bounds.w * layoutScale);
  var scaledH = Math.max(0.01, bounds.h * layoutScale);
  var viewportFit = Math.min(1, safeW / scaledW, safeH / scaledH);
  var lockScaleCap = Math.min(1, (skullSafe ? 0.94 : LYRIC_CAMERA_LOCK_MAX_SCALE) / layoutScale);
  var minFit = dualStack ? (skullSafe ? 0.48 : 0.54) : (skullSafe ? 0.36 : 0.42);
  return clampRange(Math.min(viewportFit, lockScaleCap), minFit, 1);
}
// 兼容旧变量名以便其它代码不破坏
var lyricsParticles = null;
var lyricsGeo = null;

// 三个 attribute: 源位置(随机扩散态), 目标位置(组成字), color, brightness
var lyricsAttrTargetA = null;
var lyricsAttrTargetB = null;
var lyricsAttrSeed = null;

function createLyricsParticles() {
  if (stageLyrics.group) {
    ensureLyricStarRiver();
    return;
  }
  stageLyrics.group = new THREE.Group();
  stageLyrics.group.renderOrder = 38;
  scene.add(stageLyrics.group);
  ensureLyricStarRiver();
}

function ensureLyricStarRiver() {
  if (!stageLyrics.group || stageLyrics.starRiver) return stageLyrics.starRiver;
  var count = 160;
  var geo = new THREE.BufferGeometry();
  var seeds = new Float32Array(count);
  var lanes = new Float32Array(count);
  var depths = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000;
    lanes[i] = Math.random();
    depths[i] = Math.random();
  }
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('lane', new THREE.BufferAttribute(lanes, 1));
  geo.setAttribute('depthSeed', new THREE.BufferAttribute(depths, 1));
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture },
      uTime: uniforms.uTime,
      uPixel: uniforms.uPixel,
      uBass: uniforms.uBass,
      uBeat: uniforms.uBeat,
      uWidth: { value: stageLyrics.starRiverWidth || 4.2 },
      uHeight: { value: stageLyrics.starRiverHeight || 0.58 },
      uOpacity: { value: 0 },
      uColorA: { value: lyricThreeColor(stageLyrics.palette.secondary, '#9cffdf', 0.42) },
      uColorB: { value: lyricThreeColor(stageLyrics.palette.highlight, '#fff7d2', 0.44) }
    },
    vertexShader: [
      'precision highp float;',
      'attribute float seed,lane,depthSeed;',
      'uniform float uTime,uPixel,uBass,uBeat,uWidth,uHeight;',
      'varying float vSeed,vLane,vGlow;',
      'float hash(float n){return fract(sin(n)*43758.5453123);}',
      'void main(){',
      '  float laneBand = floor(lane * 5.0);',
      '  float laneLocal = fract(lane * 5.0);',
      '  float speed = 0.030 + hash(seed * 1.71) * 0.055 + laneBand * 0.005;',
      '  float flow = fract(hash(seed * 2.13) + uTime * speed);',
      '  float x = (flow - 0.5) * uWidth * (1.08 + hash(seed * 5.1) * 0.18);',
      '  float curve = sin(flow * 6.2831853 * (0.92 + hash(seed * 4.0) * 0.46) + seed * 0.071 + uTime * 0.34);',
      '  float breath = sin(uTime * (0.42 + hash(seed * 6.9) * 0.42) + seed * 0.093);',
      '  float y = (laneBand - 2.0) * uHeight * 0.135 + curve * uHeight * (0.20 + hash(seed * 9.0) * 0.18) + (laneLocal - 0.5) * uHeight * 0.16 + breath * uHeight * 0.10;',
      '  float z = -0.08 + (depthSeed - 0.5) * 0.44 + sin(uTime * (0.18 + hash(seed) * 0.24) + seed) * 0.08;',
      '  vec3 pos = vec3(x, y, z);',
      '  float edge = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.82, 1.0, flow));',
      '  vSeed = seed;',
      '  vLane = lane;',
      '  vGlow = edge * (0.62 + 0.38 * sin(uTime * (0.9 + hash(seed * 8.0) * 0.7) + seed));',
      '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
      '  float dist = max(0.45, -mv.z);',
      '  float size = (0.030 + hash(seed * 12.0) * 0.040 + vGlow * 0.024 + uBeat * 0.010) * (1.0 + uBass * 0.18);',
      '  gl_PointSize = clamp(size * uPixel * 120.0 / dist, 1.0, 7.2);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uColorA,uColorB;',
      'uniform float uOpacity,uTime,uBeat;',
      'varying float vSeed,vLane,vGlow;',
      'void main(){',
      '  vec4 tex = texture2D(uMap, gl_PointCoord);',
      '  if(tex.a < 0.02) discard;',
      '  float tw = pow(0.5 + 0.5 * sin(uTime * (0.55 + fract(vSeed) * 0.35) + vSeed), 4.0);',
      '  vec3 col = mix(uColorA, uColorB, smoothstep(0.12, 0.92, vLane) * 0.45 + tw * 0.42 + vGlow * 0.26);',
      '  float alpha = tex.a * uOpacity * (0.20 + vGlow * 0.78 + tw * 0.32 + uBeat * 0.10);',
      '  gl_FragColor = vec4(col * (0.82 + vGlow * 0.72 + tw * 0.32), alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  var points = new THREE.Points(geo, mat);
  points.renderOrder = 45;
  points.frustumCulled = false;
  points.position.set(0, 0.20, 1.53);
  stageLyrics.group.add(points);
  stageLyrics.starRiver = points;
  return points;
}

function updateLyricStarRiver(dt) {
  var river = ensureLyricStarRiver();
  if (!river || !river.material || !river.material.uniforms) return;
  if (fx && fx.preset === SKULL_PRESET_INDEX) {
    river.visible = false;
    if (river.material.uniforms.uOpacity) river.material.uniforms.uOpacity.value = 0;
    return;
  }
  var u = river.material.uniforms;
  var data = stageLyrics.current && stageLyrics.current.userData ? stageLyrics.current.userData.lyric : null;
  var targetW = data ? clampRange((data.textWorldW || data.worldW || 4.2) * 1.12 + 0.80, 2.25, 7.20) : 3.4;
  var targetH = data ? clampRange((data.textWorldH || data.worldH || 0.58) * 1.85 + 0.18, 0.52, 1.35) : 0.58;
  stageLyrics.starRiverWidth += (targetW - stageLyrics.starRiverWidth) * Math.min(1, dt * 5.2);
  stageLyrics.starRiverHeight += (targetH - stageLyrics.starRiverHeight) * Math.min(1, dt * 4.6);
  u.uWidth.value = stageLyrics.starRiverWidth;
  u.uHeight.value = stageLyrics.starRiverHeight;
  var lyricGlowStrength = fx.lyricGlow ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength)) : 0;
  var targetOpacity = (stageLyrics.current && fx.backgroundStarRiver)
    ? clampRange(0.22 + lyricGlowStrength * 0.40 + stageLyrics.highBloom * 0.16 + stageLyrics.beatGlow * 0.12, 0.16, 0.86)
    : 0;
  u.uOpacity.value += (targetOpacity - u.uOpacity.value) * (targetOpacity > u.uOpacity.value ? 0.10 : 0.055);
  u.uColorA.value.copy(lyricThreeColor(stageLyrics.palette.secondary || stageLyrics.palette.primary, '#9cffdf', 0.42));
  u.uColorB.value.copy(lyricThreeColor(stageLyrics.palette.highlight || stageLyrics.palette.primary, '#fff7d2', 0.46));
  river.visible = u.uOpacity.value > 0.01 || !!stageLyrics.current;
  var t = uniforms.uTime.value;
  river.position.y += ((0.18 + Math.sin(t * 0.44) * 0.035 + Math.sin(t * 0.91 + 1.7) * 0.018) - river.position.y) * 0.08;
  river.position.z += ((1.54 + Math.cos(t * 0.31) * 0.060) - river.position.z) * 0.08;
  river.rotation.z = Math.sin(t * 0.22) * 0.012;
}

function disposeLyricMesh(mesh) {
  if (!mesh) return;
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.traverse(function(obj){
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(function(m){ if (m.map) m.map.dispose(); m.dispose(); });
      } else {
        if (obj.material.map) obj.material.map.dispose();
        if (obj.material.uniforms && obj.material.uniforms.uMap && obj.material.uniforms.uMap.value) obj.material.uniforms.uMap.value.dispose();
        obj.material.dispose();
      }
    }
    if (obj.geometry) obj.geometry.dispose();
  });
}

