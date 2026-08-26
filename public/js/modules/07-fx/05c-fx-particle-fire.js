var fxParticleFireEngine = null;
var fxParticleFireMaskRaf = null;
function applyFxParticleFireMask(reveal) {
  var canvas = document.getElementById('fx-particlecount-canvas');
  if (!canvas) return;
  var r = clampRange(Number(reveal) || 0, 0, 1);
  var leftEdge = Math.max(0, (1 - r) * 98);
  var mask = 'linear-gradient(to right, transparent 0%, transparent ' + leftEdge + '%, black ' + leftEdge + '%, black 100%)';
  canvas.style.maskImage = mask;
  canvas.style.webkitMaskImage = mask;
}
function runFxParticleFireMaskReveal() {
  if (fxParticleFireMaskRaf) cancelAnimationFrame(fxParticleFireMaskRaf);
  var track = document.getElementById('fx-particlecount-track');
  if (!track || !track.classList.contains('active') || !fxParticleFireEngine) return;
  (function tick() {
    if (!track.classList.contains('active') || !fxParticleFireEngine) {
      fxParticleFireMaskRaf = null;
      return;
    }
    var r = fxParticleFireEngine.getReveal();
    applyFxParticleFireMask(r);
    if (r < 1) fxParticleFireMaskRaf = requestAnimationFrame(tick);
    else fxParticleFireMaskRaf = null;
  })();
}
function updateFxParticleFireSliderVisual(value) {
  var input = document.getElementById('fx-particlecount');
  var track = document.getElementById('fx-particlecount-track');
  var canvas = document.getElementById('fx-particlecount-canvas');
  if (!input || !track) return;
  var num = Number(value != null ? value : input.value);
  var atMax = num >= 0.995;
  var wasActive = track.classList.contains('active');
  track.classList.toggle('active', atMax);
  track.classList.toggle('full', num >= 1.0 - 0.004);
  if (canvas && !atMax) {
    if (fxParticleFireMaskRaf) { cancelAnimationFrame(fxParticleFireMaskRaf); fxParticleFireMaskRaf = null; }
    canvas.style.maskImage = '';
    canvas.style.webkitMaskImage = '';
  }
  if (fxParticleFireEngine) {
    var activated = fxParticleFireEngine.setState(1, atMax);
    if (atMax && activated) runFxParticleFireMaskReveal();
    else if (atMax && !wasActive) runFxParticleFireMaskReveal();
    else if (atMax) applyFxParticleFireMask(fxParticleFireEngine.getReveal());
  }
}
function scheduleFxParticleFireRefresh() {
  requestAnimationFrame(function(){
    refreshFxParticleFireSlider();
    if (fxParticleFireEngine && !fxParticleFireEngine.hasSize()) {
      setTimeout(refreshFxParticleFireSlider, 100);
      setTimeout(refreshFxParticleFireSlider, 320);
    }
  });
}
function refreshFxParticleFireSlider() {
  if (!document.getElementById('fx-particlecount-canvas')) return;
  if (!fxParticleFireEngine) initFxParticleFireSlider();
  if (!fxParticleFireEngine) return;
  fxParticleFireEngine.resize();
  updateFxParticleFireSliderVisual(fx.particleCount != null ? fx.particleCount : (document.getElementById('fx-particlecount') || {}).value);
}
function initFxParticleFireSlider() {
  var canvas = document.getElementById('fx-particlecount-canvas');
  var input = document.getElementById('fx-particlecount');
  if (!canvas || !input || fxParticleFireEngine) return;
  var VERT = '#version 300 es\nlayout(location=0) in vec2 a_pos;\nout vec2 v_uv;\nvoid main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }';
  var FRAG_SIM = '#version 300 es\nprecision highp float;\nin vec2 v_uv; out vec4 fc;\nuniform float u_time, u_slider, u_elapsed;\nuniform sampler2D u_back;\nfloat hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\nvoid main(){\n  vec2 uv=v_uv;\n  vec2 g=uv*vec2(72.0,6.0);\n  vec2 id=floor(g);\n  vec2 cf=fract(g);\n  float h=hash(id);\n  vec2 ap=abs(cf-0.5);\n  float cell=smoothstep(0.34,0.22,max(ap.x*0.9,ap.y));\n  vec3 prev=texture(u_back,uv).rgb;\n  float fade_mask = smoothstep(0.0, 0.45, uv.x);\n  vec3 decay = prev * 0.90 * fade_mask;\n  float act=smoothstep(0.95,1.0,u_slider);\n  if(act<0.01||u_elapsed<0.0){ fc=vec4(decay,1.0); return; }\n  float t=u_time;\n  float cellDelay = h * 1.2;\n  float cellAge   = max(u_elapsed - cellDelay, 0.0);\n  float ignited   = step(0.001, cellAge);\n  float cellSpd   = 0.85 + h * 0.30;\n  float eased = 1.0 - pow(1.0 - clamp(cellAge / 2.5, 0.0, 1.0), 3.0);\n  float dist  = eased * u_slider * cellSpd * ignited;\n  float cellOff = (h - 0.5) * 0.05;\n  float front   = max(u_slider - dist - cellOff, 0.02);\n  float tail    = max(u_slider - front, 0.001);\n  float inZ   = step(front - 0.003, uv.x) * step(uv.x, u_slider + 0.003);\n  float dn    = clamp(max(u_slider - uv.x, 0.0) / tail, 0.0, 1.0);\n  float bright = pow(1.0 - dn, 0.65);\n  bright = max(bright, 0.04 * ignited) * inZ;\n  bright *= 1.0 - smoothstep(0.94, 1.05, dn);\n  float es = mix(0.15, 0.5, min(u_elapsed / 1.0, 1.0));\n  float vy = abs(uv.y - 0.5) * 2.0;\n  float vf = pow(max(1.0 - vy * vy * 0.45, 0.0), 0.75);\n  float ts = mix(0.85, 1.0, min(u_elapsed / 1.5, 1.0));\n  float f1 = sin(uv.x * 30.0 + t * 15.0 * ts + h * 6.28);\n  float f2 = sin(uv.x * 17.0 + t * 8.0 * ts + h * 3.14);\n  float f3 = sin(uv.x * 52.0 + t * 25.0 * ts + h * 10.0);\n  float flame = smoothstep(0.08, 0.92, (f1 + f2 * 0.5 + f3 * 0.25) * 0.35 + 0.5);\n  float r1 = sin(dn * 16.0 - t * 5.0 * ts + h * 3.0);\n  float r2 = sin(dn * 8.0 - t * 2.5 * ts + h * 5.0);\n  float rhythm = smoothstep(-0.15, 0.55, r1) * (r2 * 0.5 + 0.5);\n  rhythm = pow(max(rhythm, 0.0), 1.2);\n  float avgSpd = dist / max(cellAge, 0.001);\n  float age    = max(cellAge - max(u_slider - uv.x, 0.0) / max(avgSpd, 0.001), 0.0);\n  float flash  = step(0.0, age) * exp(-age * 3.2);\n  float sp  = fract(t * (0.38 + h * 0.15) + h * 7.0);\n  float sX  = u_slider - sp * tail;\n  float sY  = 0.5 + sin(sp * 11.0 + h * 6.28) * 0.28;\n  float spark = smoothstep(0.014, 0.0, abs(uv.x - sX)) * smoothstep(0.18, 0.0, abs(uv.y - sY)) * (1.0 - sp) * (1.0 - sp) * es;\n  float energy = bright * vf * (flame * 0.42 + rhythm * 0.38) + flash * bright * vf * 0.55 + spark * 0.7 * inZ;\n  energy *= es;\n  float edgeBase = exp(-pow((uv.x - front) * 18.0, 2.0));\n  float ef1 = sin(uv.x * 45.0 + t * 20.0 * ts + h * 6.28) * 0.5 + 0.5;\n  float ef2 = sin(uv.x * 28.0 + t * 11.0 * ts + h * 3.14) * 0.5 + 0.5;\n  float edge = edgeBase * (0.25 + ef1 * ef2 * 1.5) * 1.6 * act * es;\n  float leadD    = front - uv.x;\n  float leadZone = smoothstep(0.07, 0.0, leadD) * step(0.0, leadD) * vf;\n  float h2       = hash(id + vec2(99.0, 33.0));\n  float leadF    = sin(leadD * 100.0 + t * 20.0 * ts + h2 * 6.28) * 0.5 + 0.5;\n  float leadSpark = leadZone * step(0.6, h2) * leadF * act * es * 0.5;\n  float total = energy + edge + leadSpark;\n  vec3 ember = vec3(0.28, 0.10, 0.58);\n  vec3 wpur  = vec3(0.62, 0.32, 1.0);\n  vec3 wht   = vec3(1.0, 0.94, 0.98);\n  float temp = 1.0 - dn;\n  vec3 col   = mix(ember, wpur, temp);\n  col        = mix(col, wht, pow(temp, 4.5));\n  col       *= total;\n  float pulse = sin(t * 2.8) * 0.15 + 1.0;\n  float core  = exp(-pow((uv.x - u_slider) * 16.0, 2.0));\n  col += wht * core * 2.2 * pulse * act * es;\n  col += wpur * exp(-pow((uv.x - u_slider) * 3.5, 2.0)) * 0.12 * act * es;\n  col *= cell;\n  col *= fade_mask;\n  fc = vec4(min(decay + col, vec3(1.5)), 1.0);\n}';
  var FRAG_BLUR = '#version 300 es\nprecision highp float;\nin vec2 v_uv; out vec4 fc;\nuniform sampler2D u_tex;\nuniform vec2 u_dir, u_res;\nuniform float u_ext;\nvec3 s(vec2 uv){\n  vec3 c=texture(u_tex,uv).rgb;\n  return u_ext>0.5 && dot(c,vec3(0.2126,0.7152,0.0722))<0.3 ? vec3(0.0) : c;\n}\nvoid main(){\n  vec2 o=u_dir*1.8/u_res;\n  vec3 r=s(v_uv)*0.227027;\n  r+=s(v_uv+o)*0.194595;    r+=s(v_uv-o)*0.194595;\n  r+=s(v_uv+o*2.0)*0.121622;r+=s(v_uv-o*2.0)*0.121622;\n  r+=s(v_uv+o*3.0)*0.054054;r+=s(v_uv-o*3.0)*0.054054;\n  fc=vec4(r,1.0);\n}';
  var FRAG_COMP = '#version 300 es\nprecision highp float;\nin vec2 v_uv; out vec4 fc;\nuniform sampler2D u_scene, u_glow;\nvoid main(){\n  vec3 s=texture(u_scene,v_uv).rgb;\n  vec3 g=texture(u_glow,v_uv).rgb;\n  fc=vec4(1.0-exp(-(s+g*1.2+s*g*0.35)*1.15),1.0);\n}';
  var gl = null, rafId = null, resizeObserver = null, resizeDebounce = null;
  var loopRunning = false, idleFrames = 0, wasActive = false, ultraStart = null;
  var cachedActive = false, cachedSlider = particleCountToNorm(input.value);
  var simProg = null, blurProg = null, compProg = null, vao = null, vbo = null, programsReady = false;
  var simA = null, simB = null, blurH = null, blurV = null;
  var U = {};
  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function linkProgram(vsSrc, fsSrc) {
    var v = compileShader(gl.VERTEX_SHADER, vsSrc);
    var f = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }
  function makeFBO() {
    var fbo = gl.createFramebuffer();
    var tex = gl.createTexture();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo: fbo, tex: tex };
  }
  function destroyFBO(entry) {
    if (!gl || !entry) return;
    gl.deleteFramebuffer(entry.fbo);
    gl.deleteTexture(entry.tex);
  }
  function createFBOs() {
    if (!gl || !canvas) return;
    simA = makeFBO();
    simB = makeFBO();
    blurH = makeFBO();
    blurV = makeFBO();
  }
  function destroyFBOs() {
    destroyFBO(simA); simA = null;
    destroyFBO(simB); simB = null;
    destroyFBO(blurH); blurH = null;
    destroyFBO(blurV); blurV = null;
  }
  function compilePrograms() {
    if (!gl) return;
    simProg = linkProgram(VERT, FRAG_SIM);
    blurProg = linkProgram(VERT, FRAG_BLUR);
    compProg = linkProgram(VERT, FRAG_COMP);
    if (!simProg || !blurProg || !compProg) return;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    U.simTime = gl.getUniformLocation(simProg, 'u_time');
    U.simSlider = gl.getUniformLocation(simProg, 'u_slider');
    U.simElapsed = gl.getUniformLocation(simProg, 'u_elapsed');
    U.simBack = gl.getUniformLocation(simProg, 'u_back');
    U.blurDir = gl.getUniformLocation(blurProg, 'u_dir');
    U.blurExt = gl.getUniformLocation(blurProg, 'u_ext');
    U.blurTex = gl.getUniformLocation(blurProg, 'u_tex');
    U.blurRes = gl.getUniformLocation(blurProg, 'u_res');
    U.compScene = gl.getUniformLocation(compProg, 'u_scene');
    U.compGlow = gl.getUniformLocation(compProg, 'u_glow');
    programsReady = true;
  }
  function resize() {
    if (!gl || !canvas) return false;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width === w && canvas.height === h && simA && simB) return true;
    canvas.width = w;
    canvas.height = h;
    destroyFBOs();
    createFBOs();
    return !!(simA && simB);
  }
  function resetFireSimulation() {
    ultraStart = performance.now();
    wasActive = false;
    idleFrames = 0;
    if (!gl || !simA || !simB) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, simA.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function ensureLoop(forceRestart) {
    if (!simA || !simB) {
      resize();
      if (!simA || !simB) return;
    }
    if (forceRestart) wasActive = false;
    if (!loopRunning) {
      loopRunning = true;
      idleFrames = 0;
      wasActive = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, simA.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      rafId = requestAnimationFrame(render);
    } else {
      idleFrames = 0;
    }
  }
  function render(t) {
    var active = cachedActive;
    if (!active && !wasActive) {
      if (++idleFrames > 180) {
        loopRunning = false;
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(render);
      return;
    }
    idleFrames = 0;
    if (active && !wasActive) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, simA.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    wasActive = active;
    var elapsed = active ? (performance.now() - (ultraStart || 0)) / 1000 : -1.0;
    var sv = cachedSlider;
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
    gl.useProgram(simProg);
    gl.uniform1f(U.simTime, t * 0.001);
    gl.uniform1f(U.simSlider, sv);
    gl.uniform1f(U.simElapsed, elapsed);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simA.tex);
    gl.uniform1i(U.simBack, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.useProgram(blurProg);
    gl.uniform2f(U.blurRes, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurH.fbo);
    gl.uniform2f(U.blurDir, 1.0, 0.0);
    gl.uniform1f(U.blurExt, 1.0);
    gl.bindTexture(gl.TEXTURE_2D, simB.tex);
    gl.uniform1i(U.blurTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurV.fbo);
    gl.uniform2f(U.blurDir, 0.0, 1.0);
    gl.uniform1f(U.blurExt, 0.0);
    gl.bindTexture(gl.TEXTURE_2D, blurH.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simB.tex);
    gl.uniform1i(U.compScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurV.tex);
    gl.uniform1i(U.compGlow, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    var tmp = simA; simA = simB; simB = tmp;
    rafId = requestAnimationFrame(render);
  }
  gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false, antialias: false, powerPreference: 'high-performance' });
  if (!gl) { console.warn('[fx-particlecount] WebGL2 unavailable'); return; }
  canvas.addEventListener('webglcontextlost', function(e){ e.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', function(){
    programsReady = false;
    compilePrograms();
    if (programsReady) {
      resize();
      if (cachedActive) ensureLoop();
    }
  });
  compilePrograms();
  if (!programsReady) return;
  resizeObserver = new ResizeObserver(function(){
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(resize, 80);
  });
  resizeObserver.observe(canvas);
  resize();
  fxParticleFireEngine = {
    hasSize: function() { return !!(canvas && canvas.width > 0 && canvas.height > 0 && simA && simB); },
    resize: resize,
    getReveal: function() {
      if (!cachedActive || ultraStart == null) return 0;
      return Math.min(1, (performance.now() - ultraStart) / 2800);
    },
    setState: function(norm, active) {
      var was = cachedActive;
      cachedSlider = norm;
      var activated = false;
      if (active) {
        if (!was) {
          resetFireSimulation();
          activated = true;
        } else if (ultraStart == null) {
          resetFireSimulation();
          activated = true;
        }
      } else {
        ultraStart = null;
      }
      cachedActive = active;
      if (active) {
        resize();
        ensureLoop(!was);
      }
      return activated;
    }
  };
  scheduleFxParticleFireRefresh();
}
