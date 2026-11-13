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
    /await protocol\.handle\(WALLPAPER_ENGINE_SCHEME,/,
    'installProtocol 必须把请求接到处理器（具体包装由防悬挂守卫锁定）',
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

test('壁纸媒体在窗口隐藏 / Folia 世界必须停解码与镜像上传，并能在恢复时唤醒', () => {
  // 用户提问「隐藏时会不会还吃性能、切 Folia 会不会关闭」——检查结论：
  // 旧实现只在 document.hidden 时暂停；Electron 托盘隐藏/最小化时
  // document.hidden 常为 false（12d 注释也承认），镜像循环也只判 document.hidden，
  // 于是 4K 视频继续解码 + 每帧 createImageBitmap/texImage2D 继续跑。
  // Folia 只暂停了视频，镜像循环没停。
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');
  const stateSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/00-state/12d-fx-runtime-globals.js'), 'utf8');
  const foliaSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');
  const foliaCss = fs.readFileSync(path.join(ROOT, 'public/css/12-folia/folia-world.css'), 'utf8');
  const indexCss = fs.readFileSync(path.join(ROOT, 'public/css/index.css'), 'utf8');

  assert.match(
    fnsSrc,
    /function wallpaperEngineMediaShouldRun\(\)[\s\S]{0,600}isDeepBackgroundMode\(\)[\s\S]{0,300}foliaWorldActive\(\)/,
    '统一判定必须同时覆盖 document.hidden、Electron 原生最小化/隐藏、Folia 世界',
  );
  assert.match(
    fnsSrc,
    /function paint\(\)[\s\S]{0,400}if \(!wallpaperEngineMediaShouldRun\(\)\)[\s\S]{0,300}return;/,
    '镜像绘制循环必须在不该运行时完全跳过 drawImage / createImageBitmap / texImage2D',
  );
  assert.match(
    fnsSrc,
    /function wallpaperEngineGlassMirrorKick\(\)/,
    '必须有主动唤醒入口：后台期间 rAF 会被 Chromium 节流甚至暂停',
  );
  assert.match(
    fnsSrc,
    /function wallpaperEngineSyncMediaRuntime\(\)[\s\S]{0,800}video\.pause\(\)/,
    '统一同步入口必须在不该运行时暂停视频解码',
  );
  const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
  assert.match(mainSrc, /mainWindow\.on\('hide',\s*\(\) => sendWindowState\(mainWindow\)\)/,
    '主进程 hide 事件必须下发窗口状态（渲染层据此判定深度后台）');
  assert.match(mainSrc, /mainWindow\.on\('minimize',\s*\(\) => sendWindowState\(mainWindow\)\)/,
    '主进程 minimize 事件必须下发窗口状态');
  assert.match(stateSrc, /updateDesktopRuntimeState[\s\S]{0,1500}wallpaperEngineSyncMediaRuntime\(\)/,
    '窗口状态变化（minimize/hide/show/restore）必须触发壁纸同步');
  assert.match(foliaSrc, /foliaWorldPauseWallpaperVideos[\s\S]{0,600}wallpaperEngineSyncMediaRuntime\(\)/,
    'Folia 进入时必须同步停止壁纸媒体');
  assert.match(foliaSrc, /foliaWorldResumeWallpaperVideos[\s\S]{0,900}wallpaperEngineSyncMediaRuntime\(\)/,
    'Folia 退出时必须唤醒镜像循环');
  assert.match(foliaCss, /body\.folia-world-active #wallpaper-engine-layer[\s\S]{0,200}visibility:\s*hidden\s*!important/,
    'Folia 激活时壁纸层与镜像画布必须退出合成链');
  assert.match(indexCss, /body\.render-deep-sleep #wallpaper-engine-layer[\s\S]{0,200}visibility:\s*hidden\s*!important/,
    '深度后台时壁纸层与镜像画布必须退出合成链');

  // 直接执行源码里的纯判定函数（不靠正则猜），覆盖全部状态组合
  const fnMatch = fnsSrc.match(/function wallpaperEngineMediaShouldRun\(\)[\s\S]*?\n\}/);
  assert.ok(fnMatch, '必须能抽到 wallpaperEngineMediaShouldRun 函数体');
  const build = (hidden, deep, folia) => new Function(
    'document', 'isDeepBackgroundMode', 'foliaWorldActive',
    fnMatch[0] + '\nreturn wallpaperEngineMediaShouldRun();',
  )({ hidden }, () => deep, () => folia);
  assert.equal(build(true, false, false), false, 'document.hidden 时必须停');
  assert.equal(build(false, true, false), false, '窗口最小化/托盘隐藏时必须停');
  assert.equal(build(false, false, true), false, 'Folia 世界激活时必须停');
  assert.equal(build(false, false, false), true, '前台可见且不在 Folia 时必须运行');
  // 依赖函数抛错时不能把壁纸误停，也不能让异常冒泡到合并 script 顶层
  const throwing = new Function(
    'document', 'isDeepBackgroundMode', 'foliaWorldActive',
    fnMatch[0] + '\nreturn wallpaperEngineMediaShouldRun();',
  )({ hidden: false }, () => { throw new Error('state-not-ready'); }, () => { throw new Error('state-not-ready'); });
  assert.equal(throwing, true, '状态模块尚未就绪而抛错时必须放行（不能静默停掉壁纸）');
});

test('控制台隐藏态必须压过歌单主题的 !important 深色玻璃条', () => {
  // 2026-11-13 实机 CDP.getMatchedStylesForNode 定案：隐藏态下 #bottom-bar
  // 的 class = "lg-host visible lg-active soft-hidden"，但命中规则里
  // playlist.css 的 #bottom-bar.visible{opacity:.94!important +
  // 深色渐变!important + blur brightness(.94)!important} 压过了
  // playback.css 的 #bottom-bar.soft-hidden{opacity:0}（无 !important），
  // 于是隐藏后留下一条黑色玻璃条。修法：shell.css（最后加载）用更高特异性
  // + !important 压回 opacity/背景/滤镜，并用 visibility:hidden 双保险。
  const shellCss = fs.readFileSync(path.join(ROOT, 'public/css/10-shell/shell.css'), 'utf8');
  assert.match(
    shellCss,
    /html #bottom-bar\.visible\.soft-hidden[\s\S]{0,700}background:transparent!important[\s\S]{0,200}backdrop-filter:none!important/,
    '隐藏态必须清掉深色渐变背景与 backdrop-filter（黑玻璃条来源）',
  );
  assert.match(
    shellCss,
    /#bottom-bar\.visible\.soft-hidden > \.lg-glass-shell[\s\S]{0,160}display:none!important/,
    '只隐藏 LiquidGlass 玻璃画布，不能把整个底栏藏掉',
  );
  assert.match(
    shellCss,
    /#bottom-bar\.visible\.soft-hidden #progress-bar[\s\S]{0,200}background:rgba\(255,255,255,\.22\)!important/,
    '隐藏态必须保留并增强 #progress-bar：那是隐藏后唯一的歌曲进度提示',
  );
  assert.doesNotMatch(
    shellCss,
    /#bottom-bar\.visible\.soft-hidden[\s\S]{0,700}visibility:hidden!important/,
    '不许再用 visibility:hidden 把整条底栏藏掉——会连进度一起藏掉（用户实测反驳）',
  );
  assert.match(
    shellCss,
    /html body\.home-controls-locked #bottom-bar\.visible/,
    'home-controls-locked 路径也要覆盖（showHome 走这条）',
  );

  // 把手必须保持原本的单色小横条：用户实测「控制台进度条上边怎么还有个
  // 小进度条，本来是小横条的」—— 之前把把手做成双色进度条 + 无条件 opacity:.5
  // 会在控制台升起时叠出第二根进度条。隐藏态进度由 #progress-bar 承担即可。
  const seekSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-lyrics/04-progress-seek.js'), 'utf8');
  assert.doesNotMatch(
    seekSrc,
    /--play-progress/,
    'setProgressVisual 不许再往 #bottom-handle 写进度（把手恢复单色小横条）',
  );
  assert.doesNotMatch(
    shellCss,
    /#bottom-handle\{opacity:\.5\}/,
    '不许无条件提高把手 opacity：controls-visible 时应由 playback.css 隐藏它',
  );
  assert.doesNotMatch(
    shellCss,
    /#bottom-handle span\{[\s\S]{0,300}--play-progress/,
    '把手 span 不许再画成第二条进度条',
  );

  // 镜像挂在 body 层后必须自己带窗口圆角（用户实测：WE 壁纸让四周变方）
  assert.match(
    shellCss,
    /body\.desktop-shell #wallpaper-engine-glass-mirror\{border-radius:34px\}/,
    '镜像 canvas 必须跟 #wallpaper-engine-layer 一样带 34px 圆角',
  );
  assert.match(
    shellCss,
    /body\.desktop-shell\.desktop-maximized #wallpaper-engine-glass-mirror[\s\S]{0,300}border-radius:0!important/,
    '最大化/全屏/壁纸模式时圆角必须归零（与壁纸层同一套变体）',
  );
});

test('协议处理器绝不能悬挂：disposed / 异常 / 超时都要立即给响应', () => {
  // 启动自动恢复壁纸会发 mineradio-wallpaper:// 请求；若此时协议处理器抛错或
  // 挂起，页面 did-finish-load 等不到 → 15s 后 MR-BOOT-WINDOW-LOAD 报错弹窗
  // （2026-11-13 用户连续两次启动失败，startup-error.log 里 did-fail-load:-3
  //  + "Wallpaper Engine library is closed" 即此链路）
  assert.match(
    librarySrc,
    /mediaResponse\(request\)[\s\S]{0,300}if \(this\.disposed\) return new Response\('Not found'/,
    'mediaResponse 必须先判 disposed 并返回 404，不能让已释放的库继续处理',
  );
  assert.match(
    librarySrc,
    /installProtocol\(protocol\)[\s\S]{0,900}setTimeout\(\(\) => resolve\(notFound\(504\)\), 8000\)/,
    'installProtocol 必须有 8 秒超时兜底（小于 15s 的 loadURL 超时）',
  );
  assert.match(
    librarySrc,
    /mediaResponse\(request\)\.catch\(\(\) => notFound\(500\)\)/,
    'mediaResponse 的任何异常必须转成 500 响应，不能抛给 protocol.handle',
  );
});

test('壁纸方向：WebGL 着色器必须翻转 UV 的 Y（ImageData 顶行在 v=0）', () => {
  // 2026-11-13 用户实测壁纸上下颠倒：ImageData 顶行上传到 v=0，
  // 而屏幕上沿对应 aPos.y=+1，直接用 aPos*0.5+0.5 会把视频顶行画到屏幕底
  const fnsSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');
  assert.match(
    fnsSrc,
    /vUv=vec2\(aPos\.x\*0\.5\+0\.5,0\.5-aPos\.y\*0\.5\)/,
    '顶点着色器必须翻转 Y：屏幕顶采样视频顶行',
  );
});

test('空闲主页预览不得在 WE 壁纸激活时接管背景', () => {
  // 控制台隐藏 → showHome → activateHomeWallpaperPreview 无条件直调，
  // 粒子画布(z=2)盖住壁纸层(z=0) → 全屏发黑（用户 2026-11-13 实测）
  const homeSrc = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/04-home-empty-wallpaper.js'), 'utf8');
  assert.match(
    homeSrc,
    /function activateHomeWallpaperPreview[\s\S]{0,300}wallpaper-engine-active[\s\S]{0,120}return/,
    'activateHomeWallpaperPreview 必须在咽喉处挡住 WE 激活态（showHome 会绕过条件直调）',
  );
  assert.match(
    homeSrc,
    /function shouldUseIdleWallpaperPreview[\s\S]{0,500}wallpaper-engine-active[\s\S]{0,120}return false/,
    'shouldUseIdleWallpaperPreview 也必须有同样守卫',
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
    /createImageBitmap\(m\.mid\)[\s\S]{0,600}bitmap\.close\(\)/,
    '主路径必须 createImageBitmap(GPU 拷贝) 且用完 close()：'
    + 'getImageData 每帧数 MB 垃圾会把渲染进程压到 OOM（2026-11-13 实测崩溃），'
    + '而 texImage2D 直传视频元素的 GPU 纹理回读不了',
  );
  assert.match(
    fnsSrc,
    /uploadPending/,
    '必须有 uploadPending 防排队堆积（上传是异步的）',
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
