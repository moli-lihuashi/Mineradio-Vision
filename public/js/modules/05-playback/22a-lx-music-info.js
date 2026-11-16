(function (global) {
  'use strict';

  // ====================================================================
  //  歌曲 → LX 源脚本的 musicInfo 归一（纯函数，无 DOM，可单测）
  //
  //  为什么单独拆：LX 源脚本对每个平台期望的 ID 字段不同——
  //    wy（网易云）要 musicId、tx（QQ）要 songmid/strMediaMid、kg（酷狗）要 hash/albumId。
  //  传错字段的表现是「音源返回解析失败」，而不是报参数错误，所以映射必须能单测。
  //
  //  覆盖范围：只映射本项目有对应 LX 源的平台。
  //    汽水、Spotify、本地音乐在 LX 生态里没有对应源，返回 '' 表示不兜底。
  //
  //  注意：LX 的 normalizeMusicInfo 会在缺字段时互相补（songmid ↔ id ↔ musicId），
  //  所以这里**只传该平台真正的主 ID**，不把 id 到处滥填——多填会污染它的兜底推断。
  // ====================================================================

  var LX_SOURCE_BY_PROVIDER = {
    netease: 'wy',
    qq: 'tx',
    kugou: 'kg',
  };

  function lxSourceKeyForProvider(provider) {
    return LX_SOURCE_BY_PROVIDER[String(provider == null ? '' : provider).toLowerCase()] || '';
  }

  function str(value) {
    return value == null ? '' : String(value).trim();
  }

  function albumNameOf(song) {
    var album = song.album;
    if (album && typeof album === 'object') return str(album.name || album.albumName);
    return str(album || song.albumName);
  }

  /**
   * @param {string} provider netease | qq | kugou
   * @param {object} song     本项目歌曲对象
   * @returns {object} LX 源脚本期望的 musicInfo
   */
  function buildLxMusicInfo(provider, song) {
    var s = song || {};
    var info = {
      name: str(s.name || s.title || s.songName),
      singer: str(s.singer || s.artist || s.artistName),
      albumName: albumNameOf(s),
    };
    var source = lxSourceKeyForProvider(provider);

    if (source === 'tx') {
      // QQ：主 ID 是 songmid；无损/母带另需 strMediaMid
      info.songmid = str(s.mid || s.songmid || s.qqId || s.id);
      var mediaMid = str(s.strMediaMid || s.mediaMid || s.media_mid);
      if (mediaMid) info.strMediaMid = mediaMid;
    } else if (source === 'kg') {
      // 酷狗：主 ID 是文件 hash；albumId 用来区分同名不同版
      info.hash = str(s.hash || s.fileHash || s.audioHash || s.kugouHash || s.id);
      var albumId = str(s.albumId || s.album_id);
      if (albumId) info.albumId = albumId;
    } else if (source === 'wy') {
      // 网易云：主 ID 是 musicId（与 id 同值，LX 两个字段都会读）
      info.musicId = str(s.id);
      info.id = str(s.id);
    }

    return info;
  }

  /** 这条 musicInfo 是否带得动解析（三个主 ID 全空就没必要发请求）。 */
  function hasUsableId(info) {
    if (!info) return false;
    return !!(str(info.hash) || str(info.songmid) || str(info.musicId));
  }

  var api = {
    LX_SOURCE_BY_PROVIDER: LX_SOURCE_BY_PROVIDER,
    lxSourceKeyForProvider: lxSourceKeyForProvider,
    buildLxMusicInfo: buildLxMusicInfo,
    hasUsableId: hasUsableId,
  };
  global.LxMusicInfo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
