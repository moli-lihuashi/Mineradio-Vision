/**
 * Step A：noSyncBuild / demand-prewarm / upgrade（酷狗适配版）
 * - 不用作者 coop 整曲建轨；prewarm 只异步建 lightweight 窗 mesh
 * - 换行优先 setLyricTrackTarget / takePrewarm；否则轻量同步；重 payload 可 defer
 * 依赖：14c stageLyricPrewarm、14b buildStageLyricDisplayPayload、13 buildLyricMesh / setLyricTrackTarget
 */

function stageLyricPayloadIsSingleLine(payload) {
  if (!payload) return true;
  var mode = typeof normalizeLyricDisplayMode === 'function'
    ? normalizeLyricDisplayMode(payload.mode)
    : payload.mode;
  return mode === 'single';
}

function stageLyricPreparedKey(payload) {
  if (typeof normalizeStageLyricPayload === 'function') payload = normalizeStageLyricPayload(payload);
  if (!payload || !payload.key) return '';
  return [
    payload.key,
    payload.trackKey || '',
    payload.trackStart == null ? '' : payload.trackStart,
    payload.trackEnd == null ? '' : payload.trackEnd,
    payload.trackLightweight ? 'light' : 'full',
    Array.isArray(payload.trackEntries) ? payload.trackEntries.length : 0
  ].join('::');
}

function disposeStageLyricPrewarmMesh() {
  if (typeof stageLyricPrewarm === 'undefined' || !stageLyricPrewarm) return;
  if (stageLyricPrewarm.timer) {
    clearTimeout(stageLyricPrewarm.timer);
    stageLyricPrewarm.timer = 0;
  }
  if (stageLyricPrewarm.workTimer) {
    clearTimeout(stageLyricPrewarm.workTimer);
    stageLyricPrewarm.workTimer = 0;
  }
  if (stageLyricPrewarm.workRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(stageLyricPrewarm.workRaf);
    stageLyricPrewarm.workRaf = 0;
  }
  if (stageLyricPrewarm.mesh && typeof disposeLyricMesh === 'function') {
    try { disposeLyricMesh(stageLyricPrewarm.mesh); } catch (_) {}
    stageLyricPrewarm.mesh = null;
  }
  stageLyricPrewarm.build = null;
  stageLyricPrewarm.key = '';
  stageLyricPrewarm.targetIndex = null;
  stageLyricPrewarm.lightweight = false;
  stageLyricPrewarm.dueAt = 0;
  stageLyricPrewarm.token = (Number(stageLyricPrewarm.token) || 0) + 1;
}

function stageLyricMeshCanServePayload(mesh, payload) {
  if (!mesh || !mesh.userData || !mesh.userData.lyric || !payload) return false;
  var data = mesh.userData.lyric;
  if (!data.usesTrack || !data.rowLayers || !data.rowLayers.length) return false;
  if (!payload.trackLightweight && data.trackLightweight) return false;
  if (!payload.trackKey || data.trackKey !== payload.trackKey) return false;
  if (payload.trackIndex == null || !isFinite(Number(payload.trackIndex))) return false;
  var targetLineIndex = Number(payload.trackIndex);
  if (data.trackStart != null && isFinite(Number(data.trackStart)) && targetLineIndex < Number(data.trackStart)) return false;
  if (data.trackEnd != null && isFinite(Number(data.trackEnd)) && targetLineIndex > Number(data.trackEnd)) return false;
  return true;
}

function stageLyricPrewarmCanServePayload(payload) {
  if (typeof stageLyricPrewarm === 'undefined' || !stageLyricPrewarm || !stageLyricPrewarm.mesh) return false;
  var key = stageLyricPreparedKey(payload);
  if (key && stageLyricPrewarm.key === key) return true;
  return stageLyricMeshCanServePayload(stageLyricPrewarm.mesh, payload);
}

function takeStageLyricPrewarmMesh(payload) {
  if (typeof stageLyricPrewarm === 'undefined' || !stageLyricPrewarm || !stageLyricPrewarm.mesh) return null;
  var key = stageLyricPreparedKey(payload);
  if (key && stageLyricPrewarm.key === key) {
    var exact = stageLyricPrewarm.mesh;
    stageLyricPrewarm.mesh = null;
    stageLyricPrewarm.key = '';
    stageLyricPrewarm.targetIndex = null;
    stageLyricPrewarm.dueAt = 0;
    return exact;
  }
  if (
    payload && payload.trackKey &&
    stageLyricMeshCanServePayload(stageLyricPrewarm.mesh, payload) &&
    typeof setLyricTrackTarget === 'function' &&
    setLyricTrackTarget(stageLyricPrewarm.mesh, payload)
  ) {
    var trackMesh = stageLyricPrewarm.mesh;
    stageLyricPrewarm.mesh = null;
    stageLyricPrewarm.key = '';
    stageLyricPrewarm.targetIndex = null;
    stageLyricPrewarm.dueAt = 0;
    return trackMesh;
  }
  return null;
}

/** 重 payload（非整曲轻量）且当前/预热都伺候不了 → 推迟同步建轨 */
function shouldDeferStageLyricSyncBuild(payload, redrawOnly) {
  if (redrawOnly || !payload || !lyricsLines || !lyricsLines.length) return false;
  if (stageLyricPayloadIsSingleLine(payload)) return false;
  if (payload.trackLightweight) return false;
  if (stageLyrics && stageLyrics.current && stageLyricMeshCanServePayload(stageLyrics.current, payload)) return false;
  if (stageLyricPrewarmCanServePayload(payload)) return false;
  return true;
}

function scheduleStageLyricDemandMeshPrewarm(index, reason, delay) {
  if (typeof stageLyricPrewarm === 'undefined' || !stageLyricPrewarm) return false;
  if (!lyricsLines || !lyricsLines.length) return false;
  if (typeof buildStageLyricDisplayPayload !== 'function' || typeof buildLyricMesh !== 'function') return false;
  index = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(Number(index) || 0)));
  var wait = delay == null ? 24 : Number(delay);
  if (!isFinite(wait)) wait = 24;
  wait = Math.max(0, wait);
  if (stageLyricPrewarm.workTimer) clearTimeout(stageLyricPrewarm.workTimer);
  var token = (Number(stageLyricPrewarm.token) || 0) + 1;
  stageLyricPrewarm.token = token;
  stageLyricPrewarm.targetIndex = index;
  stageLyricPrewarm.lightweight = true;
  stageLyricPrewarm.dueAt = stageLyricNowMs() + wait;
  stageLyricPrewarm.workTimer = setTimeout(function () {
    stageLyricPrewarm.workTimer = 0;
    if (token !== stageLyricPrewarm.token) return;
    if (!stageLyricWantRowLayers || !stageLyricWantRowLayers()) return;
    var payload = null;
    try {
      payload = buildStageLyricDisplayPayload(index, { lightweightTrack: true });
      if (payload && typeof normalizeStageLyricPayload === 'function') payload = normalizeStageLyricPayload(payload);
    } catch (_) { payload = null; }
    if (!payload || !payload.trackEntries || !payload.trackEntries.length) return;
    var key = stageLyricPreparedKey(payload);
    if (stageLyricPrewarm.mesh && stageLyricPrewarm.key === key) return;
    if (stageLyricPrewarm.mesh && typeof disposeLyricMesh === 'function') {
      try { disposeLyricMesh(stageLyricPrewarm.mesh); } catch (_) {}
      stageLyricPrewarm.mesh = null;
    }
    var mesh = null;
    try { mesh = buildLyricMesh(payload); } catch (err) {
      console.warn('[row-layers] demand prewarm build failed:', reason || '', err);
      return;
    }
    if (token !== stageLyricPrewarm.token) {
      if (mesh && typeof disposeLyricMesh === 'function') disposeLyricMesh(mesh);
      return;
    }
    if (typeof applyLyricPaletteToMesh === 'function') {
      try { applyLyricPaletteToMesh(mesh); } catch (_) {}
    }
    mesh.userData.payload = payload;
    stageLyricPrewarm.mesh = mesh;
    stageLyricPrewarm.key = key;
    stageLyricPrewarm.lightweight = true;
    stageLyricPrewarm.targetIndex = index;
  }, wait);
  return true;
}

function requestStageLyricDemandPrewarm(payload) {
  if (!payload) return;
  var idx = payload.trackIndex != null && isFinite(Number(payload.trackIndex))
    ? Number(payload.trackIndex)
    : (stageLyrics && stageLyrics.currentIdx);
  if (!isFinite(Number(idx))) return;
  idx = Math.round(Number(idx));
  var reason = payload.trackLightweight ? 'track-demand-light' : 'track-demand';
  if (typeof scheduleStageLyricPrewarmForIndex === 'function') {
    scheduleStageLyricPrewarmForIndex(idx, reason, payload.trackLightweight ? 16 : 24);
  }
  scheduleStageLyricDemandMeshPrewarm(idx, reason, 16);
  var nextIdx = idx + 1;
  if (lyricsLines && nextIdx < lyricsLines.length) {
    scheduleStageLyricDemandMeshPrewarm(nextIdx, 'track-demand-next', 48);
  }
  if (payload.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
    scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 120);
  }
}

/** 轻量轨 → persistent ensure（酷狗升级路径）
 * 仅当 current 仍是 trackLightweight 时才升级；
 * 禁止对已 persistent / 已 reveal 的轨用另一份 lightweight prewarm 换轨（会空窗）。
 */
function upgradeCurrentStageLyricFromPreparedTrack(reason) {
  if (!stageLyrics || !stageLyrics.current || stageLyrics.currentIdx < 0) return false;
  if (typeof stageLyricMultiLineWarmupLoad === 'function' && !stageLyricMultiLineWarmupLoad()) return false;
  if (stageLyricPayloadIsSingleLine(stageLyrics.currentPayload)) return false;
  var data = stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  if (!data) return false;
  var idx = Number(stageLyrics.currentIdx);
  if (!isFinite(idx)) return false;

  // 已挂 persistent：只 ensure 滑窗，绝不换 root mesh
  if (data.trackPersistent) {
    if (typeof ensureStageLyricPersistentTrackRows === 'function') {
      ensureStageLyricPersistentTrackRows(stageLyrics.current, idx, { reason: reason || 'upgrade-ensure' });
      return true;
    }
    return false;
  }

  // 仍轻量：优先升成 persistent（同 mesh），不要拿下一行的 prewarm 顶掉当前
  if (data.trackLightweight || data.usesTrack) {
    if (typeof initializeStageLyricPersistentTrack === 'function') {
      try {
        initializeStageLyricPersistentTrack(
          stageLyrics.current,
          stageLyrics.currentPayload || stageLyrics.current.userData.payload
        );
      } catch (_) {}
    }
    if (typeof scheduleStageLyricFullTrackWarmup === 'function') {
      scheduleStageLyricFullTrackWarmup(reason || 'lightweight-upgrade', 96);
    }
    return true;
  }
  return false;
}
