// ============================================================
//  AudioWorklet 管理器：从音频图 PCM 分析，主线程只收特征
// ============================================================

(function (global) {
  'use strict';

  var AudioWorkletAnalysis = function () {
    this.audioCtx = null;
    this.inputNode = null;
    this.workletNode = null;
    this.running = false;
    this.onFeatures = null;
  };

  AudioWorkletAnalysis.prototype.init = async function (audioCtx, inputNode) {
    this.audioCtx = audioCtx;
    this.inputNode = inputNode;
    try {
      var moduleUrl = (typeof location !== 'undefined' && location.href)
        ? new URL('js/modules/03-beat/07-audio-analysis-processor.js', location.href).href
        : 'js/modules/03-beat/07-audio-analysis-processor.js';
      await audioCtx.audioWorklet.addModule(moduleUrl);
    } catch (e) {
      console.warn('[AudioWorklet] load failed, fallback to main-thread:', e);
      return false;
    }

    this.workletNode = new AudioWorkletNode(audioCtx, 'mineradio-audio-analysis', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: {}
    });

    // 从播放链路旁路接入，不经过 AnalyserNode，真正吃 PCM
    if (inputNode && inputNode.connect) {
      try { inputNode.connect(this.workletNode); } catch (err) {
        console.warn('[AudioWorklet] connect failed:', err);
        return false;
      }
    }

    var self = this;
    this.workletNode.port.onmessage = function (e) {
      var type = e.data && e.data.type;
      var payload = e.data && e.data.payload;
      if (type === 'audioFeatures' && self.onFeatures) self.onFeatures(payload);
    };

    var sens = this.workletNode.parameters.get('sensitivity');
    if (sens) sens.value = 1.0;
    return true;
  };

  AudioWorkletAnalysis.prototype.start = function () {
    this.running = true;
  };

  AudioWorkletAnalysis.prototype.stop = function () {
    this.running = false;
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (_) {}
      this.workletNode = null;
    }
  };

  AudioWorkletAnalysis.prototype.setKickRange = function (manual, start, end) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'setKickRange',
      payload: { manual: !!manual, start: start, end: end }
    });
  };

  AudioWorkletAnalysis.prototype.setSensitivity = function (val) {
    if (!this.workletNode) return;
    var sens = this.workletNode.parameters.get('sensitivity');
    if (sens) sens.value = val;
  };

  global.Mineradio = global.Mineradio || {};
  global.Mineradio.AudioWorkletAnalysis = AudioWorkletAnalysis;

})(typeof window !== 'undefined' ? window : globalThis);
