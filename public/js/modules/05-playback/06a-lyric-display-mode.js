// === 歌词行数 / 双语翻译 / 歌词动画 ===
function setLyricDisplayMode(mode) {
  var valid = ['single', 'dual', 'triple', 'cinema', 'custom'];
  if (valid.indexOf(mode) < 0) mode = fx.lyricDisplayMode || 'dual';
  fx.lyricDisplayMode = mode;
  var seg = document.getElementById('lyric-display-mode-seg');
  if (seg) {
    Array.from(seg.querySelectorAll('button')).forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
  }
  var slider = document.getElementById('fx-lyriccustomlines');
  if (slider) slider.parentElement.style.display = mode === 'custom' ? '' : 'none';
  saveLyricLayout();
  if (mode === 'single' || mode === 'cinema') {
    hideStageNextLineSmooth();
  } else {
    requestStageLyricCameraSnap(12);
    refreshStageDualLyricPreview();
  }
  if (stageLyrics.currentIdx >= 0 && lyricsLines[stageLyrics.currentIdx]) {
    showStageLine(enrichLyricText(lyricsLines[stageLyrics.currentIdx].text || '', stageLyrics.currentIdx), true);
  }
  pushDesktopLyricsState(true);
  showToast('歌词行数: ' + ({ single: '单行', dual: '双行', triple: '三行', cinema: '沉浸', custom: '自定' })[mode] || mode);
}
function setLyricTranslationMode(mode) {
  var valid = ['off', 'current', 'dual', 'multi'];
  if (valid.indexOf(mode) < 0) mode = fx.lyricTranslationMode || 'off';
  fx.lyricTranslationMode = mode;
  var seg = document.getElementById('lyric-translation-mode-seg');
  if (seg) {
    Array.from(seg.querySelectorAll('button')).forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-translation') === mode);
    });
  }
  saveLyricLayout();
  if (stageLyrics.currentIdx >= 0 && lyricsLines[stageLyrics.currentIdx]) {
    showStageLine(enrichLyricText(lyricsLines[stageLyrics.currentIdx].text || '', stageLyrics.currentIdx), true);
  }
  showToast('双语翻译: ' + ({ off: '关闭', current: '当前', dual: '双行', multi: '多行' })[mode] || mode);
}
function setLyricMotionStyle(style) {
  var valid = ['float', 'smooth', 'glass', 'shine', 'glitch'];
  if (valid.indexOf(style) < 0) style = fx.lyricMotionStyle || 'float';
  fx.lyricMotionStyle = style;
  var seg = document.getElementById('lyric-motion-style-seg');
  if (seg) {
    Array.from(seg.querySelectorAll('button')).forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-motion') === style);
    });
  }
  var glitch = document.getElementById('lyric-glitch-controls');
  if (glitch) glitch.style.display = style === 'glitch' ? '' : 'none';
  saveLyricLayout();
  showToast('歌词动画: ' + ({ float: '漂浮', smooth: '柔滑', glass: '玻璃', shine: '线光', glitch: '故障' })[style] || style);
}
function syncLyricSegmentActive() {
  var map = [
    ['lyric-display-mode-seg', 'data-mode', fx.lyricDisplayMode || 'dual'],
    ['lyric-translation-mode-seg', 'data-translation', fx.lyricTranslationMode || 'off'],
    ['lyric-motion-style-seg', 'data-motion', fx.lyricMotionStyle || 'float']
  ];
  map.forEach(function(item) {
    var seg = document.getElementById(item[0]);
    if (!seg) return;
    Array.from(seg.querySelectorAll('button')).forEach(function(b) {
      b.classList.toggle('active', b.getAttribute(item[1]) === item[2]);
    });
  });
  var customSlider = document.getElementById('fx-lyriccustomlines');
  if (customSlider && customSlider.parentElement) {
    customSlider.parentElement.style.display = (fx.lyricDisplayMode === 'custom') ? '' : 'none';
  }
  var glitchBox = document.getElementById('lyric-glitch-controls');
  if (glitchBox) glitchBox.style.display = (fx.lyricMotionStyle === 'glitch') ? '' : 'none';
}
function computeLyricMotion(style, t, seed) {
  var power = Number(fx.lyricGlitchPower) || 0.5;
  var rate = Number(fx.lyricGlitchRate) || 0.22;
  var breathe, rotZAdd = 0, posXAdd = 0;
  var glowMod = 1, shineMod = 0;
  switch (style) {
    case 'smooth':
      // 柔和：缓慢深呼吸 + 轻微摇摆，幅度增至 0.18
      breathe = Math.sin(t * 0.38 + seed) * 0.18;
      rotZAdd = Math.sin(t * 0.25 + seed) * 0.014;
      break;
    case 'glass':
      // 玻璃：中频呼吸 + 周期性高光闪烁（模拟玻璃反光折射）
      breathe = Math.sin(t * 1.6 + seed) * 0.10 + Math.sin(t * 2.3 + seed * 1.3) * 0.05;
      glowMod = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.8 + seed * 0.7));
      break;
    case 'shine':
      // 线光：水平位移 + 周期性强光脉冲（模拟线光扫过）
      breathe = Math.sin(t * 0.6 + seed) * 0.08;
      posXAdd = Math.sin(t * 0.5 + seed) * 0.18;
      shineMod = 0.5 + 0.5 * Math.max(0, Math.sin(t * 1.2 + seed * 1.5));
      break;
    case 'glitch':
      var phase = Math.floor(t * (rate * 24));
      var r1 = ((Math.sin(phase * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1;
      var r2 = ((Math.sin(phase * 78.233 + seed * 1.7) * 12753.123) % 1 + 1) % 1;
      if (r1 > 0.55) {
        breathe = (r1 - 0.45) * power * 0.60;
        rotZAdd = (r2 - 0.5) * power * 0.22;
        posXAdd = (r2 - 0.5) * power * 0.32;
      } else {
        breathe = Math.sin(t * 0.92 + seed) * 0.05;
      }
      break;
    case 'float':
    default:
      breathe = Math.sin(t * 0.92 + seed) * 0.16 + Math.sin(t * 0.41 + seed * 0.7) * 0.09;
      break;
  }
  return { breathe: breathe, rotZAdd: rotZAdd, posXAdd: posXAdd, glowMod: glowMod, shineMod: shineMod };
}
// === 启动播放 ===