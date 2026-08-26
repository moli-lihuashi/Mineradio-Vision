'use strict';
/**
 * 歌词空白诊断 v2：模拟 playing + 多帧 tickLyricsParticles + 舞台 mesh tick
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-blank2-'));
const qaScript = path.join(tempDir, 'qa.js');
const qaPreload = path.join(tempDir, 'preload.js');

fs.writeFileSync(qaPreload, `
try {
  localStorage.setItem('mineradio-startup-fast-skip-v1', 'true');
  localStorage.removeItem('mineradio_lyric_row_layers_force_3210');
  localStorage.removeItem('mineradio_lyric_row_layers_force_326');
  localStorage.removeItem('mineradio_lyric_row_layers');
} catch (e) {}
`, 'utf8');

fs.writeFileSync(qaScript, `
const path = require('path');
const { app, BrowserWindow } = require('electron');
const appRoot = process.env.MINERADIO_QA_APP_ROOT;
const qaPreload = process.env.MINERADIO_QA_PRELOAD;
const logs = [];
function finish(code, payload) {
  console.log('LYRIC_BLANK2:' + JSON.stringify(payload));
  setTimeout(() => app.exit(code), 80);
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
    const msg = String(details && details.message || '');
    if (/row-layers|fail-open|ReferenceError|TypeError|\\[lyrics\\]/i.test(msg)) logs.push(msg.slice(0, 400));
  });
  await win.loadFile(path.join(appRoot, 'public', 'index.html'));
  await new Promise(r => setTimeout(r, 6500));
  const result = await win.webContents.executeJavaScript(\`(async () => {
    function snap(label) {
      const mesh = stageLyrics && stageLyrics.current;
      const data = mesh && mesh.userData && mesh.userData.lyric;
      const rows = (data && data.rowLayers) || [];
      let uploaded = 0, windowActive = 0, visible = 0, maxOp = 0, activeOp = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        if (row.renderWindowActive) windowActive++;
        if (row.renderLineUploaded) uploaded++;
        if (row.mesh && row.mesh.visible) visible++;
        const op = row.mat && row.mat.uniforms && row.mat.uniforms.uOpacity
          ? Number(row.mat.uniforms.uOpacity.value) || 0
          : 0;
        if (op > maxOp) maxOp = op;
        if (row.isActive) activeOp = op;
      }
      const legacyOp = data && data.textMat && data.textMat.uniforms && data.textMat.uniforms.uOpacity
        ? Number(data.textMat.uniforms.uOpacity.value) || 0 : 0;
      return {
        label,
        idx: stageLyrics.currentIdx,
        text: String(stageLyrics.currentText || '').slice(0, 32),
        hasMesh: !!mesh,
        usesTrack: !!(data && data.usesTrack),
        rows: rows.length,
        windowActive, uploaded, visible, maxOp, activeOp, legacyOp,
        ready: data ? data.renderInitialTextReady === true : null,
        latch: !!STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF,
        enable: !!ENABLE_LYRIC_ROW_LAYERS,
        want: typeof stageLyricWantRowLayers === 'function' ? !!stageLyricWantRowLayers() : null,
        failOpenDone: !!(mesh && mesh.userData && mesh.userData._lyricFailOpenDone),
        groupChildren: stageLyrics.group ? stageLyrics.group.children.length : 0
      };
    }

    const info = {
      boot: {
        particleLyrics: fx && fx.particleLyrics,
        mode: fx && fx.lyricDisplayMode,
        enable: !!ENABLE_LYRIC_ROW_LAYERS,
        stored: localStorage.getItem('mineradio_lyric_row_layers'),
        force3210: localStorage.getItem('mineradio_lyric_row_layers_force_3210')
      },
      hasUpdateFn: typeof updateStageLyricsVisual === 'function' || typeof updateStageLyrics === 'function',
      updateFnName: typeof updateStageLyricsVisual === 'function' ? 'updateStageLyricsVisual'
        : (typeof updateStageLyrics === 'function' ? 'updateStageLyrics' : null),
      frames: [],
      hints: []
    };

    // find stage visual tick
    let stageTick = null;
    if (typeof updateStageLyricsVisual === 'function') stageTick = updateStageLyricsVisual;
    else if (typeof updateStageLyrics === 'function') stageTick = updateStageLyrics;
    else if (typeof tickStageLyrics === 'function') stageTick = tickStageLyrics;
    // scan common names on window
    const candidates = Object.getOwnPropertyNames(window).filter(n => /stageLyric|StageLyric|lyricsParticle/i.test(n) && typeof window[n] === 'function');
    info.candidateFns = candidates.slice(0, 40);

    STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
    ENABLE_LYRIC_ROW_LAYERS = true;
    fx.particleLyrics = true;
    fx.lyricDisplayMode = 'dual';
    fx.lyricTranslationMode = 'off';
    fx.performanceQuality = 'balanced';
    lyricsLines = [];
    lyricsTransLines = [];
    lyricsTranslationLines = lyricsTransLines;
    for (let i = 0; i < 36; i++) lyricsLines.push({ t: i * 2, text: '播放诊断 ' + i });
    createLyricsParticles();
    playing = true;
    if (!audio) {
      audio = {
        paused: false, ended: false, currentTime: 3.0, duration: 200,
        pause: function () {}, play: function () { return Promise.resolve(); }
      };
    } else {
      try { audio.paused = false; audio.ended = false; audio.currentTime = 3.0; } catch (_) {}
    }
    stageLyrics.currentIdx = -1;

    // drive ~1s of playback ticks + mesh visual update
    for (let f = 0; f < 36; f++) {
      try { audio.currentTime = 3.0 + f * (1 / 30); } catch (_) {}
      try { tickLyricsParticles(); } catch (e) {
        info.frames.push({ f, err: String(e && e.message || e) });
        continue;
      }
      try {
        if (typeof updateStageLyrics3D === 'function') updateStageLyrics3D(1 / 30);
      } catch (e3) {
        info.frames.push({ f, stageErr: String(e3 && e3.message || e3) });
      }
      if (f === 0 || f === 1 || f === 2 || f === 5 || f === 15 || f === 20 || f === 35) {
        info.frames.push(snap('f' + f));
      }
    }

    const last = info.frames.filter(x => x && x.label).pop();
    if (last && last.hasMesh && last.usesTrack && last.ready && last.maxOp > 0.05 && last.visible > 0) {
      info.verdict = 'ROW_LAYERS_OK_WHEN_TICKED';
    } else if (last && last.hasMesh && last.usesTrack && !last.ready && last.maxOp < 0.05) {
      info.verdict = 'STUCK_REVEAL_OPACITY_ZERO';
      info.hints.push('renderInitialTextReady never true; opacity forced 0');
    } else if (last && last.latch) {
      info.verdict = 'FAIL_OPEN_LATCHED';
    } else if (last && !last.hasMesh) {
      info.verdict = 'NO_MESH_AFTER_PLAY_TICK';
      info.hints.push('tickLyricsParticles did not keep a current mesh');
    } else {
      info.verdict = 'UNKNOWN';
      info.hints.push(JSON.stringify(last));
    }

    // Case B: tickLyricsParticles only (no updateStageLyrics3D) — proves visual tick is required
    STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
    ENABLE_LYRIC_ROW_LAYERS = true;
    clearStageLyrics();
    createLyricsParticles();
    stageLyrics.currentIdx = -1;
    playing = true;
    audio.currentTime = 3;
    const noLayerFrames = [];
    for (let f = 0; f < 12; f++) {
      tickLyricsParticles();
      if (f === 0 || f === 11) noLayerFrames.push(snap('nolayer_' + f));
    }
    info.withoutRowLayerTick = noLayerFrames;
    if (noLayerFrames[1] && noLayerFrames[1].hasMesh && noLayerFrames[1].usesTrack && noLayerFrames[1].maxOp < 0.05 && !noLayerFrames[1].ready) {
      info.hints.push('ROOT: tickLyricsParticles alone leaves track invisible — must run updateStageLyrics3D');
    }

    // Case C: force lyricRows off — legacy with full stage tick
    STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = true;
    ENABLE_LYRIC_ROW_LAYERS = false;
    clearStageLyrics();
    createLyricsParticles();
    stageLyrics.currentIdx = -1;
    playing = true;
    audio.currentTime = 3;
    const legacyFrames = [];
    for (let f = 0; f < 20; f++) {
      tickLyricsParticles();
      try { updateStageLyrics3D(1 / 30); } catch (_) {}
      if (f === 0 || f === 5 || f === 19) legacyFrames.push(snap('legacy_' + f));
    }
    info.legacyPlay = legacyFrames;

    // Case D: regression — prewarm next + upgrade must NOT replace persistent mesh
    STAGE_LYRIC_ROW_LAYERS_SESSION_LATCH_OFF = false;
    ENABLE_LYRIC_ROW_LAYERS = true;
    clearStageLyrics();
    createLyricsParticles();
    playing = true;
    audio.currentTime = 3;
    stageLyrics.currentIdx = -1;
    tickLyricsParticles();
    updateStageLyrics3D(1 / 30);
    const meshBefore = stageLyrics.current;
    const idBefore = meshBefore && meshBefore.id;
    if (typeof scheduleStageLyricDemandMeshPrewarm === 'function') {
      scheduleStageLyricDemandMeshPrewarm((stageLyrics.currentIdx || 0) + 1, 'diag-next', 0);
    }
    await new Promise(r => setTimeout(r, 40));
    if (typeof upgradeCurrentStageLyricFromPreparedTrack === 'function') {
      upgradeCurrentStageLyricFromPreparedTrack('diag-upgrade');
    }
    updateStageLyrics3D(1 / 30);
    const meshAfter = stageLyrics.current;
    const idAfter = meshAfter && meshAfter.id;
    const dataAfter = meshAfter && meshAfter.userData && meshAfter.userData.lyric;
    info.upgradeRegression = {
      idBefore,
      idAfter,
      sameMesh: idBefore === idAfter,
      persistent: !!(dataAfter && dataAfter.trackPersistent),
      ready: dataAfter ? dataAfter.renderInitialTextReady === true : null,
      prewarmStillPending: !!(typeof stageLyricPrewarm !== 'undefined' && stageLyricPrewarm && stageLyricPrewarm.mesh)
    };
    if (info.upgradeRegression.idBefore != null && info.upgradeRegression.idBefore !== info.upgradeRegression.idAfter) {
      info.hints.push('ROOT: upgrade replaced persistent mesh with prewarm (blank risk)');
      info.verdict = 'UPGRADE_REPLACES_MESH';
    }

    let animateSrc = '';
    try { animateSrc = Function.prototype.toString.call(animate); } catch (_) {}
    info.animateMentionsLyrics = /tickLyricsParticles|updateStageLyrics3D/.test(animateSrc);

    return info;
  })()\`);
  finish(0, { ok: true, result, logs: logs.slice(-30) });
}).catch(err => finish(1, { ok: false, error: String(err && err.stack || err) }));
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
const match = String(result.stdout || '').match(/LYRIC_BLANK2:(\{.*\})/);
if (!match) {
  console.error('[FAIL] no payload');
  process.exit(1);
}
const payload = JSON.parse(match[1]);
const info = payload.result || {};
console.log('\\nVERDICT:', info.verdict);
console.log('HINTS:', info.hints);
console.log('BOOT:', JSON.stringify(info.boot));
console.log('FRAMES:');
(info.frames || []).filter(f => f && f.label).forEach(f => console.log(JSON.stringify(f)));
console.log('WITHOUT ROW TICK:', JSON.stringify(info.withoutRowLayerTick));
console.log('animateMentionsLyrics:', info.animateMentionsLyrics);
console.log('LOGS:', payload.logs);
process.exit(0);
