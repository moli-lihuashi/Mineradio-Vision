/* Folia 世界 — 歌词样式：隐喻（metaphor）· 线稿与版面
 *
 * 移植自 Folia 0.8.x 的 src/components/visualizer/metaphor/metaphorFigures.ts。
 * 用细线、弧、波浪线、点和注记小字画出来的图，像论文和演算纸上的插图：
 *   1) 图：行星轨道、星图、晶格、晶胞、分子、对撞机探测器截面、费曼图、路径积分、演算草稿，
 *      以及十张高能物理草稿（电磁簇射/衰变链/气泡室/不变质量谱/企鹅图/箱图/加速器/希格斯势/跑动耦合/切伦科夫光锥）。
 *      一个 cue 挑几张，摆在字块外面（间奏时在舞台里排开），一笔一笔隔 0.2 秒冒出来，冒出来以后不动。
 *      另有一张大的垫在字后面：只进半调、线加粗，不看墨，所以不碍着读字。
 *   2) 版面：字后面一层网点（色带/方格纸/同心弧/点阵），和贴着字块的规线、裁切标记、行号与时间码。
 * 注记是公式和标签（衬线斜体），按量出来的字宽排开，交给字形图集画成细墨字。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  var F = window.FoliaMetaphor = window.FoliaMetaphor || {};
  var paint = F.paint;
  if (!paint) return;

  var SHAPE_BLOB = paint.constants.SHAPE_BLOB;
  var SHAPE_RING = paint.constants.SHAPE_RING;
  var SHAPE_BAR = paint.constants.SHAPE_BAR;
  var SHAPE_ARC = paint.constants.SHAPE_ARC;
  var SHAPE_WAVE = paint.constants.SHAPE_WAVE;
  var staticShape = paint.staticShape;

  var FIGURE_KINDS = [
    'orbit', 'starmap', 'lattice', 'cell', 'molecule', 'detector', 'feynman', 'paths', 'draft',
    'shower', 'decay', 'bubble', 'spectrum', 'penguin', 'box', 'collider', 'potential', 'running', 'cherenkov'
  ];

  var FIGURE_LIMIT = 240;
  var BACKDROP_LIMIT = 48;

  var TAU = Math.PI * 2;
  /* 线的半宽（世界单位） */
  var STROKE = 0.016;
  /* 融球阈值以上的那块是它半轴的多少（着色器里 k³ × 1.45 过 0.5） */
  var BLOB_CORE = 0.55;
  var ARC_AT = 0.9;
  var WAVE_AMP = 0.75;

  function span(rng, min, max) { return min + rng() * (max - min); }
  function choose(rng, items) { return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]; }
  function shuffle(rng, items) {
    var list = items.slice();
    for (var index = list.length - 1; index > 0; index -= 1) {
      var other = Math.floor(rng() * (index + 1));
      var swap = list[index];
      list[index] = list[other];
      list[other] = swap;
    }
    return list;
  }

  /* 一支笔：在一张图自己的坐标里画（图大约占半径 1），落到世界里时平移、缩放、转一个角度。 */
  function Pen(cx, cy, scale, rot, delay, mix, heavy) {
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
    this.rot = rot;
    this.delay = delay;
    this.mix = mix || { ink: 1, tone: 0, accent: 0 };
    this.heavy = heavy || 1;
    this.shapes = [];
    this.notes = [];
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    this.stroke = 0;
  }

  Pen.prototype.at = function (x, y) {
    return [this.cx + (x * this.cos - y * this.sin) * this.scale, this.cy + (x * this.sin + y * this.cos) * this.scale];
  };

  /* 三笔一组，一组比上一组晚 0.2 秒。 */
  Pen.prototype.born = function () {
    var born = this.delay + Math.floor(this.stroke / 3) * 0.2;
    this.stroke += 1;
    return born;
  };

  Pen.prototype.line = function (x0, y0, x1, y1, dashes, weight) {
    var a = this.at(x0, y0);
    var b = this.at(x1, y1);
    var patch = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, sx: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
      sy: STROKE * (weight || 1) * this.heavy, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), param: dashes || 0, born: this.born() };
    for (var key in this.mix) if (Object.prototype.hasOwnProperty.call(this.mix, key)) patch[key] = this.mix[key];
    this.shapes.push(staticShape(SHAPE_BAR, patch));
  };

  Pen.prototype.wave = function (x0, y0, x1, y1, halfWaves, amp) {
    var a = this.at(x0, y0);
    var b = this.at(x1, y1);
    var patch = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, sx: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
      sy: (amp * this.scale) / WAVE_AMP + STROKE * 3, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), param: halfWaves,
      born: this.born(), tone: (this.mix.tone || 0) + (this.heavy > 1 ? 0.2 : 0) };
    for (var key in this.mix) if (Object.prototype.hasOwnProperty.call(this.mix, key) && key !== 'tone') patch[key] = this.mix[key];
    this.shapes.push(staticShape(SHAPE_WAVE, patch));
  };

  Pen.prototype.arc = function (x, y, radius, mid, half, weight) {
    var c = this.at(x, y);
    var patch = { x: c[0], y: c[1], sx: (radius * this.scale) / ARC_AT, sy: (weight || 1) * this.heavy,
      rot: (mid || 0) + this.rot, param: Math.min(1, (half == null ? Math.PI : half) / Math.PI), born: this.born() };
    for (var key in this.mix) if (Object.prototype.hasOwnProperty.call(this.mix, key)) patch[key] = this.mix[key];
    this.shapes.push(staticShape(SHAPE_ARC, patch));
  };

  Pen.prototype.dot = function (x, y, radius) {
    var c = this.at(x, y);
    var size = (radius * this.scale) / BLOB_CORE;
    var patch = { x: c[0], y: c[1], sx: size, sy: size, born: this.born() };
    for (var key in this.mix) if (Object.prototype.hasOwnProperty.call(this.mix, key)) patch[key] = this.mix[key];
    this.shapes.push(staticShape(SHAPE_BLOB, patch));
  };

  Pen.prototype.orbiter = function (x, y, orbit, radius, speed, phase) {
    var c = this.at(x, y);
    var size = (radius * this.scale) / BLOB_CORE;
    var patch = { x: c[0], y: c[1], sx: size, sy: size, orbit: orbit * this.scale, orbitSpeed: speed,
      p1: phase, steady: true, born: this.born() };
    for (var key in this.mix) if (Object.prototype.hasOwnProperty.call(this.mix, key)) patch[key] = this.mix[key];
    this.shapes.push(staticShape(SHAPE_BLOB, patch));
  };

  Pen.prototype.arrow = function (x0, y0, x1, y1, at) {
    this.line(x0, y0, x1, y1);
    var angle = Math.atan2(y1 - y0, x1 - x0);
    var ratio = at == null ? 0.55 : at;
    var hx = x0 + (x1 - x0) * ratio;
    var hy = y0 + (y1 - y0) * ratio;
    this.line(hx, hy, hx - Math.cos(angle + 0.45) * 0.11, hy - Math.sin(angle + 0.45) * 0.11);
    this.line(hx, hy, hx - Math.cos(angle - 0.45) * 0.11, hy - Math.sin(angle - 0.45) * 0.11);
  };

  Pen.prototype.note = function (text, x, y, size, align, rot) {
    var a = this.at(x, y);
    this.notes.push({ text: text, x: a[0], y: a[1], size: size * this.scale, rot: (rot || 0) + this.rot, align: align || 0, born: this.born() });
  };

  /* ---- 图 1~9：科学插图 ---- */

  function drawOrbit(pen, rng) {
    var rings = 3 + Math.floor(rng() * 2);
    pen.dot(0, 0, 0.085);
    for (var index = 0; index < rings; index += 1) {
      var radius = 0.3 + (index * 0.7) / (rings - 1);
      pen.arc(0, 0, radius);
      pen.orbiter(0, 0, radius, span(rng, 0.03, 0.055), ((rng() < 0.85 ? 1 : -1) * 0.1) / Math.pow(radius, 1.5), rng() * TAU);
    }
    var angle = span(rng, 0.2, 1.2);
    pen.line(0, 0, Math.cos(angle), Math.sin(angle), 9);
    pen.arc(0, 0, 0.16, angle / 2, angle / 2);
    pen.note(choose(rng, ['T² ∝ a³', 'a = 1.52 AU', 'e = 0.0167', 'v² = GM/r']), Math.cos(angle) * 1.08, Math.sin(angle) * 1.08, 0.15);
    pen.arc(span(rng, -0.4, 0.4), span(rng, 0.9, 1.3), 1.5, -Math.PI / 2, 0.55);
  }

  function drawStarmap(pen, rng) {
    var stars = [];
    for (var tries = 0; stars.length < 7 && tries < 60; tries += 1) {
      var angle = rng() * TAU;
      var radius = Math.sqrt(rng()) * 0.85;
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;
      var ok = true;
      for (var i = 0; i < stars.length; i += 1) if (Math.hypot(stars[i][0] - x, stars[i][1] - y) <= 0.32) ok = false;
      if (ok) stars.push([x, y]);
    }
    stars.sort(function (a, b) { return a[0] - b[0]; });
    for (var index = 0; index < stars.length; index += 1) {
      pen.dot(stars[index][0], stars[index][1], span(rng, 0.03, 0.07));
      if (index > 0) pen.line(stars[index - 1][0], stars[index - 1][1], stars[index][0], stars[index][1]);
    }
    var named = stars[1] || stars[0];
    var crossed = stars[stars.length - 1] || stars[0];
    pen.arc(named[0], named[1], 0.14);
    pen.note(choose(rng, ['α', 'β', 'γ', 'δ']), named[0] + 0.18, named[1] + 0.14, 0.17);
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < dirs.length; d += 1) {
      pen.line(crossed[0] + dirs[d][0] * 0.1, crossed[1] + dirs[d][1] * 0.1, crossed[0] + dirs[d][0] * 0.24, crossed[1] + dirs[d][1] * 0.24);
    }
    var mid = span(rng, 0.9, 2.2);
    pen.arc(0, 0, 1.08, mid, 0.5);
    for (var tick = -2; tick <= 2; tick += 1) {
      var at = mid + tick * 0.22;
      pen.line(Math.cos(at) * 1.08, Math.sin(at) * 1.08, Math.cos(at) * 1.16, Math.sin(at) * 1.16);
    }
    pen.note(choose(rng, ['δ −05° 23′', 'RA 05h 35m', 'z = 0.0073', 'd = 4.2 ly']), -0.95, -1.05, 0.14);
  }

  function drawLattice(pen, rng) {
    var gamma = choose(rng, [Math.PI / 3, Math.PI / 2, 1.3]);
    var pitch = 0.46;
    var bx = Math.cos(gamma) * pitch;
    var by = Math.sin(gamma) * pitch;
    function at(column, row) { return [(column - 1.5) * pitch + (row - 1) * bx, (row - 1) * by]; }
    for (var row = 0; row < 3; row += 1) {
      for (var column = 0; column < 4; column += 1) {
        var p = at(column, row);
        if (column < 3) { var right = at(column + 1, row); pen.line(p[0], p[1], right[0], right[1]); }
        if (row < 2) { var down = at(column, row + 1); pen.line(p[0], p[1], down[0], down[1]); }
        pen.dot(p[0], p[1], 0.045);
      }
    }
    var ox = at(1, 0);
    var aEnd = at(2, 0);
    var bEnd = at(1, 1);
    pen.line(ox[0], ox[1], aEnd[0], aEnd[1], 0, 2.2);
    pen.line(ox[0], ox[1], bEnd[0], bEnd[1], 0, 2.2);
    pen.note('a', ox[0] + pitch / 2, ox[1] - 0.14, 0.16, 0.5);
    pen.note('b', ox[0] + bx / 2 - 0.14, ox[1] + by / 2, 0.16, 0.5);
    for (var c = 0; c < 3; c += 1) {
      var q = at(c, 1);
      pen.arc(q[0] + (pitch + bx) / 2, q[1] + by / 2, 0.05);
    }
    pen.note(choose(rng, ['nλ = 2d sinθ', 'a = 5.43 Å', '(1 1 1)', 'G · R = 2πn']), -0.9, -0.82, 0.15);
  }

  function drawCell(pen, rng) {
    var half = 0.52;
    var front = [[-half - 0.2, -half - 0.14], [half - 0.2, -half - 0.14], [half - 0.2, half - 0.14], [-half - 0.2, half - 0.14]];
    var back = front.map(function (p) { return [p[0] + 0.44, p[1] + 0.32]; });
    for (var index = 0; index < 4; index += 1) {
      var next = (index + 1) % 4;
      pen.line(front[index][0], front[index][1], front[next][0], front[next][1]);
      pen.line(back[index][0], back[index][1], back[next][0], back[next][1], index === 0 || index === 3 ? 7 : 0);
      pen.line(front[index][0], front[index][1], back[index][0], back[index][1], index === 0 ? 5 : 0);
      pen.dot(front[index][0], front[index][1], 0.055);
      pen.dot(back[index][0], back[index][1], 0.045);
    }
    var faceCentred = rng() < 0.5;
    if (faceCentred) {
      [front, back].forEach(function (face) {
        pen.arc((face[0][0] + face[2][0]) / 2, (face[0][1] + face[2][1]) / 2, 0.06);
      });
      for (var i = 0; i < 4; i += 1) {
        var n = (i + 1) % 4;
        pen.arc((front[i][0] + back[n][0]) / 2, (front[i][1] + back[n][1]) / 2, 0.05);
      }
    } else {
      pen.dot(0.02, 0.02, 0.075);
      pen.line(front[0][0], front[0][1], back[2][0], back[2][1], 9);
    }
    pen.note(faceCentred ? 'fcc' : 'bcc', -half - 0.2, half + 0.38, 0.18);
    pen.note(choose(rng, ['a = 3.61 Å', 'a = 2.87 Å', '[1 0 0]', 'Z = 4']), -half - 0.2, -half - 0.36, 0.14);
  }

  function drawMolecule(pen, rng) {
    if (rng() < 0.55) {
      function vertex(index, radius) {
        return [Math.cos(Math.PI / 6 + (index * Math.PI) / 3) * radius, Math.sin(Math.PI / 6 + (index * Math.PI) / 3) * radius];
      }
      for (var index = 0; index < 6; index += 1) {
        var a = vertex(index, 0.5);
        var b = vertex(index + 1, 0.5);
        pen.line(a[0], a[1], b[0], b[1]);
        if (index % 2 === 0) {
          var inner0 = vertex(index, 0.39);
          var inner1 = vertex(index + 1, 0.39);
          pen.line(inner0[0] + (inner1[0] - inner0[0]) * 0.12, inner0[1] + (inner1[1] - inner0[1]) * 0.12,
            inner1[0] + (inner0[0] - inner1[0]) * 0.12, inner1[1] + (inner0[1] - inner1[1]) * 0.12);
        }
      }
      var groups = shuffle(rng, ['OH', 'NH₂', 'CH₃', 'Cl', 'COOH']);
      shuffle(rng, [0, 1, 2, 3, 4, 5]).slice(0, 1 + Math.floor(rng() * 2)).forEach(function (at, order) {
        var from = vertex(at, 0.5);
        var to = vertex(at, 0.86);
        pen.line(from[0], from[1], to[0], to[1]);
        var label = vertex(at, 1.02);
        pen.note(groups[order], label[0], label[1], 0.16, 0.5);
      });
      pen.note(choose(rng, ['C₆H₆', 'sp²', 'π', '1.39 Å']), 0, -1.05, 0.15, 0.5);
      return;
    }
    var variants = [[2, 104.5, 'H₂O'], [3, 120, 'BF₃'], [4, 109.5, 'CH₄'], [2, 180, 'CO₂']];
    var picked = choose(rng, variants);
    var arms = picked[0];
    var angle = picked[1];
    var formula = picked[2];
    var spread = arms === 2 ? (angle * Math.PI) / 180 : TAU / arms;
    var start = Math.PI / 2 - (arms === 2 ? spread / 2 : 0);
    pen.dot(0, 0, 0.13);
    for (var arm = 0; arm < arms; arm += 1) {
      var direction = start + arm * spread;
      pen.line(Math.cos(direction) * 0.14, Math.sin(direction) * 0.14, Math.cos(direction) * 0.62, Math.sin(direction) * 0.62, 0, 1.6);
      pen.dot(Math.cos(direction) * 0.7, Math.sin(direction) * 0.7, 0.08);
    }
    if (angle < 180) {
      pen.arc(0, 0, 0.3, start + spread / 2, spread / 2);
      pen.note(angle + '°', Math.cos(start + spread / 2) * 0.42, Math.sin(start + spread / 2) * 0.42, 0.13, 0.5);
    }
    pen.note(formula, 0, -0.95, 0.18, 0.5);
  }

  function drawDetector(pen, rng) {
    pen.arc(0, 0, 0.32);
    pen.arc(0, 0, 0.62);
    pen.arc(0, 0, 1, 0, Math.PI, 1.6);
    pen.dot(0, 0, 0.035);
    for (var track = 5 + Math.floor(rng() * 4); track > 0; track -= 1) {
      var bend = span(rng, 0.55, 2.4);
      var direction = rng() * TAU;
      var side = rng() < 0.5 ? 1 : -1;
      var reach = rng() < 0.3 ? 0.62 : 1;
      var centre = direction + (side * Math.PI) / 2;
      var half = Math.asin(Math.min(1, reach / (2 * bend)));
      pen.arc(Math.cos(centre) * bend, Math.sin(centre) * bend, bend, centre + Math.PI + side * half, half);
    }
    var jets = [rng() * TAU, rng() * TAU];
    for (var tower = 7 + Math.floor(rng() * 4); tower > 0; tower -= 1) {
      var angle = choose(rng, jets) + span(rng, -0.35, 0.35);
      var height = span(rng, 0.05, 0.3);
      pen.line(Math.cos(angle) * 1.04, Math.sin(angle) * 1.04, Math.cos(angle) * (1.04 + height), Math.sin(angle) * (1.04 + height), 0, 2.4);
    }
    pen.note(choose(rng, ['√s = 13 TeV', 'pT > 20 GeV', '|η| < 2.5', 'B = 3.8 T']), -1, -1.3, 0.14);
  }

  function drawFeynman(pen, rng) {
    var variant = Math.floor(rng() * 3);
    if (variant === 0) {
      var sets = [['e⁻', 'e⁺', 'γ', 'μ⁻', 'μ⁺'], ['u', 'd', 'W', 'e', 'ν'], ['q', 'q', 'g', 't', 't']];
      var labels = choose(rng, sets);
      pen.arrow(-1, 0.6, -0.35, 0);
      pen.arrow(-0.35, 0, -1, -0.6);
      pen.wave(-0.35, 0, 0.35, 0, 7, 0.07);
      pen.arrow(0.35, 0, 1, 0.6);
      pen.arrow(1, -0.6, 0.35, 0);
      pen.dot(-0.35, 0, 0.04);
      pen.dot(0.35, 0, 0.04);
      pen.note(labels[0], -1.02, 0.78, 0.17, 0.5);
      pen.note(labels[1], -1.02, -0.78, 0.17, 0.5);
      pen.note(labels[2], 0, 0.22, 0.17, 0.5);
      pen.note(labels[3], 1.02, 0.78, 0.17, 0.5);
      pen.note(labels[4], 1.02, -0.78, 0.17, 0.5);
    } else if (variant === 1) {
      [0.45, -0.45].forEach(function (y) {
        pen.arrow(-1, y, 0, y);
        pen.arrow(0, y, 1, y);
        pen.dot(0, y, 0.04);
      });
      pen.wave(0, 0.45, 0, -0.45, 9, 0.07);
      pen.note('e⁻', -1.02, 0.64, 0.17, 0.5);
      pen.note('p', -1.02, -0.66, 0.17, 0.5);
      pen.note('γ', 0.2, 0, 0.17, 0.5);
      pen.note('−ie γμ', 0.2, 0.68, 0.13);
    } else {
      pen.wave(-1, 0, -0.4, 0, 7, 0.07);
      pen.arc(0, 0, 0.4);
      pen.wave(0.4, 0, 1, 0, 7, 0.07);
      pen.dot(-0.4, 0, 0.04);
      pen.dot(0.4, 0, 0.04);
      pen.line(0, 0.4, -0.1, 0.46);
      pen.line(0, 0.4, -0.1, 0.34);
      pen.line(0, -0.4, 0.1, -0.34);
      pen.line(0, -0.4, 0.1, -0.46);
      pen.note('γ', -0.72, 0.2, 0.17, 0.5);
      pen.note('k', 0, 0.6, 0.15, 0.5);
      pen.note('O(α²)', 0.5, -0.66, 0.14);
    }
    pen.line(-0.9, -1, 0.9, -1, 0, 0.8);
    pen.line(0.9, -1, 0.8, -0.95, 0, 0.8);
    pen.line(0.9, -1, 0.8, -1.05, 0, 0.8);
    pen.note('t', 1, -1, 0.14);
  }

  function drawPaths(pen, rng) {
    pen.dot(-0.9, 0, 0.06);
    pen.dot(0.9, 0, 0.06);
    pen.line(-0.9, 0, 0.9, 0, 0, 1.5);
    for (var halfWaves = 1; halfWaves <= 6; halfWaves += 1) pen.wave(-0.9, 0, 0.9, 0, halfWaves, span(rng, 0.12, 0.6) / Math.sqrt(halfWaves));
    pen.note('A', -1.08, 0, 0.17, 0.5);
    pen.note('B', 1.08, 0, 0.17, 0.5);
    pen.note(choose(rng, ['Z = ∫Dφ exp(iS/ħ)', 'δS = 0', 'S = ∫ L dt', '⟨B|A⟩ = Σ exp(iS/ħ)']), -0.9, -0.85, 0.15);
  }

  var FORMULAS = [
    'E² = p²c² + m²c⁴', 'S = ∫ L d⁴x', '∇·E = ρ/ε₀', 'Δx Δp ≥ ħ/2', 'r = 2GM/c²', '1/(p² − m² + iε)', '∫ d⁴k/(2π)⁴', 'α ≈ 1/137',
    'Σ 1/n² = π²/6', 'H ψ = E ψ', '∂μ Fμν = Jν', 'T = 2.725 K', 'F = G m₁m₂/r²', 'dS ≥ 0', 'β = −11 + 2n/3'
  ];

  function drawDraft(pen, rng) {
    var lines = shuffle(rng, FORMULAS).slice(0, 4);
    var struck = Math.floor(rng() * 2);
    var boxed = 3;
    lines.forEach(function (text, row) {
      var y = 0.85 - row * 0.3;
      var width = Array.from(text).length * 0.085;
      pen.note(text, -1, y, 0.16);
      if (row === struck) pen.line(-1.04, y - 0.03, -1 + width + 0.04, y + 0.04);
      if (row === 2) pen.line(-1, y - 0.12, -1 + width, y - 0.12);
      if (row === boxed) {
        var x0 = -1.08, x1 = -1 + width + 0.08, y0 = y - 0.14, y1 = y + 0.14;
        pen.line(x0, y0, x1, y0);
        pen.line(x1, y0, x1, y1);
        pen.line(x1, y1, x0, y1);
        pen.line(x0, y1, x0, y0);
      }
    });
    var ox = -0.2;
    var oy = -1.1;
    pen.line(ox, oy, ox + 1.2, oy);
    pen.line(ox, oy, ox, oy + 0.62);
    var peak = span(rng, 0.45, 0.8);
    for (var index = 0; index < 11; index += 1) {
      var x = 0.08 + index * 0.1;
      var offset = (x - peak) / 0.11;
      pen.dot(ox + x, oy + 0.06 + 0.5 / (1 + offset * offset) + span(rng, -0.025, 0.025), 0.022);
    }
    pen.line(ox + peak, oy, ox + peak, oy + 0.6, 7);
    pen.note(choose(rng, ['m = 125 GeV', 'Γ', 'm₀', 'σ(E)']), ox + peak + 0.06, oy + 0.64, 0.13);
    pen.note(choose(rng, ['∴', '= 0 ?', '→ ∞', '+ h.c.', 'QED']), 0.55, 0.55, 0.2);
  }

  /* ---- 图 10~19：高能物理草稿 ---- */

  function drawShower(pen, rng) {
    pen.arrow(-1.05, 0, -0.6, 0);
    pen.note('e⁻', -1.05, 0.16, 0.16);
    var layer = [{ x: -0.6, y: 0, photon: false }];
    for (var generation = 0; generation < 4; generation += 1) {
      var spread = 0.42 / Math.pow(2, generation);
      var next = [];
      if (generation > 0) pen.line(layer[0].x, -0.95, layer[0].x, 0.95, 11);
      for (var i = 0; i < layer.length; i += 1) {
        var node = layer[i];
        pen.dot(node.x, node.y, 0.022);
        for (var s = 0; s < 2; s += 1) {
          var side = s === 0 ? 1 : -1;
          var child = { x: node.x + 0.38, y: node.y + side * spread * span(rng, 0.8, 1.15), photon: node.photon ? false : side > 0 };
          if (child.photon) pen.wave(node.x, node.y, child.x, child.y, 5, 0.028);
          else pen.line(node.x, node.y, child.x, child.y);
          next.push(child);
        }
      }
      layer = next;
    }
    pen.note('X₀', -0.22, -1.08, 0.15, 0.5);
    pen.note(choose(rng, ['N ≈ 2ⁿ', 'E/2ⁿ < Ec', 'tmax ∝ ln E']), 0.2, 1.1, 0.14);
  }

  function drawDecay(pen, rng) {
    var variants = [
      ['H', 'Z', 'μ⁺', 'μ⁻', 'e⁺', 'e⁻', 'm = 125 GeV'],
      ['H', 'W', 'ℓ', 'ν', 'q', 'q', 'BR ≈ 21%'],
      ['t t', 'W', 'b', 'ℓν', 'b', 'jj', 'm = 173 GeV']
    ];
    var picked = choose(rng, variants);
    pen.dot(-0.95, 0, 0.07);
    pen.line(-0.95, 0, -0.4, 0, 5);
    pen.dot(-0.4, 0, 0.035);
    pen.note(picked[0], -0.95, 0.2, 0.18, 0.5);
    var leaves = [[picked[2], picked[3]], [picked[4], picked[5]]];
    [1, -1].forEach(function (side, branch) {
      var y = side * 0.52;
      pen.wave(-0.4, 0, 0.2, y, 7, 0.045);
      pen.dot(0.2, y, 0.035);
      pen.note(picked[1], -0.16, y * 0.5 + side * 0.2, 0.16, 0.5);
      [1, -1].forEach(function (fork, leaf) {
        var end = y + fork * 0.3;
        pen.arrow(0.2, y, 0.9, end);
        pen.note(leaves[branch][leaf], 1.04, end, 0.16, 0.5);
      });
    });
    pen.note(picked[6], -1, -1, 0.14);
  }

  /* 一条越卷越紧的螺旋：几段半圆接起来，圆心在两个点之间来回换。 */
  function spiral(pen, x, y, radius, shrink, direction, flip) {
    for (var turn = 0; turn < 5 && radius - turn * shrink > 0.03; turn += 1) {
      var centre = x + direction * (radius - (turn % 2 === 0 ? 0 : shrink));
      pen.arc(centre, y, radius - turn * shrink, (turn % 2 === 0 ? 1 : -1) * flip * (Math.PI / 2), Math.PI / 2);
    }
  }

  function drawBubble(pen, rng) {
    var vx = span(rng, -0.15, 0.15);
    var vy = span(rng, -0.25, 0.05);
    pen.line(-1.1, vy - 0.25, vx, vy, 9);
    pen.dot(vx, vy, 0.03);
    spiral(pen, vx, vy, span(rng, 0.3, 0.42), 0.07, -1, 1);
    spiral(pen, vx, vy, span(rng, 0.36, 0.5), 0.085, 1, -1);
    for (var track = 2 + Math.floor(rng() * 2); track > 0; track -= 1) {
      var angle = span(rng, -0.5, 0.5);
      pen.line(vx, vy, vx + Math.cos(angle) * 1.1, vy + Math.sin(angle) * 1.1);
    }
    for (var bubble = 0; bubble < 7; bubble += 1) pen.dot(-0.95 + bubble * (0.2 - bubble * 0.012), 0.75 + bubble * 0.03, 0.02);
    [[-0.85, -0.85], [0.85, 0.8]].forEach(function (cross) {
      pen.line(cross[0] - 0.1, cross[1], cross[0] + 0.1, cross[1]);
      pen.line(cross[0], cross[1] - 0.1, cross[0], cross[1] + 0.1);
    });
    pen.note('γ → e⁺e⁻', vx - 0.5, vy - 0.62, 0.15);
    pen.note(choose(rng, ['B = 2 T', 'p = 0.3 B r', 'Λ → p π⁻']), 0.3, -1, 0.14);
  }

  function drawSpectrum(pen, rng) {
    var ox = -0.9;
    var oy = -0.8;
    pen.line(ox, oy, 1, oy);
    pen.line(ox, oy, ox, 0.85);
    var peak = 6 + Math.floor(rng() * 4);
    var bins = 14;
    var width = 1.8 / bins;
    for (var bin = 0; bin < bins; bin += 1) {
      var offset = (bin - peak) / 0.9;
      var height = 1.35 * Math.exp(-bin * 0.2) + 0.3 * Math.exp(-offset * offset) + 0.05;
      var x = ox + 0.05 + bin * width;
      pen.line(x, oy + height, x + width, oy + height);
      var point = oy + height + span(rng, -0.06, 0.06);
      pen.dot(x + width / 2, point, 0.022);
      pen.line(x + width / 2, point - 0.07, x + width / 2, point + 0.07);
    }
    var px = ox + 0.05 + (peak + 0.5) * width;
    pen.line(px, oy, px, oy + 0.95, 7);
    pen.note(choose(rng, ['125', '91.2', '3.1']), px, oy - 0.14, 0.14, 0.5);
    pen.note(choose(rng, ['m(γγ)  GeV', 'm(μμ)  GeV', 'm(4ℓ)  GeV']), 1, oy - 0.14, 0.14, 1);
    pen.note('Events', ox - 0.14, 0.85, 0.14, 1, Math.PI / 2);
    pen.note(choose(rng, ['5σ', 'S/√B', 'χ²/ndf = 1.1']), px + 0.12, oy + 1.02, 0.16);
  }

  function drawPenguin(pen, rng) {
    pen.arrow(-1.05, 0.15, -0.45, 0.15);
    pen.arrow(-0.45, 0.15, 0.45, 0.15, 0.3);
    pen.arrow(0.45, 0.15, 1.05, 0.15);
    pen.arc(0, 0.15, 0.45, Math.PI / 2, Math.PI / 2);
    pen.dot(-0.45, 0.15, 0.035);
    pen.dot(0.45, 0.15, 0.035);
    pen.dot(0, 0.15, 0.035);
    pen.wave(0, 0.15, 0, -0.5, 9, 0.05);
    pen.dot(0, -0.5, 0.035);
    pen.arrow(0, -0.5, 0.75, -0.3);
    pen.arrow(0.75, -0.8, 0, -0.5);
    pen.note('b', -1.05, 0.33, 0.17, 0.5);
    pen.note('s', 1.05, 0.33, 0.17, 0.5);
    pen.note('W', 0, 0.76, 0.17, 0.5);
    pen.note(choose(rng, ['t', 'u, c, t']), -0.22, 0.02, 0.14, 0.5);
    pen.note('g', 0.18, -0.2, 0.16, 0.5);
    pen.note('q', 0.88, -0.28, 0.15, 0.5);
    pen.note('q', 0.88, -0.84, 0.15, 0.5);
    pen.note(choose(rng, ['b → s g', 'Vtb V*ts', 'O(GF αs)']), -1, -0.95, 0.14);
  }

  function drawBox(pen, rng) {
    var variants = [['K⁰', 's', 'd'], ['B⁰', 'b', 'd'], ['D⁰', 'c', 'u']];
    var picked = choose(rng, variants);
    var meson = picked[0], upper = picked[1], lower = picked[2];
    pen.arrow(-1.05, 0.38, -0.42, 0.38);
    pen.arrow(-0.42, 0.38, 0.42, 0.38);
    pen.arrow(0.42, 0.38, 1.05, 0.38);
    pen.arrow(1.05, -0.38, 0.42, -0.38);
    pen.arrow(0.42, -0.38, -0.42, -0.38);
    pen.arrow(-0.42, -0.38, -1.05, -0.38);
    pen.wave(-0.42, 0.38, -0.42, -0.38, 7, 0.05);
    pen.wave(0.42, 0.38, 0.42, -0.38, 7, 0.05);
    [-0.42, 0.42].forEach(function (x) {
      pen.dot(x, 0.38, 0.035);
      pen.dot(x, -0.38, 0.035);
    });
    pen.note(upper, -0.75, 0.56, 0.16, 0.5);
    pen.note(lower, -0.75, -0.58, 0.16, 0.5);
    pen.note(lower, 0.75, 0.56, 0.16, 0.5);
    pen.note(upper, 0.75, -0.58, 0.16, 0.5);
    pen.note('u, c, t', 0, 0.56, 0.13, 0.5);
    pen.note('W', -0.62, 0, 0.16, 0.5);
    pen.note('W', 0.62, 0, 0.16, 0.5);
    pen.note(meson, -1.25, 0, 0.18, 0.5);
    pen.note(choose(rng, ['Δm', 'ΔF = 2', 'ε ≈ 2.2×10⁻³']), -0.3, -1, 0.15);
  }

  function drawCollider(pen, rng) {
    pen.arc(0.15, 0.1, 0.85, 0, Math.PI, 1.4);
    pen.arc(0.15, 0.1, 0.79);
    pen.arc(-0.52, -0.68, 0.27);
    pen.arc(-0.92, -0.9, 0.1);
    pen.line(-1.3, -1.02, -1, -0.96, 0, 2.2);
    pen.line(-0.84, -0.84, -0.72, -0.86);
    pen.line(-0.33, -0.49, -0.42, -0.52);
    var turn = rng() * 0.6;
    var labels = ['IP1', 'IP2', 'IP5', 'IP8'];
    for (var point = 0; point < 4; point += 1) {
      var angle = turn + (point * Math.PI) / 2;
      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      pen.dot(0.15 + cos * 0.82, 0.1 + sin * 0.82, 0.05);
      pen.line(0.15 + cos * 0.7, 0.1 + sin * 0.7, 0.15 + cos * 0.95, 0.1 + sin * 0.95, 0, 1.6);
      pen.note(labels[point], 0.15 + cos * 1.12, 0.1 + sin * 1.12, 0.13, 0.5);
    }
    [[turn + 0.8, 0.85, 1], [turn + 0.8 + Math.PI, 0.79, -1]].forEach(function (beam) {
      var x = 0.15 + Math.cos(beam[0]) * beam[1];
      var y = 0.1 + Math.sin(beam[0]) * beam[1];
      var along = beam[0] + (beam[2] * Math.PI) / 2;
      [0.5, -0.5].forEach(function (side) {
        pen.line(x, y, x - Math.cos(along + side) * 0.12, y - Math.sin(along + side) * 0.12);
      });
    });
    pen.note(choose(rng, ['27 km', 'C = 26.7 km', '2808 bunches']), 0.15, 0.1, 0.16, 0.5);
    pen.note(choose(rng, ['√s = 13.6 TeV', 'L = 2×10³⁴', 'B = 8.3 T']), 0.15, -0.14, 0.13, 0.5);
    pen.note('LINAC', -1.3, -1.18, 0.12);
  }

  function drawPotential(pen, rng) {
    function curve(x) { return 3.2 * Math.pow(x * x - 0.5, 2) - 0.6; }
    pen.line(-1.15, -0.78, 1.15, -0.78);
    pen.line(0, -0.9, 0, 0.9);
    var steps = 22;
    for (var step = 0; step < steps; step += 1) {
      var x0 = -1.05 + (step * 2.1) / steps;
      var x1 = -1.05 + ((step + 1) * 2.1) / steps;
      pen.line(x0, curve(x0), x1, curve(x1), 0, 1.3);
    }
    var side = rng() < 0.5 ? 1 : -1;
    var valley = side * Math.SQRT1_2;
    pen.arc(0, curve(0) + 0.07, 0.06);
    pen.dot(valley, curve(valley) + 0.07, 0.065);
    pen.line(side * 0.1, curve(0) + 0.02, valley - side * 0.12, curve(valley) + 0.24, 6);
    pen.line(valley, -0.78, valley, curve(valley), 5);
    pen.note('V(φ)', 0.08, 0.92, 0.16);
    pen.note('φ', 1.2, -0.92, 0.16, 0.5);
    pen.note('v', valley, -0.92, 0.15, 0.5);
    pen.note(choose(rng, ['v = 246 GeV', 'μ² < 0', 'V = μ²φ² + λφ⁴', 'mH² = 2λv²']), -1.1, -1.12, 0.14);
  }

  function drawRunning(pen, rng) {
    var ox = -0.9;
    var oy = -0.8;
    pen.line(ox, oy, 1.05, oy);
    pen.line(ox, oy, ox, 0.85);
    for (var tick = 1; tick <= 6; tick += 1) pen.line(ox + tick * 0.28, oy, ox + tick * 0.28, oy + (tick % 2 === 0 ? 0.08 : 0.05));
    var meet = span(rng, 0.5, 0.7);
    var gap = rng() < 0.5 ? 0.09 : 0.02;
    var starts = [0.62, 0.05, -0.5];
    var suffixes = ['₁', '₂', '₃'];
    starts.forEach(function (start, index) {
      var end = -0.02 + (index - 1) * -gap;
      var slope = (end - start) / (meet - ox);
      pen.line(ox, start, 1, start + slope * (1 - ox), 0, index === 2 ? 1.6 : 1);
      pen.note('α' + suffixes[index] + '⁻¹', ox + 0.08, start + 0.13, 0.15);
    });
    pen.line(meet, oy, meet, 0.6, 9);
    pen.note(choose(rng, ['10¹⁶ GeV', 'MGUT', 'Λ']), meet, oy - 0.14, 0.14, 0.5);
    pen.note('log Q', 1.05, oy - 0.14, 0.14, 1);
    pen.note(choose(rng, ['β₀ = 11 − 2n/3', 'dα/d ln Q = β(α)', 'SUSY ?']), 0, 0.92, 0.14);
  }

  function drawCherenkov(pen, rng) {
    var sine = span(rng, 0.42, 0.6);
    var angle = Math.asin(sine);
    pen.arrow(-1.1, 0, 1.05, 0, 0.92);
    for (var wave = 0; wave < 6; wave += 1) {
      var x = -0.85 + wave * 0.3;
      pen.arc(x, 0, (0.9 - x) * sine);
      pen.dot(x, 0, 0.02);
    }
    var reach = 1.75 * Math.cos(angle);
    [1, -1].forEach(function (side) {
      pen.line(0.9, 0, 0.9 - Math.cos(angle) * reach, side * Math.sin(angle) * reach, 0, 1.5);
      var fx = 0.9 - Math.cos(angle) * reach * 0.55;
      var fy = side * Math.sin(angle) * reach * 0.55;
      pen.wave(fx, fy, fx + Math.sin(angle) * 0.5, fy + side * Math.cos(angle) * 0.5, 6, 0.035);
    });
    pen.arc(0.9, 0, 0.3, Math.PI - angle / 2, angle / 2);
    pen.note('θ', 0.5, 0.1, 0.15, 0.5);
    pen.note('cos θ = 1/nβ', -1.1, -1.12, 0.15);
    pen.note(choose(rng, ['β > 1/n', 'n = 1.33', 'v > c/n']), 0.35, 1.02, 0.14);
  }

  var DRAW = {
    orbit: drawOrbit, starmap: drawStarmap, lattice: drawLattice, cell: drawCell, molecule: drawMolecule,
    detector: drawDetector, feynman: drawFeynman, paths: drawPaths, draft: drawDraft,
    shower: drawShower, decay: drawDecay, bubble: drawBubble, spectrum: drawSpectrum, penguin: drawPenguin,
    box: drawBox, collider: drawCollider, potential: drawPotential, running: drawRunning, cherenkov: drawCherenkov
  };

  /* 垫在字后面的那张：只进半调，线粗到网点画得出来。 */
  var TONE_MIX = { ink: 0, tone: 0.75, accent: 0 };
  var TONE_HEAVY = 2.6;

  function drawFigure(kind, rng, x, y, scale, rot, delay, toned) {
    var pen = toned ? new Pen(x, y, scale, rot, delay, TONE_MIX, TONE_HEAVY) : new Pen(x, y, scale, rot, delay);
    DRAW[kind](pen, rng);
    if (toned) return { shapes: pen.shapes, notes: [] };
    return { shapes: pen.shapes, notes: pen.notes };
  }

  /* 间奏时图摆在舞台的这几处（半宽、半高的倍数） */
  var STAGE_SLOTS = [[-0.72, 0.3], [0.72, -0.3], [0, -0.1]];
  /* 一张图连注记大约占它 scale 的多少倍 */
  var FIGURE_REACH = 1.35;
  /* 全景镜头留的边（相机层的 WIDE_MARGIN）；图往画面外再多排这么多 */
  var FRAME_SPILL = 1.15;
  var WIDE_MARGIN = 1.1;

  /* 把全景镜头看得见的那块切成大格，去掉碰到字的，剩下的挑一半左右，一格一张。 */
  function freeCells(halfW, halfH, aspect, rng) {
    var frameH = Math.max(halfH, 0.6, Math.max(halfW, 0.8) / aspect) * WIDE_MARGIN * FRAME_SPILL;
    var frameW = frameH * aspect;
    var cell = Math.min(5, Math.max(2.4, Math.min(frameW, frameH) / 1.1));
    var columns = Math.max(1, Math.round((frameW * 2) / cell));
    var rows = Math.max(1, Math.round((frameH * 2) / cell));
    var cellW = (frameW * 2) / columns;
    var cellH = (frameH * 2) / rows;
    var cells = [];
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        var x0 = -frameW + column * cellW;
        var y0 = -frameH + row * cellH;
        if (x0 < halfW + 0.15 && x0 + cellW > -halfW - 0.15 && y0 < halfH + 0.15 && y0 + cellH > -halfH - 0.15) continue;
        cells.push({ x: x0 + cellW / 2, y: y0 + cellH / 2, scale: Math.min(2.4, Math.min(cellW, cellH) / (2 * FIGURE_REACH)) });
      }
    }
    return shuffle(rng, cells);
  }

  function planFigures(bounds, rng, amount, interlude, aspect) {
    var figures = { shapes: [], notes: [] };
    if (amount <= 0) return figures;
    var ratio = aspect == null ? 1.6 : aspect;
    var halfW = (bounds.x1 - bounds.x0) / 2;
    var halfH = (bounds.y1 - bounds.y0) / 2;
    var reach = Math.max(halfW, halfH, 2);
    var cells = interlude ? [] : freeCells(halfW, halfH, Math.min(4, Math.max(0.25, ratio)), rng);
    var wanted = cells.length > 0 ? cells.length * 0.5 * Math.min(1.5, amount) + rng() * 0.6 : 1.6 * amount + rng() * 0.9;
    var total = interlude ? Math.min(STAGE_SLOTS.length, 1 + Math.round(amount)) : Math.min(4, Math.max(1, Math.round(wanted)));
    var kinds = shuffle(rng, FIGURE_KINDS);
    var sides = shuffle(rng, [0, 1, 2, 3]);
    var under = drawFigure(kinds[total], rng, span(rng, -0.35, 0.35) * halfW, span(rng, -0.35, 0.35) * halfH,
      reach * (interlude ? 0.6 : 0.85) * span(rng, 0.85, 1.2), span(rng, -0.3, 0.3), 0, true);
    for (var u = 0; u < under.shapes.length; u += 1) figures.shapes.push(under.shapes[u]);
    for (var index = 0; index < total; index += 1) {
      var scale = (interlude ? 1.2 : Math.min(2, Math.max(1, reach * 0.36))) * span(rng, 0.85, 1.15);
      var x;
      var y;
      if (interlude) {
        var slot = STAGE_SLOTS[index % STAGE_SLOTS.length];
        x = slot[0] * halfW + span(rng, -0.25, 0.25);
        y = slot[1] * halfH + span(rng, -0.3, 0.3);
      } else if (index < cells.length) {
        var cell = cells[index];
        var fit = span(rng, 0.7, 0.95);
        scale = Math.max(0.8, cell.scale * fit);
        x = cell.x + span(rng, -1, 1) * cell.scale * (1 - fit) * FIGURE_REACH;
        y = cell.y + span(rng, -1, 1) * cell.scale * (1 - fit) * FIGURE_REACH;
      } else {
        var out = scale * FIGURE_REACH + 0.2;
        var side = sides[index % sides.length];
        var along = span(rng, -0.7, 0.7);
        x = side < 2 ? along * halfW : (side === 2 ? -1 : 1) * (halfW + out);
        y = side < 2 ? (side === 0 ? 1 : -1) * (halfH + out) : along * halfH;
      }
      var figure = drawFigure(kinds[index % kinds.length], rng, x, y, scale, span(rng, -0.12, 0.12), 0.3 + index * 0.7);
      for (var s = 0; s < figure.shapes.length; s += 1) figures.shapes.push(figure.shapes[s]);
      for (var n = 0; n < figure.notes.length; n += 1) figures.notes.push(figure.notes[n]);
    }
    if (figures.shapes.length > FIGURE_LIMIT) figures.shapes.length = FIGURE_LIMIT;
    return figures;
  }

  function pad2(value) { return String(Math.max(0, Math.floor(value))).padStart(2, '0'); }
  function timecode(seconds) { return pad2(seconds / 60) + ':' + pad2(seconds % 60); }

  /* 一个 cue 的版面：字后面那层网点 + 贴着字块的规线/裁切标记/行号与时间码。 */
  function planBackdrop(bounds, rng, amount, interlude, info) {
    var halfW = (bounds.x1 - bounds.x0) / 2;
    var halfH = (bounds.y1 - bounds.y0) / 2;
    var reach = Math.max(halfW, halfH, 2);
    var shapes = [];
    function tone(shape, patch) {
      var base = { ink: 0, accent: 0 };
      for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) base[key] = patch[key];
      shapes.push(staticShape(shape, base));
    }

    if (amount > 0) {
      var layer = choose(rng, ['band', 'band', 'grid', 'arcs', 'dots', 'plain']);
      if (layer === 'band') {
        var upright = rng() < 0.3;
        var half = (upright ? halfW : halfH) * span(rng, 0.3, 0.75);
        var shift = (upright ? halfW : halfH) * span(rng, -0.7, 0.7);
        tone(SHAPE_BAR, {
          x: upright ? shift : 0, y: upright ? 0 : shift, sx: reach * 9, sy: half, tone: span(rng, 0.3, 0.5),
          rot: (upright ? Math.PI / 2 : 0) + (rng() < 0.4 ? span(rng, -0.2, 0.2) : 0)
        });
      } else if (layer === 'grid') {
        var pitch = Math.max(1, reach / 3.5);
        var columns = Math.min(7, Math.ceil((halfW + pitch * 2) / pitch));
        var rows = Math.min(5, Math.ceil((halfH + pitch * 2) / pitch));
        for (var column = -columns; column <= columns; column += 1) {
          tone(SHAPE_BAR, { x: column * pitch, sx: rows * pitch, sy: 0.022, rot: Math.PI / 2, tone: column === 0 ? 0.8 : 0.4 });
        }
        for (var row = -rows; row <= rows; row += 1) {
          tone(SHAPE_BAR, { y: row * pitch, sx: columns * pitch, sy: 0.022, tone: row === 0 ? 0.8 : 0.4 });
        }
      } else if (layer === 'arcs') {
        var cx = (rng() < 0.5 ? -1 : 1) * (halfW + reach * 0.6);
        var cy = (rng() < 0.5 ? -1 : 1) * (halfH + reach * 0.4);
        for (var ring = 1; ring <= 5; ring += 1) {
          tone(SHAPE_ARC, { x: cx, y: cy, sx: (reach * 0.7 * ring) / ARC_AT, sy: 2.5, param: 1, tone: 0.55 });
        }
      } else if (layer === 'dots') {
        var gap = Math.max(0.9, reach / 3);
        var skew = rng() < 0.5 ? 0.5 : 0;
        for (var dotRow = -2; dotRow <= 2; dotRow += 1) {
          for (var dotColumn = -3; dotColumn <= 3; dotColumn += 1) {
            tone(SHAPE_BLOB, { x: (dotColumn + (dotRow % 2 === 0 ? 0 : skew)) * gap, y: dotRow * gap * 0.87, sx: 0.2, sy: 0.2, tone: 1 });
          }
        }
      }
    }
    if (shapes.length > BACKDROP_LIMIT) shapes.length = BACKDROP_LIMIT;
    if (interlude) return { shapes: shapes, notes: [] };

    var pen = new Pen(0, 0, 1, 0, 0);
    var furniture = choose(rng, ['rules', 'rules', 'crop', 'margin', 'none']);
    var left = -halfW - 0.1;
    var right = halfW + 0.1;
    var size = Math.min(0.34, Math.max(0.2, reach * 0.07));
    if (furniture === 'rules') {
      pen.line(left, halfH + 0.3, right, halfH + 0.3, 0, 2.6);
      pen.line(left, -halfH - 0.3, right, -halfH - 0.3);
      pen.note(pad2(info.index), left, halfH + 0.3 + size * 0.95, size);
      pen.note(timecode(info.time), right, -halfH - 0.3 - size * 0.95, size, 1);
    } else if (furniture === 'crop') {
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sy) {
          var x = sx * (halfW + 0.3);
          var y = sy * (halfH + 0.3);
          pen.line(x + sx * 0.12, y, x + sx * 0.5, y);
          pen.line(x, y + sy * 0.12, x, y + sy * 0.5);
        });
      });
      pen.note(pad2(info.index) + ' — ' + timecode(info.time), 0, -halfH - 0.3 - size * 1.1, size, 0.5);
    } else if (furniture === 'margin') {
      var mx = left - 0.3;
      pen.line(mx, -halfH, mx, halfH, 0, 1.8);
      for (var tick = 0; tick <= 4; tick += 1) {
        var ty = -halfH + (tick * halfH) / 2;
        pen.line(mx, ty, mx + (tick % 2 === 0 ? 0.22 : 0.12), ty);
      }
      pen.note(pad2(info.index) + ' / ' + timecode(info.time), mx - size * 0.9, halfH, size, 1, Math.PI / 2);
    }
    var merged = shapes.slice();
    for (var i = 0; i < pen.shapes.length; i += 1) merged.push(pen.shapes[i]);
    return { shapes: merged, notes: pen.notes };
  }

  /* 注记排成一个个字：按量出来的字宽沿注记的方向排开。 */
  function layoutNotes(notes, measure) {
    var glyphs = [];
    for (var n = 0; n < notes.length; n += 1) {
      var note = notes[n];
      var chars = Array.from(note.text);
      var advances = chars.map(function (char) { return measure(char) * note.size; });
      var total = advances.reduce(function (sum, advance) { return sum + advance; }, 0);
      var cos = Math.cos(note.rot);
      var sin = Math.sin(note.rot);
      var pen = -total * note.align;
      for (var index = 0; index < chars.length; index += 1) {
        var along = pen + advances[index] / 2;
        pen += advances[index];
        if (chars[index].trim() === '') continue;
        glyphs.push({ char: chars[index], x: note.x + along * cos, y: note.y + along * sin, size: note.size, rot: note.rot, born: note.born });
      }
    }
    return glyphs;
  }

  F.figures = {
    kinds: FIGURE_KINDS,
    planFigures: planFigures,
    planBackdrop: planBackdrop,
    layoutNotes: layoutNotes,
    drawFigure: drawFigure,
    Pen: Pen
  };
})();
