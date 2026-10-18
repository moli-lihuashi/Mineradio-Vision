'use strict';

// 更新清单与版本元信息：纯逻辑层（不做网络、不写盘，除只读读 package.json）。
// 版本比较 / 镜像候选生成 / manifest 归一化 / latest.yml 解析 / 摘要计算 / 错误分类。
// deps: { appRoot, ... }（appRoot 用于定位 package.json）

module.exports = function createUpdateManifest(deps) {
  const { appRoot } = deps || {};
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const cfg = deps || {};

  function readPackageInfo() {
    try {
      const raw = fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  function parseGitHubRepository(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') };
    const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i);
    if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') };
    return null;
  }
  function readUpdateConfig(pkg) {
    const local = (pkg && pkg.mineradio && pkg.mineradio.update) || {};
    const repoHint = process.env.MINERADIO_UPDATE_REPOSITORY
      || process.env.GITHUB_REPOSITORY
      || local.repository
      || local.github
      || (pkg && pkg.repository && (pkg.repository.url || pkg.repository))
      || '';
    const parsed = parseGitHubRepository(repoHint) || {};
    const owner = process.env.MINERADIO_UPDATE_OWNER || local.owner || parsed.owner || '';
    const repo = process.env.MINERADIO_UPDATE_REPO || local.repo || parsed.repo || '';
    return {
      provider: local.provider || 'github',
      owner,
      repo,
      configured: !!(owner && repo),
      preview: local.preview !== false,
      preferMirrors: local.preferMirrors !== false,
      mirrors: readUpdateMirrors(local),
      manifest: process.env.MINERADIO_UPDATE_MANIFEST
        || process.env.MINERADIO_UPDATE_MANIFEST_URL
        || process.env.MINERADIO_UPDATE_MANIFEST_FILE
        || '',
    };
  }
  function parseUpdateMirrorList(value) {
    if (Array.isArray(value)) return value;
    return String(value || '').split(/[\n,;]/);
  }
  function readUpdateMirrors(local) {
    const envMirrors = process.env.MINERADIO_UPDATE_MIRRORS || process.env.MINERADIO_UPDATE_MIRROR || '';
    const raw = envMirrors
      ? parseUpdateMirrorList(envMirrors)
      : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || []);
    const seen = new Set();
    const mirrors = [];
    raw.forEach(item => {
      const url = String(item || '').trim();
      if (!/^https?:\/\//i.test(url)) return;
      const key = url.replace(/\/+$/, '').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      mirrors.push(url);
    });
    return mirrors.slice(0, 6);
  }
  function normalizeDigest(value, algorithm) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const prefix = new RegExp('^' + algorithm + ':', 'i');
    return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
  }
  function assetDigestInfo(asset) {
    const digest = String(asset && asset.digest || '').trim();
    return {
      sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
      sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
    };
  }
  function buildMirrorUrl(originalUrl, mirror) {
    const source = String(originalUrl || '').trim();
    const base = String(mirror || '').trim();
    if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
    if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
    if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
    return base.replace(/\/+$/, '/') + source;
  }
  function uniqueDownloadCandidates(urls, opts) {
    opts = opts || {};
    const directUrls = (Array.isArray(urls) ? urls : [urls])
      .map(url => String(url || '').trim())
      .filter(url => /^https?:\/\//i.test(url));
    const directSet = new Set(directUrls.map(url => url.toLowerCase()));
    const mirrors = opts.useMirrors === false ? [] : (cfg.UPDATE_CONFIG.mirrors || []);
    const mirrored = [];
    directUrls.forEach(source => {
      mirrors.forEach((mirror, index) => {
        const url = buildMirrorUrl(source, mirror);
        if (url) mirrored.push({
          url,
          label: '国内加速线路 ' + (index + 1),
          mirrored: true,
        });
      });
    });
    const direct = directUrls.map(url => ({
      url,
      label: directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路',
      mirrored: false,
    }));
    const ordered = cfg.UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct);
    const seen = new Set();
    return ordered.filter(item => {
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function publicDownloadUrls(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
      .map(item => item && item.url)
      .filter(Boolean);
  }
  function normalizeVersion(value) {
    return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
  }
  function compareVersions(a, b) {
    const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
    const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(aa.length, bb.length, 3);
    for (let i = 0; i < len; i++) {
      const left = aa[i] || 0;
      const right = bb[i] || 0;
      if (left > right) return 1;
      if (left < right) return -1;
    }
    return 0;
  }
  function cleanReleaseLine(line) {
    return String(line || '')
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();
  }
  function extractReleaseNotes(body) {
    const notes = [];
    String(body || '').split(/\r?\n/).forEach(line => {
      const text = cleanReleaseLine(line);
      if (!text) return;
      if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
      if (/^https?:\/\//i.test(text)) return;
      if (text.length > 72) return;
      notes.push(text);
    });
    return notes.slice(0, 4);
  }
  function pickReleaseAsset(assets) {
    const list = Array.isArray(assets) ? assets : [];
    const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
      || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
      || list[0];
    if (!preferred) return null;
    const digest = assetDigestInfo(preferred);
    const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
    return {
      name: preferred.name || '',
      size: preferred.size || 0,
      contentType: preferred.content_type || '',
      downloadUrl: preferred.browser_download_url || '',
      downloadUrls: publicDownloadUrls(candidates),
      sha256: digest.sha256 || '',
      sha512: digest.sha512 || '',
    };
  }
  function patchAssetVersions(name) {
    const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
    return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
  }
  function pickPatchAsset(assets, currentVersion, latestVersion) {
    const list = Array.isArray(assets) ? assets : [];
    const current = normalizeVersion(currentVersion || cfg.APP_VERSION);
    const latest = normalizeVersion(latestVersion || '');
    const preferred = list.find(a => {
      const name = String(a && a.name || '');
      if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
      const versions = patchAssetVersions(name);
      if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
      return versions[0] === current && name.toLowerCase().includes('patch');
    }) || list.find(a => {
      const name = String(a && a.name || '');
      if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
      const versions = patchAssetVersions(name);
      return versions[0] === current && name.toLowerCase().includes('patch');
    }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
    if (!preferred) return null;
    const digest = assetDigestInfo(preferred);
    const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
    return {
      name: preferred.name || '',
      size: preferred.size || 0,
      contentType: preferred.content_type || '',
      downloadUrl: preferred.browser_download_url || '',
      downloadUrls: publicDownloadUrls(candidates),
      sha256: digest.sha256 || '',
      sha512: digest.sha512 || '',
    };
  }
  function updateAssetNameFromUrl(value) {
    try {
      const u = new URL(String(value || ''));
      const base = path.basename(decodeURIComponent(u.pathname || ''));
      if (base) return base;
    } catch (_) {}
    return path.basename(String(value || '').split('?')[0]) || '';
  }
  function normalizeManifestUpdateInfo(data) {
    data = data || {};
    const release = data.release || {};
    const asset = release.asset || data.asset || {};
    const latestVersion = normalizeVersion(
      data.latestVersion
      || data.version
      || release.version
      || release.tagName
      || release.tag_name
      || release.name
      || cfg.APP_VERSION
    ) || cfg.APP_VERSION;
    const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
    const patch = release.patch || data.patch || null;
    const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
    const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
    const patchInfo = patch && patch.downloadUrl ? {
      name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `Mineradio-${cfg.APP_VERSION}→${latestVersion}.patch.json`,
      size: Number(patch.size || 0) || 0,
      contentType: patch.contentType || patch.content_type || 'application/json',
      downloadUrl: patch.downloadUrl,
      downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
      from: normalizeVersion(patch.from || cfg.APP_VERSION),
      to: normalizeVersion(patch.to || latestVersion),
      sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
      sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    } : null;
    const notes = Array.isArray(release.notes) && release.notes.length
      ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
      : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : cfg.UPDATE_FALLBACK_NOTES);
    const assetInfo = downloadUrl ? {
      name: asset.name || updateAssetNameFromUrl(downloadUrl) || `Mineradio-${latestVersion}-Setup.exe`,
      size: Number(asset.size || 0) || 0,
      contentType: asset.contentType || asset.content_type || '',
      downloadUrl,
      downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
      sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
      sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
    } : null;
    return {
      configured: true,
      preview: false,
      updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, cfg.APP_VERSION) > 0,
      currentVersion: cfg.APP_VERSION,
      latestVersion,
      release: {
        tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
        name: release.name || data.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
        htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
        downloadUrl,
        asset: assetInfo,
        patch: patchInfo,
        patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, cfg.APP_VERSION) > 0),
        summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
        notes,
      },
      source: 'manifest',
    };
  }
  function updateError(code, message, cause) {
    const err = new Error(message || code);
    err.code = code;
    if (cause) err.cause = cause;
    return err;
  }
  function classifyUpdateError(err) {
    const code = String(err && err.code || '').trim();
    const message = String(err && err.message || err || '').trim();
    const detail = message || code || '未知错误';
    if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
      return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
    }
    if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
      return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
    }
    if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
      return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
    }
    if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
      return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
    }
    if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
      return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
    }
    const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
    if (http) {
      const status = Number(http[1]);
      if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
      if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
      if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
      return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
    }
    return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
  }
  function yamlScalar(text, key) {
    const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
    const match = String(text || '').match(pattern);
    if (!match) return '';
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  function githubReleaseDownloadUrl(version, fileName) {
    const tag = 'v' + normalizeVersion(version);
    const encodedOwner = encodeURIComponent(cfg.UPDATE_CONFIG.owner);
    const encodedRepo = encodeURIComponent(cfg.UPDATE_CONFIG.repo);
    const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
    return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
  }
  function parseLatestYmlUpdateInfo(text, reason) {
    const latestVersion = normalizeVersion(yamlScalar(text, 'version') || cfg.APP_VERSION) || cfg.APP_VERSION;
    const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `Mineradio-${latestVersion}-Setup.exe`;
    const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
    const size = Number(yamlScalar(text, 'size') || 0) || 0;
    const releaseDate = yamlScalar(text, 'releaseDate');
    const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath);
    const candidates = uniqueDownloadCandidates(downloadUrl);
    const asset = {
      name: updateAssetNameFromUrl(downloadUrl) || assetPath,
      size,
      contentType: 'application/octet-stream',
      downloadUrl,
      downloadUrls: publicDownloadUrls(candidates),
      sha256: '',
      sha512,
    };
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, cfg.APP_VERSION) > 0,
      currentVersion: cfg.APP_VERSION,
      latestVersion,
      release: {
        tagName: 'v' + latestVersion,
        name: 'Mineradio v' + latestVersion,
        version: latestVersion,
        publishedAt: releaseDate,
        htmlUrl: `https://github.com/${cfg.UPDATE_CONFIG.owner}/${cfg.UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
        downloadUrl,
        asset,
        patch: null,
        patchAvailable: false,
        summary: '发现新版本，已启用备用更新线路。',
        notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
      },
      source: 'latest-yml',
      reason: reason || '',
    };
  }
  function safeUpdateFileName(name, version) {
    const raw = String(name || '').trim() || `Mineradio-${version || cfg.APP_VERSION}.exe`;
    const cleaned = raw
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    return cleaned || `Mineradio-${version || cfg.APP_VERSION}.exe`;
  }
  function sha512Base64(buffer) {
    return crypto.createHash('sha512').update(buffer).digest('base64');
  }
  function sha512Hex(buffer) {
    return crypto.createHash('sha512').update(buffer).digest('hex');
  }
  function sha256Hex(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  return {
    readPackageInfo,
    parseGitHubRepository,
    readUpdateConfig,
    parseUpdateMirrorList,
    readUpdateMirrors,
    normalizeDigest,
    assetDigestInfo,
    buildMirrorUrl,
    uniqueDownloadCandidates,
    publicDownloadUrls,
    normalizeVersion,
    compareVersions,
    cleanReleaseLine,
    extractReleaseNotes,
    pickReleaseAsset,
    patchAssetVersions,
    pickPatchAsset,
    updateAssetNameFromUrl,
    normalizeManifestUpdateInfo,
    updateError,
    classifyUpdateError,
    yamlScalar,
    githubReleaseDownloadUrl,
    parseLatestYmlUpdateInfo,
    safeUpdateFileName,
    sha512Base64,
    sha512Hex,
    sha256Hex,
  };
};
