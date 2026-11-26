const { fs, os, path, vm, spawnSync, appRoot, rel, fail, logStep, walk, forbiddenPattern, runElectron, jsCheckFiles, runNodeSyntaxCheck, readQishuiSources, readKugouSources, readServerEntrySources } = require('./helpers');

function checkMainWindowChrome() {
  logStep('Main window chrome guard');
  const mainPath = path.join(appRoot, 'desktop', 'main.js');
  const text = fs.readFileSync(mainPath, 'utf8');
  const mainWindowIndex = Math.max(
    text.indexOf('mainWindow = new BrowserWindow({'),
    text.indexOf('const win = new BrowserWindow({'),
  );
  if (mainWindowIndex < 0) fail('main BrowserWindow definition not found in desktop/main.js');
  const snippet = text.slice(mainWindowIndex, mainWindowIndex + 900);
  if (!/frame:\s*false/.test(snippet)) fail('main window is not configured as frame:false');
  if (!/transparent:\s*true/.test(snippet)) fail('main window is not configured as transparent:true');
  console.log('[OK] Main player window still uses frame:false and transparent:true.');
}

function checkProgressSeekDragGuard() {
  logStep('Progress drag seek guard');
  const progressPath = path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '04-progress-seek.js');
  const stagePath = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14-stage-lyrics-rendering.js');
  const mainLoopPath = path.join(appRoot, 'public', 'js', 'modules', '11-main-loop.js');
  const rendererQualityPath = path.join(appRoot, 'public', 'js', 'modules', '01-scene', '00-renderer-quality.js');
  const text = fs.readFileSync(progressPath, 'utf8');
  const stageText = fs.readFileSync(stagePath, 'utf8');
  const mainLoopText = fs.readFileSync(mainLoopPath, 'utf8');
  const rendererQualityText = fs.readFileSync(rendererQualityPath, 'utf8');
  if (!/previewProgressPointer/.test(text) || !/commitProgressSeek/.test(text) || !/waitForProgressSeekReady/.test(text)) {
    fail('progress drag must preview during drag and commit seek once on release');
  }
  if (!/isProgressDragPreviewActive/.test(text) || !/getProgressDragPreviewSeconds/.test(text)) {
    fail('progress drag must expose preview time for lyrics and beat visuals');
  }
  if (!/stageLyricProgressPreviewActive/.test(stageText) || !/stageLyricPlaybackSeconds/.test(stageText) || !/getProgressDragPreviewSeconds/.test(stageText)) {
    fail('stage lyrics must follow progress drag preview time without seeking audio on every pointermove');
  }
  const previewTickBody = (text.match(/function scheduleProgressLyricPreviewTick\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  if (!/scheduleProgressLyricPreviewTick/.test(text) || !/markRenderInteraction\('progress-drag'/.test(text) || !/wakeMainLoopFromBackground/.test(previewTickBody) || /tickLyricsParticles\(\)/.test(previewTickBody) || !/mainFrameGates\.lyricsParticles/.test(mainLoopText) || !/tickLyricsParticles\(\)/.test(mainLoopText)) {
    fail('progress drag must keep one main-loop-owned lyric tick per display frame');
  }
  if (!/function shouldSkipFixedRenderCadenceFrame/.test(mainLoopText) || !/state\.phase[\s\S]{0,300}elapsedMs \* fps \/ 1000/.test(mainLoopText) || !/fps >= displayHz \* 0\.98/.test(mainLoopText) || !/fixedForegroundFps/.test(rendererQualityText) || !/fixedForegroundFps == null \|\| fixedForegroundFps === 0/.test(rendererQualityText)) {
    fail('fixed foreground FPS must use phase accumulation and must not be bypassed by repeated drag interaction wakeups');
  }
  if (/renderProgressPreview\(preview\.time, preview\.duration\);\s*syncBeatMapPlaybackCursor/.test(text)) {
    fail('raw pointermove must not rescan the full beat map during lyric preview');
  }
  if (!/previewHoldUntil/.test(text) || !/previewClockRunning/.test(text) || !/getProgressPreviewClockSeconds/.test(text)) {
    fail('progress drag release must keep one continuous preview clock through seek settle');
  }
  if (!/beginProgressPreviewHold\(serial,\s*2800,\s*!!resumeAfterSeek,\s*media,\s*mediaSrc,\s*targetTime\)/.test(text) || !/finishProgressPreviewHold\(serial,\s*96\)/.test(text)) {
    fail('progress drag release must retain the preview clock across slow seek and lyric-window settlement');
  }
  if (!/function progressSeekTargetReached/.test(text) || !/!progressSeekMediaStillCurrent/.test(text) || !/media\.seeking/.test(text) || !/waitForProgressSeekReady\(media,\s*targetTime,\s*serial/.test(text)) {
    fail('progress seek completion must verify media identity, seek state, serial, and actual target time');
  }
  if (!/function progressSeekPreviewVisualReady/.test(text) || !/stageLyricProgressSeekVisualReady/.test(text + stageText) || !/previewAudioSettled && progressSeekPreviewVisualReady\(\)/.test(text)) {
    fail('progress preview must not hand its clock back before the final lyric window is visually committed');
  }
  if (!/primeProgressSeekPlayback\(media,\s*mediaSrc,\s*serial\)/.test(text) || !/resumePlaySerial/.test(text)) {
    fail('progress drag release must pre-start playback while muted instead of waiting for a second visual/audio handoff');
  }
  if (!/isProgressDragPreviewActive\(\)\s*&&\s*progressDragState\.previewDuration[\s\S]{0,120}renderProgressPreview\(getProgressPreviewClockSeconds\(\),\s*progressDragState\.previewDuration\)/.test(text)) {
    fail('progress UI must follow the same preview clock during release hold');
  }
  if (!/progressBar\.addEventListener\('pointermove'[\s\S]{0,180}queueProgressPointerPreview/.test(text) || !/function queueProgressPointerPreview[\s\S]{0,650}previewProgressPointer/.test(text)) {
    fail('progress pointermove must coalesce and update preview instead of committing audio currentTime');
  }
  if (/progressBar\.addEventListener\('pointermove'[\s\S]{0,220}currentTime\s*=/.test(text)) {
    fail('progress pointermove must not write audio.currentTime while dragging');
  }
  if (!/setAudioOutputGainImmediate\(0\)/.test(text) || !/resumeAfterSeek/.test(text) || !/attemptAudioPlay\(\{ manual: true, silent: true, fade: true \}\)/.test(text)) {
    fail('progress seek must mute during drag and resume with a fade after release');
  }
  if (!/!audio\.paused && !audio\.ended && playing/.test(text) || !/if \(!resumeAfterSeek\)[\s\S]{0,260}media\.pause\(\)/.test(text)) {
    fail('progress seek must only resume audio when it was actually playing before drag');
  }
  const commitStart = text.indexOf('function commitProgressSeek');
  const commitIdentityGuard = text.indexOf('if (!progressSeekMediaStillCurrent(media, mediaSrc))', commitStart);
  const commitMute = text.indexOf('setAudioOutputGainImmediate(0)', commitStart);
  if (!/function progressSeekMediaStillCurrent\(media, mediaSrc\)/.test(text) || commitStart < 0 || commitIdentityGuard < commitStart || commitMute < 0 || commitIdentityGuard > commitMute || /if \(!progressSeekMediaStillCurrent\(media, mediaSrc\)\) \{[\s\S]{0,120}restorePlaybackGain\(\)/.test(text) || !/progressSeekMediaStillCurrent\(dragMedia, dragMediaSrc\)[^\n]*restorePlaybackGain/.test(text)) {
    fail('stale progress drags must never mute or restore gain on a newly switched audio element');
  }
  console.log('[OK] Progress drag previews visually and commits audio seek on release.');
}

function checkLyricBackfaceMaterialGuard() {
  logStep('Lyric backface readability guard');
  // 2026-11-25：实现迁到 12-lyrics-row-layers（后加载胜出），10 里的同名死副本已删除。
  // 这里读真正生效的那份，别再读 10 —— 否则守卫会对着死代码报 OK。
  const shaderPath = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '12-lyrics-row-layers.js');
  const stagePath = path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14-stage-lyrics-rendering.js');
  const shaderText = fs.readFileSync(shaderPath, 'utf8');
  const stageText = fs.readFileSync(stagePath, 'utf8');
  if (!/function makeLyricBackfaceReadableMaterial/.test(shaderText) || !/gl_FrontFacing\s*\?\s*vUv\s*:\s*vec2\(1\.0 - vUv\.x, vUv\.y\)/.test(shaderText)) {
    fail('lyric backface materials must flip UV on backfaces like the primary lyric shader');
  }
  if (!/readabilityMat = makeLyricBackfaceReadableMaterial/.test(stageText) || !/glowMat = makeLyricBackfaceReadableMaterial/.test(stageText)) {
    fail('lyric readability and glow layers must use backface-readable materials');
  }
  console.log('[OK] Lyric readability/glow layers stay readable from the back side.');
}

function checkQQVipStatusSyncGuard() {
  logStep('QQ VIP status refresh guard');
  // 2026-10-18 服务端拆分第 8 块：QQ 协议族（fetchQQVipStatus / normalizeQQVipPayload /
  // QQ_*_TIMEOUT_MS 预算常量等）搬进 server/lib/qq-content.js 与 server/lib/qq-session.js。
  // 本守卫的断言语义是「这些能力还在服务端代码里」，不是「还在 server.js 里」→ 按族读。
  const serverText = readServerEntrySources(appRoot);
  const vipModuleText = fs.readFileSync(path.join(appRoot, 'qq-vip-api.js'), 'utf8');
  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  const preloadText = fs.readFileSync(path.join(appRoot, 'desktop', 'preload.js'), 'utf8');
  const loginStatusText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '02-login-status.js'), 'utf8');
  const loginFlowText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '03-login-modal-flows.js'), 'utf8');
  const accountUtilsText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '01-login-modal-utils.js'), 'utf8');
  const userModalText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '04-user-modal-logout.js'), 'utf8');
  const playbackText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '13-playback-start-audio.js'), 'utf8');
  const startupText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '10-shell', '05-startup-bindings.js'), 'utf8');
  const cssText = fs.readFileSync(path.join(appRoot, 'public', 'css', 'index.css'), 'utf8');

  if (!/function fetchQQVipStatus/.test(serverText) || !/SRFVipQuery_V2/.test(serverText) || !/QQ_VIP_INFO_CACHE_TTL_MS/.test(serverText) || !/forceVip/.test(serverText) || !/vipCheckedAt/.test(serverText)) {
    fail('QQ login status must include an explicit forceable VIP probe instead of relying only on profile fields');
  }
  if (!/function refreshQQConfiguredCookieStore/.test(serverText) || /function getQQLoginInfo[\s\S]{0,220}refreshConfiguredCookieStores\(true\)/.test(serverText)) {
    fail('QQ force refresh must only reload QQ cookies and must not refresh Qishui/Kugou/Netease stores');
  }
  if (!/function normalizeQQVipPayload/.test(serverText) || !/qqVipObjectLooksExpired/.test(serverText) || !/vipProbeAvailable/.test(serverText) ||
      !/decision:\s*'unknown'/.test(vipModuleText) || !/resolveQQVipFromProbes/.test(vipModuleText)) {
    fail('QQ VIP status must normalize active, expired, VIP, and SVIP signals before exposing badges');
  }
  if (!/Promise\.allSettled\(probes\.map/.test(vipModuleText) ||
      !/qqVipSessionCacheKey/.test(serverText) ||
      /qqVipInfoCache\.get\(uin\)/.test(serverText)) {
    fail('QQ VIP probes must all settle and cache results by the current account session fingerprint');
  }
  if (/vipEvidence:\s*playbackVipEvidence/.test(serverText) || /member-track-playback/.test(serverText) ||
      !/function qqPlaybackShowsMemberAccess[\s\S]{0,260}return false;/.test(loginStatusText)) {
    fail('QQ song hints and successful playback must not be promoted into persistent account VIP evidence');
  }
  if (!/function refreshQQVipStatusNow/.test(loginStatusText) || !/function qqLoginNeedsAuthorizationRefresh/.test(loginStatusText) || !/forceVip=1/.test(loginStatusText) || !/window\.addEventListener\('focus'/.test(loginStatusText) || !/visibilitychange/.test(loginStatusText)) {
    fail('QQ frontend must force VIP refresh on manual refresh and foreground return');
  }
  if (!/membershipKnown === false/.test(loginStatusText) ||
      !/Object\.assign\(\{\}, qqLoginStatus,[\s\S]{0,180}membershipStale:\s*true/.test(loginStatusText) ||
      /mergeQQPlaybackVipEvidence\(Object\.assign/.test(loginStatusText)) {
    fail('QQ frontend must keep last-known-good membership on transient failures and show unknown membership as pending');
  }
  if (!/openQQMusicLoginWindow\(owner, options\)/.test(mainText) ||
      !/options\.forceReauth[\s\S]{0,180}clearStorageData/.test(mainText) ||
      !/openQQMusicLogin:\s*\(options\)/.test(preloadText) ||
      !/forceReauth:\s*!!\(qqLoginStatus && qqLoginStatus\.loggedIn\)/.test(loginFlowText)) {
    fail('QQ membership resync must force a fresh official login instead of reusing a stale playback key');
  }
  if (!/cookieIsExpired/.test(mainText) || !/qqLoginCookieCandidateScore/.test(mainText) ||
      !/QQ_VKEY_REQUEST_TIMEOUT_MS = 6000/.test(serverText) ||
      !/QQ_AUDIO_PROBE_TOTAL_MS = 6200/.test(serverText) ||
      (playbackText.match(/timeoutMs: 15000/g) || []).length < 2) {
    fail('QQ cookie selection and end-to-end playback timeout budgets must be deterministic and aligned');
  }
  if (!/providerVipAuditSameUser/.test(loginStatusText) || !/已同步/.test(loginStatusText)) {
    fail('provider VIP audit must detect normal-to-VIP sync as well as VIP loss');
  }
  if (!/qqLoginStatusText/.test(loginFlowText) || !/qqNeedsMembershipSync/.test(loginFlowText) || !/同步会员/.test(loginFlowText) || !/重新打开官方窗口同步会员/.test(loginFlowText) || !/qqNeedsAuthRefresh \|\| qqNeedsMembershipSync/.test(loginFlowText)) {
    fail('QQ login panel must show membership-aware status and use reauthorization when the local QQ session is stale');
  }
  if (!/pendingQQSync/.test(accountUtilsText) || !/待同步/.test(accountUtilsText) || !/\.top-account-vip\.pending/.test(cssText)) {
    fail('QQ top account badge must show pending sync instead of ordinary account when membership auth is stale');
  }
  if (!/refreshQQLoginStatus\(\{ forceVip: true, reason: 'startup' \}\)/.test(startupText)) {
    fail('startup must force a QQ VIP status recheck so renewed memberships sync immediately');
  }
  if (!/QQ SVIP 会员/.test(userModalText) || !/QQ 会员待同步/.test(userModalText) || !/refreshQQVipStatusNow\('account-modal'\)/.test(userModalText)) {
    fail('account modal must distinguish QQ SVIP and refresh QQ membership when opened');
  }
  console.log('[OK] QQ membership status can be force-refreshed after renewals.');
}

function checkKugouCloudlistIdentityGuard() {
  // 2026-08-29 20017 事故守卫：cloudlist 必须走 lite 客户端身份专用通道 + dfid 注册，
  // server.js 侧不得再出现标准版身份常量。详见 docs/PROJECT_MEMORY.md 同日条目。
  logStep('Kugou cloudlist identity guard');
  // 2026-10-18 插件族拆分：kugou-api.js 退化为门面（require + 导出表），实现搬进 server/kugou/*.js。
  // 本守卫的语义是「这些身份常量 / 调用形态还在代码里」，不是「还在第几行」，
  // 所以按族读整份拼接文本（与 readQishuiSources() 同一套做法）。文件名排序固定拼接顺序。
  const kugouApiText = readKugouSources(appRoot);
  const serverText = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');
  const endpoints = ['v7/get_all_list', 'v4/get_list_all_file', 'v6/add_song', 'v4/delete_songs'];
  endpoints.forEach((endpoint) => {
    if (!new RegExp("kugouCloudlistRequest\\('/" + endpoint + "'").test(kugouApiText)) {
      fail('/' + endpoint + ' must be called via kugouCloudlistRequest (lite identity channel)');
    }
    if (new RegExp("kugou(?:H5Gateway|Gateway)Request\\('/" + endpoint + "'").test(kugouApiText)) {
      fail('/' + endpoint + ' must not bypass kugouCloudlistRequest (standard identity returns 20017)');
    }
  });
  if (!/const KUGOU_LITE_APPID = '3116'/.test(kugouApiText)) fail('kugou-api.js family must pin the lite appid 3116 (session signing identity)');
  if (!/const KUGOU_LITE_CLIENTVER = '11440'/.test(kugouApiText)) fail('kugou-api.js family must pin the lite clientver 11440');
  if (!/LnT6xpN3khm36zse0QzvmgTZ3waWdRSA/.test(kugouApiText)) fail('lite android salt missing from kugou-api.js family');
  if (!/QDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27/.test(kugouApiText)) {
    fail('device registration must use the lite RSA public key (standard key yields 20010 rsa failure)');
  }
  if (/OIlwieks28dk2k092lksi2UIkp/.test(serverText)) fail('standard android salt must not reappear in server.js (identity drift)');
  if (/DIAG7QOELSYoIJvTFJhMpe1s/.test(serverText)) fail('standard RSA key must not reappear in server.js (identity drift)');
  // 懒加载后常量经 KUGOU_ID getter 转发，仍以 kugou-api.js 为唯一来源。
  // 2026-10-18 服务端拆分（"只搬不改"）把用到 KUGOU_ID.* 的逻辑整体搬进了 server/lib/*.js，
  // server.js 只剩 getter 定义，所以使用点要在「server.js + server/lib」整体范围内找。
  const kugouIdUserTexts = [serverText];
  const serverLibDir = path.join(appRoot, 'server', 'lib');
  if (fs.existsSync(serverLibDir)) {
    fs.readdirSync(serverLibDir).filter((name) => name.endsWith('.js')).forEach((name) => {
      kugouIdUserTexts.push(fs.readFileSync(path.join(serverLibDir, name), 'utf8'));
    });
  }
  const kugouIdUsers = kugouIdUserTexts.join('\n');
  if (!/KUGOU_LITE_APPID/.test(serverText) || !/KUGOU_ID\.APPID/.test(kugouIdUsers)) {
    fail('server.js (or server/lib/*) must reuse the lite identity constants from kugou-api.js (KUGOU_ID getters)');
  }
  if (!/setKugouDfidPersistHook\(/.test(serverText)) fail('server.js must register the dfid persist hook (avoid per-launch device registration)');
  // 2026-08-31：dfid 死门控回归 — WithCloudlistDevice 必须无条件 ensure，不得再依赖未设置的 opts.router
  if (/opts\.router\s*!==\s*['"]cloudlist\.service\.kugou\.com['"]/.test(kugouApiText)) {
    fail('kugouWithCloudlistDevice must not early-return on opts.router (callers never set it; dfid injection dies)');
  }
  if (!/opts\.router\s*=\s*['"]cloudlist\.service\.kugou\.com['"]/.test(kugouApiText)) {
    fail('kugouCloudlistRequest must mark opts.router for the cloudlist channel');
  }
  // server 歌单列表不得走 gateway 旁路
  if (/kugouGatewayRequest\(\s*['"]\/v7\/get_all_list['"]/.test(serverText)) {
    fail('server.js /v7/get_all_list must use kugouCloudlistRequest (gateway bypass skips ensureKugouDfid)');
  }
  if (!/kugouApiCloudlistRequest/.test(serverText)) {
    fail('server.js must delegate cloudlist to kugou-api.js kugouCloudlistRequest');
  }
  console.log('[OK] Cloudlist stays on the lite identity channel with dfid registration.');
}

function checkVolumeWheelStepGuard() {
  logStep('Volume wheel step guard');
  const audioText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '08-audio-graph-controls.js'), 'utf8');
  if (!/function adjustVolumeByWheel/.test(audioText) || !/var step = 0\.01;/.test(audioText)) {
    fail('volume control mouse wheel must adjust exactly 1 percent per wheel event');
  }
  console.log('[OK] Volume wheel step is 1%.');
}

function checkLoginProviderTabGuard() {
  logStep('Login provider single-selection guard');
  const flowPath = path.join(appRoot, 'public', 'js', 'modules', '08-account', '03-login-modal-flows.js');
  const raw = fs.readFileSync(flowPath, 'utf8');
  // 注释里必然引用这些历史字面量，先剥行注释
  const code = raw.replace(/^\s*\/\/.*$/gm, '');
  const fnIdx = code.indexOf('function updateLoginProviderUi()');
  if (fnIdx < 0) fail('updateLoginProviderUi is missing');
  const endIdx = code.indexOf('\nasync function refreshQr()', fnIdx);
  const body = code.slice(fnIdx, endIdx > fnIdx ? endIdx : undefined);

  // 五个按钮的 active 必须在一处、按 data-login-provider === loginProvider 推导，
  // 且必须在 Qishui / Spotify 两个提前 return 的分支之前。
  const unifiedIdx = body.search(/\[neteaseBtn,\s*qqBtn,\s*kugouBtn,\s*qishuiBtn,\s*spotifyBtn\]\.forEach/);
  if (unifiedIdx < 0) fail('login provider tabs must be synchronised once in a single place');
  if (!/btn\.getAttribute\('data-login-provider'\)\s*===\s*loginProvider/.test(body)) {
    fail('tab active state must be derived from loginProvider, not hardcoded per branch');
  }
  const qishuiBranchIdx = body.indexOf('if (isQishui)');
  const spotifyBranchIdx = body.indexOf('if (isSpotify)');
  if (qishuiBranchIdx >= 0 && unifiedIdx > qishuiBranchIdx) fail('unified tab sync must run before the early-return Qishui branch');
  if (spotifyBranchIdx >= 0 && unifiedIdx > spotifyBranchIdx) fail('unified tab sync must run before the early-return Spotify branch');
  // 分支里散落的 toggle 是第二套状态来源：历史上通用尾部漏了 qishuiBtn，
  // 「汽水 → 网易云 / QQ / 酷狗」就同时留下两个 .active 行（两个选中框）。
  if (/qishuiBtn\)\s*qishuiBtn\.classList\.toggle\('active'/.test(body)
    || /neteaseBtn\)\s*neteaseBtn\.classList\.toggle\('active'/.test(body)) {
    fail('per-branch active toggles must not coexist with the unified sync');
  }
  const cssText = fs.readFileSync(path.join(appRoot, 'public', 'css', '08-account', 'account.css'), 'utf8');
  if (!/login-platform-list button:not\(\.active\)\s*\{/.test(cssText)) {
    fail('unselected login platform rows must stay borderless/backgroundless, otherwise hover leaves a second frame');
  }
  console.log('[OK] login platform tabs keep exactly one active row on every provider switch.');
}

function checkUserModalTabGuard() {
  logStep('User modal tab single-selection guard');
  const raw = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '04-user-modal-logout.js'), 'utf8');
  const code = raw.replace(/^\s*\/\/.*$/gm, '');
  // 旧实现：['netease','qq','kugou','both'].forEach + getElementById('user-provider-' + key)
  // → qishui / spotify 两个按钮的 .active 从不同步，切到它们时左列一个高亮都没有。
  if (!/querySelectorAll\('#user-platform-tabs button'\)/.test(code)) {
    fail('user modal tabs must be derived from the actual DOM buttons so new providers are included automatically');
  }
  if (/getElementById\('user-provider-'\s*\+/.test(code)
    || /\[\s*'netease'\s*,\s*'qq'\s*,\s*'kugou'\s*,\s*'both'\s*\]\s*\.forEach/.test(code)) {
    fail('hardcoded provider whitelist is back: qishui / spotify tabs would never receive .active');
  }
  if (!/\.replace\(\/\^user-provider-\//.test(code)) fail('tab key must be derived from the button id');
  if (!/key === 'both' \? dualAccountMode/.test(code)) fail('All (dual account) tab must keep its own active rule');
  // 退出按钮原来写死三家英文名，切到汽水/Spotify 会显示「Logout Netease」
  if (/Logout Netease|Logout Kugou|Logout QQ Music/.test(code)) fail('logout label must follow the active provider, not a three-platform hardcoded string');
  if (!/logoutBtn\.textContent = '退出' \+ meta\.label/.test(code)) fail('logout label must be derived from platformMeta(activeAccountProvider).label');
  const html = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  ['netease', 'qq', 'kugou', 'qishui', 'spotify', 'both'].forEach(function (key) {
    if (!new RegExp('id="user-provider-' + key + '"').test(html)) fail('user-platform-tabs is missing the ' + key + ' button');
  });
  console.log('[OK] user modal tabs stay single-selected and the logout label follows the active provider.');
}

function checkPlatformPanelStyleGuard() {
  logStep('Platform recommend panel styling guard');
  const nfPath = path.join(appRoot, 'public', 'css', '05-playback', 'netease-features.css');
  const nfCss = fs.readFileSync(nfPath, 'utf8');
  const shellCss = fs.readFileSync(path.join(appRoot, 'public', 'css', '10-shell', 'shell.css'), 'utf8');

  // 输入行：.netease-features-inputs 里的 select/input 必须走自定义外观。
  // 曾经只有 .netease-features-toolbar 有样式，这一行是原生控件（白底黑字、0 圆角），
  // 在深色玻璃面板上像一块白补丁。
  if (!/\.netease-features-inputs\s*>\s*\*/.test(nfCss)) fail('netease-features input row lost its styling hook (.netease-features-inputs > *)');
  if (!/appearance:\s*none/.test(nfCss)) fail('select must reset native appearance, otherwise it renders as a white system control');
  if (!/background-image:\s*url\("data:image\/svg\+xml/.test(nfCss)) fail('select must keep the inline SVG chevron');
  if (!/\.netease-features-inputs input::placeholder/.test(nfCss)) fail('input placeholder colour must be themed');
  if (!/\.netease-features-inputs\s*>\s*\*[^{]*\{[^}]*border-radius/s.test(nfCss)) fail('input row must keep its rounded glass chrome');

  // 滚动条：两处容器都要细药丸 + 透明轨道 + 无箭头；标准属性只能在 @supports 里，
  // 否则 Chromium 会整组忽略 ::-webkit-scrollbar-*（见 index.css 同名注释）。
  const scrollbars = [
    { name: 'netease-features-panel', css: nfCss },
    { name: 'home-platform-recommend-list', css: shellCss }
  ];
  scrollbars.forEach(function (entry) {
    const sel = '\\.' + entry.name + '::-webkit-scrollbar';
    if (!new RegExp(sel + '\\b').test(entry.css)) fail(entry.name + ' lost its custom scrollbar');
    if (!new RegExp(sel + '-thumb[^}]*border-radius', 's').test(entry.css)) fail(entry.name + ' scrollbar thumb must stay a rounded pill');
    if (!new RegExp(sel + '-button[^}]*display:\\s*none', 's').test(entry.css)) fail(entry.name + ' scrollbar must hide the arrow buttons');
    if (!new RegExp(sel + '-track\\s*\\{[^}]*background:\\s*transparent', 's').test(entry.css)) fail(entry.name + ' scrollbar track must stay transparent');
  });
  [nfCss, shellCss].forEach(function (css) {
    const stdIdx = css.indexOf('scrollbar-width:');
    if (stdIdx < 0) return;
    const supportsIdx = css.indexOf('@supports not selector(::-webkit-scrollbar)');
    if (supportsIdx < 0 || stdIdx < supportsIdx) {
      fail('scrollbar-width/scrollbar-color must sit inside @supports not selector(::-webkit-scrollbar), otherwise Chromium drops the webkit pseudo-elements');
    }
  });
  if (!/\.home-platform-recommend-list\s*\{[^}]*scrollbar-gutter:\s*stable/s.test(shellCss)) {
    fail('recommend list must reserve the scrollbar gutter, otherwise the two-column grid shifts when it appears');
  }
  console.log('[OK] platform recommend panel keeps themed inputs and pill scrollbars.');
}

function checkCoverFallbackGuard() {
  logStep('Cover load fallback guard');
  const apiText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '01-api', '00-mineradio-api.js'), 'utf8');
  const qualityText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '00a-api-quality.js'), 'utf8');
  if (!/function mineradioCoverFallback\(img\)/.test(apiText)) fail('mineradioCoverFallback must stay defined in 01-api/00-mineradio-api.js');
  if (!/mineradioCoverFallback:\s*mineradioCoverFallback/.test(apiText)) fail('mineradioCoverFallback must be exported on Mineradio.api');
  if (!/var mineradioCoverFallback = Mineradio\.api\.mineradioCoverFallback;/.test(qualityText)) {
    fail('mineradioCoverFallback must be promoted to a global in 05-playback/00a-api-quality.js (all modules use it inline)');
  }
  // 关键判据：src 必须换成 1x1 透明图，不能只是 opacity / removeAttribute
  if (!/data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP/.test(apiText)) fail('cover fallback must swap src to the transparent 1x1 GIF (opacity keeps the broken-image icon)');
  if (!/img\.src = MINERADIO_BLANK_IMAGE/.test(apiText)) fail('cover fallback must assign the blank image');
  if (!/dataset\.coverBroken = '1'/.test(apiText)) fail('cover fallback must mark data-cover-broken so probes/tests can assert it');

  // 全站 <img> 的 onerror 都必须指向这个函数：内联 this.style.opacity 会留下破图图标
  const offenders = [];
  walk(path.join(appRoot, 'public', 'js', 'modules')).forEach(function (file) {
    if (!file.endsWith('.js')) return;
    const text = fs.readFileSync(file, 'utf8');
    if (/onerror="this\.style\.opacity/.test(text)) offenders.push(rel(file));
  });
  if (offenders.length) {
    fail('inline onerror="this.style.opacity=…" leaves the browser broken-image icon: ' + offenders.join(', '));
  }
  console.log('[OK] every cover <img> falls back to a blank image and a grey placeholder block.');
}

function checkPlaylistCoverMarkGuard() {
  logStep('Playlist cover placeholder mark guard');
  const detailText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '02-playlist-detail.js'), 'utf8');
  const cssText = fs.readFileSync(path.join(appRoot, 'public', 'css', '06-lyrics', 'playlist.css'), 'utf8');

  // 判据：喜欢=库的 Cardioid Heart、收藏=库的 Rose Curve（math-curve-loaders 原版移植，
  // 2026-11-13 用户要求撤掉设计稿的实心爱心/五角星），其余无封面保持灰块
  if (!/function playlistCoverMarkKind\(pl\)/.test(detailText)) fail('playlistCoverMarkKind is missing');
  if (!/function playlistCoverMarkHtml\(pl, size, radius\)/.test(detailText)) fail('playlistCoverMarkHtml is missing');
  if (!/isLikedPlaylistContext\(/.test(detailText)) fail('liked playlists must reuse isLikedPlaylistContext instead of a new ad-hoc name match');
  // 曲线必须来自库的原版定义（方程参数/粒子数/尾迹/时长默认值），不许自画形状。
  // liked 用 Heart Wave：库的 Cardioid Heart 渲染出来凹口在底部（用户看着是倒的），
  // Heart Wave 两瓣朝上才是正立心。
  if (!/PLAYLIST_TRAIL_CURVES\s*=\s*\{[^}]*liked:\s*\{[^}]*(Heart Wave|particleCount: 104)/.test(detailText)) {
    fail('liked must use the library Heart Wave config (104 particles, upright heart)');
  }
  if (!/collected:\s*\{[^}]*particleCount: 78/.test(detailText)) {
    fail('collected must use the library Rose Curve config (78 particles)');
  }
  if (!/b: 6\.4, root: 3\.3, amp: 0\.9, scaleX: 23\.2, scaleY: 24\.5/.test(detailText)) {
    fail('Heart Wave original parameters are missing');
  }
  if (!/a: 9\.2, aBoost: 0\.6, breathBase: 0\.72, breathBoost: 0\.28, k: 5, scale: 3\.25/.test(detailText)) {
    fail('Rose Curve original parameters are missing');
  }
  // 原版引擎三件套：呼吸曲线 / 旋转 / 拖尾粒子公式
  if (!/0\.52 \+ \(\(Math\.sin\(pulse \* Math\.PI \* 2 \+ 0\.55\) \+ 1\) \/ 2\) \* 0\.48/.test(detailText)) {
    fail('getDetailScale breathing curve (original formula) is missing');
  }
  if (!/Math\.pow\(1 - tailOffset, 0\.56\)/.test(detailText) || !/0\.9 \+ fade \* 2\.7/.test(detailText)) {
    fail('original getParticle trail formula is missing');
  }
  if (!/function playlistCoverHtml\(pl, thumb, size, radius\)/.test(detailText)) fail('playlistCoverHtml (cover slot) is missing');
  if (!/playlistCoverHtml\(pl, thumb, 44, 8\)/.test(detailText)) fail('the playlist card must render its cover through playlistCoverHtml');
  if (!/\.pl-cover-slot\{/.test(cssText)) fail('.pl-cover-slot styles are missing (img + hidden mark must share one box)');
  // 封面加载失败也要落到标记上，不能留一块灰 —— 用户那张「Ta在抖音收藏的音乐」就是有 URL 但拉不到
  const apiText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '01-api', '00-mineradio-api.js'), 'utf8');
  if (!/classList\.contains\('pl-cover-mark'\)/.test(apiText)) {
    fail('mineradioCoverFallback must reveal the sibling cover mark when a real cover fails to load');
  }

  // 样式：颜色走 currentColor、标记不吃指针事件、hover 动画由卡片驱动
  // 必须限定在这个规则块内（[^}] 不跨块）——用 [\s\S]*? 会匹配到文件后面别处的
  // pointer-events:none，等于守卫失效（这条第一次就踩了，突变自证才暴露）。
  if (!/\.pl-cover-mark\{[^}]*pointer-events:none/.test(cssText)) {
    fail('.pl-cover-mark must be pointer-events:none: it sits over the card and would eat the card hover/click');
  }
  if (!/\.pl-cover-mark\.is-liked\{color:#ff2d55\}/.test(cssText)) fail('liked mark colour is missing');
  if (!/\.pl-cover-mark\.is-collected\{color:#ffc93c\}/.test(cssText)) fail('collected mark colour is missing');
  if (!/\.pl-card:hover \.pl-cover-mark\.is-liked\{filter:drop-shadow/.test(cssText)) {
    fail('liked hover glow must be driven by .pl-card:hover (the pointer rests on the card, not the icon)');
  }
  if (/pl-cover-beat|pl-cover-twinkle/.test(cssText)) {
    fail('the old hand-drawn heart-beat / twinkle keyframes must go with the removed solid heart/star icons');
  }
  // hover 粒子动画必须以卡片为单位绑定（mark 是 pointer-events:none，永远不是事件目标）
  if (!/closest\('\.pl-card'\)/.test(detailText)) {
    fail('trail mouseover delegation must resolve the mark from .pl-card, not from closest(.pl-cover-mark)');
  }
  console.log('[OK] coverless playlists use the library math-curve placeholders (static outline + hover particle trail).');
}

function checkPlatformPanelPlaybackGuard() {
  logStep('Platform panel playback semantics guard');
  const nfText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '20-netease-features.js'), 'utf8');
  const pfxText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '21-platform-extras.js'), 'utf8');
  const fallbackText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '05-playback', '11-provider-fallback.js'), 'utf8');
  const coverText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '03-beat', '05-cover-depth.js'), 'utf8');
  const progressText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '06-lyrics', '04-progress-seek.js'), 'utf8');
  const cssText = fs.readFileSync(path.join(appRoot, 'public', 'css', '05-playback', 'playback.css'), 'utf8');

  // 语义三分：点行=单曲，右侧按钮=连播整批，文案必须说「正在播放」而不是「加入队列」
  if (!/function nfPlaySongs\(songs, index, name, all\)/.test(nfText)) fail('nfPlaySongs must take an `all` flag (row click = single, button = whole batch)');
  if (!/nfPlaySongs\(nfState\.songs,[\s\S]{0,220}?'网易云', true\)/.test(nfText)) fail('the 「全部」 button must pass all=true');
  if (!/nfPlaySongs\(nfState\.songs,[\s\S]{0,220}?'网易云'\)/.test(nfText)) fail('row click must call nfPlaySongs WITHOUT all=true (single-track play)');
  if (!/data-nf-act="play"[^>]*>全部</.test(nfText)) fail('the row button label must say 全部 (not 播放), otherwise it reads as single-track play');
  if (/已把 '\s*\+\s*songs\.length\s*\+\s*' 首加入播放队列/.test(nfText)) fail('the old misleading status text ("已把 N 首加入播放队列") must stay gone');
  if (!/function pfxPlaySong\(item, all\)/.test(pfxText)) fail('pfxPlaySong must take an `all` flag');
  if (!/data-pfx-all="1"/.test(pfxText)) fail('the platform panel row button must carry data-pfx-all');
  if (!/pfxPlaySong\(item, row\.hasAttribute\('data-pfx-all'\)\)/.test(pfxText)) fail('row click must play one track; only the 全部 button plays the batch');
  if (/已把 '\s*\+\s*pfxState\.songs\.length\s*\+\s*' 首加入播放队列/.test(pfxText)) fail('the old misleading status text must stay gone (platform panel)');

  // 播放被限制时底栏必须给出原因，而不是停在 0:00
  if (!/var playbackBlockedNotice = null;/.test(fallbackText)) fail('playbackBlockedNotice state is missing');
  if (!/function syncPlaybackBlockedNoticeForSong\(/.test(fallbackText)) fail('syncPlaybackBlockedNoticeForSong is missing');
  if (!/playbackBlockedNotice = \{[\s\S]{0,220}?\};\s*applyPlaybackBlockedToControlBar\(\)/.test(fallbackText)) {
    fail('handlePlaybackUnavailable must record the notice AND write it into the control bar');
  }
  if (!/typeof syncPlaybackBlockedNoticeForSong === 'function'/.test(coverText)) fail('updateControlTrackInfo must keep the blocked reason instead of overwriting it with the artist name');
  if (!/blocked \? '--:-- \/ --:--'/.test(progressText)) fail('blocked playback must show --:-- instead of 0:00 / 0:00');
  if (!/\.control-artist\.is-playback-blocked\{/.test(cssText)) fail('the blocked state needs its own colour');
  console.log('[OK] panel rows play a single track, the 全部 button plays the batch, and blocked playback explains itself in the control bar.');
}

function checkVisualGuideGuard() {
  logStep('Onboarding guide guard');
  const toastText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '08-account', '06-toast.js'), 'utf8');
  const globalsText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '00-state', '12a-audio-login-globals.js'), 'utf8');

  // 引导要跟着功能走：平台推荐 / 平台能力 / 我的歌单 / 导入 / 受限说明都得在里面
  const simpleBlock = toastText.slice(toastText.indexOf('var visualGuideSteps = ['), toastText.indexOf('var visualGuideStepsDiy = ['));
  const diyBlock = toastText.slice(toastText.indexOf('var visualGuideStepsDiy = ['), toastText.indexOf('function activeVisualGuideSteps()'));
  if (!simpleBlock || !diyBlock) fail('guide step tables are missing');
  const simpleSteps = (simpleBlock.match(/kicker:/g) || []).length;
  const diySteps = (diyBlock.match(/kicker:/g) || []).length;
  if (simpleSteps < 7) fail('simple-mode guide must cover the new entries (at least 7 steps), got ' + simpleSteps);
  if (diySteps < 6) fail('DIY guide lost steps, got ' + diySteps);
  [
    ['平台推荐卡片', '.home-card[data-card-id="discover"]'],
    ['我的歌单卡片', '.home-card[data-card-id="library"]'],
    ['底栏', '#bottom-bar'],
    ['账号', '#user-btn'],
    ['搜索', '#search-box']
  ].forEach(function (entry) {
    if (simpleBlock.indexOf(entry[1]) < 0) fail('simple guide is missing the ' + entry[0] + ' step (' + entry[1] + ')');
  });
  ['平台能力', '我的歌单', '导入'].forEach(function (word) {
    if (simpleBlock.indexOf(word) < 0) fail('simple guide never mentions 「' + word + '」 — that is the part that went stale');
  });
  ['#playlist-panel', '#fx-panel'].forEach(function (sel) {
    if (diyBlock.indexOf(sel) < 0) fail('DIY guide is missing ' + sel);
  });

  // 内容版本号：改了引导就要能重新展示一次
  if (!/VISUAL_GUIDE_SEEN_STORE_KEY = 'mineradio-visual-guide-seen-v3'/.test(globalsText)) {
    fail('guide content changed — bump VISUAL_GUIDE_SEEN_STORE_KEY so existing users see the new version once');
  }
  // 「?」入口看过即收起 —— 这是产品有意为之（首启提示一次，不让它长期占位）。
  // 别把它改成常驻，也别删掉这个隐藏逻辑。
  if (!/classList\.add\('visual-guide-btn-hidden'\)/.test(toastText)) {
    fail('the guide entry must hide itself once seen (explicit product decision)');
  }
  // 图标是自绘 SVG（细线圆环 + 问号），和相邻「发现新版本」同构；别再退回纯文本问号
  const htmlText = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  if (!/id="visual-guide-btn"[\s\S]{0,320}?class="visual-guide-glyph"/.test(htmlText)) {
    fail('the guide entry must use the SVG glyph, not a text question mark');
  }
  console.log('[OK] onboarding guide covers the new entries, hides after first run, and uses the circular help glyph.');
}

function checkDesktopLyricsMotionGuard() {
  logStep('Desktop lyrics line-motion guard');
  const html = fs.readFileSync(path.join(appRoot, 'public', 'desktop-lyrics.html'), 'utf8');

  // 面板四档：上浮 / 3D 翻转 / 呼吸 / 静止。单行（默认行数 1）与多行栈都要各自有分支，
  // 只写多行的话，默认配置下四个选项看起来一模一样（用户就是这么发现「没效果」的）。
  if (!/body\.motion-slide \.line\.in\{animation:lyr-motion-slide/.test(html)) {
    fail('single-line slide motion is missing: the default 1-line layout would fall back to the fixed lyr-in');
  }
  if (!/body\.motion-flip \.line\.in\{animation:lyr-motion-flip/.test(html)) fail('single-line flip motion is missing');
  if (!/body\.motion-float:not\(\.paused\) \.line\{/.test(html)) {
    fail('single-line float motion is missing (and it must skip .paused so it does not override the paused opacity)');
  }
  if (!/body\.motion-none \.line\.in\{animation:none;opacity:1\}/.test(html)) {
    fail('single-line "static" must cancel the entrance animation AND force opacity:1, otherwise the lyric disappears');
  }
  ['lyr-motion-slide', 'lyr-motion-flip', 'lyr-motion-breathe'].forEach(function (name) {
    if (html.indexOf('@keyframes ' + name) < 0) fail('missing keyframes ' + name);
  });
  // 多行栈那条老分支不能丢
  if (!/body\.motion-slide \.line-row\.enter\{animation:row-slide/.test(html)) fail('multi-row slide motion regressed');
  if (!/body\.motion-flip \.line-row\.enter\{animation:row-flip/.test(html)) fail('multi-row flip motion regressed');
  if (!/body\.motion-float:not\(\.paused\) \.line-row\.active\{animation:row-breathe/.test(html)) fail('multi-row float motion regressed');
  /* 呼吸幅度不能小到看不见：3px / 1.5% 缩放在正常字号下肉眼不可见，
   * 用户实测反馈「呼吸没有效果」（其余三档都有明显入场）。 */
  if (!/-7px,0\) scale\(1\.04\)/.test(html)) fail('row-breathe amplitude is too subtle to see (needs ~7px / 1.04)');
  if (!/-8px,0\) scale\(1\.04\)/.test(html)) fail('lyr-motion-breathe amplitude is too subtle to see (needs ~8px / 1.04)');
  /* 呼吸也要有「换行反馈」：其他三档换行都有入场动画，只有呼吸在换行瞬间毫无变化，
   * 盯着换行看就是「没效果」。入场用短促弹一下 + 呼吸从入场结束接续。 */
  if (!/body\.motion-float:not\(\.paused\) \.line-row\.active\.enter\{animation:row-float-in/.test(html)) {
    fail('float motion has no line-change feedback in stacked layout (row-float-in on .active.enter)');
  }
  if (!/body\.motion-float:not\(\.paused\) \.line\.in\{animation:lyr-float-in/.test(html)) {
    fail('float motion has no line-change feedback in single-line layout (lyr-float-in on .line.in)');
  }
  /* 多行「换行」的触发条件：payload 里 active 恒定落在窗口正中（desktopLyricWindow 的
   * k === half），所以 activeIdx 永远是同一个数字。只比 activeIdx 的话 remove/add .enter
   * 一次都不会执行，enter 类只是首次渲染的残留 —— 换行时四档动效看起来完全一样，
   * 面板上选什么都没反应。必须比整窗文本签名（换行时整窗文本都会变），
   * 再用「进度回退」兜住连续两句歌词字面相同的情况。 */
  if (/var lineChanged = activeChanged;/.test(html)) {
    fail('stacked layout decides the entrance on activeIdx alone: active always sits on the middle row, so a line change never replays');
  }
  if (!/var lineChanged = activeChanged \|\| signature !== stackSignature/.test(html)) {
    fail('stacked layout must detect a line change from the whole-window text signature');
  }
  if (!/activeProgress \+ \.5 < stackActiveProgress/.test(html)) {
    fail('stacked layout must treat a progress rewind as a line change, otherwise two identical consecutive lines replay nothing');
  }
  if (!/state\.lyricMotion !== 'none'/.test(html)) {
    fail('stacked layout must skip the replay in "static" mode instead of forcing a reflow every line');
  }
  /* 桌面歌词文字对齐（2026-11-14）：居中/左/右。链路 = 默认值 → normalize → payload
   * → 页面 body.align-* → viewport/stack/text-align 三层 CSS；超长句滚动锚点随对齐变
   * （右对齐向右滚、正位移）。 */
  const settingsText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '00-state', '12d-fx-runtime-globals.js'), 'utf8');
  const layoutText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03c-lyrics-layout-settings.js'), 'utf8');
  const overlayText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '10-shell', '04-desktop-overlay-fullscreen.js'), 'utf8');
  const indexText = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  if (!/desktopLyricsAlign: 'center'/.test(settingsText)) fail('desktopLyricsAlign default is missing in fxDefaults');
  if (!/function normalizeDesktopLyricsAlign/.test(layoutText)) fail('normalizeDesktopLyricsAlign is missing');
  if (!/desktopLyricsAlign: normalizeDesktopLyricsAlign/.test(layoutText)) fail('align must flow through the layout settings read/write');
  if (!/align: normalizeDesktopLyricsAlign\(fx\.desktopLyricsAlign/.test(overlayText)) fail('desktop lyrics payload must carry align');
  if (!/payload\.align/.test(overlayText)) fail('payload change-key must include align so a switch re-pushes');
  if (!/data-desktop-lyrics-align="left"/.test(indexText) || !/desktop-lyrics-align-seg/.test(indexText)) fail('align segment control is missing in the fx panel');
  if (!/body\.align-left \.lyric-viewport\{[^}]*text-align:left/.test(html) || !/body\.align-right \.lyric-viewport\{[^}]*text-align:right/.test(html)) fail('align CSS branches for the viewport are missing');
  if (!/body\.align-left \.lyric-stack\{align-items:flex-start;/.test(html) || !/body\.align-right \.lyric-stack\{align-items:flex-end;/.test(html)) fail('stack alignment CSS branches are missing');
  if (!/document\.body\.classList\.add\('align-' \+ state\.align\)/.test(html)) fail('page must apply body align class from the payload');
  if (!/state\.align === 'right' \? 1 : -1/.test(html)) fail('scroll direction must follow the align setting (right-aligned lyrics scroll rightwards)');
  /* 左/右对齐 + 倾斜（2026-11-15）：绕容器中心 rotateY 会把贴边端推到透视极端，
   * 字形被放大/压缩 2.6 倍（实测左对齐 +35° 首字 103px、末字 50px；-35° 整行
   * 压到 215px、字宽 19px），用户明确反馈「字体被拉伸、看着奇怪」。
   * 正解 = 贴边端做旋转原点（该点投影后固定，不需要位置补偿）+ 2400px 弱透视；
   * 居中档保持 800px / 中心原点原设计。 */
  if (!/body\.align-left,body\.align-right\{--lyric-tilt-perspective:2400px\}/.test(html)) {
    fail('aligned lyrics must use a weaker perspective (2400px) so tilt does not stretch glyphs');
  }
  if (!/body\.align-left \.lyric-stack\{align-items:flex-start;transform-origin:left center\}/.test(html) ||
      !/body\.align-right \.lyric-stack\{align-items:flex-end;transform-origin:right center\}/.test(html)) {
    fail('stacked lyrics must rotate around the aligned edge so the first/last character stays put');
  }
  if (!/transform:perspective\(var\(--lyric-tilt-perspective,800px\)\) rotateY\(var\(--lyric-tilt, 0deg\)\);/.test(html)) {
    fail('stack transform lost the align-aware perspective');
  }
  if (!/perspective\(var\(--lyric-tilt-perspective,800px\)\) rotateY\(var\(--lyric-tilt, 0deg\)\) translate3d/.test(html)) {
    fail('single-line transform lost the align-aware perspective');
  }
  if (/--lyric-stack-tilt-shift|alignStackTiltShift|applyStackTiltShift/.test(html)) {
    fail('obsolete tilt position compensation must not come back: the origin-based approach replaces it');
  }
  /* 控制条位置 + 切档稳定（2026-11-15）：控制条固定在窗口居中时，左对齐歌词
   * 会把它甩到「右边」；居中档残留的 cinema 几何律动与 transform 过渡会让
   * 切档后文字持续漂移（实测 20~68px）。 */
  if (!/body\.align-left \.lock-hint\{left:16px/.test(html) ||
      !/body\.align-right \.lock-hint\{left:auto;right:16px/.test(html)) {
    fail('lyrics control bar must follow the alignment so it sits above the lyrics, not to their right');
  }
  if (!/body\.align-left \.stage\.hint-visible \.lock-hint\{transform:translateX\(0\)/.test(html) ||
      !/body\.align-right \.stage\.hint-visible \.lock-hint\{transform:translateX\(0\)/.test(html)) {
    fail('aligned control bar must drop the translateX(-50%) centering transform');
  }
  /* 2026-11-21：几何律动已从 applyStageMotion 整体移除（比 11-15 的「三档置零」更彻底），
   * stage 的 transform 固定为零位移，只保留亮度/发光律动。判据随之改为「正向锁定固定值
   * + 反向禁止任何几何项写进 transform」，比只找置零变量更能防回退。 */
  if (!/stage\.style\.transform\s*=\s*'translate3d\(0px,0px,0\)'/.test(html)) {
    fail('stage transform must stay pinned to zero displacement (geometric cinema motion removed)');
  }
  if (/stage\.style\.transform\s*=[^\n]*(?:rotateX|rotateY|rotate3d|scale|scaleX|scaleY)\(/.test(html)) {
    fail('geometric motion must not be written back into stage transform (drifts when switching align)');
  }
  if (/state\.align === 'left' \|\| state\.align === 'right'\) \? 1 : live\.scale/.test(html)) {
    fail('per-alignment geometry motion must not come back');
  }
  if (!/body\.align-switch \.lyric-stack\{transition:none\}/.test(html) ||
      !/body\.align-switch \.lock-hint\{transition:opacity \.16s ease\}/.test(html) ||
      !/document\.body\.classList\.add\('align-switch'\)/.test(html)) {
    fail('align switching must suppress transform transitions for the stack and the control bar');
  }
  /* 控制条垂直位置（2026-11-15）：胶囊写死 top:72px 只对单行档成立（stage 顶部
   * padding 104px）；多行档 padding 只有 22px，实测 3 行时胶囊 130..162 而
   * viewport 80..258 —— 功能按钮压在第一行歌词上，用户明确要求「放到歌词顶上」。
   * 正解 = 用 stage 的实测 paddingTop 反推（viewport.top = stage.top + paddingTop），
   * 该值只由 stack-mode 决定，与文字宽度/字号过渡无关，切档换行都不跳。 */
  if (!/function positionLyricControlBar/.test(html) ||
      !/parseFloat\(getComputedStyle\(stage\)\.paddingTop\)/.test(html) ||
      !/lockHint\.style\.top = top \+ 'px'/.test(html) ||
      (html.match(/positionLyricControlBar\(\);/g) || []).length < 4) {
    fail('lyrics control bar must be positioned above the viewport from the live stage padding, and re-synced on every layout path');
  }
  if (!/hintVisible && hintRect && hintRect\.width > 0/.test(html)) {
    fail('unlocked hover hit test must include the control bar once it sits above the stage box, otherwise its buttons cannot be clicked');
  }
  /* 小屏 + 多行（600px 屏 / 10 行 / 504px 窗口）歌词块几乎铺满窗口，顶部只剩 27px，
   * 胶囊放不进去。用文字无关的预测值把歌词块微量下移让出顶栏；必须扣掉已生效的
   * 下移量再算基线，否则会自反馈越推越下。 */
  if (!/--lyric-control-push:0px/.test(html) ||
      !/transform:translate3d\(0,var\(--lyric-control-push,0px\),0\)/.test(html) ||
      !/function lyricPredictedViewportTop/.test(html) ||
      !/vpRect\.bottom - controlPushPx/.test(html) ||
      !/var roomBottom = Math\.max\(0, innerHeight - baseBottom - 6\)/.test(html)) {
    fail('short-window control-bar clearance must be text-independent and free of push feedback');
  }
  console.log('[OK] desktop lyrics honour all four line-motion presets in both single-line and stacked layouts.');
}

function checkSplashBootGuard() {
  logStep('Splash boot / WebGL fail-open guard');
  const rendererText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '01-scene', '00-renderer-quality.js'), 'utf8');
  const splashText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '10-shell', '01-splash-and-boot.js'), 'utf8');
  const loaderText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'index-loader.js'), 'utf8');

  // 125 个模块合并成【单个】script 求值（为了跨文件 function 提升）。代价是：
  // 任何一行顶层未捕获异常都会把它之后的全部模块一起带走，只留下被提升的函数声明。
  // renderer 创建是这条链上最典型的爆点 —— WebGL 不可用时 THREE 直接 throw。
  if (/(^|\n)\s*var renderer = new THREE\.WebGLRenderer\(/.test(rendererText)) {
    fail('renderer creation must not be a bare top-level statement: one throw aborts every module after it (splash then hangs at 100%)');
  }
  if (!/try \{\s*\r?\n\s*var real = new THREE\.WebGLRenderer\(/.test(rendererText)) fail('renderer creation must be wrapped in try/catch');
  if (!/catch \(rendererErr\)/.test(rendererText)) fail('renderer creation must catch WebGL failures explicitly');
  if (!/function createInertRendererStub\(/.test(rendererText)) {
    fail('WebGL failure must degrade to an inert renderer stub — null breaks the 89 renderer.* call sites');
  }
  if (!/domElementIsInertStub = true/.test(rendererText)) fail('inert renderer stub must expose the domElementIsInertStub marker so tests can tell it apart');
  if (!/__mineradioRendererUnavailable/.test(rendererText) || !/mineradio-no-webgl/.test(rendererText)) {
    fail('renderer fallback must leave a visible trace (window.__mineradioRendererUnavailable + body.mineradio-no-webgl)');
  }

  // 注释里也会出现同样的字面量（解释历史 bug 时必然要引用），所以先剥掉行注释再断言，
  // 否则守卫会被自己的说明文字骗过去。
  const splashCode = splashText.replace(/^\s*\/\/.*$/gm, '');

  // 开屏的时间门禁不能把「还没开始」当成 elapsed=0，否则 50ms 轮询永不出队。
  if (/var splashShownAt = 0;/.test(splashCode)) fail('splashShownAt must be initialised at module evaluation, not 0');
  if (!/var splashShownAt = \(typeof performance/.test(splashCode)) fail('splashShownAt must capture performance.now() when the module is evaluated');
  if (/splashShownAt \? \(performance\.now\(\) - splashShownAt\) : 0/.test(splashCode)) {
    fail('splash gate must not treat a missing splashShownAt as elapsed=0 (that is the infinite-retry deadlock)');
  }
  if (!/function splashElapsedSinceShown\(/.test(splashCode)) fail('splash elapsed helper is missing');
  if (!/SPLASH_CORE_READY_MAX_WAIT_MS/.test(splashCode) || !/markSplashReadyToEnter\('core-not-ready'\)/.test(splashCode)) {
    fail('splash must cap the wait for __mineradioCoreModulesReady and degrade open instead of polling forever');
  }
  // 点击进入不能只绑在 initSplashDomBindings() 里 —— 那个函数在模块后段，
  // 顶层一旦中断它就永不执行，用户点开屏完全没反应（实测如此）。
  if (!/closest\('#splash'\)/.test(splashCode)) fail('splash click must be bound at module top level via document delegation');
  if (/s\.addEventListener\('click', requestSplashEnter\)/.test(splashCode)) fail('splash click is still only bound inside initSplashDomBindings');
  // initSplashDomBindings 内部：先定起点 + 排计时器，再去碰可能抛错的初始化
  const initIdx = splashCode.indexOf('function initSplashDomBindings()');
  const shownIdx = initIdx < 0 ? -1 : splashCode.indexOf('splashShownAt = performance.now();', initIdx);
  const paintIdx = initIdx < 0 ? -1 : splashCode.indexOf('try { paintHomeLocalSnapshot(); }', initIdx);
  if (initIdx < 0 || shownIdx < 0 || paintIdx < 0) fail('initSplashDomBindings shape changed unexpectedly');
  else if (shownIdx > paintIdx) {
    fail('initSplashDomBindings must arm the min-duration timer before any fallible init (paintHomeLocalSnapshot can throw on a broken stage)');
  }

  // loader 侧保留「显示值爬到 100」的兜底，且 main-loop 不能被开屏挡住
  if (!/minFillMs \+ 400/.test(loaderText)) fail('index-loader lost its splash progress safety window');
  if (!/typeof window\.tryMarkSplashReadyFromBoot === 'function'/.test(loaderText)) fail('index-loader must hand off to tryMarkSplashReadyFromBoot after reaching 100%');
  console.log('[OK] renderer creation fails open, splash timing has no zero-start deadlock, and click-to-enter is bound at module top level.');
}

function checkMusicalProfileGuard() {
  logStep('Musical profile (chroma key/chroma) guard');
  const beatText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '03-beat', '01-audio-beat-analysis.js'), 'utf8');
  const runtimeText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '03-beat', '03-beat-map-runtime.js'), 'utf8');
  const prefetchText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '03-beat', '00-tempo-worker-cache-prefetch.js'), 'utf8');
  const plannerText = fs.readFileSync(path.join(appRoot, 'cuefield-next', 'recipe-planner.js'), 'utf8');
  const profileText = fs.readFileSync(path.join(appRoot, 'cuefield-next', 'musical-profile.js'), 'utf8');

  // 生产者
  if (!/async function analyzeMusicalProfile\(/.test(beatText)) fail('beat analysis must expose analyzeMusicalProfile');
  if (!/musicalProfile:\s*musicalProfile/.test(beatText)) fail('beat map must carry musicalProfile in its return value');
  if (!/musicalProfilePeakOnly/.test(beatText) || !/binWeight\[bin\]/.test(beatText)) {
    fail('chroma must keep per-pitch-class bin weighting and the spectral-peak mode (both were needed to get key fit above noise)');
  }
  if (!/musicalProfileCorrelation/.test(beatText)) {
    fail('key estimation must use correlation, not cosine: Krumhansl templates are all-positive, cosine scores white noise at 0.96');
  }

  // pack 是白名单 —— 少一行字段就会被静默丢掉，写盘后再也读不回来
  if (!/musicalProfile:\s*packMusicalProfile\(map\.musicalProfile\)/.test(runtimeText)) fail('packLocalBeatMap must include musicalProfile');
  if (!/musicalProfile:\s*stored\.musicalProfile \|\| null/.test(runtimeText)) fail('unpackLocalBeatMap must restore musicalProfile');
  if (!/function packMusicalProfile\(/.test(runtimeText)) fail('packMusicalProfile helper is missing');
  if (!/v:\s*2,/.test(runtimeText)) fail('beat map pack version must be 2 (v1 has no musicalProfile)');

  // 老缓存补算
  if (!/beatProfileBackfill/.test(prefetchText) || !/diskMap\.musicalProfile/.test(prefetchText)) {
    fail('prefetch must backfill musicalProfile for v1-era cache entries instead of trusting them forever');
  }

  // 消费者还在用它当门槛
  if (!/musicalEvidence/.test(plannerText) || !/compareMusicalProfiles/.test(plannerText)) {
    fail('cuefield recipe-planner must keep gating recipes on musicalEvidence');
  }
  if (!/function compareMusicalProfiles/.test(profileText) || !/function compareLocalMusicalWindows/.test(profileText)) {
    fail('cuefield-next/musical-profile.js lost its comparison functions');
  }
  console.log('[OK] Chroma-based musical profile is produced, packed (v2), backfilled, and consumed as cuefield harmonic evidence.');
}

function checkCuefieldAutoMixGuard() {
  logStep('Cuefield AutoMix integration guard');
  const serverText = fs.readFileSync(path.join(appRoot, 'server', 'routes', 'update.js'), 'utf8');
  const htmlText = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  const loaderText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'index-loader.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const syncText = fs.readFileSync(path.join(appRoot, 'scripts', 'sync-dist-app.js'), 'utf8');

  // 本仓库的 Cuefield 是「前端 5 模块 + 服务端双引擎（默认 v2、v1 兜底）」。
  // 上游那套 05-playback/16|17|18 与 cuefieldRunEqualPowerCrossfade 一行都不在，
  // 按上游路径断言只会 ENOENT —— 守卫必须盯着我们真实存在的东西。
  const MODULES = [
    '00-cuefield-automix-core.js',
    '01-cuefield-timeline-executor.js',
    '01a-cuefield-bridge-engine.js',
    '01b-cuefield-source-loop.js',
    '02-cuefield-automix-integration.js',
  ];
  const moduleDir = path.join(appRoot, 'public', 'js', 'modules', '05-cuefield');
  const texts = {};
  for (const name of MODULES) {
    const file = path.join(moduleDir, name);
    if (!fs.existsSync(file)) fail('Cuefield front-end module is missing: 05-cuefield/' + name);
    texts[name] = fs.readFileSync(file, 'utf8');
  }

  // 1) index.html 必须按依赖顺序逐个 script 载入（core → executor → bridge → loop → integration）
  let cursor = -1;
  for (const name of MODULES) {
    const at = htmlText.indexOf('05-cuefield/' + name);
    if (at < 0) fail('index.html does not load 05-cuefield/' + name);
    if (at < cursor) fail('index.html loads 05-cuefield modules out of order at ' + name);
    cursor = at;
  }
  if (/05-cuefield\//.test(loaderText)) fail('05-cuefield must not also be listed in index-loader.js (would be evaluated twice)');

  // 2) 服务端：v1 与 v2 两条引擎都要在；v2 失败必须可见地回落（engineFallback），不能静默
  for (const needle of [
    "pn === '/api/cuefield/transition'",
    "pn === '/api/cuefield/feedback'",
    'cuefield-next/mineradio-bridge',
    'planCuefieldTransitionFromCache',
    'engineFallback',
  ]) {
    if (!serverText.includes(needle)) fail('server/routes/update.js lost cuefield wiring: ' + needle);
  }
  if (!/get\('engine'\)[\s\S]{0,40}\|\|\s*'v2'/.test(serverText)) fail('cuefield transition endpoint must default to the v2 engine');

  // 3) 两个引擎目录都要在，且都要进打包与 dist 同步白名单
  for (const [dirName, minModules] of [['cuefield', 8], ['cuefield-next', 19]]) {
    const abs = path.join(appRoot, dirName);
    if (!fs.existsSync(abs)) fail('missing cuefield engine directory: ' + dirName + '/');
    const count = fs.readdirSync(abs).filter((f) => f.endsWith('.js')).length;
    if (count < minModules) fail(dirName + '/ must keep at least ' + minModules + ' modules, found ' + count);
    if (!packageJson.build.files.includes(dirName + '/**/*')) fail('package.json build.files must include ' + dirName + '/**/*');
    if (!syncText.includes("'" + dirName + "'")) fail('sync-dist-app.js must copy ' + dirName + '/ into dist');
  }

  // 4) 执行层必须认识 v2 的 11 种 op —— 只剩 play/crossfade 就等于「播到尾再淡出」
  const timelineText = texts['01-cuefield-timeline-executor.js'];
  for (const op of ['play', 'volume', 'filter', 'bass', 'duck', 'echo', 'bridge', 'loop', 'rate', 'spectrum', 'handoff']) {
    if (!new RegExp("op === '" + op + "'").test(timelineText)) fail('timeline executor lost op=' + op);
  }

  // 5) weak 档必须真的放开：v2 在真实歌曲上产出的通常就是 tier='weak'（实测 score=0.604），
  //    上游默认 allowWeak:false 会把它全部拒掉 → 用户听感等于没有 automix。
  const integrationText = texts['02-cuefield-automix-integration.js'];
  if (!/allowWeak:\s*true/.test(integrationText)) fail('automix must allow weak-tier plans: weak is the norm on real tracks, not an error');
  if (!/minWeakScore:\s*0?\.\d+/.test(integrationText)) fail('automix must pin an explicit minWeakScore next to allowWeak (0.58 default is too loose)');

  // 5b) 05-cuefield/* 源码保持原样，仍以 #quick-menu-automix-toggle 同步开关 UI。
  //     该按钮已从顶层收编进「歌曲过渡」面板底部，id 不变、功能仍可达；
  //     这里守的是「源码不许改回上游的 #cuefield-automix-btn」，
  //     以及存档恢复后仍会刷一次状态（无按钮的旧布局由 18 的 retireLegacyCuefieldSwitch 兜底）。
  if (!/getElementById\('quick-menu-automix-toggle'\)/.test(integrationText)) {
    fail('automix UI must target #quick-menu-automix-toggle; #cuefield-automix-btn does not exist in this repo');
  }
  if (!/quick-menu-automix-status/.test(integrationText)) fail('automix UI must refresh #quick-menu-automix-status text');
  if (!/syncCuefieldAutoMixUiOnReady/.test(integrationText) || !/DOMContentLoaded/.test(integrationText)) {
    fail('automix must re-sync its UI after DOM ready: the script loads in <head>, the toggle lives at the end of <body>');
  }

  // 6) 反馈仍必须本地，不能接远程
  if (/feedback-remote|CUEFIELD_FEEDBACK_REMOTE|https?:\/\/.*cuefield/i.test(serverText + integrationText)) {
    fail('cuefield feedback must remain local; no remote feedback service');
  }
  console.log('[OK] Cuefield AutoMix keeps 5 front-end modules over a dual-engine backend (default v2, visible v1 fallback).');
}

function checkOverlayTaskbarGuard() {
  logStep('Desktop overlay taskbar guard');
  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  const wallpaperText = fs.readFileSync(path.join(appRoot, 'desktop', 'wallpaper-mode-runtime.js'), 'utf8');
  const toolbarOption = "process.platform === 'win32' ? { type: 'toolbar' } : {}";
  const lyricsStart = mainText.indexOf('function createDesktopLyricsWindow');
  const lyricsEnd = mainText.indexOf('function closeDesktopLyricsWindow', lyricsStart);
  if (lyricsStart < 0 || lyricsEnd < 0) fail('desktop lyrics window creation block not found');
  const lyricsBlock = mainText.slice(lyricsStart, lyricsEnd);
  if (!/skipTaskbar: true/.test(lyricsBlock)) fail('desktop lyrics window lost skipTaskbar');
  if (lyricsBlock.indexOf(toolbarOption) < 0) {
    fail('desktop lyrics window needs type:toolbar on Windows, otherwise it creates a second taskbar thumbnail');
  }
  const wallStart = wallpaperText.indexOf('createWindow() {');
  const wallEnd = wallpaperText.indexOf('win.setIgnoreMouseEvents(true)', wallStart);
  if (wallStart < 0 || wallEnd < 0) fail('desktop wallpaper window creation block not found');
  const wallBlock = wallpaperText.slice(wallStart, wallEnd);
  if (!/skipTaskbar: true/.test(wallBlock)) fail('desktop wallpaper window lost skipTaskbar');
  if (wallBlock.indexOf(toolbarOption) < 0) {
    fail('desktop wallpaper window needs type:toolbar on Windows, otherwise it creates a second taskbar thumbnail');
  }
  const mainStart = mainText.indexOf('mainWindow = new BrowserWindow({');
  const mainBlock = mainText.slice(mainStart, mainStart + 900);
  if (mainStart < 0 || /type:\s*'toolbar'/.test(mainBlock)) {
    fail('the main player window must stay a normal taskbar window (type:toolbar belongs to overlays only)');
  }
  console.log('[OK] both desktop overlays use the Windows tool-window style while the main window stays on the taskbar.');
}

/* Folia 世界的层级契约：背景壳层（.folia-bg-host, z 0）在模式宿主（.folia-mode-host, z 1）
 * 下面，所以任何模式的画布都必须是透明的，否则用户选的背景永远透不出来。
 * 镜台曾经用 setClearColor(bg, 1) 铺满整块不透明画布 → 「换背景什么都没变」，
 * 而且壁纸效果层只把 alpha 0 当成特例，主窗口一直是 1，问题藏了很久。 */
function checkFoliaBackgroundLayerGuard() {
  logStep('Folia background layer guard');
  const foliaDir = path.join(appRoot, 'public', 'js', 'modules', '12-folia');
  const files = fs.readdirSync(foliaDir).filter((f) => f.endsWith('.js'));
  let sawRenderer = false;
  for (const file of files) {
    const text = fs.readFileSync(path.join(foliaDir, file), 'utf8');
    if (text.indexOf('new THREE.WebGLRenderer') < 0) continue;
    sawRenderer = true;
    const calls = text.match(/setClearColor\([^;]*?\);/g) || [];
    for (const call of calls) {
      if (!/,\s*0\);$/.test(call.replace(/\s+/g, ' ').trim())) {
        fail('folia mode ' + file + ' clears its WebGL canvas opaque (' + call.trim()
          + '), which hides the shared background layer underneath');
      }
    }
  }
  if (!sawRenderer) fail('expected at least one folia WebGL mode (diorama) to be found for the clear-alpha check');

  const css = fs.readFileSync(path.join(appRoot, 'public', 'css', '12-folia', 'folia-world.css'), 'utf8');
  const bgHost = css.indexOf('.folia-bg-host {');
  const modeHost = css.indexOf('.folia-mode-host {');
  if (bgHost < 0 || modeHost < 0) fail('folia background/mode host rules are gone');
  const zOf = (start) => {
    const block = css.slice(start, css.indexOf('}', start));
    const m = block.match(/z-index:\s*(-?\d+)/);
    return m ? Number(m[1]) : null;
  };
  if (zOf(bgHost) !== 0 || zOf(modeHost) !== 1) {
    fail('folia layering must stay .folia-bg-host(z 0) < .folia-mode-host(z 1)');
  }

  console.log('[OK] folia mode canvases stay transparent above the shared background layer.');
}

/* 流畅度回归守卫（2026-11-21 流畅度测试批次）
 * ① 启动导航超时后，页面已就绪就不得整页重载（否则打断正在播放的音频）；
 * ② 暂停不得拆掉整轨歌词（拆了恢复要重建 40+ 行，实测 149ms），只允许隐藏；
 * ③ 歌词 shader 常驻预热必须存在并被主循环调用。 */
/* 玻璃镜像必须包含静态背景图源：#custom-bg::before 的 --custom-bg-image。
 * 2026-11-22 复发：镜像合成只有底色+视频+WebGL，漏了用户设的静态壁纸图，
 * 玻璃折射出来是纯黑（镜像均色 [1.7,1.9,2.1]）。 */
function checkLiquidGlassBackdropImageGuard() {
  logStep('Liquid glass backdrop static image guard');
  const loopText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '11-main-loop.js'), 'utf8');
  if (!/function liquidGlassDrawCustomBgImage/.test(loopText)) {
    fail('LiquidGlass backdrop mirror has no static custom-background image source; glass refracts black when a still wallpaper is set');
  }
  const draw = loopText.slice(loopText.indexOf('function liquidGlassDrawCustomBgImage'));
  const drawEnd = draw.indexOf('\n}', draw.indexOf('ctx.globalAlpha = prevAlpha'));
  const drawBody = draw.slice(0, drawEnd);
  if (!/getPropertyValue\(['"]--custom-bg-image['"]\)/.test(drawBody) ||
      !/getPropertyValue\(['"]--custom-bg-image-opacity['"]\)/.test(drawBody) ||
      !/naturalWidth/.test(drawBody) || !/background|cover|Math\.max\(W \/ iw, H \/ ih\)/.test(drawBody)) {
    fail('custom-background image must be decoded, cover-fitted and alpha-blended to match the CSS backdrop');
  }
  if (!/wallpaper-engine-active/.test(drawBody)) {
    fail('custom-background image draw must skip when Wallpaper Engine owns the backdrop, otherwise it paints under WE as a stale layer');
  }
  const fn = loopText.indexOf('function updateLiquidGlassBackdropMirror');
  const fnEnd = loopText.indexOf('\n}', loopText.indexOf('_globalDirty = true', fn));
  const fnBody = loopText.slice(fn, fnEnd);
  const callAt = fnBody.indexOf('liquidGlassDrawCustomBgImage(');
  const weAt = fnBody.indexOf('weMirrorReady');
  if (callAt < 0 || weAt < 0 || callAt > weAt) {
    fail('custom-background image must be drawn into the mirror before the WE mirror/video branch so overlays composite in CSS order');
  }
  /* WE 静态壁纸图同样必须进镜像：11-13 只补了视频镜像，图片从未画进合成。 */
  if (!/wallpaper-engine-image/.test(fnBody) ||
      !/naturalWidth/.test(fnBody.slice(fnBody.indexOf('wallpaper-engine-image')))) {
    fail('LiquidGlass mirror must draw the WE static image (#wallpaper-engine-image); only the WE video mirror was wired in 2026-11-13');
  }
  const weImgAt = fnBody.indexOf('wallpaper-engine-image');
  if (weImgAt < weAt || weImgAt > fnBody.indexOf('liquidGlassBgVideoEl')) {
    fail('WE static image must composite after the WE video mirror but before the custom-bg video fallback');
  }
  if (!/wallpaper-engine-dwm-active/.test(fnBody.slice(Math.max(0, weImgAt - 600), weImgAt + 200))) {
    fail('WE static image draw must skip DWM co-existence mode where the layer is hidden and the desktop wallpaper shows through');
  }
  /* 图片必须 CORS 模式加载，否则 drawImage 污染镜像 canvas，玻璃回读拿到黑。 */
  const weFns = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '06-fx', '02-wallpaper-engine-fns.js'), 'utf8');
  const imgBlock = weFns.slice(weFns.indexOf('image.onload = function () { wallpaperEngineLayerReady'),
                               weFns.indexOf('image.src = wallpaperEngineMediaUrl'));
  if (!/image\.crossOrigin\s*=\s*['"]anonymous['"]/.test(imgBlock)) {
    fail('WE static image must set crossOrigin=anonymous before src, otherwise it taints the glass mirror canvas and glass refracts black');
  }
  console.log('[OK] liquid glass mirror composites both static custom background and WE image, cover-fitted and CORS-safe.');
}

/* 改缓存目录时带上界面设置（2026-11-22）
 * 换缓存根 = 换 Chromium profile = localStorage 全空（默认 profile 实测 111 个键，
 * 桌面歌词/经典预设歌词布局/音量/首页网格都在里面）。
 *
 * 跨 profile 复制 leveldb 实测无效（复制过去的 000003.log 与源字节一致、键名都在，
 * 但 Chromium 打开后只读到应用新建的键），所以必须走渲染进程 API。这条守卫钉住全链：
 *   ① 改目录前渲染进程导出 localStorage 快照（saveSettingsSnapshot）；
 *   ② 主进程把快照落盘，并支持页面回调 consume 删除；
 *   ③ 服务端返回 index.html 时注入 __MINERADIO_SETTINGS_SNAPSHOT__；
 *   ④ index.html 的 head 内联脚本在任何模块之前写回 localStorage。 */
function checkCacheSettingsSnapshotGuard() {
  logStep('Cache settings snapshot guard');
  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  const preloadText = fs.readFileSync(path.join(appRoot, 'desktop', 'preload.js'), 'utf8');
  const serverText = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');
  const indexText = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  const uiText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '07-fx', '08-cache-storage-settings.js'), 'utf8');

  if (!/function writeSettingsSnapshot\(/.test(mainText)) fail('main process cannot persist a settings snapshot: changing the cache dir drops every localStorage setting');
  if (!/function consumeSettingsSnapshot\(/.test(mainText)) fail('main process cannot delete the one-shot settings snapshot');
  if (!/mineradio-cache-save-settings-snapshot/.test(mainText)) fail('missing IPC that receives the settings snapshot from the renderer');
  if (!/mineradio-cache-consume-settings-snapshot/.test(mainText)) fail('missing IPC that consumes the settings snapshot after it was applied');
  if (!/MINERADIO_SETTINGS_SNAPSHOT_FILE/.test(mainText)) fail('main process does not tell the server where the snapshot lives');
  /* 登录 cookie 用 safeStorage 加密，OS 密钥在 profile 的 Local State 里；
   * 只搬 localStorage 不搬 Local State，换目录后旧 cookie 全部解不开（登录全没）。 */
  if (!/function snapshotProfileLocalState\(/.test(mainText)) fail('main process does not snapshot the profile Local State: changing the cache dir would make every stored login cookie undecryptable');
  if (!/function applyProfileLocalStateSnapshot\(/.test(mainText)) fail('main process never restores the profile Local State into the new cache profile');
  if (!/snapshotProfileLocalState\(prev\)/.test(mainText)) fail('setCacheSettings must snapshot the Local State before switching the cache root');
  const lsApplyAt = mainText.indexOf('applyProfileLocalStateSnapshot(cacheSettings)');
  const lsSetPathAt = mainText.indexOf("app.setPath('cache', cacheSettings.chromiumPath)");
  if (lsApplyAt < 0) fail('startup does not restore the Local State snapshot');
  if (lsSetPathAt > 0 && lsApplyAt > lsSetPathAt) fail('Local State must be restored before app.setPath("cache"), otherwise Chromium already opened the profile with a fresh key');

  if (!/^\s*saveSettingsSnapshot:/m.test(preloadText)) fail('preload does not expose saveSettingsSnapshot');
  if (!/^\s*consumeSettingsSnapshot:/m.test(preloadText)) fail('preload does not expose consumeSettingsSnapshot');

  if (!/__MINERADIO_SETTINGS_SNAPSHOT__/.test(serverText)) fail('server does not inject the settings snapshot into index.html');

  const restoreAt = indexText.indexOf('__MINERADIO_SETTINGS_SNAPSHOT__');
  if (restoreAt < 0) fail('index.html never writes the snapshot back into localStorage');
  const firstModuleTag = indexText.indexOf('<script src="js/modules/');
  if (firstModuleTag > 0 && restoreAt > firstModuleTag) {
    fail('index.html must restore the snapshot before any js/modules script runs, otherwise modules already read the defaults');
  }
  if (!/localStorage\.setItem\(k,/.test(indexText)) fail('index.html restore script does not call localStorage.setItem');

  /* 必须真的「先导出再改目录」：只看 typeof 检测会被绕过，必须匹配调用形式。 */
  const exportCallAt = uiText.search(/desktopWindow\.saveSettingsSnapshot\(\{ values:/);
  const setCallAt = uiText.search(/setCacheSettings\(\{ rootPath: res\.path \}\)/);
  if (exportCallAt < 0) fail('cache settings UI never calls saveSettingsSnapshot with the localStorage values');
  if (setCallAt < 0) fail('cache settings UI lost its setCacheSettings call');
  if (exportCallAt > setCallAt) {
    fail('cache settings UI must export the snapshot BEFORE calling setCacheSettings, otherwise the old profile is already gone');
  }
  if (!/return saving\.then\(function\(\) \{[\s\S]{0,200}setCacheSettings\(/.test(uiText)) {
    fail('cache settings UI must await the snapshot export before switching the cache root');
  }
  console.log('[OK] Changing the cache dir carries the UI settings across (snapshot → server inject → head restore, no leveldb copying).');
}

function checkSmoothnessRegressionGuard() {
  logStep('Smoothness regression guard (startup navigation + lyric pause + shader warmup)');
  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  const guardStart = mainText.indexOf('async function mainPageUsableAfterNavigation(');
  if (guardStart < 0) fail('mainPageUsableAfterNavigation is missing: a navigation timeout will reload a page that is already playing');
  const guardBody = mainText.slice(guardStart, guardStart + 1800);
  if (!/return probe\.ready === true;/.test(guardBody)) fail('startup usability check must only trust __mineradioCoreModulesReady');
  if (/probe\.shell/.test(guardBody)) fail('startup usability check must not trust the static .desktop-shell class (an empty shell page would be accepted)');
  const usableAt = mainText.indexOf("writeStartupState('navigation-timeout-but-usable'");
  const retryAt = mainText.indexOf("writeStartupState('navigation-retry'");
  if (usableAt < 0) fail('navigation-timeout-but-usable state is not recorded');
  if (retryAt < 0 || usableAt > retryAt) fail('usability check must run before navigation-retry/stop()');
  /* 重试前回填启动页必须 await：loadFile 是异步导航，不 await 会和下一次 loadURL
   * 抢同一个 webContents —— 第二次导航被取消，报 ERR_FAILED (-2)，错误框里只剩这个
   * 二次症状（实测 2026-11-22，MR-BOOT-WINDOW-LOAD）。 */
  const retryBody = mainText.slice(retryAt, retryAt + 1600);
  if (!/await withStartupTimeout\(\s*win\.loadFile\(/.test(retryBody)) {
    fail('startup placeholder loadFile must be awaited before retrying navigation, otherwise it cancels the retry (ERR_FAILED -2)');
  }
  if (!/attemptErrors\.push/.test(mainText)) {
    fail('navigation retry must keep every attempt\'s failure reason; keeping only the last one hides the real cause (e.g. attempt 1 timeout behind attempt 2 ERR_FAILED)');
  }

  const lyricText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '14-stage-lyrics-rendering.js'), 'utf8');
  if (!/var _genuinePause = !!\(audio && audio\.paused && !audio\.ended && lyricsLines\.length\)/.test(lyricText)) {
    fail('pause hide must be gated on audio.paused && !audio.ended (not the outer !playing): a track switch briefly flips playing and would hide a visible track');
  }
  if (!/if \(_genuinePause && _pauseTrack && _pauseTrackData && _pauseTrackData\.trackPersistent\)/.test(lyricText)) {
    fail('pause must hide a persistent lyric track instead of tearing it down');
  }
  if (!/stageLyrics\.currentIdx !== -1/.test(lyricText)) {
    fail('pause hide must skip a freshly committed track (currentIdx === -1): hiding it makes "switch-while-paused" show a blank lyric');
  }
  if (!/stageLyrics\.pauseHiddenTrack = true;/.test(lyricText)) fail('pause-hidden track flag is not set');
  if (!/if \(stageLyrics\.pauseHiddenTrack\) \{[\s\S]{0,160}visible = true/.test(lyricText)) {
    fail('resume must restore the hidden lyric track visibility');
  }
  /* 切歌交接必须清暂停隐藏标志，否则标志跨轨泄漏。 */
  const handoffAt = lyricText.indexOf('function handoffStageLyricsForNewTrack(');
  if (handoffAt < 0) fail('handoffStageLyricsForNewTrack is missing');
  const clearAt = lyricText.indexOf('function clearStageLyrics()');
  const handoffBody = lyricText.slice(handoffAt, clearAt > handoffAt ? clearAt : handoffAt + 1200);
  if (!/stageLyrics\.pauseHiddenTrack = false;/.test(handoffBody)) {
    fail('track handoff must clear pauseHiddenTrack, otherwise the flag leaks across tracks');
  }
  const stateText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '03a-lyrics-state.js'), 'utf8');
  if (!/pauseHiddenTrack:\s*false/.test(stateText)) fail('stageLyrics.pauseHiddenTrack default is missing');

  const loopText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '11-main-loop.js'), 'utf8');
  if (!/ensureLyricShaderWarmup\(\)/.test(loopText)) fail('main loop does not warm lyric shaders (programs will recompile after track disposal)');
  const shaderText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '11-lyrics-shaders.js'), 'utf8');
  if (!/function ensureLyricShaderWarmup\(\)/.test(shaderText)) fail('ensureLyricShaderWarmup is missing');

  /* 同步整段建行必须有预算：整首歌 60 行遮罩画布挤一帧时实测 103–273ms。 */
  const rowLayersText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'modules', '02-visual', '12-lyrics-row-layers.js'), 'utf8');
  const makeGroupAt = rowLayersText.indexOf('function makeLyricRowLayerGroup(');
  if (makeGroupAt < 0) fail('makeLyricRowLayerGroup is missing');
  const makeGroupBody = rowLayersText.slice(makeGroupAt, makeGroupAt + 2200);
  if (/stepLyricRowLayerGroupBuild\(state, 1024, Infinity\)/.test(makeGroupBody)) {
    fail('makeLyricRowLayerGroup must not drain all phases with an Infinity budget: it builds ~60 mask canvases in one frame (103–273ms)');
  }
  if (!/stepLyricRowLayerGroupBuild\(state, 1024, \d+\)/.test(makeGroupBody)) {
    fail('makeLyricRowLayerGroup must pass a finite per-frame budget so the visible rows land this frame and the rest are filled in later');
  }
  console.log('[OK] Startup timeout keeps a usable page, pause hides instead of disposing the lyric track, lyric shaders stay warm, sync row builds are budgeted.');
}


/* 缓存目录配置必须落在稳定 userData：Electron 的 setPath('cache', X) 会把
 * appData/userData 篡改成 X/<APP_NAME>（Windows 实测），若 cache-settings.json
 * 仍从 app.getPath('userData') 读写，「更改目录」会写进 Chromium 缓存目录、
 * 重启后弹回默认。 */
function checkCacheSettingsStablePathGuard() {
  logStep('Cache settings stable path guard');
  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  const fnStart = mainText.indexOf('function cacheSettingsConfigPath()');
  const fnEnd = mainText.indexOf('}', fnStart);
  if (fnStart < 0 || fnEnd < 0) fail('cacheSettingsConfigPath() not found');
  const fnBody = mainText.slice(fnStart, fnEnd);
  /* 只看 return 语句本身（函数体里的注释会提到 getPath('userData')，不参与判定）。 */
  const returnMatch = fnBody.match(/return[^;]*;/);
  if (!returnMatch || /app\.getPath\(.userData.\)/.test(returnMatch[0])) {
    fail("cacheSettingsConfigPath() must not resolve via app.getPath('userData') - it is corrupted after setPath('cache') and the setting silently reverts on restart");
  }
  if (fnBody.indexOf('_STABLE_USER_DATA') < 0) {
    fail("cacheSettingsConfigPath() must resolve against _STABLE_USER_DATA captured before setPath('cache')");
  }
  const decl = mainText.indexOf('const _STABLE_USER_DATA');
  const setPath = mainText.indexOf("app.setPath('cache'");
  if (decl < 0 || setPath < 0 || decl > setPath) {
    fail("_STABLE_USER_DATA must be captured before app.setPath('cache') runs");
  }
  if (mainText.indexOf('legacy') < 0 || mainText.indexOf('migrated legacy cache-settings') < 0) {
    fail('readCacheSettings() must migrate the pre-fix cache-settings.json written into the corrupted userData');
  }
  /* 改目录必须迁移有价值的缓存（beatmaps/lyrics），且不迁移 Chromium 缓存。 */
  if (mainText.indexOf('async function migrateCacheDirectory') < 0) {
    fail('changing the cache directory must migrate the valuable cache (beatmaps/lyrics) instead of silently orphaning the old files');
  }
  const migrateFn = mainText.slice(mainText.indexOf('async function migrateCacheDirectory'), mainText.indexOf('function ensureCacheDirectories'));
  if (migrateFn.indexOf('beatmapsPath') < 0 || migrateFn.indexOf('lyricsPath') < 0) {
    fail('cache migration must cover beatmaps and lyrics');
  }
  if (migrateFn.indexOf('chromiumPath') >= 0) {
    fail('cache migration must NOT copy the Chromium cache (it is disposable and would drag 200MB+ of junk along)');
  }
  if (migrateFn.indexOf('COPYFILE_EXCL') < 0) {
    fail('cache migration must skip files that already exist in the target (COPYFILE_EXCL)');
  }
  const setSettingsHandler = mainText.slice(mainText.indexOf('mineradio-cache-set-settings'), mainText.indexOf('mineradio-hotkeys-configure-global'));
  if (setSettingsHandler.indexOf('migrateCacheDirectory(') < 0) {
    fail('set-settings must invoke migrateCacheDirectory when the root path changes');
  }
  console.log('[OK] cache-settings.json persists in the stable userData, with legacy migration and valuable-cache migration in place.');
}

/* 悬浮小组件宿主契约（Enhanced Remote Widget，MIT）。
 * 三层结构：页面桥接 → 主进程宿主 → widget 窗口（前端零改动，只认 window.foliaWidget）。
 * 任何一层被拆掉都表现为「点开关没反应」或「窗口空白」，静态守卫在这里钉死。 */
function checkFloatingWidgetHostGuard() {
  logStep('Floating widget host guard');
  const widgetDir = path.join(appRoot, 'desktop', 'floating-widget');
  for (const file of ['widget.html', 'widget-preload.cjs', 'window-layouts.cjs', 'widget-visibility.cjs', 'widget-player.mjs']) {
    if (!fs.existsSync(path.join(widgetDir, file))) {
      fail('floating widget asset missing: desktop/floating-widget/' + file);
    }
  }
  /* widget.html 必须仍用官方 preload：换成别的 preload 会让 window.foliaWidget 消失，整窗白屏。 */
  const widgetHtml = fs.readFileSync(path.join(widgetDir, 'widget.html'), 'utf8');
  if (!/mineradio-local:/.test(widgetHtml)) {
    fail('widget.html CSP must allow the app-local cover protocol, otherwise local-library covers render blank');
  }

  const hostText = fs.readFileSync(path.join(appRoot, 'desktop', 'floating-widget.js'), 'utf8');
  for (const fn of ['initFloatingWidget', 'toggleFloatingWidget', 'disposeFloatingWidget']) {
    if (!new RegExp('function ' + fn + '\\(').test(hostText)) {
      fail('floating widget host is missing ' + fn + '()');
    }
  }
  if (hostText.indexOf("preload: path.join(WIDGET_DIR, 'widget-preload.cjs')") < 0) {
    fail('floating widget window must load widget-preload.cjs (window.foliaWidget is the only host contract)');
  }
  /* 布局存储必须落稳定 userData：setPath('cache') 会篡改 userData。 */
  if (!/stableUserDataDir/.test(hostText)) {
    fail('floating widget layout store must resolve against the stable userData captured before setPath(cache)');
  }
  /* 操作必须校验 sender 再转发，否则任意窗口都能控制播放。 */
  if (!/function isWidgetSender/.test(hostText) || hostText.indexOf('isWidgetSender(event)') < 0) {
    fail('floating widget IPC must verify the sender window before accepting actions');
  }

  const mainText = fs.readFileSync(path.join(appRoot, 'desktop', 'main.js'), 'utf8');
  if (!/require\('\.\/floating-widget'\)/.test(mainText)) {
    fail('desktop/main.js does not require the floating widget host');
  }
  if (mainText.indexOf('floatingWidget.initFloatingWidget(') < 0) {
    fail('desktop/main.js never initializes the floating widget host (the FX toggle would silently do nothing)');
  }
  if (mainText.indexOf('floatingWidget.disposeFloatingWidget()') < 0) {
    fail('shutdown must dispose the floating widget host, otherwise its windows outlive the app');
  }

  const preloadText = fs.readFileSync(path.join(appRoot, 'desktop', 'preload.js'), 'utf8');
  for (const channel of [
    'mineradio-floating-widget-status',
    'mineradio-floating-widget-toggle',
    'mineradio-floating-widget-sync',
  ]) {
    if (preloadText.indexOf(channel) < 0) fail('desktop/preload.js is missing the ' + channel + ' bridge');
  }

  const bridgeRel = 'js/modules/10-shell/30-floating-widget-bridge.js';
  const bridgeText = fs.readFileSync(path.join(appRoot, 'public', bridgeRel), 'utf8');
  const loaderText = fs.readFileSync(path.join(appRoot, 'public', 'js', 'index-loader.js'), 'utf8');
  if (loaderText.indexOf(bridgeRel) < 0) {
    fail('the floating widget bridge module is not registered in index-loader (dead file, no effect)');
  }
  /* payload 字段必须与原版 client.mjs 的 pushCurrentState 对齐，否则小组件显示空信息。 */
  for (const field of ['songKey', 'title', 'artist', 'album', 'coverUrl', 'position', 'duration',
                       'state', 'lyricPosition', 'lyricRate', 'liked', 'canLike', 'currentLyric']) {
    if (!new RegExp('\\b' + field + ':').test(bridgeText)) {
      fail('floating widget payload is missing the ' + field + ' field expected by widget-player.mjs');
    }
  }
  /* 歌词行必须转成小组件的 startTime/fullText 形状，并带原始 words 的逐词时间。 */
  if (!/startTime: start/.test(bridgeText) || !/fullText:/.test(bridgeText)) {
    fail('floating widget lyrics must be normalized to { startTime, endTime, fullText }');
  }
  /* 歌词异步晚到：必须有签名兜住，否则切歌后小组件一直显示上一首歌词。 */
  if (!/floatingWidgetBridgeLyricSignature/.test(bridgeText)) {
    fail('floating widget bridge must detect late-arriving lyrics (signature) and re-push the full set');
  }
  /* 入口：2026-11-23 起从视觉控制台的 #t-floatingWidget 换成三条杠菜单的快捷格
   * （视觉控制台里那份与快捷格重复，已按用户要求删除）。仍然要求必须有入口接线。 */
  const htmlText = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
  if (htmlText.indexOf('id="qm-shortcut-floating"') < 0 || htmlText.indexOf('toggleFloatingWidgetPanel(') < 0) {
    fail('三条杠菜单需要有「小组件」快捷格并接线到 toggleFloatingWidgetPanel()');
  }
  console.log('[OK] floating widget host: assets, preload contract, IPC sender check, payload fields, loader entry and menu shortcut are all intact.');
}

/* 悬浮小组件的液态玻璃主题（mode-liquid）：透明窗口 + CSS 玻璃语言。
 * 关键判据来自实测：小组件是 transparent 窗口，背后桌面像素 DOM/canvas 读不到；
 * 唯一可行的折射源 desktopCapturer 在 Windows 上反复挂起（帧率 13→0 波动），
 * 不能作为稳定背景。所以这个主题的契约是「窗口真透明 + 无框」：
 * 桌面由 OS 合成透出，玻璃质感靠封面描边/半透明控件/文字阴影表达。 */
/* 悬浮小组件的液态玻璃主题（mode-liquid）：透明窗口 + CSS 玻璃语言。
 * 判据来自实测：小组件是 transparent 窗口，背后桌面像素 DOM/canvas 读不到；
 * 唯一可行的折射源 desktopCapturer 在 Windows 上反复挂起（抓帧 13→0 波动），
 * 不能作为稳定背景。所以这个主题的契约是「窗口真透明 + 无框」：
 * 桌面由 OS 合成直接透出，玻璃质感靠封面描边 / 半透明控件 / 文字阴影表达。 */
function checkFloatingWidgetLiquidThemeGuard() {
  logStep('Floating widget liquid theme guard');
  const dir = path.join(appRoot, 'desktop', 'floating-widget');
  const css = fs.readFileSync(path.join(dir, 'widget.css'), 'utf8');
  const start = css.indexOf('.widget-card.mode-liquid {');
  if (start < 0) fail('widget.css is missing the mode-liquid theme rules');
  const block = css.slice(start, css.indexOf('}', start));
  /* 玻璃面契约（2026-11-23 定稿）：桌面要透出来，但不能是「什么都没有」——
   * 必须有一层低 alpha 的白色渐变面 + 顶部内高光 + 落影，且仍然没有硬边框。
   * 完全透明会让用户觉得「玻璃被删掉了」；不透明的板子又挡住桌面。 */
  if (!/linear-gradient\([^)]*rgba\(255, 255, 255/.test(block)) {
    fail('mode-liquid needs a translucent white gradient pane, otherwise it reads as either a plain hole or an opaque board');
  }
  if (block.indexOf('border: none !important') < 0) {
    fail('mode-liquid must have no hard border: the user explicitly removed the frame');
  }
  if (!/inset 0 1px 0 rgba\(255, 255, 255/.test(block)) {
    fail('mode-liquid needs an inset top highlight to read as glass rather than a flat tint');
  }
  if (!/0 1\dpx 3\dpx rgba\(0, 0, 0/.test(block)) {
    fail('mode-liquid needs an outer drop shadow so the glass separates from the wallpaper');
  }
  if (block.indexOf('backdrop-filter') < 0) {
    fail('mode-liquid should still request backdrop-filter (harmless where unsupported, better where it works)');
  }  /* 文字可读性兜底：桌面背后什么都有可能 */
  if (!/text-shadow:[^;]*rgba\(0, 0, 0/.test(css)) {
    fail('mode-liquid text needs a shadow fallback, otherwise white lyrics vanish on a bright wallpaper');
  }
  /* 封面是唯一的实体面：必须有圆角与内描边，否则和桌面糊在一起 */
  if (!/\.widget-card\.mode-liquid \.cover \{[\s\S]{0,400}inset 0 0 0 1px/.test(css)) {
    fail('mode-liquid cover needs an inset hairline so the artwork reads as a pane of glass on the desktop');
  }
  /* 不再依赖 WebGL 折射：player 里不能有任何 liquid 运行时接线。
   * （文件本身可能被并行会话恢复，所以判据放在「谁在用它」上，而不是文件存在与否。） */
  const player = fs.readFileSync(path.join(dir, 'widget-player.mjs'), 'utf8');
  if (player.indexOf('createLiquidTheme') >= 0 || player.indexOf('liquidTheme') >= 0) {
    fail('widget-player must not wire the WebGL liquid theme: it cannot refract the desktop and its backdrop capture hangs');
  }
  if (player.indexOf('widget-desktop-backdrop') >= 0) {
    fail('widget-player must not listen for desktop backdrop frames; that path is unreliable on Windows and was removed');
  }
  const host = fs.readFileSync(path.join(appRoot, 'desktop', 'floating-widget.js'), 'utf8');
  if (host.indexOf('desktopCapturer') >= 0 || host.indexOf('startDesktopCapture') >= 0) {
    fail('floating widget must not capture the desktop: getSources hangs intermittently on Windows and frames never reach the glass reliably');
  }
  const stateText = fs.readFileSync(path.join(dir, 'widget-state.mjs'), 'utf8');
  if (stateText.indexOf("cls: 'mode-liquid'") < 0) fail('MODES must expose the mode-liquid theme');
  const html = fs.readFileSync(path.join(dir, 'widget.html'), 'utf8');
  if (html.indexOf('data-mode="6"') < 0) fail('settings theme picker has no 7th option for 液态玻璃');
  console.log('[OK] liquid theme: transparent frameless card, hairline cover, text shadow fallback; no unreliable desktop capture.');
}

module.exports = {
  checkMainWindowChrome, checkProgressSeekDragGuard, checkLyricBackfaceMaterialGuard, checkQQVipStatusSyncGuard, checkKugouCloudlistIdentityGuard, checkVolumeWheelStepGuard, checkLoginProviderTabGuard, checkUserModalTabGuard, checkPlatformPanelStyleGuard, checkCoverFallbackGuard, checkPlaylistCoverMarkGuard, checkPlatformPanelPlaybackGuard, checkVisualGuideGuard, checkDesktopLyricsMotionGuard, checkSplashBootGuard, checkMusicalProfileGuard, checkCuefieldAutoMixGuard, checkOverlayTaskbarGuard, checkFoliaBackgroundLayerGuard, checkLiquidGlassBackdropImageGuard, checkCacheSettingsSnapshotGuard, checkSmoothnessRegressionGuard, checkCacheSettingsStablePathGuard, checkFloatingWidgetHostGuard, checkFloatingWidgetLiquidThemeGuard
};
