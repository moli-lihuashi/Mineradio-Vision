'use strict';

/* 搜索「以登录平台为优先」回归守（2026-11-26）。
 *
 * 需求：搜索音乐时，结果要以当前登录账号所在平台为优先。
 * 落点：
 *   - All（混合）搜索并入当前登录平台（酷狗/汽水/Spotify 未登录不给搜：取址必失败）
 *   - 该平台的结果整体上浮（MUSIC_SEARCH_PREFERRED_BOOST），但小于翻唱/伴奏扣分
 *   - 未登录不设优先：平台集合与排序保持原样，不能把匿名网易云当「登录平台」
 *   - 一次搜索（含加载更多）查同一批平台：集合在会话开始时快照进 state.providers
 *
 * 登录态只经判定函数注入（hasPlatformLogin / firstLoggedProvider），不去改状态对象。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const searchPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '07-search.js');
const source = fs.readFileSync(searchPath, 'utf8');

function namedFunctionSource(name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `missing ${name}()`);
  const bodyStart = source.indexOf('{', declaration.index + declaration[0].length);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(declaration.index, i + 1);
    }
  }
  throw new Error(`unterminated ${name}()`);
}

/* 常量直接取源码原文：测试里再写一份迟早和实现漂移 */
const EXTRA_DECL = source.match(/var MUSIC_SEARCH_MIXED_EXTRA_PROVIDERS = \[[^\]]*\];/)[0];
const BOOST_DECL = source.match(/var MUSIC_SEARCH_PREFERRED_BOOST = \d+;/)[0];

const PROVIDER_ORDER = ['netease', 'qq', 'kugou', 'qishui', 'spotify'];

/* login: { kugou: true } 这样的已登录表；active 为当前账号平台（未给则按真实优先级推） */
function loginEnv(login, active) {
  login = login || {};
  return {
    hasPlatformLogin(provider) { return !!login[provider]; },
    firstLoggedProvider() {
      if (active && login[active]) return active;
      for (const provider of PROVIDER_ORDER) if (login[provider]) return provider;
      return 'netease';
    },
    normalizeMusicProviderKey(provider) {
      return PROVIDER_ORDER.indexOf(provider) >= 0 ? provider : 'netease';
    },
    songProviderKey(song) { return (song && song.provider) || 'netease'; },
  };
}

function runProviders(mode, env) {
  const sandbox = Object.assign({ console }, env);
  vm.runInNewContext(
    [EXTRA_DECL, namedFunctionSource('searchPreferredProvider'), namedFunctionSource('musicSearchProvidersForMode'),
      '\nthis.build = musicSearchProvidersForMode; this.preferred = searchPreferredProvider;'].join('\n'),
    sandbox
  );
  return { providers: sandbox.build(mode), preferred: sandbox.preferred() };
}

test('未登录：All 搜索仍是 网易云 + QQ，不设优先平台', () => {
  const got = runProviders('song', loginEnv({}));
  assert.deepEqual(Array.from(got.providers), ['netease', 'qq'], '未登录不得把匿名网易云当登录平台加入优先');
  assert.equal(got.preferred, '', '未登录必须没有优先平台（否则默认排序被悄悄改掉）');
});

test('登录平台进 All 搜索（顺序保持 网易云 → QQ → 优先平台，偏好靠分数表达）', () => {
  assert.deepEqual(Array.from(runProviders('song', loginEnv({ kugou: true })).providers), ['netease', 'qq', 'kugou']);
  assert.deepEqual(Array.from(runProviders('song', loginEnv({ qishui: true })).providers), ['netease', 'qq', 'qishui']);
  assert.deepEqual(Array.from(runProviders('song', loginEnv({ spotify: true })).providers), ['netease', 'qq', 'spotify']);
  assert.deepEqual(Array.from(runProviders('song', loginEnv({ qq: true })).providers), ['netease', 'qq']);
  assert.deepEqual(Array.from(runProviders('song', loginEnv({ netease: true })).providers), ['netease', 'qq']);
});

test('多平台同时登录：优先当前账号平台（activeAccountProvider）', () => {
  const got = runProviders('song', loginEnv({ netease: true, qq: true }, 'qq'));
  assert.equal(got.preferred, 'qq');
  assert.deepEqual(Array.from(got.providers), ['netease', 'qq']);
});

test('单平台标签不受登录态影响', () => {
  assert.deepEqual(Array.from(runProviders('kugou', loginEnv({ kugou: true })).providers), ['kugou']);
  assert.deepEqual(Array.from(runProviders('kugou', loginEnv({})).providers), ['kugou']);
});

function runMerge(env, groups, q) {
  const sandbox = Object.assign({
    console,
    scoreSongSearchResult(song) { return song && song._base != null ? song._base : 100; }, // 基础分自带，差异只来自优先平台上浮
  }, env);
  vm.runInNewContext(
    [EXTRA_DECL, BOOST_DECL,
      namedFunctionSource('simpleSearchNorm'),
      namedFunctionSource('searchMentionsKnownArtist'),
      namedFunctionSource('searchPreferredProvider'),
      namedFunctionSource('searchPrimaryArtistNorm'),
      namedFunctionSource('searchTrackSignature'),
      namedFunctionSource('searchArtistNamesOverlap'),
      namedFunctionSource('searchPreferredBoostApplies'),
      namedFunctionSource('mergeSongSearchResults'),
      '\nthis.merge = mergeSongSearchResults;'].join('\n'),
    sandbox
  );
  return Array.from(sandbox.merge(groups, 99, q || '晴天'), (song) => song.provider + ':' + song.id);
}

test('登录平台上的同一首歌排最前（多平台都有时用账号那家）', () => {
  const netease = [{ provider: 'netease', id: 'ne1', name: '晴天', artist: '周杰伦' }];
  const qq = [{ provider: 'qq', id: 'qq1', name: '晴天', artist: '周杰伦' }];
  const kugou = [{ provider: 'kugou', id: 'kg1', name: '晴天', artist: '周杰伦' }];

  assert.deepEqual(runMerge(loginEnv({ kugou: true }), [netease, qq, kugou]),
    ['kugou:kg1', 'netease:ne1', 'qq:qq1']);

  // 未登录：不加分，按入参顺序（保持旧行为）
  assert.deepEqual(runMerge(loginEnv({}), [netease, qq]),
    ['netease:ne1', 'qq:qq1']);
});

test('只有同题同艺人（或查询点名艺人）才上浮：优先平台的翻唱不能顶掉别家原唱', () => {
  const neteaseOriginal = [{ provider: 'netease', id: 'ne1', name: '晴天', artist: '周杰伦' }];
  const kugouCover = [{ provider: 'kugou', id: 'kg-cover', name: '晴天', artist: '蓝心羽' }];
  // 同分：若给整组上浮，酷狗翻唱会跑到第一位；按「同一首歌」判定则保持原顺序
  assert.deepEqual(runMerge(loginEnv({ kugou: true }), [neteaseOriginal, kugouCover]),
    ['netease:ne1', 'kugou:kg-cover']);

  // 搜歌手时点名的艺人属于「确实匹配」：本平台那份要优先
  const neteaseJay = [{ provider: 'netease', id: 'ne-jay', name: '晴天', artist: '周杰伦' }];
  const kugouJay = [{ provider: 'kugou', id: 'kg-jay', name: '晴天', artist: '周杰伦' }];
  assert.deepEqual(runMerge(loginEnv({ kugou: true }), [neteaseJay, kugouJay], '周杰伦'),
    ['kugou:kg-jay', 'netease:ne-jay']);
});

test('上浮分小于翻唱/伴奏扣分：优先平台的翻唱不能顶掉别家原唱', () => {
  const boost = Number(BOOST_DECL.match(/= (\d+);/)[1]);
  assert.ok(boost > 0 && boost < 76, '上浮分必须正数且小于「翻唱」扣分 76');
});

test('会话快照：加载更多仍查同一批平台（登录中途退出不乱序）', () => {
  const sandbox = Object.assign({
    console,
    musicSearchCombinedSongs(state) {
      return (state.raw.kugou || []).concat(state.raw.netease || [], state.raw.qq || []);
    },
  }, loginEnv({}));
  vm.runInNewContext(
    [EXTRA_DECL,
      namedFunctionSource('musicSearchSongKey'),
      namedFunctionSource('appendUniqueSongs'),
      namedFunctionSource('searchPreferredProvider'),
      namedFunctionSource('musicSearchProvidersForMode'),
      namedFunctionSource('absorbMusicSearchPage'),
      '\nthis.absorb = absorbMusicSearchPage;'].join('\n'),
    sandbox
  );
  const state = {
    q: '晴天', mode: 'song',
    providers: ['kugou', 'netease', 'qq'], // 搜索开始时酷狗已登录
    raw: {}, offsets: {}, songs: [], failures: [], moreByProvider: {}, exhausted: false,
  };
  const page = (provider, offset, count) => ({
    provider, limit: 12, offset,
    songs: Array.from({ length: count }, (_, i) => ({ provider, id: provider + '-' + (offset + i), name: 'x' })),
  });
  // 本轮只有网易云 + QQ 返回（酷狗失败），两者都到底 → 酷狗没到底，整体不能判结束
  sandbox.absorb(state, {
    failures: ['kugou'],
    providerPages: { netease: page('netease', 0, 3), qq: page('qq', 0, 2) },
  });
  assert.equal(state.moreByProvider.netease, false);
  assert.equal(state.moreByProvider.qq, false);
  assert.equal(state.exhausted, false, '快照里的酷狗还失败着，必须保留「加载更多」重试');
  assert.ok(state.failures.indexOf('kugou') >= 0);
});

test('源码守卫：平台集合必须快照进会话，搜索与分页都读快照', () => {
  const fetchSrc = namedFunctionSource('fetchMusicSearchResults');
  assert.match(fetchSrc, /pageState\.providers/, '混合搜索必须用会话里的平台快照');
  assert.match(fetchSrc, /MUSIC_SEARCH_MIXED_PAGE_SIZES\[provider\]/, '后加平台也要有分页尺寸');
  assert.match(fetchSrc, /MUSIC_SEARCH_EXTRA_PROVIDER_TIMEOUT_MS/, '后加平台必须带超时，不能拖住整个 All 搜索');

  const doSearchSrc = namedFunctionSource('doSearch');
  assert.match(doSearchSrc, /providers:\s*musicSearchProvidersForMode\(mode\)/, '搜索开始时快照平台集合');

  assert.match(namedFunctionSource('musicSearchCombinedSongs'), /state\.providers/);
  assert.match(namedFunctionSource('absorbMusicSearchPage'), /state\.providers/);
});

test('源码守卫：「需会话/授权」提示只在没登录时给', () => {
  const metaSrc = namedFunctionSource('searchResultMetaHtml');
  assert.match(metaSrc, /searchProviderNeedsSessionNotice\(song\)/);
  const helperSrc = namedFunctionSource('searchProviderNeedsSessionNotice');
  assert.match(helperSrc, /hasPlatformLogin\(provider\)/, '必须按判定函数取登录态');
  assert.match(helperSrc, /qq|kugou/);
});
