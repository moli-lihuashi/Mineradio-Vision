'use strict';

// 洛雪音乐（LX）源脚本运行时 + 音频代理请求头白名单的测试。
//
// 用一段**合成脚本**验证运行时真的能把脚本跑起来（解析元数据、注入 lx、收 inited、
// 响应 request），不涉及任何真实音源，也不联网。
//
// 注意：source-host 在 require 时就算好落盘目录，所以环境变量必须在 require 之前设置。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lx-test-'));
process.env.MINERADIO_LX_SOURCE_DIR = path.join(TMP, 'sources');

const { sanitizeProxyHeaders, encodeHeaderParam, decodeHeaderParam } = require('../server/lib/proxy-headers');
const lxHost = require('../server/lx/source-host');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// 合成脚本：只声明能力并返回固定内容，不含任何真实音源地址
const FIXTURE_SCRIPT = `
/* @name 合成测试音源 */
/* @version 0.0.1 */
/* @author mineradio-test */
const { EVENT_NAMES, on, send } = globalThis.lx
const sources = {
  kw: { name: 'test-kw', type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k', '320k'] },
  kg: { name: 'test-kg', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
}
on(EVENT_NAMES.request, ({ source, action, info }) => {
  if (action === 'lyric') {
    return Promise.resolve({ lyric: '[00:01.00]测试歌词', tlyric: '', rlyric: '', lxlyric: '' })
  }
  if (action === 'musicUrl') {
    return Promise.resolve('https://example.invalid/test.mp3')
  }
  return Promise.reject(new Error('unsupported action'))
})
send(EVENT_NAMES.inited, { status: true, sources })
`;

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { }
});

test('代理请求头白名单：只放行 referer / origin / user-agent', () => {
  const clean = sanitizeProxyHeaders({
    Referer: 'https://a.example/',
    'User-Agent': 'UA/1.0',
    ORIGIN: 'https://a.example',
    Cookie: 'sid=secret',
    Authorization: 'Bearer x',
    'X-Forwarded-For': '1.2.3.4',
  });
  assert.deepEqual(Object.keys(clean).sort(), ['origin', 'referer', 'user-agent']);
  assert.equal(clean.cookie, undefined);
  assert.equal(clean.authorization, undefined);
});

test('代理请求头白名单：拒绝 CRLF 注入与超长值', () => {
  const clean = sanitizeProxyHeaders({
    referer: 'https://ok.example/',
    origin: 'https://ok.example\r\nX-Evil: 1',
    'user-agent': 'x'.repeat(600),
  });
  assert.equal(clean.referer, 'https://ok.example/');
  assert.equal(clean.origin, undefined, 'CRLF 必须被拒');
  assert.equal(clean['user-agent'], undefined, '超长必须被拒');
});

test('请求头参数编解码可往返，坏输入一律当没传', () => {
  const encoded = encodeHeaderParam({ referer: 'https://a.example/', 'user-agent': 'UA/2' });
  assert.ok(encoded);
  assert.deepEqual(decodeHeaderParam(encoded), { referer: 'https://a.example/', 'user-agent': 'UA/2' });
  assert.deepEqual(decodeHeaderParam(''), {});
  assert.deepEqual(decodeHeaderParam('%%%not-base64%%%'), {});
  assert.deepEqual(decodeHeaderParam(Buffer.from('{"cookie":"x"}').toString('base64url')), {});
});

test('运行时能加载合成脚本，并报出它声明的平台与音质', async () => {
  // importSource 返回的是「导入后的运行时快照」：{ok, name, version, sources, installed}
  const imported = await lxHost.importSource(FIXTURE_SCRIPT, 'fixture.js');
  assert.equal(imported.ok, true, '导入应成功');
  assert.equal(imported.name, '合成测试音源');
  assert.ok(Array.isArray(imported.installed) && imported.installed.length === 1, '导入后应有 1 条记录');

  const st = await lxHost.status();
  assert.equal(st.ok, true);
  assert.ok(st.sources.kw, '应声明 kw 源');
  assert.ok(st.sources.kg, '应声明 kg 源');
  // 沙箱里造出来的数组属于另一个 realm，deepEqual 会因原型不同失败，转成本地数组再比
  assert.deepEqual(Array.from(st.sources.kw.qualitys), ['128k', '320k']);
  assert.ok(Array.isArray(st.installed) && st.installed.length === 1);
  assert.equal(st.installed[0].active, true, '导入后应自动成为当前音源');
});

test('自检通过：脚本能初始化，且能响应 request 事件', async () => {
  const st = await lxHost.status();
  const id = st.installed[0].id;
  // checkSources 返回 { ok, checked, installed }
  const result = await lxHost.checkSources([id]);
  assert.equal(result.checked.length, 1);
  assert.equal(result.checked[0].ok, true, '自检应通过：' + JSON.stringify(result.checked[0]));
  // checkSources 的 sources 是平台 key 数组（['kw','kg']），不是对象
  assert.ok(Array.isArray(result.checked[0].sources), 'sources 应是数组');
  assert.ok(result.checked[0].sources.includes('kw'));
  assert.ok(result.checked[0].sources.includes('kg'));
});

test('歌词解析走通脚本的 lyric action', async () => {
  const lyrics = await lxHost.resolveLyrics('kw', { songmid: 'test-1', name: '测试曲' });
  assert.match(lyrics.lyric, /测试歌词/);
});

test('不允许停用最后一个启用的音源（否则等于没有音源）', async () => {
  const st = await lxHost.status();
  const id = st.installed[0].id;
  await assert.rejects(
    () => lxHost.setSourcesEnabled([id], false),
    /LX_SOURCE_AT_LEAST_ONE_ENABLED/,
    '唯一启用的音源被停用时应明确报错，而不是静默变成没有音源'
  );
});

test('删除后列表清空，且不再声称已配置', async () => {
  const st = await lxHost.status();
  await lxHost.deleteSource(st.installed[0].id);
  // 删空之后 lxHost.status() 会因 getRuntime 抛错——「未配置」这个友好分支是路由层包的
  assert.equal(lxHost.listSources().length, 0, '删除后列表应为空');
  await assert.rejects(() => lxHost.status(), /LX_SOURCE_/, '无音源时 status 应明确报错，由路由转成未配置');
});

test('静态守卫：路由已注册、前端已加载、且不内置任何音源脚本', () => {
  const server = read('server.js');
  const loader = read('public/js/index-loader.js');
  const html = read('public/index.html');
  const lxRoute = read('server/routes/lx.js');

  assert.match(server, /require\('\.\/server\/routes\/lx'\)\(routeCtx\)/, 'server.js 必须注册 lx 路由');
  assert.match(loader, /22-lx-source\.js/, 'index-loader 必须加载音源面板');
  // 入口已从顶栏弹层改成歌单面板的页签（用户要求不要新增顶栏图标）
  assert.match(html, /id="lx-pane"/, '页面必须有音源面板容器');
  assert.match(html, /id="tab-lx"[^>]*switchPlaylistTab\('lx'\)/, '歌单面板要有 LX 页签');
  assert.ok(!/id="lx-source-btn/.test(html), '顶栏不应再有独立的音源按钮');
  // 「我的播客」是有实现的功能，不能被替换掉
  assert.match(html, /id="tab-podcast"[^>]*switchPlaylistTab\('podcasts'\)/, '播客页签必须保留');
  assert.ok(!/id="lx-source-popover"/.test(html), '不应再保留独立弹层');
  assert.match(read('public/js/modules/06-lyrics/01-playlist-panel-shell.js'),
    /tab = tab === 'lx' \? 'lx' :/, 'tab 入口归一必须认识 lx（这一行被改掉就等于点了没反应）');
  assert.match(lxRoute, /\/api\/lx-source\/resolve/, '必须有取址接口');

  // 不内置音源：路由与运行时里不应出现具体音源域名
  const builtIn = /(?:kw\.kuwo\.cn|kugou\.com|y\.qq\.com|music\.163\.com|music\.migu\.cn)/;
  assert.ok(!builtIn.test(lxRoute), 'lx 路由不应内置具体平台的接口域名');
});

// ---- 歌曲 → musicInfo 归一（22a） ----
// 这是播放链路能用的前提：LX 源脚本对每个平台期望的 ID 字段不同，传错只会得到「解析失败」。
const LxMusicInfo = require('../public/js/modules/05-playback/22a-lx-music-info');

test('平台映射：只给有对应 LX 源的平台兜底', () => {
  assert.equal(LxMusicInfo.lxSourceKeyForProvider('netease'), 'wy');
  assert.equal(LxMusicInfo.lxSourceKeyForProvider('qq'), 'tx');
  assert.equal(LxMusicInfo.lxSourceKeyForProvider('kugou'), 'kg');
  // LX 生态里没有汽水/Spotify，不能硬编一个源出来
  assert.equal(LxMusicInfo.lxSourceKeyForProvider('qishui'), '');
  assert.equal(LxMusicInfo.lxSourceKeyForProvider('spotify'), '');
  assert.equal(LxMusicInfo.lxSourceKeyForProvider(''), '');
  assert.equal(LxMusicInfo.lxSourceKeyForProvider(undefined), '');
});

test('归一：QQ 传 songmid（+ strMediaMid），不滥填别的 ID', () => {
  const info = LxMusicInfo.buildLxMusicInfo('qq', {
    id: '999', mid: 'MID123', strMediaMid: 'MEDIA9', name: '歌名', singer: '歌手', album: { name: '专辑' },
  });
  assert.equal(info.songmid, 'MID123', 'QQ 的主 ID 是 mid/songmid');
  assert.equal(info.strMediaMid, 'MEDIA9');
  assert.equal(info.hash, undefined, 'QQ 不该带 hash');
  assert.equal(info.name, '歌名');
  assert.equal(info.albumName, '专辑');
});

test('归一：酷狗传 hash（+ albumId）', () => {
  const info = LxMusicInfo.buildLxMusicInfo('kugou', {
    id: '1', hash: 'HASHABC', albumId: 'AL1', name: 'x',
  });
  assert.equal(info.hash, 'HASHABC');
  assert.equal(info.albumId, 'AL1');
  assert.equal(info.songmid, undefined, '酷狗不该带 songmid');
});

test('归一：网易云传 musicId', () => {
  const info = LxMusicInfo.buildLxMusicInfo('netease', { id: 42, name: 'y', albumName: '专辑2' });
  assert.equal(info.musicId, '42');
  assert.equal(info.id, '42');
  assert.equal(info.albumName, '专辑2');
});

test('hasUsableId：三个主 ID 全空就没必要发请求', () => {
  assert.equal(LxMusicInfo.hasUsableId({ name: 'x' }), false);
  assert.equal(LxMusicInfo.hasUsableId({ hash: 'h' }), true);
  assert.equal(LxMusicInfo.hasUsableId({ songmid: 'm' }), true);
  assert.equal(LxMusicInfo.hasUsableId({ musicId: '1' }), true);
  assert.equal(LxMusicInfo.hasUsableId(null), false);
});

test('静态守卫：播放取址链已接入 LX 兜底，且默认开启、可关', () => {
  const registry = read('public/js/modules/05-playback/01-music-provider-registry.js');
  assert.match(registry, /tryLxSourceFallback/, '取址链里必须有兜底函数');
  assert.match(registry, /mineradio-lx-source-fallback/, '兜底开关必须用约定的 storage key');
  assert.match(registry, /getItem\(LX_FALLBACK_STORE_KEY\) !== '0'/, '只有显式关才不兜底（默认开）');
  // 兜底必须在「无 url」和「抛错」两条路上都试过
  assert.match(registry, /if \(data && data\.url\) return data;[\s\S]{0,200}tryLxSourceFallback/, '无直链时要兜底');
  assert.match(registry, /var lxFromError = await tryLxSourceFallback/, '取址抛错时要兜底');
  assert.match(read('public/js/index-loader.js'), /22a-lx-music-info\.js/, 'loader 必须加载归一模块');
  assert.match(read('public/index.html'), /id="lx-source-fallback"/, '面板必须有兜底开关');
});

test('歌词兜底：平台取不到词时才用音源，且不改动有词的情况', () => {
  const lyr = read('public/js/modules/06-lyrics/00-lyrics-fetch-parse.js');
  assert.match(lyr, /function tryLxSourceLyric/, '歌词管道必须有 LX 取词兜底');
  assert.match(lyr, /function lyricResponseHasContent/, '必须有「有没有词」的判定');
  // 只在没词时触发，有词走原路径
  assert.match(lyr, /if \(!lyricResponseHasContent\(r\)\) \{[\s\S]{0,220}tryLxSourceLyric/, '兜底必须在空词分支里');
  // 铁律：合并 script 里同名函数后声明者胜出，fetchLyric 只许有一份
  const defs = (lyr.match(/function fetchLyric\s*\(/g) || []).length;
  assert.equal(defs, 1, 'fetchLyric 只能有一个定义，实际 ' + defs);

  const panel = read('public/js/modules/05-playback/22-lx-source.js');
  assert.match(panel, /async function resolveLyric/, '面板模块必须暴露取词接口');
  assert.match(panel, /'\/api\/lx-source\/lyric'/, '取词必须走已实现的后端端点');
  // lxlyric 是逐字格式，现有管道解析不了，不能偷偷塞进 lyric 字段
  assert.ok(!/lyric:\s*res\.lxlyric/.test(panel), '不能把 lxlyric 当行级歌词');
});

test('汽水死链路已删除：不再导出未启用的扫码/OAuth 换 token 函数', () => {
  const api = read('qishui-api.js');
  assert.ok(!/createQishuiPcQrLogin,/.test(api), 'qishui-api 不该再导出 createQishuiPcQrLogin');
  assert.ok(!/checkQishuiPcQrLogin,/.test(api), 'qishui-api 不该再导出 checkQishuiPcQrLogin');
  assert.ok(!/exchangeQishuiOAuthCode,/.test(api), 'qishui-api 不该再导出 exchangeQishuiOAuthCode');
  assert.match(api, /saveQishuiAccessToken,/, '活着的 token 存取必须保留');
  const auth = read('server/qishui/auth.js');
  assert.match(auth, /function saveQishuiAccessToken/);
  assert.match(auth, /function clearQishuiAccessToken/);
});

test('取址预检：白名单外的域名在取址阶段就报清楚，不拖到播放失败', () => {
  const route = read('server/routes/lx.js');
  assert.match(route, /isAllowedProxyMediaHost/, '取址必须检查代理白名单');
  // 只匹配 ERR_TEXT 里那一处不够弱：响应体必须真的用这个错误码
  assert.match(route, /error:\s*'LX_SOURCE_HOST_NOT_PROXYABLE'/, '取址响应必须用这个错误码');
  // 报错里要带域名和修法，否则用户只看到「播放失败」
  assert.match(route, /不在音频代理白名单里/, '错误文案要说明原因');
  assert.match(route, /PROXY_MEDIA_HOST_SUFFIXES/, '错误文案要给出修法');
  const server = read('server.js');
  assert.match(server, /isAllowedProxyMediaHost/, 'routeCtx 必须注入白名单判定');
});

// ---- 音源面板组件美化：视觉改造不能碰坏交互 ----
test('音源面板美化：交互必需的 id 与动作一个都不能丢', () => {
  const html = read('public/index.html');
  ['lx-pane', 'lx-source-list', 'lx-source-status', 'lx-source-fallback',
   'lx-source-url', 'lx-source-file', 'lx-source-file-name', 'lx-source-summary'].forEach(id => {
    assert.ok(html.includes('id="' + id + '"'), '缺少元素 id: ' + id);
  });
  ['import-url', 'refresh'].forEach(act => {
    assert.ok(html.includes('data-lx-act="' + act + '"'), '缺少动作: ' + act);
  });
  // JS 用 .checked 读写，语义不能变成别的控件
  assert.ok(html.includes('type="checkbox" id="lx-source-fallback"'), '兜底开关必须仍是原生 checkbox');
  assert.ok(html.includes('accept=".js,application/javascript,text/javascript"'), '文件类型限制必须保留');
  assert.ok(html.includes('for="lx-source-file"'), '自定义上传按钮必须用 label for 关联原生 input');
});

test('音源面板美化：原生控件确实被样式接管，且文件名会回显', () => {
  const css = read('public/css/index.css');
  assert.ok(css.includes('appearance:none'), 'checkbox 必须用 appearance:none 变成滑动开关');
  assert.ok(css.includes('input:checked::after'), '开关必须有选中态滑块');
  assert.ok(css.includes('.lx-source-file-picker input[type=file]'), '原生 file input 必须被隐藏');
  assert.ok(css.includes('opacity:0'), '隐藏要用 opacity 保留可访问性，不能用 display:none');
  assert.ok(css.includes('.lx-source-import'), '导入区要有分组容器');
  assert.ok(css.includes('.lx-source-note svg'), '说明提示卡要有图标');
  const js = read('public/js/modules/05-playback/22-lx-source.js');
  assert.ok(js.includes("el('lx-source-file-name')"), '选择文件后要回显文件名');
  assert.ok(js.includes('is-picked'), '选中态要有样式标记');
});

test('美化改动不会被 CSS 磁盘缓存挡住：index.css 版本号必须 bump', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('css/index.css?v=3.0.1-lxui'),
    '改动 index.css 后必须 bump 版本号，否则窗口重新加载会命中旧样式');
  assert.ok(!html.includes('css/index.css?v=3.0.0-modular'), '旧版本号不能残留');
});
