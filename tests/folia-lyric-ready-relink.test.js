'use strict';

// Folia 歌词晚到 → 模组重挂守卫（2026-11-21）
//
// 症状：打开播放器时 Folia 世界里没有歌词，切一下样式/世界就恢复。
// 根因：模组只在 mount 时读一次 ctx.lines（花笺的 director.attach({lines}) 是快照），
//       启动时世界比歌词先就绪 → 模组带着空歌词挂上去 → 之后歌词到了也读不到。
// 这里钉住三件事：
//   1. foliaWorldLines() 返回稳定数组（原地刷新），模组手里的引用能一直读到最新内容；
//   2. 宿主把歌词表版本 linesRev 下发给模组（换歌/歌词到达都能触发 onChange）；
//   3. 模组实例首帧没有歌词、之后有了 → 静默重建一次（只一次，不能循环）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const state = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/00-folia-state.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/17-folia-mod-host.js'), 'utf8');

test('歌词表是稳定数组：原地刷新，不换引用', () => {
  const fn = state.slice(state.indexOf('function foliaWorldLines()'), state.indexOf('/* ---- 时钟'));
  assert.ok(fn.length > 200, '没找到 foliaWorldLines');
  assert.match(fn, /stable\.length = 0/, '没有原地清空稳定数组：重算会换新数组，模组手里的引用会停在挂载那一刻');
  assert.match(fn, /stable\.push\(out\[i\]\)/, '没有把新歌词写回稳定数组');
  assert.match(fn, /return stable/, '返回的不是稳定数组');
  assert.doesNotMatch(fn, /foliaWorldLineCache = \{ ref: src/, '又换成了新缓存对象（引用会变）');
  assert.match(state, /var foliaWorldLineCache = \{ ref: null, len: 0, lines: \[\], rev: 0 \}/, '缓存里缺少 rev');
});

test('ctx 下发 linesRev，宿主按版本号通知 onChange', () => {
  assert.match(runtime, /linesRev: \(typeof foliaWorldLineCache/, 'ctx 没有 linesRev');
  const drive = host.slice(host.indexOf('function foliaModDriveInstance'), host.indexOf('function foliaModRegisterSettingsPanel'));
  assert.match(drive, /live\.linesRev/, '驱动层没读 linesRev');
  assert.match(drive, /linesRev !== inst\.lastLinesRev/, 'linesRev 没参与变更判定：换歌同长度时不会通知');
  assert.match(drive, /inst\.lastLinesRev = linesRev/, '没有记住 lastLinesRev');
});

test('挂载时没歌词 → 歌词到了静默重挂一次', () => {
  assert.match(host, /mountLines: \(foliaCtx && foliaCtx\.lines\) \? foliaCtx\.lines\.length : 0/,
    '没有在 create 时记录挂载行数（等首帧 tick 记会漏掉开屏期间歌词已到的情况）');
  assert.match(host, /relinkDone: false/, '实例上没有「只重挂一次」的标记');
  const tick = host.slice(host.indexOf('tick: function (inst, foliaCtx)'), host.indexOf('destroy: function (inst)'));
  assert.match(tick, /inst\.mountLines > 0/, '没有识别「挂载时已有歌词 → 不用重挂」');
  assert.match(tick, /lineCount > 0/, '没有识别「现在有歌词了」');
  assert.match(tick, /foliaWorldRelinkCurrentMode\(/, '没有触发重挂');
  assert.match(tick, /inst\.relinkDone = true;[\s\S]{0,120}?return;/, '重挂后没有结束本帧（还会往旧实例跑回调）');
  assert.match(tick, /lastRelinkTryAt/, '重建失败时没有节流：会每帧重试');
});

test('重挂走 createInstance（旧帧垫底、不闪），异步创建中不叠加', () => {
  const relink = runtime.slice(runtime.indexOf('function foliaWorldRelinkCurrentMode'), runtime.indexOf('function foliaWorldEnter'));
  assert.ok(relink.length > 100, '没找到 foliaWorldRelinkCurrentMode');
  assert.match(relink, /!foliaWorld\.active \|\| !foliaWorld\.instance/, '世界没开却去重建');
  assert.match(relink, /__pending/, '异步创建还没落地时会叠一层新实例');
  assert.match(relink, /foliaWorldCreateInstance\(\)/, '没有复用 createInstance（拿不到旧帧垫底）');
});

test('模组样式未注册时读档不能把存档写回 classic', () => {
  assert.match(state, /pendingMode: ''/, 'foliaWorld 没有 pendingMode');
  assert.match(state, /foliaWorld\.pendingMode = foliaWorld\.mode/, '读档校正时没记下原 id');
  assert.match(state, /mode: foliaWorld\.pendingMode \|\| foliaWorld\.mode \|\| 'classic'/, '落盘没用 pendingMode：启动时一次 enter 就会把花笺抹成流光');
  assert.match(state, /function clearFoliaWorldPendingMode/, '缺少清 pending 的入口');
  assert.match(runtime, /clearFoliaWorldPendingMode\(\)/, 'foliaWorldSetMode 没清 pending');
  assert.match(host, /foliaWorld\.pendingMode === want/, '已移除样式的收尾没清理 pending（会永远留着坏 id）');
});
