// =============================================================================
// 打包版内可见诊断入口
//
// 桌面构建没有常开的 DevTools 控制台。在控制台里执行：
//     await mineradioDiagnostics()
// 返回值就是完整报告对象（构建溯源 + 连接层记录 + 运行日志），
// 不依赖 console.log —— 生产态的 console.log 被 00-debug-gate 静音了。
// =============================================================================

(function (global) {
  'use strict';

  async function readToken() {
    try {
      if (global.desktopWindow && typeof global.desktopWindow.fetchApiToken === 'function') {
        const token = await global.desktopWindow.fetchApiToken();
        if (token) return String(token);
      }
    } catch (_) {}
    if (global.__MINERADIO_API_TOKEN__) return String(global.__MINERADIO_API_TOKEN__);
    try {
      if (global.desktopWindow && typeof global.desktopWindow.getApiToken === 'function') {
        const cached = global.desktopWindow.getApiToken();
        if (cached) return String(cached);
      }
    } catch (_) {}
    return '';
  }

  async function getJson(url, token) {
    const headers = {};
    if (token) headers['X-Mineradio-Token'] = token;
    const res = await global.fetch(url, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url);
    return res.json();
  }

  global.mineradioDiagnostics = async function mineradioDiagnostics() {
    const token = await readToken();
    const [build, network, logs] = await Promise.all([
      getJson('/api/debug/build', token),
      getJson('/api/debug/network?limit=200', token),
      getJson('/api/debug/logs?limit=300', token),
    ]);
    const hints = Array.isArray(build && build.hints) ? build.hints.slice() : [];
    if (network && Array.isArray(network.entries)) {
      const failures = network.entries.filter(function (e) {
        return !!e.error || (e.status != null && e.status >= 400);
      });
      if (failures.length) hints.push('连接层有 ' + failures.length + ' 条失败记录，见 network.entries。');
    }
    /* 当前曲目的源指纹，以及上一次换链到底有没有换到新链接。
       只有「换了源还是不行」才该劝用户升级音质，这条信息直接决定提示该怎么写。 */
    let playbackSource = null;
    try {
      if (typeof global.playbackSourceRevisionSnapshot === 'function') {
        playbackSource = global.playbackSourceRevisionSnapshot();
      }
    } catch (_) {}
    if (playbackSource && playbackSource.changedAfterRecovery === false) {
      hints.push('上一次重新取链拿回的是同一枚链接（源没轮换），失败原因不在取链环节。');
    }
    const report = { build: build, network: network, logs: logs, playbackSource: playbackSource, hints: hints };
    // warn 未被生产门控静音：给控制台里的人一个明确的「拿到了」信号。
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[MineradioDiagnostics] 报告已取到，本表达式的返回值即完整对象。');
    }
    return report;
  };

  /* 分层网络自检（要跑 5~10 秒，所以不并进上面的默认报告，得单独调）：
       await mineradioSelfCheck()
       await mineradioSelfCheck({ hosts: ['gateway.kugou.com'] }) */
  global.mineradioSelfCheck = async function mineradioSelfCheck(options) {
    const opts = options || {};
    const token = await readToken();
    const params = new URLSearchParams();
    if (Array.isArray(opts.hosts) && opts.hosts.length) params.set('hosts', opts.hosts.join(','));
    if (opts.timeoutMs) params.set('timeoutMs', String(opts.timeoutMs));
    const query = params.toString();
    const report = await getJson('/api/debug/self-check' + (query ? '?' + query : ''), token);
    return report;
  };
})(typeof window !== 'undefined' ? window : globalThis);
