/* 歌词着色器市场 MVP — 9.14
 * 着色器包格式：userData/plugins/lyric-shaders/<name>.json
 *   { name, vertexShader, fragmentShader, uniforms: { key: {value, type} }, preview }
 * FX 控制台加「着色器市场」折叠区，扫描列表 + 内置 3 预设。
 * 选中后注入 10-lyrics-mask-shaders.js 的 shader 编译链。 */
'use strict';

var LYRIC_SHADER_MARKET_STORAGE = 'mineradio-lyric-shader-active';
var lyricShaderMarketState = {
  active: null,
  loaded: false,
  presets: [],
  customShaders: [],
};

// 内置 3 个预设
var BUILTIN_LYRIC_SHADERS = [
  {
    id: 'builtin-aurora',
    name: '极光流动',
    description: '绿紫渐变极光效果',
    vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime;\nuniform vec3 uColorA;\nuniform vec3 uColorB;\nvarying vec2 vUv;\nvoid main(){ float w=sin(vUv.x*3.14+uTime*0.5)*0.5+0.5; vec3 c=mix(uColorA,uColorB,w); gl_FragColor=vec4(c,1.0); }',
    uniforms: {
      uTime: { value: 0, type: 'f' },
      uColorA: { value: [0.2, 0.8, 0.4], type: 'v3' },
      uColorB: { value: [0.6, 0.2, 0.8], type: 'v3' },
    },
    preview: 'aurora',
  },
  {
    id: 'builtin-neon-pulse',
    name: '霓虹脉冲',
    description: '随节跳动的霓虹边框',
    vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime;\nuniform float uBass;\nvarying vec2 vUv;\nvoid main(){ float edge=abs(vUv.x-0.5)*2.0; float pulse=uBass*0.5+0.3; vec3 neon=vec3(0.0,0.95,1.0)*pulse*(1.0-edge*0.6); gl_FragColor=vec4(neon,1.0); }',
    uniforms: {
      uTime: { value: 0, type: 'f' },
      uBass: { value: 0, type: 'f' },
    },
    preview: 'neon',
  },
  {
    id: 'builtin-warm-glow',
    name: '暖光余晖',
    description: '温暖的金橙色光晕',
    vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime;\nuniform vec3 uWarm;\nvarying vec2 vUv;\nvoid main(){ float d=distance(vUv,vec2(0.5)); float glow=1.0-smoothstep(0.0,0.7,d); vec3 c=uWarm*glow*(0.7+0.3*sin(uTime*0.3)); gl_FragColor=vec4(c,1.0); }',
    uniforms: {
      uTime: { value: 0, type: 'f' },
      uWarm: { value: [1.0, 0.7, 0.3], type: 'v3' },
    },
    preview: 'warm',
  },
];

function getActiveLyricShaderId() {
  try { return localStorage.getItem(LYRIC_SHADER_MARKET_STORAGE) || ''; } catch (_) { return ''; }
}

function setActiveLyricShaderId(id) {
  try {
    if (id) localStorage.setItem(LYRIC_SHADER_MARKET_STORAGE, id);
    else localStorage.removeItem(LYRIC_SHADER_MARKET_STORAGE);
  } catch (_) {}
}

function getAllLyricShaders() {
  return BUILTIN_LYRIC_SHADERS.concat(lyricShaderMarketState.customShaders);
}

function findLyricShaderById(id) {
  var all = getAllLyricShaders();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i];
  }
  return null;
}

function loadCustomLyricShaders() {
  // 通过 fetch 扫描 userData/plugins/lyric-shaders/ 目录
  // 桌面版走 /api/shader-market/list
  return fetch('/api/shader-market/list', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : { shaders: [] }; })
    .then(function (data) {
      lyricShaderMarketState.customShaders = (data && data.shaders) || [];
      lyricShaderMarketState.loaded = true;
      return lyricShaderMarketState.customShaders;
    })
    .catch(function () {
      lyricShaderMarketState.customShaders = [];
      lyricShaderMarketState.loaded = true;
      return [];
    });
}

function applyLyricShader(shaderId) {
  var shader = shaderId ? findLyricShaderById(shaderId) : null;
  if (shaderId && !shader) {
    showToast('着色器未找到: ' + shaderId);
    return;
  }
  lyricShaderMarketState.active = shader;
  setActiveLyricShaderId(shaderId || '');
  // 通知歌词渲染层更新着色器
  if (typeof window !== 'undefined') {
    window._activeLyricShader = shader || null;
  }
  if (typeof showToast === 'function') {
    showToast(shader ? ('已切换歌词着色器: ' + shader.name) : '已恢复默认歌词着色器');
  }
}

function buildLyricShaderMarketHtml() {
  var all = getAllLyricShaders();
  var activeId = getActiveLyricShaderId();
  var html = '<div class="lyric-shader-market" id="lyric-shader-market">';
  html += '<div class="lyric-shader-market-title">歌词着色器市场</div>';
  html += '<div class="lyric-shader-market-grid">';
  html += '<div class="lyric-shader-card' + (!activeId ? ' active' : '') + '" onclick="applyLyricShader(\'\')">';
  html += '<div class="lyric-shader-preview lyric-shader-preview-default"></div>';
  html += '<div class="lyric-shader-name">默认</div>';
  html += '<div class="lyric-shader-desc">内置着色器</div>';
  html += '</div>';
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    html += '<div class="lyric-shader-card' + (s.id === activeId ? ' active' : '') + '" onclick="applyLyricShader(\'' + escAttr(s.id) + '\')">';
    html += '<div class="lyric-shader-preview lyric-shader-preview-' + escAttr(s.preview || s.id) + '"></div>';
    html += '<div class="lyric-shader-name">' + escHtml(s.name) + '</div>';
    html += '<div class="lyric-shader-desc">' + escHtml(s.description || '') + '</div>';
    html += '</div>';
  }
  html += '</div>';
  if (!all.length) {
    html += '<div class="lyric-shader-empty">在 userData/plugins/lyric-shaders/ 放置 JSON 着色器包即可加载自定义着色器。</div>';
  }
  html += '</div>';
  return html;
}

function renderLyricShaderMarketPanel() {
  var container = document.getElementById('lyric-shader-market-panel');
  if (!container) return;
  if (!lyricShaderMarketState.loaded) {
    container.innerHTML = '<div class="lyric-shader-loading">加载中…</div>';
    loadCustomLyricShaders().then(function () {
      container.innerHTML = buildLyricShaderMarketHtml();
    });
    return;
  }
  container.innerHTML = buildLyricShaderMarketHtml();
}

function initLyricShaderMarket() {
  // 首次加载自定义着色器
  loadCustomLyricShaders().then(function () {
    var activeId = getActiveLyricShaderId();
    if (activeId) applyLyricShader(activeId);
  });
}

// 插件市场折叠按钮：点击展开/收回，同时控制玻璃插件 + 着色器市场两个子折叠区
function togglePluginMarketFold() {
  var parent = document.getElementById('fx-plugin-market-fold');
  if (!parent) return;
  var willOpen = !parent.classList.contains('open');
  parent.classList.toggle('open', willOpen);
  // 展开时同时展开两个子折叠区；收回时同时收回
  var lgFold = document.getElementById('fx-liquidglass-plugin-fold');
  var shaderFold = document.getElementById('fx-lyric-shader-fold');
  if (willOpen) {
    if (lgFold) lgFold.classList.add('open');
    if (shaderFold) shaderFold.classList.add('open');
    if (typeof renderLiquidGlassPluginPanel === 'function') renderLiquidGlassPluginPanel();
    if (typeof renderLyricShaderMarketPanel === 'function') renderLyricShaderMarketPanel();
  } else {
    if (lgFold) lgFold.classList.remove('open');
    if (shaderFold) shaderFold.classList.remove('open');
  }
}
