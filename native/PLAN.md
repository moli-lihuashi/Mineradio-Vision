# Mineradio C++ 底层改造详细计划

> 基于阶段 1 BPM 原型实测数据制定 · 2026-08-12  
> 2026-08-13 修订：纠正 dj-analyzer 归因、阶段 2 拆线（Worklet / 离线 C++ / 实时 C++）、写入审阅意见  
> **2026-08-13 ABC**：P1.5 drawRange 真减顶点已落地；row-layers feature-flag 整栈；overlay/probe/discovery 增量已挂

## 一、阶段 1 实测结论（已完成 ✓）

### 环境
- CPU: Xeon E3-1231 v3
- Node: 22.16.0 / Electron: 42.4.1 / MSVC: 14.44.35207
- 编译选项: `/O2 /arch:AVX2 /fp:fast /utf-8`

### 实测加速比

| 测试项 | JS 耗时 | Native 耗时 | 加速比 |
|--------|---------|-------------|--------|
| 简单鼓点 30s BPM 分析 | 74.47 ms | 34.55 ms | **2.16x** |
| 复杂音乐 30s BPM 分析 | 70.77 ms | 36.64 ms | **1.93x** |
| FFT 1024点 × 1000次 | 56.86 ms | 22.08 ms | **2.58x** |
| FFT 4096点 × 500次 | 119.34 ms | 50.28 ms | **2.37x** |
| 3分钟完整歌曲 BPM | 510.78 ms | 233.90 ms | **2.18x** |

### 关键发现

1. **算法正确性**：JS 与 Native 结果完全一致（BPM=123，置信度 11.60），证明实现等价
2. **加速比 2-2.6x**：低于预期的 3-5x，原因分析：
   - V8 JIT 已相当快，纯浮点循环优势被压缩
   - 自相关部分内存访问模式不规则，SIMD 自动向量化收益有限
   - 下采样、分帧等非 SIMD 代码占比约 40%
3. **真实瓶颈不在 BPM**：BPM 只在切歌时跑一次，510ms→234ms 用户无感
4. **CPU 占用归因需拆开（重要更正）**：
   - `dj-analyzer.js` 跑在 **Node 服务端进程**（`server.js` → `analyzePodcastDjStream`），是**整曲离线** biquad / percentile / onset，**不是** Renderer 每帧 60fps
   - 播放时 Renderer 主线程每帧热点更可能在：`11-main-loop.js`（`getByteFrequencyData` + 频段累加 + realtime beat）+ Three.js / 粒子 / 歌词纹理
   - 因此：**只把 `dj-analyzer` 迁到 C++，未必能把「播放中 50% CPU」打到 ≤15%**；必须先 Profile 再定主战场

### 结论

**纯 BPM 分析的 2x 加速不足以支撑全面重写**。真正需要改造的是（按证据优先级）：
1. **先 Profile**：分清 Renderer 播放帧 vs Server DJ 离线分析 vs GPU
2. **Renderer 实时频谱 / onset 主线程路径**（`11-main-loop.js`；已有半成品 AudioWorklet）
3. **Server/离线多频段 biquad 链**（`dj-analyzer.js` + 客户端 `02-podcast-dj-analysis.js` 同类算法）— 适合直接复用阶段 1 addon
4. 实时 FFT 可视化数据采集 — Chromium `AnalyserNode` 已是原生，**阶段 2 默认不动**

---

## 二、改造目标与边界

### 必须解决的问题
1. 播放时 CPU 占用 ~50%（E3-1231 v3）→ **产品愿望 ≤15%**；工程上拆成：  
   - **Renderer 播放帧**（真战场，见 §诊断）→ 相对基线再降 ≥30–40%（保效果路径）  
   - **DJ 离线分析尖峰** → 已由 2C 达成约 3–7x，**不再指望拉低播歌占用**
2. GC 暂停导致偶尔卡顿 → 音频分析侧优先 Worklet（已做）；歌词大纹理另议
3. ~~高分辨率可视化数据采集占用主线程~~ → Worklet 成功时已降载；失败回退仍需盯控制台

### 明确不做的
- ❌ 不重写 UI 层（HTML/CSS/JS 保持不变）
- ❌ 不重写播放列表/搜索/歌词同步逻辑
- ❌ 不替换 Chromium 的 `<audio>` 元素（阶段 2 可选；3A WASAPI 旁路另列）
- ❌ **不用 C++ 重写 3D/粒子**（GPU/顶点着色器问题；见 §诊断）
- ❌ **再堆 2C 同类离线 C++ 来「降播歌 50%」**（归因错误）

---

## 三、分阶段实施计划

### 阶段 2：实时 / 离线音频分析核心（1-2 周）— **修订版**

**目标**：把高 CPU 的音频分析移出 Renderer 主线程（或 Node 热路径）；主线程只收精简特征。  
**前提**：完成 **2.0 Profile 门禁** 后再写大量 C++。

#### 2.0 Profile 门禁（开工前必做，0.5 天）

用 Chrome DevTools Performance 录 **播放普通歌曲 30s** + **播客 DJ 分析一次**：

| 场景 | 看什么 | 判定 |
|------|--------|------|
| 普通播放 | Renderer：`animate` / `getByteFrequencyData` / Three `render` 占比 | 若主循环+渲染 >60% → 先 2B/GPU，勿只啃 dj-analyzer |
| 普通播放 | 是否大量 GC / Scripting long task | GC 为主 → 先对象池 / Worklet，C++ 次之 |
| DJ 分析 | Main/Server：`analyzePodcastDjStream` / biquad 时长 | 尖峰明显 → 2C C++ 离线管道收益明确 |
| 后台/最小化 | CPU 是否仍高 | 否 → 先加强现有后台降帧，再 native |

> 未过门禁不要承诺「播放 CPU 50%→15%」。阶段 2 可交付「分析加速 + 可测特征通路」，综合 CPU 目标以 Profile 后修订。

#### 2.1 需要迁移 / 改造的模块（按真实收益重排）

| 优先级 | 模块 | 当前位置 | 实际频率 | 预期收益 | 建议手段 |
|--------|------|----------|----------|----------|----------|
| P0 | Renderer 频段累加 + RMS + realtime beat | `11-main-loop.js` | 每渲染帧 | **播放 CPU 关键** | 先修好 AudioWorklet；不够再 C++ |
| P0 | 伪 Worklet 桥（主线程 RAF 再采 analyser） | `08-audio-worklet-bridge.js` | 已默认关 | 关掉是对的；勿再双采 | 真正 `AudioWorkletProcessor.process` |
| P1 | 离线 DJ biquad + percentile + onset | `dj-analyzer.js`（**Server**） | 切歌/播客分析一次 | 降分析尖峰、加速 beatmap | **C++（复用阶段1）** |
| P1 | 客户端同类离线 DJ 分析 | `03-beat/02-podcast-dj-analysis.js` | 分析时 | 同源算法 | 调同一 native API |
| P2 | Offline beatmap 全曲 decode 二次下载 | `01-audio-beat-analysis.js` | 切歌 | 带宽/CPU 尖峰 | 缓存复用，不必先 C++ |
| — | AnalyserNode FFT | Web Audio | 每帧 | 已原生 | **不动** |
| — | BPM | 阶段1 | 切歌一次 | 已完成 | 保持 |

#### 2.2 架构设计（两条线，勿混为一谈）

**线 A — Renderer 实时特征（影响播放中 CPU）**

```
┌─────────────────────────────────────────────────┐
│  Renderer 主线程                                 │
│  - 只读最新 features 快照（低频回调 / SharedBuffer）│
│  - 驱动可视化 / 镜头，不做 biquad / 大循环        │
└────────────────┬────────────────────────────────┘
                 │ port / Atomics 快照
┌────────────────▼────────────────────────────────┐
│  AudioWorklet（优先）或 C++ Worker               │
│  - 吃 AudioNode 输入 PCM                         │
│  - 8 频段能量 + kick/vocal/rms + onset           │
│  - 输出固定结构 Float32 特征包（≤256B/帧）       │
└─────────────────────────────────────────────────┘
```

**线 B — Server/离线 DJ 分析（影响分析尖峰，不直接等于播放帧）**

```
Node server / analyze API
  → Float32 PCM (已有 decode 路径)
  → native.analyzeDjEnergy(pcm, sr)   // C++ biquad bank + percentile + onset
  → 返回 lowEnergy/hitEnergy/beatMap 摘要
  → JS 只做组装与缓存
```

> SharedArrayBuffer 对 **线 A** 有价值；**线 B 用 N-API 直接吃 `Float32Array`/`Buffer` 即可**，不必为 Server 路径强上 SAB/COOP。

#### 2.3 实施步骤（建议顺序）

0. **2.0 Profile**：~~用户复测播放 CPU 1%–10%（达标）~~ → **2026-08-13 夜作废**（任务管理器误读）；真实基线约 **50%（渲染进程 ~43%）**。
1. **2B（已完成 2026-08-13）**：AudioWorklet 真离主线程  
   - ✅ `07-audio-analysis-processor.js` 在 `process()` 内 PCM→FFT/频段/onset  
   - ✅ `08-audio-worklet-bridge.js` **已接入 `index-loader`**（此前漏挂，永远走主线程 fallback）  
   - ✅ 音频图旁路：`audioTap→gain→destination`；Worklet 成功后 Analyser 降到 512  
   - ✅ `11-main-loop.js` 优先消费 Worklet features；失败回退主线程  
   - ⚠️ 验收「播放 CPU ≤15%」**未达标**（瓶颈在 Three 渲染，不在频谱）
2. **2C（已完成 2026-08-13）**：扩展 `native/mineradio-bpm`  
   - ✅ `src/dj_energy.h`：biquad HP/LP + hop 分帧 RMS/peak  
   - ✅ N-API：`analyzeDjPcm` / `djEnergyCreate` / `djEnergyPushStereo` / `djEnergyFinish`  
   - ✅ `src/dj_beatmap.h` + N-API：`buildBeatMapFromLowEnergy`（onset→grid→camera/pulse）  
   - ✅ `dj-analyzer.js` 能量 + beatmap 优先 native，失败自动 JS fallback  
   - ✅ 基准：`npm run test:dj` — 60s@44.1k 能量误差 ~1e-5，加速约 **2.7–3.5x**  
   - ✅ 基准：`npm run test:beatmap` — 90s synth beat 时间/impact 对齐，beatmap 加速约 **6–7x**  
   - ✅ 顺带修 JS `cameraActive`：`(bestCand && …)` 在无候选时得到 `null`，被 `camera !== false` 误计入 visualBeatCount；现与 C++ 布尔语义一致  
   - ✅ Electron 包用 `rebuild:electron`；源码树保留 Node ABI 供 CLI  
   - ⚠️ **2C 不降低播放中 Renderer CPU**（切歌离线尖峰专用）  
   - ❌ **2D 暂关**：优先渲染侧「真减顶点 / 隔帧 / DPR」；分析侧已非大头


3. **2D（暂关，可重开）**：C++ 实时 tap  
   - 决策修订：播放 50% 主因是 **Three 封面粒子 + 跟屏满帧**，不是分析；优先渲染预算  
   - **帧率以 FX「前台帧率上限」为准**（跟随屏幕=真 VSync；不偷锁 30）  
   - 默认维持 Worklet + 帧门控 + 粒子隔帧/DPR；极端低配机再议 2D
4. **验证指标（拆开写）**  
   - 播放中 Renderer CPU：以 **~50% 真基线** 为参照，目标相对下降 ≥40% 或绝对值 ≤15%（以机器为准）⏳  
   - DJ 分析：端到端耗时 ≥ 阶段1 量级加速（约 2x+），主进程分析尖峰下降 ✅  
   - 节拍/镜头观感：A/B 同曲不劣化（parity 绿）✅  
   - 崩溃：native throw → 自动 fallback，不拖垮 Electron ✅  

#### 2.3-R 渲染侧保效果降载（阶段 2 收口后的真战场 · 2026-08-13）

> 全面诊断结论：任务管理器 **~40% / 大内存** = 主窗口 Renderer；eco≈**99²≈9801** 封面点；VS 内大量 `snoise`；默认跟屏。

| 步 | 内容 | 状态 |
|----|------|------|
| P0 | 奇偶帧粒子子集 `uTemporalSubset` + 歌词火花进 VS | ✅ 复测总 CPU ~53%→~45%；近测跟屏仍可回摆 ~50% |
| P1 | eco/低配内部分辨率 scale；低配扩大隔帧默认 | ✅ 已合入；跟屏时占用仍高属预期 |
| P1.5 | **真减顶点**（drawRange / 更低网格 + 点径补偿） | ✅ **已落地**（棋盘分区 `setDrawRange`；eco 有效分辨率再压；`uUseDrawRange` 跳过 VS discard） |
| — | FX 帧率面板权威（取消 eco 偷锁 30） | ✅ |
| — | 重开 row-layers 追分 | ✅ feature-flag 整栈（默认开；eco/高压退轻量）；`lyricRows=0` / localStorage 可关 |

**控制台核对**：`window.__mineradioPerf`（`temporalSubset` / `mode` / `fps`）；`audioWorkletActive`；`PCOUNT` / `coverParticleGridForResolution()`。

#### 2.4 风险与缓解

| 风险 | 缓解 |
|------|------|
| 把 Server 离线路径误当成播放帧瓶颈 | 2.0 Profile 门禁；指标拆分 |
| SharedArrayBuffer / COOP 折腾成本高 | 线 B 不用 SAB；线 A 优先 Worklet MessagePort |
| 线程同步复杂 | 离线路径同步 N-API；实时路径先 Worklet |
| 崩溃影响整个应用 | try/catch + JS fallback；native 侧边界检查 |
| 多平台编译 | 先 Win x64；`prebuildify` 进 CI |
| Electron ABI 漂移 | `electron-rebuild` 绑死与 app 同版本；打包校验 `.node` |
| 算法漂移导致镜头乱跳 | 黄金样本对照（同 PCM → 能量/onset 误差阈值） |
| AVX2 在老 CPU 崩溃 | 提供 SSE2/标量 fallback 或运行时 CPUID 分发 |

#### 2.5 阶段 2 明确不做

- ❌ 不顺手开搞阶段 3 解码/WASAPI（边界膨胀）
- ❌ 不替换 `<audio>` / Web Audio 图（阶段 2）
- ❌ 不重写 Three/粒子「用 C++ 降 CPU」（那是 GPU/JS 渲染预算问题）
- ❌ 不把未接线的 Worklet 主线程双采重新打开

---

### 阶段 3：音频播放核心（2-4 周，可选）

**目标**：C++ 接管解码 + 播放 + 输出，实现零卡顿

#### 3.1 架构

```
┌─────────────────────────────────────────┐
│  JS (UI)                                │
│  - play/pause/seek 命令                 │
│  - 接收播放状态回调                      │
└──────────────┬──────────────────────────┘
               │ N-API
┌──────────────▼──────────────────────────┐
│  C++ Audio Engine (独立线程)            │
│  ┌──────────┐  ┌────────┐  ┌─────────┐ │
│  │ Decoder  │→│ Mixer  │→│ Output  │ │
│  │ mpg123/  │  │ 淡入   │  │WASAPI   │ │
│  │ FFmpeg   │  │ 淡出   │  │独占模式 │ │
│  └──────────┘  └────────┘  └─────────┘ │
└─────────────────────────────────────────┘
```

#### 3.2 实施步骤

1. **解码器集成**
   - 集成 mpg123（MP3）或 FFmpeg libavcodec（全格式）
   - 流式解码，不一次性加载
   - 输出 PCM 到环形缓冲

2. **音频输出**
   - Windows: WASAPI（共享模式起步，独占模式可选）
   - 采样率/位深度自适应
   - 缓冲区 2 × 10ms，延迟可控

3. **DSP 链**
   - 音量（无 destructive scaling）
   - 淡入淡出（采样级精确）
   - 均衡器（5/10 段 IIR）
   - 响度归一化（EBU R128，可选）

4. **JS 接口**
   - `engine.load(url) / play() / pause() / seek(sec)`
   - `engine.getPosition() / getDuration()`
   - `engine.setVolume(0..1) / setEQ(bands[])`
   - `engine.on('ended' / 'timeupdate' / 'error')`

5. **迁移策略**
   - 并行运行：`<audio>` + C++ engine 同时存在
   - 设置项让用户切换
   - 稳定后默认 C++，`<audio>` 作 fallback

#### 3.3 收益预期

| 指标 | 当前 (Chromium `<audio>`) | 阶段3后 |
|------|--------------------------|---------|
| CPU 占用 | ~15%（含分析） | ~5% |
| GC 影响 | 偶发卡顿 | 零 |
| 格式支持 | Chromium 决定 | 全格式 |
| Hi-Res | 受限 | 32bit/384kHz |
| 淡入淡出 | 不精确 | 采样级 |
| 无缝衔接 | 不支持 | gapless |

---

### 阶段 4：高级功能（可选，按需）

- ASIO/WASAPI 独占模式输出
- Dolby Atmos / Sony 360 Reality Audio
- 实时音频录制 / 虚拟声卡
- DRM 加密音乐支持
- 跨设备同步播放

---

## 四、技术选型

### C++ 库

| 用途 | 库 | 许可证 | 体积 |
|------|----|--------|------|
| FFT | 自实现（已就绪）/ KFR | MIT | 0 / 小 |
| MP3 解码 | mpg123 | LGPL | 小 |
| 全格式解码 | FFmpeg | LGPL/GPL | 大 |
| 音频输出 | WASAPI (Win) / CoreAudio (Mac) | 系统 API | 0 |
| DSP | KFR / FAUST | MIT/GPL | 中 |
| 节拍分析 | aubio | GPLv3 | 中 |

### 构建与分发

- **node-gyp** + **binding.gyp**（已验证可行）
- **prebuildify**：预编译多平台二进制，避免用户装编译器
- **electron-rebuild**：Electron 版本升级时重新编译
- 分发：`.node` 文件随 app 打包，按 `win32-x64` / `darwin-x64` / `linux-x64` 分目录

---

## 五、当前已就绪资产

```
native/mineradio-bpm/
├── package.json              # 项目配置
├── binding.gyp               # 构建配置（已调通：AVX2 + UTF-8 + EHsc）
├── index.js                  # JS wrapper + JS 对照实现
├── src/
│   ├── bpm_native.cpp        # N-API 绑定（已编译通过）
│   ├── fft.h                 # Cooley-Tukey FFT（已验证）
│   └── bpm.h                 # BPM 分析 + octave 校正（已验证）
├── test/
│   └── benchmark.js          # 5 项对比测试（已跑通）
└── build/Release/
    └── bpm_native.node       # 编译产物（Electron 42.4.1 x64）
```

### 关键编译参数（已验证）

```
/O2 /arch:AVX2 /fp:fast /utf-8 /permissive- /Zc:__cplusplus
Optimization=3, EnableEnhancedInstructionSet=5, FloatingPointModel=2
NAPI_CPP_EXCEPTIONS
```

### 编译命令

```powershell
cd native/mineradio-bpm
npx node-gyp rebuild --target=42.4.1 --arch=x64 --dist-url=https://electronjs.org/headers --msvs_version=2022
node test/benchmark.js
```

---

## 六、决策点

### 是否继续阶段 2？

**推荐继续，但改顺序**：

1. **先做 2.0 Profile**（半日）—— 没数据不要把「播放 50%」全算在 `dj-analyzer` 头上  
2. **先做 2B AudioWorklet 做对**（成本低，直接打播放主线程）  
3. **并行/紧接着 2C：`dj-analyzer` 离线管道 C++ 化**（阶段1资产复用最顺，收益可测）  
4. **2D C++ 实时线程仅作后备**

如果 Profile 显示粒子/3D `renderer.render` 占大头：  
→ **不要永久砍高端机特效**。按「上下兼顾」（§六-B）做自适应预算：低配/帧压/电池时临时降载，高配与用户选「高/超高」时保持满特效；同时仍可推进 2B/2C。  
→ 切勿把「低配能跑」做成「高配也变糊」。单靠 native 音频也不要承诺一定 ≤15%（渲染仍可能是大头）。

### 六-B、产品原则：上下兼顾（2026-08-13 确认）

> 用户明确要求：好机器效果不能缩水；差机器也要流畅。优化必须分层，不能一刀切降特效。

| 层级 | 低配 / 压力中 | 中档 | 高配 / 用户选高或超高 |
|------|---------------|------|------------------------|
| 画质档 `performanceQuality` | `eco` 或 `auto→eco` | `balanced` | `high` / `ultra`（拉满） |
| GPU 节流 `gpuThrottleMode` | `auto` 仅在电池/帧压时介入 | `auto` | `auto` 几乎不触发；可手动 `off` |
| 音频分析 | Worklet/C++ 离主线程（**不降观感**） | 同左 | 同左（主线程更闲，特效更稳） |
| 可见运动层 | 保 VSync 连续感（低配原则文档） | 满 | 满 + 更高粒子/歌词预算 |

**允许做的「降载」**（临时、可恢复、可关）：
- 帧压高时临时关 bloom / 降到 ~30fps（现有 `01-gpu-throttle.js`，且仅 `auto/on`）
- 后台/最小化停不可见图层
- 分析/预取降频（用户看不见算法）

**禁止做的**：
- ❌ 默认全局锁 `eco` 导致独显机器也糊  
- ❌ 为降 CPU 永久删高端视觉路径  
- ❌ 把「阶段 2 音频优化」偷换成「砍特效」交差  

**与阶段 2 的关系**：2B/2C 是 **上下都受益** 的路径（同一套特效，主线程更轻）。渲染自适应只是低配安全网，不是高配天花板。

### 阶段 3 是否值得做？

**取决于产品定位**（维持原文判断）：
- 个人用 / 小众：阶段 2（修订版）通常够  
- Hi-Res / gapless / 专业淡入淡出：再开阶段 3  
- 商业版权 DRM：阶段 3 + DRM，且与现有 `/api/audio` 代理模型要重新设计

**额外建议**：阶段 3 前必须先稳定阶段 2 的 **特征 ABI**（Worklet/C++ 同一套 features 结构），否则播放引擎换掉后可视化要重接两次。

---

## 七、时间估算（单人）— 修订

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| 1 | BPM 原型（已完成） | 1 天 |
| 2.0 | Profile 门禁 + 基线记录 | 0.5 天 |
| 2B | AudioWorklet 真离主线程 | 1–2 天 |
| 2C | dj-analyzer 离线 C++ | 3–5 天 |
| 2D | C++ 实时 tap（可选） | 3–5 天 |
| 3 | 音频播放核心 | 10–20 天 |
| 4 | 高级功能 | 按需 |

---

## 八、备选方案（如果 C++ 改造暂停）

不改底层，用 JS 生态优化：

1. **AudioWorklet（强烈建议先做）**：仓库里已有 `07-audio-analysis-processor.js`，当前桥接实现是错的（主线程双采）；修好可能就吃掉大部分「播放分析」CPU  
2. **Web Worker**：离线 beat/DJ 分析移出主线程（客户端路径）  
3. **对象池**：减少 GC 压力  
4. **requestIdleCallback / 已有切歌后置**：非关键任务让步（已部分落地）  
5. **OffscreenCanvas**：粒子渲染移到 Worker（工作量大，慎开）  
6. **降采样分析**：播放中用 512 FFT / 隔帧分析，视觉可接受时立刻降 CPU

**适用场景**：如果 DevTools 显示 GC 或 Three.js 是主因（而非纯浮点算力），这些方案成本更低，应排在大规模 C++ 之前。

---

## 九、审阅意见与修改建议（2026-08-13）

> 针对「阶段 2 底层更改」的外部审阅，已部分吸收进上文修订。下列条目请在实施时逐条勾选。

### 同意并应保留的

- [x] 阶段 1 证明 **N-API + MSVC/AVX2 链路可走通**，继续扩展 addon 合理  
- [x] **不重写 UI / 不先替换 `<audio>`** 的边界正确  
- [x] 离线 DJ biquad 链适合 C++，且能量化验收（对照 JS）方法论正确  
- [x] 阶段 3 作为可选、先共享/再独占 WASAPI 的节奏合理

### 必须修正的认知

1. **`dj-analyzer.js` ≠ 播放每帧实时分析**  
   它是 Server 侧整曲流式/离线分析；播放帧热点在 `11-main-loop.js` + 渲染。计划原文「每帧 60fps」应视为过时表述（已在 §三修订）。
2. **「CPU 50%→≤15%」不能单绑阶段 2C**  
   未 Profile 前只能作为产品愿望；工程指标应拆成「播放 Renderer」与「DJ 分析」。
3. **现有 AudioWorklet 桥不能当已完成优化**  
   ~~`08-audio-worklet-bridge.js` 在主线程双采~~ → **2026-08-13 已改**：PCM 旁路 + Worklet 内 FFT，主循环消费 features；失败回退主线程。

### 架构修改建议

| # | 建议 | 理由 |
|---|------|------|
| 1 | 阶段 2 拆成 **2B Worklet / 2C 离线 C++ / 2D 实时 C++** | 避免一条线赌错战场 |
| 2 | 离线路径用 **同步 `analyzeDjPcm`**，别一上来 TSFN+SAB | 降低复杂度；SAB 留给真实时 |
| 3 | 统一 **Features ABI**（8 bands + kick/vocal/rms + onset） | Worklet 与 C++ 可互换，阶段 3 也不用重接可视化 |
| 4 | addon 命名考虑 `mineradio-audio-native`（或 bpm 包内加 analyzer） | 避免「只有 BPM」的心理模型 |
| 5 | 增加 **黄金 PCM 回归**（小 wav 夹具）进 `native/.../test` | 防算法漂移导致镜头/DJ 拍点乱 |
| 6 | 打包进 `electron-builder` 校验 `.node` 存在与 ABI | 防止用户环境缺编译器时静默回退却无人知 |
| 7 | 老 CPU：**AVX2 非硬依赖** | E3 有 AVX2，但用户机可能没有 |
| 8 | 与前端已做优化协同：stall 恢复、预取限流、切歌后置、Worklet 关闭 | Native 不要重复解决已缓解的问题 |
| 9 | **上下兼顾**：高配满特效 + 低配自适应；默认画质改为 `auto` 按硬件选档 | 避免「优化=全家变糊」 |

### 不建议在阶段 2 做的

- 过早引入 FFmpeg/WASAPI（阶段 3 范围）  
- 为「听起来更 Hi-Fi」在分析线程上加重 DSP（与降 CPU 目标相反）  
- 用 C++ 重写 Three/粒子  
- 在未打通 JS fallback 前默认强制 native（崩溃面过大）
- **为降 CPU 永久下调高配默认特效**（与上下兼顾冲突）

### 阶段 2 DoD（2026-08-13 关闭 · 深夜修订）

1. ~~OK Profile 附录已填用户复测 CPU（1%-10%）~~ → **误判作废**；附录已改为 ~50% 真基线 + P0/P1 轨迹
2. OK 播放路径：Worklet 生效时主循环不再每帧 O(fftBins)；Analyser 仅低频兜底
3. OK dj-analyzer：默认 native（energy+beatmap），失败 JS；bench >=2x（energy~3x / beatmap~7x）
4. OK 算法对齐：energy/beatmap parity 绿；cameraActive null 坑已修
5. OK Win x64 .node 可随 dist_new 启动；afterPack + 启动日志提示缺文件/JS fallback
6. NO 2D：**不是因为 CPU 已达标**，而是战场在渲染；阶段 3A WASAPI 可选、默认不开

### 附录：Profile / 复测

| 日期 | 机器 | 场景 | Renderer CPU | 主线程长任务 | Server 分析耗时 | 备注 |
|------|------|------|--------------|--------------|-----------------|------|
| 2026-08-12 | E3-1231 v3 | 阶段1 BPM native | - | - | BPM ~2x | N-API 可行 |
| 2026-08-13 | E3-1231 v3 | 普通播放（门控+2B/2C） | ~~约 1%-10%~~ → **误判作废** | 用户观测 | - | 任务管理器误读；同日复测仍约 **50%**（渲染进程 ~43% / ~1.4GB） |
| 2026-08-13 夜 | E3-1231 v3 | 普通播放（歌词恢复后） | **~53% 总 / 渲染~43%** | - | - | 瓶颈在 Renderer/Three，非 2C |
| 2026-08-13 P0 | E3-1231 v3 | 隔帧粒子子集 + 火花进 shader | **~45% 总 / 渲染~38%**，内存 ~0.98GB | - | - | 有降；顶点着色仍重 |
| 2026-08-13 P1 | E3-1231 v3 | 内部分辨率 + 低配隔帧 | 跟屏近测仍可 **~50%** | - | - | 帧率跟 FX 面板；跟屏=满帧贵 |
| 2026-08-13 诊 | E3 静态+截图 | 全面诊断 | 大头=封面粒子 VS + render | - | - | eco≈9801 点；C++ 播歌帧≈0；Canvas `play-cpu-diagnosis` |
| 2026-08-13 | 本机 Node | DJ energy 60s@44.1k | - | - | JS/native ~3x | test:dj |
| 2026-08-13 | 本机 Node | DJ beatmap 90s synth | - | - | JS/native ~7x | test:beatmap |
| 2026-08-13 | Electron 42.4.1 | dist_new 加载 addon | - | - | - | nativeDjAvailable=true |

**阶段 2 结论**：2B/2C 对「分析」有效，**不能**单独把播放 50% 打下来。  
**下一刀**：你侧重启 `dist_new` 复测播歌 CPU + dual 歌词（row-layers）；按需 `localStorage.mineradio_lyric_row_layers=0` 回退。  
**帧率**：FX「前台帧率上限」说了算；想压占用用户可选手动 30/45。

### P0 / P1 保效果降载（2026-08-13）

- **P0 封面粒子时间复用**（`uTemporalSubset` / `uFrameParity`）：低配默认开；超高满量。`fx.particleTemporalSubset` 可强制。
- **P0 歌词火花**：漂移改 vertex shader。
- **P1 内部分辨率**：eco/低配 DPR×scale；压力升高时 `applyRendererPowerMode` 重算。
- **验收**：`window.__mineradioPerf.temporalSubset === 1`；`mode` 应等于面板选择（vsync 或 `30fps` 等）。

---

### 阶段 3A（用户选定 2026-08-13）：瘦身 WASAPI，不换解码

**目标**：在**不替换** Chromium `<audio>` 解码/取链的前提下，增加可选的 **WASAPI 共享模式输出**（PCM 旁路 → C++ → 声卡），失败自动回退现有出声路径。

**明确不做（留给完整阶段 3 / 阶段 4）**：
- ❌ FFmpeg/mpg123 接管全曲解码
- ❌ WASAPI 独占 / ASIO
- ❌ 强制默认 native 出声（必须设置项开关 + fallback）
- ❌ 重写 Cuefield / 换源 / stall 事务

**建议实施顺序**：
1. `native/mineradio-bpm`（或后续拆 `mineradio-audio`）增加 WASAPI shared sink：`open/write/start/stop/setVolume`
2. Renderer：AudioWorklet/旁路拉 PCM → IPC → main → N-API 写入环形缓冲
3. 开启时把 WebAudio `gain` 置 0，避免双声；关闭/失败立刻恢复 `<audio>` 链路
4. 设置项：`nativeWasapiOutput`（默认 off）

**与「追分」并行策略**：3A 做差异化听感/可控输出；**row-layers 仍是对照作者评分的主缺口**（追平，不是制造独特优势）。

#### 差异化速查（对照作者 / 网易云类平台）

| 维度 | 作者主线 | 我们（酷狗 fork） | 网易云等商业桌面端 |
|------|----------|------------------|-------------------|
| 歌词舞台 | row-layers / 星河深 | 缺 row-layers（追平项）；有 LiquidGlass/着色器市场 | 成熟双语/逐字，但是产品壳 |
| 音源 | 网易等为主 | **酷狗深链路 + 多平台 + DPAPI/登录包** | 自家生态 + DRM |
| 性能 C++ | 少公开 native 分析 | **DJ energy/beatmap C++ + Worklet**（分析侧；**不降播歌 50%**） | 完整播放栈（解码/输出/DRM）多年沉淀 |
| 阶段 3A | 通常无 | **可选 WASAPI 共享旁路**（实验优势） | 原生输出已是标配，不叫「优势」叫「基线」 |
| 3D/视觉 | 壁纸/壳层深 | Sonic / 粒子 / GPU 节流 / 上下兼顾 | 偏 UI，少沉浸 3D |

**一句话**：row-layers 让你**更接近作者**；独特优势在 **酷狗+多源、LiquidGlass/视觉实验、DJ native、Worklet 门控**。跟网易云比 C++，对方是**整条播放工业栈**，我们是**播放器上的分析/可选输出增强**，不要对标「谁 C++ 更多」。
