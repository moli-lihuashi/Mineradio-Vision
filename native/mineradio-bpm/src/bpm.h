// src/bpm.h
// BPM 分析器：PCM → 下采样 → 分帧 FFT → 频谱通量 → 自相关 → BPM
// 算法与 JS 对照版完全一致，公平对比原生 vs JIT 性能
#pragma once
#include "fft.h"
#include <vector>
#include <cstdint>
#include <algorithm>
#include <chrono>
#include <numeric>

namespace mradio {

struct BpmResult {
    float bpm;
    float confidence;       // 峰值/均值比
    int   framesAnalyzed;
    double elapsedMs;       // C++ 侧耗时（不含跨 N-API 拷贝）
};

// 下采样到目标采样率（线性插值，简单够用）
inline std::vector<float> downsample(const float* src, int n, int srcRate, int dstRate) {
    if (srcRate == dstRate) return std::vector<float>(src, src + n);
    const double ratio = static_cast<double>(srcRate) / dstRate;
    const int outN = static_cast<int>(n / ratio);
    std::vector<float> out(outN);
    for (int i = 0; i < outN; ++i) {
        const double srcPos = i * ratio;
        const int i0 = static_cast<int>(srcPos);
        const int i1 = std::min(i0 + 1, n - 1);
        const double frac = srcPos - i0;
        out[i] = static_cast<float>(src[i0] * (1.0 - frac) + src[i1] * frac);
    }
    return out;
}

// 立体声 → 单声道（interleaved: L R L R ...）
inline std::vector<float> toMono(const float* src, int n, int channels) {
    if (channels <= 1) return std::vector<float>(src, src + n);
    const int frames = n / channels;
    std::vector<float> out(frames);
    for (int i = 0; i < frames; ++i) {
        float s = 0.0f;
        for (int c = 0; c < channels; ++c) s += src[i * channels + c];
        out[i] = s / channels;
    }
    return out;
}

// 核心 BPM 分析
// pcm: 单声道 Float32 PCM, sampleRate: 采样率
inline BpmResult analyzeBpm(const float* pcm, int n, int sampleRate) {
    auto t0 = std::chrono::high_resolution_clock::now();

    // 1. 下采样到 22050Hz（节拍信息不需要高频）
    const int targetRate = 22050;
    auto mono = downsample(pcm, n, sampleRate, targetRate);
    const int sr = targetRate;
    const int N = static_cast<int>(mono.size());

    // 2. 分帧参数
    const int winSize = 1024;
    const int hopSize = 512;
    const int nFrames = std::max(0, (N - winSize) / hopSize + 1);
    if (nFrames < 20) {
        return { 0.0f, 0.0f, nFrames, 0.0 };
    }

    // 3. 预计算 Hann 窗
    auto window = hannWindow(winSize);

    // 4. 逐帧 FFT + 频谱通量
    // 节拍主要在低频段：0-200Hz。22050Hz/1024 → 每个 bin ≈ 21.5Hz
    // 取前 10 个 bin（≈0-215Hz）作为节拍频段
    const int lowBins = 10;
    std::vector<float> prevMag(lowBins, 0.0f);
    std::vector<float> flux(nFrames, 0.0f);

    std::vector<std::complex<float>> buf(winSize);
    for (int f = 0; f < nFrames; ++f) {
        // 加窗
        const int offset = f * hopSize;
        for (int i = 0; i < winSize; ++i) {
            buf[i] = std::complex<float>(mono[offset + i] * window[i], 0.0f);
        }
        fft(buf);

        // 低频段 magnitude，计算频谱通量（正差值之和）
        float sumFlux = 0.0f;
        for (int b = 0; b < lowBins; ++b) {
            const float mag = std::abs(buf[b]);
            const float diff = mag - prevMag[b];
            if (diff > 0.0f) sumFlux += diff;
            prevMag[b] = mag;
        }
        flux[f] = sumFlux;
    }

    // 5. 自相关找 BPM
    // frame rate = sr / hop = 22050 / 512 ≈ 43.07 fps
    const float frameRate = static_cast<float>(sr) / hopSize;
    // BPM 范围 60-180 → lag 范围
    const int minLag = static_cast<int>(frameRate * 60.0f / 60.0f);   // 60 BPM
    const int maxLag = static_cast<int>(frameRate * 60.0f / 180.0f);  // 180 BPM
    // 注意：BPM 越高 → 周期越短 → lag 越小
    // 所以 minLag 对应 60BPM（慢），maxLag 应对应 180BPM（快）
    // 修正：lag = frameRate / (BPM/60) = frameRate * 60 / BPM
    // 60 BPM → lag = 43.07, 180 BPM → lag = 14.36
    const int lagLo = std::max(8, static_cast<int>(frameRate * 60.0f / 180.0f));   // 高 BPM
    const int lagHi = std::min(nFrames / 2, static_cast<int>(frameRate * 60.0f / 60.0f)); // 低 BPM

    std::vector<float> autocorr(lagHi + 1, 0.0f);
    float maxAc = 0.0f;
    int bestLag = lagLo;
    float sumAc = 0.0f;
    int cntAc = 0;

    for (int lag = lagLo; lag <= lagHi; ++lag) {
        double s = 0.0;
        for (int i = lag; i < nFrames; ++i) {
            s += static_cast<double>(flux[i]) * flux[i - lag];
        }
        const float ac = static_cast<float>(s / (nFrames - lag));
        autocorr[lag] = ac;
        sumAc += ac;
        ++cntAc;
        if (ac > maxAc) {
            maxAc = ac;
            bestLag = lag;
        }
    }

    const float meanAc = cntAc > 0 ? sumAc / cntAc : 0.001f;
    const float confidence = meanAc > 0.001f ? maxAc / meanAc : 0.0f;

    // Octave 校正：检查 bestLag/2 和 bestLag/3 是否也有显著峰值
    // 如果有，倾向更短的周期（更高 BPM）—— 解决自相关的倍频错误
    for (int div = 2; div <= 3; ++div) {
        const int shorterLag = bestLag / div;
        if (shorterLag >= lagLo && autocorr[shorterLag] > maxAc * 0.55f) {
            bestLag = shorterLag;
            break;
        }
    }

    // lag → BPM：BPM = frameRate * 60 / lag
    const float bpm = frameRate * 60.0f / bestLag;

    auto t1 = std::chrono::high_resolution_clock::now();
    const double elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

    return { bpm, confidence, nFrames, elapsedMs };
}

// 纯 FFT 性能基准 — 对比 JS FFT 实现
struct FftBenchResult {
    double elapsedMs;
    int totalOps;
    int fftSize;
};

inline FftBenchResult fftBenchmark(int fftSize, int iterations) {
    std::vector<std::complex<float>> buf(fftSize);
    // 随机初始化
    for (int i = 0; i < fftSize; ++i) {
        buf[i] = std::complex<float>(
            static_cast<float>(std::rand()) / RAND_MAX * 2.0f - 1.0f,
            static_cast<float>(std::rand()) / RAND_MAX * 2.0f - 1.0f
        );
    }

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int it = 0; it < iterations; ++it) {
        auto tmp = buf;
        fft(tmp);
    }
    auto t1 = std::chrono::high_resolution_clock::now();

    return {
        std::chrono::duration<double, std::milli>(t1 - t0).count(),
        iterations,
        fftSize
    };
}

} // namespace mradio
