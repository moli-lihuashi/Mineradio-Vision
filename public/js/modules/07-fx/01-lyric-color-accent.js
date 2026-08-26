function buildLyricColorControls() {
  var grid = document.getElementById('lyric-color-grid');
  if (!grid) return;
  var html = '<button class="lyric-swatch auto" type="button" data-auto="1" onclick="setLyricColorAuto()" title="封面取色">AUTO</button>';
  html += lyricColorPresets.map(function(p, i){
    return '<button class="lyric-swatch" type="button" data-color="' + p.color + '" onclick="setLyricColorPreset(' + i + ')" title="' + escAttr(p.name) + '" style="--swatch:' + p.color + '"></button>';
  }).join('');
  grid.innerHTML = html;
}
function updateLyricColorControls() {
  var picker = document.getElementById('lyric-color-picker');
  var value = document.getElementById('lyric-color-value');
  var autoBtn = document.getElementById('lyric-auto-btn');
  var color = normalizeHexColor(fx.lyricColor);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.lyricColorMode === 'custom' ? color.toUpperCase() : '封面取色';
  if (autoBtn) autoBtn.classList.toggle('active', fx.lyricColorMode !== 'custom');
  document.querySelectorAll('.lyric-swatch').forEach(function(btn){
    var isAuto = btn.dataset.auto === '1';
    var isColor = normalizeHexColor(btn.dataset.color || '') === color;
    btn.classList.toggle('active', isAuto ? fx.lyricColorMode !== 'custom' : (fx.lyricColorMode === 'custom' && isColor));
  });
}
function updateLyricHighlightControls() {
  var picker = document.getElementById('lyric-highlight-picker');
  var value = document.getElementById('lyric-highlight-value');
  var autoBtn = document.getElementById('lyric-highlight-auto-btn');
  var color = normalizeHexColor(fx.lyricHighlightColor);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.lyricHighlightMode === 'custom' ? color.toUpperCase() : '跟随歌词';
  if (autoBtn) autoBtn.classList.toggle('active', fx.lyricHighlightMode !== 'custom');
}
function updateLyricGlowControls() {
  var row = document.getElementById('lyric-glow-row');
  var picker = document.getElementById('lyric-glow-picker');
  var value = document.getElementById('lyric-glow-value');
  var linkBtn = document.getElementById('lyric-glow-link-btn');
  var linked = fx.lyricGlowLinked !== false;
  var color = normalizeHexColor(fx.lyricGlowColor || '#9db8cf');
  if (picker) picker.value = color;
  if (row) row.classList.toggle('linked', linked);
  if (value) value.textContent = linked ? '跟随高亮' : color.toUpperCase();
  if (linkBtn) {
    linkBtn.classList.toggle('active', linked);
    linkBtn.textContent = linked ? '链接' : '独立';
    linkBtn.title = linked ? '点击后单独设置溢光颜色' : '点击后让溢光跟随高亮';
  }
}
function applyHomeAccentColor() {
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var rgb = hexToRgb(color);
  document.documentElement.style.setProperty('--home-accent', color);
  document.documentElement.style.setProperty('--home-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
}
function updateHomeAccentControls() {
  applyHomeAccentColor();
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var picker = document.getElementById('home-accent-picker');
  var value = document.getElementById('home-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function setHomeAccentColor(color, silent) {
  fx.homeAccentColor = normalizeHexColor(color || '#00f5d4');
  updateHomeAccentControls();
  saveLyricLayout();
  if (!silent) showToast('Home 填充: ' + fx.homeAccentColor.toUpperCase());
}
function resetHomeAccentColor() {
  setHomeAccentColor(fxDefaults.homeAccentColor || '#00f5d4');
}
function applyIconAccentColors() {
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homeRgb = hexToRgb(homeColor);
  var visualRgb = hexToRgb(visualColor);
  var root = document.documentElement;
  root.style.setProperty('--home-icon-color', homeColor);
  root.style.setProperty('--home-icon-rgb', homeRgb.r + ',' + homeRgb.g + ',' + homeRgb.b);
  root.style.setProperty('--visual-icon-color', visualColor);
  root.style.setProperty('--visual-icon-rgb', visualRgb.r + ',' + visualRgb.g + ',' + visualRgb.b);
}
function updateIconAccentControls() {
  applyIconAccentColors();
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homePicker = document.getElementById('home-icon-picker');
  var homeValue = document.getElementById('home-icon-value');
  var visualPicker = document.getElementById('visual-icon-picker');
  var visualValue = document.getElementById('visual-icon-value');
  if (homePicker) homePicker.value = homeColor;
  if (homeValue) homeValue.textContent = homeColor.toUpperCase();
  if (visualPicker) visualPicker.value = visualColor;
  if (visualValue) visualValue.textContent = visualColor.toUpperCase();
}
function setHomeIconColor(color, silent) {
  fx.homeIconColor = normalizeHexColor(color || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  updateIconAccentControls();
  saveLyricLayout();
  if (!silent) showToast('主页图标: ' + fx.homeIconColor.toUpperCase());
}
function resetHomeIconColor() {
  setHomeIconColor(fxDefaults.homeIconColor || '#f4d28a');
}
function setVisualIconColor(color, silent) {
  fx.visualIconColor = normalizeHexColor(color || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  updateIconAccentControls();
  saveLyricLayout();
  if (!silent) showToast('视觉图标: ' + fx.visualIconColor.toUpperCase());
}
function resetVisualIconColor() {
  setVisualIconColor(fxDefaults.visualIconColor || '#7fd8ff');
}
function applyCustomBackground() {
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var albumMode = typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover();
  var media = typeof customBackgroundActiveMedia === 'function' ? customBackgroundActiveMedia() : normalizeCustomBackgroundMedia(fx.backgroundMedia || fx.backgroundImage);
  var image = media && media.type === 'image' ? media.src : '';
  var hasVideo = !!(media && media.type === 'video');
  var opacity = clampRange(fx.backgroundOpacity == null ? 1 : Number(fx.backgroundOpacity), 0, 1);
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  var override = albumMode || !!media || customColor || opacity < 1;
  var root = document.documentElement;
  var layer = document.getElementById('custom-bg');
  var video = document.getElementById('custom-bg-video');
  root.style.setProperty('--custom-bg-color', color);
  document.body.classList.toggle('custom-background-override', override);
  document.body.classList.toggle('custom-background-flat', override && !media);
  document.body.classList.toggle('custom-background-album-cover', albumMode);
  document.body.classList.toggle('custom-background-video', hasVideo);
  if (layer) {
    layer.style.setProperty('--custom-bg-image', image ? 'url("' + cssImageUrl(image) + '")' : 'none');
    layer.style.setProperty('--custom-bg-image-opacity', image ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-video-opacity', hasVideo ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-overlay-opacity', media ? '0.18' : '0');
  }
  var token = ++customBgApplyToken;
  if (!video) return;
  if (!hasVideo) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (customBgObjectUrl) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    return;
  }
  function setVideoSrc(src) {
    if (token !== customBgApplyToken || !src) return;
    if (customBgObjectUrl && customBgObjectUrl !== src) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      video.load();
    }
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    var p = video.play();
    if (p && p.catch) p.catch(function(){});
  }
  if (media.src) {
    setVideoSrc(media.src);
  } else if (media.id) {
    getCustomBackgroundBlob(media.id).then(function(blob){
      if (token !== customBgApplyToken || !blob) return;
      if (customBgObjectUrl) URL.revokeObjectURL(customBgObjectUrl);
      customBgObjectUrl = URL.createObjectURL(blob);
      setVideoSrc(customBgObjectUrl);
    }).catch(function(err){ console.warn('background video load failed:', err); });
  }
}
function updateCustomBackgroundControls() {
  applyCustomBackground();
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var picker = document.getElementById('bg-color-picker');
  var value = document.getElementById('bg-color-value');
  var imageValue = document.getElementById('bg-image-value');
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  if (picker) picker.value = color;
  if (value) value.textContent = customColor ? color.toUpperCase() : '\u5c01\u9762\u6e10\u53d8';
  if (picker && picker.closest) {
    var row = picker.closest('.lyric-color-row');
    if (row) row.classList.toggle('bg-cover-mode', !customColor);
  }
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  if (imageValue) imageValue.textContent = customBackgroundMediaLabel(fx.backgroundMedia || fx.backgroundImage);
  applyBackgroundMediaHint();
}
function setCustomBackgroundColor(color, silent, customFlag) {
  fx.backgroundColor = normalizeHexColor(color || '#000000', '#000000');
  fx.backgroundColorMode = customFlag === false ? 'cover' : 'custom';
  fx.backgroundColorCustom = customFlag !== false;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast('背景颜色: ' + fx.backgroundColor.toUpperCase());
}
function setCustomBackgroundCoverMode(silent) {
  fx.backgroundColorMode = 'cover';
  fx.backgroundColorCustom = false;
  fx.backgroundColor = normalizeHexColor(fx.backgroundColor || fxDefaults.backgroundColor || '#000000', '#000000');
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast('\u80cc\u666f\u989c\u8272: \u5c01\u9762\u6e10\u53d8');
}
function resetCustomBackgroundColor() {
  setCustomBackgroundCoverMode(false);
}
function setCustomBackgroundOpacity(value, silent) {
  fx.backgroundOpacity = clampRange(Number(value), 0, 1);
  fx.backgroundColorMode = 'custom';
  fx.backgroundColorCustom = true;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast('背景透明度: ' + Math.round(fx.backgroundOpacity * 100) + '%');
}
function setCustomBackgroundImage(src, silent) {
  var image = normalizeCustomBackgroundImage(src);
  fx.backgroundImage = image;
  fx.backgroundMedia = image ? { type: 'image', src: image } : null;
  fx.backgroundAlbumCover = false;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast(fx.backgroundImage ? '背景图片已应用' : '背景图片已清除');
}
function clearCustomBackgroundImage() {
  setCustomBackgroundImage('');
}
function setCustomBackgroundMedia(media, silent) {
  media = normalizeCustomBackgroundMedia(media);
  fx.backgroundMedia = media;
  fx.backgroundImage = media && media.type === 'image' ? media.src : '';
  fx.backgroundAlbumCover = false;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast(media ? (media.type === 'video' ? '背景视频已应用' : '背景图片已应用') : '背景媒体已清除');
}
function readBackgroundImageFile(file) {
  if (!file || !/^image\//i.test(file.type || '')) {
    showToast('请选择图片文件');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxSide = 2200;
      var iw = img.naturalWidth || img.width || 1;
      var ih = img.naturalHeight || img.height || 1;
      var scale = Math.min(1, maxSide / Math.max(iw, ih));
      var w = Math.max(1, Math.round(iw * scale));
      var h = Math.max(1, Math.round(ih * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      var out = '';
      try { out = cv.toDataURL('image/webp', 0.84); } catch (err) {}
      if (!/^data:image\/webp/i.test(out)) {
        try { out = cv.toDataURL('image/jpeg', 0.86); } catch (err2) { out = String(e.target.result || ''); }
      }
      setCustomBackgroundImage(out);
    };
    img.onerror = function(){ showToast('背景图片读取失败'); };
    img.src = e.target.result;
  };
  reader.onerror = function(){ showToast('背景图片读取失败'); };
  reader.readAsDataURL(file);
}
function readBackgroundVideoFile(file) {
  if (!file || !/^video\//i.test(file.type || '')) {
    showToast('请选择视频文件');
    return;
  }
  var id = 'bg-video-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  putCustomBackgroundBlob(id, file, { name: file.name || '', mime: file.type || '', size: file.size || 0 }).then(function(){
    setCustomBackgroundMedia({ type: 'video', id: id, name: file.name || '', mime: file.type || '', size: file.size || 0 });
  }).catch(function(err){
    console.warn('background video store failed:', err);
    if ((file.size || 0) > 18 * 1024 * 1024) {
      showToast('视频较大，当前环境无法保存，请换小一点的视频');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e){
      setCustomBackgroundMedia({ type: 'video', src: String(e.target.result || ''), name: file.name || '', mime: file.type || '', size: file.size || 0 });
    };
    reader.onerror = function(){ showToast('背景视频读取失败'); };
    reader.readAsDataURL(file);
  });
}
function readBackgroundMediaFile(file) {
  if (!file) return;
  if (/^image\//i.test(file.type || '')) readBackgroundImageFile(file);
  else if (/^video\//i.test(file.type || '')) readBackgroundVideoFile(file);
  else showToast('请选择图片或视频文件');
}
function applyUiAccentColor() {
  var color = normalizeHexColor(fx.uiAccentColor || '#00f5d4', '#00f5d4');
  var rgb = hexToRgb(color);
  var root = document.documentElement;
  root.style.setProperty('--fc-accent', color);
  root.style.setProperty('--fc-accent-hov', color);
  root.style.setProperty('--fc-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
  root.style.setProperty('--glass-border', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.30)');
  root.style.setProperty('--glass-shadow-focus', '0 24px 72px rgba(0,0,0,.34),0 0 0 1px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.13),0 0 42px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.075),inset 0 1px 0 rgba(255,255,255,.20)');
}
function updateUiAccentControls() {
  applyUiAccentColor();
  var color = normalizeHexColor(fx.uiAccentColor || '#00f5d4', '#00f5d4');
  var picker = document.getElementById('ui-accent-picker');
  var value = document.getElementById('ui-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function setUiAccentColor(color, silent) {
  fx.uiAccentColor = normalizeHexColor(color || '#00f5d4', '#00f5d4');
  updateUiAccentControls();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout();
  if (!silent) showToast('界面高亮: ' + fx.uiAccentColor.toUpperCase());
}
function resetUiAccentColor() {
  setUiAccentColor(fxDefaults.uiAccentColor || '#00f5d4');
}
function updateVisualTintControls() {
  var picker = document.getElementById('visual-tint-picker');
  var value = document.getElementById('visual-tint-value');
  var autoBtn = document.getElementById('visual-tint-auto-btn');
  var color = normalizeHexColor(fx.visualTintColor || '#9db8cf');
  document.documentElement.style.setProperty('--visual-tint', color);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.visualTintMode === 'custom' ? color.toUpperCase() : '封面取色';
  if (autoBtn) autoBtn.classList.toggle('active', fx.visualTintMode !== 'custom');
}
function setVisualTintAuto() {
  fx.visualTintMode = 'auto';
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  showToast('视觉主色: 封面取色');
}
function resetVisualTintColor() {
  fx.visualTintMode = 'auto';
  fx.visualTintColor = normalizeHexColor(fxDefaults.visualTintColor || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  showToast('视觉主色已恢复默认');
}
function setVisualTintCustom(color, silent) {
  fx.visualTintMode = 'custom';
  fx.visualTintColor = normalizeHexColor(color || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  if (!silent) showToast('视觉主色: ' + fx.visualTintColor.toUpperCase());
}
function updateRippleColorControls() {
  var sel = document.getElementById('fx-ripplecolor');
  if (!sel) return;
  if (fx.rippleColorMode === 'auto') {
    sel.value = 'auto';
  } else {
    var color = normalizeHexColor(fx.rippleColor || '#9db8cf');
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value.toLowerCase() === color.toLowerCase()) {
        sel.value = sel.options[i].value;
        found = true;
        break;
      }
    }
    if (!found) sel.value = 'auto';
  }
}
function setRippleColorTheme(val) {
  if (val === 'auto') {
    fx.rippleColorMode = 'auto';
    showToast('涟漪颜色: 封面取色');
  } else {
    fx.rippleColorMode = 'custom';
    fx.rippleColor = normalizeHexColor(val);
    showToast('涟漪颜色: ' + fx.rippleColor.toUpperCase());
  }
  updateRippleColorControls();
  syncFxUniforms();
  saveLyricLayout();
}
function resetRippleColor() {
  fx.rippleColorMode = 'auto';
  fx.rippleColor = normalizeHexColor(fxDefaults.rippleColor || '#9db8cf');
  updateRippleColorControls();
  syncFxUniforms();
  saveLyricLayout();
  showToast('涟漪颜色已恢复默认');
}
function resetRippleParams() {
  fx.rippleSpeed = fxDefaults.rippleSpeed;
  fx.rippleDensity = fxDefaults.rippleDensity;
  fx.rippleBrightness = fxDefaults.rippleBrightness;
  fx.rippleWidth = fxDefaults.rippleWidth;
  fx.rippleRange = fxDefaults.rippleRange;
  setRange('fx-ripplespeed', fx.rippleSpeed);
  setRange('fx-rippledensity', fx.rippleDensity);
  setRange('fx-ripplebright', fx.rippleBrightness);
  setRange('fx-ripplewidth', fx.rippleWidth);
  setRange('fx-ripplerange', fx.rippleRange);
  syncFxUniforms();
  saveLyricLayout();
  showToast('涟漪参数已恢复默认');
}
var coverColorPickerState = { target: 'visualTint', canvas: null };
function currentCoverPickerCanvas() {
  if (coverPickerCanvas && coverPickerCanvas.getContext) return coverPickerCanvas;
  if (coverTex && coverTex.image && coverTex.image.getContext) return coverTex.image;
  return null;
}
function coverPickerSwatchColors() {
  var pal = stageLyrics.coverPalette || stageLyrics.palette || {};
  var list = [pal.primary, pal.secondary, pal.highlight, fx.visualTintColor, fx.uiAccentColor, fx.homeAccentColor]
    .map(function(c){ return normalizeHexColor(c || '', ''); })
    .filter(function(c){ return /^#[0-9a-f]{6}$/i.test(c); });
  var seen = {};
  return list.filter(function(c){
    if (seen[c]) return false;
    seen[c] = true;
    return true;
  }).slice(0, 5);
}
function setCoverPickerPreview(hex) {
  var preview = document.getElementById('cover-color-preview');
  if (preview) preview.style.setProperty('--picked', normalizeHexColor(hex || '#9db8cf'));
}
function renderCoverPickerSwatches() {
  var wrap = document.getElementById('cover-color-swatches');
  if (!wrap) return;
  var colors = coverPickerSwatchColors();
  wrap.innerHTML = colors.map(function(c){
    return '<button type="button" style="--c:' + c + '" title="' + c.toUpperCase() + '" onclick="applyCoverPickerColor(\'' + c + '\')"></button>';
  }).join('');
}
function openCoverColorPicker(target) {
  target = target || 'visualTint';
  var pop = document.getElementById('cover-color-pop');
  var art = document.getElementById('cover-color-art');
  var hint = document.getElementById('cover-color-hint');
  if (pop && pop.classList.contains('show') && coverColorPickerState.target === target) {
    closeCoverColorPicker();
    return;
  }
  var cv = currentCoverPickerCanvas();
  coverColorPickerState.target = target;
  coverColorPickerState.canvas = cv;
  if (!pop || !art) return;
  if (!cv) {
    setVisualTintAuto();
    closeCoverColorPicker();
    showToast('暂无封面，已切换为自动封面取色');
    return;
  }
  var imgSrc = '';
  try { imgSrc = cv.toDataURL('image/jpeg', 0.84); } catch (e) {}
  if (!imgSrc && currentCoverSource && currentCoverSource.src) imgSrc = currentCoverSource.src;
  art.style.backgroundImage = imgSrc ? 'url("' + cssImageUrl(imgSrc) + '")' : '';
  setCoverPickerPreview(fx.visualTintColor || (stageLyrics.coverPalette && stageLyrics.coverPalette.primary) || '#9db8cf');
  renderCoverPickerSwatches();
  if (hint) hint.textContent = '点击专辑封面任意位置取色，或使用下方推荐色。';
  pop.classList.add('show');
  placeFxFloatingPanel(pop, document.getElementById('visual-tint-auto-btn') || document.getElementById('visual-tint-picker') || art, { gap: 12, pad: 14 });
}
function closeCoverColorPicker() {
  var pop = document.getElementById('cover-color-pop');
  if (pop) pop.classList.remove('show');
  hideCoverColorLoupe();
}
function applyCoverPickerColor(hex) {
  hex = normalizeHexColor(hex || '#9db8cf');
  setCoverPickerPreview(hex);
  if (coverColorPickerState.target === 'visualTint') {
    setVisualTintCustom(hex, true);
    showToast('视觉主色: ' + hex.toUpperCase());
  }
  closeCoverColorPicker();
}
function moveCoverColorLoupe(e) {
  var cv = coverColorPickerState.canvas || currentCoverPickerCanvas();
  var loupe = document.getElementById('cover-color-loupe');
  var art = document.getElementById('cover-color-art');
  if (!cv || !loupe || !art) return;
  var rect = art.getBoundingClientRect();
  var x = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  var y = clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var imgSrc = '';
  try { imgSrc = cv.toDataURL('image/jpeg', 0.84); } catch (err) {}
  if (imgSrc) {
    loupe.style.backgroundImage = 'url("' + cssImageUrl(imgSrc) + '")';
    loupe.style.backgroundSize = '680% 680%';
    loupe.style.backgroundPosition = (x * 100).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%';
  }
  loupe.style.left = Math.min(window.innerWidth - 128, e.clientX + 18) + 'px';
  loupe.style.top = Math.min(window.innerHeight - 128, e.clientY + 18) + 'px';
  loupe.classList.add('show');
}
function hideCoverColorLoupe() {
  var loupe = document.getElementById('cover-color-loupe');
  if (loupe) loupe.classList.remove('show');
}
function pickCoverColorFromArt(e) {
  var cv = coverColorPickerState.canvas || currentCoverPickerCanvas();
  if (!cv || !cv.getContext) return;
  var rect = e.currentTarget.getBoundingClientRect();
  var x = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  var y = clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var sx = Math.max(0, Math.min(cv.width - 1, Math.floor(x * cv.width)));
  var sy = Math.max(0, Math.min(cv.height - 1, Math.floor(y * cv.height)));
  try {
    var data = cv.getContext('2d').getImageData(sx, sy, 1, 1).data;
    applyCoverPickerColor(rgbToHexColor(data[0], data[1], data[2]));
  } catch (err) {
    showToast('封面取色不可用，已保留自动取色');
    setVisualTintAuto();
    closeCoverColorPicker();
  }
}
function updateLyricFontControls() {
  var normalized = normalizeLyricFontKey(fx.lyricFont);
  document.querySelectorAll('#lyric-font-grid button').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.font === normalized);
  });
  renderCustomLyricFontButtons();
}
function renderCustomLyricFontButtons() {
  var container = document.getElementById('fx-custom-font-list');
  if (!container) return;
  container.innerHTML = '';
  var normalized = normalizeLyricFontKey(fx.lyricFont);
  (customLyricFonts || []).forEach(function(record) {
    var key = 'custom:' + record.id;
    var item = document.createElement('div');
    item.className = 'fx-custom-font-item' + (key === normalized ? ' active' : '');
    item.title = record.name + ' (点击应用，× 删除)';
    item.style.fontFamily = lyricFontStackForKey(key);
    var label = document.createElement('span');
    label.textContent = record.name;
    item.appendChild(label);
    item.addEventListener('click', function(e) {
      if (e.target && e.target.classList && e.target.classList.contains('fx-custom-font-remove')) return;
      setLyricFont(key);
    });
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fx-custom-font-remove';
    remove.textContent = '×';
    remove.title = '删除 ' + record.name;
    remove.addEventListener('click', function(e) {
      e.stopPropagation();
      if (confirm('删除自定义字体「' + record.name + '」？')) {
        removeCustomLyricFont(record.id);
        renderCustomLyricFontButtons();
        if (typeof refreshCurrentLyricStyle === 'function') refreshCurrentLyricStyle();
      }
    });
    item.appendChild(remove);
    container.appendChild(item);
  });
}
function handleCustomLyricFontFileChange(input) {
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  if (customLyricFonts.length >= CUSTOM_LYRIC_FONT_MAX_COUNT) {
    showToast('自定义字体已达上限 ' + CUSTOM_LYRIC_FONT_MAX_COUNT + ' 个');
    input.value = '';
    return;
  }
  showToast('正在加载字体: ' + (file.name || ''));
  addCustomLyricFontFromFile(file).then(function(record) {
    showToast('字体已添加: ' + record.name);
    renderCustomLyricFontButtons();
    setLyricFont('custom:' + record.id);
  }).catch(function(err) {
    showToast('字体加载失败: ' + (err && err.message || '未知错误'));
  });
  input.value = '';
}
function setLyricFont(key) {
  fx.lyricFont = normalizeLyricFontKey(key);
  updateLyricFontControls();
  try {
    if (typeof refreshCurrentLyricStyle === 'function') refreshCurrentLyricStyle();
  } catch (err) {
    console.warn('[preset] refreshCurrentLyricStyle after font change failed:', err);
  }
  saveLyricLayout();
  try { pushDesktopLyricsState(true); } catch (_) {}
  showToast('歌词字体已切换');
}
function setLyricGlowLinked(linked, openPicker) {
  fx.lyricGlowLinked = linked !== false;
  if (!fx.lyricGlowLinked) fx.lyricGlowColor = normalizeHexColor(fx.lyricGlowColor || fx.lyricHighlightColor || '#9db8cf');
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricGlowControls();
  saveLyricLayout();
  if (openPicker) {
    setTimeout(function(){
      var picker = document.getElementById('lyric-glow-picker');
      if (picker) picker.click();
    }, 0);
  }
}
function toggleLyricGlowLink(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  setLyricGlowLinked(fx.lyricGlowLinked === false);
}
function handleLyricGlowRowClick(e) {
  if (fx.lyricGlowLinked !== false) {
    if (e && e.preventDefault) e.preventDefault();
    setLyricGlowLinked(false, true);
  }
}
function setLyricGlowCustom(color, silent) {
  fx.lyricGlowLinked = false;
  fx.lyricGlowColor = normalizeHexColor(color || '#9db8cf');
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('溢光颜色: ' + fx.lyricGlowColor.toUpperCase());
}
function setLyricColorAuto() {
  fx.lyricColorMode = 'auto';
  setStageLyricPalette(stageLyrics.coverPalette || stageLyrics.palette);
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  showToast('歌词颜色: 封面取色');
}
function setLyricColorCustom(color, silent) {
  fx.lyricColorMode = 'custom';
  fx.lyricColor = normalizeHexColor(color);
  setStageLyricPalette(lyricPaletteFromHex(fx.lyricColor));
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('歌词颜色: ' + fx.lyricColor.toUpperCase());
}
function setLyricColorPreset(i) {
  var p = lyricColorPresets[i];
  if (!p) return;
  setLyricColorCustom(p.color);
}
function setLyricHighlightAuto() {
  fx.lyricHighlightMode = 'auto';
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  showToast('高亮颜色: 跟随歌词');
}
function setLyricHighlightCustom(color, silent) {
  fx.lyricHighlightMode = 'custom';
  fx.lyricHighlightColor = normalizeHexColor(color);
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('高亮颜色: ' + fx.lyricHighlightColor.toUpperCase());
}
