(function (global) {
  'use strict';

  // ====================================================================
  //  音源弹层 · 洛雪音乐（LX）兼容源脚本管理（22）
  //
  //  这里只做「管理」：导入 / 启用 / 切换 / 自检 / 删除 / 看状态。
  //  真正执行脚本的是 server/lx/source-host.js（vm 沙箱 + lx.request 兼容层）。
  //
  //  ⚠ 不内置任何音源脚本：LX 生态的脚本由用户自行导入，版权与合规责任归导入者。
  //  沙箱是 vm，不是强隔离——面板底部固定显示这句提示，不隐藏。
  // ====================================================================

  var PROVIDER_LABEL = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易云', mg: '咪咕', xm: '虾米', local: '本地' };

  var state = {
    installed: [],
    sources: {},
    configured: false,
    currentName: '',
    busy: false
  };

  function el(id) { return document.getElementById(id); }

  function apiMod() { return global.Mineradio && global.Mineradio.api; }
  function apiJson() { var m = apiMod(); return m && m.apiJson ? m.apiJson : null; }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(text, kind) {
    var node = el('lx-source-status');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'lx-source-status' + (kind ? ' is-' + kind : '');
  }

  // status() 给的 sources 是对象（{kw:{...}}），checkSources 给的是 key 数组（['kw','kg']）。
  // 两种都要吃：只按 Object.keys 处理数组会得到 "0 / 1"。
  function providerTags(sources) {
    var keys = Array.isArray(sources) ? sources.slice() : Object.keys(sources || {});
    if (!keys.length) return '';
    return keys.map(function (k) { return PROVIDER_LABEL[k] || k; }).join(' / ');
  }

  function render() {
    var list = el('lx-source-list');
    var summary = el('lx-source-summary');
    if (!list) return;

    var items = state.installed || [];
    if (summary) {
      summary.textContent = items.length
        ? '共 ' + items.length + ' 个' + (state.configured ? ' · 当前已加载' : ' · 尚未加载')
        : '还没导入过音源';
    }

    if (!items.length) {
      list.innerHTML = '<div class="lx-source-empty">还没有音源。导入一个 LX 兼容脚本后这里会列出来。</div>';
      return;
    }

    list.innerHTML = items.map(function (item, i) {
      var flags = [];
      if (item.active) flags.push('<em class="lx-flag is-on">当前</em>');
      if (item.enabled === false) flags.push('<em class="lx-flag is-off">已停用</em>');
      var sub = [item.version ? 'v' + item.version : '', item.author || ''].filter(Boolean).join(' · ');
      return '<div class="lx-source-item' + (item.active ? ' is-active' : '') + '">' +
        '<div class="lx-source-main">' +
          '<span class="lx-source-name">' + esc(item.name || '未命名音源') + flags.join('') + '</span>' +
          (sub ? '<span class="lx-source-sub">' + esc(sub) + '</span>' : '') +
        '</div>' +
        '<div class="lx-source-ops">' +
          '<button type="button" data-lx-act="select" data-lx-id="' + esc(item.id) + '"' +
            (item.active || item.enabled === false ? ' disabled' : '') + '>用这个</button>' +
          '<button type="button" data-lx-act="toggle" data-lx-id="' + esc(item.id) + '"' +
            ' data-lx-enabled="' + (item.enabled === false ? '0' : '1') + '">' +
            (item.enabled === false ? '启用' : '停用') + '</button>' +
          '<button type="button" data-lx-act="check" data-lx-id="' + esc(item.id) + '">自检</button>' +
          '<button type="button" class="is-ghost" data-lx-act="delete" data-lx-id="' + esc(item.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function refresh() {
    var call = apiJson();
    if (!call) return;
    try {
      var st = await call('/api/lx-source/status');
      state.installed = (st && st.installed) || [];
      state.sources = (st && st.sources) || {};
      state.configured = !!(st && st.configured);
      render();
    } catch (err) {
      setStatus('读取音源状态失败：' + ((err && err.message) || err), 'error');
    }
  }

  function postJson(path, payload) {
    var call = apiJson();
    if (!call) return Promise.reject(new Error('API 未就绪'));
    return call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  async function importFromUrl() {
    var input = el('lx-source-url');
    var url = input ? String(input.value || '').trim() : '';
    if (!url) { setStatus('先填脚本直链，形如 https://…/source.js', 'error'); return; }
    setStatus('正在下载并解析脚本…');
    try {
      var res = await postJson('/api/lx-source/import', { url: url });
      if (!res || res.ok !== true) throw new Error((res && res.message) || '导入失败');
      if (input) input.value = '';
      state.installed = res.installed || [];
      render();
      setStatus((res.message || '已导入') + '。点「自检」确认它支持哪些平台。', 'ok');
    } catch (err) {
      setStatus('导入失败：' + ((err && err.message) || err), 'error');
    }
  }

  function importFromFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus('脚本超过 5MB，拒绝导入', 'error'); return; }
    var reader = new FileReader();
    reader.onload = async function () {
      setStatus('正在解析脚本…');
      try {
        var res = await postJson('/api/lx-source/import', { script: String(reader.result || ''), fileName: file.name });
        if (!res || res.ok !== true) throw new Error((res && res.message) || '导入失败');
        state.installed = res.installed || [];
        render();
        setStatus((res.message || '已导入') + '。点「自检」确认它支持哪些平台。', 'ok');
      } catch (err) {
        setStatus('导入失败：' + ((err && err.message) || err), 'error');
      }
    };
    reader.onerror = function () { setStatus('读文件失败', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  async function runAct(action, id, extra) {
    if (state.busy) return;
    state.busy = true;
    try {
      if (action === 'select') {
        setStatus('正在切换音源…');
        var r1 = await postJson('/api/lx-source/select', { id: id });
        if (!r1 || r1.ok !== true) throw new Error((r1 && r1.message) || '切换失败');
        state.installed = r1.installed || state.installed;
        render();
        setStatus('已切换，音源已重新加载', 'ok');
      } else if (action === 'toggle') {
        var enable = extra === '0';
        setStatus(enable ? '正在启用…' : '正在停用…');
        var r2 = await postJson('/api/lx-source/enable', { id: id, enabled: enable });
        if (!r2 || r2.ok !== true) throw new Error((r2 && r2.message) || '操作失败');
        state.installed = r2.installed || state.installed;
        render();
        setStatus(enable ? '已启用' : '已停用', 'ok');
      } else if (action === 'check') {
        setStatus('正在自检（会真正初始化脚本，可能需要几秒）…');
        var r3 = await postJson('/api/lx-source/check', { id: id });
        if (!r3 || r3.ok !== true) throw new Error((r3 && r3.message) || '自检失败');
        var item = (r3.checked || [])[0] || {};
        if (item.ok === false) {
          setStatus('自检失败：' + (item.message || item.error || '脚本无法初始化'), 'error');
        } else {
          var tags = providerTags(item.sources);
          setStatus('自检通过：' + (item.name || '音源') +
            (tags ? '，支持 ' + tags : '') +
            (item.version ? '（v' + item.version + '）' : ''), 'ok');
        }
        await refresh();
      } else if (action === 'delete') {
        setStatus('正在删除…');
        var r4 = await postJson('/api/lx-source/delete', { id: id });
        if (!r4 || r4.ok !== true) throw new Error((r4 && r4.message) || '删除失败');
        state.installed = r4.installed || [];
        render();
        setStatus('已删除', 'ok');
      }
    } catch (err) {
      setStatus(((err && err.message) || '操作失败'), 'error');
    } finally {
      state.busy = false;
    }
  }

  // ---- 给播放链路用的取址封装 ----
  // 返回可直接喂给 audio.src 的地址：走 /api/audio 代理，带上音源要求的 Referer/UA。
  async function resolveUrl(provider, musicInfo, quality) {
    var api = apiMod();
    if (!api || typeof api.apiJson !== 'function') throw new Error('API 未就绪');
    var res = await api.apiJson('/api/lx-source/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: provider, musicInfo: musicInfo || {}, quality: quality || '' })
    });
    if (!res || res.ok !== true) throw new Error((res && res.message) || '音源解析失败');
    if (!res.proxy || !res.proxy.path) throw new Error('音源没有返回可播放地址');
    var url = typeof api.apiMediaProxyUrlAsync === 'function'
      ? await api.apiMediaProxyUrlAsync(res.proxy.path, res.proxy.params)
      : res.url;
    return { url: url, quality: res.quality || '', resolver: res.resolver || '' };
  }

  // ---- 给歌词管道用的取词封装（与取址同源：同一条 LX 源、同一份 musicInfo） ----
  async function resolveLyric(provider, musicInfo) {
    var api = apiMod();
    if (!api || typeof api.apiJson !== 'function') throw new Error('API 未就绪');
    var res = await api.apiJson('/api/lx-source/lyric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: provider, musicInfo: musicInfo || {} })
    });
    if (!res || res.ok !== true) throw new Error((res && res.message) || '音源取词失败');
    // lxlyric 是 LX 的逐字格式，现有歌词管道解析不了，只交出行级 LRC 与翻译
    return {
      lyric: res.lyric || '',
      tlyric: res.tlyric || '',
      rlyric: res.rlyric || ''
    };
  }

  function bind() {
    var box = el('lx-pane');
    if (!box) return;

    box.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !box.contains(t)) return;
      var act = t.closest('[data-lx-act]');
      if (!act) return;
      var name = act.getAttribute('data-lx-act');
      if (name === 'import-url') { importFromUrl(); return; }
      if (name === 'refresh') { setStatus('正在刷新…'); refresh(); return; }
      runAct(name, act.getAttribute('data-lx-id'), act.getAttribute('data-lx-enabled'));
    });

    var fileInput = el('lx-source-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        // 原生 input 被样式隐藏了，文件名要显式回显到自定义组件上
        var nameEl = el('lx-source-file-name');
        if (nameEl) {
          nameEl.textContent = file ? file.name : '尚未选择文件';
          nameEl.classList.toggle('is-picked', !!file);
        }
        fileInput.value = '';
        if (file) importFromFile(file);
      });
    }

    var urlInput = el('lx-source-url');
    if (urlInput) {
      urlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); importFromUrl(); }
      });
    }

    // 兜底开关：与 01-music-provider-registry.js 里 lxSourceFallbackEnabled() 共用同一个 key
    var fallbackBox = el('lx-source-fallback');
    if (fallbackBox) {
      try {
        fallbackBox.checked = localStorage.getItem('mineradio-lx-source-fallback') !== '0';
      } catch (_) { }
      fallbackBox.addEventListener('change', function () {
        try {
          localStorage.setItem('mineradio-lx-source-fallback', fallbackBox.checked ? '1' : '0');
        } catch (_) { }
        setStatus(fallbackBox.checked ? '已开启：平台取不到直链时用音源兜底' : '已关闭：只走原平台', 'ok');
      });
    }
  }

  global.LxSource = {
    refresh: refresh,
    resolveUrl: resolveUrl,
    resolveLyric: resolveLyric,
    state: state
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})(typeof window !== 'undefined' ? window : globalThis);
