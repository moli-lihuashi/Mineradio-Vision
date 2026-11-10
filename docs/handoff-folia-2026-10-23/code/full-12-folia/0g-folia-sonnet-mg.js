/* Folia 世界 — 商籁（sonnet）MG 图库
 *
 * 移植自 Folia src/components/visualizer/sonnet/ 的绘制层（与运行时机零耦合，
 * 只被 0g-folia-mode-sonnet.js 的 buildSonnetShotMg 入口调用）：
 *   sonnetShotMg.ts 814 + sonnetAdditionalShotMg.ts 229 +
 *   sonnetThemedShotMg.ts 32 + sonnetThemedShotMgPrimitives.ts 67 +
 *   sonnetOpenFrameShotMg.ts 347 + sonnetExtendedShotMg.ts 37 +
 *   sonnetShotMgCelestial.ts 250 + sonnetShotMgMarine.ts 282 +
 *   sonnetShotMgMusic.ts 193 + sonnetShotMgCraft.ts 257 +
 *   sonnetShotMgKinetic.ts 341 + sonnetShotMgArchitecture.ts 80 +
 *   sonnetShotMgBotanical.ts 58 + sonnetShotMgFlora.ts 58 +
 *   sonnetShotMgLandscape.ts 75 + sonnetBackgroundMgVariants.ts 349 +
 *   sonnetFixedGeoVariants.ts 224 + sonnetBackgroundDecor.ts 272 +
 *   sonnetIcons.ts 91 + sonnetIconTextures.ts 57 +
 *   sonnetAnimatedGraphics.ts 245 + sonnetSpatialMgGeometry.ts 148 +
 *   sonnetShotMgViewport.ts 6。
 *
 * 图库结构（100 个 geo 变体，全部由 seed 确定性选中）：
 *   0–17   内联在 buildSonnetShotMg（含 molecule 3 子变体 / prism 4 种）
 *   18–23  additional（contour-atlas / radial-wave / transit-blueprint /
 *          chronograph / folded-ribbons / halftone-poster）
 *   24–35  themed 十二种（花鸟 / 建筑 / 山水）
 *   36–47  open-frame 十二种（开放构图：不画封闭视口边界、不用 clip mask）
 *   48–99  extended 五十二种（celestial 10 / marine 10 / music 8 / craft 10 / kinetic 14）
 * 另有 bg HUD 8 变体、fixedGeo 8 变体、backgroundDecor 6 变体。
 *
 * 必须照抄的判据（改一处就整体走形）：
 *   - 变体选择：resolveSonnetGeoVariant = ((trunc(seed)%100)+100)%100；
 *     子变体走 cycle = floor(trunc(seed)/100)，与主索引独立
 *   - bg HUD / fixedGeo / decor 各自带盐混合（0x9e3779b9 / 0x85ebca6b / 0xc2b2ae35）
 *   - AnimatedGraphics 的 stagger：黄金比例 0.618 起排，stroke delay≤0.5 span 0.32~0.58，
 *     fill delay≤0.45 span 0.4~0.65；逐段按弧长截断，fill 的 rect 走左→右宽度擦除
 *   - circle() 的起点与方向用 Math.random()（Folia 原样，非确定性装饰层，
 *     冒烟不对这些层做强断言）
 *   - open-frame / extended 全 range：每条 stroke 独立命令，没有封闭视口边界
 *   - bleed = max(radius*0.92, 轴长*0.64)，开放构图用它冲出画外
 *
 * 与 Folia 的实现差异（输入数据缺失，非公式差异）：
 *   1) theme.lyricsIcons 本项目恒不存在 → resolveSonnetIconNames 恒回落 ['Flower']，
 *      Lucide Flower 的 SVG 按 lucide-react@1.48.0 的 renderToStaticMarkup 输出
 *      静态 vendored（见第 13 节），不再依赖 react / react-dom / lucide-react。
 *   2) pixi 走全局 PIXI（vendor/folia/pixi/pixi.min.js UMD），不是 ESM import。
 */
(function () {
  'use strict';

  /* ============================== 1. pixi 适配 ============================== */

  /* Folia sonnetShotMg.ts 顶部两行。colorNumber 每帧会调很多次，
   * Color.shared 是 pixi 8 的单例，setValue().toNumber() 就是 CSS 串 → 0xRRGGBB。 */
  function sonnetColorNumber(pixi, color) {
    return pixi.Color.shared.setValue(color).toNumber();
  }

  /* Folia：音频电平归一化。本项目 audioBands 已经是 0..1，但 frequencyData 派生值
   * 可能是 0..255，所以保留 >1 时除 255 的分支。 */
  function sonnetNormalizeAudioLevel(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n > 1 ? n / 255 : n));
  }

  /* ============================== 2. AnimatedGraphics ============================== */
  /* sonnetAnimatedGraphics.ts：把 Graphics 命令录成 path（含每段长度），
   * scheduleStagger 用黄金比例给每条 stroke/fill 分配 delay/span，
   * update(rawProgress) 按局部 cubic ease-out 逐段生长。 */

  var SONNET_STAGGER_GOLDEN = 0.6180339887498949;

  function sonnetCreateAnimatedGraphics(pixi) {
    var display = new pixi.Graphics();
    var self = {
      display: display,
      commands: [],
      currentPath: [],
      currentLength: 0,
      lastX: 0,
      lastY: 0,
      staggerScheduled: false,
      drawnProgress: NaN,
      drawnCommandCount: -1
    };

    /* rotation / mask 必须转发到 display（Folia 用 getter/setter）。 */
    Object.defineProperty(self, 'rotation', {
      get: function () { return display.rotation; },
      set: function (v) { display.rotation = v; }
    });
    Object.defineProperty(self, 'mask', {
      get: function () { return display.mask; },
      set: function (v) { display.mask = v; }
    });

    self.moveTo = function (x, y) {
      self.currentPath.push({ type: 'moveTo', x: x, y: y });
      self.lastX = x;
      self.lastY = y;
      return self;
    };

    self.lineTo = function (x, y) {
      var len = Math.hypot(x - self.lastX, y - self.lastY);
      self.currentPath.push({ type: 'lineTo', x: x, y: y, len: len, lastX: self.lastX, lastY: self.lastY });
      self.currentLength += len;
      self.lastX = x;
      self.lastY = y;
      return self;
    };

    self.quadraticCurveTo = function (cx, cy, tx, ty) {
      var len = Math.hypot(cx - self.lastX, cy - self.lastY) + Math.hypot(tx - cx, ty - cy);
      self.currentPath.push({
        type: 'quadraticCurveTo', cx: cx, cy: cy, tx: tx, ty: ty,
        len: len, lastX: self.lastX, lastY: self.lastY
      });
      self.currentLength += len;
      self.lastX = tx;
      self.lastY = ty;
      return self;
    };

    self.bezierCurveTo = function (c1x, c1y, c2x, c2y, tx, ty) {
      var len = Math.hypot(c1x - self.lastX, c1y - self.lastY)
        + Math.hypot(c2x - c1x, c2y - c1y)
        + Math.hypot(tx - c2x, ty - c2y);
      self.currentPath.push({
        type: 'bezierCurveTo', c1x: c1x, c1y: c1y, c2x: c2x, c2y: c2y, tx: tx, ty: ty,
        len: len, lastX: self.lastX, lastY: self.lastY
      });
      self.currentLength += len;
      self.lastX = tx;
      self.lastY = ty;
      return self;
    };

    self.arc = function (cx, cy, r, start, end, anticlockwise) {
      if (anticlockwise === undefined) anticlockwise = false;
      var diff = end - start;
      if (anticlockwise && diff > 0) diff -= Math.PI * 2;
      else if (!anticlockwise && diff < 0) diff += Math.PI * 2;
      var len = Math.abs(diff) * r;
      self.currentPath.push({
        type: 'arc', cx: cx, cy: cy, r: r, start: start, end: end,
        anticlockwise: anticlockwise, len: len, diff: diff
      });
      self.currentLength += len;
      self.lastX = cx + Math.cos(end) * r;
      self.lastY = cy + Math.sin(end) * r;
      return self;
    };

    self.circle = function (x, y, r) {
      /* Folia 原样：起点与方向随机，避免「都从右边开始画」的统一感。 */
      var start = Math.random() * Math.PI * 2;
      var anticlockwise = Math.random() > 0.5;
      var diff = anticlockwise ? -Math.PI * 2 : Math.PI * 2;
      var len = Math.PI * 2 * r;
      var startX = x + Math.cos(start) * r;
      var startY = y + Math.sin(start) * r;

      self.moveTo(startX, startY);
      self.currentPath.push({
        type: 'arc', cx: x, cy: y, r: r, start: start, end: start + diff,
        anticlockwise: anticlockwise, len: len, diff: diff
      });
      self.currentLength += len;
      self.lastX = x + Math.cos(start + diff) * r;
      self.lastY = y + Math.sin(start + diff) * r;
      return self;
    };

    self.rect = function (x, y, w, h) {
      self.currentPath.push({ type: 'rect_hint', x: x, y: y, w: w, h: h });
      self.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).lineTo(x, y);
      return self;
    };

    self.stroke = function (options) {
      if (self.currentPath.length > 0) {
        self.commands.push({ type: 'stroke', path: self.currentPath.slice(), length: self.currentLength, options: options });
        self.currentPath = [];
        self.currentLength = 0;
      }
      return self;
    };

    self.fill = function (options) {
      if (self.currentPath.length > 0) {
        self.commands.push({ type: 'fill', path: self.currentPath.slice(), length: self.currentLength, options: options });
        self.currentPath = [];
        self.currentLength = 0;
      }
      return self;
    };

    function scheduleStagger() {
      var strokeIndex = 0;
      var fillIndex = 0;
      for (var i = 0; i < self.commands.length; i++) {
        var cmd = self.commands[i];
        var isStroke = cmd.type === 'stroke';
        var index = isStroke ? strokeIndex++ : fillIndex++;
        var slot = (index * SONNET_STAGGER_GOLDEN) % 1;
        var jitter = ((index * 2654435761) >>> 0) / 4294967296;
        var delay = slot * (isStroke ? 0.5 : 0.45);
        var span = isStroke ? 0.32 + jitter * 0.26 : 0.4 + jitter * 0.25;
        cmd.staggerDelay = delay;
        cmd.staggerSpan = Math.min(span, 1 - delay);
      }
      self.staggerScheduled = true;
    }

    self.update = function (rawProgress) {
      /* 每条命令的局部窗口都在 0..1 内，窗口外的进度画的是同一帧；
       * 画满之后每帧重 tessellate 同样的几何是纯浪费。 */
      var key = Math.min(1, Math.max(0, rawProgress));
      if (key === self.drawnProgress && self.commands.length === self.drawnCommandCount) return;
      self.drawnProgress = key;
      self.drawnCommandCount = self.commands.length;
      display.clear();
      if (!self.staggerScheduled) scheduleStagger();

      for (var ci = 0; ci < self.commands.length; ci++) {
        var cmd = self.commands[ci];
        if (cmd.type === 'fill') {
          display.moveTo(0, 0);
          var localRaw = Math.min(1, Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan));
          var localProgress = 1 - Math.pow(1 - localRaw, 3);
          var isRectWipe = false;
          if (cmd.path.length === 6 && cmd.path[0].type === 'rect_hint') {
            isRectWipe = true;
            var r = cmd.path[0];
            /* 左→右 mask 擦除：只动画宽度。 */
            display.rect(r.x, r.y, r.w * localProgress, r.h);
          }
          if (!isRectWipe) {
            for (var pi = 0; pi < cmd.path.length; pi++) {
              var p = cmd.path[pi];
              if (p.type === 'rect_hint') continue;
              if (p.type === 'moveTo') display.moveTo(p.x, p.y);
              else if (p.type === 'lineTo') display.lineTo(p.x, p.y);
              else if (p.type === 'circle') display.circle(p.x, p.y, p.r);
              else if (p.type === 'arc') display.arc(p.cx, p.cy, p.r, p.start, p.end, p.anticlockwise);
              else if (p.type === 'quadraticCurveTo') display.quadraticCurveTo(p.cx, p.cy, p.tx, p.ty);
              else if (p.type === 'bezierCurveTo') display.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
            }
          }
          var alphaProgress = 1 - Math.pow(1 - Math.min(1, localRaw * 2), 3);
          var alpha = (cmd.options.alpha == null ? 1 : cmd.options.alpha) * alphaProgress;
          var fillOptions = {};
          for (var fk in cmd.options) fillOptions[fk] = cmd.options[fk];
          fillOptions.alpha = alpha;
          display.fill(fillOptions);
        } else if (cmd.type === 'stroke') {
          if (cmd.length <= 0) continue;

          var localRawS = Math.min(1, Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan));
          var localProgressS = 1 - Math.pow(1 - localRawS, 3);

          var targetLen = cmd.length * localProgressS;
          var currentLen = 0;

          for (var si = 0; si < cmd.path.length; si++) {
            var sp = cmd.path[si];
            if (sp.type === 'rect_hint') continue;
            if (sp.type === 'moveTo') {
              display.moveTo(sp.x, sp.y);
            } else {
              if (currentLen >= targetLen) break;

              if (currentLen + sp.len <= targetLen) {
                if (sp.type === 'lineTo') display.lineTo(sp.x, sp.y);
                else if (sp.type === 'circle') display.circle(sp.x, sp.y, sp.r);
                else if (sp.type === 'arc') display.arc(sp.cx, sp.cy, sp.r, sp.start, sp.end, sp.anticlockwise);
                else if (sp.type === 'quadraticCurveTo') display.quadraticCurveTo(sp.cx, sp.cy, sp.tx, sp.ty);
                else if (sp.type === 'bezierCurveTo') display.bezierCurveTo(sp.c1x, sp.c1y, sp.c2x, sp.c2y, sp.tx, sp.ty);
                currentLen += sp.len;
              } else {
                var ratio = (targetLen - currentLen) / sp.len;
                if (sp.type === 'lineTo') {
                  display.lineTo(sp.lastX + (sp.x - sp.lastX) * ratio, sp.lastY + (sp.y - sp.lastY) * ratio);
                } else if (sp.type === 'circle') {
                  display.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2 * ratio);
                } else if (sp.type === 'arc') {
                  display.arc(sp.cx, sp.cy, sp.r, sp.start, sp.start + sp.diff * ratio, sp.anticlockwise);
                } else if (sp.type === 'quadraticCurveTo') {
                  var ncpX = sp.lastX + ratio * (sp.cx - sp.lastX);
                  var ncpY = sp.lastY + ratio * (sp.cy - sp.lastY);
                  var ntx = (1 - ratio) * (1 - ratio) * sp.lastX + 2 * (1 - ratio) * ratio * sp.cx + ratio * ratio * sp.tx;
                  var nty = (1 - ratio) * (1 - ratio) * sp.lastY + 2 * (1 - ratio) * ratio * sp.cy + ratio * ratio * sp.ty;
                  display.quadraticCurveTo(ncpX, ncpY, ntx, nty);
                } else if (sp.type === 'bezierCurveTo') {
                  var q0x = sp.lastX + ratio * (sp.c1x - sp.lastX);
                  var q0y = sp.lastY + ratio * (sp.c1y - sp.lastY);
                  var q1x = sp.c1x + ratio * (sp.c2x - sp.c1x);
                  var q1y = sp.c1y + ratio * (sp.c2y - sp.c1y);
                  var q2x = sp.c2x + ratio * (sp.tx - sp.c2x);
                  var q2y = sp.c2y + ratio * (sp.ty - sp.c2y);
                  var r0x = q0x + ratio * (q1x - q0x);
                  var r0y = q0y + ratio * (q1y - q0y);
                  var r1x = q1x + ratio * (q2x - q1x);
                  var r1y = q1y + ratio * (q2y - q1y);
                  display.bezierCurveTo(q0x, q0y, r0x, r0y, r0x + ratio * (r1x - r0x), r0y + ratio * (r1y - r0y));
                }
                currentLen = targetLen;
                break;
              }
            }
          }

          display.stroke(cmd.options);
        }
      }
    };

    return self;
  }

  /* ============================== 3. 变体选择 ============================== */
  /* sonnetSpatialMgGeometry.ts：确定性变体选择。主索引与子变体互相独立，
   * 子变体走 cycle（seed 除以 100 的商），所以同一首歌的 molecule / HUD 旋转
   * 不会跟着主 geo 变体一起变。 */

  var SONNET_GEO_VARIANT_COUNT = 100;
  var SONNET_TAU = Math.PI * 2;

  function sonnetResolveGeoVariant(seed) {
    return ((Math.trunc(seed) % SONNET_GEO_VARIANT_COUNT) + SONNET_GEO_VARIANT_COUNT)
      % SONNET_GEO_VARIANT_COUNT;
  }

  function sonnetResolveGeoCycle(seed) {
    return Math.floor(Math.trunc(seed) / SONNET_GEO_VARIANT_COUNT);
  }

  /* 子变体选择与主几何索引独立。 */
  function sonnetResolveGeoSubVariant(seed, count) {
    var cycle = sonnetResolveGeoCycle(seed);
    return ((cycle % count) + count) % count;
  }

  function sonnetResolveMoleculeVariant(seed) {
    return sonnetResolveGeoSubVariant(seed, 3);
  }

  function sonnetResolveHudRotationQuarterTurns(seed) {
    return sonnetResolveGeoSubVariant(seed, 4);
  }

  /* ---- 可复用空间配方（实体棱柱） ---- */

  function sonnetGeoTracePolygon(target, points) {
    target.moveTo(points[0][0], points[0][1]);
    for (var index = 1; index < points.length; index += 1) {
      target.lineTo(points[index][0], points[index][1]);
    }
    return target.lineTo(points[0][0], points[0][1]);
  }

  function sonnetGeoDrawFace(target, points, color, fillAlpha) {
    sonnetGeoTracePolygon(target, points).fill({ color: color, alpha: fillAlpha });
  }

  function sonnetDrawSolidCuboid(target, x, y, width, height, depthX, depthY, color, alpha) {
    var left = x - width / 2;
    var right = x + width / 2;
    var top = y - height / 2;
    var bottom = y + height / 2;
    var front = [[left, top], [right, top], [right, bottom], [left, bottom]];
    var topFace = [[left, top], [left + depthX, top + depthY], [right + depthX, top + depthY], [right, top]];
    var sideFace = [[right, top], [right + depthX, top + depthY], [right + depthX, bottom + depthY], [right, bottom]];
    sonnetGeoDrawFace(target, topFace, color, alpha * 0.42);
    sonnetGeoDrawFace(target, sideFace, color, alpha * 0.68);
    sonnetGeoDrawFace(target, front, color, alpha * 0.24);
  }

  function sonnetDrawExtrudedPolygon(target, front, depthX, depthY, color, alpha) {
    var back = [];
    for (var i = 0; i < front.length; i++) back.push([front[i][0] + depthX, front[i][1] + depthY]);
    for (var index = 0; index < front.length; index += 1) {
      var next = (index + 1) % front.length;
      sonnetGeoDrawFace(
        target,
        [front[index], back[index], back[next], front[next]],
        color,
        alpha * (0.34 + (index % 3) * 0.12)
      );
    }
    sonnetGeoDrawFace(target, front, color, alpha * 0.22);
  }

  function sonnetDrawTriangularPrism(target, x, y, width, height, depthX, depthY, color, alpha) {
    sonnetDrawExtrudedPolygon(target, [
      [x, y - height / 2],
      [x + width / 2, y + height / 2],
      [x - width / 2, y + height / 2]
    ], depthX, depthY, color, alpha);
  }

  function sonnetDrawHexagonalPrism(target, x, y, width, height, depthX, depthY, color, alpha) {
    sonnetDrawExtrudedPolygon(target, [
      [x - width * 0.25, y - height / 2],
      [x + width * 0.25, y - height / 2],
      [x + width / 2, y],
      [x + width * 0.25, y + height / 2],
      [x - width * 0.25, y + height / 2],
      [x - width / 2, y]
    ], depthX, depthY, color, alpha);
  }

  function sonnetDrawTrapezoidPrism(target, x, y, topWidth, bottomWidth, height, depthX, depthY, color, alpha) {
    sonnetDrawExtrudedPolygon(target, [
      [x - topWidth / 2, y - height / 2],
      [x + topWidth / 2, y - height / 2],
      [x + bottomWidth / 2, y + height / 2],
      [x - bottomWidth / 2, y + height / 2]
    ], depthX, depthY, color, alpha);
  }

  /* sonnetShotMgViewport.ts：开放构图的 overscan，让开放路径冲出每条画布边。 */
  function sonnetResolveShotMgBleed(width, height, radius) {
    return {
      x: Math.max(radius * 0.92, width * 0.64),
      y: Math.max(radius * 0.92, height * 0.64)
    };
  }

  /* ============================== 4. 主题基元 ============================== */
  /* sonnetThemedShotMgPrimitives.ts：themed 序列共用的路径配方。 */

  function sonnetTracePolygon(target, points) {
    for (var index = 0; index < points.length; index++) {
      if (index === 0) target.moveTo(points[index][0], points[index][1]);
      else target.lineTo(points[index][0], points[index][1]);
    }
    return target.lineTo(points[0][0], points[0][1]);
  }

  function sonnetFillPolygon(target, points, color, alpha) {
    sonnetTracePolygon(target, points).fill({ color: color, alpha: alpha });
  }

  function sonnetStrokePolygon(target, points, color, alpha, width) {
    if (width === undefined) width = 1.5;
    sonnetTracePolygon(target, points).stroke({ color: color, alpha: alpha, width: width });
  }

  function sonnetDrawLeaf(target, x, y, length, width, angle, color, fillAlpha) {
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    var nx = -dy;
    var ny = dx;
    var tipX = x + dx * length;
    var tipY = y + dy * length;
    target.moveTo(x, y)
      .quadraticCurveTo(x + dx * length * 0.45 + nx * width, y + dy * length * 0.45 + ny * width, tipX, tipY)
      .quadraticCurveTo(x + dx * length * 0.45 - nx * width, y + dy * length * 0.45 - ny * width, x, y)
      .fill({ color: color, alpha: fillAlpha });
    target.moveTo(x, y)
      .quadraticCurveTo(x + dx * length * 0.45 + nx * width, y + dy * length * 0.45 + ny * width, tipX, tipY)
      .quadraticCurveTo(x + dx * length * 0.45 - nx * width, y + dy * length * 0.45 - ny * width, x, y)
      .stroke({ color: color, alpha: Math.min(0.8, fillAlpha * 3.2), width: 1.5 });
    target.moveTo(x, y).lineTo(tipX, tipY).stroke({ color: color, alpha: 0.32, width: 1 });
  }

  function sonnetDrawPetal(target, cx, cy, length, width, angle, color, fillAlpha) {
    sonnetDrawLeaf(target, cx, cy, length, width, angle, color, fillAlpha);
  }

  /* ============================== 5. 内联 geo 变体 0–17 ============================== */
  /* sonnetShotMg.ts 的 buildSonnetShotMg。type-impact / fragment-collage 两种
   * 镜头会建「几何混沌」层（geo）+ 反向旋转的 fixedGeo 层；editorial-column 走
   * 严格栅格；quiet-tableau / mask-reveal 只撒几个小方块。 */

  function sonnetBuildShotMg(pixi, kind, theme, width, height, seed, iconTextures) {
    var container = new pixi.Container();
    var primary = sonnetColorNumber(pixi, theme.primaryColor);
    var secondary = sonnetColorNumber(pixi, theme.secondaryColor);
    var radius = Math.min(width, height);

    /* 背景 UI 层 */
    var bg = sonnetCreateAnimatedGraphics(pixi);

    /* HUD 覆盖层（seed 选中的背景 MG 变体） */
    var hw = width / 2;
    var hh = height / 2;
    sonnetDrawBackgroundMgHud({
      target: bg,
      variant: sonnetResolveBackgroundMgVariant(seed),
      width: width,
      height: height,
      seed: seed,
      primary: primary,
      secondary: secondary
    });

    /* 几何混沌 */
    var geo;
    var fixedGeoParts = [];
    var fixedGeoLayer;
    if (kind === 'type-impact' || kind === 'fragment-collage') {
      geo = sonnetCreateAnimatedGraphics(pixi);
      var geoVariant = sonnetResolveGeoVariant(seed);

      if (geoVariant === 0) {
        /* Variant 0: 巨大圆框 + 放射线 */
        geo.circle(0, 0, radius * 0.6).stroke({ color: primary, width: 6, alpha: 0.8 });
        geo.circle(0, 0, radius * 0.58).stroke({ color: primary, width: 2, alpha: 0.4 });
        for (var i = 0; i < 32; i++) {
          var angle = (i / 32) * Math.PI * 2;
          var r1 = radius * (0.3 + (i % 3) * 0.05);
          var r2 = radius * 0.55;
          geo.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1)
            .lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2)
            .stroke({ color: primary, width: 1, alpha: 0.2 + (i % 2) * 0.1 });
        }
      } else if (geoVariant === 1) {
        /* Variant 1: 嵌套菱形 */
        var r = radius * 0.7;
        geo.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).lineTo(0, -r).stroke({ color: primary, width: 6, alpha: 0.8 });
        geo.moveTo(0, -r * 0.96).lineTo(r * 0.96, 0).lineTo(0, r * 0.96).lineTo(-r * 0.96, 0).lineTo(0, -r * 0.96).stroke({ color: primary, width: 2, alpha: 0.4 });
        geo.moveTo(0, -r * 0.4).lineTo(r * 0.4, 0).lineTo(0, r * 0.4).lineTo(-r * 0.4, 0).lineTo(0, -r * 0.4).stroke({ color: primary, width: 1, alpha: 0.6 });
        geo.moveTo(-r, 0).lineTo(r, 0).stroke({ color: primary, width: 1, alpha: 0.3 });
        geo.moveTo(0, -r).lineTo(0, r).stroke({ color: primary, width: 1, alpha: 0.3 });
      } else if (geoVariant === 2) {
        /* Variant 2: 科技六边形网格 */
        var drawHex = function (x, y, hr, w, a) {
          geo.moveTo(x + hr * Math.sin(0), y - hr * Math.cos(0));
          for (var j = 1; j <= 6; j++) geo.lineTo(x + hr * Math.sin(j * Math.PI / 3), y - hr * Math.cos(j * Math.PI / 3));
          geo.stroke({ color: primary, width: w, alpha: a });
        };
        drawHex(0, 0, radius * 0.6, 6, 0.8);
        drawHex(0, 0, radius * 0.57, 2, 0.4);
        drawHex(0, 0, radius * 0.25, 1, 0.5);
        /* 连接辐条 */
        for (var j = 0; j < 6; j++) {
          var spokeAngle = j * Math.PI / 3 - Math.PI / 6; /* 指向顶点 */
          geo.moveTo(Math.cos(spokeAngle) * radius * 0.25, Math.sin(spokeAngle) * radius * 0.25)
            .lineTo(Math.cos(spokeAngle) * radius * 0.57, Math.sin(spokeAngle) * radius * 0.57)
            .stroke({ color: primary, width: 2, alpha: 0.4 });
        }
      } else if (geoVariant === 3) {
        /* Variant 3: 有机分子 */
        var molVariant = sonnetResolveMoleculeVariant(seed);

        if (molVariant === 0) {
          /* 子变体 0: 苯环簇 */
          var hexR = radius * 0.22;
          var drawBenzene = function (cx, cy, scale, rotationOffset) {
            if (rotationOffset === undefined) rotationOffset = 0;
            var br = hexR * scale;
            geo.moveTo(cx + br * Math.sin(rotationOffset), cy - br * Math.cos(rotationOffset));
            for (var j = 1; j <= 6; j++) {
              geo.lineTo(cx + br * Math.sin(j * Math.PI / 3 + rotationOffset), cy - br * Math.cos(j * Math.PI / 3 + rotationOffset));
            }
            geo.stroke({ color: primary, width: 3, alpha: 0.8 });

            /* 双键 */
            for (var j = 0; j < 6; j += 2) {
              var innerR = br * 0.82;
              geo.moveTo(cx + innerR * Math.sin(j * Math.PI / 3 + rotationOffset), cy - innerR * Math.cos(j * Math.PI / 3 + rotationOffset))
                .lineTo(cx + innerR * Math.sin((j + 1) * Math.PI / 3 + rotationOffset), cy - innerR * Math.cos((j + 1) * Math.PI / 3 + rotationOffset))
                .stroke({ color: primary, width: 2, alpha: 0.5 });
            }
          };

          var rMain = hexR * 1.2;
          drawBenzene(0, 0, 1.2); /* 中心环 */

          /* 右侧稠环 */
          var dx = Math.sin(Math.PI / 3) * rMain * 2;
          drawBenzene(dx, 0, 1.2);

          /* 左上稠环 */
          var branchDist = Math.sin(Math.PI / 3) * rMain * 2;
          drawBenzene(-Math.sin(Math.PI / 6) * branchDist, -Math.cos(Math.PI / 6) * branchDist, 1.2);

          /* 连接结构线 */
          geo.moveTo(0, rMain)
            .lineTo(0, rMain + radius * 0.2)
            .lineTo(radius * 0.15, rMain + radius * 0.35)
            .stroke({ color: primary, width: 2, alpha: 0.6 });
        } else if (molVariant === 1) {
          /* 子变体 1: 咖啡因/血清素样（稠六边形 + 五边形 + 分支） */
          var hexR = radius * 0.22;
          geo.moveTo(0, -hexR);
          for (var j = 1; j <= 6; j++) geo.lineTo(hexR * Math.sin(j * Math.PI / 3), -hexR * Math.cos(j * Math.PI / 3));
          geo.stroke({ color: primary, width: 3, alpha: 0.8 });

          geo.moveTo(hexR * 0.8 * Math.sin(Math.PI / 3), -hexR * 0.8 * Math.cos(Math.PI / 3))
            .lineTo(hexR * 0.8 * Math.sin(2 * Math.PI / 3), -hexR * 0.8 * Math.cos(2 * Math.PI / 3))
            .stroke({ color: primary, width: 2, alpha: 0.5 });
          geo.moveTo(hexR * 0.8 * Math.sin(4 * Math.PI / 3), -hexR * 0.8 * Math.cos(4 * Math.PI / 3))
            .lineTo(hexR * 0.8 * Math.sin(5 * Math.PI / 3), -hexR * 0.8 * Math.cos(5 * Math.PI / 3))
            .stroke({ color: primary, width: 2, alpha: 0.5 });

          var px1 = hexR * Math.sqrt(3) / 2;
          var py1 = -hexR / 2;
          var px2 = hexR * Math.sqrt(3) / 2;
          var py2 = hexR / 2;
          var pentTopX = px1 + hexR * 0.8;
          var pentTopY = py1 - hexR * 0.1;
          var pentMidX = px1 + hexR * 1.2;
          var pentMidY = 0;
          var pentBotX = px2 + hexR * 0.8;
          var pentBotY = py2 + hexR * 0.1;

          geo.moveTo(px1, py1).lineTo(pentTopX, pentTopY).lineTo(pentMidX, pentMidY)
            .lineTo(pentBotX, pentBotY).lineTo(px2, py2).stroke({ color: primary, width: 3, alpha: 0.8 });

          var drawBranch = function (sx, sy, angle, len, node) {
            var ex = sx + Math.cos(angle) * len;
            var ey = sy + Math.sin(angle) * len;
            geo.moveTo(sx, sy).lineTo(ex, ey).stroke({ color: primary, width: 2, alpha: 0.6 });
            if (node) geo.circle(ex, ey, 6).stroke({ color: primary, width: 2, alpha: 0.8 });
          };

          drawBranch(0, -hexR, -Math.PI / 2, radius * 0.15, true);
          drawBranch(-hexR * Math.sqrt(3) / 2, hexR / 2, Math.PI * 0.8, radius * 0.2, true);
          drawBranch(-hexR * Math.sqrt(3) / 2, -hexR / 2, -Math.PI * 0.8, radius * 0.15, false);
          drawBranch(pentMidX, pentMidY, 0, radius * 0.18, false);
          drawBranch(pentMidX + radius * 0.18, pentMidY, Math.PI / 4, radius * 0.1, true);
        } else {
          /* 子变体 2: 线性聚合物链（锯齿主干 + 官能团） */
          var segLen = radius * 0.18;
          var steps = 7;
          var startX = -segLen * (steps / 2) * Math.cos(Math.PI / 6);
          var pts = [];

          var cx = startX;
          var cy = 0;
          pts.push({ x: cx, y: cy });
          for (var i = 0; i < steps; i++) {
            cx += segLen * Math.cos(Math.PI / 6);
            cy = (i % 2 === 0 ? 1 : -1) * segLen * Math.sin(Math.PI / 6);
            pts.push({ x: cx, y: cy });
          }

          geo.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i <= steps; i++) geo.lineTo(pts[i].x, pts[i].y);
          geo.stroke({ color: primary, width: 3, alpha: 0.8 });

          /* 双键的偏移法线 */
          var nx = -Math.sin(Math.PI / 6) * 6;
          var ny = Math.cos(Math.PI / 6) * 6;
          geo.moveTo(pts[1].x + nx, pts[1].y + ny)
            .lineTo(pts[2].x + nx, pts[2].y + ny)
            .stroke({ color: primary, width: 2, alpha: 0.5 });

          for (var i = 1; i < steps; i++) {
            var angle = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
            var bx = pts[i].x;
            var by = pts[i].y + Math.sin(angle) * segLen * 0.6;
            geo.moveTo(pts[i].x, pts[i].y).lineTo(bx, by).stroke({ color: primary, width: 2, alpha: 0.5 });
            if (i % 2 !== 0) {
              geo.circle(bx, by, 5).stroke({ color: primary, width: 2, alpha: 0.8 });
            } else {
              geo.moveTo(bx, by).lineTo(bx + segLen * 0.5, by - segLen * 0.3).stroke({ color: primary, width: 2, alpha: 0.5 });
            }
          }
        }
      } else if (geoVariant === 4) {
        /* Variant 4: 原子电子轨道（相交椭圆） */
        var ellR = radius * 0.7;
        for (var i = 0; i < 3; i++) {
          var angle = i * Math.PI / 3;
          var steps = 60;
          for (var j = 0; j <= steps; j++) {
            var t = j * Math.PI * 2 / steps;
            var ex = Math.cos(t) * ellR;
            var ey = Math.sin(t) * ellR * 0.18;
            var rx = ex * Math.cos(angle) - ey * Math.sin(angle);
            var ry = ex * Math.sin(angle) + ey * Math.cos(angle);
            if (j === 0) geo.moveTo(rx, ry);
            else geo.lineTo(rx, ry);
          }
          geo.stroke({ color: primary, width: 1, alpha: 0.3 });
        }
        /* 小原子核 */
        geo.circle(0, 0, radius * 0.05).fill({ color: primary, alpha: 0.8 });
      } else if (geoVariant === 5) {
        /* Variant 5: 带环行星与轨道 */
        var planetR = radius * 0.25;
        /* 行星本体 */
        geo.circle(0, 0, planetR).fill({ color: primary, alpha: 0.15 }).stroke({ color: primary, width: 2, alpha: 0.8 });
        /* 行星纹理（若干弧） */
        geo.moveTo(-planetR * 0.7, -planetR * 0.5).quadraticCurveTo(0, -planetR * 0.2, planetR * 0.7, -planetR * 0.5).stroke({ color: primary, width: 1, alpha: 0.4 });
        geo.moveTo(-planetR * 0.9, 0).quadraticCurveTo(0, planetR * 0.3, planetR * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
        /* 环 */
        var ringRx = radius * 0.6;
        var ringRy = radius * 0.15;
        var angle = Math.PI / 6; /* 30 度倾角 */

        var drawTiltedEllipse = function (rx, ry, w, a, segments) {
          if (segments === undefined) segments = 60;
          for (var j = 0; j <= segments; j++) {
            var t = j * Math.PI * 2 / segments;
            var ex = Math.cos(t) * rx;
            var ey = Math.sin(t) * ry;
            var rotX = ex * Math.cos(angle) - ey * Math.sin(angle);
            var rotY = ex * Math.sin(angle) + ey * Math.cos(angle);

            if (j === 0) geo.moveTo(rotX, rotY);
            else geo.lineTo(rotX, rotY);
          }
          geo.stroke({ color: primary, width: w, alpha: a });
        };

        drawTiltedEllipse(ringRx, ringRy, 4, 0.5);
        drawTiltedEllipse(ringRx * 1.1, ringRy * 1.15, 1, 0.3);
        drawTiltedEllipse(ringRx * 1.25, ringRy * 1.3, 2, 0.2);

        /* 远处轨道 */
        geo.circle(0, 0, radius * 0.7).stroke({ color: primary, width: 1, alpha: 0.2 });
        geo.circle(Math.cos(Math.PI / 4) * radius * 0.7, Math.sin(Math.PI / 4) * radius * 0.7, 8).fill({ color: primary, alpha: 0.6 });
      } else if (geoVariant === 6) {
        /* Variant 6: 抽象线框山脉（赛博网格地貌） */
        var bleed = sonnetResolveShotMgBleed(width, height, radius);
        var w = bleed.x * 1.08;
        var h = radius * 0.8;
        var baseY = radius * 0.2;

        /* 背景日/月 */
        geo.circle(0, baseY - h * 0.6, radius * 0.3).stroke({ color: primary, width: 2, alpha: 0.4 });
        for (var i = 0; i < 5; i++) {
          geo.moveTo(-bleed.x, baseY - h * 0.6 + i * 15).lineTo(bleed.x, baseY - h * 0.6 + i * 15).stroke({ color: primary, width: 1, alpha: 0.3 });
        }

        /* 山脊（分层多边形） */
        var peaks = 7;
        for (var layer = 0; layer < 3; layer++) {
          var layerW = w * (1 + layer * 0.2);
          var layerH = h * (0.5 + layer * 0.25);
          geo.moveTo(-layerW / 2, baseY);
          for (var i = 1; i < peaks; i++) {
            var px = -layerW / 2 + (layerW / peaks) * i;
            var py = baseY - layerH * (0.3 + 0.7 * Math.abs(Math.sin((seed + layer * 11 + i * 7))));
            geo.lineTo(px, py);
          }
          geo.lineTo(layerW / 2, baseY);
          geo.stroke({ color: primary, width: 3 - layer, alpha: 0.6 - layer * 0.15 });
        }

        /* 基线 */
        geo.moveTo(-w, baseY).lineTo(w, baseY).stroke({ color: primary, width: 4, alpha: 0.8 });

        /* 网格地面 */
        for (var i = 0; i < 5; i++) {
          var gridY = baseY + Math.pow(i, 1.5) * 12;
          geo.moveTo(-w, gridY).lineTo(w, gridY).stroke({ color: primary, width: 1, alpha: 0.4 - i * 0.08 });
        }

        /* 透视线 */
        for (var i = -4; i <= 4; i++) {
          geo.moveTo(i * radius * 0.2, baseY).lineTo(i * bleed.x * 0.32, bleed.y).stroke({ color: primary, width: 1, alpha: 0.3 });
        }
      } else if (geoVariant === 7) {
        /* Variant 7: 雷达 / 同心靶 */
        for (var i = 1; i <= 6; i++) {
          var rr = radius * 0.15 * i;
          geo.circle(0, 0, rr).stroke({ color: primary, width: i % 2 === 0 ? 2 : 1, alpha: 0.2 + (i % 3) * 0.1 });
        }
        /* 十字线 */
        geo.moveTo(-radius * 0.9, 0).lineTo(radius * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
        geo.moveTo(0, -radius * 0.9).lineTo(0, radius * 0.9).stroke({ color: primary, width: 1, alpha: 0.4 });

        /* 雷达扫描弧 */
        geo.moveTo(0, 0);
        geo.arc(0, 0, radius * 0.75, 0, Math.PI / 4);
        geo.lineTo(0, 0);
        geo.fill({ color: primary, alpha: 0.1 });
        geo.stroke({ color: primary, width: 2, alpha: 0.5 });

        /* 外圈刻度 */
        var rOuter = radius * 0.8;
        for (var i = 0; i < 72; i++) {
          var angle = (i / 72) * Math.PI * 2;
          var len = i % 18 === 0 ? 20 : (i % 6 === 0 ? 10 : 5);
          geo.moveTo(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter)
            .lineTo(Math.cos(angle) * (rOuter + len), Math.sin(angle) * (rOuter + len))
            .stroke({ color: primary, width: 1, alpha: 0.4 });
        }

        /* 浮动目标锁 */
        var lockAngle = (seed % 360) * Math.PI / 180;
        var lockR = radius * 0.45;
        var lx = Math.cos(lockAngle) * lockR;
        var ly = Math.sin(lockAngle) * lockR;
        geo.rect(lx - 15, ly - 15, 30, 30).stroke({ color: primary, width: 2, alpha: 0.8 });
        geo.moveTo(lx, ly - 20).lineTo(lx, ly + 20).stroke({ color: primary, width: 1, alpha: 0.6 });
        geo.moveTo(lx - 20, ly).lineTo(lx + 20, ly).stroke({ color: primary, width: 1, alpha: 0.6 });
      } else if (geoVariant === 8) {
        /* Variant 8: 技术 HUD 装饰框 */
        var fw = radius * 0.85;
        var fh = radius * 0.65;

        /* 角括号 */
        var bracketSize = radius * 0.15;
        var drawBracket = function (cx, cy, sx, sy) {
          geo.moveTo(cx - sx * bracketSize, cy)
            .lineTo(cx, cy)
            .lineTo(cx, cy - sy * bracketSize)
            .stroke({ color: primary, width: 3, alpha: 0.7 });
          /* 内强调 */
          geo.moveTo(cx - sx * bracketSize * 0.8, cy - sy * 8)
            .lineTo(cx - sx * 8, cy - sy * 8)
            .lineTo(cx - sx * 8, cy - sy * bracketSize * 0.8)
            .stroke({ color: primary, width: 1, alpha: 0.4 });
        };
        drawBracket(-fw, -fh, -1, -1);
        drawBracket(fw, -fh, 1, -1);
        drawBracket(-fw, fh, -1, 1);
        drawBracket(fw, fh, 1, 1);

        /* 标尺 */
        for (var i = -fw + 20; i < fw - 20; i += 20) {
          geo.moveTo(i, -fh).lineTo(i, -fh - (i % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 });
          geo.moveTo(i, fh).lineTo(i, fh + (i % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 });
        }

        /* 中心目标环 */
        geo.circle(0, 0, radius * 0.1).stroke({ color: primary, width: 2, alpha: 0.4 });
        geo.moveTo(-radius * 0.15, 0).lineTo(radius * 0.15, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
        geo.moveTo(0, -radius * 0.15).lineTo(0, radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.4 });

        /* 数据块 */
        geo.rect(-fw, -fh + 20, 10, 40).fill({ color: primary, alpha: 0.5 });
        geo.rect(-fw, -fh + 65, 10, 15).fill({ color: primary, alpha: 0.3 });
        geo.rect(fw - 10, fh - 60, 10, 40).fill({ color: primary, alpha: 0.5 });
      } else if (geoVariant === 9) {
        /* Variant 9: 等距 3D 立方体 */
        var drawCube = function (cx, cy, size, alpha) {
          var dy = size * 0.5; /* 大致等距投影 */
          var dx = size * 0.866; /* sqrt(3)/2 */

          /* 顶面 */
          geo.moveTo(cx, cy - size)
            .lineTo(cx + dx, cy - dy)
            .lineTo(cx, cy)
            .lineTo(cx - dx, cy - dy)
            .lineTo(cx, cy - size)
            .fill({ color: primary, alpha: alpha * 0.15 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });

          /* 右面 */
          geo.moveTo(cx, cy)
            .lineTo(cx + dx, cy - dy)
            .lineTo(cx + dx, cy + size - dy)
            .lineTo(cx, cy + size)
            .lineTo(cx, cy)
            .fill({ color: primary, alpha: alpha * 0.3 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });

          /* 左面 */
          geo.moveTo(cx, cy)
            .lineTo(cx - dx, cy - dy)
            .lineTo(cx - dx, cy + size - dy)
            .lineTo(cx, cy + size)
            .lineTo(cx, cy)
            .fill({ color: primary, alpha: alpha * 0.05 })
            .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });
        };

        drawCube(0, 0, radius * 0.35, 0.8);
        drawCube(radius * 0.4, -radius * 0.15, radius * 0.2, 0.5);
        drawCube(-radius * 0.45, radius * 0.25, radius * 0.25, 0.6);
        drawCube(0, radius * 0.45, radius * 0.15, 0.4);

        /* 背景连接线 */
        geo.moveTo(0, 0).lineTo(radius * 0.4, -radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.3 });
        geo.moveTo(0, 0).lineTo(-radius * 0.45, radius * 0.25).stroke({ color: primary, width: 1, alpha: 0.3 });
      } else if (geoVariant === 10) {
        /* Variant 10: 星座网络 */
        geo.circle(0, 0, radius * 0.75).stroke({ color: primary, width: 1, alpha: 0.2 });
        geo.circle(0, 0, radius * 0.73).stroke({ color: primary, width: 2, alpha: 0.1 });

        var nodes = [];
        for (var i = 0; i < 18; i++) {
          var nr = radius * (0.1 + ((seed * 17 + i * 23) % 65) / 100);
          var nAngle = ((seed * 11 + i * 37) % 360) * Math.PI / 180;
          nodes.push({ x: Math.cos(nAngle) * nr, y: Math.sin(nAngle) * nr });
        }

        /* 画节点并连接相近节点 */
        for (var i = 0; i < nodes.length; i++) {
          geo.circle(nodes[i].x, nodes[i].y, 3).fill({ color: primary, alpha: 0.7 });
          geo.circle(nodes[i].x, nodes[i].y, 6).stroke({ color: primary, width: 1, alpha: 0.3 });

          for (var j = i + 1; j < nodes.length; j++) {
            var dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
            if (dist < radius * 0.45) {
              geo.moveTo(nodes[i].x, nodes[i].y)
                .lineTo(nodes[j].x, nodes[j].y)
                .stroke({ color: primary, width: 1, alpha: 0.4 * (1 - dist / (radius * 0.45)) });
            }
          }
        }
      } else if (geoVariant === 11) {
        /* Variant 11: 月亮与月相 */
        var moonR = radius * 0.4;
        /* 大弯月（路径） */
        geo.moveTo(0, -moonR);
        /* 外弧 */
        geo.arc(0, 0, moonR, -Math.PI / 2, Math.PI / 2, false);
        /* 内弧做成月牙 */
        geo.quadraticCurveTo(-moonR * 0.4, 0, 0, -moonR);
        geo.fill({ color: primary, alpha: 0.8 });

        /* 背后的满月线框 */
        geo.circle(0, 0, moonR).stroke({ color: primary, width: 1, alpha: 0.3 });

        /* 月相轨道 */
        var orbitR = radius * 0.65;
        geo.circle(0, 0, orbitR).stroke({ color: primary, width: 1, alpha: 0.2 });

        /* 小月亮（月相） */
        for (var i = 0; i < 8; i++) {
          var angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
          var mx = Math.cos(angle) * orbitR;
          var my = Math.sin(angle) * orbitR;

          geo.circle(mx, my, 8).stroke({ color: primary, width: 1, alpha: 0.5 });

          if (i === 0) {
            /* 新月：空 */
          } else if (i === 4) {
            /* 满月 */
            geo.circle(mx, my, 6).fill({ color: primary, alpha: 0.8 });
          } else {
            /* 部分 */
            geo.moveTo(mx, my - 6).arc(mx, my, 6, -Math.PI / 2, Math.PI / 2, i > 4).lineTo(mx, my - 6).fill({ color: primary, alpha: 0.5 });
          }
        }

        /* 若干几何星 */
        var drawStar = function (sx, sy, sr) {
          geo.moveTo(sx, sy - sr).lineTo(sx + sr * 0.2, sy - sr * 0.2)
            .lineTo(sx + sr, sy).lineTo(sx + sr * 0.2, sy + sr * 0.2)
            .lineTo(sx, sy + sr).lineTo(sx - sr * 0.2, sy + sr * 0.2)
            .lineTo(sx - sr, sy).lineTo(sx - sr * 0.2, sy - sr * 0.2)
            .fill({ color: primary, alpha: 0.7 });
        };
        drawStar(-radius * 0.4, -radius * 0.5, 12);
        drawStar(radius * 0.5, -radius * 0.3, 8);
        drawStar(-radius * 0.2, radius * 0.5, 15);
      } else if (geoVariant === 12) {
        /* Variant 12: 几何花卉 / 植物（莲） */
        var petalLen = radius * 0.5;
        var drawLotusPetal = function (angle, length, width, alpha) {
          var cx = 0, cy = 0;
          var endX = cx + Math.cos(angle) * length;
          var endY = cy + Math.sin(angle) * length;
          var ctrlDist = length * 0.5;

          /* 左曲线 */
          var lca = angle - width;
          var c1x = cx + Math.cos(lca) * ctrlDist;
          var c1y = cy + Math.sin(lca) * ctrlDist;

          /* 右曲线 */
          var rca = angle + width;
          var c2x = cx + Math.cos(rca) * ctrlDist;
          var c2y = cy + Math.sin(rca) * ctrlDist;

          geo.moveTo(cx, cy);
          geo.quadraticCurveTo(c1x, c1y, endX, endY);
          geo.quadraticCurveTo(c2x, c2y, cx, cy);
          geo.stroke({ color: primary, width: 1, alpha: alpha });
          if (alpha > 0.5) geo.fill({ color: primary, alpha: alpha * 0.2 });
        };

        /* 多层莲 */
        for (var layer = 0; layer < 4; layer++) {
          var petals = 8 + layer * 4;
          var currentLen = petalLen * (1 - layer * 0.2);
          var currentWidth = 0.3 - layer * 0.05;
          var offset = layer * (Math.PI / petals);
          for (var i = 0; i < petals; i++) {
            var angle = (i / petals) * Math.PI * 2 + offset;
            drawLotusPetal(angle, currentLen, currentWidth, 0.8 - layer * 0.15);
          }
        }

        /* 中心雄蕊 */
        geo.circle(0, 0, radius * 0.08).stroke({ color: primary, width: 2, alpha: 0.8 });
        geo.circle(0, 0, radius * 0.03).fill({ color: primary, alpha: 0.9 });

        /* 环绕的几何茎/藤 */
        var stemR = radius * 0.65;
        for (var i = 0; i < 3; i++) {
          var startAngle = (i / 3) * Math.PI * 2;
          geo.moveTo(Math.cos(startAngle) * stemR, Math.sin(startAngle) * stemR);
          geo.bezierCurveTo(
            Math.cos(startAngle + 1) * stemR * 1.2, Math.sin(startAngle + 1) * stemR * 1.2,
            Math.cos(startAngle + 2) * stemR * 0.8, Math.sin(startAngle + 2) * stemR * 0.8,
            Math.cos(startAngle + 3) * stemR, Math.sin(startAngle + 3) * stemR
          ).stroke({ color: primary, width: 1, alpha: 0.4 });

          /* 藤上的叶节点 */
          var lx = Math.cos(startAngle + 1.5) * stemR * 1.05;
          var ly = Math.sin(startAngle + 1.5) * stemR * 1.05;
          geo.circle(lx, ly, 4).fill({ color: primary, alpha: 0.6 });
        }
      } else if (geoVariant === 13) {
        /* Variant 13: 神圣几何（生命之花） */
        var soflR = radius * 0.25; /* 每个圆的半径 */
        var drawIntersectingCircle = function (cx, cy, alpha) {
          geo.circle(cx, cy, soflR).stroke({ color: primary, width: 1.5, alpha: alpha });
        };

        /* 中心圆（更强） */
        drawIntersectingCircle(0, 0, 0.35);

        /* 6 个环绕圆 */
        for (var i = 0; i < 6; i++) {
          var angle = (i / 6) * Math.PI * 2;
          var cx = Math.cos(angle) * soflR;
          var cy = Math.sin(angle) * soflR;
          drawIntersectingCircle(cx, cy, 0.2); /* 中等不透明度 */
        }

        /* 12 个外圆构成下一层 */
        for (var i = 0; i < 12; i++) {
          var angle = (i / 12) * Math.PI * 2;
          /* 下一层的距离是 soflR * sqrt(3) */
          var dist = i % 2 === 0 ? soflR * 2 : soflR * Math.sqrt(3);
          var cx = Math.cos(angle) * dist;
          var cy = Math.sin(angle) * dist;
          geo.circle(cx, cy, soflR).stroke({ color: secondary, width: 1, alpha: 0.1 }); /* 次要色 */
        }

        /* 边界圆 */
        geo.circle(0, 0, soflR * 3).stroke({ color: primary, width: 1.5, alpha: 0.2 });
        geo.circle(0, 0, soflR * 3.1).stroke({ color: secondary, width: 1, alpha: 0.08 });

        /* 径向连接线（极淡，避免蛛网感） */
        for (var i = 0; i < 12; i++) {
          var angle = (i / 12) * Math.PI * 2;
          geo.moveTo(Math.cos(angle) * soflR * 0.5, Math.sin(angle) * soflR * 0.5)
            .lineTo(Math.cos(angle) * soflR * 3, Math.sin(angle) * soflR * 3)
            .stroke({ color: secondary, width: 1, alpha: 0.05 });
        }
      } else if (geoVariant === 14) {
        /* Variant 14: 大型半透明建筑巨石 */
        var direction = seed % 2 === 0 ? 1 : -1;
        sonnetDrawSolidCuboid(geo, radius * 0.18 * direction, radius * 0.03, radius * 0.62, radius * 0.7, radius * 0.22 * direction, -radius * 0.16, primary, 0.34);
        sonnetDrawSolidCuboid(geo, -radius * 0.48 * direction, radius * 0.24, radius * 0.28, radius * 0.38, radius * 0.12 * direction, -radius * 0.09, primary, 0.24);
        sonnetDrawSolidCuboid(geo, radius * 0.55 * direction, -radius * 0.3, radius * 0.2, radius * 0.26, radius * 0.09 * direction, -radius * 0.07, primary, 0.2);
      } else if (geoVariant === 15) {
        /* Variant 15: 浮动三棱柱 */
        var direction = seed % 2 === 0 ? 1 : -1;
        sonnetDrawTriangularPrism(geo, -radius * 0.12 * direction, radius * 0.02, radius * 0.72, radius * 0.68, radius * 0.18 * direction, -radius * 0.13, primary, 0.34);
        sonnetDrawTriangularPrism(geo, radius * 0.48 * direction, radius * 0.26, radius * 0.28, radius * 0.25, -radius * 0.08 * direction, -radius * 0.06, primary, 0.22);
        sonnetDrawTriangularPrism(geo, -radius * 0.5 * direction, -radius * 0.3, radius * 0.2, radius * 0.18, radius * 0.06 * direction, -radius * 0.05, primary, 0.18);
      } else if (geoVariant === 16) {
        /* Variant 16: 切面六棱柱 */
        var direction = seed % 2 === 0 ? 1 : -1;
        sonnetDrawHexagonalPrism(geo, radius * 0.12 * direction, 0, radius * 0.68, radius * 0.72, radius * 0.2 * direction, -radius * 0.14, primary, 0.32);
        sonnetDrawHexagonalPrism(geo, -radius * 0.48 * direction, radius * 0.27, radius * 0.25, radius * 0.28, radius * 0.07 * direction, -radius * 0.05, primary, 0.2);
        sonnetDrawHexagonalPrism(geo, radius * 0.52 * direction, -radius * 0.3, radius * 0.18, radius * 0.2, -radius * 0.06 * direction, -radius * 0.045, primary, 0.17);
      } else if (geoVariant === 17) {
        /* Variant 17: 梯形棱柱与低建筑基座 */
        var direction = seed % 2 === 0 ? 1 : -1;
        sonnetDrawTrapezoidPrism(geo, radius * 0.12 * direction, radius * 0.04, radius * 0.3, radius * 0.68, radius * 0.62, radius * 0.18 * direction, -radius * 0.13, primary, 0.34);
        sonnetDrawTrapezoidPrism(geo, -radius * 0.42 * direction, radius * 0.28, radius * 0.2, radius * 0.38, radius * 0.22, radius * 0.08 * direction, -radius * 0.06, primary, 0.21);
        sonnetDrawTrapezoidPrism(geo, radius * 0.5 * direction, -radius * 0.3, radius * 0.2, radius * 0.12, radius * 0.22, -radius * 0.06 * direction, -radius * 0.05, primary, 0.18);
      } else {
        sonnetDrawAdditionalShotMg({
          target: geo,
          variant: geoVariant,
          radius: radius,
          width: width,
          height: height,
          seed: seed,
          primary: primary,
          secondary: secondary
        });
      }

      /* 随机几何构图已移到 sonnetTextViewBuilder，让它们伴随文字 */

      /* 按变体兼容性有选择地施加确定性旋转 */
      var keepsUpright = [6, 8, 9, 14, 15, 16, 17, 20, 22, 23].indexOf(geoVariant) >= 0
        || geoVariant >= SONNET_THEMED_GEO_VARIANT_START;
      if (!keepsUpright) {
        /* 任意旋转 */
        geo.rotation = ((seed * 13) % 360) * (Math.PI / 180);
      } else if (geoVariant === 8) {
        /* HUD 框按 90 度增量旋转 */
        geo.rotation = sonnetResolveHudRotationQuarterTurns(seed) * (Math.PI / 2);
      }

      container.addChild(geo.display);

      /* fixedGeo 在相机移动时保持竖直，可以独立于主动画场景与浮动粒子开关。
       * seed 变体构建器返回每个 AnimatedGraphics 部件（实心/空心件 + 阴影线），
       * 让它们都按共享 stagger 日程生长。 */
      fixedGeoLayer = new pixi.Container();
      fixedGeoParts = sonnetBuildFixedGeo({
        pixi: pixi,
        layer: fixedGeoLayer,
        variant: sonnetResolveFixedGeoVariant(seed),
        radius: radius,
        seed: seed,
        primary: primary,
        secondary: secondary
      });
      container.addChild(fixedGeoLayer);
    } else if (kind === 'editorial-column') {
      /* 严格栅格 */
      for (var i = 1; i <= 6; i++) {
        var x = -hw + width * (i / 7);
        bg.moveTo(x, -hh).lineTo(x, hh).stroke({ color: primary, width: 1, alpha: 0.15 });
      }
      for (var i = 1; i <= 4; i++) {
        var y = -hh + height * (i / 5);
        bg.moveTo(-hw, y).lineTo(hw, y).stroke({ color: primary, width: 1, alpha: 0.15 });
      }
      bg.rect(-hw + width * 0.2, -hh + height * 0.2, width * 0.6, height * 0.6).stroke({ color: primary, width: 4, alpha: 0.5 });
    } else {
      /* quiet-tableau 或 mask-reveal（极简散布元素） */
      for (var i = 0; i < 5; i++) {
        var size = 10 + (seed % (i + 1)) * 5;
        bg.rect(
          -hw + width * (0.2 + ((seed * 11 + i) % 60) / 100),
          -hh + height * (0.2 + ((seed * 17 + i) % 60) / 100),
          size, size
        ).fill({ color: primary, alpha: 0.4 });
      }
    }

    container.bg = bg;
    container.bgLayer = bg.display;
    if (geo) {
      container.geo = geo;
      container.geoLayer = geo.display;
    }
    container.fixedGeoParts = fixedGeoParts;
    container.fixedGeoLayer = fixedGeoLayer;

    container.addChild(bg.display);

    /* 浮动粒子（seed 选中的背景装饰变体） */
    var decor = sonnetBuildBackgroundDecor({
      pixi: pixi,
      kind: kind,
      width: width,
      height: height,
      seed: seed,
      primary: primary,
      secondary: secondary,
      iconTextures: iconTextures
    });
    var particleLayer = decor.layer;
    var iconAnimations = decor.iconAnimations;
    var smoothedIconAudio = 0;

    for (var ii = 0; ii < iconAnimations.length; ii++) {
      iconAnimations[ii].entryPhase = sonnetResolveIconEntryPhase(ii, iconAnimations.length);
    }

    container.addChild(particleLayer);
    container.particleLayer = particleLayer;
    container.decorVariant = sonnetResolveBackgroundDecorVariant(seed);

    container.updateTime = function (time, cues, startTime, endTime, audioBass, audioPower, audioVocal) {
      if (audioBass === undefined) audioBass = 0;
      if (audioPower === undefined) audioPower = 0;
      if (audioVocal === undefined) audioVocal = 0;
      /* 连续贝塞尔曲线动画（cubic ease-out），忽略节奏 cue 的跳变，
       * 但进度要铺满这个镜头里歌词的实际时长。 */

      var targetFinishTime = endTime;
      if (cues.length > 0) {
        /* 以前只用 cues[cues.length-1].at，但最后一个词若是长音，
         * 背景会画得太早然后冻住。强制至少铺满总镜头时长的 95%，
         * 保证长镜头有连续的背景运动。 */
        var lastWordStart = cues[cues.length - 1].at;
        targetFinishTime = Math.max(
          lastWordStart,
          startTime + (endTime - startTime) * 0.95
        );
      } else {
        targetFinishTime = startTime + (endTime - startTime) * 0.95;
      }

      targetFinishTime = Math.min(endTime, targetFinishTime);

      var drawDuration = Math.max(1.0, targetFinishTime - startTime);
      var rawProgress = Math.min(1, Math.max(0, (time - startTime) / drawDuration));

      /* rawProgress 往下传；AnimatedGraphics 自己做局部缓动，
       * 避免错峰元素的曲线被截断。 */

      if (container.geo) container.geo.update(rawProgress);
      if (container.bg) container.bg.update(rawProgress);
      if (container.fixedGeoParts) {
        for (var pi = 0; pi < container.fixedGeoParts.length; pi++) container.fixedGeoParts[pi].update(rawProgress);
      }

      var audioEnergy = sonnetNormalizeAudioLevel(audioBass) * 0.34
        + sonnetNormalizeAudioLevel(audioVocal) * 0.52
        + sonnetNormalizeAudioLevel(audioPower) * 0.14;
      /* 忽略闲置呼吸信号，然后扩展可听范围，让中等峰值也可见。 */
      var gatedEnergy = Math.max(0, (audioEnergy - 0.08) / 0.92);
      var targetIconAudio = Math.min(1, Math.pow(gatedEnergy, 0.68) * 1.35);
      var smoothing = targetIconAudio > smoothedIconAudio ? 0.34 : 0.16;
      smoothedIconAudio += (targetIconAudio - smoothedIconAudio) * smoothing;
      var sceneDuration = Math.max(0.01, endTime - startTime);
      for (var ai = 0; ai < iconAnimations.length; ai++) {
        var icon = iconAnimations[ai];
        var entryDuration = sonnetResolveIconEntryDuration(sceneDuration, icon.preferredDuration);
        var entryDelay = sonnetResolveIconEntryDelay(icon.entryPhase, sceneDuration, entryDuration);
        var entryProgress = Math.min(
          1,
          Math.max(0, (time - startTime - entryDelay) / entryDuration)
        );
        var entryEased = 1 - Math.pow(1 - entryProgress, 3);
        var loopPulse = (Math.sin((time - startTime) * Math.PI * 0.7 + icon.phase) + 1) * 0.5;
        var audioScale = 1 + smoothedIconAudio * 0.42;
        var loopScale = 1 + loopPulse * 0.025;

        icon.node.alpha = Math.min(
          1,
          icon.baseAlpha * entryEased * (0.72 + smoothedIconAudio * 0.38 + loopPulse * 0.03)
        );
        icon.node.scale.set(
          icon.baseScale * (0.72 + entryEased * 0.28) * audioScale * loopScale
        );
      }
    };

    return container;
  }

  /* ============================== 6. additional 变体 18–23 ============================== */
  /* sonnetAdditionalShotMg.ts：轻量、主题色的海报母题。派发链：
   * 18–23 → 本节六个；其余 → themed(24–35) → open(36–47) → extended(48–99)。 */

  var SONNET_ADDITIONAL_GEO_VARIANT_START = 18;
  var SONNET_ADDITIONAL_GEO_VARIANT_COUNT = 6;

  function sonnetDrawContourAtlas(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var steps = 48;
    for (var ring = 0; ring < 8; ring += 1) {
      var baseRadius = radius * (0.16 + ring * 0.075);
      for (var step = 0; step <= steps; step += 1) {
        var angle = (step / steps) * Math.PI * 2;
        var ripple = Math.sin(angle * 3 + seed * 0.07 + ring) * radius * 0.018
          + Math.cos(angle * 5 - seed * 0.03 + ring * 0.7) * radius * 0.012;
        var x = Math.cos(angle) * (baseRadius + ripple) + Math.sin(ring * 1.7) * radius * 0.055;
        var y = Math.sin(angle) * (baseRadius + ripple) * 0.72 + Math.cos(ring * 1.3) * radius * 0.035;
        if (step === 0) target.moveTo(x, y);
        else target.lineTo(x, y);
      }
      target.stroke({
        color: ring % 3 === 0 ? secondary : primary,
        width: ring % 3 === 0 ? 2 : 1,
        alpha: 0.2 + ring * 0.045
      });
    }
    target.moveTo(-radius * 0.78, radius * 0.52)
      .lineTo(-radius * 0.58, radius * 0.52)
      .lineTo(-radius * 0.58, radius * 0.46)
      .lineTo(-radius * 0.38, radius * 0.46)
      .stroke({ color: primary, width: 3, alpha: 0.64 });
  }

  function sonnetDrawRadialWave(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bars = 64;
    for (var index = 0; index < bars; index += 1) {
      var angle = (index / bars) * Math.PI * 2;
      var signal = 0.5 + 0.5 * Math.sin(index * 1.83 + seed * 0.11);
      var inner = radius * (0.29 + signal * 0.035);
      var outer = radius * (0.43 + signal * 0.21);
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({
          color: index % 8 === 0 ? secondary : primary,
          width: index % 8 === 0 ? 3 : 1,
          alpha: index % 2 === 0 ? 0.58 : 0.32
        });
    }
    target.circle(0, 0, radius * 0.24).stroke({ color: primary, width: 5, alpha: 0.7 });
    target.circle(0, 0, radius * 0.68).stroke({ color: secondary, width: 1, alpha: 0.18 });
    target.circle(0, 0, radius * 0.72).stroke({ color: primary, width: 2, alpha: 0.12 });
  }

  function sonnetDrawTransitBlueprint(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var routes = [
      [[-0.72, -0.38], [-0.38, -0.38], [-0.38, 0.08], [0.08, 0.08], [0.08, 0.52], [0.68, 0.52]],
      [[-0.62, 0.58], [-0.62, 0.24], [-0.14, 0.24], [-0.14, -0.52], [0.5, -0.52], [0.5, -0.2], [0.74, -0.2]],
      [[-0.78, -0.06], [-0.5, -0.06], [-0.5, -0.62], [0.24, -0.62], [0.24, 0.3], [0.72, 0.3]]
    ];

    for (var routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      var route = routes[routeIndex];
      var first = route[0];
      var last = route[route.length - 1];
      target.moveTo(-bleed.x * direction, first[1] * radius);
      for (var ri = 0; ri < route.length; ri++) {
        var px = route[ri][0] * radius * direction;
        var py = route[ri][1] * radius;
        target.lineTo(px, py);
      }
      target.lineTo(bleed.x * direction, last[1] * radius);
      target.stroke({
        color: routeIndex === 1 ? secondary : primary,
        width: routeIndex === 0 ? 5 : 2,
        alpha: 0.34 + routeIndex * 0.12
      });
      for (var pointIndex = 0; pointIndex < route.length; pointIndex++) {
        if (pointIndex === 0 || pointIndex === route.length - 1 || (pointIndex + routeIndex) % 2 === 0) {
          var px2 = route[pointIndex][0] * radius * direction;
          var py2 = route[pointIndex][1] * radius;
          target.circle(px2, py2, pointIndex === 0 ? 10 : 6)
            .fill({ color: pointIndex % 2 === 0 ? primary : secondary, alpha: 0.72 });
          target.circle(px2, py2, pointIndex === 0 ? 16 : 11)
            .stroke({ color: primary, width: 1, alpha: 0.36 });
        }
      }
    }
  }

  function sonnetDrawChronograph(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var rings = [0.2, 0.38, 0.62];
    for (var index = 0; index < rings.length; index++) {
      var scale = rings[index];
      target.circle(0, 0, radius * scale).stroke({
        color: index === 1 ? secondary : primary,
        width: index === 2 ? 4 : 2,
        alpha: 0.3 + index * 0.13
      });
    }
    for (var tick = 0; tick < 48; tick += 1) {
      var angle = (tick / 48) * Math.PI * 2;
      var outer = radius * 0.72;
      var inner = outer - radius * (tick % 4 === 0 ? 0.11 : 0.045);
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({ color: tick % 4 === 0 ? secondary : primary, width: tick % 4 === 0 ? 3 : 1, alpha: 0.5 });
    }
    var handAngle = ((seed % 60) / 60) * Math.PI * 2 - Math.PI / 2;
    var secondAngle = (((seed * 7) % 60) / 60) * Math.PI * 2 - Math.PI / 2;
    target.moveTo(-Math.cos(handAngle) * radius * 0.12, -Math.sin(handAngle) * radius * 0.12)
      .lineTo(Math.cos(handAngle) * radius * 0.55, Math.sin(handAngle) * radius * 0.55)
      .stroke({ color: primary, width: 6, alpha: 0.74 });
    target.moveTo(0, 0)
      .lineTo(Math.cos(secondAngle) * radius * 0.65, Math.sin(secondAngle) * radius * 0.65)
      .stroke({ color: secondary, width: 2, alpha: 0.72 });
    target.circle(0, 0, radius * 0.055).fill({ color: primary, alpha: 0.85 });
  }

  function sonnetDrawFoldedRibbons(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var band = 0; band < 5; band += 1) {
      var y = (-0.5 + band * 0.25) * radius;
      var offset = (band % 2 === 0 ? 1 : -1) * direction;
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(
          -radius * 0.38, y - radius * 0.28 * offset,
          radius * 0.18, y + radius * 0.28 * offset,
          bleed.x, y
        )
        .stroke({ color: band % 2 === 0 ? primary : secondary, width: band === 2 ? 12 : 5, alpha: 0.24 + band * 0.08 });
      target.moveTo(-bleed.x, y + radius * 0.055)
        .bezierCurveTo(
          -radius * 0.38, y - radius * 0.28 * offset + radius * 0.055,
          radius * 0.18, y + radius * 0.28 * offset + radius * 0.055,
          bleed.x, y + radius * 0.055
        )
        .stroke({ color: primary, width: 1, alpha: 0.3 });
    }
    target.moveTo(-radius * 0.34, -bleed.y).lineTo(-radius * 0.34, -radius * 0.18)
      .stroke({ color: primary, width: 2, alpha: 0.18 });
    target.moveTo(radius * 0.34, radius * 0.18).lineTo(radius * 0.34, bleed.y)
      .stroke({ color: primary, width: 2, alpha: 0.18 });
  }

  function sonnetDrawHalftonePoster(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var spacing = radius * 0.17;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var columns = Math.ceil((bleed.x * 2) / spacing) + 2;
    var rows = Math.ceil((bleed.y * 2) / spacing) + 2;
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        var x = (column - (columns - 1) / 2) * spacing;
        var y = (row - (rows - 1) / 2) * spacing;
        var distance = Math.hypot(x, y) / radius;
        var pulse = 0.5 + 0.5 * Math.sin(column * 0.9 + row * 1.4 + seed * 0.08);
        var dotRadius = radius * (0.009 + Math.max(0, 0.72 - distance) * 0.034 + pulse * 0.012);
        target.circle(x, y, dotRadius).fill({
          color: (row + column) % 5 === 0 ? secondary : primary,
          alpha: 0.24 + pulse * 0.5
        });
      }
    }
    target.moveTo(-bleed.x, -bleed.y * 0.72).lineTo(bleed.x, -bleed.y * 0.72)
      .stroke({ color: secondary, width: 2, alpha: 0.28 });
    target.moveTo(-bleed.x * 0.58, -bleed.y).lineTo(-bleed.x * 0.58, bleed.y)
      .stroke({ color: primary, width: 1, alpha: 0.2 });
  }

  /* 只派发附加区间，让原始 sonnet 镜头构建器专注于构图。 */
  function sonnetDrawAdditionalShotMg(o) {
    switch (o.variant) {
      case 18:
        sonnetDrawContourAtlas(o);
        return true;
      case 19:
        sonnetDrawRadialWave(o);
        return true;
      case 20:
        sonnetDrawTransitBlueprint(o);
        return true;
      case 21:
        sonnetDrawChronograph(o);
        return true;
      case 22:
        sonnetDrawFoldedRibbons(o);
        return true;
      case 23:
        sonnetDrawHalftonePoster(o);
        return true;
      default:
        return sonnetDrawThemedShotMg(o)
          || sonnetDrawOpenShotMg(o)
          || sonnetDrawExtendedShotMg(o);
    }
  }

  /* ============================== 7. themed 变体 24–35 ============================== */
  /* sonnetThemedShotMg.ts + flora / botanical / architecture / landscape 四族。
   * 十二种主题背景注册成一个确定性扩展区间。 */

  var SONNET_THEMED_GEO_VARIANT_START = 24;
  var SONNET_THEMED_GEO_VARIANT_COUNT = 12;

  var SONNET_THEMED_GEO_VARIANTS = [
    'camellia', 'tulip-field', 'wildflower',
    'fern', 'ginkgo', 'climbing-vine',
    'greenhouse', 'pagoda', 'city-facade',
    'terraces', 'mountain-lake', 'coastal-cliff'
  ];

  /* ---- flora 三種（sonnetShotMgFlora.ts） ---- */

  function sonnetDrawCamelliaMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var turn = (seed % 12) * Math.PI / 72;
    for (var ring = 0; ring < 3; ring += 1) {
      var count = 7 + ring * 4;
      for (var index = 0; index < count; index += 1) {
        var angle = turn + (index / count) * Math.PI * 2 + ring * 0.12;
        sonnetDrawPetal(
          target, 0, 0, radius * (0.28 + ring * 0.15), radius * (0.075 + ring * 0.018),
          angle, ring === 1 ? secondary : primary, 0.07 + ring * 0.045
        );
      }
    }
    target.circle(0, 0, radius * 0.1).fill({ color: secondary, alpha: 0.22 });
    target.circle(0, 0, radius * 0.13).stroke({ color: primary, width: 3, alpha: 0.68 });
  }

  function sonnetDrawTulipFieldMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    for (var index = 0; index < 7; index += 1) {
      var x = (-0.66 + index * 0.22) * radius;
      var top = (-0.3 + ((seed + index * 5) % 5) * 0.085) * radius;
      var bottom = radius * 0.68;
      target.moveTo(x, bottom).bezierCurveTo(x + radius * 0.04 * direction, radius * 0.28, x - radius * 0.05 * direction, top + radius * 0.12, x, top)
        .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 });
      sonnetDrawLeaf(target, x, radius * 0.24, radius * 0.26, radius * 0.055, index % 2 ? -2.7 : -0.45, primary, 0.1);
      var bloomColor = index % 3 === 0 ? secondary : primary;
      target.moveTo(x, top + radius * 0.14)
        .quadraticCurveTo(x - radius * 0.18, top - radius * 0.04, x - radius * 0.11, top - radius * 0.2)
        .lineTo(x, top - radius * 0.1)
        .lineTo(x + radius * 0.11, top - radius * 0.2)
        .quadraticCurveTo(x + radius * 0.18, top - radius * 0.04, x, top + radius * 0.14)
        .fill({ color: bloomColor, alpha: 0.12 + (index % 3) * 0.045 });
      target.moveTo(x, top + radius * 0.14)
        .quadraticCurveTo(x - radius * 0.18, top - radius * 0.04, x - radius * 0.11, top - radius * 0.2)
        .lineTo(x, top - radius * 0.1).lineTo(x + radius * 0.11, top - radius * 0.2)
        .quadraticCurveTo(x + radius * 0.18, top - radius * 0.04, x, top + radius * 0.14)
        .stroke({ color: bloomColor, width: 2, alpha: 0.65 });
    }
  }

  function sonnetDrawWildflowerMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var stem = 0; stem < 9; stem += 1) {
      var x = (-0.72 + stem * 0.18) * radius;
      var lean = (((seed + stem * 7) % 9) - 4) * radius * 0.018;
      var flowerY = (-0.45 + ((seed + stem * 3) % 6) * 0.08) * radius;
      target.moveTo(x, radius * 0.72).quadraticCurveTo(x - lean, radius * 0.12, x + lean, flowerY)
        .stroke({ color: stem % 2 ? secondary : primary, width: 1.5, alpha: 0.42 });
      for (var petal = 0; petal < 5; petal += 1) {
        var angle = (petal / 5) * Math.PI * 2 - Math.PI / 2;
        sonnetDrawPetal(target, x + lean, flowerY, radius * 0.105, radius * 0.032, angle, stem % 3 ? primary : secondary, 0.1);
      }
      target.circle(x + lean, flowerY, radius * 0.025).fill({ color: secondary, alpha: 0.48 });
    }
  }

  /* ---- botanical 三種（sonnetShotMgBotanical.ts） ---- */

  function sonnetDrawFernMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var tilt = (seed % 2 ? 1 : -1) * 0.18;
    target.moveTo(-radius * 0.12, radius * 0.72)
      .bezierCurveTo(-radius * 0.04, radius * 0.2, radius * 0.12, -radius * 0.24, radius * 0.02, -radius * 0.72)
      .stroke({ color: primary, width: 3, alpha: 0.62 });
    for (var index = 0; index < 13; index += 1) {
      var ratio = index / 13;
      var x = -radius * 0.12 + radius * 0.14 * ratio;
      var y = radius * (0.63 - ratio * 1.23);
      var length = radius * (0.3 - Math.abs(ratio - 0.5) * 0.18);
      sonnetDrawLeaf(target, x, y, length, length * 0.22, Math.PI + tilt - ratio * 0.25, index % 3 ? primary : secondary, 0.09 + ratio * 0.05);
      sonnetDrawLeaf(target, x, y, length, length * 0.22, -tilt + ratio * 0.25, index % 3 ? secondary : primary, 0.07 + ratio * 0.04);
    }
  }

  function sonnetDrawGinkgoMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    target.moveTo(-radius * 0.72 * direction, radius * 0.55)
      .bezierCurveTo(-radius * 0.25 * direction, radius * 0.16, radius * 0.08 * direction, -radius * 0.12, radius * 0.65 * direction, -radius * 0.5)
      .stroke({ color: primary, width: 5, alpha: 0.38 });
    for (var index = 0; index < 8; index += 1) {
      var ratio = index / 7;
      var x = (-0.58 + ratio * 1.12) * radius * direction;
      var y = (0.4 - ratio * 0.78 + Math.sin(index * 1.8) * 0.08) * radius;
      var angle = -1.1 + (index % 3) * 0.7;
      var size = radius * (0.13 + (index % 4) * 0.018);
      target.moveTo(x, y).lineTo(x + Math.cos(angle) * size * 0.7, y + Math.sin(angle) * size * 0.7)
        .stroke({ color: secondary, width: 1.5, alpha: 0.42 });
      var cx = x + Math.cos(angle) * size;
      var cy = y + Math.sin(angle) * size;
      target.moveTo(cx, cy)
        .arc(cx, cy, size, angle + Math.PI * 0.1, angle + Math.PI * 0.9)
        .lineTo(cx, cy).fill({ color: index % 2 ? primary : secondary, alpha: 0.09 + (index % 3) * 0.04 });
      target.moveTo(cx, cy)
        .arc(cx, cy, size, angle + Math.PI * 0.1, angle + Math.PI * 0.9)
        .lineTo(cx, cy).stroke({ color: primary, width: 1.5, alpha: 0.58 });
    }
  }

  function sonnetDrawClimbingVineMg(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var mirror = seed % 2 === 0 ? 1 : -1;
    for (var vine = 0; vine < 3; vine += 1) {
      var offset = (vine - 1) * radius * 0.3;
      target.moveTo(offset, radius * 0.76)
        .bezierCurveTo(offset + radius * 0.5 * mirror, radius * 0.38, offset - radius * 0.48 * mirror, -radius * 0.1, offset + radius * 0.22 * mirror, -radius * 0.76)
        .stroke({ color: vine === 1 ? secondary : primary, width: vine === 1 ? 3 : 1.5, alpha: 0.46 });
      for (var leaf = 0; leaf < 5; leaf += 1) {
        var ratio = (leaf + 1) / 6;
        var x = offset + Math.sin(ratio * Math.PI * 4 + vine) * radius * 0.16;
        var y = radius * (0.7 - ratio * 1.36);
        sonnetDrawLeaf(target, x, y, radius * 0.2, radius * 0.055, leaf % 2 ? -0.25 : Math.PI + 0.25, leaf % 2 ? secondary : primary, 0.08 + vine * 0.035);
      }
    }
  }

  /* ---- architecture 三種（sonnetShotMgArchitecture.ts） ---- */

  function sonnetDrawGreenhouseMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var shell = [
      [-radius * 0.7, radius * 0.58], [-radius * 0.7, -radius * 0.12],
      [0, -radius * 0.62], [radius * 0.7, -radius * 0.12], [radius * 0.7, radius * 0.58]
    ];
    sonnetFillPolygon(target, shell, primary, 0.055);
    sonnetStrokePolygon(target, shell, primary, 0.68, 3);
    target.moveTo(0, -radius * 0.62).lineTo(0, radius * 0.58).stroke({ color: secondary, width: 2, alpha: 0.5 });
    for (var pane = -3; pane <= 3; pane += 1) {
      var x = pane * radius * 0.18;
      target.moveTo(x, radius * 0.58).lineTo(x * 0.38, -radius * (0.58 - Math.abs(pane) * 0.04))
        .stroke({ color: pane % 2 ? secondary : primary, width: 1, alpha: 0.32 });
    }
    var doorX = radius * 0.2 * direction;
    target.rect(doorX - radius * 0.13, radius * 0.08, radius * 0.26, radius * 0.5)
      .fill({ color: secondary, alpha: 0.1 });
    target.rect(doorX - radius * 0.13, radius * 0.08, radius * 0.26, radius * 0.5)
      .stroke({ color: secondary, width: 2, alpha: 0.62 });
    target.moveTo(-bleed.x, radius * 0.58).lineTo(-radius * 0.7, radius * 0.58)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    target.moveTo(radius * 0.7, radius * 0.58).lineTo(bleed.x, radius * 0.58)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
  }

  function sonnetDrawPagodaMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var lean = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var floor = 0; floor < 4; floor += 1) {
      var y = radius * (0.47 - floor * 0.27);
      var halfWidth = radius * (0.5 - floor * 0.075);
      var roof = [
        [-halfWidth * 1.18, y], [-halfWidth, y - radius * 0.11],
        [0, y - radius * 0.19], [halfWidth, y - radius * 0.11], [halfWidth * 1.18, y]
      ];
      sonnetFillPolygon(target, roof, floor % 2 ? secondary : primary, 0.07 + floor * 0.025);
      sonnetStrokePolygon(target, roof, floor % 2 ? secondary : primary, 0.58, 2);
      target.rect(-halfWidth * 0.68, y, halfWidth * 1.36, radius * 0.17)
        .fill({ color: primary, alpha: 0.035 + floor * 0.018 });
      target.rect(-halfWidth * 0.68, y, halfWidth * 1.36, radius * 0.17)
        .stroke({ color: primary, width: 1, alpha: 0.36 });
    }
    target.moveTo(0, -radius * 0.62).lineTo(radius * 0.035 * lean, -radius * 0.78)
      .stroke({ color: secondary, width: 3, alpha: 0.65 });
    target.moveTo(-bleed.x, radius * 0.64).lineTo(-radius * 0.52, radius * 0.64)
      .stroke({ color: secondary, width: 1, alpha: 0.22 });
    target.moveTo(radius * 0.52, radius * 0.64).lineTo(bleed.x, radius * 0.64)
      .stroke({ color: secondary, width: 1, alpha: 0.22 });
  }

  function sonnetDrawCityFacadeMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var heights = [0.52, 0.88, 0.66, 1.08, 0.74, 0.94, 0.58];
    var buildingWidth = radius * 0.205;
    for (var index = 0; index < heights.length; index++) {
      var heightRatio = heights[index];
      var x = radius * (-0.73 + index * 0.24);
      var height = radius * heightRatio;
      var color = index % 3 === 1 ? secondary : primary;
      target.rect(x, radius * 0.62 - height, buildingWidth, height)
        .fill({ color: color, alpha: 0.045 + (index % 3) * 0.035 });
      target.rect(x, radius * 0.62 - height, buildingWidth, height)
        .stroke({ color: color, width: index === 3 ? 3 : 1.5, alpha: 0.5 });
      for (var row = 0; row < Math.floor(heightRatio * 6); row += 1) {
        for (var column = 0; column < 2; column += 1) {
          if ((row + column + index + seed) % 3 === 0) {
            target.rect(x + radius * (0.035 + column * 0.085), radius * 0.53 - height + row * radius * 0.13, radius * 0.045, radius * 0.055)
              .fill({ color: column ? secondary : primary, alpha: 0.2 });
          }
        }
      }
    }
    target.moveTo(-bleed.x, radius * 0.63).lineTo(bleed.x, radius * 0.63)
      .stroke({ color: primary, width: 4, alpha: 0.48 });
  }

  /* ---- landscape 三種（sonnetShotMgLandscape.ts） ---- */

  function sonnetDrawTerracesMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var band = 0; band < 7; band += 1) {
      var y = radius * (-0.5 + band * 0.16);
      var amplitude = radius * (0.09 + band * 0.012);
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.35, y + amplitude * direction, radius * 0.08, y - amplitude * direction, bleed.x, y + amplitude * 0.35)
        .lineTo(bleed.x, y + radius * 0.12)
        .bezierCurveTo(radius * 0.12, y + radius * 0.04, -radius * 0.3, y + radius * 0.2, -bleed.x, y + radius * 0.12)
        .fill({ color: band % 2 ? secondary : primary, alpha: 0.025 + band * 0.018 });
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.35, y + amplitude * direction, radius * 0.08, y - amplitude * direction, bleed.x, y + amplitude * 0.35)
        .stroke({ color: band % 2 ? secondary : primary, width: band % 3 === 0 ? 2.5 : 1, alpha: 0.34 + band * 0.04 });
    }
  }

  function sonnetDrawMountainLakeMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var shift = (((seed % 7) - 3) / 3) * radius * 0.04;
    var back = [
      [-bleed.x, radius * 0.1], [-radius * 0.42, -radius * 0.46],
      [-radius * 0.14, -radius * 0.16], [radius * 0.22, -radius * 0.62],
      [bleed.x, radius * 0.1]
    ];
    var front = [
      [-bleed.x, radius * 0.22], [-radius * 0.28 + shift, -radius * 0.2],
      [radius * 0.06, radius * 0.05], [radius * 0.48 + shift, -radius * 0.28], [bleed.x, radius * 0.22]
    ];
    sonnetFillPolygon(target, back, secondary, 0.07);
    sonnetStrokePolygon(target, back, secondary, 0.46, 1.5);
    sonnetFillPolygon(target, front, primary, 0.12);
    sonnetStrokePolygon(target, front, primary, 0.66, 2.5);
    for (var line = 0; line < 7; line += 1) {
      var y = radius * (0.28 + line * 0.07);
      var inset = radius * (0.08 + (line % 3) * 0.08);
      target.moveTo(-bleed.x + inset, y).lineTo(bleed.x - inset, y)
        .stroke({ color: line % 2 ? secondary : primary, width: 1, alpha: 0.2 + line * 0.035 });
    }
    target.circle(-radius * 0.48, -radius * 0.48, radius * 0.1).fill({ color: secondary, alpha: 0.14 });
    target.circle(-radius * 0.48, -radius * 0.48, radius * 0.13).stroke({ color: secondary, width: 2, alpha: 0.5 });
  }

  function sonnetDrawCoastalCliffMg(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var cliff = [
      [-bleed.x * direction, bleed.y], [-radius * 0.78 * direction, -radius * 0.1],
      [-radius * 0.5 * direction, -radius * 0.34], [-radius * 0.18 * direction, radius * 0.08],
      [radius * 0.08 * direction, radius * 0.58]
    ];
    sonnetFillPolygon(target, cliff, primary, 0.11);
    sonnetStrokePolygon(target, cliff, primary, 0.62, 2.5);
    var towerX = -radius * 0.5 * direction;
    target.rect(towerX - radius * 0.09, -radius * 0.42, radius * 0.18, radius * 0.45)
      .fill({ color: secondary, alpha: 0.12 });
    target.rect(towerX - radius * 0.09, -radius * 0.42, radius * 0.18, radius * 0.45)
      .stroke({ color: secondary, width: 2, alpha: 0.7 });
    target.moveTo(towerX - radius * 0.14, -radius * 0.42).lineTo(towerX, -radius * 0.56).lineTo(towerX + radius * 0.14, -radius * 0.42)
      .fill({ color: secondary, alpha: 0.2 });
    target.moveTo(towerX - radius * 0.14, -radius * 0.42).lineTo(towerX, -radius * 0.56).lineTo(towerX + radius * 0.14, -radius * 0.42)
      .lineTo(towerX - radius * 0.14, -radius * 0.42)
      .stroke({ color: secondary, width: 2, alpha: 0.72 });
    for (var wave = 0; wave < 6; wave += 1) {
      var y = radius * (0.14 + wave * 0.1);
      target.moveTo(-radius * 0.05 * direction, y)
        .quadraticCurveTo(radius * 0.35 * direction, y - radius * 0.08, bleed.x * direction, y)
        .stroke({ color: wave % 2 ? secondary : primary, width: wave % 3 === 0 ? 2 : 1, alpha: 0.26 + wave * 0.045 });
    }
  }

  var SONNET_THEMED_DRAWERS = [
    sonnetDrawCamelliaMg, sonnetDrawTulipFieldMg, sonnetDrawWildflowerMg,
    sonnetDrawFernMg, sonnetDrawGinkgoMg, sonnetDrawClimbingVineMg,
    sonnetDrawGreenhouseMg, sonnetDrawPagodaMg, sonnetDrawCityFacadeMg,
    sonnetDrawTerracesMg, sonnetDrawMountainLakeMg, sonnetDrawCoastalCliffMg
  ];

  function sonnetDrawThemedShotMg(o) {
    var index = o.variant - SONNET_THEMED_GEO_VARIANT_START;
    var drawer = SONNET_THEMED_DRAWERS[index];
    if (!drawer) return false;
    drawer(o);
    return true;
  }

  /* ============================== 8. open-frame 变体 36–47 ============================== */
  /* sonnetOpenFrameShotMg.ts：十二种「开放画框」背景。文字可能落在 MG 区域之外，
   * 所以没有一个画封闭硬边界——弧、括号、标尺、碎片至少有一侧是开的。 */

  var SONNET_OPEN_GEO_VARIANT_START = 36;
  var SONNET_OPEN_GEO_VARIANT_COUNT = 12;

  var SONNET_OPEN_GEO_VARIANTS = [
    'open-arc-brackets', 'dashed-orbits', 'open-fragments', 'horizon-bundles',
    'semi-wreath', 'side-rulers', 'diagonal-stream', 'corner-petal-spray',
    'dotted-windows', 'open-radar', 'brush-strokes', 'stitch-corners'
  ];

  function sonnetRotatePoint(x, y, angle) {
    return [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle)
    ];
  }

  /* 四分之一弧贴住四个想象角，彼此不相连。 */
  function sonnetDrawOpenArcBrackets(o) {
    var target = o.target, width = o.width, height = o.height, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bx = width * 0.34;
    var by = height * 0.34;
    var arcR = radius * 0.17;
    /* (start, end) 对外象限逆时针扫过。 */
    var corners = [
      { x: -bx, y: -by, start: Math.PI, end: Math.PI * 1.5 },
      { x: bx, y: -by, start: -Math.PI / 2, end: 0 },
      { x: bx, y: by, start: 0, end: Math.PI / 2 },
      { x: -bx, y: by, start: Math.PI / 2, end: Math.PI }
    ];
    for (var index = 0; index < corners.length; index++) {
      var corner = corners[index];
      target.arc(corner.x, corner.y, arcR, corner.start, corner.end)
        .stroke({ color: index % 2 ? secondary : primary, width: 3, alpha: 0.6 });
      target.arc(corner.x, corner.y, arcR * 0.72, corner.start, corner.end)
        .stroke({ color: primary, width: 1, alpha: 0.3 });
      target.moveTo(corner.x - 5, corner.y).lineTo(corner.x + 5, corner.y)
        .stroke({ color: primary, width: 1, alpha: 0.5 });
      target.moveTo(corner.x, corner.y - 5).lineTo(corner.x, corner.y + 5)
        .stroke({ color: primary, width: 1, alpha: 0.5 });
    }
    var dotAngle = (seed % 8) * SONNET_TAU / 8;
    target.circle(Math.cos(dotAngle) * radius * 0.5, Math.sin(dotAngle) * radius * 0.5, radius * 0.02)
      .fill({ color: secondary, alpha: 0.7 });
  }

  /* 同心虚线轨道；每环都被断成带开放间隙的弧。 */
  function sonnetDrawDashedOrbits(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var ring = 0; ring < 3; ring += 1) {
      var ringRadius = radius * (0.32 + ring * 0.18);
      var dashes = 12 + ring * 4;
      var offset = seed * 0.13 + ring * 0.7;
      var span = (SONNET_TAU / dashes) * 0.55;
      for (var dash = 0; dash < dashes; dash += 1) {
        var start = offset + (dash / dashes) * SONNET_TAU;
        target.arc(0, 0, ringRadius, start, start + span)
          .stroke({ color: ring === 1 ? secondary : primary, width: ring === 1 ? 1 : 2, alpha: 0.28 + ring * 0.06 });
      }
    }
    var markerAngle = seed * 0.31;
    target.circle(Math.cos(markerAngle) * radius * 0.68, Math.sin(markerAngle) * radius * 0.68, radius * 0.022)
      .fill({ color: primary, alpha: 0.75 });
    target.circle(Math.cos(markerAngle + Math.PI) * radius * 0.5, Math.sin(markerAngle + Math.PI) * radius * 0.5, radius * 0.016)
      .fill({ color: secondary, alpha: 0.6 });
    target.circle(0, 0, radius * 0.05).stroke({ color: primary, width: 1.5, alpha: 0.5 });
  }

  /* 散布的三边方片；没有一片是闭合的。 */
  function sonnetDrawOpenFragments(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var index = 0; index < 5; index += 1) {
      var angle = (index / 5) * SONNET_TAU + seed * 0.05;
      var distance = radius * (0.42 + ((seed + index * 7) % 30) / 100);
      var cx = Math.cos(angle) * distance;
      var cy = Math.sin(angle) * distance * 0.8;
      var size = radius * (0.07 + ((seed + index * 13) % 20) / 200);
      var rotation = seed * 0.11 + index * 0.9;
      /* 正方形只画三边，第四边留空。 */
      var points = [
        sonnetRotatePoint(-size, -size, rotation),
        sonnetRotatePoint(size, -size, rotation),
        sonnetRotatePoint(size, size, rotation),
        sonnetRotatePoint(-size, size, rotation)
      ];
      target.moveTo(cx + points[0][0], cy + points[0][1]);
      for (var point = 1; point < points.length; point += 1) {
        target.lineTo(cx + points[point][0], cy + points[point][1]);
      }
      target.stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 });
      if (index === (seed % 5)) {
        target.circle(cx, cy, size * 0.28).fill({ color: primary, alpha: 0.35 });
      }
    }
  }

  /* 顶部与底部附近的断线束，中间留空。 */
  function sonnetDrawHorizonBundles(o) {
    var target = o.target, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bundles = [
      { baseY: -height * 0.28, drift: 1 },
      { baseY: height * 0.3, drift: -1 }
    ];
    for (var bundleIndex = 0; bundleIndex < bundles.length; bundleIndex++) {
      var bundle = bundles[bundleIndex];
      for (var line = 0; line < 3; line += 1) {
        var y = bundle.baseY + line * 10 * bundle.drift;
        var breakAt = width * ((((seed + line * 17 + bundleIndex * 31) % 40) + 30) / 100 - 0.5);
        var gapHalf = width * 0.045;
        target.moveTo(-width * 0.4, y).lineTo(breakAt - gapHalf, y)
          .stroke({ color: line === 1 ? secondary : primary, width: line === 1 ? 2 : 1, alpha: 0.42 - line * 0.08 });
        target.moveTo(breakAt + gapHalf, y).lineTo(width * 0.4, y)
          .stroke({ color: line === 1 ? secondary : primary, width: line === 1 ? 2 : 1, alpha: 0.42 - line * 0.08 });
      }
      target.moveTo(-width * 0.42, bundle.baseY)
        .lineTo(-width * 0.42 + 6, bundle.baseY)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
    }
    target.rect(width * 0.36, -height * 0.28 - 3, width * 0.04, 6).fill({ color: secondary, alpha: 0.5 });
  }

  /* 270 度花环 + 径向叶刻度 + 一个有意的开口。 */
  function sonnetDrawSemiWreath(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var opening = (seed % 4) * (Math.PI / 2) + Math.PI / 8;
    var span = SONNET_TAU * 0.75;
    var outer = radius * 0.58;
    var inner = radius * 0.5;
    target.arc(0, 0, outer, opening, opening + span)
      .stroke({ color: primary, width: 2.5, alpha: 0.55 });
    target.arc(0, 0, inner, opening, opening + span)
      .stroke({ color: secondary, width: 1, alpha: 0.3 });
    var ticks = 18;
    for (var index = 0; index < ticks; index += 1) {
      var angle = opening + (index / ticks) * span;
      target.moveTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .lineTo(Math.cos(angle) * (outer + radius * 0.05), Math.sin(angle) * (outer + radius * 0.05))
        .stroke({ color: primary, width: 1, alpha: 0.4 });
      if (index % 6 === 0) {
        target.circle(Math.cos(angle) * inner, Math.sin(angle) * inner, radius * 0.016)
          .fill({ color: secondary, alpha: 0.6 });
      }
    }
  }

  /* 两道竖直标尺列带刻度；构图上下永不闭合。 */
  function sonnetDrawSideRulers(o) {
    var target = o.target, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var sides = [-1, 1];
    for (var si = 0; si < sides.length; si++) {
      var side = sides[si];
      var x = side * width * 0.36;
      target.moveTo(x, -height * 0.3).lineTo(x, height * 0.3)
        .stroke({ color: primary, width: 1, alpha: 0.35 });
      for (var tick = 0; tick < 12; tick += 1) {
        var y = -height * 0.3 + (tick / 11) * height * 0.6;
        var length = tick % 4 === 0 ? 18 : 9;
        target.moveTo(x, y).lineTo(x - side * length, y)
          .stroke({ color: tick % 4 === 0 ? secondary : primary, width: 1, alpha: 0.45 });
      }
      var accentY = -height * 0.3 + (((seed + (side > 0 ? 5 : 0)) % 11) / 11) * height * 0.6;
      target.rect(side > 0 ? x : x - 4, accentY - 4, 4, 8).fill({ color: secondary, alpha: 0.6 });
    }
  }

  /* 一束平行斜流线 + 两个开放菱形。 */
  function sonnetDrawDiagonalStream(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var angle = Math.PI / 4 + (seed % 3) * (Math.PI / 12);
    var dirX = Math.cos(angle);
    var dirY = Math.sin(angle);
    var normalX = -dirY;
    var normalY = dirX;
    for (var line = 0; line < 7; line += 1) {
      var offset = (line - 3) * radius * 0.16;
      var length = radius * (0.55 + ((seed + line * 29) % 40) / 100);
      var cx = normalX * offset;
      var cy = normalY * offset;
      target.moveTo(cx - dirX * length, cy - dirY * length)
        .lineTo(cx + dirX * length * 0.6, cy + dirY * length * 0.6)
        .stroke({ color: line === 3 ? secondary : primary, width: line === 3 ? 2 : 1, alpha: 0.22 + line * 0.03 });
    }
    /* 菱形故意少画一条边。 */
    var diamondOffsets = [-radius * 0.16, radius * 0.16];
    for (var index = 0; index < diamondOffsets.length; index++) {
      var offsetD = diamondOffsets[index];
      var dcx = normalX * offsetD + dirX * radius * 0.1;
      var dcy = normalY * offsetD + dirY * radius * 0.1;
      var size = radius * 0.07;
      var points = [
        sonnetRotatePoint(0, -size, angle), sonnetRotatePoint(size, 0, angle),
        sonnetRotatePoint(0, size, angle), sonnetRotatePoint(-size, 0, angle)
      ];
      target.moveTo(dcx + points[0][0], dcy + points[0][1]);
      for (var point = 1; point < points.length; point += 1) {
        target.lineTo(dcx + points[point][0], dcy + points[point][1]);
      }
      target.stroke({ color: primary, width: 1.5, alpha: 0.55 });
      if (index === 0) target.circle(dcx, dcy, size * 0.22).fill({ color: secondary, alpha: 0.55 });
    }
  }

  /* 弧形花瓣笔触只从两个对角喷出。 */
  function sonnetDrawCornerPetalSpray(o) {
    var target = o.target, width = o.width, height = o.height, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var sign = seed % 2 === 0 ? 1 : -1;
    /* 花瓣从两个对角向内喷。 */
    var corners = [
      { x: -sign * width * 0.28, y: -height * 0.26, base: Math.atan2(1, sign) },
      { x: sign * width * 0.28, y: height * 0.26, base: Math.atan2(-1, -sign) }
    ];
    for (var cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
      var corner = corners[cornerIndex];
      for (var petal = 0; petal < 5; petal += 1) {
        var spread = (petal - 2) * 0.3;
        var angle = corner.base + spread;
        var length = radius * (0.3 - Math.abs(petal - 2) * 0.045);
        var endX = corner.x + Math.cos(angle) * length;
        var endY = corner.y + Math.sin(angle) * length;
        var ctrlX = corner.x + Math.cos(angle + 0.35) * length * 0.55;
        var ctrlY = corner.y + Math.sin(angle + 0.35) * length * 0.55;
        target.moveTo(corner.x, corner.y)
          .quadraticCurveTo(ctrlX, ctrlY, endX, endY)
          .stroke({ color: petal === 2 ? secondary : primary, width: petal === 2 ? 2 : 1, alpha: 0.4 });
      }
      if (cornerIndex === 0) {
        target.circle(corner.x, corner.y, radius * 0.02).fill({ color: primary, alpha: 0.6 });
      }
    }
  }

  /* 稀疏点阵 + 三个开放的角窗括号。 */
  function sonnetDrawDottedWindows(o) {
    var target = o.target, width = o.width, height = o.height, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var columns = 7;
    var rows = 5;
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        if ((row * columns + column + seed) % 5 === 0) continue;
        var x = (column - (columns - 1) / 2) * width * 0.11;
        var y = (row - (rows - 1) / 2) * height * 0.14;
        target.circle(x, y, 1.5).fill({ color: primary, alpha: 0.35 });
      }
    }
    var arm = radius * 0.1;
    for (var window = 0; window < 3; window += 1) {
      var cellX = (((seed + window * 2) % columns) - (columns - 1) / 2) * width * 0.11;
      var cellY = (((seed + window * 3 + 1) % rows) - (rows - 1) / 2) * height * 0.14;
      var flipX = (seed + window) % 2 === 0 ? 1 : -1;
      var flipY = (seed + window * 2) % 2 === 0 ? 1 : -1;
      /* 单个直角括号，标出一个想象中的窗角。 */
      target.moveTo(cellX + flipX * arm, cellY)
        .lineTo(cellX, cellY)
        .lineTo(cellX, cellY + flipY * arm)
        .stroke({ color: secondary, width: 2, alpha: 0.6 });
    }
  }

  /* 开放 200 度雷达弧 + 扫描线 + 未闭合目标标记。 */
  function sonnetDrawOpenRadar(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var span = SONNET_TAU * 0.56;
    for (var ring = 0; ring < 3; ring += 1) {
      var ringRadius = radius * (0.3 + ring * 0.18);
      var start = seed * 0.1 + ring * 0.9;
      target.arc(0, 0, ringRadius, start, start + span)
        .stroke({ color: ring === 1 ? secondary : primary, width: ring === 1 ? 2 : 1, alpha: 0.35 + ring * 0.06 });
    }
    var sweep = seed * 0.07;
    target.moveTo(0, 0)
      .lineTo(Math.cos(sweep) * radius * 0.66, Math.sin(sweep) * radius * 0.66)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
    var lockAngle = sweep + 0.8;
    var lockX = Math.cos(lockAngle) * radius * 0.48;
    var lockY = Math.sin(lockAngle) * radius * 0.48;
    var tick = radius * 0.04;
    /* 想象方块四周的四道刻度，互不相接。 */
    target.moveTo(lockX - tick * 2, lockY - tick).lineTo(lockX - tick * 2, lockY - tick * 2).lineTo(lockX - tick, lockY - tick * 2)
      .stroke({ color: secondary, width: 1.5, alpha: 0.7 });
    target.moveTo(lockX + tick * 2, lockY + tick).lineTo(lockX + tick * 2, lockY + tick * 2).lineTo(lockX + tick, lockY + tick * 2)
      .stroke({ color: secondary, width: 1.5, alpha: 0.7 });
    target.circle(0, 0, radius * 0.018).fill({ color: primary, alpha: 0.8 });
    target.circle(lockX, lockY, radius * 0.014).fill({ color: secondary, alpha: 0.7 });
  }

  /* 超大锥形笔触条松散散布，配开放方块。 */
  function sonnetDrawBrushStrokes(o) {
    var target = o.target, width = o.width, height = o.height, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var stroke = 0; stroke < 4; stroke += 1) {
      var horizontal = stroke % 2 === 0;
      var along = (((seed + stroke * 23) % 50) / 100 - 0.25) * (horizontal ? width : height);
      var across = (((seed + stroke * 41) % 60) / 100 - 0.3) * (horizontal ? height : width);
      var length = radius * (0.3 + ((seed + stroke * 7) % 25) / 100);
      var x1 = horizontal ? along - length : across;
      var y1 = horizontal ? across : along - length;
      var x2 = horizontal ? along + length : across;
      var y2 = horizontal ? across : along + length;
      target.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ color: stroke === 1 ? secondary : primary, width: radius * 0.04, alpha: 0.22 });
      target.moveTo(x1, y1 + (horizontal ? radius * 0.035 : 0))
        .lineTo(horizontal ? x2 * 0.6 : x2, horizontal ? y2 + radius * 0.035 : y2 * 0.6)
        .stroke({ color: primary, width: radius * 0.012, alpha: 0.45 });
    }
    /* 两处笔触末端的三边开放方块。 */
    var size = radius * 0.05;
    var anchorX = width * 0.3;
    var anchorY = -height * 0.3;
    target.moveTo(anchorX - size, anchorY - size).lineTo(anchorX + size, anchorY - size).lineTo(anchorX + size, anchorY + size)
      .stroke({ color: secondary, width: 1.5, alpha: 0.6 });
    target.rect(-anchorX - size / 2, -anchorY - size / 2, size, size).fill({ color: primary, alpha: 0.4 });
  }

  /* 间距很远的缝线虚线 L 角 + 点阵中心十字。 */
  function sonnetDrawStitchCorners(o) {
    var target = o.target, width = o.width, height = o.height, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var arm = radius * 0.18;
    var dash = radius * 0.03;
    var corners = [
      { x: -width * 0.39, y: -height * 0.36, sx: 1, sy: 1 },
      { x: width * 0.39, y: -height * 0.36, sx: -1, sy: 1 },
      { x: width * 0.39, y: height * 0.36, sx: -1, sy: -1 },
      { x: -width * 0.39, y: height * 0.36, sx: 1, sy: -1 }
    ];
    for (var index = 0; index < corners.length; index++) {
      var corner = corners[index];
      for (var offset = 0; offset + dash <= arm; offset += dash * 2) {
        target.moveTo(corner.x + corner.sx * offset, corner.y)
          .lineTo(corner.x + corner.sx * (offset + dash), corner.y)
          .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 });
        target.moveTo(corner.x, corner.y + corner.sy * offset)
          .lineTo(corner.x, corner.y + corner.sy * (offset + dash))
          .stroke({ color: index % 2 ? secondary : primary, width: 2, alpha: 0.5 });
      }
    }
    var crossArm = radius * 0.09;
    for (var offset = -crossArm; offset + dash * 0.6 <= crossArm; offset += dash * 1.2) {
      target.moveTo(offset, 0).lineTo(offset + dash * 0.6, 0)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
      target.moveTo(0, offset).lineTo(0, offset + dash * 0.6)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
    }
    target.circle(0, 0, radius * 0.012).fill({ color: secondary, alpha: 0.7 });
    /* 某个 seed 选中的角臂上的强调针脚，让不同种子可分辨。 */
    var accentCorner = corners[seed % corners.length];
    target.circle(accentCorner.x + accentCorner.sx * arm, accentCorner.y, radius * 0.014)
      .fill({ color: primary, alpha: 0.6 });
  }

  var SONNET_OPEN_DRAWERS = [
    sonnetDrawOpenArcBrackets, sonnetDrawDashedOrbits, sonnetDrawOpenFragments, sonnetDrawHorizonBundles,
    sonnetDrawSemiWreath, sonnetDrawSideRulers, sonnetDrawDiagonalStream, sonnetDrawCornerPetalSpray,
    sonnetDrawDottedWindows, sonnetDrawOpenRadar, sonnetDrawBrushStrokes, sonnetDrawStitchCorners
  ];

  /* 派发 open-frame 区间；区间外返回 false。 */
  function sonnetDrawOpenShotMg(o) {
    var index = o.variant - SONNET_OPEN_GEO_VARIANT_START;
    var drawer = SONNET_OPEN_DRAWERS[index];
    if (!drawer) return false;
    drawer(o);
    return true;
  }

  /* ============================== 9. extended 变体 48–99（上） ============================== */
  /* sonnetExtendedShotMg.ts + celestial / marine / music / craft / kinetic 五族。
   * 五十二个扩展主题背景注册成一个确定性区间，按主题分派到各族的抽屉表。
   * 全 range 开放构图：没有封闭视口边界、没有 clip mask，每条 stroke 独立命令，
   * 让共享 stagger 日程把它们分层错峰地画出来。 */

  var SONNET_EXTENDED_GEO_VARIANT_START = 48;
  var SONNET_EXTENDED_GEO_VARIANT_COUNT = 52;

  var SONNET_CELESTIAL_GEO_VARIANTS = [
    'spiral-galaxy', 'comet-trail', 'eclipse-corona', 'meteor-shower', 'orbit-satellites',
    'aurora-ribbons', 'crescent-halo', 'nebula-veil', 'star-map', 'lunar-tide'
  ];

  var SONNET_MARINE_GEO_VARIANTS = [
    'wave-scrolls', 'nautilus', 'coral-branch', 'lighthouse-beam', 'compass-rose',
    'sail-regatta', 'bubble-rise', 'tide-pools', 'seaweed-sway', 'deep-current'
  ];

  /* ---- celestial 十种（geo 48–57） ---- */

  /* 48: 双对数螺旋臂 + 亮核 + 自由星尘。 */
  function sonnetDrawSpiralGalaxy(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var arm = 0; arm < 2; arm += 1) {
      var offset = arm * Math.PI + foliaHash01(seed, arm, 101) * 0.5;
      target.moveTo(Math.cos(offset) * radius * 0.06, Math.sin(offset) * radius * 0.05);
      var steps = 56;
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps;
        var angle = offset + t * Math.PI * 3.1;
        var r = radius * (0.06 + t * 0.62);
        target.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.72);
      }
      target.stroke({ color: arm === 0 ? primary : secondary, width: 2, alpha: 0.5 - arm * 0.12 });
    }
    target.circle(0, 0, radius * 0.07).fill({ color: primary, alpha: 0.7 });
    target.circle(0, 0, radius * 0.12).stroke({ color: primary, width: 1, alpha: 0.3 });
    for (var i = 0; i < 14; i += 1) {
      var angle = foliaHash01(seed, i, 103) * SONNET_TAU;
      var r = radius * (0.2 + foliaHash01(seed, i, 107) * 0.55);
      target.circle(Math.cos(angle) * r, Math.sin(angle) * r * 0.72, 1.4 + foliaHash01(seed, i, 109) * 2.2)
        .fill({ color: i % 3 === 0 ? secondary : primary, alpha: 0.3 + foliaHash01(seed, i, 113) * 0.35 });
    }
  }

  /* 49: 彗星头 + 三条弯尾 + 十字闪光。 */
  function sonnetDrawCometTrail(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var hx = radius * 0.34 * direction;
    var hy = -radius * 0.18;
    for (var tail = 0; tail < 3; tail += 1) {
      var spread = (tail - 1) * radius * 0.12;
      target.moveTo(hx - direction * radius * 0.04, hy + spread * 0.3)
        .bezierCurveTo(
          hx - direction * radius * 0.35, hy + spread,
          hx - direction * radius * 0.6, hy + radius * 0.16 + spread,
          hx - direction * radius * (0.85 + tail * 0.06), hy + radius * 0.3 + spread * 1.2
        )
        .stroke({ color: tail === 1 ? secondary : primary, width: 3 - tail, alpha: 0.55 - tail * 0.12 });
    }
    target.circle(hx, hy, radius * 0.09).fill({ color: primary, alpha: 0.75 });
    target.circle(hx, hy, radius * 0.14).stroke({ color: primary, width: 1, alpha: 0.35 });
    for (var i = 0; i < 5; i += 1) {
      var x = (foliaHash01(seed, i, 127) - 0.5) * radius * 1.4;
      var y = radius * (0.1 + foliaHash01(seed, i, 131) * 0.5);
      var s = 2.5 + foliaHash01(seed, i, 137) * 2.5;
      target.moveTo(x - s, y).lineTo(x + s, y).stroke({ color: secondary, width: 1, alpha: 0.45 });
      target.moveTo(x, y - s).lineTo(x, y + s).stroke({ color: secondary, width: 1, alpha: 0.45 });
    }
  }

  /* 50: 日盘 + 不均匀的交替光芒日冕。 */
  function sonnetDrawEclipseCorona(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var discR = radius * 0.24;
    target.circle(0, 0, discR).fill({ color: primary, alpha: 0.16 });
    target.circle(0, 0, discR).stroke({ color: secondary, width: 2, alpha: 0.65 });
    target.circle(0, 0, discR * 1.14).stroke({ color: primary, width: 1, alpha: 0.25 });
    var rays = 28;
    for (var i = 0; i < rays; i += 1) {
      var angle = (i / rays) * SONNET_TAU + foliaHash01(seed, i, 139) * 0.08;
      var inner = discR * 1.2;
      var outer = radius * (i % 2 === 0 ? 0.6 : 0.42) * (0.85 + foliaHash01(seed, i, 149) * 0.3);
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: i % 2 === 0 ? 2 : 1, alpha: 0.3 + (i % 3) * 0.1 });
    }
  }

  /* 51: 斜向流星 streak + 发光头部，全部开放收尾。 */
  function sonnetDrawMeteorShower(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    for (var i = 0; i < 8; i += 1) {
      var x = (foliaHash01(seed, i, 151) - 0.5) * radius * 1.5;
      var y = -radius * 0.55 + foliaHash01(seed, i, 157) * radius * 0.9;
      var len = radius * (0.2 + foliaHash01(seed, i, 163) * 0.3);
      var dx = direction * len;
      var dy = len * 0.55;
      target.moveTo(x, y).lineTo(x - dx, y - dy)
        .stroke({ color: primary, width: 2, alpha: 0.55 });
      target.moveTo(x - dx * 0.15, y - dy * 0.15 + 3).lineTo(x - dx * 0.85, y - dy * 0.85 + 3)
        .stroke({ color: secondary, width: 1, alpha: 0.3 });
      target.circle(x, y, 2 + foliaHash01(seed, i, 167) * 2)
        .fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.7 });
    }
  }

  /* 52: 断口轨道环 + 小卫星菱形。 */
  function sonnetDrawOrbitSatellites(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var ring = 0; ring < 3; ring += 1) {
      var r = radius * (0.28 + ring * 0.18);
      var gapStart = foliaHash01(seed, ring, 173) * SONNET_TAU;
      var segs = 3 + ring;
      for (var s = 0; s < segs; s += 1) {
        var start = gapStart + (s / segs) * SONNET_TAU;
        target.arc(0, 0, r, start, start + (SONNET_TAU / segs) * 0.68)
          .stroke({ color: ring === 1 ? secondary : primary, width: ring === 0 ? 2 : 1, alpha: 0.35 + ring * 0.08 });
      }
      var satAngle = foliaHash01(seed, ring, 179) * SONNET_TAU;
      var sx = Math.cos(satAngle) * r;
      var sy = Math.sin(satAngle) * r;
      var d = 5 + ring * 2;
      target.moveTo(sx, sy - d).lineTo(sx + d, sy).lineTo(sx, sy + d).lineTo(sx - d, sy).lineTo(sx, sy - d)
        .fill({ color: secondary, alpha: 0.75 });
    }
    target.circle(0, 0, radius * 0.06).fill({ color: primary, alpha: 0.8 });
  }

  /* 53: 竖直极光带从顶部流下，没有边缘。 */
  function sonnetDrawAuroraRibbons(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var band = 0; band < 4; band += 1) {
      var x0 = -radius * 0.6 + band * radius * 0.38 + (foliaHash01(seed, band, 181) - 0.5) * radius * 0.1;
      var sway = (band % 2 === 0 ? 1 : -1) * radius * 0.2;
      target.moveTo(x0, -radius * 0.75)
        .bezierCurveTo(
          x0 + sway, -radius * 0.35,
          x0 - sway, radius * 0.1,
          x0 + sway * 0.6, radius * 0.55
        )
        .stroke({ color: band % 2 === 0 ? primary : secondary, width: 7 - band, alpha: 0.16 + band * 0.05 });
      target.moveTo(x0 + radius * 0.06, -radius * 0.7)
        .bezierCurveTo(
          x0 + sway + radius * 0.06, -radius * 0.3,
          x0 - sway + radius * 0.06, radius * 0.12,
          x0 + sway * 0.6 + radius * 0.06, radius * 0.5
        )
        .stroke({ color: primary, width: 1, alpha: 0.3 });
    }
    for (var i = 0; i < 8; i += 1) {
      target.circle(
        (foliaHash01(seed, i, 191) - 0.5) * radius * 1.5,
        -radius * 0.6 + foliaHash01(seed, i, 193) * radius * 0.5,
        1.4
      ).fill({ color: secondary, alpha: 0.5 });
    }
  }

  /* 54: 月牙 + 光环 + 垂挂星坠。 */
  function sonnetDrawCrescentHalo(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var moonR = radius * 0.3;
    var cx = -radius * 0.12;
    var cy = -radius * 0.1;
    target.moveTo(cx, cy - moonR);
    target.arc(cx, cy, moonR, -Math.PI / 2, Math.PI / 2, false);
    target.quadraticCurveTo(cx - moonR * 0.45, cy, cx, cy - moonR);
    target.fill({ color: primary, alpha: 0.55 });
    target.circle(cx, cy, moonR * 1.35).stroke({ color: secondary, width: 1, alpha: 0.3 });
    target.circle(cx, cy, moonR * 1.5).stroke({ color: primary, width: 1, alpha: 0.16 });
    for (var i = 0; i < 3; i += 1) {
      var px = radius * (0.18 + i * 0.16);
      var topY = -radius * 0.5 + foliaHash01(seed, i, 197) * radius * 0.1;
      var len = radius * (0.14 + foliaHash01(seed, i, 199) * 0.12);
      target.moveTo(px, topY).lineTo(px, topY + len).stroke({ color: primary, width: 1, alpha: 0.4 });
      var sr = 4 + i;
      var sy = topY + len + sr;
      target.moveTo(px, sy - sr).lineTo(px + sr * 0.25, sy - sr * 0.25)
        .lineTo(px + sr, sy).lineTo(px + sr * 0.25, sy + sr * 0.25)
        .lineTo(px, sy + sr).lineTo(px - sr * 0.25, sy + sr * 0.25)
        .lineTo(px - sr, sy).lineTo(px - sr * 0.25, sy - sr * 0.25)
        .lineTo(px, sy - sr)
        .stroke({ color: secondary, width: 1, alpha: 0.6 });
    }
  }

  /* 55: 嵌套有机星云纱——闭合贝塞尔团块，没有直边。 */
  function sonnetDrawNebulaVeil(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var blob = 0; blob < 4; blob += 1) {
      var bx = (foliaHash01(seed, blob, 211) - 0.5) * radius * 0.5;
      var by = (foliaHash01(seed, blob, 223) - 0.5) * radius * 0.4;
      var br = radius * (0.2 + blob * 0.1);
      var wobble = foliaHash01(seed, blob, 227) * 0.6;
      target.moveTo(bx + br, by);
      target.bezierCurveTo(bx + br, by - br * (0.6 + wobble * 0.3), bx + br * 0.5, by - br, bx, by - br * (0.9 - wobble * 0.2));
      target.bezierCurveTo(bx - br * 0.6, by - br * 0.8, bx - br, by - br * 0.3, bx - br * (0.85 + wobble * 0.2), by + br * 0.2);
      target.bezierCurveTo(bx - br * 0.7, by + br * 0.7, bx - br * 0.2, by + br, bx + br * 0.3, by + br * (0.8 + wobble * 0.2));
      target.bezierCurveTo(bx + br * 0.8, by + br * 0.6, bx + br, by + br * 0.4, bx + br, by);
      target.stroke({ color: blob % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.35 - blob * 0.04 });
      if (blob < 2) target.fill({ color: primary, alpha: 0.05 });
    }
    for (var i = 0; i < 10; i += 1) {
      target.circle(
        (foliaHash01(seed, i, 229) - 0.5) * radius * 1.2,
        (foliaHash01(seed, i, 233) - 0.5) * radius * 1.0,
        1.2 + foliaHash01(seed, i, 239) * 1.8
      ).fill({ color: primary, alpha: 0.25 + foliaHash01(seed, i, 241) * 0.3 });
    }
  }

  /* 56: 勘测式星图——淡十字网格 + 一个亮星座。 */
  function sonnetDrawStarMap(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var gx = 0; gx < 5; gx += 1) {
      for (var gy = 0; gy < 4; gy += 1) {
        var x = -radius * 0.6 + gx * radius * 0.3;
        var y = -radius * 0.45 + gy * radius * 0.3;
        target.moveTo(x - 3, y).lineTo(x + 3, y).stroke({ color: primary, width: 1, alpha: 0.18 });
        target.moveTo(x, y - 3).lineTo(x, y + 3).stroke({ color: primary, width: 1, alpha: 0.18 });
      }
    }
    var nodes = 6;
    var px = 0;
    var py = 0;
    for (var i = 0; i < nodes; i += 1) {
      var x = -radius * 0.5 + foliaHash01(seed, i, 251) * radius;
      var y = -radius * 0.4 + foliaHash01(seed, i, 257) * radius * 0.8;
      if (i > 0) {
        target.moveTo(px, py).lineTo(x, y).stroke({ color: secondary, width: 1.5, alpha: 0.55 });
      }
      target.circle(x, y, 3).fill({ color: primary, alpha: 0.8 });
      target.circle(x, y, 6.5).stroke({ color: primary, width: 1, alpha: 0.3 });
      px = x;
      py = y;
    }
  }

  /* 57: 上方月 + 下方开放潮汐弧——天与海之间的桥。 */
  function sonnetDrawLunarTide(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var mx = radius * 0.28 * (seed % 2 === 0 ? 1 : -1);
    var my = -radius * 0.34;
    target.circle(mx, my, radius * 0.16).fill({ color: primary, alpha: 0.2 });
    target.circle(mx, my, radius * 0.16).stroke({ color: primary, width: 2, alpha: 0.6 });
    target.arc(mx, my, radius * 0.24, Math.PI * 0.2, Math.PI * 0.8).stroke({ color: secondary, width: 1, alpha: 0.35 });
    for (var row = 0; row < 4; row += 1) {
      var y = radius * (0.05 + row * 0.14);
      var arcs = 6 - row;
      for (var i = 0; i < arcs; i += 1) {
        var x = -radius * 0.62 + i * radius * 0.24 + (row % 2) * radius * 0.12;
        target.arc(x, y, radius * 0.09, Math.PI, SONNET_TAU)
          .stroke({ color: row % 2 === 0 ? primary : secondary, width: row === 0 ? 2 : 1, alpha: 0.45 - row * 0.07 });
      }
    }
  }

  var SONNET_CELESTIAL_DRAWERS = [
    sonnetDrawSpiralGalaxy, sonnetDrawCometTrail, sonnetDrawEclipseCorona, sonnetDrawMeteorShower, sonnetDrawOrbitSatellites,
    sonnetDrawAuroraRibbons, sonnetDrawCrescentHalo, sonnetDrawNebulaVeil, sonnetDrawStarMap, sonnetDrawLunarTide
  ];

  /* ---- marine 十种（geo 58–67） ---- */

  /* 58: 重复波峰弧行，横跨整个 bleed 宽度。 */
  function sonnetDrawWaveScrolls(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var row = 0; row < 4; row += 1) {
      var y = -radius * 0.3 + row * radius * 0.22;
      var crestR = radius * 0.1;
      var step = crestR * 2.1;
      var count = Math.ceil((bleed.x * 2) / step);
      for (var i = 0; i < count; i += 1) {
        var x = -bleed.x + i * step + (row % 2) * crestR;
        target.arc(x, y, crestR, Math.PI, SONNET_TAU)
          .stroke({ color: (i + row) % 3 === 0 ? secondary : primary, width: row === 1 ? 2 : 1, alpha: 0.42 - row * 0.06 });
      }
    }
    for (var i = 0; i < 6; i += 1) {
      target.circle(
        (foliaHash01(seed, i, 263) - 0.5) * bleed.x * 1.4,
        -radius * 0.55 + foliaHash01(seed, i, 269) * radius * 0.25,
        1.6
      ).fill({ color: secondary, alpha: 0.4 });
    }
  }

  /* 59: 鹦鹉螺——采样对数螺旋 + 腔室分隔，外尖开放。 */
  function sonnetDrawNautilus(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var turns = 2.6;
    var steps = 90;
    var startAngle = foliaHash01(seed, 0, 271) * SONNET_TAU;
    target.moveTo(Math.cos(startAngle) * radius * 0.04, Math.sin(startAngle) * radius * 0.04);
    for (var i = 1; i <= steps; i += 1) {
      var t = i / steps;
      var angle = startAngle + t * turns * SONNET_TAU;
      var r = radius * (0.04 + t * 0.5);
      target.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.94);
    }
    target.stroke({ color: primary, width: 2.5, alpha: 0.65 });
    /* 腔室分隔线从螺旋核以渐增半径辐射。 */
    for (var i = 1; i <= 8; i += 1) {
      var t = i / 9;
      var angle = startAngle + t * turns * SONNET_TAU;
      var r = radius * (0.04 + t * 0.5);
      target.moveTo(Math.cos(angle) * r * 0.55, Math.sin(angle) * r * 0.52)
        .lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.94)
        .stroke({ color: secondary, width: 1, alpha: 0.35 });
    }
    target.circle(0, 0, radius * 0.05).stroke({ color: primary, width: 1.5, alpha: 0.5 });
  }

  /* 60: 珊瑚枝从底部分叉生长，带尖端芽。 */
  function sonnetDrawCoralBranch(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var baseX = (seed % 2 === 0 ? -1 : 1) * radius * 0.12;
    var fork = function (x, y, angle, len, width_, depth, limb) {
      var ex = x + Math.cos(angle) * len;
      var ey = y + Math.sin(angle) * len;
      target.moveTo(x, y)
        .quadraticCurveTo(
          x + Math.cos(angle + 0.3) * len * 0.5,
          y + Math.sin(angle + 0.3) * len * 0.5,
          ex, ey
        )
        .stroke({ color: depth === 0 ? secondary : primary, width: width_, alpha: 0.6 - depth * 0.12 });
      target.circle(ex, ey, width_ * 0.9).fill({ color: secondary, alpha: 0.5 });
      if (depth < 2) {
        var spread = 0.55 + foliaHash01(seed, limb, 277) * 0.3;
        fork(ex, ey, angle - spread, len * 0.62, Math.max(1, width_ - 1), depth + 1, limb * 2 + 1);
        fork(ex, ey, angle + spread * 0.8, len * 0.68, Math.max(1, width_ - 1), depth + 1, limb * 2 + 2);
      }
    };
    fork(baseX, radius * 0.62, -Math.PI / 2, radius * 0.34, 3, 0, 0);
    /* 几颗漂散的珊瑚虫。 */
    for (var i = 0; i < 5; i += 1) {
      target.circle(
        baseX + (foliaHash01(seed, i, 281) - 0.5) * radius * 0.9,
        radius * (0.3 + foliaHash01(seed, i, 283) * 0.3),
        1.8
      ).fill({ color: primary, alpha: 0.35 });
    }
  }

  /* 61: 灯塔立于矮礁，双光束扇出，开放海弧。 */
  function sonnetDrawLighthouseBeam(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var bx = -radius * 0.3 * direction;
    var baseY = radius * 0.42;
    /* 塔身：锥形轮廓，没有基座横条。 */
    target.moveTo(bx - radius * 0.09, baseY)
      .lineTo(bx - radius * 0.05, baseY - radius * 0.42)
      .lineTo(bx + radius * 0.05, baseY - radius * 0.42)
      .lineTo(bx + radius * 0.09, baseY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    target.rect(bx - radius * 0.07, baseY - radius * 0.52, radius * 0.14, radius * 0.1)
      .stroke({ color: primary, width: 1.5, alpha: 0.55 });
    target.circle(bx, baseY - radius * 0.47, radius * 0.025).fill({ color: secondary, alpha: 0.9 });
    /* 双光束扇向开放的右侧。 */
    for (var beam = 0; beam < 2; beam += 1) {
      var spread = radius * (0.1 + beam * 0.12);
      target.moveTo(bx, baseY - radius * 0.47)
        .lineTo(bx + direction * radius * 0.85, baseY - radius * 0.47 - spread)
        .stroke({ color: secondary, width: 1.5, alpha: 0.4 - beam * 0.1 });
      target.moveTo(bx, baseY - radius * 0.47)
        .lineTo(bx + direction * radius * 0.85, baseY - radius * 0.47 + spread)
        .stroke({ color: secondary, width: 1.5, alpha: 0.4 - beam * 0.1 });
    }
    /* 下方海弧，互不相连。 */
    for (var i = 0; i < 5; i += 1) {
      var x = -radius * 0.6 + i * radius * 0.3;
      target.arc(x, radius * 0.56, radius * 0.1, Math.PI, SONNET_TAU)
        .stroke({ color: primary, width: 1, alpha: 0.35 });
    }
  }

  /* 62: 罗盘玫瑰 + 长基数指针 + 局部度弧。 */
  function sonnetDrawCompassRose(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var roseR = radius * 0.42;
    for (var i = 0; i < 8; i += 1) {
      var angle = (i / 8) * SONNET_TAU - Math.PI / 2;
      var long = i % 2 === 0;
      var len = long ? roseR : roseR * 0.55;
      var halfWidth = long ? 0.09 : 0.06;
      /* 指针 = 从中心出发的细三角。 */
      var tx = Math.cos(angle) * len;
      var ty = Math.sin(angle) * len;
      var lx = Math.cos(angle + halfWidth) * roseR * 0.16;
      var ly = Math.sin(angle + halfWidth) * roseR * 0.16;
      var rx = Math.cos(angle - halfWidth) * roseR * 0.16;
      var ry = Math.sin(angle - halfWidth) * roseR * 0.16;
      target.moveTo(lx, ly).lineTo(tx, ty).lineTo(rx, ry)
        .stroke({ color: long ? primary : secondary, width: long ? 2 : 1, alpha: long ? 0.65 : 0.45 });
      if (long && i % 4 === 0) {
        target.moveTo(lx, ly).lineTo(tx, ty).lineTo(rx, ry)
          .fill({ color: primary, alpha: 0.1 });
      }
    }
    target.circle(0, 0, roseR * 0.14).stroke({ color: primary, width: 1.5, alpha: 0.6 });
    target.circle(0, 0, roseR * 0.05).fill({ color: secondary, alpha: 0.8 });
    /* 度刻度只沿一段开放弧——刻意不是闭合表盘。 */
    var arcStart = foliaHash01(seed, 0, 293) * SONNET_TAU;
    for (var i = 0; i <= 24; i += 1) {
      var angle = arcStart + (i / 24) * Math.PI * 1.2;
      var inner = roseR * 1.12;
      var outer = inner + (i % 6 === 0 ? 10 : 5);
      target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
    }
  }

  /* 63: 三艘抽象帆船 + 开放水波短划。 */
  function sonnetDrawSailRegatta(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var boat = 0; boat < 3; boat += 1) {
      var scale = 1 - boat * 0.24;
      var bx = (boat - 1) * radius * 0.44 + (foliaHash01(seed, boat, 307) - 0.5) * radius * 0.08;
      var by = radius * (0.28 - boat * 0.12);
      var mastH = radius * 0.34 * scale;
      target.moveTo(bx, by).lineTo(bx, by - mastH)
        .stroke({ color: primary, width: 2, alpha: 0.6 });
      /* 帆：二次曲线后缘。 */
      target.moveTo(bx, by - mastH)
        .quadraticCurveTo(bx + radius * 0.2 * scale, by - mastH * 0.55, bx, by - mastH * 0.08)
        .stroke({ color: boat === 1 ? secondary : primary, width: 1.5, alpha: 0.55 });
      target.moveTo(bx, by - mastH * 0.92)
        .lineTo(bx - radius * 0.13 * scale, by - mastH * 0.1)
        .lineTo(bx, by - mastH * 0.1)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
      /* 船体：浅弧，两端开放。 */
      target.moveTo(bx - radius * 0.15 * scale, by)
        .quadraticCurveTo(bx, by + radius * 0.07 * scale, bx + radius * 0.15 * scale, by)
        .stroke({ color: primary, width: 2, alpha: 0.55 });
    }
    for (var i = 0; i < 7; i += 1) {
      var x = -radius * 0.66 + i * radius * 0.22;
      var y = radius * (0.42 + (i % 2) * 0.05);
      target.moveTo(x, y).lineTo(x + radius * 0.1, y)
        .stroke({ color: secondary, width: 1, alpha: 0.35 });
    }
  }

  /* 64: 三列上升气泡，大泡带高光弧。 */
  function sonnetDrawBubbleRise(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var column = 0; column < 3; column += 1) {
      var x = (column - 1) * radius * 0.34 + (foliaHash01(seed, column, 311) - 0.5) * radius * 0.12;
      var count = 5 + column;
      for (var i = 0; i < count; i += 1) {
        var t = i / count;
        var y = radius * 0.55 - t * radius * 1.05;
        var wobble = (foliaHash01(seed, column * 10 + i, 313) - 0.5) * radius * 0.08;
        var r = radius * (0.02 + t * 0.055);
        target.circle(x + wobble, y, r)
          .stroke({ color: i % 3 === 0 ? secondary : primary, width: 1, alpha: 0.35 + t * 0.35 });
        if (r > radius * 0.05) {
          target.arc(x + wobble, y, r * 0.55, Math.PI * 1.1, Math.PI * 1.6)
            .stroke({ color: secondary, width: 1, alpha: 0.5 });
        }
      }
    }
  }

  /* 65: 重叠有机潮汐池环 + 内部卵石点。 */
  function sonnetDrawTidePools(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var pool = 0; pool < 4; pool += 1) {
      var px = (foliaHash01(seed, pool, 317) - 0.5) * radius * 0.7;
      var py = (foliaHash01(seed, pool, 331) - 0.2) * radius * 0.5;
      var pr = radius * (0.16 + foliaHash01(seed, pool, 337) * 0.12);
      target.moveTo(px + pr, py);
      target.bezierCurveTo(px + pr, py - pr * 0.7, px + pr * 0.4, py - pr, px, py - pr * 0.9);
      target.bezierCurveTo(px - pr * 0.7, py - pr * 0.8, px - pr, py - pr * 0.2, px - pr * 0.9, py + pr * 0.3);
      target.bezierCurveTo(px - pr * 0.6, py + pr * 0.8, px + pr * 0.2, py + pr, px + pr * 0.6, py + pr * 0.7);
      target.bezierCurveTo(px + pr * 0.95, py + pr * 0.5, px + pr, py + pr * 0.3, px + pr, py);
      target.stroke({ color: pool % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.45 });
      for (var pebble = 0; pebble < 3; pebble += 1) {
        target.circle(
          px + (foliaHash01(seed, pool * 4 + pebble, 347) - 0.5) * pr,
          py + (foliaHash01(seed, pool * 4 + pebble, 349) - 0.5) * pr * 0.7,
          1.6 + pebble
        ).fill({ color: secondary, alpha: 0.45 });
      }
    }
  }

  /* 66: 高海草叶从底部摇摆，带漂移气泡。 */
  function sonnetDrawSeaweedSway(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var blade = 0; blade < 6; blade += 1) {
      var x = -radius * 0.55 + blade * radius * 0.22 + (foliaHash01(seed, blade, 353) - 0.5) * radius * 0.06;
      var h = radius * (0.4 + foliaHash01(seed, blade, 359) * 0.3);
      var sway = (blade % 2 === 0 ? 1 : -1) * radius * 0.12;
      target.moveTo(x, radius * 0.62)
        .bezierCurveTo(x + sway, radius * 0.62 - h * 0.4, x - sway, radius * 0.62 - h * 0.7, x + sway * 0.5, radius * 0.62 - h)
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 2, alpha: 0.5 - blade * 0.03 });
      target.circle(x + sway * 0.5, radius * 0.62 - h, 2).fill({ color: secondary, alpha: 0.5 });
    }
    for (var i = 0; i < 6; i += 1) {
      target.circle(
        (foliaHash01(seed, i, 367) - 0.5) * radius * 1.1,
        -radius * 0.5 + foliaHash01(seed, i, 373) * radius * 0.5,
        1.4 + foliaHash01(seed, i, 379) * 1.6
      ).stroke({ color: primary, width: 1, alpha: 0.35 });
    }
  }

  /* 67: 分层水平流线 + 散布的鱼形 V 字。 */
  function sonnetDrawDeepCurrent(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var line = 0; line < 5; line += 1) {
      var y = -radius * 0.4 + line * radius * 0.2;
      var lift = (line % 2 === 0 ? 1 : -1) * radius * 0.06;
      target.moveTo(-bleed.x, y)
        .bezierCurveTo(-radius * 0.3, y + lift, radius * 0.3, y - lift, bleed.x, y)
        .stroke({ color: line === 2 ? secondary : primary, width: line === 2 ? 2 : 1, alpha: 0.32 + (line % 3) * 0.07 });
    }
    /* 鱼形 V 字逆流而上，按 seed 偏移。 */
    for (var i = 0; i < 6; i += 1) {
      var x = (foliaHash01(seed, i, 383) - 0.5) * radius * 1.2;
      var y = -radius * 0.3 + foliaHash01(seed, i, 389) * radius * 0.6;
      var s = 5 + foliaHash01(seed, i, 397) * 4;
      var flip = i % 2 === 0 ? 1 : -1;
      target.moveTo(x - s * flip, y - s * 0.5).lineTo(x, y).lineTo(x - s * flip, y + s * 0.5)
        .stroke({ color: secondary, width: 1.5, alpha: 0.55 });
    }
  }

  var SONNET_MARINE_DRAWERS = [
    sonnetDrawWaveScrolls, sonnetDrawNautilus, sonnetDrawCoralBranch, sonnetDrawLighthouseBeam, sonnetDrawCompassRose,
    sonnetDrawSailRegatta, sonnetDrawBubbleRise, sonnetDrawTidePools, sonnetDrawSeaweedSway, sonnetDrawDeepCurrent
  ];

  /* ---- music 八种（geo 68–75） ---- */

  var SONNET_MUSIC_GEO_VARIANTS = [
    'sound-wave', 'vinyl-grooves', 'equalizer-bloom', 'note-arc',
    'tuning-fork', 'piano-ribbon', 'metronome', 'staff-wave'
  ];

  /* 68: 对称波形绕开放中轴镜像。 */
  function sonnetDrawSoundWave(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var steps = 72;
    var envelope = function (t) {
      return Math.sin(t * Math.PI) * (0.4 + 0.6 * foliaHash01(seed, Math.round(t * 12), 401));
    };
    var mirrors = [-1, 1];
    for (var mi = 0; mi < mirrors.length; mi++) {
      var mirror = mirrors[mi];
      target.moveTo(-bleed.x, 0);
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps;
        var x = -bleed.x + t * bleed.x * 2;
        var y = mirror * Math.sin(t * SONNET_TAU * 5 + seed * 0.13) * radius * 0.22 * envelope(t);
        target.lineTo(x, y);
      }
      target.stroke({ color: mirror < 0 ? primary : secondary, width: mirror < 0 ? 2 : 1, alpha: 0.55 });
    }
    target.moveTo(-bleed.x, 0).lineTo(bleed.x, 0).stroke({ color: primary, width: 1, alpha: 0.18 });
  }

  /* 69: 黑胶——带间隙的沟槽弧（永不是闭合环）+ 唱臂。 */
  function sonnetDrawVinylGrooves(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var groove = 0; groove < 7; groove += 1) {
      var r = radius * (0.2 + groove * 0.08);
      var gapAt = foliaHash01(seed, groove, 409) * SONNET_TAU;
      target.arc(0, 0, r, gapAt, gapAt + SONNET_TAU * 0.86)
        .stroke({ color: groove % 3 === 0 ? secondary : primary, width: groove % 3 === 0 ? 2 : 1, alpha: 0.3 + groove * 0.05 });
    }
    target.circle(0, 0, radius * 0.12).stroke({ color: primary, width: 2, alpha: 0.6 });
    target.circle(0, 0, radius * 0.03).fill({ color: secondary, alpha: 0.8 });
    /* 唱臂从角部枢轴扫入。 */
    var pivotX = radius * 0.62;
    var pivotY = -radius * 0.52;
    target.circle(pivotX, pivotY, radius * 0.035).stroke({ color: primary, width: 2, alpha: 0.6 });
    target.moveTo(pivotX, pivotY)
      .lineTo(radius * 0.18, -radius * 0.1)
      .stroke({ color: primary, width: 3, alpha: 0.5 });
    target.circle(radius * 0.18, -radius * 0.1, 3).fill({ color: secondary, alpha: 0.8 });
  }

  /* 70: 均衡器条沿浅底弧绽放，没有基线框。 */
  function sonnetDrawEqualizerBloom(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bars = 17;
    for (var i = 0; i < bars; i += 1) {
      var t = i / (bars - 1);
      var x = -radius * 0.66 + t * radius * 1.32;
      var arcY = radius * 0.5 - Math.sin(t * Math.PI) * radius * 0.12;
      var h = radius * (0.08 + Math.sin(t * Math.PI) * 0.3 * (0.5 + foliaHash01(seed, i, 419) * 0.8));
      target.moveTo(x, arcY).lineTo(x, arcY - h)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: 3, alpha: 0.5 + Math.sin(t * Math.PI) * 0.25 });
      target.circle(x, arcY - h - 4, 1.6).fill({ color: secondary, alpha: 0.55 });
    }
  }

  /* 71: 五个八分音符沿弧步进，由一条开放梁连接。 */
  function sonnetDrawNoteArc(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var headR = radius * 0.045;
    var points = [];
    for (var i = 0; i < 5; i += 1) {
      var t = i / 4;
      var x = -radius * 0.55 + t * radius * 1.1;
      var y = radius * 0.22 - Math.sin(t * Math.PI * 0.9) * radius * 0.34;
      points.push({ x: x, y: y });
      target.circle(x, y, headR).fill({ color: i === 2 ? secondary : primary, alpha: 0.8 });
      target.moveTo(x + headR, y).lineTo(x + headR, y - radius * 0.16)
        .stroke({ color: i === 2 ? secondary : primary, width: 2, alpha: 0.65 });
    }
    /* 连接符杆顶的梁，最后一个音符之后仍开放。 */
    target.moveTo(points[0].x + headR, points[0].y - radius * 0.16);
    for (var i = 1; i < points.length; i += 1) {
      target.lineTo(points[i].x + headR, points[i].y - radius * 0.16);
    }
    target.lineTo(points[4].x + radius * 0.12, points[4].y - radius * 0.13);
    target.stroke({ color: primary, width: 3, alpha: 0.5 });
    /* 第一个音符上卷曲的孤立符尾。 */
    target.moveTo(points[0].x + headR, points[0].y - radius * 0.16)
      .quadraticCurveTo(points[0].x + radius * 0.1, points[0].y - radius * 0.1, points[0].x + radius * 0.06, points[0].y - radius * 0.02)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
  }

  /* 72: 音叉 + 两侧传播声环。 */
  function sonnetDrawTuningFork(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var fx = (seed % 2 === 0 ? -1 : 1) * radius * 0.08;
    var topY = -radius * 0.4;
    var prongW = radius * 0.05;
    var prongGap = radius * 0.1;
    var uY = radius * 0.02;
    /* 双叉 + U 弯 + 柄，按段拆成开放路径。 */
    target.moveTo(fx - prongGap / 2 - prongW, topY).lineTo(fx - prongGap / 2 - prongW, uY)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 });
    target.moveTo(fx + prongGap / 2 + prongW, topY).lineTo(fx + prongGap / 2 + prongW, uY)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 });
    target.arc(fx, uY, prongGap / 2 + prongW, 0, Math.PI)
      .stroke({ color: primary, width: 2.5, alpha: 0.65 });
    target.moveTo(fx, uY + prongGap / 2 + prongW).lineTo(fx, radius * 0.42)
      .stroke({ color: primary, width: 3, alpha: 0.6 });
    target.circle(fx, radius * 0.46, radius * 0.035).stroke({ color: secondary, width: 2, alpha: 0.6 });
    /* 叉左右两侧的振动弧。 */
    for (var side = -1; side <= 1; side += 2) {
      for (var ring = 0; ring < 3; ring += 1) {
        var r = radius * (0.14 + ring * 0.1);
        var cx = fx + side * radius * 0.06;
        var cy = topY + radius * 0.1;
        target.arc(cx, cy, r, side < 0 ? Math.PI * 0.6 : -Math.PI * 0.4, side < 0 ? Math.PI * 1.4 : Math.PI * 0.4)
          .stroke({ color: ring === 1 ? secondary : primary, width: 1.5, alpha: 0.42 - ring * 0.1 });
      }
    }
  }

  /* 73: 琴键骑在浅缎带曲线上——长短条交替。 */
  function sonnetDrawPianoRibbon(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    /* 缎带引导曲线，两端开放。 */
    target.moveTo(-bleed.x, radius * 0.18)
      .bezierCurveTo(-radius * 0.3, -radius * 0.05, radius * 0.3, radius * 0.3, bleed.x, radius * 0.05)
      .stroke({ color: primary, width: 1, alpha: 0.25 });
    var keys = 12;
    for (var i = 0; i < keys; i += 1) {
      var t = i / (keys - 1);
      var x = -radius * 0.6 + t * radius * 1.2;
      var baseY = radius * 0.18 + Math.sin(t * Math.PI) * -radius * 0.1 + t * -radius * 0.06;
      var black = [1, 3, 6, 8, 10].indexOf(i % 12) >= 0;
      var len = radius * (black ? 0.14 : 0.24);
      target.moveTo(x, baseY).lineTo(x, baseY - len)
        .stroke({ color: black ? secondary : primary, width: black ? 4 : 3, alpha: black ? 0.7 : 0.45 });
    }
  }

  /* 74: 节拍器 + 倾斜摆杆 + 运动回声弧。 */
  function sonnetDrawMetronome(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var cx = 0;
    var baseY = radius * 0.4;
    var topY = -radius * 0.36;
    /* 锥形机身轮廓，底部开放。 */
    target.moveTo(cx - radius * 0.2, baseY).lineTo(cx - radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    target.moveTo(cx + radius * 0.2, baseY).lineTo(cx + radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    target.moveTo(cx - radius * 0.06, topY).lineTo(cx + radius * 0.06, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    /* 摆杆。 */
    var tilt = (foliaHash01(seed, 0, 431) - 0.5) * 0.9;
    var pivotY = radius * 0.16;
    var tipX = cx + Math.sin(tilt) * radius * 0.5;
    var tipY = pivotY - Math.cos(tilt) * radius * 0.5;
    target.circle(cx, pivotY, radius * 0.03).fill({ color: secondary, alpha: 0.85 });
    target.moveTo(cx, pivotY).lineTo(tipX, tipY).stroke({ color: secondary, width: 2, alpha: 0.7 });
    target.rect(tipX - 4, tipY - 4, 8, 8).fill({ color: secondary, alpha: 0.7 });
    /* 随摆杆扫动的回声弧。 */
    for (var i = 0; i < 3; i += 1) {
      var r = radius * (0.24 + i * 0.12);
      target.arc(cx, pivotY, r, -Math.PI / 2 - 0.5 - i * 0.1, -Math.PI / 2 + 0.5 + i * 0.1)
        .stroke({ color: primary, width: 1, alpha: 0.3 - i * 0.06 });
    }
  }

  /* 75: 五条谱线横跨 bleed 起伏，带几个自由音符。 */
  function sonnetDrawStaffWave(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    for (var line = 0; line < 5; line += 1) {
      var y0 = -radius * 0.16 + line * radius * 0.08;
      var lift = (line % 2 === 0 ? 1 : -1) * radius * 0.05;
      target.moveTo(-bleed.x, y0)
        .bezierCurveTo(-radius * 0.3, y0 + lift, radius * 0.3, y0 - lift, bleed.x, y0)
        .stroke({ color: primary, width: 1, alpha: 0.3 + (line === 2 ? 0.15 : 0) });
    }
    for (var i = 0; i < 4; i += 1) {
      var x = -radius * 0.45 + i * radius * 0.3 + (foliaHash01(seed, i, 439) - 0.5) * radius * 0.08;
      var y = -radius * 0.16 + Math.floor(foliaHash01(seed, i, 443) * 5) * radius * 0.08;
      target.circle(x, y, radius * 0.032).fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.85 });
      target.moveTo(x + radius * 0.032, y).lineTo(x + radius * 0.032, y - radius * 0.14)
        .stroke({ color: i % 2 === 0 ? secondary : primary, width: 1.5, alpha: 0.6 });
    }
  }

  var SONNET_MUSIC_DRAWERS = [
    sonnetDrawSoundWave, sonnetDrawVinylGrooves, sonnetDrawEqualizerBloom, sonnetDrawNoteArc,
    sonnetDrawTuningFork, sonnetDrawPianoRibbon, sonnetDrawMetronome, sonnetDrawStaffWave
  ];

  /* ---- craft 十种（geo 76–85） ---- */

  var SONNET_CRAFT_GEO_VARIANTS = [
    'origami-crane', 'paper-plane-trail', 'weave-band', 'knot-loop', 'stitch-sampler',
    'folded-fan', 'ribbon-curl', 'patchwork-trio', 'dreamcatcher', 'tassel-drop'
  ];

  /* 76: 折纸鹤线稿 + 两处轻填充折面。 */
  function sonnetDrawOrigamiCrane(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var s = radius * 0.34;
    /* 身体菱形。 */
    target.moveTo(0, -s * 0.3).lineTo(direction * s * 0.5, 0).lineTo(0, s * 0.35).lineTo(-direction * s * 0.5, 0)
      .lineTo(0, -s * 0.3)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    /* 抬起的翅膀。 */
    target.moveTo(0, -s * 0.3).lineTo(-direction * s * 0.15, -s * 0.95).lineTo(direction * s * 0.28, -s * 0.1)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
    target.moveTo(0, -s * 0.3).lineTo(-direction * s * 0.15, -s * 0.95).lineTo(-direction * s * 0.42, s * 0.02)
      .fill({ color: primary, alpha: 0.07 });
    /* 颈 + 头。 */
    target.moveTo(direction * s * 0.5, 0)
      .lineTo(direction * s * 0.78, -s * 0.62)
      .lineTo(direction * s * 0.98, -s * 0.5)
      .stroke({ color: secondary, width: 1.5, alpha: 0.6 });
    /* 尾。 */
    target.moveTo(-direction * s * 0.5, 0).lineTo(-direction * s * 0.85, -s * 0.5)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
    /* 折痕线。 */
    target.moveTo(0, -s * 0.3).lineTo(0, s * 0.35).stroke({ color: secondary, width: 1, alpha: 0.3 });
    target.moveTo(-direction * s * 0.5, 0).lineTo(direction * s * 0.5, 0)
      .stroke({ color: secondary, width: 1, alpha: 0.3 });
  }

  /* 77: 纸飞机 + 分段环回尾迹。 */
  function sonnetDrawPaperPlaneTrail(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var direction = seed % 2 === 0 ? 1 : -1;
    var px = radius * 0.4 * direction;
    var py = -radius * 0.28;
    var s = radius * 0.16;
    /* 飞机：两个折三角。 */
    target.moveTo(px + direction * s, py).lineTo(px - direction * s * 0.8, py - s * 0.55).lineTo(px - direction * s * 0.35, py)
      .lineTo(px + direction * s, py)
      .stroke({ color: primary, width: 2, alpha: 0.65 });
    target.moveTo(px + direction * s, py).lineTo(px - direction * s * 0.35, py).lineTo(px - direction * s * 0.8, py + s * 0.4)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
    /* 尾迹：三段带刻意间隙的弧。 */
    for (var seg = 0; seg < 3; seg += 1) {
      var start = Math.PI * (0.1 + seg * 0.55);
      target.arc(px - direction * radius * 0.35, py + radius * 0.3, radius * (0.34 + seg * 0.06), start, start + Math.PI * 0.4)
        .stroke({ color: seg === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - seg * 0.08 });
    }
  }

  /* 78: 编织带——竖条借间隙在两条横条上下穿行。 */
  function sonnetDrawWeaveBand(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bandY = [-radius * 0.12, radius * 0.12];
    var strips = 7;
    /* 横条先画（在后），每条在每个交叉点断开。 */
    for (var row = 0; row < bandY.length; row++) {
      var y = bandY[row];
      for (var i = 0; i < strips; i += 1) {
        var x0 = -radius * 0.63 + i * radius * 0.18;
        if ((i + row) % 2 === 0) {
          target.moveTo(x0 + radius * 0.02, y).lineTo(x0 + radius * 0.16, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 });
        } else {
          target.moveTo(x0 - radius * 0.05, y).lineTo(x0 + radius * 0.02, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 });
          target.moveTo(x0 + radius * 0.16, y).lineTo(x0 + radius * 0.23, y)
            .stroke({ color: row === 0 ? primary : secondary, width: 5, alpha: 0.4 });
        }
      }
    }
    /* 竖条压在留隙的交叉点上。 */
    for (var i = 0; i < strips; i += 1) {
      var x = -radius * 0.54 + i * radius * 0.18;
      var overRow = i % 2;
      var vy = bandY[overRow];
      target.moveTo(x, vy - radius * 0.05).lineTo(x, vy + radius * 0.05)
        .stroke({ color: primary, width: 6, alpha: 0.6 });
      target.moveTo(x, bandY[1 - overRow] - radius * 0.03).lineTo(x, bandY[1 - overRow] + radius * 0.03)
        .stroke({ color: secondary, width: 2, alpha: 0.3 });
    }
  }

  /* 79: 8 字结按段绘制，交叉处留隙表示上下关系。 */
  function sonnetDrawKnotLoop(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var s = radius * 0.34;
    /* 左环，在右环压过处断开。 */
    target.moveTo(0, 0);
    target.bezierCurveTo(-s * 0.9, -s * 0.9, -s * 1.5, -s * 0.2, -s * 0.8, s * 0.28);
    target.stroke({ color: primary, width: 3, alpha: 0.6 });
    target.moveTo(-s * 0.62, s * 0.34);
    target.bezierCurveTo(-s * 0.3, s * 0.44, -s * 0.12, s * 0.2, 0, 0);
    target.stroke({ color: primary, width: 3, alpha: 0.6 });
    /* 右环，在左环压过处断开。 */
    target.moveTo(s * 0.12, -s * 0.08);
    target.bezierCurveTo(s * 0.6, -s * 0.6, s * 1.4, -s * 0.3, s * 0.9, s * 0.2);
    target.stroke({ color: secondary, width: 3, alpha: 0.6 });
    target.moveTo(s * 0.72, s * 0.26);
    target.bezierCurveTo(s * 0.4, s * 0.4, s * 0.05, s * 0.14, -s * 0.06, s * 0.04);
    target.stroke({ color: secondary, width: 3, alpha: 0.6 });
    /* 松散末端向外飘。 */
    target.moveTo(0, 0).bezierCurveTo(-s * 0.2, s * 0.5, -s * 0.4, s * 0.8, -s * 0.3, s * 1.1)
      .stroke({ color: primary, width: 2, alpha: 0.4 });
    target.moveTo(s * 0.06, -s * 0.02).bezierCurveTo(s * 0.3, -s * 0.5, s * 0.5, -s * 0.8, s * 0.42, -s * 1.05)
      .stroke({ color: secondary, width: 2, alpha: 0.4 });
  }

  /* 80: 十字绣样本行，向边缘渐隐。 */
  function sonnetDrawStitchSampler(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var stitch = function (x, y, size, color, alpha) {
      target.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color: color, width: 1.5, alpha: alpha });
      target.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color: color, width: 1.5, alpha: alpha });
    };
    for (var row = 0; row < 4; row += 1) {
      var y = -radius * 0.36 + row * radius * 0.24;
      var count = 7 - Math.abs(row - 1.5);
      for (var i = 0; i < count; i += 1) {
        var x = (i - (count - 1) / 2) * radius * 0.16 + (row % 2) * radius * 0.08;
        var edgeFade = 1 - Math.abs(i - (count - 1) / 2) / (count / 2 + 0.5);
        stitch(x, y, 4 + (row % 2), (i + row) % 3 === 0 ? secondary : primary, 0.25 + edgeFade * 0.4);
      }
    }
  }

  /* 81: 折扇——从枢轴出发的扇骨 + 双护弧，顶部开放。 */
  function sonnetDrawFoldedFan(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var pivotY = radius * 0.42;
    var ribs = 11;
    var spread = Math.PI * 0.9;
    for (var i = 0; i < ribs; i += 1) {
      var angle = -Math.PI / 2 - spread / 2 + (i / (ribs - 1)) * spread;
      var len = radius * (0.5 + Math.sin((i / (ribs - 1)) * Math.PI) * 0.12);
      target.moveTo(0, pivotY)
        .lineTo(Math.cos(angle) * len, pivotY + Math.sin(angle) * len)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: i === 5 ? 2.5 : 1.5, alpha: 0.5 });
    }
    target.arc(0, pivotY, radius * 0.5, -Math.PI / 2 - spread / 2, -Math.PI / 2 + spread / 2)
      .stroke({ color: primary, width: 2, alpha: 0.45 });
    target.arc(0, pivotY, radius * 0.58, -Math.PI / 2 - spread / 2 + 0.06, -Math.PI / 2 + spread / 2 - 0.06)
      .stroke({ color: secondary, width: 1, alpha: 0.3 });
    target.circle(0, pivotY, radius * 0.03).fill({ color: secondary, alpha: 0.8 });
  }

  /* 82: 卷曲礼带——采样螺旋 + 平行回声笔触。 */
  function sonnetDrawRibbonCurl(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var cx = radius * 0.15 * (seed % 2 === 0 ? 1 : -1);
    var start = foliaHash01(seed, 0, 449) * SONNET_TAU;
    var echoes = [0, 1];
    for (var ei = 0; ei < echoes.length; ei++) {
      var echo = echoes[ei];
      var offset = echo * radius * 0.035;
      target.moveTo(cx + Math.cos(start) * radius * 0.06, -radius * 0.1 + Math.sin(start) * radius * 0.06 + offset);
      var steps = 64;
      for (var i = 1; i <= steps; i += 1) {
        var t = i / steps;
        var angle = start + t * SONNET_TAU * 2.4;
        var r = radius * (0.06 + t * 0.42);
        target.lineTo(cx + Math.cos(angle) * r, -radius * 0.1 + Math.sin(angle) * r * 0.8 + offset);
      }
      target.stroke({ color: echo === 0 ? primary : secondary, width: echo === 0 ? 3 : 1, alpha: echo === 0 ? 0.55 : 0.3 });
    }
    /* 松散末端向上甩出。 */
    var endAngle = start + SONNET_TAU * 2.4;
    var ex = cx + Math.cos(endAngle) * radius * 0.48;
    var ey = -radius * 0.1 + Math.sin(endAngle) * radius * 0.38;
    target.moveTo(ex, ey).quadraticCurveTo(ex + radius * 0.1, ey - radius * 0.12, ex + radius * 0.16, ey - radius * 0.04)
      .stroke({ color: primary, width: 2, alpha: 0.5 });
  }

  /* 83: 三个重叠拼布三角 + 手工内条纹。 */
  function sonnetDrawPatchworkTrio(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var configs = [
      { x: -radius * 0.22, y: -radius * 0.05, s: radius * 0.3, up: true },
      { x: radius * 0.18, y: -radius * 0.12, s: radius * 0.24, up: false },
      { x: radius * 0.05, y: radius * 0.2, s: radius * 0.2, up: true }
    ];
    for (var index = 0; index < configs.length; index++) {
      var cfg = configs[index];
      var x = cfg.x, y = cfg.y, s = cfg.s, up = cfg.up;
      var topY = up ? y - s * 0.6 : y;
      var baseY = up ? y + s * 0.4 : y + s;
      target.moveTo(x, topY).lineTo(x + s * 0.55, baseY).lineTo(x - s * 0.55, baseY).lineTo(x, topY)
        .stroke({ color: index === 1 ? secondary : primary, width: 2, alpha: 0.55 });
      /* 内条纹在剪影内部算出——不需要 mask。 */
      for (var stripe = 1; stripe <= 3; stripe += 1) {
        var t = stripe / 4;
        var sy = topY + (baseY - topY) * t;
        var half = s * 0.55 * (up ? t : 1 - t);
        target.moveTo(x - half, sy).lineTo(x + half, sy)
          .stroke({ color: index === 1 ? primary : secondary, width: 1, alpha: 0.35 });
      }
    }
  }

  /* 84: 捕梦网——环 + 到偏心枢纽的径向网 + 垂挂羽毛。 */
  function sonnetDrawDreamcatcher(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var ringR = radius * 0.32;
    var cy = -radius * 0.12;
    target.circle(0, cy, ringR).stroke({ color: primary, width: 2, alpha: 0.6 });
    var hubX = radius * 0.05;
    var hubY = cy - radius * 0.03;
    for (var i = 0; i < 8; i += 1) {
      var angle = (i / 8) * SONNET_TAU + 0.2;
      var rimX = Math.cos(angle) * ringR * 0.92;
      var rimY = cy + Math.sin(angle) * ringR * 0.92;
      target.moveTo(rimX, rimY).lineTo(hubX, hubY)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: 1, alpha: 0.4 });
    }
    target.circle(hubX, hubY, radius * 0.035).stroke({ color: secondary, width: 1.5, alpha: 0.6 });
    /* 三条垂挂绳带羽枝；底部保持开放。 */
    for (var i = -1; i <= 1; i += 1) {
      var sx = i * ringR * 0.55;
      var topY = cy + Math.sqrt(Math.max(0, ringR * ringR - sx * sx));
      var len = radius * (0.22 + (1 - Math.abs(i)) * 0.12 + foliaHash01(seed, i + 1, 457) * 0.06);
      target.moveTo(sx, topY).lineTo(sx, topY + len).stroke({ color: primary, width: 1, alpha: 0.45 });
      var featherY = topY + len;
      target.moveTo(sx, featherY).lineTo(sx, featherY + radius * 0.12)
        .stroke({ color: secondary, width: 1.5, alpha: 0.55 });
      for (var barb = 1; barb <= 3; barb += 1) {
        var by = featherY + barb * radius * 0.03;
        var bl = radius * 0.04 * (1 - barb * 0.18);
        target.moveTo(sx, by).lineTo(sx - bl, by + radius * 0.02)
          .stroke({ color: secondary, width: 1, alpha: 0.4 });
        target.moveTo(sx, by).lineTo(sx + bl, by + radius * 0.02)
          .stroke({ color: secondary, width: 1, alpha: 0.4 });
      }
    }
  }

  /* 85: 流苏帘——错落垂线 + 短杆上的珠端。 */
  function sonnetDrawTasselDrop(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var barY = -radius * 0.4;
    target.moveTo(-radius * 0.3, barY).lineTo(radius * 0.3, barY)
      .stroke({ color: primary, width: 2, alpha: 0.4 });
    var threads = 7;
    for (var i = 0; i < threads; i += 1) {
      var x = -radius * 0.27 + i * radius * 0.09;
      var len = radius * (0.3 + foliaHash01(seed, i, 461) * 0.35);
      var sway = (foliaHash01(seed, i, 463) - 0.5) * radius * 0.08;
      target.moveTo(x, barY)
        .quadraticCurveTo(x + sway, barY + len * 0.6, x + sway * 0.6, barY + len)
        .stroke({ color: i % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.45 });
      target.circle(x + sway * 0.6, barY + len + 3, 2.5)
        .fill({ color: i % 3 === 0 ? secondary : primary, alpha: 0.6 });
    }
  }

  var SONNET_CRAFT_DRAWERS = [
    sonnetDrawOrigamiCrane, sonnetDrawPaperPlaneTrail, sonnetDrawWeaveBand, sonnetDrawKnotLoop, sonnetDrawStitchSampler,
    sonnetDrawFoldedFan, sonnetDrawRibbonCurl, sonnetDrawPatchworkTrio, sonnetDrawDreamcatcher, sonnetDrawTasselDrop
  ];

  /* ---- kinetic 十四种（geo 86–99） ---- */

  var SONNET_KINETIC_GEO_VARIANTS = [
    'pendulum-wave', 'domino-arc', 'gear-cluster', 'circuit-delta', 'signal-tower',
    'spiral-stair', 'waterfall-lines', 'pinwheel', 'ripple-drop', 'suspension-bridge',
    'field-lines', 'prism-beam', 'echo-arcs', 'kite-string'
  ];

  /* 86: 摆波——沿弧错相的绳与摆锤。 */
  function sonnetDrawPendulumWave(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var pivotY = -radius * 0.42;
    var bobs = 9;
    for (var i = 0; i < bobs; i += 1) {
      var x = -radius * 0.5 + (i / (bobs - 1)) * radius;
      var len = radius * (0.4 + i * 0.035);
      var swing = Math.sin(i * 0.9 + seed * 0.07) * 0.35;
      var bx = x + Math.sin(swing) * len;
      var by = pivotY + Math.cos(swing) * len;
      target.moveTo(x, pivotY).lineTo(bx, by)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
      target.circle(bx, by, 3.5 + (i % 3))
        .fill({ color: i % 2 === 0 ? secondary : primary, alpha: 0.7 });
    }
    target.moveTo(-radius * 0.58, pivotY).lineTo(radius * 0.58, pivotY)
      .stroke({ color: primary, width: 2, alpha: 0.35 });
  }

  /* 87: 多米诺沿弧倾倒，每块多转一级。 */
  function sonnetDrawDominoArc(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var count = 10;
    var arcR = radius * 0.55;
    for (var i = 0; i < count; i += 1) {
      var angle = Math.PI * 1.15 + (i / (count - 1)) * Math.PI * 0.7;
      var bx = Math.cos(angle) * arcR;
      var by = Math.sin(angle) * arcR + radius * 0.5;
      var tilt = (i / (count - 1)) * 1.1 * (seed % 2 === 0 ? 1 : -1);
      var w = radius * 0.035;
      var h = radius * 0.14;
      var cos = Math.cos(tilt);
      var sin = Math.sin(tilt);
      var corner = function (cx, cy) {
        return [bx + cx * cos - cy * sin, by + cx * sin + cy * cos];
      };
      var c1 = corner(-w, 0);
      var c2 = corner(w, 0);
      var c3 = corner(w, -h * 2);
      var c4 = corner(-w, -h * 2);
      target.moveTo(c1[0], c1[1]).lineTo(c2[0], c2[1]).lineTo(c3[0], c3[1]).lineTo(c4[0], c4[1]).lineTo(c1[0], c1[1])
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: 1.5, alpha: 0.55 });
    }
  }

  /* 88: 三个啮合齿轮，由环与径向齿构成。 */
  function sonnetDrawGearCluster(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var gears = [
      { x: 0, y: 0, r: radius * 0.26, teeth: 10 },
      { x: radius * 0.42, y: -radius * 0.2, r: radius * 0.16, teeth: 8 },
      { x: -radius * 0.4, y: radius * 0.22, r: radius * 0.13, teeth: 7 }
    ];
    for (var gi = 0; gi < gears.length; gi++) {
      var gear = gears[gi];
      var color = gi === 1 ? secondary : primary;
      target.circle(gear.x, gear.y, gear.r).stroke({ color: color, width: 2, alpha: 0.55 });
      target.circle(gear.x, gear.y, gear.r * 0.3).stroke({ color: color, width: 1.5, alpha: 0.45 });
      var offset = foliaHash01(seed, gi, 467) * SONNET_TAU;
      for (var t = 0; t < gear.teeth; t += 1) {
        var angle = offset + (t / gear.teeth) * SONNET_TAU;
        target.moveTo(gear.x + Math.cos(angle) * gear.r, gear.y + Math.sin(angle) * gear.r)
          .lineTo(gear.x + Math.cos(angle) * gear.r * 1.18, gear.y + Math.sin(angle) * gear.r * 1.18)
          .stroke({ color: color, width: 3, alpha: 0.5 });
      }
    }
  }

  /* 89: 45 度折转的电路走线 + 节点焊盘，没有板框。 */
  function sonnetDrawCircuitDelta(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var lanes = 4;
    for (var lane = 0; lane < lanes; lane += 1) {
      var y = -radius * 0.36 + lane * radius * 0.24;
      var bendX = -radius * 0.3 + foliaHash01(seed, lane, 479) * radius * 0.6;
      var drop = (lane % 2 === 0 ? 1 : -1) * radius * 0.08;
      target.moveTo(-bleed.x, y)
        .lineTo(bendX - Math.abs(drop), y)
        .lineTo(bendX, y + drop)
        .lineTo(bleed.x, y + drop)
        .stroke({ color: lane === 1 ? secondary : primary, width: 1.5, alpha: 0.45 });
      target.circle(bendX, y + drop, 3).fill({ color: secondary, alpha: 0.7 });
      target.circle(-bleed.x * 0.55, y, 2.5).stroke({ color: primary, width: 1, alpha: 0.5 });
    }
  }

  /* 90: 信号塔桅 + 两侧辐射波弧。 */
  function sonnetDrawSignalTower(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var baseY = radius * 0.45;
    var topY = -radius * 0.3;
    target.moveTo(-radius * 0.12, baseY).lineTo(0, topY).lineTo(radius * 0.12, baseY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    for (var brace = 1; brace <= 3; brace += 1) {
      var y = baseY - (baseY - topY) * (brace / 4);
      var half = radius * 0.12 * (1 - brace / 4.5);
      target.moveTo(-half, y).lineTo(half, y - radius * 0.06)
        .stroke({ color: primary, width: 1, alpha: 0.4 });
    }
    target.circle(0, topY, radius * 0.03).fill({ color: secondary, alpha: 0.9 });
    for (var side = -1; side <= 1; side += 2) {
      for (var ring = 0; ring < 3; ring += 1) {
        var r = radius * (0.12 + ring * 0.13);
        target.arc(0, topY, r, side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, side < 0 ? Math.PI * 1.25 : Math.PI * 0.25)
          .stroke({ color: ring === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - ring * 0.1 });
      }
    }
  }

  /* 91: 螺旋梯上升为错相的踏步/竖板折线。 */
  function sonnetDrawSpiralStair(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var steps = 12;
    var startAngle = foliaHash01(seed, 0, 487) * SONNET_TAU;
    for (var i = 0; i < steps; i += 1) {
      var angle = startAngle + i * 0.42;
      var r = radius * (0.14 + i * 0.04);
      var x = Math.cos(angle) * r;
      var y = radius * 0.4 - i * radius * 0.055;
      var tread = radius * 0.09;
      target.moveTo(x, y)
        .lineTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4)
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: 2, alpha: 0.55 });
      target.moveTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4)
        .lineTo(x + Math.cos(angle) * tread, y + Math.sin(angle) * tread * 0.4 - radius * 0.055)
        .stroke({ color: primary, width: 1, alpha: 0.35 });
    }
    /* 中央脊柱，顶部开放。 */
    target.moveTo(0, radius * 0.45).lineTo(0, -radius * 0.35)
      .stroke({ color: primary, width: 2, alpha: 0.3 });
  }

  /* 92: 下落的错长竖直水流 + 下方溅弧。 */
  function sonnetDrawWaterfallLines(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var streams = 9;
    for (var i = 0; i < streams; i += 1) {
      var x = -radius * 0.5 + (i / (streams - 1)) * radius + (foliaHash01(seed, i, 491) - 0.5) * radius * 0.05;
      var topY = -radius * 0.6 + foliaHash01(seed, i, 499) * radius * 0.15;
      var len = radius * (0.55 + foliaHash01(seed, i, 503) * 0.35);
      target.moveTo(x, topY).lineTo(x, topY + len)
        .stroke({ color: i % 3 === 0 ? secondary : primary, width: i % 3 === 0 ? 2 : 1, alpha: 0.4 + (i % 3) * 0.08 });
    }
    for (var i = 0; i < 5; i += 1) {
      var x = -radius * 0.4 + i * radius * 0.2;
      target.arc(x, radius * 0.5, radius * 0.07, Math.PI, SONNET_TAU)
        .stroke({ color: secondary, width: 1, alpha: 0.4 });
    }
  }

  /* 93: 四叶风车，弯帆绕毂。 */
  function sonnetDrawPinwheel(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var hubR = radius * 0.05;
    for (var blade = 0; blade < 4; blade += 1) {
      var angle = (blade / 4) * SONNET_TAU + foliaHash01(seed, 0, 509) * 0.5;
      var tipR = radius * 0.5;
      var tx = Math.cos(angle) * tipR;
      var ty = Math.sin(angle) * tipR;
      var edgeAngle = angle + 0.7;
      target.moveTo(Math.cos(angle) * hubR, Math.sin(angle) * hubR)
        .quadraticCurveTo(
          Math.cos(edgeAngle) * tipR * 0.55, Math.sin(edgeAngle) * tipR * 0.55,
          tx, ty
        )
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 2, alpha: 0.55 });
      target.moveTo(tx, ty)
        .lineTo(Math.cos(angle + 0.45) * tipR * 0.62, Math.sin(angle + 0.45) * tipR * 0.62)
        .stroke({ color: blade % 2 === 0 ? primary : secondary, width: 1.5, alpha: 0.4 });
    }
    target.circle(0, 0, hubR).fill({ color: secondary, alpha: 0.8 });
    target.circle(0, 0, radius * 0.56).stroke({ color: primary, width: 1, alpha: 0.15 });
  }

  /* 94: 落滴上方 + 断口涟漪弧——什么都不碰边。 */
  function sonnetDrawRippleDrop(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var dx = (foliaHash01(seed, 0, 521) - 0.5) * radius * 0.2;
    /* 泪滴。 */
    target.moveTo(dx, -radius * 0.52);
    target.bezierCurveTo(dx + radius * 0.07, -radius * 0.36, dx + radius * 0.06, -radius * 0.3, dx, -radius * 0.27);
    target.bezierCurveTo(dx - radius * 0.06, -radius * 0.3, dx - radius * 0.07, -radius * 0.36, dx, -radius * 0.52);
    target.stroke({ color: secondary, width: 2, alpha: 0.65 });
    /* 断口涟漪：交替位置留隙的弧段。 */
    for (var ring = 0; ring < 4; ring += 1) {
      var r = radius * (0.14 + ring * 0.13);
      var y = radius * 0.25;
      var gapAt = foliaHash01(seed, ring, 523) * SONNET_TAU;
      target.arc(dx, y, r, gapAt, gapAt + SONNET_TAU * 0.72)
        .stroke({ color: ring % 2 === 0 ? primary : secondary, width: ring === 0 ? 2 : 1, alpha: 0.5 - ring * 0.09 });
    }
    /* 撞击皇冠。 */
    target.moveTo(dx - radius * 0.05, radius * 0.2).lineTo(dx - radius * 0.02, radius * 0.12)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
    target.moveTo(dx + radius * 0.05, radius * 0.2).lineTo(dx + radius * 0.02, radius * 0.12)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
  }

  /* 95: 悬索桥——下垂主缆 + 双塔 + 开放桥面线。 */
  function sonnetDrawSuspensionBridge(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var deckY = radius * 0.3;
    var towerX = radius * 0.34;
    var towerTop = -radius * 0.28;
    target.moveTo(-bleed.x, deckY).lineTo(bleed.x, deckY)
      .stroke({ color: primary, width: 2, alpha: 0.5 });
    var sides = [-1, 1];
    for (var si = 0; si < sides.length; si++) {
      var side = sides[si];
      var x = side * towerX;
      target.moveTo(x - radius * 0.03, deckY).lineTo(x - radius * 0.03, towerTop)
        .stroke({ color: primary, width: 2, alpha: 0.55 });
      target.moveTo(x + radius * 0.03, deckY).lineTo(x + radius * 0.03, towerTop)
        .stroke({ color: primary, width: 2, alpha: 0.55 });
      target.moveTo(x - radius * 0.04, towerTop + radius * 0.08).lineTo(x + radius * 0.04, towerTop + radius * 0.08)
        .stroke({ color: secondary, width: 1.5, alpha: 0.45 });
    }
    /* 主缆：三段二次曲线，两端冲出画布。 */
    target.moveTo(-bleed.x, deckY - radius * 0.1)
      .quadraticCurveTo(-towerX, towerTop - radius * 0.06, -towerX, towerTop)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
    target.moveTo(-towerX, towerTop)
      .quadraticCurveTo(0, deckY - radius * 0.04, towerX, towerTop)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
    target.moveTo(towerX, towerTop)
      .quadraticCurveTo(bleed.x, deckY - radius * 0.1, bleed.x, deckY - radius * 0.06)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
    /* 中跨吊索。 */
    for (var i = 1; i < 7; i += 1) {
      var t = i / 7;
      var hx = -towerX + t * towerX * 2;
      var cableY = (1 - t) * (1 - t) * towerTop + 2 * (1 - t) * t * (deckY - radius * 0.04) + t * t * towerTop;
      target.moveTo(hx, cableY).lineTo(hx, deckY)
        .stroke({ color: primary, width: 1, alpha: 0.35 });
    }
  }

  /* 96: 磁力线环穿过双极，上下镜像。 */
  function sonnetDrawFieldLines(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var poleGap = radius * 0.2;
    for (var loop = 0; loop < 4; loop += 1) {
      var bulge = radius * (0.2 + loop * 0.16);
      var mirrors = [-1, 1];
      for (var mi = 0; mi < mirrors.length; mi++) {
        var mirror = mirrors[mi];
        target.moveTo(0, -poleGap);
        target.bezierCurveTo(
          mirror * bulge, -poleGap - radius * 0.1,
          mirror * bulge, poleGap + radius * 0.1,
          0, poleGap
        );
        target.stroke({ color: loop % 2 === 0 ? primary : secondary, width: loop === 0 ? 2 : 1, alpha: 0.5 - loop * 0.08 });
      }
    }
    target.circle(0, -poleGap, radius * 0.04).fill({ color: secondary, alpha: 0.85 });
    target.circle(0, poleGap, radius * 0.04).fill({ color: primary, alpha: 0.85 });
    target.moveTo(-radius * 0.1, -poleGap).lineTo(radius * 0.1, -poleGap)
      .stroke({ color: secondary, width: 1.5, alpha: 0.5 });
    target.moveTo(-radius * 0.1, poleGap).lineTo(radius * 0.1, poleGap)
      .stroke({ color: primary, width: 1.5, alpha: 0.5 });
  }

  /* 97: 棱镜把一束入射光分成扇形光谱。 */
  function sonnetDrawPrismBeam(o) {
    var target = o.target, radius = o.radius, width = o.width, height = o.height, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var bleed = sonnetResolveShotMgBleed(width, height, radius);
    var s = radius * 0.24;
    var topY = -s * 0.7;
    var baseY = s * 0.55;
    target.moveTo(0, topY).lineTo(s * 0.8, baseY).lineTo(-s * 0.8, baseY).lineTo(0, topY)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    target.moveTo(0, topY).lineTo(s * 0.8, baseY).lineTo(-s * 0.8, baseY).lineTo(0, topY)
      .fill({ color: primary, alpha: 0.06 });
    /* 从左边缘入射的光束。 */
    var entryX = -s * 0.35;
    var entryY = s * 0.05;
    target.moveTo(-bleed.x, entryY + radius * 0.12).lineTo(entryX, entryY)
      .stroke({ color: secondary, width: 2.5, alpha: 0.6 });
    /* 出射扇形射向右边缘。 */
    for (var ray = 0; ray < 4; ray += 1) {
      var exitY = -radius * 0.1 + ray * radius * 0.09;
      target.moveTo(s * 0.4, entryY - radius * 0.05)
        .lineTo(bleed.x, exitY)
        .stroke({ color: ray === 1 ? secondary : primary, width: 1.5, alpha: 0.45 - ray * 0.05 });
    }
  }

  /* 98: 回声弧在两堵看不见的墙之间反弹，每次跳偏移。 */
  function sonnetDrawEchoArcs(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    for (var hop = 0; hop < 5; hop += 1) {
      var side = hop % 2 === 0 ? -1 : 1;
      var cx = side * radius * 0.52;
      var cy = -radius * 0.35 + hop * radius * 0.18;
      var r = radius * (0.14 + hop * 0.045);
      target.arc(cx, cy, r, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5)
        .stroke({ color: hop % 2 === 0 ? primary : secondary, width: 2 - hop * 0.2, alpha: 0.55 - hop * 0.07 });
      target.circle(cx + (side < 0 ? r : -r) * 0.4, cy + r * 0.6, 1.8)
        .fill({ color: secondary, alpha: 0.5 });
    }
  }

  /* 99: 菱形风筝 + 交叉骨架 + 尾结与长自由线。 */
  function sonnetDrawKiteString(o) {
    var target = o.target, radius = o.radius, seed = o.seed, primary = o.primary, secondary = o.secondary;
    var kx = radius * 0.22 * (seed % 2 === 0 ? 1 : -1);
    var ky = -radius * 0.3;
    var kw = radius * 0.16;
    var kh = radius * 0.22;
    target.moveTo(kx, ky - kh).lineTo(kx + kw, ky).lineTo(kx, ky + kh).lineTo(kx - kw, ky).lineTo(kx, ky - kh)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    target.moveTo(kx, ky - kh).lineTo(kx, ky + kh).stroke({ color: secondary, width: 1, alpha: 0.4 });
    target.moveTo(kx - kw, ky).lineTo(kx + kw, ky).stroke({ color: secondary, width: 1, alpha: 0.4 });
    target.moveTo(kx, ky - kh).lineTo(kx + kw, ky).lineTo(kx, ky + kh).lineTo(kx - kw, ky).lineTo(kx, ky - kh)
      .fill({ color: primary, alpha: 0.06 });
    /* 带采样下垂的线；尾结是独立命令，让线保持一条连续笔触（整段一起生长）。 */
    var bows = [];
    target.moveTo(kx, ky + kh);
    var stringSteps = 24;
    for (var i = 1; i <= stringSteps; i += 1) {
      var t = i / stringSteps;
      var x = kx - t * radius * 0.5 + Math.sin(t * Math.PI * 2.2) * radius * 0.08;
      var y = ky + kh + t * radius * 0.6;
      target.lineTo(x, y);
      if (i === 7 || i === 13 || i === 19) bows.push({ x: x, y: y });
    }
    target.stroke({ color: primary, width: 1.5, alpha: 0.5 });
    for (var bi = 0; bi < bows.length; bi++) {
      var bowS = radius * 0.035;
      target.moveTo(bows[bi].x, bows[bi].y).lineTo(bows[bi].x - bowS, bows[bi].y - bowS).lineTo(bows[bi].x, bows[bi].y - bowS * 0.3).lineTo(bows[bi].x + bowS, bows[bi].y - bowS)
        .lineTo(bows[bi].x, bows[bi].y)
        .stroke({ color: secondary, width: 1, alpha: 0.55 });
    }
  }

  var SONNET_KINETIC_DRAWERS = [
    sonnetDrawPendulumWave, sonnetDrawDominoArc, sonnetDrawGearCluster, sonnetDrawCircuitDelta, sonnetDrawSignalTower,
    sonnetDrawSpiralStair, sonnetDrawWaterfallLines, sonnetDrawPinwheel, sonnetDrawRippleDrop, sonnetDrawSuspensionBridge,
    sonnetDrawFieldLines, sonnetDrawPrismBeam, sonnetDrawEchoArcs, sonnetDrawKiteString
  ];

  /* ---- extended 派发（48–99） ---- */

  var SONNET_EXTENDED_GEO_VARIANTS = SONNET_CELESTIAL_GEO_VARIANTS
    .concat(SONNET_MARINE_GEO_VARIANTS)
    .concat(SONNET_MUSIC_GEO_VARIANTS)
    .concat(SONNET_CRAFT_GEO_VARIANTS)
    .concat(SONNET_KINETIC_GEO_VARIANTS);

  var SONNET_EXTENDED_DRAWERS = SONNET_CELESTIAL_DRAWERS
    .concat(SONNET_MARINE_DRAWERS)
    .concat(SONNET_MUSIC_DRAWERS)
    .concat(SONNET_CRAFT_DRAWERS)
    .concat(SONNET_KINETIC_DRAWERS);

  function sonnetDrawExtendedShotMg(o) {
    var index = o.variant - SONNET_EXTENDED_GEO_VARIANT_START;
    var drawer = SONNET_EXTENDED_DRAWERS[index];
    if (!drawer) return false;
    drawer(o);
    return true;
  }

  /* ============================== 10. 背景 HUD 8 变体 ============================== */
  /* sonnetBackgroundMgVariants.ts：seed 驱动的 HUD 框构图，画在 bg 层。
   * 每个变体用同一套边距，保证镜头之间可互换；只有家具（十字、括号、标尺、
   * 弧、点）在变。 */

  var SONNET_BACKGROUND_MG_VARIANT_COUNT = 8;

  var SONNET_BACKGROUND_MG_VARIANTS = [
    'classic-cross', 'corner-brackets', 'marquee-strips', 'diagonal-corners',
    'dotted-columns', 'double-frame', 'ruler-frame', 'arc-gauge'
  ];

  function sonnetResolveBackgroundMgVariant(seed) {
    return foliaMixSeed(seed, 0x9e3779b9) % SONNET_BACKGROUND_MG_VARIANT_COUNT;
  }

  function sonnetWithFrame(o) {
    return {
      target: o.target,
      variant: o.variant,
      width: o.width,
      height: o.height,
      seed: o.seed,
      primary: o.primary,
      secondary: o.secondary,
      hw: o.width / 2,
      hh: o.height / 2,
      marginX: o.width * 0.05,
      marginY: o.height * 0.05
    };
  }

  /* 多个变体共用的铆钉/节点小 X 标记。 */
  function sonnetDrawCross(target, x, y, size, color, alpha) {
    if (alpha === undefined) alpha = 0.5;
    target.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color: color, width: 1, alpha: alpha });
    target.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color: color, width: 1, alpha: alpha });
  }

  /* 变体 0：原始 HUD——角十字、左侧十字列、底部进度条。 */
  function sonnetDrawClassicCross(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var size = 4;
    sonnetDrawCross(target, -hw + marginX, -hh + marginY, size, primary, 0.4);
    sonnetDrawCross(target, hw - marginX, -hh + marginY, size, primary, 0.4);
    sonnetDrawCross(target, -hw + marginX, hh - marginY, size, primary, 0.4);
    sonnetDrawCross(target, hw - marginX, hh - marginY, size, primary, 0.4);

    for (var i = 0; i < 8; i += 1) {
      sonnetDrawCross(target, -hw + marginX, -hh + marginY + i * 20 + 30, 3, primary, 0.3);
    }

    var barY = hh - marginY - 10;
    target.moveTo(-hw + marginX + 20, barY).lineTo(hw - marginX - 20, barY).stroke({ color: primary, width: 1, alpha: 0.3 });
    sonnetDrawCross(target, -hw + marginX + 10, barY, 3, primary, 0.5);
    sonnetDrawCross(target, -hw + marginX + 30, barY, 3, primary, 0.5);
    sonnetDrawCross(target, hw - marginX - 10, barY, 3, primary, 0.5);
    target.circle(0, barY, 2).fill({ color: secondary, alpha: 0.8 });
  }

  /* 变体 1：制图式角 L 括号 + 底部刻度尺。 */
  function sonnetDrawCornerBrackets(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary, seed = context.seed;
    var arm = Math.min(hw, hh) * 0.08;
    var inset = 6;
    var corners = [
      [-hw + marginX, -hh + marginY, 1, 1],
      [hw - marginX, -hh + marginY, -1, 1],
      [-hw + marginX, hh - marginY, 1, -1],
      [hw - marginX, hh - marginY, -1, -1]
    ];
    for (var index = 0; index < corners.length; index++) {
      var cx = corners[index][0], cy = corners[index][1], sx = corners[index][2], sy = corners[index][3];
      target.moveTo(cx + sx * arm, cy)
        .lineTo(cx, cy)
        .lineTo(cx, cy + sy * arm)
        .stroke({ color: primary, width: 2, alpha: 0.55 });
      target.moveTo(cx + sx * (arm + inset), cy + sy * inset)
        .lineTo(cx + sx * inset, cy + sy * inset)
        .lineTo(cx + sx * inset, cy + sy * (arm + inset))
        .stroke({ color: primary, width: 1, alpha: 0.25 });
      if (index % 2 === 0) {
        target.rect(cx + sx * arm * 0.4 - 2, cy + sy * arm * 0.4 - 2, 4, 4)
          .fill({ color: secondary, alpha: 0.6 });
      }
    }

    /* 括号之间的底部刻度尺。 */
    var rulerY = hh - marginY + inset;
    target.moveTo(-hw + marginX + arm + 12, rulerY).lineTo(hw - marginX - arm - 12, rulerY)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    var ticks = 24;
    var span = (hw - marginX - arm - 12) * 2;
    for (var i = 0; i <= ticks; i += 1) {
      var x = -hw + marginX + arm + 12 + (span * i) / ticks;
      var long = i % 6 === 0;
      target.moveTo(x, rulerY).lineTo(x, rulerY - (long ? 8 : 4))
        .stroke({ color: long ? secondary : primary, width: 1, alpha: long ? 0.55 : 0.3 });
    }

    /* 侧边上按 seed 错开的定位点。 */
    for (var i = 0; i < 5; i += 1) {
      var y = -hh + marginY + arm + 14 + i * ((hh - marginY - arm - 14) * 2) / 5;
      target.circle(-hw + marginX - 4, y, 1.5).fill({ color: primary, alpha: 0.35 });
      target.circle(hw - marginX + 4, y + (seed % 7), 1.5).fill({ color: primary, alpha: 0.35 });
    }
  }

  /* 变体 2：上下 marquee 条 + 垂挂刻度 + 端块。 */
  function sonnetDrawMarqueeStrips(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var left = -hw + marginX;
    var right = hw - marginX;
    var directions = [-1, 1];
    for (var di = 0; di < directions.length; di++) {
      var direction = directions[di];
      var stripY = hh - marginY;
      var y = direction * stripY;
      target.moveTo(left, y).lineTo(right, y).stroke({ color: primary, width: 2, alpha: 0.45 });
      target.moveTo(left, y + direction * 6).lineTo(right, y + direction * 6)
        .stroke({ color: primary, width: 1, alpha: 0.2 });
      /* 端帽块。 */
      target.rect(left, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 });
      target.rect(right - 14, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 });
      /* 两条轨之间的垂挂刻度。 */
      var ticks = 18;
      for (var i = 1; i < ticks; i += 1) {
        var x = left + ((right - left) * i) / ticks;
        if (i % 3 === 0) {
          target.moveTo(x, y).lineTo(x, y + direction * 6)
            .stroke({ color: primary, width: 1, alpha: 0.35 });
        }
      }
    }
    sonnetDrawCross(target, 0, -hh + marginY, 4, primary, 0.5);
    target.moveTo(-6, hh - marginY - 14).lineTo(0, hh - marginY - 8).lineTo(6, hh - marginY - 14)
      .stroke({ color: secondary, width: 1, alpha: 0.6 });
  }

  /* 变体 3：描边角三角 + 平行斜线。 */
  function sonnetDrawDiagonalCorners(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var corner = Math.min(hw, hh) * 0.12;
    var corners = [
      [-hw + marginX, -hh + marginY, 1, 1],
      [hw - marginX, -hh + marginY, -1, 1],
      [-hw + marginX, hh - marginY, 1, -1],
      [hw - marginX, hh - marginY, -1, -1]
    ];
    for (var index = 0; index < corners.length; index++) {
      var cx = corners[index][0], cy = corners[index][1], sx = corners[index][2], sy = corners[index][3];
      target.moveTo(cx + sx * corner, cy)
        .lineTo(cx, cy)
        .lineTo(cx, cy + sy * corner)
        .lineTo(cx + sx * corner, cy)
        .stroke({ color: primary, width: 1.5, alpha: 0.5 });
      /* 内侧平行斜线对。 */
      target.moveTo(cx + sx * corner * 0.55, cy).lineTo(cx, cy + sy * corner * 0.55)
        .stroke({ color: index % 2 === 0 ? secondary : primary, width: 1, alpha: 0.4 });
      target.moveTo(cx + sx * corner * 0.3, cy).lineTo(cx, cy + sy * corner * 0.3)
        .stroke({ color: primary, width: 1, alpha: 0.25 });
    }

    /* 带交替菱形标记的基线。 */
    var barY = hh - marginY - 12;
    target.moveTo(-hw + marginX + corner + 10, barY).lineTo(hw - marginX - corner - 10, barY)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    for (var i = 0; i < 5; i += 1) {
      var x = -hw + marginX + corner + 30 + i * 26;
      var s = i === 2 ? 5 : 3;
      target.moveTo(x, barY - s).lineTo(x + s, barY).lineTo(x, barY + s).lineTo(x - s, barY)
        .lineTo(x, barY - s)
        .stroke({ color: i === 2 ? secondary : primary, width: 1, alpha: 0.55 });
    }
  }

  /* 变体 4：点阵侧列 + 中心十字 + 基线。 */
  function sonnetDrawDottedColumns(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var rows = 14;
    for (var i = 0; i < rows; i += 1) {
      var y = -hh + marginY + 10 + i * ((hh - marginY - 10) * 2) / (rows - 1);
      var strong = i % 4 === 0;
      target.circle(-hw + marginX, y, strong ? 2.4 : 1.4)
        .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 });
      target.circle(hw - marginX, y, strong ? 2.4 : 1.4)
        .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 });
    }
    /* 中心定位十字保持低调，坐在文字后面。 */
    target.moveTo(-18, 0).lineTo(18, 0).stroke({ color: primary, width: 1, alpha: 0.22 });
    target.moveTo(0, -18).lineTo(0, 18).stroke({ color: primary, width: 1, alpha: 0.22 });
    target.circle(0, 0, 6).stroke({ color: primary, width: 1, alpha: 0.3 });

    var barY = hh - marginY - 8;
    target.moveTo(-hw + marginX + 16, barY).lineTo(hw - marginX - 16, barY)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    sonnetDrawCross(target, -hw + marginX + 8, barY, 3, primary, 0.5);
    sonnetDrawCross(target, hw - marginX - 8, barY, 3, primary, 0.5);
  }

  /* 变体 5：内嵌双框，中段留隙 + 填充角块。 */
  function sonnetDrawDoubleFrame(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var left = -hw + marginX;
    var right = hw - marginX;
    var top = -hh + marginY;
    var bottom = hh - marginY;
    var gapX = (right - left) * 0.18;
    var gapY = (bottom - top) * 0.22;
    var cx = (left + right) / 2;
    var cy = (top + bottom) / 2;

    /* 外框在每条边中断开。 */
    target.moveTo(left, top).lineTo(cx - gapX / 2, top).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(cx + gapX / 2, top).lineTo(right, top).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, bottom).lineTo(cx - gapX / 2, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(cx + gapX / 2, bottom).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, top).lineTo(left, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, cy + gapY / 2).lineTo(left, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(right, top).lineTo(right, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(right, cy + gapY / 2).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });

    /* 内回声框（连续、更细）。 */
    var inset = 7;
    target.rect(left + inset, top + inset, right - left - inset * 2, bottom - top - inset * 2)
      .stroke({ color: primary, width: 1, alpha: 0.18 });

    /* 填充角块 + 间隙处的小缺口刻度。 */
    var cornerPairs = [[left, top], [right, top], [left, bottom], [right, bottom]];
    for (var index = 0; index < cornerPairs.length; index++) {
      target.rect(cornerPairs[index][0] - 3, cornerPairs[index][1] - 3, 6, 6)
        .fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 });
    }
    target.moveTo(cx - 5, top).lineTo(cx + 5, top).stroke({ color: secondary, width: 3, alpha: 0.5 });
    target.moveTo(cx - 5, bottom).lineTo(cx + 5, bottom).stroke({ color: secondary, width: 3, alpha: 0.5 });
  }

  /* 变体 6：四边测量刻度。 */
  function sonnetDrawRulerFrame(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary;
    var left = -hw + marginX;
    var right = hw - marginX;
    var top = -hh + marginY;
    var bottom = hh - marginY;
    var xTicks = 32;
    var yTicks = 18;
    for (var i = 0; i <= xTicks; i += 1) {
      var x = left + ((right - left) * i) / xTicks;
      var major = i % 8 === 0;
      var mid = i % 4 === 0;
      var len = major ? 12 : mid ? 7 : 4;
      var color = major ? secondary : primary;
      target.moveTo(x, top).lineTo(x, top + len).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 });
      target.moveTo(x, bottom).lineTo(x, bottom - len).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 });
    }
    for (var i = 0; i <= yTicks; i += 1) {
      var y = top + ((bottom - top) * i) / yTicks;
      var major = i % 6 === 0;
      var len = major ? 12 : i % 3 === 0 ? 7 : 4;
      var color = major ? secondary : primary;
      target.moveTo(left, y).lineTo(left + len, y).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 });
      target.moveTo(right, y).lineTo(right - len, y).stroke({ color: color, width: 1, alpha: major ? 0.55 : 0.32 });
    }
    /* 安静的中心环，锚定标尺系统。 */
    target.circle(0, 0, 10).stroke({ color: primary, width: 1, alpha: 0.25 });
    target.circle(0, 0, 3).fill({ color: secondary, alpha: 0.4 });
  }

  /* 变体 7：角四分之一弧 + 边节点 + 底部带指针的弧仪表。 */
  function sonnetDrawArcGauge(context) {
    var target = context.target, hw = context.hw, hh = context.hh, marginX = context.marginX, marginY = context.marginY,
      primary = context.primary, secondary = context.secondary, seed = context.seed;
    var arcR = Math.min(hw, hh) * 0.11;
    var corners = [
      [-hw + marginX, -hh + marginY, 0, Math.PI / 2],
      [hw - marginX, -hh + marginY, Math.PI / 2, Math.PI],
      [hw - marginX, hh - marginY, Math.PI, Math.PI * 1.5],
      [-hw + marginX, hh - marginY, Math.PI * 1.5, Math.PI * 2]
    ];
    for (var index = 0; index < corners.length; index++) {
      var cx = corners[index][0], cy = corners[index][1], start = corners[index][2], end = corners[index][3];
      target.arc(cx, cy, arcR, start, end).stroke({ color: primary, width: 2, alpha: 0.5 });
      target.arc(cx, cy, arcR * 0.72, start, end).stroke({ color: primary, width: 1, alpha: 0.25 });
      var mid = (start + end) / 2;
      target.circle(cx + Math.cos(mid) * arcR, cy + Math.sin(mid) * arcR, 2)
        .fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 });
    }

    /* 每边中点的边节点。 */
    target.circle(0, -hh + marginY, 2).fill({ color: primary, alpha: 0.45 });
    target.circle(-hw + marginX, 0, 2).fill({ color: primary, alpha: 0.45 });
    target.circle(hw - marginX, 0, 2).fill({ color: primary, alpha: 0.45 });

    /* 底部半圆仪表 + seed 固定的指针。 */
    var gaugeY = hh - marginY + arcR * 0.4;
    var gaugeR = Math.min(hw, hh) * 0.16;
    target.arc(0, gaugeY, gaugeR, Math.PI, Math.PI * 2).stroke({ color: primary, width: 1.5, alpha: 0.4 });
    for (var i = 0; i <= 8; i += 1) {
      var angle = Math.PI + (i / 8) * Math.PI;
      target.moveTo(Math.cos(angle) * (gaugeR - 5), gaugeY + Math.sin(angle) * (gaugeR - 5))
        .lineTo(Math.cos(angle) * gaugeR, gaugeY + Math.sin(angle) * gaugeR)
        .stroke({ color: i % 4 === 0 ? secondary : primary, width: 1, alpha: 0.45 });
    }
    var needle = Math.PI + (((seed % 100) / 100) * Math.PI);
    target.moveTo(0, gaugeY)
      .lineTo(Math.cos(needle) * (gaugeR - 8), gaugeY + Math.sin(needle) * (gaugeR - 8))
      .stroke({ color: secondary, width: 2, alpha: 0.6 });
    target.circle(0, gaugeY, 2.5).fill({ color: primary, alpha: 0.7 });
  }

  /* 派发 seed 选中的背景 HUD 变体；未知变体回落 classic。 */
  function sonnetDrawBackgroundMgHud(o) {
    var context = sonnetWithFrame(o);
    switch (o.variant % SONNET_BACKGROUND_MG_VARIANT_COUNT) {
      case 1:
        sonnetDrawCornerBrackets(context);
        return;
      case 2:
        sonnetDrawMarqueeStrips(context);
        return;
      case 3:
        sonnetDrawDiagonalCorners(context);
        return;
      case 4:
        sonnetDrawDottedColumns(context);
        return;
      case 5:
        sonnetDrawDoubleFrame(context);
        return;
      case 6:
        sonnetDrawRulerFrame(context);
        return;
      case 7:
        sonnetDrawArcGauge(context);
        return;
      default:
        sonnetDrawClassicCross(context);
    }
  }

  /* ============================== 11. fixedGeo 8 变体 ============================== */
  /* sonnetFixedGeoVariants.ts：seed 驱动的固定几何构图，画在 fixedGeo 层。
   * 固定几何反向对抗相机旋转，所以读起来像稳定的印刷块（实心填充 + 空心轮廓
   * + 阴影线），排在文字后面。 */

  var SONNET_FIXED_GEO_VARIANT_COUNT = 8;

  var SONNET_FIXED_GEO_VARIANTS = [
    'classic-blocks', 'twin-pillars', 'disc-ring', 'diamond-pair',
    'stripe-stack', 'corner-els', 'twin-wedges', 'cross-ring'
  ];

  function sonnetResolveFixedGeoVariant(seed) {
    return foliaMixSeed(seed, 0x85ebca6b) % SONNET_FIXED_GEO_VARIANT_COUNT;
  }

  /* 斜向阴影线片，由静态 rect mask 裁剪；阴影线录在 AnimatedGraphics 上，
   * 让它们按共享 stagger 日程生长。 */
  function sonnetDrawHatching(pixi, primary, x, y, w, h, spacing, target) {
    var hatch = sonnetCreateAnimatedGraphics(pixi);
    for (var i = -w; i < w + h; i += spacing) {
      hatch.moveTo(x + i, y).lineTo(x + i + h, y + h).stroke({ color: primary, width: 1, alpha: 0.15 });
    }

    var mask = new pixi.Graphics();
    mask.rect(x, y, w, h).fill({ color: 0xffffff });
    hatch.mask = mask;

    target.addChild(hatch.display);
    target.addChild(mask);
    return hatch;
  }

  /* 变体 0：原始实心块 + 空心框 + 阴影片三件套。 */
  function sonnetDrawClassicBlocks(context) {
    var geo = context.geo, r = context.radius, primary = context.primary;
    geo.rect(-r * 0.4, -r * 0.2, r * 0.6, r * 0.15).fill({ color: primary, alpha: 0.7 });
    geo.rect(-r * 0.1, r * 0.1, r * 0.5, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 });
    context.addHatch(-r * 0.3, -r * 0.4, r * 0.4, r * 0.25);
  }

  /* 变体 1：一根实心柱挨着更高的空心框，中间夹阴影条。 */
  function sonnetDrawTwinPillars(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent;
    geo.rect(-r * 0.34, -r * 0.28, r * 0.12, r * 0.56).fill({ color: accent, alpha: 0.65 });
    geo.rect(-r * 0.34 + r * 0.035, -r * 0.28 + r * 0.035, r * 0.05, r * 0.49)
      .fill({ color: primary, alpha: 0.35 });
    geo.rect(r * 0.06, -r * 0.34, r * 0.28, r * 0.68).stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.rect(r * 0.06 + r * 0.04, -r * 0.34 + r * 0.04, r * 0.2, r * 0.6)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    context.addHatch(-r * 0.14, -r * 0.2, r * 0.12, r * 0.4, 5);
  }

  /* 变体 2：实心盘配同心空心环 + 一段阴影弦。 */
  function sonnetDrawDiscRing(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent;
    geo.circle(-r * 0.2, r * 0.12, r * 0.15).fill({ color: accent, alpha: 0.7 });
    geo.circle(-r * 0.2, r * 0.12, r * 0.06).fill({ color: primary, alpha: 0.5 });
    geo.circle(r * 0.14, -r * 0.06, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.circle(r * 0.14, -r * 0.06, r * 0.22).stroke({ color: primary, width: 1, alpha: 0.3 });
    context.addHatch(r * 0.02, -r * 0.14, r * 0.24, r * 0.16, 5);
  }

  /* 变体 3：大空心菱形 + 小实心伴生菱形。 */
  function sonnetDrawDiamondPair(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent, seed = context.seed;
    var direction = seed % 2 === 0 ? 1 : -1;
    var dr = r * 0.3;
    var cx = -r * 0.08 * direction;
    geo.moveTo(cx, -dr).lineTo(cx + dr, 0).lineTo(cx, dr).lineTo(cx - dr, 0).lineTo(cx, -dr)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.moveTo(cx, -dr * 0.7).lineTo(cx + dr * 0.7, 0).lineTo(cx, dr * 0.7).lineTo(cx - dr * 0.7, 0)
      .lineTo(cx, -dr * 0.7)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    var sr = r * 0.11;
    var sx = r * 0.3 * direction;
    var sy = -r * 0.2;
    geo.moveTo(sx, sy - sr).lineTo(sx + sr, sy).lineTo(sx, sy + sr).lineTo(sx - sr, sy).lineTo(sx, sy - sr)
      .fill({ color: accent, alpha: 0.7 });
    context.addHatch(sx - sr * 0.8, r * 0.16, sr * 1.6, sr * 1.2, 4);
  }

  /* 变体 4：错落的水平条纹堆（实心 / 空心 / 细强调）。 */
  function sonnetDrawStripeStack(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent, seed = context.seed;
    var direction = seed % 2 === 0 ? 1 : -1;
    geo.rect(-r * 0.36 * direction - r * 0.2, -r * 0.26, r * 0.56, r * 0.09)
      .fill({ color: accent, alpha: 0.7 });
    geo.rect(-r * 0.28, -r * 0.06, r * 0.56, r * 0.16).stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.rect(-r * 0.2 * direction, r * 0.2, r * 0.4, r * 0.045).fill({ color: primary, alpha: 0.5 });
    context.addHatch(r * 0.26 * direction, -r * 0.3, r * 0.12, r * 0.6, 5);
  }

  /* 变体 5：对角线上两根粗角 L + 空心中心方。 */
  function sonnetDrawCornerEls(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent, seed = context.seed;
    var direction = seed % 2 === 0 ? 1 : -1;
    var arm = r * 0.24;
    var thick = r * 0.07;
    /* 左上 / 右下 L 对（direction 翻转时镜像）。 */
    var x1 = -r * 0.3 * direction;
    var y1 = -r * 0.24;
    geo.rect(x1 - (direction < 0 ? arm : 0), y1, arm, thick).fill({ color: accent, alpha: 0.7 });
    geo.rect(direction < 0 ? x1 - arm : x1, y1, thick, arm).fill({ color: accent, alpha: 0.7 });
    var x2 = r * 0.3 * direction;
    var y2 = r * 0.24;
    geo.rect(direction < 0 ? x2 : x2 - arm, y2 - thick, arm, thick).fill({ color: primary, alpha: 0.55 });
    geo.rect(direction < 0 ? x2 + arm - thick : x2 - thick, y2 - arm, thick, arm)
      .fill({ color: primary, alpha: 0.55 });
    geo.rect(-r * 0.13, -r * 0.13, r * 0.26, r * 0.26).stroke({ color: primary, width: 2, alpha: 0.6 });
    context.addHatch(-r * 0.09 * direction, r * 0.02, r * 0.16, r * 0.1, 4);
  }

  /* 变体 6：实心上楔对空心下楔。 */
  function sonnetDrawTwinWedges(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent, seed = context.seed;
    var direction = seed % 2 === 0 ? 1 : -1;
    var wx = -r * 0.14 * direction;
    geo.moveTo(wx, -r * 0.3).lineTo(wx + r * 0.24, r * 0.02).lineTo(wx - r * 0.24, r * 0.02)
      .lineTo(wx, -r * 0.3)
      .fill({ color: accent, alpha: 0.6 });
    var hx = r * 0.16 * direction;
    geo.moveTo(hx, r * 0.3).lineTo(hx + r * 0.24, -r * 0.02).lineTo(hx - r * 0.24, -r * 0.02)
      .lineTo(hx, r * 0.3)
      .stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.moveTo(hx, r * 0.2).lineTo(hx + r * 0.15, 0).lineTo(hx - r * 0.15, 0).lineTo(hx, r * 0.2)
      .stroke({ color: primary, width: 1, alpha: 0.3 });
    context.addHatch(-r * 0.3 * direction - r * 0.05, r * 0.1, r * 0.2, r * 0.18, 5);
  }

  /* 变体 7：空心环中央的实心十字 + 阴影方。 */
  function sonnetDrawCrossRing(context) {
    var geo = context.geo, r = context.radius, primary = context.primary, accent = context.accent, seed = context.seed;
    var cx = (seed % 3 - 1) * r * 0.08;
    var arm = r * 0.17;
    var thick = r * 0.075;
    geo.rect(cx - arm, -thick / 2, arm * 2, thick).fill({ color: accent, alpha: 0.7 });
    geo.rect(cx - thick / 2, -arm, thick, arm * 2).fill({ color: accent, alpha: 0.7 });
    geo.circle(cx, 0, r * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 });
    geo.circle(cx, 0, r * 0.36).stroke({ color: primary, width: 1, alpha: 0.25 });
    context.addHatch(cx + r * 0.18, r * 0.14, r * 0.16, r * 0.16, 4);
  }

  /* 把 seed 选中的固定几何构图建进 layer，并返回每个 AnimatedGraphics 部件，
   * 让镜头更新循环把它们一起养大。 */
  function sonnetBuildFixedGeo(options) {
    var geo = sonnetCreateAnimatedGraphics(options.pixi);
    var context = {
      pixi: options.pixi,
      layer: options.layer,
      variant: options.variant,
      radius: options.radius,
      seed: options.seed,
      primary: options.primary,
      secondary: options.secondary,
      geo: geo,
      parts: [geo],
      /* 交替强调色，让相同形状在不同镜头间仍有差别。 */
      accent: options.seed % 2 === 0 ? options.secondary : options.primary
    };
    context.addHatch = function (x, y, w, h, spacing) {
      if (spacing === undefined) spacing = 6;
      context.parts.push(sonnetDrawHatching(context.pixi, context.primary, x, y, w, h, spacing, context.layer));
    };
    options.layer.addChild(geo.display);

    switch (options.variant % SONNET_FIXED_GEO_VARIANT_COUNT) {
      case 1:
        sonnetDrawTwinPillars(context);
        break;
      case 2:
        sonnetDrawDiscRing(context);
        break;
      case 3:
        sonnetDrawDiamondPair(context);
        break;
      case 4:
        sonnetDrawStripeStack(context);
        break;
      case 5:
        sonnetDrawCornerEls(context);
        break;
      case 6:
        sonnetDrawTwinWedges(context);
        break;
      case 7:
        sonnetDrawCrossRing(context);
        break;
      default:
        sonnetDrawClassicBlocks(context);
    }
    return context.parts;
  }

  /* ============================== 12. backgroundDecor 6 变体 ============================== */
  /* sonnetBackgroundDecor.ts：seed 驱动的漂浮粒子装饰层。每个变体把一组形状调色板与
   * 一种空间编排配对，让连续镜头读起来是不同的装饰系统；主题图标精灵保持音频 reactive
   * 的入场，与变体无关。 */

  var SONNET_BACKGROUND_DECOR_VARIANT_COUNT = 6;

  var SONNET_BACKGROUND_DECOR_VARIANTS = [
    'scatter', 'orbit', 'edge-band', 'corner-clusters', 'constellation', 'twin-columns'
  ];

  function sonnetResolveBackgroundDecorVariant(seed) {
    return foliaMixSeed(seed, 0xc2b2ae35) % SONNET_BACKGROUND_DECOR_VARIANT_COUNT;
  }

  var SONNET_DECOR_SHAPE_PALETTES = [
    ['square', 'diamond', 'sparkle'],
    ['ring', 'hexagon', 'dot'],
    ['bar', 'plus', 'square'],
    ['triangle', 'diamond', 'plus'],
    ['dot', 'ring', 'sparkle'],
    ['chevron', 'bar', 'hexagon']
  ];

  /* 以 (0,0) 为中心画一个粒子字形；pSize 是名义半尺寸。 */
  function sonnetDrawDecorShape(g, shape, pSize, color, alpha) {
    switch (shape) {
      case 'diamond':
        g.moveTo(0, -pSize).lineTo(pSize, 0).lineTo(0, pSize).lineTo(-pSize, 0)
          .fill({ color: color, alpha: alpha * 0.85 });
        return;
      case 'sparkle':
        g.moveTo(0, -pSize * 1.5).quadraticCurveTo(0, 0, pSize * 1.5, 0)
          .quadraticCurveTo(0, 0, 0, pSize * 1.5)
          .quadraticCurveTo(0, 0, -pSize * 1.5, 0)
          .quadraticCurveTo(0, 0, 0, -pSize * 1.5)
          .fill({ color: color, alpha: alpha * 1.2 });
        return;
      case 'plus': {
        var arm = pSize * 0.34;
        g.rect(-pSize, -arm, pSize * 2, arm * 2).fill({ color: color, alpha: alpha * 0.9 });
        g.rect(-arm, -pSize, arm * 2, pSize * 2).fill({ color: color, alpha: alpha * 0.9 });
        return;
      }
      case 'ring':
        g.circle(0, 0, pSize).stroke({ color: color, width: Math.max(1, pSize * 0.22), alpha: alpha * 0.9 });
        return;
      case 'triangle':
        g.moveTo(0, -pSize).lineTo(pSize * 0.9, pSize * 0.7).lineTo(-pSize * 0.9, pSize * 0.7)
          .lineTo(0, -pSize)
          .fill({ color: color, alpha: alpha * 0.85 });
        return;
      case 'hexagon': {
        for (var j = 0; j <= 6; j += 1) {
          var angle = (j * Math.PI) / 3;
          var hx = Math.sin(angle) * pSize;
          var hy = -Math.cos(angle) * pSize;
          if (j === 0) g.moveTo(hx, hy);
          else g.lineTo(hx, hy);
        }
        g.stroke({ color: color, width: Math.max(1, pSize * 0.16), alpha: alpha });
        return;
      }
      case 'bar':
        g.rect(-pSize, -pSize * 0.18, pSize * 2, pSize * 0.36).fill({ color: color, alpha: alpha * 0.85 });
        return;
      case 'dot':
        g.circle(0, 0, pSize * 0.34).fill({ color: color, alpha: alpha });
        return;
      case 'chevron':
        g.moveTo(-pSize * 0.5, -pSize * 0.55).lineTo(pSize * 0.35, 0).lineTo(-pSize * 0.5, pSize * 0.55)
          .stroke({ color: color, width: Math.max(1.5, pSize * 0.2), alpha: alpha });
        return;
      default:
        g.rect(-pSize / 2, -pSize / 2, pSize, pSize).fill({ color: color, alpha: alpha });
    }
  }

  /* 解析第 index 个粒子在该编排下的位置/旋转。 */
  function sonnetResolveDecorPlacement(variant, index, count, seed, width, height) {
    var hw = width / 2;
    var hh = height / 2;
    var radius = Math.min(width, height);
    var jitter = function (salt, range) {
      return (foliaHash01(seed, index, salt) - 0.5) * range;
    };
    var baseRotation = foliaHash01(seed, index, 11) * Math.PI * 2;

    switch (variant) {
      case 1: {
        /* 两个同心轨道环；粒子沿环前进。 */
        var ring = index % 2;
        var ringRadius = radius * (0.36 + ring * 0.26);
        var angle = (index / count) * Math.PI * 4 + jitter(13, 0.35);
        return {
          x: Math.cos(angle) * ringRadius,
          y: Math.sin(angle) * ringRadius * 0.86,
          rotation: angle + Math.PI / 2
        };
      }
      case 2: {
        /* 上下交替的边缘带。 */
        var side = index % 2 === 0 ? -1 : 1;
        var t = (Math.floor(index / 2) + 0.5) / Math.max(1, Math.floor(count / 2));
        return {
          x: -hw + width * (0.06 + 0.88 * t) + jitter(17, width * 0.03),
          y: side * hh * 0.78 + jitter(19, height * 0.05),
          rotation: side < 0 ? 0 : Math.PI
        };
      }
      case 3: {
        /* 四角松散簇。 */
        var corner = index % 4;
        var sx = corner % 2 === 0 ? -1 : 1;
        var sy = corner < 2 ? -1 : 1;
        return {
          x: sx * hw * 0.68 + jitter(23, width * 0.12),
          y: sy * hh * 0.62 + jitter(29, height * 0.12),
          rotation: baseRotation
        };
      }
      case 4: {
        /* 抖动的星座网格。 */
        var cols = 6;
        var rows = 4;
        var col = index % cols;
        var row = Math.floor(index / cols) % rows;
        return {
          x: -hw * 0.8 + (col / (cols - 1)) * hw * 1.6 + jitter(31, width * 0.06),
          y: -hh * 0.72 + (row / (rows - 1)) * hh * 1.44 + jitter(37, height * 0.06),
          rotation: baseRotation
        };
      }
      case 5: {
        /* 左右镜像的竖列。 */
        var mside = index % 2 === 0 ? -1 : 1;
        var mt = (Math.floor(index / 2) + 0.5) / Math.max(1, Math.ceil(count / 2));
        return {
          x: mside * hw * 0.74 + jitter(41, width * 0.04),
          y: -hh * 0.8 + mt * hh * 1.6 + jitter(43, height * 0.05),
          rotation: mside < 0 ? Math.PI : 0
        };
      }
      default:
        /* 经典均匀散布（原始行为）。 */
        return {
          x: -hw + width * foliaHash01(seed, index, 47),
          y: -hh + height * foliaHash01(seed, index, 53),
          rotation: baseRotation
        };
    }
  }

  /* 构造漂浮装饰层：seed 选调色板 + 编排，主题图标精灵按图标日程插入槽位。 */
  function sonnetBuildBackgroundDecor(options) {
    var pixi = options.pixi;
    var kind = options.kind;
    var width = options.width;
    var height = options.height;
    var seed = options.seed;
    var primary = options.primary;
    var secondary = options.secondary;
    var iconTextures = options.iconTextures;
    var layer = new pixi.Container();
    var variant = sonnetResolveBackgroundDecorVariant(seed);
    var palette = SONNET_DECOR_SHAPE_PALETTES[variant];
    var particleCount = kind === 'type-impact' ? 24 : 12;
    var iconParticleIndices = sonnetBuildIconParticleIndices(iconTextures.length, particleCount, seed);
    var hasIcons = iconTextures.length > 0;
    var iconAnimations = [];

    for (var i = 0; i < particleCount; i += 1) {
      var pSize = 4 + (seed + i) % 12;
      var iconTextureIndex = iconParticleIndices[i];
      var node;

      if (hasIcons && iconTextureIndex !== null && iconTextureIndex !== undefined) {
        var texture = iconTextures[iconTextureIndex];
        if (texture) {
          var sprite = new pixi.Sprite(texture);
          sprite.anchor.set(0.5);
          sprite.width = pSize * 7;
          sprite.height = pSize * 7;
          var iconSeed = Math.abs(seed + i * 17);
          sprite.alpha = 0;
          iconAnimations.push({
            node: sprite,
            baseScale: sprite.scale.x,
            baseAlpha: 0.85,
            entryPhase: 0,
            preferredDuration: 0.62 + (iconSeed % 4) * 0.08,
            phase: (iconSeed % 31) * 0.2
          });
          node = sprite;
        } else {
          var fallback = new pixi.Graphics();
          fallback.rect(-pSize / 2, -pSize / 2, pSize, pSize).fill({ color: primary, alpha: 0.6 });
          node = fallback;
        }
      } else {
        var g = new pixi.Graphics();
        var shape = palette[(seed + i) % palette.length];
        var color = i % 2 === 0 ? primary : secondary;
        sonnetDrawDecorShape(g, shape, pSize, color, 0.55 + foliaHash01(seed, i, 59) * 0.3);
        node = g;
      }

      var placement = sonnetResolveDecorPlacement(variant, i, particleCount, seed, width, height);
      node.position.set(placement.x, placement.y);
      node.rotation = placement.rotation;
      layer.addChild(node);
    }

    return { layer: layer, iconAnimations: iconAnimations };
  }

  /* ============================== 13. icons ============================== */
  /* sonnetIcons.ts + sonnetIconTextures.ts。本项目 theme 恒无 lyricsIcons，
   * resolveSonnetIconNames 恒回落 ['Flower']；Lucide Flower 的 SVG markup 按
   * lucide-react@1.48.0 + react@19.3.0 的 renderToStaticMarkup 输出静态 vendored
   * （属性顺序、空元素序列化 <circle …></circle>、stroke-width 的浮点字符串均逐字节一致，
   *  探针实跑复刻，见 _debug-archive/2026-10-21-sonnet-icons-probe/）。 */

  var SONNET_ICON_STROKE_WIDTH = 3.5;
  var SONNET_ICON_BASE_SIZE = 192;
  var SONNET_ICON_SIZE_STEP = 32;

  /* Lucide Flower（lucide-react@1.48.0 dist/esm/icons/flower.mjs）的内联子元素。
   * React 会剥掉 key，只留 cx/cy/r 与 d；空 children 序列化成 <tag …></tag>。 */
  var SONNET_LUCIDE_FLOWER_CHILDREN =
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"></path>' +
    '<path d="M12 7.5V9"></path>' +
    '<path d="M7.5 12H9"></path>' +
    '<path d="M16.5 12H15"></path>' +
    '<path d="M12 16.5V15"></path>' +
    '<path d="m8 8 1.88 1.88"></path>' +
    '<path d="M14.12 9.88 16 8"></path>' +
    '<path d="m8 16 1.88-1.88"></path>' +
    '<path d="M14.12 14.12 16 16"></path>';

  /* 本项目只 vendored 了 Flower；未知名被丢弃（与 Folia 的 resolveLucideIconNames 同语义），
   * 空列表回落到 ['Flower']。 */
  function sonnetResolveIconNames(names) {
    var resolved = [];
    if (names && names.length) {
      for (var i = 0; i < names.length; i++) {
        var name = typeof names[i] === 'string' ? names[i].trim() : '';
        if (name.toLowerCase() === 'flower' && resolved.indexOf('Flower') < 0) {
          resolved.push('Flower');
        }
      }
    }
    return resolved.length > 0 ? resolved : ['Flower'];
  }

  /* 把图标粒子散布到整个场景，同时保证每个可用主题图标都被用上。 */
  function sonnetBuildIconParticleIndices(iconCount, particleCount, seed) {
    var safeIconCount = Math.max(0, Math.floor(iconCount));
    var safeParticleCount = Math.max(0, Math.floor(particleCount));
    if (safeIconCount === 0) {
      var none = [];
      for (var n = 0; n < safeParticleCount; n += 1) none.push(null);
      return none;
    }

    var iconParticleCount = Math.min(
      safeParticleCount,
      Math.max(Math.ceil(safeParticleCount / 4), safeIconCount)
    );
    var emittedIconCount = 0;
    var indices = [];
    for (var index = 0; index < safeParticleCount; index += 1) {
      var previousBand = Math.floor(index * iconParticleCount / safeParticleCount);
      var currentBand = Math.floor((index + 1) * iconParticleCount / safeParticleCount);
      if (currentBand === previousBand) {
        indices.push(null);
        continue;
      }

      var iconIndex = ((seed + emittedIconCount) % safeIconCount + safeIconCount) % safeIconCount;
      emittedIconCount += 1;
      indices.push(iconIndex);
    }
    return indices;
  }

  /* 把图标入场分散到镜头的大部分，给最终揭示留时间。 */
  function sonnetResolveIconEntryPhase(index, iconCount) {
    var safeCount = Math.max(0, Math.floor(iconCount));
    if (safeCount <= 1) return 0.12;
    var safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)));
    return 0.04 + (safeIndex / (safeCount - 1)) * 0.82;
  }

  function sonnetResolveIconEntryDuration(sceneDuration, preferredDuration) {
    var safeSceneDuration = Math.max(0.01, sceneDuration);
    return Math.min(
      Math.max(0.01, preferredDuration),
      Math.max(0.08, safeSceneDuration * 0.18),
      safeSceneDuration
    );
  }

  function sonnetResolveIconEntryDelay(entryPhase, sceneDuration, entryDuration) {
    return Math.min(1, Math.max(0, entryPhase)) * Math.max(0, sceneDuration - entryDuration);
  }

  function sonnetBuildIconTextureKey(name, color, strokeWidth, size, resolution) {
    return name + '|' + color + '|' + strokeWidth + '|' + size + '|' + resolution;
  }

  /* 复刻 lucide-react 的 absoluteStrokeWidth 缩放：
   * strokeWidth * icon.size(24) / size。浮点字符串由 JS 数值转换产生，与
   * renderToStaticMarkup 的属性序列化一致（0.4375 / 0.375 …）。 */
  function sonnetLucideKebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /* 只有 Flower 有 vendored markup；其余名返回 null（调用方按可选装饰处理）。 */
  function sonnetBuildIconDataUrl(name, color, strokeWidth, size) {
    if (name !== 'Flower') return null;
    var safeSize = Number(size);
    if (!isFinite(safeSize) || safeSize <= 0) return null;
    var safeStrokeWidth = Number(strokeWidth);
    if (!isFinite(safeStrokeWidth)) return null;
    var scaled = safeStrokeWidth * 24 / safeSize;
    var markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + safeSize + '" height="' + safeSize + '"' +
      ' viewBox="0 0 24 24" fill="none" stroke="' + color + '"' +
      ' stroke-width="' + scaled + '" stroke-linecap="round" stroke-linejoin="round"' +
      ' class="lucide lucide-' + sonnetLucideKebab(name) + '" aria-hidden="true">' +
      SONNET_LUCIDE_FLOWER_CHILDREN +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }

  /* 单一导出命名空间：sonnet 模式主机（0g-folia-mode-sonnet.js）经此取用 MG 能力。
   * 只新增 window.foliaSonnetMg 一个全局名，MG 内部 200+ 个符号不暴露。 */
  if (typeof window !== 'undefined') {
    window.foliaSonnetMg = {
      buildShotMg: sonnetBuildShotMg,
      resolveGeoVariant: sonnetResolveGeoVariant,
      resolveBackgroundMgVariant: sonnetResolveBackgroundMgVariant,
      resolveFixedGeoVariant: sonnetResolveFixedGeoVariant,
      resolveBackgroundDecorVariant: sonnetResolveBackgroundDecorVariant,
      resolveIconNames: sonnetResolveIconNames,
      buildIconParticleIndices: sonnetBuildIconParticleIndices,
      resolveIconEntryPhase: sonnetResolveIconEntryPhase,
      resolveIconEntryDuration: sonnetResolveIconEntryDuration,
      resolveIconEntryDelay: sonnetResolveIconEntryDelay,
      buildIconTextureKey: sonnetBuildIconTextureKey,
      buildIconDataUrl: sonnetBuildIconDataUrl,
      colorNumber: sonnetColorNumber,
      normalizeAudioLevel: sonnetNormalizeAudioLevel
    };
  }
})();
