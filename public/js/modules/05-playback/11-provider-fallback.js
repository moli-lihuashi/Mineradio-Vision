var firstPlayDone = false;

// 酷狗版兼容桩：作者 11-provider-fallback 依赖这些符号
function normalizePlaybackProvider(provider) {
  if (typeof normalizeMusicProviderKey === 'function') return normalizeMusicProviderKey(provider);
  if (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') return provider;
  return 'netease';
}
function accountProviderOrder() {
  return ['netease', 'qq', 'kugou', 'qishui', 'spotify'];
}
function songRequiresVip(song) {
  if (!song) return false;
  if (song.fee === 1 || song.fee === 4 || song.fee === 8) return true;
  if (song.vip || song.onlyVipPlayable || song.needVip) return true;
  return false;
}
async function resolveAlbumGaplessPlaybackData(song) {
  if (typeof resolveProviderPlayUrlData === 'function') {
    return resolveProviderPlayUrlData(song, {});
  }
  if (!song || song.id == null) return null;
  return apiJson('/api/song/url?id=' + encodeURIComponent(song.id));
}

function playbackProviderLabel(song) {
  var provider = songProviderKey(song);
  if (provider === 'qq') return 'QQ 音乐';
  if (provider === 'kugou') return '酷狗音乐';
  if (provider === 'qishui') return '汽水音乐';
  if (provider === 'spotify') return 'Spotify';
  return '网易云';
}
function playbackLoginProvider(song) {
  return normalizePlaybackProvider(songProviderKey(song));
}
function playbackRestrictionRawCategory(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  return data.reason || data.category || data.errorCategory || restriction.category || restriction.reason || '';
}
function playbackRestrictionLooksVipLocked(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  if (typeof songRequiresVip === 'function' && songRequiresVip(Object.assign({}, song || {}, data || {}))) return true;
  if (data.trial || data.needVip || data.need_vip || data.vipRequired || data.onlyVipPlayable || data.only_vip_playable) return true;
  var text = [
    data.error,
    data.message,
    data.reason,
    data.category,
    restriction.category,
    restriction.reason,
    restriction.message,
    data.rawMessage,
    restriction.rawMessage
  ].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
  return /vip_required|paid_required|trial_only|need_vip|only_vip|member|vip|会员|付费|购买|数字专辑|专辑/.test(text);
}
function playbackRestrictionMissingPlaybackKey(data) {
  data = data || {};
  var restriction = data.restriction || {};
  return !!(data.missingPlaybackKey || restriction.missingPlaybackKey);
}
function playbackRestrictionCategory(song, data) {
  var category = playbackRestrictionRawCategory(song, data);
  var provider = playbackLoginProvider(song);
  var status = platformStatus(provider) || {};
  var mergedStatus = Object.assign({}, status, data || {}, data && data.restriction || {});
  var loggedIn = !!(status.loggedIn || data && data.loggedIn);
  var vipLevel = typeof providerVipLevel === 'function' ? providerVipLevel(provider, mergedStatus) : 'none';
  var membershipUnknown = !!(
    provider === 'qq'
    && loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  );
  var vipLocked = playbackRestrictionLooksVipLocked(song, data);
  if (vipLocked && !playbackRestrictionMissingPlaybackKey(data)) {
    if (category === 'login_required' && loggedIn && vipLevel === 'none' && !membershipUnknown) return 'vip_required';
    if (!category || category === 'url_unavailable' || category === 'copyright_unavailable') {
      if (loggedIn && vipLevel === 'none' && !membershipUnknown) return 'vip_required';
    }
  }
  if (!category && data && data.error && /401|403|login_required|auth|cookie|credential|unauthorized|forbidden/i.test(String(data.error))) return loggedIn && vipLocked ? 'vip_required' : 'login_required';
  if (!category && data && data.error && /vip|member|paid|trial|会员|付费|购买/i.test(String(data.error))) return loggedIn ? 'vip_required' : 'login_required';
  return category || 'url_unavailable';
}
function playbackProviderMembershipText(provider, data) {
  var status = platformStatus(provider) || {};
  var mergedStatus = Object.assign({}, status, data || {}, data && data.restriction || {});
  var level = typeof providerVipLevel === 'function' ? providerVipLevel(provider, mergedStatus) : 'none';
  if (level === 'svip') return 'SVIP';
  if (level === 'vip') return provider === 'spotify' ? 'Premium' : 'VIP';
  if (
    provider === 'qq'
    && status.loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  ) return '会员待同步';
  return '普通账号';
}
function playbackRestrictionNotice(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  var category = playbackRestrictionCategory(song, data);
  var provider = playbackProviderLabel(song);
  var providerKey = playbackLoginProvider(song);
  var status = platformStatus(providerKey) || {};
  var loggedIn = !!(status.loggedIn || data.loggedIn);
  var membershipPending = !!(
    providerKey === 'qq'
    && loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  );
  var membership = playbackProviderMembershipText(providerKey, data);
  var message = data.message || restriction.message || '';
  if (category === 'vip_required' || category === 'paid_required' || category === 'trial_only') {
    var needText = category === 'paid_required' ? '购买、数字专辑或更高权限' : (category === 'trial_only' ? '完整播放权限' : '会员权限');
    var title = membershipPending ? 'QQ 会员状态待同步' : (loggedIn ? '当前平台没有会员状态' : '当前平台未登录会员');
    var body = message || (provider + ' 已识别为会员/付费曲目，当前状态是 ' + membership + '，缺少' + needText + '。');
    if (loggedIn && body.indexOf('当前状态') < 0) body += ' 当前状态是 ' + membership + '。';
    return { category: category, title: title, body: body + ' 可以登录会员账号、降低音质或切换到其它音源。', action: 'upgrade', toast: title };
  }
  if (category === 'login_required') {
    if (loggedIn && playbackRestrictionMissingPlaybackKey(data)) {
      return {
        category: category,
        title: '平台播放授权未完成',
        body: message || (provider + ' 已登录，但还缺少播放授权，请重新打开官方登录窗口完成授权。'),
        action: 'login',
        toast: '播放授权未完成'
      };
    }
    return {
      category: category,
      title: '当前平台未登录',
      body: (message || (provider + ' 需要登录后才能获取播放地址。')) + ' 正在打开对应登录入口。',
      action: 'login',
      toast: '当前平台未登录'
    };
  }
  if (category === 'provider_limited') {
    return {
      category: category,
      title: '平台仅作为匹配源',
      body: message || (provider + ' 当前只提供搜索/匹配信息，播放会自动寻找其它可播版本。'),
      action: 'switch_source',
      toast: '正在自动换源'
    };
  }
  if (category === 'copyright_unavailable') {
    return {
      category: category,
      title: '当前平台版权不可播',
      body: (message || (provider + ' 当前版权暂不可播。')) + ' 可以换一个平台版本。',
      action: 'switch_source',
      toast: '版权不可播'
    };
  }
  return {
    category: category,
    title: '当前平台没有可用音源',
    body: (message || (provider + ' 没有返回可播放地址。')) + ' 可能是版权、地区、会员或网络限制，可以换源或稍后重试。',
    action: 'switch_source',
    toast: '当前平台没有可用音源'
  };
}
function playbackRestrictionMessage(song, data) {
  var notice = playbackRestrictionNotice(song, data);
  return notice.body || notice.title;
  data = data || {};
  var restriction = data.restriction || {};
  var category = data.reason || restriction.category || '';
  var provider = playbackProviderLabel(song);
  var message = data.message || restriction.message || '';
  if (!message) {
    if (category === 'login_required') message = provider + '需要登录后再尝试播放';
    else if (category === 'vip_required') message = provider + '歌曲需要会员权限';
    else if (category === 'paid_required') message = provider + '歌曲需要购买或更高权限';
    else if (category === 'trial_only') message = provider + '仅返回试听片段';
    else if (category === 'copyright_unavailable') message = provider + '版权暂不可播';
    else if (category === 'provider_limited') message = provider + '当前只作为匹配源，正在寻找其它可播版本';
    else message = provider + '没有返回可播放地址';
  }
  if (category === 'login_required') return message + ' · 正在打开登录';
  if (category === 'provider_limited') return message + ' · 可以自动换源';
  if (category === 'copyright_unavailable' || category === 'url_unavailable') return message + ' · 可以试试另一个平台版本';
  return message;
}
function qqPlaybackRetryQualities(requestedQuality, resolvedLevel) {
  requestedQuality = normalizePlaybackQualityForProvider(requestedQuality || getProviderPlaybackQuality('qq'), 'qq');
  resolvedLevel = String(resolvedLevel || '').toLowerCase();
  var pool = [];
  if (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless' || resolvedLevel === 'hires' || resolvedLevel === 'lossless') {
    pool = ['exhigh', 'standard'];
  } else if (requestedQuality === 'exhigh' || resolvedLevel === 'exhigh') {
    pool = ['standard'];
  }
  return pool.filter(function (q) { return q !== requestedQuality; });
}
async function retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality) {
  opts = opts || {};
  if (playbackRestrictionCategory(song, data) === 'login_required' || playbackRestrictionMissingPlaybackKey(data)) return false;
  var tried = Array.isArray(opts.qqQualityTried) ? opts.qqQualityTried.slice() : [];
  [requestedQuality, data && data.level].forEach(function (q) {
    q = normalizePlaybackQuality(q || '');
    if (q && tried.indexOf(q) < 0) tried.push(q);
  });
  var candidates = qqPlaybackRetryQualities(requestedQuality, data && data.level).filter(function (q) { return tried.indexOf(q) < 0; });
  if (!candidates.length || token !== trackSwitchToken) return false;
  var nextQuality = candidates[0];
  var resolvedQuality = normalizePlaybackQuality(data && data.level);
  markPlaybackQualityRuntimeCap(song, 'qq', nextQuality, 'qq-url-unavailable');
  if (!opts.startupAutoplay) showSourceFallbackNotice('QQ 音质自动兼容', '当前音质启动失败，正在切到 ' + playbackQualityLabel(nextQuality, 'qq') + '。');
  var retryResumeAt = opts.resumeAt;
  if (retryResumeAt == null && opts.startupAutoplay && pendingPlaybackResumeAt > 0) retryResumeAt = pendingPlaybackResumeAt;
  // 重试同样是一次「异步之后再动播放器」：取址期间用户可能删掉前面的队列项
  // （目标整体前移）或随机重排，捕获的 idx 会指向别的歌 —— 按队列项身份重新定位，
  // 目标已不在队列里就直接中止，绝不用旧索引起播别人的歌。
  var retryIdx = typeof queueIndexForItem === 'function' ? queueIndexForItem(song) : (playQueue.indexOf(song));
  if (retryIdx < 0) return false;
  if (token !== trackSwitchToken) return false;
  var retryStarted = await playQueueAt(retryIdx, Object.assign({}, opts, {
    qualityOverride: nextQuality,
    qqQualityTried: tried,
    resumeAt: retryResumeAt,
  }));
  return retryStarted === true;
}
var sourceFallbackNoticeTimer = null;
function closeSourceFallbackNotice() {
  var notice = document.getElementById('source-fallback-notice');
  if (sourceFallbackNoticeTimer) { clearTimeout(sourceFallbackNoticeTimer); sourceFallbackNoticeTimer = null; }
  if (notice) notice.classList.remove('show');
  var stack = document.getElementById('source-fallback-stack');
  if (stack) Array.prototype.slice.call(stack.children || []).forEach(removeSourceFallbackCard);
}
function ensureSourceFallbackStack() {
  var stack = document.getElementById('source-fallback-stack');
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'source-fallback-stack';
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}
function removeSourceFallbackCard(card) {
  if (!card) return;
  card.classList.add('leaving');
  setTimeout(function () {
    if (card.parentNode) card.parentNode.removeChild(card);
  }, 260);
}
function showSourceFallbackNotice(title, body) {
  var stack = ensureSourceFallbackStack();
  if (stack) {
    var card = document.createElement('div');
    card.className = 'source-fallback-card';
    var head = document.createElement('div');
    head.className = 'source-fallback-head';
    var titleElNew = document.createElement('div');
    titleElNew.className = 'source-fallback-title';
    titleElNew.textContent = title || '自动换源';
    var close = document.createElement('button');
    close.className = 'source-fallback-close';
    close.type = 'button';
    close.textContent = '×';
    close.onclick = function () { removeSourceFallbackCard(card); };
    var bodyElNew = document.createElement('div');
    bodyElNew.className = 'source-fallback-body';
    bodyElNew.textContent = body || '';
    head.appendChild(titleElNew);
    head.appendChild(close);
    card.appendChild(head);
    card.appendChild(bodyElNew);
    stack.insertBefore(card, stack.firstChild || null);
    while (stack.children.length > 4) removeSourceFallbackCard(stack.lastElementChild);
    requestAnimationFrame(function () { card.classList.add('show'); });
    setTimeout(function () { removeSourceFallbackCard(card); }, 5600);
    return;
  }
  var notice = document.getElementById('source-fallback-notice');
  var titleEl = document.getElementById('source-fallback-title');
  var bodyEl = document.getElementById('source-fallback-body');
  if (!notice || !titleEl || !bodyEl) return;
  titleEl.textContent = title || '自动换源';
  bodyEl.textContent = body || '';
  notice.classList.add('show');
  if (sourceFallbackNoticeTimer) clearTimeout(sourceFallbackNoticeTimer);
  sourceFallbackNoticeTimer = setTimeout(closeSourceFallbackNotice, 5000);
}
function normalizeMatchText(text) {
  return String(text || '').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '');
}
function artistNameParts(song) {
  var parts = [];
  if (song && Array.isArray(song.artists)) {
    song.artists.forEach(function (a) { if (a && a.name) parts.push(a.name); });
  }
  if (song && song.artist) {
    String(song.artist).split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i).forEach(function (name) {
      if (name && name.trim()) parts.push(name.trim());
    });
  }
  return parts.map(normalizeMatchText).filter(Boolean);
}
function isSameTitleArtist(source, candidate) {
  if (!source || !candidate) return false;
  if (normalizeMatchText(source.name || source.title) !== normalizeMatchText(candidate.name || candidate.title)) return false;
  var a = artistNameParts(source);
  var b = artistNameParts(candidate);
  if (!a.length || !b.length) return false;
  return a.some(function (name) { return b.indexOf(name) >= 0; });
}
// 括号里的「版本标识」：氛围版 / Live / 伴奏 / DJ版 / 钢琴版 等。
// normalizeMatchText 会把整个括号删掉，导致「歌（氛围版）」与「歌」归一后同名 ——
// 换源时会把原版当成同名同歌手版本播出去（用户侧＝点 A 播 B）。
// 这里只做大小写与标点归一，保留括号内容用于比较。
function matchTitleDecoration(text) {
  var parts = [];
  var pattern = /[（(【\[]([^）)】\]]*)[）)】\]]/g;
  var raw = String(text || '');
  var matched;
  while ((matched = pattern.exec(raw))) {
    var token = String(matched[1] || '')
      .toLowerCase()
      .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '');
    if (token) parts.push(token);
  }
  return parts.sort().join('|');
}
// 换源专用的严格同名判定：在宽松同名之上，要求版本标识完全一致。
// 不给 isSameTitleArtist 本身加严 —— 它还被歌词匹配与搜索打分共用，
// 收紧会让「氛围版」找不到歌词。
function isSameTitleArtistStrict(source, candidate) {
  if (!isSameTitleArtist(source, candidate)) return false;
  return matchTitleDecoration(source.name || source.title) === matchTitleDecoration(candidate.name || candidate.title);
}
var SOURCE_FALLBACK_SEARCH_TIMEOUT_MS = 6500;
var SOURCE_FALLBACK_DIRECT_PROVIDERS = ['netease', 'qq', 'kugou'];
var SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS = 20000;
var SOURCE_FALLBACK_MAX_QUEUE_ADVANCES = 2;
var SOURCE_FALLBACK_MAX_PROVIDER_ATTEMPTS = 4;
var sourceFallbackRecoverySerial = 0;
var activeSourceFallbackRecovery = null;
var sourceFallbackBudgetTimeoutResult = {};

function sourceFallbackRecoveryContentKey(song) {
  if (!song) return '';
  var rawTitle = song.name || song.title || '';
  var title = normalizeMatchText(rawTitle);
  // 版本标识必须进 key：否则「歌（氛围版）」和「歌」会被当成同一项去重，
  // 换源时会把其中一首直接跳过。
  var decoration = matchTitleDecoration(rawTitle);
  var artists = artistNameParts(song).sort().join(',');
  if (title && artists) return title + (decoration ? '{' + decoration + '}' : '') + '|' + artists;
  return sourceFallbackSongKey(song);
}
function sourceFallbackRecoveryFromOptions(opts) {
  if (!opts) return null;
  return opts.sourceFallbackRecovery
    || (opts.playbackOpts && opts.playbackOpts.sourceFallbackRecovery)
    || null;
}
function sourceFallbackRecoveryIdentityActive(recovery) {
  return !!(
    recovery
    && activeSourceFallbackRecovery === recovery
    && !recovery.terminal
    && !recovery.cancelled
    && !recovery.completed
  );
}
function sourceFallbackRecoveryRemainingMs(recovery) {
  if (!sourceFallbackRecoveryIdentityActive(recovery)) return 0;
  return Math.max(0, Number(recovery.deadlineAt) - Date.now());
}
function sourceFallbackRecoveryCanContinue(recovery) {
  return sourceFallbackRecoveryRemainingMs(recovery) > 0;
}
function cancelSourceFallbackRecovery(reason) {
  var recovery = activeSourceFallbackRecovery;
  if (!recovery || recovery.terminal || recovery.completed) return false;
  recovery.cancelled = true;
  recovery.cancelReason = String(reason || 'superseded');
  activeSourceFallbackRecovery = null;
  return true;
}
function completeSourceFallbackRecovery(recovery) {
  if (!recovery || recovery.terminal || recovery.cancelled) return false;
  recovery.completed = true;
  if (activeSourceFallbackRecovery === recovery) activeSourceFallbackRecovery = null;
  return true;
}
function beginSourceFallbackPlaybackInvocation(opts) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!recovery) {
    cancelSourceFallbackRecovery('new-root-playback');
    return true;
  }
  return sourceFallbackRecoveryCanContinue(recovery);
}
function ensureSourceFallbackRecovery(opts, song, idx, token) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (recovery) return sourceFallbackRecoveryIdentityActive(recovery) ? recovery : null;
  var songKey = sourceFallbackRecoveryContentKey(song);
  /* 反复点同一首歌：复用仍在进行中的那次换源，不要 cancel 后重开一轮。
   * 每轮换源都要重跑封面解码 / canvas / 三张 three.js 纹理 / 歌词准备 / 队列与歌单架重建，
   * 连点几次就把渲染进程原生内存打穿 —— render-process-gone 之后自动重载，用户侧就是「卡死重启」。
   * 复用时 skipDepth / queueAdvances 继续累计，到上限后正常终局，不会无限重建。 */
  if (songKey && activeSourceFallbackRecovery
      && sourceFallbackRecoveryIdentityActive(activeSourceFallbackRecovery)
      && activeSourceFallbackRecovery.activeSongKey === songKey) {
    return activeSourceFallbackRecovery;
  }
  cancelSourceFallbackRecovery('new-recovery');
  recovery = {
    id: 'source-fallback-' + Date.now() + '-' + (++sourceFallbackRecoverySerial),
    activeSongKey: songKey,
    startedAt: Date.now(),
    deadlineAt: Date.now() + SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS,
    rootIndex: idx,
    rootToken: token,
    queueAdvances: 0,
    skipDepth: 0,
    providerAttempts: 0,
    silent: !!(opts && opts.startupAutoplay),
    visitedSongKeys: Object.create(null),
    attemptedProviderKeys: Object.create(null),
    terminal: false,
    cancelled: false,
    completed: false
  };
  if (songKey) recovery.visitedSongKeys[songKey] = true;
  activeSourceFallbackRecovery = recovery;
  return recovery;
}
function sourceFallbackQueuePlaybackOptions(opts, recovery) {
  var next = Object.assign({}, opts || {});
  delete next.fallbackOriginalSong;
  delete next.fallbackCandidateSong;
  delete next.preResolvedPlaybackData;
  delete next.preloadedAudio;
  delete next.preloadedData;
  delete next.preloadedProxyAudioUrl;
  next.fallbackDepth = 0;
  next.sourceFallbackRecovery = recovery;
  return next;
}
function sourceFallbackRecoveryFailureOptions(opts) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!recovery) return null;
  return {
    silent: !!recovery.silent,
    playbackOpts: sourceFallbackQueuePlaybackOptions(opts, recovery),
    sourceFallbackRecovery: recovery
  };
}
function settleExpiredSourceFallbackPlayback(idx, token, opts, message) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!sourceFallbackRecoveryIdentityActive(recovery)) return false;
  if (opts && opts.fallbackOriginalSong && opts.fallbackCandidateSong) {
    restoreSourceFallbackQueueItem(idx, opts.fallbackOriginalSong, opts.fallbackCandidateSong, token);
  }
  // 必须用调用方传入的 idx / token 结算：这里已经过若干次 await，
  // 全局 currentIdx / trackSwitchToken 可能已经指向另一首歌，会把终止态打到错误项上。
  return settleSourceFallbackTerminal(
    idx,
    token,
    message || '自动恢复已达到时间上限，请稍后手动重试。',
    sourceFallbackRecoveryFailureOptions(opts) || { sourceFallbackRecovery: recovery }
  );
}
function sourceFallbackProviderAttemptKey(recovery, song, provider) {
  return (sourceFallbackRecoveryContentKey(song) || sourceFallbackSongKey(song)) + '|' + normalizePlaybackProvider(provider);
}
function beginSourceFallbackProviderAttempt(recovery, song, provider) {
  if (!sourceFallbackRecoveryCanContinue(recovery)) return false;
  var key = sourceFallbackProviderAttemptKey(recovery, song, provider);
  if (recovery.attemptedProviderKeys[key]) return false;
  if (recovery.providerAttempts >= SOURCE_FALLBACK_MAX_PROVIDER_ATTEMPTS) return false;
  recovery.attemptedProviderKeys[key] = true;
  recovery.providerAttempts++;
  return true;
}
function awaitSourceFallbackBudget(promise, recovery) {
  if (!recovery) return Promise.resolve(promise);
  var remaining = sourceFallbackRecoveryRemainingMs(recovery);
  if (remaining <= 0) return Promise.resolve(sourceFallbackBudgetTimeoutResult);
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      resolve(sourceFallbackBudgetTimeoutResult);
    }, remaining);
    Promise.resolve(promise).then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sourceFallbackProviderTitle(provider) {
  if (provider === 'qq') return 'QQ 音乐';
  if (provider === 'kugou') return '酷狗音乐';
  return '网易云';
}
function sourceFallbackProviderReady(provider) {
  provider = normalizePlaybackProvider(provider);
  if (SOURCE_FALLBACK_DIRECT_PROVIDERS.indexOf(provider) < 0) return false;
  var status = typeof platformStatus === 'function' ? platformStatus(provider) : null;
  if (!status || !status.loggedIn) return false;
  if (provider === 'qq' || provider === 'kugou') return status.playbackKeyReady === true;
  return true;
}
function alternatePlaybackProviders(song) {
  var currentProvider = normalizePlaybackProvider(songProviderKey(song));
  var ordered = typeof accountProviderOrder === 'function'
    ? accountProviderOrder()
    : SOURCE_FALLBACK_DIRECT_PROVIDERS.slice();
  var seen = {};
  var providers = [];
  ordered.concat(SOURCE_FALLBACK_DIRECT_PROVIDERS).forEach(function (provider) {
    provider = normalizePlaybackProvider(provider);
    if (seen[provider] || provider === currentProvider || !sourceFallbackProviderReady(provider)) return;
    seen[provider] = true;
    providers.push(provider);
  });
  return providers;
}
function alternatePlaybackProvider(song) {
  return alternatePlaybackProviders(song)[0] || '';
}
// 汽水公共目录（UGC）行的 artist 是上传者、原唱只写在标题括号里（后端已解析成 originalArtist/originalTitle）。
// 拿上传者去拼关键词或做「同名同歌手」校验，永远匹配不到可播版本 —— 这就是用户侧「无法播放」的最后一道墙。
function sourceFallbackCatalogMatchOnly(song) {
  if (!song || song.playable !== false) return false;
  if (song.recommendationSource === 'qishui-public-catalog') return true;
  var restriction = song.restriction || {};
  return restriction.action === 'switch_source' && restriction.category === 'provider_limited';
}
function sourceFallbackMatchIdentity(song) {
  var rawTitle = String((song && (song.name || song.title)) || '').trim();
  var rawArtist = String((song && song.artist) || '').trim();
  var catalog = sourceFallbackCatalogMatchOnly(song);
  var title = String((song && song.originalTitle) || '').trim() || rawTitle;
  var artist = String((song && song.originalArtist) || '').trim();
  // 目录行的 artist 是上传者，不能当歌手用；非目录行保持原行为（含 artists[] 兜底）。
  if (!artist && !catalog) artist = rawArtist || (artistNameParts(song)[0] || '');
  var source = song;
  if (title !== rawTitle || artist !== rawArtist) {
    source = Object.assign({}, song, {
      name: title,
      title: title,
      artist: artist,
      artists: artist ? [{ name: artist }] : []
    });
  }
  return { title: title, artist: artist, catalog: catalog, source: source };
}
// 目录行没有任何原唱线索时只能按同名匹配；必须排除翻唱/伴奏/片段等衍生版本。
// 注意：**不能用候选的 playable 字段过滤**——搜索结果里的 playable 来自 Privilege，实测周杰伦的原唱
// 会被标成 playable:false/fee:1 却仍能解析出 hires 播放地址；拿它过滤会把排在第 1 的原唱跳过、
// 反而选中后面的翻唱版本（实测「晴天」会错选蓝心羽、「搁浅」会错选杨丞琳 Live）。
// 可播性交给后面的 resolveAlbumGaplessPlaybackData 真解析去判定。
function sourceFallbackTitleOnlyMatch(title, candidate) {
  if (!candidate) return false;
  var norm = typeof simpleSearchNorm === 'function' ? simpleSearchNorm : normalizeMatchText;
  var sourceTitle = norm(title || '');
  var candidateTitle = norm((candidate.name || candidate.title) || '');
  if (!sourceTitle || !candidateTitle || sourceTitle !== candidateTitle) return false;
  if (typeof sourceSwitchSongHasBlockedArtist === 'function' && sourceSwitchSongHasBlockedArtist(candidate)) return false;
  var raw = String((candidate.name || '') + ' ' + (candidate.artist || '') + ' ' + (candidate.album || '')).toLowerCase();
  if (typeof searchLooksLikeDerivative === 'function' && searchLooksLikeDerivative(raw)) return false;
  return true;
}
async function sourceFallbackSearchCandidates(identity, target, recovery, keywordArtist) {
  var query = [identity.title, keywordArtist].filter(Boolean).join(' ').trim();
  if (!query) return null;
  var url = target === 'qq'
    ? '/api/qq/search?keywords=' + encodeURIComponent(query) + '&limit=8'
    : (target === 'kugou'
      ? '/api/kugou/search?keywords=' + encodeURIComponent(query) + '&limit=8'
      : '/api/search?keywords=' + encodeURIComponent(query) + '&limit=12');
  var data = await awaitSourceFallbackBudget(
    apiJson(url, { timeoutMs: SOURCE_FALLBACK_SEARCH_TIMEOUT_MS }),
    recovery
  );
  if (data === sourceFallbackBudgetTimeoutResult || (recovery && !sourceFallbackRecoveryCanContinue(recovery))) return null;
  return (data && (data.songs || data.result)) || [];
}
async function searchAlternatePlatformSong(song, requestedTarget, recovery) {
  var target = requestedTarget || alternatePlaybackProvider(song);
  if (!target || !sourceFallbackProviderReady(target)) return null;
  if (recovery && !sourceFallbackRecoveryCanContinue(recovery)) return null;
  if (!song || !(song.name || song.title)) return null;
  var identity = sourceFallbackMatchIdentity(song);
  if (identity.artist) {
    var list = await sourceFallbackSearchCandidates(identity, target, recovery, identity.artist);
    if (recovery && !sourceFallbackRecoveryCanContinue(recovery)) return null;
    for (var i = 0; list && i < list.length; i++) {
      if (typeof sourceCandidateRejectReason === 'function' && sourceCandidateRejectReason(identity.source, list[i], target)) continue;
      // 换源必须用严格同名：版本标识（氛围版 / Live / 伴奏…）不一致就不算同一首，
      // 否则「歌（氛围版）」会被原版顶替播放。
      if (isSameTitleArtistStrict(identity.source, list[i])) {
        var strictHit = cloneSong(list[i]);
        strictHit.autoFallbackConfidence = 'same-title-artist';
        return strictHit;
      }
    }
    return null;
  }
  // 只有「纯匹配源」目录行、且确实没有原唱信息时才走同名匹配。
  if (!identity.catalog) return null;
  var looseList = await sourceFallbackSearchCandidates(identity, target, recovery, '');
  if (recovery && !sourceFallbackRecoveryCanContinue(recovery)) return null;
  for (var j = 0; looseList && j < looseList.length; j++) {
    if (!sourceFallbackTitleOnlyMatch(identity.title, looseList[j])) continue;
    var looseHit = cloneSong(looseList[j]);
    looseHit.autoFallbackConfidence = 'same-title';
    return looseHit;
  }
  return null;
}
function sourceFallbackSongKey(song) {
  if (!song) return '';
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  return [songProviderKey(song), song.id || song.mid || song.hash || '', song.name || song.title || '', song.artist || ''].join(':');
}
// 队列项身份定位：换源搜索是长异步，等待期间用户可能删项 / 随机重排，
// 捕获的 idx 会指向别的歌。写回队列、回滚、重试、结算之前必须重新定位，
// 优先对象引用（精确，不怕同名重复），其次内容 key（队列被重建过时兜底）。
function sourceFallbackQueueIndexFor(songs) {
  if (!playQueue || !playQueue.length || !songs) return -1;
  var list = Array.isArray(songs) ? songs : [songs];
  for (var r = 0; r < list.length; r++) {
    var ref = list[r];
    if (!ref) continue;
    var byRef = playQueue.indexOf(ref);
    if (byRef >= 0) return byRef;
  }
  for (var k = 0; k < list.length; k++) {
    var key = sourceFallbackSongKey(list[k]);
    if (!key) continue;
    for (var i = 0; i < playQueue.length; i++) {
      if (sourceFallbackSongKey(playQueue[i]) === key) return i;
    }
  }
  return -1;
}
// 队列项已不在队列里（被删除 / 被整体替换）：放弃本次换源，绝不写到别的槽位
function abandonSourceFallbackForMissingItem(recovery, reason) {
  if (recovery && typeof cancelSourceFallbackRecovery === 'function') {
    cancelSourceFallbackRecovery(reason || 'queue-item-missing');
  }
  return false;
}
function restoreSourceFallbackQueueItem(idx, originalSong, candidateSong, expectedToken) {
  if (!originalSong) return false;
  if (expectedToken != null && expectedToken !== trackSwitchToken) return false;
  // 旧 idx 只能当提示：真正要回滚的位置必须按候选/原曲身份重新定位
  var targetIdx = sourceFallbackQueueIndexFor([candidateSong, originalSong]);
  if (targetIdx < 0) return false;
  if (currentIdx !== targetIdx || sourceFallbackSongKey(playQueue[targetIdx]) !== sourceFallbackSongKey(candidateSong)) return false;
  playQueue[targetIdx] = hydrateCustomCover(originalSong);
  if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(playQueue[targetIdx]);
  var title = document.getElementById('thumb-title');
  var artist = document.getElementById('thumb-artist');
  if (title) title.textContent = playQueue[targetIdx].name || playQueue[targetIdx].title || '';
  if (artist) artist.textContent = playQueue[targetIdx].artist || '';
  safeRenderQueuePanel('source-fallback-rollback', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('source-fallback-rollback');
  return true;
}
function settleSourceFallbackTerminal(idx, token, message, opts) {
  opts = opts || {};
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (token !== trackSwitchToken || currentIdx !== idx) return false;
  if (recovery) {
    if (!sourceFallbackRecoveryIdentityActive(recovery)) return false;
    recovery.terminal = true;
    recovery.terminalAt = Date.now();
    if (activeSourceFallbackRecovery === recovery) activeSourceFallbackRecovery = null;
  }
  hideLoading();
  forcePlaybackControlsInteractive();
  playToggleBusy = false;
  markQueueItemPlaybackFailed(idx, recovery);
  if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload('source-fallback-terminal');
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('source-fallback-terminal');
  if (typeof clearPlaybackResumeWatchdogs === 'function') clearPlaybackResumeWatchdogs();
  if (typeof playbackResumeRecovery !== 'undefined' && playbackResumeRecovery) {
    playbackResumeRecovery.serial = (Number(playbackResumeRecovery.serial) || 0) + 1;
    playbackResumeRecovery.pending = false;
  }
  if (audio) {
    try {
      audioFadeSerial++;
      clearAudioFadeTimers();
      audio.onended = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.__mineradioQueueItemKey = '';
      audio.__mineradioTrackSwitchToken = 0;
      audio.load();
    } catch (e) { }
  }
  playing = false;
  setPlayIcon(false);
  if (typeof syncPlaybackStateFromAudioEvent === 'function') syncPlaybackStateFromAudioEvent('source-fallback-terminal');
  if (!opts.silent) showSourceFallbackNotice('当前没有可用音源', message || '当前歌曲不可播放，并且没有其它可用音源能接管（可能未登录或尚未就绪）。');
  return false;
}
function markQueueItemPlaybackFailed(idx, recovery) {
  if (!playQueue[idx]) return;
  playQueue[idx]._lastPlaybackFailAt = Date.now();
  playQueue[idx]._lastPlaybackFailRecoveryId = recovery && recovery.id ? recovery.id : '';
}
var MAX_RECENT_AUTO_QUEUE_FAILURES = 12;
function recentQueuePlaybackFailureCount(recovery) {
  var now = Date.now();
  var count = 0;
  for (var index = 0; index < playQueue.length; index++) {
    var failedAt = Number(playQueue[index] && playQueue[index]._lastPlaybackFailAt) || 0;
    if (recovery && playQueue[index] && playQueue[index]._lastPlaybackFailRecoveryId !== recovery.id) continue;
    if (failedAt && now - failedAt <= 18000) {
      count++;
      if (count >= MAX_RECENT_AUTO_QUEUE_FAILURES) break;
    }
  }
  return count;
}
function nextUnblockedQueueIndex(idx, recovery) {
  var now = Date.now();
  for (var step = 1; step < playQueue.length; step++) {
    var nextIdx = (idx + step) % playQueue.length;
    var failedAt = Number(playQueue[nextIdx] && playQueue[nextIdx]._lastPlaybackFailAt) || 0;
    var recoveryKey = sourceFallbackRecoveryContentKey(playQueue[nextIdx]);
    if (recovery && recoveryKey && recovery.visitedSongKeys[recoveryKey]) continue;
    var failedInRecovery = !recovery
      || (playQueue[nextIdx] && playQueue[nextIdx]._lastPlaybackFailRecoveryId === recovery.id);
    if (!failedInRecovery || !failedAt || now - failedAt > 18000) return nextIdx;
  }
  return -1;
}
function isQueueItemRecentlyPlaybackFailed(idx) {
  var failedAt = Number(playQueue[idx] && playQueue[idx]._lastPlaybackFailAt) || 0;
  return !!(failedAt && Date.now() - failedAt <= 18000);
}
async function skipFailedQueueItem(idx, token, message, opts) {
  opts = opts || {};
  if (token !== trackSwitchToken) return false;
  var recovery = ensureSourceFallbackRecovery(opts, playQueue[idx], idx, token);
  if (!recovery) return false;
  var terminalOpts = Object.assign({}, opts, { sourceFallbackRecovery: recovery });
  if (!sourceFallbackRecoveryCanContinue(recovery)) {
    return settleSourceFallbackTerminal(idx, token, '自动恢复已达到时间上限，请稍后手动重试。', terminalOpts);
  }
  // 硬闸：嵌套深度。playQueueAt → skipFailedQueueItem → playQueueAt 会自我递归，
  // 每层都重跑封面/歌词/UI 重建管线。深度上限与 queueAdvances 双重封顶。
  var depth = Number(recovery.skipDepth) || 0;
  if (depth >= SOURCE_FALLBACK_MAX_QUEUE_ADVANCES) {
    return settleSourceFallbackTerminal(idx, token, '已停止自动切换，避免无可用音源时反复扫描整条队列。', terminalOpts);
  }
  recovery.skipDepth = depth + 1;
  hideLoading();
  markQueueItemPlaybackFailed(idx, recovery);
  var currentRecoveryKey = sourceFallbackRecoveryContentKey(playQueue[idx]);
  if (currentRecoveryKey) recovery.visitedSongKeys[currentRecoveryKey] = true;
  if (playQueue.length <= 1) {
    return settleSourceFallbackTerminal(idx, token, message || '当前歌曲不可播放，队列里没有其他歌曲。', terminalOpts);
  }
  /* 用户明确点选这一首：换源已把所有平台都试过，仍然没有同一版本。
   * 此时不能自动跳下一首 —— 用户点的和听到的必须是同一首，跳走就是「点 A 播 B」。
   * 停在当前项并说明原因，下一首交给用户自己点。
   * 自动连播（没带 userPick）仍保持原有「跳过受限歌曲继续播」的行为。 */
  if (opts.userPick) {
    return settleSourceFallbackTerminal(
      idx,
      token,
      '这首歌在当前音源拿不到播放地址，其它平台也没有同一版本（歌手与版本标识都一致）。已停在这里，可手动选择下一首。',
      terminalOpts
    );
  }
  if (recentQueuePlaybackFailureCount(recovery) >= Math.min(MAX_RECENT_AUTO_QUEUE_FAILURES, playQueue.length)) {
    return settleSourceFallbackTerminal(idx, token, '', terminalOpts);
  }
  if (recovery.queueAdvances >= SOURCE_FALLBACK_MAX_QUEUE_ADVANCES) {
    return settleSourceFallbackTerminal(idx, token, '已停止自动切换，避免无可用音源时反复扫描整条队列。', terminalOpts);
  }
  var nextIdx = nextUnblockedQueueIndex(idx, recovery);
  if (nextIdx < 0) {
    return settleSourceFallbackTerminal(idx, token, '已尝试绕开受限歌曲，当前队列没有新的可播放项。', terminalOpts);
  }
  if (!opts.silent) showSourceFallbackNotice('已跳过受限歌曲', message || '未找到同一版本（歌手与版本标识一致）的其它平台音源，正在播放下一首。');
  recovery.queueAdvances++;
  var nextRecoveryKey = sourceFallbackRecoveryContentKey(playQueue[nextIdx]);
  if (nextRecoveryKey) recovery.visitedSongKeys[nextRecoveryKey] = true;
  var nextPlaybackOpts = Object.assign(
    {},
    sourceFallbackQueuePlaybackOptions(opts.playbackOpts || {}, recovery),
    { skipShuffleOrder: true }
  );
  var nextStarted = await playQueueAt(nextIdx, nextPlaybackOpts);
  if (nextStarted === true) completeSourceFallbackRecovery(recovery);
  else if (sourceFallbackRecoveryIdentityActive(recovery) && !sourceFallbackRecoveryCanContinue(recovery)) {
    // 用本次换源的 idx / token 结算，不用全局 currentIdx / trackSwitchToken：
    // await 期间用户可能已经切到别的歌，全局值会把终止态打到错误项上。
    return settleSourceFallbackTerminal(idx, token, '自动恢复已达到时间上限，请稍后手动重试。', terminalOpts);
  }
  return nextStarted === true;
}
async function tryAutoPlaybackFallback(song, data, idx, token, opts) {
  opts = opts || {};
  if (opts.fallbackDepth > 0) {
    if (opts.fallbackOriginalSong && opts.fallbackCandidateSong) {
      restoreSourceFallbackQueueItem(idx, opts.fallbackOriginalSong, opts.fallbackCandidateSong, token);
    }
    return false;
  }
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') return null;
  var category = playbackRestrictionCategory(song, data);
  var fromLabel = playbackProviderLabel(song);
  var alternateProviders = alternatePlaybackProviders(song);
  if (!alternateProviders.length && category === 'login_required') return null;
  var recovery = ensureSourceFallbackRecovery(opts, song, idx, token);
  if (!recovery) return false;
  opts = Object.assign({}, opts, { sourceFallbackRecovery: recovery });
  /* 队列项身份：整个换源过程以这个队列项为中心。
   * 搜索 / 取址都是长异步，等待期间用户可能删掉前面的歌或点「随机」，
   * 捕获的 idx 会指向别的曲目 —— 写回候选、回滚、结算都必须重新定位。 */
  var queueItemSong = song;
  var committedCandidate = null;
  function liveQueueIndex() {
    return sourceFallbackQueueIndexFor([queueItemSong, committedCandidate]);
  }
  function settleFallback(message) {
    var settleIdx = liveQueueIndex();
    if (settleIdx < 0) return abandonSourceFallbackForMissingItem(recovery, 'queue-item-missing');
    return settleSourceFallbackTerminal(settleIdx, token, message, skipOpts);
  }
  var skipPlaybackOpts = sourceFallbackQueuePlaybackOptions(opts, recovery);
  skipPlaybackOpts.startupAutoplay = true;
  if (opts.resumeAt != null) skipPlaybackOpts.resumeAt = opts.resumeAt;
  var skipOpts = {
    silent: !!recovery.silent,
    playbackOpts: skipPlaybackOpts,
    sourceFallbackRecovery: recovery,
    // 用户点选的歌换源无果时停住而不是跳下一首（详见 skipFailedQueueItem）
    userPick: !!(opts && opts.userPick)
  };
  if (!sourceFallbackRecoveryCanContinue(recovery)) {
    return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
  }
  if (!alternateProviders.length) {
    // 没有任何已登录/已授权的音源可接管时，不再走 skipFailedQueueItem：
    // 那条路会 playQueueAt(nextIdx) → 再失败 → 再 skip，一层套一层。
    // 每层都重跑 封面解码/canvas/深度图/三张 three.js 纹理 + 歌词准备 + 队列面板/ shelf 重建，
    // 实测一次点击叠 3~4 层，主线程被反复打满 15~30s，渲染进程被反复分配原生内存直到 OOM
    // （kOomExceptionCode 0xE0000008，minidump 崩溃线程=渲染主线程）。
    // 这里直接终局：必须走 settleSourceFallbackTerminal 完成结算，
    // 它会置 terminal、清 activeSourceFallbackRecovery，并回收 album-gapless / cuefield / watchdog / 音频句柄。
    // 只做 hideLoading 之类的局部收尾会留下「未结算的 recovery」，
    // 后续换源会被这份旧事务挡住（tests/playback-source-fallback-transaction.test.js 覆盖此契约）。
    return settleFallback('当前歌曲不可播放，并且没有其它可用音源能接管（可能未登录或尚未就绪）。');
  }
  if (!opts.startupAutoplay) {
    showSourceFallbackNotice('正在自动换源', fromLabel + ' 当前不可播，正在检查 ' + alternateProviders.map(sourceFallbackProviderTitle).join('、') + ' 的同一版本（歌手与版本标识一致）。');
  }
  for (var providerIndex = 0; providerIndex < alternateProviders.length; providerIndex++) {
    var alternateProvider = alternateProviders[providerIndex];
    if (!beginSourceFallbackProviderAttempt(recovery, song, alternateProvider)) {
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
      }
      continue;
    }
    var targetLabel = sourceFallbackProviderTitle(alternateProvider);
    try {
      var alternate = await searchAlternatePlatformSong(song, alternateProvider, recovery);
      if (token !== trackSwitchToken) return false;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
      }
      if (!alternate) continue;
      var alternateData = typeof resolveAlbumGaplessPlaybackData === 'function'
        ? await awaitSourceFallbackBudget(resolveAlbumGaplessPlaybackData(alternate), recovery)
        : null;
      if (token !== trackSwitchToken) return false;
      if (alternateData === sourceFallbackBudgetTimeoutResult || !sourceFallbackRecoveryCanContinue(recovery)) {
        return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
      }
      if (!alternateData || !alternateData.url) continue;
      // 提交前最后一道定位：搜索等待期间可能已删项 / 重排，旧 idx 不能直接用于写入
      var commitIdx = sourceFallbackQueueIndexFor([queueItemSong]);
      if (commitIdx < 0) return abandonSourceFallbackForMissingItem(recovery, 'queue-item-missing');
      var originalSong = playQueue[commitIdx];
      alternate.autoFallbackFrom = songProviderKey(song);
      var nextCandidate = hydrateCustomCover(alternate);
      committedCandidate = nextCandidate;
      playQueue[commitIdx] = nextCandidate;
      safeRenderQueuePanel('source-fallback-provisional', { scrollCurrent: miniQueueOpen });
      safeShelfRebuild('source-fallback-provisional');
      var fallbackPlaybackOpts = {
        fallbackDepth: 1,
        startupAutoplay: !!opts.startupAutoplay,
        preserveHomeState: !!opts.preserveHomeState,
        suppressPlayFailureNotice: true,
        // 暂停意图必须穿透自动换源：删除暂停中的当前项接续时只加载音源，
        // 换到候选版本也不能自己出声（否则删除暂停曲目会突然播放）。
        holdPaused: !!opts.holdPaused,
        preResolvedPlaybackData: alternateData,
        fallbackOriginalSong: originalSong,
        fallbackCandidateSong: nextCandidate,
        sourceFallbackRecovery: recovery,
        qqQualityTried: ['hires', 'lossless', 'exhigh', 'standard']
      };
      if (opts.resumeAt != null) fallbackPlaybackOpts.resumeAt = opts.resumeAt;
      var fallbackPromise = playQueueAt(commitIdx, fallbackPlaybackOpts);
      var fallbackToken = trackSwitchToken;
      var fallbackStarted = await fallbackPromise;
      if (fallbackToken !== trackSwitchToken) return false;
      if (fallbackStarted === true) {
        queueItemSong = committedCandidate;
        completeSourceFallbackRecovery(recovery);
        if (!opts.startupAutoplay) {
          if (alternate.autoFallbackConfidence === 'same-title') {
            // 目录行没有原唱信息，只能按同名匹配 —— 必须让用户知道这一首是「同名」而不是「同名同歌手」。
            showSourceFallbackNotice('已按同名匹配换源', (song.name || '当前歌曲') + ' 在 ' + fromLabel + ' 只有同名目录版本（无原唱信息），已按同名匹配到 ' + targetLabel + ' 的版本。');
          } else {
            showSourceFallbackNotice('已自动切换音源', (song.name || '当前歌曲') + ' 已从 ' + fromLabel + ' 切到 ' + targetLabel + '。');
          }
        }
        return true;
      }
      // 回滚同样按身份定位（内部会重新解析候选当前所在位置）
      restoreSourceFallbackQueueItem(commitIdx, originalSong, committedCandidate, fallbackToken);
      committedCandidate = null;
      token = fallbackToken;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
      }
    } catch (e) {
      if (token !== trackSwitchToken) return false;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return settleFallback('自动恢复已达到时间上限，请稍后手动重试。');
      }
      console.warn('[SourceFallback]', alternateProvider, e && (e.message || e));
    }
  }
  var skipIdx = sourceFallbackQueueIndexFor([queueItemSong]);
  if (skipIdx < 0) return abandonSourceFallbackForMissingItem(recovery, 'queue-item-missing');
  // 换源只接受「同一版本」（歌手 + 版本标识一致）。氛围版 / Live / 伴奏 这类版本没有同版本音源时，
  // 宁可跳过并说明，也不拿原版顶替 —— 用户点的和听到的必须是同一首。
  return await skipFailedQueueItem(skipIdx, token, '没有找到这首歌同一版本（歌手与版本标识都一致）的其它平台音源，正在播放下一首。', skipOpts);
}
// ---------- 播放被限制时的底栏状态（2026-11-13）----------
// 之前只弹 toast + 浮层，然后自动打开登录面板；底栏曲名/歌手照旧、时间停在
// 「0:00 / 0:00」，看起来像什么都没发生（用户原话：「底栏 0:00 静默」）。
// 现在把原因写进底栏第二行，并把时间占位改成 --:--，切歌或起播成功时自动恢复。
var playbackBlockedNotice = null;

function playbackBlockedKeyOf(song) {
  song = song || {};
  return String(song.provider || '') + '|' + String(song.id || '') + '|' + String(song.name || '');
}

function applyPlaybackBlockedToControlBar() {
  var artist = document.getElementById('control-artist');
  if (!artist) return;
  if (playbackBlockedNotice) {
    var text = playbackBlockedNotice.body || playbackBlockedNotice.title || '当前歌曲无法播放';
    artist.textContent = text;
    artist.title = text;
    artist.classList.add('is-playback-blocked');
    var timeDisplay = document.getElementById('time-display');
    if (timeDisplay) timeDisplay.textContent = '--:-- / --:--';
    return;
  }
  artist.classList.remove('is-playback-blocked');
  artist.title = '';
}

function clearPlaybackBlockedNotice() {
  if (!playbackBlockedNotice) return;
  playbackBlockedNotice = null;
  var artist = document.getElementById('control-artist');
  if (artist) {
    artist.classList.remove('is-playback-blocked');
    artist.title = '';
  }
  var current = typeof playQueue !== 'undefined' && playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null;
  if (current && typeof updateControlTrackInfo === 'function') updateControlTrackInfo(current);
}

// updateControlTrackInfo() 每次换歌都会把 #control-artist 重写成歌手名，
// 所以由它在末尾回调这里：同一首还在被限制 → 保持原因；换了歌 → 清掉限制态。
function syncPlaybackBlockedNoticeForSong(song) {
  var artist = document.getElementById('control-artist');
  if (!artist) return;
  if (playbackBlockedNotice && playbackBlockedNotice.key === playbackBlockedKeyOf(song)) {
    var text = playbackBlockedNotice.body || playbackBlockedNotice.title || '当前歌曲无法播放';
    artist.textContent = text;
    artist.title = text;
    artist.classList.add('is-playback-blocked');
    return;
  }
  if (playbackBlockedNotice) playbackBlockedNotice = null;
  artist.classList.remove('is-playback-blocked');
  artist.title = '';
}

function handlePlaybackUnavailable(song, data) {
  hideLoading();
  forcePlaybackControlsInteractive();
  var provider = playbackLoginProvider(song);
  var notice = playbackRestrictionNotice(song, data);
  var category = notice.category;
  showToast(notice.toast || notice.title || playbackRestrictionMessage(song, data));
  showSourceFallbackNotice(notice.title, notice.body);
  playbackBlockedNotice = {
    key: playbackBlockedKeyOf(song),
    title: notice.title,
    body: notice.body || notice.title,
    provider: provider,
    category: category
  };
  applyPlaybackBlockedToControlBar();
  if (category === 'login_required') {
    setTimeout(function () {
      var modal = document.getElementById('login-modal');
      if (!modal || modal.classList.contains('show')) return;
      openProviderLogin(provider);
    }, 520);
  }
}
