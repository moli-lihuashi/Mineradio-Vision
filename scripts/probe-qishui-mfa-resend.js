'use strict';

/**
 * 探针：验证「扫码+二次验证通过之后」的轮询是否会把上游打到 error_code 7。
 *
 * 这是前两个探针的共同盲区：它们从未扫码，所以永远停在 status=new，
 * 根本进不到 2046 二次验证分支。而用户是在扫码之后才看到
 * 「扫码过于频繁，60 秒后自动重试」。
 *
 * 关键代码（qishui-auth-v6.js:694-704）：
 *   this._mfaDone = true;
 *   envelope = await this.request('POST', '/check_qrconnect/', { isResend: 'true' }, ...);
 * 而后续轮询走到 656 行 `if (this._mfaDone && this._mfaToken === tokenKey)`
 * 时 verified={status:true} 直接跳过验证，**却仍然执行 694-700 的重发**。
 * 也就是说：验证通过之后，每 2 秒的轮询都会再发一次 isResend=true 的
 * check_qrconnect。用户挂着登录窗几十秒 → 几十次 isResend 重发。
 *
 * 本探针用 runtime 内部字段模拟「已验证」态（不改任何业务配置、不弹窗），
 * 然后连续轮询，观察：
 *   A) 每次 checkQrConnect 实际发出几个上游请求（是否翻倍）
 *   B) 连续轮询后 error_code 是否变成 7
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-mfa-resend.js --rounds=20
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'probe-qishui-mfa-resend.log');
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
const rounds = Math.max(1, Number(argOf('rounds', '20')) || 20);
const interval = Math.max(0, Number(argOf('interval', '2000')) || 2000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

async function main() {
  await app.whenReady();
  const mod = loadModule();
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  log('=== 扫码后（_mfaDone 态）轮询是否触发 error_code 7 ===');
  log('asset-dir: ' + assetDir);
  log(`轮询 ${rounds} 次，间隔 ${interval}ms\n`);

  let env;
  try {
    env = await mod.getQrCode();
  } catch (err) {
    log('getQrCode() 失败：' + String((err && err.message) || err).slice(0, 200));
    return finish(mod);
  }
  const token = String((env && env.data && env.data.token) || '');
  log('二维码 token=' + (token ? token.slice(0, 12) + '…' : '(空)'));
  if (!token) return finish(mod);

  const rt = mod.__getRuntime && mod.__getRuntime();
  if (!rt) {
    log('拿不到 runtime 实例，无法模拟 _mfaDone 态');
    return finish(mod);
  }

  // 模拟「该 token 的二次验证已通过」：这正是用户扫码并完成安全验证后的真实状态。
  // 只改内存标志位，不动窗口、不弹验证窗、不写配置。
  rt._mfaToken = token;
  rt._mfaDone = true;
  rt._mfaStopToken = '';
  log('已模拟 _mfaDone=true（该 token 视为二次验证已通过）');
  log('→ 之后每次 checkQrConnect 都会走 656 行分支 + 694 行重发\n');

  const codes = [];
  let firstSevenAt = -1;
  for (let i = 1; i <= rounds; i++) {
    const before = (rt.mfaNetworkLog || []).length;
    let env2 = null;
    let errMsg = null;
    try {
      env2 = await mod.checkQrConnect(token);
    } catch (err) {
      errMsg = String((err && err.message) || err).slice(0, 120);
    }
    const d = (env2 && env2.data) || {};
    const code = Number(d.error_code);
    codes.push(code);
    if (code === 7 && firstSevenAt < 0) firstSevenAt = i;
    const reqs = Math.max(0, (rt.mfaNetworkLog || []).length - before);
    log(`  #${String(i).padStart(2)} error_code=${String(d.error_code).padEnd(4)} ` +
        `status=${String(d.status || '-').padEnd(8)} 本轮上游请求数=${reqs}${errMsg ? ' err=' + errMsg : ''}`);
    if (i < rounds && interval) await sleep(interval);
  }

  log('');
  log('code 序列: ' + JSON.stringify(codes));
  log('');

  const seven = codes.filter(c => c === 7).length;
  if (seven > 0) {
    log(`【A】_mfaDone 态下轮询确实出现 error_code 7（${seven}/${rounds} 次，首次第 ${firstSevenAt} 次）`);
    log('→ 7 由「验证通过后仍重复 isResend 重发」触发。前端把它渲染成');
    log('  「扫码过于频繁，60 秒后自动重试」是误诊：真实原因是重发没停。');
  } else {
    log('【A】_mfaDone 态下轮询没有出现 7');
    log('→ 7 与 isResend 重发无关，需另找条件。');
  }

  return finish(mod);
}

function finish(mod) {
  // 绝不调 mod.clear()：会 clearStorageData 清掉用户真实登录态。
  try {
    const rt = mod && mod.__getRuntime && mod.__getRuntime();
    if (rt) {
      if (rt.window && !rt.window.isDestroyed()) rt.window.destroy();
      if (rt.assetServer) rt.assetServer.close();
    }
  } catch (_) {}
  log('');
  log('done');
  app.exit(0);
}

main().catch(err => {
  log('[probe-error] ' + ((err && err.stack) || err));
  app.exit(2);
});
