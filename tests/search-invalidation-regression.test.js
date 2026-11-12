'use strict';

/* 2026-11-12 复核回归：清空搜索框走 renderSearchHistory 分支时，旧实现既不取消
 * 在飞的搜索 / 分页请求，也不作废会话 —— 慢平台晚到的分页结果把历史盖回旧列表。
 * 另：分页返回后必须再次核对当前输入与模式。 */

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

test('invalidatePendingMusicSearch 递增代次、abort 在飞请求、清空分页会话', () => {
  let aborted = 0;
  const sandbox = {
    searchRequestSeq: 7,
    searchAbort: { abort() { aborted += 1; } },
    searchPageState: { q: '晴天', songs: [{ name: '旧结果' }] },
  };
  vm.runInNewContext(
    namedFunctionSource('invalidatePendingMusicSearch') + '\nthis.run = invalidatePendingMusicSearch;',
    sandbox
  );
  sandbox.run();
  assert.equal(sandbox.searchRequestSeq, 8, '作废必须让在飞请求的 requestSeq 失配');
  assert.equal(aborted, 1, '在飞请求要被 abort');
  assert.equal(sandbox.searchAbort, null);
  assert.equal(sandbox.searchPageState, null, '分页会话要清空，晚到结果无处可渲染');
  // 幂等：没有在飞请求时重复调用不能抛
  sandbox.run();
  assert.equal(sandbox.searchRequestSeq, 9);
  assert.equal(aborted, 1);
});

test('清空输入、doSearch 空词、分页返回三处都必须作废 / 核对', () => {
  const inputHandler = source.slice(source.indexOf("$input.addEventListener('input'"), source.indexOf("$input.addEventListener('focus'"));
  assert.match(inputHandler, /if \(!q\) \{[\s\S]*?invalidatePendingMusicSearch\(\)/,
    '清空输入必须立即作废在飞请求');
  const doSearchSrc = namedFunctionSource('doSearch');
  assert.match(doSearchSrc, /if \(!q\) \{[\s\S]*?invalidatePendingMusicSearch\(\)/,
    '空词调用 doSearch 也要作废');
  const loadMoreSrc = namedFunctionSource('loadNextMusicSearchPage');
  const awaitAt = loadMoreSrc.indexOf('var page = await fetchMusicSearchResults');
  const renderAt = loadMoreSrc.indexOf('renderSongSearchResults(state.songs)');
  assert.ok(awaitAt > 0 && renderAt > awaitAt);
  const between = loadMoreSrc.slice(awaitAt, renderAt);
  assert.match(between, /\$input\.value\.trim\(\) !== state\.q/, '分页返回后必须核对当前关键词');
  assert.match(between, /searchMode !== state\.mode/, '分页返回后必须核对当前标签');
  assert.match(namedFunctionSource('clearSearchResults'), /searchAbort\.abort|searchPageState = null/);
});

/* ---- 2026-11-12 复核：混合搜索里「一个平台到底 + 另一个平台本轮失败」不能被判结束 ---- */
function makeAbsorbSandbox() {
  const sandbox = {
    console,
    Object, Array, String, Number, Math,
    songProviderKey(song) { return (song && song.provider) || 'netease'; },
    musicSearchCombinedSongs(state) { return (state.raw.netease || []).concat(state.raw.qq || []); },
    mergeSongSearchResults() { return []; },
  };
  const bundle = [
    namedFunctionSource('musicSearchSongKey'),
    namedFunctionSource('appendUniqueSongs'),
    namedFunctionSource('musicSearchProvidersForMode'),
    namedFunctionSource('absorbMusicSearchPage'),
  ].join('\n');
  vm.runInNewContext(bundle + '\nthis.absorb = absorbMusicSearchPage;', sandbox);
  return sandbox;
}

function freshMixedState() {
  return {
    q: '晴天', mode: 'song',
    raw: { netease: [{ id: 'n0', provider: 'netease' }], qq: [{ id: 'q0', provider: 'qq' }] },
    offsets: { netease: 14, qq: 12 },
    songs: [], failures: [],
    moreByProvider: { netease: true, qq: true },
    exhausted: false,
  };
}

function shortPage(provider, limit, offset, count) {
  return {
    provider,
    songs: Array.from({ length: count }, (_, i) => ({ id: provider + '-' + offset + '-' + i, provider })),
    limit,
    offset,
  };
}

test('混合分页：网易云最后一页 + QQ 本轮失败 → 不得判定结束，QQ 保留重试', () => {
  const sandbox = makeAbsorbSandbox();
  const state = freshMixedState();
  const page = {
    failures: ['qq'],
    providerPages: { netease: shortPage('netease', 14, 14, 2) }, // 未满一页 = 网易云到底
  };
  sandbox.absorb(state, page);
  assert.equal(state.moreByProvider.netease, false, '网易云确实到底了');
  assert.equal(state.exhausted, false, 'QQ 本轮失败，整体不能提前结束分页');
  assert.ok(state.failures.indexOf('qq') >= 0, '失败平台要记下来供 UI 提示');
  assert.equal(state.offsets.qq, 12, '失败平台的 offset 不得推进，重试仍取当前页');
  assert.equal(state.offsets.netease, 28, '成功平台正常推进');
});

test('混合分页：两平台都明确到底且无失败 → 才判定结束', () => {
  const sandbox = makeAbsorbSandbox();
  const state = freshMixedState();
  sandbox.absorb(state, {
    failures: [],
    providerPages: {
      netease: shortPage('netease', 14, 14, 2),
      qq: shortPage('qq', 12, 12, 1),
    },
  });
  assert.equal(state.exhausted, true, '全部参与平台都到底才能隐藏「加载更多」');
});

test('混合分页：失败平台恢复后撤销失败标记，并能正常判定到底', () => {
  const sandbox = makeAbsorbSandbox();
  const state = freshMixedState();
  sandbox.absorb(state, {
    failures: ['qq'],
    providerPages: { netease: shortPage('netease', 14, 14, 2) },
  });
  assert.equal(state.exhausted, false);
  // QQ 恢复并返回一整页：仍有更多
  sandbox.absorb(state, {
    failures: [],
    providerPages: { qq: shortPage('qq', 12, 12, 12) },
  });
  assert.ok(state.failures.indexOf('qq') < 0, '恢复后应撤销失败标记');
  assert.equal(state.exhausted, false, 'QQ 拿满一页 = 还有更多');
  // QQ 下一页只回 1 首 → 所有平台都到底
  sandbox.absorb(state, {
    failures: [],
    providerPages: { qq: shortPage('qq', 12, 24, 1) },
  });
  assert.equal(state.exhausted, true, '恢复后仍要能正常结束');
});

test('源码守卫：判定到底必须遍历全部参与平台，且失败平台保留重试', () => {
  const absorbSrc = namedFunctionSource('absorbMusicSearchPage');
  assert.match(absorbSrc, /musicSearchProvidersForMode\(state\.mode\)\.every/);
  assert.match(absorbSrc, /state\.failures\.indexOf\(provider\) >= 0\) return false/);
  assert.match(absorbSrc, /state\.moreByProvider\[provider\] === false/);
  assert.doesNotMatch(absorbSrc, /providers\.every\(function \(p\) \{ return !state\.moreByProvider\[p\]; \}\)/,
    '旧实现只遍历本轮成功平台，会吞掉失败平台的重试机会');
});
