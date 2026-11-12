'use strict';

/**
 * 探针：判定 error_code 7 到底是不是「频率触发」。
 *
 * 背景：上一轮判定 7 = 上游限流（rate_limited），并据此加了前端轮询防重入锁。
 * 但用户反馈「还是频繁」，所以必须先证伪/证实这个前提本身：
 *   A) 如果快速轮询（200ms 一次）能把全新身份打到 error_code 7 → 7 确实与频率相关，
 *      防重入锁的方向正确。
 *   B) 如果 200ms 连打十几次都还是 0 → 7 与频率无关，是别的条件（身份被标记 /
 *      token 状态 / 请求姿势），那上一轮的方向就是错的，必须换方向。
 *
 * 这是决定性判别，不做任何业务写入、不调 mod.clear()。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/probe-qishui-rate-threshold.js
 *   ... --interval=200 --rounds=15
 *   ... --recover=90     打爆后再等 90 秒，看是否恢复
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'probe-qishui-rate-threshold.log');
try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}

const log = (line) => {
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
};

const argOf = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const assetDir = path.resolve(ROOT, argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'));
const interval = Math.max(0, Number(argOf('interval', '200')) || 200);
const rounds = Math.max(1, Number(argOf('rounds', '15')) || 15);
const recoverWait = Math.max(0, Number(argOf('recover', '0')) || 0);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

async function main() {
  await app.whenReady();
  const mod = loadModule();

  // 每次运行都用全新身份：这正是「用户环境 vs 探针」的差异所在，
  // 先确认全新身份在极端频率下的表现。
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  log('=== error_code 7 是否由频率触发 ===');
  log('asset-dir: ' + assetDir);
  log(`轮询 ${rounds} 次，间隔 ${interval}ms（远快于前端的 2000ms）\n`);

  let envelope;
  try {
    envelope = await mod.getQrCode();
  } catch (err) {
    record(false, 'getQrCode() 成功', String((err && err.message) || err).slice(0, 300));
    return finish(mod);
  }
  const qrData = (envelope && envelope.data) || {};
  const token = String(qrData.token || qrData.qrcode_token || '');
  record(true, 'getQrCode() 成功', `error_code=${qrData.error_code} token=${token ? token.slice(0, 12) + '…' : '(空)'}`);
  if (!token) return finish(mod);

  const codes = [];
  let firstSevenAt = -1;
  const started = Date.now();
  for (let i = 1; i <= rounds; i++) {
    let env = null;
    let errMsg = null;
    try {
      env = await mod.checkQrConnect(token);
    } catch (err) {
      errMsg = String((err && err.message) || err).slice(0, 200);
    }
    const d = (env && env.data) || {};
    const code = Number(d.error_code);
    codes.push(code);
    if (code === 7 && firstSevenAt < 0) firstSevenAt = i;
    const elapsed = Date.now() - started;
    log(`  #${String(i).padStart(2)} t=${String(elapsed).padStart(5)}ms error_code=${d.error_code} ` +
        `status=${d.status || '-'}${errMsg ? ' err=' + errMsg : ''}`);
    if (i < rounds && interval) await sleep(interval);
  }

  const totalMs = Date.now() - started;
  log('');
  log(`code 序列: ${JSON.stringify(codes)}`);
  log(`总耗时 ${totalMs}ms，平均 ${Math.round(totalMs / rounds)}ms/次`);
  log('');

  // 核心判别
  if (firstSevenAt > 0) {
    record(true, `【A】快速轮询确实触发 7（第 ${firstSevenAt} 次）`,
      '7 与频率相关 → 防重入锁方向正确');
  } else {
    record(false, '【A】快速轮询没有触发 7',
      `打了 ${rounds} 次、平均 ${Math.round(totalMs / rounds)}ms/次仍是 ${JSON.stringify([...new Set(codes)])} → 7 与频率无关`);
  }

  // 频率估算：用户的真实环境是 2 秒一次，跑了 30 分钟
  const userRate = 2000;
  log(`参考：用户环境 2 秒/次，30 分钟 ≈ ${Math.round(30 * 60 * 1000 / userRate)} 次请求`);

  // 恢复测试
  if (recoverWait > 0) {
    log(`\n等 ${recoverWait}s 后再打一次（看 7 是否有窗口期）…`);
    await sleep(recoverWait * 1000);
    let env = null;
    try { env = await mod.checkQrConnect(token); } catch (_) {}
    const d = (env && env.data) || {};
    log(`  恢复后 error_code=${d.error_code} status=${d.status || '-'}`);
    record(Number(d.error_code) !== 7, `等待 ${recoverWait}s 后不再是 7`, `error_code=${d.error_code}`);
  }

  return finish(mod);
}

function finish(mod) {
  // 绝不调用 mod.clear()：会对 persist:mineradio-qishui-auth-v6 执行
  // clearStorageData，跑在真实 userData 下会清掉用户真实登录态。
  try {
    const rt = mod && mod.__getRuntime && mod.__getRuntime();
    if (rt) {
      if (rt.window && !rt.window.isDestroyed()) rt.window.destroy();
      if (rt.assetServer) rt.assetServer.close();
    }
  } catch (_) {}
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  log(`\n${passed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
}

main().catch(err => {
  log('[probe-error] ' + ((err && err.stack) || err));
  app.exit(2);
});
