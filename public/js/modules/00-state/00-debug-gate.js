'use strict';

// 生产环境 console 静音门控
// 默认静音 console.log/debug/info（噪音）；保留 console.warn/error 用于真异常。
// 开启调试：localStorage.setItem('mineradio_debug', '1') 后刷新。
// 关闭调试：localStorage.removeItem('mineradio_debug') 后刷新。
(function muteConsoleInProduction() {
  try {
    var debug = (typeof localStorage !== 'undefined' && localStorage.getItem('mineradio_debug') === '1');
    if (!debug && typeof console !== 'undefined') {
      var noop = function () {};
      console.log = noop;
      console.debug = noop;
      console.info = noop;
      // 保留 console.warn / console.error
    }
  } catch (_) {}
})();
