'use strict';

// Spotify：资源映射（上游 JSON → 前端结构，纯函数）。
//
// 从 spotify-api.js 抽出。零出边：只做形状转换，不认识「谁在调它」。

const {
  normalizeText,
  spotifyUrl,
} = require('./config');

function spotifyImage(images) {
  images = Array.isArray(images) ? images.filter(item => item && item.url) : [];
  if (!images.length) return '';
  const sorted = images.slice().sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  return sorted[0].url || '';
}

function mapSpotifyTrack(track, index, query) {
  track = track || {};
  const id = normalizeText(track.id);
  const name = normalizeText(track.name);
  if (!id || !name || track.is_local) return null;
  const album = track.album || {};
  const artists = Array.isArray(track.artists) ? track.artists.map(artist => ({
    id: normalizeText(artist && artist.id),
    name: normalizeText(artist && artist.name),
    mid: normalizeText(artist && artist.id),
    uri: normalizeText(artist && artist.uri),
  })).filter(artist => artist.name) : [];
  const artistText = artists.map(artist => artist.name).join(' / ');
  return {
    provider: 'spotify',
    source: 'spotify',
    type: 'spotify',
    id,
    providerSongId: id,
    spotifyId: id,
    uri: normalizeText(track.uri),
    spotifyUri: normalizeText(track.uri),
    spotifyUrl: track.external_urls && track.external_urls.spotify || '',
    name,
    artist: artistText,
    artists,
    album: normalizeText(album.name),
    albumId: normalizeText(album.id),
    albumUri: normalizeText(album.uri),
    cover: spotifyImage(album.images),
    duration: Math.max(0, Math.round((Number(track.duration_ms) || 0) / 1000)),
    durationMs: Number(track.duration_ms) || 0,
    popularity: Number(track.popularity || 0) || 0,
    explicit: !!track.explicit,
    fee: 0,
    playable: false,
    playbackMode: 'recommend-match',
    recommendationSource: 'spotify-web-api',
    spotifyRank: index,
    spotifyQuery: query || '',
    previewUrl: track.preview_url || '',
    restriction: {
      category: 'provider_limited',
      reason: 'spotify_metadata_only',
      message: 'Spotify 官方 Web API 当前作为搜索/歌单资料源接入，播放会自动寻找其它可播版本。',
      action: 'switch_source',
    },
  };
}

function dedupeSpotifySongs(songs) {
  const out = [];
  const seen = new Set();
  (songs || []).forEach((song) => {
    const key = (song.id || '') + '|' + normalizeText(song.name).toLowerCase() + '|' + normalizeText(song.artist).toLowerCase();
    if (!song || !song.name || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function normalizeSpotifyProfile(profile) {
  profile = profile || {};
  const product = normalizeText(profile.product || '').toLowerCase();
  const isPremium = product === 'premium';
  return {
    userId: normalizeText(profile.id),
    accountId: normalizeText(profile.account_id),
    nickname: normalizeText(profile.display_name || 'Spotify'),
    avatar: spotifyImage(profile.images),
    country: normalizeText(profile.country),
    product: product || 'unknown',
    vipType: isPremium ? 1 : 0,
    vipLevel: isPremium ? 'vip' : 'none',
    vipLabel: isPremium ? 'Premium' : (product ? product.toUpperCase() : '方案未知'),
    membershipKnown: !!product,
    isVip: isPremium,
    isSvip: false,
  };
}

function mapSpotifyPlaylist(item, profile) {
  item = item || {};
  const id = normalizeText(item.id);
  if (!id) return null;
  const owner = item.owner || {};
  const ownerId = normalizeText(owner.id);
  const profileId = normalizeText(profile && profile.id);
  const owned = !!(profileId && ownerId === profileId);
  return {
    provider: 'spotify',
    source: 'spotify',
    id,
    name: normalizeText(item.name || 'Spotify Playlist'),
    cover: spotifyImage(item.images),
    creator: normalizeText(owner.display_name || owner.id || 'Spotify'),
    trackCount: Number(item.items && item.items.total) || Number(item.tracks && item.tracks.total) || 0,
    playCount: 0,
    subscribed: !owned,
    shelfPane: owned ? 'mine' : 'fav',
    public: item.public,
    collaborative: !!item.collaborative,
    spotifyUrl: item.external_urls && item.external_urls.spotify || '',
    spotifyUri: normalizeText(item.uri),
  };
}

function spotifyLibraryUri(type, value) {
  type = normalizeText(type || 'track').toLowerCase();
  value = normalizeText(value && typeof value === 'object'
    ? (value.spotifyUri || value.uri || value.spotifyId || value.providerSongId || value.albumId || value.id)
    : value);
  if (/^spotify:(?:track|album|playlist|episode|show|audiobook|artist|user):[^:]+$/i.test(value)) return value;
  value = value.replace(/^spotify:(?:track|album|playlist):/i, '');
  if (!/^(?:track|album|playlist|episode|show|audiobook|artist|user)$/.test(type) || !value) return '';
  return 'spotify:' + type + ':' + value;
}

module.exports = {
  spotifyImage,
  mapSpotifyTrack,
  dedupeSpotifySongs,
  normalizeSpotifyProfile,
  mapSpotifyPlaylist,
  spotifyLibraryUri,
};
