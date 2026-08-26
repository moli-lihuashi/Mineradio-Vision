'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function pluginDirs() {
  const dirs = [];
  try {
    dirs.push(path.join(app.getPath('userData'), 'plugins', 'liquidglass'));
  } catch (_) {}
  try {
    dirs.push(path.join(app.getAppPath(), 'public', 'plugins', 'liquidglass'));
  } catch (_) {}
  return dirs;
}

function ensureUserPluginDir() {
  try {
    const dir = path.join(app.getPath('userData'), 'plugins', 'liquidglass');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (_) {
    return '';
  }
}

function listLiquidGlassPluginFiles() {
  const files = [];
  pluginDirs().forEach((dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      if (!/\.js$/i.test(name)) return;
      files.push(path.join(dir, name));
    });
  });
  return files;
}

function readLiquidGlassPluginScripts() {
  return listLiquidGlassPluginFiles().map((file) => {
    try {
      return {
        id: path.basename(file, '.js'),
        file,
        source: fs.readFileSync(file, 'utf8'),
      };
    } catch (e) {
      return { id: path.basename(file, '.js'), file, error: e.message || 'READ_FAILED' };
    }
  }).filter((item) => item && item.source);
}

module.exports = {
  ensureUserPluginDir,
  listLiquidGlassPluginFiles,
  readLiquidGlassPluginScripts,
  pluginDirs,
};
