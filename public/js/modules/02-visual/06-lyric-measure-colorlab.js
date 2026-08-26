/* ===== 歌词文本测量缓存 (避免每帧 measureText) ===== */
var lyricTextMeasureCache = { fonts: {}, order: [], maxFonts: 64, maxCharsPerFont: 512 };
function clearLyricTextMeasureCache() {
  lyricTextMeasureCache = { fonts: {}, order: [], maxFonts: 64, maxCharsPerFont: 512 };
}
function lyricTextMeasureFontCache(ctx) {
  var key = String(ctx && ctx.font || '');
  var cache = lyricTextMeasureCache.fonts[key];
  if (cache) return cache;
  while (lyricTextMeasureCache.order.length >= lyricTextMeasureCache.maxFonts) {
    delete lyricTextMeasureCache.fonts[lyricTextMeasureCache.order.shift()];
  }
  cache = { values: {}, order: [] };
  lyricTextMeasureCache.fonts[key] = cache;
  lyricTextMeasureCache.order.push(key);
  return cache;
}
function lyricMeasuredCharacterWidth(ctx, character) {
  character = String(character || '');
  var cache = lyricTextMeasureFontCache(ctx);
  if (Object.prototype.hasOwnProperty.call(cache.values, character)) return cache.values[character];
  while (cache.order.length >= lyricTextMeasureCache.maxCharsPerFont) delete cache.values[cache.order.shift()];
  var width = ctx.measureText(character).width;
  cache.values[character] = width;
  cache.order.push(character);
  return width;
}
var lyricTextMeasureWarmupTimer = 0;
function warmLyricTextMeasureCache() {
  lyricTextMeasureWarmupTimer = 0;
  if (typeof document === 'undefined') return;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = lyricFontCss(128);
  measureTextWithLetterSpacing(ctx, '歌词 Lyrics 0123456789', lyricLetterSpacingPx(128));
}
function scheduleLyricTextMeasureWarmup(delay) {
  if (lyricTextMeasureWarmupTimer) clearTimeout(lyricTextMeasureWarmupTimer);
  var run = warmLyricTextMeasureCache;
  delay = Math.max(0, Number(delay) || 0);
  lyricTextMeasureWarmupTimer = setTimeout(function () {
    lyricTextMeasureWarmupTimer = 0;
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
    else run();
  }, delay);
}
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', function () {
    clearLyricTextMeasureCache();
    scheduleLyricTextMeasureWarmup(0);
  });
}
function normalizeLyricFontKey(value) {
  value = String(value || 'sans');
  if (builtinLyricFontKeyPattern().test(value)) return value;
  if (customLyricFontRecordForKey(value)) return value;
  return 'sans';
}
function lyricFontStackForKey(key) {
  key = normalizeLyricFontKey(key);
  var customFont = customLyricFontRecordForKey(key);
  if (customFont) return quotedCssFontFamily(customFont.family) + ',"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
  if (key === 'hei') return '"Noto Sans SC","Microsoft YaHei",SimHei,"PingFang SC",sans-serif';
  if (key === 'song') return '"Noto Serif SC","Source Han Serif SC",SimSun,"Songti SC",serif';
  if (key === 'bold-song') return '"Source Han Serif SC Heavy","Source Han Serif SC","Noto Serif SC Black","Noto Serif SC","STZhongsong","SimSun",serif';
  if (key === 'stone-song') return '"FZYaSongS-B-GB","FZCuSong-B09S","Source Han Serif SC Heavy","Noto Serif SC Black","STZhongsong","SimSun",serif';
  if (key === 'kai-song') return '"Kaiti SC","STKaiti","KaiTi","Source Han Serif SC","Noto Serif SC",serif';
  if (key === 'serif-en') return 'Georgia,"Times New Roman","Noto Serif SC","Source Han Serif SC",serif';
  if (key === 'gothic') return '"UnifrakturCook","UnifrakturMaguntia","Old English Text MT","Blackletter","Cinzel Decorative","Noto Serif SC",serif';
  if (key === 'editorial') return '"Didot","Bodoni 72","Libre Baskerville",Georgia,"Noto Serif SC",serif';
  if (key === 'humanist') return '"Avenir Next","Segoe UI","Inter","Noto Sans SC","PingFang SC",sans-serif';
  if (key === 'round') return '"HarmonyOS Sans SC","Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
  if (key === 'mono') return '"JetBrains Mono",Consolas,"Noto Sans SC","Microsoft YaHei",monospace';
  if (key === 'display') return '"Alibaba PuHuiTi","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
  return 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
}
function lyricFontWeightValue() {
  if (normalizeLyricFontKey(fx && fx.lyricFont) === 'stone-song') return 900;
  return Math.round(clampRange(Number(fx && fx.lyricWeight) || 900, 500, 900) / 50) * 50;
}
function lyricFontCss(fontSize, weight) {
  var w = weight == null ? lyricFontWeightValue() : Math.round(clampRange(Number(weight) || lyricFontWeightValue(), 500, 900) / 50) * 50;
  return w + ' ' + fontSize + 'px ' + lyricFontStackForKey(fx && fx.lyricFont);
}
function lyricMeasureTextAtSize(ctx, text, fontSize, weight) {
  var prevFont = ctx.font;
  ctx.font = lyricFontCss(fontSize, weight);
  var width = lyricMeasureText(ctx, text, fontSize);
  ctx.font = prevFont;
  return width;
}
function lyricLetterSpacingPx(fontSize) {
  return clampRange(Number(fx && fx.lyricLetterSpacing) || 0, -0.04, 0.18) * Math.max(1, fontSize || 1);
}
function lyricLineHeightFactor() {
  return clampRange(Number(fx && fx.lyricLineHeight) || 1, 0.86, 1.35);
}
function measureTextWithLetterSpacing(ctx, text, spacing) {
  text = String(text || '');
  spacing = Number(spacing) || 0;
  if (!spacing || text.length < 2) return ctx.measureText(text).width;
  var chars = Array.from(text);
  if ('fontKerning' in ctx && 'letterSpacing' in ctx) {
    var previousKerning = ctx.fontKerning;
    var previousLetterSpacing = ctx.letterSpacing;
    var probeSpacing = 0.001;
    try {
      ctx.fontKerning = 'none';
      ctx.letterSpacing = probeSpacing + 'px';
      var glyphWidth = ctx.measureText(text).width - probeSpacing * chars.length;
      if (isFinite(glyphWidth)) return Math.max(1, glyphWidth + spacing * (chars.length - 1));
    } finally {
      ctx.fontKerning = previousKerning;
      ctx.letterSpacing = previousLetterSpacing;
    }
  }
  var w = 0;
  for (var i = 0; i < chars.length; i++) {
    w += lyricMeasuredCharacterWidth(ctx, chars[i]);
    if (i < chars.length - 1) w += spacing;
  }
  return Math.max(1, w);
}
function lyricMeasureText(ctx, text, fontSize) {
  return measureTextWithLetterSpacing(ctx, text, lyricLetterSpacingPx(fontSize));
}
function drawTextWithLetterSpacing(ctx, text, x, y, spacing, stroke) {
  text = String(text || '');
  spacing = Number(spacing) || 0;
  if (!spacing || text.length < 2) {
    if (stroke) ctx.strokeText(text, x, y);
    else ctx.fillText(text, x, y);
    return;
  }
  var chars = Array.from(text);
  var align = ctx.textAlign || 'left';
  var width = measureTextWithLetterSpacing(ctx, text, spacing);
  var start = x;
  if (align === 'center') start = x - width / 2;
  else if (align === 'right' || align === 'end') start = x - width;
  ctx.textAlign = 'left';
  var cursor = start;
  for (var i = 0; i < chars.length; i++) {
    if (stroke) ctx.strokeText(chars[i], cursor, y);
    else ctx.fillText(chars[i], cursor, y);
    cursor += lyricMeasuredCharacterWidth(ctx, chars[i]) + (i < chars.length - 1 ? spacing : 0);
  }
  ctx.textAlign = align;
}
function lyricFillText(ctx, text, x, y, fontSize) {
  drawTextWithLetterSpacing(ctx, text, x, y, lyricLetterSpacingPx(fontSize), false);
}
function lyricStrokeText(ctx, text, x, y, fontSize) {
  drawTextWithLetterSpacing(ctx, text, x, y, lyricLetterSpacingPx(fontSize), true);
}
function applyStonePrintTexture(ctx, W, H, fontSize) {
  if (normalizeLyricFontKey(fx && fx.lyricFont) !== 'stone-song') return;
  var size = clampRange(fontSize || 128, 42, 180);
  var bandTop = H * 0.10;
  var bandH = H * 0.80;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  var noiseW = 300, noiseH = 110;
  var noise = document.createElement('canvas');
  noise.width = noiseW; noise.height = noiseH;
  var nctx = noise.getContext('2d');
  var img = nctx.createImageData(noiseW, noiseH);
  for (var p = 0; p < noiseW * noiseH; p++) {
    var x0 = p % noiseW;
    var y0 = Math.floor(p / noiseW);
    var vein = Math.sin(x0 * 0.19 + y0 * 0.043) * 0.10 + Math.sin(y0 * 0.31) * 0.06;
    var r = Math.random() + vein;
    var a = 0;
    if (r > 0.82) a = 78 + Math.random() * 92;
    else if (r > 0.62) a = 22 + Math.random() * 54;
    else if (r > 0.48) a = 4 + Math.random() * 24;
    img.data[p * 4] = 255;
    img.data[p * 4 + 1] = 255;
    img.data[p * 4 + 2] = 255;
    img.data[p * 4 + 3] = a;
  }
  nctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.34;
  ctx.drawImage(noise, 0, bandTop, W, bandH);

  var chips = Math.round(size * 7.2);
  for (var i = 0; i < chips; i++) {
    var x = Math.random() * W;
    var y = bandTop + Math.random() * bandH;
    var w = 0.7 + Math.random() * (size * 0.052);
    var h = 0.45 + Math.random() * (size * 0.026);
    ctx.globalAlpha = 0.16 + Math.random() * 0.36;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.38);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  ctx.lineCap = 'round';
  for (var s = 0; s < 44; s++) {
    var sx = Math.random() * W;
    var sy = bandTop + Math.random() * bandH;
    ctx.globalAlpha = 0.09 + Math.random() * 0.16;
    ctx.lineWidth = 0.45 + Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 10 + Math.random() * 86, sy + (Math.random() - 0.5) * 4.8);
    ctx.stroke();
  }

  for (var c = 0; c < 26; c++) {
    var cx = Math.random() * W;
    var cy = bandTop + Math.random() * bandH;
    var radius = 1.8 + Math.random() * (size * 0.060);
    ctx.globalAlpha = 0.08 + Math.random() * 0.18;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * (0.7 + Math.random() * 1.4), radius * (0.25 + Math.random() * 0.55), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function hexToRgb(hex) {
  hex = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}
function normalizeCustomBackgroundImage(value) {
  var src = String(value || '').trim();
  if (!src) return '';
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  return '';
}
function normalizeCustomBackgroundMedia(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    var img = normalizeCustomBackgroundImage(value);
    if (img) return { type: 'image', src: img };
    if (/^data:video\/(mp4|webm|quicktime);base64,/i.test(value) || /^https?:\/\//i.test(value)) return { type: 'video', src: String(value) };
    return null;
  }
  if (typeof value !== 'object') return null;
  var type = value.type === 'video' ? 'video' : (value.type === 'image' ? 'image' : '');
  if (type === 'image') {
    var imageSrc = normalizeCustomBackgroundImage(value.src || value.url || '');
    return imageSrc ? { type: 'image', src: imageSrc } : null;
  }
  if (type === 'video') {
    var src = String(value.src || '').trim();
    var id = String(value.id || '').trim();
    if (!id && !/^data:video\/(mp4|webm|quicktime);base64,/i.test(src) && !/^https?:\/\//i.test(src)) return null;
    return {
      type: 'video',
      id: id,
      src: src,
      name: String(value.name || '').slice(0, 120),
      mime: String(value.mime || '').slice(0, 80),
      size: Math.max(0, Number(value.size) || 0)
    };
  }
  return null;
}
function customBackgroundMediaLabel(media) {
  if (typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover()) return '封面原图';
  media = normalizeCustomBackgroundMedia(media);
  if (!media) return '未设置';
  return media.type === 'video' ? '视频已设置' : '图片已设置';
}
function customBackgroundUsesAlbumCover() {
  return typeof fx !== 'undefined' && !!(fx && fx.backgroundAlbumCover === true);
}
function customBackgroundAlbumCoverSource() {
  var src = '';
  try {
    if (typeof currentCoverSource !== 'undefined' && currentCoverSource && currentCoverSource.src) src = String(currentCoverSource.src || '');
  } catch (e) { }
  if (!src) {
    try {
      var thumb = document.getElementById('thumb-cover');
      src = thumb && (thumb.currentSrc || thumb.src || thumb.getAttribute('src')) || '';
    } catch (e2) { }
  }
  if (!src) {
    try {
      var song = Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
      if (song) src = typeof songCoverSrc === 'function' ? songCoverSrc(song, 640) : (song.customCover || song.cover || '');
    } catch (e3) { }
  }
  return src || '';
}
function customBackgroundActiveMedia() {
  var media = normalizeCustomBackgroundMedia(fx.backgroundMedia || fx.backgroundImage);
  if ((typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover()) || (media && media.type === 'album')) {
    var albumSrc = customBackgroundAlbumCoverSource();
    return albumSrc ? { type: 'image', src: albumSrc, album: true } : null;
  }
  return media;
}
function setCustomBackgroundAlbumCover(enabled, silent) {
  fx.backgroundAlbumCover = enabled === true;
  if (fx.backgroundAlbumCover) {
    fx.backgroundMedia = null;
    fx.backgroundImage = '';
  }
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast(fx.backgroundAlbumCover ? '背景媒体: 封面原图' : '背景媒体: 已关闭封面');
}
function toggleCustomBackgroundAlbumCover() {
  setCustomBackgroundAlbumCover(!customBackgroundUsesAlbumCover());
}
function openCustomBackgroundCropModal() {
  showToast('背景裁切功能开发中');
}
function openCustomBackgroundCropModalSoon() {
  setTimeout(function(){ openCustomBackgroundCropModal(); }, 80);
}
var CUSTOM_BG_DB_NAME = 'mineradio-custom-background-v1';
var CUSTOM_BG_STORE = 'media';
var customBgObjectUrl = '';
var customBgApplyToken = 0;
function openCustomBackgroundDb() {
  return new Promise(function(resolve, reject){
    if (!window.indexedDB) { reject(new Error('indexedDB unavailable')); return; }
    var req = indexedDB.open(CUSTOM_BG_DB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(CUSTOM_BG_STORE)) db.createObjectStore(CUSTOM_BG_STORE, { keyPath: 'id' });
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error || new Error('indexedDB open failed')); };
  });
}
async function putCustomBackgroundBlob(id, blob, meta) {
  var db = await openCustomBackgroundDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction(CUSTOM_BG_STORE, 'readwrite');
    tx.objectStore(CUSTOM_BG_STORE).put(Object.assign({ id: id, blob: blob, savedAt: Date.now() }, meta || {}));
    tx.oncomplete = function(){ db.close(); resolve(); };
    tx.onerror = function(){ db.close(); reject(tx.error || new Error('indexedDB put failed')); };
  });
}
async function getCustomBackgroundBlob(id) {
  var db = await openCustomBackgroundDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction(CUSTOM_BG_STORE, 'readonly');
    var req = tx.objectStore(CUSTOM_BG_STORE).get(id);
    req.onsuccess = function(){ resolve(req.result && req.result.blob ? req.result.blob : null); };
    req.onerror = function(){ reject(req.error || new Error('indexedDB get failed')); };
    tx.oncomplete = function(){ db.close(); };
  });
}
var colorLabState = { picker: null, id: '', h: 0, s: 1, v: 1, dragging: false };
var COLOR_LAB_PRESETS = [
  { name: '极黑', color: '#000000' },
  { name: '极白', color: '#ffffff' },
  { name: '克莱因蓝', color: '#002fa7' },
  { name: '法拉利红', color: '#f00000' },
  { name: '香槟金', color: '#c8a96a' },
  { name: '孔雀绿', color: '#006b5b' },
  { name: '午夜紫', color: '#2b164f' },
  { name: '银雾', color: '#d9dde2' }
];
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var d = max - min, h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h, s, v) {
  h = ((h % 1) + 1) % 1; s = clampRange(s, 0, 1); v = clampRange(v, 0, 1);
  var i = Math.floor(h * 6), f = h * 6 - i;
  var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  var r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return rgbToHexColor(r * 255, g * 255, b * 255);
}
function applyColorLabValue(hex, silent) {
  hex = normalizeHexColor(hex || '#000000', '#000000');
  var id = colorLabState.id;
  if (id === 'ui-accent-picker') setUiAccentColor(hex, true);
  else if (id === 'visual-tint-picker') setVisualTintCustom(hex, true);
  else if (id === 'ripple-color-picker') {
    fx.rippleColorMode = 'custom';
    fx.rippleColor = hex;
    updateRippleColorControls();
    syncFxUniforms();
  }
  else if (id === 'home-accent-picker') setHomeAccentColor(hex, true);
  else if (id === 'home-icon-picker') setHomeIconColor(hex, true);
  else if (id === 'visual-icon-picker') setVisualIconColor(hex, true);
  else if (id === 'bg-color-picker') setCustomBackgroundColor(hex, true, true);
  else if (id === 'shelf-accent-picker') setShelfAccentColor(hex, true);
  else if (id === 'lyric-color-picker') setLyricColorCustom(hex, true);
  else if (id === 'lyric-highlight-picker') setLyricHighlightCustom(hex, true);
  else if (id === 'lyric-glow-picker') setLyricGlowCustom(hex, true);
  if (!silent) showToast('颜色: ' + hex.toUpperCase());
}
function syncColorLabUi(hex) {
  hex = normalizeHexColor(hex || '#000000', '#000000');
  var rgb = hexToRgb(hex);
  var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  colorLabState.h = hsv.h; colorLabState.s = hsv.s; colorLabState.v = hsv.v;
  var pop = document.getElementById('color-lab-pop');
  var sv = document.getElementById('color-lab-sv');
  var cursor = document.getElementById('color-lab-cursor');
  var hue = document.getElementById('color-lab-hue');
  var hexInput = document.getElementById('color-lab-hex');
  var preview = document.getElementById('color-lab-preview');
  var hueHex = hsvToHex(colorLabState.h, 1, 1);
  if (pop) {
    pop.style.setProperty('--lab-color', hex);
    pop.style.setProperty('--lab-hue', hueHex);
  }
  if (sv) sv.style.setProperty('--lab-hue', hueHex);
  if (cursor) { cursor.style.left = (colorLabState.s * 100).toFixed(2) + '%'; cursor.style.top = ((1 - colorLabState.v) * 100).toFixed(2) + '%'; }
  if (hue) hue.value = Math.round(colorLabState.h * 360);
  if (hexInput) hexInput.value = hex.toUpperCase();
  if (preview) preview.style.setProperty('--lab-color', hex);
}
function closeColorLab() {
  var pop = document.getElementById('color-lab-pop');
  if (pop) pop.classList.remove('show');
  colorLabState.picker = null;
  colorLabState.id = '';
}
function placeFxFloatingPanel(pop, anchor, opts) {
  if (!pop || !anchor || !anchor.getBoundingClientRect) return;
  opts = opts || {};
  var gap = opts.gap == null ? 12 : opts.gap;
  var pad = opts.pad == null ? 14 : opts.pad;
  var rect = anchor.getBoundingClientRect();
  var vw = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320);
  var vh = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 320);
  var pw = Math.min(pop.offsetWidth || pop.getBoundingClientRect().width || 330, vw - pad * 2);
  var ph = Math.min(pop.offsetHeight || pop.getBoundingClientRect().height || 260, vh - pad * 2);
  var left;
  var top;
  if (vw < 760) {
    left = Math.max(pad, Math.min(vw - pw - pad, rect.left + rect.width / 2 - pw / 2));
    top = rect.bottom + gap;
    if (top + ph > vh - pad) top = Math.max(pad, rect.top - ph - gap);
  } else {
    var roomRight = vw - rect.right - pad;
    var roomLeft = rect.left - pad;
    if (roomRight >= pw + gap || roomRight >= roomLeft) left = rect.right + gap;
    else left = rect.left - pw - gap;
    left = Math.max(pad, Math.min(vw - pw - pad, left));
    top = rect.top + rect.height / 2 - ph / 2;
    top = Math.max(pad, Math.min(vh - ph - pad, top));
  }
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.style.transform = 'none';
}
function openColorLabForPicker(picker) {
  var pop = document.getElementById('color-lab-pop');
  if (!picker || !pop) return;
  if (pop.classList.contains('show') && colorLabState.picker === picker) {
    closeColorLab();
    return;
  }
  colorLabState.picker = picker;
  colorLabState.id = picker.id || '';
  var label = picker.closest('.lyric-color-row');
  var title = document.getElementById('color-lab-title');
  if (title) title.textContent = label ? (label.textContent || 'Color').replace(/#[0-9a-f]{6}/ig, '').trim().slice(0, 24) : 'Color';
  syncColorLabUi(picker.value || '#000000');
  var presets = document.getElementById('color-lab-presets');
  if (presets) {
    presets.innerHTML = COLOR_LAB_PRESETS.map(function(p){
      return '<button type="button" title="' + escAttr(p.name) + '" style="--c:' + p.color + '" data-color="' + p.color + '"></button>';
    }).join('');
  }
  pop.classList.add('show');
  var anchor = label || picker;
  var extraGap = (picker.id === 'ripple-color-picker') ? 70 : 0;
  placeFxFloatingPanel(pop, anchor, { gap: 12 + extraGap, pad: 14 });
}
function updateColorLabFromSv(e) {
  var sv = document.getElementById('color-lab-sv');
  if (!sv) return;
  var rect = sv.getBoundingClientRect();
  colorLabState.s = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  colorLabState.v = 1 - clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var hex = hsvToHex(colorLabState.h, colorLabState.s, colorLabState.v);
  syncColorLabUi(hex);
  applyColorLabValue(hex, true);
}
function bindColorLabPicker(picker) {
  if (!picker || picker._colorLabBound) return;
  picker._colorLabBound = true;
  picker.setAttribute('aria-haspopup', 'dialog');
  picker.setAttribute('data-color-lab-picker', '1');
  function openFromPickerEvent(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    picker._colorLabOpenedAt = Date.now();
    openColorLabForPicker(picker);
  }
  picker.addEventListener('pointerdown', openFromPickerEvent);
  picker.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); });
  picker.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - (picker._colorLabOpenedAt || 0) < 260) return;
    openColorLabForPicker(picker);
  });
  picker.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') openFromPickerEvent(e);
  });
}
function liftFxFloatingPopups() {
  ['cover-color-pop', 'color-lab-pop', 'cover-color-loupe'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  });
}
function bindColorLabRows() {
  document.querySelectorAll('.lyric-color-row').forEach(function(row){
    if (!row || row._colorLabRowBound || row.classList.contains('linked')) return;
    var picker = row.querySelector('.lyric-color-picker');
    if (!picker) return;
    row._colorLabRowBound = true;
    row.addEventListener('pointerdown', function(e){
      if (!e || !e.target) return;
      if (e.target.closest('button,.fx-mini-btn,input[type="range"],select,textarea')) return;
      e.preventDefault();
      e.stopPropagation();
      picker._colorLabOpenedAt = Date.now();
      openColorLabForPicker(picker);
    });
  });
}
function repositionFxFloatingPanels() {
  var colorPop = document.getElementById('color-lab-pop');
  if (colorPop && colorPop.classList.contains('show') && colorLabState.picker) {
    var picker = colorLabState.picker;
    var label = picker.closest('.lyric-color-row');
    var extraGap = (picker.id === 'ripple-color-picker') ? 70 : 0;
    placeFxFloatingPanel(colorPop, label || picker, { gap: 12 + extraGap, pad: 14 });
  }
  var coverPop = document.getElementById('cover-color-pop');
  if (coverPop && coverPop.classList.contains('show')) {
    placeFxFloatingPanel(coverPop, document.getElementById('visual-tint-auto-btn') || document.getElementById('visual-tint-picker') || coverPop, { gap: 12, pad: 14 });
  }
}
window.addEventListener('resize', debounce(function(){
  if (window.requestAnimationFrame) requestAnimationFrame(repositionFxFloatingPanels);
  else repositionFxFloatingPanels();
}, 100));
