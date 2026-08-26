const { fs, path, appRoot, rel, fail, logStep, walk, forbiddenPattern } = require('./helpers');

function parseCombinedIndexModules() {
  logStep('Combined index module parse');
  const publicDir = path.join(appRoot, 'public');
  const loaderPath = path.join(publicDir, 'js', 'index-loader.js');
  const loader = fs.readFileSync(loaderPath, 'utf8');
  const match = loader.match(/const modulePaths = \[([\s\S]*?)\n\s*\]/);
  if (!match) fail('modulePaths not found in public/js/index-loader.js');
  const modulePaths = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const combined = modulePaths
    .map(modulePath => fs.readFileSync(path.join(publicDir, modulePath), 'utf8'))
    .join('\n');
  new Function(combined);
  console.log(`[OK] Combined classic script parses. Modules: ${modulePaths.length}.`);
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
