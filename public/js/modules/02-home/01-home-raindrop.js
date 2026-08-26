(function () {
  var state = null;

  function supported() {
    if (typeof window.RaindropFX !== 'function') return false;
    try {
      var test = document.createElement('canvas');
      return !!test.getContext('webgl2');
    } catch (e) {
      return false;
    }
  }

  function buildHeroGlassBackground(width, height) {
    var bg = document.createElement('canvas');
    bg.width = Math.max(1, width);
    bg.height = Math.max(1, height);
    var ctx = bg.getContext('2d');
    if (!ctx) return bg;

    var ambient = ctx.createLinearGradient(0, 0, width * 0.72, height);
    ambient.addColorStop(0, '#2a3340');
    ambient.addColorStop(0.48, '#141820');
    ambient.addColorStop(1, '#1a2230');
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    var glass = ctx.createLinearGradient(0, 0, width, height);
    glass.addColorStop(0, 'rgba(255,255,255,0.14)');
    glass.addColorStop(0.42, 'rgba(255,255,255,0.05)');
    glass.addColorStop(1, 'rgba(36,66,255,0.08)');
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (var x = 0; x < width; x += 52) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return bg;
  }

  function presetOptions(intensity, storm) {
    var useMist = !!storm;
    if (storm || intensity === 'heavy') {
      return {
        spawnLimit: 220,
        dropletsPerSeconds: 180,
        spawnInterval: [0.055, 0.11],
        spawnSize: [34, 76],
        mist: useMist,
        mistTime: 9,
        mistColor: [0.01, 0.012, 0.016, 0.22]
      };
    }
    if (intensity === 'moderate') {
      return {
        spawnLimit: 150,
        dropletsPerSeconds: 130,
        spawnInterval: [0.08, 0.15],
        spawnSize: [28, 60],
        mist: false,
        mistTime: 10,
        mistColor: [0.008, 0.01, 0.014, 0.18]
      };
    }
    return {
      spawnLimit: 96,
      dropletsPerSeconds: 78,
      spawnInterval: [0.11, 0.2],
      spawnSize: [20, 44],
      mist: false,
      mistTime: 12,
      mistColor: [0.006, 0.008, 0.012, 0.14]
    };
  }

  function renderScale(width, height, hybrid) {
    var px = width * height;
    var scale = hybrid ? 0.78 : 0.88;
    if (px > 520000) scale = hybrid ? 0.68 : 0.78;
    else if (px > 360000) scale = hybrid ? 0.72 : 0.82;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function applyCanvasSize(canvas, layoutWidth, layoutHeight, renderWidth, renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    canvas.style.width = layoutWidth + 'px';
    canvas.style.height = layoutHeight + 'px';
  }

  window.HomeRaindropFx = {
    supported: supported,
    active: function () {
      return !!(state && state.running);
    },
    start: function (intensity, storm, opts) {
      opts = opts || {};
      if (!supported()) return false;
      var hero = document.querySelector('.home-hero');
      if (!hero) return false;
      this.stop();

      var width = Math.max(1, Math.round(hero.clientWidth || 800));
      var height = Math.max(1, Math.round(hero.clientHeight || 400));
      var hybrid = !!opts.hybrid;
      var render = renderScale(width, height, hybrid);
      var canvas = document.createElement('canvas');
      canvas.id = 'home-weather-raindrop-canvas';
      canvas.className = 'home-weather-fx-canvas home-weather-raindrop-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      applyCanvasSize(canvas, width, height, render.width, render.height);

      var rainCanvas = opts.rainCanvas || null;
      var insertBefore = rainCanvas && rainCanvas.parentNode === hero ? rainCanvas.nextSibling : hero.firstChild;
      hero.insertBefore(canvas, insertBefore);

      var preset = presetOptions(intensity, storm);
      var fx = new window.RaindropFX({
        canvas: canvas,
        spawnLimit: preset.spawnLimit,
        dropletsPerSeconds: preset.dropletsPerSeconds,
        spawnInterval: preset.spawnInterval,
        spawnSize: preset.spawnSize,
        mist: preset.mist,
        mistTime: preset.mistTime,
        mistColor: preset.mistColor,
        raindropDiffuseLight: [0.16, 0.18, 0.22],
        raindropLightPos: [-0.55, 0.82, 1.5, 0],
        backgroundBlurSteps: 1,
        mistBlurStep: 2
      });

      state = {
        fx: fx,
        canvas: canvas,
        hero: hero,
        running: true,
        hybrid: hybrid,
        rainCanvas: rainCanvas,
        layoutWidth: width,
        layoutHeight: height,
        renderWidth: render.width,
        renderHeight: render.height
      };

      var bg = buildHeroGlassBackground(render.width, render.height);

      Promise.resolve(fx.setBackground(bg)).then(function () {
        if (state && state.fx === fx) fx.start();
      }).catch(function () {
        if (state && state.fx === fx) fx.start();
      });
      return true;
    },
    resize: function () {
      if (!state || !state.fx) return;
      var hero = state.hero || document.querySelector('.home-hero');
      if (!hero) return;
      var width = Math.max(1, Math.round(hero.clientWidth || state.layoutWidth));
      var height = Math.max(1, Math.round(hero.clientHeight || state.layoutHeight));
      if (width === state.layoutWidth && height === state.layoutHeight) return;
      var render = renderScale(width, height, state.hybrid);
      state.layoutWidth = width;
      state.layoutHeight = height;
      state.renderWidth = render.width;
      state.renderHeight = render.height;
      applyCanvasSize(state.canvas, width, height, render.width, render.height);
      state.fx.resize(render.width, render.height);
      var bg = buildHeroGlassBackground(render.width, render.height);
      Promise.resolve(state.fx.setBackground(bg)).catch(function () {});
    },
    stop: function () {
      if (!state) return;
      state.running = false;
      try {
        if (state.fx && typeof state.fx.destroy === 'function') state.fx.destroy();
        else if (state.fx && typeof state.fx.stop === 'function') state.fx.stop();
      } catch (e) {}
      if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
      state = null;
    }
  };
})();
