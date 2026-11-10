/* Folia 背景 — 嵌入（url）：把用户提供的网页用 iframe 嵌成世界背景
 *
 * 源文件（Folia: src/components/visualizer/backgrounds/url/ + utils/ + stores/）：
 *   UrlBackgroundLayer.tsx（89 行）→ iframe 壳 + 渐变遮罩
 *   entry.tsx（31 行）            → mode 'url' / order 40 / labelFallback 'Embed'
 *   utils/urlBackground.ts（95 行）→ normalizeUrl / sanitizeItem / mergeList / sanitizeList
 *   stores/useVisualizerSettingsStore.ts:184-245 → add / update / delete / select / setList
 *   stores/visualizerSettingsPersistence.ts:664-680 → 读存档（list 逐条 sanitize）
 *   i18n/locales/zh-CN.ts:2086 → options.visualizerBackgroundModeUrl = 嵌入
 *
 * 必须照抄的判据
 * --------------
 * 1. normalizeUrl：trim → 无 '://' 补 'https://' → URL 解析 → 只收 http:/https:，其余 null。
 * 2. sanitizeItem：必须有非空 id + 合法 url；note 为空（trim 后）回落 url 本身。
 * 3. sanitizeList：逐条 sanitize + 按 id 去重（保首个）。
 * 4. update：`{...item, ...patch, id: 原 id}` 再 sanitize，失败**保留旧条目**
 *    （patch 想改 id 无效——id 是合并键，改了导入就串台）。
 * 5. delete：删的是选中项 → 选中列表第一项的 id；列表空 → null。删别的项不动选中。
 * 6. setList：sanitize 整表；旧选中项不在新表 → null（add / update 不动选中）。
 * 7. mergeList：按 id 合并（新表覆盖同 id 条目的 url/note，**不夺走**旧表独有的条目）——
 *    Folia 的注释写明「导入是合而不是替换，共享配置只增不减」。
 * 8. iframe：`sandbox="allow-scripts"` + `allowFullScreen` + pointer-events:none + 无边框全幅；
 *    **换 url 必须整元素重建**（Folia 的 key={url}，防 chrome-error://chromewebdata 跨源导航错）。
 * 9. 容器尺寸 > 0 才挂 iframe（内嵌页脚本按 0×0 初始化会 IndexSizeError、永久白屏）；
 *    尺寸没就绪用 ResizeObserver 等，**每次选中项变化都重走一遍检查**（Folia setReady(false)）。
 * 10. 遮罩永远在：linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))，无开关。
 *
 * 与 Folia 的实现差异（都不是行为差异）
 * ------------------------------------
 * 1. React 的 state/key 语义换成手写 DOM：换选中 url = 拆旧 iframe 元素建新的（等价 key 重建）；
 *    同 url 重入不动 DOM（等价 React 同 key 不重渲染）。
 * 2. Folia 的数据在 `url_background_list` / `url_background_selected_id` 两个键；本项目按背景族
 *    统一存 `mineradio-folia-url-tuning-v1`（{items, selectedId}），读出后同样逐条 sanitize + 去重，
 *    选中项不在列表里时兜底为 null。
 * 3. SettingsCard（UrlBackgroundSettingsCard）本轮不移植；程序化入口 foliaUrlAdd/Update/Delete/
 *    Select/SetList/MergeList 与 store 的 handle* 一一对应。
 * 4. CSP：index.html 的 frame-src 从 'none' 放宽为 'https: http:'——只放行 http(s) iframe
 *    （与 normalizeUrl 只收 http/https 一致；项目自身不嵌任何 frame，不影响现有功能），
 *    sandbox="allow-scripts" 进一步锁住内嵌页（无同源、无表单、无顶层导航）。
 * 5. tick 是空函数：iframe 自己渲染，不占每帧预算，也没有任何随帧变化的量。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (typeof registerFoliaBackground !== 'function') return;

  var URL_TUNING_STORE_KEY = 'mineradio-folia-url-tuning-v1';

  /* ---- utils/urlBackground.ts 逐字照抄 ---- */

  function foliaUrlNormalize(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    var candidate = trimmed.indexOf('://') >= 0 ? trimmed : 'https://' + trimmed;
    try {
      var parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch (_) {
      return null;
    }
  }

  function foliaUrlSanitizeItem(value) {
    if (!value || typeof value !== 'object') return null;
    var id = typeof value.id === 'string' ? value.id.trim() : '';
    var url = foliaUrlNormalize(value.url);
    if (!id || !url) return null;
    var note = typeof value.note === 'string' && value.note.trim() ? value.note.trim() : url;
    return { id: id, url: url, note: note };
  }

  /* 导入合并：新表覆盖同 id 条目的 url/note，旧表独有的条目原样保留（只增不减）。 */
  function foliaUrlMergeList(current, incoming) {
    var merged = {};
    var list = [];
    for (var i = 0; i < current.length; i++) {
      var copy = { id: current[i].id, url: current[i].url, note: current[i].note };
      merged[current[i].id] = copy;
      list.push(copy);
    }
    if (Array.isArray(incoming)) {
      for (var j = 0; j < incoming.length; j++) {
        var sanitized = foliaUrlSanitizeItem(incoming[j]);
        if (!sanitized) continue;
        var existing = merged[sanitized.id] || null;
        var next = { id: existing ? existing.id : sanitized.id, url: sanitized.url, note: sanitized.note };
        if (existing) {
          for (var k = 0; k < list.length; k++) {
            if (list[k].id === sanitized.id) { list[k] = next; break; }
          }
        } else {
          list.push(next);
        }
        merged[sanitized.id] = next;
      }
    }
    return list;
  }

  function foliaUrlSanitizeList(items) {
    if (!Array.isArray(items)) return [];
    var next = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = foliaUrlSanitizeItem(items[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      next.push(item);
    }
    return next;
  }

  /* ---- 存档（与 Folia 的 readStored* 等价，键名不同） ---- */

  var foliaUrlTuning = { items: [], selectedId: null };

  function foliaUrlReadStored() {
    var items = [];
    var selectedId = null;
    try {
      var raw = localStorage.getItem(URL_TUNING_STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          items = foliaUrlSanitizeList(parsed.items);
          if (typeof parsed.selectedId === 'string' && parsed.selectedId) selectedId = parsed.selectedId;
        }
      }
    } catch (_) {}
    /* 选中项必须真的在列表里（Folia 在 setList/delete 时保证，脏存档这里兜底）。 */
    var exists = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === selectedId) { exists = true; break; }
    }
    if (!exists) selectedId = null;
    return { items: items, selectedId: selectedId };
  }

  function foliaUrlSave() {
    try {
      localStorage.setItem(URL_TUNING_STORE_KEY, JSON.stringify({
        items: foliaUrlTuning.items,
        selectedId: foliaUrlTuning.selectedId
      }));
    } catch (_) {}
  }

  /* ---- DOM ---- */

  function foliaUrlEl(className) {
    var node = document.createElement('div');
    node.className = className;
    return node;
  }

  function foliaUrlSelectedItem() {
    for (var i = 0; i < foliaUrlTuning.items.length; i++) {
      if (foliaUrlTuning.items[i].id === foliaUrlTuning.selectedId) return foliaUrlTuning.items[i];
    }
    return null;
  }

  function foliaUrlDestroyFrame(inst) {
    inst.framePending = false;
    inst.frameUrl = null;
    if (inst.resizeObserver) {
      try { inst.resizeObserver.disconnect(); } catch (_) {}
      inst.resizeObserver = null;
    }
    if (inst.frame && inst.frame.parentNode) inst.frame.parentNode.removeChild(inst.frame);
    inst.frame = null;
  }

  /* UrlBackgroundLayer.tsx:34-76 —— 容器有尺寸才挂 iframe；选中项变化重走检查；
   * 换 url 整元素重建（key={url}）。 */
  function foliaUrlSyncFrame(inst) {
    var item = foliaUrlSelectedItem();
    if (!item || !item.url) {
      foliaUrlDestroyFrame(inst);
      return;
    }
    if (inst.frame && inst.frameUrl === item.url) return;
    foliaUrlDestroyFrame(inst);
    inst.frameUrl = item.url;
    inst.framePending = true;

    var mount = function () {
      if (inst.destroyed || !inst.framePending || inst.frameUrl !== item.url) return;
      /* 内嵌页脚本按 0×0 初始化会 IndexSizeError、永久白屏——尺寸没就绪绝不能挂。 */
      var rect = inst.root.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      inst.framePending = false;
      var frame = document.createElement('iframe');
      frame.className = 'folia-bg-url-frame';
      frame.src = item.url;
      frame.title = item.note || item.url;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('allowfullscreen', '');
      frame.style.pointerEvents = 'none';
      inst.frame = frame;
      inst.root.insertBefore(frame, inst.overlay);
    };

    mount();
    if (inst.framePending && typeof ResizeObserver === 'function') {
      inst.resizeObserver = new ResizeObserver(function () {
        mount();
        if (!inst.framePending && inst.resizeObserver) {
          try { inst.resizeObserver.disconnect(); } catch (_) {}
          inst.resizeObserver = null;
        }
      });
      inst.resizeObserver.observe(inst.root);
    }
  }

  /* 存档操作的就地生效：只对「当前挂着的世界背景实例」同步 DOM。 */
  function foliaUrlApplyLive() {
    if (typeof foliaWorld === 'undefined' || !foliaWorld) return;
    var def = foliaWorld.bgDef;
    if (!def || def.id !== 'url') return;
    var inst = foliaWorld.bgInstance;
    if (!inst || inst.destroyed) return;
    foliaUrlSyncFrame(inst);
  }

  function foliaUrlCreate(host) {
    var stored = foliaUrlReadStored();
    foliaUrlTuning.items = stored.items;
    foliaUrlTuning.selectedId = stored.selectedId;

    var root = foliaUrlEl('folia-bg-url');
    var overlay = foliaUrlEl('folia-bg-url-overlay');
    root.appendChild(overlay);

    var inst = {
      root: root,
      overlay: overlay,
      frame: null,
      frameUrl: null,
      framePending: false,
      resizeObserver: null,
      destroyed: false
    };
    host.appendChild(root);
    foliaUrlSyncFrame(inst);
    return inst;
  }

  /* iframe 自己渲染：不占每帧预算，也没有任何随帧变化的量（Folia 无对应逻辑）。 */
  function foliaUrlTick() {}

  function foliaUrlDestroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    foliaUrlDestroyFrame(inst);
    if (inst.root && inst.root.parentNode) inst.root.parentNode.removeChild(inst.root);
  }

  /* ---- stores/useVisualizerSettingsStore.ts:184-245 —— 五个操作逐条对应 ---- */

  function foliaUrlAdd(item) {
    var sanitized = foliaUrlSanitizeItem(item);
    if (!sanitized) return false;
    foliaUrlTuning.items = foliaUrlTuning.items.concat([sanitized]);
    foliaUrlSave();
    foliaUrlApplyLive();
    return true;
  }

  function foliaUrlUpdate(id, patch) {
    foliaUrlTuning.items = foliaUrlTuning.items.map(function (item) {
      if (item.id !== id) return item;
      var merged = Object.assign({}, item, patch || {}, { id: item.id });
      return foliaUrlSanitizeItem(merged) || item;
    });
    foliaUrlSave();
    foliaUrlApplyLive();
  }

  function foliaUrlDelete(id) {
    foliaUrlTuning.items = foliaUrlTuning.items.filter(function (item) { return item.id !== id; });
    if (foliaUrlTuning.selectedId === id) {
      foliaUrlTuning.selectedId = foliaUrlTuning.items.length > 0 ? foliaUrlTuning.items[0].id : null;
    }
    foliaUrlSave();
    foliaUrlApplyLive();
  }

  function foliaUrlSelect(id) {
    foliaUrlTuning.selectedId = id ? String(id) : null;
    foliaUrlSave();
    foliaUrlApplyLive();
  }

  function foliaUrlSetList(items) {
    foliaUrlTuning.items = foliaUrlSanitizeList(items);
    var selectedId = foliaUrlTuning.selectedId;
    var exists = false;
    for (var i = 0; i < foliaUrlTuning.items.length; i++) {
      if (foliaUrlTuning.items[i].id === selectedId) { exists = true; break; }
    }
    foliaUrlTuning.selectedId = selectedId && exists ? selectedId : null;
    foliaUrlSave();
    foliaUrlApplyLive();
  }

  /* 面板用：把存档读进内存。没进过嵌入背景时内存里还是空表，直接读会渲染成「暂无 URL」。 */
  function foliaUrlLoadTuning() {
    var stored = foliaUrlReadStored();
    foliaUrlTuning.items = stored.items;
    foliaUrlTuning.selectedId = stored.selectedId;
    return foliaUrlTuning;
  }

  window.foliaUrlTuning = foliaUrlTuning;
  window.foliaUrlLoadTuning = foliaUrlLoadTuning;
  window.foliaUrlNormalize = foliaUrlNormalize;
  window.foliaUrlSanitizeItem = foliaUrlSanitizeItem;
  window.foliaUrlSanitizeList = foliaUrlSanitizeList;
  window.foliaUrlMergeList = foliaUrlMergeList;
  window.foliaUrlAdd = foliaUrlAdd;
  window.foliaUrlUpdate = foliaUrlUpdate;
  window.foliaUrlDelete = foliaUrlDelete;
  window.foliaUrlSelect = foliaUrlSelect;
  window.foliaUrlSetList = foliaUrlSetList;

  registerFoliaBackground('url', {
    name: '嵌入',
    desc: '把任意网页嵌成世界背景',
    order: 40,
    needsWebGL2: false,
    create: foliaUrlCreate,
    tick: foliaUrlTick,
    destroy: foliaUrlDestroy
  });
})();
