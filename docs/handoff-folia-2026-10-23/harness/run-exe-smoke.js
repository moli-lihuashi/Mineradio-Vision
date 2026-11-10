/* 通用 exe 冒烟跑者（可复用）。
 *
 * 为什么需要它：exe 侧冒烟打印完结论后**进程不会自己退出**（Electron 孙子进程还挂着 ws），
 * bash 里直接跑会一直挂着直到被 SIGTERM，且 spawnSync + 管道会被孙子进程继承而卡死。
 * 做法：spawn + 文件 fd 接 stdout/stderr → 轮询日志收尾行 → SIGKILL 子进程 → taskkill 清 exe。
 *
 * 用法：
 *   node .workbuddy/harness/run-exe-smoke.js                        # 默认跑 smoke-folia-tempera.js
 *   node .workbuddy/harness/run-exe-smoke.js smoke-folia-sonnet.js   # 跑指定脚本（可省略 .js）
 *   node .workbuddy/harness/run-exe-smoke.js --no-sync               # 跳过 sync-dist
 *   退出码：结论 ALL PASS → 0，否则 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const NODE = process.execPath;
const HARNESS = __dirname;

const argv = process.argv.slice(2);
const noSync = argv.includes('--no-sync');
const name = argv.find((a) => !a.startsWith('--')) || 'smoke-folia-tempera.js';
const SMOKE = path.join(HARNESS, name.endsWith('.js') ? name : name + '.js');
const LOG = path.join(HARNESS, 'out-exe-smoke.txt');

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/* 两种 FAILED 汇总都要认：'FAILED 1 / 46'（老格式）和 'FAILED 1 (46 项)'（部分脚本的格式）。
 * 漏认会把已跑完的冒烟误判成 TIMEOUT，白等 180s 还挨 SIGKILL（finally 清理被搅黄）。 */
const SUMMARY_RE = /^(ALL PASS \(\d+ 项\)|FAILED \d+(?: \/ \d+| \(\d+ 项\)))$/m;
/* 脚本中途抛异常时只会打 'SMOKE ERROR xxx' 然后走 finally 退出，永远等不到汇总行 ——
 * 只认 SUMMARY_RE 的话这里会白等满 deadline 再报 TIMEOUT，把「崩了」误诊成「卡住了」。
 * （smoke-folia-background 就踩过：sora 画布偶发没挂上 → 后面的断言全 undefined → 崩，
 *   日志里明明有五条 FAIL，跑完却被记成 TIMEOUT。） */
const CRASH_RE = /^SMOKE ERROR/m;
const DONE_RE = (t) => SUMMARY_RE.test(t) || CRASH_RE.test(t);
const killExe = () => { try { execSync('taskkill /F /IM Mineradio.exe', { stdio: 'ignore' }); } catch (_) {} };

if (!noSync) {
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'sync-dist-app.js')], { encoding: 'utf8', cwd: ROOT });
  const line = ((r.stdout || '').match(/synced \d+ files.*/) || ['' + (r.stdout || '')])[0];
  console.log('[sync] ' + line.trim());
  if (r.status !== 0) { console.log('[sync] 失败：' + (r.stderr || '').slice(0, 600)); process.exit(1); }
}

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE; /* 本机该变量常驻 =1，会让 Electron 退化成纯 node */

killExe(); /* 残留实例会占着端口，新冒烟会连到旧页面 */
const fd = fs.openSync(LOG, 'w');
const child = spawn(NODE, [SMOKE], { stdio: ['ignore', fd, fd], cwd: ROOT, env });
/* 180s 对大多数冒烟够用，但刚 sync 完的第一次启动（冷启动 + 首次读盘）会明显变慢：
 * background(87 项) 就踩过一次假 TIMEOUT（重跑即全过）。默认抬到 240s —— 这只是上限，
 * 真要卡死照样超时，正常跑到点不会等这么久。 */
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS || 240000);
let text = '';
while (Date.now() < deadline) {
  text = fs.readFileSync(LOG, 'utf8');
  if (DONE_RE(text)) break;
  sleepMs(500);
}
try { child.kill('SIGKILL'); } catch (_) {}
killExe();
fs.closeSync(fd);

const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
const crashLine = (text.match(/^SMOKE ERROR.*$/m) || [])[0];
const passMatch = text.match(/ALL PASS \(\d+ 项\)/);
const failMatch = text.match(/FAILED \d+(?: \/ \d+| \(\d+ 项\))/);
/* 别写成 (a || b || '字面量')[0] —— 命字面量分支时 [0] 会取到第一个字符。 */
const summary = passMatch ? passMatch[0]
  : failMatch ? failMatch[0]
    : (crashLine ? 'SMOKE ERROR（脚本中途崩了）' : 'TIMEOUT');
/* 超时/崩溃时把这份日志另存一份：批跑里后面那几条会把 out-exe-smoke.txt 覆盖掉，
 * 事后只剩「TIMEOUT」一个词，没法判断卡在哪一段。 */
if (!SUMMARY_RE.test(text)) {
  const stamp = path.basename(SMOKE, '.js') + '-' + Date.now() + '.txt';
  const keep = path.join(path.dirname(LOG), 'out-timeout-' + stamp);
  try { fs.copyFileSync(LOG, keep); console.log('（异常日志留档：' + keep + '）'); } catch (_) {}
}
const fails = lines.filter((l) => l.indexOf('FAIL') >= 0);
for (const l of fails.slice(0, 20)) console.log(l);
if (crashLine) console.log(crashLine);
console.log('[exe] ' + summary + (SUMMARY_RE.test(text) ? '' : '（日志：' + LOG + '）'));
process.exit(/^ALL PASS/.test(summary) ? 0 : 1);
