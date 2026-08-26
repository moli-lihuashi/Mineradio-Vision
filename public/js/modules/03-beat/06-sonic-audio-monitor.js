/* ===== sonic-audio-monitor 频谱面板 ===== */
var sonicAudioMonitorState = { panelOpen: false, raf: 0, lastDrawAt: 0, lastRaw: null };
function drawSonicAudioMonitorPanel() {
  var panel = document.getElementById('sonic-audio-monitor-panel');
  var canvas = document.getElementById('sonic-audio-monitor-canvas');
  var meter = document.getElementById('sonic-audio-meter-fill');
  var label = document.getElementById('sonic-audio-monitor-label');
  if (!canvas || !panel || !sonicAudioMonitorState.panelOpen) {
    sonicAudioMonitorState.raf = 0;
    return;
  }
  var now = performance.now();
  if (now - sonicAudioMonitorState.lastDrawAt < 48) {
    sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
    return;
  }
  sonicAudioMonitorState.lastDrawAt = now;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  var w = canvas.width;
  var h = canvas.height;
  var raw = sonicAudioMonitorState.lastRaw || [];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,8,14,0.92)';
  ctx.fillRect(0, 0, w, h);
  // 绘制 8 频段条形图 (使用 sonicBandSmooth 数据)
  var bandNames = ['subBass','bass','lowMid','mid','highMid','presence','brilliance','air'];
  var bandLabels = ['Sub','Bass','LMid','Mid','HMid','Pres','Bril','Air'];
  var barW = w / bandNames.length;
  for (var i = 0; i < bandNames.length; i++) {
    var v = clamp01(Number(sonicBandSmooth[bandNames[i]] || 0));
    var bh = Math.max(1, v * (h - 18));
    var x = i * barW + 2;
    var bw = Math.max(1, barW - 4);
    var hue = 194 + (i / bandNames.length) * 120;
    ctx.fillStyle = 'hsla(' + hue + ', 92%, ' + Math.round(54 + v * 18) + '%, 0.86)';
    ctx.fillRect(x, h - bh - 14, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bandLabels[i], x + bw / 2, h - 3);
  }
  // 阈值线
  var threshold = clamp01((Number(fx.sonicAudioThreshold) || 40) / 100);
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - threshold * (h - 14));
  ctx.lineTo(w, h - threshold * (h - 14));
  ctx.stroke();
  // meter (用 lowDrive 派生量)
  if (meter) meter.style.transform = 'scaleX(' + clamp01(Number(sonicDerived.lowDrive || 0)).toFixed(3) + ')';
  if (label) {
    var mode = (fx.sonicAudioAutoTrack !== false) ? 'AUTO' : 'MANUAL';
    var kr = sonicAudioMonitorState.kickRange || [0, 7];
    label.textContent = mode + ' kick[' + kr[0] + '-' + kr[1] + '] | energy ' + (sonicDerived.energy || 0).toFixed(2) + ' | warmth ' + (sonicDerived.warmth || 0).toFixed(2);
  }
  sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
}
function setSonicAudioMonitorPanelOpen(open) {
  sonicAudioMonitorState.panelOpen = !!open;
  var panel = document.getElementById('sonic-audio-monitor-panel');
  var btn = document.getElementById('sonic-audio-monitor-toggle');
  if (panel) panel.classList.toggle('open', sonicAudioMonitorState.panelOpen);
  if (btn) btn.classList.toggle('active', sonicAudioMonitorState.panelOpen);
  if (sonicAudioMonitorState.panelOpen && !sonicAudioMonitorState.raf) {
    sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
  }
}
function toggleSonicAudioMonitorPanel(force) {
  setSonicAudioMonitorPanelOpen(force == null ? !sonicAudioMonitorState.panelOpen : !!force);
}
function bindSonicAudioMonitorControls() {
  var btn = document.getElementById('sonic-audio-monitor-toggle');
  if (btn && !btn._sonicAudioMonitorBound) {
    btn._sonicAudioMonitorBound = true;
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      toggleSonicAudioMonitorPanel();
      // 同步到“实时频谱”开关状态，保持两个入口一致
      fx.sonicAudioMonitorEnabled = sonicAudioMonitorState.panelOpen;
      var _monToggle = document.getElementById('t-sonicAudioMonitorEnabled');
      if (_monToggle) _monToggle.classList.toggle('on', !!fx.sonicAudioMonitorEnabled);
      saveLyricLayout();
    });
  }
  // 频谱滑块绑定到 fx 字段
  var sliders = [
    ['fx-sonicaudiosensitivity', 'sonicAudioSensitivity', 0, 100],
    ['fx-sonicaudiobandstart', 'sonicAudioBandStart', 0, 510],
    ['fx-sonicaudiobandend', 'sonicAudioBandEnd', 2, 512],
    ['fx-sonicaudiothreshold', 'sonicAudioThreshold', 0, 100],
    ['fx-sonicaudiopulse', 'sonicAudioPulse', 0, 100],
    ['fx-sonicsubbass', 'sonicGroundSubBass', 0, 100],
    ['fx-sonicbass', 'sonicGroundBass', 0, 100],
    ['fx-soniclowmid', 'sonicGroundLowMid', 0, 100],
    ['fx-sonicmid', 'sonicGroundMid', 0, 100],
    ['fx-sonichighmid', 'sonicGroundHighMid', 0, 100],
    ['fx-sonicpresence', 'sonicGroundPresence', 0, 100],
    ['fx-sonicbrilliance', 'sonicGroundBrilliance', 0, 100],
    ['fx-sonicair', 'sonicGroundAir', 0, 100]
  ];
  sliders.forEach(function(item) {
    var input = document.getElementById(item[0]);
    if (!input || input._sonicAudioBound) return;
    input._sonicAudioBound = true;
    input.addEventListener('input', function() {
      fx[item[1]] = clampRange(Math.round(Number(input.value) || fxDefaults[item[1]]), item[2], item[3]);
      setRange(item[0], fx[item[1]]);
      saveLyricLayout();
    });
  });
}
