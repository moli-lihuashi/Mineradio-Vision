// Home 场景轮播：基于 three.r128 的 WebGL 堆叠卡片
// 玻璃着色器 + 加色发光层（glow mesh），直接渲染保持 canvas 透明
// 推荐场景固定第一张，仅在跨时段推荐变化时更新；手动拖拽/点击浏览
(function (global) {
  'use strict';
  var THREE = global.THREE;
  if (!THREE || !THREE.WebGLRenderer) {
    // 缺少依赖，安静失败
    return;
  }

  var CARD_W = 2.1, CARD_H = 3.0;
  var ASPECT = CARD_W / CARD_H;
  var CAMERA_Z = 4.2;

  var instances = new WeakMap();

  function splitTagline(tagline) {
    var s = String(tagline || '');
    var idx = s.indexOf('，');
    if (idx < 0) idx = s.indexOf('、');
    if (idx < 0) return { sub: s, desc: '' };
    return { sub: s.slice(0, idx), desc: s.slice(idx + 1) };
  }

  function hex(h) { return new THREE.Color(h); }

  // ─── Shaders ───────────────────────────────────────────────
  var baseVert = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }'
  ].join('\n');

  var glassFrag = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec3  uColorA;',
    'uniform vec3  uColorB;',
    'uniform float uTime;',
    'uniform vec2  uMouse;',
    'uniform float uAspect;',
    'uniform float uActive;',
    'float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return min(max(q.x,q.y),0.) + length(max(q,0.)) - r; }',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){ vec2 i=floor(p),f=fract(p); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }',
    'void main(){',
    '  vec2 p=(vUv-.5)*2.; p.x*=uAspect;',
    '  float d=sdRR(p, vec2(uAspect,1.), 0.28);',
    '  float alpha=smoothstep(0.014,-0.014,d);',
    '  if(alpha<=0.001) discard;',
    '  float g=clamp(vUv.x*.5+vUv.y*.6,0.,1.);',
    '  vec3 col=mix(uColorA,uColorB,g);',
    '  col *= mix(0.48, 0.90, vUv.y);',
    '  float s=sin((vUv.x+vUv.y)*3.8-uTime*1.1+uMouse.x*1.3);',
    '  col += smoothstep(0.65,1.,s)*0.06;',
    '  float n=noise(vUv*vec2(200.,290.));',
    '  col += (n-.5)*0.035;',
    '  float cloud=noise(vUv*3.2+uTime*.04)*0.05;',
    '  col += cloud*uColorA*0.5;',
    '  vec2 lp=uMouse*vec2(uAspect,1.)*0.75;',
    '  float sp=exp(-dot(p-lp,p-lp)*2.2);',
    '  col += sp*0.15*(0.5+0.5*uActive);',
    '  col += smoothstep(0.78,1.,vUv.y)*0.07;',
    '  float edge=smoothstep(-0.06,0.,d);',
    '  col += edge*0.14;',
    '  col -= smoothstep(0.18,0.,vUv.y)*0.10;',
    '  gl_FragColor=vec4(col, alpha*0.9);',
    '}'
  ].join('\n');

  var glowFrag = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec3  uColor;',
    'uniform float uTime;',
    'uniform float uActive;',
    'void main(){',
    '  vec2 p=vUv-.5;',
    '  float d=length(p*vec2(1.05,1.));',
    '  float a=smoothstep(0.5,0.,d);',
    '  a=pow(a,3.0);',
    '  float pulse=0.8+0.2*sin(uTime*0.9);',
    '  a*=mix(0.30,0.85,uActive)*pulse;',
    '  gl_FragColor=vec4(uColor,a);',
    '}'
  ].join('\n');

  // ─── Canvas content texture ────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function makeContentTexture(def, width = 512) {
    var W = width, H = Math.round(W / ASPECT);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var PAD = Math.round(W * 0.1);
    var y = Math.round(W * 0.11);
    var bh = Math.round(W * 0.075);

    // badge pill（仅推荐卡显示）
    if (def.badge) {
      ctx.font = '500 ' + Math.round(W * 0.045) + 'px "PingFang SC","Inter",system-ui';
      var bw = ctx.measureText(def.badge).width + Math.round(W * 0.07);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(ctx, PAD, y, bw, bh, Math.round(W * 0.037)); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, PAD, y, bw, bh, Math.round(W * 0.037)); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.badge, PAD + Math.round(W * 0.035), y + bh / 2);
    }

    // title
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,1.0)';
    ctx.font = '700 ' + Math.round(W * 0.21) + 'px "PingFang SC","Inter",system-ui';
    ctx.fillText(def.title, PAD, Math.round(W * 0.5));

    // subtitle row（竖条 + 副标题）
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(PAD, Math.round(W * 0.55), Math.round(W * 0.006), Math.round(W * 0.047));
    ctx.fillStyle = 'rgba(255,255,255,0.74)';
    ctx.font = '400 ' + Math.round(W * 0.05) + 'px "PingFang SC","Inter",system-ui';
    ctx.fillText(def.sub, PAD + Math.round(W * 0.028), Math.round(W * 0.595));

    // description
    if (def.desc) {
      var descLines = def.desc.split('\n');
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.font = '400 ' + Math.round(W * 0.062) + 'px "PingFang SC","Inter",system-ui';
      descLines.forEach(function (line, i) { ctx.fillText(line, PAD, Math.round(W * 0.76) + i * Math.round(W * 0.098)); });
    }

    // divider
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, H - Math.round(W * 0.25)); ctx.lineTo(W - PAD, H - Math.round(W * 0.25)); ctx.stroke();

    // bottom tag
    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    ctx.font = '500 ' + Math.round(W * 0.04) + 'px "Inter",system-ui';
    ctx.fillText(def.tag, PAD, H - Math.round(W * 0.16));

    // play button
    var cxp = W - PAD - Math.round(W * 0.06), cyp = H - Math.round(W * 0.19);
    ctx.strokeStyle = 'rgba(255,255,255,0.54)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cxp, cyp, Math.round(W * 0.055), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(cxp - Math.round(W * 0.016), cyp - Math.round(W * 0.022));
    ctx.lineTo(cxp - Math.round(W * 0.016), cyp + Math.round(W * 0.022));
    ctx.lineTo(cxp + Math.round(W * 0.024), cyp);
    ctx.closePath(); ctx.fill();

    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // ─── Layout ────────────────────────────────────────────────
  function targetFor(order) {
    if (order === 0) return { x: 0, y: 0, z: 0, rot: 0, scale: 1, active: 1 };
    var side = (order % 2 === 1) ? 1 : -1;
    var tier = Math.floor((order + 1) / 2);
    return {
      x: side * (2.0 + (tier - 1) * 1.25),
      y: tier * 0.5,
      z: -tier * 1.3,
      rot: side * tier * 0.11,
      scale: 1 - tier * 0.1,
      active: 0,
    };
  }

  function buildCards(scene, renderer, cardsData) {
    var cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    var glowGeo = new THREE.PlaneGeometry(CARD_W * 1.8, CARD_H * 1.6);
    var contentGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    var shadowGeo = new THREE.PlaneGeometry(CARD_W * 1.15, CARD_H * 1.15);

    var shadowTex = (function () {
      var S = 256;
      var c = document.createElement('canvas'); c.width = c.height = S;
      var x = c.getContext('2d');
      var grd = x.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.5)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grd; x.fillRect(0, 0, S, S);
      return new THREE.CanvasTexture(c);
    })();

    var cards = [];
    cardsData.forEach(function (def, i) {
      var group = new THREE.Group();

      var shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
        map: shadowTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.8,
      }));
      shadow.position.set(0.12, -0.28, -0.05);
      shadow.scale.set(1.05, 0.9, 1);
      group.add(shadow);

      var glowUniforms = { uColor: { value: hex(def.a) }, uTime: { value: 0 }, uActive: { value: 0 } };
      var glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
        vertexShader: baseVert, fragmentShader: glowFrag, uniforms: glowUniforms,
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.position.z = -0.03;
      group.add(glow);

      var uniforms = {
        uColorA: { value: hex(def.a) },
        uColorB: { value: hex(def.b) },
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2() },
        uAspect: { value: ASPECT },
        uActive: { value: 0 },
      };
      var card = new THREE.Mesh(cardGeo, new THREE.ShaderMaterial({
        vertexShader: baseVert, fragmentShader: glassFrag, uniforms: uniforms,
        transparent: true, depthTest: false, depthWrite: false,
      }));
      group.add(card);

      var originalTex = makeContentTexture(def, 512);
      var content = new THREE.Mesh(contentGeo, new THREE.MeshBasicMaterial({
        map: originalTex, transparent: true,
        depthTest: false, depthWrite: false, opacity: 0,
      }));
      content.position.z = 0.02;
      group.add(content);

      scene.add(group);
      cards.push({ group: group, card: card, glow: glow, content: content, shadow: shadow, uniforms: uniforms, glowUniforms: glowUniforms, order: i, def: def, originalTex: originalTex, isExpanded: false, isHovered: false });
    });
    return { cards: cards, geos: [cardGeo, glowGeo, contentGeo, shadowGeo], shadowTex: shadowTex };
  }

  // ─── Fallback（WebGL 不可用时） ────────────────────────────
  function renderFallback(container, cardsData, onSelect) {
    var html = '<div class="home-scene-carousel-fallback">';
    cardsData.forEach(function (def) {
      html += '<button type="button" class="home-scene-carousel-fallback-btn" data-scene-id="' + def.id + '" style="--scene-gradient:linear-gradient(135deg,' + def.a + ',' + def.b + ')">';
      html += '<span class="hcfb-badge">' + (def.badge || '场景') + '</span>';
      html += '<span class="hcfb-title">' + def.title + '</span>';
      html += '<span class="hcfb-sub">' + def.sub + '</span>';
      html += '</button>';
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('[data-scene-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { onSelect(btn.getAttribute('data-scene-id')); });
    });
  }

  function mount(container, opts) {
    opts = opts || {};
    var scenes = opts.scenes || [];
    var recommendedId = opts.recommendedId || '';
    var onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};
    var getActiveId = typeof opts.getActiveId === 'function' ? opts.getActiveId : function () { return ''; };

    // 构造卡片数据：推荐场景置首
    var ordered = [];
    var rest = [];
    scenes.forEach(function (s) { (s.id === recommendedId ? ordered : rest).push(s); });
    var orderedScenes = ordered.concat(rest);
    var cardsData = orderedScenes.map(function (scene) {
      var parts = splitTagline(scene.tagline);
      return {
        id: scene.id,
        title: scene.label,
        sub: parts.sub,
        desc: parts.desc,
        badge: scene.id === recommendedId ? '此刻推荐' : '',
        tag: (scene.id || '').toUpperCase(),
        a: (scene.coverGradient && scene.coverGradient[0]) || '#33415c',
        b: (scene.coverGradient && scene.coverGradient[1]) || '#1d2d44',
      };
    });

    // 签名缓存：场景集 + 推荐id 不变则不重建
    var sig = cardsData.map(function (c) { return c.id; }).join(',') + '|' + recommendedId;
    var prev = instances.get(container);
    if (prev && prev.sig === sig) {
      prev.activeId = getActiveId() || prev.activeId;
      return;
    }
    if (prev) dispose(container);

    // 清空容器，准备挂载
    container.innerHTML = '';
    var mountEl = document.createElement('div');
    mountEl.className = 'home-scene-carousel-mount';
    container.appendChild(mountEl);

    var inst = {
      sig: sig,
      container: container,
      mountEl: mountEl,
      activeId: getActiveId() || '',
      cardsData: cardsData,
      onSelect: onSelect,
      raf: 0,
      running: false,
      disposed: false,
    };
    instances.set(container, inst);

    // 尝试创建 WebGL 渲染器
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
    } catch (e) { renderer = null; }
    if (!renderer) { renderFallback(container, cardsData, onSelect); return; }

    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    var w = mountEl.clientWidth || 520, h = mountEl.clientHeight || 220;
    renderer.setSize(w, h);
    mountEl.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(0, 0, CAMERA_Z);

    var built = buildCards(scene, renderer, cardsData);
    var cards = built.cards;

    // 直接渲染（不用 EffectComposer：r128 下 Bloom 合成会丢失 alpha 致黑框）

    // ─── 交互 ────────────────────────────────────────────────
    var mouse = new THREE.Vector2();
    var parallax = new THREE.Vector2();
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var dragging = false, dragStartX = 0, dragMoved = 0, dragOffset = 0;
    var expandedIndex = -1;
    var lastInteractAt = performance.now();
    var clock = new THREE.Clock();
    var damp = THREE.MathUtils.damp;

    function bringToFront(idx) {
      if (expandedIndex >= 0) return false;
      var o = cards[idx].order;
      if (o === 0) return false;
      cards.forEach(function (c) { if (c.order < o) c.order += 1; });
      cards[idx].order = 0;
      return true;
    }
    function cycle() {
      if (expandedIndex >= 0) return;
      cards.forEach(function (c) { c.order = (c.order + cards.length - 1) % cards.length; });
    }
    function pickCard(cx, cy) {
      var r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((cx - r.left) / r.width) * 2 - 1;
      pointer.y = -((cy - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(cards.map(function (c) { return c.card; }), false);
      if (!hits.length) return -1;
      return cards.findIndex(function (c) { return c.card === hits[0].object; });
    }

    // 展开缩放：让卡片填满容器（按容器宽高与卡片宽高比取较小值）
    function calcExpandScale() {
      var nw = mountEl.clientWidth || 520, nh = mountEl.clientHeight || 220;
      var vFov = 40 * Math.PI / 180;
      var dist = CAMERA_Z;
      var visibleH = 2 * dist * Math.tan(vFov / 2);
      var visibleW = visibleH * (nw / nh);
      return Math.min(visibleW / CARD_W, visibleH / CARD_H) * 0.92;
    }
    var expandScale = calcExpandScale();

    function makeExpandedTexture(def) {
      var nw = mountEl.clientWidth || 520, nh = mountEl.clientHeight || 220;
      var texW = Math.min(4096, Math.round(Math.max(nw, nh) * 1.6));
      return makeContentTexture(def, texW);
    }

    function expandCard(idx) {
      if (expandedIndex >= 0) return;
      if (idx < 0 || idx >= cards.length) return;
      if (cards[idx].order !== 0) bringToFront(idx);
      expandedIndex = idx;
      cards[idx].isExpanded = true;
      var tex = makeExpandedTexture(cards[idx].def);
      cards[idx].content.material.map = tex;
      cards[idx].content.material.needsUpdate = true;
      if (cards[idx]._expandedTex) cards[idx]._expandedTex.dispose();
      cards[idx]._expandedTex = tex;
    }
    function collapseCard() {
      if (expandedIndex < 0) return;
      var idx = expandedIndex;
      cards[idx].isExpanded = false;
      cards[idx].content.material.map = cards[idx].originalTex;
      cards[idx].content.material.needsUpdate = true;
      if (cards[idx]._expandedTex) { cards[idx]._expandedTex.dispose(); delete cards[idx]._expandedTex; }
      expandedIndex = -1;
    }

    function onPointerDown(e) {
      dragging = true; dragMoved = 0; dragStartX = e.clientX;
      lastInteractAt = performance.now();
    }
    function onPointerMove(e) {
      var r = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      if (dragging) {
        dragMoved = e.clientX - dragStartX;
        dragOffset = THREE.MathUtils.clamp(dragMoved / 260, -1, 1);
        lastInteractAt = performance.now();
        return;
      }
      // 悬停检测（非展开状态）
      if (expandedIndex < 0) {
        var idx = pickCard(e.clientX, e.clientY);
        cards.forEach(function (c, i) { c.isHovered = (i === idx); });
      } else {
        cards.forEach(function (c) { c.isHovered = false; });
      }
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      lastInteractAt = performance.now();
      var idx = pickCard(e.clientX, e.clientY);
      // 展开状态下，只有展开卡本身可点；其它（淡出不可见）卡视为空白
      if (expandedIndex >= 0 && idx !== expandedIndex) idx = -1;
      var moved = Math.abs(dragMoved);

      if (moved > 90) {
        // 拖拽切换
        if (expandedIndex >= 0) collapseCard();
        else cycle();
        dragOffset = 0; return;
      }
      if (moved >= 14) { dragOffset = 0; return; } // 小幅拖拽不触发

      // 点击（moved < 14）
      if (idx >= 0) {
        if (expandedIndex >= 0 && idx === expandedIndex) {
          // 已展开且正在播放，再次点击该卡：收起
          collapseCard();
        } else {
          // 点击卡片：先展开填满容器，再播放该场景
          if (expandedIndex >= 0) collapseCard();
          expandCard(idx);
          onSelect(cards[idx].def.id);
        }
      } else {
        // 点击空白
        if (expandedIndex >= 0) collapseCard();
        else cycle();
      }
      dragOffset = 0;
    }
    function onKey(e) {
      if (e.key === 'Escape' && expandedIndex >= 0) collapseCard();
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    global.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keydown', onKey);

    // ─── Resize ──────────────────────────────────────────────
    function resize() {
      var nw = mountEl.clientWidth || 520, nh = mountEl.clientHeight || 220;
      if (nw < 2 || nh < 2) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      expandScale = calcExpandScale();
      // 展开中 resize 重建高分辨率纹理
      if (expandedIndex >= 0) {
        var idx = expandedIndex;
        var tex = makeExpandedTexture(cards[idx].def);
        cards[idx].content.material.map = tex;
        cards[idx].content.material.needsUpdate = true;
        if (cards[idx]._expandedTex) cards[idx]._expandedTex.dispose();
        cards[idx]._expandedTex = tex;
      }
    }
    var ro = new ResizeObserver(resize);
    ro.observe(mountEl);

    // ─── 可见性：离屏暂停 ───────────────────────────────────
    function visible() { return inst.running && document.visibilityState === 'visible'; }
    var io = new IntersectionObserver(function (entries) {
      var ev = entries[0];
      inst.running = ev.isIntersecting && document.visibilityState === 'visible';
      if (inst.running && !inst.raf) loop();
    }, { threshold: 0.01 });
    io.observe(mountEl);
    function onVis() {
      var v = mountEl.getBoundingClientRect().width > 0 && document.visibilityState === 'visible';
      inst.running = v;
      if (v && !inst.raf) loop();
      else if (!v && inst.raf) { cancelAnimationFrame(inst.raf); inst.raf = 0; }
    }
    document.addEventListener('visibilitychange', onVis);
    inst.running = true;

    // ─── Loop ────────────────────────────────────────────────
    function loop() {
      if (inst.disposed) return;
      var dt = Math.min(clock.getDelta(), 0.05);
      var t = clock.elapsedTime;

      // 3 秒无操作：自动轮播回到此刻推荐卡片（index 0），展开状态不打断
      if (expandedIndex < 0 && !dragging && performance.now() - lastInteractAt > 3000) {
        if (cards[0] && cards[0].order !== 0) {
          bringToFront(0);
        }
      }

      parallax.x = damp(parallax.x, mouse.x, 4, dt);
      parallax.y = damp(parallax.y, mouse.y, 4, dt);
      scene.rotation.y = parallax.x * 0.20;
      scene.rotation.x = -parallax.y * 0.14;

      var activeId = inst.activeId;
      cards.forEach(function (c, idx) {
        var isExpanded = (idx === expandedIndex && c.isExpanded);
        var isFront = (c.order === 0 && expandedIndex < 0);
        var isHovered = c.isHovered && expandedIndex < 0;
        var g = c.group;

        if (isExpanded) {
          // 展开填满容器
          g.position.x = damp(g.position.x, 0, 6, dt);
          g.position.y = damp(g.position.y, 0, 6, dt);
          g.position.z = damp(g.position.z, 0, 6, dt);
          g.rotation.z = damp(g.rotation.z, 0, 6, dt);
          g.scale.setScalar(damp(g.scale.x, expandScale, 6, dt));
          c.card.material.opacity = damp(c.card.material.opacity, 0.9, 6, dt);
          c.shadow.material.opacity = damp(c.shadow.material.opacity, 0.9, 6, dt);
          c.content.material.opacity = damp(c.content.material.opacity, 1, 6, dt);
          c.uniforms.uActive.value = damp(c.uniforms.uActive.value, 1, 6, dt);
        } else if (expandedIndex >= 0) {
          // 展开期间其它卡淡出隐藏
          g.position.x = damp(g.position.x, targetFor(c.order).x, 6, dt);
          g.position.y = damp(g.position.y, targetFor(c.order).y, 6, dt);
          g.position.z = damp(g.position.z, targetFor(c.order).z, 6, dt);
          g.rotation.z = damp(g.rotation.z, targetFor(c.order).rot, 6, dt);
          g.scale.setScalar(damp(g.scale.x, targetFor(c.order).scale, 6, dt));
          c.card.material.opacity = damp(c.card.material.opacity, 0, 6, dt);
          c.shadow.material.opacity = damp(c.shadow.material.opacity, 0, 6, dt);
          c.content.material.opacity = damp(c.content.material.opacity, 0, 6, dt);
          c.uniforms.uActive.value = damp(c.uniforms.uActive.value, 0, 6, dt);
        } else {
          var tg = targetFor(c.order);
          var peek = c.order === 0 ? dragOffset * 0.5 : 0;
          // 悬停外推 + 放大
          var hoverOff = isHovered ? 0.6 : 0;
          var hoverScale = isHovered ? 1.06 : 1;
          var hoverRot = isHovered ? 0.02 : 0;

          g.position.x = damp(g.position.x, tg.x + peek, 6, dt);
          g.position.y = damp(g.position.y, tg.y + Math.sin(t * 0.9 + c.order) * 0.03, 6, dt);
          g.position.z = damp(g.position.z, tg.z + hoverOff, 6, dt);
          g.rotation.z = damp(g.rotation.z, tg.rot + peek * 0.15 + hoverRot, 6, dt);
          g.scale.setScalar(damp(g.scale.x, tg.scale * hoverScale, 6, dt));

          c.card.material.opacity = damp(c.card.material.opacity, (isFront || isHovered) ? 0.9 : 0.63, 6, dt);
          c.shadow.material.opacity = damp(c.shadow.material.opacity, (isFront || isHovered) ? 0.8 : 0.35, 6, dt);
          c.content.material.opacity = damp(c.content.material.opacity, (isFront || isHovered) ? 1 : 0.2, 6, dt);

          var playBoost = (c.def.id === activeId && c.order !== 0) ? 0.5 : 0;
          var targetActive = tg.active + playBoost + (isHovered ? 0.3 : 0);
          c.uniforms.uActive.value = damp(c.uniforms.uActive.value, targetActive, 6, dt);
        }

        var base = (cards.length - c.order) * 10 + (isExpanded ? 100 : 0);
        c.shadow.renderOrder = base;
        c.glow.renderOrder = base + 1;
        c.card.renderOrder = base + 2;
        c.content.renderOrder = base + 3;

        c.uniforms.uTime.value = t;
        c.uniforms.uMouse.value.set(parallax.x, parallax.y);
        c.glowUniforms.uTime.value = t + c.order;
        c.glowUniforms.uActive.value = c.uniforms.uActive.value;
      });

      renderer.render(scene, camera);
      if (inst.running) inst.raf = requestAnimationFrame(loop);
      else inst.raf = 0;
    }
    inst.raf = requestAnimationFrame(loop);

    inst.dispose = function () {
      inst.disposed = true;
      if (inst.raf) cancelAnimationFrame(inst.raf);
      inst.raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('keydown', onKey);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      global.removeEventListener('pointerup', onPointerUp);
      built.geos.forEach(function (g) { g.dispose(); });
      cards.forEach(function (c) {
        c.card.material.dispose();
        c.glow.material.dispose();
        c.content.material.dispose();
        c.originalTex && c.originalTex.dispose();
        if (c._expandedTex) c._expandedTex.dispose();
        c.shadow.material.dispose();
      });
      built.shadowTex.dispose();
      try { renderer.dispose(); } catch (e) {}
      try { renderer.forceContextLoss && renderer.forceContextLoss(); } catch (e) {}
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }

  function updateActive(container, activeId) {
    var inst = instances.get(container);
    if (inst) inst.activeId = activeId || '';
  }

  function dispose(container) {
    var inst = instances.get(container);
    if (!inst) return;
    if (inst.dispose) inst.dispose();
    instances.delete(container);
    container.innerHTML = '';
  }

  global.Mineradio = global.Mineradio || {};
  global.Mineradio.sceneCarousel = {
    mount: mount,
    updateActive: updateActive,
    dispose: dispose,
  };
})(this);
