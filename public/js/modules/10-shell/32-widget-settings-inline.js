// =============================================================================
// 皮肤面板 · 挂件偏好设置（iframe 内嵌，2026-11-23）
//
// 用户的要求很明确：偏好设置那套浅色 UI 保持原样，但不要再弹一个独立窗口。
// 所以这里不重画控件 —— 直接把 desktop/floating-widget/widget.html?settings=1
// 嵌进面板，再用 postMessage 顶替 preload 的 ipcRenderer：
//
//   iframe 里的页面 → widget-embed-bridge.js → parent.postMessage
//        → 本模块转成 IPC → 主进程 floating-widget.js → widget 窗口
//   反向：widget 每次 publishSettingsSnapshot → 主进程 → 本模块
//        → iframe 收到 widget-settings-state，画面刷新
//
// 页面本身零改动（除了 head 里多引一个只在 ?embedded=1 生效的桥接脚本）。
// =============================================================================
(function (global) {
  'use strict';

  var FRAME_SRC = '/floating-widget/widget.html?settings=1&embedded=1';
  var bound = false;
  var frameReady = false;
  var requestInFlight = false;
  var lastSnapshot = null;
  var unsubscribe = null;

  function el(id) { return document.getElementById(id); }

  function widgetHost() {
    try {
      if (global.desktopWindow && global.desktopWindow.floatingWidget) return global.desktopWindow.floatingWidget;
    } catch (_) { }
    return null;
  }

  function setLoading(text) {
    var node = el('skin-widget-frame-loading');
    if (!node) return;
    if (!text) { node.hidden = true; return; }
    node.hidden = false;
    node.textContent = text;
  }

  /* 把快照推给 iframe；iframe 还没 ready 就先存着，ready 时补推 */
  function pushStateToFrame(snapshot) {
    if (snapshot) lastSnapshot = snapshot;
    if (!frameReady) return;
    var frame = el('skin-widget-frame');
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({
        __foliaEmbed: 1, kind: 'event',
        channel: 'widget-settings-state',
        payload: lastSnapshot || null
      }, '*');
    } catch (_) { }
  }

  /* 向主进程要一次最新快照：顺带保证 widget 窗口（隐藏）已经起来。
     它是唯一持有配置的地方（存在 widget 窗口的 localStorage 里）。 */
  function requestSnapshot() {
    var host = widgetHost();
    if (!host || typeof host.settingsPanelOpen !== 'function') {
      setLoading('小组件偏好设置仅在桌面客户端可用');
      return;
    }
    if (requestInFlight) return;
    requestInFlight = true;
    host.settingsPanelOpen().then(function (res) {
      requestInFlight = false;
      if (res && res.snapshot) {
        setLoading(null);
        pushStateToFrame(res.snapshot);
      } else {
        setLoading('小组件配置还没就绪，可先点上面的「开启 / 关闭」再回来');
      }
    }).catch(function () {
      requestInFlight = false;
      setLoading('小组件配置读取失败');
    });
  }

  function mountInlineWidgetFrame() {
    var frame = el('skin-widget-frame');
    if (!frame) return;
    if (frame.getAttribute('data-mounted') === '1') {
      // 已经挂过：只补一次状态，避免切 tab 反复重建 iframe（会丢页面内的滚动与分组状态）
      if (frameReady) pushStateToFrame(null);
      return;
    }
    frame.setAttribute('data-mounted', '1');
    setLoading('正在加载小组件偏好设置…');
    frame.addEventListener('load', function () {
      // 同源可读：用来区分「加载成功」和「404 空白页」
      var ok = false;
      try {
        ok = !!(frame.contentDocument && frame.contentDocument.getElementById('sheet'));
      } catch (_) { ok = false; }
      if (!ok) {
        setLoading('偏好设置页没有加载出来，检查 /floating-widget/ 静态路由');
        return;
      }
      setLoading('正在读取小组件配置…');
      requestSnapshot();
    });
    frame.src = FRAME_SRC;
  }

  function bindInlineWidgetSettings() {
    if (bound) return;
    bound = true;

    global.addEventListener('message', function (event) {
      var data = event && event.data;
      if (!data || data.__foliaEmbed !== 1) return;
      var frame = el('skin-widget-frame');
      // 只认自己这个 iframe 发来的消息
      if (frame && event.source && frame.contentWindow && event.source !== frame.contentWindow) return;

      /* iframe 内容高度：父窗把 iframe 拉满，全页只留面板那条滚动条 */
      if (data.kind === 'height') {
        var heightFrame = el('skin-widget-frame');
        var h = Number(data.height);
        if (heightFrame && isFinite(h) && h > 0) {
          heightFrame.style.height = Math.max(360, Math.min(2600, Math.round(h))) + 'px';
        }
        return;
      }

      if (data.kind === 'ready') {
        frameReady = true;
        requestSnapshot();
        return;
      }
      if (data.kind !== 'send') return;

      var host = widgetHost();
      if (data.channel === 'widget-settings-action') {
        if (host && typeof host.applySettings === 'function') {
          host.applySettings(data.payload).catch(function () { });
        }
        return;
      }
      if (data.channel === 'widget-settings-ready') {
        requestSnapshot();
        return;
      }
      if (data.channel === 'widget-settings-close') {
        if (typeof global.closeSkinPopover === 'function') global.closeSkinPopover();
      }
    });

    // widget 每次改设置都会重新上报快照 —— 一路回到 iframe
    var host = widgetHost();
    if (host && typeof host.onSettingsState === 'function' && !unsubscribe) {
      try { unsubscribe = host.onSettingsState(function (state) { pushStateToFrame(state); }); } catch (_) { }
    }
  }

  global.mountInlineWidgetFrame = mountInlineWidgetFrame;
  global.requestInlineWidgetSnapshot = requestSnapshot;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindInlineWidgetSettings);
  } else {
    bindInlineWidgetSettings();
  }
})(window);
