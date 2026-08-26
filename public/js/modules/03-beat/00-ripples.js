// ============================================================
//  涟漪触发系统 — 3×3 九宫格 + bass 上升沿
// ============================================================
var rippleIdx = 0;
var lastRippleAt = 0;
var lastBassRising = false;
var BASS_THRESHOLD = 0.30;
var RIPPLE_COOLDOWN = 0.32;

var regions = [];
for (var ry = 0; ry < 3; ry++) for (var rx = 0; rx < 3; rx++) {
  regions.push({
    x: (rx / 2 - 0.5) * PLANE_SIZE * 0.72,
    y: (ry / 2 - 0.5) * PLANE_SIZE * 0.72,
  });
}

function triggerRipple(x, y, strength) {
  var r = ripples[rippleIdx];
  r.x = x; r.y = y; r.age = 0; r.str = strength;
  rippleIdx = (rippleIdx + 1) % RIPPLE_MAX;
}

function updateRipples(dt) {
  var isBassHit = bass > BASS_THRESHOLD && !lastBassRising;
  lastBassRising = bass > BASS_THRESHOLD * 0.75;
  var now = uniforms.uTime.value;
  if (isBassHit && (now - lastRippleAt) > RIPPLE_COOLDOWN) {
    lastRippleAt = now;
    var count = 2 + (Math.random() < 0.5 ? 0 : 1);
    var used = {};
    for (var k = 0; k < count; k++) {
      var idx, tries = 0;
      do { idx = Math.floor(Math.random() * 9); tries++; } while (used[idx] && tries < 12);
      used[idx] = true;
      var reg = regions[idx];
      var jx = reg.x + (Math.random() - 0.5) * 0.7;
      var jy = reg.y + (Math.random() - 0.5) * 0.7;
      var str = 0.65 + bass * 1.4 + Math.random() * 0.25;
      triggerRipple(jx, jy, str);
    }
  }

  for (var i = 0; i < RIPPLE_MAX; i++) {
    var r = ripples[i];
    if (r.str > 0.005) {
      r.age += dt;
      if (r.age > 2.0) { r.str = 0; r.age = -10; }
    }
    var off = i * 4;
    rippleData[off]   = r.x;
    rippleData[off+1] = r.y;
    rippleData[off+2] = r.age;
    rippleData[off+3] = r.str;
  }
  rippleTex.needsUpdate = true;

  var active = 0;
  for (var i = 0; i < RIPPLE_MAX; i++) if (ripples[i].str > 0.005) active++;
  uniforms.uRippleCount.value = active;
}

