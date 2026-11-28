// ============================================================
// 阶段 3A：渲染进程 WASAPI 旁路桥（默认关闭）
// 从 audioTap 拉 PCM → desktopWindow.wasapiWrite；开启时静音 WebAudio 出声避免双声
// ============================================================

var WASAPI_OUTPUT_STORE_KEY = 'mineradio-wasapi-output-v1';
var wasapiOutputEnabled = false;
var wasapiOutputActive = false;
var wasapiScriptNode = null;
var wasapiTapConnected = false;
var wasapiDetachedDestination = null;
var wasapiOutputQueue = Promise.resolve();
var wasapiOutputGeneration = 0;
var wasapiOutputDeviceGeneration = 0;

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

function enqueueWasapiOutputOperation(operation) {
  var result = wasapiOutputQueue.then(operation);
  wasapiOutputQueue = result.catch(function () {});
  return result;
}

function wasapiOutputSuperseded() {
  return { ok: false, error: 'WASAPI_OUTPUT_SUPERSEDED', superseded: true };
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
  var generation = ++wasapiOutputGeneration;
  return enqueueWasapiOutputOperation(function () {
    return startWasapiOutputBridgeOwned(generation);
  });
}

async function startWasapiOutputBridgeOwned(generation) {
  if (generation !== wasapiOutputGeneration) return wasapiOutputSuperseded();
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
  if (generation !== wasapiOutputGeneration) return wasapiOutputSuperseded();
  if (!avail) return { ok: false, error: 'WASAPI unavailable' };
  if (wasapiOutputDeviceGeneration || wasapiScriptNode) {
    await stopWasapiOutputBridgeOwned(generation);
    if (generation !== wasapiOutputGeneration) return wasapiOutputSuperseded();
  }

  var sr = Math.round(audioCtx.sampleRate) || 48000;
  var opened;
  try { opened = await api.wasapiOpen({ sampleRate: sr, channels: 2 }); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  if (generation !== wasapiOutputGeneration) {
    try { await api.wasapiClose(); } catch (_) {}
    return wasapiOutputSuperseded();
  }
  if (!opened || !opened.ok) return { ok: false, error: (opened && opened.error) || 'open failed' };
  wasapiOutputDeviceGeneration = generation;

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

    /* 取样点必须是「调音链之后、主出声之前」的那个节点。
     * 音频图顺序：source → moodExit → audioTuning(EQ/前级/响度/声道/防爆音) → audioTap → gainNode → destination。
     * 旧代码写死 tap = source，等于整段绕过调音链 —— 这就是「开旁路后音效调节没反应」的原因。
     * gainNode 是合并脚本里的模块级变量，从它取样才能把 EQ、前级、响度和音量/淡变一起带上。 */
    var masterOut = (typeof gainNode !== 'undefined') ? gainNode : null;
    if (masterOut) {
      masterOut.connect(wasapiScriptNode);
      wasapiTapConnected = true;
      /* 主出声改由 WASAPI 走，WebAudio 这一路必须断掉；
       * 不能沿用「把 gain 设 0」的写法：取样点在 gain 之后，清零会连旁路流一起静音。 */
      try {
        masterOut.disconnect(audioCtx.destination);
        wasapiDetachedDestination = audioCtx.destination;
      } catch (_) { }
    } else {
      /* 兜底：拿不到主输出节点才退回 source。这条路径调音链不生效，必须留下痕迹。 */
      source.connect(wasapiScriptNode);
      wasapiTapConnected = true;
      console.warn('[WASAPI 3A] gainNode 不可用，退回 source 取样：EQ / 音量不会生效');
    }
    wasapiScriptNode.connect(audioCtx.destination);
    wasapiOutputActive = true;
    console.log('[WASAPI 3A] bridge started @', sr);
    return { ok: true, enabled: true, status: opened.status };
  } catch (e) {
    await stopWasapiOutputBridgeOwned(generation);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function stopWasapiOutputBridge() {
  var generation = ++wasapiOutputGeneration;
  return enqueueWasapiOutputOperation(function () {
    return stopWasapiOutputBridgeOwned(generation);
  });
}

async function stopWasapiOutputBridgeOwned(generation) {
  wasapiOutputActive = false;
  var api = wasapiDesktopApi();
  if (wasapiScriptNode) {
    try { wasapiScriptNode.disconnect(); } catch (_) {}
    wasapiScriptNode = null;
  }
  wasapiTapConnected = false;
  /* 把主出声接回去（开启时是断开的，不是把 gain 清零） */
  if (wasapiDetachedDestination && typeof gainNode !== 'undefined' && gainNode) {
    try { gainNode.connect(wasapiDetachedDestination); } catch (_) { }
    wasapiDetachedDestination = null;
  }
  /* 兼容旧版本留下的清零写法：万一还有 __wasapiPrevGain，恢复它 */
  if (typeof gainNode !== 'undefined' && gainNode && gainNode.__wasapiPrevGain != null) {
    try { gainNode.gain.value = gainNode.__wasapiPrevGain; } catch (_) {}
    gainNode.__wasapiPrevGain = null;
  }
  if (api && typeof api.wasapiClose === 'function' && wasapiOutputDeviceGeneration) {
    try { await api.wasapiClose(); } catch (_) {}
  }
  wasapiOutputDeviceGeneration = 0;
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
  if (result && result.superseded) return;
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
        if (result && result.superseded) return;
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
