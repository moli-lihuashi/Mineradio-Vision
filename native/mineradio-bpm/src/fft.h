// src/fft.h
// 迭代式 Cooley-Tukey radix-2 FFT — 纯 C++ 实现，无外部依赖
// 编译器 /arch:AVX2 + /fp:fast 会自动向量化 butterfly 循环
#pragma once
#include <vector>
#include <complex>
#include <cmath>

namespace mradio {

constexpr float PI_F = 3.14159265358979323846f;

// 迭代 radix-2 FFT（n 必须是 2 的幂）
inline void fft(std::vector<std::complex<float>>& a) {
    const int n = static_cast<int>(a.size());
    if (n <= 1) return;

    // 位反转排列
    for (int i = 1, j = 0; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }

    // 蝶形运算
    for (int len = 2; len <= n; len <<= 1) {
        const float ang = -2.0f * PI_F / static_cast<float>(len);
        const std::complex<float> wlen(std::cos(ang), std::sin(ang));
        const int half = len >> 1;
        for (int i = 0; i < n; i += len) {
            std::complex<float> w(1.0f, 0.0f);
            #pragma omp simd
            for (int j = 0; j < half; ++j) {
                const auto u = a[i + j];
                const auto v = a[i + j + half] * w;
                a[i + j] = u + v;
                a[i + j + half] = u - v;
                w *= wlen;
            }
        }
    }
}

// 实数 FFT 便利函数：输入实数序列，输出复数频谱（只取前 n/2+1 个 bin 有意义）
inline std::vector<std::complex<float>> rfft(const float* data, int n) {
    std::vector<std::complex<float>> buf(n);
    for (int i = 0; i < n; ++i) buf[i] = std::complex<float>(data[i], 0.0f);
    fft(buf);
    return buf;
}

// Hann 窗
inline std::vector<float> hannWindow(int n) {
    std::vector<float> w(n);
    for (int i = 0; i < n; ++i) {
        w[i] = 0.5f * (1.0f - std::cos(2.0f * PI_F * i / (n - 1)));
    }
    return w;
}

} // namespace mradio
