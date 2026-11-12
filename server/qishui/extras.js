'use strict';

// ====================================================================
//  汽水音乐增补能力（2026-11-12 批次4）
//
//  一手依据：github.com/guowenye/qishui-api 的 src/qishuiClient.js
//   · GET /luna/pc/search/playlist   歌单搜索（q / cursor / search_method 走 query）
//   搜索接口本身不强制 Cookie；本项目沿用已验收的 qishuiWebRequestJson PC 通道。
//
//  实测（probe-qishui-protocol.js）：源码里提到的混合搜索回退
//  /luna/pc/search/mixed 在本项目 PC 通道下始终返回 ERR_INVALID_PARAM
//  （试过去掉 search_method、加 search_type、改用 keyword、去掉 count 均无效），
//  所以这里不接一个已知不可用的回落，主路失败直接返回上游原因。
//
//  真实取证：匿名调用 /luna/pc/search/playlist?q=夜&cursor=0 返回
//  status_info + result_groups[{ id:'playlists', data:[{ entity:{ playlist:{...} } }] }]，
//  即真实歌单数据（名称 / 封面 / 曲目数 / 创建者）。
//
//  明确不接（不写空壳）：
//   · 从平台歌单移除歌曲：qishui-api 源码里没有该端点；npm 包 qishui-music-api
//     虽有 playlist_remove_tracks 操作名，但端点与参数不在可核对的一手源码里，
//     且需要登录会话才能验证写入是否生效。
//   · 专辑 / 歌单收藏库、歌手专辑列表：Folia 的 qishuiProvider albums:false，
//     车机接口也没有这些端点，属于「不适用」。
//
//  批次5 追加：GET /luna/pc/feed/mode（场景模式目录，匿名实测返回 45 个真实场景）。
//  实测该域下按场景取歌的候选端点（/luna/pc/feed/list、/feed/media、
//  /playlist/feed/media、/radio/tracks、/recommend/feed 等）全部 HTTP 404，
//  所以只接「模式目录」，不做一个点开没歌的假电台。
// ====================================================================

const defaultHttp = require('./http');
const defaultConfig = require('./config');
const defaultMapping = require('./mapping');

function asArray(v) { return Array.isArray(v) ? v : []; }
function text(v) { return String(v == null ? '' : v).trim(); }
function intInRange(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

module.exports = function createQishuiExtras(ctx) {
  ctx = ctx || {};
  const webRequestJson = ctx.qishuiWebRequestJson || defaultHttp.qishuiWebRequestJson;
  const pcAppParams = ctx.qishuiPcAppParams || defaultHttp.qishuiPcAppParams;
  const pcBase = ctx.qishuiPcBase || defaultConfig.QISHUI_WEB_PC_API_BASE;
  const mapping = ctx.qishuiMapping || defaultMapping;
  const cookie = () => ctx.qishuiCookie || '';

  const requestOpts = { bases: [pcBase], noDefaultParams: true, sessionOnly: true, pcApp: true, timeoutMs: 12000 };

  async function searchPlaylists(q) {
    const keywords = text(q.get('keywords') || q.get('q'));
    if (!keywords) return { provider: 'qishui', error: 'MISSING_KEYWORDS', playlists: [] };
    const offset = intInRange(q.get('offset') || q.get('cursor'), 0, 100000, 0);
    const limit = intInRange(q.get('limit') || q.get('count'), 1, 30, 20);
    const baseParams = { q: keywords, cursor: String(offset), count: limit, search_method: 'input' };

    let json = null;
    const source = 'pc_search_playlist';
    try {
      json = await webRequestJson('/luna/pc/search/playlist', pcAppParams(baseParams), cookie(), requestOpts);
    } catch (err) {
      return {
        provider: 'qishui', playlists: [], source,
        error: 'QISHUI_PLAYLIST_SEARCH_FAILED',
        message: '汽水歌单搜索失败：' + (err && err.message || err) +
          '（混合搜索回退端点在本项目 PC 通道下实测返回 ERR_INVALID_PARAM，未接入）。',
      };
    }

    // 复用项目已验收的递归卡片提取（兼容 entity.playlist 等多种层级）。
    const playlists = mapping.extractQishuiPlaylistCards(json).slice(0, limit);
    const groups = asArray(json && json.result_groups);
    const playlistGroup = groups.find(g => g && (g.id === 'playlists' || g.id === 'playlist')) || groups[0] || {};
    const nextCursor = text(playlistGroup.next_cursor || playlistGroup.nextCursor);
    const hasMore = typeof playlistGroup.has_more === 'boolean'
      ? playlistGroup.has_more
      : (Number(playlistGroup.has_more) > 0 || !!nextCursor || playlists.length >= limit);

    return {
      provider: 'qishui',
      keywords,
      playlists,
      source,
      offset,
      limit,
      nextCursor,
      nextOffset: nextCursor && /^\d+$/.test(nextCursor) ? Number(nextCursor) : offset + playlists.length,
      hasMore,
      message: playlists.length ? '' : '没有匹配的歌单结果。',
    };
  }

  // ---------- 场景模式目录 ----------
  // 真实响应：feed_mode_block[].feed_mode[]，每条含
  //   entity.feed_scene_mode.{scene_mode_id, sub_queue_type}、text、url_info。
  async function feedModes() {
    const json = await webRequestJson('/luna/pc/feed/mode',
      pcAppParams({ cursor: '0', count: 50 }), cookie(), requestOpts);
    const blocks = asArray(json && json.feed_mode_block);
    const modes = [];
    blocks.forEach(block => {
      const group = text(block && (block.title || block.type));
      asArray(block && block.feed_mode).forEach(row => {
        const scene = row && row.entity && row.entity.feed_scene_mode;
        if (!scene) return;
        modes.push({
          provider: 'qishui',
          id: text(scene.scene_mode_id),
          name: text(row.text || (scene && scene.sub_queue_type)),
          subQueueType: text(scene.sub_queue_type),
          group,
          type: text(row.type),
          cover: mapping.qishuiPlaylistCoverFromItem
            ? mapping.qishuiPlaylistCoverFromItem({ url_cover: row.url_info })
            : '',
        });
      });
    });
    return {
      provider: 'qishui', modes,
      groups: blocks.map(b => ({ title: text(b && b.title), type: text(b && b.type), count: asArray(b && b.feed_mode).length })),
      source: 'pc_feed_mode',
      message: modes.length ? '' : '汽水场景模式本次没有返回内容。',
    };
  }

  return { searchPlaylists, feedModes };
};
