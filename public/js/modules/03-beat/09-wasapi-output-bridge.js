// ============================================================
// 阶段 3A：渲染进程 WASAPI 旁路桥（默认关闭）
// 从 audioTap 拉 PCM → desktopWindow.wasapiWrite；开启时静音 WebAudio 出声避免双声
// ============================================================

var WASAPI_OUTPUT_STORE_KEY = 'mineradio-wasapi-output-v1';
var wasapiOutputEnabled = false;
var wasapiOutputActive = false;
var wasapiScriptNode = null;
var wasapiTapConnected = false;

function readWasapiOutputPref() {
  try {
    var raw = localStorage.getItem(WASAPI_OUTPUT_STORE_KEY);
    if (!raw) return false;
    var o = JSON.parse(raw);
    return !!(o && o.enabled);
  } catch (_) {
    return false;
  }
}

function writeWasapiOutputPref(enabled) {
  try {
    localStorage.setItem(WASAPI_OUTPUT_STORE_KEY, JSON.stringify({ enabled: !!enabled, updatedAt: Date.now() }));
  } catch (_) {}
}

function wasapiDesktopApi() {
  return (typeof window !== 'undefined' && window.desktopWindow) ? window.desktopWindow : null;
}

async function setWasapiOutputEnabled(enabled) {
  enabled = !!enabled;
  writeWasapiOutputPref(enabled);
  wasapiOutputEnabled = enabled;
  if (!enabled) {
    await stopWasapiOutputBridge();
    return { ok: true, enabled: false };
  }
  return startWasapiOutputBridge();
}

async function startWasapiOutputBridge() {
  var api = wasapiDesktopApi();
  if (!api || typeof api.wasapiOpen !== 'function') {
    wasapiOutputActive = false;
    return { ok: false, error: 'desktop WASAPI API missing' };
  }
  if (!audioCtx || !source) {
    if (typeof initAudio === 'function') initAudio();
  }
  if (!audioCtx) return { ok: false, error: 'audioCtx missing' };

  var avail = false;
  try { avail = !!(await api.wasapiAvailable()); } catch (_) { avail = false; }
  if (!avail) return { ok: false, error: 'WASAPI unavailable' };

  var sr = Math.round(audioCtx.sampleRate) || 48000;
  var opened;
  try { opened = await api.wasapiOpen({ sampleRate: sr, channels: 2 }); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  if (!opened || !opened.ok) return { ok: false, error: (opened && opened.error) || 'open failed' };

  try {
    if (wasapiScriptNode) {
      try { wasapiScriptNode.disconnect(); } catch (_) {}
      wasapiScriptNode = null;
    }
    // ScriptProcessor 够用做旁路 POC；后续可换专用 Worklet 推 PCM
    var bufferSize = 2048;
    wasapiScriptNode = audioCtx.createScriptProcessor(bufferSize, 2, 2);
    wasapiScriptNode.onaudioprocess = function (ev) {
      if (!wasapiOutputActive || !api.wasapiWrite) return;
      var input = ev.inputBuffer;
      var L = input.getChannelData(0);
      var R = input.numberOfChannels > 1 ? input.getChannelData(1) : L;
      var n = L.length;
      var interleaved = new Float32Array(n * 2);
      for (var i = 0; i < n; i++) {
        interleaved[i * 2] = L[i];
        interleaved[i * 2 + 1] = R[i];
      }
      api.wasapiWrite(interleaved);
      // 输出静音，避免经 destination 再响一次（节点仍需接 destination 才会回调）
      var outL = ev.outputBuffer.getChannelData(0);
      var outR = ev.outputBuffer.numberOfChannels > 1 ? ev.outputBuffer.getChannelData(1) : null;
      outL.fill(0);
      if (outR) outR.fill(0);
    };

    var tap = (typeof audioTap !== 'undefined' && audioTap) ? audioTap : source;
    // audioTap 可能是局部变量；从 gain 前旁路：优先 source
    tap = source;
    if (typeof Mineradio !== 'undefined' && Mineradio.moodAudio && Mineradio.moodAudio.getExitNode) {
      try { tap = Mineradio.moodAudio.getExitNode() || tap; } catch (_) {}
    }
    tap.connect(wasapiScriptNode);
    wasapiScriptNode.connect(audioCtx.destination);
    wasapiTapConnected = true;

    // 静音 WebAudio 主出声，只走 WASAPI
    if (gainNode) {
      if (gainNode.gain.value > 0.0001) gainNode.__wasapiPrevGain = gainNode.gain.value;
      gainNode.gain.value = 0;
    }
    wasapiOutputActive = true;
    console.log('[WASAPI 3A] bridge started @', sr);
    return { ok: true, enabled: true, status: opened.status };
  } catch (e) {
    await stopWasapiOutputBridge();
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function stopWasapiOutputBridge() {
  wasapiOutputActive = false;
  var api = wasapiDesktopApi();
  if (wasapiScriptNode) {
    try { wasapiScriptNode.disconnect(); } catch (_) {}
    wasapiScriptNode = null;
  }
  wasapiTapConnected = false;
  if (gainNode && gainNode.__wasapiPrevGain != null) {
    try { gainNode.gain.value = gainNode.__wasapiPrevGain; } catch (_) {}
    gainNode.__wasapiPrevGain = null;
  } else if (gainNode && wasapiOutputEnabled === false) {
    // leave as-is
  }
  if (api && typeof api.wasapiClose === 'function') {
    try { await api.wasapiClose(); } catch (_) {}
  }
  console.log('[WASAPI 3A] bridge stopped / fallback to WebAudio');
  return { ok: true, enabled: false };
}

function initWasapiOutputBridgeFromPref() {
  wasapiOutputEnabled = readWasapiOutputPref();
  if (!wasapiOutputEnabled) return;
  // 等用户手势后再开音频图；此处只记偏好，真正 start 在 initAudio 后由 UI/热键触发
  console.log('[WASAPI 3A] pref enabled — call setWasapiOutputEnabled(true) after audio unlock');
}

if (typeof Mineradio === 'undefined') var Mineradio = {};
Mineradio.wasapiOutput = {
  isEnabled: function () { return !!wasapiOutputEnabled; },
  isActive: function () { return !!wasapiOutputActive; },
  setEnabled: setWasapiOutputEnabled,
  start: startWasapiOutputBridge,
  stop: stopWasapiOutputBridge,
  initFromPref: initWasapiOutputBridgeFromPref
};

// ============================================================
//  FX 面板 UI（开关 / 状态 / 开机自恢复）
// ============================================================
var wasapiOutputLastError = '';
var wasapiAutoStartBound = false;

function wasapiOutputStatusText() {
  if (wasapiOutputActive) return '状态：运行中 · WASAPI 旁路输出（WebAudio 已静音）';
  if (wasapiOutputLastError) return '状态：未启用 · 上次错误：' + wasapiOutputLastError;
  if (wasapiOutputEnabled) return '状态：已开启 · 等待播放后自动接管';
  return '状态：未启用（WebAudio 混音输出）';
}

function updateWasapiOutputControls() {
  var toggle = document.getElementById('t-wasapiOutput');
  if (toggle) toggle.classList.toggle('on', !!wasapiOutputActive);
  var statusEl = document.getElementById('wasapi-output-status');
  if (statusEl) {
    var next = wasapiOutputStatusText();
    if (statusEl.textContent !== next) statusEl.textContent = next;
  }
}

async function toggleWasapiOutput() {
  var next = !(wasapiOutputEnabled && wasapiOutputActive);
  if (typeof showToast === 'function') showToast(next ? '正在切换到 WASAPI 输出…' : '正在切回 WebAudio 输出…');
  var result = null;
  try { result = await setWasapiOutputEnabled(next); }
  catch (e) { result = { ok: false, error: (e && e.message) || String(e) }; }
  wasapiOutputLastError = (result && result.ok) ? '' : ((result && result.error) || '未知错误');
  if (typeof showToast === 'function') {
    showToast(result && result.ok
      ? (next ? 'WASAPI 输出已接管' : '已切回 WebAudio 输出')
      : ('WASAPI 切换失败：' + wasapiOutputLastError));
  }
  updateWasapiOutputControls();
}

function bindWasapiAutoStart() {
  if (wasapiAutoStartBound) return;
  wasapiAutoStartBound = true;
  // 偏好已开启但音频图尚未解锁时，等第一次真正出声再接管（capture 捕获 audio 元素的非冒泡事件）
  document.addEventListener('playing', function () {
    if (!wasapiOutputEnabled || wasapiOutputActive) return;
    setTimeout(function () {
      if (!wasapiOutputEnabled || wasapiOutputActive) return;
      startWasapiOutputBridge().then(function (result) {
        if (result && result.ok) {
          console.log('[WASAPI 3A] auto-recovered after play');
        } else {
          wasapiOutputLastError = (result && result.error) || '未知错误';
          wasapiOutputEnabled = false;
          writeWasapiOutputPref(false);
        }
        updateWasapiOutputControls();
      }).catch(function () {});
    }, 350);
  }, true);
}

initWasapiOutputBridgeFromPref();
bindWasapiAutoStart();
