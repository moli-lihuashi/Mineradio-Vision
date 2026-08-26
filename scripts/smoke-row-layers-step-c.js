'use strict';
/**
 * Step C 验收冒烟：row-layers boot ON
 * 覆盖 completion checklist 的可自动化部分；不做 Step D 默开。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const electron = path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electron)) {
  console.error('[FAIL] electron.exe missing');
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-smoke-stepc-'));
const qaScript = path.join(tempDir, 'qa.js');
const qaPreload = path.join(tempDir, 'preload.js');

fs.writeFileSync(qaPreload, `
try {
  localStorage.setItem('mineradio-startup-fast-skip-v1', 'true');
  localStorage.setItem('mineradio_lyric_row_layers_force_326', '1');
  localStorage.setItem('mineradio_lyric_row_layers', '1');
  localStorage.removeItem('mineradio_lyric_row_layers_force_325');
  localStorage.removeItem('mineradio_lyric_row_layers_force_322');
} catch (e) {}
`, 'utf8');

fs.writeFileSync(qaScript, `
const path = require('path');
const { app, BrowserWindow } = require('electron');
const appRoot = process.env.MINERADIO_QA_APP_ROOT;
const qaPreload = process.env.MINERADIO_QA_PRELOAD;
const logs = [];

function finish(code, payload) {
  console.log('SMOKE_STEPC:' + JSON.stringify(payload));
  setTimeout(() => app.exit(code), 60);
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false, frame: false, transparent: true,
    skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: false, nodeIntegration: false, backgroundThrottling: false,
      offscreen: true, preload: qaPreload
    }
  });
  win.webContents.on('console-message', (_e, details) => {
    logs.push({ level: details && details.level, message: String(details && details.message || '').slice(0, 500) });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    finish(1, { ok: false, reason: 'render-process-gone', details, logs: logs.slice(-24) });
  });
  await win.loadFile(path.join(appRoot, 'public', 'index.html'));
  await new Promise(r => setTimeout(r, 6500));
  const result = await win.webContents.executeJavaScript(\`(async () => {
    const failures = [];
    const info = { checks: {} };
    function ok(name, cond, detail) {
      info.checks[name] = !!cond;
      if (!cond) failures.push(name + (detail ? (': ' + detail) : ''));
    }

    info.appVersion = document.documentElement.getAttribute('data-app-version') || '';
    ok('appVersion', /^3\\.2\\.(9|10|11|12)/.test(info.appVersion), info.appVersion);

    // --- boot ON ---
    info.ENABLE = typeof ENABLE_LYRIC_ROW_LAYERS === 'undefined' ? null : !!ENABLE_LYRIC_ROW_LAYERS;
    ok('enableOn', info.ENABLE === true, String(info.ENABLE));
    ok('wantOn', typeof stageLyricWantRowLayers === 'function' && !!stageLyricWantRowLayers());
    ok('apiBuild', typeof buildLyricMesh === 'function');
    ok('apiPayload', typeof buildStageLyricDisplayPayload === 'function');
    ok('apiShow', typeof showStageLine === 'function');
    ok('apiCommit', typeof commitIncomingStageLyricTrackMesh === 'function');
    ok('apiPrime', typeof primeLyricMeshOpacity === 'function');
    ok('apiReveal', typeof stageLyricTrackRevealReady === 'function');
    ok('apiHold', typeof stageLyricShouldHoldOutgoingForReveal === 'function');
    ok('apiPrewarm', typeof takeStageLyricPrewarmMesh === 'function');
    ok('apiDefer', typeof shouldDeferStageLyricSyncBuild === 'function');
    ok('apiUpgrade', typeof upgradeCurrentStageLyricFromPreparedTrack === 'function');
    ok('apiDemand', typeof scheduleStageLyricDemandMeshPrewarm === 'function');
    ok('apiSyncRunway', typeof ensureStageLyricVisibleTextRunwaySync === 'function');
    ok('apiHarden', typeof hardenStageLyricIncomingTrackOrFailOpen === 'function');
    ok('apiNeedsHard', typeof stageLyricTrackMeshNeedsHardFailOpen === 'function');
    ok('apiFailOpen', typeof stageLyricFailOpenLegacyFromTrack === 'function');
    ok('apiEnsure', typeof ensureStageLyricPersistentTrackRows === 'function');
    ok('apiRefresh', typeof refreshCurrentLyricStyle === 'function');
    ok('apiUsableCount', typeof stageLyricTrackMeshUsableRowCount === 'function');

    // --- seed long dual lyrics ---
    try {
      if (typeof fx === 'object' && fx) {
        fx.lyricDisplayMode = 'dual';
        fx.lyricTranslationMode = 'off';
        fx.performanceQuality = 'balanced';
      }
      STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
      ENABLE_LYRIC_ROW_LAYERS = true;
      lyricsLines = [];
      lyricsTransLines = [];
      lyricsTranslationLines = lyricsTransLines;
      for (var i = 0; i < 48; i++) {
        lyricsLines.push({ t: i * 2.2, text: 'StepC line ' + i + ' 验收歌词 ' + (i % 7) });
      }
      if (typeof createLyricsParticles === 'function') createLyricsParticles();
      ok('stageGroup', !!(stageLyrics && stageLyrics.group));
    } catch (e) {
      ok('seed', false, e && e.message);
    }

    // C5 eco gate (before fail-open)
    try {
      var prevQ = fx.performanceQuality;
      fx.performanceQuality = 'eco';
      ok('ecoOff', typeof stageLyricWantRowLayers === 'function' && !stageLyricWantRowLayers());
      fx.performanceQuality = prevQ || 'balanced';
      ok('ecoRestore', !!stageLyricWantRowLayers());
    } catch (e) {
      ok('ecoGate', false, e && e.message);
    }

    // C1 first paint: lightweight showStageLine should yield usable rows or hold-capable mesh
    var firstPaint = { displayed: false, usable: 0, usesTrack: false, held: false };
    try {
      stageLyrics.currentIdx = 0;
      stageLyrics.transitionLineStep = 0;
      var payload0 = buildStageLyricDisplayPayload(0, { lightweightTrack: true });
      if (payload0 && typeof normalizeStageLyricPayload === 'function') payload0 = normalizeStageLyricPayload(payload0);
      firstPaint.displayed = !!showStageLine(payload0, false, { noSyncBuild: false });
      var cur = stageLyrics.current;
      var data = cur && cur.userData && cur.userData.lyric;
      firstPaint.usesTrack = !!(data && data.usesTrack);
      firstPaint.usable = typeof stageLyricTrackMeshUsableRowCount === 'function'
        ? stageLyricTrackMeshUsableRowCount(cur)
        : (data && data.rowLayers ? data.rowLayers.length : 0);
      ok('c1_displayed', firstPaint.displayed);
      ok('c1_usableOrLegacy', firstPaint.usable > 0 || !firstPaint.usesTrack, 'usable=' + firstPaint.usable + ' usesTrack=' + firstPaint.usesTrack);
    } catch (e) {
      ok('c1_firstPaint', false, e && e.message);
    }
    info.firstPaint = firstPaint;

    // C2 line change with noSyncBuild then sync fallback
    var lineChange = { displayed: false, idx: -1, usable: 0 };
    try {
      STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
      ENABLE_LYRIC_ROW_LAYERS = true;
      var payload3 = buildStageLyricDisplayPayload(3, { lightweightTrack: true });
      if (payload3 && typeof normalizeStageLyricPayload === 'function') payload3 = normalizeStageLyricPayload(payload3);
      var d1 = showStageLine(payload3, false, { noSyncBuild: true });
      if (!d1) d1 = showStageLine(payload3, false, { noSyncBuild: false });
      if (d1) stageLyrics.currentIdx = 3;
      lineChange.displayed = !!d1;
      lineChange.idx = stageLyrics.currentIdx;
      lineChange.usable = typeof stageLyricTrackMeshUsableRowCount === 'function'
        ? stageLyricTrackMeshUsableRowCount(stageLyrics.current)
        : 0;
      // hold contract helper exists
      ok('c2_holdHelper', typeof stageLyricShouldHoldOutgoingForReveal === 'function');
      ok('c2_lineChange', lineChange.displayed && lineChange.idx === 3, JSON.stringify(lineChange));
      if (typeof upgradeCurrentStageLyricFromPreparedTrack === 'function') {
        try { upgradeCurrentStageLyricFromPreparedTrack('stepc'); } catch (_) {}
      }
    } catch (e) {
      ok('c2_lineChange', false, e && e.message);
    }
    info.lineChange = lineChange;

    // C3 refresh / preset-style refresh
    try {
      refreshCurrentLyricStyle();
      ok('c3_refreshAlive', !!(stageLyrics && stageLyrics.current));
      if (typeof buildPresetGrid === 'function') {
        buildPresetGrid();
        var cards = document.querySelectorAll('#preset-grid .preset-card');
        ok('c3_presetGrid', !!(cards && cards.length));
      } else {
        ok('c3_presetGrid', false, 'missing');
      }
    } catch (e) {
      ok('c3_refresh', false, e && e.message);
    }

    // C4a：空轨但有歌词 → sync 应先补齐（harden 返回 ok）
    var heal = { result: null, usable: 0 };
    try {
      STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
      ENABLE_LYRIC_ROW_LAYERS = true;
      var payloadHeal = buildStageLyricDisplayPayload(4, { lightweightTrack: true });
      if (payloadHeal && typeof normalizeStageLyricPayload === 'function') payloadHeal = normalizeStageLyricPayload(payloadHeal);
      showStageLine(payloadHeal, false, { noSyncBuild: false });
      stageLyrics.currentIdx = 4;
      var meshHeal = stageLyrics.current;
      if (meshHeal && meshHeal.userData && meshHeal.userData.lyric) {
        meshHeal.userData.lyric.usesTrack = true;
        meshHeal.userData.lyric.rowLayers = [];
      }
      heal.result = hardenStageLyricIncomingTrackOrFailOpen(meshHeal, payloadHeal, 'stepc-heal');
      heal.usable = stageLyricTrackMeshUsableRowCount(stageLyrics.current);
      ok('c4a_syncHeal', heal.result === 'ok' && heal.usable > 0, JSON.stringify(heal));
      ok('c4a_stillEnabled', ENABLE_LYRIC_ROW_LAYERS === true && !STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF);
    } catch (e) {
      ok('c4a_syncHeal', false, e && e.message);
    }
    info.heal = heal;

    // C4b：sync 无法补齐 → 同栈 fail-open + 会话锁
    var failOpen = { result: null, latch: null, enable: null, legacy: false };
    try {
      STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
      ENABLE_LYRIC_ROW_LAYERS = true;
      var payload5 = buildStageLyricDisplayPayload(5, { lightweightTrack: true });
      if (payload5 && typeof normalizeStageLyricPayload === 'function') payload5 = normalizeStageLyricPayload(payload5);
      showStageLine(payload5, false, { noSyncBuild: false });
      stageLyrics.currentIdx = 5;
      var broken = stageLyrics.current;
      if (broken && broken.userData && broken.userData.lyric) {
        broken.userData.lyric.usesTrack = true;
        broken.userData.lyric.rowLayers = [];
        broken.userData._lyricFailOpenDone = false;
      }
      var origSync = ensureStageLyricVisibleTextRunwaySync;
      ensureStageLyricVisibleTextRunwaySync = function () { return false; };
      try {
        failOpen.result = hardenStageLyricIncomingTrackOrFailOpen(broken, payload5, 'stepc-empty-track');
      } finally {
        ensureStageLyricVisibleTextRunwaySync = origSync;
      }
      failOpen.latch = !!STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF;
      failOpen.enable = !!ENABLE_LYRIC_ROW_LAYERS;
      failOpen.legacy = !!(stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric
        && !stageLyrics.current.userData.lyric.usesTrack);
      ok('c4b_failOpen', failOpen.result === 'fail-open', String(failOpen.result));
      ok('c4b_latch', failOpen.latch === true);
      ok('c4b_enableOff', failOpen.enable === false);
      ok('c4b_legacyMesh', failOpen.legacy || !!(stageLyrics.current && stageLyrics.currentText));
      ok('c4b_wantOff', typeof stageLyricWantRowLayers === 'function' && !stageLyricWantRowLayers());
    } catch (e) {
      ok('c4b_failOpen', false, e && e.message);
    }
    info.failOpen = failOpen;

    // C5 after latch：legacy 路径不抛
    try {
      var legacyShown = showStageLine('legacy after latch 验收', false);
      ok('c5_legacyAfterLatch', !!legacyShown && !stageLyricWantRowLayers());
    } catch (e) {
      ok('c5_legacyAfterLatch', false, e && e.message);
    }

    return { ok: failures.length === 0, failures, info };
  })()\`);
  const failOpenHit = logs.filter(l => /fail-open/i.test(l.message || '')).slice(-6);
  finish(result && result.ok ? 0 : 1, {
    ok: !!(result && result.ok),
    result,
    failOpenHit,
    logs: logs.slice(-30)
  });
}).catch(err => finish(1, { ok: false, error: String(err && err.stack || err), logs }));
`, 'utf8');

const result = spawnSync(electron, [qaScript], {
  cwd: appRoot,
  env: { ...process.env, MINERADIO_QA_APP_ROOT: appRoot, MINERADIO_QA_PRELOAD: qaPreload },
  encoding: 'utf8',
  timeout: 120000
});

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
const match = String(result.stdout || '').match(/SMOKE_STEPC:(\{.*\})/);
if (!match) {
  console.error('[FAIL] no SMOKE_STEPC payload, status=', result.status);
  process.exit(1);
}
const payload = JSON.parse(match[1]);
if (!payload.ok) {
  console.error('[FAIL]', JSON.stringify(payload, null, 2));
  process.exit(1);
}
console.log('[OK] Step C row-layers acceptance smoke passed');
console.log(JSON.stringify(payload.result && payload.result.info, null, 2));
process.exit(0);
