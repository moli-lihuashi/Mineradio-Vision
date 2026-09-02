function stageLyricProgressPreviewActive() {
  return typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive();
}
function stageLyricPlaybackSeconds() {
  if (typeof getProgressDragPreviewSeconds === 'function') {
    var preview = getProgressDragPreviewSeconds();
    if (preview != null && isFinite(preview)) return preview;
  }
  return (audio && isFinite(audio.currentTime)) ? audio.currentTime : 0;
}
function stageLyricProgressSeekVisualReady(seconds) {
  return true;
}
function stageLyricWantRowLayers() {
  // feature-flag：ENABLE_LYRIC_ROW_LAYERS / Mineradio.enableLyricRowLayers
  // eco 退回轻量 dual/triple。fail-open 会话锁优先。
  if (typeof STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF !== 'undefined' && STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF) return false;
  if (typeof ENABLE_LYRIC_ROW_LAYERS === 'undefined' || !ENABLE_LYRIC_ROW_LAYERS) return false;
  if (typeof normalizeLyricDisplayMode !== 'function' || typeof buildLyricMesh !== 'function' || typeof updateLyricRowLayers !== 'function') return false;
  if (normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) === 'single') return false;
  var quality = typeof resolvedPerformanceQuality === 'function' ? resolvedPerformanceQuality() : 'balanced';
  if (quality === 'eco') return false;
  return true;
}
if (typeof Mineradio === 'undefined') var Mineradio = {};
Mineradio.enableLyricRowLayers = function (on) {
  ENABLE_LYRIC_ROW_LAYERS = !!on;
  if (on) STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('mineradio_lyric_row_layers', ENABLE_LYRIC_ROW_LAYERS ? '1' : '0');
    }
  } catch (_) {}
  if (typeof refreshCurrentLyricStyle === 'function') {
    try { refreshCurrentLyricStyle(); } catch (_) {}
  }
  return ENABLE_LYRIC_ROW_LAYERS;
};

/** 多行轨是否走「轻量首屏 + resident ensure」（非整曲 coop） */
function stageLyricWantsLightweightFirst(payload) {
  return !!(
    payload &&
    payload.mode &&
    payload.mode !== 'single' &&
    Array.isArray(payload.trackEntries) &&
    payload.trackEntries.length > 2 &&
    typeof buildLyricMesh === 'function'
  );
}
// 兼容旧名（曾误指 live coop）
function stageLyricShouldBuildCooperatively(payload) {
  return stageLyricWantsLightweightFirst(payload);
}

function resetStageLyricResumeFrameGates() {
  var now = performance.now();
  if (typeof resetFrameGate === 'function' && typeof mainFrameGates !== 'undefined' && mainFrameGates) {
    resetFrameGate(mainFrameGates.lyricsParticles, now);
    resetFrameGate(mainFrameGates.stageLyrics, now);
  }
}
function markStageLyricsPlaybackResume(reason) {
  // 轻量版：清 frame-gate backlog，避免暂停后首帧歌词粒子被积压 dt 猛推
  resetStageLyricResumeFrameGates();
  return reason || 'playback-started';
}

/**
 * 挂上新 track mesh：必要时 hold 旧轨直到 reveal；并 prime 新轨透明度。
 * 必须在 build 成功后再调用（禁止先 out 旧轨再同步建新轨）。
 */
function commitIncomingStageLyricTrackMesh(trackMesh, payload, redrawOnly) {
  if (!trackMesh || !stageLyrics || !stageLyrics.group) return false;
  var outgoingMesh = stageLyrics.current;
  var holdOutgoingForReveal = !redrawOnly
    && typeof stageLyricShouldHoldOutgoingForReveal === 'function'
    && stageLyricShouldHoldOutgoingForReveal(outgoingMesh, trackMesh);
  if (typeof releaseStageLyricRevealHoldsForSuccessor === 'function') {
    releaseStageLyricRevealHoldsForSuccessor(outgoingMesh);
  }
  if (redrawOnly && outgoingMesh) {
    try { disposeLyricMesh(outgoingMesh); } catch (_) {}
    stageLyrics.current = null;
  } else if (outgoingMesh && outgoingMesh !== trackMesh) {
    var outData = outgoingMesh.userData && outgoingMesh.userData.lyric;
    if (outData) {
      var curOp = outData.textMat && outData.textMat.uniforms && outData.textMat.uniforms.uOpacity
        ? Number(outData.textMat.uniforms.uOpacity.value)
        : (Number(outData.globalOpacity) || 0.88);
      if (!isFinite(curOp) || curOp < 0.08) curOp = 0.88;
      outData.globalOpacity = curOp;
    }
    outgoingMesh.userData.state = 'out';
    outgoingMesh.userData.age = 0;
    outgoingMesh.userData.lyricRevealSuccessor = holdOutgoingForReveal ? trackMesh : null;
    if (stageLyrics.outgoing.indexOf(outgoingMesh) < 0) stageLyrics.outgoing.push(outgoingMesh);
  }
  stageLyrics.currentText = (payload && payload.text) || stageLyrics.currentText || '';
  stageLyrics.currentPayload = payload || null;
  if (!redrawOnly && typeof primeLyricMeshOpacity === 'function') {
    var lineStep = clampRange(Number(stageLyrics.transitionLineStep) || 0, -2, 2);
    primeLyricMeshOpacity(trackMesh, Math.abs(lineStep) > 0 ? 0.34 : 0.24);
  }
  if (!trackMesh.parent) stageLyrics.group.add(trackMesh);
  stageLyrics.current = trackMesh;
  trackMesh.userData.lyricRevealWatchAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (typeof initializeStageLyricPersistentTrack === 'function') {
    try { initializeStageLyricPersistentTrack(trackMesh, payload); } catch (_) {}
  }
  if (typeof hideStageNextLineSmooth === 'function') hideStageNextLineSmooth();
  return true;
}

function promoteNextLineToCurrent(text) {
  if (typeof stageLyricWantRowLayers === 'function' && stageLyricWantRowLayers()) {
    showStageLine(text, false);
    return;
  }
  if (!stageLyrics.next) {
    showStageLine(text, false);
    return;
  }
  // 多行预告若曾拼进同一 next mesh（" · "），不能 promote，否则当前行纹理错乱且下行丢失
  if (String(stageLyrics.nextText || '').indexOf('  ·  ') >= 0) {
    hideStageNextLineSmooth();
    hideStageNext2LineSmooth();
    showStageLine(text, false);
    return;
  }
  var oldCurrent = stageLyrics.current;
  var promoted = stageLyrics.next;
  stageLyrics.current = promoted;
  stageLyrics.next = null;
  stageLyrics.nextText = '';
  stageLyrics.nextIdx = -1;
  stageLyrics.currentText = text;
  promoted.userData.state = 'promote';
  promoted.userData.lyricRole = 'current';
  promoted.userData.promoteT = 0;
  promoted.userData.promoteAnchorSaved = false;
  promoted.userData.age = 0.72;
  promoted.renderOrder = 42;
  updateLyricMeshProgress(promoted, 0);
  if (oldCurrent && oldCurrent !== promoted) {
    oldCurrent.userData.state = 'out-up';
    oldCurrent.userData.age = 0;
    stageLyrics.outgoing.push(oldCurrent);
  }
  // 三行：next2 升成 next，避免换行后第三行空白
  if (stageLyrics.next2) {
    stageLyrics.next = stageLyrics.next2;
    stageLyrics.nextText = stageLyrics.next2Text || '';
    stageLyrics.nextIdx = stageLyrics.next2Idx;
    stageLyrics.next2 = null;
    stageLyrics.next2Text = '';
    stageLyrics.next2Idx = -1;
    stageLyrics.next.userData.lyricRole = 'next';
    stageLyrics.next.userData.state = 'in';
    stageLyrics.next.userData.age = Math.max(0.35, Number(stageLyrics.next.userData.age) || 0);
    stageLyrics.next.renderOrder = 41;
  }
  requestStageLyricCameraSnap(8);
}

function buildLyricMeshLegacy(text, opts) {
  opts = opts || {};
  var role = opts.role === 'next' || opts.role === 'next2' ? opts.role : 'current';
  // 保留 \n 强制换行：原文/译文上下两行渲染（makeLyricMaskLegacy 支持多行）
  text = (typeof normalizeLyricStageLineText === 'function' ? normalizeLyricStageLineText(text) : String(text || '').replace(/\s+/g, ' ').trim());
  // P1：legacy mesh 固定走 Legacy API，避免被 payload/row shader 全局名踩踏
  var mask = (typeof makeLyricMaskLegacy === 'function' ? makeLyricMaskLegacy : makeLyricMask)(text);
  var pal = stageLyrics.palette;
  var worldW = 6.10;
  var worldH = worldW * (mask.height / mask.width);
  var geo = new THREE.PlaneGeometry(worldW, worldH, 1, 1);
  var textWorldW = worldW * (mask.textWidth / mask.width);
  var textWorldH = worldH * ((mask.textHeight || mask.fontSize) / mask.height);
  var group = new THREE.Group();
  group.renderOrder = role === 'next2' ? 40 : (role === 'next' ? 41 : 42);
  var roleOff = lyricMeshRoleOffsets(role);
  var spawnOff = role === 'next' || role === 'next2' ? lyricMeshSpawnOffset(role) : null;
  group.position.set(0, spawnOff ? spawnOff.y : roleOff.y, spawnOff ? spawnOff.z : roleOff.z);
  group.scale.setScalar(spawnOff ? spawnOff.scale : roleOff.scale);
  group.userData.age = 0;
  group.userData.state = (role === 'next' || role === 'next2') ? 'rise' : 'in';
  group.userData.riseT = (role === 'next' || role === 'next2') ? 0 : 1;
  group.userData.lastLyricProgress = -1;
  group.userData.floatSeed = lyricStableSeed(text, role);
  group.userData.lyricRole = role;

  var sunMat = makeLyricBackfaceReadableMaterial({
    map: getLyricSunBloomTexture(),
    opacity: 0,
    blending: THREE.AdditiveBlending,
    color: lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#ffe7a6', 0.50)
  });
  var sunWorldW = Math.max(textWorldW + worldH * 1.10, textWorldW * 1.18);
  sunWorldW = Math.min(worldW * 1.16, Math.max(worldH * 1.35, sunWorldW));
  var sunWorldH = Math.max(worldH * 1.02, Math.min(worldH * 1.54, worldH + textWorldW * 0.070));
  var sun = new THREE.Mesh(new THREE.PlaneGeometry(sunWorldW, sunWorldH, 1, 1), sunMat);
  sun.renderOrder = 40;
  sun.position.set(0, 0.02, -0.030);
  sun.scale.set(0.78, 0.58, 1);
  group.add(sun);

  var glowTex = makeLyricGlowTexture(text, mask.fontSize, mask.textWidth, mask.lines, mask.lineHeight, mask.fitScaleX);
  var glowMat = makeLyricBackfaceReadableMaterial({
    map: glowTex,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    color: lyricThreeColor(pal.secondary, '#9cffdf', 0.36)
  });
  var glowMeta = glowTex.userData || {};
  var glowWorldW = textWorldW * ((glowMeta.width || mask.width) / Math.max(1, glowMeta.textWidth || mask.textWidth));
  glowWorldW = Math.min(worldW * 1.10, Math.max(textWorldW + worldH * 0.38, glowWorldW));
  var glowWorldH = worldH * ((glowMeta.height || mask.height) / mask.height);
  glowWorldH = Math.min(worldH * 1.42, Math.max(worldH * 0.92, glowWorldH));
  var glow = new THREE.Mesh(new THREE.PlaneGeometry(glowWorldW, glowWorldH, 1, 1), glowMat);
  glow.renderOrder = 41;
  glow.scale.set(1.0, 1.06, 1);
  group.add(glow);

  var readabilityTex = makeLyricReadabilityTexture(mask);
  var readabilityMat = makeLyricBackfaceReadableMaterial({
    map: readabilityTex,
    opacity: 0
  });
  var readability = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH, 1, 1), readabilityMat);
  readability.renderOrder = 42;
  readability.position.set(0, 0, -0.012);
  group.add(readability);

  var textMat = (typeof makeLyricShaderMaterialLegacy === 'function' ? makeLyricShaderMaterialLegacy : makeLyricShaderMaterial)(mask, pal);
  var textMesh = new THREE.Mesh(geo, textMat);
  textMesh.renderOrder = 43;
  group.add(textMesh);

  // 预告行少火花；关 glow 粒子则不建，省掉每帧 CPU 漂移循环
  var sparkCount = 0;
  if (fx.lyricGlowParticles) sparkCount = role === 'current' ? 48 : 12;
  var sparks = null;
  var pmat = null;
  var ppos = null;
  if (sparkCount > 0) {
  var pgeo = new THREE.BufferGeometry();
  ppos = new Float32Array(sparkCount * 3);
  var pseed = new Float32Array(sparkCount);
  for (var i = 0; i < sparkCount; i++) {
    var angle = Math.random() * Math.PI * 2;
    var ring = 0.78 + Math.pow(Math.random(), 1.45) * 0.58;
    var rx = textWorldW * (0.50 + Math.random() * 0.22) + 0.10;
    var ry = worldH * (0.42 + Math.random() * 0.22) + 0.08;
    ppos[i*3] = Math.cos(angle) * rx * ring + (Math.random() - 0.5) * textWorldW * 0.12;
    ppos[i*3+1] = Math.sin(angle) * ry * ring + (Math.random() - 0.5) * worldH * 0.14;
    ppos[i*3+2] = (Math.random() - 0.5) * 0.24;
    pseed[i] = Math.random() * 1000;
  }
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute('seed', new THREE.BufferAttribute(pseed, 1));
  pmat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture },
      uSize: { value: 0.052 },
      uOpacity: { value: 0 },
      uColor: { value: lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff7d2', 0.30) },
      uPixel: uniforms.uPixel,
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uBeat: { value: 0 },
      uDrift: { value: 1 }
    },
    vertexShader: [
      'attribute float seed;',
      'uniform float uSize, uPixel, uTime, uBass, uMid, uBeat, uDrift;',
      'varying float vSeed;',
      'void main(){',
      '  vSeed = seed;',
      '  float s = seed;',
      '  float t = uTime;',
      '  float dustBreath = 0.62 + 0.38 * sin(t * (0.32 + fract(s) * 0.15) + s);',
      '  float drift = uDrift;',
      '  vec3 pos = position;',
      '  pos.x += sin(t * (0.18 + fract(s * 0.17) * 0.12) + s) * (0.045 + uBass * 0.030 + uBeat * 0.052) * drift + cos(t * 0.11 + s) * 0.018 * dustBreath;',
      '  pos.y += cos(t * (0.16 + fract(s * 0.23) * 0.12) + s) * (0.042 + uMid * 0.026 + uBeat * 0.046) * drift + sin(t * 0.13 + s) * 0.016 * dustBreath;',
      '  pos.z += sin(t * (0.24 + fract(s * 0.31) * 0.12) + s) * (0.036 + uBeat * 0.028) * drift;',
      '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
      '  float jitter = 0.58 + fract(sin(seed * 19.17) * 43758.5453) * 1.18;',
      '  float depth = clamp(2.2 / max(0.35, -mv.z), 0.54, 1.55);',
      '  gl_PointSize = uSize * jitter * depth * uPixel * 120.0;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'varying float vSeed;',
      'void main(){',
      '  vec4 tex = texture2D(uMap, gl_PointCoord);',
      '  float twinkle = 0.72 + fract(sin(vSeed * 7.31) * 91.7) * 0.28;',
      '  gl_FragColor = vec4(uColor * twinkle, tex.a * uOpacity);',
      '}'
    ].join('\n'),
    transparent:true, depthWrite:false, depthTest:false, blending:THREE.AdditiveBlending
  });
  sparks = new THREE.Points(pgeo, pmat);
  sparks.renderOrder = 44;
  sparks.visible = !!fx.lyricGlowParticles;
  group.add(sparks);
  }

  group.userData.lyric = {
    mask:mask, textMesh:textMesh, readability:readability, glow:glow, sparks:sparks, sun:sun,
    textMat:textMat, readabilityMat:readabilityMat, glowMat:glowMat, sparkMat:pmat, sunMat:sunMat,
    basePositions:ppos ? (ppos.slice ? ppos.slice(0) : new Float32Array(ppos)) : null,
    textWorldW:textWorldW, textWorldH:textWorldH, worldW:worldW, worldH:worldH
  };
  updateLyricMeshProgress(group, 0);
  return group;
}

function updateLyricMeshProgress(mesh, progress, opts) {
  // P1：track 版由 13 提供；14 不再用 legacy 三行盖掉
  if (mesh && mesh.userData && mesh.userData.lyric &&
      (mesh.userData.lyric.usesTrack || mesh.userData.lyric.trackPersistent || mesh.userData.lyric.trackPendingPayload) &&
      typeof updateLyricMeshProgressTrack === 'function') {
    return updateLyricMeshProgressTrack(mesh, progress, opts);
  }
  if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
  progress = Math.max(0, Math.min(1, progress || 0));
  var d = mesh.userData.lyric;
  if (d.textMat && d.textMat.uniforms && d.textMat.uniforms.uProgress) {
    d.textMat.uniforms.uProgress.value = progress;
  }
  mesh.userData.lastLyricProgress = progress;
}

/** P0：track 超时未露字 → 拆掉回落 legacy，并会话锁死 row-layers，避免切行再空白
 * 注意：只锁本会话（重负载/GPU 抖动导致的一次超时不应永久关掉行层——
 * 行层永久关闭会让自定行数彻底失效，legacy 路径不读行数）。 */
var STAGE_LYRIC_REVEAL_FAILOPEN_MS = 900;
function stageLyricFailOpenLegacyFromTrack(trackMesh, reason) {
  if (typeof cancelStageLyricResidentBuild === 'function') {
    try { cancelStageLyricResidentBuild(); } catch (_) {}
  }
  try { STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = true; } catch (_) {}
  try {
    if (typeof ENABLE_LYRIC_ROW_LAYERS !== 'undefined') ENABLE_LYRIC_ROW_LAYERS = false;
    // 不再写 localStorage '0'：一次性 reveal 超时只降级本会话，下次启动重试行层
  } catch (_) {}
  var idx = stageLyrics && stageLyrics.currentIdx;
  var text = '';
  try {
    if (idx === -2) text = normalizeLyricLineText(currentLyricFallbackText());
    else if (idx >= 0 && lyricsLines && lyricsLines[idx]) {
      text = enrichLyricText(normalizeLyricLineText(lyricsLines[idx].text || ''), idx);
    } else {
      text = normalizeLyricLineText((stageLyrics && stageLyrics.currentText) || '');
    }
  } catch (_) {
    text = normalizeLyricLineText((stageLyrics && stageLyrics.currentText) || '');
  }
  if (trackMesh && stageLyrics && trackMesh === stageLyrics.current) {
    try { disposeLyricMesh(trackMesh); } catch (_) {}
    stageLyrics.current = null;
  } else if (trackMesh) {
    try { disposeLyricMesh(trackMesh); } catch (_) {}
  }
  if (!text || !stageLyrics || !stageLyrics.group) return false;
  var mesh = null;
  try {
    mesh = buildLyricMeshLegacy(text);
  } catch (err) {
    console.warn('[row-layers] fail-open legacy build failed:', reason || '', err);
    return false;
  }
  var progress = 0;
  try {
    progress = trackMesh && trackMesh.userData ? (Number(trackMesh.userData.lastLyricProgress) || 0) : 0;
  } catch (_) {}
  stageLyrics.currentText = text;
  stageLyrics.currentPayload = null;
  stageLyrics.group.add(mesh);
  stageLyrics.current = mesh;
  try { updateLyricMeshProgress(mesh, progress); } catch (_) {}
  console.warn('[row-layers] fail-open legacy + session latch:', reason || 'reveal-timeout');
  return true;
}

function showStageLine(text, redrawOnly, options) {
  options = options || {};
  createLyricsParticles();
  if (!stageLyrics.group) return false;
  if (!text && text !== 0) { clearStageLyrics(); return false; }

  // row-layers / track 路径（displayMode != single）
  if (stageLyricWantRowLayers() && typeof normalizeStageLyricPayload === 'function') {
    var payload = null;
    if (typeof text === 'object') payload = normalizeStageLyricPayload(text);
    else if (stageLyrics.currentIdx >= 0 && typeof buildStageLyricDisplayPayload === 'function') {
      payload = buildStageLyricDisplayPayload(stageLyrics.currentIdx, { lightweightTrack: true });
    }
    if (payload && payload.mode && payload.mode !== 'single' && typeof buildLyricMesh === 'function') {
      if (!redrawOnly && stageLyrics.current && typeof setLyricTrackTarget === 'function' && setLyricTrackTarget(stageLyrics.current, payload)) {
        stageLyrics.currentText = payload.text || normalizeLyricLineText(String(text || ''));
        stageLyrics.currentPayload = payload;
        hideStageNextLineSmooth();
        return true;
      }
      var prewarmMesh = !redrawOnly && typeof takeStageLyricPrewarmMesh === 'function'
        ? takeStageLyricPrewarmMesh(payload)
        : null;
      if (prewarmMesh) {
        commitIncomingStageLyricTrackMesh(prewarmMesh, payload, !!redrawOnly);
        if (typeof hardenStageLyricIncomingTrackOrFailOpen === 'function') {
          if (hardenStageLyricIncomingTrackOrFailOpen(prewarmMesh, payload, 'empty-prewarm') === 'fail-open') return true;
        }
        if (payload.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
          scheduleStageLyricFullTrackWarmup('prewarm-takeover', 96);
        }
        return true;
      }
      if (options.noSyncBuild && typeof shouldDeferStageLyricSyncBuild === 'function' && shouldDeferStageLyricSyncBuild(payload, redrawOnly)) {
        if (typeof requestStageLyricDemandPrewarm === 'function') requestStageLyricDemandPrewarm(payload);
        return false;
      }
      // 同步路径：只建轻量窗（禁止整曲一次贴满）
      var trackMesh = null;
      var syncPayload = payload;
      if (!payload.trackLightweight && typeof buildStageLyricDisplayPayload === 'function' && stageLyrics.currentIdx >= 0) {
        try {
          var syncLight = buildStageLyricDisplayPayload(
            payload.trackIndex != null ? payload.trackIndex : stageLyrics.currentIdx,
            { lightweightTrack: true }
          );
          if (syncLight && typeof normalizeStageLyricPayload === 'function') syncLight = normalizeStageLyricPayload(syncLight);
          if (syncLight && syncLight.trackEntries && syncLight.trackEntries.length) syncPayload = syncLight;
        } catch (_) {}
      } else if (!payload.trackLightweight && payload.trackIndex != null && typeof buildStageLyricDisplayPayload === 'function') {
        try {
          var syncLight2 = buildStageLyricDisplayPayload(payload.trackIndex, { lightweightTrack: true });
          if (syncLight2 && typeof normalizeStageLyricPayload === 'function') syncLight2 = normalizeStageLyricPayload(syncLight2);
          if (syncLight2 && syncLight2.trackEntries && syncLight2.trackEntries.length) syncPayload = syncLight2;
        } catch (_) {}
      }
      try { trackMesh = buildLyricMesh(syncPayload); } catch (err) {
        console.warn('[row-layers] buildLyricMesh failed, fallback dual-mesh:', err);
        trackMesh = null;
      }
      if (trackMesh) {
        commitIncomingStageLyricTrackMesh(trackMesh, syncPayload, !!redrawOnly);
        if (typeof hardenStageLyricIncomingTrackOrFailOpen === 'function') {
          if (hardenStageLyricIncomingTrackOrFailOpen(trackMesh, syncPayload, 'empty-track') === 'fail-open') return true;
        }
        if (syncPayload.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
          scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 96);
        }
        return true;
      }
      if (typeof requestStageLyricDemandPrewarm === 'function') requestStageLyricDemandPrewarm(payload);
      // fall through to legacy if build failed
    }
  }

  // 保留 \n：原文/译文上下两行；比对时用压平形式保持 promote 逻辑不变
  text = (typeof normalizeLyricStageLineText === 'function' ? normalizeLyricStageLineText : normalizeLyricLineText)(typeof text === 'object' ? (text && text.text) || '' : text);
  if (!text) { clearStageLyrics(); return false; }
  if (!redrawOnly && isLyricDualLine() && stageLyrics.next) {
    // triple/custom 模式下 nextText 是多行用 " · " 合并的串，需取首段比对以触发 promote 动画
    var nt = normalizeLyricLineText(stageLyrics.nextText);
    var flatText = normalizeLyricLineText(text);
    if (nt === flatText || (nt && String(nt).split(/\s+·\s+/)[0] === flatText)) {
      promoteNextLineToCurrent(text);
      return true;
    }
  }
  if (redrawOnly && stageLyrics.current) {
    disposeLyricMesh(stageLyrics.current);
    stageLyrics.current = null;
  } else if (stageLyrics.current) {
    stageLyrics.current.userData.state = 'out';
    stageLyrics.current.userData.age = 0;
    stageLyrics.outgoing.push(stageLyrics.current);
  }
  stageLyrics.currentText = text;
  var mesh = null;
  try {
    mesh = buildLyricMeshLegacy(text);
  } catch (err) {
    console.warn('[lyrics] showStageLine legacy build failed:', err);
    return false;
  }
  stageLyrics.group.add(mesh);
  stageLyrics.current = mesh;
  return true;
}

function showStageNextLine(text) {
  createLyricsParticles();
  if (!stageLyrics.group) return;
  // 预告行同样保留 \n：原文/译文上下两行，与当前行布局一致
  text = (typeof normalizeLyricStageLineText === 'function' ? normalizeLyricStageLineText : String)(text);
  if (!text) {
    hideStageNextLineSmooth();
    return;
  }
  if (normalizeLyricLineText(stageLyrics.nextText) === normalizeLyricLineText(text) && stageLyrics.next) return;
  if (stageLyrics.next) hideStageNextLineSmooth();
  var mesh = null;
  try {
    mesh = buildLyricMeshLegacy(text, { role: 'next' });
  } catch (err) {
    console.warn('[lyrics] showStageNextLine build failed:', err);
    stageLyrics.next = null;
    stageLyrics.nextText = '';
    stageLyrics.nextIdx = -1;
    return;
  }
  mesh.userData.age = 0;
  mesh.userData.state = 'rise';
  mesh.userData.riseT = 0;
  var spawnOff = lyricMeshSpawnOffset('next');
  mesh.position.set(0, spawnOff.y, spawnOff.z);
  mesh.scale.setScalar(spawnOff.scale);
  stageLyrics.group.add(mesh);
  stageLyrics.next = mesh;
  stageLyrics.nextText = text;
}
function hideStageNextLineSmooth() {
  if (!stageLyrics.next) {
    stageLyrics.nextText = '';
    stageLyrics.nextIdx = -1;
    return;
  }
  var mesh = stageLyrics.next;
  mesh.userData.state = 'out';
  mesh.userData.age = 0;
  stageLyrics.outgoing.push(mesh);
  stageLyrics.next = null;
  stageLyrics.nextText = '';
  stageLyrics.nextIdx = -1;
}
function showStageNext2Line(text) {
  createLyricsParticles();
  if (!stageLyrics.group) return;
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    hideStageNext2LineSmooth();
    return;
  }
  if (normalizeLyricLineText(stageLyrics.next2Text) === normalizeLyricLineText(text) && stageLyrics.next2) return;
  if (stageLyrics.next2) hideStageNext2LineSmooth();
  var mesh = null;
  try {
    mesh = buildLyricMeshLegacy(text, { role: 'next2' });
  } catch (err) {
    console.warn('[lyrics] showStageNext2Line build failed:', err);
    stageLyrics.next2 = null;
    stageLyrics.next2Text = '';
    stageLyrics.next2Idx = -1;
    return;
  }
  mesh.userData.age = 0;
  mesh.userData.state = 'rise';
  mesh.userData.riseT = 0;
  var spawnOff = lyricMeshSpawnOffset('next2');
  mesh.position.set(0, spawnOff.y, spawnOff.z);
  mesh.scale.setScalar(spawnOff.scale);
  stageLyrics.group.add(mesh);
  stageLyrics.next2 = mesh;
  stageLyrics.next2Text = text;
}
function hideStageNext2LineSmooth() {
  if (!stageLyrics.next2) {
    stageLyrics.next2Text = '';
    stageLyrics.next2Idx = -1;
    return;
  }
  var mesh = stageLyrics.next2;
  mesh.userData.state = 'out';
  mesh.userData.age = 0;
  stageLyrics.outgoing.push(mesh);
  stageLyrics.next2 = null;
  stageLyrics.next2Text = '';
  stageLyrics.next2Idx = -1;
}
function syncStageLyricPreviewLines(fromIdx) {
  if (!isLyricDualLine() || (typeof stageLyricWantRowLayers === 'function' && stageLyricWantRowLayers())) {
    if (stageLyrics.next || stageLyrics.nextText) hideStageNextLineSmooth();
    if (stageLyrics.next2 || stageLyrics.next2Text) hideStageNext2LineSmooth();
    return;
  }
  var want = typeof getLyricLineCount === 'function' ? getLyricLineCount() : 2;
  var upcomingText = typeof getUpcomingLyricTextAt === 'function' ? getUpcomingLyricTextAt(fromIdx, 1) : getUpcomingLyricText(fromIdx);
  var upcomingIdx = typeof getUpcomingLyricIndexAt === 'function' ? getUpcomingLyricIndexAt(fromIdx, 1) : findUpcomingLyricIndex(fromIdx);
  if (upcomingText) {
    var needNext = !stageLyrics.next
      || upcomingIdx !== stageLyrics.nextIdx
      || normalizeLyricLineText(stageLyrics.nextText) !== normalizeLyricLineText(upcomingText);
    if (needNext) {
      stageLyrics.nextIdx = upcomingIdx;
      showStageNextLine(upcomingText);
    }
  } else if (stageLyrics.next || stageLyrics.nextText || stageLyrics.nextIdx >= 0) {
    hideStageNextLineSmooth();
  }
  if (want >= 3) {
    var upcoming2Text = typeof getUpcomingLyricTextAt === 'function' ? getUpcomingLyricTextAt(fromIdx, 2) : '';
    var upcoming2Idx = typeof getUpcomingLyricIndexAt === 'function' ? getUpcomingLyricIndexAt(fromIdx, 2) : -1;
    if (upcoming2Text) {
      var needNext2 = !stageLyrics.next2
        || upcoming2Idx !== stageLyrics.next2Idx
        || normalizeLyricLineText(stageLyrics.next2Text) !== normalizeLyricLineText(upcoming2Text);
      if (needNext2) {
        stageLyrics.next2Idx = upcoming2Idx;
        showStageNext2Line(upcoming2Text);
      }
    } else if (stageLyrics.next2 || stageLyrics.next2Text || stageLyrics.next2Idx >= 0) {
      hideStageNext2LineSmooth();
    }
  } else if (stageLyrics.next2 || stageLyrics.next2Text || stageLyrics.next2Idx >= 0) {
    hideStageNext2LineSmooth();
  }
}

function refreshCurrentLyricStyle() {
  if (!stageLyrics || !stageLyrics.current) return;
  try {
    if (typeof cancelStageLyricResidentBuild === 'function') {
      try { cancelStageLyricResidentBuild(); } catch (_) {}
    }
    // 从原始歌词行重新计算 enriched 文本，避免使用陈旧的 currentText（翻译/显示模式切换后需重算）
    var idx = stageLyrics.currentIdx;
    var text;
    if (idx === -2) text = normalizeLyricLineText(currentLyricFallbackText());
    else if (idx >= 0 && lyricsLines[idx]) text = enrichLyricText(normalizeLyricLineText(lyricsLines[idx].text || ''), idx);
    else text = normalizeLyricLineText(stageLyrics.currentText || '');
    stageLyrics.currentText = text;
    var progress = stageLyrics.current.userData ? (stageLyrics.current.userData.lastLyricProgress || 0) : 0;
    var redrawPayload = text;
    if (idx >= 0 && typeof stageLyricMultiLineWarmupLoad === 'function' && stageLyricMultiLineWarmupLoad() && typeof buildStageLyricDisplayPayload === 'function') {
      try {
        redrawPayload = buildStageLyricDisplayPayload(idx, { lightweightTrack: true }) || text;
      } catch (_) { redrawPayload = text; }
    }
    showStageLine(redrawPayload, true);
    if (stageLyrics.current) updateLyricMeshProgress(stageLyrics.current, progress);
    if (stageLyrics.current && stageLyrics.current.userData) stageLyrics.current.userData.age = 0.48;
    if (isLyricDualLine()) {
      syncStageLyricPreviewLines(idx);
    } else {
      hideStageNextLineSmooth();
      hideStageNext2LineSmooth();
    }
  } catch (err) {
    console.warn('[lyrics] refreshCurrentLyricStyle failed:', err);
  }
}

function clearStageLyrics() {
  if (typeof cancelStageLyricResidentBuild === 'function') {
    try { cancelStageLyricResidentBuild(); } catch (_) {}
  }
  if (typeof clearStageLyricFullTrackWarmup === 'function') {
    try { clearStageLyricFullTrackWarmup(); } catch (_) {}
  }
  if (typeof disposeStageLyricPrewarmMesh === 'function') {
    try { disposeStageLyricPrewarmMesh(); } catch (_) {}
  }
  disposeLyricMesh(stageLyrics.current);
  disposeLyricMesh(stageLyrics.next);
  disposeLyricMesh(stageLyrics.next2);
  stageLyrics.current = null;
  stageLyrics.next = null;
  stageLyrics.next2 = null;
  stageLyrics.currentIdx = -1;
  stageLyrics.nextIdx = -1;
  stageLyrics.next2Idx = -1;
  stageLyrics.currentText = '';
  stageLyrics.nextText = '';
  stageLyrics.next2Text = '';
  stageLyrics.currentPayload = null;
  while (stageLyrics.outgoing.length) disposeLyricMesh(stageLyrics.outgoing.pop());
}

// 间奏波形：歌词行之间的纯音乐空档（>2.5s）显示极简封面色波形，下句进场时收束淡出
var interludeWave = { canvas:null, ctx:null, opacity:0, target:0, color:'143,233,255' };
function updateInterludeWave(dt) {
  if (!interludeWave.canvas) {
    interludeWave.canvas = document.getElementById('interlude-wave-canvas');
    if (interludeWave.canvas) interludeWave.ctx = interludeWave.canvas.getContext('2d');
  }
  if (!interludeWave.canvas || !interludeWave.ctx) return;
  interludeWave.color = beatGlowCoverRGB || '143,233,255';
  var t = getAdjustedLyricPlaybackTime(stageLyricPlaybackSeconds());
  // 间奏判定：当前时间落在歌词行之间的空档，且空档 > 2.5s
  var inInterlude = false;
  if (playing && audio && !audio.paused && lyricsLines && lyricsLines.length) {
    var curIdx = -1;
    for (var i = 0; i < lyricsLines.length; i++) {
      if (lyricsLines[i].t <= t + 0.05) curIdx = i; else break;
    }
    var lineEnd, nextStart;
    if (curIdx < 0) {
      lineEnd = 0;
      nextStart = lyricsLines[0] ? lyricsLines[0].t : Infinity;
    } else {
      var cur = lyricsLines[curIdx];
      lineEnd = cur.t + (cur.duration || 0);
      nextStart = (curIdx < lyricsLines.length - 1)
        ? lyricsLines[curIdx + 1].t
        : ((audio && audio.duration) || Infinity);
    }
    var gap = nextStart - lineEnd;
    if (t > lineEnd + 0.5 && t < nextStart - 0.4 && gap > 2.5) inInterlude = true;
  }
  interludeWave.target = inInterlude ? 1 : 0;
  // 平滑淡入淡出（淡入快、淡出慢，收束更柔）
  var ease = interludeWave.target > interludeWave.opacity ? 0.14 : 0.07;
  interludeWave.opacity += (interludeWave.target - interludeWave.opacity) * Math.min(1, ease * Math.max(1, dt * 60));
  var opStr = (interludeWave.opacity * 0.42).toFixed(3);
  if (opStr !== interludeWave._lastOpStr) {
    interludeWave.canvas.style.opacity = opStr;
    interludeWave._lastOpStr = opStr;
  }
  if (interludeWave.opacity < 0.01) return;
  // 用 timeDomainData 绘制极简波形线；画布尺寸约每 90 帧对齐一次，
  // 不再每帧读 offsetWidth 并重赋 width（写读交错触发布局 + 重置 2D 上下文）
  var ctx = interludeWave.ctx;
  if (interludeWave._sizeTick === undefined) interludeWave._sizeTick = 0;
  if ((interludeWave._sizeTick++ % 90) === 0 || !interludeWave._w) {
    var nw = interludeWave.canvas.offsetWidth || 640;
    var nh = interludeWave.canvas.offsetHeight || 96;
    if (nw !== interludeWave._w || nh !== interludeWave._h) {
      interludeWave._w = nw; interludeWave._h = nh;
      interludeWave.canvas.width = nw;
      interludeWave.canvas.height = nh;
    }
  }
  var w = interludeWave._w || 640;
  var h = interludeWave._h || 96;
  ctx.clearRect(0, 0, w, h);
  if (!timeDomainData || !timeDomainData.length) return;
  var samples = timeDomainData.length;
  var mid = h / 2;
  var amp = h * 0.42;
  // 主波形
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(' + interludeWave.color + ',' + (0.55 * interludeWave.opacity).toFixed(3) + ')';
  ctx.beginPath();
  for (var x = 0; x < w; x++) {
    var s = Math.floor((x / w) * samples);
    var v = (timeDomainData[s] - 128) / 128;
    var y = mid + v * amp;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 中线微光，强化"静默中的呼吸感"
  ctx.strokeStyle = 'rgba(' + interludeWave.color + ',' + (0.10 * interludeWave.opacity).toFixed(3) + ')';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
}

function updateStageLyrics3D(dt) {
  if (!stageLyrics.group) return;
  if (typeof resetLyricRenderUploadFrameBudget === 'function') resetLyricRenderUploadFrameBudget(true);
  if (!fx.particleLyrics && !stageLyrics.current && !stageLyrics.next && (!stageLyrics.outgoing || !stageLyrics.outgoing.length)) return;
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  if (!isFinite(stageLyrics.glowFollowX)) stageLyrics.glowFollowX = 0;
  if (!isFinite(stageLyrics.glowFollowY)) stageLyrics.glowFollowY = 0;
  if (!isFinite(stageLyrics.glowFollowRoll)) stageLyrics.glowFollowRoll = 0;
  var t = uniforms.uTime.value;
  var lyricGlowStrength = fx.lyricGlow ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength)) : 0;
  var glowDrive = Math.min(1.7, Math.max(0, lyricGlowStrength / 0.50));
  var glowBreath = lyricGlowStrength > 0 ? (0.5 + 0.5 * Math.sin(t * 1.05)) : 0;
  var musicBloom = Math.max(lyricSunEnergy, beatPulse * 0.10);
  var beatGlowRaw = fx.lyricGlowBeat && lyricGlowStrength > 0
    ? Math.max(beatPulse * 1.22, beatCam.punch * 0.86 + beatCam.radiusKick * 1.85)
    : 0;
  stageLyrics.beatGlow += (beatGlowRaw - stageLyrics.beatGlow) * (beatGlowRaw > stageLyrics.beatGlow ? 0.32 : 0.10);
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  var skullLyricPreset = !!(fx && fx.preset === SKULL_PRESET_INDEX);
  var solarBloom = lyricGlowStrength > 0 ? (0.18 + glowBreath * 0.16 + musicBloom * 0.90 + stageLyrics.beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) * glowDrive : 0;
  if (skullLyricPreset && lyricGlowStrength > 0) {
    solarBloom = (0.035 + glowBreath * 0.030 + musicBloom * 0.11 + Math.pow(Math.max(0, stageLyrics.beatGlow), 1.26) * 1.45 + Math.pow(Math.max(0, skullBeatFlash || 0), 1.08) * 1.18) * glowDrive;
  }
  solarBloom = Math.max(0, Math.min(1.45, solarBloom));
  stageLyrics.highBloom += (solarBloom - stageLyrics.highBloom) * (solarBloom > stageLyrics.highBloom ? (skullLyricPreset ? 0.22 : 0.075) : (skullLyricPreset ? 0.070 : 0.050));
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  updateLyricStarRiver(dt);
  var followDrive = fx.lyricGlowBeat && lyricGlowStrength > 0 ? Math.min(1.35, stageLyrics.beatGlow) : 0;
  var followXTarget = followDrive * (beatCam.thetaKick * 34 + beatCam.rollKick * 8);
  var followYTarget = followDrive * (beatCam.phiKick * 42 - beatCam.radiusKick * 0.48);
  var followRollTarget = followDrive * (beatCam.rollKick * 22 + beatCam.thetaKick * 10);
  stageLyrics.glowFollowX += (followXTarget - stageLyrics.glowFollowX) * 0.26;
  stageLyrics.glowFollowY += (followYTarget - stageLyrics.glowFollowY) * 0.24;
  stageLyrics.glowFollowRoll += (followRollTarget - stageLyrics.glowFollowRoll) * 0.22;
  stageLyrics.glowFollowX *= 0.92;
  stageLyrics.glowFollowY *= 0.92;
  stageLyrics.glowFollowRoll *= 0.90;
  var layoutScale = clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65);
  var layoutX = clampRange(Number(fx.lyricOffsetX) || 0, -4.0, 4.0);
  var layoutY = clampRange(Number(fx.lyricOffsetY) || 0, -2.4, 2.7);
  var layoutZ = clampRange(Number(fx.lyricOffsetZ) || 0, -3.2, 3.2);
  var layoutTiltX = clampRange(Number(fx.lyricTiltX) || 0, -84, 84);
  var layoutTiltY = clampRange(Number(fx.lyricTiltY) || 0, -84, 84);
  var skullMouthLyrics = !!(camera && fx && fx.preset === SKULL_PRESET_INDEX && skullParticleGroup && skullParticleGroup.visible);
  var shelfDetailOpen = !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
  var skullShelfDetailOpen = !!(fx && fx.preset === SKULL_PRESET_INDEX && shelfDetailOpen);
  var normalShelfDetailOpen = !!(shelfDetailOpen && !skullShelfDetailOpen);
  stageLyrics.group.renderOrder = shelfDetailOpen ? 24 : 38;
  var shelfDetailLyricProfile = shelfDetailOpen ? {
    opacity: skullShelfDetailOpen ? 0.30 : 0.38,
    readability: skullShelfDetailOpen ? 0.20 : 0.26,
    bloom: skullShelfDetailOpen ? 0.20 : 0.24,
    glowCap: skullShelfDetailOpen ? 0.050 : 0.070,
    outgoing: skullShelfDetailOpen ? 0.34 : 0.42,
    easeDown: 0.34
  } : {
    opacity: 0.96,
    readability: 0.86,
    bloom: 1,
    glowCap: 1.0,
    outgoing: 1,
    easeDown: 0.16
  };
  var shelfLyricAvoid = shouldAvoidStageLyricsForShelf();
  var wallpaperLyricLock = shouldUseWallpaperLyricCameraLock();
  var wallpaperShelfLyrics = wallpaperLyricLock && shouldDimWallpaperForShelf();
  var dualLineLayoutLock = lyricDualLineStackActive();
  var sonicLyricPreset = isSonicTopographyPresetActive();
  if (sonicLyricPreset) {
    layoutScale *= 0.90;
    layoutY = clampRange(layoutY + 0.26, -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 1.05, -1.6, 1.6);
  } else if (wallpaperLyricLock) {
    layoutScale *= wallpaperShelfLyrics ? 0.60 : 0.84;
    layoutX = clampRange(layoutX + (wallpaperShelfLyrics ? -1.34 : 0), -2.0, 2.0);
    layoutY = clampRange(layoutY + (wallpaperShelfLyrics ? -0.04 : 0.08), -1.2, 1.35);
    layoutZ = clampRange(layoutZ + (wallpaperShelfLyrics ? 1.02 : 1.15), -1.6, 1.6);
  } else if (dualLineLayoutLock && !skullMouthLyrics) {
    layoutScale *= 0.88;
    layoutY = clampRange(layoutY + ((stageLyrics.next2 || stageLyrics.next2Text) ? 0.30 : (stageLyrics.next || stageLyrics.nextText ? 0.22 : 0.16)), -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 0.92, -1.6, 1.6);
  } else if (!skullMouthLyrics && shelfLyricAvoid && fx.lyricCameraLock) {
    layoutScale *= 0.72;
    layoutX = clampRange(layoutX - 1.36, -2.0, 2.0);
    layoutY = clampRange(layoutY + 0.06, -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 0.72, -1.6, 1.6);
  } else if (!skullMouthLyrics && shouldOffsetLyricsForShelfDetail()) {
    layoutScale *= normalShelfDetailOpen ? 0.56 : 0.70;
    layoutX = clampRange(layoutX - (normalShelfDetailOpen ? 1.78 : 1.58), -2.0, 2.0);
    layoutY = clampRange(layoutY + (normalShelfDetailOpen ? 0.18 : 0.08), -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 0.84, -1.6, 1.6);
  }
  if (skullMouthLyrics) {
    layoutScale *= skullShelfDetailOpen ? 0.52 : (shelfLyricAvoid ? 0.58 : 0.66);
    if (shelfLyricAvoid && !skullShelfDetailOpen) {
      layoutX = clampRange(layoutX - 0.36, -2.0, 2.0);
      layoutY = clampRange(layoutY + 0.02, -1.2, 1.35);
      layoutZ = clampRange(layoutZ + 0.18, -1.6, 1.6);
    }
  }
  // 歌词上下浮动：在 layoutY 上叠加缓慢正弦浮动，下方三个布局分支(skullMouth/cameraLock/normal)都会继承
  if (fx.lyricVerticalFloat) {
    layoutY = layoutY + Math.sin(t * 0.9) * 0.14 + Math.sin(t * 0.37 + 1.3) * 0.05;
  }
  var lockBaseDistance = wallpaperShelfLyrics ? 5.58 : (dualLineLayoutLock ? 5.12 : 4.85);
  var lockDistance = lockBaseDistance + layoutZ;
  var cameraLockedLyrics = (fx.lyricCameraLock || wallpaperLyricLock || dualLineLayoutLock) && camera;
  var skullLyricEdgeGuard = !!(fx && fx.preset === SKULL_PRESET_INDEX && (orbit.centerLocked || orbit.recentering));
  var lockFit = (cameraLockedLyrics || skullLyricEdgeGuard || skullMouthLyrics) ? lyricCameraLockFit(layoutScale, layoutX, layoutY, skullMouthLyrics ? Math.max(2.2, 4.4 + layoutZ) : lockDistance) : 1;
  if (skullMouthLyrics) lockFit = Math.min(lockFit, 1.12);
  if (!isFinite(stageLyrics.lockFitScale)) stageLyrics.lockFitScale = 1;
  var lockFitEase = lyricDualLineStackActive() ? (lockFit < stageLyrics.lockFitScale ? 0.24 : 0.16) : (lockFit < stageLyrics.lockFitScale ? 0.18 : 0.10);
  stageLyrics.lockFitScale += (lockFit - stageLyrics.lockFitScale) * lockFitEase;
  stageLyrics.group.scale.setScalar(layoutScale * stageLyrics.lockFitScale);
  if (skullMouthLyrics) {
    stageLyrics.snapCameraLockFrames = 0;
    skullParticleGroup.updateMatrixWorld(true);
    skullLyricMouthTarget.copy(skullLyricMouthLocal).applyMatrix4(skullParticleGroup.matrixWorld);
    skullParticleGroup.getWorldQuaternion(skullLyricMouthQuat);
    skullLyricMouthForward.set(0, 0, 1).applyQuaternion(skullLyricMouthQuat);
    skullLyricMouthTarget.addScaledVector(skullLyricMouthForward, 0.020);
    skullLyricReadableQuat.copy(skullLyricMouthQuat);
    setStageLyricViewBasisFromCameraOrQuaternion(skullLyricMouthQuat);
    lyricLayoutTarget.copy(skullLyricMouthTarget);
    applyStageLyricLayoutOffset(lyricLayoutTarget, layoutX, layoutY, layoutZ);
    stageLyricTargetQuaternion(skullLyricReadableQuat, layoutTiltX, layoutTiltY);
    stageLyrics.group.userData = stageLyrics.group.userData || {};
    if (!stageLyrics.group.userData.skullMouthLocked) {
      stageLyrics.group.position.copy(lyricLayoutTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      stageLyrics.group.userData.skullMouthLocked = true;
    } else {
      stageLyrics.group.position.lerp(lyricLayoutTarget, 0.26);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, 0.30);
    }
  } else if (cameraLockedLyrics) {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    setStageLyricViewBasisFromCameraOrQuaternion(null);
    lyricLayoutBase.copy(camera.position).addScaledVector(lyricCameraDir, lockBaseDistance);
    lyricCameraTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricCameraTarget, layoutX, layoutY, layoutZ);
    stageLyricTargetQuaternion(camera.quaternion, layoutTiltX, layoutTiltY);
    if (stageLyrics.snapCameraLockFrames > 0) {
      stageLyrics.group.position.copy(lyricCameraTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      stageLyrics.snapCameraLockFrames -= 1;
    } else {
      var lockPosEase = wallpaperLyricLock ? (wallpaperShelfLyrics ? 0.42 : 0.34) : 0.24;
      var lockQuatEase = wallpaperLyricLock ? (wallpaperShelfLyrics ? 0.44 : 0.36) : 0.22;
      stageLyrics.group.position.lerp(lyricCameraTarget, lockPosEase);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, lockQuatEase);
    }
  } else {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    stageLyrics.snapCameraLockFrames = 0;
    if (particles) {
      particles.updateMatrixWorld(true);
      particles.getWorldPosition(lyricCoverWorldPos);
      particles.getWorldQuaternion(lyricCoverWorldQuat);
    } else {
      lyricCoverWorldPos.set(0, 0, 0);
      lyricCoverWorldQuat.identity();
    }
    setStageLyricViewBasisFromCameraOrQuaternion(lyricCoverWorldQuat);
    lyricLayoutBase.copy(lyricCoverWorldPos);
    lyricLayoutTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricLayoutTarget, layoutX, layoutY, layoutZ);
    stageLyrics.group.position.copy(lyricLayoutTarget);
    stageLyricTargetQuaternion(lyricCoverWorldQuat, layoutTiltX, layoutTiltY);
    stageLyrics.group.quaternion.copy(lyricTargetQuat);
  }
  function tickMesh(mesh, isCurrent, isNextLine) {
    if (!mesh || !mesh.userData) return false;
    var meshRole = (mesh.userData.lyricRole === 'next2' || mesh.userData.lyricRole === 'next' || mesh.userData.lyricRole === 'current')
      ? mesh.userData.lyricRole
      : (isNextLine ? 'next' : 'current');
    if (meshRole === 'next' || meshRole === 'next2') isNextLine = true;
    else isNextLine = !!isNextLine;
    var holdingForLyricReveal = false;
    if (!isCurrent && mesh.userData.lyricRevealSuccessor) {
      var revealSuccessor = mesh.userData.lyricRevealSuccessor;
      if (
        stageLyrics.current !== revealSuccessor
        || !revealSuccessor
        || !revealSuccessor.parent
        || (typeof stageLyricTrackRevealReady === 'function' && stageLyricTrackRevealReady(revealSuccessor))
      ) {
        mesh.userData.lyricRevealSuccessor = null;
        mesh.userData.age = 0;
      } else {
        holdingForLyricReveal = true;
        mesh.userData.age = 0;
      }
    }
    if (!holdingForLyricReveal) mesh.userData.age += dt;
    var dataEarly = mesh.userData.lyric || {};
    if (isCurrent && dataEarly.usesTrack && !mesh.userData._lyricFailOpenDone) {
      // Step B：0 usable rows 同栈立即回落，不等 450ms
      if (typeof stageLyricTrackMeshNeedsHardFailOpen === 'function' && stageLyricTrackMeshNeedsHardFailOpen(mesh)) {
        mesh.userData._lyricFailOpenDone = true;
        try {
          stageLyricFailOpenLegacyFromTrack(mesh, 'empty-track-tick');
        } catch (failErr) {
          console.warn('[row-layers] fail-open threw:', failErr);
        }
        return !!stageLyrics.current;
      }
      var nowReveal = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      // 暂停/未播放时不累计 fail-open 计时：此时露字本来就不会推进，
      // 累计只会造成「刚加载就暂停」的歌 900ms 后误报并锁死本会话。
      var actuallyPlayingReveal = !!(playing && audio && !audio.paused && !audio.ended);
      if (!actuallyPlayingReveal) mesh.userData.lyricRevealWatchAt = nowReveal;
      else if (!mesh.userData.lyricRevealWatchAt) mesh.userData.lyricRevealWatchAt = nowReveal;
      var revealWait = nowReveal - mesh.userData.lyricRevealWatchAt;
      var revealPending = dataEarly.renderInitialTextReady !== true;
      var opaqueEnough = false;
      if (!revealPending && dataEarly.rowLayers && dataEarly.rowLayers.length) {
        for (var oi = 0; oi < dataEarly.rowLayers.length; oi++) {
          var orow = dataEarly.rowLayers[oi];
          if (!orow || !orow.isActive) continue;
          var omat = orow.mat;
          var opv = omat && omat.uniforms && omat.uniforms.uOpacity
            ? Number(omat.uniforms.uOpacity.value) || 0
            : (omat ? Number(omat.opacity) || 0 : 0);
          if (opv > 0.04) { opaqueEnough = true; break; }
        }
      }
      if (typeof stageLyricTrackRevealReady === 'function' && stageLyricTrackRevealReady(mesh) && opaqueEnough) {
        // reveal-ready：已露字，不 fail-open
      } else if (revealWait > STAGE_LYRIC_REVEAL_FAILOPEN_MS && (revealPending || !opaqueEnough)) {
        mesh.userData._lyricFailOpenDone = true;
        try {
          stageLyricFailOpenLegacyFromTrack(mesh, revealPending ? 'reveal-timeout' : 'opacity-timeout');
        } catch (failErr) {
          console.warn('[row-layers] fail-open threw:', failErr);
        }
        return !!stageLyrics.current;
      }
    }
    if (isCurrent && dataEarly.usesTrack && dataEarly.rowLayers && dataEarly.rowLayers.length && typeof updateLyricRowLayers === 'function') {
      try {
        if (typeof commitStageLyricPersistentPendingTarget === 'function') {
          commitStageLyricPersistentPendingTarget(mesh);
        }
      } catch (_) {}
      var opacityTrack = shelfDetailLyricProfile.opacity;
      var shownProgressTrack = mesh.userData.lastLyricProgress || 0;
      try {
        updateLyricRowLayers(dataEarly, {
          opacity: opacityTrack,
          readability: shelfDetailLyricProfile.readability,
          contextIntro: 1,
          shownProgress: shownProgressTrack,
          contextDrift: 0.02,
          style: (fx && fx.lyricMotionStyle) || 'float',
          time: t,
          seed: Number(mesh.userData.seed) || 0,
          jitterX: 0,
          jitterY: 0,
          glitchPulse: 0,
          targetIndex: dataEarly.trackTargetIndex,
          targetLineIndex: dataEarly.trackTargetLineIndex,
          targetVirtualIndex: dataEarly.trackTargetVirtualIndex,
          rowGlow: 0,
          rowGlowBeat: stageLyrics.beatGlow || 0,
          deltaTime: dt,
          ease: 0.14
        });
        // track 路径已接管透明度/位姿，勿再跑 legacy tick（会盖掉行层或抛缺 helper）
        if (mesh.userData.state !== 'out' && mesh.userData.state !== 'out-up') return true;
      } catch (err) {
        if (!(mesh.userData._rowLayerErrLogged)) {
          mesh.userData._rowLayerErrLogged = true;
          console.warn('[row-layers] updateLyricRowLayers:', err);
        }
        mesh.userData._rowLayerErrCount = (Number(mesh.userData._rowLayerErrCount) || 0) + 1;
        if (!mesh.userData._lyricFailOpenDone && mesh.userData._rowLayerErrCount >= 3) {
          mesh.userData._lyricFailOpenDone = true;
          try { stageLyricFailOpenLegacyFromTrack(mesh, 'row-layers-error'); } catch (_) {}
          return !!stageLyrics.current;
        }
      }
    }
    if (mesh.userData.state === 'out-up') {
      var upT = Math.min(1, mesh.userData.age / 0.30);
      upT = upT * upT;
      var dataUp = mesh.userData.lyric || {};
      var upOpacity = (1 - upT) * 0.88;
      if (dataUp.textMat) dataUp.textMat.uniforms.uOpacity.value = upOpacity;
      if (dataUp.readabilityMat) dataUp.readabilityMat.opacity = upOpacity * 0.52;
      if (dataUp.glowMat) dataUp.glowMat.opacity *= 0.86;
      if (dataUp.sunMat) dataUp.sunMat.opacity *= 0.84;
      mesh.position.y += dt * 0.82;
      mesh.position.z -= dt * 0.10;
      mesh.scale.setScalar(Math.max(0.84, 0.98 - upT * 0.12));
      return upT < 1;
    }
    var a = Math.min(1, mesh.userData.age / (isCurrent ? (isNextLine ? 0.72 : (mesh.userData.state === 'promote' ? 0.34 : 0.46)) : 0.34));
    if (isNextLine && mesh.userData.state === 'rise') a = mesh.userData.riseT || 0;
    a = a * a * (3 - 2 * a);
    var data = mesh.userData.lyric || {};
    var followMix = isCurrent ? 1.0 : 0.64;
    var glowX = stageLyrics.glowFollowX * followMix;
    var glowY = stageLyrics.glowFollowY * followMix;
    var glowRoll = stageLyrics.glowFollowRoll * followMix;
    if (data.glow) {
      data.glow.position.set(glowX * 0.14, glowY * 0.12, -0.006);
      data.glow.rotation.z = glowRoll * 0.30;
    }
    if (data.sun) {
      data.sun.position.set(glowX * 0.42, 0.02 + glowY * 0.34, -0.035);
      data.sun.rotation.z = glowRoll * 0.36;
    }
    if (data.sparks) {
      data.sparks.position.set(glowX * 0.24, glowY * 0.22, 0.010);
      data.sparks.rotation.z = glowRoll * 0.22;
    }
    var opacity = 0;
    if (isCurrent) {
      var shelfDetailLyricDim = shelfDetailLyricProfile.bloom;
      var lyricOpacityTarget = isNextLine ? shelfDetailLyricProfile.opacity * 0.90 : shelfDetailLyricProfile.opacity;
      if (isNextLine && mesh.userData.state === 'rise') {
        var riseVis = clampRange(((mesh.userData.riseT || 0) - 0.10) / 0.78, 0, 1);
        riseVis = riseVis * riseVis * (3 - 2 * riseVis);
        lyricOpacityTarget *= riseVis;
      }
      var currentOpacity = data.textMat ? data.textMat.uniforms.uOpacity.value : 0;
      var opacityEase = shelfDetailOpen && currentOpacity > lyricOpacityTarget ? shelfDetailLyricProfile.easeDown : (isNextLine ? 0.22 : (mesh.userData.state === 'promote' ? 0.24 : 0.18));
      opacity = clampRange(currentOpacity + (lyricOpacityTarget - currentOpacity) * opacityEase, 0, 1);
      if (data.textMat) data.textMat.uniforms.uOpacity.value = opacity;
      if (data.readabilityMat) {
        var readabilityTarget = opacity * (isNextLine ? shelfDetailLyricProfile.readability * 0.72 : shelfDetailLyricProfile.readability);
        var readabilityEase = shelfDetailOpen && data.readabilityMat.opacity > readabilityTarget ? 0.28 : (isNextLine ? 0.14 : 0.16);
        data.readabilityMat.opacity += (readabilityTarget - data.readabilityMat.opacity) * readabilityEase;
      }
      if (isNextLine && data.textMat && data.textMat.uniforms.uProgress) {
        data.textMat.uniforms.uProgress.value = 1;
      }
      if (!isNextLine && data.textMat && data.textMat.uniforms.uSolar) {
        var solarTarget = stageLyrics.highBloom * shelfDetailLyricDim;
        var solarEase = shelfDetailOpen && data.textMat.uniforms.uSolar.value > solarTarget ? 0.26 : 0.12;
        data.textMat.uniforms.uSolar.value += (solarTarget - data.textMat.uniforms.uSolar.value) * solarEase;
      }
      var solar = isNextLine ? 0 : stageLyrics.highBloom * shelfDetailLyricDim;
      var warmth = Math.max(0, Math.min(1, solar * 1.10));
      if (data.glowMat) {
        var _glowLift = (lyricMotionProfile().glowLift) || 1;
        var glowTarget = (!isNextLine && lyricGlowStrength > 0) ? Math.min(shelfDetailLyricProfile.glowCap, (0.075 + solar * 0.34 + stageLyrics.beatGlow * 0.16 * shelfDetailLyricDim) * Math.min(3.0, glowDrive) * _glowLift) : (isNextLine ? opacity * 0.04 * lyricGlowStrength : 0);
        data.glowMat.opacity += (glowTarget - data.glowMat.opacity) * (glowTarget > data.glowMat.opacity ? 0.095 : (shelfDetailOpen ? 0.20 : 0.055));
        data.glowMat.color.copy(lyricThreeColor(stageLyrics.palette.glowColor || stageLyrics.palette.secondary, '#9cffdf', 0.36)).lerp(lyricSunHotColor, warmth);
      }
      if (data.sparkMat) {
        var sparkTarget = (!isNextLine && lyricGlowStrength > 0 && fx.lyricGlowParticles && !shelfDetailOpen) ? Math.min(0.42, (0.10 + solar * 0.14 + stageLyrics.beatGlow * 0.10) * Math.min(1.6, glowDrive)) : 0;
        var sparkOpacity = getLyricSparkOpacity(data);
        sparkOpacity += (sparkTarget - sparkOpacity) * (sparkTarget > sparkOpacity ? 0.13 : (shelfDetailOpen ? 0.22 : 0.075));
        setLyricSparkOpacity(data, sparkOpacity);
        var sparkSizeTarget = fx.lyricGlowParticles && !shelfDetailOpen ? (0.050 + solar * 0.016 + stageLyrics.beatGlow * 0.026 + bass * 0.008) : 0.035;
        setLyricSparkSize(data, getLyricSparkSize(data) + (sparkSizeTarget - getLyricSparkSize(data)) * 0.12);
        var sparkColor = lyricSunHotColor.clone().lerp(lyricSunColor, 0.22 + solar * 0.18);
        setLyricSparkColor(data, sparkColor);
      }
      var seed = mesh.userData.floatSeed || 0;
      if (data.sunMat) {
        var sunTarget = (!isNextLine && lyricGlowStrength > 0 && !shelfDetailOpen) ? Math.min(0.88, (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + stageLyrics.beatGlow * 0.20) * Math.min(2.4, glowDrive) * _glowLift) : 0;
        data.sunMat.opacity += (sunTarget - data.sunMat.opacity) * (shelfDetailOpen ? 0.18 : 0.055);
        data.sunMat.color.copy(lyricSunColor).lerp(lyricSunHotColor, solar * 0.55);
      }
      if (data.sun) {
        var sunPulse = solar;
        var beatScale = fx.lyricGlowBeat ? stageLyrics.beatGlow * 0.24 : 0;
        data.sun.scale.set(0.82 + sunPulse * 0.36 + beatScale + Math.sin(t * 1.6) * sunPulse * 0.018, 0.60 + sunPulse * 0.34 + beatScale * 0.72 + Math.cos(t * 1.25) * sunPulse * 0.020, 1);
        data.sun.rotation.z += Math.sin(t * 0.32 + seed) * 0.010 * sunPulse;
      }
      var roleOff = lyricMeshRoleOffsets(meshRole);
      var motion = computeLyricMotion(fx.lyricMotionStyle || 'float', t, seed);
      var breathe = motion.breathe;
      var rotZAdd = motion.rotZAdd;
      var posXAdd = motion.posXAdd;
      var glowMod = motion.glowMod !== undefined ? motion.glowMod : 1;
      var shineMod = motion.shineMod !== undefined ? motion.shineMod : 0;
      // 动画样式驱动的材质特效（仅当前行，需开启歌词辉光）
      if (!isNextLine && lyricGlowStrength > 0) {
        if (glowMod !== 1 && data.glowMat) data.glowMat.opacity *= glowMod;
        if (shineMod > 0 && data.sunMat) {
          data.sunMat.opacity = Math.max(data.sunMat.opacity, shineMod * 0.65);
          if (data.sun) data.sun.scale.set(0.82 + shineMod * 0.38, 0.60 + shineMod * 0.30, 1);
        }
      }
      // 动态更新 shader uniforms（扫光/闪烁/边缘高光随样式变化）
      if (data.textMat && data.textMat.uniforms) {
        var _mp = lyricMotionProfile();
        if (data.textMat.uniforms.uSweep) data.textMat.uniforms.uSweep.value = _mp.sweep;
        if (data.textMat.uniforms.uShimmer) data.textMat.uniforms.uShimmer.value = _mp.shimmer;
        if (data.textMat.uniforms.uEdgeBoost) data.textMat.uniforms.uEdgeBoost.value = _mp.edgeBoost;
      }
      if (skullMouthLyrics) {
        var mouthMeshY = -0.070 + Math.sin(t * 0.50 + seed) * 0.018 + Math.sin(t * 1.12 + seed) * 0.006;
        var mouthMeshZ = 0.018 + Math.cos(t * 0.46 + seed) * 0.007;
        var mouthMeshScale = 1.08 + a * 0.040 + breathe * 0.12 + bass * 0.024 + beatPulse * 0.014;
        if (!mesh.userData.skullMouthMeshLocked) {
          mesh.position.set(0, mouthMeshY, mouthMeshZ);
          mesh.userData.skullMouthMeshLocked = true;
        } else {
          mesh.position.x += (posXAdd - mesh.position.x) * 0.18;
          mesh.position.y += (mouthMeshY - mesh.position.y) * 0.16;
          mesh.position.z += (mouthMeshZ - mesh.position.z) * 0.18;
        }
        mesh.scale.setScalar(mouthMeshScale);
        mesh.rotation.z = Math.sin(t * 0.30 + seed) * 0.010 + rotZAdd;
      } else {
        mesh.userData.skullMouthMeshLocked = false;
        var posEase = isNextLine ? 0.16 : (mesh.userData.state === 'promote' ? 0.34 : 0.16);
        if (mesh.userData.state === 'promote') {
          if (!mesh.userData.promoteAnchorSaved) {
            mesh.userData.promoteAnchorY = mesh.position.y;
            mesh.userData.promoteAnchorZ = mesh.position.z;
            mesh.userData.promoteAnchorScale = mesh.scale.x;
            mesh.userData.promoteAnchorSaved = true;
          }
          mesh.userData.promoteT = Math.min(1, (mesh.userData.promoteT || 0) + dt / 0.38);
          var pt = mesh.userData.promoteT;
          pt = pt * pt * (3 - 2 * pt);
          var curOff = lyricMeshRoleOffsets('current');
          var anchorY = mesh.userData.promoteAnchorY;
          var anchorZ = mesh.userData.promoteAnchorZ;
          var anchorScale = mesh.userData.promoteAnchorScale;
          var targetY = anchorY + (curOff.y - anchorY) * pt + breathe;
          var targetZ = anchorZ + (curOff.z - anchorZ) * pt + 0.02;
          var targetScale = anchorScale + (curOff.scale - anchorScale) * pt + breathe * 0.04;
          mesh.position.y += (targetY - mesh.position.y) * posEase;
          mesh.position.z += (targetZ - mesh.position.z) * posEase;
          mesh.position.x += (posXAdd - mesh.position.x) * posEase;
          mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * posEase);
          if (mesh.userData.promoteT >= 1) {
            mesh.userData.state = 'in';
            mesh.userData.riseT = 1;
          }
        } else if (isNextLine && mesh.userData.state === 'rise') {
          var spawnOff = lyricMeshSpawnOffset(meshRole);
          var nextOff = lyricMeshRoleOffsets(meshRole);
          mesh.userData.riseT = Math.min(1, (mesh.userData.riseT || 0) + dt / 0.72);
          var rt = mesh.userData.riseT;
          rt = rt * rt * (3 - 2 * rt);
          var targetY = spawnOff.y + (nextOff.y - spawnOff.y) * rt + breathe * 0.22 * rt;
          var targetZ = spawnOff.z + (nextOff.z - spawnOff.z) * rt;
          var targetScale = spawnOff.scale + (nextOff.scale - spawnOff.scale) * rt + breathe * 0.04 * rt;
          mesh.position.y += (targetY - mesh.position.y) * posEase;
          mesh.position.z += (targetZ - mesh.position.z) * posEase;
          mesh.position.x += (posXAdd - mesh.position.x) * posEase;
          mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * posEase);
          mesh.rotation.z = Math.sin(t * 0.34 + seed) * 0.008 * rt + rotZAdd;
          if (mesh.userData.riseT >= 1) mesh.userData.state = 'in';
        } else {
          var targetY = roleOff.y + (isNextLine ? breathe * 0.28 : breathe);
          var targetZ = roleOff.z + (isNextLine ? 0 : 0.02);
          mesh.scale.setScalar(roleOff.scale + a * 0.055 + (isNextLine ? breathe * 0.06 : breathe) + bass * 0.038 + beatPulse * 0.014);
          mesh.position.y += (targetY - mesh.position.y) * posEase;
          mesh.position.z += (targetZ + Math.cos(t * 0.48 + seed) * 0.080 - mesh.position.z) * (isNextLine ? 0.14 : 0.12);
          mesh.position.x += (posXAdd - mesh.position.x) * posEase;
          mesh.rotation.z = Math.sin(t * 0.34 + seed) * (isNextLine ? 0.010 : 0.018) + rotZAdd;
        }
      }
      if (data.sparks && data.sparkMat) data.sparks.visible = fx.lyricGlowParticles || getLyricSparkOpacity(data) > 0.015;
      // P0：火花漂移在 vertex shader，主线程只推几个 uniform（不再扫 position 数组）
      if (data.sparks && data.sparkMat && data.sparkMat.uniforms && fx.lyricGlowParticles && getLyricSparkOpacity(data) > 0.012) {
        var su = data.sparkMat.uniforms;
        if (su.uTime) su.uTime.value = t;
        if (su.uBass) su.uBass.value = bass;
        if (su.uMid) su.uMid.value = mid;
        if (su.uBeat) su.uBeat.value = fx.lyricGlowParticles ? stageLyrics.beatGlow : 0;
        if (su.uDrift) su.uDrift.value = 1;
        data.sparks.rotation.z += (0.0009 + stageLyrics.beatGlow * 0.0007) * (dt * 60);
        data.sparks.rotation.x = Math.sin(t * 0.12 + seed) * 0.012;
      }
      return true;
    }
    opacity = holdingForLyricReveal
      ? clampRange(Number(data.globalOpacity) || shelfDetailLyricProfile.opacity, 0, 1)
      : (1 - a) * 0.72 * shelfDetailLyricProfile.outgoing;
    if (data.textMat && data.textMat.uniforms && data.textMat.uniforms.uOpacity) {
      data.textMat.uniforms.uOpacity.value = opacity;
    }
    if (data.readabilityMat) data.readabilityMat.opacity = opacity * (shelfDetailOpen ? shelfDetailLyricProfile.readability : 0.58);
    if (holdingForLyricReveal && data.usesTrack && data.rowLayers && typeof updateLyricRowLayers === 'function') {
      try {
        updateLyricRowLayers(data, {
          opacity: opacity,
          readability: shelfDetailOpen ? shelfDetailLyricProfile.readability : 0.58,
          contextIntro: 1,
          shownProgress: mesh.userData.lastLyricProgress || 0,
          contextDrift: 0.02,
          style: (fx && fx.lyricMotionStyle) || 'float',
          time: t,
          seed: Number(mesh.userData.floatSeed) || 0,
          jitterX: 0,
          jitterY: 0,
          glitchPulse: 0,
          targetIndex: data.trackTargetIndex,
          targetLineIndex: data.trackTargetLineIndex,
          targetVirtualIndex: data.trackTargetVirtualIndex,
          rowGlow: 0,
          rowGlowBeat: stageLyrics.beatGlow || 0,
          deltaTime: dt,
          ease: 0.22
        });
      } catch (_) {}
      return true;
    }
    if (data.textMat && data.textMat.uniforms.uSolar) data.textMat.uniforms.uSolar.value *= shelfDetailOpen ? 0.72 : 0.86;
    if (data.glowMat) data.glowMat.opacity = lyricGlowStrength > 0 ? (shelfDetailOpen ? Math.min(shelfDetailLyricProfile.glowCap * 0.40, opacity * 0.05 * lyricGlowStrength) : opacity * 0.08 * lyricGlowStrength) : 0;
    if (data.sparkMat) {
      var outgoingSpark = lyricGlowStrength > 0 && fx.lyricGlowParticles && !shelfDetailOpen ? Math.max(opacity * 0.24 * lyricGlowStrength, (1 - a) * 0.18 * lyricGlowStrength) : 0;
      setLyricSparkOpacity(data, outgoingSpark);
      setLyricSparkSize(data, 0.046 + (1 - a) * 0.020);
    }
    if (data.sunMat) data.sunMat.opacity = lyricGlowStrength > 0 && !shelfDetailOpen ? opacity * 0.08 * lyricGlowStrength : 0;
    mesh.position.z -= dt * 0.26;
    mesh.position.y += dt * 0.08;
    mesh.scale.setScalar(0.98 - a * 0.06);
    return a < 1;
  }
  tickMesh(stageLyrics.current, true, !!(stageLyrics.current && stageLyrics.current.userData && (stageLyrics.current.userData.lyricRole === 'next' || stageLyrics.current.userData.lyricRole === 'next2')));
  if (stageLyrics.next) tickMesh(stageLyrics.next, true, true);
  if (stageLyrics.next2) tickMesh(stageLyrics.next2, true, true);
  for (var i = stageLyrics.outgoing.length - 1; i >= 0; i--) {
    if (!tickMesh(stageLyrics.outgoing[i], false)) {
      disposeLyricMesh(stageLyrics.outgoing[i]);
      stageLyrics.outgoing.splice(i, 1);
    }
  }
}

function getLyricLineProgress(line, nextLine, now) {
  if (!line) return 0;
  now += line.words && line.words.length ? 0.030 : 0.020;
  if (line.words && line.words.length && line.charCount > 0) {
    var lastP = 0;
    for (var i = 0; i < line.words.length; i++) {
      var w = line.words[i];
      var ws = w.t;
      var we = w.t + Math.max(0.08, w.d || 0.24);
      if (now < ws) return lastP;
      var local = now >= we ? 1 : (now - ws) / Math.max(0.08, we - ws);
      local = Math.max(0, Math.min(1, local));
      var p = (w.c0 + (w.c1 - w.c0) * local) / line.charCount;
      lastP = Math.max(lastP, p);
      if (now < we) return lastP;
    }
    return 1;
  }
  var nextT = nextLine && nextLine.t > line.t ? nextLine.t : Math.min((audio && audio.duration) || now + 4, line.t + (line.duration || 4.8));
  var span = Math.max(0.75, nextT - line.t);
  var prog = Math.max(0, Math.min(1, (now - line.t) / span));
  return prog * prog * (3 - 2 * prog);
}

function tickLyricsParticles() {
  if (!fx.particleLyrics) {
    if (stageLyrics.current || stageLyrics.next || stageLyrics.next2 || stageLyrics.currentText || stageLyrics.nextText || stageLyrics.next2Text || (stageLyrics.outgoing && stageLyrics.outgoing.length)) clearStageLyrics();
    return;
  }
  if (!playing || !audio || !lyricsLines.length) {
    // 暂停保留歌词：真暂停(非曲目结束)且开启时，保留当前歌词不退出
    var _pauseHold = fx.lyricPauseHold && audio && audio.paused && !audio.ended && lyricsLines.length && stageLyrics.current;
    if (!_pauseHold) {
      if (stageLyrics.current) {
        stageLyrics.current.userData.state = 'out';
        stageLyrics.current.userData.age = 0;
        stageLyrics.outgoing.push(stageLyrics.current);
        stageLyrics.current = null;
        stageLyrics.currentIdx = -1;
        stageLyrics.currentText = '';
      }
      hideStageNextLineSmooth();
      hideStageNext2LineSmooth();
    }
    return;
  }
  var t = getAdjustedLyricPlaybackTime(stageLyricPlaybackSeconds());
  var newIdx = -1;
  for (var i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].t <= t + 0.05) newIdx = i; else break;
  }
  if (newIdx < 0) {
    var introText = currentLyricFallbackText();
    if (!introText) {
      clearStageLyrics();
      return;
    }
    if (stageLyrics.currentIdx !== -2 || stageLyrics.currentText !== introText) {
      stageLyrics.currentIdx = -2;
      showStageLine(introText);
    }
    syncStageLyricPreviewLines(-2);
    if (stageLyrics.current) {
      var firstLine = lyricsLines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      var introLine = { t:0, text:introText, duration:Math.max(0.8, introEnd), charCount:Math.max(1, introText.length), fallback:true };
      updateLyricMeshProgress(stageLyrics.current, getLyricLineProgress(introLine, null, t));
    }
    return;
  }
  if (newIdx !== stageLyrics.currentIdx) {
    if (stageLyricWantRowLayers() && typeof buildStageLyricDisplayPayload === 'function') {
      stageLyrics.transitionLineStep = stageLyrics.currentIdx >= 0
        ? clampRange(newIdx - stageLyrics.currentIdx, -2, 2)
        : 0;
      var lightPayload = null;
      try {
        lightPayload = buildStageLyricDisplayPayload(newIdx, { lightweightTrack: true });
        if (lightPayload && typeof normalizeStageLyricPayload === 'function') {
          lightPayload = normalizeStageLyricPayload(lightPayload);
        }
      } catch (_) { lightPayload = null; }
      var displayed = showStageLine(lightPayload || enrichLyricText(lyricsLines[newIdx].text || '', newIdx), false, { noSyncBuild: true });
      if (!displayed && lightPayload) {
        displayed = showStageLine(lightPayload, false, { noSyncBuild: false });
      }
      if (!displayed) {
        if (typeof requestStageLyricDemandPrewarm === 'function' && lightPayload) {
          requestStageLyricDemandPrewarm(lightPayload);
        }
        // 未上屏则不推进 currentIdx，下一帧再试（避免空窗索引错乱）
      } else {
        stageLyrics.currentIdx = newIdx;
        if (typeof upgradeCurrentStageLyricFromPreparedTrack === 'function') {
          try { upgradeCurrentStageLyricFromPreparedTrack('line-change'); } catch (_) {}
        }
        if (typeof scheduleStageLyricDemandMeshPrewarm === 'function' && newIdx + 1 < lyricsLines.length) {
          scheduleStageLyricDemandMeshPrewarm(newIdx + 1, 'track-demand-next', 32);
        }
      }
    } else {
      stageLyrics.currentIdx = newIdx;
      showStageLine(enrichLyricText(lyricsLines[newIdx].text || '', newIdx));
    }
  } else if (stageLyricWantRowLayers() && typeof upgradeCurrentStageLyricFromPreparedTrack === 'function') {
    try { upgradeCurrentStageLyricFromPreparedTrack('same-line-upgrade'); } catch (_) {}
  }
  if (stageLyrics.current) {
    var curLine = lyricsLines[newIdx] || { t:t };
    var nextLine = lyricsLines[newIdx + 1];
    var progress = getLyricLineProgress(curLine, nextLine, t);
    updateLyricMeshProgress(stageLyrics.current, progress);
  }
  syncStageLyricPreviewLines(newIdx);
}

function disposeLyricsParticles() {
  clearStageLyrics();
  if (stageLyrics.starRiver) {
    if (stageLyrics.starRiver.parent) stageLyrics.starRiver.parent.remove(stageLyrics.starRiver);
    if (stageLyrics.starRiver.geometry) stageLyrics.starRiver.geometry.dispose();
    if (stageLyrics.starRiver.material) stageLyrics.starRiver.material.dispose();
    stageLyrics.starRiver = null;
  }
  if (stageLyrics.group) {
    scene.remove(stageLyrics.group);
    stageLyrics.group = null;
  }
}
