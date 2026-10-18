const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BuiltInPlaylistLibrary } = require('../desktop/built-in-playlist-library');

test('built-in playlists persist mixed-provider songs without changing their source', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-built-in-playlists-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = new BuiltInPlaylistLibrary({ userDataPath: root });

  const created = await library.create('跨平台收藏');
  const id = created.playlist.id;
  assert.match(id, /^[a-f0-9]{24}$/);

  await library.addTrack(id, { provider: 'netease', id: 1001, name: '网易云歌曲', artist: 'A', cover: 'https://example.com/ne.jpg' });
  await library.addTrack(id, { provider: 'qq', id: 'qq-1', mid: '003QQMID', mediaMid: '004MEDIA', name: 'QQ 歌曲', artist: 'B' });
  await library.addTrack(id, { provider: 'kugou', id: 'kg-1', hash: 'ABCDEF', albumAudioId: '900', name: '酷狗歌曲', artist: 'C' });
  await library.addTrack(id, { provider: 'qishui', id: 'qs-1', providerSongId: 'qs-1', name: '汽水歌曲', artist: 'D' });
  await library.addTrack(id, { provider: 'local', id: 'local:0123456789abcdef01234567', localFileId: '0123456789abcdef01234567', localKey: '0123456789abcdef01234567', localUrl: 'mineradio-local://audio/0123456789abcdef01234567?cap=test', name: '本地歌曲', artist: 'E' });

  const duplicate = await library.addTrack(id, { provider: 'qq', mid: '003QQMID', name: '同一首 QQ 歌曲', artist: 'B' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.playlist.trackCount, 5);

  const firstPage = library.page(id, { offset: 0, limit: 3 });
  assert.deepEqual(firstPage.tracks.map((track) => track.provider), ['netease', 'qq', 'kugou']);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.total, 5);
  assert.equal(firstPage.tracks[1].mid, '003QQMID');
  assert.equal(firstPage.tracks[2].hash, 'ABCDEF');

  const restored = new BuiltInPlaylistLibrary({ userDataPath: root });
  const restoredPage = restored.page(id, { offset: 3, limit: 10 });
  assert.deepEqual(restoredPage.tracks.map((track) => track.provider), ['qishui', 'local']);
  assert.equal(restored.listSync().playlists[0].cover, 'https://example.com/ne.jpg');

  await restored.rename(id, '常听合集');
  await restored.reorderTrack(id, 4, 0);
  assert.equal(restored.page(id, { limit: 1 }).tracks[0].provider, 'local');
  await restored.removeTrack(id, 0);
  assert.equal(restored.page(id, { limit: 20 }).total, 4);

  await assert.rejects(
    () => restored.addTrack(id, { provider: 'spotify', spotifyId: 'blocked', id: 'blocked', name: '已移除平台' }),
    /BUILT_IN_PLAYLIST_TRACK_INVALID/
  );
  await restored.delete(id);
  assert.equal(restored.listSync().count, 0);
});

test('wiring exposes built-in playlists in panel, queue, shelf and collect modal', () => {
  const appRoot = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8');
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.js');
  const loader = read('public/js/index-loader.js');
  const builtInRenderer = read('public/js/modules/06-lyrics/00-built-in-playlists.js');
  const panel = read('public/js/modules/06-lyrics/02-playlist-detail.js');
  const loaders = read('public/js/modules/06-lyrics/03-podcast-playlist-loaders.js');
  const collect = read('public/js/modules/05-playback/06c-account-actions.js');
  const shelf = read('public/js/modules/04-shelf/00c-shelf-manager.js');
  const shelfContent = read('public/js/modules/04-shelf/03-content-list-manager.js');
  const registry = read('public/js/modules/05-playback/01-music-provider-registry.js');
  const globals = read('public/js/modules/00-state/12a-audio-login-globals.js');
  const boot = read('public/js/modules/10-shell/01-splash-and-boot.js');
  const html = read('public/index.html');

  // 主进程：实例化（用稳定 userData，不能是 setPath('cache') 之后的路径）+ 8 个 IPC
  assert.match(main, /new BuiltInPlaylistLibrary\(\{ userDataPath: path\.join\(_REAL_APP_DATA, APP_NAME\) \}\)/);
  for (const channel of ['list', 'page', 'create', 'rename', 'delete', 'add-track', 'remove-track', 'reorder-track']) {
    assert.match(main, new RegExp("mineradio-built-in-playlists?-" + channel.replace('-', '\\-')), 'missing IPC channel ' + channel);
  }
  assert.match(main, /isTrustedMainWindowIpc\(event\)/);

  // preload 暴露 8 个方法
  for (const method of ['listBuiltInPlaylists', 'readBuiltInPlaylist', 'createBuiltInPlaylist', 'renameBuiltInPlaylist', 'deleteBuiltInPlaylist', 'addBuiltInPlaylistTrack', 'removeBuiltInPlaylistTrack', 'reorderBuiltInPlaylistTrack']) {
    assert.match(preload, new RegExp(method + ':'), 'preload missing ' + method);
  }

  // 前端模块注册 + 全局状态
  assert.match(loader, /06-lyrics\/00-built-in-playlists\.js/);
  assert.match(globals, /var builtInPlaylists = \[\];/);
  assert.match(globals, /var builtInPlaylistLoadPromise = null;/);
  assert.match(builtInRenderer, /function addTrackToBuiltInPlaylist/);
  assert.match(builtInRenderer, /function refreshBuiltInPlaylists/);

  // provider 域：mineradio 不能被归一成 netease
  assert.match(registry, /if \(provider === 'mineradio'\) return 'mineradio';/);

  // 歌单面板 / 详情 / 入队
  assert.match(panel, /Mineradio 内置歌单/);
  assert.match(panel, /builtInPlaylistTracksPage/);
  assert.match(panel, /renameBuiltInPlaylist/);
  assert.match(panel, /deleteBuiltInPlaylist/);
  assert.match(panel, /removeTrackFromBuiltInPlaylist/);
  assert.match(loaders, /mineradio:/);
  assert.match(loaders, /loadAllBuiltInPlaylistTracks/);

  // 收藏弹窗：内置分区 + 创建入口
  assert.match(collect, /可混合全部平台/);
  assert.match(collect, /addCollectTargetToBuiltInPlaylist/);
  assert.match(collect, /function createPlatformPlaylistFromCollect/);
  assert.match(html, /promptCreateBuiltInPlaylist\(\)/);

  // 新建 / 重命名 / 删除必须走应用内模态：Electron 渲染进程默认禁用
  // window.prompt / window.confirm（恒返回 null / false），调用即静默无反应
  assert.equal(/\bwindow\.prompt\s*\(/.test(builtInRenderer), false, 'built-in playlists must not call window.prompt');
  assert.equal(/\bwindow\.confirm\s*\(/.test(builtInRenderer), false, 'built-in playlists must not call window.confirm');
  assert.match(builtInRenderer, /function openBuiltInPromptModal/);
  assert.match(builtInRenderer, /function promptCreateBuiltInPlaylist/);
  for (const id of ['modal', 'title', 'message', 'input', 'ok', 'cancel']) {
    assert.match(html, new RegExp('id="builtin-prompt-' + id + '"'), 'index.html missing builtin-prompt-' + id);
  }

  // 3D 书架与二级列表
  assert.match(shelf, /provider === 'mineradio'/);
  assert.match(shelf, /内置歌单/);
  assert.match(shelfContent, /loadAllBuiltInPlaylistTracks/);

  // 启动时与平台登录态并行拉一次
  assert.match(boot, /refreshBuiltInPlaylists\(false\)/);
});
