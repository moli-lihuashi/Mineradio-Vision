'use strict';

// 平台接口覆盖率守：前端调用的每个平台接口，服务端必须有对应路由。
//
// 起因（2026-11-12）：用户问「我们的每个平台接口有没有 Folia 全」，实测发现
//   前端 05-playback/05-home-track-detail.js 早就在请求
//     /api/album?id=            （网易云专辑详情）
//     /api/qq/album/detail?mid= （QQ 专辑详情）
//   而服务端从来没注册这两个路由 → 点「专辑」永远显示「专辑详情加载失败」。
// 这类缺口静态就能查出来：把前端字符串字面量与服务端 `pn === '...'` 全量对账。
//
// 守三件事：
//   ① 前端每个 `/api/**` 字面量都必须能在服务端找到路由（除非在已知外部白名单里）；
//   ② 补上的两个专辑路由必须真的接到实现函数，不是空壳；
//   ③ 五家平台的核心能力（搜索/取址/歌词/歌单/登录）一条都不许少。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* 递归收集目录下的 .js 文本 */
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const frontSrc = walk(path.join(root, 'public', 'js'), [])
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const serverSrc = walk(path.join(root, 'server'), [])
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n') + read('server.js');

/* 前端形如 '/api/xxx?y=' 或 '/api/xxx' 的字面量；去掉 query 后归一化 */
const frontPaths = new Set();
for (const m of frontSrc.matchAll(/['"](\/api\/[A-Za-z0-9/_.-]+)/g)) {
  frontPaths.add(m[1].replace(/\/$/, ''));
}

/* 服务端注册的路由（pn === '/api/...'） */
const serverPaths = new Set();
for (const m of serverSrc.matchAll(/pn\s*===\s*'(\/api\/[A-Za-z0-9/_.-]+)'/g)) {
  serverPaths.add(m[1]);
}

/* 少数路径不是「平台接口」，而是服务自身的内部端点（诊断 / 静态 / 更新检查） */
const EXTERNAL_OK = new Set([
  '/api/health', '/api/log', '/api/debug', '/api/update', '/api/ai',
]);

function normalize(p) {
  /* /api/login/qr/check?key= 已被正则截到不带 query */
  return p.replace(/\/+$/, '');
}

test('① 前端调用的每个 /api 路径，服务端都有路由', () => {
  const missing = [];
  for (const raw of frontPaths) {
    const p = normalize(raw);
    if (serverPaths.has(p)) continue;
    if (EXTERNAL_OK.has(p)) continue;
    missing.push(p);
  }
  assert.deepEqual(missing, [], '以下接口前端在调用、服务端没有实现：' + missing.join(', '));
});

test('② 两个补上的专辑路由必须真的接到实现', () => {
  const neteaseRoute = read('server/routes/netease.js');
  const qqRoute = read('server/routes/qq.js');
  const qqContent = read('server/lib/qq-content.js');

  assert.match(neteaseRoute, /if \(pn === '\/api\/album'\)/, '网易云专辑详情路由要注册');
  assert.match(neteaseRoute, /await netease_album\(/, '必须真的调底层 album()');
  assert.match(neteaseRoute, /album_sub, album_sublist, netease_album/, 'ctx 里要注入 netease_album');

  assert.match(qqRoute, /if \(pn === '\/api\/qq\/album\/detail'\)/, 'QQ 专辑详情路由要注册');
  assert.match(qqRoute, /await handleQQAlbumDetail\(mid, limit\)/, '必须真的调实现函数');
  assert.match(qqRoute, /handleQQArtistDetail, handleQQAlbumDetail, handleQQSongComments/,
    'ctx 里要注入 handleQQAlbumDetail');
  assert.match(qqContent, /async function handleQQAlbumDetail\(mid, limit\)/);
  assert.match(qqContent, /music\.musichallAlbum\.AlbumSongList/, '曲目走 AlbumSongList');
  assert.match(qqContent, /music\.musichallAlbum\.AlbumInfoServer/, '专辑信息走 AlbumInfoServer');
  /* 真实结构（抓包确认）：albumInfo.data = { basicInfo, company, singer, extra }
     - 专辑名 / 发行日 / 简介在 basicInfo 里，不在 data 顶层；
     - 歌手在 data.singer.singerList 里，不在 basicInfo 里。
     读错层级会得到「专辑名空、歌手空」但接口 200 的假成功。 */
  assert.match(qqContent, /infoBlock\.basicInfo \|\| infoBlock/, '必须优先读 basicInfo');
  /* 断言要精确到「从哪个对象取 singer」：只查 singerBlock.singerList 存在不够，
     把来源改成 basic.singer 后字符串仍在，测试会漏（已用变异验证过）。
     所以这里匹配完整的赋值语句。 */
  assert.match(qqContent, /const singerBlock = infoBlock && infoBlock\.singer;/,
    '歌手要读 data.singer.singerList（不在 basicInfo 里）');
  assert.match(qqContent, /Array\.isArray\(singerBlock\.singer_list\)\) \? singerBlock\.singer_list/,
    'singer.singerList 是真实字段名');
  assert.match(qqContent, /basic\.albumName \|\| basic\.name/, '专辑名在 basicInfo.albumName');
  assert.match(qqContent, /handleQQAlbumDetail,/, '要导出给路由用');

  const serverJs = read('server.js');
  assert.match(serverJs, /const netease_album = _lazyFn\(_neteaseMod, 'album'\)/, '要定义 netease_album');
  /* 定义在文件顶层还不够：必须真的进 routeCtx，否则路由解构到 undefined，
     运行时才炸。这里同时校验「定义」与「注入」两处。 */
  assert.match(serverJs, /album_sub, album_sublist, netease_album, playlist_subscribe/,
    'netease_album 必须进 routeCtx，否则 router 解构到 undefined');
  assert.equal((serverJs.match(/handleQQAlbumDetail/g) || []).length, 2,
    'server.js 的 deps 与 routeCtx 各注入一次');
});

test('③ 五家平台的核心能力一条都不许少', () => {
  const required = {
    netease: ['/api/search', '/api/song/url', '/api/lyric', '/api/user/playlists', '/api/login/status'],
    kugou: ['/api/kugou/search', '/api/kugou/song/url', '/api/kugou/lyric', '/api/kugou/user/playlists', '/api/kugou/login/status'],
    qq: ['/api/qq/search', '/api/qq/song/url', '/api/qq/lyric', '/api/qq/user/playlists', '/api/qq/login/status'],
    qishui: ['/api/qishui/search', '/api/qishui/song/url', '/api/qishui/lyric', '/api/qishui/user/playlists', '/api/qishui/login/status'],
    spotify: ['/api/spotify/search', '/api/spotify/song/url', '/api/spotify/lyric', '/api/spotify/user/playlists', '/api/spotify/status'],
  };
  for (const [provider, paths] of Object.entries(required)) {
    for (const p of paths) {
      assert.ok(serverPaths.has(p), provider + ' 缺少核心路由 ' + p);
    }
  }
});

test('④ 与 Folia 的能力差距是逐项核实过的，不靠推断', () => {
  /* 2026-11-12 逐项读代码核实后的结论（不是照抄 Folia 的 capabilities 声明）。
     上一轮凭 Folia 声明推断出「网易云每日推荐、酷狗私人FM 缺失」，
     实际两者都已实现（recommend_songs / fetchKugouFmRecommendations）。
     这里把「确认真缺」与「确认已有」都写成断言，防止清单再次失真。 */
  const trulyMissing = {
    /* 2026-11-13 核对 Folia 源码 kugouProvider.ts capabilities 后，酷狗/QQ 的
       榜单、主题歌单、MV、评论 Folia 自己也没有（capabilities 里没有 toplist/theme/mv/comment），
       所以它们不是「Folia 全、我们缺」的差距，从缺口清单删除。
       2026-11-12 批次1：网易云这组 5 项已全部真接入（server/netease/extras.js），
       改由下面的正向断言守「不许退回空壳」。 */
    netease: [],
    kugou: [],
    qq: [],
  };

  const neteaseSrc = read('server/routes/netease.js') + read('server.js') + read('server/netease/extras.js');
  // 真接入断言必须只盯实现文件：server/routes/netease.js 里另有播客搜索的
  // await cloudsearch(，用合并文本匹配会放过「分类搜索被掏空」（变异 M19 实测漏报）。
  const neteaseExtrasSrc = read('server/netease/extras.js');
  const kugouSrc = read('server/routes/kugou.js') + walk(path.join(root, 'server', 'kugou'), [])
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const qqSrc = read('server/lib/qq-content.js') + read('server/routes/qq.js');

  /* ① 标为「缺」的，代码里确实找不到对应实现方法名 */
  for (const key of trulyMissing.netease) {
    assert.ok(neteaseSrc.indexOf(key) < 0, 'netease ' + key + ' 若已实现，请从缺口清单移除');
  }

  /* ①' 批次1 的真接入断言：路由注册 + 实现里真的 await 了上游方法，两处都要在。
        只查路径会放过「注册了但固定返回空」的空壳（本项目已经踩过三次）。
        合成正例的返回体断言在 tests/netease-extras.test.js。 */
  const neteaseImplemented = [
    ['/api/personal/fm', 'personal_fm'],
    ['/api/user/cloud', 'user_cloud'],
    ['/api/user/listen/rank', 'user_record'],
    ['/api/recommend/history', 'history_recommend_songs'],
    ['/api/scrobble', 'scrobble'],
    ['/api/explore/home', 'homepage_block_page'],
    ['/api/artist/albums', 'artist_album'],
    ['/api/user/albums', 'album_sublist'],
    ['/api/search/collections', 'cloudsearch'],
    ['/api/playlist/remove-song', 'playlist_tracks'],
  ];
  for (const [route, upstream] of neteaseImplemented) {
    assert.ok(serverPaths.has(route), '网易云 ' + route + ' 必须注册路由');
    assert.match(neteaseExtrasSrc, new RegExp('await ' + upstream + '\\('),
      '网易云 ' + route + ' 必须真的 await 上游 ' + upstream + '，不许是空壳');
  }

  /* ② 上一轮误报为缺、实际已实现的能力，必须有明确实现（写死防回退）。
     要求函数名后紧跟 `(`：改名成 fetchKugouFmRecommendationsX(...) 会因为
     中间隔着 X 而不再匹配（`\b` 挡不住这种前缀绕过，已用变异验证）。 */
  assert.match(neteaseSrc, /\brecommend_songs\(/, '网易云每日推荐已实现（recommend_songs）');
  assert.match(kugouSrc, /\bfetchKugouFmRecommendations\(/, '酷狗私人FM已实现');

  /* ③ 探索页：批次1 之前前端没有音乐探索入口，唯一命中是 Windows 资源管理器的
     desktop overlay。批次1 接了网易云探索页后，20-netease-features.js 成为第二个
     合法命中；同时要求它真的调用 /api/explore/home，防止「文件名在但实现被掏空」。
     再新增别的探索页时，这条会红，提醒同步清单。 */
  const exploreHits = [];
  for (const f of walk(path.join(root, 'public', 'js'), [])) {
    if (/explore/i.test(fs.readFileSync(f, 'utf8'))) exploreHits.push(path.basename(f));
  }
  assert.deepEqual(exploreHits.sort(), [
    '04-desktop-overlay-fullscreen.js',
    '20-netease-features.js',
    '21-platform-extras.js',
  ], '只允许资源管理器、网易云探索面板与统一平台能力面板含 explore 字样；若新增探索页请同步本条');
  assert.match(read('public/js/modules/10-shell/04-desktop-overlay-fullscreen.js'),
    /desktopUsesLayeredExplorerColorkey/,
    '那条命中必须确实是 Windows 资源管理器分支，不是音乐探索页');
  assert.match(read('public/js/modules/05-playback/20-netease-features.js'),
    /\/api\/explore\/home/,
    '网易云探索面板必须真的调探索接口');
  assert.match(read('public/js/modules/05-playback/21-platform-extras.js'),
    /\/api\/spotify\/explore\/categories/,
    '批次5 的 Spotify 探索分类必须真的出现在前端入口里');
});

test('⑥ QQ 推荐不得退回固定空数组；红心签名通道不许被硬接', () => {
  // 2026-11-12 批次2：/api/qq/recommendations 原是固定 songs:[] 的空壳，
  // 已换成 music.radioProxy.MbTrackRadioSvr/get_radio_track 的真实推荐。
  const qqRoute = read('server/routes/qq.js');
  const qqExtras = read('server/qq/extras.js');
  const accountActions = read('public/js/modules/05-playback/06c-account-actions.js');

  assert.ok(!/当前版本没有可验证的 QQ 音乐推荐接口/.test(qqRoute),
    'QQ 推荐不许再退回「没有可验证接口」的空态');
  assert.match(qqRoute, /extras\.guessYouLike\(/, 'QQ 推荐必须走真实实现');
  // 精确到「真的 await 了上游调用」，只查字符串会被注释里的同名文本蒙过去。
  assert.match(qqExtras, /await call\('music\.radioProxy\.MbTrackRadioSvr', 'get_radio_track'/);
  assert.match(qqExtras, /success: false, error: 'QQ_LIKED_SONGS_SIGNATURE_REQUIRED'/,
    '红心歌单 dirId 201 必须明确判失败，不许假装写入成功');

  // 账号写回只放开可验证的部分：新建歌单 + 歌单增删；红心保持关闭。
  const qqAdapter = accountActions.slice(accountActions.indexOf('qq: {'), accountActions.indexOf('};', accountActions.indexOf('qq: {')));
  assert.match(qqAdapter, /createPlaylist: true/);
  assert.match(qqAdapter, /like: false/);
  assert.match(qqAdapter, /unsupportedMessage/);
});

test('⑦ 酷狗专辑详情链路不许退回「暂不支持」空态', () => {
  // 批次3：/api/kugou/album/detail 接公开移动端接口，前端 05-home-track-detail.js
  // 的酷狗分支必须能拿到 { album, songs }。
  const detail = read('public/js/modules/05-playback/05-home-track-detail.js');
  const extras = read('server/kugou/extras.js');
  assert.ok(!/酷狗暂不支持按当前音源打开完整专辑详情/.test(detail), '前端不许再写死酷狗不支持专辑详情');
  assert.match(detail, /\/api\/kugou\/album\/detail\?albumId=/);
  assert.match(extras, /await mobileJson\('album\/info'/);
  assert.match(extras, /await mobileJson\('album\/song'/);
});

test('⑧ 批次4：Spotify/汽水新增能力不许退回空态，汽水不许加回假回退', () => {
  const spotify = read('server/spotify/extras.js');
  const qishui = read('server/qishui/extras.js');
  const loader = read('public/js/index-loader.js');
  assert.match(spotify, /userGet\('\/me\/albums'/);
  assert.match(spotify, /'\/artists\/' \+ encodeURIComponent\(artistId\) \+ '\/albums'/);
  assert.match(spotify, /'DELETE', \{\}, \{ tracks: uris/);
  assert.match(qishui, /\/luna\/pc\/search\/playlist/);
  // 注释里会提到这个端点，所以只检查「真的发起了请求」这一种形态。
  assert.ok(!/webRequestJson\('\/luna\/pc\/search\/mixed'/.test(qishui),
    '混合搜索回退实测 ERR_INVALID_PARAM，不许再加回一个假装可用的回落');
  assert.match(loader, /21-platform-extras\.js/);
});

/* ---------------------------------------------------------------- ⑤ 代码侧防回退 */
// 原来的 ⑤ 依赖 docs/feature-gaps-vs-folia.md 与 feature-gap-removal-checklist.md；
// 这两份对比清单已于 2026-11-13 按要求删除（备份在 .workbuddy/archive/2026-11-13-folia-gap-docs/）。
// 其中「靠文档约束代码」的断言改为直接断言代码本身——不依赖任何文档也能防回退。
test('⑤ 代码侧防回退：已实现的能力不许被删、标不适用的不许偷加', () => {
  /* 网易云日推是真实实现（批次1）：上游调用没了就说明功能被回退 */
  assert.match(read('server.js'), /\brecommend_songs\(/, '网易云日推（recommend_songs）必须在');

  /* 酷狗 MV 在 Folia 的能力表里是「不适用」，本项目也不该出现这条路由 */
  assert.ok(!/pn === '\/api\/kugou\/mv/.test(read('server/routes/kugou.js')),
    '酷狗 MV 属不适用，不该有路由');
});

test('⑨ 汽水扫码状态收敛：双形态统一映射，error_code 7 不再被断言成限流', () => {
  const route = read('server/routes/qishui.js');
  const front = read('public/js/modules/08-account/03-login-modal-flows.js');
  const qrStatus = read('server/qishui/qr-status.js');

  // 路由必须走统一映射，不许再手写 if 链
  assert.match(route, /mapQishuiQrStatus\(\{\s*status:\s*data\.status,\s*errorCode\s*\}\)/,
    'routes/qishui.js 必须调用 mapQishuiQrStatus 做状态归一');

  // 数字形态必须保留（qishui-auth-v6.js:828 同时判过 '3'，说明数字真实存在）
  assert.match(qrStatus, /'2':\s*'scanned'/, '数字 2 → scanned 不是死代码，必须保留');
  assert.match(qrStatus, /'3':\s*'confirmed'/, '数字 3 → confirmed 必须保留');

  // 「限流」这个被证伪的语义不许再作为状态名出现
  assert.ok(!/rate_limited/.test(route), 'routes/qishui.js 不许再产出 rate_limited');
  assert.ok(!/'rate_limited'/.test(qrStatus), 'qr-status.js 不许再造 rate_limited 状态名');
  assert.match(front, /qsStatus === 'upstream_code_7'/, '前端必须认新的中性状态名');
  assert.ok(!/qsStatus === 'rate_limited'/.test(front), '前端不该再认 rate_limited');
});
