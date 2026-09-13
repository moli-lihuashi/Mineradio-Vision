// ============================================================
//  动态库加载
// ============================================================
function loadScriptOnce(src) {
  return new Promise(function(resolve, reject){
    var hit = document.querySelector('script[data-mr-src="' + src + '"]');
    if (hit) {
      if (hit.getAttribute('data-mr-state') === 'ok') { resolve(); return; }
      if (hit.getAttribute('data-mr-state') === 'error') {
        // 失败过的脚本允许重试：移除旧标签后重新插入
        try { hit.remove(); } catch (_) {}
      } else {
        // 仍在加载中：挂到同一节点
        hit.addEventListener('load', function(){ hit.setAttribute('data-mr-state', 'ok'); resolve(); });
        hit.addEventListener('error', function(){ hit.setAttribute('data-mr-state', 'error'); reject(new Error('SCRIPT_LOAD_FAILED:' + src)); });
        return;
      }
    }
    var sc = document.createElement('script');
    sc.src = src;
    sc.async = true;
    sc.setAttribute('data-mr-src', src);
    sc.onload = function () {
      sc.setAttribute('data-mr-state', 'ok');
      resolve();
    };
    sc.onerror = function () {
      sc.setAttribute('data-mr-state', 'error');
      reject(new Error('SCRIPT_LOAD_FAILED:' + src));
    };
    document.head.appendChild(sc);
  });
}
