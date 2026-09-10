const { fs, path, appRoot, rel, fail, logStep, walk, forbiddenPattern } = require('./helpers');

function parseCombinedIndexModules() {
  logStep('Combined index module parse');
  const publicDir = path.join(appRoot, 'public');
  const loaderPath = path.join(publicDir, 'js', 'index-loader.js');
  const loader = fs.readFileSync(loaderPath, 'utf8');
  const coreStart = loader.indexOf('const modulePaths');
  if (coreStart < 0) fail('modulePaths not found in public/js/index-loader.js');
  const deferredStart = loader.indexOf('const deferredModulePaths');
  const coreSrc = deferredStart > coreStart ? loader.slice(coreStart, deferredStart) : loader.slice(coreStart);
  // concat 链会拆成多段数组，统一抽 'js/modules/...' 路径
  const modulePaths = [...coreSrc.matchAll(/'(js\/modules\/[^']+)'/g)].map(m => m[1]);
  if (!modulePaths.length) fail('modulePaths parsed empty');
  const combined = modulePaths
    .map(modulePath => fs.readFileSync(path.join(publicDir, modulePath), 'utf8'))
    .join('\n');
  new Function(combined);
  console.log(`[OK] Combined classic script parses. Modules: ${modulePaths.length}.`);

  if (deferredStart >= 0) {
    const deferredSrc = loader.slice(deferredStart, loader.indexOf('];', deferredStart) + 2);
    const deferredPaths = [...deferredSrc.matchAll(/'(js\/modules\/[^']+)'/g)].map(m => m[1]);
    if (!deferredPaths.length) fail('deferredModulePaths parsed empty');
    const overlap = deferredPaths.filter(p => modulePaths.includes(p));
    if (overlap.length) fail('deferred modules overlap core modulePaths: ' + overlap.join(', '));
    const deferredCombined = deferredPaths
      .map(modulePath => fs.readFileSync(path.join(publicDir, modulePath), 'utf8'))
      .join('\n');
    new Function(deferredCombined);
    console.log(`[OK] Deferred classic script parses. Modules: ${deferredPaths.length}.`);
  }
}

function scanForbiddenMarkers() {
  logStep('Forbidden FSR/DLSS/native FG scan');
  const scanTargets = [
    path.join(appRoot, 'public', 'js'),
    path.join(appRoot, 'desktop'),
    path.join(appRoot, 'server.js'),
    path.join(appRoot, 'dj-analyzer.js'),
    path.join(appRoot, 'cuefield')
  ];
  const files = [];
  for (const target of scanTargets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      walk(target).forEach(file => {
        if (/\.(js|json|html|css)$/i.test(file)) files.push(file);
      });
    } else {
      files.push(target);
    }
  }

  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (forbiddenPattern.test(text)) hits.push(rel(file));
  }
  if (hits.length) fail(`Forbidden markers found:\n${hits.join('\n')}`);
  console.log(`[OK] No FSR/DLSS/native FG markers in ${files.length} scanned files.`);
}

module.exports = {
  parseCombinedIndexModules, scanForbiddenMarkers
};
