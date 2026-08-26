// ============================================================
//  涟漪全屏平面 (Preset 9 专用，纯2D片元着色器)
//  使用 NDC 坐标，始终填满屏幕，不受相机影响
// ============================================================
var ripplePlaneGeo = new THREE.PlaneGeometry(2, 2);
var ripplePlaneMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:       { value: 0 },
    uBass:       { value: 0 },
    uMid:        { value: 0 },
    uTreble:     { value: 0 },
    uBeat:       { value: 0 },
    uEnergy:     { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uAlpha:      { value: 0 },
    uTintColor:  { value: new THREE.Color('#9db8cf') },
    uTintStrength: { value: 0 },
    uSpeedMul:   { value: 1.0 },
    uDensityMul: { value: 1.0 },
    uBrightMul:  { value: 1.0 },
    uWidthMul:   { value: 1.0 },
    uRangeMul:   { value: 1.0 },
  },
  vertexShader: '\n' +
    'varying vec2 vUv;\n' +
    'void main() {\n' +
    '  vUv = uv;\n' +
    '  gl_Position = vec4(position.xy, 0.0, 1.0);\n' +
    '}\n',
  fragmentShader: '\n' +
    'precision highp float;\n' +
    'varying vec2 vUv;\n' +
    'uniform vec2 uResolution;\n' +
    'uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uAlpha;\n' +
    'uniform vec3 uTintColor;\n' +
    'uniform float uTintStrength;\n' +
    'uniform float uSpeedMul, uDensityMul, uBrightMul, uWidthMul, uRangeMul;\n' +
    '\n' +
    '// 单个波纹光晕层 - 柔和渐变的光带，而非硬边线条\n' +
    '// dist: 到波源距离\n' +
    '// speed: 扩散速度\n' +
    '// phaseOffset: 相位偏移\n' +
    '// wavelength: 波长（光带之间的距离）\n' +
    '// width: 光带宽度（越大越宽）\n' +
    '// brightness: 亮度\n' +
    '// softness: 边缘柔和度（0~1，越大越柔和）\n' +
    'float waveGlow(float dist, float speed, float phaseOffset, float wavelength, float width, float brightness, float softness) {\n' +
    '  float phase = uTime * speed + phaseOffset;\n' +
    '  float pos = dist - phase;\n' +
    '  float modPos = mod(pos, wavelength);\n' +
    '  float distToCenter = abs(modPos - wavelength * 0.5);\n' +
    '  float normalizedDist = distToCenter / (wavelength * width);\n' +
    '  float core = exp(-normalizedDist * normalizedDist * 4.5);\n' +
    '  float halo = exp(-normalizedDist * 1.8) * softness;\n' +
    '  return (core + halo * 0.5) * brightness;\n' +
    '}\n' +
    '\n' +
    '// 计算一侧所有波纹层的总强度\n' +
    'float sideWaves(float dist, float speedMul, float brightnessMul, float densityMul, float widthMul) {\n' +
    '  float total = 0.0;\n' +
    '  float sp = 0.30 * speedMul * uSpeedMul;\n' +
    '  float dMul = 1.0 / max(0.1, densityMul * uDensityMul);\n' +
    '  float wMul = widthMul * uWidthMul;\n' +
    '  float bMul = brightnessMul * uBrightMul;\n' +
    '\n' +
    '  // 主光带\n' +
    '  total += waveGlow(dist, sp * 1.0,   0.0,  2.6 * dMul, 0.10 * wMul, 0.80 * bMul, 0.70);\n' +
    '  // 次级光带\n' +
    '  total += waveGlow(dist, sp * 1.30,  1.3 * dMul,  2.0 * dMul, 0.07 * wMul, 0.35 * bMul, 0.65);\n' +
    '  // 三级光带\n' +
    '  total += waveGlow(dist, sp * 1.6,   2.4 * dMul,  1.5 * dMul, 0.05 * wMul, 0.18 * bMul, 0.60);\n' +
    '  // 细光带 - 高音驱动\n' +
    '  total += waveGlow(dist, sp * 2.0,   3.4 * dMul,  1.0 * dMul, 0.035 * wMul, 0.08 * (0.4 + uTreble * 0.6) * bMul, 0.55);\n' +
    '  // 微弱尾迹\n' +
    '  total += waveGlow(dist, sp * 0.75, -1.2 * dMul,  3.2 * dMul, 0.12 * wMul, 0.12 * bMul, 0.80);\n' +
    '  // 中频细节层\n' +
    '  total += waveGlow(dist, sp * 1.45,  2.8 * dMul,  1.8 * dMul, 0.045 * wMul, 0.12 * (0.5 + uMid * 0.5) * bMul, 0.60);\n' +
    '\n' +
    '  return total;\n' +
    '}\n' +
    '\n' +
    'void main() {\n' +
    '  float aspect = uResolution.x / uResolution.y;\n' +
    '  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);\n' +
    '\n' +
    '  // 左右波源，在屏幕外侧，uRangeMul 控制距离\n' +
    '  float rangeInv = 1.0 / max(0.1, uRangeMul);\n' +
    '  vec2 srcLeft  = vec2(-aspect * 0.65 * rangeInv, 0.0);\n' +
    '  vec2 srcRight = vec2( aspect * 0.65 * rangeInv, 0.0);\n' +
    '  float distLeft  = length(p - srcLeft);\n' +
    '  float distRight = length(p - srcRight);\n' +
    '\n' +
    '  // 音乐驱动\n' +
    '  float speedMul = 1.0 + uBass * 1.2;\n' +
    '  float brightMul = 0.55 + uEnergy * 0.45;\n' +
    '\n' +
    '  float waveL = sideWaves(distLeft, speedMul, brightMul, 1.0, 1.0);\n' +
    '  float waveR = sideWaves(distRight, speedMul, brightMul, 1.0, 1.0);\n' +
    '\n' +
    '  // 距离衰减\n' +
    '  float falloffL = exp(-distLeft * 1.1 * uRangeMul);\n' +
    '  float falloffR = exp(-distRight * 1.1 * uRangeMul);\n' +
    '\n' +
    '  // 中间平静区\n' +
    '  float centerCalm = smoothstep(0.0, 0.50, abs(p.x));\n' +
    '\n' +
    '  float ripple = (waveL * falloffL + waveR * falloffR) * centerCalm;\n' +
    '\n' +
    '  // 节拍脉冲\n' +
    '  ripple *= 1.0 + uBeat * 0.5;\n' +
    '\n' +
    '  // 颜色：基于 uTintColor 生成渐变光感\n' +
    '  vec3 tc = uTintColor;\n' +
    '  vec3 deepCol = tc * 0.15;\n' +
    '  vec3 midCol  = tc * 0.55;\n' +
    '  vec3 brightCol = tc + (1.0 - tc) * 0.25;\n' +
    '  vec3 coreCol = tc + (1.0 - tc) * 0.55;\n' +
    '\n' +
    '\n' +
    '  vec3 col = vec3(0.0);\n' +
    '  float a = 0.0;\n' +
    '\n' +
    '  // 底层淡染\n' +
    '  float tintAmount = smoothstep(0.0, 0.3, ripple) * 0.5;\n' +
    '  col += deepCol * tintAmount;\n' +
    '  a += tintAmount * 0.35;\n' +
    '\n' +
    '  // 中层光晕\n' +
    '  float midAmount = smoothstep(0.15, 0.6, ripple);\n' +
    '  col = mix(col, midCol, midAmount);\n' +
    '  a = max(a, midAmount * 0.75);\n' +
    '\n' +
    '  // 高光层\n' +
    '  float brightAmount = smoothstep(0.45, 0.85, ripple);\n' +
    '  col = mix(col, brightCol, brightAmount);\n' +
    '  a = max(a, brightAmount * 0.90);\n' +
    '\n' +
    '  // 核心亮边\n' +
    '  float coreAmount = smoothstep(0.8, 1.0, ripple);\n' +
    '  col = mix(col, coreCol, coreAmount);\n' +
    '  a = max(a, coreAmount);\n' +
    '\n' +
    '  // 节拍高光提亮\n' +
    '  col += coreCol * uBeat * 0.15 * smoothstep(0.3, 0.7, ripple);\n' +
    '\n' +
    '  float alpha = a * uAlpha;\n' +
    '  alpha = clamp(alpha, 0.0, 1.0);\n' +
    '\n' +
    '  gl_FragColor = vec4(col, alpha);\n' +
    '}\n',
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
var ripplePlane = new THREE.Mesh(ripplePlaneGeo, ripplePlaneMat);
ripplePlane.renderOrder = 999;
ripplePlane.frustumCulled = false;
ripplePlane.visible = false;
scene.add(ripplePlane);
var rippleFadeStart = 0;
var RIPPLE_FADE_DURATION = 600; // ms

// ============================================================
//  经典播放器预设 (Preset 11)
//  左侧专辑封面 + 右侧滚动歌词，经典播放器界面
// ============================================================
var CLASSIC_PRESET_INDEX = 11;
var classicPlayer = {
  active: false,
  currentLyricIdx: -1,
  lastSongKey: '',
  restoreParticleLyrics: false
};
// 经典播放器歌词 DOM 缓存：避免每帧 querySelectorAll('.cp-lyric-line') 与 getElementById
var _cpLyricsContainer = null;
var _cpLyricLineEls = null;
var _cpPlayerEl = null;
// 歌词结束余韵状态：每首歌只触发一次，切歌时复位
var cpEndingState = { triggered:false, songKey:'' };
function triggerClassicEndingAftermath(lastLineEl) {
  if (!lastLineEl) return;
  // 末句上浮 + 渐淡 + 模糊
  lastLineEl.classList.remove('cp-lyric-line--ending');
  void lastLineEl.offsetWidth;
  lastLineEl.classList.add('cp-lyric-line--ending');
  // 微粒子化飘散：以末句中心为原点炸出封面色火星
  var wrap = document.getElementById('cp-lyrics-wrap');
  var layer = document.getElementById('cp-ending-particles');
  if (!wrap || !layer) return;
  layer.style.setProperty('--beat-glow-rgb', beatGlowCoverRGB || '143,233,255');
  var wrapRect = wrap.getBoundingClientRect();
  var lineRect = lastLineEl.getBoundingClientRect();
  var cx = lineRect.left - wrapRect.left + lineRect.width / 2;
  var cy = lineRect.top - wrapRect.top + lineRect.height / 2;
  var sparks = 18;
  for (var i = 0; i < sparks; i++) {
    var s = document.createElement('div');
    s.className = 'cp-ending-spark';
    var ang = (Math.random() * Math.PI * 2);
    var dist = 40 + Math.random() * 90;
    var ex = Math.cos(ang) * dist;
    var ey = Math.sin(ang) * dist - (40 + Math.random() * 50);  // 整体向上飘
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.setProperty('--ex', ex.toFixed(1) + 'px');
    s.style.setProperty('--ey', ey.toFixed(1) + 'px');
    s.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
    layer.appendChild(s);
  }
  setTimeout(function(){
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }, 2100);
}
function isClassicPresetActive() {
  return !!(fx && Number(fx.preset) === CLASSIC_PRESET_INDEX);
}
function applyClassicPresetState(active) {
  var el = document.getElementById('classic-player');
  if (!el) return;
  classicPlayer.active = !!active;
  el.classList.toggle('active', classicPlayer.active);
  applyClassicFxPanelState();
  if (classicPlayer.active) {
    classicPlayer.restoreParticleLyrics = !!fx.particleLyrics;
    setParticleLyricsSilently(false);
    applyClassicPlayerSettings();
    updateClassicPlayerSong();
    renderClassicPlayerLyrics();
    requestAnimationFrame(function() {
      updateClassicPlayerLyrics();
    });
    updatePlayerQuickMenuUi();
  } else {
    if (classicPlayer.restoreParticleLyrics) {
      setParticleLyricsSilently(true);
    }
    classicPlayer.restoreParticleLyrics = false;
    updatePlayerQuickMenuUi();
  }
}
function updateClassicPlayerSong() {
  var meta = currentDesktopSongMeta();
  var coverEl = document.getElementById('cp-cover');
  var songEl = document.getElementById('cp-song-name');
  var artistEl = document.getElementById('cp-artist');
  var albumEl = document.getElementById('cp-album');
  var bgBlur = document.querySelector('.cp-bg-blur');
  if (coverEl && meta.cover) {
    coverEl.style.backgroundImage = 'url("' + String(meta.cover).replace(/["'()\\]/g, function(c) { return '\\' + c; }) + '")';
  }
  if (bgBlur && meta.cover) {
    bgBlur.style.backgroundImage = 'url("' + String(meta.cover).replace(/["'()\\]/g, function(c) { return '\\' + c; }) + '")';
  }
  if (songEl) songEl.textContent = meta.title || '未知歌曲';
  if (artistEl) artistEl.textContent = meta.artist || '未知歌手';
  if (albumEl) {
    var song = playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null;
    albumEl.textContent = (song && song.album) || '';
  }
}
function renderClassicPlayerLyrics() {
  var container = document.getElementById('cp-lyrics');
  if (!container) return;
  container.textContent = '';
  // 歌词重建后失效缓存（旧 NodeList 指向已移除的节点）
  _cpLyricLineEls = null;
  _cpLyricsContainer = container;
  if (!lyricsLines || !lyricsLines.length) {
    var empty = document.createElement('div');
    empty.className = 'cp-lyric-line';
    empty.textContent = '暂无歌词';
    container.appendChild(empty);
    return;
  }
  var frag = document.createDocumentFragment();
  lyricsLines.forEach(function(line, i) {
    var el = document.createElement('div');
    el.className = 'cp-lyric-line';
    el.setAttribute('data-idx', i);
    el.textContent = line.text || '';
    frag.appendChild(el);
  });
  container.appendChild(frag);
}

// 将 active 行文字拆为 char span，用于逐字高亮
function splitClassicLyricChars(lineEl, line) {
  if (!lineEl || !line) return;
  var text = line.text || '';
  if (!text || !line.words || !line.words.length || !line.charCount) {
    // 无逐字时间戳，不拆分，保持纯文本
    lineEl._cpSplit = false;
    return;
  }
  lineEl.textContent = '';
  var frag = document.createDocumentFragment();
  for (var i = 0; i < text.length; i++) {
    var span = document.createElement('span');
    span.className = 'cp-char';
    span.textContent = text[i];
    frag.appendChild(span);
  }
  lineEl.appendChild(frag);
  lineEl._cpSplit = true;
}

// 还原 active 行为纯文本（切歌时清理）
function unsplitClassicLyricChars(lineEl) {
  if (!lineEl || !lineEl._cpSplit) return;
  var idx = parseInt(lineEl.getAttribute('data-idx'), 10);
  var line = (lyricsLines && idx >= 0 && idx < lyricsLines.length) ? lyricsLines[idx] : null;
  lineEl.textContent = (line && line.text) || '';
  lineEl._cpSplit = false;
}

// 更新 active 行的逐字高亮进度
function updateClassicKaraokeProgress(lineEl, line, nextLine, now) {
  if (!lineEl || !lineEl._cpSplit) return;
  var chars = lineEl.querySelectorAll('.cp-char');
  if (!chars.length) return;
  if (line.words && line.words.length && line.charCount > 0) {
    var charIdx = 0;
    for (var i = 0; i < line.words.length; i++) {
      var w = line.words[i];
      var ws = w.t;
      var we = w.t + Math.max(0.08, w.d || 0.24);
      var sungEnd = (now >= we) ? w.c1 : (now >= ws ? Math.floor(w.c0 + (w.c1 - w.c0) * ((now - ws) / Math.max(0.08, we - ws))) : w.c0);
      for (; charIdx < sungEnd && charIdx < chars.length; charIdx++) {
        chars[charIdx].classList.add('cp-sung');
        chars[charIdx].classList.remove('cp-singing');
      }
      if (now >= ws && now < we) {
        if (charIdx < chars.length) {
          chars[charIdx].classList.add('cp-singing');
          charIdx++;
        }
      }
    }
    for (; charIdx < chars.length; charIdx++) {
      chars[charIdx].classList.remove('cp-sung', 'cp-singing');
    }
  }
}
function updateClassicPlayerLyrics() {
  if (!classicPlayer.active) return;
  // 缓存容器元素，避免每帧 getElementById
  if (!_cpLyricsContainer) _cpLyricsContainer = document.getElementById('cp-lyrics');
  var container = _cpLyricsContainer;
  var wrap = document.getElementById('cp-lyrics-wrap');
  if (!container || !wrap || !lyricsLines || !lyricsLines.length) return;
  var songKey = currentIdx + '_' + (playQueue[currentIdx] ? (playQueue[currentIdx].name || '') : '');
  if (songKey !== classicPlayer.lastSongKey) {
    classicPlayer.lastSongKey = songKey;
    updateClassicPlayerSong();
    classicPlayer.currentLyricIdx = -1;
    renderClassicPlayerLyrics();
    container = _cpLyricsContainer; // renderClassicPlayerLyrics 内部已同步缓存
    container.style.transform = '';
    // 切歌时复位余韵触发标记
    cpEndingState.triggered = false;
    cpEndingState.songKey = songKey;
  }
  var t = getAdjustedLyricPlaybackTime((audio && audio.currentTime) ? audio.currentTime : 0);
  var curIdx = -1;
  for (var i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].t <= t + 0.05) curIdx = i;
    else break;
  }
  // 缓存 .cp-lyric-line NodeList（静态快照），仅歌词重建后失效
  if (!_cpLyricLineEls) _cpLyricLineEls = container.querySelectorAll('.cp-lyric-line');
  var lines = _cpLyricLineEls;
  var changed = curIdx !== classicPlayer.currentLyricIdx;
  if (changed) {
    classicPlayer.currentLyricIdx = curIdx;
    lines.forEach(function(el, i) {
      el.classList.remove('active', 'past', 'future');
      // 旧 active 行还原为纯文本
      if (el._cpSplit) unsplitClassicLyricChars(el);
      if (i < curIdx) {
        el.classList.add('past');
      } else if (i === curIdx) {
        el.classList.add('active');
        // 新 active 行拆字
        splitClassicLyricChars(el, lyricsLines[i]);
      } else {
        el.classList.add('future');
      }
    });
    if (curIdx >= 0 && lines[curIdx]) {
      var wrapH = wrap.clientHeight;
      var lineTop = lines[curIdx].offsetTop;
      var lineH = lines[curIdx].offsetHeight;
      var scrollTop = lineTop + lineH / 2 - wrapH / 2;
      container.style.transform = 'translateY(' + (-scrollTop).toFixed(1) + 'px)';
    }
    // 仅在歌词行变化时应用弧形/淡出，避免每帧 getBoundingClientRect 导致强制回流
    applyClassicLyricCurve(lines, curIdx, wrap);
  }
  // 歌词结束余韵：末句唱完后触发一次上浮+渐淡+微粒子化飘散
  if (lyricsLines.length) {
    var lastIdx = lyricsLines.length - 1;
    var lastLine = lyricsLines[lastIdx];
    var lastLineEnd = lastLine.t + (lastLine.duration || 0);
    var dur = (audio && isFinite(audio.duration)) ? audio.duration : 0;
    // 回退到末句之前则复位（用户拖动进度条回退时允许再次触发）
    if (cpEndingState.triggered && t < lastLineEnd - 3) {
      cpEndingState.triggered = false;
      var _oldEnd = container.querySelector('.cp-lyric-line--ending');
      if (_oldEnd) _oldEnd.classList.remove('cp-lyric-line--ending');
    }
    if (!cpEndingState.triggered && lines[lastIdx]) {
      // 有逐字时长：末句唱完 0.4s 后触发；无时长兜底：歌曲最后 3s 触发
      var lastLineFinished = lastLine.duration > 0.5
        ? (t > lastLineEnd + 0.4)
        : (dur > 0 && t > dur - 3);
      if (lastLineFinished) {
        cpEndingState.triggered = true;
        triggerClassicEndingAftermath(lines[lastIdx]);
      }
    }
  }
  // 节拍呼吸脉动：每帧注入 --cp-beat-pulse（低开销，仅 setProperty）
  var pulse = Math.min(1, (bass || 0) * 0.8 + (beatPulse || 0) * 0.5);
  if (classicPlayer._lastPulse !== pulse) {
    if (!_cpPlayerEl) _cpPlayerEl = document.getElementById('classic-player');
    if (_cpPlayerEl) {
      _cpPlayerEl.style.setProperty('--cp-beat-pulse', pulse.toFixed(3));
    }
    classicPlayer._lastPulse = pulse;
  }
  // 逐字高亮进度（每帧更新 active 行）
  if (curIdx >= 0 && lines[curIdx] && lines[curIdx]._cpSplit) {
    updateClassicKaraokeProgress(
      lines[curIdx],
      lyricsLines[curIdx],
      lyricsLines[curIdx + 1],
      t
    );
    // 节拍呼吸：active 行 char span 光晕随 beat 脉动（CSS 变量驱动，无强制回流）
    var beatGlow = 1 + pulse * 0.8;
    if (lines[curIdx]._lastBeatGlow !== beatGlow) {
      lines[curIdx].style.setProperty('--cp-beat-glow', beatGlow.toFixed(2));
      lines[curIdx]._lastBeatGlow = beatGlow;
    }
  }
}

// ============================================================
//  浮空粒子层 (独立 Points)
//   v7.1: 速度大幅放慢, 改用 sin/cos 长周期漂移 (优雅而非乱飞)
// ============================================================
var FLOAT_COUNT = 1300;
var floatGroup = null;
var floatPositionsArr = null, floatBaseArr = null, floatPhaseArr = null, floatColorArr = null;

function createFloatLayer() {
  fx.floatLayer = false;
  uniforms.uFloatAlpha.value = 0;
  if (floatGroup) destroyFloatLayer();
  return;
  if (floatGroup) return;
  var fgeo = new THREE.BufferGeometry();
  floatPositionsArr = new Float32Array(FLOAT_COUNT * 3);
  floatBaseArr      = new Float32Array(FLOAT_COUNT * 3);  // 基准位置
  floatPhaseArr     = new Float32Array(FLOAT_COUNT * 3);  // 每粒子相位 (0..2π)
  floatColorArr     = new Float32Array(FLOAT_COUNT * 3);
  var floatRandArr  = new Float32Array(FLOAT_COUNT);
  var floatAmpArr   = new Float32Array(FLOAT_COUNT);      // 漂移幅度 (0.15-0.45)
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var halo = i < FLOAT_COUNT * 0.76;
    var bx, by, bz;
    if (halo) {
      var a = Math.random() * Math.PI * 2;
      var r = 0.62 + Math.pow(Math.random(), 0.72) * 2.75;
      var lane = (Math.random() - 0.5) * 0.62;
      bx = Math.cos(a) * r;
      by = Math.sin(a) * r * 0.54 + lane;
      bz = (Math.random() - 0.5) * 2.4 - 0.25;
    } else {
      bx = (Math.random() - 0.5) * 8.4;
      by = (Math.random() - 0.5) * 5.8;
      bz = (Math.random() - 0.5) * 5.6;
    }
    floatBaseArr[i*3]   = bx; floatBaseArr[i*3+1] = by; floatBaseArr[i*3+2] = bz;
    floatPositionsArr[i*3]   = bx;
    floatPositionsArr[i*3+1] = by;
    floatPositionsArr[i*3+2] = bz;
    floatPhaseArr[i*3]   = Math.random() * Math.PI * 2;
    floatPhaseArr[i*3+1] = Math.random() * Math.PI * 2;
    floatPhaseArr[i*3+2] = Math.random() * Math.PI * 2;
    floatAmpArr[i] = 0.15 + Math.random() * 0.35;
    var white = 0.88 + Math.random() * 0.12;
    floatColorArr[i*3]   = white;
    floatColorArr[i*3+1] = white;
    floatColorArr[i*3+2] = white;
    floatRandArr[i] = Math.random();
  }
  fgeo.setAttribute('position', new THREE.BufferAttribute(floatPositionsArr, 3));
  fgeo.setAttribute('aColor',   new THREE.BufferAttribute(floatColorArr, 3));
  fgeo.setAttribute('aRand',    new THREE.BufferAttribute(floatRandArr, 1));

  // 把 amp + phase 存到 attribute 让 shader 端做漂移 (避免 JS 每帧改 buffer)
  fgeo.setAttribute('aAmp',     new THREE.BufferAttribute(floatAmpArr, 1));
  fgeo.setAttribute('aPhase',   new THREE.BufferAttribute(floatPhaseArr, 3));

  var fvs = `
    precision highp float;
    uniform float uTime, uBass, uPixel, uFloatAlpha;
    attribute vec3 aColor;
    attribute vec3 aPhase;
    attribute float aRand, aAmp;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec3 pos = position;
      float orbit = uTime * (0.030 + aRand * 0.034);
      float cs = cos(orbit), sn = sin(orbit);
      pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
      float breathe = 1.0 + sin(uTime * 0.34 + aPhase.x) * 0.045;
      pos.xy *= breathe;
      pos.x += sin(uTime * (0.18 + aRand * 0.05) + aPhase.x) * aAmp * 0.34;
      pos.y += cos(uTime * (0.15 + aRand * 0.06) + aPhase.y) * aAmp * 0.30;
      pos.z += sin(uTime * (0.11 + aRand * 0.04) + aPhase.z) * aAmp * 0.68 + uBass * 0.10 * sin(aRand * 12.0);
      vC = aColor;
      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      float dist = -mvPos.z;
      float twinkle = 0.62 + 0.38 * sin(uTime * (0.42 + aRand * 0.34) + aPhase.z);
      vA = clamp(0.22 + (5.0 - dist) * 0.10, 0.055, 0.58) * twinkle;
      float sz = clamp(40.0 / max(0.5, dist), 1.3, 4.1);
      gl_PointSize = sz * uPixel;
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  var ffs = `
    precision highp float;
    uniform sampler2D uDotTex;
    uniform float uFloatAlpha;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec4 tex = texture2D(uDotTex, gl_PointCoord);
      if (tex.a < 0.02) discard;
      gl_FragColor = vec4(vC, tex.a * vA * uFloatAlpha);
    }
  `;
  var fmat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uFloatAlpha: uniforms.uFloatAlpha,
    },
    vertexShader: fvs, fragmentShader: ffs,
    transparent:true, depthWrite:false, blending: THREE.AdditiveBlending,
  });
  floatGroup = new THREE.Points(fgeo, fmat);
  floatGroup.frustumCulled = false;
  scene.add(floatGroup);
}
function destroyFloatLayer() {
  if (!floatGroup) return;
  scene.remove(floatGroup);
  floatGroup.geometry.dispose(); floatGroup.material.dispose();
  floatGroup = null;
}

