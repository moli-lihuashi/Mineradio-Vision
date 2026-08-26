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
    if (timeoutMs && global.AbortController && !fetchOpts.signal) {
      var controller = new AbortController();
      fetchOpts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, timeoutMs);
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
