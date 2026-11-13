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

  // 镜像必须挂在 body 层：J2/K 实验（2026-11-13）证明壁纸层内部的镜像
  // 无法被普通 backdrop-filter 玻璃回读，body 直挂的同一画布可以
  const layerBlock = indexSrc.match(/<div id="wallpaper-engine-layer"[\s\S]*?<\/div>/);
  assert.ok(layerBlock, 'index.html 必须有壁纸层');
  assert.doesNotMatch(layerBlock[0], /glass-mirror/, '镜像 canvas 必须移出壁纸层（body 直挂）');
  assert.match(shellCss, /body\.wallpaper-engine-video-ready #wallpaper-engine-glass-mirror/,
    '镜像显示开关必须走 body 级 class（canvas 已不在层内，层选择器够不着）');
});

test('镜像 canvas 不得被污染：媒体必须 CORS 模式加载且协议响应带 ACAO', () => {
  // 第三层坑（2026-11-13 真机复现：叠加层关了、镜像画了，玻璃仍黑）：
  // mineradio-wallpaper:// 响应没有 Access-Control-Allow-Origin，<video> 非 CORS
  // 模式加载 → drawImage 把镜像 canvas 污染（getImageData 抛 SecurityError）。
  // 两处必须同时成立，缺一视频直接加载失败。
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');

  const crossOriginIdx = fnsSrc.indexOf("video.crossOrigin = 'anonymous'");
  const srcIdx = fnsSrc.indexOf('video.src = wallpaperEngineMediaUrl(item, \'media\')');
  assert.ok(crossOriginIdx > -1, '必须设置 video.crossOrigin = \'anonymous\'（CORS 模式加载）');
  assert.ok(srcIdx > -1, '必须存在 video.src 赋值');
  assert.ok(crossOriginIdx < srcIdx,
    'crossOrigin 必须在 video.src 赋值之前设置：src 设置后改 crossOrigin 不会重新协商 CORS');

  assert.match(
    librarySrc,
    /'Access-Control-Allow-Origin': '\*'/,
    'mediaResponse 成功响应必须带 Access-Control-Allow-Origin：*，'
    + '否则 crossOrigin=anonymous 的媒体加载直接失败',
  );
});

test('视频必须退居解码角色：镜像激活时 display:none，回读链里不许有视频层', () => {
  // 第四层坑（2026-11-13 真机实验定案）：只要 backdrop-filter 的采样链里有
  // <video> 层（哪怕 visibility:hidden），整块回读就是黑的；把视频
  // display:none、只留干净 2D canvas，玻璃立刻透出画面（红 canvas 对照实验）。
  // 因此镜像激活期间视频必须 display:none，由 rAF 驱动画帧。
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');

  assert.match(
    fnsSrc,
    /video\.style\.display = 'none'/,
    'wallpaperEngineGlassMirrorStart 必须把视频 display:none 移出渲染树',
  );
  assert.match(
    fnsSrc,
    /wallpaperEngineGlassMirrorStop[\s\S]{0,600}video\.style\.display = ''/,
    '镜像停止时必须恢复视频 display，避免普通播放路径拿不到视频',
  );
  assert.match(
    fnsSrc,
    /display:none 时 rVFC 不会触发，用 rAF/,
    '画帧循环必须走 rAF：display:none 的视频不触发 rVFC，用 rVFC 驱动会卡在首帧',
  );
});

test('镜像必须是 WebGL + CPU 像素拷贝：视频帧直传与重绘 2D canvas 都无法被玻璃回读', () => {
  // 第五层坑（2026-11-13 实机实验矩阵定案）：backdrop-filter 回读对
  // 「每帧重绘的 2D canvas」返回黑（GPU 与 willReadFrequently CPU 均如此），
  // 对「texImage2D 直接上传视频元素」也返回黑（视频帧 GPU 资源回读不了）；
  // 静态 2D canvas 与「CPU 拷贝像素（drawImage→getImageData→9 参 texImage2D）」
  // 均正常 —— 粒子背景一直正常正是因为它是 WebGL。所以镜像必须走
  // WebGL + 离屏 2D 中转的 CPU 像素上传；WebGL 不可用时回退 2D（壁纸可见优先）。
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');

  assert.match(
    fnsSrc,
    /getContext\('webgl',\s*\{[\s\S]*?preserveDrawingBuffer:\s*true/,
    '镜像必须优先取 WebGL 上下文（preserveDrawingBuffer:true 保障回读稳定）',
  );
  assert.match(
    fnsSrc,
    /willReadFrequently:\s*true/,
    '中转画布必须 willReadFrequently（每帧 getImageData）',
  );
  assert.match(
    fnsSrc,
    /m\.gl\.texImage2D\(m\.gl\.TEXTURE_2D, 0, m\.gl\.RGBA, canvas\.width, canvas\.height, 0,/,
    '必须用 9 参形式从 CPU 像素上传（6 参视频元素直传的纹理回读不了）',
  );
  assert.match(
    fnsSrc,
    /m\.ctx2d = canvas\.getContext\('2d'\)/,
    'WebGL 不可用时必须回退 2D 绘制（壁纸可见优先于玻璃可采样）',
  );

  // body 级显示开关（镜像挂在 body 层后的接线）
  assert.match(
    fnsSrc,
    /wallpaperEngineGlassMirrorStart[\s\S]{0,600}classList\.add\('wallpaper-engine-video-ready'\)/,
    'Start 必须先开 body 级显示开关再读 rect，否则拿到 0×0 会把背存缩到 2×2',
  );
  assert.match(
    fnsSrc,
    /wallpaperEngineGlassMirrorStop[\s\S]{0,600}classList\.remove\('wallpaper-engine-video-ready'\)/,
    'Stop 必须撤掉 body 级显示开关',
  );

  // LiquidGlass 面板玻璃不走 backdrop-filter：主循环合成名单必须包含 WE 镜像
  const mainLoopSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/11-main-loop.js'), 'utf8');
  assert.match(
    mainLoopSrc,
    /wallpaper-engine-active[\s\S]{0,200}wallpaper-engine-video-ready[\s\S]{0,300}wallpaper-engine-glass-mirror/,
    'updateLiquidGlassBackdropMirror 必须把 WE 玻璃镜像纳入采样源：'
    + '面板玻璃只认 __lgBackdropCanvas 合成名单（custom-bg-video 在名单里、WE 不在），'
    + '缺源就是「手动导入正常、页面点选的 WE 壁纸全黑」的根因',
  );
});
