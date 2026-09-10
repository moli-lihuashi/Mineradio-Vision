// FX 面板 05a/05b/05c 为延迟波；核心侧先放同名空实现，避免 boot/overlay 在就绪前 ReferenceError。
// 真实实现加载后会以 function 声明覆盖这些 stub；05c 加载完成时置 __fxPanelDomModulesReady。
// 注意：本文件会被拼进 combined script，禁止在此写 'use strict'（会拖整包进严格模式）。

window.__fxPanelDomModulesReady = false;

function updateFxInputs() {}
function updateSonicFxInputs() {}
function updateDevelopmentFxControls() {}
function updateDesktopLyricsFpsControls() {}
function updatePerformanceControls() {}
function setPerformanceBackgroundMode() {}
function setPerformanceQualityMode() {}
function setForegroundFpsMode() {}
function setGpuThrottleMode() {}
function migratePerformanceQualityTowardAutoOnce() {}
function getFxSliderRow() { return null; }
function ensureFxSliderResetButton() {}
function resetFxSliderValue() {}
function animateFxResetButton() {}

function organizeFxPanel() {}
function relabelFxPanelControls() {}
function repairFxParticleCountPlacement() {}
function applyBackgroundMediaHint() {}
function setFxPanelTab() {}

function initFxParticleFireSlider() {}
function scheduleFxParticleFireRefresh() {}
function updateFxParticleFireSliderVisual() {}
function refreshFxParticleFireSlider() {}
function applyFxParticleFireMask() {}
function runFxParticleFireMaskReveal() {}

// setRange 定义在延迟波 05a-fx-panel-inputs.js；主波多个 FX 绑定/仪表函数体内直接调用，
// 空实现兜底 boot 窗口期，延迟波加载后由 function 声明覆盖。
function setRange() {}
// updateHomeAudioVisual 同理：11-main-loop 主循环按帧调用，延迟波就绪前不可 ReferenceError。
function updateHomeAudioVisual() {}

