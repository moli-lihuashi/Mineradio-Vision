'use strict';
/**
 * 3.2.x 冒烟：P4 默认开 row-layers + 双管线 + resident/reveal + overlay / probe
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

// Step A/B wiring (files always present; runtime APIs only when row-layers boot ON)
(function assertStepABWiring() {
  const prewarm = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14d-stage-lyric-prewarm.js');
  const resident = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14c-stage-lyric-resident.js');
  const loader = path.join(appRoot, 'public', 'js', 'index-loader.js');
  const rendering = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14-stage-lyrics-rendering.js');
  if (!fs.existsSync(prewarm)) {
    console.error('[FAIL] missing 14d-stage-lyric-prewarm.js');
    process.exit(1);
  }
  if (!fs.existsSync(resident)) {
    console.error('[FAIL] missing 14c-stage-lyric-resident.js');
    process.exit(1);
  }
  const loaderSrc = fs.readFileSync(loader, 'utf8');
  const renderSrc = fs.readFileSync(rendering, 'utf8');
  const prewarmSrc = fs.readFileSync(prewarm, 'utf8');
  const residentSrc = fs.readFileSync(resident, 'utf8');
  const need = [
    [loaderSrc, 'force_3210', 'index-loader Step D latch'],
    [renderSrc, 'noSyncBuild', 'showStageLine driver'],
    [renderSrc, 'takeStageLyricPrewarmMesh', 'showStageLine prewarm take'],
    [renderSrc, 'upgradeCurrentStageLyricFromPreparedTrack', 'line upgrade'],
    [renderSrc, 'disposeStageLyricPrewarmMesh', 'clearStageLyrics dispose'],
    [renderSrc, 'hardenStageLyricIncomingTrackOrFailOpen', 'showStageLine harden'],
    [renderSrc, 'empty-track-tick', 'tick hard fail-open'],
    [prewarmSrc, 'shouldDeferStageLyricSyncBuild', '14d defer'],
    [prewarmSrc, 'scheduleStageLyricDemandMeshPrewarm', '14d demand prewarm'],
    [prewarmSrc, 'trackPersistent', '14d upgrade persistent-only'],
    [residentSrc, 'ensureStageLyricVisibleTextRunwaySync', '14c sync runway'],
    [residentSrc, 'hardenStageLyricIncomingTrackOrFailOpen', '14c harden'],
    [residentSrc, 'stageLyricTrackMeshNeedsHardFailOpen', '14c empty-track gate']
  ];
  for (const [src, needle, label] of need) {
    if (!src.includes(needle)) {
      console.error('[FAIL] Step A/B wiring missing:', label, '→', needle);
      process.exit(1);
    }
  }
})();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-smoke-320-'));
const qaScript = path.join(tempDir, 'qa.js');
const qaPreload = path.join(tempDir, 'preload.js');

fs.writeFileSync(qaPreload, `
try {
  localStorage.setItem('mineradio-startup-fast-skip-v1', 'true');
  // Step D：模拟升级机——清旧 force_326，不预写 force_3210，让一次性闩把默认设为开
  localStorage.removeItem('mineradio_lyric_row_layers');
  localStorage.removeItem('mineradio_lyric_row_layers_force_3210');
  localStorage.setItem('mineradio_lyric_row_layers_force_326', '1');
  localStorage.setItem('mineradio_lyric_row_layers', '0');
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
  console.log('SMOKE320:' + JSON.stringify(payload));
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
    logs.push({ level: details && details.level, message: String(details && details.message || '').slice(0, 400) });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    finish(1, { ok: false, reason: 'render-process-gone', details, logs: logs.slice(-20) });
  });
  await win.loadFile(path.join(appRoot, 'public', 'index.html'));
  await new Promise(r => setTimeout(r, 5500));
  const result = await win.webContents.executeJavaScript(\`(async () => {
    const failures = [];
    const info = {};
    info.appVersion = document.documentElement.getAttribute('data-app-version') || '';
    if (info.appVersion !== '3.2.12' && info.appVersion !== '3.2.11' && info.appVersion !== '3.2.10' && info.appVersion !== '3.2.9' && info.appVersion !== '3.2.8' && info.appVersion !== '3.2.7' && info.appVersion !== '3.2.6' && info.appVersion !== '3.2.5' && info.appVersion !== '3.2.4' && info.appVersion !== '3.2.3') {
      failures.push('appVersion=' + info.appVersion);
    }

    // P1 双管线始终在
    info.hasMaskAdapter = typeof makeLyricMask === 'function' && typeof makeLyricShaderMaterial === 'function';
    info.hasMaskLegacy = typeof makeLyricMaskLegacy === 'function' && typeof makeLyricShaderMaterialLegacy === 'function';
    info.hasFailOpen = typeof stageLyricFailOpenLegacyFromTrack === 'function';
    info.hasBuildLyricMeshLegacy = typeof buildLyricMeshLegacy === 'function';
    info.hasCommitHold = typeof commitIncomingStageLyricTrackMesh === 'function';
    if (!info.hasMaskAdapter) failures.push('10c mask adapter missing');
    if (!info.hasMaskLegacy) failures.push('legacy mask/shader missing');
    if (!info.hasFailOpen) failures.push('fail-open missing');
    if (!info.hasBuildLyricMeshLegacy) failures.push('buildLyricMeshLegacy missing');
    if (!info.hasCommitHold) failures.push('commitIncomingStageLyricTrackMesh missing');

    // 3.2.11 Step D：默认开 row-layers；force_3210 应一次性清掉 force_326 的 '0'
    info.ENABLE_LYRIC_ROW_LAYERS = typeof ENABLE_LYRIC_ROW_LAYERS === 'undefined' ? 'undef' : !!ENABLE_LYRIC_ROW_LAYERS;
    if (ENABLE_LYRIC_ROW_LAYERS !== true) failures.push('ENABLE_LYRIC_ROW_LAYERS expected true, got ' + ENABLE_LYRIC_ROW_LAYERS);
    try {
      info.force3210 = localStorage.getItem('mineradio_lyric_row_layers_force_3210');
      info.storedRows = localStorage.getItem('mineradio_lyric_row_layers');
      info.force326 = localStorage.getItem('mineradio_lyric_row_layers_force_326');
    } catch (_) {}
    if (info.force3210 !== '1') failures.push('force_3210 expected 1');
    if (info.storedRows !== '1') failures.push('stored lyric_row_layers expected 1 after force_3210, got ' + info.storedRows);
    if (info.force326 != null && info.force326 !== '') failures.push('force_326 should be cleared, got ' + info.force326);
    info.hasBuildLyricMesh = typeof buildLyricMesh === 'function';
    if (!info.hasBuildLyricMesh) failures.push('buildLyricMesh missing while default ON');
    info.wantRowLayers = typeof stageLyricWantRowLayers === 'function' ? !!stageLyricWantRowLayers() : null;
    if (!info.wantRowLayers) failures.push('wantRowLayers should be true in Step D default');
    if (typeof stageLyricWantRowLayers !== 'function') failures.push('stageLyricWantRowLayers missing');
    info.hasHarden = typeof hardenStageLyricIncomingTrackOrFailOpen === 'function';
    info.hasTranslationAlias = typeof lyricsTranslationLines !== 'undefined';
    if (!info.hasHarden) failures.push('hardenStageLyricIncomingTrackOrFailOpen missing while default ON');
    if (!info.hasTranslationAlias) failures.push('lyricsTranslationLines alias missing');

    // 预设网格
    info.hasPresetGrid = !!document.getElementById('preset-grid');
    info.hasBuildPresetGrid = typeof buildPresetGrid === 'function';
    if (!info.hasBuildPresetGrid) failures.push('buildPresetGrid missing');
    try {
      if (typeof buildPresetGrid === 'function') buildPresetGrid();
      var cards = document.querySelectorAll('#preset-grid .preset-card');
      info.presetCardCount = cards ? cards.length : 0;
      if (!info.presetCardCount) failures.push('preset-grid empty after buildPresetGrid');
    } catch (e) {
      failures.push('buildPresetGrid threw: ' + (e && e.message));
    }

    // overlay APIs
    const overlayFns = ['getDesktopWindowApi','applyDesktopLyricsState','applyWallpaperModeState','syncDesktopOverlayState','toggleFullscreen','pushDesktopLyricsState'];
    overlayFns.forEach(fn => {
      if (typeof window[fn] !== 'function') failures.push('missing overlay fn: ' + fn);
    });
    info.hasOverlayVars = typeof desktopOverlayPushState === 'object' && !!desktopOverlayPushState;

    // probe / animate
    const perf = window.__mineradioPerf;
    info.perfHasMark = !!(perf && typeof perf.mark === 'function' && typeof perf.markSince === 'function');
    info.perfHasSummary = !!(perf && typeof perf.summary === 'function');
    if (!info.perfHasMark) failures.push('__mineradioPerf mark/markSince missing');
    if (!info.perfHasSummary) failures.push('__mineradioPerf.summary missing');
    info.hasDetailRowsHtml = typeof playlistPanelDetailRowsHtml === 'function';
    if (!info.hasDetailRowsHtml) failures.push('playlistPanelDetailRowsHtml missing');
    info.hasAnimate = typeof animate === 'function';
    if (!info.hasAnimate) failures.push('animate missing — main-loop may have failed to load');
    // P3 后 live coop 已删除；验收 resident/reveal 与 fail-open
    info.hasResidentEnsure = typeof ensureStageLyricPersistentTrackRows === 'function';
    info.hasRevealReady = typeof stageLyricTrackRevealReady === 'function';
    info.hasFailOpen = typeof stageLyricFailOpenLegacyFromTrack === 'function';
    if (ENABLE_LYRIC_ROW_LAYERS) {
      if (!info.hasResidentEnsure) failures.push('ensureStageLyricPersistentTrackRows missing while row-layers on');
      if (!info.hasRevealReady) failures.push('stageLyricTrackRevealReady missing while row-layers on');
    }
    if (!info.hasFailOpen) failures.push('stageLyricFailOpenLegacyFromTrack missing');

    try { if (typeof syncDesktopOverlayState === 'function') syncDesktopOverlayState(); }
    catch (e) { failures.push('syncDesktopOverlayState threw: ' + (e && e.message)); }

    return { ok: failures.length === 0, failures, info };
  })()\`);
  finish(result && result.ok ? 0 : 1, { ok: !!(result && result.ok), result, logs: logs.slice(-24) });
}).catch(err => finish(1, { ok: false, error: String(err && err.stack || err), logs }));
`, 'utf8');

const result = spawnSync(electron, [qaScript], {
  cwd: appRoot,
  env: { ...process.env, MINERADIO_QA_APP_ROOT: appRoot, MINERADIO_QA_PRELOAD: qaPreload },
  encoding: 'utf8',
  timeout: 90000
});

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
const match = String(result.stdout || '').match(/SMOKE320:(\{.*\})/);
if (!match) {
  console.error('[FAIL] no SMOKE320 payload, status=', result.status);
  process.exit(1);
}
const payload = JSON.parse(match[1]);
if (!payload.ok) {
  console.error('[FAIL]', JSON.stringify(payload, null, 2));
  process.exit(1);
}
console.log('[OK] 3.2.12 default-ON smoke passed');
console.log(JSON.stringify(payload.result.info, null, 2));
process.exit(0);
