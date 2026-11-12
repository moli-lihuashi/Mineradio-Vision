'use strict';

// 批次4 汽水歌单搜索的合成正例。
// 守的是 /luna/pc/search/playlist 端点、参数、回退路径与结果映射。
// 真实匿名响应由 .workbuddy/harness/probe-qishui-protocol.js 与真起服务探针验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const createQishuiExtras = require('../server/qishui/extras');

function playlistPayload(name) {
  return {
    status_info: { now: 1 },
    result_groups: [{
      id: 'playlists', next_cursor: '20', has_more: true,
      data: [{
        meta: { item_type: 'playlist' },
        entity: { playlist: { id: '7514616126853890086', title: name, desc: '简介', count_tracks: 20, owner: { nickname: '小编' } } },
      }],
    }],
  };
}

function makeHarness(options) {
  const opts = options || {};
  const calls = [];
  const mapping = opts.qishuiMapping || {
    extractQishuiPlaylistCards: function (json) {
      const groups = (json && json.result_groups) || [];
      const out = [];
      groups.forEach(g => (g.data || []).forEach(row => {
        const pl = row && row.entity && row.entity.playlist;
        if (pl && pl.id) out.push({ provider: 'qishui', id: pl.id, name: pl.title, trackCount: pl.count_tracks || 0, creator: (pl.owner && pl.owner.nickname) || '' });
      }));
      return out;
    },
  };
  const ctx = {
    get qishuiCookie() { return opts.cookie || ''; },
    qishuiPcBase: 'https://api.qishui.com',
    qishuiPcAppParams: function (p) { return Object.assign({ aid: '386088' }, p); },
    qishuiWebRequestJson: async function (path, params, cookie, reqOpts) {
      calls.push({ path, params, cookie, reqOpts });
      const entry = opts.responses && opts.responses[path];
      if (entry === 'throw') throw new Error('upstream-unavailable');
      if (typeof entry === 'function') return entry(params);
      return entry || playlistPayload('夜、萤火虫和你');
    },
    qishuiMapping: Object.assign({
      qishuiPlaylistCoverFromItem: function (item) {
        const raw = item && item.url_cover;
        return raw && raw.urls && raw.urls[0] ? raw.urls[0] + (raw.uri || '') + '~c5_300x300.jpg' : '';
      },
    }, mapping),
  };
  return { extras: createQishuiExtras(ctx), calls: calls };
}

function params(obj) { return new URLSearchParams(obj || {}); }

test('歌单搜索：打 /luna/pc/search/playlist，参数与结果/游标映射正确', async () => {
  const h = makeHarness({});
  const r = await h.extras.searchPlaylists(params({ keywords: '夜', cursor: '0', limit: '5' }));
  assert.equal(r.playlists.length, 1);
  assert.equal(r.playlists[0].name, '夜、萤火虫和你');
  assert.equal(r.source, 'pc_search_playlist');
  assert.equal(r.nextCursor, '20');
  assert.equal(r.nextOffset, 20);
  assert.equal(r.hasMore, true);
  const c = h.calls[0];
  assert.equal(c.path, '/luna/pc/search/playlist');
  assert.equal(c.params.q, '夜');
  assert.equal(c.params.cursor, '0');
  assert.equal(c.params.count, 5);
  assert.equal(c.params.search_method, 'input');
  assert.equal(c.reqOpts.pcApp, true);
  assert.equal(c.reqOpts.noDefaultParams, true);
});

test('主路失败时返回明确 error，不去打已知不可用的混合搜索回退', async () => {
  // 实测 /luna/pc/search/mixed 在本项目 PC 通道下始终 ERR_INVALID_PARAM，
  // 所以实现里移除回退；这条守的是「不许再加一个假装可用的回落」。
  const h = makeHarness({ responses: { '/luna/pc/search/playlist': 'throw' } });
  const r = await h.extras.searchPlaylists(params({ keywords: '夜' }));
  assert.equal(r.playlists.length, 0);
  assert.equal(r.error, 'QISHUI_PLAYLIST_SEARCH_FAILED');
  assert.match(r.message, /汽水歌单搜索失败/);
  assert.match(r.message, /ERR_INVALID_PARAM/);
  assert.deepEqual(h.calls.map(c => c.path), ['/luna/pc/search/playlist']);
});

test('批次5 场景模式目录：/luna/pc/feed/mode 解析 scene_mode_id 与分组', async () => {
  const h = makeHarness({
    responses: {
      '/luna/pc/feed/mode': {
        status_code: 0,
        feed_mode_block: [{
          title: '场景音乐', type: 'scene_music',
          feed_mode: [{
            type: 'scene_mode', text: '深夜 EMO',
            entity: { feed_scene_mode: { scene_mode_id: 4, sub_queue_type: 'scene_mode_emo' } },
            url_info: { uri: 'tos-cn/a.png', urls: ['https://p3-luna.douyinpic.com/img/'] },
          }],
        }],
      },
    },
  });
  const r = await h.extras.feedModes();
  assert.equal(r.modes.length, 1);
  assert.equal(r.modes[0].id, '4');
  assert.equal(r.modes[0].name, '深夜 EMO');
  assert.equal(r.modes[0].subQueueType, 'scene_mode_emo');
  assert.equal(r.modes[0].group, '场景音乐');
  assert.match(r.modes[0].cover, /p3-luna\.douyinpic\.com/);
  assert.equal(r.groups[0].count, 1);
  const c = h.calls[0];
  assert.equal(c.path, '/luna/pc/feed/mode');
});

test('缺少关键词时不打上游；空结果带 message', async () => {
  const h = makeHarness({ responses: { '/luna/pc/search/playlist': { result_groups: [] } } });
  assert.equal((await h.extras.searchPlaylists(params())).error, 'MISSING_KEYWORDS');
  assert.equal(h.calls.length, 0);
  const empty = await h.extras.searchPlaylists(params({ keywords: '不存在的歌单' }));
  assert.equal(empty.playlists.length, 0);
  assert.match(empty.message, /没有匹配的歌单/);
});
