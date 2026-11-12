'use strict';

/**
 * 离线真机复现：随机播放曲末不自动切歌 / 曲末点播放键不跳转 / 连点卡死。
 *
 * 背景（2026-11-12）：用户报「kg 音乐随机播放，一首歌完整播完后不自动跳下一首，
 * 点控制台播放按钮也不跳转，反复点击之后播放器卡死重启」。
 *
 * 为什么用 data-URI WAV 而不是真的 KG 歌曲：
 *   - 症状必须先在「播放核心的曲末链路」上定位，不能让 KG 取址/签名/网络把变量搅进来；
 *   - 0.5s 静音 WAV 能在 ~1s 内让浏览器真实派发 ended 事件，探针可重复、不依赖登录态；
 *   - playLocalQueueSong 与在线路径共用同一份 audio.onended 实现，链路判据等价。
 *
 * A 组：自然曲末 → nextTrack / requestTrackSwitch / playQueueAt 是否真的被调度。
 * B 组：人为让曲末链路失效（把 nextTrack 临时换成 no-op，模拟链路断掉），
 *       音频停在 ended 态后点 togglePlay，看它会不会切歌；再连点 5 次看是否异常。
 *
 * 用法：node scripts/probe-shuffle-track-end.js
 * 前置：本机不能有其他 Mineradio.exe 抢调试端口（探针使用隔离 profile）。
 *
 * 注意：本文件是 2026-11-12 **修复前**的取证脚本，判据按当时行为写成，
 * 修复后重跑结果会变（C 组的 Promise.all 还可能超时）。
 * 修复后的正式验收请用 scripts/verify-shuffle-track-end.js。
 */

const cdp = require('../.workbuddy/harness/cdp-client');

const PORT = 9437;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-shuffle-probe';

function makeWav(seconds, freq) {
  const rate = 8000;
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    buf[44 + i] = 128 + Math.round(36 * Math.sin(2 * Math.PI * freq * i / rate));
  }
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

const WAV_A = makeWav(0.5, 440);
const WAV_B = makeWav(0.5, 660);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   [' + detail + ']' : ''));
}
const short = (v) => JSON.stringify(v);

async function main() {
  let app = null;
  try {
    app = await cdp.launch({
      port: PORT,
      safeClose: true,
      bootTimeoutMs: 120000,
      evalTimeoutMs: 30000,
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

    // ---- 注入 hook ----
    const hook = `(function(){
      var P = window.__shuffleEndProbe = {
        log: [], errors: [], counts: {}, orig: {}, startResult: null,
        pre: null, post: null, bPre: null, bPost: null
      };
      ['nextTrack','requestTrackSwitch','playQueueAt','togglePlay'].forEach(function(name){
        var orig = window[name];
        if (typeof orig !== 'function') { P.errors.push('missing global ' + name); return; }
        P.orig[name] = orig;
        P.counts[name] = 0;
        window[name] = function(){
          P.counts[name]++;
          P.log.push({ name: name, idx: arguments[0], t: Date.now() });
          try { return orig.apply(this, arguments); }
          catch (e) { P.errors.push(name + ' threw: ' + String(e && (e.message || e) || e)); throw e; }
        };
      });
      window.__probeWavA = ${JSON.stringify(WAV_A)};
      window.__probeWavB = ${JSON.stringify(WAV_B)};
      window.__probeResetCounts = function(){
        ['nextTrack','requestTrackSwitch','playQueueAt','togglePlay'].forEach(function(n){ P.counts[n] = 0; });
        P.log.length = 0;
      };
      window.__probeSnapshot = function(){
        var a = window.audio;
        return {
          playMode: window.playMode,
          currentIdx: window.currentIdx,
          queueLen: window.playQueue && window.playQueue.length,
          token: window.trackSwitchToken,
          onendedType: a ? typeof a.onended : 'no-audio',
          audioSrc: a ? String(a.src || '').slice(0, 48) : '',
          paused: a ? a.paused : null,
          ended: a ? a.ended : null,
          currentTime: a ? Number(a.currentTime || 0).toFixed(3) : null,
          duration: a ? Number(a.duration || 0).toFixed(3) : null,
          readyState: a ? a.readyState : null,
          networkState: a ? a.networkState : null,
          pendingStop: !!(window.sleepTimer && window.sleepTimer.pendingStop),
          pendingTrackSwitch: !!window.pendingTrackSwitch,
          trackSwitchDrain: !!window.trackSwitchDrain,
          playToggleBusy: !!window.playToggleBusy,
          counts: JSON.parse(JSON.stringify(P.counts)),
          log: P.log.slice(-14),
          errors: P.errors.slice(-8),
          startResult: P.startResult
        };
      };
      return Object.keys(P.orig);
    })()`;
    const hooked = await app.eval(hook);
    check('四个全局播放函数均可 hook', Array.isArray(hooked) && hooked.length === 4, short(hooked));

    // ---- A 组：自然曲末 ----
    const setupA = `(function(){
      var P = window.__shuffleEndProbe;
      window.__probeResetCounts();
      try {
        window.playMode = 'shuffle';
        window.playQueue = [
          { name:'Probe A', artist:'probe', type:'local', source:'local',
            localUrl: window.__probeWavA, localKey:'probe-a', id:'probe-a', duration:0.5 },
          { name:'Probe B', artist:'probe', type:'local', source:'local',
            localUrl: window.__probeWavB, localKey:'probe-b', id:'probe-b', duration:0.5 }
        ];
        window.currentIdx = 0;
        if (window.sleepTimer) {
          window.sleepTimer.active = false;
          window.sleepTimer.pendingStop = false;
          window.sleepTimer.finishSong = false;
        }
        var r = window.playQueueAt(0, { manual: true });
        Promise.resolve(r).then(function(v){ P.startResult = v; })
          .catch(function(e){ P.errors.push('playQueueAt: ' + String(e && (e.message || e) || e)); });
        return 'started';
      } catch (e) { return 'throw: ' + String(e && (e.message || e) || e); }
    })()`;
    const started = await app.eval(setupA);
    check('A 组起播调用成功', started === 'started', short(started));

    await sleep(350);
    const pre = await app.eval('window.__probeSnapshot()');
    console.log('  A 组起播后快照: ' + short(pre));
    check('起播后 audio.onended 仍是函数', pre && pre.onendedType === 'function', 'onendedType=' + (pre && pre.onendedType));
    check('定时停止未开启（不会主动停在曲末）', pre && pre.pendingStop === false, 'pendingStop=' + (pre && pre.pendingStop));

    await sleep(2200);
    const post = await app.eval('window.__probeSnapshot()');
    console.log('  A 组曲末后快照: ' + short(post));
    check('A1 自然曲末触发 nextTrack', post && post.counts.nextTrack >= 1, 'nextTrack=' + (post && post.counts.nextTrack));
    check('A2 曲末登记 requestTrackSwitch', post && post.counts.requestTrackSwitch >= 1, 'requestTrackSwitch=' + (post && post.counts.requestTrackSwitch));
    check('A3 切歌真正执行 playQueueAt（>=2 次）', post && post.counts.playQueueAt >= 2, 'playQueueAt=' + (post && post.counts.playQueueAt));
    check('A4 曲末链路没有抛异常', post && post.errors.length === 0, short(post && post.errors));

    // ---- B 组：曲末链路断掉后，点播放按钮 ----
    const setupB = `(function(){
      var P = window.__shuffleEndProbe;
      window.__probeResetCounts();
      // 模拟「onended 链路没能把控制权交给 nextTrack」的现实状态：
      // 把 nextTrack 换成 no-op，音频仍会自然播到 ended，但不会切歌。
      window.nextTrack = function(){ P.counts.nextTrack++; P.log.push({ name:'nextTrack-noop', t:Date.now() }); };
      window.playMode = 'shuffle';
      window.playQueue = [
        { name:'Probe C', artist:'probe', type:'local', source:'local',
          localUrl: window.__probeWavA, localKey:'probe-c', id:'probe-c', duration:0.5 },
        { name:'Probe D', artist:'probe', type:'local', source:'local',
          localUrl: window.__probeWavB, localKey:'probe-d', id:'probe-d', duration:0.5 }
      ];
      window.currentIdx = 0;
      var r = window.playQueueAt(0, { manual: true });
      Promise.resolve(r).then(function(v){ P.startResult = v; })
        .catch(function(e){ P.errors.push('B playQueueAt: ' + String(e && (e.message || e) || e)); });
      return 'started';
    })()`;
    await app.eval(setupB);
    await sleep(1400);
    const bPre = await app.eval('window.__probeSnapshot()');
    console.log('  B 组曲末后（点播放键之前）快照: ' + short(bPre));
    check('B0 音频确实停在 ended 态', bPre && bPre.ended === true, 'ended=' + (bPre && bPre.ended));

    // 恢复真 nextTrack（仍计数），再模拟用户点击播放按钮
    const clickB = `(function(){
      var P = window.__shuffleEndProbe;
      window.nextTrack = function(){
        P.counts.nextTrack++;
        P.log.push({ name:'nextTrack', t:Date.now() });
        return P.orig.nextTrack.apply(this, arguments);
      };
      P.counts.nextTrack = 0;
      P.counts.togglePlay = 0;
      return Promise.resolve(window.togglePlay()).then(function(){ return 'clicked'; });
    })()`;
    const clicked = await app.eval(clickB);
    await sleep(900);
    const bPost = await app.eval('window.__probeSnapshot()');
    console.log('  B 组点一次播放键后快照: ' + short(bPost));
    check('B1 togglePlay 被调用', bPost && bPost.counts.togglePlay >= 1, 'togglePlay=' + (bPost && bPost.counts.togglePlay));
    check('B2 曲末态点播放键会切到下一首（nextTrack>=1）',
      bPost && bPost.counts.nextTrack >= 1, 'nextTrack=' + (bPost && bPost.counts.nextTrack));

    // ---- C 组：连点 ----
    const clickC = `(function(){
      var P = window.__shuffleEndProbe;
      P.counts.togglePlay = 0;
      P.errors.length = 0;
      var jobs = [];
      for (var i = 0; i < 5; i++) jobs.push(Promise.resolve(window.togglePlay()).catch(function(e){ P.errors.push('toggle: '+String(e)); }));
      return Promise.all(jobs).then(function(){ return 'clicked5'; });
    })()`;
    const clicked5 = await app.eval(clickC);
    await sleep(1200);
    const cPost = await app.eval('window.__probeSnapshot()');
    console.log('  C 组连点 5 次后快照: ' + short(cPost));
    check('C1 连点后页面仍可求值（渲染进程未崩）', !!cPost && !cPost.__thrown, short(clicked5));
    check('C2 连点没有抛异常', cPost && cPost.errors.length === 0, short(cPost && cPost.errors));

    const harnessErrors = await app.errors();
    console.log('  前台未捕获错误: ' + short((harnessErrors || []).slice(-10)));

    const failed = results.filter((r) => !r.ok);
    console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + (failed.length ? ' FAILED' : ' ALL_OK') + ' ====');
    if (failed.length) process.exitCode = 1;
  } finally {
    try { await app.close(); } catch (_) {}
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
