/* Folia 世界 — 歌词样式：隐喻（metaphor）
 *
 * 移植自 Folia 0.8.x（AGPL-3.0，chthollyphile/folia-major）的
 * src/components/visualizer/metaphor/{entry,VisualizerMetaphor,createMetaphorRuntime}。
 * 上游原话：「歌词和周围的装饰都是无定形的墨——融球和字写进同一张场里一起切阈值，所以它们会融在一起又分开；
 * 整个画面很慢。画面靠剪辑推进，不靠补间：分镜表按唱到的词硬切机位（全景/特写/跟字/大特写/倾斜/留白/拉远/冲镜），
 * 机位永远正对纸面，一个镜头里只极慢地蠕动，要走远的（跟字、拉远、冲镜）分成几档在词上跳切。
 * 墨不会往下淌：墨球像加速器里的束流一样对撞，碎片沿螺旋线甩出去。」
 *
 * 每帧两遍：字形 + 融球 + 线稿用加法混合画进半浮点的墨场，再全屏显影成纸、墨、网点和颗粒。
 * 画什么只由播放时间决定：分镜表说这一刻是哪个 cue、哪个镜头，机位由 plan 层按排版算。
 * 一个 cue 一套东西（排版、图集、几何、融球规划、线稿与版面），按需建、提前空闲时备好，只留当前和相邻的。
 *
 * 与上游的差异（都是输入/宿主能力差异，公式未改）：
 *   1) 上游自己起 rAF；这里由主循环的 foliaWorldTick 驱动（世界铁律：不另起循环抢帧），
 *      暂停/时间没变时不重复画。
 *   2) 上游的智能动感「湮灭对撞」读 beatFx 服务；本项目没有那套服务，对撞仍卡在词开唱时刻，
 *      不做「挪到拍上」与小环（visual 本体一致，少一层节拍对齐）。
 *   3) 上游主题可带 wordColors（关键字着色）；本项目恒为空，强调色墨统一用主题强调色。
 */
(function () {
  'use strict';

  if (typeof registerFoliaMode !== 'function') return;
  if (typeof THREE === 'undefined') return;
  var F = window.FoliaMetaphor;
  if (!F || !F.paint || !F.figures || !F.plan) return;

  var paint = F.paint;
  var plan = F.plan;
  var figures = F.figures;

  var SHAPE_STRIDE = paint.constants.SHAPE_STRIDE;
  var SHAPE_CAPACITY = paint.constants.SHAPE_CAPACITY;
  var GLYPH_WORLD = plan.constants.GLYPH_WORLD;
  var NOTE_PREFIX = plan.constants.NOTE_PREFIX;

  /* 没接设置面板：用上游的默认调参（cutPace 1 / cameraMotion 1 / flow 1 / blobs 1 / halftone 1 / grain 1 /
   * negative true / flip false / transitions true）。 */
  var TUNING = { cutPace: 1, cameraMotion: 1, flow: 1, blobs: 1, halftone: 1, grain: 1, negative: true, flip: false, transitions: true };

  var DEFAULT_WEIGHT = 300;
  var NOTE_END = -100000;
  var WOBBLE = 0.05;
  var PREPARE_LEAD = 2.5;
  var PREPARE_IDLE_TIMEOUT = 1000;
  var DOT_SIZE = 7;
  var DEG = Math.PI / 180;
  var CUE_KEEP = 1;

  function themeKeyOf(theme) {
    theme = theme || {};
    /* 颜色变了要重算纸墨，字体/字重/强度变了要重排分镜：合成一个签名，任何一样变都重来 */
    return [
      theme.fontStack, theme.weight, theme.animationIntensity,
      theme.primaryColor, theme.secondaryColor, theme.accentColor, theme.backgroundColor
    ].join('|');
  }

  function paletteKeyOf(palette) {
    return palette.paper.join(',') + '|' + palette.ink.join(',') + '|' + palette.accent.join(',');
  }

  function additive(material) {
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    return material;
  }

  function scheduleIdle(fn, timeout) {
    if (typeof window.requestIdleCallback === 'function') {
      var handle = window.requestIdleCallback(function () { fn(); }, { timeout: timeout || PREPARE_IDLE_TIMEOUT });
      return function () { try { window.cancelIdleCallback(handle); } catch (_) {} };
    }
    var timer = setTimeout(fn, 0);
    return function () { clearTimeout(timer); };
  }

  function requireWebGL2() {
    return !!(typeof foliaWorldSupportsWebGL2 === 'function' && foliaWorldSupportsWebGL2());
  }

  /* ---------------- 一个 cue 的那套东西 ---------------- */

  function buildSet(inst, cueIndex) {
    var program = inst.program;
    var cue = program.cues[cueIndex];
    var rng = plan.seedRng('metaphor:' + inst.songSeed + ':' + cueIndex);
    var line = cue.lineIndex >= 0 ? inst.lines[cue.lineIndex] : null;
    var tokens = line
      ? plan.buildTokens(line)
      : (cue.text ? plan.buildTextTokens(cue.text, cue.start - 10) : []);
    var hasText = false;
    for (var t = 0; t < tokens.length; t += 1) if (!tokens[t].space) hasText = true;
    var layout = hasText
      ? plan.buildLayout({ tokens: tokens, composition: cue.composition, measure: inst.glyphs.measure, rng: rng })
      : { composition: 'block', glyphs: [], words: [], bounds: plan.EMPTY_STAGE };
    var interlude = cue.lineIndex < 0;
    var blobs = paint.planShapes(layout.bounds, rng, TUNING.blobs, interlude);
    var collisions = paint.planCollisions(layout.bounds, rng, collisionTimes(cue, layout, rng), TUNING.blobs, interlude);
    var backdrop = figures.planBackdrop(layout.bounds, rng, TUNING.blobs, interlude, { index: cue.lineIndex + 1, time: cue.singStart });
    var figureSet = figures.planFigures(layout.bounds, rng, TUNING.blobs, interlude, inst.layoutAspect);
    /* 版面的网点在最底下，线稿在最上面（都是加法，先后不影响结果，只是容量满了先丢后面的） */
    var shapes = paint.joinShapes(backdrop.shapes, blobs, figureSet.shapes);
    var notes = figures.layoutNotes(backdrop.notes.concat(figureSet.notes), inst.glyphs.measureNote);

    var entries = [];
    layout.glyphs.forEach(function (glyph) {
      entries.push({ key: glyph.char, x: glyph.x, y: glyph.y, size: glyph.size, rot: glyph.rot, t0: glyph.t0, t1: glyph.t1, accent: glyph.accent, seed: glyph.seed });
    });
    notes.forEach(function (note) {
      entries.push({
        key: NOTE_PREFIX + note.char, x: note.x, y: note.y, size: note.size, rot: note.rot,
        t0: cue.start + note.born, t1: NOTE_END, accent: false, seed: rng()
      });
    });
    if (entries.length === 0) return { layout: layout, shapes: shapes, collisions: collisions, mesh: null, texture: null };

    var atlas = plan.buildAtlas(inst.glyphs, entries.map(function (entry) { return entry.key; }));
    var texture = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    var count = entries.length;
    var positions = new Float32Array(count * 12);
    var offsets = new Float32Array(count * 8);
    var uvs = new Float32Array(count * 8);
    var times = new Float32Array(count * 8);
    var metas = new Float32Array(count * 12);
    var tints = new Float32Array(count * 12);
    var accent = inst.palette.accent;
    var indices = [];
    var CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    entries.forEach(function (glyph, index) {
      var half = (glyph.size * GLYPH_WORLD) / 2;
      var cos = Math.cos(glyph.rot);
      var sin = Math.sin(glyph.rot);
      var rect = atlas.rects[glyph.key] || [0, 0, 0, 0];
      for (var corner = 0; corner < 4; corner += 1) {
        var cx = CORNERS[corner][0];
        var cy = CORNERS[corner][1];
        var vertex = index * 4 + corner;
        positions[vertex * 3] = glyph.x;
        positions[vertex * 3 + 1] = glyph.y;
        positions[vertex * 3 + 2] = 0;
        offsets[vertex * 2] = (cx * cos - cy * sin) * half;
        offsets[vertex * 2 + 1] = (cx * sin + cy * cos) * half;
        /* 图集数据的第一行是字的上沿 */
        uvs[vertex * 2] = cx < 0 ? rect[0] : rect[2];
        uvs[vertex * 2 + 1] = cy > 0 ? rect[1] : rect[3];
        times[vertex * 2] = glyph.t0;
        times[vertex * 2 + 1] = glyph.t1;
        metas[vertex * 3] = glyph.seed;
        metas[vertex * 3 + 1] = glyph.accent ? 1 : 0;
        metas[vertex * 3 + 2] = glyph.size;
        tints[vertex * 3] = accent[0];
        tints[vertex * 3 + 1] = accent[1];
        tints[vertex * 3 + 2] = accent[2];
      }
      indices.push(index * 4, index * 4 + 1, index * 4 + 2, index * 4, index * 4 + 2, index * 4 + 3);
    });
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aTime', new THREE.BufferAttribute(times, 2));
    geometry.setAttribute('aMeta', new THREE.BufferAttribute(metas, 3));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
    /* 四个角写死成顶点属性（上游用 gl_VertexID 推，WebGL2 专属） */
    var cornerData = new Float32Array(count * 8);
    for (var index = 0; index < count; index += 1) {
      for (var corner = 0; corner < 4; corner += 1) {
        cornerData[(index * 4 + corner) * 2] = CORNERS[corner][0];
        cornerData[(index * 4 + corner) * 2 + 1] = CORNERS[corner][1];
      }
    }
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(cornerData, 2));
    geometry.setIndex(indices);
    var mesh = new THREE.Mesh(geometry, inst.glyphMaterial);
    mesh.frustumCulled = false;
    return { layout: layout, shapes: shapes, collisions: collisions, mesh: mesh, texture: texture };
  }

  /* 一个 cue 里哪几个时刻对撞：歌词是隔几个词挑一个词的开唱时刻，间奏是隔几秒一次。 */
  function collisionTimes(cue, layout, rng) {
    if (cue.lineIndex >= 0) {
      var seen = {};
      var onsets = [];
      layout.words.forEach(function (word) {
        if (seen[word.t0]) return;
        seen[word.t0] = true;
        onsets.push(word.t0);
      });
      onsets.sort(function (a, b) { return a - b; });
      var first = Math.floor(rng() * Math.min(3, onsets.length));
      var picked = [];
      for (var index = first; index < onsets.length; index += 3) picked.push(onsets[index]);
      return picked.slice(0, 3);
    }
    var times = [];
    var end = cue.loop > 0 ? cue.start + cue.loop : cue.end;
    for (var at = cue.start + paint.constants.COLLISION_APPROACH; at < end - paint.constants.COLLISION_LIFE && times.length < 12; at += 5 + rng() * 4) {
      times.push(at);
    }
    return times;
  }

  function disposeSet(inst, set) {
    if (!set) return;
    if (set.mesh) {
      inst.fieldScene.remove(set.mesh);
      set.mesh.geometry.dispose();
    }
    if (set.texture) set.texture.dispose();
    if (inst.shown === set) inst.shown = null;
  }

  function dropSets(inst) {
    inst.sets.forEach(function (set) { disposeSet(inst, set); });
    inst.sets.clear();
    inst.generation += 1;
    if (typeof plan.clearTracks === 'function') plan.clearTracks();
    if (inst.cancelPrepare) {
      inst.cancelPrepare();
      inst.cancelPrepare = null;
    }
    inst.preparing = -1;
    inst.shown = null;
  }

  function prepare(inst, cueIndex) {
    if (inst.preparing === cueIndex) return;
    if (inst.cancelPrepare) inst.cancelPrepare();
    inst.preparing = cueIndex;
    var generation = inst.generation;
    inst.cancelPrepare = scheduleIdle(function () {
      inst.cancelPrepare = null;
      inst.preparing = -1;
      if (inst.disposed || generation !== inst.generation) return;
      if (cueIndex !== inst.current + 1 || inst.sets.has(cueIndex)) return;
      ensureSet(inst, cueIndex);
    }, PREPARE_IDLE_TIMEOUT);
  }

  function ensureSet(inst, cueIndex) {
    var set = inst.sets.get(cueIndex);
    if (!set) {
      set = buildSet(inst, cueIndex);
      inst.sets.set(cueIndex, set);
      var stale = [];
      inst.sets.forEach(function (_value, index) {
        if (Math.abs(index - cueIndex) > CUE_KEEP) stale.push(index);
      });
      stale.forEach(function (index) {
        disposeSet(inst, inst.sets.get(index));
        inst.sets.delete(index);
      });
    }
    return set;
  }

  function show(inst, set) {
    if (inst.shown === set) return;
    if (inst.shown && inst.shown.mesh) inst.fieldScene.remove(inst.shown.mesh);
    inst.shown = set;
    if (set.mesh) inst.fieldScene.add(set.mesh);
    inst.glyphMaterial.uniforms.uAtlas.value = set.texture;
  }

  function applyPalette(inst) {
    var palette = paint.resolvePalette(inst.theme, TUNING.flip);
    var uniforms = inst.developMaterial.uniforms;
    uniforms.uPaper.value.fromArray(palette.paper);
    uniforms.uInk.value.fromArray(palette.ink);
    uniforms.uAccent.value.fromArray(palette.accent);
    uniforms.uTone.value.fromArray(palette.tone);
    inst.shapeMaterial.uniforms.uAccent.value.set(palette.accent[0], palette.accent[1], palette.accent[2]);
    inst.palette = palette;
  }

  function compile(inst) {
    return plan.compileProgram(inst.lines, {
      seed: inst.songSeed,
      title: inst.songTitle,
      cutPace: TUNING.cutPace,
      negative: TUNING.negative,
      transitions: TUNING.transitions,
      intensity: inst.theme.animationIntensity
    });
  }

  function rebuildProgram(inst) {
    inst.program = compile(inst);
    dropSets(inst);
  }

  function aim(inst, pose) {
    var camera = inst.camera;
    camera.fov = pose.fov;
    camera.position.set(pose.x, pose.y, pose.distance);
    camera.rotation.set(0, 0, pose.roll);
    camera.updateProjectionMatrix();
  }

  function sampleAudio(inst, ctx) {
    var raw = Number(ctx.audio && ctx.audio.power);
    if (!isFinite(raw) || raw < 0) raw = 0;
    if (raw > 1) raw = raw / 255;
    var level = ctx.paused ? 0 : Math.min(1, raw);
    var now = ctx.now || performance.now();
    var dt = inst.audioAt > 0 ? Math.min(0.1, (now - inst.audioAt) / 1000) : 0.016;
    inst.audioAt = now;
    inst.audio += (level - inst.audio) * (1 - Math.exp(-dt / (level > inst.audio ? 0.3 : 0.9)));
  }

  function resize(inst) {
    var host = inst.host;
    var width = host.clientWidth;
    var height = host.clientHeight;
    if (width < 1 || height < 1) return false;
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    if (width === inst.width && height === inst.height && ratio === inst.pixelRatio) return false;
    inst.width = width;
    inst.height = height;
    inst.pixelRatio = ratio;
    inst.renderer.setPixelRatio(ratio);
    inst.renderer.setSize(width, height, false);
    var pixelWidth = Math.max(1, Math.round(width * ratio));
    var pixelHeight = Math.max(1, Math.round(height * ratio));
    inst.fieldTarget.setSize(pixelWidth, pixelHeight);
    inst.developMaterial.uniforms.uRes.value.set(pixelWidth, pixelHeight);
    inst.developMaterial.uniforms.uPixelRatio.value = ratio;
    inst.camera.aspect = width / height;
    /* 线稿是按画面宽高比摆的：比例变了不少就重摆 */
    if (Math.abs(Math.log(width / height / inst.layoutAspect)) > 0.25) {
      inst.layoutAspect = width / height;
      dropSets(inst);
    }
    return true;
  }

  function render(inst, ctx) {
    if (inst.disposed || !inst.width || !inst.height) return;
    var time = Number(ctx.time);
    var safeTime = isFinite(time) ? Math.max(0, time) : 0;
    var cueIndex = plan.findCue(inst.program, safeTime);
    var cue = inst.program.cues[cueIndex];
    if (!cue) return;
    inst.current = cueIndex;
    var set = ensureSet(inst, cueIndex);
    show(inst, set);
    var following = cueIndex + 1;
    if (following < inst.program.cues.length && inst.program.cues[following].start - safeTime < PREPARE_LEAD && !inst.sets.has(following)) {
      prepare(inst, following);
    }

    var cueTime = plan.resolveCueTime(cue, safeTime);
    var shot = plan.findShot(cue, cueTime);
    plan.resolveTransition(inst.program, cueIndex, safeTime, inst.fx);
    var aspect = inst.width / inst.height;
    aim(inst, plan.resolvePose({ shot: shot, layout: set.layout, time: cueTime, aspect: aspect, motion: TUNING.cameraMotion }));

    sampleAudio(inst, ctx);
    var glyphUniforms = inst.glyphMaterial.uniforms;
    glyphUniforms.uTime.value = safeTime;
    glyphUniforms.uReveal.value = plan.resolveReveal(cue, safeTime);
    glyphUniforms.uMelt.value = plan.resolveMelt(cue, safeTime);
    glyphUniforms.uPop.value = 1;
    if (set.mesh) set.mesh.visible = !!ctx.showText;

    var count = paint.writeShapes(set.shapes, safeTime, inst.audio, TUNING.flow, inst.shapeData, safeTime - cue.start);
    if (ctx.showText) count = paint.writePairs(set.layout.glyphs, safeTime, inst.shapeData, count);
    count = paint.writeCollisions(set.collisions, cueTime, inst.shapeData, count);

    var stepped = Math.floor(safeTime * 8) / 8;
    inst.shapeMaterial.uniforms.uTime.value = stepped;
    glyphUniforms.uShakeTime.value = stepped;
    glyphUniforms.uWobble.value = WOBBLE * TUNING.flow;
    inst.shapeMaterial.uniforms.uWobble.value = WOBBLE * TUNING.flow;
    inst.shapeGeometry.instanceCount = count;
    if (count > 0) {
      if (typeof inst.shapeBuffer.addUpdateRange === 'function') inst.shapeBuffer.addUpdateRange(0, count * SHAPE_STRIDE);
      else {
        inst.shapeBuffer.updateRange.offset = 0;
        inst.shapeBuffer.updateRange.count = count * SHAPE_STRIDE;
      }
      inst.shapeBuffer.needsUpdate = true;
    }

    var develop = inst.developMaterial.uniforms;
    develop.uTime.value = safeTime;
    develop.uFlow.value = TUNING.flow * (1 + inst.audio * 0.6);
    develop.uGrain.value = TUNING.grain;
    develop.uDot.value = DOT_SIZE * TUNING.halftone;
    develop.uAngle.value = shot.screenAngle;
    develop.uFlood.value = inst.fx.flood;
    develop.uInvert.value = shot.invert ? 1 : 0;
    develop.uSeed.value = shot.seed;
    develop.uSeeThrough.value = 0;

    inst.renderer.setRenderTarget(inst.fieldTarget);
    inst.renderer.setClearColor(0x000000, 0);
    inst.renderer.clear();
    inst.renderer.render(inst.fieldScene, inst.camera);
    inst.renderer.setRenderTarget(null);
    inst.renderer.render(inst.developScene, inst.developCamera);
    inst.lastTime = safeTime;
    inst.lastRenderAt = ctx.now || performance.now();
  }

  /* ---------------- 生命周期 ---------------- */

  function create(host, ctx) {
    if (!requireWebGL2()) throw new Error('隐喻需要 WebGL2');
    var theme = ctx.theme || {};
    var stack = theme.fontStack || 'system-ui, sans-serif';
    var weight = Number(theme.weight);
    if (!isFinite(weight) || weight <= 0) weight = DEFAULT_WEIGHT;

    var inst = {
      host: host,
      theme: theme,
      themeKey: themeKeyOf(theme),
      lines: ctx.lines || [],
      songSeed: String(ctx.seed || 'metaphor'),
      songTitle: (ctx.song && ctx.song.title) || '',
      linesRev: ctx.linesRev,
      tuning: TUNING,
      width: 0,
      height: 0,
      pixelRatio: 1,
      layoutAspect: 1.6,
      current: -1,
      generation: 0,
      preparing: -1,
      cancelPrepare: null,
      sets: new Map(),
      shown: null,
      audio: 0,
      audioAt: 0,
      fx: { flood: 0 },
      lastTime: NaN,
      lastRenderAt: 0,
      disposed: false,
      palette: null
    };

    /* 会抛错的两样（拿不到 2D 画布、编分镜）放在建 WebGL 上下文之前 */
    inst.glyphs = new plan.GlyphSource(stack, weight);
    inst.fontReady = inst.glyphs.fontReady();
    inst.program = compile(inst);

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    } catch (err) {
      throw new Error('隐喻无法创建 WebGL 渲染器：' + ((err && err.message) || String(err)));
    }
    inst.renderer = renderer;
    renderer.autoClear = false;
    /* 不做 sRGB 输出编码：配色本来就是 0..1 的 sRGB 值，着色器直接混，
     * 再让渲染器编码一次会把纸墨整体提亮（与 Folia 的显影语义不一致）。 */
    var canvas = renderer.domElement;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(canvas);

    /* 墨场要能加过 1（几个融球叠在一起）：半浮点；画不了半浮点时退回 8 位，叠多了会封顶，画面只是略平 */
    var gl = renderer.getContext();
    var floatOk = false;
    try { floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')); } catch (_) {}
    inst.fieldTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });

    inst.glyphMaterial = additive(new THREE.ShaderMaterial({
      vertexShader: paint.shaders.glyphVertex,
      fragmentShader: paint.shaders.glyphFragment,
      uniforms: { uAtlas: { value: null }, uTime: { value: 0 }, uReveal: { value: 1 }, uMelt: { value: 0 }, uPop: { value: 1 }, uShakeTime: { value: 0 }, uWobble: { value: WOBBLE } }
    }));
    inst.shapeMaterial = additive(new THREE.ShaderMaterial({
      vertexShader: paint.shaders.shapeVertex,
      fragmentShader: paint.shaders.shapeFragment,
      uniforms: { uTime: { value: 0 }, uWobble: { value: WOBBLE }, uAccent: { value: new THREE.Vector3() } }
    }));

    inst.fieldScene = new THREE.Scene();
    inst.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
    inst.shapeData = new Float32Array(SHAPE_CAPACITY * SHAPE_STRIDE);
    inst.shapeBuffer = new THREE.InstancedInterleavedBuffer(inst.shapeData, SHAPE_STRIDE);
    inst.shapeBuffer.setUsage(THREE.DynamicDrawUsage);
    inst.shapeGeometry = new THREE.InstancedBufferGeometry();
    inst.shapeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    inst.shapeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    inst.shapeGeometry.setAttribute('iPos', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 2, 0));
    inst.shapeGeometry.setAttribute('iScale', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 2, 2));
    inst.shapeGeometry.setAttribute('iRot', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 1, 4));
    inst.shapeGeometry.setAttribute('iMix', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 3, 5));
    inst.shapeGeometry.setAttribute('iShape', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 1, 8));
    inst.shapeGeometry.setAttribute('iParam', new THREE.InterleavedBufferAttribute(inst.shapeBuffer, 1, 9));
    inst.shapeGeometry.instanceCount = 0;
    var shapeMesh = new THREE.Mesh(inst.shapeGeometry, inst.shapeMaterial);
    shapeMesh.frustumCulled = false;
    inst.fieldScene.add(shapeMesh);

    inst.developMaterial = new THREE.ShaderMaterial({
      vertexShader: paint.shaders.developVertex,
      fragmentShader: paint.shaders.developFragment,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: inst.fieldTarget.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uTime: { value: 0 },
        uFlow: { value: 1 },
        uGrain: { value: 1 },
        uDot: { value: DOT_SIZE },
        uAngle: { value: 0.5 },
        uFlood: { value: 0 },
        uInvert: { value: 0 },
        uSeed: { value: 0 },
        uSeeThrough: { value: 0 },
        uPaper: { value: new THREE.Vector3() },
        uInk: { value: new THREE.Vector3() },
        uAccent: { value: new THREE.Vector3() },
        uTone: { value: new THREE.Vector3() }
      }
    });
    inst.developScene = new THREE.Scene();
    inst.developCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    inst.developGeometry = new THREE.BufferGeometry();
    inst.developGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    var developMesh = new THREE.Mesh(inst.developGeometry, inst.developMaterial);
    developMesh.frustumCulled = false;
    inst.developScene.add(developMesh);

    applyPalette(inst);

    /* 副标题层（译文 / 下一句预览） */
    inst.subtitle = null;
    try {
      if (typeof foliaCreateSubtitleOverlay === 'function') {
        inst.subtitle = foliaCreateSubtitleOverlay(host, theme, typeof foliaResolveSubtitleFontSizes === 'function'
          ? foliaResolveSubtitleFontSizes(ctx.fontScale || 1) : undefined);
      }
    } catch (_) {}

    /* 等待播放占位（首行之前） */
    var waiting = document.createElement('div');
    waiting.className = 'folia-diorama-waiting';
    waiting.textContent = '等待播放';
    waiting.style.display = 'none';
    host.appendChild(waiting);
    inst.waiting = waiting;

    if (typeof ResizeObserver === 'function') {
      inst.resizeObserver = new ResizeObserver(function () {
        if (inst.disposed) return;
        if (resize(inst)) render(inst, inst.lastCtx || { time: inst.lastTime, showText: true });
      });
      inst.resizeObserver.observe(host);
    }

    try {
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(function () {
          if (inst.disposed) return;
          var ready = inst.glyphs.fontReady();
          if (ready && !inst.fontReady) {
            inst.fontReady = true;
            inst.glyphs.setFont(String(inst.theme.fontStack || ''), Number(inst.theme.weight) || DEFAULT_WEIGHT);
            dropSets(inst);
            inst.forceRender = true;
          }
        });
      }
    } catch (_) {}

    resize(inst);
    inst.forceRender = true;
    render(inst, ctx);
    return inst;
  }

  function tick(inst, ctx) {
    if (!inst || inst.disposed) return;
    inst.lastCtx = ctx;
    if (inst.subtitle && typeof inst.subtitle.update === 'function') {
      try { inst.subtitle.update(ctx, ctx.dt); } catch (_) {}
    }

    var themeKey = themeKeyOf(ctx.theme);
    if (themeKey !== inst.themeKey) {
      inst.themeKey = themeKey;
      inst.theme = ctx.theme || {};
      var stack = inst.theme.fontStack || 'system-ui, sans-serif';
      var weight = Number(inst.theme.weight);
      if (!isFinite(weight) || weight <= 0) weight = DEFAULT_WEIGHT;
      if (inst.glyphs.setFont(stack, weight)) {
        inst.fontReady = inst.glyphs.fontReady();
        dropSets(inst);
      }
      applyPalette(inst);
      rebuildProgram(inst);
    }

    if (ctx.linesRev !== inst.linesRev) {
      inst.linesRev = ctx.linesRev;
      inst.lines = ctx.lines || [];
      inst.songSeed = String(ctx.seed || 'metaphor');
      inst.songTitle = (ctx.song && ctx.song.title) || '';
      rebuildProgram(inst);
    } else {
      inst.lines = ctx.lines || inst.lines;
    }

    var resized = resize(inst);
    var time = Number(ctx.time);
    var timeChanged = !isFinite(inst.lastTime) || !isFinite(time) || Math.abs(time - inst.lastTime) > 1e-4;
    if (inst.waiting) {
      var hasLines = (ctx.lines && ctx.lines.length) > 0;
      inst.waiting.style.display = (!hasLines && time <= 0.001) ? 'block' : 'none';
    }
    if (resized || inst.forceRender || timeChanged) {
      inst.forceRender = false;
      render(inst, ctx);
    }
  }

  function destroy(inst) {
    if (!inst || inst.disposed) return;
    inst.disposed = true;
    if (inst.cancelPrepare) {
      inst.cancelPrepare();
      inst.cancelPrepare = null;
    }
    if (inst.resizeObserver) {
      try { inst.resizeObserver.disconnect(); } catch (_) {}
    }
    dropSets(inst);
    if (inst.subtitle && typeof inst.subtitle.destroy === 'function') {
      try { inst.subtitle.destroy(); } catch (_) {}
    }
    if (inst.waiting && inst.waiting.parentNode) inst.waiting.parentNode.removeChild(inst.waiting);
    try {
      inst.shapeGeometry.dispose();
      inst.developGeometry.dispose();
      inst.glyphMaterial.dispose();
      inst.shapeMaterial.dispose();
      inst.developMaterial.dispose();
      inst.fieldTarget.dispose();
      inst.renderer.dispose();
      var canvas = inst.renderer.domElement;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    } catch (_) {}
  }

  registerFoliaMode('metaphor', {
    name: '隐喻',
    /* 上游 order 29.5（商籁之后、凝彩之前） */
    order: 29.5,
    desc: '墨色融球 + 网点线稿，节拍硬切镜头',
    needsWebGL2: true,
    create: create,
    tick: tick,
    destroy: destroy
  });
})();
