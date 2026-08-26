// public/js/modules/02-home/05-home-weather-panel.js
// 天气效果测试面板 — 用于手动触发各天气效果验证渲染
// 暴露 window.HomeWeatherPanel，接口：toggle / setWeather / clear
(function () {
  'use strict';

  var PANEL_ID = 'home-weather-test-panel';
  var panelEl = null;
  var isOpen = false;

  // 测试天气数据模板：覆盖所有 WMO 代码
  var WEATHER_PRESETS = [
    { label: '晴天', code: 0, wind: 2, isDay: 1, precip: 0 },
    { label: '晴间多云', code: 1, wind: 3, isDay: 1, precip: 0 },
    { label: '多云', code: 2, wind: 4, isDay: 1, precip: 0 },
    { label: '阴天', code: 3, wind: 5, isDay: 1, precip: 0 },
    { label: '雾', code: 45, wind: 1, isDay: 1, precip: 0 },
    { label: '冰雾', code: 48, wind: 1, isDay: 1, precip: 0 },
    { label: '毛毛雨', code: 51, wind: 3, isDay: 1, precip: 0.5 },
    { label: '小雨', code: 61, wind: 4, isDay: 1, precip: 1.5 },
    { label: '中雨', code: 63, wind: 5, isDay: 1, precip: 4 },
    { label: '大雨', code: 65, wind: 6, isDay: 1, precip: 8 },
    { label: '冻雨', code: 66, wind: 4, isDay: 1, precip: 1 },
    { label: '阵雨', code: 81, wind: 5, isDay: 1, precip: 2 },
    { label: '强阵雨', code: 82, wind: 7, isDay: 1, precip: 6 },
    { label: '小雪', code: 71, wind: 3, isDay: 1, precip: 0.5 },
    { label: '中雪', code: 73, wind: 4, isDay: 1, precip: 2 },
    { label: '大雪', code: 75, wind: 5, isDay: 1, precip: 5 },
    { label: '米雪', code: 77, wind: 2, isDay: 1, precip: 0.3 },
    { label: '阵雪', code: 85, wind: 4, isDay: 1, precip: 1.5 },
    { label: '强阵雪', code: 86, wind: 6, isDay: 1, precip: 4 },
    { label: '雷暴', code: 95, wind: 6, isDay: 1, precip: 5 },
    { label: '雷暴+冰雹', code: 96, wind: 7, isDay: 1, precip: 6 },
    { label: '强雷暴', code: 99, wind: 8, isDay: 1, precip: 10 }
  ];

  function ensureHomeWeatherRadioState() {
    if (!window.homeWeatherRadioState) {
      window.homeWeatherRadioState = { loading: false, loaded: false, city: '测试', weather: null, radio: null, error: '', updatedAt: 0 };
    }
    return window.homeWeatherRadioState;
  }

  function applyWeather(preset) {
    var state = ensureHomeWeatherRadioState();
    state.testMode = true;
    state.weather = {
      weatherCode: preset.code,
      windSpeed: preset.wind,
      isDay: preset.isDay,
      precipitation: preset.precip,
      temperature: 18,
      label: preset.label,
      location: { name: '测试城市' }
    };
    state.loaded = true;
    if (typeof window.syncHomeWeatherFx === 'function') {
      window.syncHomeWeatherFx({ force: true, testBypass: true });
    }
    // 调试信息：延迟检查引擎状态
    setTimeout(function () {
      var glActive = window.HomeWeatherGl && window.HomeWeatherGl.active && window.HomeWeatherGl.active();
      var hero = document.querySelector('.home-hero');
      var heroClasses = hero ? hero.className : 'no-hero';
      var canvases = document.querySelectorAll('.home-weather-gl-canvas');
      var canvasInfo = '';
      canvases.forEach(function (c, i) {
        canvasInfo += ' canvas' + i + ':' + c.width + 'x' + c.height;
      });
      updateStatus(preset.label + ' (code=' + preset.code + ') | GL:' + glActive + ' | ' + canvasInfo + ' | ' + heroClasses);
    }, 200);
  }

  function clearWeather() {
    var state = ensureHomeWeatherRadioState();
    state.testMode = false;
    state.weather = null;
    if (typeof window.stopHomeWeatherFx === 'function') {
      window.stopHomeWeatherFx();
    }
    updateStatus('已清除天气效果');
  }

  function updateStatus(text) {
    var status = panelEl && panelEl.querySelector('.weather-panel-status');
    if (status) status.textContent = text;
  }

  function buildPanel() {
    if (panelEl && panelEl.isConnected) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.className = 'home-weather-test-panel';
    panelEl.setAttribute('aria-hidden', 'true');

    var html = '<div class="weather-panel-header">'
      + '<span class="weather-panel-title">天气效果测试面板</span>'
      + '<button class="weather-panel-close" type="button" title="关闭">×</button>'
      + '</div>'
      + '<div class="weather-panel-grid">';

    WEATHER_PRESETS.forEach(function (p, i) {
      html += '<button class="weather-btn" data-idx="' + i + '" type="button">' + p.label + '</button>';
    });

    html += '</div>'
      + '<div class="weather-panel-actions">'
      + '<button class="weather-btn-clear" type="button">清除天气</button>'
      + '</div>'
      + '<div class="weather-panel-status">就绪</div>';

    panelEl.innerHTML = html;

    // 事件绑定
    panelEl.querySelector('.weather-panel-close').addEventListener('click', toggle);
    panelEl.querySelector('.weather-btn-clear').addEventListener('click', clearWeather);
    var btns = panelEl.querySelectorAll('.weather-btn[data-idx]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        var idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && WEATHER_PRESETS[idx]) applyWeather(WEATHER_PRESETS[idx]);
      });
    }

    document.body.appendChild(panelEl);
    return panelEl;
  }

  function toggle() {
    buildPanel();
    isOpen = !isOpen;
    if (isOpen) {
      panelEl.classList.add('open');
      panelEl.setAttribute('aria-hidden', 'false');
    } else {
      panelEl.classList.remove('open');
      panelEl.setAttribute('aria-hidden', 'true');
    }
  }

  // 注入 CSS（一次性）
  function injectStyles() {
    if (document.getElementById('home-weather-panel-styles')) return;
    var css = ''
      + '.home-weather-test-panel{position:fixed;top:80px;right:20px;width:280px;max-height:70vh;overflow-y:auto;background:rgba(18,20,28,0.96);border:1px solid rgba(140,150,170,0.25);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.6);z-index:99999;font-family:"Segoe UI",system-ui,sans-serif;color:#e8ecf2;display:none;padding:0;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}'
      + '.home-weather-test-panel.open{display:block;animation:weatherPanelIn .22s ease-out}'
      + '@keyframes weatherPanelIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}'
      + '.weather-panel-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(140,150,170,0.18)}'
      + '.weather-panel-title{font-size:13px;font-weight:600;color:#f0f4fa;letter-spacing:.3px}'
      + '.weather-panel-close{background:none;border:none;color:#9aa4b8;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;transition:color .15s}'
      + '.weather-panel-close:hover{color:#fff}'
      + '.weather-panel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:10px}'
      + '.weather-btn{background:rgba(60,70,90,0.5);border:1px solid rgba(140,150,170,0.2);color:#dce4f0;font-size:11px;padding:7px 4px;border-radius:6px;cursor:pointer;transition:all .15s;text-align:center;font-family:inherit}'
      + '.weather-btn:hover{background:rgba(90,110,150,0.7);border-color:rgba(180,200,240,0.4);color:#fff;transform:translateY(-1px)}'
      + '.weather-btn:active{transform:translateY(0)}'
      + '.weather-panel-actions{padding:0 10px 8px}'
      + '.weather-btn-clear{width:100%;background:rgba(180,80,80,0.3);border:1px solid rgba(220,120,120,0.3);color:#ffd8d8;font-size:12px;padding:8px;border-radius:6px;cursor:pointer;transition:all .15s;font-family:inherit}'
      + '.weather-btn-clear:hover{background:rgba(200,90,90,0.5);color:#fff}'
      + '.weather-panel-status{padding:8px 14px 12px;font-size:11px;color:#8a94a8;border-top:1px solid rgba(140,150,170,0.12);min-height:32px}';
    var style = document.createElement('style');
    style.id = 'home-weather-panel-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    // 键盘快捷键：Ctrl+Shift+W 切换面板
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        toggle();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HomeWeatherPanel = {
    toggle: toggle,
    setWeather: applyWeather,
    clear: clearWeather,
    isOpen: function () { return isOpen; }
  };
})();
