#pragma once
// 阶段 3A：WASAPI 共享模式 PCM 输出（Windows）
// 不负责解码；由 JS 写入 interleaved float32 stereo。

#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <avrt.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ks.h>
#include <ksmedia.h>
#endif

namespace mradio {

struct WasapiStatus {
  bool available = false;
  bool running = false;
  int sampleRate = 0;
  int channels = 0;
  double volume = 1.0;
  uint64_t framesWritten = 0;
  uint64_t underruns = 0;
  std::string deviceName;
  std::string lastError;
};

#ifdef _WIN32

class WasapiSharedSink {
public:
  WasapiSharedSink() = default;
  ~WasapiSharedSink() { close(); }

  WasapiSharedSink(const WasapiSharedSink&) = delete;
  WasapiSharedSink& operator=(const WasapiSharedSink&) = delete;

  bool open(int sampleRate, int channels) {
    close();
    lastError_.clear();
    if (sampleRate < 8000 || sampleRate > 384000 || channels < 1 || channels > 2) {
      lastError_ = "invalid sampleRate/channels";
      return false;
    }
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    comInited_ = SUCCEEDED(hr) || hr == S_FALSE || hr == RPC_E_CHANGED_MODE;

    IMMDeviceEnumerator* enumerator = nullptr;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                          __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
    if (FAILED(hr) || !enumerator) {
      lastError_ = "MMDeviceEnumerator failed";
      return false;
    }

    IMMDevice* device = nullptr;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    enumerator->Release();
    if (FAILED(hr) || !device) {
      lastError_ = "GetDefaultAudioEndpoint failed";
      return false;
    }

    IPropertyStore* props = nullptr;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props)) && props) {
      PROPVARIANT var;
      PropVariantInit(&var);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &var)) && var.vt == VT_LPWSTR && var.pwszVal) {
        int n = WideCharToMultiByte(CP_UTF8, 0, var.pwszVal, -1, nullptr, 0, nullptr, nullptr);
        if (n > 0) {
          deviceName_.assign(n - 1, '\0');
          WideCharToMultiByte(CP_UTF8, 0, var.pwszVal, -1, &deviceName_[0], n, nullptr, nullptr);
        }
      }
      PropVariantClear(&var);
      props->Release();
    }

    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client_);
    device->Release();
    if (FAILED(hr) || !client_) {
      lastError_ = "Activate IAudioClient failed";
      return false;
    }

    WAVEFORMATEX* mix = nullptr;
    hr = client_->GetMixFormat(&mix);
    if (FAILED(hr) || !mix) {
      lastError_ = "GetMixFormat failed";
      closeClientOnly();
      return false;
    }

    // 尽量用设备 mix format；若调用方 sr/ch 不同，在 write 侧简单重采样/扩声道前先要求匹配或接受设备格式
    outSampleRate_ = (int)mix->nSamplesPerSec;
    outChannels_ = (int)mix->nChannels;
    if (outChannels_ > 2) outChannels_ = 2;
    bitsPerSample_ = mix->wBitsPerSample;
    isFloat_ = (mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT)
      || (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE
          && reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);

    REFERENCE_TIME bufDuration = 10000000; // 1s
    hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, bufDuration, 0, mix, nullptr);
    CoTaskMemFree(mix);
    if (FAILED(hr)) {
      lastError_ = "IAudioClient::Initialize failed";
      closeClientOnly();
      return false;
    }

    hr = client_->GetService(__uuidof(IAudioRenderClient), (void**)&render_);
    if (FAILED(hr) || !render_) {
      lastError_ = "GetService IAudioRenderClient failed";
      closeClientOnly();
      return false;
    }

    UINT32 bufferFrames = 0;
    client_->GetBufferSize(&bufferFrames);
    bufferFrames_ = (int)bufferFrames;

    ring_.assign((size_t)outSampleRate_ * (size_t)outChannels_ * 2, 0.f); // ~2s
    ringFrames_ = (int)(ring_.size() / (size_t)outChannels_);
    writePos_ = 0;
    readPos_ = 0;
    framesQueued_ = 0;
    reqSampleRate_ = sampleRate;
    reqChannels_ = channels;
    opened_ = true;
    return true;
  }

  void close() {
    stop();
    closeClientOnly();
    ring_.clear();
    ringFrames_ = 0;
    opened_ = false;
  }

  bool start() {
    if (!opened_ || !client_) return false;
    if (running_) return true;
    stopFlag_ = false;
    HRESULT hr = client_->Start();
    if (FAILED(hr)) {
      lastError_ = "IAudioClient::Start failed";
      return false;
    }
    running_ = true;
    thread_ = std::thread([this]() { renderLoop(); });
    return true;
  }

  void stop() {
    stopFlag_ = true;
    if (thread_.joinable()) thread_.join();
    if (client_ && running_) {
      client_->Stop();
      client_->Reset();
    }
    running_ = false;
    framesQueued_ = 0;
    writePos_ = 0;
    readPos_ = 0;
  }

  // interleaved float32, frameCount = samples/channels (req channels)
  int write(const float* interleaved, int frameCount) {
    if (!opened_ || !interleaved || frameCount <= 0) return 0;
    int written = 0;
    for (int i = 0; i < frameCount; i++) {
      float L = interleaved[i * reqChannels_];
      float R = (reqChannels_ > 1) ? interleaved[i * reqChannels_ + 1] : L;
      // 极简：若设备 sr 不同，先直接喂（后续可加重采样）；多数机 48k 对齐
      if (!pushFrame(L, R)) break;
      written++;
    }
    framesWritten_ += (uint64_t)written;
    return written;
  }

  void setVolume(double v) {
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    volume_.store(v, std::memory_order_relaxed);
  }

  WasapiStatus status() const {
    WasapiStatus s;
    s.available = true;
    s.running = running_;
    s.sampleRate = outSampleRate_;
    s.channels = outChannels_;
    s.volume = volume_.load(std::memory_order_relaxed);
    s.framesWritten = framesWritten_;
    s.underruns = underruns_;
    s.deviceName = deviceName_;
    s.lastError = lastError_;
    return s;
  }

  int deviceSampleRate() const { return outSampleRate_; }
  int deviceChannels() const { return outChannels_; }
  bool isOpen() const { return opened_; }

private:
  void closeClientOnly() {
    if (render_) { render_->Release(); render_ = nullptr; }
    if (client_) { client_->Release(); client_ = nullptr; }
    if (comInited_) {
      // 不强制 CoUninitialize：Electron 主进程常已初始化 COM
      comInited_ = false;
    }
  }

  bool pushFrame(float L, float R) {
    std::lock_guard<std::mutex> lock(mu_);
    if (framesQueued_ >= ringFrames_ - 1) return false;
    int wp = writePos_;
    ring_[(size_t)wp * (size_t)outChannels_] = L;
    if (outChannels_ > 1) ring_[(size_t)wp * (size_t)outChannels_ + 1] = R;
    writePos_ = (wp + 1) % ringFrames_;
    framesQueued_++;
    return true;
  }

  bool popFrame(float& L, float& R) {
    std::lock_guard<std::mutex> lock(mu_);
    if (framesQueued_ <= 0) return false;
    int rp = readPos_;
    L = ring_[(size_t)rp * (size_t)outChannels_];
    R = (outChannels_ > 1) ? ring_[(size_t)rp * (size_t)outChannels_ + 1] : L;
    readPos_ = (rp + 1) % ringFrames_;
    framesQueued_--;
    return true;
  }

  void renderLoop() {
    DWORD taskIndex = 0;
    HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    while (!stopFlag_) {
      if (!client_ || !render_) break;
      UINT32 padding = 0;
      if (FAILED(client_->GetCurrentPadding(&padding))) {
        Sleep(5);
        continue;
      }
      int avail = bufferFrames_ - (int)padding;
      if (avail <= 0) {
        Sleep(2);
        continue;
      }
      BYTE* data = nullptr;
      if (FAILED(render_->GetBuffer((UINT32)avail, &data)) || !data) {
        Sleep(2);
        continue;
      }
      double vol = volume_.load(std::memory_order_relaxed);
      for (int i = 0; i < avail; i++) {
        float L = 0.f, R = 0.f;
        if (!popFrame(L, R)) {
          underruns_++;
          // silence
        }
        L = (float)(L * vol);
        R = (float)(R * vol);
        if (isFloat_ && bitsPerSample_ == 32) {
          float* f = reinterpret_cast<float*>(data);
          if (outChannels_ >= 2) {
            f[i * outChannels_] = L;
            f[i * outChannels_ + 1] = R;
          } else {
            f[i] = 0.5f * (L + R);
          }
        } else if (bitsPerSample_ == 16) {
          int16_t* s = reinterpret_cast<int16_t*>(data);
          auto toI16 = [](float x) -> int16_t {
            if (x > 1.f) x = 1.f;
            if (x < -1.f) x = -1.f;
            return (int16_t)(x * 32767.f);
          };
          if (outChannels_ >= 2) {
            s[i * outChannels_] = toI16(L);
            s[i * outChannels_ + 1] = toI16(R);
          } else {
            s[i] = toI16(0.5f * (L + R));
          }
        } else {
          // 不支持的格式：填零
        }
      }
      render_->ReleaseBuffer((UINT32)avail, 0);
    }
    if (task) AvRevertMmThreadCharacteristics(task);
  }

  IAudioClient* client_ = nullptr;
  IAudioRenderClient* render_ = nullptr;
  bool comInited_ = false;
  bool opened_ = false;
  bool running_ = false;
  std::atomic<bool> stopFlag_{false};
  std::thread thread_;
  std::vector<float> ring_;
  int ringFrames_ = 0;
  int writePos_ = 0;
  int readPos_ = 0;
  int framesQueued_ = 0;
  std::mutex mu_;
  int bufferFrames_ = 0;
  int outSampleRate_ = 0;
  int outChannels_ = 0;
  int bitsPerSample_ = 32;
  bool isFloat_ = true;
  int reqSampleRate_ = 48000;
  int reqChannels_ = 2;
  std::atomic<double> volume_{1.0};
  uint64_t framesWritten_ = 0;
  uint64_t underruns_ = 0;
  std::string deviceName_;
  std::string lastError_;
};

#else

class WasapiSharedSink {
public:
  bool open(int, int) { lastError_ = "WASAPI only on Windows"; return false; }
  void close() {}
  bool start() { return false; }
  void stop() {}
  int write(const float*, int) { return 0; }
  void setVolume(double) {}
  WasapiStatus status() const {
    WasapiStatus s;
    s.available = false;
    s.lastError = lastError_;
    return s;
  }
  int deviceSampleRate() const { return 0; }
  int deviceChannels() const { return 0; }
  bool isOpen() const { return false; }
private:
  std::string lastError_;
};

#endif

inline bool wasapiPlatformAvailable() {
#ifdef _WIN32
  return true;
#else
  return false;
#endif
}

} // namespace mradio
