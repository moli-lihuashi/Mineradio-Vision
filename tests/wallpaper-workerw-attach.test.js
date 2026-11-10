'use strict';

/* =============================================================================
 * WorkerW 壁纸挂载脚本的结构约束（真机适配回归）
 *
 * 这两条都是「实测踩出来的」，不是理论洁癖：
 *  1) 宿主选择：Progman 底下常年挂着 explorer 自己的小 WorkerW（实测 202x56、
 *     不可见）。挂错的话整个 Mineradio 会被压成一条碎片，用户看到的就是
 *     「开了壁纸模式什么都没发生」。所以候选宿主必须过「可见 + 不含图标层 +
 *     接近全屏」三重校验，且兄弟法（Win10/传统 Win11）优先。
 *  2) 去分层：主窗口是 transparent:true，带 WS_EX_LAYERED。跨进程 SetParent 到
 *     WorkerW 之后分层合成失效，窗口一个像素都不刷（实测截图桌面无变化）。
 *     挂载期间必须临时去掉 WS_EX_LAYERED，detach 时按原值还原。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');

const { workerWAttachScript } = require('../desktop/wallpaper-mode-runtime');
const { desktopWindowDetachScript } = require('../desktop/full-desktop-mode-runtime');

function buildAttach(input) {
  return workerWAttachScript(Object.assign(
    { hwnd: '424242', x: -11, y: -45, width: 2560, height: 1600 },
    input || {}
  ));
}

test('attach asks Progman for the wallpaper WorkerW with both known message payloads', () => {
  const script = buildAttach();
  // Windows 10 / 传统结构用 (0,0)
  assert.match(script,
    /SendMessageTimeout\(\$progman, 0x052C, \[IntPtr\]::Zero, \[IntPtr\]::Zero/,
    '0x052C (0,0) 缺失：Win10 不会生成壁纸 WorkerW');
  // 部分 Windows 11 24H2 只认 (0xD,0x1)
  assert.match(script,
    /SendMessageTimeout\(\$progman, 0x052C, \[IntPtr\]::new\(\[Int64\]0xD\), \[IntPtr\]::new\(\[Int64\]0x1\)/,
    '0x052C (0xD,0x1) 缺失：Win11 24H2 不会生成壁纸 WorkerW');
});

test('attach rejects a non numeric window handle before touching PowerShell', () => {
  assert.throws(() => workerWAttachScript({ hwnd: '0x1F', x: 0, y: 0, width: 10, height: 10 }),
    /WALLPAPER_NATIVE_HANDLE_INVALID/);
  assert.throws(() => workerWAttachScript({ x: 0, y: 0, width: 10, height: 10 }),
    /WALLPAPER_NATIVE_HANDLE_INVALID/);
});

test('host candidates must be visible, icon-free and near full screen', () => {
  const script = buildAttach();
  const start = script.indexOf('function Test-WallpaperHost');
  assert.ok(start > 0, '缺少 Test-WallpaperHost：宿主校验是「挂错窗口」的唯一防线');
  const body = script.slice(start, script.indexOf('$callback = '));
  assert.match(body, /IsWindowVisible\(\$h\)/, '不校验可见性会挑到 explorer 的隐藏小窗口');
  assert.match(body, /FindWindowExByClass\(\$h, \[IntPtr\]::Zero, "SHELLDLL_DefView"\) -ne \[IntPtr\]::Zero/,
    '必须排除带 SHELLDLL_DefView 的图标宿主（挂上去会盖住桌面图标）');
  assert.match(body, /GetWindowRect\(\$h, \[ref\]\$r\)/, '不量尺寸就分不清全屏壁纸层和 202x56 内部小窗');
  assert.match(body, /\$refW \* 0\.8/, '宽度要有全屏比例阈值');
  assert.match(body, /\$refH \* 0\.8/, '高度要有全屏比例阈值');
  // 校验必须先定义再使用
  assert.ok(script.indexOf('if (Test-WallpaperHost $script:workerw)') > start,
    'Test-WallpaperHost 必须在候选判定之前定义');
  assert.ok(script.indexOf('if (Test-WallpaperHost $progmanChild)') > start,
    'Progman 子窗口候选同样要过校验');
});

test('screen metrics come from the system, not from Progman bounds', () => {
  const script = buildAttach();
  const metricsAt = script.indexOf('GetSystemMetrics(0)');
  assert.ok(metricsAt > 0, '参考尺寸要取 GetSystemMetrics：Progman 的 GetWindowRect 在部分系统返回 0x0');
  assert.match(script, /GetSystemMetrics\(1\)/, '高度也要取系统指标');
  const progmanRectAt = script.indexOf('GetWindowRect($progman, [ref]$progRect)');
  assert.ok(progmanRectAt > metricsAt, 'Progman 尺寸只能作为系统指标失效后的兜底');
  assert.match(script, /WALLPAPER_SCREEN_METRICS_INVALID/,
    '两条路都拿不到尺寸时必须报错，否则 0.8 阈值会把所有候选都判成不合格');
});

test('the sibling WorkerW found next to the icon host wins, with documented fallbacks', () => {
  const script = buildAttach();
  const sibling = script.indexOf('$script:hostKind = "workerw-sibling"');
  const progmanChild = script.indexOf('$script:hostKind = "workerw-progman-child"');
  const bottomMost = script.indexOf('$script:hostKind = "workerw-bottom-most"');
  const fallback = script.indexOf('$script:hostKind = "progman-fallback"');
  assert.ok(sibling > 0 && progmanChild > 0 && bottomMost > 0 && fallback > 0,
    '四种宿主类型都要能命名，否则出问题无法归因');
  assert.ok(sibling < progmanChild && progmanChild < bottomMost && bottomMost < fallback,
    '优先级必须是 兄弟法 > Progman 子窗口 > 最底层 WorkerW > Progman 兜底');
  // 兜底挂在 Progman 里时窗口和 SHELLDLL_DefView 同级，必须显式排到图标层之后
  assert.match(script, /if \(\$script:hostKind -eq "progman-fallback"\)/);
  assert.match(script, /\$insertAfter = \$fallbackView/,
    '兜底模式不排在 DefView 之后会把桌面图标盖住');
});

test('layered ex-style is stripped before reparenting and reported back', () => {
  const script = buildAttach();
  const stripAt = script.indexOf('-band (-bnot $WS_EX_LAYERED)');
  const reparentAt = script.indexOf('SetParent($target, $script:workerw)');
  assert.ok(stripAt > 0, '必须真去掉 WS_EX_LAYERED：透明窗口挂上 WorkerW 后完全不渲染');
  assert.ok(stripAt < reparentAt, '去分层必须在 SetParent 之前，否则挂上去的那一帧就已经是死的');
  assert.match(script, /\$exStyleBefore = \[MineradioDesktopWallpaperNative\]::GetWindowLongPtr\(\$target, \$GWL_EXSTYLE\)/,
    '必须记录挂载前的原始 ex-style，detach 才能原样还原');
  assert.match(script, /exStyleBefore = \$exStyleBefore\.ToString\(\)/, 'ack 要带回 exStyleBefore');
  assert.match(script, /hostKind = \$script:hostKind/, 'ack 要带回 hostKind 以便排查挂到了哪一层');
});

test('detach restores the recorded ex-style and repaints the frame', () => {
  const script = desktopWindowDetachScript({
    hwnd: '424242', x: 100, y: 100, width: 1280, height: 800, exStyleBefore: '136839200',
  });
  assert.match(script, /\$restoreExStyle = "136839200"/, 'detach 脚本必须拿到原值');
  const restoreAt = script.indexOf('[MineradioFullDesktopNative]::SetWindowLongPtr($target, $GWL_EXSTYLE');
  const repaintAt = script.indexOf('SetWindowPos($target, [IntPtr]::Zero, 100, 100, 1280, 800, 0x0030)');
  assert.ok(restoreAt > 0, '不还原 GWL_EXSTYLE 的话退出壁纸模式后玻璃圆角永久变直角');
  assert.ok(repaintAt > restoreAt,
    'ex-style 改动要靠随后的 SWP_FRAMECHANGED(0x0030) 才生效，顺序不能反');
});

test('detach without a recorded ex-style leaves window styles alone', () => {
  const script = desktopWindowDetachScript({ hwnd: '424242', x: 0, y: 0, width: 800, height: 600 });
  assert.match(script, /\$restoreExStyle = ""/, '没有原值时必须输出空串');
  // 写 GWL_EXSTYLE 必须被空值判断守住，否则会把窗口搞成随机样式
  assert.match(script,
    /if \(\$restoreExStyle -ne ""\) \{\s*\n\s*\$GWL_EXSTYLE = -20\s*\n\s*\[MineradioFullDesktopNative\]::SetWindowLongPtr\(\$target, \$GWL_EXSTYLE/,
    'GWL_EXSTYLE 的写入必须包在 if ($restoreExStyle -ne "") 里');
});

test('detach refuses a malformed ex-style instead of writing garbage', () => {
  assert.throws(() => desktopWindowDetachScript({
    hwnd: '424242', x: 0, y: 0, width: 800, height: 600, exStyleBefore: '0x8280020',
  }), /FULL_DESKTOP_EXSTYLE_INVALID/);
  assert.throws(() => desktopWindowDetachScript({
    hwnd: '424242', x: 0, y: 0, width: 800, height: 600, exStyleBefore: '-1',
  }), /FULL_DESKTOP_EXSTYLE_INVALID/);
});
