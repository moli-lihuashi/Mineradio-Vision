/* 插件市场折叠区控制（2026-11-11 精简）
 *
 * 这个文件原来带「歌词着色器市场」整套实现，已整体移除：
 * 原版是空壳（`_activeLyricShader` 无人消费、`initLyricShaderMarket()` 从未被调用）；
 * 后来自行接成「运动参数配方」又会和「运动风格」档位抢 `lyricMotionProfile()`，
 * 把行层渲染卷进不必要的变量。定位不准、收益有限，删掉。
 *
 * 现在插件市场只剩「玻璃插件」：低配降级开关 + 外部 userData 插件。
 */
'use strict';

// 插件市场折叠按钮：点击展开/收回，同时控制玻璃插件子折叠区
function togglePluginMarketFold() {
  var parent = document.getElementById('fx-plugin-market-fold');
  if (!parent) return;
  var willOpen = !parent.classList.contains('open');
  parent.classList.toggle('open', willOpen);
  var lgFold = document.getElementById('fx-liquidglass-plugin-fold');
  if (willOpen) {
    if (lgFold) lgFold.classList.add('open');
    if (typeof renderLiquidGlassPluginPanel === 'function') renderLiquidGlassPluginPanel();
  } else {
    if (lgFold) lgFold.classList.remove('open');
  }
}
