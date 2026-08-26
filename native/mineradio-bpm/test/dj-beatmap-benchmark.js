'use strict';
// DJ energy + beatmap 端到端对照：JS vs C++
const path = require('path');
const bpm = require('..');
const dj = require(path.join(__dirname, '..', '..', '..', 'dj-analyzer.js'));

function synthKickPcm(seconds, sampleRate) {
  const n = Math.floor(seconds * sampleRate);
  const pcm = new Float32Array(n);
  const period = Math.floor(sampleRate * 0.5);
  for (let i = 0; i < n; i++) {
    const phase = i % period;
    const env = phase < sampleRate * 0.04 ? Math.exp(-phase / (sampleRate * 0.012)) : 0.02;
    pcm[i] = Math.sin(2 * Math.PI * 55 * i / sampleRate) * env
      + Math.sin(2 * Math.PI * 110 * i / sampleRate) * env * 0.35
      + (Math.random() * 2 - 1) * 0.008;
  }
  return pcm;
}

function meanAbs(a, b) {
  const n = Math.min(a.length, b.length);
  let max = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs((Number(a[i]) || 0) - (Number(b[i]) || 0));
    sum += d;
    if (d > max) max = d;
  }
  return { max, mean: n ? sum / n : 0, n };
}

function main() {
  if (!bpm.isNativeAvailable || typeof bpm.buildBeatMapFromLowEnergy !== 'function') {
    console.error('native beatmap API missing');
    process.exit(1);
  }
  const sr = 44100;
  const hop = 0.01;
  const pcm = synthKickPcm(90, sr);
  const energy = bpm.analyzeDjPcm(pcm, sr, hop);
  const duration = energy.frames * hop;

  const t0 = performance.now();
  const nativeMap = bpm.buildBeatMapFromLowEnergy(energy.lowEnergy, energy.hitEnergy, hop, duration);
  const nativeMs = performance.now() - t0;

  const t1 = performance.now();
  const jsMap = dj.buildBeatMapFromLowEnergyJs(energy.lowEnergy, energy.hitEnergy, hop, duration);
  const jsMs = performance.now() - t1;

  const kickDiff = meanAbs(nativeMap.kicks || [], jsMap.kicks || []);
  const nBeats = Math.min((nativeMap.beats || []).length, (jsMap.beats || []).length);
  let timeMax = 0, impactMax = 0, mismatch = 0;
  for (let i = 0; i < nBeats; i++) {
    const dt = Math.abs((nativeMap.beats[i].time || 0) - (jsMap.beats[i].time || 0));
    const di = Math.abs((nativeMap.beats[i].impact || 0) - (jsMap.beats[i].impact || 0));
    if (dt > timeMax) timeMax = dt;
    if (di > impactMax) impactMax = di;
    if (nativeMap.beats[i].combo !== jsMap.beats[i].combo) mismatch++;
  }

  console.log('=== DJ BeatMap benchmark (90s synth @ 44100) ===');
  console.log('energy frames=', energy.frames, 'engine=', energy.engine);
  console.log('native beats=', (nativeMap.beats || []).length, 'visual=', nativeMap.visualBeatCount, 'ms=', nativeMs.toFixed(2), 'cppElapsed=', Number(nativeMap.elapsedMs || 0).toFixed(2));
  console.log('js     beats=', (jsMap.beats || []).length, 'visual=', jsMap.visualBeatCount, 'ms=', jsMs.toFixed(2));
  console.log('gridStep native/js:', Number(nativeMap.gridStep).toFixed(4), Number(jsMap.gridStep).toFixed(4));
  console.log('kick time diff max/mean:', kickDiff.max.toFixed(6), kickDiff.mean.toFixed(6));
  console.log('beat time maxDiff=', timeMax.toFixed(6), 'impact maxDiff=', impactMax.toFixed(6), 'comboMismatch=', mismatch);
  console.log('speedup js/native:', (jsMs / Math.max(0.001, nativeMs)).toFixed(2) + 'x');
  console.log('dj nativeDjAvailable:', !!dj.nativeDjAvailable);

  const visualDiff = Math.abs((nativeMap.visualBeatCount || 0) - (jsMap.visualBeatCount || 0));
  const ok =
    Math.abs((nativeMap.beats || []).length - (jsMap.beats || []).length) <= 2
    && visualDiff <= 2
    && Math.abs(Number(nativeMap.gridStep) - Number(jsMap.gridStep)) < 0.02
    && timeMax < 0.05
    && impactMax < 0.08
    && mismatch <= Math.max(2, Math.floor(nBeats * 0.02));
  if (!ok) {
    console.error('FAIL beatmap parity', { visualDiff });
    process.exit(1);
  }
  console.log('OK dj-beatmap parity — ready for CPU smoke test');
}

main();
