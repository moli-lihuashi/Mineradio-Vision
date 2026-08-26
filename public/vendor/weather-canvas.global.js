"use strict";
var TsLibrary = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    CloudyEffect: () => CloudyEffect,
    CustomEffect: () => CustomEffect,
    FoggyEffect: () => FoggyEffect,
    HazeEffect: () => HazeEffect,
    INTENSITY_CONFIG: () => INTENSITY_CONFIG,
    OvercastEffect: () => OvercastEffect,
    ParticlePool: () => ParticlePool,
    RainyEffect: () => RainyEffect,
    SnowyEffect: () => SnowyEffect,
    SunnyEffect: () => SunnyEffect,
    ThunderstormEffect: () => ThunderstormEffect,
    WeatherCanvas: () => WeatherCanvas,
    WeatherCanvasRenderer: () => WeatherCanvasRenderer,
    WeatherEffect: () => WeatherEffect,
    clamp: () => clamp,
    easeInOutCubic: () => easeInOutCubic,
    easeInOutQuad: () => easeInOutQuad,
    getIntensityConfig: () => getIntensityConfig,
    randomBetween: () => randomBetween
  });

  // src/types.ts
  var INTENSITY_CONFIG = {
    light: {
      opacity: 0.6,
      speed: 0.6,
      particleCount: 0.5,
      description: "Light"
    },
    moderate: {
      opacity: 0.8,
      speed: 1,
      particleCount: 1,
      description: "Moderate"
    },
    heavy: {
      opacity: 1,
      speed: 1.4,
      particleCount: 1.8,
      description: "Heavy"
    }
  };
  function getIntensityConfig(intensity) {
    return INTENSITY_CONFIG[intensity];
  }

  // src/effects/base.ts
  var WeatherEffect = class {
    ctx;
    width;
    height;
    time = 0;
    intensity;
    intensityConfig;
    wind;
    elements = [];
    constructor(ctx, width, height, intensity = "moderate", wind = 0) {
      this.ctx = ctx;
      this.width = width;
      this.height = height;
      this.intensity = intensity;
      this.wind = wind;
      this.intensityConfig = getIntensityConfig(intensity);
    }
    renderElements(time) {
      this.elements.forEach((element) => element.render(time));
    }
    update() {
      this.time += 1;
      this.elements.forEach((element) => element.update(this.time));
    }
    setWind(wind) {
      this.wind = wind;
      this.elements.forEach((element) => {
        if (element.setWind) {
          element.setWind(wind);
        }
      });
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      this.elements.forEach((element) => element.resize(width, height));
    }
    getParticleCount(baseCount) {
      return Math.ceil(baseCount * this.intensityConfig.particleCount);
    }
    getSpeed(baseSpeed) {
      return baseSpeed * this.intensityConfig.speed;
    }
    getOpacity(baseOpacity) {
      return baseOpacity * this.intensityConfig.opacity;
    }
    // Deprecated helper methods (kept just in case subclasses still use them directly for some reason,
    // but they should move to elements)
    drawGradient(x1, y1, x2, y2, stops) {
      const gradient = this.ctx.createLinearGradient(x1, y1, x2, y2);
      stops.forEach(([offset, color]) => {
        gradient.addColorStop(offset, color);
      });
      return gradient;
    }
    drawRadialGradient(x, y, r1, r2, stops) {
      const gradient = this.ctx.createRadialGradient(x, y, r1, x, y, r2);
      stops.forEach(([offset, color]) => {
        gradient.addColorStop(offset, color);
      });
      return gradient;
    }
  };

  // src/elements/base.ts
  var BaseElement = class {
    ctx;
    width;
    height;
    constructor(ctx, width, height) {
      this.ctx = ctx;
      this.width = width;
      this.height = height;
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setWind(_wind) {
    }
    destroy() {
    }
  };

  // src/elements/background.ts
  var BackgroundElement = class extends BaseElement {
    config;
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.config = config;
    }
    update() {
    }
    render() {
      const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
      gradient.addColorStop(0, this.config.topColor);
      gradient.addColorStop(1, this.config.bottomColor);
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    setConfig(config) {
      this.config = config;
    }
  };

  // src/elements/sun.ts
  var SunElement = class extends BaseElement {
    constructor(ctx, width, height) {
      super(ctx, width, height);
    }
    update() {
    }
    render() {
      const sunX = this.width * 0.75;
      const sunY = this.height * 0.25;
      const sunRadius = 40;
      const glowGradient = this.ctx.createRadialGradient(sunX, sunY, sunRadius * 0.5, sunX, sunY, sunRadius * 2);
      glowGradient.addColorStop(0, "rgba(255, 223, 0, 0.3)");
      glowGradient.addColorStop(1, "rgba(255, 223, 0, 0)");
      this.ctx.fillStyle = glowGradient;
      this.ctx.fillRect(sunX - sunRadius * 2, sunY - sunRadius * 2, sunRadius * 4, sunRadius * 4);
      this.ctx.fillStyle = "#ffd700";
      this.ctx.beginPath();
      this.ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  };

  // src/elements/moon.ts
  var MoonElement = class extends BaseElement {
    phase = 0.5;
    // Default to Full Moon (0.5)
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.phase = this.getMoonPhase(config?.date ?? /* @__PURE__ */ new Date());
    }
    /**
     * Calculate moon phase (0 to 1)
     * 0: New Moon
     * 0.25: First Quarter
     * 0.5: Full Moon
     * 0.75: Last Quarter
     */
    getMoonPhase(date) {
      const knownNewMoon = (/* @__PURE__ */ new Date("2000-01-06T18:14:00Z")).getTime();
      const cycle = 29.530588853;
      const diffTime = date.getTime() - knownNewMoon;
      const diffDays = diffTime / (1e3 * 60 * 60 * 24);
      let phase = diffDays % cycle / cycle;
      if (phase < 0) phase += 1;
      return phase;
    }
    update() {
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    render(_time) {
      const moonX = this.width * 0.75;
      const moonY = this.height * 0.25;
      const moonRadius = 35;
      const brightness = Math.sin(this.phase * Math.PI);
      const glowOpacity = 0.2 * (0.2 + 0.8 * brightness);
      const glowGradient = this.ctx.createRadialGradient(
        moonX,
        moonY,
        moonRadius * 0.5,
        moonX,
        moonY,
        moonRadius * 2
      );
      glowGradient.addColorStop(0, `rgba(240, 248, 255, ${glowOpacity})`);
      glowGradient.addColorStop(1, "rgba(240, 248, 255, 0)");
      this.ctx.fillStyle = glowGradient;
      this.ctx.fillRect(moonX - moonRadius * 2, moonY - moonRadius * 2, moonRadius * 4, moonRadius * 4);
      this.ctx.save();
      this.ctx.beginPath();
      if (this.phase < 0.02 || this.phase > 0.98) {
        this.ctx.restore();
        return;
      }
      if (Math.abs(this.phase - 0.5) < 0.02) {
        this.ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
      } else {
        const isWaxing = this.phase < 0.5;
        const w = moonRadius * Math.cos(this.phase * 2 * Math.PI);
        if (isWaxing) {
          this.ctx.arc(moonX, moonY, moonRadius, -Math.PI / 2, Math.PI / 2, false);
          this.ctx.ellipse(moonX, moonY, Math.abs(w), moonRadius, 0, Math.PI / 2, 3 * Math.PI / 2, w > 0);
        } else {
          this.ctx.arc(moonX, moonY, moonRadius, Math.PI / 2, 3 * Math.PI / 2, false);
          this.ctx.ellipse(moonX, moonY, Math.abs(w), moonRadius, 0, 3 * Math.PI / 2, 5 * Math.PI / 2, w < 0);
        }
      }
      this.ctx.closePath();
      this.ctx.clip();
      this.ctx.fillStyle = "#f0f8ff";
      this.ctx.fillRect(moonX - moonRadius, moonY - moonRadius, moonRadius * 2, moonRadius * 2);
      this.ctx.fillStyle = "rgba(200, 210, 220, 0.3)";
      this.ctx.beginPath();
      this.ctx.arc(moonX - 10, moonY - 8, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(moonX + 8, moonY + 5, 4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  };

  // src/utils/math.ts
  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  // src/elements/stars.ts
  var StarsElement = class extends BaseElement {
    stars = [];
    starsInitialized = false;
    count;
    constructor(ctx, width, height, config = {}) {
      super(ctx, width, height);
      this.count = config.count || 100;
    }
    initializeStars() {
      if (this.starsInitialized) {
        return;
      }
      this.stars = [];
      for (let i = 0; i < this.count; i++) {
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * (this.height * 0.6),
          radius: randomBetween(0.5, 1.5),
          opacity: 0.5,
          twinkleSpeed: randomBetween(0.02, 0.05),
          phase: Math.random() * Math.PI * 2
        });
      }
      this.starsInitialized = true;
    }
    update() {
      if (!this.starsInitialized) {
        this.initializeStars();
      }
    }
    render() {
      if (!this.starsInitialized) {
        this.initializeStars();
      }
      this.stars.forEach((star) => {
        star.phase += star.twinkleSpeed;
        const opacity = 0.5 + Math.sin(star.phase) * 0.5;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }
    resize(width, height) {
      super.resize(width, height);
      this.starsInitialized = false;
      this.stars = [];
    }
  };

  // src/elements/shooting-stars.ts
  var ShootingStarsElement = class extends BaseElement {
    stars = [];
    lastSpawnTime = 0;
    spawnInterval;
    options;
    constructor(ctx, width, height, options = {}) {
      super(ctx, width, height);
      this.options = options;
      if (this.options.spawnInterval) {
        this.spawnInterval = randomBetween(this.options.spawnInterval.min, this.options.spawnInterval.max);
      } else {
        this.spawnInterval = randomBetween(2e3, 5e3);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    update(_time) {
      const now = Date.now();
      if (now - this.lastSpawnTime > this.spawnInterval) {
        this.spawnStar();
        this.lastSpawnTime = now;
        if (this.options.spawnInterval) {
          this.spawnInterval = randomBetween(this.options.spawnInterval.min, this.options.spawnInterval.max);
        } else {
          this.spawnInterval = randomBetween(1e3, 4e3);
        }
      }
      for (let i = this.stars.length - 1; i >= 0; i--) {
        const star = this.stars[i];
        star.trail.unshift({ x: star.x, y: star.y, opacity: star.opacity });
        if (star.trail.length > 10) {
          star.trail.pop();
        }
        star.x += Math.cos(star.angle) * star.speed;
        star.y += Math.sin(star.angle) * star.speed;
        star.life--;
        if (star.life < 20) {
          star.opacity = star.life / 20;
        } else if (star.opacity < 1 && star.maxLife - star.life < 20) {
          star.opacity = (star.maxLife - star.life) / 20;
        }
        if (star.life <= 0 || star.x < -100 || star.x > this.width + 100 || star.y < -100 || star.y > this.height + 100) {
          this.stars.splice(i, 1);
        }
      }
    }
    spawnStar() {
      const side = Math.floor(Math.random() * 3);
      let startX, startY, angle;
      if (side === 0) {
        startX = randomBetween(0, this.width);
        startY = -50;
        angle = randomBetween(Math.PI / 4, 3 * Math.PI / 4);
      } else if (side === 1) {
        startX = -50;
        startY = randomBetween(0, this.height * 0.5);
        angle = randomBetween(-Math.PI / 4, Math.PI / 4);
      } else {
        startX = this.width + 50;
        startY = randomBetween(0, this.height * 0.5);
        angle = randomBetween(3 * Math.PI / 4, 5 * Math.PI / 4);
      }
      startX = randomBetween(-this.width * 0.2, this.width * 1.2);
      startY = randomBetween(-this.height * 0.2, this.height * 0.5);
      const targetX = randomBetween(this.width * 0.2, this.width * 0.8);
      const targetY = randomBetween(this.height * 0.3, this.height * 0.8);
      angle = Math.atan2(targetY - startY, targetX - startX);
      const life = this.options.life ? randomBetween(this.options.life.min, this.options.life.max) : randomBetween(60, 100);
      this.stars.push({
        x: startX,
        y: startY,
        length: randomBetween(50, 150),
        speed: randomBetween(15, 25),
        angle,
        opacity: 0,
        life,
        // Frames roughly
        maxLife: 100,
        // placeholder, will set in logic
        trail: []
      });
      this.stars[this.stars.length - 1].maxLife = this.stars[this.stars.length - 1].life;
    }
    render() {
      this.ctx.save();
      this.ctx.lineCap = "round";
      for (let i = 0; i < this.stars.length; i++) {
        const star = this.stars[i];
        if (star.trail.length > 0) {
          const gradient = this.ctx.createLinearGradient(
            star.trail[star.trail.length - 1].x,
            star.trail[star.trail.length - 1].y,
            star.x,
            star.y
          );
          gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
          gradient.addColorStop(1, `rgba(255, 255, 255, ${star.opacity})`);
          this.ctx.strokeStyle = gradient;
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          const tailEnd = star.trail[star.trail.length - 1];
          this.ctx.moveTo(tailEnd.x, tailEnd.y);
          this.ctx.lineTo(star.x, star.y);
          this.ctx.stroke();
        }
      }
      this.ctx.restore();
    }
  };

  // src/elements/cloud.ts
  var CloudElement = class extends BaseElement {
    clouds = [];
    cloudsInitialized = false;
    config;
    currentWind = 0;
    mode = "day";
    // Default mode
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.config = config;
    }
    setMode(mode) {
      this.mode = mode;
    }
    initializeClouds() {
      if (this.cloudsInitialized) {
        return;
      }
      this.clouds = [];
      for (let i = 0; i < this.config.count; i++) {
        const yMin = this.height * this.config.yRange[0];
        const yMax = this.height * this.config.yRange[1];
        this.clouds.push({
          x: Math.random() * this.width,
          y: Math.random() * (yMax - yMin) + yMin,
          width: randomBetween(this.config.widthRange[0], this.config.widthRange[1]),
          height: randomBetween(this.config.heightRange[0], this.config.heightRange[1]),
          speed: randomBetween(this.config.speedRange[0], this.config.speedRange[1]),
          opacity: randomBetween(this.config.opacityRange[0], this.config.opacityRange[1])
        });
      }
      this.cloudsInitialized = true;
    }
    update() {
      if (!this.cloudsInitialized) {
        this.initializeClouds();
      }
      this.clouds.forEach((cloud) => {
        cloud.x += cloud.speed + this.currentWind;
        if (cloud.x > this.width + cloud.width) {
          cloud.x = -cloud.width;
        } else if (cloud.x < -cloud.width) {
          cloud.x = this.width + cloud.width;
        }
      });
    }
    render() {
      if (!this.cloudsInitialized) {
        this.initializeClouds();
      }
      this.clouds.forEach((cloud) => {
        const cloudColor = this.mode === "night" ? `rgba(70, 80, 90, ${cloud.opacity})` : `rgba(255, 255, 255, ${cloud.opacity})`;
        this.ctx.fillStyle = cloudColor;
        if (this.config.style === "elliptical") {
          this.drawEllipticalCloud(cloud.x, cloud.y, cloud.width, cloud.height);
        } else {
          this.drawRoundedCloud(cloud.x, cloud.y, cloud.width, cloud.height);
        }
      });
    }
    setWind(wind) {
      this.currentWind = wind;
    }
    resize(width, height) {
      super.resize(width, height);
      this.cloudsInitialized = false;
      this.clouds = [];
    }
    drawRoundedCloud(x, y, w, h) {
      this.ctx.beginPath();
      this.ctx.arc(x, y, h * 0.6, 0, Math.PI * 2);
      this.ctx.arc(x + w * 0.3, y - h * 0.2, h * 0.7, 0, Math.PI * 2);
      this.ctx.arc(x + w * 0.7, y, h * 0.6, 0, Math.PI * 2);
      this.ctx.arc(x + w * 0.5, y + h * 0.2, h * 0.5, 0, Math.PI * 2);
      this.ctx.fill();
    }
    drawEllipticalCloud(x, y, w, h) {
      this.ctx.beginPath();
      this.ctx.ellipse(x + w * 0.15, y + h * 0.5, w * 0.25, h * 0.5, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(x + w * 0.4, y, w * 0.3, h * 0.6, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(x + w * 0.65, y + h * 0.3, w * 0.28, h * 0.55, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.ellipse(x + w * 0.85, y + h * 0.5, w * 0.25, h * 0.5, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
  };

  // src/elements/fog.ts
  var FogElement = class extends BaseElement {
    particles = [];
    particlesInitialized = false;
    config;
    currentWind = 0;
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.config = config;
    }
    initParticles() {
      if (this.particlesInitialized) {
        return;
      }
      this.particles = [];
      for (let i = 0; i < this.config.count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius: randomBetween(30, 70),
          speed: randomBetween(0.2, 0.7),
          opacity: randomBetween(0.05, 0.2)
        });
      }
      this.particlesInitialized = true;
    }
    update() {
      if (!this.particlesInitialized) {
        this.initParticles();
      }
      this.particles.forEach((particle) => {
        particle.x += particle.speed + this.currentWind;
        if (particle.x > this.width + particle.radius) {
          particle.x = -particle.radius;
        } else if (particle.x < -particle.radius) {
          particle.x = this.width + particle.radius;
        }
      });
    }
    render() {
      if (!this.particlesInitialized) {
        this.initParticles();
      }
      this.particles.forEach((particle) => {
        const gradient = this.ctx.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          particle.radius
        );
        gradient.addColorStop(0, `rgba(${this.config.color}, ${particle.opacity})`);
        gradient.addColorStop(1, `rgba(${this.config.color}, 0)`);
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }
    setWind(wind) {
      this.currentWind = wind;
    }
    resize(width, height) {
      super.resize(width, height);
      this.particlesInitialized = false;
      this.particles = [];
    }
  };

  // src/elements/lightning.ts
  var LightningElement = class extends BaseElement {
    lightningFlash = 0;
    config = { color: "255, 255, 200" };
    constructor(ctx, width, height, config = {}) {
      super(ctx, width, height);
      if (config.color) {
        this.config.color = config.color;
      }
    }
    update() {
      if (Math.random() < 0.01) {
        this.lightningFlash = 1;
      }
      if (this.lightningFlash > 0) {
        this.lightningFlash -= 0.05;
      }
    }
    render() {
      if (this.lightningFlash > 0) {
        this.ctx.fillStyle = `rgba(255, 255, 255, ${this.lightningFlash * 0.3})`;
        this.ctx.fillRect(0, 0, this.width, this.height);
        if (this.lightningFlash > 0.7) {
          this.ctx.strokeStyle = `rgba(${this.config.color}, ${this.lightningFlash})`;
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          let x = this.width * 0.3 + Math.random() * this.width * 0.4;
          let y = 0;
          this.ctx.moveTo(x, y);
          for (let i = 0; i < 5; i++) {
            x += (Math.random() - 0.5) * 40;
            y += this.height / 5;
            this.ctx.lineTo(x, y);
          }
          this.ctx.stroke();
        }
      }
    }
    resize(width, height) {
      super.resize(width, height);
      this.lightningFlash = 0;
    }
  };

  // src/utils/particles.ts
  var ParticlePool = class {
    pool = [];
    active = [];
    constructor(initialSize = 100) {
      for (let i = 0; i < initialSize; i++) {
        this.pool.push(this.createParticle());
      }
    }
    createParticle() {
      return {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 1,
        maxLife: 1,
        size: 2,
        opacity: 1
      };
    }
    get(x, y, vx, vy, life, gravity = 0) {
      let particle;
      if (this.pool.length > 0) {
        particle = this.pool.pop();
      } else {
        particle = this.createParticle();
      }
      particle.x = x;
      particle.y = y;
      particle.vx = vx;
      particle.vy = vy;
      particle.life = 1;
      particle.maxLife = life;
      particle.opacity = 1;
      particle.gravity = gravity;
      this.active.push(particle);
      return particle;
    }
    update() {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const p = this.active[i];
        p.life -= 1 / p.maxLife;
        p.opacity = clamp(p.life, 0, 1);
        if (p.life <= 0) {
          this.pool.push(this.active.splice(i, 1)[0]);
        } else {
          if (p.gravity) {
            p.vy += p.gravity;
          }
          p.x += p.vx;
          p.y += p.vy;
        }
      }
    }
    getActive() {
      return this.active;
    }
    clear() {
      this.pool.push(...this.active);
      this.active = [];
    }
  };

  // src/elements/rain.ts
  var RainElement = class extends BaseElement {
    rainDrops = [];
    particlesInitialized = false;
    splashPool;
    config;
    currentWind = 0;
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.config = config;
      this.splashPool = new ParticlePool(100);
    }
    initRainDrops() {
      if (this.particlesInitialized) {
        return;
      }
      this.rainDrops = [];
      for (let i = 0; i < this.config.count; i++) {
        this.rainDrops.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          length: randomBetween(10, 30),
          speed: this.config.speed * randomBetween(1, 2),
          // vary speed slightly
          opacity: randomBetween(0.5, 1) * this.config.opacity
        });
      }
      this.particlesInitialized = true;
    }
    update() {
      if (!this.particlesInitialized) {
        this.initRainDrops();
      }
      this.rainDrops.forEach((drop) => {
        drop.y += drop.speed;
        drop.x += this.currentWind;
        if (this.currentWind > 0 && drop.x > this.width) {
          drop.x = -20;
        } else if (this.currentWind < 0 && drop.x < -20) {
          drop.x = this.width;
        }
        if (drop.y > this.height) {
          this.createSplash(drop.x, this.height);
          drop.y = -drop.length;
          drop.x = Math.random() * this.width;
        }
      });
      this.splashPool.update();
    }
    render() {
      if (!this.particlesInitialized) {
        this.initRainDrops();
      }
      this.rainDrops.forEach((drop) => {
        this.ctx.strokeStyle = `rgba(174, 194, 224, ${drop.opacity})`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(drop.x, drop.y);
        this.ctx.lineTo(drop.x + this.currentWind * 2, drop.y + drop.length);
        this.ctx.stroke();
      });
      const particles = this.splashPool.getActive();
      this.ctx.fillStyle = "rgba(174, 194, 224, 0.6)";
      particles.forEach((p) => {
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }
    createSplash(x, y) {
      const count = Math.floor(randomBetween(2, 4));
      for (let i = 0; i < count; i++) {
        const vx = randomBetween(-1, 1);
        const vy = randomBetween(-2, -4.5);
        const life = randomBetween(10, 20);
        this.splashPool.get(x, y, vx, vy, life, 0.2);
      }
    }
    setWind(wind) {
      this.currentWind = wind;
    }
    resize(width, height) {
      super.resize(width, height);
      this.particlesInitialized = false;
      this.rainDrops = [];
    }
  };

  // src/elements/snow.ts
  var SnowElement = class extends BaseElement {
    particlePool;
    config;
    currentWind = 0;
    constructor(ctx, width, height, config) {
      super(ctx, width, height);
      this.config = config;
      this.particlePool = new ParticlePool(config.count);
      this.initSnow();
    }
    initSnow() {
    }
    update() {
      for (let i = 0; i < this.config.count; i++) {
        const speed = this.config.speed * randomBetween(1, 3);
        const snowflake = this.particlePool.get(
          Math.random() * this.width,
          Math.random() * this.height - this.height,
          // start above
          this.currentWind + randomBetween(-1, 1),
          speed,
          this.height / 2
          // life
        );
        snowflake.size = randomBetween(2, 6) * (this.config.opacity / 0.8);
      }
      this.particlePool.update();
    }
    render() {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      this.particlePool.getActive().forEach((particle) => {
        this.ctx.globalAlpha = particle.opacity;
        this.drawSnowflake(particle.x, particle.y, particle.size);
      });
      this.ctx.globalAlpha = 1;
    }
    drawSnowflake(x, y, size) {
      this.ctx.save();
      this.ctx.translate(x, y);
      for (let i = 0; i < 6; i++) {
        this.ctx.rotate(Math.PI * 2 / 6);
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(0, -size);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(-size * 0.3, -size * 0.7);
        this.ctx.lineTo(size * 0.3, -size * 0.7);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
    setWind(wind) {
      this.currentWind = wind;
      this.particlePool.getActive().forEach((p) => {
        p.vx = wind + randomBetween(-1, 1);
      });
    }
    resize(width, height) {
      super.resize(width, height);
      this.particlePool.clear();
    }
  };

  // src/effects/sunny.ts
  var BACKGROUND_COLORS = {
    day: ["#4a90e2", "#87ceeb"],
    night: ["#0a1128", "#1e3a5f"]
  };
  var SunnyEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS.night : BACKGROUND_COLORS.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      if (this.mode === "night") {
        this.elements.push(new StarsElement(ctx, width, height));
        this.elements.push(new ShootingStarsElement(ctx, width, height));
      }
      if (this.mode === "day") {
        this.elements.push(new SunElement(ctx, width, height));
      } else {
        this.elements.push(new MoonElement(ctx, width, height));
      }
      const cloudConfig = {
        count: 3,
        widthRange: [80, 120],
        heightRange: [30, 40],
        speedRange: [0.1, 0.3],
        opacityRange: [0.4, 0.5],
        yRange: [0.1, 0.5]
      };
      const speedMult = this.intensityConfig.speed;
      cloudConfig.speedRange = [cloudConfig.speedRange[0] * speedMult, cloudConfig.speedRange[1] * speedMult];
      const cloudElement = new CloudElement(ctx, width, height, cloudConfig);
      cloudElement.setMode(this.mode);
      cloudElement.setWind(this.wind);
      this.elements.push(cloudElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/cloudy.ts
  var BACKGROUND_COLORS2 = {
    day: ["#87ceeb", "#b0d4f1"],
    night: ["#0f1624", "#1f2937"]
  };
  var CloudyEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS2.night : BACKGROUND_COLORS2.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      if (this.mode === "night") {
        this.elements.push(new StarsElement(ctx, width, height));
        this.elements.push(new ShootingStarsElement(ctx, width, height));
      }
      if (this.mode === "day") {
        this.elements.push(new SunElement(ctx, width, height));
      } else {
        this.elements.push(new MoonElement(ctx, width, height));
      }
      const cloudCount = intensity === "light" ? 3 : intensity === "heavy" ? 7 : 5;
      const opacityMin = intensity === "light" ? 0.4 : 0.5;
      const opacityMax = intensity === "heavy" ? 0.9 : 0.8;
      const cloudConfig = {
        count: cloudCount,
        widthRange: [80, 120],
        heightRange: [30, 40],
        speedRange: [0.1, 0.3],
        opacityRange: [opacityMin, opacityMax],
        yRange: [0.1, 0.5]
      };
      const speedMult = this.intensityConfig.speed;
      cloudConfig.speedRange = [cloudConfig.speedRange[0] * speedMult, cloudConfig.speedRange[1] * speedMult];
      const cloudElement = new CloudElement(ctx, width, height, cloudConfig);
      cloudElement.setMode(this.mode);
      cloudElement.setWind(this.wind);
      this.elements.push(cloudElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/overcast.ts
  var BACKGROUND_COLORS3 = {
    day: ["#778899", "#a0aec0"],
    night: ["#0f1624", "#1f2937"]
  };
  var OvercastEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS3.night : BACKGROUND_COLORS3.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      const cloudElement = new CloudElement(ctx, width, height, {
        count: 7,
        widthRange: [100, 200],
        heightRange: [60, 100],
        speedRange: [0.05, 0.15],
        opacityRange: [0.6, 1],
        yRange: [0, 0.5]
      });
      cloudElement.setMode(this.mode);
      cloudElement.setWind(this.wind);
      this.elements.push(cloudElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/rainy.ts
  var BACKGROUND_COLORS4 = {
    day: ["#4a5568", "#718096"],
    night: ["#1a1a2e", "#16213e"]
  };
  var RainyEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS4.night : BACKGROUND_COLORS4.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      this.elements.push(new MoonElement(ctx, width, height));
      const cloudElement = new CloudElement(ctx, width, height, {
        count: 3,
        widthRange: [80, 200],
        heightRange: [30, 70],
        speedRange: [0.1, 0.4],
        opacityRange: [0.5, 0.5],
        yRange: [0, 0.4]
      });
      cloudElement.setMode(this.mode);
      cloudElement.setWind(this.wind);
      this.elements.push(cloudElement);
      const baseCount = 150;
      const particleCount = this.getParticleCount(baseCount);
      const rainElement = new RainElement(ctx, width, height, {
        count: particleCount,
        speed: this.getSpeed(8),
        // approximate average speed
        opacity: 1
      });
      rainElement.setWind(this.wind);
      this.elements.push(rainElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/snowy.ts
  var BACKGROUND_COLORS5 = {
    day: ["#e0e7ef", "#f0f4f8"],
    night: ["#1a2b4a", "#2d4563"]
  };
  var SnowyEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS5.night : BACKGROUND_COLORS5.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      const baseCount = 4;
      const snowflakeCount = this.getParticleCount(baseCount);
      const snowElement = new SnowElement(ctx, width, height, {
        count: snowflakeCount,
        speed: this.getSpeed(2),
        opacity: this.intensityConfig.opacity
      });
      snowElement.setWind(this.wind);
      this.elements.push(snowElement);
      this.elements.push(new MoonElement(ctx, width, height));
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/haze.ts
  var BACKGROUND_COLORS6 = {
    day: ["#b8a58e", "#d4c5b0"],
    night: ["#2d2416", "#3d3020"]
  };
  var HazeEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS6.night : BACKGROUND_COLORS6.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      this.elements.push(new MoonElement(ctx, width, height));
      const baseCount = 50;
      const particleCount = this.getParticleCount(baseCount);
      const fogElement = new FogElement(ctx, width, height, {
        count: particleCount,
        color: "150, 130, 100"
      });
      fogElement.setWind(this.wind);
      this.elements.push(fogElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/foggy.ts
  var BACKGROUND_COLORS7 = {
    day: ["#c0c5ce", "#dfe3e8"],
    night: ["#1c2128", "#2d3748"]
  };
  var FoggyEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS7.night : BACKGROUND_COLORS7.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      this.elements.push(new MoonElement(ctx, width, height));
      const baseCount = 50;
      const particleCount = this.getParticleCount(baseCount);
      const fogElement = new FogElement(ctx, width, height, {
        count: particleCount,
        color: "180, 190, 200"
      });
      fogElement.setWind(this.wind);
      this.elements.push(fogElement);
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/thunderstorm.ts
  var BACKGROUND_COLORS8 = {
    day: ["#4a5568", "#718096"],
    night: ["#1a1a2e", "#16213e"]
  };
  var ThunderstormEffect = class extends WeatherEffect {
    constructor(ctx, width, height, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.mode = mode;
      const bgColors = this.mode === "night" ? BACKGROUND_COLORS8.night : BACKGROUND_COLORS8.day;
      this.elements.push(
        new BackgroundElement(ctx, width, height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      this.elements.push(new MoonElement(ctx, width, height));
      const cloudElement = new CloudElement(ctx, width, height, {
        count: 3,
        widthRange: [80, 200],
        heightRange: [30, 70],
        speedRange: [0.1, 0.4],
        opacityRange: [0.5, 0.5],
        yRange: [0, 0.4]
      });
      cloudElement.setMode(this.mode);
      cloudElement.setWind(this.wind);
      this.elements.push(cloudElement);
      const baseCount = 150;
      const particleCount = this.getParticleCount(baseCount);
      const rainElement = new RainElement(ctx, width, height, {
        count: particleCount,
        speed: this.getSpeed(8),
        opacity: 1
      });
      rainElement.setWind(this.wind);
      this.elements.push(rainElement);
      this.elements.push(new LightningElement(ctx, width, height));
    }
    mode;
    render(time) {
      this.renderElements(time);
    }
  };

  // src/effects/custom.ts
  var CustomEffect = class extends WeatherEffect {
    config;
    mode;
    constructor(ctx, width, height, config, mode = "day", intensity = "moderate", wind = 0) {
      super(ctx, width, height, intensity, wind);
      this.config = config;
      this.mode = mode;
      this.initializeElements();
    }
    initializeElements() {
      const bgColors = this.mode === "night" ? this.config.background.night : this.config.background.day;
      this.elements.push(
        new BackgroundElement(this.ctx, this.width, this.height, {
          topColor: bgColors[0],
          bottomColor: bgColors[1]
        })
      );
      this.config.elements.forEach((elConfig) => {
        if (elConfig.modes && !elConfig.modes.includes(this.mode)) {
          return;
        }
        this.addElement(elConfig);
      });
    }
    addElement(config) {
      switch (config.type) {
        case "sun":
          this.elements.push(new SunElement(this.ctx, this.width, this.height));
          break;
        case "moon":
          this.elements.push(new MoonElement(this.ctx, this.width, this.height, config.options));
          break;
        case "stars":
          this.elements.push(new StarsElement(this.ctx, this.width, this.height, config.options || {}));
          break;
        case "shooting-stars":
          this.elements.push(new ShootingStarsElement(this.ctx, this.width, this.height, config.options));
          break;
        case "cloud":
          {
            const cloudEl = new CloudElement(this.ctx, this.width, this.height, config.options);
            cloudEl.setMode(this.mode);
            cloudEl.setWind(this.wind);
            this.elements.push(cloudEl);
          }
          break;
        case "rain":
          {
            const rainEl = new RainElement(this.ctx, this.width, this.height, config.options);
            rainEl.setWind(this.wind);
            this.elements.push(rainEl);
          }
          break;
        case "snow":
          {
            const snowEl = new SnowElement(this.ctx, this.width, this.height, config.options);
            snowEl.setWind(this.wind);
            this.elements.push(snowEl);
          }
          break;
        case "fog":
          {
            const fogEl = new FogElement(this.ctx, this.width, this.height, config.options);
            fogEl.setWind(this.wind);
            this.elements.push(fogEl);
          }
          break;
        case "lightning":
          this.elements.push(new LightningElement(this.ctx, this.width, this.height, config.options || {}));
          break;
        case "background":
          break;
      }
    }
    render(time) {
      this.renderElements(time);
    }
  };

  // src/renderer.ts
  var WeatherCanvasRenderer = class {
    canvas;
    ctx;
    width;
    height;
    fps;
    frameInterval;
    animationId = null;
    lastFrameTime = 0;
    currentWeather = "sunny";
    currentMode = "day";
    currentIntensity = "moderate";
    currentEffect = null;
    currentWind = 0;
    effectMap = /* @__PURE__ */ new Map();
    customWeatherMap = /* @__PURE__ */ new Map();
    /**
     * Constructor
     * @param canvas Canvas DOM element
     * @param options Configuration options
     */
    constructor(canvas, options) {
      this.canvas = canvas;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get 2D context from canvas");
      }
      this.ctx = ctx;
      this.width = options?.width || canvas.width || 700;
      this.height = options?.height || canvas.height || 400;
      this.fps = options?.fps || 60;
      this.currentWind = options?.wind || 0;
      this.frameInterval = 1e3 / this.fps;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.initializeEffects();
    }
    /**
     * Initialize all weather effects
     */
    initializeEffects() {
      const weatherTypes = [
        "sunny",
        "cloudy",
        "overcast",
        "rainy",
        "snowy",
        "haze",
        "foggy",
        "thunderstorm"
      ];
      weatherTypes.forEach((type) => {
        ["day", "night"].forEach((mode) => {
          ["light", "moderate", "heavy"].forEach((intensity) => {
            const effect = this.createEffect(type, mode, intensity);
            if (effect) {
              const key = `${type}_${mode}_${intensity}`;
              this.effectMap.set(key, effect);
            }
          });
        });
      });
      this.customWeatherMap.forEach((config, name) => {
        ["day", "night"].forEach((mode) => {
          ["light", "moderate", "heavy"].forEach((intensity) => {
            const effect = new CustomEffect(
              this.ctx,
              this.width,
              this.height,
              config,
              mode,
              intensity,
              this.currentWind
            );
            const key = `${name}_${mode}_${intensity}`;
            this.effectMap.set(key, effect);
          });
        });
      });
    }
    /**
     * Create effect instance for specified weather, time mode and intensity
     */
    createEffect(weatherType, mode, intensity) {
      if (this.customWeatherMap.has(weatherType)) {
        const config = this.customWeatherMap.get(weatherType);
        return new CustomEffect(this.ctx, this.width, this.height, config, mode, intensity, this.currentWind);
      }
      switch (weatherType) {
        case "sunny":
          return new SunnyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "cloudy":
          return new CloudyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "overcast":
          return new OvercastEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "rainy":
          return new RainyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "snowy":
          return new SnowyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "haze":
          return new HazeEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "foggy":
          return new FoggyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        case "thunderstorm":
          return new ThunderstormEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
        default:
          return null;
      }
    }
    /**
     * Register a custom weather effect configuration
     * @param name Unique name for the weather effect
     * @param config Configuration object defining the elements and background
     */
    registerWeather(name, config) {
      this.customWeatherMap.set(name, config);
      ["day", "night"].forEach((mode) => {
        ["light", "moderate", "heavy"].forEach((intensity) => {
          const effect = new CustomEffect(
            this.ctx,
            this.width,
            this.height,
            config,
            mode,
            intensity,
            this.currentWind
          );
          const key = `${name}_${mode}_${intensity}`;
          this.effectMap.set(key, effect);
        });
      });
    }
    /**
     * Render specified weather, time mode and intensity
     */
    render(weatherType, mode, intensity = "moderate") {
      this.currentWeather = weatherType;
      this.currentMode = mode;
      this.currentIntensity = intensity;
      const key = `${weatherType}_${mode}_${intensity}`;
      let effect = this.effectMap.get(key);
      if (!effect) {
        const newEffect = this.createEffect(weatherType, mode, intensity);
        if (newEffect) {
          this.effectMap.set(key, newEffect);
          effect = newEffect;
        } else {
          console.warn(`Weather type '${weatherType}' not found, falling back to sunny.`);
          const fallbackKey = `sunny_${mode}_${intensity}`;
          effect = this.effectMap.get(fallbackKey);
          if (!effect) {
            effect = new SunnyEffect(this.ctx, this.width, this.height, mode, intensity, this.currentWind);
            this.effectMap.set(fallbackKey, effect);
          }
        }
      }
      this.currentEffect = effect;
      this.currentEffect.setWind(this.currentWind);
    }
    /**
     * Start animation loop
     */
    start() {
      if (this.animationId === null) {
        this.animate();
      }
    }
    /**
     * Stop animation loop
     */
    stop() {
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }
    /**
     * Main animation loop
     */
    animate = (timestamp = 0) => {
      if (timestamp - this.lastFrameTime >= this.frameInterval) {
        this.update();
        this.draw();
        this.lastFrameTime = timestamp;
      }
      this.animationId = requestAnimationFrame(this.animate);
    };
    /**
     * Update animation state
     */
    update() {
      if (this.currentEffect) {
        this.currentEffect.update();
      }
    }
    /**
     * Draw frame
     */
    draw() {
      this.ctx.clearRect(0, 0, this.width, this.height);
      if (this.currentEffect) {
        this.currentEffect.render(this.lastFrameTime);
      }
    }
    /**
     * Set Canvas size
     */
    setSize(width, height) {
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.effectMap.clear();
      this.initializeEffects();
      this.render(this.currentWeather, this.currentMode, this.currentIntensity);
    }
    /**
     * Change weather type
     */
    setWeatherType(weatherType) {
      this.render(weatherType, this.currentMode, this.currentIntensity);
    }
    /**
     * Change time mode
     */
    setMode(mode) {
      this.render(this.currentWeather, mode, this.currentIntensity);
    }
    /**
     * Change weather intensity
     */
    setIntensity(intensity) {
      this.render(this.currentWeather, this.currentMode, intensity);
    }
    /**
     * Change wind speed
     */
    setWind(wind) {
      this.currentWind = wind;
      if (this.currentEffect) {
        this.currentEffect.setWind(wind);
      }
    }
    /**
     * Clear Canvas
     */
    clear() {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
    /**
     * Destroy instance
     */
    destroy() {
      this.stop();
      this.clear();
      this.effectMap.clear();
      this.currentEffect = null;
    }
    getWeatherType() {
      return this.currentWeather;
    }
    getMode() {
      return this.currentMode;
    }
    getIntensity() {
      return this.currentIntensity;
    }
    getWind() {
      return this.currentWind;
    }
    getCanvas() {
      return this.canvas;
    }
    getWidth() {
      return this.width;
    }
    getHeight() {
      return this.height;
    }
  };

  // src/custom-element.ts
  var DEFAULT_WIDTH = 700;
  var DEFAULT_HEIGHT = 400;
  var WeatherCanvas = class extends HTMLElement {
    renderer = null;
    canvas = null;
    shadow;
    constructor() {
      super();
      this.shadow = this.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    width: fit-content;
                    height: fit-content;
                    overflow: hidden;
                    line-height: 0;
                }
                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
        `;
    }
    connectedCallback() {
      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.shadow.appendChild(this.canvas);
      }
      const width = this.getAttribute("width");
      const height = this.getAttribute("height");
      const canvasWidth = parseInt(width ?? "" + DEFAULT_WIDTH, 10);
      const canvasHeight = parseInt(height ?? "" + DEFAULT_HEIGHT, 10);
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
      this.renderer = new WeatherCanvasRenderer(this.canvas);
      const weatherType = this.getAttribute("weather-type") || "sunny";
      const timeMode = this.getAttribute("time-mode") || "day";
      const intensity = this.getAttribute("intensity") || "moderate";
      const wind = parseFloat(this.getAttribute("wind") || "0");
      this.renderer.setWind(wind);
      this.renderer.render(weatherType, timeMode, intensity);
      this.renderer.start();
    }
    disconnectedCallback() {
      if (this.renderer) {
        this.renderer.destroy();
        this.renderer = null;
      }
    }
    static get observedAttributes() {
      return ["weather-type", "time-mode", "intensity", "width", "height", "wind"];
    }
    attributeChangedCallback(name, oldValue, newValue) {
      if (!this.renderer) {
        return;
      }
      switch (name) {
        case "weather-type":
          this.renderer.setWeatherType(newValue);
          break;
        case "time-mode":
          this.renderer.setMode(newValue);
          break;
        case "intensity":
          this.renderer.setIntensity(newValue);
          break;
        case "width":
          if (this.canvas) {
            this.canvas.width = parseInt(newValue, 10);
            this.renderer?.setSize(this.canvas.width, this.canvas.height);
          }
          break;
        case "height":
          if (this.canvas) {
            this.canvas.height = parseInt(newValue, 10);
            this.renderer?.setSize(this.canvas.width, this.canvas.height);
          }
          break;
        case "wind":
          this.renderer.setWind(parseFloat(newValue));
          break;
      }
    }
    start() {
      this.renderer?.start();
    }
    stop() {
      this.renderer?.stop();
    }
    registerCustomWeather(name, config) {
      this.renderer?.registerWeather(name, config);
    }
  };
  customElements.define("weather-canvas", WeatherCanvas);
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=index.global.js.map