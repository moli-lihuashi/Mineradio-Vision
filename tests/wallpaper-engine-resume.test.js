'use strict';

/*
 * WE 壁纸续播守卫（2026-11-23）
 *
 * 现象：从 Folia 世界反复返回 home 后，内置（Wallpaper Engine）壁纸被抓掉，
 * 画面变成舞台歌词，重启应用才恢复。
 *
 * 两条恢复链都要守住：
 *   1) `wallpaperEngineSyncMediaRuntime()` 面对已经解码完成的暂停视频，
 *      应直接续播；快速可见性 / 世界切换时不必重复进入完整播放请求与重试链。
 *      完整请求本身不会重设 src 或递增 layerToken，不做错误归因。
 *   2) `foliaWorldPauseWallpaperVideos()` 用「当前是否在播」记录快照；
 *      同一次暂停重入会把快照覆盖成 false，退出世界时不再 resume。
 *
 * 真根因（2026-11-23 实机高速连点复现）：反复快速点 Home 时 Chromium 回收
 * WE 玻璃镜像的 WebGL 上下文（实测第 11 次 `glLost=true`）。paint 还在排帧，
 * 但 drawArrays 全部无效——画布凝固成黑帧，看起来就是「壁纸被杀掉、露出黑底
 * + 舞台歌词」。所以必须守住上下文丢失恢复链：
 *   a) lost 必须 preventDefault（否则 Chromium 不会派发 restored）；
 *   b) restored 必须整条重建镜像管线；
 *   c) paint 必须轮询 isContextLost，restored 不来时超时兜底重建。
 * 另守一条：性能降级恢复（applyRecover）也要 kick 镜像，作为次级恢复路径。
 *
 * 恢复链只能「自愈」不能「无感」（无冷却下 15ms 连点仍黑屏 23 轮、最长 16 轮）。
 * 真正消除用户可见黑屏的手段是给 Home 切换加冷却：快速连点不再触发
 * 压力阈值。冷却 + 恢复链两者配合才是完整防线，所以冷却也要守住。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const WE = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/02-wallpaper-engine-fns.js'), 'utf8');
const FOLIA = fs.readFileSync(path.join(ROOT, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');
const PERF = fs.readFileSync(path.join(ROOT, 'public/js/modules/06-fx/03-liquidglass-perf.js'), 'utf8');
const HOME = fs.readFileSync(path.join(ROOT, 'public/js/modules/05-playback/05-home-actions.js'), 'utf8');

test('Home 切换必须有冷却，防止快速连点压垮 WE 镜像上下文', () => {
  const start = HOME.indexOf('function goHome()');
  assert.ok(start > 0, '必须存在 goHome');
  const body = HOME.slice(start, start + 900);
  assert.match(body, /homeToggleCooldownUntil/, '必须有冷却时间戳');
  assert.match(HOME, /HOME_TOGGLE_COOLDOWN_MS\s*=\s*400/, '冷却必须是实测最优的 400ms');
  // 冷却期内必须直接忽略点击：只降级 forceLoad 不够，Home 仍会反复进出、
  // body class 与合成层照样抖动，压力降不下来。
  assert.match(body, /now\s*<\s*homeToggleCooldownUntil\)[\s\S]{0,200}return/, '冷却期内必须直接 return 忽略');
  // 冷却不能拦首次点击（初始 now 一定 >= 0）
  assert.match(HOME, /var homeToggleCooldownUntil\s*=\s*0/, '初始冷却时间戳必须是 0，首次点击不拦');
});

test('WE 续播：已有可解码媒体时直接 play，不重设 src', () => {
  const start = WE.indexOf('function wallpaperEngineSyncMediaRuntime()');
  assert.ok(start > 0, '必须存在 wallpaperEngineSyncMediaRuntime');
  const body = WE.slice(start, start + 2200);
  assert.match(body, /var hasReadyMedia = !!\(video\.getAttribute\('src'\) && video\.readyState >= 2\)/, '必须先判断媒体是否可续播');
  assert.match(body, /hasReadyMedia[\s\S]{0,300}video\.play\(\)/, '可续播时直接 play');
  assert.match(body, /resumePromise\.catch|try \{[\s\S]{0,200}catch \(_\)/, '续播失败必须回退到完整请求');
});

test('Folia 暂停快照必须幂等，重复调用不得覆盖首次记录', () => {
  const start = FOLIA.indexOf('function foliaWorldPauseWallpaperVideos()');
  assert.ok(start > 0, '必须存在 foliaWorldPauseWallpaperVideos');
  const body = FOLIA.slice(start, start + 900);
  assert.match(body, /if \(!foliaWorldVideosPauseHeld\)/, '必须有「只记录一次」的守卫');
  assert.match(body, /foliaWorldVideosPauseHeld = true/, '首次暂停后必须置位');
  assert.ok(
    body.indexOf('foliaWorldVideosPauseHeld') < body.indexOf('foliaWorldVideoPauseState.custom ='),
    '守卫必须在写快照之前',
  );
});

test('退出世界必须重置暂停快照标志', () => {
  const start = FOLIA.indexOf('function foliaWorldResumeWallpaperVideos()');
  assert.ok(start > 0, '必须存在 foliaWorldResumeWallpaperVideos');
  const body = FOLIA.slice(start, start + 700);
  assert.match(body, /foliaWorldVideosPauseHeld = false/, 'resume 必须清标志，否则下次进入世界不再记录');
});

test('暂停快照状态是模块级单例（不能挂在函数上）', () => {
  assert.match(FOLIA, /var foliaWorldVideoPauseState = \{ custom: false, engine: false \};/);
  assert.match(FOLIA, /var foliaWorldVideosPauseHeld = false;/);
});

test('WE 镜像 kick 必须暴露到 window（供降级恢复与探针触发）', () => {
  assert.match(WE, /window\.wallpaperEngineGlassMirrorKick\s*=\s*wallpaperEngineGlassMirrorKick/, '必须挂到 window');
});

test('LiquidGlass 性能降级恢复必须唤醒 WE 镜像', () => {
  // applyRecover 里必须调用 wallpaperEngineGlassMirrorKick，否则黑帧凝固到重启
  const start = PERF.indexOf('function applyRecover()');
  assert.ok(start > 0, '必须存在 applyRecover');
  const body = PERF.slice(start, start + 1400);
  assert.match(body, /wallpaperEngineGlassMirrorKick/, '恢复时必须 kick WE 镜像');
  // kick 必须放在重新启动实例渲染循环之后（先让玻璃恢复，再补镜像帧）
  assert.ok(
    body.indexOf('wallpaperEngineGlassMirrorKick') > body.indexOf('ensureInstanceRunning'),
    'kick 必须在实例恢复之后',
  );
});

test('WE 镜像必须监听 WebGL 上下文丢失并恢复', () => {
  const start = WE.indexOf('function wallpaperEngineGlassMirrorStart(');
  assert.ok(start > 0, '必须存在 wallpaperEngineGlassMirrorStart');
  const body = WE.slice(start, start + 6000);
  assert.match(body, /addEventListener\('webglcontextlost'[\s\S]{0,300}preventDefault/, 'lost 必须 preventDefault');
  assert.match(body, /addEventListener\('webglcontextrestored'[\s\S]{0,300}rebuildPending\s*=\s*true/, 'restored 必须标记待重建（避免连点期同步重建被打断）');
  assert.match(body, /isContextLost\(\)/, 'paint 必须轮询上下文状态');
  assert.match(body, /rebuildBackoff/, '退避重建必须有指数退避，避免丢→建→丢循环');
  assert.match(body, /rebuildPending/, 'paint 必须消费 pending 标记并真正重建');
});

test('第三环：镜像必须维护最后有效帧快照，供上下文丢失时兜底', () => {
  // paint 每次画视频帧后同步到静态 2D 快照 canvas（静态 2D 可被玻璃回读）
  assert.match(WE, /m\.snapshot/, '必须有快照字段');
  assert.match(WE, /m\.snapshotCtx\.drawImage\(m\.mid/, '必须把中转画布帧同步到快照');
  // 暴露快照与丢失判断给主循环
  assert.match(WE, /window\.wallpaperEngineGlassMirrorSnapshot/, '必须暴露快照 getter');
  assert.match(WE, /window\.wallpaperEngineGlassMirrorLost/, '必须暴露上下文丢失判断');
});

test('镜像本身就是可见壁纸层：上下文丢失时必须把真视频顶上去，恢复后藏回', () => {
  // #wallpaper-engine-glass-mirror 是可见的全屏壁纸（视频一直 display:none）。
  // 它一丢上下文整屏就黑，必须临时显示 video 接管；画出新帧后必须藏回，
  // 否则视频留在渲染树会污染玻璃回读链。
  assert.match(WE, /function wallpaperEngineGlassMirrorSetVideoFallback/, '必须有视频兜底开关');
  const lostStart = WE.indexOf("addEventListener('webglcontextlost'");
  assert.ok(lostStart > 0, '必须存在 lost 监听');
  assert.match(
    WE.slice(lostStart, lostStart + 600),
    /wallpaperEngineGlassMirrorSetVideoFallback\(true\)/,
    'lost 时必须显示视频接管背景',
  );
  assert.match(WE, /drawArrays[\s\S]{0,240}wallpaperEngineGlassMirrorNoteStableFrame\(\)/, '画出新帧后必须走稳定帧判定再撤视频');
  assert.match(WE, /stableFrames\s*>=\s*5|stableFrames\s*>\s*4/, '必须连续稳定 5 帧才撤视频兜底');
  // WebGL 重建失败时不能提前 return：那会跳过 paint 定义，整个镜像循环停摆
  const glFailStart = WE.indexOf('var retry = wallpaperEngineGlassMirrorRebuildCanvas()');
  assert.ok(glFailStart > 0, '必须存在 webgl 重建重试');
  const glFailBody = WE.slice(glFailStart, glFailStart + 700);
  assert.ok(!/m\.mode\s*=\s*'webgl';\s*return;/.test(glFailBody), '重建失败不能提前 return（会停掉 paint 循环）');
});

test('主循环必须三态采样 WE 源：正常镜像 → 丢失时快照 → 无镜像时静态图', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'public/js/modules/11-main-loop.js'), 'utf8');
  const start = MAIN.indexOf('var weMirrorReady');
  assert.ok(start > 0, '必须存在 WE 镜像采样段');
  const body = MAIN.slice(start, start + 1800);
  assert.match(body, /wallpaperEngineGlassMirrorLost\(\)/, '必须先判断上下文是否丢失');
  assert.match(body, /wallpaperEngineGlassMirrorSnapshot\(\)/, '丢失时必须退回采样快照');
  // 三态顺序：正常采镜像 → 丢失采快照 → 都不行才走图片分支
  assert.ok(
    body.indexOf('drawImage(weMirror') < body.indexOf('wallpaperEngineGlassMirrorSnapshot()'),
    '正常镜像优先于快照',
  );
});
