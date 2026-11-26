// =============================================================================
// iframe 内嵌桥（2026-11-23）
//
// 偏好设置页有两种运行方式：
//   1. 独立 BrowserWindow —— preload 注入 window.foliaWidget（ipcRenderer 直连）；
//   2. 嵌进播放器的皮肤面板（?embedded=1）—— iframe 里没有 preload，
//      所以这里用 postMessage 顶替同一个 API，页面代码一行都不用改。
//
// 父窗（主页面）收到 postMessage 后转给主进程，主进程再转发到小组件窗口；
// 反向的 widget-settings-state 也由父窗 postMessage 回来。
// 非 embedded 模式直接返回，绝不覆盖真实 preload。
// =============================================================================
(function () {
  'use strict';
  var params;
  try { params = new URLSearchParams(location.search); } catch (_) { return; }
  if (!params || params.get('embedded') !== '1') return;
  if (window.foliaWidget) return;

  // 内嵌版样式（widget-settings-dark.css）靠这个属性开闸，独立窗口不受影响
  try { document.documentElement.setAttribute('data-embedded', '1'); } catch (_) { }

  /* 主题：同源 iframe 能直接读父窗的 <html data-theme>，所以先同步一次 ——
   * 等 postMessage 再设的话，会先用深色默认值画一帧，浅色下看得见闪。
   * 之后父窗切主题由下面的 message 监听补推（父窗侧见 32-widget-settings-inline.js）。 */
  function applyTheme(theme) {
    try {
      document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    } catch (_) { }
  }
  var initialTheme = 'dark';
  try {
    initialTheme = parent.document.documentElement.getAttribute('data-theme') || 'dark';
  } catch (_) { }
  applyTheme(initialTheme);

  var listeners = Object.create(null);

  function emit(channel, payload) {
    var list = listeners[channel];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i]({}, payload); } catch (err) { console.warn('[embed] listener failed:', err); }
    }
  }

  window.foliaWidget = {
    send: function (channel, payload) {
      try {
        parent.postMessage({ __foliaEmbed: 1, kind: 'send', channel: channel, payload: payload }, '*');
      } catch (_) { }
    },
    on: function (channel, cb) {
      if (typeof cb !== 'function') return;
      (listeners[channel] || (listeners[channel] = [])).push(cb);
    }
  };

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.__foliaEmbed !== 1) return;
    if (data.kind === 'theme') { applyTheme(data.theme); return; }
    if (data.kind !== 'event') return;
    emit(data.channel, data.payload);
  });

  /* 高度自适应：父窗把 iframe 拉到内容高度，全页只留面板那一条滚动条。
   * 否则 iframe 内部自带一条滚动条，一眼就能看出「这里嵌了个窗口」。 */
  var lastHeight = 0;
  function reportHeight() {
    try {
      var sheet = document.getElementById('sheet');
      // 用 scrollHeight 而不是 getBoundingClientRect().height：
      // #sheet 在内嵌时是 auto 高度，但量自身高度会跟 iframe 互相追着变。
      var h = Math.ceil(Math.max(
        sheet ? sheet.scrollHeight : 0,
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ));
      if (!h || Math.abs(h - lastHeight) < 4) return;
      lastHeight = h;
      parent.postMessage({ __foliaEmbed: 1, kind: 'height', height: h }, '*');
    } catch (_) { }
  }
  if (window.ResizeObserver) {
    try {
      new ResizeObserver(function () { reportHeight(); }).observe(document.body);
    } catch (_) { }
  }
  window.addEventListener('load', reportHeight);
  setTimeout(reportHeight, 260);
  setTimeout(reportHeight, 900);

  // 告诉父窗「可以推状态了」
  try {
    parent.postMessage({ __foliaEmbed: 1, kind: 'ready' }, '*');
  } catch (_) { }
})();
