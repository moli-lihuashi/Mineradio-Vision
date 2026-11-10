/* Folia 世界 — 逐词组件（GlowWord 的 vanilla 版）
 *
 * 对应 Folia components/visualizer/GlowWord.tsx + wordGlow.ts + glowWordVariants.ts。
 * classic / partita 共用。一个词只有 waiting / active / passed 三态，只有状态变化才动 DOM 以外的逻辑；
 * 逐帧只写数值（transform / 文字辉光半径），不重建节点。
 *
 * 三层结构（与 Folia 完全一致）：
 *   .folia-glow-word          外层：位置 / 缩放 / 旋转（每状态各自时长）
 *     .folia-glow-word-halo   辉光层：透明文字 + text-shadow 双光环；多字时逐字拆分，逐字扫光
 *     .folia-glow-word-body   正文层：颜色 / 模糊
 *     .folia-glow-word-ripple 合唱涟漪（仅 active 且 isChorus）
 */
'use strict';

var FOLIA_GLOW_SPRING = { stiffness: 200, damping: 20, mass: 1 };
var FOLIA_GLOW_DEFAULT_PASSED_OPACITY = 0.82;

function foliaGlowTextShadow(color, inner, outer) {
  return '0 0 ' + inner + 'px ' + color + ', 0 0 ' + outer + 'px ' + color;
}

/* 逐字辉光的计划：每个字自己的时长 / 延迟 / 峰值曲线 / 半径。 */
function foliaBuildGlowPlan(word, duration, profile, total) {
  var activeColor = null; // 调用方填
  var plan = [];

  if (profile.wordRevealMode === 'instant') {
    return {
      mode: 'whole',
      duration: Math.min(duration || 0.08, 0.12),
      times: [0, 0.35, 1],
      ease: 'easeOut',
      peaks: [0, 1, 0],
      inner: 14,
      outer: 24,
      perChar: false,
      delays: []
    };
  }

  if (profile.wordRevealMode === 'fast') {
    return {
      mode: 'whole',
      duration: Math.min(Math.max(duration || 0.12, 0.12), 0.2),
      times: [0, 0.4, 1],
      ease: 'easeInOut',
      peaks: [0, 1, 0],
      inner: 18,
      outer: 32,
      perChar: false,
      delays: []
    };
  }

  if (total > 1) {
    return {
      mode: 'sweep',
      times: [0, 0.3, 1],
      ease: 'easeInOut',
      peaks: [0, 1, 0],
      inner: 20,
      outer: 40,
      perChar: true,
      singleDuration: (duration || 0) / total
    };
  }

  return {
    mode: 'sustained',
    duration: duration || 0.1,
    times: [0, 0.9, 1],
    ease: 'easeInOut',
    peaks: [0, 1, 1],
    inner: 20,
    outer: 40,
    perChar: false,
    delays: []
  };
}

function foliaCreateGlowWord(opts) {
  var word = opts.word;
  var config = opts.config;
  var theme = opts.theme;
  var profile = opts.renderProfile;
  var fontSize = opts.fontSize;
  var layoutStyle = opts.layoutStyle || {};
  var isChorus = !!opts.isChorus;
  var enableRotation = opts.enableWordRotation !== false;
  var intensity = theme.animationIntensity || 'normal';
  var baseColor = opts.baseColor;
  var activeColor = opts.activeColor;

  var graphemeTimings = foliaBuildWordGraphemeTimings(word);
  var activeEndTime = foliaGlowWordActiveEndTime(word, profile);
  var displayDuration = foliaGlowWordDisplayDuration(word, profile);

  var el = document.createElement('div');
  el.className = 'folia-glow-word';
  el.style.fontSize = fontSize;
  el.style.fontWeight = String(foliaResolveThemeFontWeight(theme, 700));
  el.style.lineHeight = '1.22';
  if (layoutStyle.marginRight) el.style.marginRight = layoutStyle.marginRight;
  if (layoutStyle.alignSelf && layoutStyle.alignSelf !== 'auto') el.style.alignSelf = layoutStyle.alignSelf;

  var halo = document.createElement('span');
  halo.className = 'folia-glow-word-halo';
  halo.setAttribute('aria-hidden', 'true');
  var haloChars = [];
  if (graphemeTimings.length > 1) {
    for (var i = 0; i < graphemeTimings.length; i++) {
      var span = document.createElement('span');
      span.textContent = graphemeTimings[i].char;
      halo.appendChild(span);
      haloChars.push(span);
    }
  } else {
    halo.textContent = word.text;
    haloChars.push(halo);
  }
  el.appendChild(halo);

  var body = document.createElement('span');
  body.className = 'folia-glow-word-body';
  body.textContent = word.text;
  el.appendChild(body);

  var anim = foliaAnimCreate();
  var status = 'waiting';
  var glowClock = 0;
  var glowPlan = null;
  var glowActive = false;
  var rippleEl = null;
  var rippleClock = 0;
  var rippleScale = 1.5 + Math.random() * 2;

  /* waiting 姿态：缩放 0.5，沿 sin/cos 甩出一段偏移，多转 20°。 */
  var waitingX = config.x + (Math.sin(config.y) * 100);
  var waitingY = config.y + (Math.cos(config.x) * 50);
  var waitingRotate = enableRotation ? config.rotate + 20 : 0;

  anim.snap('x', waitingX);
  anim.snap('y', waitingY);
  anim.snap('scale', 0.5);
  anim.snap('rotate', waitingRotate);
  anim.snap('opacity', 0);
  el.style.opacity = '0';
  el.setAttribute('data-folia-word-status', 'waiting');
  body.style.color = baseColor;
  body.style.filter = 'blur(10px)';
  halo.style.opacity = '1';

  function writeTransform() {
    var tx = anim.v.x || 0;
    var ty = anim.v.y || 0;
    var sc = isFinite(anim.v.scale) ? anim.v.scale : 1;
    var rt = anim.v.rotate || 0;
    el.style.transform = 'translate3d(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px, 0) scale(' + sc.toFixed(4) + ') rotate(' + rt.toFixed(2) + 'deg)';
    el.style.opacity = String(isFinite(anim.v.opacity) ? anim.v.opacity : 1);
  }

  function bodyTransition(duration, ease) {
    body.style.transition = 'color ' + duration.toFixed(3) + 's ' + (ease || 'ease') + ', filter ' + duration.toFixed(3) + 's ' + (ease || 'ease');
  }

  function startGlow() {
    glowPlan = foliaBuildGlowPlan(word, displayDuration, profile, graphemeTimings.length);
    glowClock = 0;
    glowActive = true;
    if (glowPlan.perChar) {
      glowPlan.itemDurations = [];
      glowPlan.itemDelays = [];
      var total = graphemeTimings.length;
      for (var i = 0; i < total; i++) {
        var t = graphemeTimings[i];
        var charDuration = Math.max(t.endTime - t.startTime, 0.001);
        glowPlan.itemDurations.push(charDuration * 6);
        glowPlan.itemDelays.push(Math.max(0, t.startTime - word.startTime));
      }
    }
  }

  function stopGlowInstant() {
    glowActive = false;
    glowPlan = null;
    for (var i = 0; i < haloChars.length; i++) haloChars[i].style.textShadow = 'none';
    halo.style.opacity = '1';
  }

  function stepGlow(dt) {
    if (!glowActive || !glowPlan) return;
    glowClock += dt;
    var plan = glowPlan;
    var easeFn = foliaEase(plan.ease);
    var allDone = true;

    if (plan.perChar) {
      for (var i = 0; i < haloChars.length; i++) {
        var dur = plan.itemDurations[i] || 0.2;
        var delay = plan.itemDelays[i] || 0;
        var local = dur > 0 ? (glowClock - delay) / dur : 1;
        if (local < 1) allDone = false;
        var peak = local <= 0 ? 0 : foliaSampleKeyframes(plan.peaks, plan.times, easeFn, Math.min(local, 1));
        haloChars[i].style.textShadow = peak <= 0.02
          ? 'none'
          : foliaGlowTextShadow(activeColor, Math.round(plan.inner * peak), Math.round(plan.outer * peak));
      }
    } else {
      var d = plan.duration || 0.2;
      var q = d > 0 ? glowClock / d : 1;
      if (q < 1) allDone = false;
      var p = foliaSampleKeyframes(plan.peaks, plan.times, easeFn, Math.min(q, 1));
      var shadow = p <= 0.02
        ? 'none'
        : foliaGlowTextShadow(activeColor, Math.round(plan.inner * p), Math.round(plan.outer * p));
      for (var k = 0; k < haloChars.length; k++) haloChars[k].style.textShadow = shadow;
    }

    if (allDone) {
      glowActive = false;
      glowPlan = null;
    }
  }

  function addRipple() {
    if (rippleEl) return;
    rippleEl = document.createElement('span');
    rippleEl.className = 'folia-glow-word-ripple';
    rippleEl.style.borderColor = activeColor;
    rippleEl.style.transform = 'translate(-50%, -50%) scale(0.2)';
    rippleEl.style.opacity = '0.8';
    el.appendChild(rippleEl);
    rippleClock = 0;
  }

  function stepRipple(dt) {
    if (!rippleEl) return;
    rippleClock += dt;
    var q = Math.min(rippleClock / 0.5, 1);
    var eased = foliaEase('easeOut')(q);
    rippleEl.style.transform = 'translate(-50%, -50%) scale(' + (0.2 + (rippleScale - 0.2) * eased).toFixed(4) + ')';
    rippleEl.style.opacity = String(0.8 * (1 - eased));
    if (q >= 1) {
      if (rippleEl.parentNode) rippleEl.parentNode.removeChild(rippleEl);
      rippleEl = null;
    }
  }

  function applyWaiting() {
    anim.to('x', waitingX, { duration: 0.4 });
    anim.to('y', waitingY, { duration: 0.4 });
    anim.to('scale', 0.5, { duration: 0.4 });
    anim.to('rotate', waitingRotate, { duration: 0.4 });
    anim.to('opacity', 0, { duration: 0.4 });
    bodyTransition(0.4, 'ease');
    body.style.color = baseColor;
    body.style.filter = 'blur(10px)';
    stopGlowInstant();
    halo.style.opacity = '1';
  }

  function applyActive() {
    var targetScale = isNaN(config.scale) ? 1.5 : config.scale * 1.4;
    anim.to('x', config.x, { spring: FOLIA_GLOW_SPRING });
    anim.to('y', config.y, { spring: FOLIA_GLOW_SPRING });
    anim.to('scale', targetScale, { spring: FOLIA_GLOW_SPRING });
    anim.to('rotate', config.rotate, { spring: FOLIA_GLOW_SPRING });
    anim.to('opacity', 1, { duration: 0.1 });
    var filterDuration = profile.wordRevealMode === 'instant' ? 0.08 : (profile.wordRevealMode === 'fast' ? 0.12 : 0.2);
    body.style.transition = 'color ' + (displayDuration || 0.2).toFixed(3) + 's linear, filter ' + filterDuration.toFixed(3) + 's ease';
    body.style.color = activeColor;
    body.style.filter = 'none';
    halo.style.opacity = '1';
    startGlow();
    if (isChorus) addRipple();
  }

  function applyPassed() {
    var opacity = intensity === 'chaotic' ? 0.9 : FOLIA_GLOW_DEFAULT_PASSED_OPACITY;
    var scale = config.scale || 1;
    var rotate = config.rotate + (config.passedRotate || 0);
    anim.to('opacity', opacity, { duration: 0.5 });
    anim.to('scale', scale, { duration: 0.5 });
    anim.to('x', config.x, { duration: 0.5 });
    anim.to('y', config.y, { duration: 0.5 });
    anim.to('rotate', rotate, { duration: 5, ease: 'linear' });

    var colorDuration = profile.wordRevealMode === 'instant' ? 0.12 : (profile.wordRevealMode === 'fast' ? 0.24 : 0.8);
    var filterDuration = profile.wordRevealMode === 'instant' ? 0.12 : (profile.wordRevealMode === 'fast' ? 0.2 : 0.5);
    body.style.transition = 'color ' + colorDuration.toFixed(3) + 's ease-in-out, filter ' + filterDuration.toFixed(3) + 's ease';
    body.style.color = baseColor;
    body.style.filter = 'blur(0px)';

    /* 辉光层淡出：framer 在 passed 里把 textShadow 直接置 none（不可插值），
     * 这里保留最后写下的半径、用 opacity 过渡还原「光环跟着收掉」的观感。 */
    var fade = profile.wordRevealMode === 'instant' ? 0.12 : (profile.wordRevealMode === 'fast' ? 0.22 : 0.9);
    halo.style.transition = 'opacity ' + fade.toFixed(3) + 's ease-out';
    halo.style.opacity = '0';
    glowActive = false;
    glowPlan = null;

    if (rippleEl && rippleEl.parentNode) rippleEl.parentNode.removeChild(rippleEl);
    rippleEl = null;
  }

  function update(time, dt) {
    var nextStatus = 'waiting';
    if (time >= word.startTime - profile.wordLookahead && time <= activeEndTime) nextStatus = 'active';
    else if (time > activeEndTime) nextStatus = 'passed';

    if (nextStatus !== status) {
      if (status === 'passed' && halo.style.transition) halo.style.transition = '';
      status = nextStatus;
      el.setAttribute('data-folia-word-status', status);
      if (status === 'waiting') applyWaiting();
      else if (status === 'active') applyActive();
      else applyPassed();
    }

    anim.step(dt);
    writeTransform();
    stepGlow(dt);
    stepRipple(dt);
  }

  return {
    el: el,
    word: word,
    status: function () { return status; },
    update: update,
    destroy: function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
