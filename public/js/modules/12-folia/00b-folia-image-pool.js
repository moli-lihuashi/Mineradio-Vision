/* Folia 世界 — 视觉自定义图片池（IndexedDB 键值存储）
 *
 * 源文件（Folia）：
 *   src/services/visualizerImageAsset.ts（45）  → 单图资产的读/写/清 + 格式校验 + 构造 {id,name,mimeType,blob}
 *   src/services/monetBackgroundImage.ts（30）  → 共享背景图 'monet_background_image'（莫奈背景 **与** 漫游「自定义图片」同一份）
 *   src/services/monetPortraitImage.ts（30）    → 莫奈右侧肖像图 'monet_portrait_image'
 *   src/services/cappellaAvatarPack.ts（37）    → 群唱自定义头像 'cappella_custom_avatar'（多图）
 *   src/services/cappellaEmojiPack.ts（38）     → 群唱自定义表情包 'cappella_custom_emoji'（多图）
 *   src/services/temperaLayerImages.ts（118）   → 凝彩画布图片 'tempera_layer_images'（多图 + 放置参数）
 *   src/stores/useVisualizerSettingsStore.ts:681-760 → 上传/清空的真实语义（校验 / 落盘 / 回退来源 / 提示）
 *   src/i18n/locales/zh-CN.ts:267-270 / 300-301 / 2569-2570 / 2621-2622 → 文案逐字
 *
 * 必须照抄的判据
 * --------------
 * 1. **一张图服务两个背景**：莫奈背景（MonetBackgroundSettingsCard 的「自定义图片」档）与
 *    漫游背景（NomandBackgroundSettingsCard 的「自定义图片」档）在 Folia 里读的是同一个
 *    `monetBackgroundImage`。所以这里只有一个 `background` 槽，两条面板共用。
 * 2. **上传只取第一个文件**（`const file = files[0]`），空选 → 「请选择图片文件。」，
 *    格式不支持 → 「仅支持 png、jpg、jpeg、gif、webp、svg 图片。」，**不落盘也不改来源**。
 * 3. **上传成功即改来源**：背景 → `uploaded-global`，肖像 → `custom`（在面板侧落地，见 0l）。
 * 4. **清空要回退来源**：背景档若正停在 `uploaded-global` 退回 `cover-derived`，
 *    肖像档若正停在 `custom` 退回 `cover`（useVisualizerSettingsStore.ts:704-716 / 735-747）。
 * 5. 资产对象形如 `{ id: Date.now()+'-'+fileName, name, mimeType, blob }`；id 里带时间戳，
 *    所以「同一张图重新上传」也算一次新资产（缓存键会跟着变，画面才会刷新）。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. Folia 的资产放在全局 `db` 缓存（`getFromCache/saveToCache`，整个 App 共用一个大对象仓）；
 *    这里单独开一个库 `mineradio-folia-assets`（一个 objectStore 键值表），避免与既有库的
 *    版本升级互相打架。键名与 Folia 逐字一致，方便对照。
 * 2. Folia 用 React state 把 `{id,name,url}` 往下传；这里维护一份**同步快照**
 *    （`foliaAssetGet(key)`），面板/渲染器直接同步读；异步部分只在落盘与首次水合。
 * 3. 对象 URL 按资产 id 缓存，清空/替换时 revoke，避免反复上传把 blob 泄漏成孤儿 URL。
 * 4. IndexedDB 不可用（隐私模式、被策略禁用、非浏览器环境）时退化成内存表：
 *    功能照常（当前会话内有效），只是刷新后不保留。绝不因为存不了就让上传按钮变成死的。
 */
'use strict';

var FOLIA_ASSET_DB_NAME = 'mineradio-folia-assets';
var FOLIA_ASSET_DB_VERSION = 1;
var FOLIA_ASSET_STORE_NAME = 'assets';

/* 键名与 Folia 逐字一致（services/*.ts 里的 *_KEY 常量）。 */
var FOLIA_ASSET_KEYS = {
  background: 'monet_background_image',
  portrait: 'monet_portrait_image',
  cappellaAvatar: 'cappella_custom_avatar',
  cappellaEmoji: 'cappella_custom_emoji',
  temperaLayers: 'tempera_layer_images'
};

/* 多图池的三个槽（值是数组）；其余是单图槽（值是对象或 null）。 */
var FOLIA_ASSET_MULTI = {
  cappellaAvatar: true,
  cappellaEmoji: true,
  temperaLayers: true
};

/* visualizerImageAsset.ts:12 —— 扩展名白名单；accept 与 Folia 的 input 属性同款。 */
var FOLIA_ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
var FOLIA_ASSET_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*';

/* 文案逐字（zh-CN.ts）。 */
var FOLIA_ASSET_TEXT = {
  selectFile: '请选择图片文件。',
  unsupported: '仅支持 png、jpg、jpeg、gif、webp、svg 图片。',
  bgUpdated: 'Monet 背景图已更新',
  bgCleared: 'Monet 背景图已清空',
  portraitUpdated: 'Monet 肖像图已更新',
  portraitCleared: 'Monet 肖像图已清空',
  nomandUploadSuccess: '背景图片上传成功',
  nomandUploadFailed: '背景图片上传失败'
};

/* 同步快照：面板 / 渲染器只读这里。单图槽 null，多图槽数组。 */
var foliaAssetSnapshot = {
  background: null,
  portrait: null,
  cappellaAvatar: [],
  cappellaEmoji: [],
  temperaLayers: []
};

var foliaAssetUrlCache = Object.create(null);
var foliaAssetDbPromise = null;
var foliaAssetDbBroken = false;
var foliaAssetMemory = Object.create(null);
var foliaAssetListeners = [];
var foliaAssetHydrating = null;

/* ---------------- 基础判据 ---------------- */

function foliaAssetIsMulti(key) {
  return FOLIA_ASSET_MULTI[key] === true;
}

function foliaAssetIsImageFile(file) {
  if (!file) return false;
  var name = String(file.name || '').toLowerCase();
  var type = String(file.type || '');
  if (type.indexOf('image/') === 0) return true;
  for (var i = 0; i < FOLIA_ASSET_EXTENSIONS.length; i++) {
    if (name.slice(-FOLIA_ASSET_EXTENSIONS[i].length) === FOLIA_ASSET_EXTENSIONS[i]) return true;
  }
  return false;
}

/* 只留「真的能用」的条目：blob 必须是 Blob、name 必须是字符串（两个 service 的过滤条件合集）。 */
function foliaAssetEntryUsable(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.name !== 'string' || !entry.name) return false;
  if (typeof Blob === 'undefined' || !(entry.blob instanceof Blob)) return false;
  return true;
}

/* 对象 URL：按 id 缓存（同一资产多次取用只建一条），替换时由调用方 revoke。 */
function foliaAssetUrlOf(entry) {
  if (!entry || !entry.id) return '';
  var key = String(entry.id);
  if (foliaAssetUrlCache[key]) return foliaAssetUrlCache[key];
  var url = '';
  if (entry.blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try { url = URL.createObjectURL(entry.blob); } catch (_) { url = ''; }
  }
  if (!url && entry.url) url = String(entry.url);
  if (url) foliaAssetUrlCache[key] = url;
  return url;
}

function foliaAssetRevokeUrl(id) {
  if (!id) return;
  var key = String(id);
  var url = foliaAssetUrlCache[key];
  if (!url) return;
  delete foliaAssetUrlCache[key];
  if (url.indexOf('blob:') === 0 && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
}

/* 落盘用：去掉 url（刷新后必然失效，留着只会被误读成「还有图」）。 */
function foliaAssetStrip(entry) {
  return { id: entry.id, name: entry.name, mimeType: entry.mimeType || '', blob: entry.blob };
}

/* 对外暴露用：补上当前可用的 url，并把 blob 一起留着（多图池改写时要原样写回）。 */
function foliaAssetPublicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType || '',
    blob: entry.blob,
    url: foliaAssetUrlOf(entry)
  };
}

/* ---------------- IndexedDB ---------------- */

function foliaAssetOpenDb() {
  if (foliaAssetDbPromise) return foliaAssetDbPromise;
  foliaAssetDbPromise = new Promise(function (resolve) {
    var idb = null;
    try { idb = typeof indexedDB !== 'undefined' ? indexedDB : null; } catch (_) { idb = null; }
    if (!idb) { foliaAssetDbBroken = true; resolve(null); return; }

    var request;
    try { request = idb.open(FOLIA_ASSET_DB_NAME, FOLIA_ASSET_DB_VERSION); }
    catch (_) { foliaAssetDbBroken = true; resolve(null); return; }

    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(FOLIA_ASSET_STORE_NAME)) db.createObjectStore(FOLIA_ASSET_STORE_NAME);
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { foliaAssetDbBroken = true; resolve(null); };
    request.onblocked = function () { foliaAssetDbBroken = true; resolve(null); };
  });
  return foliaAssetDbPromise;
}

/* 读：DB 不可用时回落内存表。永远 resolve，不抛。 */
function foliaAssetDbRead(dbKey) {
  return foliaAssetOpenDb().then(function (db) {
    if (!db) return Object.prototype.hasOwnProperty.call(foliaAssetMemory, dbKey) ? foliaAssetMemory[dbKey] : null;
    return new Promise(function (resolve) {
      var tx;
      try { tx = db.transaction(FOLIA_ASSET_STORE_NAME, 'readonly'); }
      catch (_) { resolve(null); return; }
      var request;
      try { request = tx.objectStore(FOLIA_ASSET_STORE_NAME).get(dbKey); }
      catch (_) { resolve(null); return; }
      request.onsuccess = function () {
        resolve(request.result === undefined ? null : request.result);
      };
      request.onerror = function () { resolve(null); };
    });
  });
}

/* 写：内存表始终同步写（同会话内一定读得到），DB 尽力而为。 */
function foliaAssetDbWrite(dbKey, value) {
  if (value == null) delete foliaAssetMemory[dbKey];
  else foliaAssetMemory[dbKey] = value;
  return foliaAssetOpenDb().then(function (db) {
    if (!db) return false;
    return new Promise(function (resolve) {
      var tx;
      try { tx = db.transaction(FOLIA_ASSET_STORE_NAME, 'readwrite'); }
      catch (_) { resolve(false); return; }
      try {
        if (value == null) tx.objectStore(FOLIA_ASSET_STORE_NAME).delete(dbKey);
        else tx.objectStore(FOLIA_ASSET_STORE_NAME).put(value, dbKey);
      } catch (_) { resolve(false); return; }
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { resolve(false); };
      tx.onabort = function () { resolve(false); };
    });
  });
}

/* ---------------- 快照 / 广播 ---------------- */

/* 把某个槽的原始存储值收敛成快照（单图：可用条目或 null；多图：可用条目数组）。 */
function foliaAssetIngest(key, raw) {
  if (foliaAssetIsMulti(key)) {
    var list = Array.isArray(raw) ? raw.filter(foliaAssetEntryUsable) : [];
    var keep = Object.create(null);
    var next = [];
    for (var i = 0; i < list.length; i++) {
      var entry = foliaAssetPublicEntry(list[i]);
      if (!entry.url) continue; /* 既不是 Blob 也没有 url 的条目直接丢，别把空图挂进池子 */
      keep[String(entry.id)] = true;
      next.push(entry);
    }
    var prev = Array.isArray(foliaAssetSnapshot[key]) ? foliaAssetSnapshot[key] : [];
    for (var p = 0; p < prev.length; p++) {
      if (!keep[String(prev[p].id)]) foliaAssetRevokeUrl(prev[p].id);
    }
    foliaAssetSnapshot[key] = next;
    return next;
  }

  var prevEntry = foliaAssetSnapshot[key];
  var single = foliaAssetEntryUsable(raw) ? foliaAssetPublicEntry(raw) : null;
  if (prevEntry && (!single || String(prevEntry.id) !== String(single.id))) foliaAssetRevokeUrl(prevEntry.id);
  foliaAssetSnapshot[key] = single;
  return single;
}

/* 两个背景共用同一张图：Folia 的 monetBackgroundImage 同时喂莫奈与漫游，
 * 我们的两个渲染层分别读这两个全局入口（01d / 01f 的历史钩子），所以一起写。 */
function foliaAssetBridgeGlobals() {
  if (typeof window === 'undefined') return;
  var entry = foliaAssetSnapshot.background;
  var value = entry && entry.url ? { id: entry.id, name: entry.name, url: entry.url } : null;
  window.foliaMonetBackgroundImage = value;
  window.foliaNomandCustomImage = value;
}

function foliaAssetNotify(key) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('folia-assets-changed', { detail: { key: key } }));
    } catch (_) {}
  }
  var listeners = foliaAssetListeners.slice();
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](key, foliaAssetSnapshot[key]); } catch (_) {}
  }
}

/* ---------------- 对外 API ---------------- */

/* 面板 / 渲染器的同步读口。 */
function foliaAssetGet(key) {
  if (!Object.prototype.hasOwnProperty.call(foliaAssetSnapshot, key)) return null;
  return foliaAssetSnapshot[key];
}

function foliaAssetName(key) {
  var value = foliaAssetGet(key);
  if (!value) return '';
  if (Array.isArray(value)) return value.length ? String(value[0].name || '') : '';
  return String(value.name || '');
}

function foliaAssetCount(key) {
  var value = foliaAssetGet(key);
  if (Array.isArray(value)) return value.length;
  return value ? 1 : 0;
}

/* 首次水合：把所有槽读进快照，桥好两个全局，再广播一次（背景/模式据此重挂）。 */
function foliaAssetHydrate() {
  if (foliaAssetHydrating) return foliaAssetHydrating;
  var names = Object.keys(FOLIA_ASSET_KEYS);
  var tasks = [];
  for (var i = 0; i < names.length; i++) {
    (function (name) {
      tasks.push(foliaAssetDbRead(FOLIA_ASSET_KEYS[name]).then(function (raw) {
        foliaAssetIngest(name, raw);
      }));
    })(names[i]);
  }
  foliaAssetHydrating = Promise.all(tasks).then(function () {
    foliaAssetBridgeGlobals();
    foliaAssetNotify('hydrate');
    return foliaAssetSnapshot;
  });
  return foliaAssetHydrating;
}

/* 单图上传：语义照抄 store 的 handleUpload*（只取第一个文件、校验失败不落盘）。 */
function foliaAssetPutFile(key, file) {
  return new Promise(function (resolve) {
    if (!file) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.selectFile }); return; }
    if (!foliaAssetIsImageFile(file)) { resolve({ ok: false, error: FOLIA_ASSET_TEXT.unsupported }); return; }

    var entry = {
      id: Date.now() + '-' + String(file.name || 'image'),
      name: String(file.name || 'image'),
      mimeType: String(file.type || 'application/octet-stream'),
      blob: file
    };
    var multi = foliaAssetIsMulti(key);
    var next = multi
      ? (foliaAssetSnapshot[key] || []).map(foliaAssetStrip).concat([foliaAssetStrip(entry)])
      : foliaAssetStrip(entry);

    foliaAssetDbWrite(FOLIA_ASSET_KEYS[key], next).then(function () {
      var stored = foliaAssetIngest(key, next);
      foliaAssetBridgeGlobals();
      foliaAssetNotify(key);
      resolve({ ok: true, entry: multi ? stored[stored.length - 1] : stored });
    });
  });
}

/* 多图池追加（群唱头像 / 表情包 / 凝彩画布图片）：整批校验，有一张不合格就整批拒绝
 * （Folia 是 `files.every(isSupported)`，同样不半途落盘）。 */
function foliaAssetPutFiles(key, files) {
  var list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return Promise.resolve({ ok: false, error: FOLIA_ASSET_TEXT.selectFile });
  for (var i = 0; i < list.length; i++) {
    if (!foliaAssetIsImageFile(list[i])) return Promise.resolve({ ok: false, error: FOLIA_ASSET_TEXT.unsupported });
  }
  var chain = Promise.resolve({ ok: true });
  for (var f = 0; f < list.length; f++) {
    (function (file) {
      chain = chain.then(function (result) {
        if (!result.ok) return result;
        return foliaAssetPutFile(key, file);
      });
    })(list[f]);
  }
  return chain;
}

/* 清单个槽（或删多图池里的某一项：传 id）。 */
function foliaAssetClear(key, id) {
  var multi = foliaAssetIsMulti(key);
  if (!multi) {
    return foliaAssetDbWrite(FOLIA_ASSET_KEYS[key], null).then(function () {
      foliaAssetIngest(key, null);
      foliaAssetBridgeGlobals();
      foliaAssetNotify(key);
      return { ok: true };
    });
  }

  var current = foliaAssetSnapshot[key] || [];
  var next = [];
  for (var i = 0; i < current.length; i++) {
    if (id && String(current[i].id) === String(id)) continue;
    next.push(foliaAssetStrip(current[i]));
  }
  return foliaAssetDbWrite(FOLIA_ASSET_KEYS[key], next.length ? next : null).then(function () {
    foliaAssetIngest(key, next);
    foliaAssetNotify(key);
    return { ok: true, removed: id || 'all' };
  });
}

/* 全部清空（测试/重置用）：连 DB 记录与对象 URL 一起清。 */
function foliaAssetReset() {
  var names = Object.keys(FOLIA_ASSET_KEYS);
  var tasks = [];
  for (var i = 0; i < names.length; i++) {
    (function (name) {
      tasks.push(foliaAssetDbWrite(FOLIA_ASSET_KEYS[name], null).then(function () {
        foliaAssetIngest(name, null);
      }));
    })(names[i]);
  }
  return Promise.all(tasks).then(function () {
    foliaAssetBridgeGlobals();
    foliaAssetNotify('reset');
  });
}

function foliaAssetSubscribe(fn) {
  if (typeof fn !== 'function') return function () {};
  foliaAssetListeners.push(fn);
  return function () {
    var index = foliaAssetListeners.indexOf(fn);
    if (index >= 0) foliaAssetListeners.splice(index, 1);
  };
}

if (typeof window !== 'undefined') {
  window.foliaAssetKeys = FOLIA_ASSET_KEYS;
  window.foliaAssetAccept = FOLIA_ASSET_ACCEPT;
  window.foliaAssetText = FOLIA_ASSET_TEXT;
  window.foliaAssetGet = foliaAssetGet;
  window.foliaAssetName = foliaAssetName;
  window.foliaAssetCount = foliaAssetCount;
  window.foliaAssetIsImageFile = foliaAssetIsImageFile;
  window.foliaAssetPutFile = foliaAssetPutFile;
  window.foliaAssetPutFiles = foliaAssetPutFiles;
  window.foliaAssetClear = foliaAssetClear;
  window.foliaAssetHydrate = foliaAssetHydrate;
  window.foliaAssetReset = foliaAssetReset;
  window.foliaAssetSubscribe = foliaAssetSubscribe;
  /* 探针必须换个名字：`window.foliaAssetDbBroken = function(){ return foliaAssetDbBroken; }`
   * 会把模块级的同名 var 直接改写成这个函数，于是「读状态」读回函数自己（序列化成 {}）。
   * 同名的函数声明（foliaAssetGet 等）没这个问题 —— 函数声明与赋值指向同一对象。 */
  window.foliaAssetDbUnavailable = function () { return foliaAssetDbBroken === true; };
  /* 启动即水合：背景/模式的首帧就能拿到已上传的图，不必等面板打开。 */
  foliaAssetHydrate();
}
