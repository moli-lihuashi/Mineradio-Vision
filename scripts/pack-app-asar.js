'use strict';

/*
 * 把 dist 的 resources/app 目录原地打成 app.asar（验证用，不重新打 exe）。
 *
 * 为什么需要这个脚本：electron-builder 全量打包要几分钟，而 asar 化的风险点
 * 集中在「运行期能不能读到文件」，用同一份 app 目录直接 pack 就能验证。
 * Electron 启动时优先加载 resources/app.asar，所以打完直接启动即可；
 * app 目录故意保留 —— 出问题删掉 app.asar 就能立刻回退。
 *
 * unpack 清单（少一项都会在运行期炸）：
 *   native/**               —— bindings 用 fs 扫真实路径，.node 不能 dlopen asar 内路径
 *   **\/*.node               —— 兜底所有 native 插件
 *   qishui-audio-decryptor/** —— worker_threads 打不开 asar 内文件（Node 无 asar 补丁）
 *
 * 用法：node scripts/pack-app-asar.js
 */

const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'dist', 'Mineradio', 'resources');
const APP_DIR = path.join(RES, 'app');
const OUT = path.join(RES, 'app.asar');
const UNPACKED = OUT + '.unpacked';
/* Windows 上 @electron/asar 把「绝对路径」喂给 minimatch，相对 glob 只会偶然命中；
 * 这里用两种它真正可靠的匹配方式：
 *   unpack: '*.node'                —— matchBase，按 basename 命中所有 native 插件
 *   unpackDir: 'qishui-audio-decryptor' —— 相对路径前缀匹配，整目录 unpack
 * qishui 目录必须整块 unpack：worker_threads 用原生 fs 打开脚本，Node 没有 asar 补丁。 */
const UNPACK_GLOB = '*.node';
const UNPACK_DIR = 'qishui-audio-decryptor';
/* Folia 面板模组也要整块 unpack：模组的 index.cjs 会起 worker_threads 跑 analytics.cjs，
 * 而 worker 用原生 fs 打开脚本（Node 没有 Electron 的 asar 补丁）。
 * @electron/asar 的 unpackDir 只收一个字符串，用 brace 展开同时命中两个目录。 */
const UNPACK_DIR_PANEL_MODS = 'public/folia-panel-mods';
const UNPACK_DIR_GLOB = '{' + UNPACK_DIR + ',' + UNPACK_DIR_PANEL_MODS + '}';

function fail(msg) {
  console.error('[pack-app-asar] ' + msg);
  process.exit(1);
}

(async () => {
  if (!fs.existsSync(APP_DIR)) fail('找不到 ' + APP_DIR + '（先跑 npm run build:win:dir 或 sync-dist）');

  if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true });
  if (fs.existsSync(UNPACKED)) fs.rmSync(UNPACKED, { recursive: true, force: true });

  const startedAt = Date.now();
  await asar.createPackageWithOptions(APP_DIR, OUT, { unpack: UNPACK_GLOB, unpackDir: UNPACK_DIR_GLOB });
  const ms = Date.now() - startedAt;

  const mustUnpacked = [
    'native/mineradio-bpm/build/Release/bpm_native.node',
    'qishui-audio-decryptor/decrypt-worker.js',
    'qishui-audio-decryptor/decrypt-utils.js',
    'qishui-audio-decryptor/mp4-box.js',
    /* 听歌档案：入口是主进程 require，analytics.cjs 是 worker 脚本，两个都必须是实体文件 */
    'public/folia-panel-mods/listening-archive/index.cjs',
    'public/folia-panel-mods/listening-archive/analytics.cjs',
  ];
  for (const rel of mustUnpacked) {
    if (!fs.existsSync(path.join(UNPACKED, rel))) fail('未 unpack：' + rel);
  }

  const mustPacked = ['server.js', 'desktop/main.js', 'public/index.html', 'node_modules'];
  const entries = asar.listPackage(OUT);
  for (const rel of mustPacked) {
    if (!entries.some((e) => e.replace(/\\/g, '/').includes('/' + rel))) fail('未打进 asar：' + rel);
  }

  const sizeMb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  const unpackedCount = entries.filter((e) => /app\.asar\.unpacked/.test(e)).length;
  console.log('[pack-app-asar] ok  ' + sizeMb + 'MB  ' + ms + 'ms  entries=' + entries.length + '  unpacked=' + unpackedCount);
  console.log('[pack-app-asar] 回退方式：删除 ' + OUT + ' 后重启');
})().catch((err) => fail((err && err.stack) || String(err)));
