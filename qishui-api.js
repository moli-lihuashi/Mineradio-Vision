'use strict';

// 汽水音乐：门面。
//
// 原先这里是一个 3783 行的巨石（配置 + 请求签名 + 资源映射 + 业务编排全在一处）。
// 现在按抽象层拆到 server/qishui/：
//   config.js   环境/端点常量、PC 设备身份、OAuth 配置、token 文件路径
//   http.js     TTL 缓存、requestText/Json、PC 签名、cookie 与鉴权头、web/pc 请求封装
//   mapping.js  资源映射（上游 JSON → 前端结构，纯函数）
//   account.js  账号态（status / 播放会员 / 会员缓存 TTL / 缓存失效）
//   auth.js     登录（PC 扫码 / OAuth 换 token / token 存取）
//   library.js  曲库（web 曲库 / 歌单曲目 / 用户歌单 / 首屏 feed）
//   search.js   搜索（公开搜索引擎 / PC 搜索 / SEO 单曲）
//   write.js    写操作（喜欢 / 收藏 / 加歌 / 最近播放 / 评论）
//   playback.js 播放（歌词 / track_v2 / player / 下载信息 / song-url）
//   status.js   /api/qishui/status 聚合响应
//
// 本文件只保留 require + 导出表，`module.exports` 的键与拆分前**逐字一致**
// （server.js 走 _lazyFn 惰性取、desktop/ + tests/ + harness 探针直接 require）。

const {
  buildQishuiOAuthAuthorizeUrl,
  getQishuiOAuthConfig,
} = require('./server/qishui/config');

const {
  normalizeQishuiCookieInput,
  qishuiCookieHasLogin,
  qishuiUnavailable,
} = require('./server/qishui/http');

const {
  collectQishuiTrackV2Streams,
  extractQishuiLyrics,
  qishuiBestStreamCandidateForMembership,
  qishuiConvertLyric,
  qishuiMembershipFromData,
  qishuiPlaybackMembershipFromPayload,
  qishuiPlaylistIsLikedCard,
  qishuiPublicSearchScore,
  qishuiStreamAllowedForMembership,
  qishuiTrackPlaybackRestriction,
  qishuiTrackRequiresVip,
  rankQishuiPublicSongs,
} = require('./server/qishui/mapping');

const {
  getQishuiStatus,
  qishuiMembershipCacheTtlMs,
} = require('./server/qishui/account');

const {
  createQishuiPcQrLogin,
  checkQishuiPcQrLogin,
  saveQishuiAccessToken,
  clearQishuiAccessToken,
  exchangeQishuiOAuthCode,
} = require('./server/qishui/auth');

const {
  handleQishuiFeed,
  handleQishuiUserPlaylists,
  handleQishuiPlaylistTracks,
} = require('./server/qishui/library');

const {
  handleQishuiSearch,
} = require('./server/qishui/search');

const {
  handleQishuiCheckTracksLiked,
  handleQishuiSetTrackLiked,
  handleQishuiSetPlaylistCollected,
  handleQishuiPlaylistAddSong,
  handleQishuiSetAlbumCollected,
  handleQishuiReportRecentlyPlayed,
  handleQishuiComments,
  handleQishuiCreateComment,
} = require('./server/qishui/write');

const {
  handleQishuiLyric,
  handleQishuiSongUrl,
} = require('./server/qishui/playback');

const {
  handleQishuiStatus,
} = require('./server/qishui/status');

module.exports = {
  getQishuiStatus,
  handleQishuiStatus,
  normalizeQishuiCookieInput,
  qishuiCookieHasLogin,
  getQishuiOAuthConfig,
  buildQishuiOAuthAuthorizeUrl,
  exchangeQishuiOAuthCode,
  createQishuiPcQrLogin,
  checkQishuiPcQrLogin,
  saveQishuiAccessToken,
  clearQishuiAccessToken,
  handleQishuiSearch,
  handleQishuiFeed,
  handleQishuiUserPlaylists,
  handleQishuiPlaylistTracks,
  handleQishuiCheckTracksLiked,
  handleQishuiSetTrackLiked,
  handleQishuiSetPlaylistCollected,
  handleQishuiPlaylistAddSong,
  handleQishuiSetAlbumCollected,
  handleQishuiReportRecentlyPlayed,
  handleQishuiComments,
  handleQishuiCreateComment,
  handleQishuiLyric,
  handleQishuiSongUrl,
  qishuiUnavailable,
  _test: {
    qishuiPublicSearchScore,
    rankQishuiPublicSongs,
    qishuiConvertLyric,
    extractQishuiLyrics,
    collectQishuiTrackV2Streams,
    qishuiMembershipFromData,
    qishuiPlaybackMembershipFromPayload,
    qishuiMembershipCacheTtlMs,
    qishuiTrackPlaybackRestriction,
    qishuiTrackRequiresVip,
    qishuiStreamAllowedForMembership,
    qishuiBestStreamCandidateForMembership,
    qishuiPlaylistIsLikedCard,
  },
};
