'use strict';
/**
 * Sync latest source into the packaged app:
 *   dist/Mineradio/resources/app            （默认目标，用户日常启动的就是它）
 *
 * 可选：第 1 个参数指定别的 app 目录，用来把并行存在的另一份打包树一起刷新，
 * 例如 dist/win-unpacked/resources/app（electron-builder 的 unpacked 输出，
 * 它与 dist/Mineradio 是两棵独立的树，只同步一棵会让「启动哪个 exe」决定看到新代码还是老代码）。
 *   node scripts/sync-dist-app.js dist/win-unpacked/resources/app
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targetArg = process.argv[2];
const app = targetArg
  ? path.resolve(root, targetArg)
  : path.join(root, 'dist', 'Mineradio', 'resources', 'app');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyTree(srcDir, dstDir, filter) {
  if (!fs.existsSync(srcDir)) return 0;
  let n = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      const s = path.join(from, name);
      const d = path.join(to, name);
      const st = fs.statSync(s);
      if (st.isDirectory()) {
        if (filter && !filter(s, true)) continue;
        walk(s, d);
      } else {
        if (filter && !filter(s, false)) continue;
        copyFile(s, d);
        n++;
      }
    }
  };
  walk(srcDir, dstDir);
  return n;
}

if (!fs.existsSync(app)) {
  console.error('Missing packaged app:', app);
  console.error('Build once with: npm run build:win:dir');
  process.exit(1);
}

let files = 0;

// Full public tree (modules, css, assets)
files += copyTree(path.join(root, 'public'), path.join(app, 'public'), (p) => {
  const base = path.basename(p);
  if (/^index\.html\.(bak|modified)$/i.test(base)) return false;
  if (base === '.DS_Store') return false;
  return true;
});

// Desktop main / preload
files += copyTree(path.join(root, 'desktop'), path.join(app, 'desktop'));

// Root runtime files used by package.json "files"
const rootFiles = [
  'server.js',
  'dj-analyzer.js',
  'kugou-api.js',
  'spotify-api.js',
  'qishui-api.js',
  'qq-vip-api.js',
  'package.json',
];
for (const rel of rootFiles) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  copyFile(src, path.join(app, rel));
  files++;
}

// 音频解密模块（package.json files 已纳入 qishui-audio-decryptor/**/*）
const decryptorSrc = path.join(root, 'qishui-audio-decryptor');
if (fs.existsSync(decryptorSrc)) files += copyTree(decryptorSrc, path.join(app, 'qishui-audio-decryptor'));

// Optional trees if present in pack / source
for (const dir of ['server', 'cuefield', 'build']) {
  const src = path.join(root, dir);
  const dst = path.join(app, dir);
  if (fs.existsSync(src)) files += copyTree(src, dst);
}

// Native JS entry (binary .node left as-is from pack)
const nativeIdx = path.join(root, 'native', 'mineradio-bpm', 'index.js');
if (fs.existsSync(nativeIdx)) {
  copyFile(nativeIdx, path.join(app, 'native', 'mineradio-bpm', 'index.js'));
  files++;
}

console.log('synced', files, 'files ->', app);
if (targetArg) {
  console.log('note: 这是额外目标；默认目标仍是 dist/Mineradio/resources/app');
} else {
  console.log('run:', path.join(root, 'dist', 'Mineradio', 'Mineradio.exe'));
}
