// ====================================================================
//  路由: 首页 / 场景电台 / 天气
//  - /api/discover/home
//  - /api/scene/presets, /api/scene/radio
//  - /api/weather/radio, /api/weather/ip-location
// ====================================================================
module.exports = function register(ctx) {
  const {
    sendJSON,
    handleDiscoverHome, SCENE_PRESETS,
    buildSceneRadio, buildWeatherRadio, fetchIpWeatherLocation,
    userCookie, kugouCookie, qishuiCookie,
    handleQishuiFeed, handleKugouGuessLike,
  } = ctx;

  return async function(req, res, url, pn) {
    if (pn === '/api/discover/home') {
      try {
        sendJSON(res, await handleDiscoverHome({ force: url.searchParams.get('force') === '1' || url.searchParams.get('refresh') === '1' }));
      } catch (err) {
        console.error('[DiscoverHome]', err);
        sendJSON(res, { error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500);
      }
      return;
    }

    // 9.18: 猜你喜欢 — 真推荐聚合（网易云日推 > 汽水 feed > 酷狗真推荐 fallback）
    if (pn === '/api/home/recommend') {
      try {
        // limit 缺省 = 不限制：上游给多少返多少；显式传 limit 才截断（上限 200）
        const limitParam = parseInt(url.searchParams.get('limit') || '0', 10) || 0;
        const limit = limitParam > 0 ? Math.min(200, limitParam) : 0;
        const cut = (songs) => (limit > 0 ? songs.slice(0, limit) : songs);
        const tried = [];
        // 1. 网易云每日推荐（真推荐算法，基于听歌历史）
        if (userCookie) {
          tried.push('netease');
          try {
            const disc = await handleDiscoverHome();
            const songs = (disc && disc.dailySongs) || [];
            if (songs.length) {
              sendJSON(res, { provider: 'recommend', source: 'netease-daily', loggedIn: true, songs: cut(songs), total: songs.length, updatedAt: Date.now() });
              return;
            }
          } catch (e) { console.warn('[HomeRecommend] netease:', e.message); }
        }
        // 2. 汽水 feed（真推荐，基于 played_media）
        if (qishuiCookie) {
          tried.push('qishui');
          try {
            const data = await handleQishuiFeed(limit > 0 ? limit : 200);
            const songs = (data && data.songs) || [];
            if (songs.length) {
              sendJSON(res, { provider: 'recommend', source: 'qishui-feed', loggedIn: true, songs: cut(songs), total: songs.length, updatedAt: Date.now() });
              return;
            }
          } catch (e) { console.warn('[HomeRecommend] qishui:', e.message); }
        }
        // 3. 酷狗真推荐 (私人FM > 每日推荐 > 歌单聚合保底)
        if (kugouCookie) {
          tried.push('kugou');
          try {
            const kgResult = await handleKugouGuessLike(ctx.kugouCookie, limit > 0 ? limit : 20);
            const songs = (kgResult && kgResult.songs) || [];
            if (songs.length) {
              const source = kgResult.source || 'kugou-fm';
              sendJSON(res, { provider: 'recommend', source: source, loggedIn: true, songs: cut(songs), total: songs.length, updatedAt: Date.now() });
              return;
            }
          } catch (e) { console.warn('[HomeRecommend] kugou:', e.message); }
        }
        sendJSON(res, { provider: 'recommend', loggedIn: false, songs: [], error: 'NO_PLATFORM_LOGIN', tried: tried, message: '登录网易云 / 汽水 / 酷狗后可获取推荐' });
      } catch (err) {
        console.error('[HomeRecommend]', err);
        sendJSON(res, { provider: 'recommend', loggedIn: false, songs: [], error: err.message }, 500);
      }
      return;
    }

    if (pn === '/api/scene/presets') {
      try {
        const scenes = Object.keys(SCENE_PRESETS).map((id) => {
          const preset = SCENE_PRESETS[id];
          return {
            id,
            label: preset.label || id,
            title: preset.title,
            tagline: preset.tagline,
            energy: preset.energy,
            warmth: preset.warmth,
            focus: preset.focus,
            melancholy: preset.melancholy,
            visualPreset: preset.visualPreset,
            coverGradient: preset.coverGradient,
            moodVisualLink: preset.moodVisualLink !== false,
            hours: Array.isArray(preset.hours) ? preset.hours.slice() : [],
          };
        });
        sendJSON(res, { ok: true, scenes });
      } catch (err) {
        sendJSON(res, { ok: false, error: err.message, scenes: [] }, 500);
      }
      return;
    }

    if (pn === '/api/scene/radio') {
      try {
        const scene = url.searchParams.get('scene') || url.searchParams.get('id') || 'focus';
        sendJSON(res, await buildSceneRadio(scene));
      } catch (err) {
        console.error('[SceneRadio]', err);
        sendJSON(res, {
          ok: false,
          error: err.message,
          weather: null,
          radio: { title: '场景电台', subtitle: '场景电台暂时不可用', seedQueries: [], songs: [] },
        }, 500);
      }
      return;
    }

    if (pn === '/api/weather/radio') {
      try {
        const data = await buildWeatherRadio({
          city: url.searchParams.get('city') || url.searchParams.get('q') || '',
          lat: url.searchParams.get('lat'),
          lon: url.searchParams.get('lon'),
          timezone: url.searchParams.get('timezone') || '',
        });
        sendJSON(res, data);
      } catch (err) {
        console.error('[WeatherRadio]', err);
        sendJSON(res, {
          ok: false,
          error: err.message,
          weather: null,
          radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
        }, 500);
      }
      return;
    }

    if (pn === '/api/weather/ip-location') {
      try {
        sendJSON(res, { ok: true, location: await fetchIpWeatherLocation() });
      } catch (err) {
        console.error('[WeatherIpLocation]', err);
        sendJSON(res, { ok: false, error: err.message, location: null }, 500);
      }
      return;
    }
  };
};
