// src/dj_energy.h
// DJ 离线能量提取：HP→LP biquad + hop 分帧 RMS / peak（与 dj-analyzer.js 对齐）
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <chrono>

namespace mradio {

struct Biquad {
  float b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  float x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  static Biquad make(const char* type, float freq, float q, float sr) {
    Biquad st;
    if (sr < 1.f) sr = 1.f;
    if (freq < 8.f) freq = 8.f;
    float maxF = sr * 0.45f;
    if (freq > maxF) freq = maxF;
    if (q <= 0.f) q = 0.707f;
    const float w0 = 2.f * 3.14159265358979323846f * freq / sr;
    const float cosw = std::cos(w0);
    const float sinw = std::sin(w0);
    const float alpha = sinw / (2.f * q);
    float b0, b1, b2;
    if (type && type[0] == 'h') { // highpass
      b0 = (1.f + cosw) * 0.5f;
      b1 = -(1.f + cosw);
      b2 = (1.f + cosw) * 0.5f;
    } else { // lowpass
      b0 = (1.f - cosw) * 0.5f;
      b1 = 1.f - cosw;
      b2 = (1.f - cosw) * 0.5f;
    }
    const float a0 = 1.f + alpha;
    const float a1 = -2.f * cosw;
    const float a2 = 1.f - alpha;
    const float inv = 1.f / a0;
    st.b0 = b0 * inv; st.b1 = b1 * inv; st.b2 = b2 * inv;
    st.a1 = a1 * inv; st.a2 = a2 * inv;
    return st;
  }

  inline float process(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  }
};

struct DjEnergyResult {
  std::vector<float> lowEnergy;
  std::vector<float> hitEnergy;
  double hopSec = 0.01;
  double effectiveSr = 0;
  int sampleStep = 1;
  int hopSize = 0;
  int64_t effectiveSamples = 0;
  int64_t inputSamples = 0;
  double elapsedMs = 0;
};

class DjEnergyTracker {
public:
  bool init(int sampleRate, double hopSec) {
    if (ready_) return true;
    if (sampleRate < 8000 || sampleRate > 384000) return false;
    if (!(hopSec > 0.0) || hopSec > 1.0) hopSec = 0.01;
    sampleRate_ = sampleRate;
    hopSec_ = hopSec;
    sampleStep_ = sampleRate >= 44100 ? 4 : (sampleRate >= 32000 ? 3 : 2);
    effectiveSr_ = double(sampleRate) / double(sampleStep_);
    hopSize_ = std::max(80, (int)std::floor(effectiveSr_ * hopSec_));
    hp_ = Biquad::make("highpass", 32.f, 0.72f, float(effectiveSr_));
    lp_ = Biquad::make("lowpass", 178.f, 0.82f, float(effectiveSr_));
    ready_ = true;
    return true;
  }

  void pushMono(const float* pcm, int n) {
    if (!ready_ || !pcm || n <= 0) return;
    inputSamples_ += n;
    for (int i = 0; i < n; i += sampleStep_) {
      float y = lp_.process(hp_.process(pcm[i]));
      float ay = std::fabs(y);
      frameSum_ += double(y) * double(y);
      if (ay > framePeak_) framePeak_ = ay;
      frameCount_++;
      effectiveSamples_++;
      if (frameCount_ >= hopSize_) pushFrame();
    }
  }

  void pushStereo(const float* left, const float* right, int n) {
    if (!ready_ || !left || n <= 0) return;
    inputSamples_ += n;
    if (!right) {
      pushMono(left, n);
      return;
    }
    for (int i = 0; i < n; i += sampleStep_) {
      float x = (left[i] + right[i]) * 0.5f;
      float y = lp_.process(hp_.process(x));
      float ay = std::fabs(y);
      frameSum_ += double(y) * double(y);
      if (ay > framePeak_) framePeak_ = ay;
      frameCount_++;
      effectiveSamples_++;
      if (frameCount_ >= hopSize_) pushFrame();
    }
  }

  DjEnergyResult finish() {
    auto t0 = std::chrono::high_resolution_clock::now();
    if (frameCount_ > 0) pushFrame();
    DjEnergyResult r;
    r.lowEnergy.swap(lowEnergy_);
    r.hitEnergy.swap(hitEnergy_);
    r.hopSec = hopSec_;
    r.effectiveSr = effectiveSr_;
    r.sampleStep = sampleStep_;
    r.hopSize = hopSize_;
    r.effectiveSamples = effectiveSamples_;
    r.inputSamples = inputSamples_;
    auto t1 = std::chrono::high_resolution_clock::now();
    r.elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    // reset for reuse
    ready_ = false;
    frameSum_ = 0; framePeak_ = 0; frameCount_ = 0;
    effectiveSamples_ = 0; inputSamples_ = 0;
    return r;
  }

  // 一次性批处理：整段 mono PCM
  static DjEnergyResult analyzePcm(const float* pcm, int n, int sampleRate, double hopSec) {
    auto t0 = std::chrono::high_resolution_clock::now();
    DjEnergyTracker tr;
    tr.init(sampleRate, hopSec);
    tr.pushMono(pcm, n);
    DjEnergyResult r = tr.finish();
    auto t1 = std::chrono::high_resolution_clock::now();
    r.elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return r;
  }

  bool ready() const { return ready_; }
  int sampleRate() const { return sampleRate_; }
  double hopSec() const { return hopSec_; }
  double effectiveSr() const { return effectiveSr_; }

private:
  void pushFrame() {
    int count = std::max(1, frameCount_);
    lowEnergy_.push_back(float(std::sqrt(frameSum_ / double(count))));
    hitEnergy_.push_back(framePeak_);
    frameSum_ = 0;
    framePeak_ = 0;
    frameCount_ = 0;
  }

  bool ready_ = false;
  int sampleRate_ = 0;
  int sampleStep_ = 1;
  int hopSize_ = 0;
  double hopSec_ = 0.01;
  double effectiveSr_ = 0;
  Biquad hp_, lp_;
  double frameSum_ = 0;
  float framePeak_ = 0;
  int frameCount_ = 0;
  int64_t effectiveSamples_ = 0;
  int64_t inputSamples_ = 0;
  std::vector<float> lowEnergy_;
  std::vector<float> hitEnergy_;
};

} // namespace mradio
