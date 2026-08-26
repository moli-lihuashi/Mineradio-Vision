// ============================================================
//  空场待机引导
// ============================================================
var idleGuideCanvas = null;
var idleGuideCtx = null;
var idleGuideW = 0, idleGuideH = 0, idleGuideDpr = 1;
var idleGuideParticles = [];
var idleGuideTrails = [[], [], [], []];
var idleGuideStartedAt = performance.now();
var idleGuideVisible = false;
var idleGuideLastFrameAt = performance.now();
var idleGuideDelayTimer = null;
var idleGuideRaf = null;
var idleGuideIdleSince = 0;
// Keep Wallpaper as the only startup idle background.
var IDLE_GUIDE_BACKGROUND_ENABLED = false;
var idleGuideInteraction = {
  angle: 0,
  velocity: 0,
  rotX: -0.12,
  rotY: 0,
  spinX: 0,
  spinY: 0,
  zoom: 1,
  zoomTarget: 1,
  zoomPulse: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  pointerActive: false,
  focus: 0,
  press: 0,
  tiltX: 0,
  tiltY: 0
};
function setIdleGuideVisible(show, interactive) {
  document.body.classList.toggle('idle-guide-on', show);
  document.body.classList.toggle('idle-guide-interactive', !!interactive);
  if (!interactive) document.body.classList.remove('idle-guide-dragging');
  if (idleGuideVisible === show) return;
  idleGuideVisible = show;
}
function shouldShowIdleGuide() {
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return false;
  if (document.body.classList.contains('splash-active')) return false;
  if (immersiveMode) return false;
  if (playing) return false;
  if (loginGuideAnimating) return false;
  if (document.querySelector('.modal-mask.show')) return false;
  if (uniforms && uniforms.uHasCover && uniforms.uHasCover.value > 0.5) return false;
  return true;
}
function shouldShowShelfHoverCue(value) {
  if (document.body.classList.contains('splash-active')) return false;
  if (!shelfHoverCue.guide && document.querySelector('.modal-mask.show')) return false;
  if (!shelfHoverCue.guide) {
    if (shelfPinnedOpen) return false;
    if (!shelfManager || !shelfManager.canInteract || !shelfManager.canInteract()) return false;
    if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
    if (!shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  }
  return shelfHoverCue.guide || shelfHoverCue.target > 0 || (value || shelfHoverCue.value) > 0.015;
}
function shouldHandleIdleGuidePointer(e) {
  if (!idleGuideCanvas || !shouldShowIdleGuide()) return false;
  if (isPointerOverUi(e)) return false;
  return true;
}
function clampIdleGuideSpin(v) {
  if (!isFinite(v)) return 0;
  return Math.max(-4.8, Math.min(4.8, v));
}
function idleGuidePointerDown(e) {
  if (!shouldHandleIdleGuidePointer(e)) return;
  idleGuideInteraction.dragging = true;
  idleGuideInteraction.pointerActive = true;
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = performance.now();
  idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  document.body.classList.add('idle-guide-dragging');
}
function idleGuidePointerMove(e) {
  if (!idleGuideCanvas) return;
  var canReact = shouldHandleIdleGuidePointer(e) || idleGuideInteraction.dragging;
  idleGuideInteraction.pointerActive = canReact;
  if (canReact) {
    idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
    idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  }
  if (!idleGuideInteraction.dragging) return;
  var now = performance.now();
  var dt = Math.max(1 / 120, Math.min(0.08, (now - idleGuideInteraction.lastT) / 1000 || 1 / 60));
  var dx = e.clientX - idleGuideInteraction.lastX;
  var dy = e.clientY - idleGuideInteraction.lastY;
  var rx = -dy * 0.0032;
  var ry = dx * 0.0034;
  idleGuideInteraction.rotX += rx;
  idleGuideInteraction.rotY += ry;
  idleGuideInteraction.angle += ry * 0.22;
  idleGuideInteraction.spinX = clampIdleGuideSpin(rx / dt * 0.46);
  idleGuideInteraction.spinY = clampIdleGuideSpin(ry / dt * 0.46);
  idleGuideInteraction.velocity = Math.sqrt(idleGuideInteraction.spinX * idleGuideInteraction.spinX + idleGuideInteraction.spinY * idleGuideInteraction.spinY);
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = now;
}
function idleGuidePointerUp() {
  if (!idleGuideInteraction.dragging) return;
  idleGuideInteraction.dragging = false;
  document.body.classList.remove('idle-guide-dragging');
}
function idleGuidePointerLeave() {
  if (!idleGuideInteraction.dragging) idleGuideInteraction.pointerActive = false;
}
function idleGuideWheel(e) {
  if (!shouldHandleIdleGuidePointer(e)) return false;
  var guide = idleGuideInteraction;
  guide.pointerActive = true;
  guide.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  guide.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  var nextZoom = guide.zoomTarget * Math.exp(-e.deltaY * 0.0012);
  guide.zoomTarget = Math.max(0.58, Math.min(1.82, nextZoom));
  guide.zoomPulse = Math.min(1, guide.zoomPulse + Math.min(0.28, Math.abs(e.deltaY) * 0.0014));
  return true;
}
function resizeIdleGuideCanvas() {
  if (!idleGuideCanvas) return;
  idleGuideDpr = Math.min(window.devicePixelRatio || 1, 1.6);
  idleGuideW = window.innerWidth;
  idleGuideH = window.innerHeight;
  idleGuideCanvas.width = Math.max(1, Math.floor(idleGuideW * idleGuideDpr));
  idleGuideCanvas.height = Math.max(1, Math.floor(idleGuideH * idleGuideDpr));
  idleGuideCanvas.style.width = idleGuideW + 'px';
  idleGuideCanvas.style.height = idleGuideH + 'px';
  idleGuideCtx.setTransform(idleGuideDpr, 0, 0, idleGuideDpr, 0, 0);
  idleGuideParticles = [];
  resetIdleGuideTrails();
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return;
  var minDim = Math.min(idleGuideW, idleGuideH);
  var maxDim = Math.max(idleGuideW, idleGuideH);
  var count = idleGuideW < 800 ? 150 : 240;
  for (var i = 0; i < count; i++) {
    var ring = i < count * 0.76;
    var a = Math.random() * Math.PI * 2;
    var r = ring
      ? (minDim * 0.035 + Math.pow(Math.random(), 0.58) * minDim * 0.335)
      : (Math.pow(Math.random(), 0.82) * maxDim * 0.58);
    var wobbleAmp = minDim * (ring ? (0.012 + Math.random() * 0.035) : (0.010 + Math.random() * 0.055));
    idleGuideParticles.push({
      a: a,
      r: r,
      cx: ring ? 0.5 : Math.random(),
      cy: ring ? 0.5 : Math.random(),
      size: ring ? (0.30 + Math.random() * 0.62) : (0.18 + Math.random() * 0.44),
      speed: ((ring ? 0.018 : 0.010) + Math.random() * (ring ? 0.045 : 0.030)) * (Math.random() < 0.5 ? -1 : 1),
      phase: Math.random() * Math.PI * 2,
      wobbleAmp: wobbleAmp,
      wobbleSpeed: 0.18 + Math.random() * 0.76,
      oval: 0.56 + Math.random() * 0.36,
      zAmp: 0.34 + Math.random() * 0.82,
      driftX: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      driftY: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      layer: Math.random(),
      z: (Math.random() * 2 - 1) * (ring ? minDim * 0.28 : maxDim * 0.42),
      ring: ring
    });
  }
}
function projectIdleGuidePoint(x, y, z, rot, cx, cy, depth) {
  var x1 = x * rot.cy + z * rot.sy;
  var z1 = -x * rot.sy + z * rot.cy;
  var y1 = y * rot.cx - z1 * rot.sx;
  var z2 = y * rot.sx + z1 * rot.cx;
  var scale = depth / (depth - z2 * 0.72);
  scale = Math.max(0.52, Math.min(1.74, scale));
  return {
    x: cx + x1 * scale,
    y: cy + y1 * scale,
    z: z2,
    scale: scale
  };
}
function resetIdleGuideTrails() {
  idleGuideTrails = [[], [], [], []];
}
function pushIdleGuideTrail(index, pt, alpha, now) {
  var trail = idleGuideTrails[index];
  if (!trail) trail = idleGuideTrails[index] = [];
  var last = trail[trail.length - 1];
  var dx = last ? pt.x - last.x : 999;
  var dy = last ? pt.y - last.y : 999;
  if (!last || Math.sqrt(dx * dx + dy * dy) > 1.4 || now - last.t > 42) {
    trail.push({ x: pt.x, y: pt.y, scale: pt.scale || 1, alpha: alpha || 1, t: now });
  }
  while (trail.length > 26) trail.shift();
}
function drawIdleGuideTrail(ctx, trail, now, alpha, energy) {
  if (!trail || trail.length < 2) return;
  while (trail.length && now - trail[0].t > 680) trail.shift();
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (var i = 1; i < trail.length; i++) {
    var prev = trail[i - 1];
    var cur = trail[i];
    var age = (now - cur.t) / 680;
    var order = i / Math.max(1, trail.length - 1);
    var fade = Math.max(0, 1 - age) * order;
    if (fade <= 0) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * fade * (0.18 + energy * 0.24)).toFixed(3) + ')';
    ctx.lineWidth = (0.7 + cur.scale * 0.9 + energy * 1.2) * fade;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    var mx = (prev.x + cur.x) * 0.5;
    var my = (prev.y + cur.y) * 0.5;
    ctx.quadraticCurveTo(mx, my, cur.x, cur.y);
    ctx.stroke();
  }
  ctx.restore();
}
function scheduleIdleGuideFrame(delay) {
  if (idleGuideDelayTimer) {
    clearTimeout(idleGuideDelayTimer);
    idleGuideDelayTimer = null;
  }
  if (idleGuideRaf) {
    cancelAnimationFrame(idleGuideRaf);
    idleGuideRaf = null;
  }
  if (delay && delay > 0) {
    idleGuideDelayTimer = setTimeout(function(){
      idleGuideDelayTimer = null;
      idleGuideRaf = requestAnimationFrame(drawIdleGuideFrame);
    }, delay);
  } else {
    idleGuideRaf = requestAnimationFrame(drawIdleGuideFrame);
  }
}
function drawIdleGuideFrame() {
  idleGuideRaf = null;
  if (!idleGuideCanvas || !idleGuideCtx) return;
  // 页面隐藏时停止调度，由 visibilitychange 恢复
  if (document.hidden) return;
  var ctx = idleGuideCtx;
  var nowFrame = performance.now();
  var dtFrame = Math.max(1 / 120, Math.min(0.05, (nowFrame - idleGuideLastFrameAt) / 1000 || 1 / 60));
  idleGuideLastFrameAt = nowFrame;
  var idleShow = shouldShowIdleGuide();
  var shelfCueValue = tickShelfHoverCue(dtFrame);
  var shelfCueShow = shouldShowShelfHoverCue(shelfCueValue);
  var show = idleShow || shelfCueShow;
  setIdleGuideVisible(show, idleShow);
  if (!show) {
    idleGuideCtx.clearRect(0, 0, idleGuideW, idleGuideH);
    resetIdleGuideTrails();
    // 持续不显示 3 秒后停止调度，由用户交互唤醒
    if (!idleGuideIdleSince) idleGuideIdleSince = nowFrame;
    if (nowFrame - idleGuideIdleSince > 3000) {
      idleGuideIdleSince = 0;
      return;
    }
    scheduleIdleGuideFrame(140);
    return;
  }
  idleGuideIdleSince = 0;
  var t = (nowFrame - idleGuideStartedAt) / 1000;
  if (!idleShow) {
    ctx.clearRect(0, 0, idleGuideW, idleGuideH);
    resetIdleGuideTrails();
    ctx.globalCompositeOperation = 'lighter';
    drawShelfGuideCue(ctx, t, shelfCueValue);
    ctx.globalCompositeOperation = 'source-over';
    scheduleIdleGuideFrame(0);
    return;
  }
  var cx = idleGuideW * 0.5;
  var cy = idleGuideH * 0.50;
  var guide = idleGuideInteraction;
  if (!guide.dragging) {
    guide.rotX += guide.spinX * dtFrame;
    guide.rotY += guide.spinY * dtFrame;
    guide.spinX *= Math.pow(0.90, dtFrame * 60);
    guide.spinY *= Math.pow(0.90, dtFrame * 60);
    if (Math.abs(guide.spinX) < 0.01) guide.spinX = 0;
    if (Math.abs(guide.spinY) < 0.01) guide.spinY = 0;
  }
  guide.rotY += 0.012 * dtFrame;
  guide.angle += guide.spinY * dtFrame * 0.20 + 0.010 * dtFrame;
  guide.velocity = Math.sqrt(guide.spinX * guide.spinX + guide.spinY * guide.spinY);
  var targetFocus = guide.pointerActive ? 1 : 0;
  var targetPress = guide.dragging ? 1 : 0;
  guide.focus += (targetFocus - guide.focus) * 0.10;
  guide.press += (targetPress - guide.press) * 0.16;
  guide.zoom += (guide.zoomTarget - guide.zoom) * 0.13;
  guide.zoomPulse *= Math.pow(0.84, dtFrame * 60);
  if (guide.zoomPulse < 0.002) guide.zoomPulse = 0;
  guide.tiltX += (((guide.pointerX - 0.5) * 0.26) - guide.tiltX) * 0.08;
  guide.tiltY += (((guide.pointerY - 0.5) * 0.18) - guide.tiltY) * 0.08;
  ctx.clearRect(0, 0, idleGuideW, idleGuideH);
  ctx.globalCompositeOperation = 'lighter';

  var breathe = 0.5 + 0.5 * Math.sin(t * 0.72);
  var zoom = guide.zoom;
  var zoomBoost = guide.zoomPulse;
  var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(idleGuideW, idleGuideH) * ((0.36 + breathe * 0.035 + guide.press * 0.018) * zoom));
  halo.addColorStop(0, 'rgba(255,255,255,' + (0.034 + breathe * 0.020 + guide.focus * 0.014 + guide.press * 0.018 + zoomBoost * 0.018).toFixed(3) + ')');
  halo.addColorStop(0.44, 'rgba(255,255,255,' + (0.014 + guide.focus * 0.010).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, idleGuideW, idleGuideH);

  var ringPts = [];
  var pointerX = guide.pointerX * idleGuideW;
  var pointerY = guide.pointerY * idleGuideH;
  var spinEnergy = Math.min(1, guide.velocity / 1.5 + guide.press * 0.42);
  var rot = {
    sx: Math.sin(guide.rotX),
    cx: Math.cos(guide.rotX),
    sy: Math.sin(guide.rotY),
    cy: Math.cos(guide.rotY)
  };
  var depth = Math.max(520, Math.min(idleGuideW, idleGuideH) * 0.92);
  for (var i = 0; i < idleGuideParticles.length; i++) {
    var p = idleGuideParticles[i];
    var localA = p.a + t * p.speed;
    var wanderA = p.phase + t * p.wobbleSpeed;
    var wobble = Math.sin(wanderA) * p.wobbleAmp + Math.sin(t * (p.wobbleSpeed * 0.57 + 0.11) + p.phase * 1.7) * p.wobbleAmp * 0.45;
    var x, y;
    var projected = null;
    var pointScale = 1;
    if (p.ring) {
      var rr = (p.r + wobble + breathe * 12) * zoom * (1 + guide.press * 0.030 + zoomBoost * 0.018);
      var baseX = Math.cos(localA) * rr + Math.sin(wanderA * 0.73) * p.wobbleAmp * 0.54 + p.driftX;
      var baseY = Math.sin(localA + Math.sin(wanderA) * 0.10) * rr * p.oval + Math.sin(t * 0.33 + p.phase) * p.wobbleAmp * 0.68 + p.driftY;
      var baseZ = (Math.sin(localA * 0.84 + p.phase * 0.31) * rr * p.zAmp + p.z * 0.54 + Math.cos(wanderA * 0.91) * p.wobbleAmp) * zoom;
      projected = projectIdleGuidePoint(baseX, baseY, baseZ, rot, cx, cy, depth);
      pointScale = projected.scale;
      x = projected.x + guide.tiltX * projected.z * 0.020;
      y = projected.y + guide.tiltY * projected.z * 0.018;
      var nDx = pointerX - x, nDy = pointerY - y;
      var near = guide.focus * Math.max(0, 1 - Math.sqrt(nDx * nDx + nDy * nDy) / 210);
      x += nDx * near * 0.040;
      y += nDy * near * 0.040;
      ringPts.push({ x:x, y:y, z:projected.z, scale:projected.scale, alpha:0.08 + breathe * 0.04 + near * 0.08 });
    } else {
      var driftX = ((p.cx - 0.5) * idleGuideW * 0.92 + Math.cos(localA) * (12 + p.wobbleAmp * 0.28) + wobble * 0.28) * zoom;
      var driftY = ((p.cy - 0.5) * idleGuideH * 0.72 + Math.sin(localA * 0.8 + p.phase * 0.2) * (12 + p.wobbleAmp * 0.24)) * zoom;
      var driftZ = (p.z + Math.sin(localA + p.phase) * (32 + p.wobbleAmp * 0.32)) * zoom;
      var fieldPt = projectIdleGuidePoint(driftX, driftY, driftZ, rot, cx, cy, depth * 1.16);
      pointScale = fieldPt.scale;
      x = fieldPt.x;
      y = fieldPt.y;
    }
    var depthGlow = p.ring && projected ? (0.66 + projected.scale * 0.20) : 1;
    var aP = p.ring ? ((0.070 + breathe * 0.065 + Math.sin(t * (0.8 + p.layer) + p.phase) * 0.024 + spinEnergy * 0.032) * depthGlow) : (0.034 + guide.focus * 0.010);
    ctx.beginPath();
    ctx.arc(x, y, p.size * pointScale * Math.sqrt(zoom) * (1 + spinEnergy * (p.ring ? 0.24 : 0.08) + zoomBoost * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, aP).toFixed(3) + ')';
    ctx.fill();
  }

  ctx.lineWidth = 1;
  for (var j = 0; j < ringPts.length; j += 3) {
    var aPt = ringPts[j];
    var bPt = ringPts[(j + 7) % ringPts.length];
    if (!aPt || !bPt) continue;
    var dx = aPt.x - bPt.x, dy = aPt.y - bPt.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > Math.min(idleGuideW, idleGuideH) * 0.17) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.018 + breathe * 0.020 + guide.focus * 0.012 + spinEnergy * 0.018).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(aPt.x, aPt.y);
    ctx.lineTo(bPt.x, bPt.y);
    ctx.stroke();
  }

  if (guide.focus > 0.03 || spinEnergy > 0.05) {
    var orbitR = Math.min(idleGuideW, idleGuideH) * (0.305 + guide.press * 0.018) * zoom;
    var anchorAlpha = Math.min(0.68, 0.16 + guide.focus * 0.24 + spinEnergy * 0.38);
    for (var k = 0; k < 4; k++) {
      var anchorA = guide.angle + t * 0.08 + k * 1.72 + (k === 2 ? 0.38 : 0);
      var anchorPt = projectIdleGuidePoint(
        Math.cos(anchorA) * orbitR,
        Math.sin(anchorA) * orbitR * 0.52,
        Math.sin(anchorA + k * 0.54) * orbitR * 0.48,
        rot, cx, cy, depth
      );
      pushIdleGuideTrail(k, anchorPt, anchorAlpha, nowFrame);
      drawIdleGuideTrail(ctx, idleGuideTrails[k], nowFrame, anchorAlpha, spinEnergy);
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, (2.0 + spinEnergy * 1.8 + (k === 0 ? guide.press * 1.8 : 0)) * anchorPt.scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + anchorAlpha.toFixed(3) + ')';
      ctx.fill();
    }
  }

  if (guide.focus > 0.03) {
    var handleA = guide.angle + t * 0.36;
    var handleR = Math.min(idleGuideW, idleGuideH) * (0.315 + breathe * 0.012 + guide.press * 0.012) * zoom;
    var handlePt = projectIdleGuidePoint(
      Math.cos(handleA) * handleR,
      Math.sin(handleA) * handleR * 0.52,
      Math.sin(handleA + 0.62) * handleR * 0.48,
      rot, cx, cy, depth
    );
    var hx = handlePt.x;
    var hy = handlePt.y;
    var handleGlow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 28 + guide.press * 12);
    handleGlow.addColorStop(0, 'rgba(255,255,255,' + (0.22 * guide.focus + 0.16 * guide.press).toFixed(3) + ')');
    handleGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = handleGlow;
    ctx.beginPath();
    ctx.arc(hx, hy, 28 + guide.press * 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 2.4 + guide.press * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.54 * guide.focus + 0.24 * guide.press).toFixed(3) + ')';
    ctx.fill();
  }

  if (shelfCueShow) drawShelfGuideCue(ctx, t, shelfCueValue);
  ctx.globalCompositeOperation = 'source-over';
  scheduleIdleGuideFrame(0);
}
function idleRoundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  r = Math.min(r || 0, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  var x2 = x + w, y2 = y + h;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x2 - r, y);
  ctx.quadraticCurveTo(x2, y, x2, y + r);
  ctx.lineTo(x2, y2 - r);
  ctx.quadraticCurveTo(x2, y2, x2 - r, y2);
  ctx.lineTo(x + r, y2);
  ctx.quadraticCurveTo(x, y2, x, y2 - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}
function drawShelfGuideCue(ctx, t, strength) {
  strength = Math.max(0, Math.min(1, strength == null ? shelfHoverCue.value : strength));
  if (strength <= 0.01) return;
  var r = shelfCueRect();
  var c = shelfCueCenter();
  var pulse = 0.5 + 0.5 * Math.sin(t * 1.55);
  var floatY = Math.sin(t * 0.92) * 8 * strength;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var glow = ctx.createLinearGradient(r.left, 0, r.right, 0);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.58, 'rgba(255,255,255,' + (0.010 * strength).toFixed(3) + ')');
  glow.addColorStop(0.82, 'rgba(244,210,138,' + (0.024 * strength + pulse * 0.012 * strength).toFixed(3) + ')');
  glow.addColorStop(1, 'rgba(255,255,255,' + (0.035 * strength).toFixed(3) + ')');
  ctx.fillStyle = glow;
  ctx.fillRect(r.left, r.top - 26, r.width + 18, r.height + 52);

  var halo = ctx.createRadialGradient(c.x + r.width * 0.18, c.y + floatY, 0, c.x + r.width * 0.18, c.y + floatY, r.width * 0.62);
  halo.addColorStop(0, 'rgba(244,210,138,' + (0.070 * strength + pulse * 0.026 * strength).toFixed(3) + ')');
  halo.addColorStop(0.45, 'rgba(255,255,255,' + (0.020 * strength).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(r.left, r.top - 40, r.width, r.height + 80);

  for (var i = 0; i < 10; i++) {
    var seed = i * 19.17;
    var phase = (t * (0.10 + (i % 4) * 0.014) + i * 0.113) % 1;
    var x = r.left + r.width * (0.45 + (i % 4) * 0.13) + Math.sin(t * 0.44 + seed) * 12;
    var y = r.top + r.height * (0.18 + ((i * 0.137 + Math.sin(seed)) % 0.64)) + floatY * (0.42 + (i % 3) * 0.10);
    var alpha = (0.035 + Math.sin(Math.PI * phase) * 0.050) * strength;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(x, y, 0.9 + (i % 3) * 0.26 + pulse * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244,210,138,' + alpha.toFixed(3) + ')';
    ctx.fill();
  }
  ctx.restore();
}
function initIdleGuideCanvas() {
  idleGuideCanvas = document.getElementById('idle-guide-canvas');
  if (!idleGuideCanvas) return;
  idleGuideCtx = idleGuideCanvas.getContext('2d');
  if (!idleGuideCtx) return;
  idleGuideStartedAt = performance.now();
  resizeIdleGuideCanvas();
  window.addEventListener('resize', resizeIdleGuideCanvas);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !idleGuideRaf && !idleGuideDelayTimer) {
      scheduleIdleGuideFrame(0);
    }
  });
  drawIdleGuideFrame();
}
