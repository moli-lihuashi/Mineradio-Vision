const { appRoot, runElectron, jsCheckFiles, runNodeSyntaxCheck } = require('./helpers');
const { runPlaybackSourceFallbackTransactionCheck, runLoginEasterEggGateRegressionCheck, runSpotifyApiResilienceRegressionCheck, runHomeDailyRecommendationRegressionCheck } = require('./regression-checks');
const { parseCombinedIndexModules, scanForbiddenMarkers, checkDeferredEagerDependencyGuard, smokeCoreEvalNoReferenceError } = require('./module-parse');
const { checkMainWindowChrome, checkProgressSeekDragGuard, checkLyricBackfaceMaterialGuard, checkQQVipStatusSyncGuard, checkVolumeWheelStepGuard, checkKugouCloudlistIdentityGuard, checkSplashBootGuard, checkLoginProviderTabGuard, checkUserModalTabGuard, checkPlatformPanelStyleGuard, checkCoverFallbackGuard, checkPlaylistCoverMarkGuard, checkPlatformPanelPlaybackGuard, checkVisualGuideGuard, checkDesktopLyricsMotionGuard, checkMusicalProfileGuard, checkCuefieldAutoMixGuard, checkOverlayTaskbarGuard, checkFoliaBackgroundLayerGuard, checkCacheSettingsStablePathGuard, checkLiquidGlassBackdropImageGuard, checkFloatingWidgetHostGuard, checkFloatingWidgetLiquidThemeGuard, checkSmoothnessRegressionGuard, checkCacheSettingsSnapshotGuard } = require('./guards');
const { runElectronRuntimeCheck, runMainStartupRecoveryCheck } = require('./electron-runtime');

// 2026-11-25：原 KUGOU_SKIP_CHECKS（33 条上游作者版守卫，引用本仓库不存在的模块/
// 函数）已全部删除。这里不再有跳过名单：任何检查失败都是真回归。

async function main() {
  console.log(`App root: ${appRoot}`);
  const run = (fn) => {
    const r = fn();
    return (r && typeof r.then === "function") ? r : Promise.resolve(r);
  };
  await run(() => runNodeSyntaxCheck(jsCheckFiles()));
  await run(runPlaybackSourceFallbackTransactionCheck);
  await run(runLoginEasterEggGateRegressionCheck);
  await run(runSpotifyApiResilienceRegressionCheck);
  await run(runHomeDailyRecommendationRegressionCheck);
  await run(parseCombinedIndexModules);
  await run(checkDeferredEagerDependencyGuard);
  await run(smokeCoreEvalNoReferenceError);
  await run(scanForbiddenMarkers);
  await run(checkMainWindowChrome);
  await run(checkProgressSeekDragGuard);
  await run(checkLyricBackfaceMaterialGuard);
  await run(checkQQVipStatusSyncGuard);
  await run(checkVolumeWheelStepGuard);
  await run(checkKugouCloudlistIdentityGuard);
  await run(checkSplashBootGuard);
  await run(checkLoginProviderTabGuard);
  await run(checkUserModalTabGuard);
  await run(checkPlatformPanelStyleGuard);
  await run(checkCoverFallbackGuard);
  await run(checkPlaylistCoverMarkGuard);
  await run(checkPlatformPanelPlaybackGuard);
  await run(checkVisualGuideGuard);
  await run(checkDesktopLyricsMotionGuard);
  await run(checkOverlayTaskbarGuard);
  await run(checkFoliaBackgroundLayerGuard);
  await run(checkCacheSettingsStablePathGuard);
  await run(checkLiquidGlassBackdropImageGuard);
  await run(checkFloatingWidgetHostGuard);
  await run(checkFloatingWidgetLiquidThemeGuard);
  await run(checkSmoothnessRegressionGuard);
  await run(checkCacheSettingsSnapshotGuard);
  await run(checkMusicalProfileGuard);
  await run(checkCuefieldAutoMixGuard);
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
