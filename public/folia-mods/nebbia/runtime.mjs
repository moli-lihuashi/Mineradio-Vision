/* 雾笺运行时（宿主适配层）。
 *
 * 移植自 Folia「雾笺」createNebbiaRuntime.ts（AGPL-3.0, chthollyphile/folia-major, 作者 lantudou）。
 * 剥离了：React / framer-motion MotionValue、人声包络与底鼓（智能动感「疏雨轻车」）、
 * 水族箱、雪窗、凝露三种分支 —— 只留「雨夜街景 + 雨窗玻璃」这一条。逻辑顺序与官方逐行对应，
 * 改过的每一处都在注释里标了「改为」。
 * lucide 图标字不剥离：neb/_lucideIcons.mjs 内嵌了官方那批图标的 24×24 几何，
 * 所以「句尾随机涂鸦」（doodle）和歌词里的 emoji 图标都能按笔顺擦出来。
 *
 * 时间来源：宿主给的是时钟对象（.get() / .on('change')），正好对上官方从 MotionValue 取 .get() 的用法。
 */

import { NEBBIA_FIXED } from './neb/nebbiaConstants.mjs';
import { NebbiaGlassMotion } from './neb/nebbiaDrops.mjs';
import { NebbiaGl } from './neb/nebbiaGl.mjs';
import { NebbiaGlyphCache } from './neb/nebbiaGlyphs.mjs';
import { NebbiaHits, VocalEnergy } from './neb/nebbiaHits.mjs';
import { NebbiaMask } from './neb/nebbiaMask.mjs';
import { resolveNebbiaPalette } from './neb/nebbiaPalette.mjs';
import { buildNebbiaScene } from './neb/nebbiaScene.mjs';
import { NebbiaSpot } from './neb/nebbiaSpot.mjs';
import { buildNebbiaLines, NEBBIA_DEFAULT_DOODLES } from './neb/nebbiaChars.mjs';
import { appendNebbiaCredits } from './neb/nebbiaCredits.mjs';
import { nebbiaFrameUniforms } from './neb/nebbiaFrameUniforms.mjs';
import { NebbiaSceneClock } from './neb/nebbiaSceneClock.mjs';
import { hashVisualizerSeed } from './neb/visualizerSeedHash.mjs';
import { setStrokeArrivedHook, nebbiaStrokeStats } from './neb/nebbiaStrokes.mjs';

/* 改了要重排整首的设置 */
const LAYOUT_KEYS = ['appear', 'fade', 'layouts', 'credits', 'jitter', 'warp', 'hold', 'refog', 'writeSpeed', 'doodle'];
const sameValue = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b);

export class NebbiaRuntime {
  constructor({ host, time, fontFamily = '"Kaiti SC", KaiTi, STKaiti, serif', fontWeight = 600, onFirstFrame, onFailed }) {
    this.host = host;
    /* 宿主时钟：有 .get() 就当时钟用（官方从 framer-motion 的 MotionValue 取 .get()，形态一致）。 */
    this.time = time || { get: () => 0 };
    this.onFirstFrame = onFirstFrame || (() => {});
    this.onFailed = onFailed || (() => {});
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';

    this.mask = new NebbiaMask();
    this.motion = new NebbiaGlassMotion();
    this.spot = new NebbiaSpot();
    this.energy = new VocalEnergy();
    this.glyphs = new NebbiaGlyphCache(fontFamily, fontWeight);
    this.clock = new NebbiaSceneClock();
    this.fieldInst = [];
    this.hits = new NebbiaHits(0);
    this.laid = [];
    this.words = [];
    this.song = { lines: [], seed: 'nebbia' };
    this.theme = null;
    this.tuning = null;
    this.fontScale = 1;
    this.showText = true;
    this.paused = false;
    this.still = false;
    this.lastT = NaN;
    this.lastTChange = 0;
    this.W = 0; this.H = 0;
    this.raf = 0;
    this.buildToken = 0;
    this.firstDrawn = false;
    this.dead = false;
    this.fontReady = true;
    this.strokeTimer = 0;
    this.glyphDirty = new Set();
    this.strokeWaitFrom = 0;
    this.renderMs = 0;
    this.gapMs = 0;
    this.frameAt = 0;

    host.appendChild(this.canvas);
    try {
      this.gl = new NebbiaGl(this.canvas, false, 'night', 'rain');
      this.gl.onSpriteReady = () => this.requestFrame();
      this.onLost = (e) => { e.preventDefault(); cancelAnimationFrame(this.raf); this.dead = true; this.onFailed(); };
      this.canvas.addEventListener('webglcontextlost', this.onLost);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(host);
      this.resize();
    } catch (error) {
      this.dead = true;
      try { this.observer?.disconnect(); } catch (_) {}
      try { this.canvas.remove(); } catch (_) {}
      throw error;
    }

    this.fontReady = this.glyphs.fontReady();
    this.onFontsLoaded = () => {
      if (this.dead) return;
      const ready = this.glyphs.fontReady();
      const arrived = ready && !this.fontReady;
      this.fontReady = ready;
      if (arrived) { this.glyphs.clear(); this.rebuild(); }
    };
    document.fonts?.addEventListener('loadingdone', this.onFontsLoaded);

    /* 改为：官方一次性 fetch 整张 nebbia-strokes.json，取完重排一次。
     * 我们按字懒加载，所以「什么时候重排」必须自己管 —— 第一版是每 120ms 就
     * glyphs.clear() + 整首重排，中文一首 76 个独立字就是 76 次全量重排，
     * 表现为**一卡一卡的**；英文没有笔顺可取，一次都不触发，所以「英文不卡」。
     * 现在改成：只作废真正到货的那几个字的字模 + 尾部去抖，等队列基本排空再重排一次。 */
    setStrokeArrivedHook((ch) => {
      if (this.dead) return;
      if (ch) {
        if (!this.glyphDirty.size) this.strokeWaitFrom = performance.now();
        this.glyphDirty.add(ch);
      }
      this.scheduleStrokeFlush();
    });
  }

  scheduleStrokeFlush = () => {
    if (this.strokeTimer) clearTimeout(this.strokeTimer);
    this.strokeTimer = setTimeout(this.flushStrokes, 700);
  };

  flushStrokes = () => {
    this.strokeTimer = 0;
    if (this.dead) return;
    const waiting = nebbiaStrokeStats().waiting;
    /* 还在下载就继续等 —— 但最多等 12 秒，网络差时不能一个字都不刷新 */
    if (waiting > 0 && performance.now() - this.strokeWaitFrom < 12000) {
      this.strokeTimer = setTimeout(this.flushStrokes, 700);
      return;
    }
    if (!this.glyphDirty.size) return;
    /* 只删到货的那几个字。整表 clear() 会让每个字重新追骨架 + 重新变形，很贵。 */
    for (const ch of this.glyphDirty) this.glyphs.cache.delete(ch);
    this.glyphDirty.clear();
    this.rebuild();
  }

  setTheme(theme) {
    this.theme = theme || {};
    const p = resolveNebbiaPalette(this.theme);
    this.gl.setPalette(p.sky0, p.sky1, p.la, p.lb, p.lc);
    this.requestFrame();
  }

  setSong(song) {
    if (song.seed !== this.song.seed) this.clock.songChanged();
    this.song = song;
    this.rebuild();
  }

  setFontScale(scale) { if (scale !== this.fontScale) { this.fontScale = scale; this.rebuild(); } }
  setShowText(show) { if (show !== this.showText) { this.showText = show; this.rebuild(); } }
  setDaylight(daylight) { this.gl.mistTint = daylight ? [0.86, 0.89, 0.92] : [0.07, 0.08, 0.1]; this.requestFrame(); }

  setTuning(tuning) {
    const prev = this.tuning;
    this.tuning = tuning;
    this.motion.bump = tuning.bump;
    if (!prev || LAYOUT_KEYS.some((k) => !sameValue(prev[k], tuning[k]))) this.rebuild();
    this.requestFrame();
  }

  setPlayback(paused, still) {
    this.paused = !!paused;
    this.still = !!still;
    this.requestFrame();
  }

  requestFrame() {
    if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    if (this.strokeTimer) { clearTimeout(this.strokeTimer); this.strokeTimer = 0; }
    setStrokeArrivedHook(null);
    try { this.observer?.disconnect(); } catch (_) {}
    document.fonts?.removeEventListener('loadingdone', this.onFontsLoaded);
    try { this.canvas.removeEventListener('webglcontextlost', this.onLost); } catch (_) {}
    try { this.gl.destroy(); } catch (_) {}
    try { this.canvas.remove(); } catch (_) {}
    this.laid = [];
    this.words = [];
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w < 1 || h < 1) return;
    const sized = w !== this.W || h !== this.H;
    this.W = w; this.H = h;
    /* 改为：官方按「性能与动效」全局挡位算像素比；这里固定上限 2 倍设备像素。 */
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl.resize(this.W, this.H, dpr);
    this.mask.resize(this.W, this.H);
    if (sized) { this.motion.buildField(this.W, this.H); this.rebuild(); }
    this.requestFrame();
  }

  rebuild() {
    const token = ++this.buildToken;
    const t = this.tuning;
    if (!t || !this.W) return;
    const { lines, seed, title, artist } = this.song;
    /* 官方：主题给的歌词图标优先，没给就用 NEBBIA_DEFAULT_DOODLES。
     * 图标节点是内嵌的（同步可用），不必等 loadLucideIcons 回来再 rebuild。 */
    const themeIcons = this.theme && Array.isArray(this.theme.lyricsIcons)
      ? this.theme.lyricsIcons.filter((n) => typeof n === 'string' && n)
      : [];
    const doodles = themeIcons.length ? themeIcons : NEBBIA_DEFAULT_DOODLES;
    const source = this.showText
      ? appendNebbiaCredits(
        buildNebbiaLines(lines, seed, Number(t.doodle) || 0, doodles),
        t.credits ? title : null,
        artist,
      )
      : [];
    this.laid = buildNebbiaScene(source, this.glyphs, t, { W: this.W, H: this.H, fontScale: this.fontScale }, seed);
    this.hits = new NebbiaHits(hashVisualizerSeed(String(seed)));
    this.words = source.map((l) => l.words);
    this.hits.buildBig(this.laid, this.words, this.W, this.H, null);
    this.spot.reset();
    this.requestFrame();
  }

  shadersReady() {
    try {
      if (this.gl.ready) return true;
    } catch (error) {
      console.warn('[nebbia] shaders failed', error);
      this.dead = true;
      this.onFailed();
      return false;
    }
    this.raf = requestAnimationFrame(this.frame);
    return false;
  }

  frame = () => {
    this.raf = 0;
    if (this.dead || this.gl.isContextLost || !this.shadersReady()) return;
    if (!this.W || !this.H) return;
    const t = this.tuning;
    if (!t) return;
    const ft0 = performance.now();
    if (this.frameAt) {
      const gap = ft0 - this.frameAt;
      this.gapMs = this.gapMs ? this.gapMs * 0.9 + gap * 0.1 : gap;
    }
    this.frameAt = ft0;
    const now = ft0 / 1000;
    const T = this.time.get();

    /* 改为：官方由外壳推进 paused。这里没有人直接告诉模组「暂停了」，
     * 用「歌词时间多久没动」判 —— 播放时宿主每帧推时间，暂停就不再推。
     * 停帧前先画完这一帧（冻结态），所以暂停画面不会停在半步中间。 */
    if (T !== this.lastT) { this.lastT = T; this.lastTChange = now; }
    const stalled = now - this.lastTChange > 0.6;
    const frozen = stalled || this.still;

    const dt = this.clock.tick(now, frozen);
    this.motion.beginFrame(now, frozen, true);
    const e = this.energy.update(0, Math.max(dt, 1 / 60));
    this.hits.advance(T, e, this.still ? 0 : t.rainHit, NebbiaHits.lifeOf(t.refog, NEBBIA_FIXED.beadHold), this.W, this.H);
    this.mask.draw(this.laid, T, now, t, this.motion, this.hits, t.rainBig);
    this.spot.update(this.laid, T, dt);

    const field = this.motion.fieldInstances(this.fieldInst, t.busSpeed);
    const u = nebbiaFrameUniforms(t, this.motion.shake(), this.spot, this.W, this.H, this.clock.time, null);
    this.gl.render(this.mask.ctx, this.mask.breath.active ? this.mask.breath : null, this.motion.drops, field, u, true);
    if (!this.firstDrawn) { this.firstDrawn = true; this.onFirstFrame(); }
    const cost = performance.now() - ft0;
    this.renderMs = this.renderMs ? this.renderMs * 0.9 + cost * 0.1 : cost;
    if (!stalled) this.raf = requestAnimationFrame(this.frame);
  };

  /** 探针 */
  probe() {
    return {
      size: [this.W, this.H],
      lines: this.song.lines?.length || 0,
      laid: this.laid.length,
      chars: this.laid.reduce((n, l) => n + l.chars.length, 0),
      ready: (() => { try { return this.gl.ready; } catch (_) { return false; } })(),
      firstDrawn: this.firstDrawn,
      strokes: nebbiaStrokeStats(),
      sceneTime: Math.round(this.clock.time * 10) / 10,
      drops: this.motion.drops.length / 6,
      fieldDrops: this.motion.fieldDrops.length,
      renderMs: Math.round(this.renderMs * 100) / 100,
      gapMs: Math.round(this.gapMs * 100) / 100,
      fps: this.gapMs ? Math.round(1000 / this.gapMs) : 0,
      spot: Math.round(this.spot.i * 100) / 100,
      spotAt: [Math.round(this.spot.x), Math.round(this.spot.y), Math.round(this.spot.r)],
      /* 诊断：这两个一旦退化，画面会明显比官方「平」——
       * fogOK=false 时主画面自己算雾（没有 1/4、1/8 那两层预渲染的模糊与光晕），
       * 楼群缓存不 valid 时窗外没有楼，只剩天空和几团光。 */
      gl: this.glInfo(),
    };
  }

  glInfo() {
    const gl = this.gl;
    if (!gl) return null;
    let bld = null;
    try {
      const list = gl.bld ? gl.bld.caches : null;
      if (list) bld = { n: list.length, valid: list.filter((c) => c.valid).length, size: list.map((c) => c.w + 'x' + c.h).slice(0, 3) };
    } catch (_) {}
    let progs = [];
    try { progs = Object.keys(gl.build?.programs || {}); } catch (_) {}
    return {
      fogOK: !!gl.fogOK,
      fogGl: !!gl.fogGl,
      bld,
      progs,
      canvas: [this.canvas.width, this.canvas.height],
      mist: this.tuning ? this.tuning.mist : null,
      neon: this.tuning ? this.tuning.neon : null,
      spotT: this.tuning ? this.tuning.spot : null,
      tint: Array.isArray(gl.mistTint) ? gl.mistTint.map((v) => Math.round(v * 100) / 100) : null,
    };
  }
}
