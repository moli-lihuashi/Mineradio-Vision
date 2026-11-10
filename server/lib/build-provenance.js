'use strict';

// =============================================================================
// 构建溯源（借 Folia buildProvenance 的思路，落到本仓库最实际的故障上）
//
// 这个项目最大的排障干扰是「改了源码没同步 dist」和「覆盖层页面被 HTTP 缓存」：
// 用户跑的是 dist/Mineradio/Mineradio.exe，代码在 dist/Mineradio/resources/app/ 独立副本。
// 诊断报告直接给出源码 / dist 关键文件 sha256 对照，一眼分辨跑的是哪份代码。
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 挑真正会引发「改了没反应」的运行时文件，不全树扫描（全树扫描又慢又会被并行会话干扰）。
const TRACKED_FILES = [
  'server.js',
  'kugou-api.js',
  'server/lib/http-request.js',
  'server/lib/kugou-service.js',
  'server/kugou/http.js',
  'public/index.html',
  'public/js/index-loader.js',
  'public/js/modules/06-lyrics/02-playlist-detail.js',
  'public/js/modules/05-playback/09d-playback-stall-recovery.js',
  // B 档新增：这些文件同样会被「改了源码忘了同步 dist」坑到，必须一起对照。
  'server/lib/self-check.js',
  'server/lib/cache-prune.js',
  'server/routes/debug.js',
  'public/js/modules/00-state/00-storage-migration.js',
  'public/js/modules/05-playback/09f-playback-source-revision.js',
  'public/js/modules/10-shell/05-diagnostics.js',
];

const DIST_APP_PARTS = ['dist', 'Mineradio', 'resources', 'app'];

function sha256Of(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) { return null; }
}

function readCommit(appRoot) {
  try {
    return String(execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: appRoot, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    })).trim() || 'unknown';
  } catch (_) { return 'unknown'; }
}

function readPackageMeta(appRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    return { name: String(pkg.name || 'unknown'), version: String(pkg.version || 'unknown') };
  } catch (_) { return { name: 'unknown', version: 'unknown' }; }
}

function readAppVersion(appRoot) {
  try {
    const html = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
    const m = /data-app-version\s*=\s*["']([^"']+)["']/.exec(html);
    return m ? m[1] : 'unknown';
  } catch (_) { return 'unknown'; }
}

function collectBuildProvenance(options) {
  const opts = options || {};
  const appRoot = opts.appRoot || path.resolve(__dirname, '..', '..');
  const rtRaw = String(opts.runtimeAppRoot || __dirname);
  const now = opts.now || Date.now;
  /* 打包副本里 __dirname 是 <root>/dist/Mineradio/resources/app/server/routes：
   * 源码树在标记之前，dist 副本在 routes 往上两层。若把运行时目录当源码树再往里找 dist，
   * 会得出「未找到 dist」的假结论 —— 恰恰是最需要溯源的那个场景。
   * 归一化只用运行时分隔符常量，不在源码里写死反斜杠字面量。 */
  const normalized = rtRaw.toLowerCase().split(path.win32.sep).join('/').split(path.posix.sep).join('/');
  const markerPos = normalized.indexOf('dist/mineradio/resources/app');
  const packaged = markerPos >= 0;
  let sourceRoot = appRoot;
  if (packaged) {
    const prefix = rtRaw.slice(0, markerPos);
    let end = prefix.length;
    while (end > 0 && (prefix[end - 1] === path.posix.sep || prefix[end - 1] === path.win32.sep)) end--;
    sourceRoot = prefix.slice(0, end) || path.parse(rtRaw).root;
  }
  const distDir = packaged
    ? path.resolve(rtRaw, '..', '..')
    : path.join.apply(path, [appRoot].concat(DIST_APP_PARTS));
  const distPresent = fs.existsSync(distDir);

  const files = TRACKED_FILES.map(rel => {
    const sourceSha256 = sha256Of(path.join(sourceRoot, rel));
    const distSha256 = distPresent ? sha256Of(path.join(distDir, rel)) : null;
    return {
      path: rel,
      sourceSha256,
      distSha256,
      synced: !!sourceSha256 && sourceSha256 === distSha256,
    };
  });
  const mismatches = files.filter(item => !item.synced).map(item => item.path);
  const dist = {
    present: distPresent,
    path: path.relative(sourceRoot, distDir).replace(/\\/g, '/'),
    synced: distPresent && mismatches.length === 0,
    mismatches: distPresent ? mismatches : [],
  };

  const hints = [];
  if (!distPresent) hints.push('未找到 dist/Mineradio/resources/app/，构建溯源只能核对源码树。');
  else if (mismatches.length) {
    hints.push('源码与打包副本不一致：先跑 node scripts/sync-dist-app.js，再逐文件 sha256 比对。');
  }
  if (packaged && mismatches.length) {
    hints.push('当前进程跑的是打包副本；上面的不一致文件就是你改了却没生效的那几个。');
  }
  if (!mismatches.length && distPresent) {
    hints.push('覆盖层页面若仍显示旧内容，属于 HTTP 缓存：URL 带 ?hotfix=1 或设置 localStorage.mineradio_nocache=1。');
  }

  return {
    kind: packaged ? 'packaged' : 'source',
    repo: readPackageMeta(sourceRoot).name,
    version: readPackageMeta(sourceRoot).version,
    commit: readCommit(sourceRoot),
    appVersion: readAppVersion(sourceRoot),
    generatedAt: new Date(now()).toISOString(),
    runtimeAppRoot: rtRaw,
    sourceRoot,
    dist,
    files,
    hints,
  };
}

module.exports = { TRACKED_FILES, DIST_APP_PARTS, sha256Of, collectBuildProvenance };
