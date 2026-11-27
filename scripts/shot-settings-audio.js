'use strict';
/**
 * 设置页「音频」面板截图（真实 Chromium 渲染，不是设计稿）。
 *
 * 走 public/_settings-preview-audio.html —— 它引真实 CSS 与 01-audio-tuning.js，
 * 10 段 EQ 推子由 buildUi() 运行时生成，所以截出来的就是用户看到的那一版。
 *
 * 用途：新增音效（立体环绕 / 人声伴奏 / 3D 丽音）后肉眼核对排布与折叠，
 * 避免「只跑单测不看渲染」。
 *
 * 用法：node scripts/shot-settings-audio.js [输出目录]
 * 产物：settings-audio-full.png / settings-audio-presets.png / settings-audio-haas.png
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, '_debug-archive', '2026-11-27-3d-haas'));
const PAGE = path.join(ROOT, 'public', '_settings-preview-audio.html');

if (!process.versions.electron) {
  const electronExe = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const child = spawn(electronExe, [__filename, OUT_DIR, '--disable-gpu'], { cwd: ROOT, env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
  return;
}

const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-crash-reporter');
app.setPath('userData', path.join(OUT_DIR, 'userdata-shot'));
app.setPath('sessionData', path.join(OUT_DIR, 'userdata-shot'));
app.setPath('crashDumps', path.join(OUT_DIR, 'crashdumps-shot'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function save(win, name, rect) {
  const img = await win.webContents.capturePage(rect);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, img.toPNG());
  console.log('saved ' + file);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 1500,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });

  try {
    await win.loadFile(PAGE);
    /* 等 buildUi()（10 段推子运行时生成）与 prismal 填充同步落地 */
    await sleep(900);

    /* 静态预览默认 haasEnabled=false，syncUi 会把折叠收起；
       脚本里点一下开关，让截图看到展开态（也就是用户打开后的样子）。 */
    const opened = await win.webContents.executeJavaScript(`(() => {
      ['audio-tuning-haas-toggle', 'audio-tuning-bass-toggle'].forEach(function(id){
        var btn = document.getElementById(id);
        if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
      });
      var isOpen = function(id){ var el = document.getElementById(id); return !!(el && el.classList && el.classList.contains('is-open')); };
      return { haas: isOpen('audio-tuning-haas-sliders'), bass: isOpen('audio-tuning-bass-sliders') };
    })()`, true);
    console.log('haas opened: ' + JSON.stringify(opened));
    await sleep(400);

    const geo = await win.webContents.executeJavaScript(`(() => {
      const r = (id) => { const el = document.getElementById(id); if (!el) return null;
        const b = el.getBoundingClientRect(); return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)),
          width: Math.round(b.width), height: Math.round(b.height) }; };
      return {
        doc: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        presets: r('audio-tuning-presets'),
        haas: r('audio-tuning-haas-body'),
      };
    })()`, true);
    console.log(JSON.stringify(geo));

    await save(win, 'settings-audio-full.png', { x: 0, y: 0, width: geo.doc.width, height: geo.doc.height });

    /* 局部图必须先把目标滚进视口：capturePage 的 rect 是视口坐标，
       目标在滚动容器外时会拿到越界矩形（UnknownVizError）。 */
    async function shotElement(id, name, pad) {
      const r = await win.webContents.executeJavaScript(`(function(){
        var el = document.getElementById('${id}');
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      })()`, true);
      if (!r) return;
      await sleep(320);
      const r2 = await win.webContents.executeJavaScript(`(function(){
        var b = document.getElementById('${id}').getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      })()`, true);
      const p = pad == null ? 12 : pad;
      await save(win, name, {
        x: Math.max(0, r2.x - p),
        y: Math.max(0, r2.y - p),
        width: Math.min(win.getContentBounds().width, r2.width + p * 2),
        height: Math.min(win.getContentBounds().height, r2.height + p * 2),
      });
    }

    await shotElement('audio-tuning-presets', 'settings-audio-presets.png');
    await shotElement('audio-tuning-haas-body', 'settings-audio-haas.png');
    await shotElement('audio-tuning-bass-body', 'settings-audio-bass.png');

    /* 三块音效（立体环绕 / 人声伴奏 / 3D 丽音）必须视觉一致：
       一起截一张，对比卡片间距、标题层级、开关位置有没有跑偏。 */
    const stack = await win.webContents.executeJavaScript(`(function(){
      var a = document.getElementById('audio-tuning-surround-body');
      var b = document.getElementById('audio-tuning-bass-body') || document.getElementById('audio-tuning-haas-body');
      if (!a || !b) return null;
      a.scrollIntoView({ block: 'start' });
      return true;
    })()`, true);
    if (stack) {
      await sleep(320);
      const box = await win.webContents.executeJavaScript(`(function(){
        var a = document.getElementById('audio-tuning-surround-body');
        var b = document.getElementById('audio-tuning-bass-body') || document.getElementById('audio-tuning-haas-body');
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return { x: Math.max(0, Math.round(ra.left) - 14), y: Math.max(0, Math.round(ra.top) - 14),
                 width: Math.min(window.innerWidth, Math.round(ra.width) + 28),
                 height: Math.min(window.innerHeight - Math.max(0, Math.round(ra.top) - 14),
                                 Math.round(rb.bottom - ra.top) + 28) };
      })()`, true);
      if (box && box.height > 50) await save(win, 'settings-audio-effects-stack.png', box);
    }
    app.exit(0);
  } catch (err) {
    console.error('截图失败:', err && err.message);
    app.exit(1);
  }
});
