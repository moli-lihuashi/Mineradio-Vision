'use strict';

/* =============================================================================
 * Wallpaper Engine 媒体协议守卫
 *
 * 真实缺陷（2026-11-13 用户实测「壁纸媒体不可用，已恢复原背景」）：
 *   registerWallpaperEngineScheme() 只把 mineradio-wallpaper 注册成特权 scheme，
 *   真正的 protocol.handle() 在 WallpaperEngineLibrary.installProtocol() 里，
 *   而 main.js 只给本地音乐库调了 installProtocol，WE 的从来没调 ——
 *   结果网格缩略图全黑、视频与预览全部加载失败，最后弹「壁纸媒体不可用」。
 *
 * 另一处：wallpaper-engine-* IPC 里 runtime 探针写的是
 *   wallpaperEngineRuntime ? probe : { available:false }
 * 而 runtime 是懒加载单例，面板先开就永远是 { available:false }，
 * 明明本机装着签名有效的 Wallpaper Engine，横幅却写「未找到可用的本体」。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
const librarySrc = fs.readFileSync(path.join(ROOT, 'desktop/wallpaper-engine-library.js'), 'utf8');

test('mineradio-wallpaper 协议必须在 whenReady 里挂上处理器', () => {
  assert.match(
    mainSrc,
    /ensureWallpaperEngineLibrary\(\)\.installProtocol\(protocol\)/,
    'main.js 必须调用 ensureWallpaperEngineLibrary().installProtocol(protocol)：'
    + '只 registerSchemesAsPrivileged 不挂 handler，所有 mineradio-wallpaper:// 请求都会失败',
  );
  assert.match(
    librarySrc,
    /await protocol\.handle\(WALLPAPER_ENGINE_SCHEME,\s*\(request\) => this\.mediaResponse\(request\)\)/,
    'installProtocol 必须把请求接到 mediaResponse',
  );
  // 注册特权 scheme 必须发生在 main.js 顶层（app ready 之前才有效）
  assert.match(
    mainSrc,
    /^registerWallpaperEngineScheme\(protocol\);/m,
    'registerWallpaperEngineScheme 必须在模块顶层调用（app ready 之前）',
  );
});

test('runtime 探针不许走「未初始化就报不可用」的假阴性路径', () => {
  assert.doesNotMatch(
    mainSrc,
    /wallpaperEngineRuntime \? await wallpaperEngineRuntime\.probe/,
    'runtime 是懒加载单例：直接读变量在面板先开时永远是 null，'
    + '会谎报「未找到可用的 Wallpaper Engine 本体」。必须走 ensureWallpaperEngineRuntime()',
  );
  assert.match(
    mainSrc,
    /await ensureWallpaperEngineRuntime\(\)\.probe\(/,
    '探针必须通过 ensureWallpaperEngineRuntime() 拿实例',
  );
});

test('壁纸视频不得走硬件叠加层，否则 LiquidGlass 的背景回读是黑的', () => {
  // Chromium 会把 <video> 提升为 DirectComposition video overlay，而
  // backdrop-filter 的背景回读拿不到叠加层里的帧 —— 玻璃折射壁纸视频时
  // 透出来是黑的（只剩置换图环纹）。必须显式关掉视频叠加层。
  assert.match(
    mainSrc,
    /'disable-direct-composition-video-overlays'/,
    'main.js 必须带 disable-direct-composition-video-overlays：'
    + '否则玻璃采样不到壁纸视频帧，折射区一片黑',
  );
  assert.match(
    mainSrc,
    /'disable-hardware-overlays'/,
    'main.js 必须带 disable-hardware-overlays 兜底：确保视频回落到普通合成路径',
  );
});

test('媒体视频必须有玻璃镜像 canvas，且壁纸层不得被隔进独立合成面', () => {
  // 叠加层开关之外还有两层坑（2026-11-13 实测：加了开关玻璃仍黑）：
  // 1) backdrop-filter 的回读本来就跳过 <video> 的帧 —— 必须把每帧画进
  //    同位 canvas（普通合成纹理）供玻璃采样；
  // 2) #wallpaper-engine-layer 上的 isolation / contain:paint / clip-path
  //    会把整层隔进独立合成面，回读同样拿不到 —— 一律不许出现。
  const indexSrc = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const shellCss = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/shell.css'), 'utf8');
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');

  assert.match(indexSrc, /<canvas id="wallpaper-engine-glass-mirror"/, 'index.html 必须有镜像 canvas');
  assert.match(fnsSrc, /wallpaperEngineGlassMirrorStart\(video, token\)/, '视频首帧就绪时必须启动镜像');
  assert.match(fnsSrc, /wallpaperEngineGlassMirrorStop\(\)/, '清理层媒体时必须停掉镜像，避免空烧 rVFC/rAF');

  const layerRule = shellCss.match(/#wallpaper-engine-layer\{[^}]*\}/);
  assert.ok(layerRule, 'shell.css 必须有 #wallpaper-engine-layer 规则');
  assert.doesNotMatch(layerRule[0], /isolation|contain:strict|contain:paint|clip-path/,
    '壁纸层不许带 isolation / contain:paint / clip-path：它们会把整层隔进独立合成面，'
    + 'backdrop-filter 回读不到，玻璃折射区全黑');

  const mirrorRule = shellCss.match(/#wallpaper-engine-glass-mirror\{[^}]*\}/);
  assert.ok(mirrorRule, 'shell.css 必须有镜像 canvas 规则');
  assert.doesNotMatch(mirrorRule[0], /clip-path/, '镜像 canvas 自己也不许带 clip-path（同理会被回读跳过）');
});
