'use strict';

// 汽水音乐：搜索（公开搜索引擎 / PC 搜索 / SEO 单曲）。
//
// 第 3 刀从 qishui-api.js 抽出。依赖 account + mapping；不依赖 library（搜索不走曲库缓存）。


const {
  QISHUI_PUBLIC_CONTENTS_URL,
  QISHUI_PUBLIC_ENABLED,
  QISHUI_PUBLIC_HEADERS,
  QISHUI_PUBLIC_SEARCH_URL,
  QISHUI_RELATED_MEDIA_PATH,
  QISHUI_WEB_PC_API_BASE,
  QISHUI_WEB_UA,
} = require('./config');

const {
  normalizeQishuiCookieInput,
  normalizeText,
  qishuiCookieFingerprint,
  qishuiCookieHasLogin,
  qishuiPcAppParams,
  qishuiPost,
  qishuiPublicDetailCache,
  qishuiSearchCache,
  qishuiWebRequestJson,
  requestJson,
  urlWithParams,
} = require('./http');

const {
  cacheQishuiLyric,
  extractQishuiMediaList,
  extractQishuiPcSearchItems,
  mapQishuiMedia,
  mapQishuiMediaList,
  mapQishuiPublicItem,
  normalizeLyricBody,
  pickObject,
  rankQishuiPublicSongs,
} = require('./mapping');

const {
  getQishuiStatus,
} = require('./account');

async function handleQishuiPublicSearch(keywords, limit, cookieText, offset) {
  offset = Math.max(0, Number(offset) || 0);
  const requestLimit = Math.min(100, Math.max(offset + (Number(limit) * 3 || 0), 36));
  const url = urlWithParams(QISHUI_PUBLIC_SEARCH_URL, {
    keyword: keywords,
    search_type: 'music',
    limit: requestLimit,
    // The public catalogue endpoint currently repeats nearly the same first
    // page for non-zero real_offset. Fetch a bounded candidate window once and
    // paginate the locally ranked set so scroll loading never loops duplicates.
    real_offset: 0,
    search_source: 'qishui',
  });
  const json = await requestJson(url, { timeoutMs: 8000, headers: QISHUI_PUBLIC_HEADERS });
  const list = (json && json.data && Array.isArray(json.data.list)) ? json.data.list : [];
  const mappedSongs = list.map((item, index) => mapQishuiPublicItem(item, index, keywords)).filter(Boolean);
  const rankedSongs = rankQishuiPublicSongs(mappedSongs, keywords, requestLimit);
  const songs = rankedSongs.slice(offset, offset + limit);
  const status = getQishuiStatus(cookieText);
  return {
    provider: 'qishui',
    configured: status.configured,
    loggedIn: status.loggedIn,
    webSession: status.webSession,
    publicCatalog: true,
    songs,
    rawCount: list.length,
    offset,
    limit,
    nextOffset: offset + songs.length,
    hasMore: songs.length >= limit && (offset + songs.length < rankedSongs.length || requestLimit < 100),
    message: songs.length ? '' : '汽水公开搜索暂时没有返回匹配结果。',
  };
}

async function fetchQishuiPublicDetail(id) {
  id = normalizeText(id);
  if (!id) return null;
  return qishuiPublicDetailCache.wrap(id, 30 * 60 * 1000, async () => {
    const url = urlWithParams(QISHUI_PUBLIC_CONTENTS_URL, {
      sources: 'qishui',
      need_author: true,
      need_album: true,
      need_ugc: true,
      need_stat: true,
      item_ids: id,
    });
    const json = await requestJson(url, { timeoutMs: 8000, headers: QISHUI_PUBLIC_HEADERS });
    const item = json && json.data && Array.isArray(json.data.list) ? json.data.list[0] : null;
    if (!item) return null;
    const lyricInfo = pickObject(item.lyric_info, item.lyric);
    const lyric = normalizeLyricBody(
      lyricInfo.lyric_text ||
      lyricInfo.content ||
      lyricInfo.lyric ||
      (lyricInfo.lyric_entity && lyricInfo.lyric_entity.content) ||
      ''
    );
    const tlyric = normalizeLyricBody(lyricInfo.translated_lyric || lyricInfo.translation || lyricInfo.tlyric || '');
    cacheQishuiLyric(id, lyric, tlyric, 'qishui-public-detail');
    return { item, lyric, tlyric };
  });
}

async function handleQishuiPcSearch(keywords, limit, cookieText, offset) {
  const cookie = normalizeQishuiCookieInput(cookieText);
  if (!qishuiCookieHasLogin(cookie)) throw new Error('QISHUI_COOKIE_REQUIRED');
  const requestCount = Math.max(1, Math.min(50, Number(limit) || 8));
  offset = Math.max(0, Number(offset) || 0);
  const json = await qishuiWebRequestJson('/luna/pc/search/track', qishuiPcAppParams({
    q: keywords,
    cursor: String(offset),
    count: requestCount,
    search_method: 'input',
  }), cookie, {
    bases: [QISHUI_WEB_PC_API_BASE],
    noDefaultParams: true,
    sessionOnly: true,
    pcApp: true,
    timeoutMs: 8500,
  });
  const rawItems = extractQishuiPcSearchItems(json);
  const songs = mapQishuiMediaList(rawItems, keywords, { directPlayable: true }).slice(0, limit);
  const data = (json && json.data) || json || {};
  const resultData = pickObject(data.search_result, data.searchResult, data);
  const nextCursor = normalizeText(
    resultData.next_cursor ||
    resultData.nextCursor ||
    data.next_cursor ||
    data.nextCursor ||
    ''
  );
  const hasMoreFlag = resultData.has_more;
  const hasMore = typeof hasMoreFlag === 'boolean'
    ? hasMoreFlag
    : (Number(hasMoreFlag) > 0 || !!nextCursor || songs.length >= limit);
  return {
    provider: 'qishui',
    configured: true,
    loggedIn: true,
    webSession: true,
    source: 'qishui-pc-search',
    songs,
    rawCount: rawItems.length,
    offset,
    limit,
    nextOffset: offset + songs.length,
    nextCursor,
    hasMore,
  };
}

async function handleQishuiSearch(keywords, limit, cookieText, offset) {
  keywords = normalizeText(keywords);
  limit = Math.max(1, Math.min(18, Number(limit) || 8));
  offset = Math.max(0, Number(offset) || 0);
  const status = getQishuiStatus(cookieText);
  if (!keywords) return { provider: 'qishui', songs: [], configured: status.configured, message: status.message };
  if (!status.webSession && !status.tokenConfigured && !QISHUI_PUBLIC_ENABLED) {
    return {
      provider: 'qishui',
      configured: false,
      songs: [],
      error: 'QISHUI_TOKEN_REQUIRED',
      reason: 'missing_access_token',
      message: status.message,
    };
  }
  const cacheKey = keywords.toLowerCase() + '|' + limit + '|' + offset + '|' + (status.webSession ? qishuiCookieFingerprint(cookieText) : (status.tokenConfigured ? 'token' : 'public'));
  return qishuiSearchCache.wrap(cacheKey, 2 * 60 * 1000, async () => {
    let pcSearchError = '';
    if (status.webSession) {
      try {
        return await handleQishuiPcSearch(keywords, limit, cookieText, offset);
      } catch (err) {
        pcSearchError = err && err.message || String(err);
      }
    }
    if (!status.tokenConfigured || offset > 0) {
      if (!QISHUI_PUBLIC_ENABLED) {
        const err = new Error(pcSearchError || 'QISHUI_SEARCH_UNAVAILABLE');
        err.code = 'QISHUI_SEARCH_UNAVAILABLE';
        throw err;
      }
      const fallback = await handleQishuiPublicSearch(keywords, limit, cookieText, offset);
      if (pcSearchError) fallback.pcSearchError = pcSearchError;
      return fallback;
    }
    const payload = {
      search_query: keywords,
      played_media: [],
      count: limit,
      common_params: {
        trigger_name: 'mineradio_search',
        scene: 'search',
        source: 'mineradio',
      },
    };
    try {
      const json = await qishuiPost(QISHUI_RELATED_MEDIA_PATH, payload);
      const rawItems = extractQishuiMediaList(json);
      const songs = rawItems.map((item, index) => mapQishuiMedia(item, index, keywords)).filter(Boolean).slice(0, limit);
      return {
        provider: 'qishui',
        configured: true,
        songs,
        rawCount: rawItems.length,
        offset,
        limit,
        nextOffset: songs.length,
        hasMore: rawItems.length >= limit,
        pcSearchError,
      };
    } catch (err) {
      if (!QISHUI_PUBLIC_ENABLED) throw err;
      const fallback = await handleQishuiPublicSearch(keywords, limit, cookieText, offset);
      fallback.officialError = err && err.message || String(err);
      if (pcSearchError) fallback.pcSearchError = pcSearchError;
      return fallback;
    }
  });
}

async function fetchQishuiSeoTrack(trackId) {
  return requestJson(urlWithParams('https://beta-luna.douyin.com/luna/h5/seo_track', {
    track_id: trackId,
    device_platform: 'web',
  }), {
    timeoutMs: 8000,
    headers: {
      'Accept': 'application/json,text/plain,*/*',
      'User-Agent': QISHUI_WEB_UA,
      'Referer': 'https://www.douyin.com/',
    },
  });
}

module.exports = {
  handleQishuiPublicSearch,
  fetchQishuiPublicDetail,
  handleQishuiPcSearch,
  handleQishuiSearch,
  fetchQishuiSeoTrack,
};
