(function (global) {
  'use strict';

  var SCENE_STORE_KEY = 'mineradio-scene-v1';
  var SCENE_TONE_BY_ID = {
    focus: 'library',
    commute: 'mix',
    party: 'playlist',
    sleep: 'local',
    rain: 'search',
  };

  var DEFAULT_SCENES = [
    {
      id: 'focus',
      label: '专注',
      title: '专注场景',
      tagline: '低密度节奏，把注意力留给手头的事',
      tone: 'library',
      visualPreset: 0,
      coverGradient: ['#b5651d', '#3d2c1e'],
      moodVisualLink: false,
      hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
    },
    {
      id: 'commute',
      label: '通勤',
      title: '通勤场景',
      tagline: '节拍清楚，但不抢你的注意力',
      tone: 'mix',
      visualPreset: 4,
      coverGradient: ['#f4a261', '#bc4749'],
      moodVisualLink: true,
      hours: [7, 8, 9, 17, 18, 19],
    },
    {
      id: 'party',
      label: '派对',
      title: '派对场景',
      tagline: '把能量拉高，让视觉跟着鼓点走',
      tone: 'playlist',
      visualPreset: 6,
      coverGradient: ['#ff006e', '#8338ec'],
      moodVisualLink: true,
      hours: [20, 21, 22, 23, 0, 1],
    },
    {
      id: 'sleep',
      label: '睡前',
      title: '睡前场景',
      tagline: '音量与亮度都收一点，慢慢进入休息',
      tone: 'local',
      visualPreset: 9,
      coverGradient: ['#4895ef', '#3a0ca3'],
      moodVisualLink: false,
      hours: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
    },
    {
      id: 'rain',
      label: '雨夜',
      title: '雨夜场景',
      tagline: '潮湿、柔软、适合把房间关小一点',
      tone: 'search',
      visualPreset: 9,
      coverGradient: ['#5c677d', '#33415c'],
      moodVisualLink: true,
      hours: [18, 19, 20, 21, 22, 23],
    },
  ];

  var SCENES = DEFAULT_SCENES.map(function (scene) {
    return Object.assign({}, scene, { coverGradient: scene.coverGradient.slice(), hours: scene.hours.slice() });
  });
  var sceneById = {};
  var activeSceneId = '';
  var presetsHydrated = false;

  function rebuildSceneIndex() {
    sceneById = {};
    SCENES.forEach(function (scene) {
      sceneById[scene.id] = scene;
    });
  }
  rebuildSceneIndex();

  function esc(v) {
    var api = global.Mineradio && global.Mineradio.api;
    if (api && api.escHtml) return api.escHtml(v);
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mergeScenePresetsFromServer(serverScenes) {
    if (!Array.isArray(serverScenes) || !serverScenes.length) return false;
    var merged = [];
    serverScenes.forEach(function (item) {
      var id = String(item.id || '').toLowerCase();
      if (!id) return;
      var base = sceneById[id] || {};
      merged.push({
        id: id,
        label: item.label || base.label || id,
        title: item.title || base.title || id,
        tagline: item.tagline || base.tagline || '',
        tone: base.tone || SCENE_TONE_BY_ID[id] || 'mix',
        visualPreset: isFinite(Number(item.visualPreset)) ? Number(item.visualPreset) : (base.visualPreset != null ? base.visualPreset : 0),
        coverGradient: Array.isArray(item.coverGradient) && item.coverGradient.length
          ? item.coverGradient.slice()
          : (base.coverGradient ? base.coverGradient.slice() : ['#33415c', '#1d2d44']),
        moodVisualLink: typeof item.moodVisualLink === 'boolean' ? item.moodVisualLink : (base.moodVisualLink !== false),
        hours: Array.isArray(item.hours) && item.hours.length ? item.hours.slice() : (base.hours ? base.hours.slice() : []),
        energy: isFinite(Number(item.energy)) ? Number(item.energy) : base.energy,
        warmth: isFinite(Number(item.warmth)) ? Number(item.warmth) : base.warmth,
        focus: isFinite(Number(item.focus)) ? Number(item.focus) : base.focus,
        melancholy: isFinite(Number(item.melancholy)) ? Number(item.melancholy) : base.melancholy,
      });
    });
    if (!merged.length) return false;
    SCENES = merged;
    rebuildSceneIndex();
    presetsHydrated = true;
    return true;
  }

  function hydrateScenePresets(fetchFn) {
    if (typeof fetchFn !== 'function') return Promise.resolve(false);
    return fetchFn('/api/scene/presets?t=' + Date.now()).then(function (data) {
      if (data && data.scenes && mergeScenePresetsFromServer(data.scenes)) return true;
      return false;
    }).catch(function () {
      return false;
    });
  }

  function invalidateScenePanelCache(container) {
    if (container) container._scenePanelSig = '';
  }

  function listScenes() {
    return SCENES.slice();
  }

  function getSceneMeta(sceneId) {
    return sceneById[String(sceneId || '').toLowerCase()] || null;
  }

  function getActiveSceneId() {
    return activeSceneId || '';
  }

  function setActiveSceneId(sceneId) {
    activeSceneId = sceneId || '';
  }

  function readLastScene() {
    try {
      var raw = JSON.parse(global.localStorage.getItem(SCENE_STORE_KEY) || 'null');
      if (!raw || !raw.id) return null;
      return getSceneMeta(raw.id) ? raw : null;
    } catch (e) {
      return null;
    }
  }

  function saveLastScene(sceneId) {
    var meta = getSceneMeta(sceneId);
    if (!meta) return;
    activeSceneId = meta.id;
    try {
      global.localStorage.setItem(SCENE_STORE_KEY, JSON.stringify({
        id: meta.id,
        label: meta.label,
        title: meta.title,
        updatedAt: Date.now(),
      }));
    } catch (e) {}
  }

  function recommendSceneByHour(hour) {
    hour = Number(hour);
    if (!isFinite(hour)) hour = new Date().getHours();
    var best = SCENES[0];
    var bestScore = -1;
    SCENES.forEach(function (scene) {
      var score = 0;
      (scene.hours || []).forEach(function (h) {
        var diff = Math.abs(hour - h);
        if (diff > 12) diff = 24 - diff;
        if (diff === 0) score += 4;
        else if (diff === 1) score += 2;
        else if (diff === 2) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        best = scene;
      }
    });
    return best;
  }

  function timeHintForScene(scene) {
    if (!scene) return '';
    var hour = new Date().getHours();
    var rec = recommendSceneByHour(hour);
    if (rec && rec.id === scene.id) return '此刻推荐';
    if (hour >= 21 || hour <= 5) return '夜间';
    if (hour >= 7 && hour <= 9) return '早晨';
    if (hour >= 17 && hour <= 19) return '傍晚';
    return '';
  }

  function sceneApiUrl(sceneId) {
    return '/api/scene/radio?scene=' + encodeURIComponent(sceneId || 'focus') + '&t=' + Date.now();
  }

  function gradientCss(scene) {
    var g = scene && scene.coverGradient;
    if (!g || !g.length) return 'linear-gradient(135deg,#33415c,#1d2d44)';
    if (g.length === 1) return 'linear-gradient(135deg,' + g[0] + ',' + g[0] + ')';
    return 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')';
  }

  function applySceneVisual(sceneId, mood, hooks) {
    hooks = hooks || {};
    activeSceneId = sceneId || '';
    if (typeof hooks.onSceneVisual === 'function') {
      hooks.onSceneVisual(sceneId, mood || null, getSceneMeta(sceneId));
      return;
    }
    if (!global.uniforms || !global.fx) return;
    var meta = getSceneMeta(sceneId);
    var energy = mood && Number(mood.energy);
    var focus = mood && Number(mood.focus);
    if (!isFinite(energy) && meta) energy = Number(meta.energy);
    if (!isFinite(focus) && meta) focus = Number(meta.focus);
    if (global.uniforms.uAlpha && isFinite(energy)) {
      global.uniforms.uAlpha.value = Math.max(0.72, Math.min(0.98, 0.74 + energy * 0.22));
    }
    if (global.fx && global.fx.particleCount != null && isFinite(focus)) {
      var target = Math.round(900 + focus * 2600);
      if (typeof global.setFxParticleCount === 'function') global.setFxParticleCount(target, { silent: true });
      else if (typeof global.fx.particleCount === 'number') global.fx.particleCount = target;
    }
  }

  function bindSceneButtons(container, onSelect) {
    if (!container) return;
    container.querySelectorAll('[data-scene-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-scene-id');
        if (typeof onSelect === 'function') onSelect(id);
      });
    });
    var resume = container.querySelector('[data-scene-resume]');
    if (resume) {
      resume.addEventListener('click', function () {
        var id = resume.getAttribute('data-scene-resume');
        if (id && typeof onSelect === 'function') onSelect(id);
      });
    }
  }

  function panelSignature(featured, lastMeta, hour) {
    return String(hour) + '|' + (featured && featured.id || '') + '|' + (lastMeta && lastMeta.id || '') + '|' + (presetsHydrated ? '1' : '0');
  }

  function updateScenePanelActive(container) {
    if (!container) return;
    var root = container.querySelector('[data-scene-carousel]');
    if (root && global.Mineradio && global.Mineradio.sceneCarousel) {
      global.Mineradio.sceneCarousel.updateActive(root, activeSceneId || '');
    }
  }

  function renderScenePanel(container, onSelect) {
    if (!container) return;
    var hour = new Date().getHours();
    var featured = recommendSceneByHour(hour);
    var last = readLastScene();
    var lastMeta = last ? getSceneMeta(last.id) : null;
    var sig = panelSignature(featured, lastMeta, hour);
    if (container._scenePanelSig === sig && container._sceneSelectHandler === onSelect) {
      updateScenePanelActive(container);
      return;
    }
    container._scenePanelSig = sig;
    container._sceneSelectHandler = onSelect;
    // 旧轮播先释放（避免 WebGL 上下文泄漏）
    var oldRoot = container.querySelector('[data-scene-carousel]');
    if (oldRoot && global.Mineradio && global.Mineradio.sceneCarousel) {
      global.Mineradio.sceneCarousel.dispose(oldRoot);
    }
    var html = '<div class="home-scene-head">';
    html += '<div class="home-scene-kicker">Scene Radio</div>';
    html += '<div class="home-scene-lead">音效 · 视觉 · 时段</div>';
    html += '</div>';
    if (lastMeta && lastMeta.id !== featured.id) {
      html += '<button class="home-scene-resume" type="button" data-scene-resume="' + esc(lastMeta.id) + '">';
      html += '<span class="home-scene-resume-label">回到我的场景</span>';
      html += '<span class="home-scene-resume-name">' + esc(lastMeta.label || lastMeta.title) + '</span>';
      html += '</button>';
    }
    // 堆叠轮播挂载点（由 home-scene-carousel.js 接管）
    html += '<div class="home-scene-carousel-root" data-scene-carousel></div>';
    container.innerHTML = html;
    bindSceneButtons(container, onSelect);
    var carouselRoot = container.querySelector('[data-scene-carousel]');
    if (carouselRoot && global.Mineradio && global.Mineradio.sceneCarousel) {
      global.Mineradio.sceneCarousel.mount(carouselRoot, {
        scenes: listScenes(),
        recommendedId: featured.id,
        onSelect: onSelect,
        getActiveId: getActiveSceneId,
      });
    }
  }

  global.Mineradio = global.Mineradio || {};
  global.Mineradio.scene = {
    SCENE_STORE_KEY: SCENE_STORE_KEY,
    listScenes: listScenes,
    getSceneMeta: getSceneMeta,
    getActiveSceneId: getActiveSceneId,
    setActiveSceneId: setActiveSceneId,
    readLastScene: readLastScene,
    saveLastScene: saveLastScene,
    recommendSceneByHour: recommendSceneByHour,
    sceneApiUrl: sceneApiUrl,
    applySceneVisual: applySceneVisual,
    renderScenePanel: renderScenePanel,
    gradientCss: gradientCss,
    updateScenePanelActive: updateScenePanelActive,
    hydrateScenePresets: hydrateScenePresets,
    invalidateScenePanelCache: invalidateScenePanelCache,
    arePresetsHydrated: function () { return presetsHydrated; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
