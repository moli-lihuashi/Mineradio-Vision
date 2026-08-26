// src/bpm_native.cpp
// N-API：analyzeBPM / fftBenchmark / analyzeDjPcm / djEnergy* 流式句柄
#include <napi.h>
#include "bpm.h"
#include "dj_energy.h"
#include "dj_beatmap.h"
#include "wasapi_sink.h"
#include <cstring>
#include <algorithm>
#include <chrono>
#include <memory>

using namespace Napi;

static Object DjEnergyResultToJs(Env env, const mradio::DjEnergyResult& r) {
    Object obj = Object::New(env);
    Float32Array low = Float32Array::New(env, r.lowEnergy.size());
    Float32Array hit = Float32Array::New(env, r.hitEnergy.size());
    if (!r.lowEnergy.empty()) {
        std::memcpy(low.Data(), r.lowEnergy.data(), r.lowEnergy.size() * sizeof(float));
    }
    if (!r.hitEnergy.empty()) {
        std::memcpy(hit.Data(), r.hitEnergy.data(), r.hitEnergy.size() * sizeof(float));
    }
    obj.Set("lowEnergy", low);
    obj.Set("hitEnergy", hit);
    obj.Set("hopSec", Number::New(env, r.hopSec));
    obj.Set("effectiveSampleRate", Number::New(env, r.effectiveSr));
    obj.Set("sampleStep", Number::New(env, r.sampleStep));
    obj.Set("hopSize", Number::New(env, r.hopSize));
    obj.Set("effectiveSamples", Number::New(env, (double)r.effectiveSamples));
    obj.Set("inputSamples", Number::New(env, (double)r.inputSamples));
    obj.Set("frames", Number::New(env, (double)r.lowEnergy.size()));
    obj.Set("elapsedMs", Number::New(env, r.elapsedMs));
    obj.Set("engine", String::New(env, "cpp-native"));
    return obj;
}

static void DjEnergyFinalizer(Env /*env*/, mradio::DjEnergyTracker* ptr) {
    delete ptr;
}

Value AnalyzeBPM(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsNumber()) {
        TypeError::New(env, "analyzeBPM(pcm: Float32Array, sampleRate: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Float32Array ta = info[0].As<Float32Array>();
    int n = static_cast<int>(ta.ElementLength());
    if (n < 4096) {
        TypeError::New(env, "pcm too short (need >= 4096 samples)").ThrowAsJavaScriptException();
        return env.Null();
    }
    int sampleRate = info[1].As<Number>().Int32Value();
    if (sampleRate < 8000 || sampleRate > 384000) {
        TypeError::New(env, "sampleRate out of range").ThrowAsJavaScriptException();
        return env.Null();
    }
    mradio::BpmResult r = mradio::analyzeBpm(ta.Data(), n, sampleRate);
    Object obj = Object::New(env);
    obj.Set("bpm", Number::New(env, r.bpm));
    obj.Set("confidence", Number::New(env, r.confidence));
    obj.Set("framesAnalyzed", Number::New(env, r.framesAnalyzed));
    obj.Set("elapsedMs", Number::New(env, r.elapsedMs));
    obj.Set("engine", String::New(env, "cpp-native"));
    return obj;
}

Value FftBenchmark(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        TypeError::New(env, "fftBenchmark(fftSize: number, iterations: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    int fftSize = info[0].As<Number>().Int32Value();
    int iters = info[1].As<Number>().Int32Value();
    if (fftSize < 8 || (fftSize & (fftSize - 1)) != 0) {
        TypeError::New(env, "fftSize must be power of 2 and >= 8").ThrowAsJavaScriptException();
        return env.Null();
    }
    mradio::FftBenchResult r = mradio::fftBenchmark(fftSize, iters);
    Object obj = Object::New(env);
    obj.Set("elapsedMs", Number::New(env, r.elapsedMs));
    obj.Set("totalOps", Number::New(env, r.totalOps));
    obj.Set("fftSize", Number::New(env, r.fftSize));
    obj.Set("opsPerSec", Number::New(env, r.totalOps / (r.elapsedMs / 1000.0)));
    obj.Set("engine", String::New(env, "cpp-native"));
    return obj;
}

Value AnalyzeDjPcm(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsNumber()) {
        TypeError::New(env, "analyzeDjPcm(pcm: Float32Array, sampleRate: number, hopSec?: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Float32Array ta = info[0].As<Float32Array>();
    int n = static_cast<int>(ta.ElementLength());
    if (n < 256) {
        TypeError::New(env, "pcm too short").ThrowAsJavaScriptException();
        return env.Null();
    }
    int sampleRate = info[1].As<Number>().Int32Value();
    double hopSec = (info.Length() >= 3 && info[2].IsNumber()) ? info[2].As<Number>().DoubleValue() : 0.01;
    mradio::DjEnergyResult r = mradio::DjEnergyTracker::analyzePcm(ta.Data(), n, sampleRate, hopSec);
    return DjEnergyResultToJs(env, r);
}

// djEnergyCreate(sampleRate, hopSec?) -> External handle
Value DjEnergyCreate(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        TypeError::New(env, "djEnergyCreate(sampleRate, hopSec?)").ThrowAsJavaScriptException();
        return env.Null();
    }
    int sampleRate = info[0].As<Number>().Int32Value();
    double hopSec = (info.Length() >= 2 && info[1].IsNumber()) ? info[1].As<Number>().DoubleValue() : 0.01;
    mradio::DjEnergyTracker* tr = new mradio::DjEnergyTracker();
    if (!tr->init(sampleRate, hopSec)) {
        delete tr;
        Error::New(env, "invalid sampleRate/hopSec").ThrowAsJavaScriptException();
        return env.Null();
    }
    return External<mradio::DjEnergyTracker>::New(env, tr, DjEnergyFinalizer);
}

static mradio::DjEnergyTracker* RequireTracker(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsExternal()) {
        TypeError::New(env, "djEnergy handle required").ThrowAsJavaScriptException();
        return nullptr;
    }
    return info[0].As<External<mradio::DjEnergyTracker>>().Data();
}

Value DjEnergyPushStereo(const CallbackInfo& info) {
    Env env = info.Env();
    mradio::DjEnergyTracker* tr = RequireTracker(info);
    if (!tr) return env.Undefined();
    if (info.Length() < 2 || !info[1].IsTypedArray()) {
        TypeError::New(env, "djEnergyPushStereo(handle, left, right?)").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Float32Array left = info[1].As<Float32Array>();
    const float* rightPtr = nullptr;
    int n = (int)left.ElementLength();
    if (info.Length() >= 3 && info[2].IsTypedArray()) {
        Float32Array right = info[2].As<Float32Array>();
        n = (std::min)(n, (int)right.ElementLength());
        rightPtr = right.Data();
    }
    tr->pushStereo(left.Data(), rightPtr, n);
    return env.Undefined();
}

Value DjEnergyFinish(const CallbackInfo& info) {
    Env env = info.Env();
    mradio::DjEnergyTracker* tr = RequireTracker(info);
    if (!tr) return env.Null();
    mradio::DjEnergyResult r = tr->finish();
    // handle still owned by External; allow re-init if needed by creating a new one
    return DjEnergyResultToJs(env, r);
}

static Object BeatToJs(Env env, const mradio::DjBeat& b) {
    Object o = Object::New(env);
    o.Set("time", Number::New(env, b.time));
    o.Set("strength", Number::New(env, b.strength));
    o.Set("confidence", Number::New(env, b.confidence));
    o.Set("impact", Number::New(env, b.impact));
    o.Set("primary", Boolean::New(env, b.primary));
    o.Set("camera", Boolean::New(env, b.camera));
    o.Set("pulse", Boolean::New(env, b.pulse));
    o.Set("tone", String::New(env, b.tone ? b.tone : "podcast-dj-server-low-grid"));
    o.Set("low", Number::New(env, b.low));
    o.Set("body", Number::New(env, b.body));
    o.Set("snap", Number::New(env, b.snap));
    o.Set("mass", Number::New(env, b.mass));
    o.Set("sharpness", Number::New(env, b.sharpness));
    o.Set("combo", String::New(env, b.combo ? b.combo : "downbeat"));
    o.Set("step", Number::New(env, b.step));
    o.Set("index", Number::New(env, b.index));
    o.Set("dj", Boolean::New(env, true));
    o.Set("grid", Boolean::New(env, true));
    o.Set("kickOnly", Boolean::New(env, true));
    o.Set("server", Boolean::New(env, true));
    return o;
}

static Object BeatMapToJs(Env env, const mradio::DjBeatMapResult& r) {
    Object obj = Object::New(env);
    Array kicks = Array::New(env, r.kicks.size());
    for (size_t i = 0; i < r.kicks.size(); i++) kicks.Set((uint32_t)i, Number::New(env, r.kicks[i]));
    Array beats = Array::New(env, r.beats.size());
    for (size_t i = 0; i < r.beats.size(); i++) beats.Set((uint32_t)i, BeatToJs(env, r.beats[i]));
    Array cameraBeats = Array::New(env, r.cameraBeats.size());
    for (size_t i = 0; i < r.cameraBeats.size(); i++) cameraBeats.Set((uint32_t)i, BeatToJs(env, r.cameraBeats[i]));
    Array pulseBeats = Array::New(env, r.pulseBeats.size());
    for (size_t i = 0; i < r.pulseBeats.size(); i++) {
        Object p = Object::New(env);
        const mradio::DjPulseBeat& pb = r.pulseBeats[i];
        p.Set("time", Number::New(env, pb.time));
        p.Set("strength", Number::New(env, pb.strength));
        p.Set("impact", Number::New(env, pb.impact));
        p.Set("combo", String::New(env, pb.combo ? pb.combo : "downbeat"));
        p.Set("low", Number::New(env, pb.low));
        p.Set("body", Number::New(env, pb.body));
        p.Set("snap", Number::New(env, pb.snap));
        p.Set("dj", Boolean::New(env, true));
        pulseBeats.Set((uint32_t)i, p);
    }
    Array sectionSteps = Array::New(env, r.sectionSteps.size());
    for (size_t i = 0; i < r.sectionSteps.size(); i++) sectionSteps.Set((uint32_t)i, Number::New(env, r.sectionSteps[i]));

    obj.Set("kicks", kicks);
    obj.Set("beats", beats);
    obj.Set("pulseBeats", pulseBeats);
    obj.Set("cameraBeats", cameraBeats);
    obj.Set("gridStep", Number::New(env, r.gridStep));
    obj.Set("sectionSteps", sectionSteps);
    obj.Set("tempoSource", String::New(env, r.tempoSource.c_str()));
    obj.Set("duration", Number::New(env, r.duration));
    obj.Set("visualBeatCount", Number::New(env, r.visualBeatCount));
    obj.Set("analyzedAt", Number::New(env, (double)std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count()));
    obj.Set("engine", String::New(env, "cpp-native"));
    obj.Set("elapsedMs", Number::New(env, r.elapsedMs));
    Object debug = Object::New(env);
    debug.Set("candidates", Number::New(env, r.candidates));
    debug.Set("hopSec", Number::New(env, r.hopSec));
    debug.Set("lowRef", Number::New(env, r.lowRef));
    debug.Set("step", Number::New(env, r.gridStep));
    obj.Set("debug", debug);
    return obj;
}

// buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, hopSec, durationSec?) -> Object
Value BuildBeatMapFromLowEnergy(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsTypedArray() || !info[1].IsTypedArray() || !info[2].IsNumber()) {
        TypeError::New(env, "buildBeatMapFromLowEnergy(lowEnergy, hitEnergy, hopSec, durationSec?)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Float32Array low = info[0].As<Float32Array>();
    Float32Array hit = info[1].As<Float32Array>();
    double hopSec = info[2].As<Number>().DoubleValue();
    double durationSec = (info.Length() >= 4 && info[3].IsNumber()) ? info[3].As<Number>().DoubleValue() : 0.0;
    mradio::DjBeatMapResult r = mradio::buildBeatMapFromLowEnergy(
      low.Data(), (int)low.ElementLength(),
      hit.Data(), (int)hit.ElementLength(),
      hopSec, durationSec
    );
    return BeatMapToJs(env, r);
}

Value Version(const CallbackInfo& info) {
    return String::New(info.Env(), "mineradio-bpm-native 0.4.0 (BPM+DjEnergy+BeatMap+Wasapi3A AVX2)");
}

static void WasapiFinalizer(Env /*env*/, mradio::WasapiSharedSink* ptr) {
    delete ptr;
}

static mradio::WasapiSharedSink* RequireWasapi(const CallbackInfo& info) {
    Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsExternal()) {
        TypeError::New(env, "wasapi handle required").ThrowAsJavaScriptException();
        return nullptr;
    }
    return info[0].As<External<mradio::WasapiSharedSink>>().Data();
}

Value WasapiAvailable(const CallbackInfo& info) {
    return Boolean::New(info.Env(), mradio::wasapiPlatformAvailable());
}

Value WasapiCreate(const CallbackInfo& info) {
    Env env = info.Env();
    if (!mradio::wasapiPlatformAvailable()) {
        Error::New(env, "WASAPI not available on this platform").ThrowAsJavaScriptException();
        return env.Null();
    }
    int sr = (info.Length() >= 1 && info[0].IsNumber()) ? info[0].As<Number>().Int32Value() : 48000;
    int ch = (info.Length() >= 2 && info[1].IsNumber()) ? info[1].As<Number>().Int32Value() : 2;
    auto* sink = new mradio::WasapiSharedSink();
    if (!sink->open(sr, ch)) {
        std::string err = sink->status().lastError;
        delete sink;
        Error::New(env, err.empty() ? "wasapi open failed" : err).ThrowAsJavaScriptException();
        return env.Null();
    }
    return External<mradio::WasapiSharedSink>::New(env, sink, WasapiFinalizer);
}

Value WasapiStart(const CallbackInfo& info) {
    Env env = info.Env();
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    bool ok = sink->start();
    if (!ok) {
        Error::New(env, sink->status().lastError.empty() ? "wasapi start failed" : sink->status().lastError)
          .ThrowAsJavaScriptException();
    }
    return Boolean::New(env, ok);
}

Value WasapiStop(const CallbackInfo& info) {
    Env env = info.Env();
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    sink->stop();
    return Boolean::New(env, true);
}

Value WasapiClose(const CallbackInfo& info) {
    Env env = info.Env();
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    sink->close();
    return Boolean::New(env, true);
}

Value WasapiWrite(const CallbackInfo& info) {
    Env env = info.Env();
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    if (info.Length() < 2 || !info[1].IsTypedArray()) {
        TypeError::New(env, "wasapiWrite(handle, Float32Array interleaved)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Float32Array ta = info[1].As<Float32Array>();
    int samples = (int)ta.ElementLength();
    int frames = samples / 2;
    if (frames <= 0) return Number::New(env, 0);
    int wrote = sink->write(ta.Data(), frames);
    return Number::New(env, wrote);
}

Value WasapiSetVolume(const CallbackInfo& info) {
    Env env = info.Env();
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    double v = (info.Length() >= 2 && info[1].IsNumber()) ? info[1].As<Number>().DoubleValue() : 1.0;
    sink->setVolume(v);
    return Boolean::New(env, true);
}

Value WasapiStatus(const CallbackInfo& info) {
    Env env = info.Env();
    Object obj = Object::New(env);
    if (info.Length() < 1 || info[0].IsNull() || info[0].IsUndefined()) {
        obj.Set("available", Boolean::New(env, mradio::wasapiPlatformAvailable()));
        obj.Set("running", Boolean::New(env, false));
        return obj;
    }
    auto* sink = RequireWasapi(info);
    if (!sink) return env.Null();
    mradio::WasapiStatus s = sink->status();
    obj.Set("available", Boolean::New(env, s.available));
    obj.Set("running", Boolean::New(env, s.running));
    obj.Set("sampleRate", Number::New(env, s.sampleRate));
    obj.Set("channels", Number::New(env, s.channels));
    obj.Set("volume", Number::New(env, s.volume));
    obj.Set("framesWritten", Number::New(env, (double)s.framesWritten));
    obj.Set("underruns", Number::New(env, (double)s.underruns));
    obj.Set("deviceName", String::New(env, s.deviceName.c_str()));
    obj.Set("lastError", String::New(env, s.lastError.c_str()));
    obj.Set("open", Boolean::New(env, sink->isOpen()));
    return obj;
}

Object InitAll(Env env, Object exports) {
    exports.Set("analyzeBPM", Function::New(env, AnalyzeBPM));
    exports.Set("fftBenchmark", Function::New(env, FftBenchmark));
    exports.Set("analyzeDjPcm", Function::New(env, AnalyzeDjPcm));
    exports.Set("djEnergyCreate", Function::New(env, DjEnergyCreate));
    exports.Set("djEnergyPushStereo", Function::New(env, DjEnergyPushStereo));
    exports.Set("djEnergyFinish", Function::New(env, DjEnergyFinish));
    exports.Set("buildBeatMapFromLowEnergy", Function::New(env, BuildBeatMapFromLowEnergy));
    exports.Set("wasapiAvailable", Function::New(env, WasapiAvailable));
    exports.Set("wasapiCreate", Function::New(env, WasapiCreate));
    exports.Set("wasapiStart", Function::New(env, WasapiStart));
    exports.Set("wasapiStop", Function::New(env, WasapiStop));
    exports.Set("wasapiClose", Function::New(env, WasapiClose));
    exports.Set("wasapiWrite", Function::New(env, WasapiWrite));
    exports.Set("wasapiSetVolume", Function::New(env, WasapiSetVolume));
    exports.Set("wasapiStatus", Function::New(env, WasapiStatus));
    exports.Set("version", Function::New(env, Version));
    return exports;
}

NODE_API_MODULE(bpm_native, InitAll)
