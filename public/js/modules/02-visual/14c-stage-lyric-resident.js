// P2：resident ensure/trim + reveal-ready + warmup/prewarm（对照 14-stage-lyrics-rendering）
// 依赖：14b track helpers、12 beginLyricRowLayerGroupBuild、13 setLyricTrackTarget

var stageLyricResidentBuild = { job: null, timer: 0, raf: 0, token: 0 };
var stageLyricResidentDemand = { timer: 0, mesh: null, targetIndex: -1, options: null };
var stageLyricFullTrackWarmupTimer = 0;
var stageLyricFullTrackWarmupTargetAt = 0;
var stageLyricPrewarm = { timer: 0, workTimer: 0, workRaf: 0, build: null, mesh: null, key: '', token: 0, targetIndex: null, lightweight: false, dueAt: 0 };

function stageLyricNowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function stageLyricShouldYieldToPendingInput() {
  try {
    return !!(
      typeof navigator !== 'undefined' && navigator.scheduling && typeof navigator.scheduling.isInputPending === 'function' &&
      navigator.scheduling.isInputPending({ includeContinuous: true })
    );
  } catch (e) {
    return false;
  }
}

function stageLyricCurrentUsesPersistentTrack() {
  var data = stageLyrics && stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  return !!(data && data.trackPersistent);
}

function stageLyricCurrentUsesLightweightTrack() {
  var data = stageLyrics && stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  return !!(data && data.trackLightweight);
}

function stageLyricMultiLineWarmupLoad() {
  var mode = typeof normalizeLyricDisplayMode === 'function'
    ? normalizeLyricDisplayMode(fx && fx.lyricDisplayMode)
    : (fx && fx.lyricDisplayMode);
  return mode !== 'single';
}

function clearStageLyricFullTrackWarmup() {
  if (stageLyricFullTrackWarmupTimer) {
    clearTimeout(stageLyricFullTrackWarmupTimer);
    stageLyricFullTrackWarmupTimer = 0;
  }
  stageLyricFullTrackWarmupTargetAt = 0;
}


function updateStageLyricPersistentResidentBounds(data) {
  if (!data || !Array.isArray(data.rowLayers)) return;
  var start = Infinity;
  var end = -Infinity;
  var count = 0;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    if (!row || !row.isPrimary || row.lineIndex == null || !isFinite(Number(row.lineIndex))) continue;
    var lineIndex = Math.round(Number(row.lineIndex));
    start = Math.min(start, lineIndex);
    end = Math.max(end, lineIndex);
    count += 1;
  }
  data.trackResidentStart = isFinite(start) ? start : 0;
  data.trackResidentEnd = isFinite(end) ? end : -1;
  data.trackResidentPrimaryCount = count;
}

function cancelStageLyricResidentBuild() {
  cancelStageLyricResidentDemand();
  if (stageLyricResidentBuild.timer) clearTimeout(stageLyricResidentBuild.timer);
  if (stageLyricResidentBuild.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(stageLyricResidentBuild.raf);
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  stageLyricResidentBuild.token += 1;
  var job = stageLyricResidentBuild.job;
  stageLyricResidentBuild.job = null;
  if (job && job.state) {
    if (typeof cancelLyricRowLayerGroupBuild === 'function') cancelLyricRowLayerGroupBuild(job.state);
    else if (job.state.root) disposeLyricMesh(job.state.root);
  }
  if (typeof window !== 'undefined' && window.__mineradioLyricResidentStats) {
    window.__mineradioLyricResidentStats.active = false;
  }
}

function cancelStageLyricResidentDemand() {
  if (stageLyricResidentDemand.timer) clearTimeout(stageLyricResidentDemand.timer);
  stageLyricResidentDemand.timer = 0;
  stageLyricResidentDemand.mesh = null;
  stageLyricResidentDemand.targetIndex = -1;
  stageLyricResidentDemand.options = null;
}

function scheduleStageLyricResidentDemand(mesh, targetIndex, options) {
  stageLyricResidentDemand.mesh = mesh;
  stageLyricResidentDemand.targetIndex = targetIndex;
  stageLyricResidentDemand.options = options || {};
  if (stageLyricProgressPreviewActive()) stageLyricResidentDemand.options.interactive = true;
  if (stageLyricResidentDemand.timer) return true;
  stageLyricResidentDemand.timer = setTimeout(function () {
    var demandMesh = stageLyricResidentDemand.mesh;
    var demandTarget = stageLyricResidentDemand.targetIndex;
    var demandOptions = stageLyricResidentDemand.options || {};
    var coalescedOptions = {};
    for (var optionKey in demandOptions) coalescedOptions[optionKey] = demandOptions[optionKey];
    coalescedOptions.urgent = false;
    coalescedOptions.coalesced = true;
    cancelStageLyricResidentDemand();
    ensureStageLyricPersistentTrackRows(demandMesh, demandTarget, coalescedOptions);
  }, 48);
  return true;
}

function buildStageLyricResidentPayload(index, start, end, options) {
  options = options || {};
  if (!lyricsLines || !lyricsLines.length) return null;
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var last = lyricsLines.length - 1;
  start = Math.max(0, Math.min(last, Math.round(Number(start) || 0)));
  end = Math.max(start, Math.min(last, Math.round(Number(end) || start)));
  index = Math.max(start, Math.min(end, Math.round(Number(index) || start)));
  var entries = [];
  var activeLine = 0;
  for (var i = start; i <= end; i++) {
    var entry = stageLyricTrackBaseEntry(i);
    if (!entry) continue;
    if (i === index) activeLine = entries.length;
    entries.push(entry);
  }
  if (!entries.length) return null;
  var translated = applyLyricTranslationModeToTrackEntries(entries, activeLine, entries.length * 2 + 2);
  return {
    mode: mode,
    key: 'resident|' + stageLyricTrackKeyForMode(mode) + '|' + start + '-' + end + '|' + index,
    activeLine: translated.activeLine,
    entries: translated.entries,
    trackIndex: index,
    trackKey: stageLyricTrackKeyForMode(mode),
    trackEntries: translated.entries,
    trackStart: start,
    trackEnd: end,
    trackLightweight: true,
    trackTextOnly: options.textOnly === true
  };
}

function disposeStageLyricResidentRow(row) {
  if (!row) return;
  if (typeof releaseLyricRowQuality === 'function') releaseLyricRowQuality(row, true);
  if (row.mesh) disposeLyricMesh(row.mesh);
  if (row.readability) disposeLyricMesh(row.readability);
  if (row.glow) disposeLyricMesh(row.glow);
}

function alignStageLyricResidentEffectToRow(row, effect, zOffset) {
  if (!row || !row.mesh || !effect) return;
  effect.position.copy(row.mesh.position);
  effect.position.z += Number(zOffset) || 0;
  effect.scale.copy(row.mesh.scale);
}

function stageLyricResidentTransformSnapshot(data) {
  data = data || {};
  var previewMotionLock = typeof stageLyricProgressPreviewActive === 'function' && stageLyricProgressPreviewActive();
  var pendingLineIndex = data.trackPendingPayload && isFinite(Number(data.trackPendingPayload.trackIndex))
    ? Number(data.trackPendingPayload.trackIndex)
    : null;
  var targetLineIndex = previewMotionLock && pendingLineIndex != null
    ? pendingLineIndex
    : (isFinite(Number(data.trackTargetLineIndex)) ? Number(data.trackTargetLineIndex) : 0);
  var targetVirtualIndex = previewMotionLock
    ? lyricPrimaryVirtualIndex(targetLineIndex)
    : (isFinite(Number(data.trackTargetVirtualIndex)) ? Number(data.trackTargetVirtualIndex) : lyricPrimaryVirtualIndex(targetLineIndex));
  var sharedScrollOffset = isFinite(Number(data.trackScrollOffset)) ? Number(data.trackScrollOffset) : targetVirtualIndex;
  var displayedScrollOffset = stageLyricResidentDisplayedScrollOffset(data, sharedScrollOffset);
  return {
    previewMotionLock: previewMotionLock,
    targetLineIndex: targetLineIndex,
    targetVirtualIndex: targetVirtualIndex,
    // Resident rows join the coordinate system that is on screen *now*.
    // Pending/final targets only choose what to build; using them as the
    // birth coordinate makes late rows fly in from another scroll phase.
    scrollOffset: displayedScrollOffset
  };
}

function primeStageLyricResidentRowTransform(data, row, transformSnapshot) {
  if (!data || !row || !row.mesh) return;
  var snapshot = transformSnapshot || stageLyricResidentTransformSnapshot(data);
  var targetLineIndex = Number(snapshot.targetLineIndex) || 0;
  var targetVirtualIndex = isFinite(Number(snapshot.targetVirtualIndex)) ? Number(snapshot.targetVirtualIndex) : lyricPrimaryVirtualIndex(targetLineIndex);
  var scrollOffset = isFinite(Number(snapshot.scrollOffset)) ? Number(snapshot.scrollOffset) : targetVirtualIndex;
  var lineStepWorld = clampRange(Number(data.lineWorldStep) || 0.38, 0.20, 0.94);
  var translationLineStepWorld = clampRange(Number(data.translationLineStepWorld) || lineStepWorld, 0.20, 0.78);
  var rowVirtualIndex = isFinite(Number(row.virtualIndex)) ? Number(row.virtualIndex) : targetVirtualIndex;
  var rowLineIndex = isFinite(Number(row.lineIndex)) ? Number(row.lineIndex) : null;
  var isActive = !!row.isPrimary && rowLineIndex === targetLineIndex;
  var parentIndex = row.isTranslation
    ? (isFinite(Number(row.parentIndex)) ? Number(row.parentIndex) : rowLineIndex)
    : null;
  var currentTranslation = row.isTranslation && parentIndex === targetLineIndex;
  var visibilityAbs = row.isTranslation && parentIndex != null
    ? Math.abs(lyricPrimaryVirtualIndex(parentIndex) - scrollOffset)
    : Math.abs(rowVirtualIndex - scrollOffset);
  var yTarget = -(rowVirtualIndex - scrollOffset) * lineStepWorld;
  if (row.isTranslation) {
    yTarget = lyricTranslationAnchoredY(row, rowVirtualIndex, targetVirtualIndex, lineStepWorld, translationLineStepWorld, scrollOffset, 0, currentTranslation, true);
  }
  var zTarget = 0.055 - Math.pow(Math.min(5.5, visibilityAbs), 1.06) * 0.145 + (currentTranslation ? 0.065 : 0);
  var scaleDistance = isActive || currentTranslation ? 0 : visibilityAbs;
  var scaleTarget = clampRange(1 - Math.min(5.5, scaleDistance) * 0.026, 0.84, 1.02);
  if (row.isTranslation) {
    scaleTarget *= clampRange(Number(row.fontScale) || 1, 0.72, 1.34);
    if (currentTranslation) scaleTarget *= 1.16;
  }
  row.mesh.position.set(0, yTarget, zTarget);
  row.mesh.scale.setScalar(scaleTarget);
  alignStageLyricResidentEffectToRow(row, row.readability, -0.012);
  alignStageLyricResidentEffectToRow(row, row.glow, -0.030);
}

function mergeStageLyricResidentBundle(mesh, bundle) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !bundle || !Array.isArray(bundle.rows)) return 0;
  var existing = {};
  for (var i = 0; i < data.rowLayers.length; i++) {
    var existingKey = stageLyricResidentRowKey(data.rowLayers[i]);
    if (existingKey) existing[existingKey] = data.rowLayers[i];
  }
  var added = 0;
  var textParent = data.contextGroup || data.rowLayerGroup;
  var effectParent = data.readabilityGroup || data.rowLayerGroup;
  var transformSnapshot = stageLyricResidentTransformSnapshot(data);
  for (var ri = 0; ri < bundle.rows.length; ri++) {
    var row = bundle.rows[ri];
    var key = stageLyricResidentRowKey(row);
    var existingRow = key ? existing[key] : null;
    if (existingRow) {
      if (!existingRow.readability && row.readability) {
        if (row.readability.parent) row.readability.parent.remove(row.readability);
        effectParent.add(row.readability);
        existingRow.readability = row.readability;
        existingRow.readabilityMat = row.readabilityMat;
        existingRow.renderReadabilityUploaded = false;
        alignStageLyricResidentEffectToRow(existingRow, existingRow.readability, -0.012);
        row.readability = null;
        row.readabilityMat = null;
      }
      if (!existingRow.glow && row.glow) {
        if (row.glow.parent) row.glow.parent.remove(row.glow);
        effectParent.add(row.glow);
        existingRow.glow = row.glow;
        existingRow.glowMat = row.glowMat;
        existingRow.renderGlowUploaded = false;
        alignStageLyricResidentEffectToRow(existingRow, existingRow.glow, -0.030);
        row.glow = null;
        row.glowMat = null;
      }
      disposeStageLyricResidentRow(row);
      continue;
    }
    if (!key) {
      disposeStageLyricResidentRow(row);
      continue;
    }
    existing[key] = row;
    if (row.mesh) {
      if (row.mesh.parent) row.mesh.parent.remove(row.mesh);
      textParent.add(row.mesh);
    }
    if (row.readability) {
      if (row.readability.parent) row.readability.parent.remove(row.readability);
      effectParent.add(row.readability);
    }
    if (row.glow) {
      if (row.glow.parent) row.glow.parent.remove(row.glow);
      effectParent.add(row.glow);
    }
    row.renderWindowActive = false;
    row.renderRevealAt = 0;
    primeStageLyricResidentRowTransform(data, row, transformSnapshot);
    data.rowLayers.push(row);
    added += 1;
  }
  data.rowLayers.sort(function (a, b) {
    var av = isFinite(Number(a && a.virtualIndex)) ? Number(a.virtualIndex) : 0;
    var bv = isFinite(Number(b && b.virtualIndex)) ? Number(b.virtualIndex) : 0;
    return av - bv;
  });
  if (bundle.group) disposeLyricMesh(bundle.group);
  updateStageLyricPersistentResidentBounds(data);
  return added;
}

function finishStageLyricResidentBuild(job) {
  if (!job || stageLyricResidentBuild.job !== job) return;
  stageLyricResidentBuild.job = null;
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  var bundle = finishLyricRowLayerGroupBuild(job.state);
  var data = job.mesh && job.mesh.userData && job.mesh.userData.lyric;
  if (!bundle || !data || !data.trackPersistent || stageLyrics.current !== job.mesh || data.trackKey !== job.trackKey) {
    if (bundle && bundle.group) disposeLyricMesh(bundle.group);
    return;
  }
  var added = mergeStageLyricResidentBundle(job.mesh, bundle);
  var demandIndex = data.trackPendingPayload && data.trackPendingPayload.trackIndex != null
    ? Number(data.trackPendingPayload.trackIndex)
    : Number(data.trackTargetLineIndex);
  if (!data.trackPendingPayload) trimStageLyricPersistentTrackRows(job.mesh, demandIndex);
  else if (job.interactive && job.textOnly && stageLyricProgressPreviewActive()) {
    // A long pointer drag can finish several now-stale text-only windows before
    // the newest demand is ready. Keep the committed window plus the newest
    // preview window, instead of retaining every row crossed by the pointer.
    trimStageLyricPersistentTrackRows(job.mesh, demandIndex, {
      interactive: true,
      preserveTargetIndex: data.trackTargetLineIndex
    });
  }
  // Keep extending the cheap text runway first.  Once it is complete,
  // ensureStageLyricPersistentTrackRows schedules effects only for the visible
  // window, so effect work can never split the continuous scrolling track.
  ensureStageLyricPersistentTrackRows(job.mesh, demandIndex, {
    reason: 'persistent-track-continue',
    urgent: !!data.trackPendingPayload,
    interactive: !!(job.interactive || stageLyricProgressPreviewActive())
  });
  if (typeof window !== 'undefined') {
    window.__mineradioLyricResidentStats = {
      active: !!stageLyricResidentBuild.job,
      rootId: job.mesh.id,
      trackKey: data.trackKey,
      residentStart: data.trackResidentStart,
      residentEnd: data.trackResidentEnd,
      residentPrimaryCount: data.trackResidentPrimaryCount,
      residentRows: data.rowLayers.length,
      lastAddedRows: added,
      lastBuildMs: Math.max(0, stageLyricNowMs() - job.startedAt)
    };
  }
}

function runStageLyricResidentBuild(job) {
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  if (!job || stageLyricResidentBuild.job !== job || job.token !== stageLyricResidentBuild.token) return;
  var data = job.mesh && job.mesh.userData && job.mesh.userData.lyric;
  if (!data || !data.trackPersistent || stageLyrics.current !== job.mesh || data.trackKey !== job.trackKey) {
    cancelStageLyricResidentBuild();
    return;
  }
  if (stageLyricShouldYieldToPendingInput() && !job.interactive && !job.textOnly) {
    scheduleStageLyricResidentBuildWork(job, 12);
    return;
  }
  var startedAt = stageLyricNowMs();
  var phaseLimit = job.textOnly ? 8 : (job.interactive ? 5 : 2);
  var phaseBudget = job.textOnly ? 2.8 : (job.interactive ? 3.4 : 4.2);
  var done = stepLyricRowLayerGroupBuild(job.state, phaseLimit, phaseBudget);
  var chunkMs = stageLyricNowMs() - startedAt;
  job.maxChunkMs = Math.max(job.maxChunkMs, chunkMs);
  if (done) {
    finishStageLyricResidentBuild(job);
    return;
  }
  scheduleStageLyricResidentBuildWork(job, chunkMs >= 4.2 ? 8 : 0);
}

function scheduleStageLyricResidentBuildWork(job, delay) {
  if (!job || stageLyricResidentBuild.job !== job) return;
  delay = Math.max(0, Number(delay) || 0);
  var queue = function () {
    stageLyricResidentBuild.timer = 0;
    if (!job || stageLyricResidentBuild.job !== job) return;
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      stageLyricResidentBuild.raf = requestAnimationFrame(function () {
        stageLyricResidentBuild.raf = 0;
        runStageLyricResidentBuild(job);
      });
    } else {
      stageLyricResidentBuild.timer = setTimeout(function () { runStageLyricResidentBuild(job); }, 12);
    }
  };
  if (delay > 0) stageLyricResidentBuild.timer = setTimeout(queue, delay);
  else queue();
}

function startStageLyricResidentBuild(mesh, targetIndex, start, end, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent) return false;
  cancelStageLyricResidentBuild();
  var payload = buildStageLyricResidentPayload(targetIndex, start, end, { textOnly: options.textOnly === true });
  if (!payload) return false;
  var maskLayout = data.persistentMaskLayout || { fontSize: 128, lineHeight: 138 };
  var state = beginLyricRowLayerGroupBuild(payload, maskLayout, Number(data.worldW) || 6.10, Number(data.worldH) || 1.2, stageLyrics.palette, lyricMotionProfile());
  // Resident chunks are extensions of one continuous track.  Reuse the
  // original track spacing instead of recalculating it from a compact raster.
  if (state && isFinite(Number(data.lineWorldStep))) state.lineStepWorld = Number(data.lineWorldStep);
  if (state && isFinite(Number(data.translationLineStepWorld))) state.translationLineStepWorld = Number(data.translationLineStepWorld);
  var job = {
    mesh: mesh,
    trackKey: data.trackKey,
    targetIndex: targetIndex,
    start: start,
    end: end,
    reason: options.reason || '',
    textOnly: options.textOnly === true,
    effectsOnly: options.effectsOnly === true,
    interactive: options.interactive === true,
    state: state,
    token: stageLyricResidentBuild.token,
    startedAt: stageLyricNowMs(),
    maxChunkMs: 0
  };
  stageLyricResidentBuild.job = job;
  if (typeof window !== 'undefined') {
    window.__mineradioLyricResidentStats = {
      active: true,
      rootId: mesh.id,
      trackKey: data.trackKey,
      buildStart: start,
      buildEnd: end,
      reason: job.reason,
      residentPrimaryCount: data.trackResidentPrimaryCount,
      residentRows: data.rowLayers.length
    };
  }
  scheduleStageLyricResidentBuildWork(job, 0);
  return true;
}

function stageLyricPersistentLineRowsResident(data, lineIndex, rowMap) {
  lineIndex = Math.round(Number(lineIndex));
  if (!isFinite(lineIndex) || !lyricsLines || lineIndex < 0 || lineIndex >= lyricsLines.length) return true;
  var entry = stageLyricTrackBaseEntry(lineIndex);
  if (!entry) return true;
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  if (!rowMap[lineIndex + '|primary']) return false;
  if (
    normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' &&
    makeStageLyricTranslationEntry(entry, false) &&
    !rowMap[lineIndex + '|translation']
  ) return false;
  return true;
}

function stageLyricPersistentLineEffectsResident(data, lineIndex, rowMap) {
  lineIndex = Math.round(Number(lineIndex));
  if (!isFinite(lineIndex) || !lyricsLines || lineIndex < 0 || lineIndex >= lyricsLines.length) return true;
  var entry = stageLyricTrackBaseEntry(lineIndex);
  if (!entry) return true;
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  var primary = rowMap[lineIndex + '|primary'];
  if (!primary || !primary.readability || !primary.glow) return false;
  if (normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' && makeStageLyricTranslationEntry(entry, false)) {
    var translation = rowMap[lineIndex + '|translation'];
    if (!translation || !translation.readability || !translation.glow) return false;
  }
  return true;
}

function stageLyricPersistentNextTextRunwayRange(data, targetIndex, rowMap) {
  if (!data || !lyricsLines || !lyricsLines.length) return null;
  var last = lyricsLines.length - 1;
  targetIndex = Math.max(0, Math.min(last, Math.round(Number(targetIndex) || 0)));
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  var nextIndex = -1;
  var previousIndex = -1;
  for (var next = targetIndex; next <= last; next++) {
    if (lyricLineDisplayTextAt(next) && !stageLyricPersistentLineRowsResident(data, next, rowMap)) {
      nextIndex = next;
      break;
    }
  }
  for (var previous = targetIndex - 1; previous >= 0; previous--) {
    if (lyricLineDisplayTextAt(previous) && !stageLyricPersistentLineRowsResident(data, previous, rowMap)) {
      previousIndex = previous;
      break;
    }
  }
  if (nextIndex < 0 && previousIndex < 0) {
    data.trackTextRunwayComplete = true;
    data.trackTextRunwayReadyAt = stageLyricNowMs();
    return null;
  }
  data.trackTextRunwayComplete = false;
  var preferPrevious = data.trackTextRunwayDirection === 'previous';
  var usePrevious = previousIndex >= 0 && (nextIndex < 0 || preferPrevious);
  data.trackTextRunwayDirection = usePrevious ? 'next' : 'previous';
  var chunkSize = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) === 'off' ? 36 : 24;
  if (usePrevious) {
    return {
      start: Math.max(0, previousIndex - chunkSize + 1),
      end: previousIndex
    };
  }
  return {
    start: nextIndex,
    end: Math.min(last, nextIndex + chunkSize - 1)
  };
}

function commitStageLyricPersistentPendingTarget(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  var payload = data && data.trackPendingPayload;
  if (!payload || payload.trackIndex == null || !stageLyricPersistentTargetRowsReady(mesh, payload.trackIndex)) return false;
  return setLyricTrackTarget(mesh, payload);
}

function ensureStageLyricPersistentTrackRows(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !lyricsLines || !lyricsLines.length || stageLyrics.current !== mesh) return false;
  var last = lyricsLines.length - 1;
  targetIndex = Math.max(0, Math.min(last, Math.round(Number(targetIndex) || 0)));
  var residentRowMap = stageLyricPersistentResidentRowMap(data);
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var minOffset = 0;
  var maxOffset = 0;
  for (var oi = 0; oi < offsets.length; oi++) {
    minOffset = Math.min(minOffset, Math.round(Number(offsets[oi]) || 0));
    maxOffset = Math.max(maxOffset, Math.round(Number(offsets[oi]) || 0));
  }
  var interactivePreview = !!(options.interactive || stageLyricProgressPreviewActive());
  // Normal playback keeps a long, text-only runway similar to the private
  // build's continuous track, without paying its 200+ row startup cost.
  var desiredStart = Math.max(0, targetIndex + minOffset - (interactivePreview ? 4 : 6));
  var desiredEnd = Math.min(last, targetIndex + maxOffset + (interactivePreview ? 10 : 24));
  var visibleStart = Math.max(0, targetIndex + minOffset);
  var visibleEnd = Math.min(last, targetIndex + maxOffset);
  var targetMissing = !stageLyricPersistentLineRowsResident(data, targetIndex, residentRowMap);
  var firstVisibleMissing = -1;
  for (var visibleIndex = visibleStart; visibleIndex <= visibleEnd; visibleIndex++) {
    if (lyricLineDisplayTextAt(visibleIndex) && !stageLyricPersistentLineRowsResident(data, visibleIndex, residentRowMap)) { firstVisibleMissing = visibleIndex; break; }
  }
  var firstMissing = firstVisibleMissing;
  if (firstMissing < 0) {
    for (var i = desiredStart; i <= desiredEnd; i++) {
      if (lyricLineDisplayTextAt(i) && !stageLyricPersistentLineRowsResident(data, i, residentRowMap)) { firstMissing = i; break; }
    }
  }
  if (firstMissing < 0) {
    var firstEffectsMissing = -1;
    for (var effectIndex = visibleStart; effectIndex <= visibleEnd; effectIndex++) {
      if (lyricLineDisplayTextAt(effectIndex) && !stageLyricPersistentLineEffectsResident(data, effectIndex, residentRowMap)) {
        firstEffectsMissing = effectIndex;
        break;
      }
    }
    cancelStageLyricResidentDemand();
    if (firstEffectsMissing >= 0) {
      var effectJob = stageLyricResidentBuild.job;
      if (effectJob && effectJob.mesh === mesh) {
        if (!effectJob.textOnly && effectJob.start <= visibleStart && effectJob.end >= visibleEnd) return true;
        cancelStageLyricResidentBuild();
      }
      return startStageLyricResidentBuild(mesh, targetIndex, visibleStart, visibleEnd, {
        reason: options.reason || 'persistent-track-visible-effects',
        effectsOnly: true,
        interactive: interactivePreview
      });
    }
    // Once the visible window is complete, keep extending the cheap text-only
    // track in the background until the whole song is resident.  This restores
    // the private build's one-piece scroll without paying for off-screen glow
    // and readability layers.
    if (!interactivePreview && !data.trackPendingPayload) {
      var activeRunwayJob = stageLyricResidentBuild.job;
      if (activeRunwayJob && activeRunwayJob.mesh === mesh) return true;
      var runwayRange = stageLyricPersistentNextTextRunwayRange(data, targetIndex, residentRowMap);
      if (runwayRange) {
        return startStageLyricResidentBuild(mesh, targetIndex, runwayRange.start, runwayRange.end, {
          reason: options.reason || 'persistent-track-full-text-runway',
          textOnly: true,
          interactive: false
        });
      }
    }
    trimStageLyricPersistentTrackRows(mesh, targetIndex);
    return true;
  }
  if (options.urgent && !options.coalesced && stageLyricProgressPreviewActive()) {
    return scheduleStageLyricResidentDemand(mesh, targetIndex, options);
  }
  cancelStageLyricResidentDemand();
  var buildStart = firstVisibleMissing >= 0 ? visibleStart : firstMissing;
  var buildEnd = firstVisibleMissing >= 0 ? visibleEnd : buildStart;
  var usable = 0;
  for (var initialIndex = buildStart; initialIndex <= buildEnd; initialIndex++) {
    if (lyricLineDisplayTextAt(initialIndex) && !stageLyricPersistentLineRowsResident(data, initialIndex, residentRowMap)) usable += 1;
  }
  var chunkLimit = interactivePreview ? Math.max(8, offsets.length) : Math.max(28, offsets.length);
  if (!interactivePreview || firstVisibleMissing < 0) {
    while (buildEnd < desiredEnd && usable < chunkLimit) {
      buildEnd += 1;
      if (lyricLineDisplayTextAt(buildEnd) && !stageLyricPersistentLineRowsResident(data, buildEnd, residentRowMap)) usable += 1;
    }
  }
  buildEnd = Math.max(buildStart, Math.min(last, buildEnd));
  var activeJob = stageLyricResidentBuild.job;
  if (activeJob && activeJob.mesh === mesh) {
    var activeCoversVisibleWindow = activeJob.start <= visibleStart && activeJob.end >= visibleEnd;
    if (firstVisibleMissing >= 0 && activeCoversVisibleWindow && (!interactivePreview || activeJob.textOnly)) return true;
    if (firstVisibleMissing < 0 && !targetMissing) return true;
    cancelStageLyricResidentBuild();
  }
  return startStageLyricResidentBuild(mesh, targetIndex, buildStart, buildEnd, {
    reason: options.reason || (targetMissing ? 'persistent-track-demand' : 'persistent-track-ahead'),
    textOnly: true,
    interactive: interactivePreview
  });
}

function trimStageLyricPersistentTrackRows(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !Array.isArray(data.rowLayers) || !data.rowLayers.length || !lyricsLines || !lyricsLines.length) return false;
  targetIndex = Math.max(0, Math.min((lyricsLines && lyricsLines.length ? lyricsLines.length - 1 : 0), Math.round(Number(targetIndex) || 0)));
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var minOffset = 0;
  var maxOffset = 0;
  for (var oi = 0; oi < offsets.length; oi++) {
    minOffset = Math.min(minOffset, Math.round(Number(offsets[oi]) || 0));
    maxOffset = Math.max(maxOffset, Math.round(Number(offsets[oi]) || 0));
  }
  var interactive = options.interactive === true;
  var keepStart = Math.max(0, targetIndex + minOffset - (interactive ? 3 : 6));
  var keepEnd = Math.min(lyricsLines.length - 1, targetIndex + maxOffset + (interactive ? 5 : 24));
  var preserveTargetIndex = Number(options.preserveTargetIndex);
  var preserveStart = Infinity;
  var preserveEnd = -Infinity;
  if (interactive && isFinite(preserveTargetIndex)) {
    preserveTargetIndex = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(preserveTargetIndex)));
    preserveStart = Math.max(0, preserveTargetIndex + minOffset - 2);
    preserveEnd = Math.min(lyricsLines.length - 1, preserveTargetIndex + maxOffset + 2);
  }
  var releasedEffects = 0;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    var lineIndex = row && row.isTranslation
      ? (row.parentIndex != null ? Number(row.parentIndex) : Number(row.lineIndex))
      : Number(row && row.lineIndex);
    var roundedLineIndex = isFinite(lineIndex) ? Math.round(lineIndex) : null;
    var keepForTarget = roundedLineIndex != null && roundedLineIndex >= keepStart && roundedLineIndex <= keepEnd;
    var keepForCommittedWindow = roundedLineIndex != null && roundedLineIndex >= preserveStart && roundedLineIndex <= preserveEnd;
    var keepEffects = roundedLineIndex == null || keepForTarget || keepForCommittedWindow ||
      roundedLineIndex === targetIndex || roundedLineIndex === preserveTargetIndex;
    if (keepEffects) continue;
    // Text rows are the continuous whole-song runway.  Only their expensive
    // off-screen effect layers are evicted; deleting the text row itself would
    // reintroduce the load/merge break the user sees while seeking.
    if (row.readability) {
      disposeLyricMesh(row.readability);
      row.readability = null;
      row.readabilityMat = null;
      row.renderReadabilityUploaded = false;
      releasedEffects += 1;
    }
    if (row.glow) {
      disposeLyricMesh(row.glow);
      row.glow = null;
      row.glowMat = null;
      row.renderGlowUploaded = false;
      releasedEffects += 1;
    }
  }
  updateStageLyricPersistentResidentBounds(data);
  return releasedEffects > 0;
}

function initializeStageLyricPersistentTrack(mesh, payload) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  var mode = normalizeLyricDisplayMode(payload && payload.mode || data && data.displayMode || (fx && fx.lyricDisplayMode));
  if (!data || !data.usesTrack || mode === 'single' || !lyricsLines || !lyricsLines.length) return false;
  if (!data.trackPersistent) {
    data.trackPersistent = true;
    data.trackLightweight = false;
    data.trackStart = 0;
    data.trackEnd = lyricsLines.length - 1;
    data.trackScrollWindowKey = data.trackKey || (payload && payload.trackKey) || '';
    if (!isFinite(Number(data.trackScrollOffset))) {
      data.trackScrollOffset = isFinite(Number(data.trackTargetVirtualIndex))
        ? Number(data.trackTargetVirtualIndex)
        : lyricPrimaryVirtualIndex(Number(data.trackTargetLineIndex) || 0);
    }
    data.trackScrollPrimed = true;
    data.trackTextRunwayComplete = false;
    data.trackTextRunwayReadyAt = 0;
    data.trackTextRunwayDirection = 'next';
    var layoutMask = data.activeMask || data.mask || {};
    var stableLayout = typeof stableStageLyricRowMaskLayout === 'function'
      ? stableStageLyricRowMaskLayout()
      : { fontSize: 128, lineHeight: 138 };
    data.persistentMaskLayout = {
      fontSize: Number(layoutMask.logicalFontSize) || Number(stableLayout.fontSize) || 128,
      lineHeight: Number(layoutMask.logicalLineHeight) || Number(stableLayout.lineHeight) || (Number(stableLayout.fontSize) || 128) * 1.08
    };
    data.activeMask = null;
    if (mesh.userData.payload) {
      mesh.userData.payload.trackStart = 0;
      mesh.userData.payload.trackEnd = lyricsLines.length - 1;
      mesh.userData.payload.trackLightweight = false;
    }
    updateStageLyricPersistentResidentBounds(data);
  }
  clearStageLyricFullTrackWarmup();
  ensureStageLyricPersistentTrackRows(mesh, payload && payload.trackIndex != null ? payload.trackIndex : data.trackTargetLineIndex, { reason: 'persistent-track-bootstrap' });
  return true;
}

/** Step B：结构上可画的 row 数（有 mesh+mat；不含 GPU upload 是否完成） */
function stageLyricTrackMeshUsableRowCount(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !Array.isArray(data.rowLayers) || !data.rowLayers.length) return 0;
  var n = 0;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    if (row && row.mesh && row.mat) n += 1;
  }
  return n;
}

function stageLyricTrackMeshNeedsHardFailOpen(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.usesTrack) return false;
  return stageLyricTrackMeshUsableRowCount(mesh) <= 0;
}

/**
 * Step B：同栈同步补齐可见窗文本跑道（不等 resident timer）。
 * 返回是否已有 usable rows。
 */
function ensureStageLyricVisibleTextRunwaySync(mesh, targetIndex) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.usesTrack || !lyricsLines || !lyricsLines.length) return false;
  if (!Array.isArray(data.rowLayers)) data.rowLayers = [];
  if (!data.trackPersistent) {
    try { initializeStageLyricPersistentTrack(mesh, mesh.userData.payload || null); } catch (_) {}
    data = mesh.userData.lyric;
  }
  if (!data || !data.trackPersistent) return stageLyricTrackMeshUsableRowCount(mesh) > 0;

  var last = lyricsLines.length - 1;
  targetIndex = Math.max(0, Math.min(last, Math.round(Number(targetIndex) || 0)));
  if (!isFinite(targetIndex)) targetIndex = 0;
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var minOffset = 0;
  var maxOffset = 0;
  for (var oi = 0; oi < offsets.length; oi++) {
    minOffset = Math.min(minOffset, Math.round(Number(offsets[oi]) || 0));
    maxOffset = Math.max(maxOffset, Math.round(Number(offsets[oi]) || 0));
  }
  var visibleStart = Math.max(0, targetIndex + minOffset);
  var visibleEnd = Math.min(last, targetIndex + maxOffset);
  var rowMap = stageLyricPersistentResidentRowMap(data);
  var missingVisible = stageLyricTrackMeshUsableRowCount(mesh) <= 0;
  if (!missingVisible) {
    for (var vi = visibleStart; vi <= visibleEnd; vi++) {
      if (lyricLineDisplayTextAt(vi) && !stageLyricPersistentLineRowsResident(data, vi, rowMap)) {
        missingVisible = true;
        break;
      }
    }
  }
  if (!missingVisible) return true;
  if (typeof buildStageLyricResidentPayload !== 'function' || typeof makeLyricRowLayerGroup !== 'function') {
    return stageLyricTrackMeshUsableRowCount(mesh) > 0;
  }
  var syncPayload = null;
  try {
    syncPayload = buildStageLyricResidentPayload(targetIndex, visibleStart, visibleEnd, { textOnly: true });
  } catch (_) { syncPayload = null; }
  if (!syncPayload || !syncPayload.trackEntries || !syncPayload.trackEntries.length) {
    return stageLyricTrackMeshUsableRowCount(mesh) > 0;
  }
  var worldW = Number(data.worldW) || 6.10;
  var worldH = Number(data.worldH) || (worldW * 0.22);
  var rowWorldH = Number(data.lineWorldStep) || worldH;
  var mask = data.mask || data.activeMask;
  if (!mask && typeof makeLyricMask === 'function') {
    try { mask = makeLyricMask(syncPayload); } catch (_) { mask = null; }
  }
  if (!mask) return stageLyricTrackMeshUsableRowCount(mesh) > 0;
  var pal = (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.palette) || null;
  var motionProfile = typeof lyricMotionProfile === 'function' ? lyricMotionProfile() : null;
  var bundle = null;
  try {
    bundle = makeLyricRowLayerGroup(syncPayload, mask, worldW, rowWorldH, pal, motionProfile);
  } catch (err) {
    console.warn('[row-layers] sync visible runway build failed:', err);
    bundle = null;
  }
  if (bundle) {
    try { mergeStageLyricResidentBundle(mesh, bundle); } catch (_) {
      if (bundle.group && typeof disposeLyricMesh === 'function') {
        try { disposeLyricMesh(bundle.group); } catch (_) {}
      }
    }
  }
  return stageLyricTrackMeshUsableRowCount(mesh) > 0;
}

/**
 * Step B：挂轨后同栈 harden——先 sync 可见窗；仍 0 usable → 立即 fail-open legacy。
 * @returns {'ok'|'fail-open'}
 */
function hardenStageLyricIncomingTrackOrFailOpen(mesh, payload, reason) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.usesTrack) return 'ok';
  var idx = payload && payload.trackIndex != null && isFinite(Number(payload.trackIndex))
    ? Number(payload.trackIndex)
    : (stageLyrics && stageLyrics.currentIdx);
  try {
    ensureStageLyricVisibleTextRunwaySync(mesh, idx);
  } catch (err) {
    console.warn('[row-layers] visible runway sync threw:', err);
  }
  if (!stageLyricTrackMeshNeedsHardFailOpen(mesh)) return 'ok';
  if (typeof stageLyricFailOpenLegacyFromTrack === 'function') {
    try {
      stageLyricFailOpenLegacyFromTrack(mesh, reason || 'empty-track');
    } catch (failErr) {
      console.warn('[row-layers] hard fail-open threw:', failErr);
    }
  }
  return 'fail-open';
}

function stageLyricTrackRevealReady(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.usesTrack) return true;
  if (data.renderInitialTextReady !== true) return false;
  var readyAt = Number(data.renderInitialTextReadyAt) || 0;
  return !readyAt || stageLyricNowMs() - readyAt >= 48;
}

/** 新轨尚未露字时，旧轨先顶着，避免空窗 */
function stageLyricShouldHoldOutgoingForReveal(current, incoming) {
  var currentData = current && current.userData && current.userData.lyric;
  var incomingData = incoming && incoming.userData && incoming.userData.lyric;
  return !!(
    currentData && incomingData && currentData.usesTrack && incomingData.usesTrack &&
    currentData.trackKey && currentData.trackKey === incomingData.trackKey &&
    incomingData.renderInitialTextReady !== true
  );
}

function releaseStageLyricRevealHoldsForSuccessor(successor) {
  if (!successor || !stageLyrics || !stageLyrics.outgoing) return;
  for (var i = 0; i < stageLyrics.outgoing.length; i++) {
    var outgoing = stageLyrics.outgoing[i];
    if (!outgoing || !outgoing.userData || outgoing.userData.lyricRevealSuccessor !== successor) continue;
    outgoing.userData.lyricRevealSuccessor = null;
    outgoing.userData.age = 0;
  }
}

function stageLyricFullTrackWarmupDelay(delay, reason) {
  var base = Math.max(64, Number(delay) || 180);
  if (!stageLyricMultiLineWarmupLoad()) return base;
  var reasonText = String(reason || '');
  if (/lyrics-ready-preload/i.test(reasonText)) return Math.max(base, 24);
  if (/lightweight-upgrade|track-ready-fast|playback-resume|playback-started|startup-restore/i.test(reasonText)) return Math.max(base, 420);
  if (/track-demand/i.test(reasonText)) return Math.max(base, 260);
  var total = lyricsLines && lyricsLines.length ? lyricsLines.length : 0;
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var lineCount = lyricDisplayLineCountForMode(mode);
  var translationMode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  var extra = Math.min(1200, total * (translationMode === 'off' ? 3.0 : 4.8));
  return Math.max(base, 760 + extra + lineCount * 38 + (translationMode === 'multi' ? 260 : 0));
}

function runStageLyricFullTrackWarmup(reason) {
  if (stageLyricCurrentUsesPersistentTrack()) {
    ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: reason || 'persistent-track-warmup' });
    return true;
  }
  // P3：不再后台整曲 coop 贴满；轻量轨升成 persistent 后由 ensure 滑窗补齐
  if (stageLyricCurrentUsesLightweightTrack() && stageLyrics && stageLyrics.current) {
    try {
      initializeStageLyricPersistentTrack(
        stageLyrics.current,
        stageLyrics.currentPayload || (stageLyrics.current.userData && stageLyrics.current.userData.payload)
      );
    } catch (_) {}
    return true;
  }
  return false;
}

function scheduleStageLyricFullTrackWarmup(reason, delay) {
  if (stageLyricCurrentUsesPersistentTrack()) {
    ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: reason || 'persistent-track-warmup' });
    return true;
  }
  var warmupDelay = stageLyricFullTrackWarmupDelay(delay, reason);
  var now = stageLyricNowMs();
  var targetAt = now + warmupDelay;
  if (stageLyricFullTrackWarmupTimer && stageLyricFullTrackWarmupTargetAt && targetAt >= stageLyricFullTrackWarmupTargetAt - 8) return true;
  if (stageLyricFullTrackWarmupTimer) clearTimeout(stageLyricFullTrackWarmupTimer);
  stageLyricFullTrackWarmupTargetAt = targetAt;
  stageLyricFullTrackWarmupTimer = setTimeout(function () {
    stageLyricFullTrackWarmupTimer = 0;
    stageLyricFullTrackWarmupTargetAt = 0;
    runStageLyricFullTrackWarmup(reason || 'track-ready');
  }, warmupDelay);
  return true;
}

function scheduleStageLyricPrewarmForIndex(targetIndex, reason, delay) {
  var hasTarget = targetIndex != null && isFinite(Number(targetIndex));
  var idx = hasTarget ? Math.round(Number(targetIndex)) : (stageLyrics && stageLyrics.currentIdx);
  if (lyricsLines && lyricsLines.length && isFinite(Number(idx))) {
    idx = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(Number(idx))));
  }
  var wait = delay == null ? 24 : Number(delay);
  if (!isFinite(wait)) wait = 24;
  wait = Math.max(0, wait);
  if (stageLyricCurrentUsesPersistentTrack()) {
    setTimeout(function () {
      if (!stageLyricCurrentUsesPersistentTrack()) return;
      ensureStageLyricPersistentTrackRows(
        stageLyrics.current,
        isFinite(Number(idx)) ? idx : stageLyrics.currentIdx,
        { reason: reason || 'persistent-track-prewarm' }
      );
    }, wait);
    return;
  }
  scheduleStageLyricFullTrackWarmup(reason || 'track-prewarm', Math.max(wait, 96));
}

function stageLyricPersistentTargetRowsReady(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !lyricsLines || !lyricsLines.length) return false;
  targetIndex = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(Number(targetIndex) || 0)));
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var required = {};
  for (var oi = 0; oi < offsets.length; oi++) {
    var lineIndex = targetIndex + Math.round(Number(offsets[oi]) || 0);
    if (lineIndex < 0 || lineIndex >= lyricsLines.length) continue;
    var entry = stageLyricTrackBaseEntry(lineIndex);
    if (!entry) continue;
    required[lineIndex + '|primary'] = true;
    if (normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' && makeStageLyricTranslationEntry(entry, lineIndex === targetIndex)) {
      required[lineIndex + '|translation'] = true;
    }
  }
  var requiredKeys = Object.keys(required);
  if (!requiredKeys.length) return false;
  var rows = stageLyricPersistentResidentRowMap(data);
  for (var ki = 0; ki < requiredKeys.length; ki++) {
    var requiredRow = rows[requiredKeys[ki]];
    if (!requiredRow || !requiredRow.mesh || !requiredRow.renderLineUploaded) return false;
    if (options.effects === true) {
      if (!requiredRow.readability || !requiredRow.renderReadabilityUploaded) return false;
      if (!requiredRow.glow || !requiredRow.renderGlowUploaded) return false;
    }
  }
  return true;
}

function stageLyricPersistentTargetEffectsReady(mesh, targetIndex) {
  return stageLyricPersistentTargetRowsReady(mesh, targetIndex, { effects: true });
}
