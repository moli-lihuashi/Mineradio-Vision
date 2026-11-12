'use strict';

/**
 * 探针：用「用户真实持久化身份」对比「全新随机身份」，看 7 是否与身份有关。
 *
 * 这是前几个探针的共同盲区：它们全部用 mod.configure({getConfig:()=>空对象})
 * 注入空配置，于是 ensureIdentity() 现场生成全新随机 deviceId/installId/
 * verifyPortraitId。而用户环境用的是 .qishui-qr-login.json 里已持久化的身份。
 * 「探针通过、用户失败」的最大差异就在这里。
 *
 * 本探针做 A/B 对照：
 *   A 组：全新随机身份（复现探针现状）
 *   B 组：真实持久化身份（复现用户环境）
 * 两组打同样的次数，比较 error_code 分布。
 *
 * 安全：只读用户配置文件，绝不写回；绝不调 mod.clear()。
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-identity-ab.js --rounds=10
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'probe-qishui-identity-ab.log');
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
const rounds = Math.max(1, Number(argOf('rounds', '10')) || 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

// 只读用户真实配置（DPAPI 加密），拿到 deviceId/installId/verifyPortraitId
function readRealIdentity() {
  const cfgFile = path.join(app.getPath('appData'), 'Mineradio', '.qishui-qr-login.json');
  if (!fs.existsSync(cfgFile)) return { ok: false, reason: '配置文件不存在: ' + cfgFile };
  let text = '';
  try {
    const secretStore = require(path.join(assetDir, 'desktop', 'secret-store'));
    text = secretStore.readSecretFile(cfgFile);
  } catch (e) {
    return { ok: false, reason: '解密失败: ' + (e && e.message) };
  }
  if (!text) return { ok: false, reason: '解密结果为空' };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, reason: 'JSON 解析失败' }; }
  return {
    ok: true,
    cfgFile,
    deviceId: String(parsed.deviceId || ''),
    installId: String(parsed.installId || ''),
    verifyPortraitId: String(parsed.verifyPortraitId || ''),
    hasCookie: !!(parsed.cookie && String(parsed.cookie).trim()),
    msTokenReady: !!parsed.msToken,
  };
}

async function runGroup(label, seedConfig, n) {
  log(`\n--- ${label} ---`);
  const mod = loadModule();
  const config = { ...seedConfig };
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  let env;
  try {
    env = await mod.getQrCode();
  } catch (err) {
    log('  getQrCode() 失败：' + String((err && err.message) || err).slice(0, 160));
    return null;
  }
  const token = String((env && env.data && env.data.token) || '');
  if (!token) { log('  token 为空，跳过'); return null; }
  log(`  二维码 token=${token.slice(0, 12)}…  deviceId=${String(config.deviceId || '(随机)').slice(0, 8)}…`);

  const codes = [];
  for (let i = 1; i <= n; i++) {
    let e2 = null, errMsg = null;
    try { e2 = await mod.checkQrConnect(token); } catch (err) { errMsg = String((err && err.message) || err).slice(0, 100); }
    const d = (e2 && e2.data) || {};
    codes.push(Number(d.error_code));
    log(`    #${String(i).padStart(2)} error_code=${String(d.error_code).padEnd(4)} status=${String(d.status || '-').padEnd(8)}${errMsg ? ' err=' + errMsg : ''}`);
    if (i < n) await sleep(300);
  }
  // 清理：只销毁窗口，不 clear storage
  try {
    const rt = mod.__getRuntime && mod.__getRuntime();
    if (rt) {
      if (rt.window && !rt.window.isDestroyed()) rt.window.destroy();
      if (rt.assetServer) rt.assetServer.close();
    }
  } catch (_) {}
  return codes;
}

async function main() {
  await app.whenReady();

  log('=== 身份 A/B 对照：7 是否与持久化身份有关 ===');
  log('asset-dir: ' + assetDir);
  log('每轮 ' + rounds + ' 次 check_qrconnect');

  const real = readRealIdentity();
  log('');
  if (real.ok) {
    log('真实身份读取成功：' + real.cfgFile);
    log('  deviceId=' + real.deviceId);
    log('  installId=' + real.installId);
    log('  verifyPortraitId=' + real.verifyPortraitId);
    log('  hasCookie=' + real.hasCookie + '  msTokenReady=' + real.msTokenReady);
  } else {
    log('真实身份读取失败：' + real.reason);
    log('→ B 组无法进行，只能跑 A 组');
  }

  // A 组：全新随机身份
  const codesA = await runGroup('A 组：全新随机身份（探针现状）', {}, rounds);

  // B 组：真实持久化身份（只读拷贝，不写回）
  let codesB = null;
  if (real.ok) {
    codesB = await runGroup('B 组：用户真实持久化身份', {
      deviceId: real.deviceId,
      installId: real.installId,
      verifyPortraitId: real.verifyPortraitId,
      // 注意：不注入 cookie / msToken —— 避免拿用户真实会话去打上游。
      // 身份字段才是「设备指纹」，也是探针与用户环境的核心差异。
    }, rounds);
  }

  log('\n=== 对照结论 ===');
  const summarize = (codes) => codes ? JSON.stringify([...new Set(codes)]) : 'n/a';
  log(`A 组（随机身份）code 集合: ${summarize(codesA)}`);
  log(`B 组（真实身份）code 集合: ${summarize(codesB)}`);
  const has7A = !!(codesA && codesA.includes(7));
  const has7B = !!(codesB && codesB.includes(7));
  if (!has7A && has7B) {
    log('【关键】只有真实身份触发 7 → 7 是「设备身份被标记」，与频率无关。');
    log('→ 防重入锁治不了它，需要换 deviceId 或走二次验证。');
  } else if (!has7A && !has7B) {
    log('【关键】两组都没触发 7 → 7 与身份、频率都无关，只剩「扫码后的状态」这一条路。');
  } else {
    log('【关键】两组都触发 7 → 7 与身份无关，可能与频率或上游策略有关。');
  }

  log('\ndone');
  app.exit(0);
}

main().catch(err => {
  log('[probe-error] ' + ((err && err.stack) || err));
  app.exit(2);
});
