const { spawnSync, path, appRoot, rel, fail, logStep } = require('./helpers');

function runPlaybackAudioGraphRegressionCheck() {
  logStep('Playback audio graph track-switch regression');
  const testFile = path.join(appRoot, 'tests', 'playback-audio-graph-recovery.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`playback audio graph regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runPlaybackSourceFallbackTransactionCheck() {
  logStep('Playback source fallback finite transaction regression');
  const testFile = path.join(appRoot, 'tests', 'playback-source-fallback-transaction.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`playback source fallback transaction regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runQQVipEntitlementRegressionCheck() {
  logStep('QQ VIP entitlement regression');
  const testFile = path.join(appRoot, 'tests', 'qq-vip-entitlement.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`QQ VIP entitlement regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runLoginEasterEggGateRegressionCheck() {
  logStep('Login easter egg one-time gate regression');
  const testFile = path.join(appRoot, 'tests', 'login-easter-egg-gate.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`login easter egg gate regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runSpotifyApiResilienceRegressionCheck() {
  logStep('Spotify API resilience regression');
  const testFile = path.join(appRoot, 'tests', 'spotify-api-resilience.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`Spotify API resilience regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runPlatformAccountSyncGuardCheck() {
  logStep('Platform account action and listen-sync guard');
  const testFile = path.join(appRoot, 'tests', 'platform-account-sync-guard.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`platform account/listen-sync guard failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

function runHomeDailyRecommendationRegressionCheck() {
  logStep('Complete daily recommendation data and bounded rendering regression');
  const testFiles = [
    path.join(appRoot, 'tests', 'home-daily-recommendations-backend.test.js'),
    path.join(appRoot, 'tests', 'home-daily-recommendation-virtualization.test.js'),
  ];
  const result = spawnSync(process.execPath, ['--test'].concat(testFiles), {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail('complete daily recommendation regression failed');
  }
  process.stdout.write(result.stdout || '');
}

function runQishuiProviderDistributionRegressionCheck() {
  logStep('Qishui provider distribution regression');
  const testFile = path.join(appRoot, 'tests', 'qishui-provider-distribution.test.js');
  const result = spawnSync(process.execPath, [testFile], {
    cwd: appRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`Qishui provider distribution regression failed: ${rel(testFile)}`);
  }
  process.stdout.write(result.stdout || '');
}

module.exports = {
  runPlaybackAudioGraphRegressionCheck, runPlaybackSourceFallbackTransactionCheck, runQQVipEntitlementRegressionCheck, runLoginEasterEggGateRegressionCheck, runSpotifyApiResilienceRegressionCheck, runPlatformAccountSyncGuardCheck, runHomeDailyRecommendationRegressionCheck, runQishuiProviderDistributionRegressionCheck
};
