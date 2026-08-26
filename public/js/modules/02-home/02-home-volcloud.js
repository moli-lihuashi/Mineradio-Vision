(function () {
  var volState = null;

  function hasThree() {
    return typeof window.THREE === 'object' && window.THREE.WebGLRenderer;
  }

  function presetParams(presetName) {
    if (presetName === 'overcast') {
      return { coverage: 0.38, density: 1.75, steps: 54, colorGain: 2.8, alphaGain: 3.0, fogStrength: 1.05 };
    }
    if (presetName === 'haze') {
      return { coverage: 0.42, density: 0.95, steps: 40, colorGain: 1.4, alphaGain: 1.5, fogStrength: 1.25 };
    }
    return { coverage: 0.14, density: 2.55, steps: 46, colorGain: 6.8, alphaGain: 5.8, fogStrength: 1.62 };
  }

  var FRAGMENT = [
    'precision highp float;',
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform float uCoverage;',
    'uniform float uDensity;',
    'uniform float uWind;',
    'uniform vec3 uSunDir;',
    'uniform int uSteps;',
    'uniform float uColorGain;',
    'uniform float uAlphaGain;',
    'uniform float uFogStrength;',
    'varying vec2 vUv;',
    'float hash(vec3 p){',
    '  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));',
    '  p += dot(p, p.yzx + 19.19);',
    '  return fract((p.x + p.y) * p.z);',
    '}',
    'float noise(vec3 p){',
    '  vec3 i = floor(p); vec3 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
    '    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);',
    '}',
    'float fbm(vec3 p){',
    '  float v = 0.0; float a = 0.5; mat3 m = mat3(0.8,0.6,0.0,-0.6,0.8,0.0,0.0,0.0,1.0);',
    '  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p * 2.02 + 0.07; a *= 0.5; }',
    '  return v;',
    '}',
    'float worley(vec3 p){',
    '  vec3 id = floor(p); vec3 f = fract(p); float d = 1.0;',
    '  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {',
    '    vec3 g = vec3(float(x), float(y), float(z));',
    '    vec3 o = hash(id + g) * vec3(1.0);',
    '    d = min(d, length(g + o - f));',
    '  }',
    '  return 1.0 - d;',
    '}',
    'float sampleCloud(vec3 p, float layer){',
    '  vec3 q = p;',
    '  q.x += uTime * (0.028 + layer * 0.006) + uWind * 0.055;',
    '  q.z += uTime * (0.017 + layer * 0.004) + uWind * 0.032;',
    '  q.y += layer * 0.18;',
    '  float base = fbm(q * (0.52 + layer * 0.08));',
    '  float detail = worley(q * (1.25 + layer * 0.15));',
    '  float shape = mix(base, base * (0.52 + detail * 0.72), 0.66);',
    '  float edge = smoothstep(uCoverage - layer * 0.04, uCoverage + 0.28, shape);',
    '  float h = clamp((p.y + 0.12 + layer * 0.08) / 1.08, 0.0, 1.0);',
    '  float height = smoothstep(0.0, 0.14, h) * (1.0 - smoothstep(0.58 + layer * 0.12, 1.02, h));',
    '  return edge * height * uDensity * (0.88 + layer * 0.22);',
    '}',
    'float sampleFog(vec3 p){',
    '  vec3 q = p;',
    '  q.x += uTime * 0.016 + uWind * 0.028;',
    '  q.z += uTime * 0.009;',
    '  float n = fbm(q * 0.78);',
    '  float h = clamp((p.y + 0.42) / 1.35, 0.0, 1.0);',
    '  float height = 1.0 - smoothstep(0.08, 0.98, h);',
    '  return height * smoothstep(0.12, 0.78, n) * uFogStrength * 0.82;',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);',
    '  vec2 p = (uv - 0.5) * asp;',
    '  vec3 ro = vec3(p * 2.4, 0.08, 2.0);',
    '  vec3 rd = normalize(vec3(p * 0.42, -0.05, -1.0));',
    '  float sun = clamp(dot(normalize(uSunDir), vec3(0.05, 1.0, 0.08)) * 0.45 + 0.55, 0.3, 1.0);',
    '  float t = 0.0; float trans = 1.0; vec3 col = vec3(0.0); float alpha = 0.0;',
    '  float stepLen = 0.052;',
    '  for (int i = 0; i < 64; i++) {',
    '    if (i >= uSteps) break;',
    '    vec3 pos = ro + rd * t;',
    '    if (pos.y < -0.25 || pos.y > 1.35) { t += stepLen; continue; }',
    '    float fogD = sampleFog(pos);',
    '    if (fogD > 0.001) {',
    '      vec3 fogCol = mix(vec3(0.60, 0.66, 0.76), vec3(0.90, 0.94, 1.0), sun);',
    '      col += trans * fogD * fogCol * 0.26 * uColorGain;',
    '      alpha += fogD * 0.14 * uAlphaGain;',
    '      trans *= exp(-fogD * 1.65);',
    '    }',
    '    float dens = sampleCloud(pos, 0.0) + sampleCloud(pos, 0.55) * 0.72;',
    '    if (dens > 0.002) {',
    '      vec3 cloudCol = mix(vec3(0.62, 0.70, 0.82), vec3(0.96, 0.98, 1.0), sun);',
    '      float powder = 1.0 - exp(-dens * 3.2);',
    '      cloudCol *= 0.88 + powder * 0.28;',
    '      col += trans * dens * cloudCol * 0.21 * uColorGain;',
    '      trans *= exp(-dens * 2.05);',
    '      alpha += dens * 0.118 * uAlphaGain;',
    '    }',
    '    t += stepLen + max(dens, fogD) * 0.032;',
    '    if (trans < 0.012) break;',
    '  }',
    '  float skyGrad = smoothstep(0.0, 0.95, 1.0 - uv.y);',
    '  float fogVeil = skyGrad * skyGrad * uFogStrength;',
    '  vec3 veilCol = mix(vec3(0.56, 0.63, 0.74), vec3(0.93, 0.96, 1.0), sun);',
    '  col += veilCol * fogVeil * 0.46;',
    '  alpha = clamp(alpha + fogVeil * 0.58, 0.0, 0.98);',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  function sunDirFromWeather(weather) {
    var elev = 42;
    if (weather && Number(weather.isDay) === 0) elev = -12;
    else if (weather && Number(weather.isDay) === 1) elev = 48;
    var rad = elev * Math.PI / 180;
    return { x: 0.35, y: Math.sin(rad), z: Math.cos(rad) };
  }

  function mountCanvas(parent) {
    var canvas = document.createElement('canvas');
    canvas.id = 'home-weather-fx-canvas';
    canvas.className = 'home-weather-fx-canvas home-weather-volcloud-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    parent.insertBefore(canvas, parent.firstChild);
    return canvas;
  }

  function createScene(width, height, presetName) {
    var THREE = window.THREE;
    var params = presetParams(presetName);
    var canvas = mountCanvas(document.querySelector('.home-hero'));
    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(width, height) },
        uCoverage: { value: params.coverage },
        uDensity: { value: params.density },
        uWind: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.35, 0.74, 0.57) },
        uSteps: { value: params.steps },
        uColorGain: { value: params.colorGain || 1 },
        uAlphaGain: { value: params.alphaGain || 1 },
        uFogStrength: { value: params.fogStrength || 1 }
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }',
      fragmentShader: FRAGMENT
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    return {
      THREE: THREE,
      canvas: canvas,
      renderer: renderer,
      scene: scene,
      camera: camera,
      material: material,
      presetName: presetName,
      animId: null,
      running: false,
      width: width,
      height: height,
      startTime: performance.now()
    };
  }

  function tick() {
    if (!volState || !volState.running) return;
    var now = performance.now();
    if (volState.lastTick && (now - volState.lastTick) < 33) {
      volState.animId = requestAnimationFrame(tick);
      return;
    }
    volState.lastTick = now;
    var mat = volState.material;
    mat.uniforms.uTime.value = (now - volState.startTime) * 0.001;
    volState.renderer.render(volState.scene, volState.camera);
    volState.animId = requestAnimationFrame(tick);
  }

  window.HomeVolCloudFx = {
    supported: function () {
      if (!hasThree()) return false;
      try {
        var c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) {
        return false;
      }
    },
    start: function (presetName, weather, wind) {
      if (!this.supported()) return false;
      var hero = document.querySelector('.home-hero');
      if (!hero) return false;
      var size = {
        width: Math.max(1, Math.round(hero.clientWidth || 800)),
        height: Math.max(1, Math.round(hero.clientHeight || 400))
      };
      this.stop();
      var old = document.getElementById('home-weather-fx-canvas');
      if (old) old.remove();
      volState = createScene(size.width, size.height, presetName || 'partly-cloudy');
      var params = presetParams(presetName);
      volState.material.uniforms.uCoverage.value = params.coverage;
      volState.material.uniforms.uDensity.value = params.density;
      volState.material.uniforms.uSteps.value = params.steps;
      volState.material.uniforms.uColorGain.value = params.colorGain || 1;
      volState.material.uniforms.uAlphaGain.value = params.alphaGain || 1;
      volState.material.uniforms.uFogStrength.value = params.fogStrength || 1;
      volState.material.uniforms.uWind.value = wind || 0;
      var sun = sunDirFromWeather(weather);
      volState.material.uniforms.uSunDir.value.set(sun.x, sun.y, sun.z).normalize();
      volState.running = true;
      tick();
      return true;
    },
    resize: function () {
      if (!volState) return;
      var hero = document.querySelector('.home-hero');
      if (!hero) return;
      var width = Math.max(1, Math.round(hero.clientWidth || volState.width));
      var height = Math.max(1, Math.round(hero.clientHeight || volState.height));
      volState.width = width;
      volState.height = height;
      volState.renderer.setSize(width, height, false);
      volState.material.uniforms.uResolution.value.set(width, height);
    },
    stop: function () {
      if (!volState) return;
      volState.running = false;
      if (volState.animId) cancelAnimationFrame(volState.animId);
      volState.animId = null;
      if (volState.material) volState.material.dispose();
      if (volState.renderer) volState.renderer.dispose();
      if (volState.canvas && volState.canvas.parentNode) volState.canvas.parentNode.removeChild(volState.canvas);
      volState = null;
    },
    active: function () {
      return !!(volState && volState.running);
    }
  };
})();
