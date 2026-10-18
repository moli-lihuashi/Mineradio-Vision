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

// 汽水模块族源码拼合。
//
// 背景：qishui-api.js 原本是单文件巨石，很多守卫/测试直接 readFileSync 它做文本断言
// （22 处）。拆分后声明分散到 server/qishui/*.js，单文件读取会让「能力还在」的断言
// 假失败 —— 断言的语义是「这个能力还在代码里」，不是「在第几行」。
//
// 顺序：qishui-api.js 在前，server/qishui/*.js 按文件名排序。
// 需要靠相对位置切片的断言（如 guard 里 indexOf('async function fetchQishuiWebLibrary')
// 到 indexOf('async function handleQishuiStatus')）依赖这个顺序 —— 两个函数都还在
// qishui-api.js 里，顺序与原文件一致，所以切片仍然成立。
function readQishuiSources(root) {
  return readPluginFamilySources(root, 'qishui-api.js', 'server/qishui');
}

// 插件族通用族读：门面文件在前，实现目录里的 .js 按文件名排序在后。
// 三个插件族（qishui / kugou / spotify）都是这个形态，新增一族只需加一个一行包装函数。
function readPluginFamilySources(root, entryName, subDir) {
  const base = root || appRoot;
  const files = [path.join(base, entryName)];
  const dir = path.join(base, subDir);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return joinSourceFiles(files);
}

function readKugouSources(root) {
  return readPluginFamilySources(root, 'kugou-api.js', 'server/kugou');
}

function readSpotifySources(root) {
  return readPluginFamilySources(root, 'spotify-api.js', 'server/spotify');
}

// server.js 主体的族读：server.js + server/lib/*.js。
// 服务端拆分把逻辑搬进 server/lib/*.js 后，凡「server.js 里必须有 X」的断言都要按族读，
// 否则搬走一个就变成假失败 / 假通过（否定式断言搬走后是恒真）。
function readServerEntrySources(root) {
  const base = root || appRoot;
  const files = [path.join(base, 'server.js')];
  const dir = path.join(base, 'server', 'lib');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return joinSourceFiles(files);
}

function joinSourceFiles(files) {
  return files
    .filter(file => fs.existsSync(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

module.exports = {
  fs, os, path, vm, spawnSync, appRoot, runElectron, forbiddenPattern,
  rel, logStep, fail, walk, jsCheckFiles, runNodeSyntaxCheck, joinSourceFiles,
  readQishuiSources, readPluginFamilySources, readKugouSources, readSpotifySources,
  readServerEntrySources
};
