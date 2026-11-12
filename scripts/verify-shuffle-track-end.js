'use strict';

/**
 * 真机验收：随机播放曲末切歌 / 曲末点播放键 / 连点稳定性（2026-11-12 修复）。
 *
 * 与 scripts/probe-shuffle-track-end.js（修复前的复现取证）配套：
 *   - 复现探针记录：shuffle 抽中自己、曲末点播放键归零重播、连点后 CDP 超时；
 *   - 本探针断言修复后的行为，跑在真实 exe + 隔离 profile 上。
 *
 * 全程用 data-URI 短 WAV 本地队列，不依赖 KG 登录态 / 网络 / 签名 URL，
 * 因此判据稳定可重复；playLocalQueueSong 与在线路径共用同一份曲末链路。
 *
 * A 组 自然曲末：每次 requestTrackSwitch 的目标必须 != 当时的 currentIdx。
 * B 组 曲末态（人为按住 onended 不切歌）点一次播放键：250ms 内必须 nextTrack，
 *       250ms < 0.5s 音频时长，所以不可能是「重播后自然 ended」触发的。
 * C 组 连点 5 次：页面仍可求值、无异常、渲染进程不崩。
 *
 * 用法：node scripts/verify-shuffle-track-end.js
 */

const cdp = require('../.workbuddy/harness/cdp-client');

const PORT = 9438;
const PROFILE = 'D:/Mineradio/.workbuddy/tmp/electron-shuffle-verify';

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
      evalTimeoutMs: 20000,
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

    const hook = `(function(){
      var P = window.__shuffleVerify = {
        log: [], errors: [], counts: {}, orig: {}, startResult: null,
        endedFired: 0, savedOnEnded: null
      };
      ['nextTrack','requestTrackSwitch','playQueueAt','togglePlay'].forEach(function(name){
        var orig = window[name];
        if (typeof orig !== 'function') { P.errors.push('missing global ' + name); return; }
        P.orig[name] = orig;
        P.counts[name] = 0;
        window[name] = function(){
          P.counts[name]++;
          P.log.push({ name: name, idx: arguments[0], cur: window.currentIdx, t: Date.now() });
          try { return orig.apply(this, arguments); }
          catch (e) { P.errors.push(name + ' threw: ' + String(e && (e.message || e) || e)); throw e; }
        };
      });
      window.__vWavA = ${JSON.stringify(WAV_A)};
      window.__vWavB = ${JSON.stringify(WAV_B)};
      window.__vReset = function(){
        ['nextTrack','requestTrackSwitch','playQueueAt','togglePlay'].forEach(function(n){ P.counts[n] = 0; });
        P.log.length = 0; P.errors.length = 0; P.endedFired = 0; P.startResult = null;
      };
      window.__vQueue = function(prefix){
        window.playMode = 'shuffle';
        window.playQueue = [
          { name: prefix + ' A', artist:'verify', type:'local', source:'local',
            localUrl: window.__vWavA, localKey: prefix + '-a', id: prefix + '-a', duration:0.5 },
          { name: prefix + ' B', artist:'verify', type:'local', source:'local',
            localUrl: window.__vWavB, localKey: prefix + '-b', id: prefix + '-b', duration:0.5 }
        ];
        window.currentIdx = 0;
        if (window.sleepTimer) {
          window.sleepTimer.active = false;
          window.sleepTimer.pendingStop = false;
          window.sleepTimer.finishSong = false;
        }
      };
      window.__vStart = function(){
        var P = window.__shuffleVerify;
        var r = window.playQueueAt(0, { manual: true });
        Promise.resolve(r).then(function(v){ P.startResult = v; })
          .catch(function(e){ P.errors.push('playQueueAt: ' + String(e && (e.message || e) || e)); });
      };
      window.__vSnapshot = function(){
        var P = window.__shuffleVerify;
        var a = window.audio;
        return {
          playMode: window.playMode, currentIdx: window.currentIdx,
          queueLen: window.playQueue && window.playQueue.length,
          token: window.trackSwitchToken,
          onendedType: a ? typeof a.onended : 'no-audio',
          paused: a ? a.paused : null, ended: a ? a.ended : null,
          currentTime: a ? Number(a.currentTime || 0).toFixed(3) : null,
          duration: a ? Number(a.duration || 0).toFixed(3) : null,
          pendingStop: !!(window.sleepTimer && window.sleepTimer.pendingStop),
          counts: JSON.parse(JSON.stringify(P.counts)),
          log: P.log.slice(-20), errors: P.errors.slice(-8),
          endedFired: P.endedFired, startResult: P.startResult
        };
      };
      return Object.keys(P.orig);
    })()`;
    const hooked = await app.eval(hook);
    check('四个全局播放函数均可 hook', Array.isArray(hooked) && hooked.length === 4, short(hooked));

    // ---- A 组：自然曲末，shuffle 必须跳到另一首 ----
    await app.eval('(function(){ window.__vReset(); window.__vQueue("A"); window.__vStart(); return 1; })()');
    await sleep(350);
    const pre = await app.eval('window.__vSnapshot()');
    console.log('  A 起播后: ' + short(pre));
    check('A0 起播后 onended 已装好', pre && pre.onendedType === 'function', 'onendedType=' + (pre && pre.onendedType));
    check('A0 定时停止未开启', pre && pre.pendingStop === false, 'pendingStop=' + (pre && pre.pendingStop));

    await sleep(1450);
    const post = await app.eval('window.__vSnapshot()');
    console.log('  A 曲末后: ' + short(post));
    check('A1 自然曲末触发 nextTrack', post && post.counts.nextTrack >= 1, 'nextTrack=' + (post && post.counts.nextTrack));
    check('A2 曲末登记 requestTrackSwitch', post && post.counts.requestTrackSwitch >= 1, 'requestTrackSwitch=' + (post && post.counts.requestTrackSwitch));
    check('A3 切歌真正执行 playQueueAt（>=2）', post && post.counts.playQueueAt >= 2, 'playQueueAt=' + (post && post.counts.playQueueAt));
    /* nextTrack() 里先写 currentIdx = target 再调 requestTrackSwitch()，
     * 所以 requestTrackSwitch 记录的 cur 已经是新目标了；真正该比较的是
     * 紧邻前一条 nextTrack 记录的 cur（切歌前的 currentIdx）。 */
    const switches = [];
    let beforeCur = null;
    for (const r of (post && post.log || [])) {
      if (r.name === 'nextTrack') beforeCur = r.cur;
      else if (r.name === 'requestTrackSwitch' && beforeCur != null) {
        switches.push({ from: beforeCur, to: r.idx });
        beforeCur = null;
      }
    }
    check('A4 每次切歌目标都 != 切歌前的 currentIdx（不再重播同一首）',
      switches.length >= 1 && switches.every((r) => r.to !== r.from), short(switches));
    check('A5 曲末链路无异常', post && post.errors.length === 0, short(post && post.errors));

    // ---- B 组：曲末态点播放键，必须立刻切歌 ----
    const setupB = `(function(){
      window.__vReset(); window.__vQueue("B"); window.__vStart();
      // 起播后把曲末回调按住：音频照常自然 ended，但不自动切歌，
      // 以此精确制造「用户看到的曲末停住」状态。
      setTimeout(function(){
        var P = window.__shuffleVerify;
        if (!window.audio) return;
        P.savedOnEnded = window.audio.onended;
        window.audio.onended = function(){ P.endedFired++; };
      }, 60);
      return 1;
    })()`;
    await app.eval(setupB);
    await sleep(1250);
    const bPre = await app.eval('window.__vSnapshot()');
    console.log('  B 曲末停住（点播放键前）: ' + short(bPre));
    check('B0 音频确实停在 ended 态', bPre && bPre.ended === true, 'ended=' + (bPre && bPre.ended));
    check('B0 曲末回调被人为按住（没有任何自动切歌）',
      bPre && bPre.endedFired === 1 && bPre.counts.nextTrack === 0,
      'endedFired=' + (bPre && bPre.endedFired) + ' nextTrack=' + (bPre && bPre.counts.nextTrack));

    const clicked = await app.eval(
      '(function(){ return Promise.resolve(window.togglePlay()).then(function(){ return "clicked"; }); })()'
    );
    await sleep(250);   // 250ms < 500ms 音频时长：此时若 nextTrack 已调用，只可能是点击直接切歌
    const bPost = await app.eval('window.__vSnapshot()');
    console.log('  B 点播放键 250ms 后: ' + short(bPost));
    check('B1 播放键调用成功', clicked === 'clicked', short(clicked));
    check('B2 曲末态点播放键立刻 nextTrack（不等下一轮 ended）',
      bPost && bPost.counts.nextTrack >= 1, 'nextTrack=' + (bPost && bPost.counts.nextTrack));
    check('B3 切歌登记进合流闸', bPost && bPost.counts.requestTrackSwitch >= 1,
      'requestTrackSwitch=' + (bPost && bPost.counts.requestTrackSwitch));
    check('B4 没有走重播路径（playQueueAt 由合流闸发起）',
      bPost && bPost.counts.playQueueAt >= 2, 'playQueueAt=' + (bPost && bPost.counts.playQueueAt));
    check('B5 点击链路无异常', bPost && bPost.errors.length === 0, short(bPost && bPost.errors));

    // ---- C 组：连点稳定性 ----
    const tokensBefore = bPost && bPost.token;
    const clickC = `(function(){
      var P = window.__shuffleVerify;
      P.errors.length = 0;
      P.tokenBeforeC = window.trackSwitchToken;
      for (var i = 0; i < 5; i++) {
        Promise.resolve(window.togglePlay()).catch(function(e){ P.errors.push('toggle: '+String(e)); });
      }
      return 'clicked5';
    })()`;
    const clicked5 = await app.eval(clickC);
    await sleep(1200);
    const cPost = await app.eval('window.__vSnapshot()');
    console.log('  C 连点 5 次后: ' + short(cPost));
    check('C1 连点后页面仍可求值（渲染进程未崩）',
      clicked5 === 'clicked5' && !!cPost && !cPost.__thrown, short(clicked5));
    check('C2 连点没有抛异常', cPost && cPost.errors.length === 0, short(cPost && cPost.errors));
    check('C3 连点没有疯狂推进切歌代（token 涨幅 <= 4）',
      cPost && Number(cPost.token) - Number(tokensBefore) <= 4,
      'before=' + tokensBefore + ' after=' + (cPost && cPost.token));

    const harnessErrors = await app.errors();
    console.log('  前台未捕获错误: ' + short((harnessErrors || []).slice(-8)));

    const failed = results.filter((r) => !r.ok);
    console.log('\n==== ' + (results.length - failed.length) + '/' + results.length +
      (failed.length ? ' FAILED' : ' ALL_OK') + ' ====');
    if (failed.length) process.exitCode = 1;
  } finally {
    try { await app.close(); } catch (_) {}
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
