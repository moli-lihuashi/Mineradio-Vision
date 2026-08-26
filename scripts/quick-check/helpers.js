const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

// appRoot resolves to project root: scripts/quick-check/ -> ../.. = project root
const appRoot = path.resolve(__dirname, '..', '..');
const runElectron = process.argv.includes('--electron') || process.argv.includes('--full');
const forbiddenPattern = /\b(fsr|dlss|native-fg|framegen)\b|frame generation/i;

function rel(file) {
  return path.relative(appRoot, file).replace(/\\/g, '/');
}

function logStep(name) {
  console.log(`\n== ${name} ==`);
}

function fail(message) {
  throw new Error(message);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'dist-internal-beta', 'vendor'].includes(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function jsCheckFiles() {
  const files = [];
  const addIfExists = file => {
    if (fs.existsSync(file)) files.push(file);
  };

  walk(path.join(appRoot, 'public', 'js', 'modules')).forEach(file => {
    if (file.endsWith('.js')) files.push(file);
  });
  addIfExists(path.join(appRoot, 'public', 'js', 'index-loader.js'));
  walk(path.join(appRoot, 'desktop')).forEach(file => {
    if (file.endsWith('.js')) files.push(file);
  });
  addIfExists(path.join(appRoot, 'server.js'));
  addIfExists(path.join(appRoot, 'qq-vip-api.js'));
  addIfExists(path.join(appRoot, 'dj-analyzer.js'));
  walk(path.join(appRoot, 'cuefield')).forEach(file => {
    if (file.endsWith('.js')) files.push(file);
  });

  return [...new Set(files)].sort();
}

function runNodeSyntaxCheck(files) {
  logStep('Node syntax check');
  let checked = 0;
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: appRoot,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      fail(`node --check failed: ${rel(file)}`);
    }
    checked += 1;
  }
  console.log(`[OK] Checked ${checked} JavaScript files.`);
}

module.exports = {
  fs, os, path, vm, spawnSync, appRoot, runElectron, forbiddenPattern,
  rel, logStep, fail, walk, jsCheckFiles, runNodeSyntaxCheck
};
