'use strict';

// 天气电台：定位 → Open-Meteo 天气 → 心情画像 → 选歌/排序。
// 从 server.js 抽出（原为单文件内 ~750 行），依赖由调用方注入，
// 本模块不 require server.js，避免循环依赖。
//
// deps: {
//   UA, requestJson, handleSearch, handleSongUrl,
//   playlistDetail, playlistTrackAll, mapSongRecord, getUserCookie
// }

module.exports = function createWeatherRadio(deps) {
  const {
    UA,
    requestJson,
    handleSearch,
    handleSongUrl,
    // 函数体里用的是网易 API 的原始下划线名（playlist_detail / playlist_track_all），
    // deps 接口用的是驼峰。之前只解构了驼峰、没起别名 → 函数体里两个名字成为自由变量，
    // 而它们都出现在 `typeof x === 'function'` 守卫里（typeof 对未声明变量返回 'undefined'，
    // 不抛错），于是这两条「播客歌单兜底取曲」分支从第 1 块拆分起就一直静默不执行。
    playlistDetail: playlist_detail,
    playlistTrackAll: playlist_track_all,
    mapSongRecord,
    getUserCookie,
  } = deps || {};

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'https://ip-api.com/json/';
const WEATHER_IPWHO_URL = 'https://ipwho.is/';
const WEATHER_IPAPI_CO_URL = 'https://ipapi.co/json/';
const WEATHER_REVERSE_GEO_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const WEATHER_NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  code = Number(code);
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code === 51 || code === 53 || code === 55) return '毛毛雨';
  if (code === 56 || code === 57) return '冻雨';
  if (code === 61 || code === 63 || code === 65) return '雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '雪';
  if (code === 80 || code === 81 || code === 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code === 95 || code === 96 || code === 99) return '雷雨';
  return '天气';
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

async function resolveOpenMeteoLocation(query) {
  const raw = String(query || '').trim();
  if (!raw) return WEATHER_DEFAULT_LOCATION;
  const u = new URL(OPEN_METEO_GEOCODE_URL);
  u.searchParams.set('name', raw);
  u.searchParams.set('count', '5');
  u.searchParams.set('language', 'zh');
  u.searchParams.set('format', 'json');
  if (/[\u4e00-\u9fff]/.test(raw)) u.searchParams.set('countryCode', 'CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const results = body && Array.isArray(body.results) ? body.results : [];
  const first = results.find(item => item && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
    || results[0];
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true };
  return {
    name: first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  };
}

function isGenericWeatherLocationName(name) {
  const raw = String(name || '').trim();
  return !raw || raw === '当前位置' || raw === '定位中';
}

function cleanWeatherPlaceLabel(value) {
  return String(value || '')
    .replace(/(市|区|县|區|省|自治区|壮族自治区|维吾尔自治区|回族自治区|特别行政区)$/u, '')
    .trim();
}

function formatBigDataCloudLabel(body) {
  if (!body) return '';
  const city = cleanWeatherPlaceLabel(body.city);
  const district = cleanWeatherPlaceLabel(body.locality);
  const province = cleanWeatherPlaceLabel(body.principalSubdivision);
  if (district && city && district !== city) return district + ' · ' + city;
  if (city && province && city !== province) return city + ' · ' + province;
  if (city) return city;
  if (district) return district;
  if (province) return province;
  return '';
}

function formatNominatimLabel(body) {
  const addr = body && body.address;
  if (!addr) return String(body && body.display_name || '').split(',')[0].trim();
  const district = cleanWeatherPlaceLabel(addr.city_district || addr.district || addr.suburb || addr.borough);
  const city = cleanWeatherPlaceLabel(addr.city || addr.town || addr.county || addr.municipality || addr.village);
  const state = cleanWeatherPlaceLabel(addr.state || addr.province || addr.region);
  if (district && city && district !== city) return district + ' · ' + city;
  if (city && state && city !== state) return city + ' · ' + state;
  if (city) return city;
  if (state) return state;
  if (district) return district;
  return String(body.display_name || '').split(',')[0].trim();
}

async function reverseBigDataCloudLocation(lat, lon) {
  const u = new URL(WEATHER_REVERSE_GEO_URL);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('localityLanguage', 'zh');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const name = formatBigDataCloudLabel(body);
  if (!name) return null;
  return {
    name,
    country: body && body.countryName || '',
    admin1: body && body.principalSubdivision || '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'bigdatacloud',
  };
}

async function reverseNominatimLocation(lat, lon) {
  const u = new URL(WEATHER_NOMINATIM_REVERSE_URL);
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lon));
  u.searchParams.set('format', 'json');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'zh-CN,zh');
  u.searchParams.set('zoom', '10');
  const body = await requestJson(u.toString(), {
    headers: {
      'User-Agent': 'MineradioWeather/1.0 (reverse-geocode)',
      Accept: 'application/json',
    },
  });
  const name = formatNominatimLabel(body);
  if (!name) return null;
  const addr = body && body.address || {};
  return {
    name,
    country: addr.country || '',
    admin1: addr.state || addr.province || addr.region || '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'nominatim',
  };
}

async function resolveWeatherLocationLabel(lat, lon, hintCity) {
  if (!isGenericWeatherLocationName(hintCity)) {
    return {
      name: String(hintCity).trim(),
      country: '',
      admin1: '',
      latitude: lat,
      longitude: lon,
      timezone: 'auto',
      provider: 'manual',
    };
  }
  const providers = [reverseBigDataCloudLocation, reverseNominatimLocation];
  for (const provider of providers) {
    try {
      const resolved = await provider(lat, lon);
      if (resolved && resolved.name) return resolved;
    } catch (e) {
      console.warn('[WeatherRadio] reverse geocode failed:', provider.name || 'provider', e.message);
    }
  }
  try {
    const ip = await fetchIpWeatherLocation();
    if (ip && ip.city && !isGenericWeatherLocationName(ip.city)) {
      const name = ip.region && ip.region !== ip.city
        ? cleanWeatherPlaceLabel(ip.city) + ' · ' + cleanWeatherPlaceLabel(ip.region)
        : cleanWeatherPlaceLabel(ip.city);
      return {
        name,
        country: ip.country || '',
        admin1: ip.region || '',
        latitude: lat,
        longitude: lon,
        timezone: ip.timezone || 'auto',
        provider: ip.provider || 'ip-label',
      };
    }
  } catch (e) {
    console.warn('[WeatherRadio] ip label fallback failed:', e.message);
  }
  return {
    name: String(hintCity || '当前位置').trim() || '当前位置',
    country: '',
    admin1: '',
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    provider: 'coords',
  };
}

function normalizeIpWeatherLocation(payload) {
  if (!payload || !Number.isFinite(Number(payload.latitude)) || !Number.isFinite(Number(payload.longitude))) return null;
  const city = String(payload.city || payload.region || '').trim();
  return {
    provider: payload.provider || 'ip',
    city: city || '当前位置',
    region: payload.region || '',
    country: payload.country || '',
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    timezone: payload.timezone || 'auto',
    ip: payload.ip || '',
  };
}

async function fetchIpWeatherLocationFromIpWho() {
  const body = await requestJson(WEATHER_IPWHO_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!body || body.success === false) {
    const err = new Error(body && body.message || 'IPWHO_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ipwho',
    city: body.city,
    region: body.region,
    country: body.country,
    latitude: body.latitude,
    longitude: body.longitude,
    timezone: body.timezone && body.timezone.id ? body.timezone.id : body.timezone,
    ip: body.ip,
  });
}

async function fetchIpWeatherLocationFromIpApiCo() {
  const body = await requestJson(WEATHER_IPAPI_CO_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!body || body.error) {
    const err = new Error(body && body.reason || body && body.error || 'IPAPI_CO_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ipapi-co',
    city: body.city,
    region: body.region,
    country: body.country_name || body.country,
    latitude: body.latitude,
    longitude: body.longitude,
    timezone: body.timezone,
    ip: body.ip,
  });
}

async function fetchIpWeatherLocationFromIpApi() {
  const u = new URL(WEATHER_IP_LOCATION_URL);
  u.searchParams.set('fields', 'status,message,country,regionName,city,lat,lon,timezone,query');
  u.searchParams.set('lang', 'zh-CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  if (!body || body.status !== 'success' || !Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lon))) {
    const err = new Error(body && body.message || 'IP_API_FAILED');
    err.body = body;
    throw err;
  }
  return normalizeIpWeatherLocation({
    provider: 'ip-api',
    city: body.city,
    region: body.regionName,
    country: body.country,
    latitude: body.lat,
    longitude: body.lon,
    timezone: body.timezone,
    ip: body.query,
  });
}

async function fetchOpenMeteoWeather(params) {
  params = params || {};
  let location;
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const hintCity = String(params.city || params.name || '当前位置').trim() || '当前位置';
    const resolved = await resolveWeatherLocationLabel(lat, lon, hintCity);
    location = {
      name: resolved.name,
      country: resolved.country || '',
      admin1: resolved.admin1 || '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || resolved.timezone || 'auto',
      labelProvider: resolved.provider || '',
    };
  } else {
    location = await resolveOpenMeteoLocation(params.city || params.q || params.location);
  }
  const u = new URL(OPEN_METEO_FORECAST_URL);
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', location.timezone || 'auto');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const cur = body && body.current || {};
  const weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: body.timezone || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    updatedAt: Date.now(),
  };
  weather.mood = buildWeatherMood(weather);
  return weather;
}

async function fetchIpWeatherLocation() {
  const providers = [
    fetchIpWeatherLocationFromIpWho,
    fetchIpWeatherLocationFromIpApiCo,
    fetchIpWeatherLocationFromIpApi,
  ];
  let lastErr = null;
  for (const provider of providers) {
    try {
      const loc = await provider();
      if (loc) return loc;
    } catch (e) {
      lastErr = e;
      console.warn('[WeatherIpLocation]', provider.name || 'provider', e.message);
    }
  }
  throw lastErr || new Error('IP_LOCATION_FAILED');
}


function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

function uniqueSongsByKey(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    const key = String(song && (song.id || song.name + '|' + song.artist) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function tagWeatherPoolSongs(songs, source) {
  return (songs || []).map(song => ({ ...song, weatherSource: source }));
}

async function fetchWeatherPlaylistSongs(playlist, limit) {
  const id = playlist && playlist.id;
  if (!id) return [];
  let rawTracks = [];
  try {
    if (typeof playlist_track_all === 'function') {
      const all = await playlist_track_all({ id, limit: limit || 36, offset: 0, cookie: getUserCookie(), timestamp: Date.now() });
      rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
    }
  } catch (e) {
    console.warn('[WeatherRadio] playlist_track_all failed:', playlist && playlist.name, e.message);
  }
  if (!rawTracks.length && typeof playlist_detail === 'function') {
    try {
      const detail = await playlist_detail({ id, s: 0, cookie: getUserCookie(), timestamp: Date.now() });
      const pl = (detail.body && detail.body.playlist) || {};
      rawTracks = pl.tracks || [];
    } catch (e) {
      console.warn('[WeatherRadio] playlist_detail failed:', playlist && playlist.name, e.message);
    }
  }
  return rawTracks.map(mapSongRecord).filter(song => song.id && song.name).slice(0, limit || 36);
}

async function filterLikelyPlayableWeatherSongs(songs) {
  const source = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .slice(0, 24);
  const playable = [];
  const fallback = source.slice(0, 24);
  for (let i = 0; i < source.length; i += 4) {
    const chunk = source.slice(i, i + 4);
    const settled = await Promise.allSettled(chunk.map(async song => {
      const info = await handleSongUrl(song.id, { loggedIn: !!getUserCookie() }, 'standard');
      return info && info.url ? song : null;
    }));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) playable.push(result.value);
      else if (result.status === 'rejected') console.warn('[WeatherRadio] playable probe failed:', chunk[idx] && chunk[idx].name, result.reason && result.reason.message);
    });
    if (playable.length >= 12) break;
  }
  return (playable.length ? playable : fallback).slice(0, 24);
}

function isLowSignalWeatherSong(song) {
  const text = String([
    song && song.name,
    song && song.artist,
    song && song.album,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!text) return true;
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true;
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true;
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true;
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true;
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text)) return true;
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true;
  return false;
}

function scoreWeatherSong(song, mood) {
  const text = String((song && song.name || '') + ' ' + (song && song.artist || '') + ' ' + (song && song.album || '')).toLowerCase();
  let score = 0;
  if (song && song.cover) score += 4;
  if (song && song.duration) score += 2;
  if (song && song.weatherSource === 'daily') score += 6;
  if (song && song.weatherSource === 'private') score += 4;
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text)) score += 10;
  const key = String(mood && mood.key || '');
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5;
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5;
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5;
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5;
  return score;
}

function weatherArtistKey(song) {
  const raw = String(song && song.artist || song && song.name || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return raw.trim().toLowerCase() || 'unknown';
}

function weatherTitleKey(song) {
  return String(song && song.name || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim();
}

function uniqueWeatherTitles(sorted) {
  const seen = new Set();
  const out = [];
  (sorted || []).forEach(song => {
    const key = weatherTitleKey(song);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(song);
  });
  return out;
}

function diversifyWeatherSongs(sorted, artistLimit) {
  const primary = [];
  const deferred = [];
  const counts = new Map();
  (sorted || []).forEach(song => {
    const key = weatherArtistKey(song);
    const count = counts.get(key) || 0;
    if (count < artistLimit) {
      primary.push(song);
      counts.set(key, count + 1);
    } else {
      deferred.push(song);
    }
  });
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length));
}

function orderWeatherSongs(songs, mood) {
  const sorted = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood));
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2);
}

async function buildRadioFromMood(mood, seedQueries, weatherShell) {
  const queries = (Array.isArray(seedQueries) && seedQueries.length ? seedQueries : weatherRadioSeedQueries(mood)).slice(0, 5);
  let songs = [];
  const settled = await Promise.allSettled(queries.slice(0, 4).map(q => handleSearch(q, 6)));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  if (songs.length < 10 && mood && Array.isArray(mood.keywords)) {
    const more = await Promise.allSettled(mood.keywords.slice(0, 2).map(q => handleSearch(q, 6)));
    more.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
    });
  }
  songs = orderWeatherSongs(songs, mood);
  const weather = weatherShell || {
    provider: 'open-meteo',
    label: mood.title,
    temperature: null,
    mood,
    updatedAt: Date.now(),
  };
  if (!weather.mood) weather.mood = mood;
  return {
    ok: true,
    weather,
    radio: {
      title: mood.title,
      subtitle: mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      sceneKey: mood.key || '',
      updatedAt: Date.now(),
    },
  };
}

// ====================================================================
//  场景电台（Scene Radio）
//  旧实现：只打网易云 cloudsearch + 固定取 keywords.slice(0,4) + 再套天气过滤器。
//  三个后果叠在一起 = 用户感知的「只有固定的那几首歌」：
//    1. 关键词固定 → 上游返回的也是同一批
//    2. orderWeatherSongs → isLowSignalWeatherSong 会把「纯音乐 / 钢琴 / instrumental /
//       雨声 / 白噪音 / 助眠」整类过滤掉，而这些**正是 focus / sleep / rain 场景的关键词**，
//       结果只剩少数漏网曲目，每次都是同样几首
//    3. 只接网易云，没登录网易云时列表更窄
//  现在：多音源轮转交错 + 关键词池随机抽 + 每 20 分钟换一批 + 场景专用过滤器（不误杀纯音乐）。
// ====================================================================

// 注：SCENE_RADIO_* / sceneRadioCache / SCENE_KEYWORD_EXTRA 原本被放错在这里，
//     实际使用方是场景电台，已随第 5 块拆分移到 server/lib/scene-radio.js。

  async function buildWeatherRadio(params) {
    let weather;
    try {
      weather = await fetchOpenMeteoWeather(params);
    } catch (e) {
      console.warn('[WeatherRadio] weather provider failed, using fallback radio:', e.message);
      weather = fallbackWeatherForRadio(params, e);
    }
    const queries = weatherRadioSeedQueries(weather.mood);
    return buildRadioFromMood(weather.mood, queries, weather);
  }

  return {
    clampNumber,
    openMeteoWeatherLabel,
    buildWeatherMood,
    buildWeatherRadio,
    resolveOpenMeteoLocation,
    isGenericWeatherLocationName,
    cleanWeatherPlaceLabel,
    formatBigDataCloudLabel,
    formatNominatimLabel,
    reverseBigDataCloudLocation,
    reverseNominatimLocation,
    resolveWeatherLocationLabel,
    normalizeIpWeatherLocation,
    fetchIpWeatherLocationFromIpWho,
    fetchIpWeatherLocationFromIpApiCo,
    fetchIpWeatherLocationFromIpApi,
    fetchOpenMeteoWeather,
    fetchIpWeatherLocation,
    weatherRadioSeedQueries,
    fallbackWeatherForRadio,
    uniqueSongsByKey,
    tagWeatherPoolSongs,
    fetchWeatherPlaylistSongs,
    filterLikelyPlayableWeatherSongs,
    isLowSignalWeatherSong,
    scoreWeatherSong,
    weatherArtistKey,
    weatherTitleKey,
    uniqueWeatherTitles,
    diversifyWeatherSongs,
    orderWeatherSongs,
    buildRadioFromMood,
  };
};
