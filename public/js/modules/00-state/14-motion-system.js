'use strict';
/*
 * Mineradio Motion System
 * ------------------------------------------------------------------
 * 把 Apple「Designing Fluid Interfaces」的动效工程规范落到代码：
 *   1. 真 spring 物理（刚度/阻尼/质量），不是 back.out/expo.out 预设曲线
 *   2. 可中断接力：交互中途改向时保留当前位移与速度，平滑 retarget，
 *      不做 GSAP 的 killTweensOf + overwrite「杀死重开」
 *   3. 统一 Apple easing / duration token，替换散落各处的 0.42/0.34/0.18 硬编码
 *   4. VelocityTracker：拖拽松手时把实测速度喂给 spring，实现 1:1 跟随→弹簧回弹
 *   5. prefers-reduced-motion 门：降级为瞬切/淡入
 *
 * 边界（不可违反）：
 *   - 只动 transform / opacity / 数值属性，绝不碰玻璃材质/着色器参数
 *   - spring 托管的 transform 属性，同一元素上不再让 GSAP 写同一属性，避免互踩
 *   - 单条共享 rAF 驱动所有活跃 spring，避免每 spring 一个 rAF 的开销
 *
 * 挂载点：window.MineradioMotion
 */
(function () {
  var SETTLE_EPS = 0.0006;     // 位移收敛阈值
  var SETTLE_EPS_V = 0.0006;   // 速度收敛阈值
  var MAX_LIFE_FRAMES = 240;   // 2s @60fps 安全上限，防止数值噪声永不停止
  var MAX_DT = 0.05;           // 切后台回来后 dt 钳制，避免发散

  // ---- reduced motion ----
  var _rmCache = null;
  function prefersReducedMotion() {
    if (_rmCache != null) return _rmCache;
    try {
      var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      _rmCache = !!(mq && mq.matches);
    } catch (_) { _rmCache = false; }
    return _rmCache;
  }
  try {
    var _mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (_mq && _mq.addEventListener) _mq.addEventListener('change', function () { _rmCache = null; });
  } catch (_) {}

  // ---- Tokens：Apple HIG 标准缓动 / 时长 / 弹簧预设 ----
  var EASE = {
    // 来自 apple-design-skill design-system.md Motion 章节
    default: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',   // 通用过渡
    easeIn:  'cubic-bezier(0.42, 0, 1.0, 1.0)',      // 元素离场
    easeOut: 'cubic-bezier(0, 0, 0.58, 1.0)',        // 元素进场
    spring:  'cubic-bezier(0.34, 1.56, 0.64, 1.0)',  // spring 近似（非交互备用）
    // 项目里已在用、手感接近 Apple 的曲线，统一收编
    smooth:  'cubic-bezier(0.16, 1, 0.3, 1)',
    appleIO: 'cubic-bezier(0.2, 0.7, 0.2, 1)'
  };
  // GSAP 核心库不解析 cubic-bezier() 字符串（需 CustomEase 插件，未载），
  // 故为每个 token 配一个 GSAP 命名缓动近似，供 easedTo 在 GSAP 引擎下使用。
  var GSAP_EASE = {
    default: 'power2.inOut',
    easeIn:  'power2.in',
    easeOut: 'power2.out',
    spring:  'back.out(1.56)',
    smooth:  'power3.out',
    appleIO: 'power2.inOut'
  };
  var DURATION = {
    micro: 0.12,   // 图标点按 100-150ms
    tap: 0.15,     // 按钮按下
    toggle: 0.22,  // 开关切换
    expand: 0.28,  // 展开/收起 250-300ms
    view: 0.35,    // 视图切换 300-400ms
    modal: 0.40    // 模态呈现 400ms
  };
  // 弹簧预设：{k 刚度, c 阻尼, mass 质量}，按 iOS 手感标定
  var SPRING = {
    standard: { k: 180, c: 22, mass: 1 },  // 默认 sheet/面板
    snappy:   { k: 300, c: 30, mass: 1 },  // 按钮点按，几乎不过冲
    gentle:   { k: 120, c: 18, mass: 1 },  // 大面板/歌单架
    bouncy:   { k: 320, c: 14, mass: 1 }   // 图标弹跳，可控过冲
  };

  // ---- 弹簧注册表 + 共享 rAF ----
  var active = new Map();   // key -> SpringState
  var idSeq = 0;
  var rafId = null;
  var lastT = 0;

  function ownerId(owner) {
    if (owner == null) return 'n' + (++idSeq);
    if (!owner.__motionId) {
      try { Object.defineProperty(owner, '__motionId', { value: ++idSeq, writable: false, configurable: true }); }
      catch (_) { owner.__motionId = ++idSeq; }
    }
    return 'o' + owner.__motionId;
  }
  function springKey(owner, prop) { return ownerId(owner) + '::' + prop; }

  function SpringState(apply) {
    this.apply = apply;
    this.value = 0; this.velocity = 0; this.target = 0;
    this.preset = SPRING.snappy;
    this.settled = true;
    this.life = 0;
    this.onComplete = null;
  }

  function stepSpring(s, dt) {
    if (dt > MAX_DT) dt = MAX_DT;
    var p = s.preset;
    var k = p.k, c = p.c, mass = p.mass || 1;
    // 自适应子步长：保证 ω·h < 0.1，刚性弹簧也稳定
    var omega = Math.sqrt(k / mass);
    var sub = Math.min(8, Math.max(1, Math.ceil((omega * dt) / 0.1)));
    var h = dt / sub;
    for (var i = 0; i < sub; i++) {
      var force = -k * (s.value - s.target) - c * s.velocity;
      s.velocity += (force / mass) * h;
      s.value += s.velocity * h;
    }
    s.apply(s.value);
    s.life++;
    var done = (Math.abs(s.value - s.target) < SETTLE_EPS && Math.abs(s.velocity) < SETTLE_EPS_V) || s.life >= MAX_LIFE_FRAMES;
    if (done) {
      s.value = s.target; s.velocity = 0; s.settled = true;
      s.apply(s.value);
      var cb = s.onComplete; s.onComplete = null;
      if (cb) { try { cb(); } catch (_) {} }
    }
  }

  function tick(now) {
    rafId = null;
    if (!active.size) { lastT = 0; return; }
    if (!lastT) lastT = now;
    var dt = (now - lastT) / 1000; lastT = now;
    if (dt <= 0) dt = 1 / 60;
    active.forEach(function (s, key) {
      stepSpring(s, dt);
      if (s.settled) {
        active.delete(key);
        // persist 的弹簧（持续托管元素）settle 后保留内联 transform；其余释放让 CSS 复位
        if (s._isTransform && s._el && !s._persist) maybeReleaseTransform(s._el);
      }
    });
    if (active.size) rafId = requestAnimationFrame(tick);
    else lastT = 0;
  }
  function ensureLoop() {
    if (rafId == null && active.size) rafId = requestAnimationFrame(tick);
  }
  function killSpring(owner, prop, opts) {
    var key = springKey(owner, prop);
    var s = active.get(key);
    active.delete(key);
    if (s && s._isTransform && s._el && (opts == null || opts.release !== false)) maybeReleaseTransform(s._el);
  }
  function killAll(owner, opts) {
    if (!owner || !owner.__motionId) return;
    var release = opts == null || opts.release !== false;
    var prefix = 'o' + owner.__motionId + '::';
    var els = [];
    active.forEach(function (s, key) {
      if (key.indexOf(prefix) === 0) {
        active.delete(key);
        if (release && s._isTransform && s._el && els.indexOf(s._el) < 0) els.push(s._el);
      }
    });
    if (release) els.forEach(function (el) { maybeReleaseTransform(el); });
  }

  // ---- DOM transform 复合管理：spring 托管 scale/rotate/x/y，避免与 GSAP 互踩 ----
  var bags = new Map(); // ownerId(el) -> {scale,rotate,x,y,opacity}
  function getBag(owner) {
    var id = ownerId(owner);
    var b = bags.get(id);
    if (!b) { b = { scale: 1, rotate: 0, x: 0, y: 0, opacity: 1, _el: owner }; bags.set(id, b); }
    return b;
  }
  function applyBag(b) {
    var el = b._el;
    if (!el || !el.style) return;
    var t = '';
    if (b.scale !== 1) t += 'scale(' + (Math.round(b.scale * 100000) / 100000) + ') ';
    if (b.rotate) t += 'rotate(' + (Math.round(b.rotate * 100000) / 100000) + 'deg) ';
    if (b.x || b.y) t += 'translate(' + (Math.round(b.x * 100) / 100) + 'px,' + (Math.round(b.y * 100) / 100) + 'px) ';
    el.style.transform = t.trim() || 'none';
    el.style.opacity = b.opacity;
  }
  // 某元素的 transform 弹簧全部 settle 后，清除内联 transform/opacity，
  // 让 CSS 的 :hover/:active/transition 状态重新接管（避免内联残留盖掉 hover 抬升）。
  function maybeReleaseTransform(el) {
    if (!el || !el.__motionId) return;
    var prefix = 'o' + el.__motionId + '::';
    var stillActive = false;
    active.forEach(function (other, key) {
      if (key.indexOf(prefix) === 0 && other._isTransform) stillActive = true;
    });
    if (stillActive) return;
    try {
      el.style.transform = '';
      el.style.opacity = '';
    } catch (_) {}
    bags.delete('o' + el.__motionId);
  }

  // ---- 公共 API ----

  /**
   * 可中断弹簧：把 (owner,prop) 推向 target。
   * 若已有同 key 弹簧在跑，保留当前位移与速度，仅改目标（+可选速度注入）——
   * 这就是 Apple「连续响应」的核心，取代 kill+overwrite 的杀死重开。
   * @param apply(value) 写回函数；不传则按 DOM transform 复合写回
   */
  function springTo(owner, prop, target, opts) {
    opts = opts || {};
    if (prefersReducedMotion()) {
      var b = getBag(owner);
      if (prop in b) { b[prop] = target; applyBag(b); }
      else if (opts.apply) opts.apply(target);
      if (opts.onComplete) { try { opts.onComplete(); } catch (_) {} }
      return null;
    }
    var isTransformPart = (prop === 'scale' || prop === 'rotate' || prop === 'x' || prop === 'y' || prop === 'opacity');
    var apply = opts.apply;
    var bag = null;
    var usedBag = false;
    if (!apply && isTransformPart) {
      bag = getBag(owner);
      usedBag = true;
      apply = function (v) { bag[prop] = v; applyBag(bag); };
    }
    if (!apply) return null; // 非 transform 属性必须显式给 apply

    var key = springKey(owner, prop);
    var s = active.get(key);
    if (!s) {
      s = new SpringState(apply);
      s.value = (opts.from != null ? opts.from : (bag ? bag[prop] : 0));
      s.velocity = opts.velocity || 0;
      active.set(key, s);
    } else {
      s.apply = apply;                 // apply 可能因 bag 重建而变化
      if (opts.from != null) s.value = opts.from;
      if (opts.velocity != null) s.velocity += opts.velocity; // 速度接力/注入
    }
    s.target = target;
    s.preset = opts.preset || SPRING.snappy;
    s.settled = false;
    s.life = 0;
    s.onComplete = opts.onComplete || null;
    s._el = usedBag ? owner : null;    // 供 settle 后释放内联 transform 使用
    s._isTransform = usedBag;
    s._persist = !!opts.persist;       // 持续托管（如按钮 hover）：settle 后不清内联 transform，避免 CSS :hover 闪烁
    ensureLoop();
    return s;
  }

  /**
   * 点按弹跳（tapPop）：图标/按钮点一下，从略小弹回 1.0，自然过冲。
   * 可中断：连点时从当前位移+速度平滑改向，不跳变。
   * @param dip   下压幅度（0.12 = 从 0.88 弹回）
   */
  function tapPop(owner, prop, opts) {
    opts = opts || {};
    var preset = opts.preset || SPRING.bouncy;
    var dip = opts.dip != null ? opts.dip : 0.12;
    var target = opts.target != null ? opts.target : 1;
    var key = springKey(owner, prop);
    var s = active.get(key);
    if (s && !s.settled) {
      // 正在弹：注入反向速度制造再次下压，目标不变 → 平滑再弹一次
      s.velocity += -dip * (opts.kick || 14);
      s.preset = preset;
      s.target = target;
      s.life = 0;
      ensureLoop();
      return s;
    }
    // 首次：从下压位弹回目标
    return springTo(owner, prop, target, {
      from: target - dip,
      preset: preset,
      onComplete: opts.onComplete
    });
  }

  /**
   * 非交互过渡（进场/离场/编排）：用 GSAP + Apple cubic-bezier。
   * spring 留给直接操纵；这类 choreographed 动效用缓动即可，且无需可中断。
   */
  function easedTo(target, props, opts) {
    opts = opts || {};
    var dur = opts.duration != null ? opts.duration : DURATION.view;
    // opts.ease 接受 EASE token key（如 'smooth'），默认 'smooth'
    var key = opts.ease || 'smooth';
    var cssEase = EASE[key] ? EASE[key] : EASE.smooth;
    var gsapEase = GSAP_EASE[key] ? GSAP_EASE[key] : 'power3.out';
    if (window.gsap) {
      var vars = { duration: dur, ease: gsapEase, overwrite: opts.overwrite != null ? opts.overwrite : false };
      for (var k in props) vars[k] = props[k];
      if (opts.onComplete) vars.onComplete = opts.onComplete;
      return window.gsap.to(target, vars);
    }
    // 无 GSAP 回退：CSS transition（粗粒度）
    try {
      if (target && target.style) {
        target.style.transition = 'all ' + dur + 's ' + cssEase;
        for (var kk in props) target.style[kk] = props[kk];
      }
    } catch (_) {}
    if (opts.onComplete) setTimeout(opts.onComplete, dur * 1000);
    return null;
  }

  // ---- VelocityTracker：拖拽松手时把速度喂给 spring ----
  function VelocityTracker() {
    this.samples = []; // [{t, v}]
  }
  VelocityTracker.prototype.reset = function (v) {
    this.samples = [{ t: performance.now(), v: v || 0 }];
  };
  VelocityTracker.prototype.push = function (v) {
    var now = performance.now();
    this.samples.push({ t: now, v: v });
    // 只留 100ms 窗口，过期丢弃
    while (this.samples.length > 2 && now - this.samples[0].t > 100) this.samples.shift();
  };
  VelocityTracker.prototype.velocity = function () {
    var n = this.samples.length;
    if (n < 2) return 0;
    var a = this.samples[0], b = this.samples[n - 1];
    var dt = b.t - a.t;
    if (dt <= 0) return 0;
    return (b.v - a.v) / (dt / 1000); // 单位/秒
  };

  // ---- UI 进出：popover / 抽屉 / 面板（可中断，不动玻璃材质）----
  function writeUiTransform(el, bag, centerX) {
    if (!el || !el.style || !bag) return;
    var t = centerX ? 'translateX(-50%) ' : '';
    t += 'translate(' + (Math.round(bag.x * 100) / 100) + 'px,' + (Math.round(bag.y * 100) / 100) + 'px) ';
    t += 'scale(' + (Math.round(bag.scale * 100000) / 100000) + ')';
    el.style.transform = t;
    el.style.opacity = String(bag.opacity);
  }

  function releaseUiTransform(el) {
    if (!el || !el.style) return;
    try {
      el.style.transform = '';
      el.style.opacity = '';
      el.classList.remove('motion-spring-ui');
    } catch (_) {}
    if (el.__motionId) bags.delete('o' + el.__motionId);
  }

  /**
   * 面板/popover 进入：真 spring + 可中断改向。
   * opts.centerX — 保留 translateX(-50%)（底栏 popover 居中刚需）
   */
  function springUiIn(el, opts) {
    opts = opts || {};
    if (!el) return null;
    if (prefersReducedMotion()) {
      releaseUiTransform(el);
      if (opts.onComplete) { try { opts.onComplete(); } catch (_) {} }
      return null;
    }
    var centerX = !!opts.centerX;
    var preset = opts.preset || SPRING.standard;
    el.classList.add('motion-spring-ui');
    killAll(el, { release: false });
    var bag = getBag(el);
    bag.x = opts.fromX != null ? Number(opts.fromX) : 0;
    bag.y = opts.fromY != null ? Number(opts.fromY) : 8;
    bag.scale = opts.fromScale != null ? Number(opts.fromScale) : 0.97;
    bag.opacity = opts.fromOpacity != null ? Number(opts.fromOpacity) : 0;
    bag.rotate = 0;
    writeUiTransform(el, bag, centerX);

    var pending = 4;
    function doneOne() {
      pending -= 1;
      if (pending > 0) return;
      releaseUiTransform(el);
      if (opts.onComplete) { try { opts.onComplete(); } catch (_) {} }
    }
    function run(prop, target) {
      springTo(el, prop, target, {
        from: bag[prop],
        preset: preset,
        persist: true,
        apply: function (v) { bag[prop] = v; writeUiTransform(el, bag, centerX); },
        onComplete: doneOne
      });
    }
    run('x', 0);
    run('y', 0);
    run('scale', 1);
    run('opacity', 1);
    return bag;
  }

  /**
   * 面板/popover 退出：spring 收起后交还 CSS（由调用方移除 .show/.open）。
   */
  function springUiOut(el, opts) {
    opts = opts || {};
    if (!el) return null;
    if (prefersReducedMotion()) {
      releaseUiTransform(el);
      if (opts.onComplete) { try { opts.onComplete(); } catch (_) {} }
      return null;
    }
    var centerX = !!opts.centerX;
    var preset = opts.preset || SPRING.snappy;
    el.classList.add('motion-spring-ui');
    killAll(el, { release: false });
    var bag = getBag(el);
    // 从当前内联/默认态起步
    if (!isFinite(Number(bag.opacity)) || bag.opacity <= 0) bag.opacity = 1;
    if (!isFinite(Number(bag.scale)) || bag.scale <= 0) bag.scale = 1;
    writeUiTransform(el, bag, centerX);

    var toX = opts.toX != null ? Number(opts.toX) : 0;
    var toY = opts.toY != null ? Number(opts.toY) : 6;
    var toScale = opts.toScale != null ? Number(opts.toScale) : 0.98;
    var toOpacity = opts.toOpacity != null ? Number(opts.toOpacity) : 0;
    var pending = 4;
    function doneOne() {
      pending -= 1;
      if (pending > 0) return;
      releaseUiTransform(el);
      if (opts.onComplete) { try { opts.onComplete(); } catch (_) {} }
    }
    function run(prop, target) {
      springTo(el, prop, target, {
        preset: preset,
        persist: true,
        apply: function (v) { bag[prop] = v; writeUiTransform(el, bag, centerX); },
        onComplete: doneOne
      });
    }
    run('x', toX);
    run('y', toY);
    run('scale', toScale);
    run('opacity', toOpacity);
    return bag;
  }

  /** 模式按钮轻点按：可中断 tapPop */
  function springTap(el, opts) {
    opts = opts || {};
    if (!el) return null;
    return tapPop(el, 'scale', {
      dip: opts.dip != null ? opts.dip : 0.08,
      preset: opts.preset || SPRING.bouncy,
      onComplete: opts.onComplete
    });
  }

  /** 根据 open 布尔对居中 popover 做可中断进出（volume/quality/mood/mini-queue） */
  function springPopover(pop, open, opts) {
    opts = opts || {};
    if (!pop) return null;
    var centerX = opts.centerX !== false;
    if (open) {
      pop.dataset.motionOpen = '1';
      return springUiIn(pop, {
        centerX: centerX,
        fromX: opts.fromX != null ? opts.fromX : 0,
        fromY: opts.fromY != null ? opts.fromY : 8,
        fromScale: opts.fromScale != null ? opts.fromScale : 0.98,
        fromOpacity: opts.fromOpacity != null ? opts.fromOpacity : 0,
        preset: opts.preset || SPRING.snappy,
        onComplete: opts.onComplete
      });
    }
    if (pop.dataset.motionOpen === '0') return null;
    pop.dataset.motionOpen = '0';
    return springUiOut(pop, {
      centerX: centerX,
      toX: opts.toX != null ? opts.toX : 0,
      toY: opts.toY != null ? opts.toY : 6,
      toScale: opts.toScale != null ? opts.toScale : 0.98,
      toOpacity: 0,
      preset: opts.preset || SPRING.snappy,
      onComplete: opts.onComplete
    });
  }

  // ---- 调试钩子（可选）----
  function snapshot() {
    return { activeSprings: active.size, rafRunning: rafId != null };
  }

  window.MineradioMotion = {
    EASE: EASE,
    DURATION: DURATION,
    SPRING: SPRING,
    prefersReducedMotion: prefersReducedMotion,
    springTo: springTo,
    tapPop: tapPop,
    springUiIn: springUiIn,
    springUiOut: springUiOut,
    springTap: springTap,
    springPopover: springPopover,
    releaseUiTransform: releaseUiTransform,
    easedTo: easedTo,
    VelocityTracker: VelocityTracker,
    killSpring: killSpring,
    killAll: killAll,
    snapshot: snapshot
  };
})();
