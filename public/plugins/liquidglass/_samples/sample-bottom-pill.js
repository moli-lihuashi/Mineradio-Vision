/**
 * 外部 LiquidGlass 插件格式参考（**不会被自动加载**）。
 *
 * 放在 `_samples/` 子目录是故意的：`desktop/liquidglass-plugins.js` 只 readdir
 * 插件目录的根层（不递归），所以这份文件不会进 app。
 * 想启用一个插件：把它复制到 `userData/plugins/liquidglass/xxx.js`（根层），重启。
 *
 * ⚠ 注意 mount 的目标：宿主已经负责 #bottom-bar / #search-box / #fx-panel /
 *   #home-grid / .home-rail / #empty-home / .home-card 等区域，往这些 root 上 mount
 *   会被 hostOwnsRoot() 闸门拒绝（LIQUIDGLASS_ROOT_BUSY）—— 同一块区域两套玻璃会
 *   各自跑一遍模糊+折射，帧率与延迟都会翻倍。
 *   插件要挂玻璃，请先自己创建一块新的 DOM 元素再 mount 上去。
 */
(function () {
  if (!window.MineradioLiquidGlass) return;
  var PRESET = 'sampleBottomPillExternal';
  window.MineradioLiquidGlass.registerPlugin({
    id: 'sample-bottom-pill-external',
    name: '底部柔光胶囊（外部示例）',
    description: '示例：外部插件注册独立预设，启用时挂载玻璃、停用时卸载。',
    version: '0.2.0',
    enabledByDefault: false
  }, function (api) {
    api.definePreset(PRESET, {
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
      distortion: 0,
      bevelMode: 0,
      rootSelector: '#bottom-bar',
      glassSelector: ''
    });
    if (!document.getElementById('bottom-bar')) return null;
    try {
      // glassSelector 留空时 SDK 会自动补 backdrop shell 并启动渲染管线
      api.mount(PRESET, { rootSelector: '#bottom-bar' });
    } catch (e) {
      console.warn('[LiquidGlassPlugin]', PRESET, e);
      return null;
    }
    return function () {
      api.unmount(PRESET);
    };
  });
})();
