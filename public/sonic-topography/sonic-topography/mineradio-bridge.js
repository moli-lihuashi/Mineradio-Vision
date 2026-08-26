(function () {
  var audioCallbacks = [];
  var lastAudioPayload = null;
  var mediaState = window.__mediaState || {
    title: '',
    artist: '',
    thumbnail: '',
    primaryColor: '',
    textColor: '',
    isPlaying: false,
    position: 0,
    duration: 0,
    _callbacks: []
  };
  window.__mediaState = mediaState;

  function notifyMediaChange() {
    (mediaState._callbacks || []).forEach(function (cb) {
      try {
        cb({
          title: mediaState.title,
          artist: mediaState.artist,
          thumbnail: mediaState.thumbnail,
          primaryColor: mediaState.primaryColor,
          textColor: mediaState.textColor,
          isPlaying: mediaState.isPlaying,
          position: mediaState.position,
          duration: mediaState.duration
        });
      } catch (e) {}
    });
  }
  window.__notifyMediaChange = notifyMediaChange;

  function wrapWeProperties(props) {
    var out = {};
    if (!props || typeof props !== 'object') return out;
    Object.keys(props).forEach(function (key) {
      var val = props[key];
      out[key] = val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, 'value') ? val : { value: val };
    });
    return out;
  }

  var embeddedDefaults = wrapWeProperties({
    showAlbumCover: false,
    showPlayerController: false,
    controllerSize: 'small',
    controllerX: 2,
    controllerY: 3
  });

  window.wallpaperRegisterAudioListener = function (cb) {
    if (typeof cb !== 'function') return;
    audioCallbacks.push(cb);
    if (lastAudioPayload && lastAudioPayload.length) {
      try { cb(lastAudioPayload); } catch (e) {}
    }
  };

  window.wallpaperRegisterMediaPropertiesListener = function (cb) {
    if (typeof cb === 'function') {
      mediaState._callbacks.push(cb);
      cb({
        title: mediaState.title,
        artist: mediaState.artist
      });
    }
  };

  window.wallpaperRegisterMediaThumbnailListener = function (cb) {
    if (typeof cb === 'function') {
      mediaState._thumbnailCb = cb;
      if (mediaState.thumbnail) {
        cb({
          thumbnail: mediaState.thumbnail,
          primaryColor: mediaState.primaryColor,
          textColor: mediaState.textColor
        });
      }
    }
  };

  window.wallpaperRegisterMediaPlaybackListener = function (cb) {
    if (typeof cb === 'function') {
      mediaState._playbackCb = cb;
      cb({ state: mediaState.isPlaying ? 0 : 1 });
    }
  };

  window.wallpaperRegisterMediaTimelineListener = function (cb) {
    if (typeof cb === 'function') {
      mediaState._timelineCb = cb;
      cb({ position: mediaState.position, duration: mediaState.duration });
    }
  };

  window.wallpaperMediaIntegration = { PLAYBACK_PLAYING: 0, PLAYBACK_PAUSED: 1 };

  function applyBridgeProperties(props) {
    var wrapped = wrapWeProperties(props);
    if (window.wallpaperPropertyListener) {
      if (window.wallpaperPropertyListener.applyUserProperties) {
        window.wallpaperPropertyListener.applyUserProperties(wrapped);
      }
      if (window.wallpaperPropertyListener.applyGeneralProperties) {
        window.wallpaperPropertyListener.applyGeneralProperties(wrapped);
      }
    }
  }

  applyBridgeProperties(embeddedDefaults);

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'mineradio-sonic') return;

    if (data.audio && data.audio.length) {
      lastAudioPayload = data.audio;
      audioCallbacks.forEach(function (cb) {
        try { cb(data.audio); } catch (e) {}
      });
    }

    if (data.media) {
      var m = data.media;
      if (m.title != null) mediaState.title = m.title;
      if (m.artist != null) mediaState.artist = m.artist;
      if (m.thumbnail != null) mediaState.thumbnail = m.thumbnail;
      if (m.primaryColor != null) mediaState.primaryColor = m.primaryColor;
      if (m.textColor != null) mediaState.textColor = m.textColor;
      if (m.isPlaying != null) mediaState.isPlaying = !!m.isPlaying;
      if (m.position != null) mediaState.position = Number(m.position) || 0;
      if (m.duration != null) mediaState.duration = Number(m.duration) || 0;
      notifyMediaChange();
      if (mediaState._thumbnailCb && mediaState.thumbnail) {
        mediaState._thumbnailCb({
          thumbnail: mediaState.thumbnail,
          primaryColor: mediaState.primaryColor,
          textColor: mediaState.textColor
        });
      }
      if (mediaState._playbackCb) {
        mediaState._playbackCb({ state: mediaState.isPlaying ? 0 : 1 });
      }
      if (mediaState._timelineCb) {
        mediaState._timelineCb({ position: mediaState.position, duration: mediaState.duration });
      }
    }

    if (data.properties) applyBridgeProperties(Object.assign({}, embeddedDefaults, data.properties));
  });
})();
