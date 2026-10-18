'use strict';

// 更新 / 补丁执行层：拉清单、下载（含镜像回退）、校验、打补丁、任务状态。
// 纯逻辑在 ./update-manifest.js，本模块只负责 I/O 与任务编排。
// deps: { manifest, fetchUtils, config, jobs }

module.exports = function createUpdateService(deps) {
  const { manifest, fetchUtils, config, jobs } = deps || {};
  const cfg = config || {};
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const http = require('http');
  const https = require('https');
  const { URL, fileURLToPath } = require('url');
  const { once } = require('events');
  const { APP_VERSION, PATCH_ALLOWED_ROOTS, PATCH_MAX_BYTES, PATCH_STATIC_EXTENSIONS, UPDATE_CONFIG, UPDATE_DOWNLOAD_DIR, UPDATE_FALLBACK_NOTES, UPDATE_INSTALLER_MAX_BYTES, UPDATE_PATCH_BACKUP_DIR, UPDATE_PUBKEY_PEM } = cfg;
  const appRoot = cfg.appRoot;
  const { classifyUpdateError, compareVersions, extractReleaseNotes, normalizeDigest, normalizeManifestUpdateInfo, normalizeVersion, parseLatestYmlUpdateInfo, pickPatchAsset, pickReleaseAsset, safeUpdateFileName, sha256Hex, sha512Base64, sha512Hex, uniqueDownloadCandidates, updateError } = manifest || {};
  const { fetchWithTimeout } = fetchUtils || {};
  const updateDownloadJobs = jobs instanceof Map ? jobs : new Map();

  async function readUpdateManifest(ref) {
    const value = String(ref || '').trim();
    if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
    if (/^https?:\/\//i.test(value)) {
      const resp = await fetch(value, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      });
      if (!resp.ok) throw new Error('Update manifest ' + resp.status);
      return resp.json();
    }
    const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  async function fetchManifestUpdateInfo(ref) {
    try {
      const data = await readUpdateManifest(ref);
      return normalizeManifestUpdateInfo(data);
    } catch (err) {
      return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
    }
  }
  function localUpdateFallback(reason, opts) {
    opts = opts || {};
    const configured = !!(opts.configured != null ? opts.configured : false);
    return {
      configured,
      preview: UPDATE_CONFIG.preview,
      updateAvailable: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      release: {
        tagName: 'v' + APP_VERSION,
        name: 'Mineradio v' + APP_VERSION,
        version: APP_VERSION,
        htmlUrl: '',
        downloadUrl: '',
        summary: '当前版本，更新检测已就绪。',
        notes: UPDATE_FALLBACK_NOTES,
      },
      reason: reason || '',
    };
  }
  // 注：这个函数原先被放进 ./fetch-utils.js（「通用 HTTP 工具」），但它内部用到
  // APP_VERSION / updateError / classifyUpdateError —— 三个只在本工厂作用域里可见的符号。
  // 搬过去时没有注入 → 一旦真的走到候选抓取就是 ReferenceError: APP_VERSION is not defined
  // （fetchLatestYmlUpdateInfo → fetchTextFromCandidates）。这里让 update 专用件回归 update 域。
  async function fetchTextFromCandidates(candidates, timeoutMs) {
    const list = Array.isArray(candidates) && candidates.length ? candidates : [];
    const failures = [];
    for (let i = 0; i < list.length; i++) {
      const candidate = list[i];
      try {
        const resp = await fetchWithTimeout(candidate.url, {
          headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
        }, timeoutMs || 6500);
        if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
        return { text: await resp.text(), candidate };
      } catch (err) {
        const info = classifyUpdateError(err);
        failures.push(candidate.label + ': ' + info.reason);
      }
    }
    throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
  }

  async function fetchLatestYmlUpdateInfo(reason) {
    if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
    const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
    const candidates = uniqueDownloadCandidates(latestYmlUrl);
    const result = await fetchTextFromCandidates(candidates, 6500);
    return parseLatestYmlUpdateInfo(result.text, reason);
  }
  async function fetchLatestUpdateInfo() {
    if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
    if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const resp = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': `Mineradio/${APP_VERSION}`,
          'Accept': 'application/vnd.github+json',
        },
      });
      if (!resp.ok) {
        try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
        catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
      }
      const data = await resp.json();
      const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
      const asset = pickReleaseAsset(data.assets);
      const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
      const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
      return {
        configured: true,
        preview: false,
        updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
        currentVersion: APP_VERSION,
        latestVersion,
        release: {
          tagName: data.tag_name || ('v' + latestVersion),
          name: data.name || ('Mineradio v' + latestVersion),
          version: latestVersion,
          publishedAt: data.published_at || '',
          htmlUrl: data.html_url || '',
          downloadUrl: asset ? asset.downloadUrl : '',
          asset,
          patch,
          patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
          summary: notes[0] || '发现新版本，建议更新。',
          notes,
        },
      };
    } catch (err) {
      const reason = err && err.message || 'Update check failed';
      try { return await fetchLatestYmlUpdateInfo(reason); }
      catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
    } finally {
      clearTimeout(timer);
    }
  }
  function publicUpdateJob(job) {
    if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
    return {
      ok: job.status !== 'error',
      id: job.id,
      status: job.status,
      progress: job.progress || 0,
      received: job.received || 0,
      total: job.total || 0,
      speedBps: job.speedBps || 0,
      etaSeconds: job.etaSeconds || 0,
      sourceLabel: job.sourceLabel || '',
      attempt: job.attempt || 0,
      attempts: job.attempts || 0,
      mode: job.mode || 'installer',
      message: job.message || '',
      restartRequired: !!job.restartRequired,
      cached: !!job.cached,
      fileName: job.fileName || '',
      filePath: job.status === 'ready' ? job.filePath : '',
      version: job.version || '',
      releaseUrl: job.releaseUrl || '',
      error: job.error || '',
      errorReason: job.errorReason || '',
      errorDetail: job.errorDetail || '',
      failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
  function activeUpdateJobFor(version) {
    const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  }
  function trimUpdateJobs() {
    const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
  }
  async function downloadUpdateAsset(job) {
    const tmpPath = job.filePath + '.download';
    try {
      fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
      job.status = 'downloading';
      job.updatedAt = Date.now();

      const resp = await fetch(job.downloadUrl, {
        headers: {
          'User-Agent': `Mineradio/${APP_VERSION}`,
        },
      });
      if (!resp.ok) throw new Error('Download failed ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.total || 0;
      job.received = 0;
      job.progress = 0;
      job.speedBps = 0;
      job.etaSeconds = 0;
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
    } catch (e) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      job.status = 'error';
      job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
      job.updatedAt = Date.now();
    }
  }
  function verifyUpdateBuffer(buffer, job) {
    const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
    if (expectedSize > 0 && buffer.length !== expectedSize) {
      throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
    }
    const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
    if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
      throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
    }
    const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
    if (expectedSha512) {
      const actualBase64 = sha512Base64(buffer);
      const actualHex = sha512Hex(buffer).toLowerCase();
      if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
        throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
      }
    }
  }
  async function verifyUpdateFile(filePath, job) {
    // 流式校验：安装包可达上百 MB，同步读入 + 同步哈希会阻塞事件循环（下载完成时播放会卡顿数秒）
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const stat = await fh.stat();
      const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
      if (expectedSize > 0 && stat.size !== expectedSize) {
        throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${stat.size}`);
      }
      const hash256 = crypto.createHash('sha256');
      const hash512 = crypto.createHash('sha512');
      const reader = fh.createReadStream();
      for await (const chunk of reader) {
        hash256.update(chunk);
        hash512.update(chunk);
      }
      const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
      if (expectedSha256 && hash256.digest('hex') !== expectedSha256) {
        throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
      }
      const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
      if (expectedSha512) {
        const actualHex = hash512.digest('hex');
        const actualBase64 = Buffer.from(actualHex, 'hex').toString('base64');
        if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
          throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
        }
      }
    } finally {
      await fh.close().catch(() => {});
    }
  }
  function moveInvalidUpdateFile(filePath, reason) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return;
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
      fs.renameSync(filePath, invalidPath);
      console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
    } catch (e) {
      console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
    }
  }
  async function reuseVerifiedInstallerJob(opts) {
    if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
    if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
    const now = Date.now();
    const stat = fs.statSync(opts.filePath);
    const job = {
      id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      status: 'ready',
      progress: 100,
      received: stat.size || 0,
      total: opts.expectedSize || stat.size || 0,
      speedBps: 0,
      etaSeconds: 0,
      sourceLabel: '本地缓存',
      attempt: 0,
      attempts: opts.attempts || 0,
      mode: 'installer',
      message: '安装包已下载，可直接打开安装',
      fileName: opts.fileName || path.basename(opts.filePath),
      filePath: opts.filePath,
      version: opts.version || '',
      downloadUrl: opts.downloadUrl || '',
      downloadCandidates: opts.downloadCandidates || [],
      expectedSize: opts.expectedSize || 0,
      sha256: opts.sha256 || '',
      sha512: opts.sha512 || '',
      releaseUrl: opts.releaseUrl || '',
      failedAttempts: [],
      cached: true,
      createdAt: now,
      updatedAt: now,
      error: '',
    };
    try {
      await verifyUpdateFile(opts.filePath, job);
      updateDownloadJobs.set(job.id, job);
      trimUpdateJobs();
      return job;
    } catch (err) {
      moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
      return null;
    }
  }
  function setUpdateJobError(job, err, fallbackMessage) {
    const info = classifyUpdateError(err);
    job.status = 'error';
    job.error = info.code;
    job.errorReason = info.reason;
    job.errorDetail = info.detail;
    job.message = fallbackMessage || info.reason;
    job.updatedAt = Date.now();
  }
  function prepareUpdateJobAttempt(job, candidate, index, total) {
    job.status = 'downloading';
    job.sourceLabel = candidate.label || '下载线路';
    job.attempt = index + 1;
    job.attempts = total;
    job.received = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.error = '';
    job.errorReason = '';
    job.errorDetail = '';
    job.updatedAt = Date.now();
  }
  function ensureMirrorCanBeVerified(job, candidate) {
    if (!candidate || !candidate.mirrored) return;
    if (job.sha256 || job.sha512) return;
    throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
  }
  // 致命错误：不再尝试剩余镜像（同一资产在各线路上一样会超限/一样大），直接终局
  function fatalUpdateError(code, message) {
    const err = updateError(code, message);
    err.updateFatal = true;
    return err;
  }
  async function downloadUpdateAssetWithMirrors(job) {
    const tmpPath = job.filePath + '.download';
    const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
      ? job.downloadCandidates
      : uniqueDownloadCandidates(job.downloadUrl || '');
    const failures = [];
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        ensureMirrorCanBeVerified(job, candidate);
        prepareUpdateJobAttempt(job, candidate, i, candidates.length);
        job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

        const resp = await fetchWithTimeout(candidate.url, {
          headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
        }, 14000);
        if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

        const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
        // 声称的大小就超限：直接拒，不必开始写盘（致命：换镜像也一样大）
        if (totalHeader > UPDATE_INSTALLER_MAX_BYTES) {
          throw fatalUpdateError('UPDATE_FILE_TOO_LARGE', '安装包超过大小上限 (' + Math.round(totalHeader / 1048576) + 'MB)');
        }
        job.total = totalHeader || job.expectedSize || job.total || 0;
        job.progress = 0;
        job.updatedAt = Date.now();
        let speedWindowAt = Date.now();
        let speedWindowBytes = 0;

        const writer = fs.createWriteStream(tmpPath);
        const reader = resp.body.getReader();
        let receivedOverLimit = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const buf = Buffer.from(chunk.value);
            job.received += buf.length;
            // 累计硬上限：content-length 撒谎/缺失时的真实护栏
            if (job.received > UPDATE_INSTALLER_MAX_BYTES) { receivedOverLimit = true; break; }
            speedWindowBytes += buf.length;
            const now = Date.now();
            if (now - speedWindowAt >= 900) {
              job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
              speedWindowAt = now;
              speedWindowBytes = 0;
            }
            if (job.total > 0) {
              job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
              job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
            } else {
              const kb = Math.max(1, job.received / 1024);
              job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
            }
            job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
            job.updatedAt = Date.now();
            if (!writer.write(buf)) await once(writer, 'drain');
          }
        } finally {
          writer.end();
          await once(writer, 'finish').catch(() => {});
        }
        if (receivedOverLimit) {
          // 先关流再删临时文件（Windows 上占用中 unlink 会 EBUSY）
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          throw fatalUpdateError('UPDATE_FILE_TOO_LARGE', '安装包超过大小上限 (' + Math.round(UPDATE_INSTALLER_MAX_BYTES / 1048576) + 'MB)，已中断');
        }

        await verifyUpdateFile(tmpPath, job);
        if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
        fs.renameSync(tmpPath, job.filePath);
        job.status = 'ready';
        job.progress = 100;
        job.etaSeconds = 0;
        job.message = '安装包已下载';
        job.updatedAt = Date.now();
        return;
      } catch (err) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        const info = classifyUpdateError(err);
        failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
        job.failedAttempts = failures.slice(-6);
        job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
        job.updatedAt = Date.now();
        // 致命错误（如体积超限）：换线路无意义，直接终局，不再继续下载其余镜像
        if (err && err.updateFatal) { setUpdateJobError(job, err, '下载失败：' + info.reason); return; }
        if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
      }
    }
  }
  async function startUpdateDownloadJob(info) {
    const release = info && info.release ? info.release : {};
    const asset = release.asset || {};
    const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
    if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
    if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
    if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

    const version = info.latestVersion || release.version || '';
    const existing = activeUpdateJobFor(version);
    if (existing) return publicUpdateJob(existing);

    const fileName = safeUpdateFileName(asset.name || '', version);
    const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
    const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
    const expectedSize = asset.size || 0;
    const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
    const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
    const cached = await reuseVerifiedInstallerJob({
      fileName,
      filePath,
      version,
      downloadUrl,
      downloadCandidates,
      expectedSize,
      sha256,
      sha512,
      releaseUrl: release.htmlUrl || '',
      attempts: downloadCandidates.length,
    });
    if (cached) return publicUpdateJob(cached);

    const now = Date.now();
    const job = {
      id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      status: 'queued',
      progress: 0,
      received: 0,
      total: expectedSize,
      mode: 'installer',
      fileName,
      filePath,
      version,
      downloadUrl,
      downloadCandidates,
      expectedSize,
      sha256,
      sha512,
      releaseUrl: release.htmlUrl || '',
      sourceLabel: '',
      attempt: 0,
      attempts: downloadCandidates.length,
      failedAttempts: [],
      createdAt: now,
      updatedAt: now,
      error: '',
    };
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    downloadUpdateAssetWithMirrors(job);
    return publicUpdateJob(job);
  }
  function safePatchRelativePath(value) {
    const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!rel || rel.includes('\0')) return '';
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
    const root = parts[0];
    if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
    const ext = path.posix.extname(rel).toLowerCase();
    if (!PATCH_STATIC_EXTENSIONS.has(ext)) return '';
    if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
    return parts.join('/');
  }
  function patchTargetPath(rel) {
    const safeRel = safePatchRelativePath(rel);
    if (!safeRel) return null;
    const target = path.resolve(appRoot, safeRel);
    const root = path.resolve(appRoot);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
  }
  function decodePatchFile(file) {
    if (!file || typeof file !== 'object') return null;
    if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
    if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
    return null;
  }
  function backupPatchTarget(job, rel, target) {
    if (!fs.existsSync(target)) return;
    const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
  }
  function writePatchFile(job, file) {
    const rel = safePatchRelativePath(file.path || file.name);
    const target = rel ? patchTargetPath(rel) : null;
    const content = decodePatchFile(file);
    if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
    if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
    const expected = String(file.sha256 || '').trim().toLowerCase();
    const actual = sha256Hex(content);
    if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
    backupPatchTarget(job, rel, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.mineradio-patch';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
    if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
    return rel;
  }
  function assertPatchSignature(payload) {
    // fail-closed：未配置公钥时拒绝应用补丁，而不是跳过校验。
    // 补丁会直接写入安装目录（public/ 下的 HTML/JS），无签名校验等于给供应链投毒开后门。
    // 需要启用补丁更新时，必须在启动环境设置 MINERADIO_UPDATE_PUBKEY_PEM（见 build/patch-sign.js）。
    if (!UPDATE_PUBKEY_PEM) throw new Error('PATCH_SIGNATURE_UNCONFIGURED');
    const signature = String(payload.signature || payload.sig || '').trim();
    if (!signature) throw new Error('PATCH_SIGNATURE_MISSING');
    const signedPayload = Object.assign({}, payload);
    delete signedPayload.signature;
    delete signedPayload.sig;
    const ok = crypto.verify(
      'sha256',
      Buffer.from(JSON.stringify(signedPayload), 'utf8'),
      crypto.createPublicKey(UPDATE_PUBKEY_PEM),
      Buffer.from(signature, 'base64'),
    );
    if (!ok) throw new Error('PATCH_SIGNATURE_INVALID');
  }
  function parsePatchPayload(raw) {
    const payload = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    assertPatchSignature(payload);
    return normalizePatchPayload(payload);
  }
  function normalizePatchPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
    const type = String(payload.type || payload.kind || '');
    if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
    const from = normalizeVersion(payload.from || payload.baseVersion || '');
    const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
    if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
    if (!files.length) throw new Error('PATCH_EMPTY');
    if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
    return { from, to, files, restartRequired: payload.restartRequired === true };
  }
  async function downloadAndApplyPatch(job) {
    const chunks = [];
    try {
      fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
      job.status = 'downloading';
      job.mode = 'patch';
      job.message = '正在下载快速补丁';
      job.updatedAt = Date.now();

      const resp = await fetch(job.downloadUrl, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      });
      if (!resp.ok) throw new Error('Patch download failed ' + resp.status);

      job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.total || 0;
      job.received = 0;
      const reader = resp.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        if (job.received > PATCH_MAX_BYTES) throw new Error('PATCH_TOO_LARGE');
        chunks.push(buf);
        job.progress = job.total > 0
          ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
          : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
        job.updatedAt = Date.now();
      }

      const raw = Buffer.concat(chunks);
      const expectedPatchHash = String(job.sha256 || '').trim().toLowerCase();
      if (expectedPatchHash && sha256Hex(raw) !== expectedPatchHash) throw new Error('PATCH_PACKAGE_HASH_MISMATCH');
      const patch = parsePatchPayload(raw.toString('utf8'));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.updatedAt = Date.now();
      const changed = [];
      patch.files.forEach(file => changed.push(writePatchFile(job, file)));
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
    } catch (e) {
      job.status = 'error';
      job.error = e.message || 'PATCH_APPLY_FAILED';
      job.message = '快速补丁失败，可改用完整安装包';
      job.updatedAt = Date.now();
    }
  }
  async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
    ensureMirrorCanBeVerified(job, candidate);
    prepareUpdateJobAttempt(job, candidate, index, total);
    job.mode = 'patch';
    job.message = '正在下载快速补丁';
    job.progress = 0;
    job.updatedAt = Date.now();

    const resp = await fetchWithTimeout(candidate.url, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    }, 12000);
    if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

    job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
    job.received = 0;
    const chunks = [];
    const reader = resp.body.getReader();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      job.received += buf.length;
      speedWindowBytes += buf.length;
      if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
      chunks.push(buf);
      const now = Date.now();
      if (now - speedWindowAt >= 700) {
        job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
        speedWindowAt = now;
        speedWindowBytes = 0;
      }
      job.progress = job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
      job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
      job.updatedAt = Date.now();
    }
    const raw = Buffer.concat(chunks);
    verifyUpdateBuffer(raw, job);
    return raw;
  }
  async function downloadAndApplyPatchWithMirrors(job) {
    const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
      ? job.downloadCandidates
      : uniqueDownloadCandidates(job.downloadUrl || '');
    const failures = [];
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
        const patch = parsePatchPayload(raw.toString('utf8'));
        job.version = patch.to;
        job.message = '正在应用快速补丁';
        job.progress = 88;
        job.etaSeconds = 0;
        job.updatedAt = Date.now();
        const changed = [];
        patch.files.forEach(file => changed.push(writePatchFile(job, file)));
        job.changedFiles = changed;
        job.status = 'ready';
        job.progress = 100;
        job.restartRequired = patch.restartRequired;
        job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
        job.updatedAt = Date.now();
        return;
      } catch (err) {
        const info = classifyUpdateError(err);
        failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
        job.failedAttempts = failures.slice(-6);
        job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
        job.updatedAt = Date.now();
        if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
      }
    }
  }
  function startUpdatePatchJob(info) {
    const release = info && info.release ? info.release : {};
    const patch = release.patch || {};
    const downloadUrl = patch.downloadUrl || '';
    if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
    if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
    if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

    const version = info.latestVersion || release.version || patch.to || '';
    const existing = Array.from(updateDownloadJobs.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
    if (existing) return publicUpdateJob(existing);

    const now = Date.now();
    const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
    const job = {
      id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      status: 'queued',
      progress: 0,
      received: 0,
      total: patch.size || 0,
      mode: 'patch',
      fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
      filePath: '',
      version,
      downloadUrl,
      downloadCandidates,
      releaseUrl: release.htmlUrl || '',
      expectedSize: patch.size || 0,
      sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
      sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
      restartRequired: true,
      sourceLabel: '',
      attempt: 0,
      attempts: downloadCandidates.length,
      failedAttempts: [],
      message: '等待下载快速补丁',
      createdAt: now,
      updatedAt: now,
      error: '',
    };
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    downloadAndApplyPatchWithMirrors(job);
    return publicUpdateJob(job);
  }

  return {
    updateDownloadJobs,
    readUpdateManifest,
    fetchManifestUpdateInfo,
    localUpdateFallback,
    fetchLatestYmlUpdateInfo,
    fetchLatestUpdateInfo,
    publicUpdateJob,
    activeUpdateJobFor,
    trimUpdateJobs,
    downloadUpdateAsset,
    verifyUpdateBuffer,
    verifyUpdateFile,
    moveInvalidUpdateFile,
    reuseVerifiedInstallerJob,
    setUpdateJobError,
    prepareUpdateJobAttempt,
    ensureMirrorCanBeVerified,
    fatalUpdateError,
    downloadUpdateAssetWithMirrors,
    startUpdateDownloadJob,
    safePatchRelativePath,
    patchTargetPath,
    decodePatchFile,
    backupPatchTarget,
    writePatchFile,
    assertPatchSignature,
    parsePatchPayload,
    normalizePatchPayload,
    downloadAndApplyPatch,
    downloadPatchBufferFromCandidate,
    downloadAndApplyPatchWithMirrors,
    startUpdatePatchJob,
  };
};
