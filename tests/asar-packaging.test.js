'use strict';

/*
 * asar 打包守卫（2026-11-23）
 *
 * asar 的收益是冷启动少开 2700 个文件，风险全在「运行期还能不能拿到文件」：
 *   1) .node 必须 unpack —— process.dlopen 需要真实路径，bindings 还会用 fs 扫目录；
 *   2) qishui-audio-decryptor 必须整目录 unpack —— worker_threads 用原生 fs 打开脚本，
 *      Node 没有 Electron 那套 asar 补丁；
 *   3) 用户数据不能落在 __dirname（asar 内只读）—— 已确认 cookie 系列和
 *      cuefield 反馈都重定向到 userData；
 *   4) 热补丁写 app.getAppPath()，asar 形态下必须 fail-closed，而不是报 ENOTDIR；
 *   5) sync-dist 只更新 app/，若留着旧 app.asar 会遮蔽新代码（「改了完全没反应」）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACK = fs.readFileSync(path.join(ROOT, 'scripts/pack-app-asar.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'scripts/sync-dist-app.js'), 'utf8');
const UPDATE = fs.readFileSync(path.join(ROOT, 'server/lib/update-service.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');

test('正式构建开启 asar 并 unpack native 与解密 worker', () => {
  assert.equal(PKG.build.asar, true, 'build.asar 必须为 true');
  const list = PKG.build.asarUnpack || [];
  assert.ok(list.some((p) => p === '**/*.node' || p.includes('*.node')), 'asarUnpack 必须覆盖 .node');
  assert.ok(list.some((p) => p.startsWith('qishui-audio-decryptor')), 'asarUnpack 必须覆盖解密 worker 目录');
});

test('本地 pack 脚本用 Windows 可靠的两段匹配', () => {
  assert.match(PACK, /unpack:\s*UNPACK_GLOB/, '必须传 unpack');
  assert.match(PACK, /unpackDir:\s*UNPACK_DIR/, '必须传 unpackDir');
  assert.match(PACK, /const UNPACK_GLOB = '\*\.node';/, 'unpack 用 basename 匹配（matchBase）');
  assert.match(PACK, /const UNPACK_DIR = 'qishui-audio-decryptor';/, 'unpackDir 用相对路径前缀');
  assert.match(PACK, /bpm_native\.node/, '必须校验 native 产物已 unpack');
  assert.match(PACK, /decrypt-worker\.js/, '必须校验 worker 已 unpack');
});

test('用户数据不得写进 asar：cuefield 反馈重定向到 userData', () => {
  assert.match(MAIN, /process\.env\.CUEFIELD_FEEDBACK_FILE\s*=\s*path\.join\(_stableUserData/, '必须在 require(server.js) 前设置 CUEFIELD_FEEDBACK_FILE');
  const mainAt = MAIN.indexOf('process.env.CUEFIELD_FEEDBACK_FILE');
  const requireAt = MAIN.indexOf("path.join(__dirname, '..', 'server.js')");
  assert.ok(mainAt > 0 && requireAt > 0, '两处都必须存在');
  assert.ok(mainAt < requireAt, 'env 必须早于 require(server.js)');
});

test('热补丁在 asar 形态下 fail-closed', () => {
  const fn = UPDATE.slice(UPDATE.indexOf('function patchTargetPath(rel)'), UPDATE.indexOf('function decodePatchFile(file)'));
  assert.match(fn, /\.asar\(\$\|\[\\\\\/\]\)/i, '必须识别 appRoot 以 .asar 结尾');
  assert.match(fn, /return null/, '必须返回 null 而不是拼出不存在的路径');
});

test('sync-dist 会清掉残留 app.asar，避免遮蔽新代码', () => {
  assert.match(SYNC, /app\.asar/, '必须处理 app.asar');
  assert.match(SYNC, /rmSync\(asarPath/, '必须删除残留 asar');
  assert.match(SYNC, /removed stale app\.asar/, '必须打印提示');
});
