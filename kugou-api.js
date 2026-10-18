'use strict';

// 酷狗音乐：门面（拆分完成）。
//
// 按抽象层单向切成 9 个模块，门面只剩 require + 原样的 `module.exports`：
//   config.js    环境 / 端点 / 加密盐 / 版本号 / 调试开关
//   http.js      缓存实例 / 请求封装 / 签名 / cookie 解析 / 设备注册(dfid) / 网关请求
//   mapping.js   资源映射（上游 JSON → 前端结构，纯函数）
//   account.js   登录态 / 会员判定 / 资料 / 用户歌单列表
//   favorite.js  收藏歌单 id / like fileid 记忆 / 喜欢检查·加歌·删歌·切换
//   search.js    关键词搜索
//   play.js      取址四条通道（mobile / web / h5 / gateway）+ 候选 hash + 播放态
//   lyric.js     歌词搜索 / 候选 / 时长筛选 / 下载解密
//   recommend.js FM / 每日推荐 / 猜你喜欢
//
// 依赖方向（脚本断言，无环）：
//   config / mapping 零出边；http → config + mapping
//   search / lyric / account / favorite 只依赖上面三个
//   play → account；recommend → account + favorite
//
// `module.exports` 的键与拆分前逐字一致（31 键，含 `_test`）。

const {
  KUGOU_H5_SALT,
  KUGOU_LITE_ANDROID_SALT,
  KUGOU_LITE_APPID,
  KUGOU_LITE_CLIENTVER,
  KUGOU_LITE_GATEWAY_UA,
} = require('./server/kugou/config');

const {
  buildKugouRequestCookie,
  ensureKugouDfid,
  extractKugouAuth,
  kugouCloudlistRequest,
  kugouCookieHasLogin,
  kugouCookieHasPlayback,
  kugouCookieObject,
  kugouCookieUserId,
  kugouGatewayRequest,
  kugouH5GatewayRequest,
  registerKugouCloudDevice,
  setKugouDfidPersistHook,
  signatureAndroidParams,
} = require('./server/kugou/http');

const {
  kugouAudioReferer,
  kugouPlaybackCacheScope,
  kugouPlaybackParamsRequireVip,
  mapKugouSearchItem,
  normalizeKugouVipPayloadV2,
} = require('./server/kugou/mapping');

const {
  handleKugouSearch,
} = require('./server/kugou/search');

const {
  handleKugouSongUrl,
} = require('./server/kugou/play');

const {
  handleKugouLyric,
} = require('./server/kugou/lyric');

const {
  getKugouLoginInfo,
  handleKugouUserPlaylists,
} = require('./server/kugou/account');

const {
  handleKugouPlaylistTracks,
  handleKugouLikeCheck,
  handleKugouLikeToggle,
  handleKugouPlaylistAddSong,
} = require('./server/kugou/favorite');

const {
  handleKugouGuessLike,
} = require('./server/kugou/recommend');



module.exports = {
  handleKugouSearch,
  handleKugouSongUrl,
  handleKugouLyric,
  handleKugouGuessLike,
  handleKugouUserPlaylists,
  handleKugouPlaylistTracks,
  handleKugouLikeCheck,
  handleKugouLikeToggle,
  handleKugouPlaylistAddSong,
  getKugouLoginInfo,
  kugouCookieObject,
  kugouCookieHasLogin,
  kugouCookieHasPlayback,
  kugouCookieUserId,
  extractKugouAuth,
  kugouGatewayRequest,
  kugouH5GatewayRequest,
  kugouCloudlistRequest,
  ensureKugouDfid,
  registerKugouCloudDevice,
  setKugouDfidPersistHook,
  signatureAndroidParams,
  KUGOU_LITE_APPID,
  KUGOU_LITE_CLIENTVER,
  KUGOU_LITE_ANDROID_SALT,
  KUGOU_LITE_GATEWAY_UA,
  KUGOU_H5_SALT,
  buildKugouRequestCookie,
  kugouAudioReferer,
  mapKugouSearchItem,
  _test: {
    normalizeKugouVipPayloadV2,
    kugouPlaybackParamsRequireVip,
    kugouPlaybackCacheScope,
    extractKugouAuth,
  },
};
