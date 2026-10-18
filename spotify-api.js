'use strict';

// Spotify：门面。
//
// 按抽象层单向切成 4 个模块，本文件只剩 require + 原样的 `module.exports`：
//   config.js    配置身份 / 常量 / 缓存实例 / 文本与文件工具 / token 文件存取
//   http.js      请求封装 / 签名头 / token 获取与刷新 / 限流退避
//   mapping.js   资源映射（上游 JSON → 前端结构，纯函数）
//   business.js  搜索 / 推荐 / 歌单 / 专辑 / 库操作 / 取址 / 歌词 / OAuth
//
// 依赖方向（脚本断言，无环）：config / mapping 零出边；http → config；
// business → config + http + mapping。
//
// `module.exports` 的键与拆分前逐字一致。

const {
  SPOTIFY_LIKED_PLAYLIST_ID,
  SPOTIFY_SEARCH_LIMIT_MAX,
  saveSpotifyConfig,
  getSpotifyOAuthConfig,
} = require('./server/spotify/config');

const {
  readStoredSpotifyToken,
  saveSpotifyOAuthToken,
  clearSpotifyToken,
  getSpotifyConfig,
  spotifyErrorDetails,
  invalidateSpotifyAccessToken,
  getSpotifyUserAccessToken,
  spotifyUserRequest,
  spotifyGet,
  spotifyUserGet,
  resetSpotifyRuntimeStateForTests,
} = require('./server/spotify/http');

const {
  normalizeSpotifyProfile,
  spotifyLibraryUri,
} = require('./server/spotify/mapping');

const {
  buildSpotifyOAuthAuthorizeUrl,
  exchangeSpotifyOAuthCode,
  handleSpotifyStatus,
  handleSpotifySearch,
  handleSpotifyRecommendations,
  handleSpotifyUserPlaylists,
  handleSpotifyPlaylistTracks,
  handleSpotifyAlbumDetail,
  requireSpotifyScopes,
  handleSpotifyLibraryCheck,
  handleSpotifyLibrarySet,
  handleSpotifyPlaylistAddSong,
  handleSpotifyCreatePlaylist,
  handleSpotifySongUrl,
  handleSpotifyLyric,
} = require('./server/spotify/business');



module.exports = {
  getSpotifyConfig,
  getSpotifyOAuthConfig,
  saveSpotifyConfig,
  buildSpotifyOAuthAuthorizeUrl,
  exchangeSpotifyOAuthCode,
  saveSpotifyOAuthToken,
  clearSpotifyToken,
  handleSpotifyStatus,
  handleSpotifySearch,
  handleSpotifyRecommendations,
  handleSpotifyUserPlaylists,
  handleSpotifyPlaylistTracks,
  handleSpotifyAlbumDetail,
  handleSpotifyLibraryCheck,
  handleSpotifyLibrarySet,
  handleSpotifyPlaylistAddSong,
  handleSpotifyCreatePlaylist,
  handleSpotifySongUrl,
  handleSpotifyLyric,
  SPOTIFY_SEARCH_LIMIT_MAX,
  SPOTIFY_LIKED_PLAYLIST_ID,
  _test: {
    getSpotifyUserAccessToken,
    spotifyGet,
    spotifyUserGet,
    spotifyUserRequest,
    spotifyLibraryUri,
    requireSpotifyScopes,
    spotifyErrorDetails,
    normalizeSpotifyProfile,
    readStoredSpotifyToken,
    invalidateSpotifyAccessToken,
    resetSpotifyRuntimeStateForTests,
  },
};
