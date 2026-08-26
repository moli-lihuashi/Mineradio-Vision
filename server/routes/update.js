// ====================================================================
//  路由: 更新 / 版本 / 节拍缓存 / Cuefield
//  - /api/app/version
//  - /api/update/*        (latest / download / download/status / patch / patch/status)
//  - /api/beatmap/cache(/status)
//  - /api/cuefield/transition, /api/cuefield/feedback
// ====================================================================
module.exports = function register(ctx) {
  const {
    APP_PACKAGE, APP_VERSION, UPDATE_CONFIG, CUEFIELD_FEEDBACK_FILE,
    sendJSON, readRequestBody,
    fetchLatestUpdateInfo, localUpdateFallback,
    startUpdateDownloadJob, startUpdatePatchJob, publicUpdateJob,
    updateDownloadJobs,
    beatCacheRootInfo, readBeatMapCache, writeBeatMapCache,
    planCuefieldTransitionFromCache,
    readCuefieldFeedbackStats, appendCuefieldFeedback,
  } = ctx;

  return async function(req, res, url, pn) {
    if (pn === '/api/app/version') {
      sendJSON(res, {
        name: APP_PACKAGE.name || 'mineradio',
        productName: APP_PACKAGE.productName || 'Mineradio',
        version: APP_VERSION,
        update: {
          provider: UPDATE_CONFIG.provider,
          configured: UPDATE_CONFIG.configured,
          owner: UPDATE_CONFIG.owner,
          repo: UPDATE_CONFIG.repo,
          preview: UPDATE_CONFIG.preview,
          manifestOverride: !!UPDATE_CONFIG.manifest,
        },
      });
      return;
    }

    if (pn === '/api/update/latest') {
      try {
        sendJSON(res, await fetchLatestUpdateInfo());
      } catch (err) {
        sendJSON(res, {
          ...localUpdateFallback(err.message || 'Update check failed', { configured: UPDATE_CONFIG.configured }),
          error: err.message || 'Update check failed',
        });
      }
      return;
    }

    if (pn === '/api/update/download') {
      try {
        const info = await fetchLatestUpdateInfo();
        const job = startUpdateDownloadJob(info);
        sendJSON(res, job, job.ok ? 200 : 400);
      } catch (err) {
        console.error('[UpdateDownload]', err);
        sendJSON(res, { ok: false, error: err.message || 'UPDATE_DOWNLOAD_START_FAILED' }, 500);
      }
      return;
    }

    if (pn === '/api/update/download/status') {
      const id = url.searchParams.get('id') || '';
      const job = id
        ? updateDownloadJobs.get(id)
        : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
      return;
    }

    if (pn === '/api/update/patch') {
      try {
        const info = await fetchLatestUpdateInfo();
        const job = startUpdatePatchJob(info);
        sendJSON(res, job, job.ok ? 200 : 400);
      } catch (err) {
        console.error('[UpdatePatch]', err);
        sendJSON(res, { ok: false, error: err.message || 'UPDATE_PATCH_START_FAILED' }, 500);
      }
      return;
    }

    if (pn === '/api/update/patch/status') {
      const id = url.searchParams.get('id') || '';
      const job = id
        ? updateDownloadJobs.get(id)
        : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find(item => item.mode === 'patch');
      sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
      return;
    }

    if (pn === '/api/beatmap/cache/status') {
      const info = beatCacheRootInfo();
      sendJSON(res, {
        enabled: info.allowed && info.available,
        dir: info.dir,
        drive: info.drive,
        reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
        mode: info.allowed && info.available ? 'disk' : 'memory-only',
      });
      return;
    }

    if (pn === '/api/beatmap/cache') {
      if (req.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        try {
          const entry = readBeatMapCache(key);
          sendJSON(res, entry
            ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
            : { ok: true, hit: false, key });
        } catch (err) {
          const info = err.info || beatCacheRootInfo();
          sendJSON(res, {
            ok: false,
            hit: false,
            enabled: false,
            mode: 'memory-only',
            key,
            reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
            dir: info.dir,
          });
        }
        return;
      }

      if (req.method === 'POST') {
        try {
          const body = await readRequestBody(req);
          sendJSON(res, writeBeatMapCache(body));
        } catch (err) {
          const info = err.info || beatCacheRootInfo();
          sendJSON(res, {
            ok: false,
            enabled: false,
            mode: 'memory-only',
            reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
            dir: info.dir,
          });
        }
        return;
      }

      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }

    // Cuefield only consumes Mineradio's existing local beat-map cache. It never
    // receives account cookies, song files, or playback URLs on this route.
    if (pn === '/api/cuefield/transition') {
      if (req.method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
        return;
      }
      try {
        const body = await readRequestBody(req);
        const plan = planCuefieldTransitionFromCache({
          fromKey: body.fromKey,
          toKey: body.toKey,
          fromLrc: body.fromLrc,
          toLrc: body.toLrc,
          exitBias: body.exitBias || 'late',
          maxEntryTime: Math.max(8, Math.min(32, Number(body.maxEntryTime) || 32)),
          readBeatMapCache,
        });
        sendJSON(res, plan);
      } catch (err) {
        sendJSON(res, {
          ok: false,
          error: err && (err.code || err.message) || 'CUEFIELD_TRANSITION_FAILED',
        }, 400);
      }
      return;
    }

    // Feedback remains on this computer under Electron userData.
    if (pn === '/api/cuefield/feedback') {
      if (req.method === 'GET') {
        try {
          sendJSON(res, { ok: true, stats: readCuefieldFeedbackStats(CUEFIELD_FEEDBACK_FILE) });
        } catch (err) {
          sendJSON(res, { ok: false, error: err.message || 'CUEFIELD_FEEDBACK_READ_FAILED' }, 500);
        }
        return;
      }
      if (req.method === 'POST') {
        try {
          const body = await readRequestBody(req);
          const record = appendCuefieldFeedback(CUEFIELD_FEEDBACK_FILE, body);
          sendJSON(res, { ok: true, record });
        } catch (err) {
          sendJSON(res, { ok: false, error: err.code || err.message || 'CUEFIELD_FEEDBACK_SAVE_FAILED' }, 400);
        }
        return;
      }
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
  };
};
