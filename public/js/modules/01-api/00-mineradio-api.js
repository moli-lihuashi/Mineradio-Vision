(function (global) {
  'use strict';

  async function withApiTokenHeaders(headers) {
    headers = Object.assign({}, headers || {});
    if (global.desktopWindow && global.desktopWindow.fetchApiToken) {
      try {
        var apiToken = await global.desktopWindow.fetchApiToken();
        if (apiToken) headers['X-Mineradio-Token'] = apiToken;
      } catch (e) {}
    }
    if (!headers['X-Mineradio-Token'] && global.__MINERADIO_API_TOKEN__) {
      headers['X-Mineradio-Token'] = global.__MINERADIO_API_TOKEN__;
    }
    if (!headers['X-Mineradio-Token'] && global.desktopWindow && global.desktopWindow.getApiToken) {
      var cached = global.desktopWindow.getApiToken();
      if (cached) headers['X-Mineradio-Token'] = cached;
    }
    return headers;
  }

  async function apiFetch(url, opts) {
    opts = opts || {};
    var fetchOpts = Object.assign({}, opts);
    fetchOpts.headers = await withApiTokenHeaders(fetchOpts.headers);
    return fetch(url, fetchOpts);
  }

  async function apiJson(url, opts) {
    opts = opts || {};
    var timeoutMs = Number(opts.timeoutMs) || 0;
    var fetchOpts = Object.assign({}, opts);
    delete fetchOpts.timeoutMs;
    fetchOpts.headers = await withApiTokenHeaders(fetchOpts.headers);
    var timer = null;
    // 外传 signal 与超时可并存：外层信号（如切歌取消）触发或超时触发都中止同一控制器。
    // 旧行为（只传 timeoutMs、无外层 signal）保持不变。
    if (global.AbortController && (timeoutMs || fetchOpts.signal)) {
      var controller = new AbortController();
      var externalSignal = fetchOpts.signal || null;
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else if (typeof externalSignal.addEventListener === 'function') {
          externalSignal.addEventListener('abort', function () { controller.abort(); }, { once: true });
        }
      }
      if (timeoutMs) timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      fetchOpts.signal = controller.signal;
    }
    try {
      var res = await fetch(url, fetchOpts);
      var data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok) {
        var err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  function imgTagFromSrc(src, extraAttrs) {
    if (!src) return '';
    return '<img src="' + escAttr(src) + '" alt=""' + (extraAttrs ? ' ' + extraAttrs : '') + '>';
  }

  // 封面加载失败的统一兜底（全站共用）。
  // 以前各处写的是 this.style.opacity=0.2 —— 图淡了，但 Chromium 照样把
  // 「破图」图标画出来（用户看到的就是左上角那个撕裂小方块）。
  // 只 removeAttribute('src') 也不行：实测无 src 的 <img> 仍绘制破图占位。
  // 唯一干净的做法是换成 1x1 透明 GIF（加载必成功 → 不画破图），这样 <img> 只显示
  // 自身 background（.pl-card img / .pl-detail-cover 等都带 rgba(255,255,255,.06)），
  // 尺寸不塌陷。放在这里而不是内联，是因为内联里带引号会和外层 HTML 属性引号打架。
  var MINERADIO_BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function mineradioCoverFallback(img) {
    if (!img || img.dataset.coverBroken === '1') return;
    img.dataset.coverBroken = '1';
    // 若这张封面旁边叠着一枚占位标记（歌单卡的爱心 / 五角星，见
    // 06-lyrics/02-playlist-detail.js: playlistCoverHtml），就直接把 img 藏掉、
    // 把标记亮出来 —— 对用户来说「封面拿不到」和「没有封面」应该长得一样。
    var sibling = img.nextElementSibling;
    if (sibling && sibling.classList && sibling.classList.contains('pl-cover-mark')) {
      img.style.display = 'none';
      sibling.style.display = 'flex';
      return;
    }
    img.removeAttribute('srcset');
    img.src = MINERADIO_BLANK_IMAGE;
  }

  global.Mineradio = global.Mineradio || {};
  async function resolveApiToken() {
    if (global.desktopWindow && global.desktopWindow.fetchApiToken) {
      try {
        var token = await global.desktopWindow.fetchApiToken();
        if (token) return String(token);
      } catch (e) {}
    }
    if (global.__MINERADIO_API_TOKEN__) return String(global.__MINERADIO_API_TOKEN__);
    if (global.desktopWindow && global.desktopWindow.getApiToken) {
      var cached = global.desktopWindow.getApiToken();
      if (cached) return String(cached);
    }
    return '';
  }
  function apiMediaProxyUrl(pathname, params, token) {
    params = Object.assign({}, params || {});
    if (token) params.token = token;
    else if (global.__MINERADIO_API_TOKEN__) params.token = global.__MINERADIO_API_TOKEN__;
    else if (global.desktopWindow && global.desktopWindow.getApiToken) {
      var cachedToken = global.desktopWindow.getApiToken();
      if (cachedToken) params.token = cachedToken;
    }
    var parts = [];
    Object.keys(params).forEach(function (key) {
      if (params[key] == null || params[key] === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return parts.length ? (pathname + '?' + parts.join('&')) : pathname;
  }
  async function apiMediaProxyUrlAsync(pathname, params) {
    return apiMediaProxyUrl(pathname, params, await resolveApiToken());
  }

  global.Mineradio.api = {
    apiJson: apiJson,
    apiFetch: apiFetch,
    withApiTokenHeaders: withApiTokenHeaders,
    resolveApiToken: resolveApiToken,
    apiMediaProxyUrl: apiMediaProxyUrl,
    apiMediaProxyUrlAsync: apiMediaProxyUrlAsync,
    escHtml: escHtml,
    escAttr: escAttr,
    imgTagFromSrc: imgTagFromSrc,
    mineradioCoverFallback: mineradioCoverFallback,
  };
})(typeof window !== 'undefined' ? window : globalThis);
