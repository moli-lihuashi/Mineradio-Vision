'use strict';

/**
 * 真机验收：「播不了的曲目 + 反复点播放键」不再打崩渲染进程。
 *
 * 与 scripts/probe-unavailable-track-click-crash.js（修复前复现取证）配套。
 * 修复前：click#1 / #2 各重开一轮 playQueueAt，click#3 页面重载（渲染进程崩溃）。
 * 修复后期望：连点 8 次只重开 1 轮，页面全程不重载；冷却过后再点，
 *             预算耗尽，只给一次「播不了」提示，仍不重开重管线。
 *
 * 用确定性桩制造「不可用」：取址失败 + 无其它音源可接管，走真实的
 * tryAutoPlaybackFallback → settleSourceFallbackTerminal（会清 audio.src）。
 *
 * 用法：node scripts/verify-unavailable-track-retry.js
 */

const cdp = require('../.workbuddy/harness/cdp-client');
const PORT = 9440;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-unavailable-verify';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v) => JSON.stringify(v);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   [' + detail + ']' : ''));
}

const hooks = [
  'playQueueAt', 'togglePlay', 'nextTrack', 'requestTrackSwitch',
  'tryAutoPlaybackFallback', 'settleSourceFallbackTerminal',
  'ensureSourceFallbackRecovery', 'cancelSourceFallbackRecovery',
  'abandonPendingTrackSwitch', 'showToast',
];

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

  try {
    const ready = await app.waitReady(90000);
    check('主界面模块就绪', ready === true, 'ready=' + ready);
    if (!ready) return;
    await app.dismissSplash();

    const inject = `(function(){
      var P = window.__retryVerify = { counts: {}, log: [], errors: [] };
      var names = ${JSON.stringify(hooks)};
      names.forEach(function(name){
        var orig = window[name];
        P.counts[name] = 0;
        if (typeof orig !== 'function') { P.errors.push('missing ' + name); return; }
        window[name] = function(){
          P.counts[name]++;
          P.log.push({ n:name, arg:arguments[0], t:Date.now() });
          if (P.log.length > 300) P.log.shift();
          try { return orig.apply(this, arguments); }
          catch (e) { P.errors.push(name + ': ' + String(e && (e.message || e) || e)); throw e; }
        };
      });
      window.resolveProviderPlayUrlData = function(){ return Promise.resolve({ url:null, reason:'verify-unavailable' }); };
      window.alternatePlaybackProviders = function(){ return []; };
      window.playbackRestrictionCategory = function(){ return 'unavailable'; };
      window.__retrySetup = function(){
        window.playMode = 'loop';
        window.playQueue = [
          { name:'不可用 A', artist:'verify', provider:'kugou', source:'kugou', id:'bad-a', duration:200 },
          { name:'不可用 B', artist:'verify', provider:'kugou', source:'kugou', id:'bad-b', duration:200 },
          { name:'不可用 C', artist:'verify', provider:'kugou', source:'kugou', id:'bad-c', duration:200 },
          { name:'不可用 D', artist:'verify', provider:'kugou', source:'kugou', id:'bad-d', duration:200 }
        ];
        window.currentIdx = 0;
        if (window.sleepTimer) { window.sleepTimer.active=false; window.sleepTimer.pendingStop=false; }
      };
      window.__retrySnap = function(){
        var P = window.__retryVerify;
        var a = window.audio;
        return {
          currentIdx: window.currentIdx, token: window.trackSwitchToken,
          hasSrc: !!(a && a.src),
          counts: JSON.parse(JSON.stringify(P.counts)),
          toasts: P.log.filter(function(r){ return r.n === 'showToast'; }).map(function(r){ return String(r.arg); }),
          errors: P.errors.slice(-8)
        };
      };
      return names.filter(function(n){ return typeof window[n] === 'function'; }).length;
    })()`;
    const hooked = await app.eval(inject);
    check('探针 hook 齐全', hooked === hooks.length, hooked + '/' + hooks.length);

    // 阶段 0 / 1：制造「连点下一曲撞到不可用曲目」的状态
    await app.eval('(function(){ window.__retrySetup(); return Promise.resolve(window.playQueueAt(0,{manual:true})).then(function(){return 1;}); })()');
    await sleep(1100);
    const s0 = await app.eval('window.__retrySnap()');
    check('起播后换源终局已清掉 audio.src', s0 && s0.hasSrc === false, 'hasSrc=' + (s0 && s0.hasSrc));

    await app.eval('(function(){ for(var i=0;i<6;i++) window.nextTrack(); return 1; })()');
    await sleep(1500);
    const s1 = await app.eval('window.__retrySnap()');
    console.log('  S1 连点 6 次下一曲后: ' + short(s1));
    check('连点下一曲没有打崩页面', !!s1 && !s1.__thrown, 'playQueueAt=' + (s1 && s1.counts.playQueueAt));

    const basePlayQueueAt = s1.counts.playQueueAt;
    const baseToasts = s1.toasts.length;

    // 阶段 2：连点 8 次播放键（修复前第 3 次就会重载）
    let aliveAllClicks = true;
    let lastSnap = s1;
    for (let i = 0; i < 8; i += 1) {
      try {
        await app.eval('(function(){ Promise.resolve(window.togglePlay()).catch(function(e){ if(window.__retryVerify) window.__retryVerify.errors.push("toggle: "+String(e)); }); return 1; })()');
        await sleep(230);
        const snap = await app.eval('(function(){ return typeof window.__retrySnap === "function" ? window.__retrySnap() : { __reloaded:true }; })()');
        if (!snap || snap.__reloaded || snap.__thrown) {
          aliveAllClicks = false;
          console.log('  !! click#' + (i + 1) + ' 页面重载/求值异常: ' + short(snap));
          break;
        }
        lastSnap = snap;
        console.log('  click#' + (i + 1) + '  playQueueAt=' + snap.counts.playQueueAt +
          '  togglePlay=' + snap.counts.togglePlay + '  token=' + snap.token);
      } catch (e) {
        aliveAllClicks = false;
        console.log('  !! click#' + (i + 1) + ' CDP 求值失败: ' + (e && e.message));
        break;
      }
    }
    check('V1 连点 8 次播放键页面全程未重载（渲染进程未崩）', aliveAllClicks);
    check('V2 8 次点击只重开 1 轮 root playback',
      !!lastSnap && lastSnap.counts.playQueueAt - basePlayQueueAt === 1,
      'ΔplayQueueAt=' + (lastSnap ? lastSnap.counts.playQueueAt - basePlayQueueAt : 'n/a'));
    check('V3 8 次点击都真的进了 togglePlay',
      !!lastSnap && lastSnap.counts.togglePlay >= 8,
      'togglePlay=' + (lastSnap && lastSnap.counts.togglePlay));

    // 阶段 3：越过冷却窗口再点 2 次，预算必须仍然挡住
    await sleep(3200);
    for (let i = 0; i < 2; i += 1) {
      try {
        await app.eval('(function(){ Promise.resolve(window.togglePlay()).catch(function(){}); return 1; })()');
        await sleep(230);
      } catch (_) {}
    }
    let s3;
    try { s3 = await app.eval('window.__retrySnap()'); }
    catch (e) { s3 = { __reloaded: true, reason: String(e && e.message) }; }
    console.log('  S3 冷却过后再点 2 次: ' + short(s3));
    check('V4 冷却过后预算仍挡住，不再重开重管线',
      !!s3 && !s3.__reloaded && s3.counts.playQueueAt - basePlayQueueAt === 1,
      'ΔplayQueueAt=' + (s3 && s3.counts ? s3.counts.playQueueAt - basePlayQueueAt : 'n/a'));
    const newToasts = (s3 && s3.toasts || []).slice(baseToasts).filter((t) => /播不了/.test(t));
    check('V5 预算耗尽时只给一次「播不了」提示',
      newToasts.length === 1, 'toasts=' + short(newToasts));
    check('V6 全程无异常', !!s3 && (!s3.errors || s3.errors.length === 0), short(s3 && s3.errors));

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
