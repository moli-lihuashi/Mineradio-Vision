/* 自定义图上传取证：无图态 / 有图态 / 莫奈肖像上传行。
 *
 * 判据（截图可读）：
 *   1) 无图：文件名行显示「-」，清空按钮与「自定义图片」药丸都是灰的
 *   2) 有图：文件名回显、清空按钮点亮、来源自动切到「自定义图片」（描边高亮）
 *   3) 肖像：莫奈样式面板里同样一行（上传肖像图 / 清空肖像图），上传后药丸可选
 *
 * 用法：node .workbuddy/harness/shot-folia-image-pool.js
 * 前置：node scripts/sync-dist-app.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 在页面里画一张带文字的渐变图，编码成 PNG File 再塞给 input —— 与用户选文件同一条链路。 */
const makeImageFile = (name, text) => `(async function(){
  var canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  var ctx = canvas.getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 960, 600);
  grad.addColorStop(0, '#0b1a33');
  grad.addColorStop(0.55, '#2a6fa8');
  grad.addColorStop(1, '#ffb36b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 960, 600);
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = 'bold 96px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(${JSON.stringify(text)}, 480, 330);
  var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png'); });
  var file = new File([blob], ${JSON.stringify(name)}, { type: 'image/png' });

  var input = document.querySelector('#fx-folia-tuning [data-folia-asset-input]');
  if (!input) return { __missing: true };
  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { fed: true, name: file.name, bytes: blob.size };
})()`;

const BOOT = `(async function(){
  playQueue = [{ id: 'shot-pool', name: '图片池取证曲', artist: 'Folia', album: 'Assets', duration: 240 }];
  currentIdx = 0;
  lyricsLines = [
    { t: 0, text: '夜色沉入海面微光', translation: '', duration: 4, words: [] },
    { t: 4, text: '风把旧名字吹散', translation: '', duration: 4, words: [] }
  ];
  if (typeof foliaWorldLineCache !== 'undefined') foliaWorldLineCache = { ref: null, len: 0, lines: [] };
  window.__foliaTestTime = 1.0;
  foliaWorldPlaybackTime = function(){ return window.__foliaTestTime; };

  await window.foliaAssetReset();
  if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
  if (typeof foliaModeResetTuning === 'function') foliaModeResetTuning('monet');

  foliaWorldExit({ silent: true });
  foliaWorld.mode = 'still';
  foliaWorld.background = 'monet';
  foliaWorldEnter({ silent: true });

  var panel = document.getElementById('fx-panel');
  if (panel) { panel.classList.add('show'); panel.style.right = '24px'; panel.style.opacity = '1';
    panel.style.transform = 'none'; panel.style.pointerEvents = 'auto'; }
  if (typeof setFxPanelTab === 'function') setFxPanelTab('folia');
  var fold = document.getElementById('fx-folia-tuning-fold');
  if (fold && !fold.classList.contains('open')) {
    var head = fold.querySelector('.fx-fold-head');
    if (head) head.click();
  }
  await new Promise(function(r){ setTimeout(r, 260); });
  return {
    active: foliaWorld.active,
    bg: foliaWorld.background,
    title: (document.getElementById('fx-folia-tuning-title') || {}).textContent,
    assets: document.querySelectorAll('#fx-folia-tuning .fx-folia-asset').length,
    assetName: (document.querySelector('#fx-folia-tuning .fx-folia-asset-name') || {}).textContent,
    uploadText: (document.querySelector('#fx-folia-tuning [data-folia-asset-upload]') || {}).textContent,
    clearDisabled: (function(){
      var b = document.querySelector('#fx-folia-tuning [data-folia-asset-clear]');
      return b ? !!b.disabled : null;
    })()
  };
})()`;

/* 把「上传行」滚到面板视口里：面板自己的滚动容器是 #fx-panel .fx-scroll，
 * scrollIntoView 会被它吃掉（停在面板顶部），所以直接算 offsetTop 写 scrollTop。 */
const SCROLL_ROW = `(function(){
  var scroller = document.querySelector('#fx-panel .fx-scroll');
  var row = document.querySelector('#fx-folia-tuning .fx-folia-asset');
  if (!scroller || !row) return { __missing: true };
  var delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop = Math.max(0, scroller.scrollTop + delta - 96);
  return { top: Math.round(scroller.scrollTop), delta: Math.round(delta) };
})()`;

const STATE = `(function(){
  var pill = null;
  var group = document.querySelector('#fx-folia-tuning [data-folia-tuning-key="backgroundSource"]');
  for (var i = 0; group && i < group.children.length; i++) {
    if (group.children[i].textContent === '自定义图片') pill = group.children[i];
  }
  var scroll = document.querySelector('#fx-panel .fx-scroll');
  if (scroll) scroll.scrollTop = Math.max(0, scroll.scrollTop);
  return {
    assetName: (document.querySelector('#fx-folia-tuning .fx-folia-asset-name') || {}).textContent,
    clearDisabled: (function(){ var b = document.querySelector('#fx-folia-tuning [data-folia-asset-clear]'); return b ? !!b.disabled : null; })(),
    source: foliaMonetTuning().backgroundSource,
    pillDisabled: pill ? !!pill.disabled : null,
    pillActive: pill ? pill.classList.contains('active') : null,
    count: window.foliaAssetCount('background'),
    globalId: window.foliaMonetBackgroundImage ? window.foliaMonetBackgroundImage.id : null
  };
})()`;

(async () => {
  const app = await cdp.launch({ port: 9443 });
  /* 注意签名带 app：调用点写的是 shot(app, name)，少一个参数就会把 app 对象当文件名
   * （于是三张图全存成 [object Object].png）。 */
  const shot = async (appRef, name) => {
    await app.send('Page.enable');
    const res = await app.send('Page.captureScreenshot', { format: 'png' });
    const out = path.resolve('.workbuddy/preview/' + name + '.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
    console.log('saved', out, fs.statSync(out).size + 'B');
  };

  try {
    if (!(await app.waitReady(120000))) throw new Error('模块未就绪');
    try { await app.dismissSplash(); } catch (_) {}
    await sleep(400);

    console.log('boot', JSON.stringify(await app.eval(BOOT)));
    await sleep(700);
    console.log('scroll', JSON.stringify(await app.eval(SCROLL_ROW)));
    await sleep(260);
    await shot(app, 'folia-image-pool-empty');

    console.log('upload-bg', JSON.stringify(await app.eval(makeImageFile('海面与风.png', '墨迹海面'))));
    await sleep(900);
    console.log('state-bg', JSON.stringify(await app.eval(STATE)));
    console.log('scroll', JSON.stringify(await app.eval(SCROLL_ROW)));
    await sleep(260);
    await shot(app, 'folia-image-pool-uploaded');

    /* 莫奈样式面板：同一行上传，槽位换成肖像图。 */
    await app.eval(`(async function(){
      foliaWorldSetBackground('none');
      foliaWorldSetMode('monet');
      await new Promise(function(r){ setTimeout(r, 120); });
      return 1;
    })()`);
    await sleep(900);
    console.log('upload-face', JSON.stringify(await app.eval(makeImageFile('肖像.png', '肖像'))));
    await sleep(900);
    console.log('portrait-state', JSON.stringify(await app.eval(`(function(){
      var pill = null;
      var group = document.querySelector('#fx-folia-tuning [data-folia-tuning-key="portraitSource"]');
      for (var i = 0; group && i < group.children.length; i++) {
        if (group.children[i].textContent === '自定义图片') pill = group.children[i];
      }
      return {
        name: (document.querySelector('#fx-folia-tuning .fx-folia-asset-name') || {}).textContent,
        source: foliaModeTuning('monet').portraitSource,
        pillDisabled: pill ? !!pill.disabled : null,
        imgSrc: (function(){
          var img = document.querySelector('.folia-monet-portrait-img');
          return img ? String(img.getAttribute('src') || '').slice(0, 12) : null;
        })()
      };
    })()`)));
    console.log('scroll', JSON.stringify(await app.eval(SCROLL_ROW)));
    await sleep(260);
    await shot(app, 'folia-image-pool-portrait');

    /* 收尾：池清空 + 调参复位 —— 残留图会打红后面的面板冒烟。 */
    await app.eval(`(async function(){
      await window.foliaAssetReset();
      try { foliaWorldExit({ silent: true }); } catch (_) {}
      if (typeof foliaModeResetTuning === 'function') foliaModeResetTuning('monet');
      if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
      try {
        localStorage.removeItem('mineradio-folia-tuning-v1');
        localStorage.removeItem('mineradio-folia-monet-tuning-v1');
      } catch (_) {}
      foliaWorld.mode = 'classic';
      foliaWorld.background = 'none';
      if (typeof saveFoliaWorldPrefs === 'function') saveFoliaWorldPrefs();
      return 1;
    })()`);
    console.log('errors', JSON.stringify(await app.errors()));
  } finally {
    try { await app.close(); } catch (_) {}
  }
})().catch((e) => { console.error('SHOT ERROR', e && e.message); process.exit(1); });
