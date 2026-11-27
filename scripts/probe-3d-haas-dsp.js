'use strict';
/**
 * 真 Electron 探针：3D 丽音（交叉差分延迟）的实际 DSP 行为。
 *
 * 为什么不能只靠 node:test：那套桩只证明「增益写进了 AudioParam」，
 * 证明不了「输出波形对不对」。这里用 OfflineAudioContext 渲染真实信号，
 * 量的是渲染结果，不是代码。
 *
 * 五条独立判据：
 *   1. 关闭态与直通逐样本一致 —— 加了这一级不能偷偷改声音
 *   2. 侧向内容串到对侧 —— 硬左输入，右声道从 0 变成有能量
 *   3. 60Hz 不进延迟支路 —— 右声道的 60Hz 能量必须≈0，否则 bass 被削
 *   4. 脉冲响应落在 22ms 之后 —— 延迟真的生效，不是参数空转
 *   5. 居中人声 L/R 仍相等 —— 幻象中心不偏（这是「差分」相对「单边延迟」的关键）
 *
 * 用法：node scripts/probe-3d-haas-dsp.js
 * 产物：_debug-archive/2026-11-27-3d-haas/probe-result.json
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_debug-archive', '2026-11-27-3d-haas');
const PROBE_HTML = path.join(ROOT, 'scripts', 'probes', 'surround-dsp.html');

/* ── 分支 1：用 node 直接跑时，以 electron 重新启动自己 ───────────────── */
if (!process.versions.electron) {
  const electronExe = require('electron'); // devDependency 里导出 exe 路径
  const env = Object.assign({}, process.env);
  /* ELECTRON_RUN_AS_NODE 会让 electron 变成纯 node，拿不到 BrowserWindow */
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_ENABLE_LOGGING = '0';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const child = spawn(electronExe, [__filename, '--disable-gpu'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
  return;
}

/* ── 分支 2：electron 主进程 ──────────────────────────────────────────── */
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-crash-reporter');
/* 用户配置默认在 C 盘：这里必须挪到项目内（C 盘禁写） */
app.setPath('userData', path.join(OUT_DIR, 'userdata'));
app.setPath('sessionData', path.join(OUT_DIR, 'userdata'));
app.setPath('crashDumps', path.join(OUT_DIR, 'crashdumps'));

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail == null ? '' : '  — ' + detail));
}

function finish(code, raw) {
  const payload = { at: new Date().toISOString(), checks, pass: checks.filter((c) => c.ok).length, total: checks.length, raw: raw || null };
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'probe-result.json'), JSON.stringify(payload, null, 2));
  } catch (_) {}
  console.log('\n' + (code === 0 ? 'ALL PASS' : 'FAILED') + '  ' + payload.pass + '/' + payload.total);
  app.exit(code);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  let res;
  try {
    await win.loadFile(PROBE_HTML);
    res = await win.webContents.executeJavaScript('window.__probe()', true);
  } catch (err) {
    console.error('探针执行失败:', err && err.message);
    return finish(1, res);
  }

  if (!res || typeof res !== 'object') {
    console.error('探针没有返回结果:', res);
    return finish(1, res);
  }
  console.log(JSON.stringify(res, null, 2));
  console.log('');

  /* 1. 关闭态中性。三条合起来才成立 —— 单看 bypassLeftDiff 会被限幅器骗：
        整链有 DynamicsCompressor（lookahead 486 samples ≈ 11ms，steadyGain 0.9345），
        它会压缩波形，让「对齐后残差」天然有 0.07 量级，这是加 3D 级之前就有的。
        真正能证明「这一级没偷改声音」的是：
          a) 右声道输入为 0 时输出必须精确为 0（没有串扰泄漏）
          b) 低电平（不触发限幅器）下整链残差极小
          c) width=1/amb=0 时开关开与关的输出逐样本相同 */
  check('1a 右声道零输入→零输出（无串扰泄漏）', res.bypassRightDiff === 0, 'bypassRightDiff=' + res.bypassRightDiff);
  check('1b 低电平下链路透明', res.lowLevelBypassDiff != null && res.lowLevelBypassDiff <= 0.015,
    'lowLevelBypassDiff=' + res.lowLevelBypassDiff + ' peak=' + res.lowLevelInPeak);
  check('1c 中性参数下开关等价', res.neutralEnabledDiff === 0, 'neutralEnabledDiff=' + res.neutralEnabledDiff);

  /* 2. 侧向串扰：硬左输入下右声道应从「精确 0」变成「有能量」 */
  check('2 开启后右声道收到侧向内容', res.haasHardLeftROn > 0.02 && res.haasHardLeftROff < 1e-4,
    'off=' + res.haasHardLeftROff + ' on=' + res.haasHardLeftROn);

  /* 3. 低频保护：60Hz 硬左，右声道只可能来自延迟支路，300Hz 高通必须压住它。
        判据用相对量（-30dB 以下），绝对阈值会被输入幅度带偏。 */
  const bassLeak = res.haasBass60RightRms / (res.haasBass60LeftRms || 1);
  check('3 60Hz 不进延迟支路（bass 不被削）', bassLeak < 0.03,
    'rightRms=' + res.haasBass60RightRms + ' / leftRms=' + res.haasBass60LeftRms +
    ' = ' + (bassLeak * 100).toFixed(2) + '%');

  /* 4. 延迟量：用「R 峰 - L 峰」而不是绝对窗口 —— 整链有 6ms 压缩器 lookahead，
        绝对时间会被整体推移，差值才是这一级贡献的量。 */
  const haasDelayMs = res.haasImpulseRPeak.ms - res.haasImpulseLPeak.ms;
  check('4 延迟量 = 22ms（R 峰晚于 L 峰）', Math.abs(haasDelayMs - 22) < 1.5,
    'L=' + res.haasImpulseLPeak.ms + 'ms R=' + res.haasImpulseRPeak.ms + 'ms Δ=' + haasDelayMs.toFixed(2) + 'ms');

  /* 5. 幻象中心：居中内容开 3D 后 L/R 仍应相等（对称交叉结构的关键优势） */
  check('5 居中人声不偏（L/R 仍相等）',
    res.haasCenterLRDiffOn != null && res.haasCenterLRDiffOn < 0.01,
    'off=' + res.haasCenterLRDiffOff + ' on=' + res.haasCenterLRDiffOn);

  /* 6. 不削波 */
  check('6 硬左满幅输入不削波', res.haasPeakL <= 1.0 && res.haasPeakR <= 1.0,
    'peakL=' + res.haasPeakL + ' peakR=' + res.haasPeakR);

  /* 7. 虚拟低音：输入 60Hz 纯音，看「补谐波」而不是「抬低频」 */
  const h2Gain = res.vbOnH2 / Math.max(1e-9, res.vbOffH2);
  check('7a 二次谐波显著增强', h2Gain > 3,
    'H2 ' + res.vbOffH2 + ' → ' + res.vbOnH2 + '（×' + h2Gain.toFixed(1) + '），H3 ' +
    res.vbOffH3 + ' → ' + res.vbOnH3);
  check('7b 基频基本不动（补谐波，不是抬低频）', res.vbOnFund <= res.vbOffFund * 1.15,
    '60Hz ' + res.vbOffFund + ' → ' + res.vbOnFund +
    '（+' + (((res.vbOnFund / res.vbOffFund) - 1) * 100).toFixed(1) + '%）');
  check('7c 没有新增直流偏移', Math.abs(res.vbOnDc) <= Math.abs(res.vbOffDc) * 1.5 + 0.001,
    'dc ' + res.vbOffDc + ' → ' + res.vbOnDc);
  check('7d 支路满强度不削波', res.vbPeak <= 1.0, 'peak=' + res.vbPeak);

  finish(checks.every((c) => c.ok) ? 0 : 2, res);
}).catch((err) => {
  console.error('主进程异常:', err);
  finish(1);
});
