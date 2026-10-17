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

  // v2（cuefield-next）引擎惰性加载：268KB，只在显式 engine:'v2' 时才 require，
  // 不给默认启动路径加任何成本。注意本文件在 server/routes/ 下，仓库根是两层之上。
  let cuefieldNextBridge = null;
  function loadCuefieldNextBridge() {
    if (!cuefieldNextBridge) cuefieldNextBridge = require('../../cuefield-next/mineradio-bridge');
    return cuefieldNextBridge;
  }

  // cuefield 的 readBeatMapCache 是**同步**接口（内部 entryFromCache 直接取返回值当 entry 用），
  // 而本仓库的 readBeatMapCache 已改成 async（fs.promises）→ 直接把 async 函数传进去拿到的是
  // Promise，`entry.map` 恒为 undefined，必然抛 BEATMAP_CACHE_MISS。
  // 这里一次性预读 from/to 两个 key，给出同步查表闭包。
  async function cuefieldCacheLookup(fromKey, toKey) {
    const read = (key) => Promise.resolve()
      .then(() => readBeatMapCache(key))
      .catch(() => null);
    const [fromEntry, toEntry] = await Promise.all([read(fromKey), read(toKey)]);
    const table = new Map();
    if (fromEntry && fromEntry.map) table.set(String(fromKey), fromEntry);
    if (toEntry && toEntry.map) table.set(String(toKey), toEntry);
    return (key) => table.get(String(key)) || null;
  }

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
        const job = await startUpdateDownloadJob(info);
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
          const entry = await readBeatMapCache(key);
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
          sendJSON(res, await writeBeatMapCache(body));
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
        // 默认 v2（cuefield-next / 上游 19 模块）。前端执行层已是配套的 5 模块版本，
        // 能消费 duck/echo/loop/rate/spectrum/bridge 与 volume 双曲线；显式传 'v1' 可回落旧引擎。
        const engine = String(
          body.engine || (url && url.searchParams && url.searchParams.get('engine')) || 'v2'
        ).trim().toLowerCase();
        const readCache = await cuefieldCacheLookup(body.fromKey, body.toKey);
        const baseOpts = {
          fromKey: body.fromKey,
          toKey: body.toKey,
          fromLrc: body.fromLrc,
          toLrc: body.toLrc,
          exitBias: body.exitBias || 'late',
          maxEntryTime: Math.max(8, Math.min(32, Number(body.maxEntryTime) || 32)),
          readBeatMapCache: readCache,
        };
        let plan = null;
        let solvedBy = 'v1';
        let v2Fallback = null;
        if (engine === 'v2') {
          try {
            plan = loadCuefieldNextBridge().planCuefieldTransitionFromCache({
              ...baseOpts,
              minimumListenUntil: body.minimumListenUntil,
              // 只带最近 2 条：避免同一种配方连刷（上游的 cadence 抖动抑制）
              recentRecipes: Array.isArray(body.recentRecipes) ? body.recentRecipes.slice(-2) : [],
              enableCleanBoundary: body.enableCleanBoundary === true,
              enableCadenceFallback: body.enableCadenceFallback === true,
              boundaryEvidence: body.boundaryEvidence,
              tailEvidence: body.tailEvidence,
              enableLiveEndCrossfadeFallback: body.enableLiveEndCrossfadeFallback === true,
            });
            solvedBy = 'v2';
          } catch (v2Err) {
            // v2 任何异常都不能影响 v1，但回落必须可见（不要静默）：
            // 响应里带 engineFallback，探针/前端都能看出「要了 v2 实际跑了 v1」。
            v2Fallback = String(v2Err && (v2Err.code || v2Err.message) || 'CUEFIELD_V2_FAILED');
            console.warn('[cuefield] v2 engine failed, falling back to v1:', v2Fallback);
            plan = null;
          }
        }
        if (!plan) plan = planCuefieldTransitionFromCache(baseOpts);
        if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
          plan.engine = solvedBy;
          if (v2Fallback) plan.engineFallback = { requested: 'v2', actual: solvedBy, error: v2Fallback };
        }
        sendJSON(res, plan);
      } catch (err) {
        // 返回 200 + ok:false：beatmap 缓存缺失等场景属预期跳过，
        // 4xx 会触发浏览器控制台 "Failed to load resource" 红字噪音
        sendJSON(res, {
          ok: false,
          error: err && (err.code || err.message) || 'CUEFIELD_TRANSITION_FAILED',
        }, 200);
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
