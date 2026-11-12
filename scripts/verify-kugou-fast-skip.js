'use strict';

/**
 * 真机验收：酷狗「未返回歌曲」时——不傻等换源、不进终局、直接提示 + 自动跳、不崩。
 *
 * 用确定性桩让 resolveProviderPlayUrlData 永远返回服务端真实结构：
 *   { provider:'kugou', url:'', playable:false, reason:'copyright_unavailable', kugouCode:3 }
 * 队列 5 首全部不可用，用来同时验证「自动跳」与「队列耗尽后停住不死循环」。
 *
 * 用法：node scripts/verify-kugou-fast-skip.js
 */
const cdp = require('../.workbuddy/harness/cdp-client');
const PORT = 9443;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-kugou-fasts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v) => JSON.stringify(v);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   [' + detail + ']' : ''));
}
const hooks = [
  'playQueueAt', 'nextTrack', 'requestTrackSwitch',
  'tryAutoPlaybackFallback', 'settleSourceFallbackTerminal',
  'handlePlaybackUnavailable', 'showToast', 'cancelSourceFallbackRecovery',
];

async function main() {
  let app = null;
  try {
    app = await cdp.launch({
      port: PORT, safeClose: true, bootTimeoutMs: 120000, evalTimeoutMs: 20000,
      extraArgs: ['--user-data-dir=' + PROFILE],
    });
  } catch (e) {
    console.log('FATAL  CDP 启动失败: ' + (e && e.message));
    process.exitCode = 1;
    return;
  }
  try {
    const ready = await app.waitReady(90000);
    check('主界面模块就绪', ready === true, 'ready=' + ready);
    if (!ready) return;
    await app.dismissSplash();

    const inject = `(function(){
      var P = window.__fsVerify = { counts:{}, log:[], errors:[], toasts:[] };
      var names = ${JSON.stringify(hooks)};
      names.forEach(function(name){
        var orig = window[name];
        P.counts[name] = 0;
        if (typeof orig !== 'function') { P.errors.push('missing ' + name); return; }
        window[name] = function(){
          P.counts[name]++;
          if (name === 'showToast') P.toasts.push(String(arguments[0]));
          P.log.push({ n:name, idx:arguments[0], t:Date.now() });
          if (P.log.length > 300) P.log.shift();
          try { return orig.apply(this, arguments); }
          catch (e) { P.errors.push(name + ': ' + String(e && (e.message || e) || e)); throw e; }
        };
      });
      // 服务端真实分类（2026-11-12 真机取证）
      window.resolveProviderPlayUrlData = function(){
        P.counts.resolve = (P.counts.resolve || 0) + 1;
        return Promise.resolve({
          provider:'kugou', url:'', playable:false,
          reason:'copyright_unavailable', kugouCode:3,
          restriction:{ category:'copyright_unavailable', action:'switch_source' }
        });
      };
      window.__fsSetup = function(){
        window.playMode = 'loop';
        window.playQueue = [
          { name:'不可用 A', artist:'verify', hash:'bad-a', id:'bad-a', source:'kugou', provider:'kugou', type:'kugou', duration:200 },
          { name:'不可用 B', artist:'verify', hash:'bad-b', id:'bad-b', source:'kugou', provider:'kugou', type:'kugou', duration:200 },
          { name:'不可用 C', artist:'verify', hash:'bad-c', id:'bad-c', source:'kugou', provider:'kugou', type:'kugou', duration:200 },
          { name:'不可用 D', artist:'verify', hash:'bad-d', id:'bad-d', source:'kugou', provider:'kugou', type:'kugou', duration:200 },
          { name:'不可用 E', artist:'verify', hash:'bad-e', id:'bad-e', source:'kugou', provider:'kugou', type:'kugou', duration:200 }
        ];
        window.currentIdx = 0;
        if (window.sleepTimer) { window.sleepTimer.active=false; window.sleepTimer.pendingStop=false; }
      };
      window.__fsSnap = function(){
        var P = window.__fsVerify;
        return {
          currentIdx: window.currentIdx, token: window.trackSwitchToken,
          hasSrc: !!(window.audio && window.audio.src),
          counts: JSON.parse(JSON.stringify(P.counts)),
          toasts: P.toasts.slice(-12), errors: P.errors.slice(-8),
          tail: P.log.slice(-10)
        };
      };
      return names.filter(function(n){ return typeof window[n] === 'function'; }).length;
    })()`;
    const hooked = await app.eval(inject);
    check('探针 hook 齐全', hooked === hooks.length, hooked + '/' + hooks.length);

    await app.eval('(function(){ window.__fsSetup(); return Promise.resolve(window.playQueueAt(0,{manual:true})).then(function(){return 1;}); })()');
    await sleep(1800);
    const s1 = await app.eval('(function(){ return typeof window.__fsSnap === "function" ? window.__fsSnap() : { __reloaded:true }; })()');
    console.log('  S1: ' + short(s1));
    check('V1 全程页面未重载（渲染进程未崩）', !!s1 && !s1.__reloaded && !s1.__thrown);
    check('V2 完全没有走换源搜索（不傻等 6.5s）',
      !!s1 && s1.counts.tryAutoPlaybackFallback === 0,
      'tryAutoPlaybackFallback=' + (s1 && s1.counts.tryAutoPlaybackFallback));
    check('V3 完全没有进换源终局（不清 audio.src、不诱发重开）',
      !!s1 && s1.counts.settleSourceFallbackTerminal === 0 && s1.counts.handlePlaybackUnavailable === 0,
      'terminal=' + (s1 && s1.counts.settleSourceFallbackTerminal) +
      ' unavailable=' + (s1 && s1.counts.handlePlaybackUnavailable));
    check('V4 自动跳转确实登记进合流闸',
      !!s1 && s1.counts.requestTrackSwitch >= 1,
      'requestTrackSwitch=' + (s1 && s1.counts.requestTrackSwitch));
    check('V5 提示「酷狗未返回歌曲」',
      !!s1 && s1.toasts.some((t) => /酷狗未返回歌曲/.test(t)), short(s1 && s1.toasts));
    check('V6 队列耗尽后停住，不死循环（playQueueAt <= 7）',
      !!s1 && s1.counts.playQueueAt <= 7,
      'playQueueAt=' + (s1 && s1.counts.playQueueAt));
    check('V7 停住时有明确提示',
      !!s1 && s1.toasts.some((t) => /停止自动跳转|没有其它曲目/.test(t)), short(s1 && s1.toasts));

    const basePlayQueueAt = s1.counts.playQueueAt;
    // 连点播放键：验证上一轮的不可用曲目重试闸仍然生效、页面不崩
    let alive = true;
    for (let i = 0; i < 6; i += 1) {
      try {
        await app.eval('(function(){ Promise.resolve(window.togglePlay()).catch(function(){}); return 1; })()');
        await sleep(200);
        const snap = await app.eval('(function(){ return typeof window.__fsSnap === "function" ? window.__fsSnap() : { __reloaded:true }; })()');
        if (!snap || snap.__reloaded || snap.__thrown) { alive = false; break; }
      } catch (e) { alive = false; break; }
    }
    const s2 = await app.eval('(function(){ return typeof window.__fsSnap === "function" ? window.__fsSnap() : { __reloaded:true }; })()');
    console.log('  S2 连点 6 次播放键后: ' + short(s2));
    check('V8 连点 6 次播放键页面仍存活', alive && !!s2 && !s2.__reloaded);
    check('V9 连点不会重开多轮 root playback（增量 <= 1）',
      !!s2 && !s2.__reloaded && s2.counts.playQueueAt - basePlayQueueAt <= 1,
      'Δ=' + (s2 && s2.counts ? s2.counts.playQueueAt - basePlayQueueAt : 'n/a'));
    check('V10 全程无异常', !!s2 && (!s2.errors || s2.errors.length === 0), short(s2 && s2.errors));

    console.log('\n  前台未捕获错误: ' + short((await app.errors().catch(() => [])).slice(-6)));
    const failed = results.filter((r) => !r.ok);
    console.log('\n==== ' + (results.length - failed.length) + '/' + results.length +
      (failed.length ? ' FAILED' : ' ALL_OK') + ' ====');
    if (failed.length) process.exitCode = 1;
  } finally {
    try { await app.close(); } catch (_) {}
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
