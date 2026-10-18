'use strict';

// 酷狗：账号与会员。
//
// 第 2 刀从 kugou-api.js 抽出。登录态、会员判定（web roleinfo 为主、vip 接口兜底）、
// 资料与用户歌单列表。零出边（除 config / http / mapping 三个底座）。

const {
  KUGOU_H5_UA,
  KUGOU_VIP_ROLEINFO_URL,
} = require('./config');

const {
  buildKugouRequestCookie,
  extractKugouAuth,
  kugouCloudlistRequest,
  kugouGatewayRequest,
  kugouProfileCache,
  kugouVipCache,
  requestJson,
} = require('./http');

const {
  extractKugouGatewayPlaylistLists,
  kugouCoverUrl,
  kugouProfileCacheKey,
  kugouUnknownWebMembershipPayload,
  mapKugouPlaylistItem,
  normalizeKugouVipPayloadV2,
  normalizeKugouWebRoleInfoPayload,
  stripKugouHtml,
} = require('./mapping');

// 网页端 roleinfo：unionVip 主探测漏判时的 fail-open 补充源。
// 之前这里只被引用、从未声明（fetchKugouWebVipInfo 一进去就 ReferenceError，
// 而调用点是 `await fetchKugouWebVipInfo(...).catch(() => kugouUnknownWebMembershipPayload())`
// —— catch 把错吞了，于是这个补充源从来没生效过，会员判定永远停在「未知」）。
// 端点见本文件 213 行注释与 tests/provider-entitlement-boundary.test.js:71 的 pathname 断言。
// 联调日志门控：设置 MINERADIO_DEBUG=1 才输出搜索/取链/FM 的详细日志




// requestText 由公共封装 server/lib/http-request 提供（含超时 + 指数退避重试 + 显式 Content-Length）。
// qishui/spotify 后续可同样迁移到公共封装，消除各平台 HTTP 样板。















// 网页端 roleinfo（vip.kugou.com/recharge/roleinfo）会员识别：role 数字映射。
// unionVip 接口漏判时，web role 常能补出会员身份（role 1/2=VIP, 6/11/13=SVIP, 31/33=音乐包）。




// 取对象中首个出现的数值字段状态（用于 web role 数字判定），无依赖。



// ---- 网页端 roleinfo 会员探测（unionVip 漏判时的 fail-open 补充源）----


async function fetchKugouWebVipInfo(cookie, auth) {
  auth = auth || extractKugouAuth(cookie);
  if (!auth.loggedIn || !cookie) return kugouUnknownWebMembershipPayload();
  const url = new URL(KUGOU_VIP_ROLEINFO_URL);
  url.searchParams.set('n', String(Date.now()));
  let timer = null;
  try {
    const payload = await Promise.race([
      requestJson(url.toString(), {
        timeoutMs: 2500,
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: 'https://vip.kugou.com/',
          'User-Agent': KUGOU_H5_UA,
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: buildKugouRequestCookie(cookie),
        },
      }).catch(() => null),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(null), 2500);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    return normalizeKugouWebRoleInfoPayload(payload, auth);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchKugouVipInfo(cookie, auth) {
  auth = auth || extractKugouAuth(cookie);
  if (!auth.playbackReady) return null;
  const cacheKey = 'vip|' + String(auth.userid || '0') + '|' + String(auth.token || '').slice(-10);
  return kugouVipCache.wrap(cacheKey, (value) => {
    const parsed = normalizeKugouVipPayloadV2(value, { userid: auth.userid });
    return parsed.isVip ? 5 * 60 * 1000 : 60 * 1000;
  }, async () => {
    const uid = Number(String(auth.userid || '').replace(/\D/g, '')) || 0;
    // 联合会员查询只有一条正确姿势：POST + body 里的 useridlist **数组**，且必须带 get_type。
    // 用 GET + userids= 会被酷狗依次以 "useridlist is null" / "get_type is null" 拒掉（20010），
    // 探针全灭 → membershipKnown=false → vipLevel='none' → 前端把会员打成「普通」。
    // 实测可用：POST /kugouvip/v2/batch_union_vipinfo
    //   body {"useridlist":[<uid>],"get_type":1,"busi_type":"concept"}
    //   → {"data":{"main_vip":{"<uid>":{"is_vip":1,"vip_type":1,"vip_end_time":…,"su_vip_end_time":…}}}}
    // get_type=1 取主会员（main_vip）、get_type=2 取概念版业务会员（busi_vip），两者互补。
    const unionVipProbe = (path, getType) => kugouGatewayRequest(path, {
      method: 'POST',
      cookie,
      params: { busi_type: 'concept' },
      body: { useridlist: [uid], get_type: getType, busi_type: 'concept' },
      headers: { Referer: 'https://vip.kugou.com/' },
    });
    const attempts = [
      () => unionVipProbe('/kugouvip/v2/batch_union_vipinfo', 1),
      () => unionVipProbe('/kugouvip/v2/batch_union_vipinfo', 2),
      () => unionVipProbe('/kugouvip/v1/batch_union_vipinfo', 1),
      // 旧接口保底：近年多已 502 / params invalid，只在上面的联合会员接口全挂时兜一下
      () => kugouGatewayRequest('/v1/get_union_vip', {
        method: 'GET',
        cookie,
        params: { busi_type: 'concept' },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
      () => kugouGatewayRequest('/v1/get_union_vip', {
        method: 'GET',
        cookie,
        baseURL: 'https://kugouvip.kugou.com',
        params: { busi_type: 'concept' },
        headers: { Referer: 'https://vip.kugou.com/' },
      }),
    ];
    const primary = await Promise.race([
      Promise.resolve().then(attempts[0]).catch(() => null),
      new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 1500);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    const primaryMembership = normalizeKugouVipPayloadV2(primary, { userid: auth.userid });
    if (primaryMembership.membershipKnown) return primary;

    // unionVip 主探测未确认会员（接口失败/未知）时，补充网页端 roleinfo 探测。
    // web role 常能识别 unionVip 漏判的会员身份，作为 fail-open 兜底而非覆盖。
    const webRoleInfo = await fetchKugouWebVipInfo(cookie, auth).catch(() => kugouUnknownWebMembershipPayload());
    const webMembership = normalizeKugouVipPayloadV2(webRoleInfo, { userid: auth.userid });
    if (webMembership.membershipKnown && webMembership.isVip) return webRoleInfo;

    return new Promise(resolve => {
      let settled = false;
      const fallbackAttempts = attempts.slice(1);
      let pending = fallbackAttempts.length;
      let knownNonMember = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value || { __kugouMembershipUnknown: true });
      };
      const timer = setTimeout(() => finish(knownNonMember), 5000);
      if (typeof timer.unref === 'function') timer.unref();
      fallbackAttempts.forEach(run => {
        Promise.resolve().then(run).then(data => {
          const parsed = normalizeKugouVipPayloadV2(data, { userid: auth.userid });
          if (parsed.membershipKnown) {
            if (parsed.isVip) {
              finish(data);
              return;
            }
            if (!knownNonMember) knownNonMember = data;
          }
          pending -= 1;
          if (pending <= 0) finish(knownNonMember);
        }).catch(() => {
          pending -= 1;
          if (pending <= 0) finish(knownNonMember);
        });
      });
    });
  });
}

async function getKugouLoginInfo(cookie) {
  const auth = extractKugouAuth(cookie);
  const profile = (!auth.nickname || !auth.avatar)
    ? await fetchKugouProfileFromPlaylists(cookie, auth).catch(() => ({}))
    : {};
  const vipProbe = await fetchKugouVipInfo(cookie, auth).catch(() => null);
  const vip = normalizeKugouVipPayloadV2(vipProbe, auth);
  const nickname = auth.nickname || profile.nickname || (auth.loggedIn ? ('酷狗 ' + (auth.userid || '用户')) : '酷狗音乐');
  return {
    provider: 'kugou',
    loggedIn: auth.loggedIn,
    playbackReady: auth.playbackReady,
    userId: auth.userid,
    nickname,
    avatar: auth.avatar || profile.avatar || '',
    vipType: vip.vipType,
    svipType: vip.svipType,
    vipLevel: vip.vipLevel,
    isVip: vip.isVip,
    isSvip: vip.isSvip,
    vipLabel: vip.vipLevel === 'svip' ? 'SVIP' : (vip.vipLevel === 'vip' ? 'VIP' : '无VIP'),
    membershipVerified: !!vip.membershipVerified,
    membershipSource: vip.membershipSource || 'none',
    hasCookie: !!cookie,
    hasToken: !!auth.token,
  };
}

function pickKugouProfileFromLists(lists, auth) {
  auth = auth || {};
  lists = Array.isArray(lists) ? lists : [];
  let selected = null;
  for (const item of lists) {
    if (!item || typeof item !== 'object') continue;
    const itemUserId = String(item.list_create_userid || item.userid || item.user_id || item.owner_id || '').replace(/\D/g, '');
    if (auth.userid && itemUserId && itemUserId === auth.userid) {
      selected = item;
      break;
    }
    if (!selected) selected = item;
  }
  if (!selected) return {};
  const nickname = stripKugouHtml(
    selected.nickname ||
    selected.username ||
    selected.user_name ||
    selected.list_create_username ||
    selected.owner_name ||
    ''
  );
  const avatar = kugouCoverUrl(
    selected.create_user_pic ||
    selected.user_pic ||
    selected.avatar ||
    selected.pic ||
    selected.img ||
    selected.imgurl ||
    '',
    120
  );
  return { nickname, avatar };
}

async function fetchKugouProfileFromPlaylists(cookie, auth) {
  auth = auth || extractKugouAuth(cookie);
  if (!auth.playbackReady) return {};
  const cacheKey = kugouProfileCacheKey(auth);
  return kugouProfileCache.wrap(cacheKey, 5 * 60 * 1000, async () => {
    const json = await kugouCloudlistRequest('/v7/get_all_list', {
      cookie,
      params: { total_ver: 979, type: 2, page: 1, pagesize: 20, userid: auth.userid, token: auth.token },
      body: {
        userid: Number(auth.userid),
        token: auth.token,
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 20,
      },
    });
    const data = (json && json.data) || {};
    return pickKugouProfileFromLists(extractKugouGatewayPlaylistLists(data), auth);
  });
}

async function handleKugouUserPlaylists(cookie) {
  const auth = extractKugouAuth(cookie);
  if (!auth.playbackReady) {
    return { provider: 'kugou', loggedIn: auth.loggedIn, playbackReady: false, playlists: [], error: 'KUGOU_AUTH_REQUIRED', message: '酷狗登录未完成，请重新网页登录' };
  }
  try {
    const json = await kugouCloudlistRequest('/v7/get_all_list', {
      cookie,
      params: { total_ver: 979, type: 2, page: 1, pagesize: 50, userid: auth.userid, token: auth.token },
      body: {
        userid: Number(auth.userid),
        token: auth.token,
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 50,
      },
    });
    const data = (json && json.data) || {};
    const lists = extractKugouGatewayPlaylistLists(data);
    const profile = pickKugouProfileFromLists(lists, auth);
    if (profile.nickname || profile.avatar) kugouProfileCache.set(kugouProfileCacheKey(auth), profile, 5 * 60 * 1000);
    const playlists = lists.map(mapKugouPlaylistItem).filter(pl => pl.id && pl.name);
    return {
      provider: 'kugou',
      loggedIn: true,
      playbackReady: true,
      userId: auth.userid,
      nickname: auth.nickname || profile.nickname || '',
      avatar: auth.avatar || profile.avatar || '',
      playlists,
    };
  } catch (err) {
    return {
      provider: 'kugou',
      loggedIn: true,
      playbackReady: true,
      playlists: [],
      error: err.message || 'KUGOU_PLAYLIST_FAILED',
      message: '酷狗歌单加载失败，请稍后重试',
    };
  }
}

module.exports = {
  fetchKugouWebVipInfo,
  fetchKugouVipInfo,
  getKugouLoginInfo,
  pickKugouProfileFromLists,
  fetchKugouProfileFromPlaylists,
  handleKugouUserPlaylists,
};
