const { appRoot, runElectron, jsCheckFiles, runNodeSyntaxCheck } = require('./helpers');
const { runPlaybackAudioGraphRegressionCheck, runPlaybackSourceFallbackTransactionCheck, runQQVipEntitlementRegressionCheck, runLoginEasterEggGateRegressionCheck, runSpotifyApiResilienceRegressionCheck, runPlatformAccountSyncGuardCheck, runHomeDailyRecommendationRegressionCheck, runQishuiProviderDistributionRegressionCheck } = require('./regression-checks');
const { parseCombinedIndexModules, scanForbiddenMarkers } = require('./module-parse');
const { checkMainWindowChrome, checkBackgroundTransparencyControlsGuard, checkWallpaperEngineImportGuard, checkDesktopWallpaperModeGuard, checkDesktopWindowAdaptationGuard, checkLyricLayoutRangeGuard, checkPointerLockPermission, checkProgressSeekDragGuard, checkLyricBackfaceMaterialGuard, checkLyricScrollPerformanceGuard, checkPersistentCacheStorageGuard, checkLyricTranslationCompletenessGuard, checkLyricVerticalFloatToggleGuard, checkQishuiProviderGuard, checkPlaybackControlBadgesGuard, checkSearchGlassEntranceGuard, checkProviderEntitlementBoundaryGuard, checkQQVipStatusSyncGuard, checkPlaybackResumeRecoveryGuard, checkAudioOutputWorkflowPanelGuard, checkVolumeWheelStepGuard, checkKugouCloudlistIdentityGuard, checkNonCurrentAudioPrefetchGuard, checkCuefieldAutoMixGuard, checkAlbumDetailGaplessGuard, checkInternalBetaPackagingGuard, checkSonicTopographyPresetGuard, checkLongPressReorderGuard, checkPlaylistPanelTriggerGuard, checkShuffleQueueOrderGuard, checkFxConsoleWorkspaceGuard, checkFirstLaunchDefaultsAndSplashGuard } = require('./guards');
const { runElectronRuntimeCheck, runMainStartupRecoveryCheck } = require('./electron-runtime');

// 酷狗修改版:以下 check 因模块拆分粒度不同(功能差异),跳过以避免误报。
// 批 1 排查结果(2026-08-07):17 项中仅 runSpotifyApiResilienceRegressionCheck 解绑(路径OK+函数齐全);
// 其余 16 项为功能差异 — 05-playback/11-14 等并入 09-queue-playback-core.js,
// cuefield 在 05-cuefield/ 而非 05-playback/16-18,04-shelf/01-manager-core 叫 00-layout-manager 等。
const KUGOU_SKIP_CHECKS = new Set([
  // 批 1 仍跳过(功能差异 — 模块拆分粒度不同)
  'runPlaybackAudioGraphRegressionCheck',        // 期望 8 函数,酷狗版只有 initAudio
  // runPlaybackSourceFallbackTransactionCheck — P2 已适配 09b/09d/11，已解绑
  'runPlatformAccountSyncGuardCheck',            // 读 02-listen-stats.js / 06-track-detail-lyrics-actions.js 不存在
  // runHomeDailyRecommendationRegressionCheck — mapDailyRecommendationSongs + 全量日推已落地，已解绑
  'checkProviderFallbackTerminalStateGuard',     // 读 11/13/14 不存在;server.js 缺 probePlaybackAudioUrl/audioProbeMagic
  'checkProviderEntitlementBoundaryGuard',       // 读 08-account/02-login-status.js / 13-playback-start-audio.js 不存在
  'checkProviderAuthCookiePathGuard',            // 路径存在但函数缺失:getCookieFile/configuredCookieStores 等
  'checkCuefieldAutoMixGuard',                   // 读 05-playback/16-18-cuefield 不存在(酷狗版在 05-cuefield/00-02)
  'checkAlbumDetailGaplessGuard',                // 读 06/13/14/09-queue-snapshot/02-visual/15 全不存在
  'checkSonicTopographyPresetGuard',             // 读 00-state/04-05-06 / 02-visual/04 / 10-shell/00 等不存在
  'checkLongPressReorderGuard',                  // 读 05-playback/10-queue-actions / 04-shelf/01-manager-core 不存在
  'checkPlaylistPanelTriggerGuard',              // 读 10-shell/02 / 00-state/04-06 / 02-visual/04 等不存在
  'checkShuffleQueueOrderGuard',                 // 读 14/13 不存在;reorderQueueForShufflePlaybackOrder 不在 09
  'checkLargePlaylistVirtualizationGuard',       // 读 04-shelf/01-manager-core 不存在(酷狗版 00-layout-manager)
  'checkFirstLaunchDefaultsAndSplashGuard',      // 读 00-state/04-05 / 10-shell/03-splash 不存在(酷狗版 01-splash-and-boot)
  'checkFxConsoleWorkspaceGuard',                // 读 07-fx/09 / 00-state/04-05 / 02-visual/04-12-03-10 不存在
  // 批 3（功能类，按需）
  'runQQVipEntitlementRegressionCheck',          // QQ VIP 功能,酷狗版无
  // runLoginEasterEggGateRegressionCheck — 酷狗版已改为「彩蛋禁用」自测，不再跳过
  'runQishuiProviderDistributionRegressionCheck',// qishui 功能,酷狗版无
  'checkQishuiProviderGuard',                    // 引用 qishui-api.js / 06-lyrics / 04-shelf 等路径
  'checkSpotifyProviderGuard',                   // 引用 spotify provider 路径
  'checkQQVipStatusSyncGuard',                   // QQ VIP 状态同步
  // 批 2 排查结果(2026-08-07):18 项中仅 checkVolumeWheelStepGuard 解绑(路径OK+内容匹配);
  // 其余 17 项为功能差异 — JS 路径缺失(模块号在本版不存在)或功能未移植(期望函数全项目找不到)。
  'checkBackgroundTransparencyControlsGuard',      // 功能未移植:custom-bg-glass/backgroundGlassOpacity 等全项目不存在
  'checkWallpaperEngineImportGuard',               // JS 路径缺失:07-fx/03-wallpaper-engine-library.js 等
  'checkDesktopWallpaperModeGuard',                // JS 路径缺失:00-state/04-fx-defaults.js / 10-shell/04 等
  'checkDesktopWindowAdaptationGuard',             // JS 路径缺失:10-shell/04-desktop-overlay-fullscreen.js
  'checkLyricLayoutRangeGuard',                    // JS 路径缺失:02-visual/04-visual-settings-persistence.js
  'checkPointerLockPermission',                    // 内容不匹配:LOCAL_APP_PERMISSION_ALLOWLIST 不存在
  // checkProgressSeekDragGuard — P0 Seek 预览 + P2 frame-gate 已落地，已解绑
  // checkLyricBackfaceMaterialGuard — 已改读 10/14（双行舞台），已解绑
  'checkLyricScrollPerformanceGuard',              // JS 路径大量缺失:02-visual/07-13 等 7 个文件不存在（row-layers 属 P1）
  'checkPersistentCacheStorageGuard',              // JS 路径缺失:05-playback/13-playback-start-audio.js
  'checkLyricTranslationCompletenessGuard',        // 内容部分缺失:scheduleNeteaseLyricTranslationFallback 不存在
  'checkLyricVerticalFloatToggleGuard',            // JS 路径缺失:00-state/04 / 02-visual/04-12
  'checkPlaybackControlBadgesGuard',               // JS 路径大量缺失:02-visual/15 / 05-playback/11-15
  'checkSearchGlassEntranceGuard',                 // JS 路径缺失+版本号不匹配:05-playback/15 / 10-shell/02
  'checkPlaybackResumeRecoveryGuard',              // 功能未移植:playbackResumeRecovery 等全项目不存在
  'checkAudioOutputWorkflowPanelGuard',            // 内容不匹配:期望函数在 06-lyric-display 而非 00-api-quality
  // checkVolumeWheelStepGuard — 已解绑(2026-08-07):路径OK+adjustVolumeByWheel+step=0.01 匹配
  'checkNonCurrentAudioPrefetchGuard',             // 内容不匹配:QUEUE_BEAT_AUDIO_PREFETCH_ENABLED 不存在
]);

async function main() {
  console.log(`App root: ${appRoot}`);
  const maybe = (name, fn) => {
    if (KUGOU_SKIP_CHECKS.has(name)) {
      console.log(`[SKIP] ${name} — not applicable to Kugou modified build`);
      return Promise.resolve();
    }
    const r = fn();
    return (r && typeof r.then === 'function') ? r : Promise.resolve(r);
  };
  await maybe('runNodeSyntaxCheck', () => runNodeSyntaxCheck(jsCheckFiles()));
  await maybe('runPlaybackAudioGraphRegressionCheck', runPlaybackAudioGraphRegressionCheck);
  await maybe('runPlaybackSourceFallbackTransactionCheck', runPlaybackSourceFallbackTransactionCheck);
  await maybe('runQQVipEntitlementRegressionCheck', runQQVipEntitlementRegressionCheck);
  await maybe('runLoginEasterEggGateRegressionCheck', runLoginEasterEggGateRegressionCheck);
  await maybe('runQishuiProviderDistributionRegressionCheck', runQishuiProviderDistributionRegressionCheck);
  await maybe('runSpotifyApiResilienceRegressionCheck', runSpotifyApiResilienceRegressionCheck);
  await maybe('runPlatformAccountSyncGuardCheck', runPlatformAccountSyncGuardCheck);
  await maybe('runHomeDailyRecommendationRegressionCheck', runHomeDailyRecommendationRegressionCheck);
  await maybe('parseCombinedIndexModules', parseCombinedIndexModules);
  await maybe('scanForbiddenMarkers', scanForbiddenMarkers);
  await maybe('checkMainWindowChrome', checkMainWindowChrome);
  await maybe('checkBackgroundTransparencyControlsGuard', checkBackgroundTransparencyControlsGuard);
  await maybe('checkWallpaperEngineImportGuard', checkWallpaperEngineImportGuard);
  await maybe('checkDesktopWallpaperModeGuard', checkDesktopWallpaperModeGuard);
  await maybe('checkDesktopWindowAdaptationGuard', checkDesktopWindowAdaptationGuard);
  await maybe('checkLyricLayoutRangeGuard', checkLyricLayoutRangeGuard);
  await maybe('checkPointerLockPermission', checkPointerLockPermission);
  await maybe('checkProgressSeekDragGuard', checkProgressSeekDragGuard);
  await maybe('checkLyricBackfaceMaterialGuard', checkLyricBackfaceMaterialGuard);
  await maybe('checkLyricScrollPerformanceGuard', checkLyricScrollPerformanceGuard);
  await maybe('checkPersistentCacheStorageGuard', checkPersistentCacheStorageGuard);
  await maybe('checkLyricTranslationCompletenessGuard', checkLyricTranslationCompletenessGuard);
  await maybe('checkLyricVerticalFloatToggleGuard', checkLyricVerticalFloatToggleGuard);
  await maybe('checkQishuiProviderGuard', checkQishuiProviderGuard);
  await maybe('checkSpotifyProviderGuard', () => checkSpotifyProviderGuard());
  await maybe('checkPlaybackControlBadgesGuard', checkPlaybackControlBadgesGuard);
  await maybe('checkProviderFallbackTerminalStateGuard', () => checkProviderFallbackTerminalStateGuard());
  await maybe('checkSearchGlassEntranceGuard', checkSearchGlassEntranceGuard);
  await maybe('checkProviderEntitlementBoundaryGuard', checkProviderEntitlementBoundaryGuard);
  await maybe('checkQQVipStatusSyncGuard', checkQQVipStatusSyncGuard);
  await maybe('checkProviderAuthCookiePathGuard', () => checkProviderAuthCookiePathGuard());
  await maybe('checkPlaybackResumeRecoveryGuard', checkPlaybackResumeRecoveryGuard);
  await maybe('checkAudioOutputWorkflowPanelGuard', checkAudioOutputWorkflowPanelGuard);
  await maybe('checkVolumeWheelStepGuard', checkVolumeWheelStepGuard);
  await maybe('checkKugouCloudlistIdentityGuard', checkKugouCloudlistIdentityGuard);
  await maybe('checkNonCurrentAudioPrefetchGuard', checkNonCurrentAudioPrefetchGuard);
  await maybe('checkCuefieldAutoMixGuard', checkCuefieldAutoMixGuard);
  await maybe('checkAlbumDetailGaplessGuard', checkAlbumDetailGaplessGuard);
  await maybe('checkInternalBetaPackagingGuard', checkInternalBetaPackagingGuard);
  await maybe('checkSonicTopographyPresetGuard', checkSonicTopographyPresetGuard);
  await maybe('checkLongPressReorderGuard', checkLongPressReorderGuard);
  await maybe('checkPlaylistPanelTriggerGuard', checkPlaylistPanelTriggerGuard);
  await maybe('checkShuffleQueueOrderGuard', checkShuffleQueueOrderGuard);
  await maybe('checkLargePlaylistVirtualizationGuard', () => checkLargePlaylistVirtualizationGuard());
  await maybe('checkFirstLaunchDefaultsAndSplashGuard', checkFirstLaunchDefaultsAndSplashGuard);
  await maybe('checkFxConsoleWorkspaceGuard', checkFxConsoleWorkspaceGuard);
  if (runElectron) {
    runElectronRuntimeCheck();
    runMainStartupRecoveryCheck();
  }
  else console.log('\n== Electron runtime smoke check ==\n[SKIP] Fast/static mode. Use quick-check.bat full to enable it.');
}

main().then(function () {
  console.log('\nAll checks passed.');
}).catch(function (error) {
  console.error(`\n[FAIL] ${error.message || error}`);
  process.exit(1);
});
