/* Folia 自定义图片池 exe 侧冒烟：IndexedDB 落盘 / 校验 / 桥接 + 三处上传界面真实交互。
 *
 * 前置：node scripts/sync-dist-app.js（跑 dist/Mineradio/Mineradio.exe）
 * 用法：node .workbuddy/harness/run-exe-smoke.js smoke-folia-image-pool.js
 *
 * 为什么必须在 exe 侧跑：上传链路的两半都只有真浏览器才有 ——
 *   ① IndexedDB 真存 Blob（Node 里没有）；② <input type="file"> 塞 File 要 DataTransfer。
 * 判据来源全是真身：window.foliaAsset* 的返回值、IDB 里的原始记录、面板 DOM 与落盘存档。
 *
 * 覆盖：
 *   A 池内核 —— 五个键名逐字对齐 Folia / 格式校验两种失败 / 空选 / 上传成功 / 双全局桥接 /
 *               IDB 原始记录形态（有 blob、不含 url）/ 替换上传 / 清空 / 两个槽互不干扰
 *   B 面板   —— 莫奈背景、漫游、莫奈样式三处的上传行结构 + 上传/清空后的来源切换与落盘
 *   C 画面   —— 莫奈肖像真的换成 blob: 图，清空后回封面（0d 的解析公式）
 *
 * 收尾必须把池清空：后面的面板冒烟断言「没有上传图时自定义图片禁用」，残留一张图会把它整条打红。
 */
'use strict';

const cdp = require('./cdp-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = `(function(){
  var k = window.foliaAssetKeys || {};
  return {
    keys: k,
    accept: window.foliaAssetAccept || '',
    text: window.foliaAssetText || {},
    broken: typeof window.foliaAssetDbUnavailable === 'function' ? window.foliaAssetDbUnavailable() : null
  };
})()`;

/* 上传一个 1x1 PNG（真 PNG 头，浏览器 Image 解码不会报错）。 */
const putFile = (key, name, mime) => `(async function(){
  var bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
    0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,
    13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]);
  var file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  return await window.foliaAssetPutFile(${JSON.stringify(key)}, file);
})()`;

const putBadFile = (key, name, mime) => `(async function(){
  var file = new File(['hello'], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  return await window.foliaAssetPutFile(${JSON.stringify(key)}, file);
})()`;

const putNothing = (key) => `(async function(){
  return await window.foliaAssetPutFile(${JSON.stringify(key)}, null);
})()`;

const SNAPSHOT = (key) => `(function(){
  var entry = window.foliaAssetGet ? window.foliaAssetGet(${JSON.stringify(key)}) : null;
  var url = entry && entry.url ? String(entry.url) : '';
  return {
    count: window.foliaAssetCount ? window.foliaAssetCount(${JSON.stringify(key)}) : -1,
    id: entry ? String(entry.id || '') : '',
    name: entry ? String(entry.name || '') : '',
    mime: entry ? String(entry.mimeType || '') : '',
    isBlobUrl: url.indexOf('blob:') === 0,
    url: url,
    monetGlobal: window.foliaMonetBackgroundImage ? String(window.foliaMonetBackgroundImage.id || '') : '',
    nomandGlobal: window.foliaNomandCustomImage ? String(window.foliaNomandCustomImage.id || '') : ''
  };
})()`;

/* 直接读 IndexedDB 原始记录：证明「真的落盘了」，也证明存的是 blob 而不是失效的 objectURL。 */
const RAW_RECORD = (dbKey) => `(async function(){
  try {
    var db = await new Promise(function(resolve, reject){
      var req = indexedDB.open('mineradio-folia-assets', 1);
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
    var value = await new Promise(function(resolve){
      var tx = db.transaction('assets', 'readonly');
      var get = tx.objectStore('assets').get(${JSON.stringify(dbKey)});
      get.onsuccess = function(){ resolve(get.result === undefined ? null : get.result); };
      get.onerror = function(){ resolve(null); };
    });
    db.close();
    if (!value) return { exists: false };
    return {
      exists: true,
      id: String(value.id || ''),
      name: String(value.name || ''),
      hasBlob: (typeof Blob !== 'undefined') && (value.blob instanceof Blob),
      hasUrlField: Object.prototype.hasOwnProperty.call(value, 'url'),
      keys: Object.keys(value)
    };
  } catch (e) { return { error: String(e && e.message) }; }
})()`;

const ASSET_ROW = (key) => `(function(){
  var row = document.querySelector('#fx-folia-tuning [data-folia-asset-key="' + ${JSON.stringify(key)} + '"]');
  if (!row) return { __missing: true };
  var up = row.querySelector('[data-folia-asset-upload]');
  var cl = row.querySelector('[data-folia-asset-clear]');
  var nm = row.querySelector('[data-folia-asset-name]');
  var inp = row.querySelector('[data-folia-asset-input]');
  return {
    uploadText: up ? up.textContent : null,
    uploadDisabled: up ? !!up.disabled : null,
    clearText: cl ? cl.textContent : null,
    clearDisabled: cl ? !!cl.disabled : null,
    name: nm ? nm.textContent : null,
    hasInput: !!inp,
    accept: inp ? inp.accept : null,
    rows: document.querySelectorAll('#fx-folia-tuning .fx-folia-asset').length,
    visible: row ? Math.round(row.getBoundingClientRect().height) : -1
  };
})()`;

/* 把 File 真塞进 input 再派发 change —— 走的是用户选文件后的同一条事件路径。 */
const FEED_FILE = (key, name, mime) => `(async function(){
  var input = document.querySelector('#fx-folia-tuning [data-folia-asset-input="' + ${JSON.stringify(key)} + '"]');
  if (!input) return { __missing: true };
  var bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
    0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,
    13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]);
  var file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { fed: true, count: input.files.length };
})()`;

const PILL_STATE = (key, label) => `(function(){
  var group = document.querySelector('#fx-folia-tuning [data-folia-tuning-key="' + ${JSON.stringify(key)} + '"]');
  if (!group) return { __missing: true };
  var target = null;
  for (var i = 0; i < group.children.length; i++) {
    if (group.children[i].textContent === ${JSON.stringify(label)}) { target = group.children[i]; break; }
  }
  if (!target) return { __missing: true, labels: Array.prototype.map.call(group.children, function(b){ return b.textContent; }) };
  return {
    disabled: !!target.disabled,
    active: target.classList.contains('active'),
    dim: target.classList.contains('is-disabled')
  };
})()`;

const MONET_PORTRAIT = `(function(){
  var inst = foliaWorld.instance;
  if (!inst) return { __missing: true };
  var layers = inst.portraitLayers || [];
  var top = layers.length ? layers[layers.length - 1] : null;
  return {
    src: inst.portraitSrc ? String(inst.portraitSrc) : '',
    isBlob: inst.portraitSrc ? String(inst.portraitSrc).indexOf('blob:') === 0 : false,
    imgSrc: top && top.el ? String(top.el.getAttribute('src') || '') : '',
    tuning: foliaModeTuning('monet').portraitSource
  };
})()`;

(async () => {
  const app = await cdp.launch({ port: 9488 });
  const out = [];
  const ok = (name, cond, detail) => {
    const line = (cond ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + detail);
    out.push(line);
    console.log(line);
    return cond;
  };

  try {
    if (!(await app.waitReady(120000))) throw new Error('模块未就绪');
    try { await app.dismissSplash(); } catch (_) {}
    await sleep(400);

    /* ---- 开场：清干净池 + 复位两套调参 + 进世界开控制台 ----
     * 池是 IndexedDB 存的，跨进程留存：上一条冒烟或上一次手工操作留下的图会让
     * 「没有图时禁用」这类断言直接反向，所以先 foliaAssetReset() 归零。 */
    const boot = await app.eval(`(async function(){
      var p = document.getElementById('fx-panel');
      if (p) { p.classList.add('show'); p.style.right = '24px'; p.style.opacity = '1';
        p.style.transform = 'none'; p.style.pointerEvents = 'auto'; }
      foliaWorldExit({ silent: true });
      try {
        localStorage.removeItem('mineradio-folia-tuning-v1');
        localStorage.removeItem('mineradio-folia-monet-tuning-v1');
        localStorage.removeItem('mineradio-folia-nomand-tuning-v1');
      } catch (_) {}
      if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
      if (typeof foliaNomandResetTuning === 'function') foliaNomandResetTuning();
      if (typeof foliaModeResetTuning === 'function') foliaModeResetTuning('monet');
      await window.foliaAssetReset();
      foliaWorld.mode = 'still';
      foliaWorld.background = 'none';
      foliaWorldEnter({ silent: true });
      if (typeof setFxPanelTab === 'function') setFxPanelTab('folia');
      return { ok: true };
    })()`);
    ok('开场：池清空 + 世界入场成功', boot && boot.ok === true, JSON.stringify(boot));
    await sleep(700);

    /* ================= A. 池内核 ================= */
    const keys = await app.eval(KEYS);
    ok('五个资产键名逐字对齐 Folia（services/*.ts 的 *_KEY 常量）',
      keys && keys.keys && keys.keys.background === 'monet_background_image'
      && keys.keys.portrait === 'monet_portrait_image'
      && keys.keys.cappellaAvatar === 'cappella_custom_avatar'
      && keys.keys.cappellaEmoji === 'cappella_custom_emoji'
      && keys.keys.temperaLayers === 'tempera_layer_images',
      keys && JSON.stringify(keys.keys));
    ok('accept 与 Folia 的 input 属性同款（png/jpg/jpeg/gif/webp/svg + image/*）',
      keys && keys.accept === '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*', keys && keys.accept);
    ok('文案逐字：请选择图片文件。/ 仅支持… / 四条 Monet 提示',
      keys && keys.text.selectFile === '请选择图片文件。'
      && keys.text.unsupported === '仅支持 png、jpg、jpeg、gif、webp、svg 图片。'
      && keys.text.bgUpdated === 'Monet 背景图已更新'
      && keys.text.bgCleared === 'Monet 背景图已清空'
      && keys.text.portraitUpdated === 'Monet 肖像图已更新'
      && keys.text.portraitCleared === 'Monet 肖像图已清空',
      keys && JSON.stringify(keys.text));
    ok('IndexedDB 可用（没有被策略降级成内存表）', keys && keys.broken === false, String(keys && keys.broken));

    const empty = await app.eval(putNothing('background'));
    ok('空选：拒绝并给出「请选择图片文件。」', empty && empty.ok === false
      && empty.error === '请选择图片文件。', JSON.stringify(empty));

    const bad = await app.eval(putBadFile('background', 'note.txt', 'text/plain'));
    ok('非图片：拒绝并给出「仅支持 png、jpg、jpeg、gif、webp、svg 图片。」',
      bad && bad.ok === false && bad.error === '仅支持 png、jpg、jpeg、gif、webp、svg 图片。',
      JSON.stringify(bad));
    const afterBad = await app.eval(SNAPSHOT('background'));
    ok('非法上传不写池、不桥接全局（仍然是空的）',
      afterBad && afterBad.count === 0 && afterBad.monetGlobal === '' && afterBad.nomandGlobal === '',
      JSON.stringify(afterBad));

    const first = await app.eval(putFile('background', 'bg-one.png', 'image/png'));
    const bg1 = await app.eval(SNAPSHOT('background'));
    ok('上传 PNG：ok + 快照有 id/name/mime + url 是 blob:',
      first && first.ok === true && bg1.count === 1 && bg1.name === 'bg-one.png'
      && bg1.mime === 'image/png' && bg1.isBlobUrl === true,
      JSON.stringify({ result: first && first.ok, snap: bg1 }));
    ok('资产 id 是「时间戳-文件名」（visualizerImageAsset.ts:41）',
      bg1 && /^\d+-bg-one\.png$/.test(bg1.id), bg1 && bg1.id);
    ok('桥接两个全局：莫奈背景与漫游读的是同一张图',
      bg1 && bg1.monetGlobal === bg1.id && bg1.nomandGlobal === bg1.id,
      bg1 && (bg1.monetGlobal + ' / ' + bg1.nomandGlobal));

    const raw = await app.eval(RAW_RECORD('monet_background_image'));
    ok('真的落盘到 IndexedDB：记录带 blob、且不含会失效的 url 字段',
      raw && raw.exists === true && raw.hasBlob === true && raw.hasUrlField === false
      && raw.name === 'bg-one.png',
      JSON.stringify(raw));

    const second = await app.eval(putFile('background', 'bg-two.png', 'image/jpeg'));
    await sleep(150);
    const bg2 = await app.eval(SNAPSHOT('background'));
    ok('再上传一次是替换：只剩一条、id 换新、名字跟着换',
      second && second.ok === true && bg2.count === 1 && bg2.name === 'bg-two.png'
      && bg2.id !== bg1.id && bg2.monetGlobal === bg2.id,
      JSON.stringify(bg2));

    const portraitPut = await app.eval(putFile('portrait', 'face.png', 'image/png'));
    const bgAfterPortrait = await app.eval(SNAPSHOT('background'));
    const portraitSnap = await app.eval(SNAPSHOT('portrait'));
    ok('肖像槽与背景槽互不干扰（上传肖像不动背景那张）',
      portraitPut && portraitPut.ok === true && portraitSnap.count === 1
      && portraitSnap.name === 'face.png' && bgAfterPortrait.name === 'bg-two.png'
      && portraitSnap.monetGlobal === bgAfterPortrait.monetGlobal,
      JSON.stringify({ bg: bgAfterPortrait.name, portrait: portraitSnap.name }));

    const clearedPortrait = await app.eval(`(async function(){ return await window.foliaAssetClear('portrait'); })()`);
    const portraitAfterClear = await app.eval(SNAPSHOT('portrait'));
    const rawPortrait = await app.eval(RAW_RECORD('monet_portrait_image'));
    ok('清空单图槽：快照归零、IDB 记录也删掉',
      clearedPortrait && clearedPortrait.ok === true
      && portraitAfterClear.count === 0 && portraitAfterClear.id === ''
      && rawPortrait && rawPortrait.exists === false,
      JSON.stringify({ snap: portraitAfterClear, raw: rawPortrait }));

    /* ================= B. 三处面板 ================= */

    /* ---- B1. 莫奈背景（背景=monet，模式=still） ---- */
    /* 顺序要紧：面板是「切背景」那一刻重建的，池必须先清空，否则面板拿着上一段的旧图渲染。 */
    await app.eval(`(async function(){
      await window.foliaAssetClear('background');
      if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
      foliaWorldSetMode('still');
      foliaWorldSetBackground('monet');
      return 1;
    })()`);
    await sleep(500);
    const bgRow0 = await app.eval(ASSET_ROW('background'));
    const bgPill0 = await app.eval(PILL_STATE('backgroundSource', '自定义图片'));
    ok('莫奈背景面板有上传行：两粒按钮 + 文件名行 + 文件选择框',
      bgRow0 && !bgRow0.__missing && bgRow0.uploadText === '上传背景图'
      && bgRow0.clearText === '清空背景图' && bgRow0.name === '未选择' && bgRow0.hasInput === true
      && bgRow0.accept === '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*',
      JSON.stringify(bgRow0));
    ok('没有图时：清空按钮禁用、「自定义图片」药丸禁用',
      bgRow0 && bgRow0.clearDisabled === true && bgPill0 && bgPill0.disabled === true,
      JSON.stringify({ clear: bgRow0 && bgRow0.clearDisabled, pill: bgPill0 }));

    const fed = await app.eval(FEED_FILE('background', 'panel-bg.png', 'image/png'));
    await sleep(500);
    const bgRow1 = await app.eval(ASSET_ROW('background'));
    const bgPill1 = await app.eval(PILL_STATE('backgroundSource', '自定义图片'));
    const bgTuning1 = await app.eval(`(function(){
      var stored = null;
      try { stored = JSON.parse(localStorage.getItem('mineradio-folia-monet-tuning-v1')); } catch (_) {}
      return { source: foliaMonetTuning().backgroundSource, stored: stored && stored.backgroundSource };
    })()`);
    ok('选文件后文件名回显、清空按钮解禁',
      fed && fed.fed === true && bgRow1 && bgRow1.name === 'panel-bg.png'
      && bgRow1.clearDisabled === false,
      JSON.stringify({ fed: fed, row: bgRow1 && bgRow1.name, clear: bgRow1 && bgRow1.clearDisabled }));
    ok('上传成功把来源切到「自定义图片」并落盘',
      bgTuning1 && bgTuning1.source === 'uploaded-global' && bgTuning1.stored === 'uploaded-global',
      JSON.stringify(bgTuning1));
    ok('「自定义图片」药丸变成可选且处于选中态',
      bgPill1 && bgPill1.disabled === false && bgPill1.active === true, JSON.stringify(bgPill1));

    await app.eval(`(function(){
      document.querySelector('#fx-folia-tuning [data-folia-asset-clear="background"]').click();
      return 1;
    })()`);
    await sleep(500);
    const bgRow2 = await app.eval(ASSET_ROW('background'));
    const bgTuning2 = await app.eval(`(function(){
      var stored = null;
      try { stored = JSON.parse(localStorage.getItem('mineradio-folia-monet-tuning-v1')); } catch (_) {}
      return { source: foliaMonetTuning().backgroundSource, stored: stored && stored.backgroundSource,
        global: window.foliaMonetBackgroundImage ? 'set' : 'null',
        count: window.foliaAssetCount('background') };
    })()`);
    ok('点清空：文件名回「未选择」、清空按钮重新禁用、池归零',
      bgRow2 && bgRow2.name === '未选择' && bgRow2.clearDisabled === true
      && bgTuning2.count === 0 && bgTuning2.global === 'null',
      JSON.stringify({ row: bgRow2, tuning: bgTuning2 }));
    ok('清空后来源退回「封面」并落盘（useVisualizerSettingsStore.ts:704-716）',
      bgTuning2.source === 'cover-derived' && bgTuning2.stored === 'cover-derived',
      JSON.stringify(bgTuning2));

    /* ---- B2. 漫游：同一个资产槽 ---- */
    await app.eval(`(async function(){
      await window.foliaAssetClear('background');
      if (typeof foliaNomandResetTuning === 'function') foliaNomandResetTuning();
      foliaWorldSetBackground('nomand');
      return 1;
    })()`);
    await sleep(500);
    const nomandRow0 = await app.eval(ASSET_ROW('background'));
    const nomandPill0 = await app.eval(PILL_STATE('imageSource', '自定义图片'));
    ok('漫游面板也有同一行上传（Folia 两张卡片共用一个上传器）',
      nomandRow0 && !nomandRow0.__missing && nomandRow0.uploadText === '上传背景图'
      && nomandRow0.clearText === '清空背景图' && nomandRow0.rows === 1,
      JSON.stringify(nomandRow0));
    ok('漫游「自定义图片」在没有图时禁用',
      nomandPill0 && nomandPill0.disabled === true, JSON.stringify(nomandPill0));

    await app.eval(FEED_FILE('background', 'nomand-bg.png', 'image/png'));
    await sleep(520);
    const nomandRow1 = await app.eval(ASSET_ROW('background'));
    const nomandTuning1 = await app.eval(`(function(){
      var stored = null;
      try { stored = JSON.parse(localStorage.getItem('mineradio-folia-nomand-tuning-v1')); } catch (_) {}
      return { source: foliaNomandTuning().imageSource, stored: stored && stored.imageSource,
        name: window.foliaAssetName('background'), globalId: window.foliaNomandCustomImage && window.foliaNomandCustomImage.id };
    })()`);
    ok('漫游上传后：文件名回显 + 成功文案、来源切 uploaded-global 并落盘',
      nomandRow1 && nomandRow1.name === '背景图片上传成功'
      && nomandTuning1.source === 'uploaded-global' && nomandTuning1.stored === 'uploaded-global'
      && nomandTuning1.name === 'nomand-bg.png',
      JSON.stringify({ row: nomandRow1 && nomandRow1.name, tuning: nomandTuning1 }));
    ok('漫游的「自定义图片」跟着解禁并选中',
      (await app.eval(PILL_STATE('imageSource', '自定义图片'))).disabled === false,
      JSON.stringify(await app.eval(PILL_STATE('imageSource', '自定义图片'))));

    /* 同一张图在莫奈背景那边也认：换回去，来源仍是 uploaded-global、文件名同一串。 */
    await app.eval(`(function(){ foliaWorldSetBackground('monet'); return 1; })()`);
    await sleep(420);
    const sharedRow = await app.eval(ASSET_ROW('background'));
    const sharedTuning = await app.eval(`(function(){
      var group = document.querySelector('#fx-folia-tuning [data-folia-tuning-key="backgroundSource"]');
      var pill = null;
      for (var i = 0; group && i < group.children.length; i++) {
        if (group.children[i].textContent === '自定义图片') pill = group.children[i];
      }
      return { source: foliaMonetTuning().backgroundSource, name: window.foliaAssetName('background'),
        pillDisabled: pill ? !!pill.disabled : null };
    })()`);
    ok('同一张图两个背景共享：切回莫奈背景，文件名不变、「自定义图片」跟着可用',
      sharedRow && sharedRow.name === 'nomand-bg.png' && sharedTuning.name === 'nomand-bg.png'
      && sharedTuning.pillDisabled === false,
      JSON.stringify({ row: sharedRow && sharedRow.name, tuning: sharedTuning }));

    await app.eval(`(async function(){
      await window.foliaAssetClear('background');
      if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
      if (typeof foliaNomandResetTuning === 'function') foliaNomandResetTuning();
      return 1;
    })()`);
    await sleep(300);

    /* ---- B3. 莫奈样式面板（模式 = monet）：肖像槽 ---- */
    await app.eval(`(async function(){
      await window.foliaAssetClear('portrait');
      if (typeof foliaModeResetTuning === 'function') foliaModeResetTuning('monet');
      foliaWorldSetBackground('none');
      foliaWorldSetMode('monet');
      return 1;
    })()`);
    await sleep(700);
    const faceRow0 = await app.eval(ASSET_ROW('portrait'));
    const facePill0 = await app.eval(PILL_STATE('portraitSource', '自定义图片'));
    ok('莫奈样式面板有肖像上传行：文案「上传肖像图 / 清空肖像图」',
      faceRow0 && !faceRow0.__missing && faceRow0.uploadText === '上传肖像图'
      && faceRow0.clearText === '清空肖像图' && faceRow0.name === '未选择'
      && faceRow0.clearDisabled === true,
      JSON.stringify(faceRow0));
    ok('没有肖像图时「自定义图片」禁用、默认停在「封面」',
      facePill0 && facePill0.disabled === true
      && (await app.eval(`foliaModeTuning('monet').portraitSource`)) === 'cover',
      JSON.stringify(facePill0));

    await app.eval(FEED_FILE('portrait', 'me.png', 'image/png'));
    await sleep(600);
    const faceRow1 = await app.eval(ASSET_ROW('portrait'));
    const faceState1 = await app.eval(`(function(){
      var stored = null;
      try { stored = JSON.parse(localStorage.getItem('mineradio-folia-tuning-v1')); } catch (_) {}
      var bucket = stored && stored.monet ? stored.monet.portraitSource : null;
      return { tuning: foliaModeTuning('monet').portraitSource, stored: bucket,
        name: window.foliaAssetName('portrait') };
    })()`);
    ok('上传肖像：文件名回显 + 来源切「自定义」并落盘',
      faceRow1 && faceRow1.name === 'me.png' && faceState1.tuning === 'custom'
      && faceState1.stored === 'custom' && faceState1.name === 'me.png',
      JSON.stringify({ row: faceRow1 && faceRow1.name, state: faceState1 }));

    /* ---- C. 画面：肖像真的换成 blob: 图 ---- */
    const portraitVisual = await app.eval(MONET_PORTRAIT);
    ok('莫奈画面用上了上传的肖像：portraitSrc 是 blob: 且挂上 img',
      portraitVisual && !portraitVisual.__missing && portraitVisual.isBlob === true
      && portraitVisual.tuning === 'custom'
      && String(portraitVisual.imgSrc).indexOf('blob:') === 0,
      JSON.stringify(portraitVisual));

    await app.eval(`(function(){
      document.querySelector('#fx-folia-tuning [data-folia-asset-clear="portrait"]').click();
      return 1;
    })()`);
    await sleep(700);
    const faceAfter = await app.eval(`(function(){
      var stored = null;
      try { stored = JSON.parse(localStorage.getItem('mineradio-folia-tuning-v1')); } catch (_) {}
      return {
        row: (function(){ var n = document.querySelector('#fx-folia-tuning [data-folia-asset-name="portrait"]'); return n ? n.textContent : null; })(),
        tuning: foliaModeTuning('monet').portraitSource,
        stored: stored && stored.monet ? stored.monet.portraitSource : null,
        count: window.foliaAssetCount('portrait')
      };
    })()`);
    const portraitVisual2 = await app.eval(MONET_PORTRAIT);
    ok('清空肖像：来源退回「封面」并落盘、池归零、画面回到封面图',
      faceAfter.tuning === 'cover' && faceAfter.stored === 'cover' && faceAfter.count === 0
      && faceAfter.row === '未选择' && portraitVisual2 && portraitVisual2.isBlob === false,
      JSON.stringify({ state: faceAfter, visual: portraitVisual2 }));

    const errs = await app.errors();
    ok('无未捕获错误', !errs || errs.length === 0, JSON.stringify(errs));

    const failed = out.filter((l) => l.startsWith('FAIL'));
    console.log('\n' + (failed.length
      ? ('FAILED ' + failed.length + ' / ' + out.length)
      : ('ALL PASS (' + out.length + ' 项)')));
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.error('SMOKE ERROR', e && e.message);
    process.exitCode = 1;
  } finally {
    /* 收尾：池清空 + 两套调参复位 + 退世界。残留一张图会打红后面的面板冒烟。 */
    try {
      await app.eval(`(async function(){
        try { await window.foliaAssetReset(); } catch (_) {}
        try { foliaWorldExit({ silent: true }); } catch (_) {}
        try {
          if (typeof foliaModeResetTuning === 'function') foliaModeResetTuning('monet');
          if (typeof foliaMonetResetTuning === 'function') foliaMonetResetTuning();
          if (typeof foliaNomandResetTuning === 'function') foliaNomandResetTuning();
          localStorage.removeItem('mineradio-folia-tuning-v1');
          localStorage.removeItem('mineradio-folia-monet-tuning-v1');
          localStorage.removeItem('mineradio-folia-nomand-tuning-v1');
        } catch (_) {}
        foliaWorld.mode = 'classic';
        foliaWorld.background = 'none';
        if (typeof saveFoliaWorldPrefs === 'function') saveFoliaWorldPrefs();
        return 1;
      })()`);
    } catch (_) {}
    try { await app.close(); } catch (_) {}
  }
})();
