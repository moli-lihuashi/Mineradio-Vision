const { fs, os, path, vm, spawnSync, appRoot, rel, fail, logStep } = require('./helpers');

function electronExecutable() {
  const exe = path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  return fs.existsSync(exe) ? exe : null;
}

function runtimeQaScript() {
  return `
const path = require('path');
const { app, BrowserWindow } = require('electron');

const appRoot = process.env.MINERADIO_QA_APP_ROOT;
const qaPreload = process.env.MINERADIO_QA_PRELOAD;
const pagePath = path.join(appRoot, 'public', 'index.html');
const logs = [];

function finish(code, payload) {
  console.log('MINERADIO_QA_RESULT:' + JSON.stringify(payload));
  setTimeout(() => app.exit(code), 80);
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
      preload: qaPreload
    }
  });

  win.webContents.on('console-message', (_event, details) => {
    logs.push({
      level: details && details.level,
      message: String(details && details.message || '').slice(0, 360)
    });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    finish(1, { ok: false, reason: 'render-process-gone', details, logs });
  });

  await win.loadFile(pagePath);
  await new Promise(resolve => setTimeout(resolve, 3000));

  const result = await win.webContents.executeJavaScript(\`
    (async () => {
      const failures = [];
      const now = performance.now();
      const displayHz = typeof estimatedDisplayRefreshHz === 'function' ? estimatedDisplayRefreshHz() : 0;
      const fpsBeforeBoost = typeof getAdaptiveRenderFps === 'function' ? getAdaptiveRenderFps(now) : 0;
      if (typeof estimatedDisplayRefreshHz !== 'function') failures.push('estimatedDisplayRefreshHz missing');
      if (typeof selectAdaptiveRenderCadence !== 'function') failures.push('selectAdaptiveRenderCadence missing');
      if (typeof sampleAdaptiveFrameCost !== 'function') failures.push('sampleAdaptiveFrameCost missing');
      if (!(displayHz >= 48 && displayHz <= 240)) failures.push('displayHz outside expected range: ' + displayHz);
      if (!(fpsBeforeBoost >= 45 || fpsBeforeBoost === 0)) failures.push('adaptive fps too low: ' + fpsBeforeBoost);
      if (typeof markRenderInteraction === 'function') markRenderInteraction('quick-check', 1000);
      const fpsAfterBoost = typeof getAdaptiveRenderFps === 'function' ? getAdaptiveRenderFps(performance.now()) : 0;
      if (!(fpsAfterBoost === 0 || fpsAfterBoost >= fpsBeforeBoost || fpsAfterBoost >= 60)) {
        failures.push('interaction boost did not preserve fps: ' + fpsBeforeBoost + ' -> ' + fpsAfterBoost);
      }
      function inspectFixedForegroundFpsCadence() {
        if (typeof shouldSkipFixedRenderCadenceFrame !== 'function' || typeof markRenderInteraction !== 'function') {
          return { ok: false, reason: 'fixed cadence helpers missing' };
        }
        const profiles = [];
        [60, 120, 144].forEach(hz => {
          [45, 60, 75, 90, 120].forEach(target => {
            const state = { key: '', lastCheckAt: 0, phase: 0 };
            const seconds = 8;
            let rendered = 0;
            for (let frame = 1; frame <= hz * seconds; frame++) {
              if (!shouldSkipFixedRenderCadenceFrame(state, frame * 1000 / hz, target, hz, String(target))) rendered += 1;
            }
            const actual = rendered / seconds;
            const expected = Math.min(target, hz);
            profiles.push({ hz, target, actual, expected, ok: Math.abs(actual - expected) <= 1 });
          });
        });
        const oldMode = fx && fx.foregroundFpsMode;
        const oldLastRenderAt = renderPerfState && renderPerfState.lastRenderAt;
        const oldBoostUntil = typeof renderInteractionBoostUntil !== 'undefined' ? renderInteractionBoostUntil : 0;
        const oldReason = typeof renderInteractionReason !== 'undefined' ? renderInteractionReason : '';
        let fixedPreserved = false;
        let vsyncCanWake = false;
        try {
          fx.foregroundFpsMode = '45';
          renderPerfState.lastRenderAt = 1234.5;
          markRenderInteraction('qa-fixed-cadence', 20);
          fixedPreserved = renderPerfState.lastRenderAt === 1234.5;
          fx.foregroundFpsMode = 'vsync';
          renderPerfState.lastRenderAt = 1234.5;
          markRenderInteraction('qa-vsync-wake', 20);
          vsyncCanWake = renderPerfState.lastRenderAt === 0 && getAdaptiveRenderFps(performance.now()) === 0;
        } finally {
          if (fx) fx.foregroundFpsMode = oldMode;
          if (renderPerfState) renderPerfState.lastRenderAt = oldLastRenderAt;
          if (typeof renderInteractionBoostUntil !== 'undefined') renderInteractionBoostUntil = oldBoostUntil;
          if (typeof renderInteractionReason !== 'undefined') renderInteractionReason = oldReason;
          if (typeof resetFixedRenderCadenceState === 'function') resetFixedRenderCadenceState();
        }
        return { ok: profiles.every(profile => profile.ok) && fixedPreserved && vsyncCanWake, profiles, fixedPreserved, vsyncCanWake };
      }
      const fixedFpsCadenceQa = inspectFixedForegroundFpsCadence();
      if (!fixedFpsCadenceQa.ok) failures.push('fixed foreground FPS cadence or VSync wake behavior failed: ' + JSON.stringify(fixedFpsCadenceQa));
      const runtime = typeof window.__mineradioPerfSnapshot === 'function' ? window.__mineradioPerfSnapshot() : null;
      const perf = window.__mineradioPerf && typeof window.__mineradioPerf.snapshot === 'function'
        ? window.__mineradioPerf.snapshot()
        : null;
      if (!runtime || !runtime.viewport) failures.push('runtime viewport snapshot missing');
      if (runtime && runtime.viewport && typeof runtime.viewport.displayHz !== 'number') failures.push('viewport displayHz missing');
      if (runtime && runtime.viewport && !runtime.viewport.adaptiveLoad) failures.push('viewport adaptiveLoad missing');
      if (runtime && runtime.viewport && !(runtime.viewport.adaptiveLoad.avgMs > 0)) failures.push('adaptiveLoad avgMs was not sampled');
      if (!perf || !perf.render) failures.push('perf render snapshot missing');
      const cuefieldButton = document.getElementById('cuefield-automix-btn');
      if (!cuefieldButton) failures.push('Cuefield AutoMix button missing');
      if (cuefieldButton && cuefieldButton.getAttribute('aria-pressed') !== 'false') failures.push('Cuefield AutoMix must default off in a fresh profile');
      if (!window.CuefieldAutoMix || typeof window.CuefieldAutoMix.createCuefieldAutoMix !== 'function') failures.push('Cuefield AutoMix core missing');
      if (!window.CuefieldTimelineExecutor || typeof window.CuefieldTimelineExecutor.buildCuefieldTimelineExecution !== 'function') failures.push('Cuefield timeline executor missing');
      if (typeof toggleCuefieldAutoMix !== 'function' || typeof tickCuefieldAutoMix !== 'function') failures.push('Cuefield renderer integration missing');
      function inspectLyricTextureQualityTiers() {
        if (typeof makeLyricMask !== 'function' || typeof compactLyricLineMaskTexture !== 'function' || typeof makeLyricQualityTexture !== 'function') {
          return { ok: false, reason: 'lyric quality texture builders missing' };
        }
        let mask = null;
        const builtTextures = [];
        try {
          mask = compactLyricLineMaskTexture(makeLyricMask('清晰度验证 High resolution lyric'));
          const rows = [{ tier: 1, width: Number(mask && mask.width) || 0, height: Number(mask && mask.height) || 0 }];
          [2, 3, 4].forEach(tier => {
            const built = makeLyricQualityTexture(mask, tier);
            if (built && built.texture) builtTextures.push(built.texture);
            rows.push({
              tier,
              width: Number(built && built.width) || 0,
              height: Number(built && built.height) || 0,
              bytes: Number(built && built.bytes) || 0,
              markedQuality: !!(built && built.texture && built.texture.userData && built.texture.userData.__mineradioLyricQuality)
            });
          });
          const widths = rows.map(row => row.width);
          const heights = rows.map(row => row.height);
          const monotonic = widths.every((width, index) => index === 0 || width > widths[index - 1]) && heights.every((height, index) => index === 0 || height > heights[index - 1]);
          const boundedActualScale = widths[0] > 0 && widths[1] >= widths[0] * 1.75 && widths[2] >= widths[0] * 2.4 && widths[3] >= widths[0] * 3.0;
          const marked = rows.slice(1).every(row => row.markedQuality && row.bytes > 0);
          return { ok: monotonic && boundedActualScale && marked, rows, monotonic, boundedActualScale, marked };
        } catch (error) {
          return { ok: false, reason: String(error && error.stack || error) };
        } finally {
          builtTextures.forEach(texture => {
            if (typeof lyricQualityDisposeTexture === 'function') lyricQualityDisposeTexture(texture);
            else if (typeof disposeOwnedLyricTexture === 'function') disposeOwnedLyricTexture(texture);
          });
          if (mask && mask.texture && typeof disposeOwnedLyricTexture === 'function') disposeOwnedLyricTexture(mask.texture);
        }
      }
      const lyricTextureQualityQa = inspectLyricTextureQualityTiers();
      if (!lyricTextureQualityQa.ok) failures.push('1x-4x lyric texture quality is not physically increasing: ' + JSON.stringify(lyricTextureQualityQa));
      async function inspectLyricQualityCacheStability() {
        const oldLines = window.lyricsLines;
        const oldTranslations = window.lyricsTranslationLines;
        const oldFx = {
          clarity: fx && fx.lyricTextureClarity,
          display: fx && fx.lyricDisplayMode,
          translation: fx && fx.lyricTranslationMode,
          count: fx && fx.lyricCustomLineCount,
          particles: fx && fx.particleLyrics
        };
        let root = null;
        try {
          invalidateLyricQualityTextures('qa-quality-cache-start', { release: true });
          window.lyricsLines = Array.from({ length: 80 }, (_, index) => ({
            t: index * 2,
            duration: 2,
            text: 'quality cache lyric row ' + index + ' smooth continuous line',
            translation: '清晰度缓存译文 ' + index,
            charCount: 40
          }));
          window.lyricsTranslationLines = window.lyricsLines.map(line => ({ t: line.t, text: line.translation }));
          fx.lyricTextureClarity = 4;
          fx.lyricDisplayMode = 'custom';
          fx.lyricTranslationMode = 'multi';
          fx.lyricCustomLineCount = 10;
          fx.particleLyrics = true;
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
          const payload = buildStageLyricDisplayPayload(30, { lightweightTrack: true });
          root = buildLyricMesh(payload);
          const data = root && root.userData && root.userData.lyric;
          if (!data || !Array.isArray(data.rowLayers)) return { ok: false, reason: 'quality cache row layers missing' };
          if (typeof initializeStageLyricPersistentTrack === 'function') initializeStageLyricPersistentTrack(root, payload);
          const target = lyricPrimaryVirtualIndex(30);
          data.trackScrollOffset = target;
          data.trackScrollPrimed = true;
          const updateOptions = {
            opacity: 1,
            readability: 1,
            contextIntro: 1,
            shownProgress: 0.5,
            contextDrift: 0,
            targetLineIndex: 30,
            targetVirtualIndex: target,
            rowGlow: 1,
            renderBase: 260,
            ease: 1,
            trackEase: 1
          };
          function step() {
            resetLyricRenderUploadFrameBudget(true);
            updateLyricRowLayers(data, updateOptions);
            finalizeLyricQualitySelectionFrame();
            data.rowLayers.forEach(row => { if (row) row.renderRevealAt = 0; });
          }
          for (let reveal = 0; reveal < data.rowLayers.length * 3 + 12; reveal++) step();
          for (let settle = 0; settle < 110; settle++) {
            step();
            await new Promise(resolve => setTimeout(resolve, 24));
            if (lyricQualityState.queue.length === 0 && lyricQualityState.residents.length > 0 && !lyricQualityState.residents.some(row => row.qualityPendingTexture)) break;
          }
          function residentIds() {
            return lyricQualityState.residents.map(row => (row.lineIndex + '|' + (row.isTranslation ? 't' : 'p') + '|' + (row.qualityTexture && row.qualityTexture.uuid))).sort();
          }
          const firstIds = residentIds();
          const firstRows = lyricQualityState.residents.length;
          const firstBytes = lyricQualityState.bytes;
          const firstQueue = lyricQualityState.queue.length;
          for (let stable = 0; stable < 30; stable++) {
            step();
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          const stableIds = residentIds();
          const anchor = lyricQualityState.residents.find(row => row.qualityTexture && row.isPrimary) || lyricQualityState.residents[0];
          if (!anchor || !anchor.qualityTexture) return { ok: false, reason: 'quality cache never produced a resident texture' };
          const oldTexture = anchor.qualityTexture;
          const baseTexture = anchor.baseLineTexture;
          fx.lyricTextureClarity = 3;
          invalidateLyricQualityTextures('texture-clarity-change');
          // Simulate a seek/input hold outliving the 3.2s fallback window.
          // The old 4x pool can be larger than the normal 3x budget, yet each
          // visible row still has to replace atomically without a 1x flash.
          const expiredFallbackAt = lyricQualityNowMs() - 1;
          lyricQualityState.transitionBudgetUntil = expiredFallbackAt;
          lyricQualityState.residents.forEach(row => { if (row) row.qualityFallbackUntil = expiredFallbackAt; });
          const startedOverNewBudget = firstBytes > lyricQualityPoolBudgetBytes(3);
          const immediateSame = lyricQualityCurrentMap(anchor) === oldTexture && !oldTexture.userData.__mineradioDisposed;
          let sawBase = false;
          for (let handoff = 0; handoff < 130; handoff++) {
            step();
            if (lyricQualityCurrentMap(anchor) === baseTexture) sawBase = true;
            await new Promise(resolve => setTimeout(resolve, 22));
            if (anchor.qualityTier === 3 && lyricQualityState.queue.length === 0 && !lyricQualityState.residents.some(row => row.qualityPendingTexture || row.qualityTier !== 3)) break;
          }
          const maxRows = lyricQualityMaxResidentRows();
          const stable = JSON.stringify(firstIds) === JSON.stringify(stableIds);
          const withinBounds = firstRows > 0 && firstRows <= maxRows && firstBytes <= lyricQualityPoolBudgetBytes(4) && firstQueue === 0;
          const allTierThree = lyricQualityState.residents.length > 0 && !lyricQualityState.residents.some(row => row.qualityTier !== 3 || row.qualityPendingTexture);
          const handoffOk = startedOverNewBudget && immediateSame && !sawBase && anchor.qualityTier === 3 && allTierThree && oldTexture.userData.__mineradioDisposed && lyricQualityCurrentMap(anchor) === anchor.qualityTexture;
          const newTier = anchor.qualityTier;
          const uploadOk = !window.__mineradioLyricUploadBudgetStats || Number(window.__mineradioLyricUploadBudgetStats.maxConsumed) <= 1;
          resetLyricRenderUploadFrameBudget(true);
          updateLyricRowLayers(data, updateOptions);
          const hadDisposeFrameCandidates = lyricQualityState.frameCandidates.some(candidate => candidate && candidate.data === data);
          disposeLyricMesh(root);
          root = null;
          finalizeLyricQualitySelectionFrame();
          await new Promise(resolve => setTimeout(resolve, 240));
          const disposedRows = Array.isArray(data.rowLayers) ? data.rowLayers : [];
          const noDisposeResurrection = data.__mineradioLyricQualityDisposed === true &&
            !lyricQualityState.frameCandidates.some(candidate => candidate && candidate.data === data) &&
            !lyricQualityState.frameCommits.some(candidate => candidate && candidate.data === data) &&
            !lyricQualityState.queue.some(job => job && job.data === data) &&
            !lyricQualityState.residents.some(row => disposedRows.indexOf(row) >= 0) &&
            !disposedRows.some(row => row && (row.qualityTexture || row.qualityPendingTexture || row.qualityQueuedKey));
          return { ok: stable && withinBounds && handoffOk && uploadOk && hadDisposeFrameCandidates && noDisposeResurrection, stable, withinBounds, handoffOk, uploadOk, startedOverNewBudget, allTierThree, hadDisposeFrameCandidates, noDisposeResurrection, firstRows, maxRows, firstBytes, firstQueue, immediateSame, sawBase, newTier };
        } catch (error) {
          return { ok: false, reason: String(error && error.stack || error) };
        } finally {
          if (root && typeof disposeLyricMesh === 'function') disposeLyricMesh(root);
          invalidateLyricQualityTextures('qa-quality-cache-finish', { release: true });
          window.lyricsLines = oldLines;
          window.lyricsTranslationLines = oldTranslations;
          if (fx) {
            fx.lyricTextureClarity = oldFx.clarity;
            fx.lyricDisplayMode = oldFx.display;
            fx.lyricTranslationMode = oldFx.translation;
            fx.lyricCustomLineCount = oldFx.count;
            fx.particleLyrics = oldFx.particles;
          }
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
        }
      }
      const lyricQualityCacheQa = await inspectLyricQualityCacheStability();
      if (!lyricQualityCacheQa.ok) failures.push('visible-row lyric quality cache was not stable, bounded, or no-flash: ' + JSON.stringify(lyricQualityCacheQa));
      function inspectLyricMode(displayMode, translationMode, sampleIndex) {
        if (typeof buildStageLyricDisplayPayload !== 'function' || typeof buildLyricMesh !== 'function') {
          failures.push('stage lyric builders missing');
          return null;
        }
        const oldLines = window.lyricsLines;
        const oldTranslations = window.lyricsTranslationLines;
        const oldFx = {
          particleLyrics: fx && fx.particleLyrics,
          lyricDisplayMode: fx && fx.lyricDisplayMode,
          lyricTranslationMode: fx && fx.lyricTranslationMode
        };
        try {
          sampleIndex = Math.max(1, Math.round(Number(sampleIndex) || 1));
          const lineCount = displayMode === 'single'
            ? Math.max(32, sampleIndex + 4)
            : Math.max(4, sampleIndex + 4);
          window.lyricsLines = Array.from({ length: lineCount }, (_, idx) => {
            const text = idx === sampleIndex
              ? 'current line should glow'
              : (idx === sampleIndex + 1 ? 'next line follows softly' : 'context lyric line ' + idx);
            const translation = idx === sampleIndex
              ? 'current translation stays visible'
              : (idx === sampleIndex + 1 ? 'next translation stays visible' : 'translation line ' + idx);
            return { t: idx * 2, duration: 2, text, translation, charCount: text.length };
          });
          /*
          window.lyricsLines = [
            { t: 0, duration: 2, text: 'before the night opens', translation: '夜色打开以前', charCount: 23 },
            { t: 2, duration: 2, text: 'current line should glow', translation: '当前行应该发光', charCount: 24 },
            { t: 4, duration: 2, text: 'next line follows softly', translation: '下一行轻轻跟随', charCount: 24 },
            { t: 6, duration: 2, text: 'third line keeps moving', translation: '第三行继续移动', charCount: 23 }
          ];
          */
          window.lyricsTranslationLines = window.lyricsLines.map(line => ({ t: line.t, text: line.translation }));
          fx.particleLyrics = true;
          fx.lyricDisplayMode = displayMode;
          fx.lyricTranslationMode = translationMode;
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
          const payload = buildStageLyricDisplayPayload(sampleIndex);
          const payloadTranslations = payload && payload.entries
            ? payload.entries.filter(entry => entry && entry.translationLine).length
            : 0;
          const mesh = payload ? buildLyricMesh(payload) : null;
          const rows = mesh && mesh.userData && mesh.userData.lyric && mesh.userData.lyric.rowLayers
            ? mesh.userData.lyric.rowLayers
            : [];
          const data = mesh && mesh.userData && mesh.userData.lyric ? mesh.userData.lyric : null;
          const qaTargetLine = data && data.usesTrack
            ? sampleIndex
            : (data && Number.isFinite(Number(data.trackTargetLineIndex)) ? Number(data.trackTargetLineIndex) : 1);
          const qaTargetVirtual = data && data.usesTrack && typeof lyricPrimaryVirtualIndex === 'function'
            ? lyricPrimaryVirtualIndex(qaTargetLine)
            : (data && Number.isFinite(Number(data.trackTargetVirtualIndex)) ? Number(data.trackTargetVirtualIndex) : 0);
          if (data && typeof updateLyricRowLayers === 'function') {
            data.trackScrollOffset = qaTargetVirtual;
            data.trackScrollPrimed = true;
            const qaLyricUpdateOptions = {
              opacity: 1,
              readability: 1,
              contextIntro: 1,
              shownProgress: 0.5,
              contextDrift: 0,
              targetLineIndex: qaTargetLine,
              targetVirtualIndex: qaTargetVirtual,
              rowGlow: 1,
              renderBase: 260,
              ease: 1,
              trackEase: 1
            };
            const qaRevealPasses = Math.max(2, rows.length + 2);
            for (let qaRevealPass = 0; qaRevealPass < qaRevealPasses; qaRevealPass++) {
              if (typeof resetLyricRenderUploadFrameBudget === 'function') resetLyricRenderUploadFrameBudget();
              updateLyricRowLayers(data, qaLyricUpdateOptions);
            }
            rows.forEach(row => { if (row) row.renderRevealAt = 0; });
            for (let qaVisiblePass = 0; qaVisiblePass < qaRevealPasses; qaVisiblePass++) {
              if (typeof resetLyricRenderUploadFrameBudget === 'function') resetLyricRenderUploadFrameBudget();
              updateLyricRowLayers(data, qaLyricUpdateOptions);
            }
          }
          const translationRows = rows.filter(row => row && row.isTranslation);
          const primaryRows = rows.filter(row => row && row.isPrimary);
          const runawayRows = translationRows.filter(row => row && row.mesh && Math.abs(row.mesh.position.y) > 3.2);
          function rowOpacity(row) {
            const mat = row && row.mat;
            if (mat && mat.uniforms && mat.uniforms.uOpacity) return Number(mat.uniforms.uOpacity.value) || 0;
            return Number(mat && mat.opacity) || 0;
          }
          const currentTranslationRows = translationRows.filter(row => row && Number(row.parentIndex) === qaTargetLine);
          const nextTranslationRows = translationRows.filter(row => row && Number(row.parentIndex) === qaTargetLine + 1);
          const currentTranslationOpacity = currentTranslationRows.reduce((max, row) => Math.max(max, rowOpacity(row)), 0);
          const nextTranslationOpacity = nextTranslationRows.reduce((max, row) => Math.max(max, rowOpacity(row)), 0);
          const currentTranslationYOffset = currentTranslationRows.reduce((max, row) => {
            const y = row && row.mesh ? Number(row.mesh.position.y) : 0;
            const baseY = row && Number.isFinite(Number(row.baseY)) ? Number(row.baseY) : y;
            return Math.max(max, Math.abs(y - baseY));
          }, 0);
          if (mesh && typeof disposeLyricMesh === 'function') disposeLyricMesh(mesh);
          return {
            payloadTranslations,
            meshTranslations: translationRows.length,
            meshPrimaries: primaryRows.length,
            runawayTranslations: runawayRows.length,
            currentTranslationOpacity,
            nextTranslationOpacity,
            currentTranslationYOffset
          };
        } finally {
          window.lyricsLines = oldLines;
          window.lyricsTranslationLines = oldTranslations;
          if (fx) {
            fx.particleLyrics = oldFx.particleLyrics;
            fx.lyricDisplayMode = oldFx.lyricDisplayMode;
            fx.lyricTranslationMode = oldFx.lyricTranslationMode;
          }
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
        }
      }
      const lyricQa = {
        singleCurrent: inspectLyricMode('single', 'current', 24),
        singleMulti: inspectLyricMode('single', 'multi', 24),
        dualDual: inspectLyricMode('dual', 'dual', 1),
        dualMulti: inspectLyricMode('dual', 'multi', 1)
      };
      if (!lyricQa.singleCurrent || lyricQa.singleCurrent.meshTranslations < 1 || lyricQa.singleCurrent.runawayTranslations) failures.push('single/current translation row invalid');
      if (!lyricQa.singleMulti || lyricQa.singleMulti.meshTranslations < 1 || lyricQa.singleMulti.runawayTranslations) failures.push('single/multi translation row invalid');
      if (!lyricQa.dualDual || lyricQa.dualDual.meshPrimaries < 2 || lyricQa.dualDual.meshTranslations < 2 || lyricQa.dualDual.runawayTranslations) failures.push('dual/dual translation rows invalid');
      if (!lyricQa.dualMulti || lyricQa.dualMulti.meshPrimaries < 2 || lyricQa.dualMulti.meshTranslations < 2 || lyricQa.dualMulti.runawayTranslations) failures.push('dual/multi translation rows invalid');
      if (!lyricQa.singleCurrent || lyricQa.singleCurrent.currentTranslationOpacity < 0.12) failures.push('single/current translation row not visible after binding update');
      if (!lyricQa.singleMulti || lyricQa.singleMulti.currentTranslationOpacity < 0.12) failures.push('single/multi translation row not visible after binding update');
      if (!lyricQa.singleCurrent || lyricQa.singleCurrent.currentTranslationYOffset > 0.015) failures.push('single/current translation row still slides from its base position');
      if (!lyricQa.singleMulti || lyricQa.singleMulti.currentTranslationYOffset > 0.015) failures.push('single/multi translation row still slides from its base position');
      if (!lyricQa.dualDual || lyricQa.dualDual.nextTranslationOpacity < 0.10) failures.push('dual/dual second translation row not visible after binding update');
      if (!lyricQa.dualMulti || lyricQa.dualMulti.nextTranslationOpacity < 0.10) failures.push('dual/multi second translation row not visible after binding update');
      async function inspectPersistentLyricContinuity() {
        const oldLines = window.lyricsLines;
        const oldTranslations = window.lyricsTranslationLines;
        const oldAudio = audio;
        const oldPlaying = playing;
        const oldFx = {
          particleLyrics: fx && fx.particleLyrics,
          lyricDisplayMode: fx && fx.lyricDisplayMode,
          lyricTranslationMode: fx && fx.lyricTranslationMode,
          lyricCustomLineCount: fx && fx.lyricCustomLineCount,
          lyricGlow: fx && fx.lyricGlow,
          lyricGlowBeat: fx && fx.lyricGlowBeat,
          lyricGlowStrength: fx && fx.lyricGlowStrength,
          lyricBackgroundAdapt: fx && fx.lyricBackgroundAdapt
        };
        const oldStageGlow = {
          beatGlow: stageLyrics && stageLyrics.beatGlow,
          highBloom: stageLyrics && stageLyrics.highBloom
        };
        try {
          if (typeof clearStageLyrics === 'function') clearStageLyrics();
          const qaLongGlowText = 'Yeah, you should be with him, I let you go from time (Uh, yeah)';
          const qaShortGlowText = 'You should stay with him';
          window.lyricsLines = Array.from({ length: 80 }, (_, idx) => {
            const text = idx === 43
              ? qaLongGlowText
              : (idx === 44 ? qaShortGlowText : 'persistent primary lyric ' + idx);
            return {
              t: idx * 1.5,
              duration: 1.5,
              text: text,
              translation: 'persistent translation ' + idx,
              charCount: text.length
            };
          });
          window.lyricsTranslationLines = window.lyricsLines.map(line => ({ t: line.t, text: line.translation }));
          fx.particleLyrics = true;
          fx.lyricDisplayMode = 'custom';
          fx.lyricCustomLineCount = 10;
          fx.lyricTranslationMode = 'multi';
          fx.lyricGlow = true;
          fx.lyricGlowBeat = false;
          fx.lyricGlowStrength = 0.85;
          fx.lyricBackgroundAdapt = 0;
          stageLyrics.beatGlow = 0;
          stageLyrics.highBloom = 0;
          audio = { src: 'qa://persistent-lyrics', currentTime: 0.2, duration: 120, ended: false, paused: false };
          playing = true;
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
          if (typeof createLyricsParticles === 'function') createLyricsParticles();
          const initialPayload = buildStageLyricDisplayPayload(0, { lightweightTrack: true });
          const root = buildLyricMesh(initialPayload);
          stageLyrics.group.add(root);
          stageLyrics.current = root;
          stageLyrics.currentIdx = 0;
          stageLyrics.currentPayload = initialPayload;
          stageLyrics.currentDisplayKey = initialPayload.key;
          initializeStageLyricPersistentTrack(root, initialPayload);
          const rootId = root.id;
          const targets = [0, 12, 43, 44, 79];
          let maxResidentPrimary = 0;
          let maxResidentRows = 0;
          let maxSameTrackOutgoing = 0;
          let maxUploadConsumed = 0;
          let maxIndexLag = 0;
          let baselineGlyphWorldH = null;
          let maxGlyphWorldDrift = 0;
          let maxLogicalRowWidth = 0;
          let minActiveScale = Infinity;
          let minimumForwardRunway = Infinity;
          let adjacentTargetsReady = 0;
          let wholeSongResident = false;
          const glowRasterSamples = [];
          function inspectActiveGlowRaster(row, target) {
            const lineMask = row && row.lineMask;
            const glowMap = row && row.glowMat && (
              row.glowMat.map ||
              (row.glowMat.uniforms && row.glowMat.uniforms.uMap && row.glowMat.uniforms.uMap.value)
            );
            const glowImage = glowMap && glowMap.image;
            const glowMeta = glowMap && glowMap.userData || {};
            const textGeometry = row && row.mesh && row.mesh.geometry && row.mesh.geometry.parameters || {};
            const glowGeometry = row && row.glow && row.glow.geometry && row.glow.geometry.parameters || {};
            if (!lineMask || !row.mesh || !row.glow || !glowImage) {
              return { ok: false, target: target, reason: 'active glow raster missing' };
            }
            const textFrameW = Math.max(0.001, Number(textGeometry.width) || Number(row.lineWorldW) || 0) * Math.max(0.001, Number(row.mesh.scale.x) || 0);
            const textFrameH = Math.max(0.001, Number(textGeometry.height) || Number(row.lineWorldH) || 0) * Math.max(0.001, Number(row.mesh.scale.y) || 0);
            const lineRasterW = Math.max(1, Number(lineMask.width) || 1);
            const lineRasterH = Math.max(1, Number(lineMask.height) || 1);
            const textInkW = textFrameW * Math.max(1, Number(lineMask.activeTextWidth) || Number(lineMask.textWidth) || lineRasterW) / lineRasterW;
            const glyphWorldH = textFrameH * Math.max(1, Number(lineMask.fontSize) || 1) / lineRasterH;
            const glowFrameW = Math.max(0.001, Number(glowGeometry.width) || 0) * Math.max(0.001, Number(row.glow.scale.x) || 0);
            const glowFrameH = Math.max(0.001, Number(glowGeometry.height) || 0) * Math.max(0.001, Number(row.glow.scale.y) || 0);
            const glowRasterW = Math.max(1, Number(glowMeta.width) || Number(glowImage.width) || 1);
            const glowRasterH = Math.max(1, Number(glowMeta.height) || Number(glowImage.height) || 1);
            const glowTextRasterW = Math.max(1, Number(glowMeta.textWidth) || glowRasterW);
            const glowInkW = glowFrameW * glowTextRasterW / glowRasterW;
            const glowFontSize = Math.max(0, Number(glowMeta.fontSize) || 0);
            const glowRasterScale = Math.max(0, Number(glowMeta.rasterScale) || 0);
            const lineRasterScale = Math.max(0.0001, Number(lineMask.rasterScale) || 1);
            const lineFontSize = Math.max(0.0001, Number(lineMask.fontSize) || 1);
            const widthAlignment = glowInkW / Math.max(0.001, textInkW);
            const rasterFontGain = glowFontSize / lineFontSize;
            const rasterScaleGain = glowRasterScale / lineRasterScale;
            const textureFrameToGlyph = glowRasterH / Math.max(1, glowFontSize);
            const worldFrameToGlyph = glowFrameH / Math.max(0.001, glyphWorldH);
            const padToGlyph = Math.max(0, glowFrameW - glowInkW) / Math.max(0.002, glyphWorldH * 2);
            const centerError = Math.hypot(
              (Number(row.glow.position.x) || 0) - (Number(row.mesh.position.x) || 0),
              (Number(row.glow.position.y) || 0) - (Number(row.mesh.position.y) || 0)
            ) / Math.max(0.001, glyphWorldH);
            const scaleError = Math.abs((Number(row.glow.scale.x) || 0) - (Number(row.mesh.scale.x) || 0));
            return {
              ok: glowFontSize > 0 && glowRasterScale > 0 && widthAlignment >= 0.90 && widthAlignment <= 1.10 && centerError <= 0.02 && scaleError <= 0.0001,
              target: target,
              text: row.text || '',
              logicalWidth: Number(lineMask.logicalWidth) || lineRasterW,
              lineRasterW: lineRasterW,
              glowRasterW: glowRasterW,
              lineFontSize: lineFontSize,
              glowFontSize: glowFontSize,
              lineRasterScale: lineRasterScale,
              glowRasterScale: glowRasterScale,
              rasterFontGain: rasterFontGain,
              rasterScaleGain: rasterScaleGain,
              widthAlignment: widthAlignment,
              textureFrameToGlyph: textureFrameToGlyph,
              worldFrameToGlyph: worldFrameToGlyph,
              padToGlyph: padToGlyph,
              centerError: centerError,
              scaleError: scaleError
            };
          }
          function relativeGlowMetricDrift(a, b) {
            a = Number(a) || 0;
            b = Number(b) || 0;
            return Math.abs(a - b) / Math.max(0.001, (Math.abs(a) + Math.abs(b)) * 0.5);
          }
          for (const target of targets) {
            audio.currentTime = Math.min(119.2, target * 1.5 + 0.2);
            const beforeTarget = Number(root.userData.lyric.trackTargetLineIndex);
            updateLyricMeshProgress(root, 0.42);
            const beforeProgress = Number(root.userData.lyric.textMat.uniforms.uProgress.value) || 0;
            const payload = buildStageLyricDisplayPayload(target);
            const accepted = setLyricTrackTarget(root, payload);
            if (!accepted) return { ok: false, reason: 'target rejected', target };
            const pendingImmediately = !!root.userData.lyric.trackPendingPayload;
            if (pendingImmediately) {
              updateLyricMeshProgress(root, 0.73);
              const heldProgress = Number(root.userData.lyric.textMat.uniforms.uProgress.value) || 0;
              if (Number(root.userData.lyric.trackTargetLineIndex) !== beforeTarget) return { ok: false, reason: 'pending target committed before upload', target };
              if (Math.abs(heldProgress - beforeProgress) > 0.0001) return { ok: false, reason: 'pending target changed old row progress', target, beforeProgress, heldProgress };
            }
            stageLyrics.currentIdx = target;
            stageLyrics.currentPayload = payload;
            stageLyrics.currentDisplayKey = payload.key;
            const deadline = performance.now() + 7000;
            let activeReady = false;
            while (performance.now() < deadline) {
              updateStageLyrics3D(1 / 60);
              await new Promise(resolve => requestAnimationFrame(resolve));
              const data = root.userData && root.userData.lyric;
              const active = data && data.rowLayers && data.rowLayers.find(row => row && row.isPrimary && Number(row.lineIndex) === target);
              const targetVirtual = lyricPrimaryVirtualIndex(target);
              const trackSettled = !!(data && Math.abs((Number(data.trackScrollOffset) || 0) - targetVirtual) <= 0.045);
              const activeCentered = !!(active && active.mesh && Math.abs(Number(active.mesh.position.y) || 0) <= Math.max(0.012, (Number(data && data.lineWorldStep) || 0.38) * 0.12));
              activeReady = !!(active && active.renderLineUploaded && stageLyricPersistentTargetRowsReady(root, target));
              const uploadStats = window.__mineradioLyricUploadBudgetStats || {};
              maxUploadConsumed = Math.max(maxUploadConsumed, Number(uploadStats.consumed) || 0, Number(uploadStats.maxConsumed) || 0);
              if (activeReady && !data.trackPendingPayload && trackSettled && activeCentered) break;
            }
            const data = root.userData && root.userData.lyric;
            if (!activeReady || !data) return { ok: false, reason: 'target resident timeout', target };
            const commitOffsets = lyricDisplayOffsetsForMode(data.displayMode);
            for (const offset of commitOffsets) {
              const lineIndex = target + Math.round(Number(offset) || 0);
              if (lineIndex < 0 || lineIndex >= window.lyricsLines.length || !lyricLineDisplayTextAt(lineIndex)) continue;
              const expectedRows = data.rowLayers.filter(row => {
                const rowLineIndex = row && row.isTranslation ? Number(row.parentIndex) : Number(row && row.lineIndex);
                return row && row.mesh && rowLineIndex === lineIndex;
              });
              if (!expectedRows.length) return { ok: false, reason: 'commit window row absent', target, lineIndex };
              for (const expectedRow of expectedRows) {
                const rowOpacity = expectedRow.mat && expectedRow.mat.uniforms && expectedRow.mat.uniforms.uOpacity
                  ? Number(expectedRow.mat.uniforms.uOpacity.value) || 0
                  : Number(expectedRow.mat && expectedRow.mat.opacity) || 0;
                if (!expectedRow.mesh.visible || rowOpacity <= 0.001) return { ok: false, reason: 'commit window row not visible', target, lineIndex, translation: !!expectedRow.isTranslation, rowOpacity };
              }
            }
            for (let settle = 0; settle < 12; settle++) {
              updateStageLyrics3D(1 / 60);
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            const primaryRows = data.rowLayers.filter(row => row && row.isPrimary);
            const translationRows = data.rowLayers.filter(row => row && row.isTranslation);
            const activeRow = primaryRows.find(row => Number(row.lineIndex) === target);
            if (!activeRow || !activeRow.lineMask || !activeRow.mesh) return { ok: false, reason: 'active row missing after settle', target };
            const glyphWorldH = Number(activeRow.lineWorldH) * (Number(activeRow.lineMask.fontSize) || 0) / Math.max(1, Number(activeRow.lineMask.height) || 1);
            maxLogicalRowWidth = Math.max(maxLogicalRowWidth, Number(activeRow.lineMask.logicalWidth) || Number(activeRow.lineMask.width) || 0);
            if (baselineGlyphWorldH == null) baselineGlyphWorldH = glyphWorldH;
            else maxGlyphWorldDrift = Math.max(maxGlyphWorldDrift, Math.abs(glyphWorldH - baselineGlyphWorldH) / Math.max(0.001, baselineGlyphWorldH));
            minActiveScale = Math.min(minActiveScale, Number(activeRow.mesh.scale.x) || 0);
            if (Math.abs(Number(data.persistentMaskLayout && data.persistentMaskLayout.fontSize) - 128) > 0.01) {
              return { ok: false, reason: 'persistent logical font inherited compact raster size', target, layout: data.persistentMaskLayout };
            }
            const visibleEffectsDeadline = performance.now() + 4000;
            while (performance.now() < visibleEffectsDeadline && !stageLyricPersistentTargetEffectsReady(root, target)) {
              updateStageLyrics3D(1 / 60);
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            if (!stageLyricPersistentTargetEffectsReady(root, target)) return { ok: false, reason: 'visible effects timeout', target };
            if (target === 43 || target === 44) {
              const effectsActiveRow = data.rowLayers.find(row => row && row.isPrimary && Number(row.lineIndex) === target);
              const glowSample = inspectActiveGlowRaster(effectsActiveRow, target);
              if (!glowSample.ok) return { ok: false, reason: 'active glow raster geometry invalid', glowSample: glowSample };
              glowRasterSamples.push(glowSample);
            }
            const visibleTranslations = translationRows.filter(row => lyricLineAllowedForDisplayMode(Number(row.parentIndex), target, data.displayMode));
            if (visibleTranslations.some(row => !row.glow || !row.glowMat)) return { ok: false, reason: 'visible translation row missing glow', target };
            if (target < window.lyricsLines.length - 12) {
              const runwayDeadline = performance.now() + 1800;
              const nextTarget = target + 1;
              while (performance.now() < runwayDeadline && !stageLyricPersistentTargetRowsReady(root, nextTarget)) {
                updateStageLyrics3D(1 / 60);
                await new Promise(resolve => requestAnimationFrame(resolve));
              }
              if (stageLyricPersistentTargetRowsReady(root, nextTarget)) adjacentTargetsReady += 1;
              updateStageLyricPersistentResidentBounds(data);
              minimumForwardRunway = Math.min(minimumForwardRunway, Number(data.trackResidentEnd) - target);
            }
            const rowKeys = data.rowLayers.map(row => stageLyricResidentRowKey(row)).filter(Boolean);
            const uniqueKeys = new Set(rowKeys);
            if (uniqueKeys.size !== rowKeys.length) return { ok: false, reason: 'duplicate resident row', target, rowKeys: rowKeys.length, unique: uniqueKeys.size };
            maxResidentPrimary = Math.max(maxResidentPrimary, primaryRows.length);
            maxResidentRows = Math.max(maxResidentRows, data.rowLayers.length);
            maxIndexLag = Math.max(maxIndexLag, Math.abs(Number(data.trackTargetLineIndex) - target));
            const sameTrackOutgoing = (stageLyrics.outgoing || []).filter(mesh => {
              const outgoingData = mesh && mesh.userData && mesh.userData.lyric;
              return outgoingData && outgoingData.trackKey === data.trackKey;
            }).length;
            maxSameTrackOutgoing = Math.max(maxSameTrackOutgoing, sameTrackOutgoing);
            if (stageLyrics.current !== root || root.id !== rootId) return { ok: false, reason: 'persistent root replaced', target, rootId, currentId: stageLyrics.current && stageLyrics.current.id };
          }
          const wholeTrackDeadline = performance.now() + 7000;
          while (performance.now() < wholeTrackDeadline) {
            updateStageLyrics3D(1 / 60);
            await new Promise(resolve => requestAnimationFrame(resolve));
            const data = root.userData && root.userData.lyric;
            wholeSongResident = !!(
              data && data.trackTextRunwayComplete &&
              Number(data.trackResidentPrimaryCount) === window.lyricsLines.length
            );
            const uploadStats = window.__mineradioLyricUploadBudgetStats || {};
            maxUploadConsumed = Math.max(maxUploadConsumed, Number(uploadStats.consumed) || 0, Number(uploadStats.maxConsumed) || 0);
            if (wholeSongResident) break;
          }
          const finalResidentData = root.userData && root.userData.lyric;
          maxResidentPrimary = Math.max(maxResidentPrimary, Number(finalResidentData && finalResidentData.trackResidentPrimaryCount) || 0);
          maxResidentRows = Math.max(maxResidentRows, Number(finalResidentData && finalResidentData.rowLayers && finalResidentData.rowLayers.length) || 0);
          const trackKeyBeforeRefresh = root.userData.lyric.trackKey;
          window.lyricsLines[40].text += ' refreshed-middle';
          invalidateStageLyricPayloadForNewLyrics('qa-middle-refresh');
          const refreshedPayload = buildStageLyricDisplayPayload(40, { lightweightTrack: true });
          if (!refreshedPayload || refreshedPayload.trackKey === trackKeyBeforeRefresh) {
            return { ok: false, reason: 'middle lyric refresh reused old track identity' };
          }
          const longGlowRaster = glowRasterSamples.find(sample => sample && sample.target === 43);
          const shortGlowRaster = glowRasterSamples.find(sample => sample && sample.target === 44);
          const glowRasterPairOk = !!(
            longGlowRaster && shortGlowRaster &&
            longGlowRaster.rasterFontGain >= 1.15 &&
            longGlowRaster.rasterScaleGain >= 1.15 &&
            relativeGlowMetricDrift(longGlowRaster.textureFrameToGlyph, shortGlowRaster.textureFrameToGlyph) <= 0.15 &&
            relativeGlowMetricDrift(longGlowRaster.worldFrameToGlyph, shortGlowRaster.worldFrameToGlyph) <= 0.18 &&
            relativeGlowMetricDrift(longGlowRaster.padToGlyph, shortGlowRaster.padToGlyph) <= 0.22
          );
          return {
            ok: maxSameTrackOutgoing === 0 && maxUploadConsumed <= 1 && maxIndexLag === 0 && wholeSongResident && maxResidentPrimary === window.lyricsLines.length && maxLogicalRowWidth > 2048 && maxGlyphWorldDrift <= 0.035 && minActiveScale >= 0.97 && minimumForwardRunway >= 20 && adjacentTargetsReady >= 3 && glowRasterPairOk,
            rootId,
            maxSameTrackOutgoing,
            maxUploadConsumed,
            maxIndexLag,
            maxResidentPrimary,
            maxResidentRows,
            baselineGlyphWorldH,
            maxGlyphWorldDrift,
            maxLogicalRowWidth,
            minActiveScale,
            minimumForwardRunway,
            adjacentTargetsReady,
            wholeSongResident,
            glowRasterPairOk,
            longGlowRaster,
            shortGlowRaster
          };
        } catch (error) {
          return { ok: false, error: String(error && error.stack || error) };
        } finally {
          if (typeof clearStageLyrics === 'function') clearStageLyrics();
          audio = oldAudio;
          playing = oldPlaying;
          window.lyricsLines = oldLines;
          window.lyricsTranslationLines = oldTranslations;
          if (fx) {
            fx.particleLyrics = oldFx.particleLyrics;
            fx.lyricDisplayMode = oldFx.lyricDisplayMode;
            fx.lyricTranslationMode = oldFx.lyricTranslationMode;
            fx.lyricCustomLineCount = oldFx.lyricCustomLineCount;
            fx.lyricGlow = oldFx.lyricGlow;
            fx.lyricGlowBeat = oldFx.lyricGlowBeat;
            fx.lyricGlowStrength = oldFx.lyricGlowStrength;
            fx.lyricBackgroundAdapt = oldFx.lyricBackgroundAdapt;
          }
          if (stageLyrics) {
            stageLyrics.beatGlow = oldStageGlow.beatGlow;
            stageLyrics.highBloom = oldStageGlow.highBloom;
          }
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
        }
      }
      async function inspectProgressDragLyricContinuity() {
        const oldLines = window.lyricsLines;
        const oldTranslations = window.lyricsTranslationLines;
        const oldAudio = audio;
        const oldPlaying = playing;
        const oldUniformTime = uniforms && uniforms.uTime ? Number(uniforms.uTime.value) || 0 : null;
        const oldDragState = typeof progressDragState !== 'undefined' ? Object.assign({}, progressDragState) : null;
        const oldFx = {
          particleLyrics: fx && fx.particleLyrics,
          lyricDisplayMode: fx && fx.lyricDisplayMode,
          lyricTranslationMode: fx && fx.lyricTranslationMode,
          lyricCustomLineCount: fx && fx.lyricCustomLineCount,
          lyricVerticalFloat: fx && fx.lyricVerticalFloat,
          lyricMotionStyle: fx && fx.lyricMotionStyle
        };
        try {
          if (typeof clearStageLyrics === 'function') clearStageLyrics();
          window.lyricsLines = Array.from({ length: 120 }, (_, idx) => ({
            t: idx * 1.5,
            duration: 1.5,
            text: 'drag primary lyric ' + idx,
            translation: 'drag translation ' + idx,
            charCount: 22
          }));
          window.lyricsTranslationLines = window.lyricsLines.map(line => ({ t: line.t, text: line.translation }));
          fx.particleLyrics = true;
          fx.lyricDisplayMode = 'custom';
          fx.lyricCustomLineCount = 10;
          fx.lyricTranslationMode = 'multi';
          fx.lyricVerticalFloat = false;
          fx.lyricMotionStyle = 'smooth';
          const mediaState = { time: 0.2, duration: 180, seeking: false, readyState: 4, paused: true };
          const dragMedia = new EventTarget();
          dragMedia.src = 'qa://progress-drag-lyrics';
          dragMedia.currentSrc = dragMedia.src;
          dragMedia.ended = false;
          Object.defineProperties(dragMedia, {
            currentTime: {
              configurable: true,
              get: () => mediaState.time,
              set: value => {
                const target = Math.max(0, Math.min(mediaState.duration, Number(value) || 0));
                mediaState.seeking = true;
                mediaState.readyState = 1;
                setTimeout(() => {
                  mediaState.time = target;
                  mediaState.seeking = false;
                  mediaState.readyState = 4;
                  dragMedia.dispatchEvent(new Event('seeked'));
                  dragMedia.dispatchEvent(new Event('timeupdate'));
                  dragMedia.dispatchEvent(new Event('canplay'));
                }, 120);
              }
            },
            duration: { configurable: true, get: () => mediaState.duration },
            seeking: { configurable: true, get: () => mediaState.seeking },
            readyState: { configurable: true, get: () => mediaState.readyState },
            paused: { configurable: true, get: () => mediaState.paused }
          });
          dragMedia.pause = () => { mediaState.paused = true; dragMedia.dispatchEvent(new Event('pause')); };
          dragMedia.play = () => { mediaState.paused = false; dragMedia.dispatchEvent(new Event('playing')); return Promise.resolve(); };
          audio = dragMedia;
          playing = false;
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
          if (typeof createLyricsParticles === 'function') createLyricsParticles();
          const initialPayload = buildStageLyricDisplayPayload(0, { lightweightTrack: true });
          const root = buildLyricMesh(initialPayload);
          stageLyrics.group.add(root);
          stageLyrics.current = root;
          stageLyrics.currentIdx = 0;
          stageLyrics.currentPayload = initialPayload;
          stageLyrics.currentDisplayKey = initialPayload.key;
          initializeStageLyricPersistentTrack(root, initialPayload);
          const rootId = root.id;
          const bar = document.getElementById('progress-bar');
          if (!bar) return { ok: false, reason: 'progress bar missing' };
          const rect = bar.getBoundingClientRect();
          if (!rect.width) return { ok: false, reason: 'progress bar has no width' };
          const pointerId = 77;
          const dispatchPointer = (type, ratio) => {
            bar.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              pointerId,
              pointerType: 'mouse',
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: rect.left + rect.width * ratio,
              clientY: rect.top + rect.height * 0.5
            }));
          };
          const finalTarget = 72;
          const finalRatio = (finalTarget * 1.5 + 0.2) / mediaState.duration;
          let maxResidentPrimaryDuringDrag = 0;
          let maxResidentRowsDuringDrag = 0;
          const sampleResident = () => {
            const residentData = root.userData && root.userData.lyric;
            maxResidentPrimaryDuringDrag = Math.max(maxResidentPrimaryDuringDrag, Number(residentData && residentData.trackResidentPrimaryCount) || 0);
            maxResidentRowsDuringDrag = Math.max(maxResidentRowsDuringDrag, Number(residentData && residentData.rowLayers && residentData.rowLayers.length) || 0);
          };
          const median = values => {
            if (!values.length) return null;
            const sorted = values.slice().sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
          };
          const seenPrimaryRows = new Set();
          let previousVisualOffsetsByKey = new Map();
          let previousContinuousSample = null;
          let continuousSamples = 0;
          let movingFrames = 0;
          let snapFrames = 0;
          let reverseFrames = 0;
          let overshootFrames = 0;
          let maxTrackFollowRatio = 0;
          let maxVisualFollowRatio = 0;
          let maxVisualStep = 0;
          let maxTrackRowsPerFrame = 0;
          let maxVisualRowsPerFrame = 0;
          let maxJoinError = 0;
          const presentationLinesVisited = new Set();
          let previousPresentationLine = null;
          let maxPresentationLineStep = 0;
          let corridorSamples = 0;
          let corridorMissingTextFrames = 0;
          const motionAnomalies = [];
          const sampleContinuousMotion = () => {
            const data = root.userData && root.userData.lyric;
            if (!data || !Array.isArray(data.rowLayers)) return false;
            const lineStepWorld = Math.max(0.001, Number(data.lineWorldStep) || 0.38);
            const primaryRows = data.rowLayers.filter(row => row && row.isPrimary && row.mesh && Number.isFinite(Number(row.virtualIndex)));
            if (!primaryRows.length) return false;
            const visualByRow = primaryRows.map(row => ({
              row,
              key: stageLyricResidentRowKey(row),
              offset: Number(row.virtualIndex) + (Number(row.mesh.position.y) || 0) / lineStepWorld
            })).filter(sample => Number.isFinite(sample.offset));
            const visualOffsetsByKey = new Map(visualByRow.map(sample => [sample.key, sample.offset]));
            const existingOffsets = visualByRow.filter(sample => seenPrimaryRows.has(sample.key)).map(sample => sample.offset);
            const existingMedian = median(existingOffsets);
            if (existingMedian != null) {
              for (const sample of visualByRow) {
                if (!seenPrimaryRows.has(sample.key)) maxJoinError = Math.max(maxJoinError, Math.abs(sample.offset - existingMedian));
              }
            }
            for (const sample of visualByRow) seenPrimaryRows.add(sample.key);
            const visualOffset = median(visualByRow.map(sample => sample.offset));
            const scrollOffset = Number(data.trackScrollOffset);
            const pendingTargetLineIndex = data.trackPendingPayload && Number.isFinite(Number(data.trackPendingPayload.trackIndex))
              ? Number(data.trackPendingPayload.trackIndex)
              : null;
            const targetLineIndex = pendingTargetLineIndex == null ? Number(data.trackTargetLineIndex) : pendingTargetLineIndex;
            const targetVirtualIndex = pendingTargetLineIndex == null && Number.isFinite(Number(data.trackTargetVirtualIndex))
              ? Number(data.trackTargetVirtualIndex)
              : lyricPrimaryVirtualIndex(Number.isFinite(targetLineIndex) ? targetLineIndex : 0);
            const presentationLine = Number(data.trackPresentationLineIndex);
            if (data.trackPreviewCorridorActive && Number.isFinite(presentationLine)) {
              corridorSamples += 1;
              presentationLinesVisited.add(Math.round(presentationLine));
              if (previousPresentationLine != null) maxPresentationLineStep = Math.max(maxPresentationLineStep, Math.abs(presentationLine - previousPresentationLine));
              previousPresentationLine = presentationLine;
              const corridorHasVisibleText = data.rowLayers.some(row => {
                if (!row || !row.isPrimary || !row.mesh || !row.renderLineUploaded || !row.mesh.visible) return false;
                return lyricLineAllowedForDisplayMode(Number(row.lineIndex), presentationLine, data.displayMode);
              });
              if (!corridorHasVisibleText) corridorMissingTextFrames += 1;
            }
            if (!Number.isFinite(scrollOffset) || visualOffset == null || !Number.isFinite(targetVirtualIndex)) return false;
            if (previousContinuousSample) {
              const gap = targetVirtualIndex - previousContinuousSample.scrollOffset;
              const delta = scrollOffset - previousContinuousSample.scrollOffset;
              const lastLineIndex = Math.max(0, window.lyricsLines.length - 1);
              const normalizedTargetLine = Math.max(0, Math.min(lastLineIndex, Math.round(Number(targetLineIndex) || 0)));
              const neighborLineIndex = normalizedTargetLine < lastLineIndex ? normalizedTargetLine + 1 : Math.max(0, normalizedTargetLine - 1);
              const primarySlotStep = Math.max(0.001, Math.abs(lyricPrimaryVirtualIndex(neighborLineIndex) - lyricPrimaryVirtualIndex(normalizedTargetLine)) || 1);
              const renderFrame = Number(window.__mineradioLyricUploadBudgetStats && window.__mineradioLyricUploadBudgetStats.frame) || 0;
              const renderFrameSpan = Math.max(1, renderFrame - Number(previousContinuousSample.renderFrame || 0));
              maxTrackRowsPerFrame = Math.max(maxTrackRowsPerFrame, Math.abs(delta) / primarySlotStep / renderFrameSpan);
              if (Math.abs(gap) > 0.025) {
                const followRatio = Math.abs(delta / gap);
                maxTrackFollowRatio = Math.max(maxTrackFollowRatio, followRatio);
                if (followRatio > 0.72 || (Math.abs(gap) > 0.25 && Math.abs(scrollOffset - targetVirtualIndex) < 0.0001)) {
                  snapFrames += 1;
                  if (motionAnomalies.length < 12) motionAnomalies.push({ type: 'track-snap', gap, delta, followRatio, scrollOffset, targetVirtualIndex });
                }
                const dragDirection = finalTarget >= 0 ? 1 : -1;
                if (delta * dragDirection < -0.0001) {
                  reverseFrames += 1;
                  if (motionAnomalies.length < 12) motionAnomalies.push({ type: 'track-reverse', gap, delta, scrollOffset, targetVirtualIndex });
                }
                const targetHeldStill = Math.abs(targetVirtualIndex - previousContinuousSample.targetVirtualIndex) < 0.0001;
                if (targetHeldStill && (targetVirtualIndex - previousContinuousSample.scrollOffset) * (targetVirtualIndex - scrollOffset) < -0.000001) overshootFrames += 1;
              }
              const visualGap = targetVirtualIndex - previousContinuousSample.visualOffset;
              const stableVisualDeltas = [];
              for (const [key, offset] of visualOffsetsByKey) {
                if (previousVisualOffsetsByKey.has(key)) stableVisualDeltas.push(offset - previousVisualOffsetsByKey.get(key));
              }
              const stableVisualDelta = median(stableVisualDeltas);
              const visualDelta = stableVisualDelta == null ? visualOffset - previousContinuousSample.visualOffset : stableVisualDelta;
              maxVisualStep = Math.max(maxVisualStep, Math.abs(visualDelta));
              maxVisualRowsPerFrame = Math.max(maxVisualRowsPerFrame, Math.abs(visualDelta) / primarySlotStep / renderFrameSpan);
              if (Math.abs(visualGap) > 0.025) {
                maxVisualFollowRatio = Math.max(maxVisualFollowRatio, Math.abs(visualDelta / visualGap));
                const dragDirection = finalTarget >= 0 ? 1 : -1;
                if (visualDelta * dragDirection < -0.0001) {
                  reverseFrames += 1;
                  if (motionAnomalies.length < 12) motionAnomalies.push({ type: 'visual-reverse', visualGap, visualDelta, visualOffset, targetVirtualIndex });
                }
              }
              if (Math.abs(delta) > 0.0005 || Math.abs(visualDelta) > 0.0005) movingFrames += 1;
            }
            previousContinuousSample = {
              scrollOffset,
              visualOffset,
              targetVirtualIndex,
              renderFrame: Number(window.__mineradioLyricUploadBudgetStats && window.__mineradioLyricUploadBudgetStats.frame) || 0
            };
            previousVisualOffsetsByKey = visualOffsetsByKey;
            continuousSamples += 1;
            return true;
          };
          const qaLyricFrame = async () => {
            await new Promise(resolve => requestAnimationFrame(resolve));
          };
          const dragMotionSamples = {
            groupY: [],
            groupScaleY: [],
            rootY: [],
            rootScale: [],
            primaryY: [],
            translationY: [],
            worldPrimaryY: [],
            screenPrimaryY: [],
            screenTranslationY: []
          };
          const primaryWorldPosition = new THREE.Vector3();
          const translationWorldPosition = new THREE.Vector3();
          let maxTrackLockError = 0;
          let maxPrimaryAnchorError = 0;
          let maxEffectYError = 0;
          let unlockedMotionSamples = 0;
          const sampleDragMotion = () => {
            const data = root.userData && root.userData.lyric;
            if (!data || !Array.isArray(data.rowLayers)) return false;
            const primary = data.rowLayers.find(row => row && row.isPrimary && Number(row.lineIndex) === finalTarget && row.mesh);
            const translation = data.rowLayers.find(row => row && row.isTranslation && Number(row.parentIndex) === finalTarget && row.mesh);
            if (!primary || !translation) return false;
            if (camera) camera.updateMatrixWorld(true);
            stageLyrics.group.updateMatrixWorld(true);
            primary.mesh.getWorldPosition(primaryWorldPosition);
            translation.mesh.getWorldPosition(translationWorldPosition);
            dragMotionSamples.groupY.push(Number(stageLyrics.group.position.y) || 0);
            dragMotionSamples.groupScaleY.push(Number(stageLyrics.group.scale.y) || 0);
            dragMotionSamples.rootY.push(Number(root.position.y) || 0);
            dragMotionSamples.rootScale.push(Number(root.scale.x) || 0);
            dragMotionSamples.primaryY.push(Number(primary.mesh.position.y) || 0);
            dragMotionSamples.translationY.push(Number(translation.mesh.position.y) || 0);
            dragMotionSamples.worldPrimaryY.push(Number(primaryWorldPosition.y) || 0);
            dragMotionSamples.screenPrimaryY.push(Number(primaryWorldPosition.clone().project(camera).y) || 0);
            dragMotionSamples.screenTranslationY.push(Number(translationWorldPosition.clone().project(camera).y) || 0);
            if (!root.userData.progressPreviewMotionLocked) unlockedMotionSamples += 1;
            const targetVirtualIndex = lyricPrimaryVirtualIndex(finalTarget);
            maxTrackLockError = Math.max(maxTrackLockError, Math.abs((Number(data.trackScrollOffset) || 0) - targetVirtualIndex));
            maxPrimaryAnchorError = Math.max(maxPrimaryAnchorError, Math.abs(Number(primary.mesh.position.y) || 0));
            if (primary.readability) maxEffectYError = Math.max(maxEffectYError, Math.abs(primary.readability.position.y - primary.mesh.position.y));
            if (primary.glow) maxEffectYError = Math.max(maxEffectYError, Math.abs(primary.glow.position.y - primary.mesh.position.y));
            if (translation.readability) maxEffectYError = Math.max(maxEffectYError, Math.abs(translation.readability.position.y - translation.mesh.position.y));
            if (translation.glow) maxEffectYError = Math.max(maxEffectYError, Math.abs(translation.glow.position.y - translation.mesh.position.y));
            return true;
          };
          const motionSpan = values => values.length ? Math.max(...values) - Math.min(...values) : Infinity;
          dispatchPointer('pointerdown', 0.05);
          const dragRatios = [];
          for (let step = 1; step <= 96; step += 1) dragRatios.push(0.05 + (finalRatio - 0.05) * step / 96);
          for (const ratio of dragRatios) {
            dispatchPointer('pointermove', ratio);
            await qaLyricFrame();
            sampleResident();
            sampleContinuousMotion();
          }
          let dragLockReady = false;
          const dragLockDeadline = performance.now() + 2200;
          while (performance.now() < dragLockDeadline) {
            await qaLyricFrame();
            const lockData = root.userData && root.userData.lyric;
            dragLockReady = !!(
              lockData && !lockData.trackPendingPayload &&
              Number(lockData.trackTargetLineIndex) === finalTarget &&
              stageLyricPersistentTargetRowsReady(root, finalTarget)
            );
            sampleResident();
            sampleContinuousMotion();
            if (dragLockReady) break;
          }
          if (!dragLockReady) return { ok: false, reason: 'drag preview target text timeout' };
          const effectsReadyAtFirstTextCommit = stageLyricPersistentTargetEffectsReady(root, finalTarget);
          let settleErrorIncreases = 0;
          let previousSettleError = Infinity;
          for (let sample = 0; sample < 36; sample += 1) {
            await qaLyricFrame();
            sampleContinuousMotion();
            const settleData = root.userData && root.userData.lyric;
            const settleTargetVirtual = lyricPrimaryVirtualIndex(finalTarget);
            const settleError = Math.abs((Number(settleData && settleData.trackScrollOffset) || 0) - settleTargetVirtual);
            if (settleError > previousSettleError + 0.003) settleErrorIncreases += 1;
            previousSettleError = settleError;
            if (!sampleDragMotion()) return { ok: false, reason: 'drag preview target rows missing during motion sample' };
          }
          const releasedAt = performance.now();
          dispatchPointer('pointerup', finalRatio);
          let previewDroppedBeforeReady = false;
          let maxUploadConsumed = 0;
          let textCommitMs = Infinity;
          let effectsReadyAtTextCommit = effectsReadyAtFirstTextCommit;
          const textDeadline = performance.now() + 2200;
          while (performance.now() < textDeadline) {
            await qaLyricFrame();
            const data = root.userData && root.userData.lyric;
            const textReady = !!(
              data && !data.trackPendingPayload &&
              Number(data.trackTargetLineIndex) === finalTarget &&
              stageLyricPersistentTargetRowsReady(root, finalTarget)
            );
            const preview = typeof getProgressDragPreviewSeconds === 'function' ? getProgressDragPreviewSeconds() : null;
            if (preview == null && !textReady) previewDroppedBeforeReady = true;
            if (preview != null && textReady) sampleDragMotion();
            sampleContinuousMotion();
            const uploadStats = window.__mineradioLyricUploadBudgetStats || {};
            maxUploadConsumed = Math.max(maxUploadConsumed, Number(uploadStats.consumed) || 0, Number(uploadStats.maxConsumed) || 0);
            sampleResident();
            if (textReady) {
              textCommitMs = performance.now() - releasedAt;
              break;
            }
          }
          if (!isFinite(textCommitMs)) return { ok: false, reason: 'drag target text timeout', previewDroppedBeforeReady };
          const dataAtCommit = root.userData && root.userData.lyric;
          const offsets = lyricDisplayOffsetsForMode(dataAtCommit.displayMode);
          for (const offset of offsets) {
            const lineIndex = finalTarget + Math.round(Number(offset) || 0);
            if (lineIndex < 0 || lineIndex >= window.lyricsLines.length) continue;
            const expected = dataAtCommit.rowLayers.filter(row => {
              const rowLineIndex = row && row.isTranslation ? Number(row.parentIndex) : Number(row && row.lineIndex);
              return row && row.mesh && rowLineIndex === lineIndex;
            });
            if (expected.length < 2 || expected.some(row => !row.renderLineUploaded || !row.mesh.visible)) {
              return { ok: false, reason: 'drag committed a partial text window', lineIndex, rows: expected.length };
            }
          }
          let settlementMotionSamples = 0;
          const settlementDeadline = performance.now() + 1800;
          while (performance.now() < settlementDeadline && stageLyricProgressPreviewActive()) {
            await qaLyricFrame();
            if (!stageLyricProgressPreviewActive()) break;
            sampleContinuousMotion();
            if (sampleDragMotion()) settlementMotionSamples += 1;
          }
          const previewReleasedAfterSettlement = !stageLyricProgressPreviewActive();
          const releaseBaselineRootY = Number(root.position.y) || 0;
          const releaseBaselineRootScale = Number(root.scale.x) || 0;
          const releaseBaselineRootRotation = Number(root.rotation.z) || 0;
          const releaseBaselineScreenY = dragMotionSamples.screenPrimaryY.length
            ? dragMotionSamples.screenPrimaryY[dragMotionSamples.screenPrimaryY.length - 1]
            : Infinity;
          await qaLyricFrame();
          const releaseData = root.userData && root.userData.lyric;
          const releasePrimary = releaseData && releaseData.rowLayers && releaseData.rowLayers.find(row => row && row.isPrimary && Number(row.lineIndex) === finalTarget && row.mesh);
          let releaseScreenY = Infinity;
          if (releasePrimary && camera) {
            camera.updateMatrixWorld(true);
            stageLyrics.group.updateMatrixWorld(true);
            releasePrimary.mesh.getWorldPosition(primaryWorldPosition);
            releaseScreenY = Number(primaryWorldPosition.clone().project(camera).y) || 0;
          }
          const releaseRootYDelta = Math.abs((Number(root.position.y) || 0) - releaseBaselineRootY);
          const releaseRootScaleDelta = Math.abs((Number(root.scale.x) || 0) - releaseBaselineRootScale);
          const releaseRootRotationDelta = Math.abs((Number(root.rotation.z) || 0) - releaseBaselineRootRotation);
          const releaseScreenYDelta = Math.abs(releaseScreenY - releaseBaselineScreenY);
          const effectsDeadline = performance.now() + 7000;
          while (performance.now() < effectsDeadline && !stageLyricPersistentTargetEffectsReady(root, finalTarget)) {
            await qaLyricFrame();
            sampleContinuousMotion();
            if (stageLyricProgressPreviewActive()) sampleDragMotion();
            const uploadStats = window.__mineradioLyricUploadBudgetStats || {};
            maxUploadConsumed = Math.max(maxUploadConsumed, Number(uploadStats.consumed) || 0, Number(uploadStats.maxConsumed) || 0);
            sampleResident();
          }
          const effectsReady = stageLyricPersistentTargetEffectsReady(root, finalTarget);
          const data = root.userData && root.userData.lyric;
          const sameTrackOutgoing = (stageLyrics.outgoing || []).filter(mesh => {
            const outgoingData = mesh && mesh.userData && mesh.userData.lyric;
            return outgoingData && outgoingData.trackKey === data.trackKey;
          }).length;
          const groupYDrift = motionSpan(dragMotionSamples.groupY);
          const groupScaleDrift = motionSpan(dragMotionSamples.groupScaleY);
          const rootYDrift = motionSpan(dragMotionSamples.rootY);
          const rootScaleDrift = motionSpan(dragMotionSamples.rootScale);
          const primaryYDrift = motionSpan(dragMotionSamples.primaryY);
          const translationYDrift = motionSpan(dragMotionSamples.translationY);
          const worldPrimaryYDrift = motionSpan(dragMotionSamples.worldPrimaryY);
          const screenPrimaryYDrift = motionSpan(dragMotionSamples.screenPrimaryY);
          const screenTranslationYDrift = motionSpan(dragMotionSamples.screenTranslationY);
          const continuousScrollOk = continuousSamples >= 80 && movingFrames >= 20 &&
            snapFrames === 0 && reverseFrames === 0 && overshootFrames === 0 &&
            maxTrackFollowRatio <= 0.60 && maxVisualFollowRatio <= 0.60 &&
            maxTrackRowsPerFrame <= 0.70 && maxVisualRowsPerFrame <= 0.70 && maxJoinError <= 0.18 &&
            corridorSamples >= 20 && presentationLinesVisited.size >= 20 && maxPresentationLineStep <= 3 && corridorMissingTextFrames === 0 &&
            settleErrorIncreases <= 1 && dragMotionSamples.primaryY.length >= 24 && settlementMotionSamples >= 6 &&
            unlockedMotionSamples === 0 && previewReleasedAfterSettlement &&
            rootYDrift <= 0.0001 && rootScaleDrift <= 0.0001 && maxEffectYError <= 0.05 &&
            releaseRootYDelta <= 0.008 && releaseRootScaleDelta <= 0.008 && releaseRootRotationDelta <= 0.008 && releaseScreenYDelta <= 0.008;
          return {
            ok: !previewDroppedBeforeReady && textCommitMs <= 1400 && effectsReady && continuousScrollOk &&
              stageLyrics.current === root && root.id === rootId && sameTrackOutgoing === 0 &&
              maxUploadConsumed <= 1 && maxResidentPrimaryDuringDrag <= window.lyricsLines.length && Number(data.trackResidentPrimaryCount) <= window.lyricsLines.length,
            rootId,
            finalTarget,
            committedTarget: Number(data.trackTargetLineIndex),
            previewDroppedBeforeReady,
            textCommitMs,
            effectsReadyAtTextCommit,
            effectsReady,
            sameTrackOutgoing,
            maxUploadConsumed,
            maxResidentPrimaryDuringDrag,
            maxResidentRowsDuringDrag,
            residentPrimary: Number(data.trackResidentPrimaryCount) || 0,
            motionSamples: dragMotionSamples.primaryY.length,
            settlementMotionSamples,
            groupYDrift,
            groupScaleDrift,
            rootYDrift,
            rootScaleDrift,
            primaryYDrift,
            translationYDrift,
            worldPrimaryYDrift,
            screenPrimaryYDrift,
            screenTranslationYDrift,
            unlockedMotionSamples,
            previewReleasedAfterSettlement,
            releaseRootYDelta,
            releaseRootScaleDelta,
            releaseRootRotationDelta,
            releaseScreenYDelta,
            maxTrackLockError,
            maxPrimaryAnchorError,
            maxEffectYError,
            continuousScrollOk,
            continuousSamples,
            movingFrames,
            snapFrames,
            reverseFrames,
            overshootFrames,
            maxTrackFollowRatio,
            maxVisualFollowRatio,
            maxVisualStep,
            maxTrackRowsPerFrame,
            maxVisualRowsPerFrame,
            corridorSamples,
            presentationLinesVisited: presentationLinesVisited.size,
            maxPresentationLineStep,
            corridorMissingTextFrames,
            maxJoinError,
            settleErrorIncreases,
            motionAnomalies
          };
        } catch (error) {
          return { ok: false, error: String(error && error.stack || error) };
        } finally {
          if (typeof clearProgressPreviewHold === 'function') clearProgressPreviewHold();
          if (typeof clearStageLyrics === 'function') clearStageLyrics();
          audio = oldAudio;
          playing = oldPlaying;
          window.lyricsLines = oldLines;
          window.lyricsTranslationLines = oldTranslations;
          if (oldDragState && typeof progressDragState !== 'undefined') Object.assign(progressDragState, oldDragState);
          if (oldUniformTime != null && uniforms && uniforms.uTime) uniforms.uTime.value = oldUniformTime;
          if (fx) {
            fx.particleLyrics = oldFx.particleLyrics;
            fx.lyricDisplayMode = oldFx.lyricDisplayMode;
            fx.lyricTranslationMode = oldFx.lyricTranslationMode;
            fx.lyricCustomLineCount = oldFx.lyricCustomLineCount;
            fx.lyricVerticalFloat = oldFx.lyricVerticalFloat;
            fx.lyricMotionStyle = oldFx.lyricMotionStyle;
          }
          if (typeof stageLyricTrackCache !== 'undefined') stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
          if (typeof lyricPrimaryVirtualPrefixCache !== 'undefined') lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
        }
      }
      let persistentLyricQa = null;
      let progressDragLyricQa = null;
      async function waitQaFrame() {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      async function inspectSearchGlassEntrance() {
        const area = document.getElementById('search-area');
        const box = document.getElementById('search-box');
        const map = document.getElementById('search-box-glass-map');
        if (!area || !box || !map || typeof setPeek !== 'function') return { ok: false, reason: 'missing search glass nodes' };
        document.documentElement.classList.remove('startup-fast-skip-preload');
        document.body.classList.remove('startup-fast-skip-revealing', 'splash-active', 'immersive-mode');
        area.classList.remove('peek');
        document.documentElement.classList.remove('search-glass-ready', 'search-glass-priming', 'search-glass-fallback');
        map.removeAttribute('href');
        try { map.removeAttributeNS('http://www.w3.org/1999/xlink', 'href'); } catch (e) {}
        if (typeof updateSearchBoxGlassDisplacementMap === 'function') updateSearchBoxGlassDisplacementMap();
        if (typeof updateSearchPillGlassDisplacementMap === 'function') updateSearchPillGlassDisplacementMap();
        if (typeof applyControlGlassChromaticOffset === 'function') applyControlGlassChromaticOffset();
        const readSearchBoxGlassStyle = () => {
          const areaStyle = getComputedStyle(area);
          const boxStyle = getComputedStyle(box);
          const boxGlassStyle = getComputedStyle(box, '::before');
          const tabs = document.querySelector('#search-area .search-mode-tabs');
          const tabsStyle = tabs ? getComputedStyle(tabs) : null;
          const pill = document.querySelector('#search-area .search-mode-tabs button') || document.querySelector('#search-area .search-history-chip');
          const pillStyle = pill ? getComputedStyle(pill) : null;
          const pillGlassStyle = pill ? getComputedStyle(pill, '::before') : null;
          const boxMap = document.getElementById('search-box-glass-map');
          const pillMap = document.getElementById('search-pill-glass-map');
          const boxFilter = document.getElementById('mineradio-search-box-glass-filter');
          const pillFilter = document.getElementById('mineradio-search-pill-glass-filter');
          const readHref = img => {
            if (!img) return '';
            let href = img.getAttribute('href') || '';
            try { href = href || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''; } catch (e) {}
            return href;
          };
          const readOffsetDx = (filter, result) => {
            const node = filter && filter.querySelector ? filter.querySelector('feOffset[result="' + result + '"]') : null;
            return node ? Number(node.getAttribute('dx')) : NaN;
          };
          const decodeHref = href => {
            try { return decodeURIComponent(href || ''); } catch (e) { return String(href || ''); }
          };
          const boxHref = readHref(boxMap);
          const pillHref = readHref(pillMap);
          const boxHrefText = decodeHref(boxHref);
          const pillHrefText = decodeHref(pillHref);
          return {
            opacity: areaStyle.opacity,
            directFilter: boxStyle.backdropFilter || boxStyle.webkitBackdropFilter || '',
            directBackgroundColor: boxStyle.backgroundColor || '',
            directBorderTopColor: boxStyle.borderTopColor || '',
            directBorderTopWidth: boxStyle.borderTopWidth || '',
            directBoxShadow: boxStyle.boxShadow || '',
            glassContent: boxGlassStyle.content || '',
            glassFilter: boxGlassStyle.backdropFilter || boxGlassStyle.webkitBackdropFilter || '',
            glassBackgroundColor: boxGlassStyle.backgroundColor || '',
            glassBorderTopColor: boxGlassStyle.borderTopColor || '',
            glassBorderTopWidth: boxGlassStyle.borderTopWidth || '',
            glassBoxShadow: boxGlassStyle.boxShadow || '',
            tabsFilter: tabsStyle ? (tabsStyle.backdropFilter || tabsStyle.webkitBackdropFilter || '') : '',
            tabsBackgroundColor: tabsStyle ? (tabsStyle.backgroundColor || '') : '',
            tabsBorderTopColor: tabsStyle ? (tabsStyle.borderTopColor || '') : '',
            tabsBoxShadow: tabsStyle ? (tabsStyle.boxShadow || '') : '',
            pillFilter: pillStyle ? (pillStyle.backdropFilter || pillStyle.webkitBackdropFilter || '') : '',
            pillBackgroundColor: pillStyle ? (pillStyle.backgroundColor || '') : '',
            pillBorderTopColor: pillStyle ? (pillStyle.borderTopColor || '') : '',
            pillBorderTopWidth: pillStyle ? (pillStyle.borderTopWidth || '') : '',
            pillBoxShadow: pillStyle ? (pillStyle.boxShadow || '') : '',
            pillGlassContent: pillGlassStyle ? (pillGlassStyle.content || '') : '',
            pillGlassFilter: pillGlassStyle ? (pillGlassStyle.backdropFilter || pillGlassStyle.webkitBackdropFilter || '') : '',
            pillGlassBackgroundColor: pillGlassStyle ? (pillGlassStyle.backgroundColor || '') : '',
            pillGlassBoxShadow: pillGlassStyle ? (pillGlassStyle.boxShadow || '') : '',
            boxMapIsRgb: boxHref.indexOf('glass-red') > -1 || boxHrefText.indexOf('glass-red') > -1,
            pillMapIsRgb: pillHref.indexOf('glass-blue') > -1 || pillHrefText.indexOf('glass-blue') > -1,
            boxRedDx: readOffsetDx(boxFilter, 'dispRedShifted'),
            boxGreenDx: readOffsetDx(boxFilter, 'dispGreenShifted'),
            boxBlueDx: readOffsetDx(boxFilter, 'dispBlueShifted'),
            pillRedDx: readOffsetDx(pillFilter, 'dispRedShifted'),
            pillGreenDx: readOffsetDx(pillFilter, 'dispGreenShifted'),
            pillBlueDx: readOffsetDx(pillFilter, 'dispBlueShifted')
          };
        };
        const searchBoxFilterLooksLikeSavedRgbGlass = value => String(value || '').includes('mineradio-search-box-glass-filter') && String(value || '').includes('saturate(1)');
        const searchPillFilterLooksLikeSavedRgbGlass = value => String(value || '').includes('mineradio-search-pill-glass-filter') && String(value || '').includes('saturate(1)');
        const searchBoxDirectFilterLooksCleared = value => String(value || '') === 'none';
        const searchBoxMapLooksLikeSavedRgbGlass = value =>
          !!(value && value.boxMapIsRgb) &&
          isFinite(value && value.boxRedDx) &&
          isFinite(value && value.boxGreenDx) &&
          isFinite(value && value.boxBlueDx) &&
          Math.abs((value && value.boxRedDx) + 90) <= 0.5 &&
          Math.abs((value && value.boxGreenDx) + 90) <= 0.5 &&
          Math.abs((value && value.boxBlueDx) + 90) <= 0.5;
        const searchBoxHiddenStyleLooksClear = value =>
          String(value && value.glassContent || '') === 'none' &&
          searchBoxDirectFilterLooksCleared(value && value.directFilter) &&
          String(value && value.directBackgroundColor || '').includes('0, 0, 0, 0') &&
          String(value && value.directBoxShadow || '') === 'none' &&
          searchBoxMapLooksLikeSavedRgbGlass(value);
        const searchBoxVisibleStyleLooksLikeSavedRgbGlass = value =>
          String(value && value.glassContent || '') === 'none' &&
          searchBoxFilterLooksLikeSavedRgbGlass(value && value.directFilter) &&
          String(value && value.directBackgroundColor || '').includes('0, 0, 0') &&
          String(value && value.directBoxShadow || '').includes('inset') &&
          searchBoxMapLooksLikeSavedRgbGlass(value);
        const closedStyle = readSearchBoxGlassStyle();
        const closed = {
          peek: area.classList.contains('peek'),
          ready: document.documentElement.classList.contains('search-glass-ready'),
          priming: document.documentElement.classList.contains('search-glass-priming'),
          fallback: document.documentElement.classList.contains('search-glass-fallback'),
          opacity: closedStyle.opacity,
          directFilter: closedStyle.directFilter,
          directBackgroundColor: closedStyle.directBackgroundColor,
          directBorderTopColor: closedStyle.directBorderTopColor,
          directBorderTopWidth: closedStyle.directBorderTopWidth,
          directBoxShadow: closedStyle.directBoxShadow,
          glassContent: closedStyle.glassContent,
          glassFilter: closedStyle.glassFilter,
          glassBackgroundColor: closedStyle.glassBackgroundColor,
          glassBorderTopColor: closedStyle.glassBorderTopColor,
          glassBorderTopWidth: closedStyle.glassBorderTopWidth,
          glassBoxShadow: closedStyle.glassBoxShadow,
          pillFilter: closedStyle.pillFilter,
          pillBackgroundColor: closedStyle.pillBackgroundColor,
          pillBorderTopColor: closedStyle.pillBorderTopColor,
          pillBorderTopWidth: closedStyle.pillBorderTopWidth,
          pillBoxShadow: closedStyle.pillBoxShadow,
          pillGlassContent: closedStyle.pillGlassContent,
          pillGlassFilter: closedStyle.pillGlassFilter,
          pillGlassBackgroundColor: closedStyle.pillGlassBackgroundColor,
          pillGlassBoxShadow: closedStyle.pillGlassBoxShadow,
          tabsFilter: closedStyle.tabsFilter,
          tabsBackgroundColor: closedStyle.tabsBackgroundColor,
          tabsBorderTopColor: closedStyle.tabsBorderTopColor,
          tabsBoxShadow: closedStyle.tabsBoxShadow,
          boxMapIsRgb: closedStyle.boxMapIsRgb,
          pillMapIsRgb: closedStyle.pillMapIsRgb,
          boxRedDx: closedStyle.boxRedDx,
          boxGreenDx: closedStyle.boxGreenDx,
          boxBlueDx: closedStyle.boxBlueDx,
          pillRedDx: closedStyle.pillRedDx,
          pillGreenDx: closedStyle.pillGreenDx,
          pillBlueDx: closedStyle.pillBlueDx
        };
        setPeek(area, true, 'search');
        const immediateStyle = readSearchBoxGlassStyle();
        const immediate = {
          peek: area.classList.contains('peek'),
          ready: document.documentElement.classList.contains('search-glass-ready'),
          priming: document.documentElement.classList.contains('search-glass-priming'),
          fallback: document.documentElement.classList.contains('search-glass-fallback'),
          opacity: immediateStyle.opacity,
          directFilter: immediateStyle.directFilter,
          directBackgroundColor: immediateStyle.directBackgroundColor,
          directBorderTopColor: immediateStyle.directBorderTopColor,
          directBorderTopWidth: immediateStyle.directBorderTopWidth,
          directBoxShadow: immediateStyle.directBoxShadow,
          glassContent: immediateStyle.glassContent,
          glassFilter: immediateStyle.glassFilter,
          glassBackgroundColor: immediateStyle.glassBackgroundColor,
          glassBorderTopColor: immediateStyle.glassBorderTopColor,
          glassBorderTopWidth: immediateStyle.glassBorderTopWidth,
          glassBoxShadow: immediateStyle.glassBoxShadow,
          pillFilter: immediateStyle.pillFilter,
          pillBackgroundColor: immediateStyle.pillBackgroundColor,
          pillBorderTopColor: immediateStyle.pillBorderTopColor,
          pillBorderTopWidth: immediateStyle.pillBorderTopWidth,
          pillBoxShadow: immediateStyle.pillBoxShadow,
          pillGlassContent: immediateStyle.pillGlassContent,
          pillGlassFilter: immediateStyle.pillGlassFilter,
          pillGlassBackgroundColor: immediateStyle.pillGlassBackgroundColor,
          pillGlassBoxShadow: immediateStyle.pillGlassBoxShadow,
          tabsFilter: immediateStyle.tabsFilter,
          tabsBackgroundColor: immediateStyle.tabsBackgroundColor,
          tabsBorderTopColor: immediateStyle.tabsBorderTopColor,
          tabsBoxShadow: immediateStyle.tabsBoxShadow,
          boxMapIsRgb: immediateStyle.boxMapIsRgb,
          pillMapIsRgb: immediateStyle.pillMapIsRgb,
          boxRedDx: immediateStyle.boxRedDx,
          boxGreenDx: immediateStyle.boxGreenDx,
          boxBlueDx: immediateStyle.boxBlueDx,
          pillRedDx: immediateStyle.pillRedDx,
          pillGreenDx: immediateStyle.pillGreenDx,
          pillBlueDx: immediateStyle.pillBlueDx
        };
        // SVG readiness is asynchronous and the visible opacity transition is
        // 350 ms. Four rAFs can sample the entrance near opacity 0 on a fast
        // machine, so wait for the real visible state with a bounded timeout.
        for (let frame = 0; frame < 36; frame += 1) {
          await waitQaFrame();
          const probeStyle = readSearchBoxGlassStyle();
          if (
            area.classList.contains('peek') &&
            document.documentElement.classList.contains('search-glass-ready') &&
            Number(probeStyle.opacity) > 0.45
          ) break;
        }
        const afterPaintStyle = readSearchBoxGlassStyle();
        const afterPaint = {
          peek: area.classList.contains('peek'),
          ready: document.documentElement.classList.contains('search-glass-ready'),
          priming: document.documentElement.classList.contains('search-glass-priming'),
          fallback: document.documentElement.classList.contains('search-glass-fallback'),
          opacity: afterPaintStyle.opacity,
          directFilter: afterPaintStyle.directFilter,
          directBackgroundColor: afterPaintStyle.directBackgroundColor,
          directBorderTopColor: afterPaintStyle.directBorderTopColor,
          directBorderTopWidth: afterPaintStyle.directBorderTopWidth,
          directBoxShadow: afterPaintStyle.directBoxShadow,
          glassContent: afterPaintStyle.glassContent,
          glassFilter: afterPaintStyle.glassFilter,
          glassBackgroundColor: afterPaintStyle.glassBackgroundColor,
          glassBorderTopColor: afterPaintStyle.glassBorderTopColor,
          glassBorderTopWidth: afterPaintStyle.glassBorderTopWidth,
          glassBoxShadow: afterPaintStyle.glassBoxShadow,
          pillFilter: afterPaintStyle.pillFilter,
          pillBackgroundColor: afterPaintStyle.pillBackgroundColor,
          pillBorderTopColor: afterPaintStyle.pillBorderTopColor,
          pillBorderTopWidth: afterPaintStyle.pillBorderTopWidth,
          pillBoxShadow: afterPaintStyle.pillBoxShadow,
          pillGlassContent: afterPaintStyle.pillGlassContent,
          pillGlassFilter: afterPaintStyle.pillGlassFilter,
          pillGlassBackgroundColor: afterPaintStyle.pillGlassBackgroundColor,
          pillGlassBoxShadow: afterPaintStyle.pillGlassBoxShadow,
          tabsFilter: afterPaintStyle.tabsFilter,
          tabsBackgroundColor: afterPaintStyle.tabsBackgroundColor,
          tabsBorderTopColor: afterPaintStyle.tabsBorderTopColor,
          tabsBoxShadow: afterPaintStyle.tabsBoxShadow,
          boxMapIsRgb: afterPaintStyle.boxMapIsRgb,
          pillMapIsRgb: afterPaintStyle.pillMapIsRgb,
          boxRedDx: afterPaintStyle.boxRedDx,
          boxGreenDx: afterPaintStyle.boxGreenDx,
          boxBlueDx: afterPaintStyle.boxBlueDx,
          pillRedDx: afterPaintStyle.pillRedDx,
          pillGreenDx: afterPaintStyle.pillGreenDx,
          pillBlueDx: afterPaintStyle.pillBlueDx
        };
        const checks = {
          closedHidden: !closed.peek && Number(closed.opacity) < 0.01,
          closedFilterOk: searchBoxDirectFilterLooksCleared(closed.directFilter),
          closedBodyOk: searchBoxHiddenStyleLooksClear(closed),
          immediateHeldBackUntilSvgReady: !immediate.peek && immediate.priming && Number(immediate.opacity) < 0.01,
          immediateFilterOk: searchBoxDirectFilterLooksCleared(immediate.directFilter),
          immediateBodyOk: searchBoxHiddenStyleLooksClear(immediate),
          afterPaintPeek: afterPaint.peek,
          afterPaintReady: afterPaint.ready,
          afterPaintVisible: Number(afterPaint.opacity) > 0.45,
          afterPaintFilterOk: searchBoxFilterLooksLikeSavedRgbGlass(afterPaint.directFilter) && String(afterPaint.glassContent || '') === 'none',
          afterPaintBodyOk: searchBoxVisibleStyleLooksLikeSavedRgbGlass(afterPaint),
          searchPillFilterOk: searchPillFilterLooksLikeSavedRgbGlass(afterPaint.pillFilter),
          searchPillBodyOk: String(afterPaint.pillGlassContent || '') === 'none' &&
            (String(afterPaint.pillBackgroundColor || '').includes('0, 0, 0') ||
            String(afterPaint.pillBackgroundColor || '').includes('255, 255, 255')) &&
            String(afterPaint.pillBorderTopWidth || '') !== '0px' &&
            String(afterPaint.pillBoxShadow || '').includes('inset') &&
            !!afterPaint.pillMapIsRgb &&
            isFinite(afterPaint.pillRedDx) &&
            isFinite(afterPaint.pillGreenDx) &&
            isFinite(afterPaint.pillBlueDx) &&
            Math.abs(afterPaint.pillRedDx + 34) <= 0.5 &&
            Math.abs(afterPaint.pillGreenDx + 34) <= 0.5 &&
            Math.abs(afterPaint.pillBlueDx + 34) <= 0.5,
          searchTabsRailOk: String(afterPaint.tabsFilter || '') === 'none' &&
            String(afterPaint.tabsBackgroundColor || '').includes('0, 0, 0, 0') &&
            String(afterPaint.tabsBorderTopColor || '').includes('0, 0, 0, 0') &&
            String(afterPaint.tabsBoxShadow || '') === 'none'
        };
        setPeek(area, false, 'search');
        return {
          ok: checks.closedHidden &&
            checks.closedFilterOk &&
            checks.closedBodyOk &&
            checks.immediateHeldBackUntilSvgReady &&
            checks.immediateFilterOk &&
            checks.immediateBodyOk &&
            checks.afterPaintPeek &&
            checks.afterPaintReady &&
            checks.afterPaintVisible &&
            checks.afterPaintFilterOk &&
            checks.afterPaintBodyOk &&
            checks.searchPillFilterOk &&
            checks.searchPillBodyOk &&
            checks.searchTabsRailOk,
          checks,
          closed,
          immediate,
          afterPaint
        };
      }
      const searchGlassQa = await inspectSearchGlassEntrance();
      if (!searchGlassQa.ok) failures.push('search glass panel lost the saved RGB SVG material during reveal: ' + JSON.stringify(searchGlassQa));
      persistentLyricQa = await inspectPersistentLyricContinuity();
      if (!persistentLyricQa.ok) failures.push('persistent multi-line lyric continuity failed: ' + JSON.stringify(persistentLyricQa));
      progressDragLyricQa = await inspectProgressDragLyricContinuity();
      if (!progressDragLyricQa.ok) failures.push('real progress drag lyric continuity failed: ' + JSON.stringify(progressDragLyricQa));
      async function inspectAudioGraphMediaHandoff() {
        if (audio || audioCtx || source) return { ok: true, skipped: 'renderer already owns an audio graph' };
        const deckA = new Audio();
        const deckB = new Audio();
        try {
          audio = deckA;
          const firstReady = initAudio();
          const sourceA = source;
          const firstBound = audioSourceMedia === deckA;
          audio = deckB;
          resetPlaybackAudioGraphForSourceSwitch('qa-media-element-handoff');
          const detachedOldSource = source === null && audioSourceMedia === null;
          const secondReady = initAudio();
          const rebound = source && source !== sourceA && audioSourceMedia === deckB && audioGraphHealthy();
          return { ok: !!(firstReady && firstBound && detachedOldSource && secondReady && rebound), firstReady, firstBound, detachedOldSource, secondReady, rebound: !!rebound };
        } catch (error) {
          return { ok: false, error: String(error && error.stack || error) };
        } finally {
          disconnectAudioGraphNodes(false);
          audio = null;
          if (audioCtx && audioCtx.state !== 'closed' && audioCtx.close) {
            try { await audioCtx.close(); } catch (error) {}
          }
          audioCtx = null;
        }
      }
      const audioGraphHandoffQa = await inspectAudioGraphMediaHandoff();
      if (!audioGraphHandoffQa.ok) failures.push('audio analyser did not rebind from deck A to adopted deck B: ' + JSON.stringify(audioGraphHandoffQa));
      return {
        ok: failures.length === 0,
        failures,
        displayHz,
        fpsBeforeBoost,
        fpsAfterBoost,
        fixedFpsCadenceQa,
        lyricTextureQualityQa,
        lyricQualityCacheQa,
        lyricQa,
        persistentLyricQa,
        progressDragLyricQa,
        searchGlassQa,
        audioGraphHandoffQa,
        render: perf && perf.render,
        viewport: runtime && runtime.viewport
      };
    })();
  \`);

  finish(result.ok ? 0 : 1, { ok: result.ok, result, logs: logs.slice(-16) });
}).catch(error => {
  finish(1, { ok: false, error: String(error && error.stack || error), logs });
});
`;
}

function runElectronRuntimeCheck() {
  logStep('Electron runtime smoke check');
  const electron = electronExecutable();
  if (!electron) fail('Electron executable not found. Run npm install first.');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-quick-check-'));
  const qaScript = path.join(tempDir, 'qa-renderer-check.js');
  const qaPreload = path.join(tempDir, 'qa-preload.js');
  fs.writeFileSync(qaScript, runtimeQaScript(), 'utf8');
  fs.writeFileSync(qaPreload, `
try {
  window.localStorage.setItem('mineradio-startup-fast-skip-v1', 'true');
  window.localStorage.removeItem('mineradio-cuefield-automix-v1');
} catch (error) {}
`, 'utf8');

  try {
    const result = spawnSync(electron, [qaScript], {
      cwd: appRoot,
      env: { ...process.env, MINERADIO_QA_APP_ROOT: appRoot, MINERADIO_QA_PRELOAD: qaPreload },
      encoding: 'utf8',
      timeout: 45000
    });
    if (result.error) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      fail(String(result.error.message || result.error));
    }
    const match = String(result.stdout || '').match(/MINERADIO_QA_RESULT:(\{.*\})/);
    const payload = match ? JSON.parse(match[1]) : null;
    if (result.status !== 0 || !payload || payload.ok !== true) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      fail(`Electron runtime smoke check failed. Exit code: ${result.status}`);
    }
    const qa = payload.result || {};
    const render = qa.render || {};
    const searchGlass = qa.searchGlassQa || {};
    const lyricTextureQuality = qa.lyricTextureQualityQa || {};
    const lyricQualityCache = qa.lyricQualityCacheQa || {};
    const fixedFpsCadence = qa.fixedFpsCadenceQa || {};
    const persistentLyrics = qa.persistentLyricQa || {};
    const progressDragLyrics = qa.progressDragLyricQa || {};
    const afterPaint = searchGlass.afterPaint || {};
    console.log('[OK] Electron runtime smoke check passed.');
    console.log(`     displayHz=${Math.round((qa.displayHz || 0) * 10) / 10}, fps=${qa.fpsBeforeBoost}, boost=${qa.fpsAfterBoost}, mode=${render.mode || 'unknown'}`);
    console.log(`     fixedFpsCadence: ${(fixedFpsCadence.profiles || []).map(profile => `${profile.hz}Hz/${profile.target}=${Math.round(profile.actual * 10) / 10}`).join(', ') || 'n/a'}, dragCap=${!!fixedFpsCadence.fixedPreserved}, vsyncWake=${!!fixedFpsCadence.vsyncCanWake}`);
    console.log(`     lyricTextureQuality: ${(lyricTextureQuality.rows || []).map(row => `${row.tier}x=${row.width}x${row.height}`).join(', ') || 'n/a'}`);
    console.log(`     lyricQualityCache: rows=${lyricQualityCache.firstRows || 0}/${lyricQualityCache.maxRows || 0}, bytes=${lyricQualityCache.firstBytes || 0}, stable=${!!lyricQualityCache.stable}, expiredOverBudget=${!!lyricQualityCache.startedOverNewBudget}, noBaseFlash=${lyricQualityCache.sawBase === false}, noDisposeRevive=${!!lyricQualityCache.noDisposeResurrection}, tier=${lyricQualityCache.newTier || 0}`);
    console.log(`     persistentLyrics: root=${persistentLyrics.rootId || 'n/a'}, sameTrackOutgoing=${persistentLyrics.maxSameTrackOutgoing}, upload/frame=${persistentLyrics.maxUploadConsumed}, indexLag=${persistentLyrics.maxIndexLag}, residentPrimary=${persistentLyrics.maxResidentPrimary}, runway=${persistentLyrics.minimumForwardRunway}, logicalWidth=${persistentLyrics.maxLogicalRowWidth}, fontDrift=${Math.round((persistentLyrics.maxGlyphWorldDrift || 0) * 1000) / 10}%, activeScale=${Math.round((persistentLyrics.minActiveScale || 0) * 1000) / 1000}`);
    console.log(`     progressDragLyrics: root=${progressDragLyrics.rootId || 'n/a'}, commit=${Math.round(progressDragLyrics.textCommitMs || 0)}ms, previewGap=${!!progressDragLyrics.previewDroppedBeforeReady}, samples=${progressDragLyrics.continuousSamples || 0}, moving=${progressDragLyrics.movingFrames || 0}, snaps=${progressDragLyrics.snapFrames || 0}, reverse=${progressDragLyrics.reverseFrames || 0}, trackRows/frame=${Math.round((progressDragLyrics.maxTrackRowsPerFrame || 0) * 1000) / 1000}, visualRows/frame=${Math.round((progressDragLyrics.maxVisualRowsPerFrame || 0) * 1000) / 1000}, corridor=${progressDragLyrics.presentationLinesVisited || 0} lines/${progressDragLyrics.corridorMissingTextFrames || 0} blank, join=${Math.round((progressDragLyrics.maxJoinError || 0) * 1000) / 1000}, upload/frame=${progressDragLyrics.maxUploadConsumed}`);
    console.log(`     searchGlass: boxDirect=${afterPaint.directFilter || 'n/a'}, boxBefore=${afterPaint.glassFilter || 'n/a'}, pillDirect=${afterPaint.pillFilter || 'n/a'}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function removeOwnedStartupQaDirectory(target, parent, expectedLeaf) {
  if (!target || !parent || !expectedLeaf) return;
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (path.dirname(resolvedTarget) !== resolvedParent || path.basename(resolvedTarget) !== expectedLeaf) {
    fail(`Refusing to remove unexpected startup QA path: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function runMainStartupRecoveryCheck() {
  logStep('Real main-entry startup recovery check');
  if (process.platform !== 'win32') {
    console.log('[SKIP] Real main-entry startup recovery check is Windows-specific.');
    return;
  }
  const electron = electronExecutable();
  if (!electron) fail('Electron executable not found. Run npm install first.');
  const appData = process.env.APPDATA;
  if (!appData) fail('APPDATA is required for the real main-entry startup recovery check');
  const runtimeName = `MineradioStartupQA-${process.pid}-${Date.now()}`;
  const qaUserData = path.join(appData, runtimeName);
  const stateFile = path.join(qaUserData, 'startup-state.json');
  const qaSessionData = path.join('D:\\MineradioCache\\chromium', runtimeName);
  try {
    const result = spawnSync(electron, [appRoot], {
      cwd: appRoot,
      env: {
        ...process.env,
        MINERADIO_RUNTIME_NAME: runtimeName,
        MINERADIO_APP_USER_MODEL_ID: 'com.mineradio.startup.qa',
        MINERADIO_NO_DESKTOP_SHORTCUT: '1',
        MINERADIO_STARTUP_TEST_SERVER_DELAY_MS: '4500',
        MINERADIO_STARTUP_TEST_FAIL_FIRST_NAV: '1',
        MINERADIO_STARTUP_QA_HIDDEN: '1',
        MINERADIO_STARTUP_QA_EXIT_MS: '700',
      },
      encoding: 'utf8',
      timeout: 40000,
    });
    if (result.error || result.status !== 0 || !fs.existsSync(stateFile)) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      fail(`Real main-entry startup QA failed: ${result.error && result.error.message || `exit=${result.status}`}`);
    }
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const events = Array.isArray(state.events) ? state.events : [];
    const firstAt = phase => {
      const event = events.find(item => item && item.phase === phase);
      return event ? Number(event.at) || 0 : 0;
    };
    const windowCreatedAt = firstAt('window-created');
    const windowVisibleAt = firstAt('window-visible');
    const serverReadyAt = firstAt('server-ready');
    const retryAt = firstAt('navigation-retry');
    const readyAt = firstAt('ready');
    if (
      state.phase !== 'ready'
      || !windowCreatedAt
      || !windowVisibleAt
      || !serverReadyAt
      || !retryAt
      || !readyAt
      || windowVisibleAt >= serverReadyAt
      || readyAt <= retryAt
      || windowVisibleAt - Number(state.startedAt || 0) > 5000
    ) {
      fail(`Real main-entry startup recovery invariants failed: ${JSON.stringify({ state, windowCreatedAt, windowVisibleAt, serverReadyAt, retryAt, readyAt })}`);
    }
    console.log(`[OK] Startup shell visible in ${windowVisibleAt - state.startedAt}ms, before delayed server at ${serverReadyAt - state.startedAt}ms; injected first navigation failure recovered and reached ready in ${readyAt - state.startedAt}ms.`);
  } finally {
    if (fs.existsSync(qaUserData)) removeOwnedStartupQaDirectory(qaUserData, appData, runtimeName);
    const qaSessionParent = path.dirname(qaSessionData);
    if (fs.existsSync(qaSessionData)) removeOwnedStartupQaDirectory(qaSessionData, qaSessionParent, runtimeName);
  }
}

async function checkLargePlaylistVirtualizationGuard() {
  logStep('Large playlist virtualization and progressive queue guard');
  const detailText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '02-playlist-detail.js'), 'utf8');
  const loaderText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '03-podcast-playlist-loaders.js'), 'utf8');
  const shelfText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '04-shelf', '01-manager-core.js'), 'utf8');
  const shelfContentText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '04-shelf', '03-content-list-manager.js'), 'utf8');
  const qishuiText = fs.readFileSync(path.join(appRoot, 'qishui-api.js'), 'utf8');
  const serverText = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');
  const cssText = fs.readFileSync(path.join(appRoot, 'public', 'css', 'index.css'), 'utf8');

  if (!/fetchNeteaseUserPlaylistsPage/.test(serverText) || !/nextOffset/.test(serverText) || !/hasMore/.test(serverText)) {
    fail('Netease playlist catalog must expose real offset pagination');
  }
  if (!/neteasePlaylistTrackIndexCache/.test(serverText) || !/fetchNeteasePlaylistTrackIndex/.test(serverText) || !/NETEASE_TRACK_STREAM_PAGE_SIZE/.test(serverText)) {
    fail('Netease large-playlist pages must reuse one bounded track-id index instead of reparsing the whole playlist per page');
  }
  if (/targetCount\s*=\s*Math\.min\(240/.test(qishuiText) || !/qishuiWebPlaylistCursorCache/.test(qishuiText)) {
    fail('Qishui playlist pagination must not stop at 240 and must reuse cursor state');
  }
  if (!/function rebindShelfCard/.test(shelfText) || !/function rebindContentRow/.test(shelfContentText)) {
    fail('3D shelf cards and detail rows must reuse their GPU-backed objects');
  }
  const detailScrollerStart = detailText.indexOf('function bindPlaylistPanelDetailScroller');
  const detailScrollerEnd = detailText.indexOf('async function loadMorePlaylistPanelDetailTracks', detailScrollerStart);
  if (detailScrollerStart < 0 || detailScrollerEnd < 0 || /addEventListener\(['"]scroll/.test(detailText.slice(detailScrollerStart, detailScrollerEnd))) {
    fail('expanded playlist detail must share the outer playlist-panel scroll axis');
  }
  if (!/#playlist-panel \.pl-inline-detail[\s\S]*?overflow:\s*visible/.test(cssText) || !/#playlist-panel \.pl-card\.expanded::before/.test(cssText)) {
    fail('continuous expanded playlist detail and its highlighted group styling are missing');
  }
  const detailStickyRules = Array.from(cssText.matchAll(/#playlist-panel\s+\.pl-detail-sticky\s*\{([^}]*)\}/g));
  const detailStickyCss = detailStickyRules.length ? detailStickyRules[detailStickyRules.length - 1][1] : '';
  if (!/\bposition:\s*sticky\b/.test(detailStickyCss) || !/\btop:\s*(?!auto\b)[^;}]+/.test(detailStickyCss) || /\bposition:\s*(?:relative|static)\b|\btop:\s*auto\b/.test(detailStickyCss)) {
    fail('expanded playlist summary must stay sticky on the outer playlist-panel scroll axis');
  }
  const detailListRules = Array.from(cssText.matchAll(/#playlist-panel\s+\.pl-detail-list\s*\{([^}]*)\}/g));
  const detailListCss = detailListRules.length ? detailListRules[detailListRules.length - 1][1] : '';
  if (!/\boverflow:\s*visible\b/.test(detailListCss) || /\boverflow-y:\s*(?:auto|scroll)\b/.test(detailListCss)) {
    fail('expanded playlist tracks must keep the single outer scroll axis');
  }
  const shelfSync = shelfText.slice(shelfText.indexOf('function syncRenderedWindow'), shelfText.indexOf('function rebuild'));
  const contentSync = shelfContentText.slice(shelfContentText.indexOf('function syncRenderedRows'), shelfContentText.indexOf('return {', shelfContentText.indexOf('function syncRenderedRows')));
  if (/disposeRenderedCards\(\);\s*renderedStart\s*=\s*start/.test(shelfSync) || /disposeRows\(\);\s*renderedStart\s*=\s*start/.test(contentSync)) {
    fail('3D virtual windows must not dispose the whole GPU pool while scrolling');
  }

  const queueWindowStart = detailText.indexOf('function queuePanelVirtualWindow');
  const queueWindowEnd = detailText.indexOf('function scheduleQueuePanelVirtualRender', queueWindowStart);
  if (queueWindowStart < 0 || queueWindowEnd < 0) fail('queue virtual window helper missing');
  const queueWindowSandbox = { QUEUE_VIRTUAL_ROW_STEP: 62, QUEUE_VIRTUAL_OVERSCAN: 8, Math, Number };
  vm.runInNewContext(detailText.slice(queueWindowStart, queueWindowEnd), queueWindowSandbox, { filename: 'playlist-queue-window.js' });
  const queueWindow = queueWindowSandbox.queuePanelVirtualWindow(null, { clientHeight: 620, scrollTop: 62 * 9988 }, 10000, true, -1);
  if (queueWindow.end - queueWindow.start > 32 || queueWindow.start < 9950 || queueWindow.end !== 10000) {
    fail(`10k queue virtual window is too large or cannot reach the tail: ${JSON.stringify(queueWindow)}`);
  }

  const detailRowsStart = detailText.indexOf('function playlistPanelDetailRowsHtml');
  const detailRowsEnd = detailText.indexOf('var PLAYLIST_REORDER_STORE_KEY', detailRowsStart);
  if (detailRowsStart < 0 || detailRowsEnd < 0) fail('playlist detail virtual row helper missing');
  const detailRowsSandbox = {
    playlistPanelDetailState: {
      loading: false,
      loadingMore: false,
      tracks: Array.from({ length: 10000 }, (_, index) => ({ id: index, name: 'Track ' + index, artist: 'Artist' })),
      total: 10000,
      hasMore: false,
      error: '',
      message: ''
    },
    PLAYLIST_DETAIL_ROW_STEP: 56,
    PLAYLIST_DETAIL_VIRTUAL_OVERSCAN: 7,
    PLAYLIST_DETAIL_INITIAL_RENDER: 96,
    window: { innerHeight: 900 },
    songCoverSrc: () => '',
    escHtml: value => String(value == null ? '' : value),
    Math,
    Number,
    String
  };
  vm.runInNewContext(detailText.slice(detailRowsStart, detailRowsEnd), detailRowsSandbox, { filename: 'playlist-detail-rows.js' });
  const detailRowsHtml = detailRowsSandbox.playlistPanelDetailRowsHtml({ viewport: 620, scrollTop: 56 * 9988 });
  const detailRowIndexes = Array.from(detailRowsHtml.matchAll(/data-pl-detail-row="(\d+)"/g), match => Number(match[1]));
  const detailSpacerCount = (detailRowsHtml.match(/class="pl-detail-virtual-spacer"/g) || []).length;
  if (detailRowIndexes.length > 26 || detailRowIndexes[detailRowIndexes.length - 1] !== 9999 || detailSpacerCount !== 2) {
    fail(`10k playlist detail virtual window regressed: ${JSON.stringify({ rows: detailRowIndexes.length, last: detailRowIndexes[detailRowIndexes.length - 1], spacers: detailSpacerCount })}`);
  }

  const catalogStart = detailText.indexOf('var playlistPanelVirtualCache');
  const catalogEnd = detailText.indexOf('function playlistCatalogFooterHtml', catalogStart);
  if (catalogStart < 0 || catalogEnd < 0) fail('playlist catalog virtual entry helper missing');
  const catalogSandbox = {
    playlistCatalogRevision: 1,
    userPlaylists: Array.from({ length: 5000 }, (_, index) => ({ provider: 'netease', id: String(index + 1), name: 'Playlist ' + index })),
    playlistPanelDetailState: { key: '', loading: false, tracks: [], total: 0, error: '' },
    normalizePlaylistProvider: provider => ['qq', 'kugou', 'qishui', 'spotify'].includes(provider) ? provider : 'netease',
    playlistCardPriority: () => 1,
    playlistPanelKey: (provider, id) => provider + ':' + id,
    window: { innerHeight: 900 },
    Math,
    Number
  };
  vm.runInNewContext(detailText.slice(catalogStart, catalogEnd), catalogSandbox, { filename: 'playlist-catalog-window.js' });
  const catalogStarted = process.hrtime.bigint();
  const catalog = catalogSandbox.playlistPanelBuildVirtualEntries();
  const catalogMs = Number(process.hrtime.bigint() - catalogStarted) / 1e6;
  const visibleTop = Math.max(0, catalog.totalHeight - 620);
  const catalogWindowStart = catalogSandbox.playlistPanelOffsetIndex(catalog.offsets, Math.max(0, visibleTop - 760));
  const catalogWindowEnd = Math.min(catalog.entries.length, catalogSandbox.playlistPanelOffsetIndex(catalog.offsets, visibleTop + 620 + 760) + 1);
  if (catalog.entries.length !== 5001 || catalogWindowEnd - catalogWindowStart > 72 || catalogWindowEnd !== catalog.entries.length || catalogMs > 120) {
    fail(`5k playlist catalog virtualization missed its scale budget: ${JSON.stringify({ entries: catalog.entries.length, window: catalogWindowEnd - catalogWindowStart, end: catalogWindowEnd, ms: catalogMs })}`);
  }

  const hydrateStart = loaderText.indexOf('function playlistQueueSource');
  const hydrateEnd = loaderText.indexOf('async function loadPlaylistIntoQueueById', hydrateStart);
  if (hydrateStart < 0 || hydrateEnd < 0) fail('progressive playlist queue helper missing');
  const seed = Array.from({ length: 96 }, (_, id) => ({ id, name: 'Track ' + id }));
  const hydrateSandbox = {
    playQueue: seed,
    queueHydrationState: null,
    PLAYLIST_QUEUE_INITIAL_BATCH_SIZE: 96,
    PLAYLIST_QUEUE_BACKGROUND_BATCH_SIZE: 160,
    PLAYLIST_QUEUE_PLAYBACK_AHEAD_THRESHOLD: 96,
    playlistTracksEndpoint: (provider, id, params) => `${provider}:${id}?offset=${params.offset}&limit=${params.limit}`,
    apiJson: async url => {
      const offset = Number((url.match(/offset=(\d+)/) || [])[1]) || 0;
      const limit = Number((url.match(/limit=(\d+)/) || [])[1]) || 0;
      const count = Math.max(0, Math.min(limit, 10000 - offset));
      return {
        tracks: Array.from({ length: count }, (_, index) => ({ id: offset + index, name: 'Track ' + (offset + index) })),
        total: 10000,
        nextOffset: offset + count,
        hasMore: offset + count < 10000
      };
    },
    cloneSong: song => Object.assign({}, song),
    markSongsLiked: () => {},
    syncLikeStatusForSongs: () => {},
    safeRenderQueuePanel: () => {},
    scheduleShelfRebuild: () => { hydrateSandbox.shelfRebuilds += 1; },
    shuffleArrayInPlace: rows => rows,
    playMode: 'loop',
    setTimeout: () => { hydrateSandbox.autoSchedules += 1; return hydrateSandbox.autoSchedules; },
    clearTimeout: () => {},
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Promise,
    autoSchedules: 0,
    shelfRebuilds: 0
  };
  hydrateSandbox.queueHydrationState = {
    token: 7,
    active: true,
    loading: false,
    provider: 'netease',
    playlistId: 'scale-test',
    sourceId: 'scale-test',
    total: 10000,
    nextOffset: 96,
    hasMore: true,
    loaded: 96,
    error: '',
    promise: null,
    timer: 0,
    queueRef: seed,
    liked: false,
    warmPagesRemaining: 1,
    pausedForBuffer: false
  };
  vm.runInNewContext(loaderText.slice(hydrateStart, hydrateEnd), hydrateSandbox, { filename: 'playlist-progressive-queue.js' });
  let pages = 1;
  await hydrateSandbox.hydratePlaylistQueueNextPage('initial-warm-page');
  if (hydrateSandbox.playQueue.length !== 256 || !hydrateSandbox.queueHydrationState.active || hydrateSandbox.autoSchedules !== 0 || hydrateSandbox.shelfRebuilds !== 0) {
    fail(`10k queue must stop after one bounded warm page: ${JSON.stringify({ length: hydrateSandbox.playQueue.length, active: hydrateSandbox.queueHydrationState.active, autoSchedules: hydrateSandbox.autoSchedules, shelfRebuilds: hydrateSandbox.shelfRebuilds })}`);
  }
  while (hydrateSandbox.queueHydrationState.active && pages < 64) {
    await hydrateSandbox.hydratePlaylistQueueNextPage('queue-browse-tail');
    pages += 1;
  }
  const ids = hydrateSandbox.playQueue.map(song => song.id);
  if (ids.length !== 10000 || new Set(ids).size !== 10000 || ids[0] !== 0 || ids[9999] !== 9999 || pages > 63) {
    fail(`10k progressive queue did not complete in order: ${JSON.stringify({ length: ids.length, unique: new Set(ids).size, first: ids[0], last: ids[9999], pages })}`);
  }
  console.log(`[OK] 5k catalog=${catalogMs.toFixed(2)}ms/window ${catalogWindowEnd - catalogWindowStart}; 10k queue=1 warm + ${pages - 1} on-demand pages/window ${queueWindow.end - queueWindow.start}; one outer detail scroll; 3D pools retained.`);
}

module.exports = {
  runElectronRuntimeCheck, runMainStartupRecoveryCheck
};
