'use strict';

/* =============================================================================
 * 歌单详情「加载失败」不能伪装成「歌单是空的」
 * （public/js/modules/06-lyrics/02-playlist-detail.js）
 *
 * 线上表现：上游一次抖动 + 前端 catch 里把 tracks 置空，界面直接给
 * 「0 首 / 歌单暂无可播放歌曲」——用户会以为自己的歌被删了。
 * 现在要求：
 *   - 失败态渲染「加载失败 + 重新加载」，绝不出「暂无可播放歌曲」；
 *   - 只有真的空歌单（服务端没标错误）才允许出那句话；
 *   - 有上一次成功缓存的曲目就继续显示（标成「上次」），不清空；
 *   - 重试必须真的重新发请求（跳过 60s 秒开缓存），成功后清掉错误态。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '02-playlist-detail.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const EMPTY_TEXT = '歌单暂无可播放歌曲';

function sliceDetail(text) {
  const start = text.indexOf('var playlistPanelTracksCache = Object.create(null);');
  assert.ok(start > 0, '找不到曲目缓存定义，歌单详情入口被改过');
  const end = text.indexOf('function playPlaylistPanelDetail()');
  assert.ok(end > start, '找不到 playPlaylistPanelDetail 边界');
  const slice = text.slice(start, end);
  assert.ok(slice.includes('async function openPlaylistPanelDetail'), '切片里没有 openPlaylistPanelDetail');
  assert.ok(slice.includes('async function retryPlaylistPanelDetail'), '切片里没有 retryPlaylistPanelDetail');
  return slice;
}

const sliceSource = sliceDetail(source);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createSandbox(options) {
  const o = options || {};
  const requests = [];
  const toasts = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Promise,
    JSON,
    Date,
    Math,
    Object,
    Array,
    Number,
    String,
    Boolean,
    isFinite,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { innerHeight: 800 },
    escHtml: esc,
    escAttr: esc,
    songCoverSrc: () => '',
    imgTagFromSrc: () => '',
    normalizePlaylistProvider: (provider) => String(provider || 'netease').toLowerCase(),
    playlistTracksEndpoint: (provider, pid) => '/api/' + provider + '/playlist/tracks?id=' + pid,
    cloneSong: (song) => Object.assign({}, song),
    showToast: (msg) => { toasts.push(String(msg)); },
    renderUserPlaylistsList() {},
    renderPlaylistSourceChip() {},
    refreshUserPlaylists: async () => {},
    scheduleShelfRebuild() {},
    animateVisiblePanelList() {},
    isPlaylistPanelVisibleForRender: () => false,
    resetPlaylistPanelRenderLimit() {},
    queueViewTab: 'playlists',
    playlistPanelDetailVirtualState: { raf: 0 },
    userPlaylists: [{ id: 'pl-1', name: '我的酷狗歌单', provider: 'kugou', trackCount: 3 }],
    PLAYLIST_FETCH_TIMEOUT_MS: 15000,
    PLAYLIST_DETAIL_INITIAL_RENDER: 64,
    PLAYLIST_DETAIL_ROW_STEP: 56,
    PLAYLIST_DETAIL_VIRTUAL_OVERSCAN: 7,
    PLAYLIST_DETAIL_OUTER_CHROME_HEIGHT: 120,
    apiJson(url) {
      requests.push(url);
      const handler = o.response || (() => ({ tracks: [] }));
      try {
        const out = handler(url, requests.length);
        return out && typeof out.then === 'function' ? out : Promise.resolve(out);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    __requests: requests,
    __toasts: toasts,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sliceSource + '\nthis.__api = {' +
      ' openPlaylistPanelDetail,' +
      ' retryPlaylistPanelDetail,' +
      ' playlistPanelDetailRowsHtml,' +
      ' playlistPanelDetailHtml,' +
      ' readPlaylistTracksCache,' +
      ' writePlaylistTracksCache,' +
      ' playlistPanelTracksCache,' +
      ' get state() { return playlistPanelDetailState; }' +
      ' };',
    sandbox,
    { filename: '02-playlist-detail.js#detail-slice' }
  );
  return sandbox;
}

const ROWS_OPTS = { viewport: 320, scrollTop: 0 };

function rowsHtml(sandbox) {
  return sandbox.__api.playlistPanelDetailRowsHtml(ROWS_OPTS);
}

test('服务端说「这次没拿到」时不许渲染成暂无可播放歌曲', async () => {
  const sandbox = createSandbox({
    response: () => ({ loggedIn: true, provider: 'kugou', error: 'KUGOU_PLAYLIST_EMPTY', retryable: true, tracks: [] }),
  });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');

  const html = rowsHtml(sandbox);
  assert.ok(!html.includes(EMPTY_TEXT), '失败态绝不能出「' + EMPTY_TEXT + '」，实际：' + html);
  assert.ok(html.includes('data-pl-detail-retry'), '失败态必须给出重试入口');
  assert.equal(sandbox.__api.state.error, 'KUGOU_PLAYLIST_EMPTY');
  assert.equal(sandbox.__api.state.tracks.length, 0);

  const full = sandbox.__api.playlistPanelDetailHtml({ id: 'pl-1', name: '我的酷狗歌单', trackCount: 3 }, 'kugou', ROWS_OPTS);
  assert.ok(full.includes('加载失败'), '标题右侧的数量位要说明是失败，实际：' + full);
  assert.ok(!full.includes('0 首'), '不能把失败写成「0 首」');
});

test('请求直接抛错（超时）时同样走失败态，不谎报空歌单', async () => {
  const sandbox = createSandbox({
    response: () => { throw new Error('Request timeout after 15000ms'); },
  });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');

  const html = rowsHtml(sandbox);
  assert.ok(!html.includes(EMPTY_TEXT), '超时也不能说歌单没歌');
  assert.ok(html.includes('data-pl-detail-retry'));
  assert.equal(sandbox.__api.state.error, 'KUGOU_PLAYLIST_LOAD_FAILED');
  assert.ok(sandbox.__toasts.some((m) => m.includes('重试')), '要提示可以重试，实际：' + sandbox.__toasts.join('|'));
});

test('有上一次成功的曲目时刷新失败继续显示旧内容', async () => {
  let mode = 'ok';
  const sandbox = createSandbox({
    response: () => {
      if (mode === 'fail') throw new Error('socket hang up');
      return { tracks: [{ id: 's1', name: '歌A', artist: '人A' }, { id: 's2', name: '歌B', artist: '人B' }] };
    },
  });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');
  assert.equal(sandbox.__api.state.tracks.length, 2);
  assert.equal(sandbox.__api.state.error, '');

  mode = 'fail';
  await sandbox.__api.retryPlaylistPanelDetail();

  assert.equal(sandbox.__api.state.tracks.length, 2, '刷新失败必须保住上一次的曲目，实际 ' + sandbox.__api.state.tracks.length);
  assert.equal(sandbox.__api.state.error, 'KUGOU_PLAYLIST_LOAD_FAILED');
  const html = rowsHtml(sandbox);
  assert.ok(!html.includes(EMPTY_TEXT), '有旧数据时更不该出现空态文案');
  assert.ok(html.includes('歌A'), '旧曲目要照常渲染');
});

test('重试必须真的重新请求，成功后清掉失败态', async () => {
  let mode = 'fail';
  const sandbox = createSandbox({
    response: () => {
      if (mode === 'fail') throw new Error('Request timeout');
      return { tracks: [{ id: 's1', name: '歌A', artist: '人A' }] };
    },
  });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');
  assert.equal(sandbox.__api.state.error, 'KUGOU_PLAYLIST_LOAD_FAILED');

  mode = 'ok';
  const before = sandbox.__requests.length;
  await sandbox.__api.retryPlaylistPanelDetail();
  assert.ok(sandbox.__requests.length > before, '重试不能命中 60s 秒开缓存，必须重新发请求');
  assert.equal(sandbox.__api.state.error, '', '成功后错误态必须清掉');
  assert.equal(sandbox.__api.state.tracks.length, 1);
  const html = rowsHtml(sandbox);
  assert.ok(!html.includes('data-pl-detail-retry'), '成功后不该再显示重试按钮');
});

test('真的空歌单才允许出现暂无可播放歌曲', async () => {
  const sandbox = createSandbox({ response: () => ({ tracks: [] }) });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');

  assert.equal(sandbox.__api.state.error, '');
  const html = rowsHtml(sandbox);
  assert.ok(html.includes(EMPTY_TEXT), '真没歌时仍要给出空态文案，实际：' + html);
  assert.ok(!html.includes('data-pl-detail-retry'), '真没歌时不该给重试按钮');
});

test('失败结果不写曲目缓存（免得下一次秒开还是空）', async () => {
  const sandbox = createSandbox({
    response: () => ({ error: 'KUGOU_PLAYLIST_EMPTY', retryable: true, tracks: [] }),
  });
  await sandbox.__api.openPlaylistPanelDetail('kugou', 'pl-1', '我的酷狗歌单');
  assert.equal(sandbox.__api.readPlaylistTracksCache('kugou:pl-1'), null,
    '空/失败结果不能进 60s 缓存，否则接下来一分钟反复显示空');
});
