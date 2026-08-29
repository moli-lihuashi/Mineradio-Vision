(function () {
  var TRANSPARENT_BG = {
    day: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'],
    night: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']
  };
  var CANVAS_OVERLAY = {
    'home-rain': {
      background: TRANSPARENT_BG,
      elements: [{ type: 'rain', options: { count: 168, speed: 9.2, opacity: 0.82, wind: 0.08 } }]
    },
    'home-fog': {
      background: TRANSPARENT_BG,
      elements: [{ type: 'fog', options: { count: 48, color: '210, 218, 228' } }]
    },
    'home-snow': {
      background: TRANSPARENT_BG,
      elements: [{ type: 'snow', options: { count: 100, speed: 1.3, opacity: 0.9 } }]
    },
    'home-storm': {
      background: TRANSPARENT_BG,
      elements: [
        { type: 'rain', options: { count: 165, speed: 9.5, opacity: 0.88 } },
        { type: 'lightning', options: {} }
      ]
    }
  };

  var ATMOSPHERE_PRESETS = {
    'partly-cloudy': {
      wash: ['rgba(178, 194, 218, 0.36)', 'rgba(128, 148, 178, 0.22)'],
      blobCount: 8,
      radius: [0.24, 0.46],
      opacity: [0.44, 0.72],
      yRange: [0.0, 0.66],
      drift: [0.11, 0.24],
      blur: 1.04
    },
    overcast: {
      wash: ['rgba(168, 180, 204, 0.14)', 'rgba(108, 122, 148, 0.08)'],
      blobCount: 6,
      radius: [0.22, 0.4],
      opacity: [0.24, 0.38],
      yRange: [0.02, 0.64],
      drift: [0.04, 0.1],
      blur: 1.18
    },
    haze: {
      wash: ['rgba(176, 168, 158, 0.06)', 'rgba(128, 122, 116, 0.03)'],
      blobCount: 5,
      radius: [0.24, 0.42],
      opacity: [0.08, 0.14],
      yRange: [0.12, 0.78],
      drift: [0.03, 0.08],
      blur: 1.35
    }
  };

  var canvasEl = null;
  var rain2dCanvasEl = null;
  var wcRenderer = null;
  var wcRunning = false;
  var atmoState = null;
  var homeRainState = null;
  var homeSnowState = null;
  var homeFogState = null;
  var homeStormState = null;
  var homeHybridState = null;
  var resizeObserver = null;
  var resizeTimer = null;
  var currentKey = '';

  function getRendererClass() {
    var lib = window.WeatherCanvasLib || window.TsLibrary;
    return lib && lib.WeatherCanvasRenderer;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function weatherFxIntensity(weather) {
    var code = Number(weather && weather.weatherCode);
    var precip = Number(weather && weather.precipitation) || 0;
    if ([65, 67, 75, 82, 86, 99].includes(code) || precip >= 4) return 'heavy';
    if ([53, 55, 57, 63, 66, 73, 81, 85, 96].includes(code) || precip >= 1.2) return 'moderate';
    return 'light';
  }

  function mapWeatherToFx(weather) {
    if (!weather) return null;
    var code = Number(weather.weatherCode);
    var intensity = weatherFxIntensity(weather);
    if ([45, 48].includes(code)) return { engine: 'fog2d', intensity: intensity };
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { engine: 'rainHybrid', intensity: intensity };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { engine: 'snow2d', intensity: intensity };
    if ([95, 96, 99].includes(code)) return { engine: 'stormHybrid', intensity: 'heavy', storm: true };
    if (code === 3) return { engine: 'atmo', preset: 'overcast', intensity: intensity };
    if (code === 1 || code === 2) return { engine: 'atmo', preset: 'partly-cloudy', intensity: 'light' };
    if (code === 0) return { engine: 'clear', preset: 'clear', intensity: 'light' };
    return null;
  }

  function weatherWind(weather) {
    var speed = Number(weather && weather.windSpeed);
    if (!Number.isFinite(speed)) return 0;
    return Math.max(-3, Math.min(3, speed / 10));
  }

  function weatherTimeMode(weather) {
    if (weather && Number(weather.isDay) === 0) return 'night';
    if (weather && Number(weather.isDay) === 1) return 'day';
    var hour = new Date().getHours();
    return hour < 6 || hour >= 20 ? 'night' : 'day';
  }

  function ensureCanvas() {
    var hero = document.querySelector('.home-hero');
    if (!hero) return null;
    if (canvasEl && !canvasEl.isConnected) canvasEl = null;
    if (!canvasEl) {
      canvasEl = document.createElement('canvas');
      canvasEl.id = 'home-weather-fx-canvas';
      canvasEl.className = 'home-weather-fx-canvas';
      canvasEl.setAttribute('aria-hidden', 'true');
      hero.insertBefore(canvasEl, hero.firstChild);
    }
    return canvasEl;
  }

  function heroSize() {
    var hero = document.querySelector('.home-hero');
    if (!hero) return { width: 800, height: 400 };
    return {
      width: Math.max(1, Math.round(hero.clientWidth || 800)),
      height: Math.max(1, Math.round(hero.clientHeight || 400))
    };
  }

  function registerOverlayTypes(instance) {
    if (!instance || typeof instance.registerWeather !== 'function') return;
    Object.keys(CANVAS_OVERLAY).forEach(function (name) {
      instance.registerWeather(name, CANVAS_OVERLAY[name]);
    });
  }

  function removeWeatherCanvases() {
    ['home-weather-fx-canvas', 'home-weather-rain-2d-canvas', 'home-weather-raindrop-canvas'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.remove();
    });
    canvasEl = null;
    rain2dCanvasEl = null;
  }

  function ensureRain2dCanvas() {
    var hero = document.querySelector('.home-hero');
    if (!hero) return null;
    if (rain2dCanvasEl && !rain2dCanvasEl.isConnected) rain2dCanvasEl = null;
    if (!rain2dCanvasEl) {
      rain2dCanvasEl = document.createElement('canvas');
      rain2dCanvasEl.id = 'home-weather-rain-2d-canvas';
      rain2dCanvasEl.className = 'home-weather-fx-canvas home-weather-rain-2d-canvas';
      rain2dCanvasEl.setAttribute('aria-hidden', 'true');
      hero.insertBefore(rain2dCanvasEl, hero.firstChild);
    }
    return rain2dCanvasEl;
  }

  function rain2dTargetCanvas() {
    return (homeRainState && homeRainState.canvas) ||
      (homeStormState && homeStormState.canvas) ||
      rain2dCanvasEl ||
      canvasEl;
  }

  function stopHybridRain() {
    homeHybridState = null;
  }

  function stopWeatherGl() {
    if (window.HomeWeatherGl && typeof window.HomeWeatherGl.stop === 'function') {
      window.HomeWeatherGl.stop();
    }
  }

  function glReady() {
    return !!(window.HomeWeatherGl && typeof window.HomeWeatherGl.supported === 'function' && window.HomeWeatherGl.supported());
  }

  function resetFxLayers() {
    stopRaindrop();
    stopWeatherGl();
    stopAtmosphere();
    stopCanvasRenderer();
    stopHomeRain2d();
    stopHomeSnow2d();
    stopHomeFog2d();
    stopHomeStorm2d();
    stopHybridRain();
    removeWeatherCanvases();
    wcRenderer = null;
  }

  function prepareFxCanvas() {
    resetFxLayers();
    return ensureCanvas();
  }

  function setHeroFxClasses(hero, classes) {
    if (!hero) return;
    hero.classList.remove('home-weather-fx-cloud', 'home-weather-fx-atmo', 'home-weather-fx-rain', 'home-weather-fx-snow', 'home-weather-fx-fog', 'home-weather-fx-storm', 'home-weather-fx-hybrid');
    classes.forEach(function (cls) { hero.classList.add(cls); });
    hero.classList.add('home-weather-fx-active');
  }

  function sizeCanvas(el) {
    var size = heroSize();
    el.width = size.width;
    el.height = size.height;
    return size;
  }
  function rainPreset(intensity, hybrid) {
    var mul = hybrid ? 0.68 : 1;
    if (intensity === 'heavy') return { count: Math.round(300 * mul), speed: 12.8, wind: 1.15, alpha: 0.86, length: [14, 30] };
    if (intensity === 'moderate') return { count: Math.round(220 * mul), speed: 10.4, wind: 0.8, alpha: 0.78, length: [12, 24] };
    return { count: Math.round(150 * mul), speed: 8.6, wind: 0.5, alpha: 0.68, length: [10, 20] };
  }

  function applyRain2dCanvasSize(canvas, layoutWidth, layoutHeight, hybrid) {
    var scale = hybrid ? 0.82 : 1;
    if (layoutWidth * layoutHeight > 520000) scale *= hybrid ? 0.88 : 0.94;
    var width = Math.max(1, Math.round(layoutWidth * scale));
    var height = Math.max(1, Math.round(layoutHeight * scale));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = layoutWidth + 'px';
    canvas.style.height = layoutHeight + 'px';
    return { width: width, height: height };
  }

  function stepRainDrops(drops, w, h, driftScale, storm) {
    drops.forEach(function (drop) {
      drop.y += drop.speed;
      drop.x += drop.drift * (driftScale || 0.07);
      if (storm) {
        if (drop.y > h + drop.len * 1.5) {
          drop.y = -drop.len - Math.random() * h * 0.35;
          drop.x = Math.random() * w;
        }
      } else if (drop.y > h + drop.len) {
        drop.y = -drop.len;
        drop.x = Math.random() * w;
      }
      var bound = storm ? 24 : 20;
      if (drop.x > w + bound) drop.x = -bound;
      else if (drop.x < -bound) drop.x = w + bound;
    });
  }

  function rain2dDrawInterval() {
    return (homeHybridState && homeHybridState.running) ? 32 : 0;
  }

  function snowPreset(intensity) {
    if (intensity === 'heavy') return { count: 140, speed: 2.4, wind: 0.9, alpha: 0.92, size: [2.2, 5.8] };
    if (intensity === 'moderate') return { count: 100, speed: 1.8, wind: 0.65, alpha: 0.88, size: [1.8, 4.8] };
    return { count: 72, speed: 1.35, wind: 0.45, alpha: 0.82, size: [1.4, 3.8] };
  }

  function fogPreset(intensity) {
    if (intensity === 'heavy') return { count: 18, speed: 0.42, wind: 0.55, alpha: [0.16, 0.28], radius: [58, 118] };
    if (intensity === 'moderate') return { count: 14, speed: 0.34, wind: 0.42, alpha: [0.12, 0.22], radius: [48, 102] };
    return { count: 10, speed: 0.26, wind: 0.32, alpha: [0.09, 0.17], radius: [42, 88] };
  }

  function buildRainDrops(width, height, preset) {
    var drops = [];
    for (var i = 0; i < preset.count; i++) {
      drops.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: preset.length[0] + Math.random() * (preset.length[1] - preset.length[0]),
        speed: preset.speed * (0.72 + Math.random() * 0.56),
        alpha: preset.alpha * (0.62 + Math.random() * 0.38),
        drift: preset.wind * (0.55 + Math.random() * 0.9)
      });
    }
    return drops;
  }

  function stopHomeRain2d() {
    if (!homeRainState) return;
    if (homeRainState.animId) cancelAnimationFrame(homeRainState.animId);
    homeRainState.running = false;
    homeRainState = null;
  }

  function drawHomeRain2d() {
    if (!homeRainState || !homeRainState.running) return;
    if (document.hidden) { // 后台/最小化：挂起绘制，恢复后原地继续
      homeRainState.animId = requestAnimationFrame(drawHomeRain2d);
      return;
    }
    var target = homeRainState.canvas || canvasEl;
    if (!target) return;
    var w = homeRainState.width;
    var h = homeRainState.height;
    stepRainDrops(homeRainState.drops, w, h, 0.07);

    var interval = rain2dDrawInterval();
    var now = performance.now();
    if (interval && homeRainState.lastDraw && (now - homeRainState.lastDraw) < interval) {
      homeRainState.animId = requestAnimationFrame(drawHomeRain2d);
      return;
    }
    homeRainState.lastDraw = now;

    var ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    homeRainState.drops.forEach(function (drop) {
      ctx.strokeStyle = 'rgba(210, 228, 248, ' + drop.alpha + ')';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + drop.drift, drop.y + drop.len);
      ctx.stroke();
    });
    homeRainState.animId = requestAnimationFrame(drawHomeRain2d);
  }

  function startHomeRain2d(intensity, weather) {
    var el = prepareFxCanvas();
    var hero = document.querySelector('.home-hero');
    if (!el || !hero) return;
    var size = sizeCanvas(el);
    var preset = rainPreset(intensity);
    preset.wind += weatherWind(weather) * 0.35;
    homeRainState = {
      canvas: el,
      width: size.width,
      height: size.height,
      intensity: intensity || 'light',
      drops: buildRainDrops(size.width, size.height, preset),
      running: true,
      animId: null
    };
    drawHomeRain2d();
    setHeroFxClasses(hero, ['home-weather-fx-rain']);
  }

  function resizeHomeRain2d() {
    if (!homeRainState || !homeRainState.running) return;
    var layout = heroSize();
    if (layout.width === homeRainState.layoutWidth && layout.height === homeRainState.layoutHeight) return;
    var target = homeRainState.canvas || canvasEl;
    var size = target
      ? applyRain2dCanvasSize(target, layout.width, layout.height, !!(homeHybridState && homeHybridState.running))
      : layout;
    homeRainState.layoutWidth = layout.width;
    homeRainState.layoutHeight = layout.height;
    homeRainState.width = size.width;
    homeRainState.height = size.height;
    homeRainState.drops = buildRainDrops(size.width, size.height, rainPreset(homeRainState.intensity, !!(homeHybridState && homeHybridState.running)));
  }

  function buildSnowflakes(width, height, preset) {
    var flakes = [];
    for (var i = 0; i < preset.count; i++) {
      flakes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: preset.size[0] + Math.random() * (preset.size[1] - preset.size[0]),
        speed: preset.speed * (0.7 + Math.random() * 0.6),
        alpha: preset.alpha * (0.72 + Math.random() * 0.28),
        drift: preset.wind * (0.45 + Math.random() * 0.85),
        spin: rand(-0.04, 0.04),
        angle: rand(0, Math.PI * 2)
      });
    }
    return flakes;
  }

  function stopHomeSnow2d() {
    if (!homeSnowState) return;
    if (homeSnowState.animId) cancelAnimationFrame(homeSnowState.animId);
    homeSnowState.running = false;
    homeSnowState = null;
  }

  function drawSnowflake(ctx, x, y, size, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = Math.max(0.8, size * 0.22);
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -size);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHomeSnow2d() {
    if (!homeSnowState || !homeSnowState.running || !canvasEl) return;
    if (document.hidden) { // 后台/最小化：挂起绘制
      homeSnowState.animId = requestAnimationFrame(drawHomeSnow2d);
      return;
    }
    var ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    var w = homeSnowState.width;
    var h = homeSnowState.height;
    ctx.clearRect(0, 0, w, h);
    homeSnowState.flakes.forEach(function (flake) {
      ctx.globalAlpha = flake.alpha;
      drawSnowflake(ctx, flake.x, flake.y, flake.size, flake.angle);
      flake.y += flake.speed;
      flake.x += flake.drift * 0.12;
      flake.angle += flake.spin;
      if (flake.y > h + flake.size) {
        flake.y = -flake.size;
        flake.x = Math.random() * w;
      }
      if (flake.x > w + 16) flake.x = -16;
      else if (flake.x < -16) flake.x = w + 16;
    });
    ctx.globalAlpha = 1;
    homeSnowState.animId = requestAnimationFrame(drawHomeSnow2d);
  }

  function startHomeSnow2d(intensity, weather) {
    var el = prepareFxCanvas();
    var hero = document.querySelector('.home-hero');
    if (!el || !hero) return;
    var size = sizeCanvas(el);
    var preset = snowPreset(intensity);
    preset.wind += weatherWind(weather) * 0.28;
    homeSnowState = {
      width: size.width,
      height: size.height,
      intensity: intensity || 'light',
      flakes: buildSnowflakes(size.width, size.height, preset),
      running: true,
      animId: null
    };
    drawHomeSnow2d();
    setHeroFxClasses(hero, ['home-weather-fx-snow']);
  }

  function resizeHomeSnow2d() {
    if (!homeSnowState || !homeSnowState.running) return;
    var size = heroSize();
    if (size.width === homeSnowState.width && size.height === homeSnowState.height) return;
    homeSnowState.width = size.width;
    homeSnowState.height = size.height;
    if (canvasEl) {
      canvasEl.width = size.width;
      canvasEl.height = size.height;
    }
    homeSnowState.flakes = buildSnowflakes(size.width, size.height, snowPreset(homeSnowState.intensity));
  }

  function buildFogParticles(width, height, preset) {
    var particles = [];
    for (var i = 0; i < preset.count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: preset.radius[0] + Math.random() * (preset.radius[1] - preset.radius[0]),
        speed: preset.speed * (0.75 + Math.random() * 0.5),
        alpha: preset.alpha[0] + Math.random() * (preset.alpha[1] - preset.alpha[0]),
        drift: preset.wind * (0.5 + Math.random() * 0.8)
      });
    }
    return particles;
  }

  function stopHomeFog2d() {
    if (!homeFogState) return;
    if (homeFogState.animId) cancelAnimationFrame(homeFogState.animId);
    homeFogState.running = false;
    homeFogState = null;
  }

  function drawHomeFog2d() {
    if (!homeFogState || !homeFogState.running || !canvasEl) return;
    if (document.hidden) { // 后台/最小化：挂起绘制
      homeFogState.animId = requestAnimationFrame(drawHomeFog2d);
      return;
    }
    var ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    var w = homeFogState.width;
    var h = homeFogState.height;
    ctx.clearRect(0, 0, w, h);
    var wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, 'rgba(198, 208, 222, 0.08)');
    wash.addColorStop(1, 'rgba(168, 180, 198, 0.14)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    homeFogState.particles.forEach(function (particle) {
      var gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.radius);
      gradient.addColorStop(0, 'rgba(214, 222, 234, ' + particle.alpha + ')');
      gradient.addColorStop(0.55, 'rgba(188, 198, 214, ' + (particle.alpha * 0.55) + ')');
      gradient.addColorStop(1, 'rgba(168, 180, 198, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
      particle.x += particle.speed + particle.drift * 0.08;
      if (particle.x > w + particle.radius) particle.x = -particle.radius;
      else if (particle.x < -particle.radius) particle.x = w + particle.radius;
    });
    homeFogState.animId = requestAnimationFrame(drawHomeFog2d);
  }

  function startHomeFog2d(intensity, weather) {
    var el = prepareFxCanvas();
    var hero = document.querySelector('.home-hero');
    if (!el || !hero) return;
    var size = sizeCanvas(el);
    var preset = fogPreset(intensity);
    preset.wind += weatherWind(weather) * 0.22;
    homeFogState = {
      width: size.width,
      height: size.height,
      intensity: intensity || 'light',
      particles: buildFogParticles(size.width, size.height, preset),
      running: true,
      animId: null
    };
    drawHomeFog2d();
    setHeroFxClasses(hero, ['home-weather-fx-fog']);
  }

  function resizeHomeFog2d() {
    if (!homeFogState || !homeFogState.running) return;
    var size = heroSize();
    if (size.width === homeFogState.width && size.height === homeFogState.height) return;
    homeFogState.width = size.width;
    homeFogState.height = size.height;
    if (canvasEl) {
      canvasEl.width = size.width;
      canvasEl.height = size.height;
    }
    homeFogState.particles = buildFogParticles(size.width, size.height, fogPreset(homeFogState.intensity));
  }

  function stopHomeStorm2d() {
    if (!homeStormState) return;
    if (homeStormState.animId) cancelAnimationFrame(homeStormState.animId);
    homeStormState.running = false;
    homeStormState = null;
  }

  function drawStormBolt(ctx, w, h, bolt) {
    if (!bolt) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 248, 210, 0.92)';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(bolt.x, 0);
    var x = bolt.x;
    var y = 0;
    for (var i = 0; i < bolt.segments; i++) {
      x += bolt.dxs[i];
      y += h / bolt.segments;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawHomeStorm2d() {
    if (!homeStormState || !homeStormState.running) return;
    if (document.hidden) { // 后台/最小化：挂起绘制
      homeStormState.animId = requestAnimationFrame(drawHomeStorm2d);
      return;
    }
    var target = homeStormState.canvas || canvasEl;
    if (!target) return;
    var w = homeStormState.width;
    var h = homeStormState.height;
    stepRainDrops(homeStormState.drops, w, h, 0.08, true);

    var interval = rain2dDrawInterval();
    var now = performance.now();
    if (interval && homeStormState.lastDraw && (now - homeStormState.lastDraw) < interval) {
      if (homeStormState.lightningFlash > 0) homeStormState.lightningFlash = Math.max(0, homeStormState.lightningFlash - 0.07);
      else if (Math.random() < 0.012) {
        var segments = 4 + Math.floor(Math.random() * 3);
        var dxs = [];
        for (var s = 0; s < segments; s++) dxs.push((Math.random() - 0.5) * 42);
        homeStormState.bolt = { x: w * (0.22 + Math.random() * 0.56), segments: segments, dxs: dxs };
        homeStormState.lightningFlash = 1;
      }
      homeStormState.animId = requestAnimationFrame(drawHomeStorm2d);
      return;
    }
    homeStormState.lastDraw = now;

    var ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (homeStormState.lightningFlash > 0) {
      ctx.fillStyle = 'rgba(235, 242, 255, ' + (homeStormState.lightningFlash * 0.24) + ')';
      ctx.fillRect(0, 0, w, h);
      if (homeStormState.lightningFlash > 0.62) drawStormBolt(ctx, w, h, homeStormState.bolt);
      homeStormState.lightningFlash = Math.max(0, homeStormState.lightningFlash - 0.07);
    } else if (Math.random() < 0.012) {
      var seg = 4 + Math.floor(Math.random() * 3);
      var stormDxs = [];
      for (var i = 0; i < seg; i++) stormDxs.push((Math.random() - 0.5) * 42);
      homeStormState.bolt = { x: w * (0.22 + Math.random() * 0.56), segments: seg, dxs: stormDxs };
      homeStormState.lightningFlash = 1;
    }
    ctx.lineCap = 'round';
    homeStormState.drops.forEach(function (drop) {
      ctx.strokeStyle = 'rgba(196, 214, 248, ' + drop.alpha + ')';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + drop.drift, drop.y + drop.len);
      ctx.stroke();
    });
    homeStormState.animId = requestAnimationFrame(drawHomeStorm2d);
  }

  function startHomeStorm2d(weather) {
    var el = prepareFxCanvas();
    var hero = document.querySelector('.home-hero');
    if (!el || !hero) return;
    var size = sizeCanvas(el);
    var preset = rainPreset('heavy');
    preset.wind += weatherWind(weather) * 0.45;
    homeStormState = {
      canvas: el,
      width: size.width,
      height: size.height,
      drops: buildRainDrops(size.width, size.height, preset),
      lightningFlash: 0,
      bolt: null,
      running: true,
      animId: null
    };
    drawHomeStorm2d();
    setHeroFxClasses(hero, ['home-weather-fx-storm', 'home-weather-fx-rain']);
  }

  function resizeHomeStorm2d() {
    if (!homeStormState || !homeStormState.running) return;
    var layout = heroSize();
    if (layout.width === homeStormState.layoutWidth && layout.height === homeStormState.layoutHeight) return;
    var target = homeStormState.canvas || canvasEl;
    var size = target
      ? applyRain2dCanvasSize(target, layout.width, layout.height, !!(homeHybridState && homeHybridState.running))
      : layout;
    homeStormState.layoutWidth = layout.width;
    homeStormState.layoutHeight = layout.height;
    homeStormState.width = size.width;
    homeStormState.height = size.height;
    homeStormState.drops = buildRainDrops(size.width, size.height, rainPreset('heavy', !!(homeHybridState && homeHybridState.running)));
  }

  function startRainHybrid(intensity, weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    var el = ensureRain2dCanvas();
    if (!el || !hero) return;
    var layout = heroSize();
    var size = applyRain2dCanvasSize(el, layout.width, layout.height, true);
    var preset = rainPreset(intensity, true);
    preset.wind += weatherWind(weather) * 0.35;
    homeRainState = {
      canvas: el,
      width: size.width,
      height: size.height,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      intensity: intensity || 'light',
      drops: buildRainDrops(size.width, size.height, preset),
      running: true,
      animId: null,
      lastDraw: 0
    };
    drawHomeRain2d();
    homeHybridState = { running: true, storm: false, intensity: intensity || 'light' };
    if (window.HomeRaindropFx && typeof window.HomeRaindropFx.start === 'function' && window.HomeRaindropFx.supported()) {
      window.HomeRaindropFx.start(intensity, false, { hybrid: true, rainCanvas: el });
      setHeroFxClasses(hero, ['home-weather-fx-rain', 'home-weather-fx-hybrid']);
      return;
    }
    setHeroFxClasses(hero, ['home-weather-fx-rain']);
  }

  function startStormHybrid(weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    var el = ensureRain2dCanvas();
    if (!el || !hero) return;
    var layout = heroSize();
    var size = applyRain2dCanvasSize(el, layout.width, layout.height, true);
    var preset = rainPreset('heavy', true);
    preset.wind += weatherWind(weather) * 0.45;
    homeStormState = {
      canvas: el,
      width: size.width,
      height: size.height,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      drops: buildRainDrops(size.width, size.height, preset),
      lightningFlash: 0,
      bolt: null,
      running: true,
      animId: null,
      lastDraw: 0
    };
    drawHomeStorm2d();
    homeHybridState = { running: true, storm: true, intensity: 'heavy' };
    if (window.HomeRaindropFx && typeof window.HomeRaindropFx.start === 'function' && window.HomeRaindropFx.supported()) {
      window.HomeRaindropFx.start('heavy', true, { hybrid: true, rainCanvas: el });
      setHeroFxClasses(hero, ['home-weather-fx-storm', 'home-weather-fx-rain', 'home-weather-fx-hybrid']);
      return;
    }
    setHeroFxClasses(hero, ['home-weather-fx-storm', 'home-weather-fx-rain']);
  }

  function resizeHybridRain() {
    if (homeRainState && homeRainState.running) resizeHomeRain2d();
    else if (homeStormState && homeStormState.running) resizeHomeStorm2d();
    if (window.HomeRaindropFx && window.HomeRaindropFx.active && window.HomeRaindropFx.active()) {
      window.HomeRaindropFx.resize();
    }
  }

  // ---------- GL 天气引擎启动函数 ----------
  function startRainGl(intensity, weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    var glassOk = !!(window.HomeRaindropFx && typeof window.HomeRaindropFx.start === 'function' && window.HomeRaindropFx.supported());
    if (glassOk) window.HomeRaindropFx.start(intensity, false, { hybrid: true });
    var ok = window.HomeWeatherGl.start('rain', intensity, { hybrid: glassOk, weather: weather });
    if (!ok) return false;
    homeHybridState = { running: true, storm: false, intensity: intensity };
    setHeroFxClasses(hero, glassOk ? ['home-weather-fx-rain', 'home-weather-fx-hybrid'] : ['home-weather-fx-rain']);
    return true;
  }

  function startStormGl(weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    var glassOk = !!(window.HomeRaindropFx && typeof window.HomeRaindropFx.start === 'function' && window.HomeRaindropFx.supported());
    if (glassOk) window.HomeRaindropFx.start('heavy', true, { hybrid: true });
    var ok = window.HomeWeatherGl.start('storm', 'heavy', { hybrid: glassOk, storm: true, weather: weather });
    if (!ok) return false;
    homeHybridState = { running: true, storm: true, intensity: 'heavy' };
    setHeroFxClasses(hero, glassOk
      ? ['home-weather-fx-storm', 'home-weather-fx-rain', 'home-weather-fx-hybrid']
      : ['home-weather-fx-storm', 'home-weather-fx-rain']);
    return true;
  }

  function startSnowGl(intensity, weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    if (!window.HomeWeatherGl.start('snow', intensity, { weather: weather })) return false;
    homeHybridState = { running: true, storm: false, intensity: intensity };
    setHeroFxClasses(hero, ['home-weather-fx-snow']);
    return true;
  }

  function startFogGl(intensity, weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    if (!window.HomeWeatherGl.start('fog', intensity, { weather: weather })) return false;
    homeHybridState = { running: true, storm: false, intensity: intensity };
    setHeroFxClasses(hero, ['home-weather-fx-fog']);
    return true;
  }

  function startAtmoGl(preset, intensity, weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    if (!window.HomeWeatherGl.start('atmo', intensity, { preset: preset, weather: weather })) return false;
    homeHybridState = { running: true, storm: false, intensity: intensity };
    setHeroFxClasses(hero, ['home-weather-fx-cloud']);
    hero.classList.add('home-weather-fx-active');
    return true;
  }

  function startClearGl(weather) {
    resetFxLayers();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    if (!window.HomeWeatherGl.start('clear', 'light', { weather: weather })) return false;
    homeHybridState = { running: true, storm: false, intensity: 'light' };
    setHeroFxClasses(hero, ['home-weather-fx-atmo']);
    hero.classList.add('home-weather-fx-active');
    return true;
  }

  function stopCanvasRenderer() {
    if (wcRenderer && typeof wcRenderer.stop === 'function') wcRenderer.stop();
    wcRunning = false;
  }

  function stopRaindrop() {
    if (window.HomeRaindropFx && typeof window.HomeRaindropFx.stop === 'function') {
      window.HomeRaindropFx.stop();
    }
  }

  function resetFxEngines() {
    resetFxLayers();
  }

  function fxEngineActive() {
    return !!(
      (homeRainState && homeRainState.running) ||
      (homeSnowState && homeSnowState.running) ||
      (homeFogState && homeFogState.running) ||
      (homeStormState && homeStormState.running) ||
      (homeHybridState && homeHybridState.running) ||
      (atmoState && atmoState.running) ||
      wcRunning ||
      (window.HomeVolCloudFx && window.HomeVolCloudFx.active && window.HomeVolCloudFx.active()) ||
      (window.HomeRaindropFx && window.HomeRaindropFx.active && window.HomeRaindropFx.active()) ||
      (window.HomeWeatherGl && window.HomeWeatherGl.active && window.HomeWeatherGl.active())
    );
  }

  function stopAtmosphere() {
    if (window.HomeVolCloudFx && typeof window.HomeVolCloudFx.stop === 'function') {
      window.HomeVolCloudFx.stop();
    }
    if (!atmoState) return;
    if (atmoState.animId) cancelAnimationFrame(atmoState.animId);
    atmoState.animId = null;
    atmoState.running = false;
    atmoState = null;
  }

  function buildAtmosphereBlobs(width, height, presetName, wind) {
    var preset = ATMOSPHERE_PRESETS[presetName] || ATMOSPHERE_PRESETS['partly-cloudy'];
    var base = Math.min(width, height);
    var blobs = [];
    for (var i = 0; i < preset.blobCount; i++) {
      blobs.push({
        x: rand(0, width),
        y: rand(height * preset.yRange[0], height * preset.yRange[1]),
        radius: rand(base * preset.radius[0], base * preset.radius[1]),
        opacity: rand(preset.opacity[0], preset.opacity[1]),
        drift: rand(preset.drift[0], preset.drift[1]) * (wind >= 0 ? 1 : -1),
        lift: rand(-0.08, 0.08),
        wobble: rand(0.0007, 0.0016),
        phase: rand(0, Math.PI * 2),
        wobbleAmp: rand(4, 14),
        depth: rand(0.35, 1)
      });
    }
    return { preset: preset, blobs: blobs, wind: wind, time: 0 };
  }

  function drawAtmosphereWash(ctx, width, height, preset) {
    var wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, preset.wash[0]);
    wash.addColorStop(1, preset.wash[1]);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
  }

  // 云团光斑预渲染：启动时烘焙 3 张软光斑贴图，每帧只做 drawImage，
  // 替代每团每帧 3 个 createRadialGradient + ctx.filter=blur()（Chromium 软件高斯路径）
  var atmoBlobSprites = null;
  function ensureAtmoBlobSprites() {
    if (atmoBlobSprites) return atmoBlobSprites;
    function makeSprite(size, cx, cy, radius, stops, blurPx) {
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var g = c.getContext('2d');
      if (blurPx) g.filter = 'blur(' + blurPx + 'px)';
      var grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      stops.forEach(function (s) { grad.addColorStop(s[0], s[1]); });
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    }
    atmoBlobSprites = {
      shadow: makeSprite(160, 80, 80, 80, [
        [0, 'rgba(118,132,154,1)'], [0.55, 'rgba(96,108,128,0.47)'], [1, 'rgba(72,82,98,0)']
      ], 6),
      body: makeSprite(160, 80, 80, 80, [
        [0, 'rgba(248,250,255,1)'], [0.28, 'rgba(228,234,244,0.65)'],
        [0.62, 'rgba(196,206,222,0.27)'], [1, 'rgba(160,172,190,0)']
      ], 4),
      // 高光保持离心的偏移感：渐变中心烤在贴图内偏左上
      highlight: makeSprite(96, 36, 34, 50, [
        [0, 'rgba(255,255,255,1)'], [0.45, 'rgba(240,246,255,0.29)'], [1, 'rgba(255,255,255,0)']
      ], 0)
    };
    return atmoBlobSprites;
  }

  function drawVolumetricBlob(ctx, blob, time) {
    var sprites = ensureAtmoBlobSprites();
    var x = blob.x + Math.sin(time * blob.wobble + blob.phase) * blob.wobbleAmp;
    var y = blob.y + Math.sin(time * blob.wobble * 0.7 + blob.phase * 1.4) * 2.5;
    var r = blob.radius * (0.92 + blob.depth * 0.12);
    var alpha = blob.opacity * (0.88 + blob.depth * 0.42);

    // 阴影层（原：中心偏移 (r*0.12, r*0.16)，半径 r*1.15）
    var sr = r * 1.15;
    ctx.globalAlpha = Math.min(1, alpha * 0.34);
    ctx.drawImage(sprites.shadow, x + r * 0.12 - sr, y + r * 0.16 - sr, sr * 2, sr * 2);

    // 主体层（原：中心偏移 (-r*0.18, -r*0.12)，半径 r*0.92）
    var br = r * 0.92;
    ctx.globalAlpha = Math.min(1, alpha * 0.52);
    ctx.drawImage(sprites.body, x - r * 0.18 - br, y - r * 0.12 - br, br * 2, br * 2);

    // 高光层（原：中心 (-r*0.08, -r*0.08)，半径 r*0.42）
    var hr = r * 0.42;
    ctx.globalAlpha = Math.min(1, alpha * 0.42);
    ctx.drawImage(sprites.highlight, x - r * 0.08 - hr, y - r * 0.08 - hr, hr * 2, hr * 2);
    ctx.globalAlpha = 1;
  }

  function tickAtmosphere() {
    if (!atmoState || !atmoState.running || atmoState.engine !== 'canvas2d' || !canvasEl) return;
    if (document.hidden) { // 后台/最小化：挂起绘制
      atmoState.animId = requestAnimationFrame(tickAtmosphere);
      return;
    }
    var ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    var width = atmoState.width;
    var height = atmoState.height;
    var preset = atmoState.preset;
    atmoState.time += 1;

    ctx.clearRect(0, 0, width, height);
    drawAtmosphereWash(ctx, width, height, preset);

    // blobs 的 depth 固定不变，仅在（重）建后排序一次；resize 会重建 atmoState，标志随之复位
    if (!atmoState.blobsSorted) {
      atmoState.blobs.sort(function (a, b) { return a.depth - b.depth; });
      atmoState.blobsSorted = true;
    }
    atmoState.blobs.forEach(function (blob) {
      blob.x += blob.drift + atmoState.wind * 0.015 * blob.depth;
      blob.y += blob.lift * 0.015;
      if (blob.x > width + blob.radius) blob.x = -blob.radius;
      if (blob.x < -blob.radius) blob.x = width + blob.radius;
      drawVolumetricBlob(ctx, blob, atmoState.time);
    });

    atmoState.animId = requestAnimationFrame(tickAtmosphere);
  }

  function startRaindropFx(fx, weather) {
    resetFxEngines();
    var hero = document.querySelector('.home-hero');
    if (!hero) return false;
    if (window.HomeRaindropFx && typeof window.HomeRaindropFx.start === 'function' && window.HomeRaindropFx.supported()) {
      if (window.HomeRaindropFx.start(fx.intensity, !!fx.storm)) {
        hero.classList.remove('home-weather-fx-cloud', 'home-weather-fx-atmo');
        hero.classList.add('home-weather-fx-rain', 'home-weather-fx-active');
        return true;
      }
    }
    startCanvasFx({ engine: 'canvas', type: fx.storm ? 'home-storm' : 'home-rain', intensity: fx.intensity }, weather);
    return false;
  }

  function startAtmosphere(presetName, wind, weather) {
    stopRaindrop();
    stopHomeRain2d();
    stopCanvasRenderer();
    var staleCanvas = document.getElementById('home-weather-fx-canvas');
    if (staleCanvas) staleCanvas.remove();
    canvasEl = null;
    if (window.HomeVolCloudFx && typeof window.HomeVolCloudFx.start === 'function' && window.HomeVolCloudFx.supported()) {
      if (window.HomeVolCloudFx.start(presetName, weather, wind)) {
        atmoState = { engine: 'volcloud', presetName: presetName, wind: wind, running: true };
        return;
      }
    }
    var el = ensureCanvas();
    if (!el) return;
    var size = heroSize();
    el.width = size.width;
    el.height = size.height;
    atmoState = {
      engine: 'canvas2d',
      presetName: presetName,
      preset: ATMOSPHERE_PRESETS[presetName] || ATMOSPHERE_PRESETS['partly-cloudy'],
      blobs: buildAtmosphereBlobs(size.width, size.height, presetName, wind).blobs,
      width: size.width,
      height: size.height,
      wind: wind,
      time: 0,
      running: true,
      animId: null
    };
    tickAtmosphere();
  }

  function resizeAtmosphere() {
    if (!atmoState) return;
    if (atmoState.engine === 'volcloud' && window.HomeVolCloudFx && typeof window.HomeVolCloudFx.resize === 'function') {
      window.HomeVolCloudFx.resize();
      return;
    }
    if (atmoState.engine === 'canvas2d') startAtmosphere(atmoState.presetName || 'partly-cloudy', atmoState.wind || 0);
  }

  function resizeCanvasRenderer() {
    if (!wcRenderer || !canvasEl) return;
    var size = heroSize();
    if (typeof wcRenderer.setSize === 'function') wcRenderer.setSize(size.width, size.height);
  }

  function resizeActiveFx() {
    if (homeHybridState && homeHybridState.running) {
      resizeHybridRain();
      if (window.HomeWeatherGl && window.HomeWeatherGl.active && window.HomeWeatherGl.active()) {
        window.HomeWeatherGl.resize();
      }
      return;
    }
    if (window.HomeWeatherGl && window.HomeWeatherGl.active && window.HomeWeatherGl.active()) {
      window.HomeWeatherGl.resize();
      return;
    }
    if (homeRainState && homeRainState.running) {
      resizeHomeRain2d();
      return;
    }
    if (homeSnowState && homeSnowState.running) {
      resizeHomeSnow2d();
      return;
    }
    if (homeFogState && homeFogState.running) {
      resizeHomeFog2d();
      return;
    }
    if (homeStormState && homeStormState.running) {
      resizeHomeStorm2d();
      return;
    }
    if (window.HomeRaindropFx && window.HomeRaindropFx.active && window.HomeRaindropFx.active()) {
      window.HomeRaindropFx.resize();
      return;
    }
    if (atmoState && atmoState.running) resizeAtmosphere();
    else if (wcRenderer) resizeCanvasRenderer();
  }

  function startCanvasFx(fx, weather) {
    var WeatherCanvasRenderer = getRendererClass();
    if (!WeatherCanvasRenderer) return;
    stopRaindrop();
    stopHomeRain2d();
    stopAtmosphere();
    var el = ensureCanvas();
    var hero = document.querySelector('.home-hero');
    if (!el || !hero) return;
    var size = heroSize();
    if (!wcRenderer) {
      wcRenderer = new WeatherCanvasRenderer(el, { width: size.width, height: size.height, fps: 30 });
      registerOverlayTypes(wcRenderer);
    } else {
      resizeCanvasRenderer();
    }
    var mode = weatherTimeMode(weather);
    wcRenderer.setWind(weatherWind(weather));
    wcRenderer.render(fx.type, mode, fx.intensity);
    wcRenderer.start();
    wcRunning = true;
    hero.classList.remove('home-weather-fx-cloud', 'home-weather-fx-atmo', 'home-weather-fx-rain');
    if (fx.type === 'home-rain' || fx.type === 'home-storm') {
      hero.classList.add('home-weather-fx-rain', 'home-weather-fx-active');
    } else {
      hero.classList.add('home-weather-fx-atmo', 'home-weather-fx-active');
    }
  }

  function bindResizeObserver() {
    if (resizeObserver || typeof ResizeObserver === 'undefined') return;
    var hero = document.querySelector('.home-hero');
    if (!hero) return;
    resizeObserver = new ResizeObserver(function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeActiveFx, 120);
    });
    resizeObserver.observe(hero);
  }

  window.syncHomeWeatherFx = function (opts) {
    opts = opts || {};
    if (window.homeWeatherRadioState && window.homeWeatherRadioState.testMode) {
      opts.force = true;
      opts.testBypass = true;
    }
    // 移除 emptyHomeActive 限制：任何主页状态都允许天气效果
    if (opts.force) opts.testBypass = true;
    if (!opts.testBypass && prefersReducedMotion()) {
      window.stopHomeWeatherFx();
      return;
    }
    var weather = window.homeWeatherRadioState && window.homeWeatherRadioState.weather;
    var fx = mapWeatherToFx(weather);
    var hero = document.querySelector('.home-hero');
    if (!fx) {
      window.stopHomeWeatherFx();
      return;
    }
    if (!hero) return;
    bindResizeObserver();

    var key = fx.engine + '|' + (fx.type || fx.preset || (fx.storm ? 'storm' : 'rain')) + '|' + (fx.intensity || 'light');
    if (key === currentKey && fxEngineActive()) {
      hero.classList.add('home-weather-fx-active');
      return;
    }
    currentKey = key;

    if (fx.engine === 'raindrop') {
      startRaindropFx(fx, weather);
      return;
    }

    if (fx.engine === 'rainHybrid') {
      if (glReady() && startRainGl(fx.intensity, weather)) return;
      startRainHybrid(fx.intensity, weather);
      return;
    }

    if (fx.engine === 'rain2d') {
      if (glReady() && startRainGl(fx.intensity, weather)) return;
      startHomeRain2d(fx.intensity, weather);
      return;
    }

    if (fx.engine === 'snow2d') {
      if (glReady() && startSnowGl(fx.intensity, weather)) return;
      startHomeSnow2d(fx.intensity, weather);
      return;
    }

    if (fx.engine === 'fog2d') {
      if (glReady() && startFogGl(fx.intensity, weather)) return;
      startHomeFog2d(fx.intensity, weather);
      return;
    }

    if (fx.engine === 'stormHybrid') {
      if (glReady() && startStormGl(weather)) return;
      startStormHybrid(weather);
      return;
    }

    if (fx.engine === 'storm2d') {
      if (glReady() && startStormGl(weather)) return;
      startHomeStorm2d(weather);
      return;
    }

    if (fx.engine === 'canvas') {
      startCanvasFx(fx, weather);
      return;
    }

    if (fx.engine === 'atmo') {
      if (glReady() && startAtmoGl(fx.preset, fx.intensity, weather)) return;
      startAtmosphere(fx.preset, weatherWind(weather), weather);
      hero.classList.remove('home-weather-fx-atmo');
      hero.classList.add('home-weather-fx-cloud', 'home-weather-fx-active');
      return;
    }

    if (fx.engine === 'clear') {
      if (glReady() && startClearGl(weather)) return;
      window.stopHomeWeatherFx();
      return;
    }

    startCanvasFx(fx, weather);
    hero.classList.add('home-weather-fx-active');
  };

  window.stopHomeWeatherFx = function () {
    currentKey = '';
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    resetFxEngines();
    var hero = document.querySelector('.home-hero');
    if (hero) hero.classList.remove('home-weather-fx-active', 'home-weather-fx-cloud', 'home-weather-fx-atmo', 'home-weather-fx-rain', 'home-weather-fx-snow', 'home-weather-fx-fog', 'home-weather-fx-storm', 'home-weather-fx-hybrid');
  };
})();
