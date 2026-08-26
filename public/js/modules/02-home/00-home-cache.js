(function (global) {
  'use strict';

  var CACHE_KEY = 'mineradio-home-discover-cache-v1';
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  var WEATHER_CACHE_KEY = 'mineradio-home-weather-cache-v1';
  var WEATHER_CACHE_TTL_MS = 45 * 60 * 1000;

  function readCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return null;
      if (!raw.updatedAt || Date.now() - Number(raw.updatedAt) > CACHE_TTL_MS) return null;
      return {
        loggedIn: !!raw.loggedIn,
        mode: raw.mode || 'starter',
        songs: Array.isArray(raw.songs) ? raw.songs : [],
        playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
        podcasts: Array.isArray(raw.podcasts) ? raw.podcasts : [],
        updatedAt: Number(raw.updatedAt) || 0,
      };
    } catch (e) {
      return null;
    }
  }

  function writeCache(payload) {
    if (!payload) return false;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        loggedIn: !!payload.loggedIn,
        mode: payload.mode || 'starter',
        songs: Array.isArray(payload.songs) ? payload.songs.slice(0, 24) : [],
        playlists: Array.isArray(payload.playlists) ? payload.playlists.slice(0, 16) : [],
        podcasts: Array.isArray(payload.podcasts) ? payload.podcasts.slice(0, 12) : [],
        updatedAt: Number(payload.updatedAt) || Date.now(),
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  function readWeatherCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return null;
      if (!raw.updatedAt || Date.now() - Number(raw.updatedAt) > WEATHER_CACHE_TTL_MS) return null;
      return {
        city: raw.city || '',
        weather: raw.weather || null,
        radio: raw.radio || null,
        updatedAt: Number(raw.updatedAt) || 0,
      };
    } catch (e) {
      return null;
    }
  }

  function writeWeatherCache(payload) {
    if (!payload) return false;
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
        city: payload.city || '',
        weather: payload.weather || null,
        radio: payload.radio || null,
        updatedAt: Number(payload.updatedAt) || Date.now(),
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearWeatherCache() {
    try { localStorage.removeItem(WEATHER_CACHE_KEY); } catch (e) {}
  }

  global.Mineradio = global.Mineradio || {};
  global.Mineradio.home = {
    readCache: readCache,
    writeCache: writeCache,
    clearCache: clearCache,
    readWeatherCache: readWeatherCache,
    writeWeatherCache: writeWeatherCache,
    clearWeatherCache: clearWeatherCache,
    CACHE_KEY: CACHE_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
