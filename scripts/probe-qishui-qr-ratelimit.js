'use strict';

/**
 * 探针：汽水扫码登录「扫码过于频繁，60 秒后自动重试」实测。
 *
 * 症状（用户截图）：二维码正常显示，但状态栏立刻提示「扫码过于频繁」，
 * 60 秒后重试还是同样提示，永远登不上。
 *
 * 判定路径：/api/qishui/login/check → qishui-qr-login.checkQrConnect
 *   → qishui-auth-v6.checkQrConnect → POST /passport/web/check_qrconnect/
 *   → data.error_code === 7 → routes/qishui.js 映射成 status='rate_limited'
 *   → 前端停轮询 + 等 60s。
 *
 * 本探针直接调真实模块，打印**原始 envelope**，用来回答三个问题：
 *   1) error_code 7 到底是上游真限流，还是我们请求姿势不对（参数/头/签名）？
 *   2) 2 秒一次的轮询是不是把它打出来的？
 *   3) 停 60 秒再试能不能恢复？
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/probe-qishui-qr-ratelimit.js
 *   ... --asset-dir=dist/Mineradio/resources/app   验 dist
 *   ... --rounds=5 --interval=2000                 自定义轮询次数/间隔
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');

const argOf = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const assetDir = path.resolve(
  ROOT,
  argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'),
);
const rounds = Math.max(1, Number(argOf('rounds', '4')) || 4);
const interval = Math.max(0, Number(argOf('interval', '2000')) || 2000);
const waitAfter = Math.max(0, Number(argOf('wait-after', '0')) || 0);

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const note = text => console.log('     ' + text);

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await app.whenReady();
  const mod = loadModule();

  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  console.log('=== 汽水扫码登录限流实测 ===');
  console.log('asset-dir: ' + assetDir);
  console.log(`轮询 ${rounds} 次，间隔 ${interval}ms\n`);

  // ---- 1) 拿二维码 ----
  let envelope;
  try {
    envelope = await mod.getQrCode();
  } catch (err) {
    record(false, 'getQrCode() 成功', String((err && err.message) || err).slice(0, 300));
    finish(mod);
    return;
  }
  const qrData = (envelope && envelope.data) || {};
  const token = String(qrData.token || qrData.qrcode_token || '');
  record(true, 'getQrCode() 成功', `error_code=${qrData.error_code} token=${token ? token.slice(0, 12) + '…' : '(空)'}`);

  if (!token) {
    record(false, '拿到二维码 token', '上游没给 token，后续无法轮询');
    finish(mod);
    return;
  }
  note('scan_url: ' + String(qrData.scan_url || '').slice(0, 100));

  // ---- 2) 连续轮询，记录每次原始 error_code ----
  const polls = [];
  for (let i = 1; i <= rounds; i++) {
    let env = null;
    let errMsg = null;
    try {
      env = await mod.checkQrConnect(token);
    } catch (err) {
      errMsg = String((err && err.message) || err).slice(0, 300);
    }
    const d = (env && env.data) || {};
    const row = {
      i,
      errorCode: d.error_code,
      status: d.status,
      description: d.description || d.message || (env && env.message) || '',
      confirmed: d.confirmed,
      errMsg,
    };
    polls.push(row);
    console.log(
      `  #${i} error_code=${row.errorCode} status=${row.status || '-'} ` +
      `desc=${String(row.description).slice(0, 60) || '-'}` +
      (errMsg ? ` err=${errMsg}` : ''),
    );
    if (i < rounds && interval) await sleep(interval);
  }

  const codes = polls.map(p => p.errorCode);
  const allSeven = codes.length > 0 && codes.every(c => Number(c) === 7);
  const anyZero = codes.some(c => Number(c) === 0);
  const anyOther = codes.filter(c => Number(c) !== 7 && Number(c) !== 0);

  // ---- 3) 判定 ----
  record(!allSeven, '轮询未全部返回 error_code=7', 'code 序列=' + JSON.stringify(codes));

  if (allSeven) {
    record(false, '【核心】上游对未扫码的轮询返回 7（限流）',
      '每次都是 7 → 说明不是我们打太多，而是这个 token/请求姿势一开始就被限');
  } else if (anyZero) {
    record(true, '至少有一次返回 error_code=0（正常等待扫码）', 'code 序列=' + JSON.stringify(codes));
  }

  if (anyOther.length) {
    note('其他 error_code: ' + JSON.stringify([...new Set(anyOther)]));
  }

  // ---- 4) 等一段时间再试一次，看限流窗口是否真的 60s ----
  if (waitAfter > 0) {
    console.log(`\n等待 ${waitAfter}ms 后再轮询一次（验证限流窗口长度）…`);
    await sleep(waitAfter);
    let env = null;
    try {
      env = await mod.checkQrConnect(token);
    } catch (_) {}
    const d = (env && env.data) || {};
    console.log(`  等待后 error_code=${d.error_code} status=${d.status || '-'}`);
    record(
      Number(d.error_code) !== 7,
      `等待 ${Math.round(waitAfter / 1000)}s 后 error_code 不再是 7`,
      `error_code=${d.error_code}`,
    );
  }

  // ---- 5) 关键判别：换一个新二维码，第一次轮询就报 7 吗？ ----
  // 如果新 token 第一次就是 7，那 2 秒轮询完全不是原因（我们连一次都没多打）。
  console.log('\n换一个新二维码，只轮询 1 次：');
  let fresh = null;
  try {
    fresh = await mod.getQrCode();
  } catch (_) {}
  const freshToken = String(((fresh && fresh.data) || {}).token || '');
  if (freshToken) {
    let env = null;
    try { env = await mod.checkQrConnect(freshToken); } catch (_) {}
    const d = (env && env.data) || {};
    console.log(`  新 token 首次轮询 error_code=${d.error_code} status=${d.status || '-'}`);
    record(
      Number(d.error_code) !== 7,
      '【决定性】全新二维码的第一次轮询不是 7',
      Number(d.error_code) === 7
        ? '第一次就 7 → 与轮询频率无关，是我们的请求姿势（参数/头/签名）被上游拒'
        : `error_code=${d.error_code}`,
    );
  } else {
    note('拿不到第二个二维码（可能已被限流），跳过此项');
  }

  finish(mod);
}

function finish(mod) {
  // 不调用 mod.clear()：它会对 persist:mineradio-qishui-auth-v6 做
  // clearStorageData，可能清掉用户真实登录态。只销毁窗口、关 asset server。
  try {
    const rt = mod && mod.__getRuntime && mod.__getRuntime();
    if (rt) {
      if (rt.window && !rt.window.isDestroyed()) rt.window.destroy();
      if (rt.assetServer) rt.assetServer.close();
    }
  } catch (_) {}
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('[probe-error]', (err && err.stack) || err);
  app.exit(2);
});
