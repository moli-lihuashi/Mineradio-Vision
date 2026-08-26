/**
 * Sample LiquidGlass plugin — soft pill on bottom controls.
 * Loaded from userData/plugins/liquidglass or public/plugins/liquidglass.
 */
(function () {
  if (!window.MineradioLiquidGlass) return;
  window.MineradioLiquidGlass.registerPlugin({
    id: 'sample-bottom-pill',
    name: '底部柔光胶囊',
    description: '示例插件：为底部播放条注册 softPill 预设（默认关闭）',
    version: '0.1.0',
    enabledByDefault: false
  }, function (api) {
    api.definePreset('sampleBottomPill', {
      blurAmount: 0.72,
      refraction: 0.16,
      chromAberration: 0.0,
      edgeHighlight: 0.12,
      specular: 0.05,
      fresnel: 1.0,
      cornerRadius: 40,
      zRadius: 12,
      shadowOpacity: 0.4,
      shadowSpread: 24,
      shadowOffsetY: 5,
      saturation: 0.36,
      brightness: 0.04,
      tintStrength: 0.0,
      bevelMode: 0,
      rootSelector: '#bottom-bar',
      glassSelector: '#bottom-bar'
    });
    // 仅注册预设；实际挂载留给用户手动启用后由宿主决定，避免与内置 bottomBar 冲突
  });
})();
