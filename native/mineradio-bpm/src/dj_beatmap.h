// src/dj_beatmap.h
// buildBeatMapFromLowEnergy 的 C++ 移植（与 dj-analyzer.js 算法对齐）
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>
#include <string>
#include <algorithm>
#include <chrono>
#include <limits>
#include <unordered_map>

namespace mradio {

inline float clamp01f(float v) {
  if (v < 0.f) return 0.f;
  if (v > 1.f) return 1.f;
  return v;
}
inline float clampRangef(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

inline float percentileF(const float* arr, int len, float p, int maxSamples = 16000) {
  if (!arr || len <= 0) return 0.001f;
  if (maxSamples <= 0) maxSamples = 16000;
  std::vector<float> sample;
  if (len <= maxSamples) {
    sample.assign(arr, arr + len);
  } else {
    sample.resize(maxSamples);
    float step = float(len - 1) / float(maxSamples - 1);
    for (int i = 0; i < maxSamples; i++) {
      int idx = (int)std::floor(i * step);
      if (idx >= len) idx = len - 1;
      sample[i] = arr[idx];
    }
  }
  std::sort(sample.begin(), sample.end());
  int i = (int)std::floor(sample.size() * p);
  if (i < 0) i = 0;
  if (i >= (int)sample.size()) i = (int)sample.size() - 1;
  float v = sample[i];
  return v == 0.f ? 0.001f : v;
}

inline float percentileVec(const std::vector<float>& arr, float p, int maxSamples = 16000) {
  if (arr.empty()) return 0.001f;
  return percentileF(arr.data(), (int)arr.size(), p, maxSamples);
}

inline float medianF(std::vector<float> vals) {
  vals.erase(std::remove_if(vals.begin(), vals.end(), [](float v) { return !std::isfinite(v); }), vals.end());
  if (vals.empty()) return 0.f;
  std::sort(vals.begin(), vals.end());
  return vals[vals.size() / 2];
}

struct DjCand {
  int frame = 0;
  float time = 0;
  float score = 0;
  float lowTone = 0;
  float hitTone = 0;
  float lowRel = 0;
  float raw = 0;
  float power = 0;
};

struct DjBeat {
  float time = 0;
  float strength = 0;
  float confidence = 0;
  float impact = 0;
  bool primary = false;
  bool camera = false;
  bool pulse = false;
  const char* tone = "podcast-dj-server-low-grid";
  float low = 0;
  float body = 0;
  float snap = 0;
  float mass = 0;
  float sharpness = 0;
  const char* combo = "downbeat";
  float step = 0.5f;
  int index = 0;
  bool dj = true;
  bool grid = true;
  bool kickOnly = true;
  bool server = true;
};

struct DjPulseBeat {
  float time = 0;
  float strength = 0;
  float impact = 0;
  const char* combo = "downbeat";
  float low = 0;
  float body = 0;
  float snap = 0;
};

struct DjBeatMapResult {
  std::vector<float> kicks;
  std::vector<DjBeat> beats;
  std::vector<DjPulseBeat> pulseBeats;
  std::vector<DjBeat> cameraBeats;
  float gridStep = 0.5f;
  std::vector<float> sectionSteps;
  std::string tempoSource = "podcast-dj-server-empty";
  float duration = 0;
  int visualBeatCount = 0;
  int candidates = 0;
  float hopSec = 0.01f;
  float lowRef = 0;
  double elapsedMs = 0;
  bool empty = true;
};

inline float bandAt(const float* arr, int nFrames, int idx) {
  if (idx < 0) idx = 0;
  if (idx >= nFrames) idx = nFrames - 1;
  float a = arr[std::max(0, idx - 1)];
  float b = arr[idx];
  float c = arr[std::min(nFrames - 1, idx + 1)];
  return (a + b * 2.f + c) * 0.25f;
}

inline DjBeatMapResult buildBeatMapFromLowEnergy(
  const float* lowEnergy, int lowN,
  const float* hitEnergy, int hitN,
  double hopSecIn, double durationSecIn
) {
  auto t0 = std::chrono::high_resolution_clock::now();
  DjBeatMapResult out;
  float hopSec = (float)((hopSecIn > 0.0) ? hopSecIn : 0.01);
  out.hopSec = hopSec;
  int nFrames = std::min(lowN, hitN);
  if (!lowEnergy || !hitEnergy || nFrames < 20) {
    out.duration = (float)(durationSecIn > 0 ? durationSecIn : 0);
    out.tempoSource = "podcast-dj-server-empty";
    auto t1 = std::chrono::high_resolution_clock::now();
    out.elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return out;
  }

  float lowFloor = std::max(0.0004f, percentileF(lowEnergy, nFrames, 0.22f));
  float lowMid = std::max(lowFloor + 0.0002f, percentileF(lowEnergy, nFrames, 0.58f));
  float lowRef = std::max(lowMid + 0.0002f, percentileF(lowEnergy, nFrames, 0.86f));
  float lowCeil = std::max(lowRef + 0.0004f, percentileF(lowEnergy, nFrames, 0.96f));
  float hitRef = std::max(0.0004f, percentileF(hitEnergy, nFrames, 0.86f));
  out.lowRef = lowRef;

  std::vector<float> onset(nFrames, 0.f);
  for (int i = 4; i < nFrames; i++) {
    float prev = lowEnergy[i - 1] * 0.62f + lowEnergy[i - 2] * 0.28f + lowEnergy[i - 3] * 0.10f;
    float lowRise = std::max(0.f, lowEnergy[i] - prev);
    float wideRise = std::max(0.f, (lowEnergy[i] + lowEnergy[i - 1]) * 0.5f - (lowEnergy[i - 3] + lowEnergy[i - 4]) * 0.5f);
    float peakRise = std::max(0.f, hitEnergy[i] - hitEnergy[i - 2] * 0.84f);
    onset[i] = lowRise * 1.72f + wideRise * 0.86f + peakRise * 0.10f;
  }

  int winN = std::max(52, (int)std::lround(0.82 / hopSec));
  int minFrameGap = std::max(18, (int)std::lround(0.215 / hopSec));
  std::vector<DjCand> candidates;
  double sumO = 0, sqO = 0;
  for (int i = 0; i < winN && i < nFrames; i++) {
    float o = onset[i];
    sumO += o;
    sqO += double(o) * double(o);
  }
  for (int f = winN + 4; f < nFrames - 4; f++) {
    float mean = float(sumO / winN);
    float stdv = std::sqrt(std::max(0.0, sqO / winN - double(mean) * double(mean)));
    float th = mean + stdv * 1.66f + lowRef * 0.0038f;
    float o = onset[f];
    if (o > th && o >= onset[f - 1] && o > onset[f + 1]) {
      int peakF = f;
      float peakScore = o + lowEnergy[f] * 0.10f;
      for (int pf = f - 2; pf <= f + 3; pf++) {
        float ps = onset[pf] + lowEnergy[pf] * 0.10f;
        if (ps > peakScore) { peakScore = ps; peakF = pf; }
      }
      float lowTone = std::min(2.6f, bandAt(lowEnergy, nFrames, peakF) / lowRef);
      float hitTone = std::min(2.6f, bandAt(hitEnergy, nFrames, peakF) / hitRef);
      float lowRel = clamp01f((bandAt(lowEnergy, nFrames, peakF) - lowFloor) / std::max(0.0001f, lowCeil - lowFloor));
      float score = (o - th) / std::max(0.0006f, stdv + mean * 0.38f + lowRef * 0.012f);
      if (score > 0.16f && (lowTone > 0.32f || lowRel > 0.22f || hitTone > 0.52f)) {
        DjCand cand;
        cand.frame = peakF;
        cand.time = peakF * hopSec;
        cand.score = score;
        cand.lowTone = lowTone;
        cand.hitTone = hitTone;
        cand.lowRel = lowRel;
        cand.raw = o;
        cand.power = cand.score * 0.56f
          + std::pow(clamp01f((cand.lowTone - 0.22f) / 1.42f), 0.82f) * 0.34f
          + std::min(1.5f, cand.hitTone) * 0.08f
          + cand.lowRel * 0.10f;
        if (!candidates.empty() && cand.frame - candidates.back().frame < minFrameGap) {
          if (cand.power > candidates.back().power) candidates.back() = cand;
        } else {
          candidates.push_back(cand);
        }
      }
    }
    float old = onset[f - winN];
    float next = onset[f];
    sumO += next - old;
    sqO += double(next) * next - double(old) * old;
  }

  float durationHint = (float)(durationSecIn > 0 ? durationSecIn : nFrames * hopSec);
  if (candidates.empty()) {
    out.duration = durationHint;
    out.tempoSource = "podcast-dj-server-empty";
    auto t1 = std::chrono::high_resolution_clock::now();
    out.elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return out;
  }
  out.candidates = (int)candidates.size();

  std::vector<float> powers;
  powers.reserve(candidates.size());
  for (auto& c : candidates) powers.push_back(c.power);
  float p30 = percentileVec(powers, 0.30f);
  float p50 = percentileVec(powers, 0.50f);
  float p90 = std::max(p50 + 0.001f, percentileVec(powers, 0.90f));
  float p96 = std::max(p90 + 0.001f, percentileVec(powers, 0.965f));
  (void)p90;

  std::vector<DjCand> strong;
  for (auto& c : candidates) {
    if (c.power >= p50 && c.lowTone > 0.34f) strong.push_back(c);
  }
  if ((int)strong.size() < 16) strong = candidates;

  auto estimateStep = [](const std::vector<DjCand>& list) -> float {
    if (list.size() < 3) return 0.f;
    const float bin = 0.006f;
    std::unordered_map<int, float> hist;
    std::vector<float> medGaps;
    for (size_t ai = 0; ai < list.size(); ai++) {
      for (size_t bi = ai + 1; bi < list.size() && bi < ai + 10; bi++) {
        float rawGap = list[bi].time - list[ai].time;
        if (rawGap < 0.24f) continue;
        if (rawGap > 2.55f) break;
        for (int div = 1; div <= 6; div++) {
          float g = rawGap / float(div);
          if (g < 0.31f) break;
          if (g > 0.86f) continue;
          float weight = std::sqrt(std::max(0.001f, list[ai].power * list[bi].power))
            / std::sqrt(float((bi - ai) * div));
          int key = (int)std::lround(g / bin);
          hist[key] += weight;
          medGaps.push_back(g);
        }
      }
    }
    int bestKey = -1;
    float bestScore = 0.f;
    for (auto& kv : hist) {
      int key = kv.first;
      float score = kv.second;
      auto it1 = hist.find(key - 1);
      auto it2 = hist.find(key + 1);
      if (it1 != hist.end()) score += it1->second * 0.72f;
      if (it2 != hist.end()) score += it2->second * 0.72f;
      if (score > bestScore) { bestScore = score; bestKey = key; }
    }
    if (bestKey >= 0) return bestKey * bin;
    return medianF(medGaps);
  };

  float globalStep = estimateStep(strong);
  if (globalStep <= 0.f) globalStep = estimateStep(candidates);
  if (globalStep <= 0.f) globalStep = 0.50f;
  globalStep = clampRangef(globalStep, 0.32f, 0.86f);

  auto nearestCandidate = [&](float center, float windowSec, int startIdx) -> const DjCand* {
    const DjCand* best = nullptr;
    float bestScore = -std::numeric_limits<float>::infinity();
    int j = std::max(0, startIdx);
    while (j < (int)candidates.size() && candidates[j].time < center - windowSec) j++;
    for (int ni = j; ni < (int)candidates.size() && candidates[ni].time <= center + windowSec; ni++) {
      float dist = std::fabs(candidates[ni].time - center);
      float score = candidates[ni].power * (1.f - dist / std::max(0.001f, windowSec) * 0.42f);
      if (score > bestScore) { best = &candidates[ni]; bestScore = score; }
    }
    return best;
  };

  auto scorePhase = [&](float anchorTime, float step) -> float {
    float start = anchorTime;
    while (start - step > 0.05f) start -= step;
    float end = std::min(durationHint, 180.f);
    float win = std::max(0.055f, std::min(0.125f, step * 0.18f));
    float score = 0.f;
    int count = 0;
    size_t cursor = 0;
    for (float gt = start; gt < end; gt += step) {
      while (cursor < candidates.size() && candidates[cursor].time < gt - win) cursor++;
      float bestScore = 0.f;
      for (size_t pi = cursor; pi < candidates.size() && candidates[pi].time <= gt + win; pi++) {
        float dist = std::fabs(candidates[pi].time - gt);
        float s = candidates[pi].power * (1.f - dist / win * 0.44f);
        if (s > bestScore) bestScore = s;
      }
      score += bestScore > 0.f ? bestScore : -p30 * 0.08f;
      count++;
    }
    return count ? score / float(count) : -std::numeric_limits<float>::infinity();
  };

  std::vector<DjCand> phaseSource;
  float phaseCap = std::min(durationHint, 180.f);
  for (auto& c : strong) {
    if (c.time < phaseCap) {
      phaseSource.push_back(c);
      if ((int)phaseSource.size() >= 72) break;
    }
  }
  if (phaseSource.empty() && !strong.empty()) phaseSource.push_back(strong[0]);

  float bestAnchor = phaseSource.empty() ? 0.f : phaseSource[0].time;
  float bestAnchorScore = -std::numeric_limits<float>::infinity();
  for (auto& c : phaseSource) {
    float score = scorePhase(c.time, globalStep);
    if (score > bestAnchorScore) { bestAnchorScore = score; bestAnchor = c.time; }
  }
  float halfStep = globalStep * 0.5f;
  if (halfStep >= 0.31f) {
    float halfScore = scorePhase(bestAnchor, halfStep);
    if (halfScore > bestAnchorScore * 1.04f) globalStep = halfStep;
  }
  float anchor = bestAnchor;
  while (anchor - globalStep > 0.05f) anchor -= globalStep;

  float duration = durationHint;
  float sectionLen = duration > 3600.f ? 96.f : 72.f;
  int sectionCount = std::max(1, (int)std::ceil(duration / sectionLen));
  std::vector<float> sectionSteps;
  sectionSteps.reserve(sectionCount);
  for (int si = 0; si < sectionCount; si++) {
    float t0s = si * sectionLen;
    float t1s = std::min(duration, t0s + sectionLen);
    std::vector<DjCand> seg;
    for (auto& c : strong) {
      if (c.time >= t0s && c.time < t1s) seg.push_back(c);
    }
    float prevStep = sectionSteps.empty() ? globalStep : sectionSteps.back();
    float localStep = estimateStep(seg);
    if (localStep <= 0.f) localStep = prevStep > 0.f ? prevStep : globalStep;
    if (prevStep > 0.f) localStep = clampRangef(localStep, prevStep * 0.94f, prevStep * 1.06f);
    if (globalStep > 0.f) localStep = clampRangef(localStep, globalStep * 0.86f, globalStep * 1.14f);
    sectionSteps.push_back(prevStep > 0.f ? (localStep * 0.30f + prevStep * 0.70f) : localStep);
  }
  auto stepAt = [&](float time) -> float {
    int idx = (int)std::floor(time / sectionLen);
    if (idx < 0) idx = 0;
    if (idx >= (int)sectionSteps.size()) idx = (int)sectionSteps.size() - 1;
    return sectionSteps.empty() ? (globalStep > 0.f ? globalStep : 0.50f) : sectionSteps[idx];
  };

  std::vector<DjBeat> beats;
  int gridIndex = 0;
  int cursorIdx = 0;
  for (float gridT = anchor; gridT < duration - 0.04f;) {
    float localStep = stepAt(gridT);
    if (localStep <= 0.f) localStep = globalStep > 0.f ? globalStep : 0.50f;
    float winSec = std::max(0.060f, std::min(0.135f, localStep * 0.20f));
    while (cursorIdx < (int)candidates.size() && candidates[cursorIdx].time < gridT - winSec) cursorIdx++;
    const DjCand* bestCand = nearestCandidate(gridT, winSec, cursorIdx);
    int gf = (int)std::lround(gridT / hopSec);
    if (gf < 0) gf = 0;
    if (gf >= nFrames) gf = nFrames - 1;
    float gridLow = bandAt(lowEnergy, nFrames, gf);
    float gridHit = bandAt(hitEnergy, nFrames, gf);
    float gridLowTone = std::min(2.6f, gridLow / lowRef);
    float gridHitTone = std::min(2.6f, gridHit / hitRef);
    float lowTone = bestCand ? std::max(gridLowTone * 0.62f, bestCand->lowTone) : gridLowTone;
    float hitTone = bestCand ? std::max(gridHitTone * 0.62f, bestCand->hitTone) : gridHitTone;
    float distPenalty = bestCand
      ? (1.f - std::min(1.f, std::fabs(bestCand->time - gridT) / winSec) * 0.26f)
      : 0.54f;
    float basePower = bestCand
      ? bestCand->power * distPenalty
      : (gridLowTone * 0.25f + gridHitTone * 0.06f);
    float powerRel = clamp01f((basePower - p30 * 0.78f) / std::max(0.001f, p96 - p30 * 0.78f));
    float lowRel = clamp01f((gridLow - lowFloor) / std::max(0.0001f, lowCeil - lowFloor));
    float kickRel = clamp01f(powerRel * 0.74f + lowRel * 0.22f + clamp01f((hitTone - 0.26f) / 1.70f) * 0.04f);
    bool softGrid = (!bestCand && lowRel < 0.20f) || kickRel < 0.16f;
    int slot = gridIndex % 4;
    const char* combo = slot == 0 ? "downbeat" : (slot == 1 ? "push" : (slot == 2 ? "drop" : "rebound"));
    if (kickRel > 0.84f && std::strcmp(combo, "downbeat") != 0) combo = "accent";
    float visualRel = kickRel > 0.76f ? 0.76f + (kickRel - 0.76f) * 0.52f : kickRel;
    float downLift = (std::strcmp(combo, "downbeat") == 0)
      ? (visualRel > 0.18f ? (0.016f + visualRel * 0.036f) : visualRel * 0.028f)
      : 0.f;
    float sectionGate = clamp01f((kickRel - 0.10f) / 0.58f);
    float impact = std::max(0.020f, std::min(0.88f, 0.022f + std::pow(visualRel, 1.62f) * 0.86f + downLift));
    float strength = std::max(0.12f, std::min(0.93f, 0.13f + std::pow(visualRel, 1.12f) * 0.68f + downLift * 0.70f));
    if (softGrid) {
      float softMul = std::strcmp(combo, "downbeat") == 0 ? 0.48f : 0.30f;
      impact *= softMul;
      strength *= 0.58f + sectionGate * 0.22f;
    }
    float timingPull = bestCand ? (0.24f + clamp01f((kickRel - 0.25f) / 0.65f) * 0.46f) : 0.f;
    float sourceTime = bestCand ? (gridT * (1.f - timingPull) + bestCand->time * timingPull) : gridT;
    bool cameraActive = impact >= 0.13f
      || (std::strcmp(combo, "downbeat") == 0 && kickRel >= 0.14f)
      || (bestCand && kickRel >= 0.18f);
    float lowMix = std::max(0.42f, std::min(0.90f, 0.52f + visualRel * 0.32f + lowTone * 0.035f - (std::strcmp(combo, "accent") == 0 ? 0.10f : 0.f)));
    float bodyMix = std::max(0.035f, std::min(0.54f, 0.060f + visualRel * 0.12f
      + (std::strcmp(combo, "push") == 0 ? 0.18f : 0.f)
      + (std::strcmp(combo, "drop") == 0 ? 0.24f : 0.f)));
    float snapMix = std::max(0.015f, std::min(0.62f, 0.026f
      + (std::strcmp(combo, "accent") == 0 ? 0.40f : 0.f)
      + (std::strcmp(combo, "rebound") == 0 ? 0.08f : 0.f)
      + visualRel * 0.038f));

    DjBeat b;
    b.time = sourceTime;
    b.strength = strength;
    b.confidence = std::max(0.44f, std::min(0.99f, 0.46f + kickRel * 0.43f + (bestCand ? 0.08f : -0.03f)));
    b.impact = impact;
    b.primary = cameraActive;
    b.camera = cameraActive;
    b.pulse = impact > 0.16f || (std::strcmp(combo, "downbeat") == 0 && kickRel >= 0.18f);
    b.tone = "podcast-dj-server-low-grid";
    b.low = lowMix;
    b.body = bodyMix;
    b.snap = snapMix;
    b.mass = std::max(0.36f, std::min(0.94f, lowMix * 0.72f + std::pow(visualRel, 1.22f) * 0.24f));
    b.sharpness = std::max(0.03f, std::min(0.28f, snapMix * 1.18f));
    b.combo = combo;
    b.step = localStep;
    b.index = (int)beats.size();
    beats.push_back(b);
    gridIndex++;
    gridT += localStep;
  }

  out.beats = beats;
  out.kicks.reserve(beats.size());
  for (auto& b : beats) out.kicks.push_back(b.time);
  for (auto& b : beats) {
    if (b.camera) out.cameraBeats.push_back(b);
    if (b.pulse && (b.impact >= 0.16f || std::strcmp(b.combo, "downbeat") == 0)) {
      DjPulseBeat p;
      p.time = b.time;
      p.strength = b.strength;
      p.impact = b.impact;
      p.combo = b.combo;
      p.low = b.low;
      p.body = b.body;
      p.snap = b.snap;
      out.pulseBeats.push_back(p);
    }
  }
  out.gridStep = globalStep;
  out.sectionSteps = sectionSteps;
  out.tempoSource = "podcast-dj-server-low-offline";
  out.duration = duration;
  out.visualBeatCount = (int)out.cameraBeats.size();
  out.empty = false;
  auto t1 = std::chrono::high_resolution_clock::now();
  out.elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
  return out;
}

} // namespace mradio
