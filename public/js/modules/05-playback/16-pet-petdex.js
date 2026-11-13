(function (global) {
  'use strict';

  // ====================================================================
  //  桌面宠物 · Petdex 接入（2026-11-13）
  //
  //  交互流程（按用户确定的方向）：点「在浏览器里挑」→ 系统浏览器打开
  //  petdex.dev/zh（那边有动画预览、精选、合集与排行榜，比在应用里堆色块强得多）
  //  → 用户复制宠物页地址 → 粘回面板 → 导入。
  //
  //  协议依据（实测取证，见 server/routes/pets.js 头注释）：
  //   · 精灵表 assets.petdex.dev/**.webp，整张图集（boba 1536×2288、2.4MB）。
  //   · pet.json 只有 4 个字段，不含帧信息；帧布局是固定网格
  //     classic 8×9 / v2 8×11，每帧 192×208，一个状态占一行、帧从第 0 列连续排。
  //   · 每行真实帧数**不写在任何元数据里**，这里解码后按列扫描得出。
  //   · 搜索接口按显示名/标签匹配，**用 slug 搜不到目标**（实测 q=hachiware-2 为 0，
  //     而 q=小八 能搜到它），所以导入必须解析宠物页、不能靠 search。
  //
  //  行序依据 petdex 站点 i18n 的 states 顺序：
  //     0 idle · 1 running-right · 2 running-left · 3 waving · 4 jumping
  //     5 failed · 6 waiting · 7 running · 8 review ·（v2 另有两行在末尾）
  //  只映射到本项目已有的动画状态，其余不猜。
  // ====================================================================

  var FRAME_W = 192;
  var FRAME_H = 208;
  var STORE_META = 'mineradio-pet-petdex-meta';
  // 实测 /zh/pets 与 /pets 都是 404，只有 /zh 首页可用（精选 / 合集 / 排行榜 / 搜索）
  var PETDEX_WEB = 'https://petdex.dev/zh';

  var dex = {
    slug: '',
    displayName: '',
    image: null,
    frameW: FRAME_W,
    frameH: FRAME_H,
    cols: 8,
    rows: 0,
    rowFrames: [],
    loading: false,
    error: '',
    panelOpen: false,
    busy: false,
    installed: []
  };

  function api() {
    var m = global.Mineradio && global.Mineradio.api;
    return m && m.apiJson ? m.apiJson : null;
  }
  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- 精灵表解码与行帧测量 ----

  // 把第 row 行画到离屏 canvas，逐列统计非透明采样点，命中数达标的最后一列即帧数。
  // 阈值 MIN_FRAME_HITS=4 与 harness/probe-petdex-sprite.js 的实测一致：
  // 只要求「至少 4 个采样点不透明」，避免把边缘残影算成一帧。
  // （boba 实测 rowFrames=[7,8,8,4,5,8,6,6,6,8,8]，各行帧数确实不同，
  //   所以不能假定每行都排满 8 列，否则会播出空白帧。）
  var MIN_FRAME_HITS = 4;
  var ALPHA_MIN = 16;

  function measureRowFrames(image, row, cols) {
    try {
      var off = document.createElement('canvas');
      off.width = FRAME_W * cols;
      off.height = FRAME_H;
      var g = off.getContext('2d', { willReadFrequently: true });
      if (!g) return cols;
      g.clearRect(0, 0, off.width, off.height);
      g.drawImage(image, 0, row * FRAME_H, FRAME_W * cols, FRAME_H, 0, 0, FRAME_W * cols, FRAME_H);
      var data = g.getImageData(0, 0, off.width, off.height).data;
      var stride = off.width;
      var last = 0;
      for (var c = 0; c < cols; c++) {
        var hits = 0;
        var x0 = c * FRAME_W;
        // 采样步长 4：判定「这列有没有内容」足够，避免整行逐像素扫描
        for (var y = 0; y < FRAME_H; y += 4) {
          var base = y * stride;
          for (var x = x0; x < x0 + FRAME_W; x += 4) {
            if (data[(base + x) * 4 + 3] > ALPHA_MIN) hits++;
          }
        }
        if (hits >= MIN_FRAME_HITS) last = c + 1;
      }
      // 返回 0 表示这一行没有任何可见内容（不是「有 cols 帧」）。
      // 由 pickRow 决定回落，别在这里伪装成有帧，否则会播出一片空白。
      return last;
    } catch (_) {
      return cols;
    }
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('精灵表解码失败')); };
      img.src = src;
    });
  }

  function saveSelection(slug, displayName) {
    try {
      localStorage.setItem(STORE_META, JSON.stringify({ slug: slug || '', displayName: displayName || '' }));
    } catch (_) { }
  }

  function loadSelection() {
    try {
      var raw = localStorage.getItem(STORE_META);
      var meta = raw ? JSON.parse(raw) : null;
      if (meta && meta.slug) return meta;
    } catch (_) { }
    return null;
  }

  // ---- 装载一只已安装的宠物，供渲染层使用 ----
  async function activate(slug, displayName) {
    if (!slug) return { ok: false, error: 'MISSING_SLUG' };
    dex.loading = true;
    dex.error = '';
    try {
      // <img> 发不了 X-Mineradio-Token，asset 端点走 ?token= 鉴权（server.js 的
      // API_AUTH_QUERY_TOKEN_PATHS 已把该路径列入白名单）。直接用裸路径会 401 → 解码失败。
      var src = '/api/pets/local/asset?slug=' + encodeURIComponent(slug) + '&t=' + Date.now();
      var apiMod = global.Mineradio && global.Mineradio.api;
      if (apiMod && typeof apiMod.apiMediaProxyUrlAsync === 'function') {
        try {
          src = await apiMod.apiMediaProxyUrlAsync('/api/pets/local/asset', { slug: slug, t: Date.now() });
        } catch (_) { /* 拿不到 token 就退回裸路径，失败原因会由 loadImage 报出来 */ }
      }
      var img = await loadImage(src);
      var cols = Math.max(1, Math.round(img.naturalWidth / FRAME_W));
      var rows = Math.max(1, Math.round(img.naturalHeight / FRAME_H));
      var frames = [];
      for (var r = 0; r < rows; r++) frames.push(measureRowFrames(img, r, cols));
      dex.slug = slug;
      dex.displayName = displayName || slug;
      dex.image = img;
      dex.cols = cols;
      dex.rows = rows;
      dex.rowFrames = frames;
      dex.frameW = FRAME_W;
      dex.frameH = FRAME_H;
      dex.loading = false;
      saveSelection(slug, dex.displayName);
      if (global.homePet) global.homePet.petdex = dex;
      if (typeof global.homePetSetStatus === 'function') {
        global.homePetSetStatus(dex.displayName + ' 来啦！', true);
      }
      return { ok: true, slug: slug, cols: cols, rows: rows, rowFrames: frames };
    } catch (err) {
      dex.loading = false;
      dex.error = err && err.message || String(err);
      return { ok: false, error: dex.error };
    }
  }

  function deactivate() {
    dex.slug = '';
    dex.displayName = '';
    dex.image = null;
    dex.rowFrames = [];
    if (global.homePet) global.homePet.petdex = null;
    saveSelection('', '');
  }

  // ---- 渲染：由 14-home-pet.js 的 homePetDraw 调用 ----
  // 世界坐标是 16×16 格；精灵帧 192×208（宽高比 0.923），按高度铺满并居中。
  // 动作→行号、状态→动作、每动作帧间隔都在 16a-pet-petdex-map.js（纯数据模块，可单测）。
  function petMap() {
    return global.HomePetPetdexMap || null;
  }
  function rowForState(state, dir) {
    var m = petMap();
    return m ? m.rowForAnim(state, dir) : 0;
  }
  function frameMsFor(state) {
    var m = petMap();
    return m ? m.frameMsFor(state) : 170;
  }
  // 选行：越界/空行都回落到 idle 行（见 16a 的 pickRow 注释）
  function pickDexRow(state, dir) {
    var m = petMap();
    if (m && m.pickRow) return m.pickRow(state, dir, dex.rows, dex.rowFrames);
    var row = rowForState(state, dir);
    return (row >= dex.rows || !dex.rowFrames[row]) ? 0 : row;
  }
  function frameCountOf(row) {
    var n = dex.rowFrames[row] || 0;
    return n > 0 ? n : 1;
  }

  function draw(ctx, anim, frameIdx, dir) {
    if (!dex.image) return false;
    var row = pickDexRow(anim, dir);
    // 连回落行（idle）都没有可见帧：这张表画不出东西，交回内置像素伙伴兜底
    if (!(dex.rowFrames[row] > 0)) return false;
    var count = frameCountOf(row);
    var col = ((Math.floor(frameIdx) % count) + count) % count;
    var drawH = 16;
    var drawW = 16 * (dex.frameW / dex.frameH);
    var x = (16 - drawW) / 2;
    try {
      ctx.drawImage(
        dex.image,
        col * dex.frameW, row * dex.frameH, dex.frameW, dex.frameH,
        x, 0, drawW, drawH
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function frameCountFor(anim, dir) {
    if (!dex.image) return 0;
    return frameCountOf(pickDexRow(anim, dir));
  }

  // ---- 面板 ----
  function status(text, kind) {
    var node = el('home-pet-dex-status');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'home-pet-dex-status' + (kind ? ' is-' + kind : '');
  }

  function renderInstalled() {
    var box = el('home-pet-dex-installed');
    if (!box) return;
    var list = dex.installed || [];
    if (!list.length) {
      box.innerHTML = '<div class="home-pet-dex-empty">还没有导入过宠物</div>';
      return;
    }
    box.innerHTML = list.map(function (p, i) {
      var active = p.slug === dex.slug;
      return '<div class="home-pet-dex-item' + (active ? ' is-active' : '') + '">' +
        '<span class="home-pet-dex-name">' + esc(p.displayName) + (active ? '<em>正在用</em>' : '') + '</span>' +
        '<button type="button" data-dex-use="' + i + '">' + (active ? '已应用' : '使用') + '</button>' +
        '<button type="button" class="is-ghost" data-dex-remove="' + i + '">移除</button>' +
        '</div>';
    }).join('');
  }

  // 拉已装列表。API 模块可能还没加载（loader 顺序靠后），所以自带重试：
  // 少了这一步，皮肤弹层与卡片上的 ⇄ 在启动后第一次打开时看不到 Petdex 宠物。
  async function refreshInstalled(retry) {
    var call = api();
    if (!call) {
      if ((retry || 0) < 4) {
        setTimeout(function () { refreshInstalled((retry || 0) + 1); }, 500);
      }
      return;
    }
    try {
      var data = await call('/api/pets/local');
      dex.installed = (data && data.pets) || [];
    } catch (_) {
      dex.installed = [];
    }
    renderInstalled();
  }

  async function openInBrowser() {
    var bridge = global.desktopWindow;
    if (!bridge || typeof bridge.openPetdex !== 'function') {
      // 非桌面环境（纯浏览器打开页面）只能开新标签
      try { global.open(PETDEX_WEB, '_blank', 'noopener'); } catch (_) { }
      status('已在浏览器打开 petdex.dev/zh，挑好后把宠物页地址粘到下面。');
      return;
    }
    try {
      var r = await bridge.openPetdex();
      if (r && r.ok) status('已在浏览器打开 petdex.dev/zh，挑好后把宠物页地址粘到下面。');
      else status('打开浏览器失败：' + ((r && r.error) || '未知原因'), 'error');
    } catch (err) {
      status('打开浏览器失败：' + (err && err.message || err), 'error');
    }
  }

  async function importFromInput() {
    if (dex.busy) return;
    var input = el('home-pet-dex-input');
    var raw = input ? input.value.trim() : '';
    if (!raw) { status('先粘贴宠物页地址，或点上面的按钮去挑一只。', 'error'); return; }
    var call = api();
    if (!call) { status('API 未就绪', 'error'); return; }
    dex.busy = true;
    status('正在读取宠物页…');
    try {
      var res = await call('/api/pets/petdex/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw })
      });
      if (!res || res.ok !== true) throw new Error((res && res.message) || '导入失败');
      status(res.alreadyInstalled
        ? (res.displayName + ' 已经在本地了，直接应用')
        : ('已导入 ' + res.displayName + '（' + Math.round((res.bytes || 0) / 1024) + ' KB），正在装载…'));
      var act = await activate(res.slug, res.displayName);
      // 先刷新列表：文件此刻已经落盘，即使装载失败也要让用户看到「已安装」并能点「使用」重试
      await refreshInstalled();
      if (!act.ok) {
        throw new Error('已下载但没能显示：' + (act.error || '未知原因') + '（可在下面列表点「使用」重试）');
      }
      if (input) input.value = '';
      status(res.displayName + ' 已就位（' + act.rows + ' 个动作 × ' + act.cols + ' 帧），关掉面板就能看到它。', 'ok');
    } catch (err) {
      status(err && err.message || String(err), 'error');
    } finally {
      dex.busy = false;
    }
  }

  async function useInstalled(index) {
    var pet = (dex.installed || [])[index];
    if (!pet) return;
    var act = await activate(pet.slug, pet.displayName);
    if (!act.ok) { status('应用失败：' + act.error, 'error'); return; }
    renderInstalled();
    status(pet.displayName + ' 已应用', 'ok');
  }

  async function removeInstalled(index) {
    var pet = (dex.installed || [])[index];
    if (!pet) return;
    var call = api();
    if (!call) return;
    try {
      var res = await call('/api/pets/local/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: pet.slug })
      });
      if (!res || res.ok !== true) throw new Error((res && res.message) || '移除失败');
      if (dex.slug === pet.slug) deactivate();
      await refreshInstalled();
      status('已移除 ' + pet.displayName + '（只删本地缓存，想用再导入一次即可）');
    } catch (err) {
      status('移除失败：' + (err && err.message || err), 'error');
    }
  }

  function openPanel() {
    var panel = el('home-pet-dex');
    if (!panel) return;
    dex.panelOpen = true;
    panel.hidden = false;
    status('点上面的按钮去 petdex.dev 挑一只，然后把宠物页地址粘到下面。');
    refreshInstalled();
    var input = el('home-pet-dex-input');
    if (input) setTimeout(function () { try { input.focus(); } catch (_) { } }, 30);
  }

  function closePanel() {
    var panel = el('home-pet-dex');
    if (!panel) return;
    dex.panelOpen = false;
    panel.hidden = true;
  }

  function togglePanel() {
    if (dex.panelOpen) closePanel(); else openPanel();
  }

  function bind() {
    var panel = el('home-pet-dex');
    if (!panel) return;
    var input = el('home-pet-dex-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); importFromInput(); }
      });
    }
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !panel.contains(t)) return;
      var use = t.closest('[data-dex-use]');
      if (use) { useInstalled(Number(use.getAttribute('data-dex-use')) || 0); return; }
      var rm = t.closest('[data-dex-remove]');
      if (rm) { removeInstalled(Number(rm.getAttribute('data-dex-remove')) || 0); return; }
      if (t.closest('[data-dex-import]')) { importFromInput(); return; }
      if (t.closest('[data-dex-open]')) { openInBrowser(); return; }
      if (t.closest('[data-dex-close]')) { closePanel(); return; }
      if (t.closest('[data-dex-off]')) {
        deactivate();
        refreshInstalled();
        status('已切回内置像素伙伴');
      }
    });
  }

  async function boot() {
    bind();
    var saved = loadSelection();
    if (saved && saved.slug) {
      var r = await activate(saved.slug, saved.displayName);
      if (!r.ok) {
        // 本地缓存被删过：清掉记忆，回到内置伙伴，不静默失败
        dex.slug = '';
        if (global.homePet) global.homePet.petdex = null;
        saveSelection('', '');
      }
    }
    // 拉一次已装列表：皮肤弹层的宠物格与卡片上的 ⇄ 跨类型轮换都要用它
    // （refreshInstalled 自己会在 API 未就绪时重试）。
    refreshInstalled();
  }

  global.HomePetPetdex = {
    state: dex,
    activate: activate,
    deactivate: deactivate,
    draw: draw,
    frameCountFor: frameCountFor,
    frameMs: frameMsFor,
    togglePanel: togglePanel,
    openPanel: openPanel,
    closePanel: closePanel,
    refreshInstalled: refreshInstalled,
    boot: boot
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
