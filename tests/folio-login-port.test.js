'use strict';

// Folia 登录页视觉借鉴 + Spotify「打开浏览器」授权移植回归守。
//
// 关键约束：本项目登录弹窗的 DOM 被 5 家平台共用（#qq-cookie-* 一物四用、
// #qr-shell 三家扫码复用），且 20+ 处单测 / quick-check 静态扫描这些 id。
// 所以这次改造只做「加类 + 加节点 + 加 CSS」，一个旧 id 都不许删。
//
// 守五件事：
//   ① 旧 DOM / onclick / 分支 id 全部保留；
//   ② 左列竖排 + 圆形彩色标记 + 登录状态、右侧 Spotify 浏览器面板都在；
//   ③ syncFolioLoginView 在公共前缀（Qishui / Spotify 提前 return 之前）调用；
//   ④ 系统浏览器授权链路：preload → IPC → main.js shell.openExternal → 同一个回调服务器；
//   ⑤ 旧的应用内窗口授权仍可用（分段控件切换后回落到旧 IPC）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('public/index.html');
const css = read('public/css/08-account/account.css');
const flows = read('public/js/modules/08-account/03-login-modal-flows.js');
const main = read('desktop/main.js');
const preload = read('desktop/preload.js');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '未找到函数 ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数 ' + name + ' 没有闭合');
}

/* ---------------------------------------------------------------- ① 旧链路保护 */
test('① 登录弹窗所有旧 DOM 与 onclick 都还在（改造不得破坏 5 家登录）', () => {
  ['login-modal', 'login-auth-drawer', 'login-modal-title', 'login-modal-desc',
    'qr-status', 'qr-shell', 'qr-img', 'qq-web-login-card', 'qq-cookie-panel',
    'qq-cookie-input', 'qq-cookie-save-btn', 'qq-cookie-toggle-btn', 'refresh-qr-btn',
    'login-account-card', 'login-intro-title', 'login-intro-body', 'login-glow',
    'login-provider-netease', 'login-provider-qq', 'login-provider-kugou',
    'login-provider-qishui', 'login-provider-spotify', 'login-mode-official',
    'login-mode-cookie', 'login-reset-all-btn'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, '#', id, ' 被删掉了');
  });
  assert.match(html, /class="modal dual-login-modal folio-login"/, 'Folia 布局类要挂在弹窗上');
  ['netease', 'qq', 'kugou', 'qishui', 'spotify'].forEach((id) => {
    assert.match(html, new RegExp("onclick=\"selectLoginProviderNode\\('" + id + "'\\)\""), id + ' 的点击链路不能改');
  });
  assert.match(html, /onclick="selectLoginMode\('official'\)"/);
  assert.match(html, /onclick="startSelectedLoginConnection\(\)"/);
  assert.match(flows, /function updateLoginProviderUi\(\)/);
  assert.match(flows, /if \(modal\) modal\.classList\.toggle\('login-modal-logged-in', isLoggedIn\)/);
});

/* ---------------------------------------------------------------- ② 新视觉 */
test('② Folia 风格左列 + 登录状态 + Spotify 浏览器面板', () => {
  assert.equal((html.match(/class="login-provider-state"/g) || []).length, 5, '五家都要有登录状态文字');
  assert.match(html, /id="folio-spotify-hero"/);
  assert.match(html, /class="folio-browser-window"/, '浏览器示意图');
  assert.match(html, /id="folio-spotify-method"/, '授权方式分段控件');
  assert.match(html, /id="folio-spotify-open-btn"[^>]*onclick="openSpotifyExternalBrowserLogin\(\)"/);
  assert.match(css, /#login-modal \.modal\.folio-login\{width:min\(772px/);
  assert.match(css, /#login-modal \.folio-login \.login-content\{padding-left:212px\}/);
  assert.match(css, /flex-direction:column!important;flex-wrap:nowrap;gap:4px/);
  assert.match(css, /border-radius:50%;font-size:11px;font-weight:800/);
  assert.match(css, /#login-modal \.folio-spotify-hero\[hidden\]\{display:none!important\}/);
  assert.match(css, /html body #login-modal \.folio-login \.login-platform-list button\{[\s\S]{0,160}border-radius:11px!important/,
    '左列必须是 11px 小圆角：主题层 prismal-chrome 的 999px 胶囊 !important 会盖掉普通规则');
  assert.match(css, /html body #login-modal \.modal\.folio-login \.login-platform-list button\.active\{[\s\S]{0,160}background:rgba\(255,255,255,\.075\)!important/,
    '选中行用淡底而不是彩色胶囊');
  /* 主题层会给 #login-platform-tabs 注入 .prism-lens-pill 做滑动胶囊高亮，
     竖列下它会和 .active 行叠成两个框，必须关掉 */
  assert.match(css, /html body #login-modal \.modal\.folio-login \.login-platform-list > \.prism-lens-pill\{\s*display:none!important/,
    '竖列下要隐藏主题注入的胶囊高亮层');
  assert.match(css, /login-platform-list button:not\(\.active\)\{[\s\S]{0,120}border-color:transparent!important/,
    '未选中行不能残留 hover / 焦点框');
  assert.match(css, /login-platform-list::-webkit-scrollbar\{[\s\S]{0,60}display:none!important/,
    '滚动条会显示成一条竖直亮块，要藏掉');
});

/* ---------------------------------------------------------------- ③ 公共前缀 */
test('③ syncFolioLoginView 必须在 Qishui / Spotify 提前 return 之前调用', () => {
  const start = flows.indexOf('function updateLoginProviderUi()');
  const common = flows.slice(start, flows.indexOf('if (isQishui)', start));
  assert.match(common, /syncFolioLoginView\(isSpotify\)/, '放在分支后面会被提前 return 跳过');
  assert.match(flows, /function syncFolioLoginView\(isSpotify\)/);
  assert.match(flows, /function selectSpotifyAuthMethod\(method\)/);
  assert.match(flows, /function openSpotifyExternalBrowserLogin\(\)/);
});

/* ---------------------------------------------------------------- ④ 真跑同步函数 */
test('④ 真跑 syncFolioLoginView：面板显隐、登录状态、分段与按钮文案', () => {
  const hero = { hidden: true };
  const note = { textContent: '' };
  const openBtn = { textContent: '' };
  const states = {};
  const seg = [
    { m: 'external', on: false, classList: { toggle: function (c, v) { this.owner.on = !!v; } } },
    { m: 'embedded', on: false, classList: { toggle: function (c, v) { this.owner.on = !!v; } } }
  ];
  seg.forEach((s) => { s.classList.owner = s; s.getAttribute = () => s.m; });
  ['netease', 'qq', 'kugou', 'qishui', 'spotify'].forEach((id) => {
    const state = { textContent: '', on: false, classList: { toggle: function (c, v) { this.owner.on = !!v; } } };
    state.classList.owner = state;
    states[id] = { state, btn: { querySelector: () => state } };
  });
  const byId = {
    'folio-spotify-hero': hero,
    'folio-spotify-note': note,
    'folio-spotify-open-btn': openBtn
  };
  ['netease', 'qq', 'kugou', 'qishui', 'spotify'].forEach((id) => { byId['login-provider-' + id] = states[id].btn; });
  const sandbox = {
    spotifyAuthMethod: 'external',
    hasPlatformLogin: (id) => id === 'kugou',
    document: {
      getElementById: (id) => byId[id] || null,
      querySelectorAll: () => seg
    },
    console
  };
  const code = 'var folioStatusObserver = null;\n' +
    extractFunction(flows, 'watchFolioSpotifyStatus') + '\n' +
    extractFunction(flows, 'syncFolioLoginView') + '\n' +
    extractFunction(flows, 'selectSpotifyAuthMethod') + '\n' +
    'syncFolioLoginView(true);';
  vm.runInNewContext(code, sandbox);
  assert.equal(hero.hidden, false, '选中 Spotify 时浏览器面板要显示');
  assert.equal(states.kugou.state.textContent, '已登录');
  assert.equal(states.spotify.state.textContent, '未登录');
  assert.equal(seg[0].on, true, '默认选中系统浏览器授权');
  assert.match(note.textContent, /系统浏览器/);
  assert.equal(openBtn.textContent, '打开浏览器');

  vm.runInNewContext(code + '\nselectSpotifyAuthMethod("embedded");', sandbox);
  assert.equal(seg[1].on, true, '切到应用内窗口后分段要跟着变');
  assert.equal(openBtn.textContent, '打开登录窗口');
  assert.match(note.textContent, /应用内的登录窗口/);

  const codeOff = code.slice(0, code.lastIndexOf('syncFolioLoginView(true);')) + 'syncFolioLoginView(false);';
  vm.runInNewContext(codeOff, sandbox);
  assert.equal(hero.hidden, true, '非 Spotify 平台必须收起浏览器面板');
});

/* ---------------------------------------------------------------- ⑤ 双授权路径 */
test('⑤ 系统浏览器授权链路完整，旧应用内窗口授权仍可用', () => {
  assert.match(preload, /openSpotifyMusicLoginExternal: \(\) => ipcRenderer\.invoke\('spotify-music-open-login-external'\)/);
  assert.match(main, /ipcMain\.handle\('spotify-music-open-login-external'/);
  assert.match(main, /openSpotifyMusicLoginWindow\(getSenderWindow\(event\), \{ external: true \}\)/);
  assert.match(main, /const external = !!\(options && options\.external\)/);
  assert.match(main, /await shell\.openExternal\(authUrl\)/, '真的把授权页交给系统浏览器');
  assert.match(main, /externalTimer = setTimeout/, '外部浏览器没有窗口可关，要有超时兜底');
  assert.match(main, /callbackServer = await startSpotifyOAuthCallbackServer/, '回调服务器必须保留');
  /* external 分支要在创建 BrowserWindow 之前 return */
  const fnStart = main.indexOf('async function openSpotifyMusicLoginWindow');
  const externalAt = main.indexOf('if (external) {', fnStart);
  const browserAt = main.indexOf('loginWindow = new BrowserWindow({', fnStart);
  assert.ok(externalAt > 0 && browserAt > externalAt, '系统浏览器分支必须排在 Electron 登录窗之前');
  /* 前端按分段选 IPC，且仍保留旧调用 */
  assert.match(flows, /var useExternal = \(spotifyAuthMethod !== 'embedded' && typeof api\.openSpotifyMusicLoginExternal === 'function'\)/);
  assert.match(flows, /useExternal \? api\.openSpotifyMusicLoginExternal\(\) : api\.openSpotifyMusicLogin\(\)/);
  assert.match(flows, /api\.openSpotifyMusicLogin\(\)/, '旧 IPC 不能被删');
});

/* ---------------------------------------------------------------- ⑥ 内置默认身份 */
test('⑥ 没配置任何 env / 文件时也能直接授权，用户配置仍然优先', () => {
  const cfg = read('server/spotify/config.js');
  const http = read('server/spotify/http.js');
  assert.match(cfg, /const SPOTIFY_BUILTIN_CLIENT_ID = '[a-f0-9]{32}'/, '要有内置的桌面客户端 ID');
  assert.match(cfg, /const SPOTIFY_BUILTIN_REDIRECT_URI = 'http:\/\/127\.0\.0\.1:5588\/login'/,
    '内置身份绑定 5588/login，配 43879 会被 Spotify 拒绝');
  assert.match(cfg, /const hasUserConfig = !!\(envClientId \|\| fileConfig\.clientId \|\| envRedirectUri \|\| fileConfig\.redirectUri\)/);
  assert.match(cfg, /const useBuiltin = !hasUserConfig/, '只有用户完全没配置时才用内置值');
  assert.match(cfg, /useBuiltin \? SPOTIFY_BUILTIN_CLIENT_ID/);
  assert.match(cfg, /useBuiltin \? SPOTIFY_BUILTIN_REDIRECT_URI/);
  assert.match(cfg, /builtin: useBuiltin/);
  assert.match(cfg, /useBuiltin \? 'builtin'/);
  assert.match(http, /builtin: !!oauth\.builtin/, '登录状态要把 builtin 透传给前端');
  assert.match(http, /内置桌面客户端身份/, '状态文案不能再提示粘贴 Client ID');
  assert.match(main, /config\.redirectUri \+ '）。'/, '端口占用提示要跟着配置里的回调地址走');
});

/* ---------------------------------------------------------------- ⑦ 默认不粘贴 */
test('⑦ 默认界面不要求粘贴 Client ID，只留一个可选入口', () => {
  assert.match(html, /id="folio-spotify-custom-toggle"/);
  assert.match(html, /id="folio-spotify-client-id"/);
  assert.match(css, /#login-modal \.folio-login\.login-provider-spotify #qq-cookie-panel\{display:none!important\}/,
    '旧的四家共用输入框默认要收起');
  assert.match(flows, /function toggleFolioSpotifyCustom\(\)/);
  assert.match(flows, /function saveFolioSpotifyCustomClientId\(\)/);
  assert.match(flows, /if \(info\.builtin\) return 'Spotify 已就绪/);
  assert.match(flows, /refreshBtn\.onclick = openSpotifyWebLogin;/);
  assert.doesNotMatch(flows, /refreshBtn\.onclick = spotifyLoginStatus\.oauthConfigured \? openSpotifyWebLogin : submitSpotifyConfigLogin/,
    '不能再把主按钮绑回「保存并授权」');
  assert.match(html, /选择授权方式/, '步骤文案不能还写「填写 Client ID」');
  /* 从扫码平台切过来时，上一家 refreshQr 的异步回调会把「扫码」文案写回状态行 */
  assert.match(flows, /function watchFolioSpotifyStatus\(\)/, '需要观察器纠正迟到的扫码文案');
  assert.match(flows, /if \(isSpotify\) watchFolioSpotifyStatus\(\);/, '切到 Spotify 时必须挂上观察器');
});
