const fs = require('fs');
const path = require('path');

const DIST_ROOT = path.resolve(__dirname, '..', 'dist');
/** Canonical runnable pack (electron-builder `win-unpacked` lands here). */
const APP_DIR_NAME = 'Mineradio';
const RELEASE_FILE = /^Mineradio-\d+\.\d+\.\d+-Setup\.(exe|exe\.blockmap)$/;
const PATCH_FILE = /^Mineradio-.+-to-.+\.patch\.json$/;
const BUILDER_LOG = /^builder(-.*)?\.ya?ml$/i;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function moveEntry(from, to) {
  ensureDir(path.dirname(to));
  if (fs.existsSync(to)) {
    fs.rmSync(to, { recursive: true, force: true });
  }
  fs.renameSync(from, to);
}

function cleanPackagedPublicJunk(publicDir) {
  if (!fs.existsSync(publicDir)) return;
  fs.readdirSync(publicDir).forEach(function(name) {
    if (/^index\.html\.(bak|modified)$/i.test(name)) {
      fs.unlinkSync(path.join(publicDir, name));
    }
  });
}

function archivePreviousReleases(distRoot, currentVersion) {
  const archiveDir = path.join(distRoot, '_archive', 'previous-releases');
  ensureDir(archiveDir);
  fs.readdirSync(distRoot, { withFileTypes: true }).forEach(function(entry) {
    if (!entry.isFile() || !RELEASE_FILE.test(entry.name)) return;
    const versionMatch = entry.name.match(/^Mineradio-(\d+\.\d+\.\d+)-Setup/);
    if (!versionMatch || versionMatch[1] === currentVersion) return;
    moveEntry(path.join(distRoot, entry.name), path.join(archiveDir, entry.name));
  });
}

async function organizeDist() {
  if (!fs.existsSync(DIST_ROOT)) return;

  const logsDir = path.join(DIST_ROOT, '_logs');
  const inconsistentDir = path.join(DIST_ROOT, '_archive', 'inconsistent-builds');
  [logsDir, inconsistentDir].forEach(ensureDir);

  fs.readdirSync(DIST_ROOT, { withFileTypes: true }).forEach(function(entry) {
    if (!entry.isFile()) return;
    if (BUILDER_LOG.test(entry.name)) {
      moveEntry(path.join(DIST_ROOT, entry.name), path.join(logsDir, entry.name));
      return;
    }
    if (entry.name === 'latest.yml') {
      moveEntry(path.join(DIST_ROOT, entry.name), path.join(inconsistentDir, entry.name));
    }
  });

  // electron-builder emits dist/win-unpacked → promote to dist/Mineradio
  const winUnpackedSrc = path.join(DIST_ROOT, 'win-unpacked');
  const appDst = path.join(DIST_ROOT, APP_DIR_NAME);
  if (fs.existsSync(winUnpackedSrc)) {
    moveEntry(winUnpackedSrc, appDst);
  }

  // Legacy layouts from older organize-dist
  const legacyDev = path.join(DIST_ROOT, '_dev', 'win-unpacked');
  if (fs.existsSync(legacyDev) && !fs.existsSync(appDst)) {
    moveEntry(legacyDev, appDst);
  }
  const legacyDevRoot = path.join(DIST_ROOT, '_dev');
  if (fs.existsSync(legacyDevRoot)) {
    try {
      fs.rmSync(legacyDevRoot, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }

  const pkg = require(path.join(__dirname, '..', 'package.json'));
  archivePreviousReleases(DIST_ROOT, pkg.version);
  cleanPackagedPublicJunk(path.join(appDst, 'resources', 'app', 'public'));

  const rootEntries = fs.readdirSync(DIST_ROOT, { withFileTypes: true });
  const publishable = rootEntries.filter(function(entry) {
    if (!entry.isFile()) return false;
    return RELEASE_FILE.test(entry.name) || PATCH_FILE.test(entry.name);
  });
  console.log(
    '  • dist organized: publishable=' + publishable.length +
    ', app=' + (fs.existsSync(path.join(appDst, 'Mineradio.exe')) ? APP_DIR_NAME : 'no')
  );
}

module.exports = async function afterAllArtifactBuild() {
  try { await organizeDist(); } catch (err) { console.warn('  • organize-dist non-fatal skip: ' + (err.message || err)); }
};

if (require.main === module) {
  organizeDist().catch(function(err) {
    console.error(err);
    process.exit(1);
  });
}
