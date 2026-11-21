'use strict';

/* 桌面效果层窗口（壁纸模式的新承载）
 *
 * 用户 2026-11-21 的要求（原话拆解）：
 *   1. 点壁纸模式时播放器窗口与任务栏条目都不能消失，播放器要一直能用；
 *   2. 效果只出现在桌面上：原世界「粒子 + 歌词」，Folia 世界「只要歌词」；
 *   3. 不再显示内置壁纸，要能和自己装的 Wallpaper Engine 壁纸共生；
 *   4. 取消「双击 Esc 退出」，退出就是再点一次开关。
 *
 * 因此壁纸模式 = 主窗口不动 + 这张独立的效果层窗口：
 *   - 透明（transparent:true）：只有画出来的粒子/歌词有像素，桌面壁纸从空隙透出来；
 *   - 整屏铺满一块显示器（display.bounds，含任务栏下方）；
 *   - 鼠标穿透 + 不可聚焦 + 不入任务栏：它是「壁纸」，不是第二份播放器；
 *   - 置底（SetWindowPos HWND_BOTTOM）：所有普通窗口都在它上面。
 *
 * 为什么不挂 WorkerW（旧实现）：Chromium 的透明窗口带 WS_EX_LAYERED，
 * classic 桌面一挂上去整屏黑（desktop/main.js 里有 2026-11-20 的实测记录）。
 * 不挂 WorkerW 就没有「透明 + 桌面层」的矛盾：普通窗口 + 置底 + 穿透，
 * 视觉效果与「贴在壁纸上面」一致，而透明与圆角都还在。
 */

const { execFile } = require('child_process');
const { attachWallpaperWindowToDesktop } = require('./wallpaper-mode-runtime');

const DEFAULT_STAGE_OPACITY = 1;
const DEFAULT_STAGE_FRAME_RATE = 60;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeStageOpacity(value) {
  return clampNumber(value, 0.2, 1, DEFAULT_STAGE_OPACITY);
}

function normalizeStageFrameRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_STAGE_FRAME_RATE;
  return Math.max(1, Math.min(60, Math.round(numeric)));
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) throw new Error('STAGE_NATIVE_HANDLE_INVALID');
  if (handle.length >= 8 && (process.arch === 'x64' || process.arch === 'arm64')) {
    return handle.readBigUInt64LE(0).toString();
  }
  return String(handle.readUInt32LE(0));
}

/* 只做一件事：把窗口压到 z 序最底（HWND_BOTTOM），并且全程不激活。
 * 不碰 style / parent / 尺寸，任何一项都不需要 —— 窗口本身就是普通顶层窗。 */
function stageBottomScript(input = {}) {
  const hwnd = String(input.hwnd || '');
  if (!/^\d+$/.test(hwnd)) throw new Error('STAGE_NATIVE_HANDLE_INVALID');
  return `
$ErrorActionPreference = "Stop"
if (-not ("MineradioStageNative" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioStageNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern IntPtr GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] private static extern IntPtr SetWindowLong32(IntPtr hWnd, int index, IntPtr value);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLong32(hWnd, index); }
  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : SetWindowLong32(hWnd, index, value); }
}
"@
}
$prevDpi = [IntPtr]::Zero
try { $prevDpi = [MineradioStageNative]::SetThreadDpiAwarenessContext([IntPtr]::new([Int64]-4)) } catch { }
$target = [IntPtr]::new([Int64]${hwnd})
if (-not [MineradioStageNative]::IsWindow($target)) { throw "STAGE_TARGET_NOT_FOUND" }
# 位置与尺寸一律用窗口**当前**的实际矩形：Electron 已经按主窗口所在显示器
# 建好这张窗口，这里只负责改 z 序。以前写死 (0,0)+GetSystemMetrics(主屏) 会在
# 主窗口位于副屏时把效果层整个搬到主屏左上角，且非 100% 缩放下尺寸对不上。
$rect = New-Object MineradioStageNative+RECT
[MineradioStageNative]::GetWindowRect($target, [ref]$rect) | Out-Null
$targetX = $rect.Left
$targetY = $rect.Top
$targetW = $rect.Right - $rect.Left
$targetH = $rect.Bottom - $rect.Top
if ($targetW -le 0 -or $targetH -le 0) {
  # 兜底：窗口还没完成布局时退回主屏物理分辨率
  $targetX = 0
  $targetY = 0
  $targetW = [MineradioStageNative]::GetSystemMetrics(0)
  $targetH = [MineradioStageNative]::GetSystemMetrics(1)
}
if ($targetW -le 0 -or $targetH -le 0) { throw "STAGE_SCREEN_METRICS_INVALID" }
$corner = 1
try { [MineradioStageNative]::DwmSetWindowAttribute($target, 33, [ref]$corner, 4) | Out-Null } catch { }
$GWL_STYLE = -16
$WS_POPUP = [Int64]0x80000000
$WS_THICKFRAME = [Int64]0x00040000
$style = [MineradioStageNative]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()
$newStyle = ($style -bor $WS_POPUP) -band (-bnot $WS_THICKFRAME)
[MineradioStageNative]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$newStyle)) | Out-Null
if (-not [MineradioStageNative]::SetWindowPos($target, [IntPtr]::new([Int64]1), $targetX, $targetY, $targetW, $targetH, 0x0070)) { throw "STAGE_BOTTOM_FAILED" }
$after = New-Object MineradioStageNative+RECT
[MineradioStageNative]::GetWindowRect($target, [ref]$after) | Out-Null
[pscustomobject]@{
  ok = $true
  windowId = ${hwnd}
  zOrder = "bottom"
  screen = [pscustomobject]@{ width = $targetW; height = $targetH }
  actualBounds = [pscustomobject]@{ x = $after.Left; y = $after.Top; width = ($after.Right - $after.Left); height = ($after.Bottom - $after.Top) }
} | ConvertTo-Json -Compress
if ($prevDpi -ne [IntPtr]::Zero) { try { [MineradioStageNative]::SetThreadDpiAwarenessContext($prevDpi) | Out-Null } catch { } }
`;
}

/* 不透明效果层专用：SetParent 到「图标宿主」（含 SHELLDLL_DefView 的 Progman/WorkerW），
 * 并插到 DefView 之后（z 序更下）——图标压在效果上，效果压在桌面背景上。
 * 不透明窗口没有 WS_EX_LAYERED，跨进程 SetParent 不影响合成，所以这条能画。 */
function stageOpaqueBehindIconsScript(input = {}) {
  const hwnd = String(input.hwnd || '');
  if (!/^\d+$/.test(hwnd)) throw new Error('STAGE_NATIVE_HANDLE_INVALID');
  const x = Math.round(Number(input.x) || 0);
  const y = Math.round(Number(input.y) || 0);
  const width = Math.max(1, Math.round(Number(input.width) || 1));
  const height = Math.max(1, Math.round(Number(input.height) || 1));
  return `
$ErrorActionPreference = "Stop"
if (-not ("MineradioStageOpaqueNative" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioStageOpaqueNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern IntPtr GetWindowLong32(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr64(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] private static extern IntPtr SetWindowLong32(IntPtr h, int i, IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  public static IntPtr GetWindowLongPtr(IntPtr h, int i) { return IntPtr.Size == 8 ? GetWindowLongPtr64(h, i) : GetWindowLong32(h, i); }
  public static IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v) { return IntPtr.Size == 8 ? SetWindowLongPtr64(h, i, v) : SetWindowLong32(h, i, v); }
}
"@
}
$prevDpi = [IntPtr]::Zero
try { $prevDpi = [MineradioStageOpaqueNative]::SetThreadDpiAwarenessContext([IntPtr]::new([Int64]-4)) } catch { }
$progman = [MineradioStageOpaqueNative]::FindWindow("Progman", $null)
$script:stageHost = [IntPtr]::Zero
$script:stageDefView = [IntPtr]::Zero
$script:stageKind = ""
if ($progman -ne [IntPtr]::Zero) {
  $v = [MineradioStageOpaqueNative]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($v -ne [IntPtr]::Zero) { $script:stageHost = $progman; $script:stageDefView = $v; $script:stageKind = "progman" }
}
if ($script:stageHost -eq [IntPtr]::Zero) {
  $cb = [MineradioStageOpaqueNative+EnumWindowsProc]{
    param([IntPtr]$top, [IntPtr]$state)
    $v = [MineradioStageOpaqueNative]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
    if ($v -ne [IntPtr]::Zero) { $script:stageHost = $top; $script:stageDefView = $v; $script:stageKind = "workerw"; return $false }
    return $true
  }
  [MineradioStageOpaqueNative]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
}
if ($script:stageHost -eq [IntPtr]::Zero -or $script:stageDefView -eq [IntPtr]::Zero) { throw "STAGE_ICON_HOST_NOT_FOUND" }
# 图标真正由 DefView 里的 SysListView32 画：把效果层挂到 DefView、插到 ListView 之后（更下层）
$listView = [MineradioStageOpaqueNative]::FindWindowEx($script:stageDefView, [IntPtr]::Zero, "SysListView32", $null)
$parent = $script:stageDefView
$insertAfter = $listView
if ($listView -eq [IntPtr]::Zero) { $parent = $script:stageHost; $insertAfter = $script:stageDefView }
$target = [IntPtr]::new([Int64]${hwnd})
if (-not [MineradioStageOpaqueNative]::IsWindow($target)) { throw "STAGE_TARGET_NOT_FOUND" }
$GWL_STYLE = -16
$WS_POPUP = [Int64]0x80000000
$WS_CHILD = [Int64]0x40000000
$style = [MineradioStageOpaqueNative]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()
$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD
[MineradioStageOpaqueNative]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null
$corner = 1
try { [MineradioStageOpaqueNative]::DwmSetWindowAttribute($target, 33, [ref]$corner, 4) | Out-Null } catch { }
[MineradioStageOpaqueNative]::SetParent($target, $parent) | Out-Null
if ([MineradioStageOpaqueNative]::GetParent($target) -ne $parent) { throw "STAGE_PARENT_FAILED" }
$origin = New-Object MineradioStageOpaqueNative+POINT
$origin.X = ${x}; $origin.Y = ${y}
if (-not [MineradioStageOpaqueNative]::ScreenToClient($script:stageHost, [ref]$origin)) { throw "STAGE_PARENT_BOUNDS_FAILED" }
if (-not [MineradioStageOpaqueNative]::SetWindowPos($target, $script:stageDefView, $origin.X, $origin.Y, ${width}, ${height}, 0x0030)) { throw "STAGE_PARENT_POSITION_FAILED" }
[pscustomobject]@{
  ok = $true
  windowId = ${hwnd}
  parentWindowId = $parent.ToInt64().ToString()
  parentKind = $script:stageKind
  zOrder = "behind-icons-opaque"
} | ConvertTo-Json -Compress
if ($prevDpi -ne [IntPtr]::Zero) { try { [MineradioStageOpaqueNative]::SetThreadDpiAwarenessContext($prevDpi) | Out-Null } catch { } }
`;
}

function parseNativeAck(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('STAGE_NATIVE_EMPTY');
  let parsed;
  try {
    parsed = JSON.parse(text.split(/\r?\n/).filter(Boolean).pop());
  } catch (_) {
    throw new Error('STAGE_NATIVE_ACK_INVALID');
  }
  if (!parsed || parsed.ok !== true) throw new Error('STAGE_NATIVE_ACK_INVALID');
  return parsed;
}

function runPowerShell(script, options = {}) {
  const execFileImpl = options.execFileImpl || execFile;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (error) {
        const failure = new Error(String(stderr || error.message || 'STAGE_NATIVE_FAILED').trim() || 'STAGE_NATIVE_FAILED');
        failure.code = failure.message;
        reject(failure);
        return;
      }
      resolve(String(stdout || ''));
    };
    try {
      execFileImpl('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', script,
      ], { windowsHide: true, timeout: Math.max(3000, Number(options.timeoutMs) || 8000) }, (error, stdout, stderr) => {
        finish(error, stdout, stderr);
      });
    } catch (error) {
      finish(error);
    }
  });
}

class DesktopStageWindow {
  constructor(options = {}) {
    if (typeof options.BrowserWindow !== 'function') throw new Error('STAGE_BROWSER_WINDOW_REQUIRED');
    if (!options.screen) throw new Error('STAGE_SCREEN_REQUIRED');
    this.BrowserWindow = options.BrowserWindow;
    this.screen = options.screen;
    this.preloadPath = String(options.preloadPath || '');
    this.overlayUrl = typeof options.overlayUrl === 'function'
      ? options.overlayUrl
      : () => String(options.overlayUrl || '');
    this.execFileImpl = options.execFileImpl;
    this.logger = options.logger || console;
    this.opaque = false;
    this.attachNative = typeof options.attachNative === 'function'
      ? options.attachNative
      : attachWallpaperWindowToDesktop;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.window = null;
    this.state = {
      enabled: false,
      opacity: DEFAULT_STAGE_OPACITY,
      frameRate: DEFAULT_STAGE_FRAME_RATE,
    };
    this.lastError = '';
    this.generation = 0;
    /* 只缓存「完整会话」：pulse 每秒都有，缓存它会让「页面加载完成后再发一次」变成
     * 只发一条 pulse —— 效果层没有曲目上下文，会把整首歌都错过（实测首屏 12s 才出声）。 */
    this.pendingFull = null;
    this.openPromise = null;
    this.displayListenersBound = false;
    this.lastDisplayId = '';
    this.zOrder = '';
    /* 效果层页面要在首帧就知道自己该走哪套最小画面（原世界/ Folia），
     * 这个值由发起切换的渲染端给出，主进程只负责写进导航 URL。 */
    this.overlayWorld = 'native';
  }

  isSupported() {
    return process.platform === 'win32';
  }

  isWindowAlive(win = this.window) {
    return !!(win && typeof win.isDestroyed === 'function' && !win.isDestroyed());
  }

  primaryDisplaySnapshot() {
    let display = null;
    try {
      const target = this.targetDisplayBounds();
      display = target ? this.screen.getDisplayMatching(target) : null;
      if (!display) display = this.screen.getPrimaryDisplay();
    } catch (_) {
      display = null;
    }
    const bounds = (display && display.bounds) || { x: 0, y: 0, width: 1280, height: 720 };
    const scale = Math.max(0.5, Math.min(4, Number(display && display.scaleFactor) || 1));
    return {
      displayId: String(display && display.id != null ? display.id : 'primary'),
      bounds: {
        x: Math.round(Number(bounds.x) || 0),
        y: Math.round(Number(bounds.y) || 0),
        width: Math.max(1, Math.round(Number(bounds.width) || 1)),
        height: Math.max(1, Math.round(Number(bounds.height) || 1)),
      },
      /* 挂进 WorkerW 用的坐标是物理像素（脚本里是 DPI-aware 线程）。 */
      physicalBounds: {
        x: Math.round((Number(bounds.x) || 0) * scale),
        y: Math.round((Number(bounds.y) || 0) * scale),
        width: Math.max(1, Math.round((Number(bounds.width) || 1) * scale)),
        height: Math.max(1, Math.round((Number(bounds.height) || 1) * scale)),
      },
    };
  }

  /* 主窗口在哪块屏，效果层就铺哪块屏。取不到就退主屏。 */
  targetDisplayBounds() {
    if (typeof this.mainWindowBounds === 'function') {
      const bounds = this.mainWindowBounds();
      if (bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0) return bounds;
    }
    return null;
  }

  getStatus(reason = '') {
    const win = this.isWindowAlive() ? this.window : null;
    let visible = false;
    let bounds = null;
    if (win) {
      try { visible = typeof win.isVisible === 'function' ? win.isVisible() : false; } catch (_) { visible = false; }
      try { bounds = typeof win.getBounds === 'function' ? win.getBounds() : null; } catch (_) { bounds = null; }
    }
    return {
      ok: !this.lastError,
      supported: this.isSupported(),
      enabled: this.state.enabled === true,
      active: !!(win && this.state.enabled),
      visible,
      attaching: false,
      generation: this.generation,
      mode: 'stage-window',
      windowId: win && typeof win.id !== 'undefined' ? win.id : null,
      bounds,
      opacity: this.state.opacity,
      frameRate: this.state.frameRate,
      lastError: this.lastError,
      zOrder: this.zOrder || '',
      opaque: this.opaque === true,
      attached: this.attached === true,
      escapeShortcutRegistered: false,
      reason: String(reason || ''),
    };
  }

  emitStatus(reason) {
    const status = this.getStatus(reason);
    try { this.onStatus(status); } catch (_) {}
    return status;
  }

  bindDisplayListeners() {
    if (this.displayListenersBound) return;
    this.displayListenersBound = true;
    const reposition = () => {
      /* 分辨率/缩放变化时即使 displayId 没变也要重设。 */
      this.applyDisplayBounds('display-changed', true);
    };
    try { this.screen.on('display-metrics-changed', reposition); } catch (_) {}
    try { this.screen.on('display-added', reposition); } catch (_) {}
    try { this.screen.on('display-removed', reposition); } catch (_) {}
  }

  /* 效果层铺哪块屏 = 主窗口所在的那块屏（与创建时同一条判据）。
   * force=false 时同一块屏直接返回：主窗口在同一块屏里拖动不该反复 setBounds。 */
  applyDisplayBounds(reason, force) {
    if (!this.isWindowAlive() || this.state.enabled !== true) return false;
    const snapshot = this.primaryDisplaySnapshot();
    if (!force && snapshot.displayId === this.lastDisplayId) return false;
    this.lastDisplayId = snapshot.displayId;
    try { this.window.setBounds(snapshot.bounds, false); } catch (_) {}
    this.sendState(reason || 'display-changed');
    return true;
  }

  /* 主窗口被拖到另一块显示器时由主进程调用。 */
  reposition(reason = '') {
    return this.applyDisplayBounds(reason || 'display-changed', false);
  }

  createWindow() {
    const snapshot = this.primaryDisplaySnapshot();
    this.lastDisplayId = snapshot.displayId;
    const win = new this.BrowserWindow({
      ...snapshot.bounds,
      show: false,
      frame: false,
      /* 不透明模式（Folia 的整屏场景样式）要挂进桌面层，透明模式（粒子/歌词）留在普通窗口带最底。
       * 透明与不透明只能二选一，所以由上层按当前样式决定，切换样式时重建窗口。 */
      transparent: this.opaque !== true,
      backgroundColor: this.opaque === true ? '#05070b' : '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: this.opaque === true && process.env.MINERADIO_STAGE_OPAQUE_PLAIN === '1',
      skipTaskbar: !(this.opaque === true && process.env.MINERADIO_STAGE_OPAQUE_PLAIN === '1'),
      alwaysOnTop: false,
      autoHideMenuBar: true,
      title: 'Mineradio Desktop Stage',
      // toolbar = WS_EX_TOOLWINDOW：skipTaskbar 只做一次性 DeleteTab，
      // 窗口重新显示后任务栏会把缩略图加回来（桌面歌词窗口踩过同一个坑）。
      ...(process.platform === 'win32' && process.env.MINERADIO_STAGE_OPAQUE_PLAIN !== '1' ? { type: 'toolbar' } : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    win.setIgnoreMouseEvents(true, { forward: true });
    try { win.setAlwaysOnTop(false); } catch (_) {}
    try { win.webContents.setAudioMuted(true); } catch (_) {}

    if (win.webContents && typeof win.webContents.setWindowOpenHandler === 'function') {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    win.webContents.on('will-navigate', (event, targetUrl) => {
      const expected = String(this.overlayUrl() || '');
      if (String(targetUrl || '') === expected) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    });
    win.on('closed', () => {
      if (this.window !== win) return;
      this.window = null;
      /* 窗口真被关掉时必须把 enabled 一起归零：只写 lastError 会让开关停在「开」，
       * 用户点一次开关反而先把它关掉（要两次点击才能重新拉起来）。 */
      if (this.state.enabled === true) {
        this.lastError = 'STAGE_WINDOW_CLOSED';
        this.state.enabled = false;
        this.pendingFull = null;
      } else {
        this.lastError = '';
      }
      this.emitStatus('window-closed');
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      if (this.window !== win || this.state.enabled !== true) return;
      this.lastError = 'STAGE_RENDERER_GONE:' + String(details && details.reason || 'unknown');
      this.disable('renderer-gone').catch(() => {});
    });
    win.webContents.on('did-finish-load', () => {
      if (this.window !== win) return;
      this.sendState('did-finish-load');
      this.sendSession('did-finish-load');
    });
    this.window = win;
    return win;
  }

  /* 不透明模式：挂进桌面层（壁纸 WorkerW，图标之下）。复用全桌面模式的挂载实现。 */
  async attachToDesktop(win) {
    const target = win || this.window;
    if (!this.isWindowAlive(target)) return false;
    const snapshot = this.primaryDisplaySnapshot();
    const physical = snapshot.physicalBounds || snapshot.bounds;
    try {
      const stdout = await runPowerShell(stageOpaqueBehindIconsScript({
        hwnd: nativeWindowHandleDecimal(target),
        x: physical.x,
        y: physical.y,
        width: physical.width,
        height: physical.height,
      }), { execFileImpl: this.execFileImpl || execFile });
      const result = parseNativeAck(stdout);
      if (!result || result.ok !== true || !result.parentWindowId || String(result.parentWindowId) === '0') {
        throw new Error('STAGE_DESKTOP_ATTACH_ACK_INVALID');
      }
      this.attached = true;
      this.zOrder = 'desktop-attached';
      return true;
    } catch (error) {
      this.logger.warn('[StageWindow] attach to desktop failed:', error && error.message || error);
      this.attached = false;
      this.zOrder = '';
      return false;
    }
  }

  /* z 序：压到普通窗口带的最底（HWND_BOTTOM）。
   * 不透明 + SetParent 到桌面层的方案实测在效果层这张窗口上不成立（挂载成功但桌面看不到画面），
   * 所以保留「透明 + 最底」这条已验证可用的路径。 */
  async applyDesktopLayer() {
    if (!this.isWindowAlive()) return 'none';
    const hwnd = nativeWindowHandleDecimal(this.window);
    try {
      const stdout = await runPowerShell(stageBottomScript({ hwnd }), { execFileImpl: this.execFileImpl || execFile });
      parseNativeAck(stdout);
      this.zOrder = 'bottom';
      return 'bottom';
    } catch (error) {
      this.logger.warn('[StageWindow] set bottom failed:', error && error.message || error);
      this.zOrder = 'none';
      return 'none';
    }
  }

  async open(payload = {}) {
    if (!this.isSupported()) {
      this.lastError = 'STAGE_UNSUPPORTED_PLATFORM';
      return { ok: false, enabled: false, error: this.lastError, status: this.getStatus('unsupported') };
    }
    if (this.isWindowAlive()) {
      this.state.enabled = true;
      this.state.opacity = normalizeStageOpacity(payload.opacity);
      this.state.frameRate = normalizeStageFrameRate(payload.frameRate);
      this.applyOpacity();
      this.showWindow();
      this.emitStatus('reopen');
      return { ok: true, enabled: true, status: this.getStatus('reopen') };
    }
    if (this.openPromise) return this.openPromise;
    this.openPromise = (async () => {
      this.generation += 1;
      this.lastError = '';
      this.state.enabled = true;
      this.state.opacity = normalizeStageOpacity(payload.opacity);
      this.state.frameRate = normalizeStageFrameRate(payload.frameRate);
      this.overlayWorld = payload.stageWorld === 'folia' ? 'folia' : 'native';
      this.opaque = payload.opaque === true || process.env.MINERADIO_STAGE_OPAQUE === '1';
      const win = this.createWindow();
      const url = String(this.overlayUrl() || '');
      if (!url) throw new Error('STAGE_URL_MISSING');
      await win.loadURL(url);
      if (!this.isWindowAlive(win)) throw new Error('STAGE_WINDOW_UNAVAILABLE');
      this.applyOpacity();
      this.bindDisplayListeners();
      if (this.opaque) {
        /* 先在隐藏状态挂进桌面层，再 showInactive：反过来（先 show 再挂）实测页面不出帧，
         * 只剩窗口底色。挂载脚本本身带 SWP_SHOWWINDOW，但 Electron 侧的 show 仍要补一次。 */
        const attached = await this.attachToDesktop(win);
        if (!attached) throw new Error('STAGE_DESKTOP_ATTACH_FAILED');
        try { win.showInactive(); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 200));
        /* 挂进桌面层后 Chromium 可能不再向这张窗口提交合成帧（桌面只剩窗口底色）。
         * 先请求一次整窗重绘，再在下一拍补一次，看看能否把首帧推上去。 */
        try { win.webContents.invalidate(); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 250));
        try { win.webContents.invalidate(); } catch (_) {}
      } else {
        this.showWindow();
      }
      this.emitStatus('opened');
      return { ok: true, enabled: this.state.enabled === true, status: this.getStatus('opened') };
    })()
      .catch((error) => {
        this.lastError = (error && error.message) || 'STAGE_OPEN_FAILED';
        this.state.enabled = false;
        this.destroyWindow();
        return { ok: false, enabled: false, error: this.lastError, status: this.getStatus('open-failed') };
      })
      .finally(() => { this.openPromise = null; });
    return this.openPromise;
  }

  applyOpacity() {
    if (!this.isWindowAlive()) return;
    const opacity = normalizeStageOpacity(this.state.opacity);
    try {
      if (opacity >= 0.999) this.window.setOpacity(1);
      else this.window.setOpacity(opacity);
    } catch (_) {}
  }

  showWindow() {
    if (!this.isWindowAlive()) return;
    try { this.window.showInactive(); } catch (_) {
      try { this.window.show(); } catch (_) {}
    }
    // z 序必须在 show 之后：show 会让窗口进入默认 z 序位置。
    Promise.resolve().then(() => this.applyDesktopLayer()).catch(() => {});
  }

  sendState(reason = '') {
    if (!this.isWindowAlive()) return false;
    const wc = this.window.webContents;
    if (!wc || wc.isDestroyed()) return false;
    try {
      /* 只发设置，不带会话：这条在「壁纸设置推送」里会被每秒调用多次，
       * 把整条队列（最多 120 首）一起塞进来会变成每秒几百 KB 的 IPC。 */
      wc.send('mineradio-stage-state', {
        enabled: this.state.enabled === true,
        opacity: this.state.opacity,
        frameRate: this.state.frameRate,
        reason: String(reason || '')
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  sendSession(reason = '', session = null) {
    const payload = session || this.pendingFull;
    if (!this.isWindowAlive() || !payload) return false;
    const wc = this.window.webContents;
    if (!wc || wc.isDestroyed()) return false;
    try {
      wc.send('mineradio-stage-state', {
        enabled: this.state.enabled === true,
        reason: String(reason || ''),
        session: payload
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /* 主窗口下发的「同一首歌同一秒」快照。舞台页不在时先存着，等它 did-finish-load。 */
  setSession(session) {
    const payload = session && typeof session === 'object' ? session : null;
    if (payload && payload.kind === 'full') this.pendingFull = payload;
    this.sendSession('session', payload);
    return true;
  }

  async update(payload = {}) {
    if (!this.state.enabled) return { ok: true, enabled: false, status: this.getStatus('update-disabled') };
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'opacity')) {
      this.state.opacity = normalizeStageOpacity(payload.opacity);
      this.applyOpacity();
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'frameRate')) {
      this.state.frameRate = normalizeStageFrameRate(payload.frameRate);
    }
    this.sendState('update');
    return { ok: true, enabled: true, status: this.emitStatus('update') };
  }

  destroyWindow() {
    const win = this.window;
    this.window = null;
    if (!win) return;
    try { win.destroy(); } catch (_) {
      try { win.close(); } catch (_) {}
    }
  }

  async disable(reason = 'disabled') {
    this.state.enabled = false;
    this.pendingFull = null;
    /* 关掉之后这些字段都描述的是已销毁的窗口，留着会让状态查询说「还挂在桌面层」。 */
    this.attached = false;
    this.zOrder = '';
    this.opaque = false;
    this.lastDisplayId = '';
    this.destroyWindow();
    return { ok: true, enabled: false, status: this.emitStatus(reason) };
  }
}

module.exports = {
  DesktopStageWindow,
  DEFAULT_STAGE_OPACITY,
  DEFAULT_STAGE_FRAME_RATE,
  normalizeStageOpacity,
  normalizeStageFrameRate,
  nativeWindowHandleDecimal,
  parseNativeAck,
  stageOpaqueBehindIconsScript,
  stageBottomScript,
};
