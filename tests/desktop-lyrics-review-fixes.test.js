'use strict';

// 桌面歌词审查后的修复守卫（2026-11-21）
//
// 1. 透明度只由页面应用一次（窗口 setOpacity + 页面 opacity 会变成平方）
// 2. 桌面歌词 IPC 必须校验发送方（主窗口或歌词窗口自己）
// 3. 死 IPC（set-dragging）已移除
// 4. 加载失败要回收窗口并广播关闭
// 5. 退出前锚点防抖要 flush
// 6. 隐藏画布上那套从未调用的特效代码已删除（画布保留给 measureText）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'desktop/overlay-preload.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'public/desktop-lyrics.html'), 'utf8');
const overlaySource = fs.readFileSync(path.join(root, 'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js'), 'utf8');

/* 从合并脚本里抠出一个具名函数（大括号配平；这些函数体里没有含大括号的字符串）。 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `缺少函数 ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 没有闭合`);
}

test('透明度只由页面应用：主进程不再对歌词窗口 setOpacity', () => {
  const start = mainSource.indexOf('function createDesktopLyricsWindow');
  const end = mainSource.indexOf('function closeDesktopLyricsWindow');
  assert.ok(start > 0 && end > start);
  const section = mainSource.slice(start, end);
  assert.equal(/desktopLyricsWindow\.setOpacity/.test(section), false,
    '主进程又给歌词窗口设了透明度：会和页面 body opacity 叠成平方');
  assert.match(pageSource, /document\.body\.style\.opacity\s*=\s*state\.enabled/,
    '页面必须继续负责透明度');
});

test('桌面歌词 IPC 全部校验发送方', () => {
  const channels = [
    'mineradio-desktop-lyrics-set-enabled',
    'mineradio-desktop-lyrics-playback-action',
    'mineradio-desktop-lyrics-update',
    'mineradio-desktop-lyrics-set-pointer-capture',
    'mineradio-desktop-lyrics-set-hot-bounds',
    'mineradio-desktop-lyrics-set-lock-state',
    'mineradio-desktop-lyrics-move-by',
  ];
  assert.match(mainSource, /function isTrustedDesktopLyricsIpc\(event\)/);
  for (const channel of channels) {
    const at = mainSource.indexOf(`ipcMain.handle('${channel}'`);
    assert.ok(at > 0, `缺少 handler: ${channel}`);
    const body = mainSource.slice(at, at + 420);
    assert.match(body, /isTrustedDesktopLyricsIpc\(event\)/, `${channel} 没有校验发送方`);
  }
});

test('死 IPC set-dragging 已从两端移除', () => {
  assert.equal(preloadSource.includes('setLyricsDrag'), false);
  assert.equal(mainSource.includes("mineradio-desktop-lyrics-set-dragging"), false);
});

test('加载失败要回收窗口并广播关闭', () => {
  assert.match(mainSource, /loadURL\(overlayUrl\('desktop-lyrics\.html'\)\)\.catch/);
  const at = mainSource.indexOf("loadURL(overlayUrl('desktop-lyrics.html')).catch");
  const body = mainSource.slice(at, at + 420);
  assert.match(body, /closeDesktopLyricsWindow\(\)/, '加载失败没有回收窗口');
  assert.match(body, /broadcastDesktopLyricsEnabledState\(false\)/, '加载失败没有把面板状态复位');
});

test('退出前 flush 锚点防抖', () => {
  assert.match(mainSource, /function flushDesktopLyricsAnchor\(\)/);
  assert.match(mainSource, /app\.on\('before-quit'[\s\S]{0,200}flushDesktopLyricsAnchor\(\)/);
  assert.match(mainSource, /app\.on\('will-quit'[\s\S]{0,200}flushDesktopLyricsAnchor\(\)/);
});

test('隐藏画布上的死特效已删除，画布保留给 measureText', () => {
  for (const fn of ['drawAura', 'drawHighlightBloom', 'drawGlowText', 'drawParticles', 'ensureParticles']) {
    assert.equal(pageSource.includes(`function ${fn}`), false, `${fn} 仍存在`);
    assert.equal(pageSource.includes(`${fn}(`), false, `${fn} 仍有调用`);
  }
  assert.equal(pageSource.includes('var particles = []'), false);
  assert.match(pageSource, /var ctx = canvas\.getContext\('2d'\)/, 'measureText 还需要画布上下文');
});

/* ---- 2026-11-21 第二轮审查：行为级修复的守卫 ---------------------------- */

test('状态推送不重复下发 beatMap（主进程累积重放会打断脉冲）', () => {
  const sent = [];
  const context = vm.createContext({
    console: console,
    desktopLyricsState: {
      enabled: true,
      text: 'x',
      beatMapKey: 'k1',
      beatMap: { v: 2, cameraBeats: [] },
    },
    desktopLyricsWindow: {
      isDestroyed: function () { return false; },
      webContents: {
        isDestroyed: function () { return false; },
        send: function (channel, payload) { sent.push({ channel, payload }); },
      },
    },
  });
  vm.runInContext(extractFunction(mainSource, 'sendDesktopLyricsState'), context, { filename: 'main-send-slice.js' });

  // 普通状态推进：状态里虽然还留着上一张图，但不许再发
  context.sendDesktopLyricsState({ text: 'y' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'mineradio-desktop-lyrics-state');
  assert.equal(Object.prototype.hasOwnProperty.call(sent[0].payload, 'beatMap'), false,
    '普通状态又带上了 beatMap：页面每帧都会重建节拍数组并清零脉冲');
  assert.equal(sent[0].payload.beatMapKey, 'k1', 'beatMapKey 必须保留，页面靠它判断是否换歌');

  // 本次更新明确带图：要发
  context.sendDesktopLyricsState({ beatMap: { v: 2, cameraBeats: [] }, beatMapKey: 'k1' });
  assert.equal(Object.prototype.hasOwnProperty.call(sent[1].payload, 'beatMap'), true);

  // webContents 已销毁：静默跳过
  context.desktopLyricsWindow.webContents.isDestroyed = function () { return true; };
  context.sendDesktopLyricsState({ text: 'z' });
  assert.equal(sent.length, 2);
});

test('窗口被外部销毁后状态复位（渲染进程崩溃不会留下假开关）', () => {
  const at = mainSource.indexOf("desktopLyricsWindow.on('closed'");
  assert.ok(at > 0);
  const section = mainSource.slice(at, at + 1200);
  assert.match(section, /createdLyricsWindow/, 'closed 必须防止「关掉再开」时清掉新窗口引用');
  assert.match(section, /desktopLyricsState\.enabled/, 'closed 必须检查当前是否还标记为开启');
  assert.match(section, /broadcastDesktopLyricsEnabledState\(false\)/, 'closed 必须把面板开关复位');
});

test('拖动不再每步回读 getBounds()', () => {
  const at = mainSource.indexOf("ipcMain.handle('mineradio-desktop-lyrics-move-by'");
  assert.ok(at > 0);
  const body = mainSource.slice(at, at + 900);
  assert.match(body, /desktopLyricsDragBounds \|\| desktopLyricsWindow\.getBounds\(\)/);
  assert.match(body, /Date\.now\(\) >= desktopLyricsDragUntil/);
});

test('多行歌词用真实容器宽排版（长句不再被裁掉两端）', () => {
  assert.match(pageSource, /stackContentWidth = clearWidth/);
  assert.match(pageSource, /function stackRowMaxWidth\(\) \{[\s\S]{0,220}stackContentWidth/);
  assert.match(pageSource, /stackRowMaxWidth\(\) \* \.985/, 'fitRowText 要留排版余量');
  assert.equal(/innerWidth - 96 - \(overhang \|\| 0\) \* 2/.test(pageSource), false,
    'fitRowText 又用回了 innerWidth-96（比真实容器宽，会裁字）');
});

test('暂停透明度不被动画 fill 顶掉', () => {
  assert.match(pageSource, /body\.paused \.line:not\(\.line-next\)\{[^}]*opacity:\.84 !important/);
});

test('自定义歌词字体在桌面歌词里重新注册，CSP 放行 data:', () => {
  assert.match(pageSource, /font-src 'self' data:/);
  assert.match(pageSource, /function applyCustomFont\(font\)/);
  assert.match(pageSource, /new FontFace\(String\(font\.family\), 'url\("/);
  assert.match(pageSource, /applyCustomFont\(next\.customFont\)/);
  assert.match(overlaySource, /customFont: desktopLyricsCustomFontPayload\(includeCustomFontData\)/);
});

test('热区只在控制条真正可见时才包含它', () => {
  assert.match(pageSource, /var hintRect = hintVisible && lockHint/);
  assert.match(pageSource, /hintBoundsTimer = setTimeout\(function \(\) \{ hintBoundsTimer = 0; sendHotBounds\(\); \}, 190\)/,
    '胶囊显隐后要重报热区（否则按钮点不到 / 不可见区域吃鼠标）');
});

test('同一张节拍图重复下发时页面跳过重建', () => {
  assert.match(pageSource,
    /if \(hasMapPayload && key === desktopBeat\.key && desktopBeat\.camera\.length\) return;/);
});

test('单行模式的「下一句」已接线（payload 必须带 nextText）', () => {
  assert.match(overlaySource, /nextText: lyric\.nextText \|\| ''/);
  assert.match(overlaySource, /nextText: normalizeDesktopLyricText\(nextLine/);
});

test('舞台几何律动保持关闭，不再用死变量拼 transform', () => {
  const at = pageSource.indexOf('function applyStageMotion');
  assert.ok(at > 0);
  const body = pageSource.slice(at, at + 900);
  assert.match(body, /stage\.style\.transform = 'translate3d\(0px,0px,0\)'/);
  assert.equal(/bobX/.test(body), false, 'applyStageMotion 里残留了未使用的位移变量');
});
