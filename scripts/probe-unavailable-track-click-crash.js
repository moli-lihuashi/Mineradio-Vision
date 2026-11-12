'use strict';

/**
 * 离线真机复现：反复点下一曲 → 撞上播不了的曲目 → 反复点播放 → 崩溃。
 *
 * 用户 2026-11-12 14:13 报障原话：「这次我直接反复点击下一曲，碰到到播不了的
 * 反复点击播放就崩了」。
 *
 * 取证目标（不猜）：
 *   1) 每次点播放键是否都重新跑一轮完整 playQueueAt（root playback）；
 *   2) 每轮是否都新建一次 source-fallback 事务（而不是复用）；
 *   3) 连点后 trackSwitchToken / abandonPendingTrackSwitch 的涨幅；
 *   4) CDP 是否仍可求值、JS heap 走势、前台错误。
 *
 * 为了可重复、不依赖登录态和网络，把取址与「其它音源」都换成确定性桩：
 *   resolveProviderPlayUrlData -> {url:null}（取不到地址）
 *   alternatePlaybackProviders -> []（没有可用音源可接管）
 *   playbackRestrictionCategory -> 'unavailable'（避开 login_required 早退）
 * 这样 tryAutoPlaybackFallback 会走真实的「无可用音源 → 终局」分支，
 * settleSourceFallbackTerminal 会把 audio.src 清空 —— 与用户撞到的状态一致。
 *
 * 用法：node scripts/probe-unavailable-track-click-crash.js
 */

const cdp = require('../.workbuddy/harness/cdp-client');
const PORT = 9439;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-unavailable-probe';
// 每次运行独立键：隔离 profile 会保留上一次的 sessionStorage，否则 boot 代数会误判成「重载过」
const RUN_ID = String(Date.now());
const BOOT_KEY = '__crashBootCount_' + RUN_ID;
const MIRROR_KEY = '__crashMirror_' + RUN_ID;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v) => JSON.stringify(v);

async function main() {
  let app = null;
  try {
    app = await cdp.launch({
      port: PORT, safeClose: true, bootTimeoutMs: 120000, evalTimeoutMs: 15000,
      extraArgs: ['--user-data-dir=' + PROFILE],
    });
  } catch (e) {
    console.log('FATAL  CDP 启动失败: ' + (e && e.message));
    process.exitCode = 1;
    return;
  }

  const hooks = [
    'playQueueAt', 'togglePlay', 'nextTrack', 'prevTrack', 'requestTrackSwitch',
    'tryAutoPlaybackFallback', 'settleSourceFallbackTerminal',
    'ensureSourceFallbackRecovery', 'cancelSourceFallbackRecovery',
    'abandonPendingTrackSwitch', 'handlePlaybackUnavailable',
    'skipFailedQueueItem', 'pauseCurrentAudioForTrackSwitch',
  ];

  try {
    const ready = await app.waitReady(90000);
    console.log('ready=' + ready);
    if (!ready) return;
    await app.dismissSplash();

    const inject = `(function(){
      var P = window.__crashProbe = { counts: {}, log: [], errors: [], recoveryIds: [], heap: [], phase2: [] };
      /* 渲染进程崩溃后页面会自动重载，window 上的探针全丢。
       * 把计数镜像进 localStorage + 记录 boot 代数，重载之后仍能取证。 */
      var BOOT_KEY = ${JSON.stringify(BOOT_KEY)};
      var MIRROR_KEY = ${JSON.stringify(MIRROR_KEY)};
      var boot = 1;
      try {
        boot = Number(sessionStorage.getItem(BOOT_KEY) || 0) + 1;
        sessionStorage.setItem(BOOT_KEY, String(boot));
      } catch (_) {}
      P.boot = boot;
      window.__crashMirror = function(){
        try {
          localStorage.setItem(MIRROR_KEY, JSON.stringify({
            boot: boot, counts: P.counts, recoveryIds: P.recoveryIds.length,
            token: window.trackSwitchToken, currentIdx: window.currentIdx,
            phase2: P.phase2, errors: P.errors.slice(-10),
            heap: P.heap.slice(-20)
          }));
        } catch (_) {}
      };
      setInterval(window.__crashMirror, 120);
      var names = ${JSON.stringify(hooks)};
      names.forEach(function(name){
        var orig = window[name];
        P.counts[name] = 0;
        if (typeof orig !== 'function') { P.errors.push('missing ' + name); return; }
        window[name] = function(){
          P.counts[name]++;
          P.log.push({ n:name, idx:arguments[0], t:Date.now() });
          if (P.log.length > 300) P.log.shift();
          var r;
          try { r = orig.apply(this, arguments); }
          catch (e) { P.errors.push(name + ': ' + String(e && (e.message || e) || e)); throw e; }
          if (name === 'ensureSourceFallbackRecovery' && r && r.id && P.recoveryIds.indexOf(r.id) < 0) P.recoveryIds.push(r.id);
          return r;
        };
      });
      // 确定性的「播不了」：取址失败 + 无其它音源可接管
      window.resolveProviderPlayUrlData = function(){ return Promise.resolve({ url:null, reason:'probe-unavailable' }); };
      window.alternatePlaybackProviders = function(){ return []; };
      window.playbackRestrictionCategory = function(){ return 'unavailable'; };
      window.__crashSetup = function(){
        window.playMode = 'loop';
        window.playQueue = [
          { name:'不可用 A', artist:'probe', provider:'kugou', source:'kugou', id:'bad-a', duration:200 },
          { name:'不可用 B', artist:'probe', provider:'kugou', source:'kugou', id:'bad-b', duration:200 },
          { name:'不可用 C', artist:'probe', provider:'kugou', source:'kugou', id:'bad-c', duration:200 },
          { name:'不可用 D', artist:'probe', provider:'kugou', source:'kugou', id:'bad-d', duration:200 }
        ];
        window.currentIdx = 0;
        if (window.sleepTimer) { window.sleepTimer.active=false; window.sleepTimer.pendingStop=false; }
      };
      window.__crashSnap = function(){
        var P = window.__crashProbe;
        var a = window.audio;
        var heap = (window.performance && window.performance.memory && window.performance.memory.usedJSHeapSize) || 0;
        P.heap.push(heap);
        return {
          currentIdx: window.currentIdx, token: window.trackSwitchToken,
          hasSrc: !!(a && a.src), srcHead: a ? String(a.src||'').slice(0,40) : '',
          ended: a ? a.ended : null, paused: a ? a.paused : null,
          onendedType: a ? typeof a.onended : 'no-audio',
          pendingTrackSwitch: !!window.pendingTrackSwitch,
          trackSwitchDrain: !!window.trackSwitchDrain,
          activeRecovery: !!window.activeSourceFallbackRecovery,
          recoveryIds: P.recoveryIds.length,
          playToggleBusy: !!window.playToggleBusy,
          counts: JSON.parse(JSON.stringify(P.counts)),
          heap: heap,
          errors: P.errors.slice(-10),
          tail: P.log.slice(-12)
        };
      };
      return names.filter(function(n){ return typeof window[n] === 'function'; }).length;
    })()`;
    const hooked = await app.eval(inject);
    console.log('hooked=' + hooked + '/' + hooks.length);

    // 阶段 0：起播一次，让播放核心进入正常 setup 轨道
    await app.eval('(function(){ window.__crashSetup(); return Promise.resolve(window.playQueueAt(0,{manual:true})).then(function(){return 1;}); })()');
    await sleep(1200);
    const s0 = await app.eval('window.__crashSnap()');
    console.log('\nS0 起播后: ' + short(s0));

    // 阶段 1：反复点下一曲（用户操作一）
    await app.eval('(function(){ for(var i=0;i<6;i++) window.nextTrack(); return 1; })()');
    await sleep(1600);
    const s1 = await app.eval('window.__crashSnap()');
    console.log('\nS1 连点 6 次下一曲后: ' + short(s1));
    console.log('  ΔplayQueueAt=' + (s1.counts.playQueueAt - s0.counts.playQueueAt) +
      ' ΔrequestTrackSwitch=' + (s1.counts.requestTrackSwitch - s0.counts.requestTrackSwitch) +
      ' Δtoken=' + (s1.token - s0.token));

    // 阶段 2：逐次点播放（用户操作二），每次点击后立刻从 Node 侧读快照。
    // 渲染进程一旦崩掉重载，window 上的探针就没了，所以必须逐次抓，不能最后一次性读。
    console.log('\n==== 阶段 2：逐次点播放 ====');
    for (let i = 0; i < 8; i += 1) {
      try {
        await app.eval('(function(){ Promise.resolve(window.togglePlay()).catch(function(e){ if(window.__crashProbe) window.__crashProbe.errors.push("toggle: "+String(e)); }); return 1; })()');
        await sleep(230);
        const snap = await app.eval('(function(){ return typeof window.__crashSnap === "function" ? window.__crashSnap() : { __reloaded:true }; })()');
        if (snap && snap.__reloaded) {
          console.log('  click#' + (i + 1) + ' → 页面已重载（渲染进程崩溃）');
          break;
        }
        if (snap && snap.__thrown) {
          console.log('  click#' + (i + 1) + ' → 求值异常: ' + short(snap));
          break;
        }
        console.log('  click#' + (i + 1) +
          '  playQueueAt=' + snap.counts.playQueueAt +
          '  togglePlay=' + snap.counts.togglePlay +
          '  ensureRecovery=' + snap.counts.ensureSourceFallbackRecovery +
          '  settleTerminal=' + snap.counts.settleSourceFallbackTerminal +
          '  abandonPending=' + snap.counts.abandonPendingTrackSwitch +
          '  token=' + snap.token + '  hasSrc=' + snap.hasSrc +
          '  heapMB=' + Math.round(snap.heap / 1048576));
        try { await app.eval('window.__crashMirror && window.__crashMirror()'); } catch (_) {}
      } catch (e) {
        console.log('  click#' + (i + 1) + ' → CDP 求值失败: ' + (e && e.message));
        break;
      }
    }
    await sleep(600);

    let mirror = null;
    let bootAfter = null;
    let aliveAfter = null;
    try {
      const res = await app.eval(`(function(){
        var m = null, b = null;
        try { m = JSON.parse(localStorage.getItem(${JSON.stringify(MIRROR_KEY)}) || 'null'); } catch (_) {}
        try { b = sessionStorage.getItem(${JSON.stringify(BOOT_KEY)}); } catch (_) {}
        return {
          mirror: m, boot: b,
          probeAlive: !!window.__crashProbe,
          snapAlive: typeof window.__crashSnap === 'function'
        };
      })()`);
      mirror = res && res.mirror;
      bootAfter = res && res.boot;
      aliveAfter = res && { probeAlive: res.probeAlive, snapAlive: res.snapAlive };
    } catch (e) {
      console.log('  CDP 求值失败: ' + (e && e.message));
    }
    console.log('\nS2 连点 6 次播放后:');
    console.log('  boot 代数 = ' + bootAfter + '（>1 说明页面重载过）  ' + short(aliveAfter));
    console.log('  mirror: ' + short(mirror));

    if (mirror && mirror.phase2) {
      console.log('\n==== 每次点击各自重开几轮 playQueueAt ====');
      mirror.phase2.forEach(function (r) {
        console.log('  click#' + r.i + '  playQueueAt ' + r.beforePlayQueueAt + '→' + r.afterPlayQueueAt +
          '  recovery ' + r.beforeRecovery + '→' + r.afterRecovery +
          '  terminal ' + r.beforeTerminal + '→' + r.afterTerminal +
          '  token=' + r.token + ' hasSrc=' + r.hasSrc);
      });
      console.log('  累计 ΔplayQueueAt = ' +
        (mirror.counts.playQueueAt - s1.counts.playQueueAt) +
        '  ΔensureRecovery = ' +
        (mirror.counts.ensureSourceFallbackRecovery - s1.counts.ensureSourceFallbackRecovery) +
        '  新增 recovery id = ' + (mirror.recoveryIds - s1.recoveryIds));
      console.log('  heap 走势(MB) = ' + short((mirror.heap || []).map(function (n) { return Math.round(n / 1048576); })));
    }
    console.log('\n  前台未捕获错误: ' + short(await app.errors().catch(() => [])));
  } finally {
    try { await app.close(); } catch (_) {}
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
