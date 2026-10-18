'use strict';

// 场景电台：按「专注 / 通勤 / 派对 / 睡眠 / 雨天 / 深夜」等预设选歌。
//   · SCENE_PRESETS：每个场景的画像（能量/暖度/专注度等）+ 关键词池 + 视觉预设
//   · 多音源轮转交错 + 关键词池随机抽 + 每 20 分钟换一批 + 场景专用过滤器（不误杀纯音乐）
// 从 server.js 抽出（原 server.js 1340–1721 的 SCENE_PRESETS 与 12 个函数）。
// 注：SCENE_RADIO_* / sceneRadioCache / SCENE_KEYWORD_EXTRA 原被误放进 weather-radio.js
//     （那里一次都没用，而使用方是本文件），第 5 块拆分时归位到这里。
// cookie 都是 server.js 的 let（持久化层会重新赋值）→ 以 getter 注入。

module.exports = function createSceneRadio(deps) {
  const {
    handleSearch,
    handleKugouSearch,
    handleQQSearch,
    handleQishuiSearch,
    qishuiCookieHasLogin,
    // 场景去重用的艺人 key 与天气域共用（避免同名不同写法被判成两首）
    weatherArtistKey,
    getKugouCookie,
    getQishuiCookie,
    getQQCookie,
  } = deps || {};

  const SCENE_PRESETS = {
    focus: {
      key: 'scene-focus',
      title: '专注场景',
      tagline: '低密度节奏，把注意力留给手头的事',
      label: '专注',
      energy: 0.34,
      warmth: 0.42,
      focus: 0.88,
      melancholy: 0.28,
      visualPreset: 0,
      coverGradient: ['#3d5a80', '#1d2d44'],
      moodVisualLink: false,
      hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
      keywords: ['lofi study', 'ambient piano', 'post rock instrumental', '纯音乐 学习', '轻电子 专注'],
    },
    commute: {
      key: 'scene-commute',
      title: '通勤场景',
      tagline: '节拍清楚，但不抢你的注意力',
      label: '通勤',
      energy: 0.58,
      warmth: 0.52,
      focus: 0.56,
      melancholy: 0.22,
      visualPreset: 4,
      coverGradient: ['#f4a261', '#bc4749'],
      moodVisualLink: true,
      hours: [7, 8, 9, 17, 18, 19],
      keywords: ['早晨 通勤', 'city pop', 'indie pop', '轻快 华语', '公路 歌单'],
    },
    party: {
      key: 'scene-party',
      title: '派对场景',
      tagline: '把能量拉高，让视觉跟着鼓点走',
      label: '派对',
      energy: 0.82,
      warmth: 0.72,
      focus: 0.34,
      melancholy: 0.12,
      visualPreset: 6,
      coverGradient: ['#ff006e', '#8338ec'],
      moodVisualLink: true,
      hours: [20, 21, 22, 23, 0, 1],
      keywords: ['dance pop', 'house 派对', '华语 舞曲', 'edm 热门', 'hip hop party'],
    },
    sleep: {
      key: 'scene-sleep',
      title: '睡前场景',
      tagline: '音量与亮度都收一点，慢慢进入休息',
      label: '睡前',
      energy: 0.22,
      warmth: 0.38,
      focus: 0.76,
      melancholy: 0.48,
      visualPreset: 9,
      coverGradient: ['#4895ef', '#3a0ca3'],
      moodVisualLink: false,
      hours: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
      keywords: ['sleep ambient', 'night jazz', 'lofi sleep', '钢琴 晚安', '慢歌 华语'],
    },
    rain: {
      key: 'scene-rain',
      title: '雨夜场景',
      tagline: '潮湿、柔软、适合把房间关小一点',
      label: '雨夜',
      energy: 0.36,
      warmth: 0.40,
      focus: 0.68,
      melancholy: 0.70,
      visualPreset: 9,
      coverGradient: ['#5c677d', '#33415c'],
      moodVisualLink: true,
      hours: [18, 19, 20, 21, 22, 23],
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    },
  };

  const SCENE_RADIO_ROTATE_MS = 20 * 60 * 1000;   // 每 20 分钟换一批歌
  const SCENE_RADIO_CACHE_TTL_MS = 20 * 60 * 1000;
  const SCENE_RADIO_MAX_SONGS = 18;
  const SCENE_RADIO_PER_KEYWORD = 8;
  const sceneRadioCache = new Map();

  // 每个场景的补充关键词池（和 SCENE_PRESETS.keywords 合并后使用）
  const SCENE_KEYWORD_EXTRA = {
    focus: [
      'chill instrumental', 'study beats', '钢琴 专注', '氛围 电子 纯音乐',
      'minimal techno', '电影原声 专注', '吉他 指弹 安静', 'lo-fi 工作',
      'deep focus ambient', 'post rock 纯音乐',
    ],
    commute: [
      'morning pop', '华语 流行 轻快', 'funk 通勤', 'synthpop',
      'city pop 夜', '摇滚 路上', '日语 city pop', 'indie rock 白天',
      '公路 旅行 歌单', 'britpop 上班',
    ],
    party: [
      'latin party', '华语 说唱 燃', 'disco funk', 'kpop 舞曲',
      'techno 派对', 'trap 燃', 'funk 律动', 'reggaeton',
      'afrobeats party', '电子 高能 舞曲',
    ],
    sleep: [
      'ambient drone', 'rain piano', '吉他 摇篮曲', 'soft jazz 夜',
      '冥想 助眠', 'chillhop sleep', '竖琴 安静', '梦境 纯音乐',
      'delta waves 睡眠', 'slow piano 晚安',
    ],
    rain: [
      '雨声 钢琴', 'jazz 雨夜', 'shoegaze', 'trip hop',
      '华语 慢歌 夜', 'soul 慢板', 'dark ambient', '雨天 民谣',
      'rainy lofi', '细雨 纯音乐',
    ],
  };

  function sceneRadioBucket(now) {
    return Math.floor((Number(now) || Date.now()) / SCENE_RADIO_ROTATE_MS);
  }
  // 稳定的确定性哈希/洗牌：同一个 bucket 内结果不变（避免点两次就换）、跨 bucket 自动换一批
  function sceneRotateSeed(text) {
    let hash = 2166136261;
    const str = String(text || '');
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function sceneShuffle(list, seed) {
    const out = Array.isArray(list) ? list.slice() : [];
    let state = (seed >>> 0) || 1;
    for (let i = out.length - 1; i > 0; i -= 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
  function sceneKeywordCandidates(sceneId, preset) {
    const list = []
      .concat(Array.isArray(preset && preset.keywords) ? preset.keywords : [])
      .concat(SCENE_KEYWORD_EXTRA[sceneId] || []);
    const seen = new Set();
    return list.filter((item) => {
      const key = String(item || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  // 当前可用的音源。网易云永远在（匿名也能搜），其余看 cookie 是否存在/可用。
  function sceneRadioProviders() {
    const providers = ['netease'];
    if (getKugouCookie()) providers.push('kugou');
    if (getQQCookie()) providers.push('qq');
    try {
      if (getQishuiCookie() && qishuiCookieHasLogin(getQishuiCookie())) providers.push('qishui');
    } catch (e) {}
    return providers;
  }
  async function searchSceneProvider(key, keyword, limit) {
    if (key === 'kugou') {
      const songs = await handleKugouSearch(keyword, limit, getKugouCookie(), 0);
      return Array.isArray(songs) ? songs : [];
    }
    if (key === 'qq') {
      const songs = await handleQQSearch(keyword, limit);
      return Array.isArray(songs) ? songs : [];
    }
    if (key === 'qishui') {
      const result = await handleQishuiSearch(keyword, limit, getQishuiCookie(), 0);
      return Array.isArray(result && result.songs) ? result.songs : [];
    }
    const songs = await handleSearch(keyword, limit);
    return Array.isArray(songs) ? songs : [];
  }
  // 场景专用低信号过滤：和天气那套相反 —— **纯音乐 / 钢琴 / instrumental / 雨声 / 白噪音是场景本体**，
  // 不能像 isLowSignalWeatherSong 那样整类砍掉。只拦 AI 生成、翻唱冒充原唱、伴奏、karaoke、测试音频。
  function isLowSignalSceneSong(song) {
    const text = String([song && song.name, song && song.artist, song && song.album].filter(Boolean).join(' ')).toLowerCase();
    if (!text) return true;
    if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声|伴奏|纯音乐)?|$|[\s\-_/）)])/i.test(text)) return true;
    if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|beat\s*maker/i.test(text)) return true;
    if (/翻自|伴奏|karaoke|去人声|消音版/i.test(text)) return true;
    const name = String(song && song.name || '').trim();
    if (/^(test|测试|未知歌曲|untitled|track\s*\d+)$/i.test(name)) return true;
    return false;
  }
  function sceneSongKey(song) {
    const name = String(song && song.name || '').toLowerCase().replace(/[（(][^）)]*[）)]/g, '').replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '');
    const artist = String(song && song.artist || '').split(/\s*\/\s*|、|,|&/)[0].toLowerCase().replace(/\s+/g, '');
    return (name + '|' + artist).trim();
  }
  // 「关键词回声」= 歌名就是把搜索词念一遍（UGC 填充曲的典型特征，汽水公共目录尤其多：
  // 搜「纯音乐 学习」能返回「纯音乐学习 / 学习静心治愈纯音乐 / 静心阅读学习纯音乐」…）。
  // 这类曲目**不是全丢**（它们有时确实是可用的环境音乐），而是：
  //   · 同一个关键词的回声最多留 1 首（按族去重）
  //   · 全部排到列表末尾，且总量封顶 2 首
  function normalizeSceneText(text) {
    // 〜 / ～ / ~ / ・ 也算分隔符：日文曲名常拿它们拼副标题
    // （「真夜中のドア〜stay with me」 vs「真夜中のドア/Stay With Me」是同一首）。
    // ヴ→ブ：日本曲库里「プラスティック・ラヴ」「プラスティック・ラブ」是同一首的两种写法。
    return String(text || '')
      .toLowerCase()
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s._\-·・'’"“”「」《》:：/\\|〜～~]+/g, '')
      .replace(/ヴ/g, 'ブ');
  }
  function sceneEchoFamily(song, keywords) {
    const name = normalizeSceneText(song && song.name);
    if (!name) return '';
    for (let i = 0; i < (keywords || []).length; i += 1) {
      const keyword = String(keywords[i] || '').trim();
      const flat = normalizeSceneText(keyword);
      if (!flat) continue;
      if (name === flat || name.indexOf(flat) >= 0) return 'kw:' + keyword;
      // 「纯音乐」+「学习」这种被拆开重排的，用 token 覆盖判定（至少两个 token 才判，避免单词误杀）
      const tokens = keyword.toLowerCase().split(/\s+/).map((t) => normalizeSceneText(t)).filter((t) => t.length >= 2);
      if (tokens.length >= 2 && tokens.every((t) => name.indexOf(t) >= 0)) return 'kw:' + keyword;
    }
    return '';
  }
  async function buildSceneRadioSongs(sceneId, preset) {
    const bucket = sceneRadioBucket();
    const providers = sceneRadioProviders();
    const providerSig = providers.join(',');
    const cacheKey = sceneId + '|' + bucket + '|' + providerSig;
    const cached = sceneRadioCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SCENE_RADIO_CACHE_TTL_MS) return cached.value;

    const pool = sceneKeywordCandidates(sceneId, preset);
    const seed = sceneRotateSeed(sceneId + '|' + bucket);
    // 每次从池里抽 3 个不同关键词；每个音源按顺序分到一个，避免所有音源打同一句
    const picks = sceneShuffle(pool, seed).slice(0, Math.min(3, pool.length));
    if (!picks.length) return { songs: [], sources: providers, keywords: [] };

    // 每个音源 × 每个关键词都搜一遍（3 关键词 × N 音源），而不是一个音源只分到一个关键词 ——
    // 一对一的话候选量太少（正片只剩 7 首），凑不满 18 首。有 20 分钟缓存兜底，上游压力可接受。
    const rawBatches = await Promise.all(providers.map((provider) => {
      return Promise.all(picks.map((keyword) => searchSceneProvider(provider, keyword, SCENE_RADIO_PER_KEYWORD)
        .catch((err) => {
          console.warn('[SceneRadio] ' + provider + ' search failed (' + keyword + '):', err && err.message);
          return [];
        })))
        .then((groups) => {
          const merged = [];
          const seen = new Set();
          groups.forEach((songs) => {
            (Array.isArray(songs) ? songs : []).forEach((song) => {
              if (!song || typeof song !== 'object') return;
              const key = String(song.id || '') + '|' + String(song.name || '');
              if (seen.has(key)) return;
              seen.add(key);
              merged.push(song);
            });
          });
          return merged;
        });
    }));

    // 每个音源内部先按「像正规曲目」排序（有专辑信息 / 有封面），同分保持搜索原序 ——
    // 酷狗/汽水的 UGC 里大量「歌名就叫关键词」的填充曲，这些通常 album 为空，靠这一步沉到后面。
    const batches = rawBatches.map((batch) => batch
      .map((song, index) => ({
        song,
        index,
        q: (song && song.album ? 2 : 0) + (song && song.cover ? 1 : 0),
      }))
      .sort((a, b) => (b.q - a.q) || (a.index - b.index))
      .map((item) => item.song));

    // 按音源轮转交错：不交错的话前十几首会全是第一个音源
    const interleaved = [];
    const maxLen = batches.reduce((max, batch) => Math.max(max, batch.length), 0);
    for (let i = 0; i < maxLen; i += 1) {
      batches.forEach((batch) => { if (batch[i]) interleaved.push(batch[i]); });
    }

    // 去重两档：
    //   ① 跨音源同曲 —— 按「歌名（去括号/符号）」，不按 id（不同平台 id 不同、艺术家写法也不同）；
    //      这一档同时解决「五个不同艺人各唱一首 Lofi Study」把队列刷成同名的问题。
    //   ② 同一首但艺术家写法不同 —— 按「歌名+主唱」兜底。
    // 另外把「歌名就是关键词」的 UGC 回声曲单独归组，最后最多保 2 首、且排末尾。
    const seenTitle = new Set();
    const seenSong = new Set();
    const seenEchoFamily = new Set();
    const normalSongs = [];
    const echoSongs = [];
    interleaved.forEach((song) => {
      if (!song || !song.name || !song.id) return;
      if (isLowSignalSceneSong(song)) return;
      const titleKey = normalizeSceneText(song.name) || sceneSongKey(song);
      const songKey = sceneSongKey(song);
      if (!titleKey || seenTitle.has(titleKey) || (songKey && seenSong.has(songKey))) return;
      seenTitle.add(titleKey);
      if (songKey) seenSong.add(songKey);
      const echoFamily = sceneEchoFamily(song, picks);
      if (echoFamily) {
        if (seenEchoFamily.has(echoFamily)) return;
        seenEchoFamily.add(echoFamily);
        echoSongs.push(song);
        return;
      }
      normalSongs.push(song);
    });

    // 同一位歌手最多 2 首（只约束正片，回声曲本来就在末尾）
    const artistCounts = new Map();
    const primary = [];
    const deferred = [];
    normalSongs.forEach((song) => {
      const artist = weatherArtistKey(song);
      const count = artistCounts.get(artist) || 0;
      if (count < 2) {
        primary.push(song);
        artistCounts.set(artist, count + 1);
      } else {
        deferred.push(song);
      }
    });
    const diverse = primary.concat(deferred);

    // 前 6 首保留搜索相关度顺序，其余用同一 bucket 内的稳定洗牌打散 —— 既不打乱最相关的，又不永远同一序列
    const head = diverse.slice(0, 6);
    const tailPool = diverse.slice(6);
    // 正片够满（≥16）时回声只补 2 首压尾；正片不足（某些场景上游全是回声曲）才多放，否则列表会短得没法听
    const echoBudget = diverse.length >= SCENE_RADIO_MAX_SONGS - 2
      ? Math.min(2, echoSongs.length)
      : echoSongs.length;
    const tail = sceneShuffle(tailPool.concat(echoSongs.slice(0, echoBudget)), seed ^ 0x9e3779b9);
    const songs = head.concat(tail).slice(0, SCENE_RADIO_MAX_SONGS);

    // 音源保底：某个已登录音源一首都没进（典型情况＝它的搜索结果全是关键词回声，被压掉了），
    // 用它自己候选里质量最高的那首顶到末尾，保证「多音源」不是名义上的。
    const present = new Set(songs.map((song) => (song && (song.source || song.provider)) || 'netease'));
    providers.forEach((provider, index) => {
      if (present.has(provider)) return;
      const candidate = (batches[index] || []).find((song) => song && song.id && !songs.some((item) => item && item.id === song.id && (item.source || item.provider) === provider));
      if (!candidate) return;
      if (songs.length >= SCENE_RADIO_MAX_SONGS) {
        const dropAt = songs.length - 1;
        songs[dropAt] = candidate;
      } else {
        songs.push(candidate);
      }
      present.add(provider);
    });

    const value = {
      songs,
      sources: providers,
      keywords: picks,
    };

    // 只留当前 bucket 的缓存，避免 Map 无限长大
    if (sceneRadioCache.size > 24) {
      for (const key of sceneRadioCache.keys()) {
        if (!key.includes('|' + bucket + '|')) sceneRadioCache.delete(key);
      }
    }
    sceneRadioCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
  async function buildSceneRadio(sceneKey) {
    const raw = String(sceneKey || '').toLowerCase();
    const sceneId = raw in SCENE_PRESETS ? raw : 'focus';
    const preset = SCENE_PRESETS[sceneId];
    const mood = Object.assign({}, preset, { keywords: preset.keywords.slice() });
    const picked = await buildSceneRadioSongs(sceneId, preset);
    return {
      ok: true,
      weather: {
        provider: 'scene',
        label: mood.title,
        temperature: null,
        mood,
        updatedAt: Date.now(),
      },
      radio: {
        title: mood.title,
        subtitle: mood.tagline,
        seedQueries: picked.keywords,
        songs: picked.songs,
        sources: picked.sources,
        sceneId,
        sceneKey: mood.key || '',
        visualPreset: preset.visualPreset,
        coverGradient: preset.coverGradient.slice(),
        moodVisualLink: preset.moodVisualLink !== false,
        updatedAt: Date.now(),
      },
    };
  }

  return {
    sceneRadioBucket,
    sceneRotateSeed,
    sceneShuffle,
    sceneKeywordCandidates,
    sceneRadioProviders,
    searchSceneProvider,
    isLowSignalSceneSong,
    sceneSongKey,
    normalizeSceneText,
    sceneEchoFamily,
    buildSceneRadioSongs,
    buildSceneRadio,
    SCENE_PRESETS,
  };
};
