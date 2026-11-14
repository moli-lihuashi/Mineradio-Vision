// =============================================================================
// 「关于」面板 —— 把已有的 build-provenance 溯源显示给用户
//
// 用户报 issue 时至少要能回答「你用的是哪次构建」：
//   版本 / 完整 commit / 构建时间，三项都来自随包发布的
//   build/build-provenance.json（由 scripts/write-build-provenance.js 构建时写入），
//   运行时再经 /api/debug/build 校验源码与打包副本是否一致。
//
// 用事件委托绑定，不依赖 DOM 就绪时机；顶层不做任何重活。
// =============================================================================
(function (global) {
  'use strict';

  function aboutReadToken() {
    try {
      if (global.desktopWindow && typeof global.desktopWindow.getApiToken === 'function') {
        const t = global.desktopWindow.getApiToken();
        if (t) return String(t);
      }
    } catch (_) { }
    if (global.__MINERADIO_API_TOKEN__) return String(global.__MINERADIO_API_TOKEN__);
    return '';
  }

  function aboutSet(id, text, title) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(text == null ? '—' : text);
    if (title) el.title = title;
  }

  function aboutFormatTime(iso) {
    if (!iso) return '未记录（源码树直接运行）';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString('zh-CN', { hour12: false }) + ' (' + iso + ')';
    } catch (_) { return iso; }
  }

  function aboutFallbackVersion() {
    const html = document.documentElement;
    return (html && html.getAttribute('data-app-version')) || '—';
  }

  function aboutRender(data) {
    const build = data && data.build;
    aboutSet('about-version', 'v' + (build && build.version ? build.version : (data && data.version) || aboutFallbackVersion()));
    const sha = build && build.commit && build.commit !== 'unknown' ? build.commit : (data && data.commit) || '';
    aboutSet('about-commit', sha ? sha.slice(0, 12) + ' …' : '—', sha);
    aboutSet('about-built-at', build ? aboutFormatTime(build.builtAt) : '未记录（源码树直接运行）');
    const clean = build ? (build.treeClean ? '干净' : '含未提交改动') : '未知';
    aboutSet('about-tree', clean);
    const dist = data && data.dist;
    aboutSet('about-dist', dist ? (dist.present ? (dist.synced ? '一致' : '不一致 · ' + (dist.mismatches || []).length + ' 个文件') : '无打包副本') : '未知');
    global.__mineradioAboutBuild = {
      version: (build && build.version) || (data && data.version) || aboutFallbackVersion(),
      commit: sha,
      builtAt: (build && build.builtAt) || '',
      treeClean: clean,
    };
  }

  async function aboutLoad() {
    aboutSet('about-commit', '读取中…');
    aboutSet('about-built-at', '读取中…');
    try {
      const headers = {};
      const token = aboutReadToken();
      if (token) headers['X-Mineradio-Token'] = token;
      const res = await global.fetch('/api/debug/build', { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      aboutRender(await res.json());
    } catch (err) {
      aboutRender(null);
      aboutSet('about-commit', '读取失败');
      aboutSet('about-built-at', 'HTTP 接口不可用：' + String(err && err.message || err));
    }
  }

  global.openAboutPanel = function openAboutPanel() {
    const mask = document.getElementById('about-modal');
    if (!mask) return;
    if (typeof global.closePlayerQuickMenu === 'function') global.closePlayerQuickMenu();
    mask.classList.add('show');
    aboutLoad();
  };

  global.closeAboutPanel = function closeAboutPanel(event) {
    if (event && event.target && event.target.id !== 'about-modal') return;
    const mask = document.getElementById('about-modal');
    if (mask) mask.classList.remove('show');
  };

  global.copyAboutBuildInfo = function copyAboutBuildInfo() {
    const b = global.__mineradioAboutBuild || { version: aboutFallbackVersion() };
    const text = [
      'Mineradio Vision v' + b.version,
      '构建自 commit ' + (b.commit || 'unknown'),
      '构建时间 ' + (b.builtAt || 'unknown'),
    ].join('\n');
    try {
      if (global.navigator && global.navigator.clipboard) {
        global.navigator.clipboard.writeText(text).then(function () {
          if (typeof global.showToast === 'function') global.showToast('构建信息已复制');
        }).catch(function () { });
      }
    } catch (_) { }
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const mask = document.getElementById('about-modal');
      if (mask && mask.classList.contains('show')) global.closeAboutPanel();
    }
  });
})(window);
