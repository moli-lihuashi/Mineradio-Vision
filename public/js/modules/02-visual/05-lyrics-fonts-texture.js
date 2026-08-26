/* ===== 自定义歌词字体管理 ===== */
var CUSTOM_LYRIC_FONT_STORE_KEY = 'mineradio:custom-lyric-fonts:v1';
var CUSTOM_LYRIC_FONT_MAX_COUNT = 8;
var CUSTOM_LYRIC_FONT_MAX_BYTES = 12 * 1024 * 1024; // 单字体 12MB 上限，避免 localStorage 溢出
customLyricFonts = Array.isArray(customLyricFonts) ? customLyricFonts : [];
function builtinLyricFontKeyPattern() {
  return /^(sans|hei|song|bold-song|stone-song|kai-song|serif-en|gothic|editorial|humanist|round|mono|display)$/;
}
function customLyricFontKey(id) {
  id = String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  return id ? ('custom:' + id) : '';
}
function customLyricFontIdFromKey(key) {
  var match = /^custom:([a-z0-9_-]{1,32})$/i.exec(String(key || ''));
  return match ? match[1] : '';
}
function customLyricFontRecordForKey(key) {
  var id = customLyricFontIdFromKey(key);
  if (!id || !Array.isArray(customLyricFonts)) return null;
  for (var i = 0; i < customLyricFonts.length; i++) {
    if (customLyricFonts[i] && customLyricFonts[i].id === id) return customLyricFonts[i];
  }
  return null;
}
function normalizeCustomLyricFontName(name) {
  name = String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (name || '自定义字体').slice(0, 18);
}
function normalizeCustomLyricFontRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var id = String(raw.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  var dataUrl = String(raw.dataUrl || '');
  if (!id || !/^data:(font\/(ttf|otf|woff2?|sfnt)|application\/(font-woff|x-font-ttf|x-font-otf|octet-stream)|application\/vnd\.ms-fontobject);base64,/i.test(dataUrl)) return null;
  if (dataUrl.length > CUSTOM_LYRIC_FONT_MAX_BYTES) return null;
  return {
    id: id,
    name: normalizeCustomLyricFontName(raw.name),
    family: String(raw.family || ('MineradioCustomLyricFont-' + id)).replace(/["\\]/g, '').slice(0, 72) || ('MineradioCustomLyricFont-' + id),
    dataUrl: dataUrl,
    size: Math.max(0, Number(raw.size) || 0),
    savedAt: Math.max(0, Number(raw.savedAt) || Date.now())
  };
}
function readCustomLyricFonts() {
  try {
    var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_FONT_STORE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeCustomLyricFontRecord).filter(Boolean).slice(0, CUSTOM_LYRIC_FONT_MAX_COUNT);
  } catch (e) {
    return [];
  }
}
function saveCustomLyricFonts() {
  try {
    localStorage.setItem(CUSTOM_LYRIC_FONT_STORE_KEY, JSON.stringify(customLyricFonts || []));
    return true;
  } catch (e) {
    console.warn('[LyricFont] save failed', e);
    return false;
  }
}
function quotedCssFontFamily(name) {
  return '"' + String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function registerCustomLyricFont(record) {
  var source = record;
  record = normalizeCustomLyricFontRecord(record);
  if (!record || typeof FontFace !== 'function' || !document.fonts) return Promise.resolve(false);
  if (source && source.loaded && source.id === record.id) return Promise.resolve(true);
  try {
    var face = new FontFace(record.family, 'url("' + record.dataUrl + '")');
    return face.load().then(function (loadedFace) {
      document.fonts.add(loadedFace);
      clearLyricTextMeasureCache();
      scheduleLyricTextMeasureWarmup(0);
      record.loaded = true;
      if (source && source.id === record.id) source.loaded = true;
      return true;
    }).catch(function (err) {
      console.warn('[LyricFont] load failed', err);
      return false;
    });
  } catch (e) {
    console.warn('[LyricFont] register failed', e);
    return Promise.resolve(false);
  }
}
function registerSavedCustomLyricFonts() {
  customLyricFonts = readCustomLyricFonts();
  if (!Array.isArray(customLyricFonts) || !customLyricFonts.length) return;
  customLyricFonts.forEach(function (record) { registerCustomLyricFont(record); });
}
function removeCustomLyricFont(id) {
  id = String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  if (!id) return false;
  var removed = null;
  customLyricFonts = (customLyricFonts || []).filter(function (record) {
    if (record.id === id) { removed = record; return false; }
    return true;
  });
  if (removed && removed.family && document.fonts && typeof document.fonts.delete === 'function') {
    try {
      var faces = [];
      document.fonts.forEach(function (f) { if (f.family === '"' + removed.family + '"' || f.family === removed.family) faces.push(f); });
      faces.forEach(function (f) { document.fonts.delete(f); });
    } catch (e) {}
  }
  saveCustomLyricFonts();
  if (fx && typeof fx.lyricFont === 'string' && fx.lyricFont === 'custom:' + id) {
    fx.lyricFont = 'sans';
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
  }
  clearLyricTextMeasureCache();
  scheduleLyricTextMeasureWarmup(0);
  return !!removed;
}
function addCustomLyricFontFromFile(file) {
  if (!file) return Promise.resolve(null);
  var name = file.name || '自定义字体';
  var idBase = String(file.name || 'font').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 24) || ('font' + Date.now().toString(36));
  var id = idBase;
  var suffix = 1;
  while ((customLyricFonts || []).some(function (r) { return r.id === id; })) {
    suffix += 1;
    id = idBase + '-' + suffix;
  }
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      var record = normalizeCustomLyricFontRecord({
        id: id,
        name: name,
        dataUrl: dataUrl,
        size: dataUrl.length
      });
      if (!record) { reject(new Error('字体格式不支持或体积过大')); return; }
      registerCustomLyricFont(record).then(function (ok) {
        if (!ok) { reject(new Error('字体加载失败')); return; }
        customLyricFonts.push(record);
        saveCustomLyricFonts();
        resolve(record);
      }).catch(reject);
    };
    reader.onerror = function () { reject(new Error('文件读取失败')); };
    reader.readAsDataURL(file);
  });
}
