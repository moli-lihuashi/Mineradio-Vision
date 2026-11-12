'use strict';

/**
 * 探针：确定 error_code 7 的真实语义。
 *
 * 背景：前两轮都把 7 当成「上游限流（rate_limited）」，并据此加了防重入锁。
 * 但实测 200ms 连打 60 次全部返回 0，频率与累计配额都已排除。所以 7 的
 * 「限流」解读本身很可能是错的，前端文案「扫码过于频繁」也跟着错。
 *
 * 本探针用「不同 token 状态」去撞上游，看 7 到底在什么条件下出现：
 *   S1) 正常 token（未扫码）        → 基线，预期 0
 *   S2) 随机伪造 token              → 无效 token 会不会是 7？
 *   S3) 已作废的旧 token            → 生成新码后，旧 token 失效会不会是 7？
 *   S4) 空 token                    → 缺参会不会是 7？
 *
 * 一旦某一档稳定返回 7，就说明 7 = token 状态问题而非限流，
 * 前端把它渲染成「扫码过于频繁，60 秒后自动重试」就是彻底的误诊。
 *
 * 只读、不调 mod.clear()、不写任何业务配置。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-qishui-code7-semantics.js
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'probe-qishui-code7-semantics.log');
try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}

// Electron 主进程在 Windows 下 console.log 会被吞（管道未 flush），
// 必须双写文件，只读文件判断。
const log = (line) => {
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
};

const argOf = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const assetDir = path.resolve(ROOT, argOf('asset-dir') || path.join('dist', 'Mineradio', 'resources', 'app'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const rows = [];
const record = (name, code, note) => {
  rows.push({ name, code, note });
  log(`  ${String(name).padEnd(34)} error_code=${String(code).padEnd(6)} ${note || ''}`);
};

function loadModule() {
  const entry = path.join(assetDir, 'qishui-auth-v6.js');
  if (!fs.existsSync(entry)) throw new Error('模块不存在：' + entry);
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

async function probe(mod, label, token, note) {
  try {
    const env = await mod.checkQrConnect(token);
    const d = (env && env.data) || {};
    record(label, d.error_code, `status=${d.status || '-'} desc=${String(d.description || '').slice(0, 60)} ${note || ''}`);
    return Number(d.error_code);
  } catch (err) {
    record(label, 'THROW', String((err && err.message) || err).slice(0, 120));
    return null;
  }
}

async function main() {
  await app.whenReady();
  const mod = loadModule();
  const config = {};
  mod.configure({
    getConfig: () => config,
    updateConfig: patch => Object.assign(config, patch),
  });

  log('=== error_code 7 的真实语义判别 ===');
  log('asset-dir: ' + assetDir);
  log('');

  // ---- 基线：正常 token ----
  let env1;
  try {
    env1 = await mod.getQrCode();
  } catch (err) {
    log('getQrCode() 失败，无法继续：' + String((err && err.message) || err).slice(0, 200));
    return finish();
  }
  const token1 = String((env1 && env1.data && env1.data.token) || '');
  log('第一张二维码 token=' + (token1 ? token1.slice(0, 12) + '…' : '(空)'));
  log('');
  log('--- 各 token 状态下的上游返回 ---');

  // S1 正常 token（未扫码）
  await probe(mod, 'S1 正常 token / 未扫码', token1, '(基线)');
  await sleep(300);

  // S2 随机伪造 token
  const fake = 'A'.repeat(32) + Math.random().toString(36).slice(2);
  await probe(mod, 'S2 随机伪造 token', fake, '无效 token');
  await sleep(300);

  // S3 短 token（结构上就不像合法 token）
  await probe(mod, 'S3 短 token "x"', 'x', '结构非法');
  await sleep(300);

  // S4 空 token
  await probe(mod, 'S4 空 token', '', '缺参');
  await sleep(300);

  // ---- S5：生成第二张码，让第一张作废，再用旧 token 打 ----
  log('');
  log('--- 作废旧 token ---');
  let env2 = null;
  try {
    env2 = await mod.getQrCode();
  } catch (err) {
    log('第二张二维码生成失败：' + String((err && err.message) || err).slice(0, 160));
  }
  if (env2 && env2.data && env2.data.token) {
    const token2 = String(env2.data.token);
    log('第二张二维码 token=' + token2.slice(0, 12) + '…');
    await sleep(300);
    await probe(mod, 'S5 已作废的旧 token', token1, '新码已覆盖');
    await sleep(300);
    await probe(mod, 'S6 当前新 token', token2, '(新码基线)');
    await sleep(300);
    // S7：对同一 token 连打 3 次，看是否第 2/3 次开始变化
    log('');
    log('--- 同一 token 连打 3 次（看是否有次数阈值） ---');
    for (let i = 1; i <= 3; i++) {
      await probe(mod, `S7.${i} 新 token 第 ${i} 次`, token2, '');
      await sleep(400);
    }
  }

  // ---- 结论 ----
  log('');
  log('=== 汇总 ===');
  const byCode = {};
  for (const r of rows) {
    const k = String(r.code);
    (byCode[k] = byCode[k] || []).push(r.name);
  }
  for (const [code, names] of Object.entries(byCode)) {
    log(`error_code=${code}: ${names.length} 档 → ${names.join(', ')}`);
  }
  log('');
  const seven = rows.filter(r => Number(r.code) === 7);
  if (seven.length) {
    log(`【关键】error_code 7 出现在：${seven.map(r => r.name).join(', ')}`);
    log('→ 7 不是「频率」触发，而是 token 状态问题。前端文案「扫码过于频繁」是误诊。');
  } else {
    log('【关键】本轮没有任何一档触发 error_code 7。');
    log('→ 7 既不是频率也不是 token 失效/伪造。需要靠真实扫码路径（2046 二次验证）复现。');
  }

  return finish();
}

function finish() {
  // 绝不调 mod.clear()：会对 persist:mineradio-qishui-auth-v6 执行
  // clearStorageData，跑在真实 userData 下会清掉用户真实登录态。
  try {
    const rt = require(path.join(assetDir, 'qishui-auth-v6.js')).__getRuntime && null;
    void rt;
  } catch (_) {}
  try {
    const rt = global.__qishuiProbeRuntime;
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
