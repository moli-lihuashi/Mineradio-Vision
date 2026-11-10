// 节拍分析的长度上限（秒）。
// 整轨搬进渲染进程的代价是线性的：实测约 2.8MB/秒音频（5 分钟 +879MB、25 分钟 +4050MB），
// 而这笔内存不计入 V8 堆（performance.memory.jsHeapSizeLimit 对它无效），
// 直接把渲染进程往 commit 上限推 —— startup-error.log 里 reason=oom 的那批崩溃就是它。
// 阈值取与播客路径相同的 3300s（见 02-podcast-dj-analysis.js 的 >3300 转服务端兜底）。
var BEAT_ANALYSIS_MAX_SEC = 3300;
// 与 MAX_SEC 配套的"下载前"闸：拿不到时长元数据时，用响应体量兜底。
// 压缩音频按 1.1Mbps 上限估，3300s ≈ 448MB；超过这个数的响应不可能是正常时长的歌，
// 必须在 arrayBuffer() 把它整块搬进渲染进程之前拦掉（那一下就是 GB 级外部内存）。
var BEAT_ANALYSIS_MAX_BYTES = Math.round(BEAT_ANALYSIS_MAX_SEC * 1100 * 1000 / 8);
// 渲染进程堆占用超过这个比例就不再启动新分析。performance.memory 的 usedJSHeapSize
// 不含 ArrayBuffer，但堆逼近上限本身就说明进程已经在悬崖边，此时再整轨解码必炸。
var BEAT_ANALYSIS_MAX_HEAP_RATIO = 0.82;
// ---- 长音轨分段解码 ----
// 上面几道闸只能"不让它进渲染进程"，长音频因此永远拿不到节拍图。真正的解法是不把
// 整轨 PCM 留在渲染进程里：按 HTTP Range 一段一段拉、一段一段解码，每段只留帧能量包络。
// 整轨 55 分钟的账（48kHz 立体声 float32）：
//   解码后 AudioBuffer            1.27GB  ← 分段后归零
//   每条频带的 OfflineAudioContext 渲染目标 0.63GB ×4  ← 分段后每段只有 23MB
//   tempo worker 用的整轨 mono     0.63GB  ← 降到 22.05kHz 后 0.29GB
// 峰值从 5.3GB 量级降到 ~0.3GB，且短于 SEGMENT_MIN_SEC 的歌仍走原来的整轨路径，行为不变。
var BEAT_ANALYSIS_SEGMENT_SEC = 120;        // 每段目标时长
var BEAT_ANALYSIS_SEGMENT_MIN_SEC = 420;    // 超过此时长才分段（7 分钟）
var BEAT_ANALYSIS_SEGMENT_TRIM_SEC = 0.20;  // 段首丢弃：从任意字节偏移解码时解码器要重同步，前几十毫秒是垃圾
var BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES = 320 * 1024; // 段首多拉一点，保证段尾不被截断
var BEAT_ANALYSIS_TEMPO_RATE = 22050;       // 分段路径下 mono 的目标采样率（ Nyquist 11kHz，鼓点足够）
// 时长元数据缺失但文件已经不小的时候，用 <audio> 元素探一次时长（只读元数据，不播放）。
// 没有它，"时长未知 + 130MB 文件"会绕过第一道闸，整轨下载+解码照样把渲染进程顶爆。
var BEAT_ANALYSIS_DURATION_PROBE_MIN_BYTES = 24 * 1024 * 1024;

async function analyzeAudioBeats(audioUrl, durationSec, token, options) {
  options = options || {};
  var analysisProfile = cinemaAnalysisProfileForSong(options.song);
  var softGrooveAnalysis = !!(analysisProfile && analysisProfile.softGroove);
  // 用 OfflineAudioContext 分离低频重鼓 / 中频鼓身 / 高频敲击感.
  // 关键：这里只保留帧能量包络，不留整轨分带。原先 4 条全长相等的 Float32Array
  // 会一起活到函数返回（async 函数的局部变量挂在 generator context 上，跨 await 不会
  // 提前释放），是单次分析里最大的一块 —— 帧能量只占全长的 1%，整轨分带纯属浪费。
  // 释放一条分带的渲染资源。注意：这里不能调 off.close() —— 实测本构建里
  // OfflineAudioContext.prototype.close 是 undefined，调用只会抛 TypeError。
  // 真正有效的释放是断开源节点对整轨 buffer 的引用；渲染目标本身随 rendered
  // 离开作用域（算完帧能量就返回）交给 GC。

  function releaseBandSrc(src) {
      try { src.buffer = null; } catch (e) {}
  }
  async function renderBandEnergyOn(buf, hpFreq, lpFreq) {
      var off = new TmpCtx(1, buf.length, buf.sampleRate);
      var src = off.createBufferSource(); src.buffer = buf;
      var node = src;
      if (hpFreq) {
        var hp = off.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = Math.min(hpFreq, buf.sampleRate * 0.45);
        hp.Q.value = 0.85;
        node.connect(hp);
        node = hp;
      }
      if (lpFreq) {
        var lp = off.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(lpFreq, buf.sampleRate * 0.45);
        lp.Q.value = 0.9;
        node.connect(lp);
        node = lp;
      }
      node.connect(off.destination);
      src.start(0);
      var rendered = await off.startRendering();
      if (token !== beatMapToken) { releaseBandSrc(src); return null; }
      await yieldToIdle(beatAnalysisYieldMs(options, 110, 620));
      var energy = await makeFrameEnergy(rendered.getChannelData(0), Math.floor(buf.sampleRate * 0.010));
      // 算完包络就丢：断开源节点对整轨 buffer 的引用，渲染目标随作用域退出释放
      releaseBandSrc(src);
      rendered = null;
      off = null;
      return energy;
  }
  async function renderBandEnergy(hpFreq, lpFreq) {
      return renderBandEnergyOn(buffer, hpFreq, lpFreq);
  }
  // 帧化能量 (10ms 窗口)。内部每 520 帧让出主线程，长音轨才不会把 UI 卡死。
  async function makeFrameEnergy(pcm, win) {
      var frames = Math.floor(pcm.length / win);
      var out = new Float32Array(frames);
      for (var f = 0; f < frames; f++) {
        var s = 0;
        var off2 = f * win;
        for (var i = 0; i < win; i++) {
          var v = pcm[off2 + i];
          s += v * v;
        }
        out[f] = Math.sqrt(s / win);
        if (f > 0 && f % 520 === 0) {
          await yieldToPaint();
          if (token !== beatMapToken) return null;
        }
      }
      return out;
  }

  try {
    beatMapBusy = true;
    // 闸门 0：进程已经吃紧时不要再见缝插针地整轨解码。
    try {
      var pm = performance.memory;
      if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize > pm.jsHeapSizeLimit * BEAT_ANALYSIS_MAX_HEAP_RATIO) {
        console.warn('[beat] 跳过分析：渲染进程堆占用过高',
          Math.round(pm.usedJSHeapSize / 1048576), 'MB /', Math.round(pm.jsHeapSizeLimit / 1048576), 'MB');
        hideBeatChip();
        return null;
      }
    } catch (_) {}
    if (options.prefetch) showBeatChip('预热下一首节奏…');
    else if (options.background) showBeatChip('后台缓冲节奏…');
    await yieldToIdle(beatAnalysisYieldMs(options, 140, 760));
    if (token !== beatMapToken) { hideBeatChip(); beatMapBusy = false; return null; }
    showBeatChip('正在分析节奏…');
    // durationSec 之前是死参数（全文只出现在签名里）。现在拿它当第一道闸：
    // 能提前知道时长的路径（播放中分析传的是 audio.duration）在下载之前就拦掉超长音轨。
    // 注意：串流/预热/cuefield 三条路径过去一直传 null，这道闸对它们完全不生效，
    // 超长音频会走完"下载 → 解码"才在第二道闸被拒，而那时 GB 级外部内存已经分配掉了。
    if (durationSec && isFinite(durationSec) && durationSec > BEAT_ANALYSIS_MAX_SEC) {
      console.warn('[beat] 跳过超长音轨分析:', Math.round(durationSec), 's >', BEAT_ANALYSIS_MAX_SEC, 's');
      hideBeatChip();
      return null;
    }
    var resp = await fetch(audioUrl);
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    // 闸门 1.5：响应体量兜底。元数据缺失（durationSec=0）时唯一能在 arrayBuffer()
    // 之前生效的判据。流式响应没有 content-length 时跳过，交给闸门 2。
    var contentLength = Number(resp.headers && resp.headers.get('content-length')) || 0;
    if (contentLength > BEAT_ANALYSIS_MAX_BYTES) {
      console.warn('[beat] 跳过异常体积的音频响应:',
        (contentLength / 1048576).toFixed(1), 'MB >', (BEAT_ANALYSIS_MAX_BYTES / 1048576).toFixed(0), 'MB');
      hideBeatChip();
      return null;
    }
    // 时长元数据缺失但文件已经不小：先探一次时长再决定走哪条路。
    // 探不到就维持 0，下面按"未知"处理（整轨路径 + 闸门 2 兜底）。
    if ((!durationSec || !isFinite(durationSec) || durationSec <= 0) &&
        contentLength >= BEAT_ANALYSIS_DURATION_PROBE_MIN_BYTES) {
      var probed = await probeAudioDurationSec(audioUrl, token);
      if (token !== beatMapToken) { hideBeatChip(); return null; }
      if (probed > 0) {
        console.log('[beat] 时长元数据缺失，<audio> 探到', Math.round(probed), 's');
        durationSec = probed;
      }
    }
    // ---- 长音轨：分段解码（不把整轨 PCM 搬进渲染进程）----
    // 分段必须在 arrayBuffer() 之前决定：一旦整块下载+解码，GB 级外部内存已经分配掉了。
    // 任何一步不成立（没时长 / 没体量 / 服务端不支持 Range）都退回整轨路径，行为与从前一致。
    // 用临时 AudioContext 解码（不能复用 audioCtx，它可能已 closed）。
    var TmpCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!TmpCtx) { hideBeatChip(); return null; }
    var DecodeCtx = window.AudioContext || window.webkitAudioContext;
    if (!DecodeCtx) { hideBeatChip(); return null; }
    var segPlan = null;
    if (durationSec && isFinite(durationSec) && durationSec > BEAT_ANALYSIS_SEGMENT_MIN_SEC && contentLength > 0) {
      segPlan = {
        totalSec: durationSec,
        bytesPerSec: contentLength / durationSec,
        contentLength: contentLength
      };
    }
    var ab = null;
    if (segPlan) {
      // 分段落定：不再需要这个完整响应，把 body 停掉，别让它在后台把整包拉完
      try { if (resp.body && resp.body.cancel) resp.body.cancel(); } catch (_) {}
      var segInput = await decodeBeatsInputBySegments(audioUrl, segPlan, token, options);
      if (token !== beatMapToken) { hideBeatChip(); return null; }
      if (segInput) {
        window.__lastBeatSegmentStats = segInput.stats;
      } else {
        console.warn('[beat] 分段解码不可用，回退整轨路径');
        resp = await fetch(audioUrl);
        if (token !== beatMapToken) { hideBeatChip(); return null; }
        ab = await resp.arrayBuffer();
        if (token !== beatMapToken) { hideBeatChip(); return null; }
      }
    } else {
      ab = await resp.arrayBuffer();
      if (token !== beatMapToken) { hideBeatChip(); return null; }
    }

    // ---- 输入源：整轨 或 分段 ----
    // 两条路径最后归结到同一组变量：四条频带的帧能量包络 + 总时长 + tempo/画像用的降采样 PCM。
    // 下游（onset / 节拍网格 / 音高画像）完全共用，不区分数据是怎么来的。
    var buffer = null;            // 仅整轨路径有
    var segMono = null;           // 仅分段路径有：降采样 mono，喂 tempo worker
    var segMonoRate = 0;
    var segProfilePcm = null;     // 仅分段路径有：音高画像用的降采样 PCM
    var segProfileRate = 0;
    var segProfileMeta = null;
    var energy = null, bodyEnergy = null, vocalEnergy = null, snapEnergy = null;
    var totalDuration = 0;
    var sr = 0;

    if (segInput) {
      energy = segInput.energy;
      bodyEnergy = segInput.bodyEnergy;
      vocalEnergy = segInput.vocalEnergy;
      snapEnergy = segInput.snapEnergy;
      totalDuration = segInput.duration;
      segMono = segInput.mono;
      segMonoRate = segInput.monoRate;
      segProfilePcm = segInput.profilePcm;
      segProfileRate = segInput.profileRate;
      segProfileMeta = segInput.profileMeta;
      sr = segInput.sampleRate;
      segInput = null;
    } else {
      var dc = new DecodeCtx();
      buffer = await new Promise(function(resolve, reject){
        // decodeAudioData 会接管并 detach 传入的 ArrayBuffer，用不着预先 slice。
        // 原先的 ab.slice(0) 让整条压缩音频在内存里同时存在两份（5 分钟歌 ≈ 24MB 白给）。
        dc.decodeAudioData(ab, resolve, reject);
      }).catch(function(e){ console.warn('decode failed:', e); return null; });
      ab = null;
      dc.close && dc.close();
      if (!buffer) { hideBeatChip(); return null; }
      if (token !== beatMapToken) { hideBeatChip(); return null; }
      // 预取路径传的是 null，拿不到时长；这里用解码出来的真实时长兜底
      // （也是唯一能在下载完成后拦住小时级音频的地方）。
      if (buffer.duration > BEAT_ANALYSIS_MAX_SEC) {
        console.warn('[beat] 跳过超长音轨分析:', Math.round(buffer.duration), 's >', BEAT_ANALYSIS_MAX_SEC, 's');
        hideBeatChip();
        return null;
      }
      totalDuration = buffer.duration;
      sr = buffer.sampleRate;
    }

    var musicTempoBeats = [];
    var musicTempoGridStep = 0;
    var musicTempoTask;
    if (options.skipMusicTempo) musicTempoTask = Promise.resolve(null);
    else if (segMono) musicTempoTask = analyzeMusicTempoFromMonoPcm(segMono, segMonoRate, token);
    else musicTempoTask = analyzeMusicTempoInWorker(buffer, token);

    // 分段路径已经把四条包络算好了，这里只补整轨路径
    if (!energy) {
      energy = await renderBandEnergy(38, 155);
      if (token !== beatMapToken || !energy) { hideBeatChip(); return null; }
      bodyEnergy = await renderBandEnergy(130, 420);
      if (token !== beatMapToken || !bodyEnergy) { hideBeatChip(); return null; }
      vocalEnergy = await renderBandEnergy(420, 2600);
      if (token !== beatMapToken || !vocalEnergy) { hideBeatChip(); return null; }
      snapEnergy = await renderBandEnergy(1800, 9000);
      if (token !== beatMapToken || !snapEnergy) { hideBeatChip(); return null; }
    }
    var nFrames = Math.min(energy.length, bodyEnergy.length, vocalEnergy.length, snapEnergy.length);
    function percentile(arr, p) {
      var copy = Array.prototype.slice.call(arr).sort(function(a,b){ return a-b; });
      return copy.length ? copy[Math.floor(copy.length * p)] : 0.001;
    }
    function bandAt(arr, f) {
      var a = arr[Math.max(0, f - 1)] || 0;
      var b = arr[f] || 0;
      var c = arr[Math.min(nFrames - 1, f + 1)] || 0;
      return (a + b * 2 + c) * 0.25;
    }
    var lowRef = Math.max(0.0008, percentile(energy, 0.86));
    var bodyRef = Math.max(0.0008, percentile(bodyEnergy, 0.86));
    var vocalRef = Math.max(0.0008, percentile(vocalEnergy, 0.86));
    var snapRef = Math.max(0.0008, percentile(snapEnergy, 0.86));

    // 计算 onset (能量正向差分), 然后取峰
    function makeOnset(arr) {
      var out = new Float32Array(nFrames);
      for (var oi = 1; oi < nFrames; oi++) {
        out[oi] = Math.max(0, arr[oi] - arr[oi - 1]);
      }
      return out;
    }
    var onset = makeOnset(energy);
    var bodyOnset = makeOnset(bodyEnergy);
    var vocalOnset = makeOnset(vocalEnergy);
    var snapOnset = makeOnset(snapEnergy);
    var lowOnsetRef = Math.max(0.00025, percentile(onset, 0.88));
    var bodyOnsetRef = Math.max(0.00025, percentile(bodyOnset, 0.88));
    var vocalOnsetRef = Math.max(0.00025, percentile(vocalOnset, 0.88));
    var snapOnsetRef = Math.max(0.00025, percentile(snapOnset, 0.88));

    function softGrooveFrameScore(frame) {
      var sf = Math.max(0, Math.min(nFrames - 1, Math.round(frame)));
      var lowTone = Math.min(2.2, bandAt(energy, sf) / lowRef);
      var bodyTone = Math.min(2.2, bandAt(bodyEnergy, sf) / bodyRef);
      var vocalTone = Math.min(2.2, bandAt(vocalEnergy, sf) / vocalRef);
      var snapTone = Math.min(2.2, bandAt(snapEnergy, sf) / snapRef);
      var lowRise = Math.min(2.6, (onset[sf] || 0) / lowOnsetRef);
      var bodyRise = Math.min(2.6, (bodyOnset[sf] || 0) / bodyOnsetRef);
      var vocalRise = Math.min(2.6, (vocalOnset[sf] || 0) / vocalOnsetRef);
      var snapRise = Math.min(2.6, (snapOnset[sf] || 0) / snapOnsetRef);
      var drumRise = lowRise * 0.52 + bodyRise * 0.42 + snapRise * 0.08;
      var drumTone = lowTone * 0.24 + bodyTone * 0.22 + snapTone * 0.05;
      var vocalLeak = Math.max(0, vocalRise + vocalTone * 0.30 - (lowRise + bodyRise) * 0.54 - 0.18);
      return Math.max(0, drumRise + drumTone - vocalLeak * 0.18);
    }

    function bestSoftGrooveFrameNear(time, radiusSec) {
      var center = Math.max(0, Math.min(nFrames - 1, Math.round(time / 0.010)));
      var radius = Math.max(1, Math.round(Math.max(0.010, radiusSec || 0.040) / 0.010));
      var base = softGrooveFrameScore(center);
      var bestFrame = center;
      var bestScore = base;
      for (var sf = Math.max(0, center - radius); sf <= Math.min(nFrames - 1, center + radius); sf++) {
        var dist = Math.abs(sf - center) / Math.max(1, radius);
        var score = softGrooveFrameScore(sf) * (1 - dist * 0.16);
        if (score > bestScore) {
          bestScore = score;
          bestFrame = sf;
        }
      }
      return { frame: bestFrame, time: bestFrame * 0.010, score: bestScore, base: base };
    }

    function scoreSoftGrooveTempoOffset(times, offset, step) {
      if (!times || !times.length) return 0;
      var total = 0;
      var weightTotal = 0;
      var localRadius = Math.min(0.026, Math.max(0.014, (step || 0.55) * 0.045));
      var stride = times.length > 720 ? 2 : 1;
      for (var si = 0; si < times.length; si += stride) {
        var t = times[si] + offset;
        if (!isFinite(t) || t < 1.0 || t > totalDuration - 0.40) continue;
        var slot = si % 4;
        var slotWeight = slot === 0 ? 1.22 : (slot === 2 ? 1.06 : 0.88);
        var point = bestSoftGrooveFrameNear(t, localRadius);
        total += point.score * slotWeight;
        weightTotal += slotWeight;
      }
      return weightTotal > 0 ? total / weightTotal : 0;
    }

    function estimateSoftGrooveTempoOffset(times, step) {
      if (!softGrooveAnalysis || !times || times.length < 8 || !step) return 0;
      var maxOffset = Math.min(0.20, Math.max(0.075, step * 0.32));
      var baseScore = scoreSoftGrooveTempoOffset(times, 0, step);
      var bestOffset = 0;
      var bestScore = baseScore;
      for (var off = -maxOffset; off <= maxOffset + 0.0001; off += 0.010) {
        var score = scoreSoftGrooveTempoOffset(times, off, step);
        if (score > bestScore) {
          bestScore = score;
          bestOffset = off;
        }
      }
      if (Math.abs(bestOffset) < 0.014) return 0;
      return bestScore > baseScore * 1.055 ? Math.max(-maxOffset, Math.min(maxOffset, bestOffset)) : 0;
    }

    function refineSoftGrooveBeatTime(time, step) {
      if (!softGrooveAnalysis || !analysisProfile.localRefine) return { time: time, score: 0, base: 0 };
      var radius = Math.min(0.058, Math.max(0.024, (step || 0.55) * 0.095));
      var point = bestSoftGrooveFrameNear(time, radius);
      if (Math.abs(point.time - time) < 0.011) return { time: time, score: point.score, base: point.base };
      if (point.score < point.base * 1.045) return { time: time, score: point.score, base: point.base };
      return { time: point.time, score: point.score, base: point.base };
    }

    function thinSoftGrooveCameraBeats(events, step, duration) {
      if (!analysisProfile.sparseCamera || !events || events.length < 6) return events || [];
      step = Math.max(0.001, step || medianGap(events.map(function(b){ return b.time; }), 0.30, 1.20) || 0.82);
      function moodScore(b) {
        if (!b) return 0;
        return (b.grooveEvidence || 0) * 0.56 + (b.impact || 0) * 0.34 + (b.strength || 0) * 0.18 + (b.low || 0) * 0.10 + (b.body || 0) * 0.08;
      }
      function eventPercentile(rows, p) {
        var vals = rows.map(function(row){ return row.score; }).sort(function(a,b){ return a-b; });
        return vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 0;
      }
      function medianNumber(vals) {
        vals = vals.filter(function(v){ return isFinite(v); }).sort(function(a,b){ return a-b; });
        return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
      }
      function cloneSparseBeat(b, score, accent, tag) {
        var out = Object.assign({}, b);
        out.primary = true;
        out.camera = true;
        out.pulse = true;
        out.sparse = true;
        out.tone = tag || 'sunset-groove';
        out.impact = clampRange((out.impact || out.strength || 0.30) * (accent ? 0.76 : 0.66) + score * 0.07, 0.18, accent ? 0.58 : 0.50);
        out.strength = clampRange((out.strength || 0.34) * (accent ? 0.76 : 0.68) + score * 0.055, 0.30, accent ? 0.64 : 0.56);
        out.mass = clampRange((out.mass || 0.48) * 0.78, 0.28, 0.60);
        out.sharpness = clampRange((out.sharpness || 0.10) * 0.66, 0.05, 0.32);
        out._sparseScore = score;
        return out;
      }
      function findBestEventNear(time, radius) {
        var best = null;
        var bestScore = -1;
        radius = radius || 0.20;
        for (var i = 0; i < events.length; i++) {
          var b = events[i];
          if (!b || !isFinite(b.time)) continue;
          var dist = Math.abs(b.time - time);
          if (dist > radius) continue;
          var score = moodScore(b) * (1 - dist / radius * 0.18);
          if (score > bestScore) {
            best = b;
            bestScore = score;
          }
        }
        return best ? { beat: best, score: Math.max(0, bestScore) } : null;
      }
      function buildBeatFromFrame(time, score, tag) {
        var f = Math.max(0, Math.min(nFrames - 1, Math.round(time / 0.010)));
        var lowTone = Math.min(2.0, bandAt(energy, f) / lowRef);
        var bodyTone = Math.min(2.0, bandAt(bodyEnergy, f) / bodyRef);
        var snapTone = Math.min(2.0, bandAt(snapEnergy, f) / snapRef);
        var toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58);
        var lowMix = lowTone / toneTotal;
        var bodyMix = (bodyTone * 0.72) / toneTotal;
        var snapMix = (snapTone * 0.58) / toneTotal;
        return {
          time: time,
          strength: clampRange(0.30 + score * 0.055, 0.30, 0.52),
          confidence: clampRange(0.46 + score * 0.08, 0.46, 0.66),
          primary: true,
          camera: true,
          pulse: true,
          sparse: true,
          tone: tag || 'sunset-pattern',
          impact: clampRange(0.18 + score * 0.060, 0.18, 0.48),
          low: Math.max(0.22, Math.min(0.74, lowMix)),
          body: bodyMix,
          snap: snapMix,
          mass: Math.max(0.30, Math.min(0.58, lowMix * 0.58 + bodyMix * 0.20)),
          sharpness: Math.max(0.05, Math.min(0.28, snapMix * 0.72))
        };
      }
      function learnIntroPattern() {
        if (!analysisProfile.introPattern) return null;
        var introEnd = Math.min(duration || 34, 34);
        var rows = events.filter(function(b){ return b && isFinite(b.time) && b.time >= 1.2 && b.time <= introEnd; })
          .map(function(b){ return { beat: b, score: moodScore(b) }; });
        if (rows.length < 6) return null;
        var scoreFloor = Math.max(0.34, eventPercentile(rows, 0.58));
        var hits = [];
        var minIntroGap = 1.08;
        rows.forEach(function(row){
          if (row.score < scoreFloor && !(row.beat && (row.beat.low || 0) > 0.42 && row.score > scoreFloor * 0.78)) return;
          var last = hits[hits.length - 1];
          if (last && row.beat.time - last.beat.time < minIntroGap) {
            if (row.score > last.score) hits[hits.length - 1] = row;
          } else {
            hits.push(row);
          }
        });
        if (hits.length < 5) return null;
        var gaps = [];
        for (var hi = 1; hi < hits.length; hi++) {
          var gap = hits[hi].beat.time - hits[hi - 1].beat.time;
          if (gap >= 1.18 && gap <= 2.45) gaps.push(gap);
        }
        if (gaps.length < 4) return null;
        var firstGaps = gaps.slice(0, Math.min(8, gaps.length));
        var evenGaps = [];
        var oddGaps = [];
        for (var gi = 0; gi < firstGaps.length; gi++) {
          (gi % 2 === 0 ? evenGaps : oddGaps).push(firstGaps[gi]);
        }
        var evenGap = medianNumber(evenGaps);
        var oddGap = medianNumber(oddGaps);
        var patternGaps;
        if (evenGap && oddGap && Math.abs(evenGap - oddGap) > 0.16) {
          patternGaps = [evenGap, oddGap].map(function(v){ return clampRange(v, 1.30, 2.22); });
        } else {
          patternGaps = [clampRange(medianNumber(firstGaps), 1.42, 2.12)];
        }
        var refScore = Math.max(0.35, eventPercentile(hits, 0.50));
        return {
          anchor: hits[0].beat.time,
          gaps: patternGaps,
          refScore: refScore,
          introHitCount: hits.length,
          introTimes: hits.slice(0, 10).map(function(row){ return row.beat.time; })
        };
      }
      function buildIntroPatternBeats() {
        var pattern = learnIntroPattern();
        if (!pattern) return null;
        var selected = [];
        var t = pattern.anchor;
        var gi = 0;
        var avgGap = pattern.gaps.reduce(function(a,b){ return a + b; }, 0) / Math.max(1, pattern.gaps.length);
        var refineRadius = Math.min(0.22, Math.max(0.14, avgGap * 0.10));
        var findRadius = Math.min(0.26, Math.max(0.18, avgGap * 0.13));
        while (t < (duration || 0) - 0.55) {
          var point = bestSoftGrooveFrameNear(t, refineRadius);
          var refinedTime = Math.abs(point.time - t) <= refineRadius ? point.time : t;
          var match = findBestEventNear(refinedTime, findRadius) || findBestEventNear(t, findRadius);
          var score = match ? match.score : Math.max(0.26, (point.score || 0) / Math.max(1.0, pattern.refScore * 2.2));
          var accent = (gi % pattern.gaps.length) === 0;
          var beat = match ? cloneSparseBeat(match.beat, score, accent, 'sunset-intro-pattern') : buildBeatFromFrame(refinedTime, score, 'sunset-intro-pattern');
          beat.time = refinedTime;
          beat.index = gi;
          beat.combo = accent ? 'downbeat' : 'rebound';
          beat.introPattern = true;
          selected.push(beat);
          t += pattern.gaps[gi % pattern.gaps.length];
          gi++;
          if (gi > 800) break;
        }
        for (var si = 0; si < selected.length; si++) delete selected[si]._sparseScore;
        console.log('soft-groove intro pattern camera:', selected.length, 'gaps:', pattern.gaps.map(function(v){ return v.toFixed(2); }).join('/'), 'anchor:', pattern.anchor.toFixed(2), 'introHits:', pattern.introHitCount);
        return selected.length >= 8 ? selected : null;
      }
      var introPatternBeats = buildIntroPatternBeats();
      if (introPatternBeats && introPatternBeats.length >= 8) return introPatternBeats;

      var railStep = step;
      while (railStep < 1.35) railStep *= 2;
      railStep = clampRange(railStep, 1.42, 2.12);
      var railMultiple = Math.max(1, Math.round(railStep / step));
      if (railMultiple < 2 && step < 1.20) railMultiple = 2;
      var phaseScores = new Array(railMultiple);
      for (var pi = 0; pi < phaseScores.length; pi++) phaseScores[pi] = 0;
      for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei];
        if (!ev || !isFinite(ev.time)) continue;
        if (ev.time < 1.0 || (duration && ev.time > duration - 0.65)) continue;
        var phase = Math.abs((ev.index == null ? ei : ev.index) % railMultiple);
        var earlyWeight = ev.time < 70 ? 1.18 : (ev.time < 205 ? 1.0 : 0.94);
        phaseScores[phase] += moodScore(ev) * earlyWeight;
      }
      var bestPhase = 0;
      for (var ps = 1; ps < phaseScores.length; ps++) {
        if (phaseScores[ps] > phaseScores[bestPhase]) bestPhase = ps;
      }
      var selected = [];
      var minGap = Math.max(1.12, railStep * 0.68);
      function pushSparse(b, score, accent) {
        if (!b || score < 0.28) return;
        var copy = cloneSparseBeat(b, score, accent, 'sunset-groove');
        copy.combo = selected.length % 2 === 0 ? 'downbeat' : 'rebound';
        var last = selected[selected.length - 1];
        if (last && copy.time - last.time < minGap) {
          if (score > (last._sparseScore || 0) + 0.05) selected[selected.length - 1] = copy;
          return;
        }
        selected.push(copy);
      }
      for (var si = 0; si < events.length; si++) {
        var b = events[si];
        if (!b || !isFinite(b.time)) continue;
        var idx = b.index == null ? si : b.index;
        var score = moodScore(b);
        var onRail = Math.abs(idx % railMultiple) === bestPhase;
        if (onRail) {
          pushSparse(b, score, false);
        } else if (score >= 0.82 && (!selected.length || b.time - selected[selected.length - 1].time >= minGap * 1.18)) {
          pushSparse(b, score, true);
        }
      }
      for (var ci = 0; ci < selected.length; ci++) {
        delete selected[ci]._sparseScore;
      }
      var minExpected = duration ? Math.max(16, Math.floor(duration / 3.2)) : 16;
      if (selected.length < minExpected) {
        var fallback = events.filter(function(b){ return b && b.camera !== false && b.pulse !== false; });
        selected = [];
        for (var fi = 0; fi < fallback.length; fi++) pushSparse(fallback[fi], moodScore(fallback[fi]), false);
        for (var di = 0; di < selected.length; di++) delete selected[di]._sparseScore;
      }
      console.log('soft-groove sparse camera:', selected.length, 'of', events.length, 'railStep:', railStep.toFixed(2), 'phase:', bestPhase + '/' + railMultiple);
      return selected.length >= 4 ? selected : events.filter(function(b){ return b && b.camera !== false; });
    }

    // 自适应阈值: 滑动均值 + 标准差, 输出带强度的 beat 事件.
    var winN = 50;  // 0.5 秒
    var candidates = [];
    var lastKickFrame = -winN;
    var minIntervalFrames = 12;  // 120ms, 粒子可响应较密集的低频瞬态.
    for (var f = winN; f < nFrames - 5; f++) {
      var sum = 0, sqSum = 0;
      for (var k = f - winN; k < f; k++) { sum += onset[k]; sqSum += onset[k] * onset[k]; }
      var mean = sum / winN;
      var std = Math.sqrt(Math.max(0, sqSum / winN - mean * mean));
      var thresh = mean + std * 2.35 + 0.0045;
      if (onset[f] > thresh && onset[f] > onset[f-1] && onset[f] >= onset[f+1]) {
        if (f - lastKickFrame >= minIntervalFrames) {
          var localScore = (onset[f] - thresh) / Math.max(0.006, std + mean * 0.35);
          candidates.push({
            frame: f,
            time: f * 0.010,
            raw: onset[f],
            score: localScore,
            lowTone: Math.min(2.0, bandAt(energy, f) / lowRef),
            bodyTone: Math.min(2.0, bandAt(bodyEnergy, f) / bodyRef),
            vocalTone: Math.min(2.0, bandAt(vocalEnergy, f) / vocalRef),
            snapTone: Math.min(2.0, bandAt(snapEnergy, f) / snapRef)
          });
          lastKickFrame = f;
        }
      }
      if (f > winN && f % 900 === 0) {
        await yieldToPaint();
        if (token !== beatMapToken) { hideBeatChip(); return null; }
      }
    }

    var scores = candidates.map(function(b){ return b.score; }).sort(function(a,b){ return a-b; });
    var p75 = scores.length ? scores[Math.floor(scores.length * 0.75)] : 1;
    var p92 = scores.length ? scores[Math.floor(scores.length * 0.92)] : Math.max(1, p75);
    var strongTimes = [];
    var beats = candidates.map(function(b, i){
      var strength = Math.max(0.18, Math.min(1, (b.score - p75 * 0.36) / Math.max(0.001, p92 - p75 * 0.36)));
      var lowDominance = b.lowTone / Math.max(0.001, b.vocalTone * 0.84 + b.bodyTone * 0.36 + b.snapTone * 0.10);
      var toneTotal = Math.max(0.001, b.lowTone + b.bodyTone * 0.72 + b.snapTone * 0.58);
      var lowMix = b.lowTone / toneTotal;
      var bodyMix = (b.bodyTone * 0.72) / toneTotal;
      var snapMix = (b.snapTone * 0.58) / toneTotal;
      var drumLike = b.lowTone > 0.38 && (lowMix > 0.42 || lowDominance > 0.72);
      if (strength > 0.55 && drumLike) strongTimes.push(b.time);
      var sharpness = Math.max(0.08, Math.min(1, snapMix * 1.55 + strength * 0.10));
      var mass = Math.max(0.25, Math.min(1, lowMix * 0.72 + bodyMix * 0.36 + strength * 0.20));
      var tone = snapMix > 0.34 && b.snapTone > 0.55 ? 'snap' : (bodyMix > 0.36 && b.bodyTone > 0.55 ? 'body' : (lowMix > 0.55 ? 'deep' : 'mixed'));
      return {
        time: b.time,
        strength: strength,
        confidence: Math.max(0.22, Math.min(1, b.score / Math.max(0.001, p92))),
        primary: drumLike && strength >= 0.50,
        camera: drumLike && strength >= 0.42,
        tone: tone,
        low: lowMix,
        body: bodyMix,
        snap: snapMix,
        mass: mass,
        sharpness: sharpness,
        index: i
      };
    });

    var gaps = [];
    for (var gi = 1; gi < strongTimes.length; gi++) {
      var gap = strongTimes[gi] - strongTimes[gi - 1];
      if (gap >= 0.26 && gap <= 0.86) gaps.push(gap);
    }
    gaps.sort(function(a,b){ return a-b; });
    var gridStep = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
    var cameraBeats = beats.filter(function(b){ return b.camera; });
    if (gridStep > 0) {
      for (var bi = 0; bi < beats.length; bi++) {
        var prevGap = bi > 0 ? beats[bi].time - beats[bi - 1].time : gridStep;
        var nextGap = bi < beats.length - 1 ? beats[bi + 1].time - beats[bi].time : gridStep;
        var gridLike = Math.abs(prevGap - gridStep) < gridStep * 0.32 || Math.abs(nextGap - gridStep) < gridStep * 0.32;
        beats[bi].primary = beats[bi].camera && beats[bi].strength >= (gridLike ? 0.42 : 0.58);
      }
      if (gridStep >= 0.38 && gridStep <= 0.88 && strongTimes.length >= 4) {
        var anchor = strongTimes[0];
        while (anchor - gridStep > 0.20) anchor -= gridStep;
        var gridBeats = [];
        var windowSec = Math.min(0.18, gridStep * 0.30);
        for (var gt = anchor; gt < totalDuration - 0.05; gt += gridStep) {
          var best = null;
          var bestDist = windowSec;
          for (var ci = 0; ci < beats.length; ci++) {
            var dist = Math.abs(beats[ci].time - gt);
            if (dist < bestDist) {
              best = beats[ci];
              bestDist = dist;
            }
          }
          if (best && best.camera) {
            best.primary = true;
            best.strength = Math.max(best.strength, 0.54);
            best.confidence = Math.max(best.confidence, 0.58);
            gridBeats.push(best);
          } else {
            var gf = Math.max(0, Math.min(nFrames - 1, Math.round(gt / 0.010)));
            var lowTone = Math.min(2.0, bandAt(energy, gf) / lowRef);
            var bodyTone = Math.min(2.0, bandAt(bodyEnergy, gf) / bodyRef);
            var vocalTone = Math.min(2.0, bandAt(vocalEnergy, gf) / vocalRef);
            var snapTone = Math.min(2.0, bandAt(snapEnergy, gf) / snapRef);
            var lowDominance = lowTone / Math.max(0.001, vocalTone * 0.84 + bodyTone * 0.36 + snapTone * 0.10);
            var toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58);
            var lowMix = lowTone / toneTotal;
            var bodyMix = (bodyTone * 0.72) / toneTotal;
            var snapMix = (snapTone * 0.58) / toneTotal;
            if (lowTone <= 0.38 || (lowMix <= 0.42 && lowDominance <= 0.72)) continue;
            gridBeats.push({
              time: gt,
              strength: 0.53,
              confidence: 0.60,
              primary: true,
              ghost: true,
              tone: 'grid',
              low: lowMix,
              body: bodyMix,
              snap: snapMix,
              mass: Math.max(0.35, Math.min(0.82, lowMix * 0.72 + bodyMix * 0.36 + 0.16)),
              sharpness: Math.max(0.08, Math.min(0.65, snapMix * 1.25)),
              index: gridBeats.length
            });
          }
        }
        cameraBeats = gridBeats;
      }
    }

    var musicTempoResult = await musicTempoTask;
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    if (musicTempoResult && musicTempoResult.beats && musicTempoResult.beats.length) {
      musicTempoBeats = normalizeMusicTempoBeats(musicTempoResult.beats || [], totalDuration);
      musicTempoGridStep = medianGap(musicTempoBeats, 0.36, 1.00);
      console.log('music-tempo worker:', musicTempoResult.tempo, 'bpm, beats:', musicTempoBeats.length, 'step:', musicTempoGridStep);
    }

    if (musicTempoBeats.length >= 4) {
      var musicTempoPhaseOffset = estimateTempoPhaseOffset(musicTempoBeats, beats, musicTempoGridStep || gridStep, totalDuration);
      if (musicTempoPhaseOffset) {
        musicTempoBeats = musicTempoBeats.map(function(t){ return t + musicTempoPhaseOffset; })
          .filter(function(t){ return isFinite(t) && t >= 0.05 && t < totalDuration - 0.05; });
        console.log('music-tempo phase correction:', musicTempoPhaseOffset.toFixed(3), 's');
      }
      if (analysisProfile.phaseScan) {
        var softGroovePhaseOffset = estimateSoftGrooveTempoOffset(musicTempoBeats, musicTempoGridStep || gridStep);
        if (softGroovePhaseOffset) {
          musicTempoBeats = musicTempoBeats.map(function(t){ return t + softGroovePhaseOffset; })
            .filter(function(t){ return isFinite(t) && t >= 0.05 && t < totalDuration - 0.05; });
          console.log('soft-groove phase correction:', softGroovePhaseOffset.toFixed(3), 's');
        }
      }
      var tempoCameraBeats = [];
      var tempoWindow = Math.min(0.16, Math.max(0.095, (musicTempoGridStep || 0.60) * 0.24));
      var tempoMetrics = [];
      for (var ti = 0; ti < musicTempoBeats.length; ti++) {
        var mtTime = musicTempoBeats[ti];
        var refinedPoint = refineSoftGrooveBeatTime(mtTime, musicTempoGridStep || gridStep);
        var metricTime = refinedPoint.time;
        var nearest = null;
        var nearestDist = tempoWindow;
        for (var nb = 0; nb < beats.length; nb++) {
          var nd = Math.abs(beats[nb].time - metricTime);
          if (nd < nearestDist) {
            nearest = beats[nb];
            nearestDist = nd;
          }
        }
        var mf = Math.max(0, Math.min(nFrames - 1, Math.round(metricTime / 0.010)));
        var mtLowTone = Math.min(2.0, bandAt(energy, mf) / lowRef);
        var mtBodyTone = Math.min(2.0, bandAt(bodyEnergy, mf) / bodyRef);
        var mtVocalTone = Math.min(2.0, bandAt(vocalEnergy, mf) / vocalRef);
        var mtSnapTone = Math.min(2.0, bandAt(snapEnergy, mf) / snapRef);
        var mtLowRise = Math.min(2.5, (onset[mf] || 0) / lowOnsetRef);
        var mtBodyRise = Math.min(2.5, (bodyOnset[mf] || 0) / bodyOnsetRef);
        var mtVocalRise = Math.min(2.5, (vocalOnset[mf] || 0) / vocalOnsetRef);
        var mtSnapRise = Math.min(2.5, (snapOnset[mf] || 0) / snapOnsetRef);
        var mtLowDominance = mtLowTone / Math.max(0.001, mtVocalTone * 0.84 + mtBodyTone * 0.36 + mtSnapTone * 0.10);
        var mtToneTotal = Math.max(0.001, mtLowTone + mtBodyTone * 0.72 + mtSnapTone * 0.58);
        var mtLowMix = mtLowTone / mtToneTotal;
        var mtBodyMix = (mtBodyTone * 0.72) / mtToneTotal;
        var mtSnapMix = (mtSnapTone * 0.58) / mtToneTotal;
        var mtPower = mtLowTone * 0.44 + mtBodyTone * 0.16 + mtSnapTone * 0.08 + Math.min(1.8, mtLowDominance) * 0.16 + (nearest ? nearest.strength * 0.46 : 0);
        if (softGrooveAnalysis) {
          var vocalLeak = Math.max(0, mtVocalRise + mtVocalTone * 0.22 - (mtLowRise + mtBodyRise) * 0.50 - 0.14);
          mtPower = mtLowTone * 0.26 + mtBodyTone * 0.24 + mtLowRise * 0.34 + mtBodyRise * 0.32 + mtSnapRise * 0.06 + Math.min(1.7, mtLowDominance) * 0.10 + (nearest ? nearest.strength * 0.30 : 0) - vocalLeak * 0.16;
        }
        tempoMetrics.push({
          time: metricTime,
          gridTime: mtTime,
          nearest: nearest,
          lowTone: mtLowTone,
          bodyTone: mtBodyTone,
          snapTone: mtSnapTone,
          lowRise: mtLowRise,
          bodyRise: mtBodyRise,
          snapRise: mtSnapRise,
          lowDominance: mtLowDominance,
          lowMix: mtLowMix,
          bodyMix: mtBodyMix,
          snapMix: mtSnapMix,
          power: mtPower,
          softScore: refinedPoint.score || 0,
          index: ti
        });
      }
      var tempoPowers = tempoMetrics.map(function(m){ return m.power; });
      var tempoLowTones = tempoMetrics.map(function(m){ return m.lowTone; });
      var tempoBodyTones = tempoMetrics.map(function(m){ return m.bodyTone; });
      var tempoSnapTones = tempoMetrics.map(function(m){ return m.snapTone; });
      var tempoLowRises = tempoMetrics.map(function(m){ return m.lowRise || 0; });
      var tempoBodyRises = tempoMetrics.map(function(m){ return m.bodyRise || 0; });
      var tempoSnapRises = tempoMetrics.map(function(m){ return m.snapRise || 0; });
      var powerFloor = Math.max(0.001, percentile(tempoPowers, 0.25));
      var powerCeil = Math.max(powerFloor + 0.001, percentile(tempoPowers, 0.90));
      var lowFloor = Math.max(0.001, percentile(tempoLowTones, 0.25));
      var lowCeil = Math.max(lowFloor + 0.001, percentile(tempoLowTones, 0.88));
      var bodyFloor = Math.max(0.001, percentile(tempoBodyTones, 0.25));
      var bodyCeil = Math.max(bodyFloor + 0.001, percentile(tempoBodyTones, 0.90));
      var snapFloor = Math.max(0.001, percentile(tempoSnapTones, 0.25));
      var snapCeil = Math.max(snapFloor + 0.001, percentile(tempoSnapTones, 0.90));
      var lowRiseFloor = Math.max(0.001, percentile(tempoLowRises, 0.25));
      var lowRiseCeil = Math.max(lowRiseFloor + 0.001, percentile(tempoLowRises, 0.90));
      var bodyRiseFloor = Math.max(0.001, percentile(tempoBodyRises, 0.25));
      var bodyRiseCeil = Math.max(bodyRiseFloor + 0.001, percentile(tempoBodyRises, 0.90));
      var snapRiseFloor = Math.max(0.001, percentile(tempoSnapRises, 0.25));
      var snapRiseCeil = Math.max(snapRiseFloor + 0.001, percentile(tempoSnapRises, 0.90));
      for (var tm = 0; tm < tempoMetrics.length; tm++) {
        var m = tempoMetrics[tm];
        var mtSlot = m.index % 4;
        var powerRel = clamp01((m.power - powerFloor) / (powerCeil - powerFloor));
        var lowRel = clamp01((m.lowTone - lowFloor) / (lowCeil - lowFloor));
        var bodyRel = clamp01((m.bodyTone - bodyFloor) / (bodyCeil - bodyFloor));
        var snapRel = clamp01((m.snapTone - snapFloor) / (snapCeil - snapFloor));
        var lowRiseRel = clamp01(((m.lowRise || 0) - lowRiseFloor) / (lowRiseCeil - lowRiseFloor));
        var bodyRiseRel = clamp01(((m.bodyRise || 0) - bodyRiseFloor) / (bodyRiseCeil - bodyRiseFloor));
        var snapRiseRel = clamp01(((m.snapRise || 0) - snapRiseFloor) / (snapRiseCeil - snapRiseFloor));
        var mtImpact = clamp01(powerRel * 0.50 + lowRel * 0.24 + bodyRel * 0.18 + snapRel * 0.08);
        if (m.nearest) mtImpact = Math.max(mtImpact, Math.min(1, m.nearest.strength * 0.58 + (m.nearest.primary ? 0.08 : 0)));
        if (softGrooveAnalysis) {
          mtImpact = clamp01(powerRel * 0.34 + lowRel * 0.18 + bodyRel * 0.18 + lowRiseRel * 0.24 + bodyRiseRel * 0.24 + snapRiseRel * 0.04);
          if (m.nearest) mtImpact = Math.max(mtImpact, Math.min(0.72, m.nearest.strength * 0.42 + (m.nearest.primary ? 0.06 : 0)));
        }
        var activeCamera = mtImpact >= 0.20 || (mtSlot === 0 && mtImpact >= 0.15 && (lowRel > 0.20 || bodyRel > 0.26));
        var activePulse = mtImpact >= 0.24 || (mtSlot === 0 && mtImpact >= 0.18);
        var grooveEvidence = lowRiseRel * 0.52 + bodyRiseRel * 0.48 + lowRel * 0.20 + bodyRel * 0.18;
        if (softGrooveAnalysis) {
          activeCamera = mtImpact >= 0.19 || (mtSlot === 0 && mtImpact >= 0.135 && grooveEvidence >= 0.32);
          activePulse = mtImpact >= 0.23 || (mtSlot === 0 && mtImpact >= 0.165 && grooveEvidence >= 0.28);
        }
        var downbeatLift = activeCamera ? (mtSlot === 0 ? 0.14 : (mtSlot === 2 ? 0.06 : 0)) : 0;
        var mtStrength = 0.26 + powerRel * 0.23 + lowRel * 0.10 + bodyRel * 0.08 + snapRel * 0.04 + downbeatLift;
        if (m.nearest) mtStrength = Math.max(mtStrength, 0.42 + m.nearest.strength * 0.28);
        if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.54 + mtImpact * 0.16);
        if (!activeCamera) mtStrength = Math.min(mtStrength, 0.36);
        if (softGrooveAnalysis) {
          mtStrength = 0.24 + powerRel * 0.18 + lowRel * 0.08 + bodyRel * 0.08 + lowRiseRel * 0.13 + bodyRiseRel * 0.12 + downbeatLift * 0.90;
          if (m.nearest) mtStrength = Math.max(mtStrength, 0.36 + m.nearest.strength * 0.22);
          if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.50 + mtImpact * 0.15);
          if (mtSlot === 2 && activeCamera) mtStrength = Math.max(mtStrength, 0.43 + mtImpact * 0.10);
          if (!activeCamera) mtStrength = Math.min(mtStrength, 0.34);
          mtStrength = Math.max(0.28, Math.min(0.76, mtStrength));
        } else {
          mtStrength = Math.max(0.30, Math.min(0.82, mtStrength));
        }
        var lowForCamera = Math.max(0.22, Math.min(0.78, m.lowMix * 0.82 + lowRel * 0.18));
        tempoCameraBeats.push({
          time: m.time,
          strength: mtStrength,
          confidence: m.nearest ? Math.max(0.60, m.nearest.confidence || 0) : Math.max(0.52, 0.48 + powerRel * 0.28),
          primary: activeCamera,
          camera: activeCamera,
          pulse: activePulse,
          impact: mtImpact,
          tone: 'music-tempo',
          grooveEvidence: grooveEvidence,
          low: lowForCamera,
          body: m.bodyMix,
          snap: m.snapMix,
          mass: Math.max(0.35, Math.min(0.86, lowForCamera * 0.68 + m.bodyMix * 0.24 + mtStrength * 0.16)),
          sharpness: Math.max(0.08, Math.min(0.65, m.snapMix * 1.18)),
          combo: mtSlot === 0 ? 'downbeat' : (mtSlot === 1 ? 'push' : (mtSlot === 2 ? 'drop' : 'rebound')),
          index: m.index
        });
      }
      if (tempoCameraBeats.length >= 4) {
        if (analysisProfile.sparseCamera) {
          tempoCameraBeats = thinSoftGrooveCameraBeats(tempoCameraBeats, musicTempoGridStep || gridStep, totalDuration);
        }
        cameraBeats = tempoCameraBeats;
        gridStep = musicTempoGridStep || gridStep;
      }
    }

    var kicks = beats.map(function(b){ return b.time; });
    var visualBeatCount = 0;
    var pulseBeats = cameraBeats.filter(function(b){
      if (typeof b === 'number') {
        visualBeatCount++;
        return true;
      }
      var active = b.primary !== false && b.camera !== false && b.pulse !== false;
      if (active) visualBeatCount++;
      return active && (b.strength >= 0.38 || (b.impact || 0) >= 0.20);
    }).map(function(b){
      if (typeof b === 'number') return { time: b, strength: 0.42, impact: 0.42 };
      return {
        time: b.time,
        strength: b.strength,
        impact: b.impact == null ? b.strength : b.impact,
        combo: b.combo,
        low: b.low,
        body: b.body,
        snap: b.snap
      };
    });
    await yieldToPaint();
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    if (options.prefetch) hideBeatChip();
    else showBeatChip('节奏缓冲中…');
    // 音高/和声画像：cuefield v2 的 musicalEvidence 全靠它（没有它 4 个 recipe 永远不 eligible）。
    // 单独 try：画像失败绝不能把整份 beatmap 弄丢。
    var musicalProfile = null;
    if (options.skipMusicalProfile !== true) {
      try {
        if (segProfilePcm) {
          musicalProfile = await analyzeMusicalProfileFromPcm(segProfilePcm, segProfileRate, totalDuration, token, segProfileMeta);
        } else {
          musicalProfile = await analyzeMusicalProfile(buffer, token);
        }
      } catch (mpErr) {
        console.warn('musical profile failed:', mpErr && mpErr.message || mpErr);
        musicalProfile = null;
      }
      if (token !== beatMapToken) { hideBeatChip(); return null; }
    }
    return { kicks: kicks, beats: beats, pulseBeats: pulseBeats, cameraBeats: cameraBeats, gridStep: gridStep, tempoSource: musicTempoBeats.length >= 4 ? 'music-tempo' : 'local', analysisProfile: analysisProfile.id || 'default', duration: totalDuration, visualBeatCount: visualBeatCount, analyzedAt: Date.now(), musicalProfile: musicalProfile };
  } catch (e) {
    console.warn('beat analysis failed:', e);
    hideBeatChip();
    return null;
  } finally {
    beatMapBusy = false;
  }

  // ===================== 长音轨分段解码 =====================
  // 为什么要有它：整轨路径的峰值内存是线性的，55 分钟就是 5.3GB 量级
  // （解码后 AudioBuffer 1.27GB + 每条频带的 OfflineAudioContext 渲染目标 0.63GB×4
  //   + tempo 用的整轨 mono 0.63GB）。这些全都不计入 V8 堆，performance.memory
  // 看不见，但直接把渲染进程往 commit 上限推 —— 崩溃dump里那 3.8GB 的私有分配区就是它。
  //
  // 做法：按 HTTP Range 一段一段拉，每段单独 decodeAudioData，只保留 10ms 帧能量包络
  // 和两份降采样 PCM（tempo 用 22.05kHz mono、音高画像用 11.025kHz mono）。
  // 任意时刻渲染进程里只有一段音频的 PCM（120s ≈ 46MB），整轨 PCM 从头到尾不存在。
  //
  // 返回 null 表示"这条路走不通"（服务端不支持 Range / 解不出 / 时长对不上），
  // 调用方据此回退整轨路径 —— 宁可慢，不能没有节拍图。
  async function decodeBeatsInputBySegments(audioUrl, plan, token, options) {
    if (options.prefetch) showBeatChip('预热长音频节奏（分段）…');
    else showBeatChip('正在分析长音频节奏（分段）…');

    var bands = [[38, 155], [130, 420], [420, 2600], [1800, 9000]];
    var envParts = [null, null, null, null];
    var monoParts = [];
    var profileParts = [];
    var monoRate = 0;
    var profileRate = 0;
    var sampleRate = 0;
    var coveredSec = 0;       // 时间轴上已经"吃掉"的秒数（按实际解码出来的时长推进）
    var segments = 0;
    var guard = 0;
    var maxSegments = Math.ceil(plan.totalSec / BEAT_ANALYSIS_SEGMENT_SEC) + 4;

    while (coveredSec < plan.totalSec - 1.0 && guard < maxSegments) {
      guard++;
      if (token !== beatMapToken) { hideBeatChip(); return null; }
      var t0 = coveredSec;
      var byteStart = Math.max(0, Math.floor(t0 * plan.bytesPerSec) - (segments === 0 ? 0 : BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES));
      var byteEnd = Math.min(plan.contentLength - 1,
        Math.ceil((t0 + BEAT_ANALYSIS_SEGMENT_SEC) * plan.bytesPerSec) + BEAT_ANALYSIS_SEGMENT_PREROLL_BYTES);
      if (byteEnd <= byteStart) break;

      var segResp;
      try {
        segResp = await fetch(audioUrl, { headers: { Range: 'bytes=' + byteStart + '-' + byteEnd } });
      } catch (_) { return null; }
      // 服务端不支持 Range 时会给 200 + 整个 body：那正是要避免的整块下载，直接放弃分段
      if (!segResp || segResp.status !== 206) { hideBeatChip(); return null; }
      var segAb;
      try { segAb = await segResp.arrayBuffer(); } catch (_) { return null; }
      if (!segAb || !segAb.byteLength) { return null; }
      if (token !== beatMapToken) { hideBeatChip(); return null; }

      var segDc = new DecodeCtx();
      var segBuf = await new Promise(function(resolve, reject){
        segDc.decodeAudioData(segAb, resolve, reject);
      }).catch(function(e){ console.warn('[beat] 分段解码失败:', e && e.message || e); return null; });
      segAb = null;
      try { segDc.close && segDc.close(); } catch (_) {}
      if (!segBuf || !segBuf.length || !segBuf.sampleRate) { return null; }
      if (token !== beatMapToken) { hideBeatChip(); return null; }
      if (sampleRate === 0) sampleRate = segBuf.sampleRate;
      else if (Math.abs(segBuf.sampleRate - sampleRate) > 1) { return null; }

      var segWin = Math.floor(sampleRate * 0.010);
      // 段首丢一小截：从任意字节偏移起解，解码器要先重同步，开头几十毫秒是垃圾。
      // 不丢的话每个段边界都会出一个假 onset，直接被当成鼓点。
      var trimFrames = segments === 0 ? 0 : Math.ceil(BEAT_ANALYSIS_SEGMENT_TRIM_SEC / 0.010);
      for (var bi = 0; bi < bands.length; bi++) {
        var part = await renderBandEnergyOn(segBuf, bands[bi][0], bands[bi][1]);
        if (!part) { hideBeatChip(); return null; }
        var kept = trimFrames > 0 && part.length > trimFrames + 8 ? part.subarray(trimFrames) : part;
        if (!envParts[bi]) envParts[bi] = [];
        envParts[bi].push(kept);
        part = null;
      }
      // tempo 用的降采样 mono
      var monoPart = downsampleMono(segBuf, BEAT_ANALYSIS_TEMPO_RATE);
      if (!monoPart) { return null; }
      monoParts.push(monoPart.pcm);
      // 音高画像用的降采样 mono（~11.025kHz）
      var profilePart = downsampleMono(segBuf, MUSICAL_PROFILE_SAMPLE_RATE);
      if (!profilePart) { return null; }
      profileParts.push(profilePart.pcm);
      // downsampleMono 在「目标率高于源速率」时按源速率原样返回，所以实际速率
      // 必须用它回给我的 rate，不能拿目标率常量硬顶 —— 顶了就是把错的采样率
      // 传给 tempo worker / chroma FFT，拍速和音高映射全歪。
      if (monoRate === 0) monoRate = monoPart.rate;
      else if (Math.abs(monoPart.rate - monoRate) > 1) { return null; }
      if (profileRate === 0) profileRate = profilePart.rate;
      else if (Math.abs(profilePart.rate - profileRate) > 1) { return null; }

      coveredSec += Math.max(0, segBuf.duration - (trimFrames * 0.010));
      segments++;
      segBuf = null;
      await yieldToIdle(beatAnalysisYieldMs(options, 30, 160));
      if (token !== beatMapToken) { hideBeatChip(); return null; }
    }

    if (!segments || coveredSec < 2.0 || !monoRate || !profileRate) { hideBeatChip(); return null; }

    var energy = concatFloat32(envParts[0]);
    var bodyEnergy = concatFloat32(envParts[1]);
    var vocalEnergy = concatFloat32(envParts[2]);
    var snapEnergy = concatFloat32(envParts[3]);
    for (var ei = 0; ei < 4; ei++) envParts[ei] = null;
    if (!energy || !bodyEnergy || !vocalEnergy || !snapEnergy) { hideBeatChip(); return null; }

    var mono = concatFloat32(monoParts);
    monoParts.length = 0;
    var profilePcm = concatFloat32(profileParts);
    profileParts.length = 0;

    // 段尾 preroll 会让覆盖时长略超真实时长（900s 实测 910s）。超出去的那截
    // 必须裁掉，否则 duration / 节拍网格会比音轨本身还长，视觉特效会跑到曲子外面。
    var overSec = coveredSec - plan.totalSec;
    if (overSec > 0.05) {
      var drop = Math.min(Math.floor(overSec / 0.010), energy.length - 1000);
      if (drop > 0) {
        energy = energy.subarray(0, energy.length - drop);
        bodyEnergy = bodyEnergy.subarray(0, bodyEnergy.length - drop);
        vocalEnergy = vocalEnergy.subarray(0, vocalEnergy.length - drop);
        snapEnergy = snapEnergy.subarray(0, snapEnergy.length - drop);
        var keepMono = Math.max(0, mono.length - Math.round(drop * 0.010 * monoRate));
        if (keepMono < mono.length) mono = mono.subarray(0, keepMono);
        var keepProfile = Math.max(0, profilePcm.length - Math.round(drop * 0.010 * profileRate));
        if (keepProfile < profilePcm.length) profilePcm = profilePcm.subarray(0, keepProfile);
        coveredSec -= drop * 0.010;
      }
    }

    var stats = {
      segments: segments,
      coveredSec: Math.round(coveredSec * 10) / 10,
      requestedSec: Math.round(plan.totalSec * 10) / 10,
      bytesPerSec: Math.round(plan.bytesPerSec),
      frames: energy.length,
      monoRate: monoRate,
      profileRate: profileRate
    };
    console.log('[beat] 分段解码完成:', JSON.stringify(stats));

    return {
      energy: energy,
      bodyEnergy: bodyEnergy,
      vocalEnergy: vocalEnergy,
      snapEnergy: snapEnergy,
      duration: coveredSec,
      sampleRate: sampleRate,
      mono: mono,
      monoRate: monoRate,
      profilePcm: profilePcm,
      profileRate: profileRate,
      profileMeta: { srcRate: sampleRate, decim: Math.max(1, Math.round(sampleRate / profileRate)) },
      stats: stats
    };
  }

  // 盒式平均降采样 + 混 mono。targetRate 高于源速率时原样返回（不升采样）。
  function downsampleMono(buf, targetRate) {
    var srcRate = buf.sampleRate;
    var channels = buf.numberOfChannels || 1;
    var chData = [];
    for (var c = 0; c < channels; c++) chData.push(buf.getChannelData(c));
    if (targetRate >= srcRate) {
      var monoFull = new Float32Array(buf.length);
      var scaleFull = 1 / channels;
      for (var i = 0; i < buf.length; i++) {
        var acc = 0;
        for (var ci = 0; ci < channels; ci++) acc += chData[ci][i];
        monoFull[i] = acc * scaleFull;
      }
      return { pcm: monoFull, rate: srcRate };
    }
    var decim = Math.max(1, Math.round(srcRate / targetRate));
    var outLen = Math.floor(buf.length / decim);
    if (outLen < 1) return null;
    var out = new Float32Array(outLen);
    var scale = 1 / (decim * channels);
    for (var o = 0; o < outLen; o++) {
      var base = o * decim;
      var sum = 0;
      for (var k = 0; k < decim; k++) {
        var pos = base + k;
        for (var cj = 0; cj < channels; cj++) sum += chData[cj][pos];
      }
      out[o] = sum * scale;
    }
    return { pcm: out, rate: srcRate / decim };
  }

  // 边拷边释放：否则「所有分片 + 合并结果」同时在场，55 分钟的 mono 就是 582MB。
  function concatFloat32(parts) {
    if (!parts || !parts.length) return null;
    if (parts.length === 1) return parts[0];
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Float32Array(total);
    var at = 0;
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], at); at += parts[j].length; parts[j] = null; }
    return out;
  }
}

// 用 <audio> 元素探时长：只读元数据不播放，Chromium 只会拉开头一小段。
// 时长元数据缺失（durationSec=0）但文件已经不小的时候必须走这一步，
// 否则"时长未知 + 上百 MB"会绕过第一道闸，整轨下载+解码照样把渲染进程顶爆。
function probeAudioDurationSec(audioUrl, token) {
  return new Promise(function(resolve){
    var settled = false;
    var el = null;
    function fin(v) {
      if (settled) return;
      settled = true;
      try { if (el) { el.onloadedmetadata = null; el.onerror = null; el.src = ''; } } catch (_) {}
      resolve(v > 0 && isFinite(v) ? v : 0);
    }
    try {
      el = new Audio();
      el.preload = 'metadata';
      el.muted = true;
      var timer = setTimeout(function(){ fin(0); }, 8000);
      el.onloadedmetadata = function(){ clearTimeout(timer); fin(el.duration); };
      el.onerror = function(){ clearTimeout(timer); fin(0); };
      el.src = audioUrl;
    } catch (_) { fin(0); }
  });
}

// ===================== 音高 / 和声画像（musicalProfile） =====================
// 干吗用的：cuefield v2 的 cuefield-next/musical-profile.js 要靠 pitchClassProfile + key + intervalProfile
// 才能算出 harmonicSimilarity / keyCompatibility。没有这个字段，recipe-planner 的 musicalEvidence 恒为
// false —— 4 个 recipe（musical-commonality / melody / harmonic-match / 反 harmonic-clash）永远不 eligible，
// transition-window-planner 的窗口排序也拿不到 ±0.06 的音乐性加分。也就是说那 8KB 一直空转。
//
// 上游靠 basic-pitch 的音符事件（pitchMidi / start / duration）。我们没有那套模型，也没有它的 weight 文件，
// 所以这里换成 chroma：逐帧 FFT → 12 音级能量累积 → 调性模板匹配。字段里用 source 标明来源，
// 不和上游的 'basic-pitch' 混在一起；noteCount 在本实现里表示「检测到的音高变化次数」（不是音符事件数），
// 消费方只拿它当质量门槛（>=12）和密度参考，语义等价。
var MUSICAL_PROFILE_SAMPLE_RATE = 11025;
var MUSICAL_PROFILE_FFT_SIZE = 4096;
var MUSICAL_PROFILE_MIN_HZ = 65;
var MUSICAL_PROFILE_MAX_HZ = 1600;
var MUSICAL_PROFILE_WINDOW_SEC = 16;
var MUSICAL_PROFILE_MAX_WINDOWS = 32;
// 谱峰模式：只统计局部极大谱线（>= 帧内最强的 12%）。关掉它就退回「全 bin 求和」，
// 留着这个开关是因为它是关键参数，探针需要 A/B（见 .workbuddy/harness/verify-musical-profile-live.js）。
var musicalProfilePeakOnly = true;
var MUSICAL_PROFILE_PEAK_MIN_SHARE = 0.12;
var MUSICAL_KEY_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
var MUSICAL_KEY_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
var MUSICAL_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var musicalProfileFftTable = null;

function musicalProfileRound(value, digits) {
  var p = Math.pow(10, digits == null ? 4 : digits);
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * p) / p;
}

function musicalProfileNormalize(list) {
  var total = 0;
  var i;
  for (i = 0; i < list.length; i++) total += Math.max(0, list[i] || 0);
  var out = [];
  for (i = 0; i < list.length; i++) {
    out.push(total > 0 ? musicalProfileRound(Math.max(0, list[i] || 0) / total, 4) : 0);
  }
  return out;
}

function musicalProfileCosine(first, second) {
  var dot = 0;
  var a = 0;
  var b = 0;
  var n = Math.min(first.length, second.length);
  for (var i = 0; i < n; i++) {
    var x = first[i] || 0;
    var y = second[i] || 0;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
}

// 调性匹配必须用相关系数，不能用余弦：Krumhansl 模板是「全正数」的，余弦对任何非负 chroma
// 都给高分——实测白噪声能拿到 fit=0.96，等于没有判别力。减掉均值后噪声≈0、有调性 0.6~0.9。
function musicalProfileCorrelation(first, second) {
  var n = Math.min(first.length, second.length);
  if (!n) return 0;
  var i;
  var meanA = 0;
  var meanB = 0;
  for (i = 0; i < n; i++) {
    meanA += first[i] || 0;
    meanB += second[i] || 0;
  }
  meanA /= n;
  meanB /= n;
  var num = 0;
  var varA = 0;
  var varB = 0;
  for (i = 0; i < n; i++) {
    var x = (first[i] || 0) - meanA;
    var y = (second[i] || 0) - meanB;
    num += x * y;
    varA += x * x;
    varB += y * y;
  }
  return varA > 0 && varB > 0 ? num / Math.sqrt(varA * varB) : 0;
}

function musicalProfileFft(n) {
  if (musicalProfileFftTable && musicalProfileFftTable.n === n) return musicalProfileFftTable;
  var bits = Math.round(Math.log(n) / Math.LN2);
  var rev = new Uint16Array(n);
  for (var i = 0; i < n; i++) {
    var r = 0;
    for (var b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  var win = new Float32Array(n);
  for (var j = 0; j < n; j++) win[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (n - 1));
  // 旋转因子必须预计算：蝶形里现算 Math.cos/sin 是「2400 帧 × 5120 次三角函数」，
  // 实测能把整轨分析从 0.4s 拖到 4.2s。预表之后只剩乘加。
  var cosTable = new Array(bits + 1);
  var sinTable = new Array(bits + 1);
  for (var size = 2, level = 1; size <= n; size <<= 1, level++) {
    var half = size >> 1;
    var cosRow = new Float32Array(half);
    var sinRow = new Float32Array(half);
    for (var k = 0; k < half; k++) {
      var ang = -2 * Math.PI * k / size;
      cosRow[k] = Math.cos(ang);
      sinRow[k] = Math.sin(ang);
    }
    cosTable[level] = cosRow;
    sinTable[level] = sinRow;
  }
  musicalProfileFftTable = { n: n, rev: rev, win: win, cosTable: cosTable, sinTable: sinTable };
  return musicalProfileFftTable;
}

function musicalProfileFftInPlace(re, im, table) {
  var n = table.n;
  var i;
  for (i = 0; i < n; i++) {
    var j = table.rev[i];
    if (j > i) {
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (var size = 2, level = 1; size <= n; size <<= 1, level++) {
    var half = size >> 1;
    var cosRow = table.cosTable[level];
    var sinRow = table.sinTable[level];
    for (var start = 0; start < n; start += size) {
      for (var k = 0; k < half; k++) {
        var wr = cosRow[k];
        var wi = sinRow[k];
        var a = start + k;
        var b = a + half;
        var xr = re[b] * wr - im[b] * wi;
        var xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

function musicalProfileEstimateKey(pitchClassProfile) {
  var candidates = [];
  var modes = [['major', MUSICAL_KEY_MAJOR], ['minor', MUSICAL_KEY_MINOR]];
  for (var m = 0; m < modes.length; m++) {
    var mode = modes[m][0];
    var template = modes[m][1];
    for (var root = 0; root < 12; root++) {
      var rotated = [];
      for (var pc = 0; pc < 12; pc++) rotated.push(template[(pc - root + 12) % 12]);
      candidates.push({ root: root, mode: mode, score: musicalProfileCorrelation(pitchClassProfile, rotated) });
    }
  }
  candidates.sort(function (a, b) { return b.score - a.score; });
  var best = candidates[0] || { root: 0, mode: 'major', score: 0 };
  var second = candidates[1] || { score: 0 };
  return {
    root: best.root,
    mode: best.mode,
    name: MUSICAL_NOTE_NAMES[best.root] + ' ' + best.mode,
    confidence: musicalProfileRound(Math.max(0, Math.min(1, (best.score - second.score) * 4)), 3),
    margin: musicalProfileRound(best.score - second.score, 3),
    fit: musicalProfileRound(best.score, 3)
  };
}

function musicalProfileIntervals(contour) {
  var buckets = [];
  var i;
  for (i = 0; i < 25; i++) buckets.push(0);
  for (i = 1; i < contour.length; i++) {
    var delta = Math.max(-12, Math.min(12, contour[i] - contour[i - 1]));
    buckets[delta + 12] += 1;
  }
  return musicalProfileNormalize(buckets);
}

function musicalProfileDominant(chroma) {
  var bestPc = 0;
  var bestVal = -1;
  var total = 0;
  for (var i = 0; i < 12; i++) {
    var v = chroma[i] || 0;
    if (v > bestVal) { bestVal = v; bestPc = i; }
    total += v;
  }
  return { pc: bestPc, share: total > 0 ? bestVal / total : 0 };
}

// confidence 必须诚实：高了会把噪声当和声证据，低了会让 evidence 恒 false 又变成死代码。
// 两个独立来源：
//   1) key.fit —— chroma 与最佳调性模板的**相关系数**（不是余弦；余弦对全正模板没判别力）。
//      实测：白噪声 0.55、纯鼓 0.57、真实混音 0.80、干净三和弦 0.85+。所以下限 0.45、跨度 0.45。
//   2) tonalShare —— 12 音级里前 3 的占比。实测：白噪声 0.29、纯鼓 0.40、真实混音 0.42、干净和弦 0.47+。
//      下限 0.28、跨度 0.20。
// 两者都乘覆盖率（分析帧数 / 每秒 4 帧），半首歌或解码失败不会假装有证据。
// 纯鼓那条靠 cuefield 的 noteCount>=12 再兜一层（鼓点没有音高变化，noteCount 恒 0）。
var MUSICAL_PROFILE_FIT_FLOOR = 0.45;
var MUSICAL_PROFILE_FIT_SPAN = 0.45;
var MUSICAL_PROFILE_TONAL_FLOOR = 0.28;
var MUSICAL_PROFILE_TONAL_SPAN = 0.2;
function musicalProfileConfidence(key, pitchClassProfile, frames, duration) {
  var sorted = pitchClassProfile.slice().sort(function (a, b) { return b - a; });
  var tonalShare = (sorted[0] || 0) + (sorted[1] || 0) + (sorted[2] || 0);
  var coverage = Math.min(1, frames / Math.max(24, (duration || 0) * 4));
  var fitPart = Math.max(0, Math.min(1, (toNumberSafe(key.fit) - MUSICAL_PROFILE_FIT_FLOOR) / MUSICAL_PROFILE_FIT_SPAN));
  var tonalPart = Math.max(0, Math.min(1, (tonalShare - MUSICAL_PROFILE_TONAL_FLOOR) / MUSICAL_PROFILE_TONAL_SPAN));
  return {
    confidence: musicalProfileRound(Math.max(0, Math.min(1, (fitPart * 0.55 + tonalPart * 0.45) * coverage)), 3),
    tonalShare: musicalProfileRound(tonalShare, 3),
    coverage: musicalProfileRound(coverage, 3)
  };
}

function toNumberSafe(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

async function analyzeMusicalProfile(buffer, token) {
  if (!buffer || !buffer.length || !buffer.sampleRate) return null;
  var pcm = musicalProfileDownmix(buffer);
  if (!pcm) return null;
  return analyzeMusicalProfileFromPcm(pcm.pcm, pcm.rate, buffer.duration, token, {
    srcRate: pcm.srcRate, decim: pcm.decim
  });
}

// 把整轨 AudioBuffer 混成 mono 并盒式平均降采样到 ~11kHz。
// chroma 只关心 1.6kHz 以下，直接抽取会混叠，先做块平均。
// 不额外建整轨 mono 数组（4 分钟 44.1k 就是 42MB），边降采样边混音。
function musicalProfileDownmix(buffer) {
  var srcRate = buffer.sampleRate;
  var channels = buffer.numberOfChannels || 1;
  var length = buffer.length;
  var channelData = [];
  for (var c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));
  var decim = Math.max(1, Math.round(srcRate / MUSICAL_PROFILE_SAMPLE_RATE));
  var rate = srcRate / decim;
  var outLen = Math.floor(length / decim);
  if (outLen < MUSICAL_PROFILE_FFT_SIZE * 2) return null;
  var pcm = new Float32Array(outLen);
  var scale = 1 / (decim * channels);
  for (var i = 0; i < outLen; i++) {
    var base = i * decim;
    var acc = 0;
    for (var k = 0; k < decim; k++) {
      var pos = base + k;
      for (var ch = 0; ch < channels; ch++) acc += channelData[ch][pos];
    }
    pcm[i] = acc * scale;
  }
  return { pcm: pcm, rate: rate, srcRate: srcRate, decim: decim };
}

// 从降采样 mono PCM 出发算 chroma / key / 局部窗口。
// 整轨路径喂 musicalProfileDownmix 的结果；分段路径喂逐段拼起来的同一规格 PCM。
async function analyzeMusicalProfileFromPcm(pcm, rate, durationSec, token, meta) {
  meta = meta || {};
  var srcRate = meta.srcRate || rate;
  var decim = meta.decim || 1;
  // 显式声明循环变量：原先这些 for 依赖上面降采样循环里 var i 的提升，
  // 把降采样拆去 musicalProfileDownmix 之后 i/bin 就没了，严格模式下直接 ReferenceError。
  var i, bin;
  if (!pcm || pcm.length < MUSICAL_PROFILE_FFT_SIZE * 2) return null;

  var table = musicalProfileFft(MUSICAL_PROFILE_FFT_SIZE);
  var n = table.n;
  var hop = Math.max(256, Math.round(rate * 0.1));
  var frameCount = pcm.length > n ? Math.floor((pcm.length - n) / hop) + 1 : 0;
  if (frameCount < 8) return null;

  var binHz = rate / n;
  var minBin = Math.max(1, Math.floor(MUSICAL_PROFILE_MIN_HZ / binHz));
  var maxBin = Math.min((n >> 1) - 1, Math.ceil(MUSICAL_PROFILE_MAX_HZ / binHz));
  var binClass = new Int8Array(maxBin + 1);
  var binClassCount = new Int16Array(12);
  for (var bin = minBin; bin <= maxBin; bin++) {
    var hz = bin * binHz;
    var midi = 69 + 12 * (Math.log(hz / 440) / Math.LN2);
    var pcIndex = ((Math.round(midi) % 12) + 12) % 12;
    binClass[bin] = pcIndex;
    binClassCount[pcIndex] += 1;
  }
  // 每个音级覆盖的 bin 数差得很远（65~130Hz 一个半音才几个 bin，1kHz 以上几十个）。
  // 不除权的话白噪声都会被算成「有调性」，chroma 全是低频段的形状。按 sqrt(覆盖数) 归一到每音级等权。
  var binWeight = new Float32Array(maxBin + 1);
  for (bin = minBin; bin <= maxBin; bin++) {
    binWeight[bin] = 1 / Math.sqrt(Math.max(1, binClassCount[binClass[bin]]));
  }

  var totalChroma = [];
  for (i = 0; i < 12; i++) totalChroma.push(0);
  var frameChromas = new Array(frameCount);
  var contour = [];
  var lastPc = -1;
  var re = new Float32Array(n);
  var im = new Float32Array(n);
  var magBuf = new Float32Array(maxBin - minBin + 2);

  for (var f = 0; f < frameCount; f++) {
    var off = f * hop;
    for (i = 0; i < n; i++) {
      re[i] = pcm[off + i] * table.win[i];
      im[i] = 0;
    }
    musicalProfileFftInPlace(re, im, table);
    var chroma = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var energy = 0;
    var frameMax = 0;
    for (bin = minBin; bin <= maxBin; bin++) {
      var rawMag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
      magBuf[bin - minBin] = rawMag;
      energy += rawMag;
      if (rawMag > frameMax) frameMax = rawMag;
    }
    // 只取谱峰（局部极大且不低于帧内最大的 12%），不要把谱线之间的噪声地板也算进 chroma。
    // 直接求和会把宽带噪声（鼓、齿音、气声）灌满 12 个音级，实测真实电子曲 keyFit 只有 0.55，
    // 和纯白噪声（0.54）分不开。取峰之后噪声帧几乎不贡献，和声帧只留基频与强谐波。
    var peakGate = frameMax * MUSICAL_PROFILE_PEAK_MIN_SHARE;
    for (bin = minBin; bin <= maxBin; bin++) {
      var mag = magBuf[bin - minBin];
      if (musicalProfilePeakOnly) {
        var prevMag = magBuf[bin - minBin - 1] || 0;
        var nextMag = magBuf[bin - minBin + 1] || 0;
        if (!(mag >= prevMag && mag > nextMag)) continue;
        if (mag < peakGate) continue;
      }
      chroma[binClass[bin]] += mag * binWeight[bin];
    }
    frameChromas[f] = chroma;
    for (i = 0; i < 12; i++) totalChroma[i] += chroma[i];
    // 旋律轮廓（音级级近似）：本帧音级足够集中才算一次「音高变化」，否则当噪声跳过
    if (energy > 1e-4) {
      var dominant = musicalProfileDominant(chroma);
      if (dominant.share >= 0.24 && dominant.pc !== lastPc) {
        contour.push(dominant.pc + 60);
        lastPc = dominant.pc;
      }
    }
    if ((f & 255) === 255) {
      // 用 yieldToPaint 而不是 yieldToIdle：主界面一直在 rAF 渲染，
      // requestIdleCallback 会被拖到 1200ms 超时才回调，实测 1255 帧的分析被 idle 等待拖成 3.7s。
      await yieldToPaint();
      if (token !== beatMapToken) return null;
    }
  }

  var pitchClassProfile = musicalProfileNormalize(totalChroma);
  var key = musicalProfileEstimateKey(pitchClassProfile);
  var intervalProfile = musicalProfileIntervals(contour);
  var quality = musicalProfileConfidence(key, pitchClassProfile, frameCount, durationSec);

  // 局部窗口：cuefield 的 compareLocalMusicalWindows 需要 windows[{start,duration,confidence,noteCount,...}]，
  // 用来判断「切出点附近」的和声是否兼容，而不是整首歌平均。
  // 短音频（试听片段）要缩短窗口，否则 framesPerWindow 比总帧数还大，windows 恒空。
  var frameStepSec = hop / rate;
  var windowSeconds = durationSec >= 48 ? MUSICAL_PROFILE_WINDOW_SEC : Math.max(3, durationSec / 4);
  var framesPerWindow = Math.max(8, Math.round(windowSeconds / frameStepSec));
  var windows = [];
  for (var w = 0; w < frameChromas.length && windows.length < MUSICAL_PROFILE_MAX_WINDOWS; w += framesPerWindow) {
    var slice = frameChromas.slice(w, w + framesPerWindow);
    if (slice.length < Math.max(4, Math.floor(framesPerWindow * 0.5))) continue;
    var sum = [];
    for (i = 0; i < 12; i++) sum.push(0);
    var windowContour = [];
    var windowLastPc = -1;
    for (var s = 0; s < slice.length; s++) {
      var frameChroma = slice[s];
      var frameEnergy = 0;
      for (i = 0; i < 12; i++) {
        sum[i] += frameChroma[i];
        frameEnergy += frameChroma[i];
      }
      if (frameEnergy > 1e-4) {
        var frameDominant = musicalProfileDominant(frameChroma);
        if (frameDominant.share >= 0.24 && frameDominant.pc !== windowLastPc) {
          windowContour.push(frameDominant.pc + 60);
          windowLastPc = frameDominant.pc;
        }
      }
    }
    var windowProfile = musicalProfileNormalize(sum);
    var windowKey = musicalProfileEstimateKey(windowProfile);
    var windowQuality = musicalProfileConfidence(windowKey, windowProfile, slice.length, windowSeconds);
    windows.push({
      start: musicalProfileRound((w * hop) / rate, 3),
      duration: musicalProfileRound((slice.length * hop) / rate, 3),
      confidence: windowQuality.confidence,
      noteCount: windowContour.length,
      pitchClassProfile: windowProfile,
      intervalProfile: musicalProfileIntervals(windowContour),
      key: { root: windowKey.root, mode: windowKey.mode, name: windowKey.name, confidence: windowKey.confidence }
    });
  }

  return {
    source: 'chroma-fft-v1',
    noteCount: contour.length,
    noteDensity: musicalProfileRound(durationSec > 0 ? contour.length / durationSec : 0, 3),
    pitchClassProfile: pitchClassProfile,
    intervalProfile: intervalProfile,
    key: { root: key.root, mode: key.mode, name: key.name, confidence: key.confidence },
    confidence: quality.confidence,
    windows: windows,
    debug: {
      frameCount: frameCount,
      srcRate: srcRate,
      rate: musicalProfileRound(rate, 1),
      decim: decim,
      keyMargin: key.margin,
      keyFit: key.fit,
      tonalShare: quality.tonalShare,
      coverage: quality.coverage,
      contourCount: contour.length
    }
  };
}
