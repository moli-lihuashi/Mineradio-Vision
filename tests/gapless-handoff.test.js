'use strict';

/* =============================================================================
 * 独立「无缝衔接」Gapless Handoff 回归测试
 *
 * 用户诉求：Cuefield AutoMix 是 DJ 式提前混音（歌还在唱下一首就叠进来），
 * 不要改它，另起一套酷狗式「预载 + 曲末交接、全程不重叠」的功能。
 *
 * 这里把 16-gapless-handoff.js 整份真实源码放进 vm 沙箱跑，用可控的
 * Audio / localStorage / provider 桩验证行为，不是重写一遍逻辑。
 * 同时守住两条边界：
 *   - 05-cuefield/* 一行不改；
 *   - 上一轮修好的暂停/播放淡入淡出 + 曲末淡出不回归。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const modulePath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '16-gapless-handoff.js');
const startPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js');
const loaderPath = path.join(appRoot, 'public', 'js', 'index-loader.js');
const htmlPath = path.join(appRoot, 'public', 'index.html');
const graphPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '08-audio-graph-controls.js');
const seekPath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '04-progress-seek.js');
const cuefieldDir = path.join(appRoot, 'public', 'js', 'modules', '05-cuefield');

const moduleSource = fs.readFileSync(modulePath, 'utf8');
const startSource = fs.readFileSync(startPath, 'utf8');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const graphSource = fs.readFileSync(graphPath, 'utf8');
const seekSource = fs.readFileSync(seekPath, 'utf8');

const TRACK_A = { id: 'A', name: '当前曲' };
const TRACK_B = { id: 'B', name: '下一首' };
const PRELOAD_URL = 'https://cdn.example/next.mp3';

function createSandbox(overrides) {
  const o = overrides || {};
  const store = Object.assign({}, o.storage || {});
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  };
  function makeMedia(initial) {
    const m = Object.assign({
      duration: 200, currentTime: 190, paused: false, ended: false,
      muted: false, volume: 1, src: '', preload: '', crossOrigin: '',
      loadCount: 0, playCount: 0, _listeners: Object.create(null),
      load() { this.loadCount++; },
      play() { this.playCount++; this.paused = false; return Promise.resolve(); },
      addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
      removeEventListener(name, fn) {
        const arr = this._listeners[name] || [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      fire(name) { (this._listeners[name] || []).slice().forEach((fn) => fn()); }
    }, initial || {});
    return m;
  }
  const mainMedia = o.mainMedia || makeMedia();
  const warmMedias = [];
  function AudioCtor() {
    const m = makeMedia({ duration: 0, currentTime: 0, paused: true });
    warmMedias.push(m);
    return m;
  }
  const resolverCalls = [];
  // 包一层统一计数：自定义 resolver（失败 / 悬挂场景）也要能被断言到
  const resolver = function (song) {
    resolverCalls.push(song);
    return o.resolver
      ? o.resolver(song)
      : Promise.resolve({ url: PRELOAD_URL, level: 'standard' });
  };
  const uiButton = {
    attrs: Object.create(null),
    classList: { toggle(name, on) { this['_' + name] = !!on; } },
    setAttribute(k, v) { this.attrs[k] = v; }
  };
  const uiLabel = { textContent: '' };
  const document = {
    getElementById(id) {
      if (id === 'quick-menu-gapless-toggle') return o.noUi ? null : uiButton;
      if (id === 'quick-menu-gapless-status') return o.noUi ? null : uiLabel;
      return null;
    }
  };
  const toasts = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage,
    document,
    window: {},
    Audio: AudioCtor,
    Mineradio: {
      api: {
        apiMediaProxyUrlAsync(route, params) {
          return Promise.resolve(route + '?url=' + encodeURIComponent(params.url));
        }
      }
    },
    audio: mainMedia,
    playQueue: o.playQueue || [TRACK_A, TRACK_B],
    currentIdx: o.currentIdx == null ? 0 : o.currentIdx,
    playMode: o.playMode || 'list',
    trackSwitchToken: o.trackSwitchToken == null ? 7 : o.trackSwitchToken,
    sleepTimer: o.sleepTimer || { pendingStop: false },
    cuefieldAutoMixEnabled: !!o.cuefieldAutoMixEnabled,
    cuefieldAutoMixExecuting: !!o.cuefieldAutoMixExecuting,
    resolveProviderPlayUrlData: resolver,
    queueItemKey(song) { return song ? 'song:' + song.id : ''; },
    showToast(msg) { toasts.push(String(msg)); },
    setInterval(fn) { sandbox.__tick = fn; return 1; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {}
  };
  vm.runInNewContext(moduleSource, sandbox, { filename: '16-gapless-handoff.js' });
  return {
    sandbox,
    store,
    mainMedia,
    warmMedias,
    resolverCalls,
    uiButton,
    uiLabel,
    toasts,
    status() { return sandbox.window.__mineradioGaplessHandoff.getStatus(); },
    toggle() { return sandbox.toggleGaplessHandoff(); },
    prefetch(media) { return sandbox.gaplessHandoffMaybePrefetch(media || mainMedia); },
    tick() { return sandbox.gaplessHandoffTick(); },
    consume(idx, song, opts) { return sandbox.consumeGaplessHandoffPreload(idx, song, opts || {}); },
    state() { return sandbox.gaplessHandoffState; }
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
}

function assertNoPlayCall(source) {
  assert.doesNotMatch(source, /\.play\s*\(/, '预载模块里绝不允许出现 play() 调用');
}

// ---------------------------------------------------------------------------
// A. 接线与「不改动既有功能」的静态守卫
// ---------------------------------------------------------------------------

test('A1 index-loader 挂载了独立模块，且排在 13-playback-start-audio 之后', () => {
  const loaderIdx = loaderSource.indexOf("'js/modules/05-playback/16-gapless-handoff.js'");
  const startIdx = loaderSource.indexOf("'js/modules/05-playback/13-playback-start-audio.js'");
  assert.ok(loaderIdx > 0, 'index-loader 必须加载 16-gapless-handoff.js');
  assert.ok(startIdx > 0 && startIdx < loaderIdx, '新模块必须在播放核心之后加载');
});

test('A2 播放核心的取址前消费钩子存在，且只在既有短路入口注入', () => {
  const hookIdx = startSource.indexOf("if (typeof consumeGaplessHandoffPreload === 'function'");
  const resolveIdx = startSource.indexOf('var data = typeof resolveProviderPlayUrlData', hookIdx);
  assert.ok(hookIdx > 0, '13-playback-start-audio.js 必须调用消费钩子');
  assert.ok(resolveIdx > hookIdx, '钩子必须在 resolveProviderPlayUrlData 之前');
  const hookBody = startSource.slice(hookIdx, resolveIdx);
  assert.match(hookBody, /opts\.preResolvedPlaybackData\s*=\s*gaplessPreload/, '只写既有的 preResolvedPlaybackData 短路入口');
  assert.doesNotMatch(hookBody, /audio\.play|audio\.src|onended/, '钩子不得碰起播 / 换源 / ended 分支');
});

test('A3 顶层重复开关已移除，Cuefield 入口收编进面板且仍可用', () => {
  // 2026-11-07：四张过渡卡片承载曲末预载与交接，顶层两个并列开关删除。
  // Cuefield 不能变成没有入口的死功能：改为面板内次级开关，保留原 id 让 02 的 UI 同步继续生效。
  assert.doesNotMatch(htmlSource, /id="quick-menu-gapless-toggle"/, '无缝衔接顶层按钮应已移除');
  assert.doesNotMatch(htmlSource, /id="quick-menu-gapless-status"/, '旧状态文案不应残留');
  assert.match(htmlSource, /id="track-transition-fold"/, '过渡能力统一由歌曲过渡面板承载');
  assert.match(htmlSource, /id="track-transition-status"/, '预载状态文案必须迁到面板状态行');
  const popoverIdx = htmlSource.indexOf('id="player-quick-menu-popover"');
  const foldIdx = htmlSource.indexOf('id="track-transition-fold"');
  const automixIdx = htmlSource.indexOf('id="quick-menu-automix-toggle"');
  assert.ok(popoverIdx > 0 && foldIdx > popoverIdx && automixIdx > foldIdx,
    'Cuefield 开关必须在歌曲过渡面板内部，不是顶层并列');
  assert.match(htmlSource, /onclick="toggleCuefieldAutoMix\(\)"/, '入口必须真能开关');
  assert.match(htmlSource, /id="quick-menu-automix-status"/, '02 的状态文案仍要有落点');
  // 底层模块不能跟着删：16 仍由面板托管，02 源码保持原样
  assert.match(moduleSource, /function toggleGaplessHandoff\(\)/);
  const integration = fs.readFileSync(path.join(cuefieldDir, '02-cuefield-automix-integration.js'), 'utf8');
  assert.match(integration, /getElementById\('quick-menu-automix-toggle'\)/, '05-cuefield 源码一行不改');
  assert.match(integration, /readCuefieldAutoMixPreference\(\)/, '存档恢复逻辑仍在');
});

test('A4 Cuefield 目录不含本功能代码，其既有未提交改动也没被掺入', () => {
  // 注意：Cuefield 原本就有 albumGaplessHandoff 这个既有字段，不能拿宽泛的
  // /gapless/i 去判「被改过」。只检查本功能独有的符号。
  const OWN = /gaplessHandoffEnabled|consumeGaplessHandoffPreload|GAPLESS_HANDOFF_|16-gapless-handoff|quick-menu-gapless/i;
  const files = fs.readdirSync(cuefieldDir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 4, '应能读到 Cuefield 模块文件');
  for (const file of files) {
    const text = fs.readFileSync(path.join(cuefieldDir, file), 'utf8');
    assert.doesNotMatch(text, OWN, file + ' 不应包含无缝衔接代码');
  }
  // 该目录允许存在与本轮无关的既有未提交改动（例如节拍图时长归一化），
  // 但这些改动里绝不能混入本功能的代码。
  let diff = '';
  try {
    const { execFileSync } = require('node:child_process');
    diff = execFileSync('git', ['diff', '--', 'public/js/modules/05-cuefield/'],
      { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '';
  } catch (_) {
    // 非 git 环境（例如从 dist 单独跑测试）时，上面的源码断言已经足够
  }
  assert.doesNotMatch(diff, OWN, 'Cuefield 的未提交改动里不应掺入无缝衔接代码');
});

test('A5 暂停/播放淡变与曲末淡出未回归', () => {
  const applyVolumeBody = graphSource.slice(
    graphSource.indexOf('function applyVolumeToAudio()'),
    graphSource.indexOf('function updateVolumeUiFrom')
  );
  assert.doesNotMatch(applyVolumeBody, /\.setTargetAtTime\s*\(/, 'setTargetAtTime 会重新盖掉淡变');
  assert.match(graphSource, /function\s+writeAudioOutputGain\s*\(/, 'A deck 淡出写入口必须还在');
  assert.match(graphSource, /function\s+scheduleTrackEndFade\s*\(/, '曲末提前淡出必须还在');
  assert.match(seekSource, /scheduleTrackEndFade\(audioEl\)/, 'timeupdate 必须仍挂曲末淡出排程');
  assert.match(seekSource, /cancelTrackEndFade\(\)/, '打断路径必须仍取消曲末淡出');
});

test('A6 预载模块源码里不存在任何 play() 调用（绝不重叠的静态硬约束）', () => {
  assertNoPlayCall(moduleSource);
  const warmBody = moduleSource.slice(
    moduleSource.indexOf('function gaplessHandoffWarm'),
    moduleSource.indexOf('function gaplessHandoffStart')
  );
  assert.match(warmBody, /media\.muted\s*=\s*true/, '预热元素必须静音');
  assert.match(warmBody, /media\.volume\s*=\s*0/, '预热元素音量必须为 0');
  assert.match(warmBody, /media\.load\(\)/, '预热只 load 字节');
});

// ---------------------------------------------------------------------------
// B. 运行时：预载窗口
// ---------------------------------------------------------------------------

test('B1 默认关闭：不预取、不消费、不预热', async () => {
  const h = createSandbox();
  assert.equal(h.status().enabled, false);
  assert.equal(h.prefetch(), false);
  assert.equal(h.consume(1, TRACK_B), null);
  assert.equal(h.resolverCalls.length, 0);
  assert.equal(h.warmMedias.length, 0);
});

test('B2 曲末 18s 窗口之外不预取（remain=30s）', () => {
  const h = createSandbox({ mainMedia: { duration: 200, currentTime: 170 } });
  h.toggle();
  assert.equal(h.prefetch(), false);
  assert.equal(h.resolverCalls.length, 0);
});

test('B3 曲末窗口内预取下一首，resolver 只被调用一次', async () => {
  const h = createSandbox();
  h.toggle();
  assert.equal(h.prefetch(), true);
  assert.equal(h.resolverCalls.length, 1);
  assert.equal(h.resolverCalls[0], TRACK_B);
  // timeupdate 反复触发也不能重复打接口
  assert.equal(h.prefetch(), false);
  assert.equal(h.resolverCalls.length, 1);
  await flush();
  assert.equal(h.status().ready, true);
  assert.equal(h.status().pending, false);
});

test('B4 太贴近 ended（remain=2s）不再发起新请求', () => {
  const h = createSandbox({ mainMedia: { duration: 200, currentTime: 198 } });
  h.toggle();
  assert.equal(h.prefetch(), false);
  assert.equal(h.resolverCalls.length, 0);
});

test('B5 暂停 / 已结束 / 无时长信息都不预取', () => {
  const cases = [
    { duration: 200, currentTime: 190, paused: true },
    { duration: 200, currentTime: 190, ended: true },
    { duration: NaN, currentTime: 190 },
    { duration: 0, currentTime: 0 }
  ];
  for (const media of cases) {
    const h = createSandbox({ mainMedia: media });
    h.toggle();
    assert.equal(h.prefetch(), false, JSON.stringify(media));
    assert.equal(h.resolverCalls.length, 0);
  }
});

test('B6 shuffle / single / 单曲队列 / 与 Cuefield 互斥 / 定时关闭 都不预取', () => {
  const cases = [
    { name: 'shuffle', overrides: { playMode: 'shuffle' } },
    { name: 'single', overrides: { playMode: 'single' } },
    { name: 'queue-length-1', overrides: { playQueue: [TRACK_A] } },
    { name: 'cuefield-on', overrides: { cuefieldAutoMixEnabled: true } },
    { name: 'cuefield-running', overrides: { cuefieldAutoMixExecuting: true } },
    { name: 'sleep-timer', overrides: { sleepTimer: { pendingStop: true } } }
  ];
  for (const c of cases) {
    const h = createSandbox(c.overrides);
    h.toggle();
    assert.equal(h.prefetch(), false, c.name);
    assert.equal(h.resolverCalls.length, 0, c.name);
  }
  const cuefield = createSandbox({ cuefieldAutoMixEnabled: true });
  cuefield.toggle();
  assert.equal(cuefield.status().blocked, 'cuefield');
  assert.match(cuefield.uiLabel.textContent, /Cuefield/, 'UI 应提示互斥');
});

// ---------------------------------------------------------------------------
// C. 运行时：绝不重叠 / 交接消费
// ---------------------------------------------------------------------------

test('C1 预热元素静音、只 load、永不 play（两首歌不会同时出声）', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  assert.equal(h.warmMedias.length, 1, '只创建一个预热元素');
  const warm = h.warmMedias[0];
  assert.equal(warm.muted, true);
  assert.equal(warm.volume, 0);
  assert.equal(warm.loadCount, 1);
  assert.equal(warm.playCount, 0);
  assert.equal(warm.paused, true);
  assert.equal(h.status().warmMediaPlaying, false);
  assert.equal(h.status().warmMediaMuted, true);
  assert.equal(h.status().warmed, true);
  // 主 audio 全程没被这个模块碰过（不 pause、不 play、不改 src）
  assert.equal(h.mainMedia.playCount, 0);
  assert.equal(h.mainMedia.loadCount, 0);
  assert.equal(h.mainMedia.src, '');
});

test('C2 交接时把预取地址注入 opts.preResolvedPlaybackData，且只消费一次', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  const opts = { preserveHomeState: true };
  const data = h.consume(1, TRACK_B, opts);
  assert.ok(data && data.url === PRELOAD_URL, '应返回预取到的地址');
  assert.equal(h.status().ready, false, '消费后状态必须清空');
  assert.equal(h.consume(1, TRACK_B), null, '预载结果是一次性的，不能重复复用');
});

test('C3 播放核心真实钩子 + 真实 consume 对接后，opts 被写入', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  const hookIdx = startSource.indexOf("if (typeof consumeGaplessHandoffPreload === 'function'");
  const resolveIdx = startSource.indexOf('var data = typeof resolveProviderPlayUrlData', hookIdx);
  const hookBody = startSource.slice(hookIdx, resolveIdx);
  const opts = { preserveHomeState: true };
  const hookSandbox = {
    consumeGaplessHandoffPreload: h.sandbox.consumeGaplessHandoffPreload,
    idx: 1,
    song: TRACK_B,
    opts
  };
  vm.runInNewContext(hookBody, hookSandbox, { filename: 'gapless-hook.js' });
  assert.equal(opts.preResolvedPlaybackData.url, PRELOAD_URL, '钩子必须把预载地址写进 opts');
});

test('C4 用户点了别的歌（idx / key 不匹配）时绝不误用预载地址', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  assert.equal(h.consume(0, TRACK_A), null, 'idx 不匹配');
  assert.equal(h.consume(1, TRACK_A), null, '曲目 key 不匹配');
  assert.equal(h.status().ready, true, '未命中不能消费掉预载');
});

test('C5 换源恢复 / 切音质 / 单曲循环 / Cuefield 交接 / 已有短路数据都不复用', async () => {
  const blockedOpts = [
    { cuefieldAutoMix: true },
    { qualitySwitch: true },
    { qualityOverride: 'hires' },
    { sourceFallbackRecovery: {} },
    { autoRepeat: true },
    { resumeRecovery: true },
    { fallbackDepth: 0 },
    { preResolvedPlaybackData: { url: 'already' } }
  ];
  for (const opts of blockedOpts) {
    const h = createSandbox();
    h.toggle();
    h.prefetch();
    await flush();
    assert.equal(h.consume(1, TRACK_B, opts), null, JSON.stringify(Object.keys(opts)));
    assert.equal(h.status().ready, true, '被拒绝的 opts 不应消费预载');
  }
});

test('C6 预载地址超过 TTL 后失效（签名 URL 过期保护）', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  h.state().readyAt = Date.now() - 130000;
  assert.equal(h.consume(1, TRACK_B), null);
});

test('C7 预取失败不影响播放：状态复位、本曲不重试、不抛异常', async () => {
  const h = createSandbox({ resolver: () => Promise.resolve(null) });
  h.toggle();
  assert.equal(h.prefetch(), true);
  await flush();
  assert.equal(h.status().ready, false);
  assert.equal(h.status().pending, false);
  assert.equal(h.state().blockedKey, 'song:B', '失败后本曲不再反复打接口');
  assert.equal(h.prefetch(), false);
  assert.equal(h.resolverCalls.length, 1);
  assert.equal(h.consume(1, TRACK_B), null);
  assert.equal(h.warmMedias.length, 0, '取不到地址就不该预热字节');
});

test('C8 resolver 抛异常时同样安全收口', async () => {
  const h = createSandbox({ resolver: () => Promise.reject(new Error('network down')) });
  h.toggle();
  h.prefetch();
  await flush();
  assert.equal(h.status().pending, false);
  assert.equal(h.status().ready, false);
  assert.match(h.status().lastError, /network down|prefetch-failed/);
});

test('C9 本地曲库：不走 provider 取址，只预热媒体字节', async () => {
  const localB = { id: 'L', localUrl: 'mineradio-local://audio/L', type: 'local' };
  const h = createSandbox({ playQueue: [TRACK_A, localB] });
  h.toggle();
  assert.equal(h.prefetch(), true);
  await flush();
  assert.equal(h.resolverCalls.length, 0, '本地曲不需要取址');
  assert.equal(h.warmMedias.length, 1);
  assert.equal(h.warmMedias[0].src, localB.localUrl);
  assert.equal(h.warmMedias[0].playCount, 0);
  assert.equal(h.consume(1, localB), null, '本地分支本来就不需要 preResolvedPlaybackData');
});

// ---------------------------------------------------------------------------
// D. 开关 / 状态 / 生命周期
// ---------------------------------------------------------------------------

test('D1 开关持久化到 localStorage，关闭时清空预载', async () => {
  const h = createSandbox();
  assert.equal(h.toggle(), true);
  assert.equal(h.store['mineradio-gapless-handoff-v1'], '1');
  h.prefetch();
  await flush();
  assert.equal(h.status().ready, true);
  assert.equal(h.toggle(), false);
  assert.equal(h.store['mineradio-gapless-handoff-v1'], '0');
  assert.equal(h.status().ready, false, '关掉开关必须立即作废预载');
  assert.equal(h.consume(1, TRACK_B), null);
  assert.ok(h.toasts.length === 2, '开关要有明确反馈');
});

test('D2 UI 状态随阶段更新，且只在文本变化时写 DOM', () => {
  const h = createSandbox();
  h.mainMedia.currentTime = 5;   // 远离曲末窗口，tick 不会顺带发起预载
  assert.equal(h.uiButton.attrs['aria-pressed'], 'false');
  assert.match(h.uiLabel.textContent, /默认关闭/);
  h.toggle();
  assert.equal(h.uiButton.classList._on, true);
  assert.equal(h.uiButton.attrs['aria-pressed'], 'true');
  assert.match(h.uiLabel.textContent, /等待曲末/);
  const text = h.uiLabel.textContent;
  h.tick();
  assert.equal(h.uiLabel.textContent, text);
});

test('D3 tick 检测到曲目切换后作废上一首的预载', async () => {
  const h = createSandbox();
  h.toggle();
  h.prefetch();
  await flush();
  assert.equal(h.status().ready, true);
  // 真实切歌后新曲刚起播，remain 远大于预载窗口：不会立刻又预取一次
  h.mainMedia.currentTime = 5;
  h.sandbox.trackSwitchToken = 8;
  h.tick();
  assert.equal(h.status().ready, false);
  assert.equal(h.status().lastError, 'track-changed');
  assert.equal(h.resolverCalls.length, 1, '切歌后不应立刻重复取址');
});

test('D4 timeupdate 事件驱动预取，且绑定随 audio 元素更换而迁移', async () => {
  const h = createSandbox();
  h.toggle();
  h.tick();   // 建立绑定
  h.mainMedia.fire('timeupdate');
  assert.equal(h.resolverCalls.length, 1, 'timeupdate 应即时触发预载');
  await flush();
  const newMedia = { duration: 200, currentTime: 190, paused: false, ended: false,
    _listeners: Object.create(null),
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
    removeEventListener(n, fn) {
      const arr = this._listeners[n] || []; const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
    },
    fire(n) { (this._listeners[n] || []).slice().forEach((fn) => fn()); } };
  h.sandbox.audio = newMedia;
  h.tick();
  assert.equal((h.mainMedia._listeners.timeupdate || []).length, 0, '旧元素监听必须摘掉');
  assert.equal((newMedia._listeners.timeupdate || []).length, 1, '新元素必须重新绑定');
});

test('D5 Cuefield 在预载在途时开启，会作废在途请求而不抢增益', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = createSandbox({ resolver: () => pending });
  h.toggle();
  h.prefetch();
  assert.equal(h.status().pending, true);
  h.sandbox.cuefieldAutoMixEnabled = true;
  release({ url: PRELOAD_URL });
  await flush();
  assert.equal(h.status().ready, false, 'Cuefield 开启后不能落地预载');
  assert.equal(h.warmMedias.length, 0);
});

test('D6 探针状态接口齐全，便于真机验证', () => {
  const h = createSandbox();
  const s = h.status();
  for (const key of ['enabled', 'blocked', 'pending', 'ready', 'targetIndex', 'targetKey',
    'warmed', 'warmMediaMuted', 'warmMediaPlaying', 'lastError']) {
    assert.ok(Object.prototype.hasOwnProperty.call(s, key), '缺少状态字段 ' + key);
  }
  assert.equal(s.warmMediaPlaying, false);
});
