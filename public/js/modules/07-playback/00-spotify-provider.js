'use strict';

/* ===== Spotify Search（委托统一 registry） ===== */
var providerHandlers = providerHandlers || {};
providerHandlers['spotify'] = {
  search: function(q, offset, limit) {
    var url = typeof searchProviderUrl === 'function'
      ? searchProviderUrl('spotify', q, limit || 10, offset || 0)
      : ('/api/spotify/search?keywords=' + encodeURIComponent(q) + '&limit=' + (limit || 10) + '&offset=' + (offset || 0));
    return apiJson(url)
      .then(function (r) { return r && r.songs || []; })
      .catch(function (e) { console.warn('Spotify search failed:', e); return []; });
  },
  login: function() {
    openSpotifyWebLogin();
  }
};
