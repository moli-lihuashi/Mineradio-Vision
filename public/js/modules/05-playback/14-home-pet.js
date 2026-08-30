// ============================================================
//  Home 桌宠「像素伙伴」— 基于 claude-pet (MIT © 2026 Lew1sWong) 的渲染核心
//  - 天气/时间驱动动作：夜晚睡觉 / 雷雨踱步 / 白天发呆+偶尔打哈欠伸懒腰
//  - 点击互动：跳跃 + 台词；卡角「⇄」切换 7 只角色（localStorage 记忆）
//  - 性能守则：30fps 封顶、像素整数倍缩放（image-rendering: pixelated）、
//    离 Home / 页签隐藏 / splash 时停帧
// ============================================================
var homePet = {
  canvas: null, ctx: null, rafId: 0, lastFrame: 0, lastSwap: 0,
  character: 'cat',
  curAnim: 'idle', frameIdx: 0,
  dir: 1, walkX: 0, walkActive: false, walkUntil: 0, nextWalkAt: 0,
  nextBlink: 0, blinkUntil: 0,
  nextMicro: 0, microUntil: 0, microState: null,
  jumpUntil: 0,
  px: 6, cols: 24, offX: 4,
  mood: 'idle', moodNote: '', statusTimer: 0,
  lastWeatherEval: 0,
};

var HOME_PET_CHAR_NAMES = { cat: '小橘', dog: '柴柴', bear: '布朗', rabbit: '团子', fox: '小狐', penguin: 'QQ', star: '小克' };
var HOME_PET_CLICK_LINES = ['陪你听歌~', '今天也想你', '❤', '嗯哼？', '音乐是最好的陪伴'];
var HOME_PET_MICRO_LINES = { yawn: '哈啊~ 有点困…', stretch: '唔~ 伸个懒腰!' };

var HOME_PET_STORE_KEY = 'mineradio-home-pet-char';

function homePetIsNight() {
  var hour = new Date().getHours();
  return hour >= 22 || hour < 6;
}

function homePetWeatherMood() {
  var weather = homeWeatherRadioState && homeWeatherRadioState.weather;
  if (homePetIsNight()) return 'night';
  var code = weather ? Number(weather.weatherCode) : NaN;
  if (!isFinite(code)) return 'idle';
  if ([95, 96, 99].indexOf(code) >= 0) return 'storm';
  if ([45, 48].indexOf(code) >= 0) return 'fog';
  if ([71, 73, 75, 77, 85, 86].indexOf(code) >= 0) return 'snow';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].indexOf(code) >= 0) return 'rain';
  return 'day';
}

function homePetMoodNote(mood) {
  var notes = {
    night: '深夜 · 睡着了 zzZ',
    storm: '雷雨 · 焦虑地踱步',
    rain: '雨天 · 听雨发呆',
    snow: '雪天 · 看雪花',
    fog: '雾天 · 迷路了',
    day: '晴天 · 陪着你',
    idle: '醒着 · 陪着你',
    poke: '开心 · 被戳到了',
    jump: '开心 · 跳一下！',
  };
  return notes[mood] || notes.idle;
}

function homePetSetStatus(text, temporary) {
  var el = document.getElementById('home-pet-status');
  if (!el) return;
  el.textContent = text;
  if (homePet.statusTimer) clearTimeout(homePet.statusTimer);
  if (temporary) {
    homePet.statusTimer = setTimeout(function () {
      homePet.statusTimer = null;
      homePetSetStatus(homePetMoodNote(homePet.mood));
    }, 1600);
  }
}

function homePetInteract() {
  homePet.jumpUntil = performance.now() + 900;
  if (Math.random() < 0.5) {
    homePet.microState = 'yawn';
    homePet.microUntil = performance.now() + 1600;
    homePet.frameIdx = 0;
  }
  var lines = HOME_PET_CLICK_LINES;
  homePetSetStatus(lines[Math.floor(Math.random() * lines.length)], true);
}

function homePetCycleCharacter() {
  var keys = Object.keys(HOME_PET_CHAR_NAMES).filter(function (key) {
    return typeof SPRITES === 'object' && SPRITES.frames && SPRITES.frames[key];
  });
  var index = keys.indexOf(homePet.character);
  homePet.character = keys[(index + 1) % keys.length] || keys[0];
  try { localStorage.setItem(HOME_PET_STORE_KEY, homePet.character); } catch (_error) { }
  homePet.frameIdx = 0;
  homePetSetStatus(HOME_PET_CHAR_NAMES[homePet.character] + ' 来啦！', true);
  if (typeof notifyListeningTodayGlass === 'function') notifyListeningTodayGlass();
}

function homePetResize() {
  if (!homePet.canvas) return;
  var rect = homePet.canvas.getBoundingClientRect();
  var cssW = Math.round(rect.width);
  var cssH = Math.round(rect.height);
  if (cssW < 60 || cssH < 40 || cssW > 4000 || cssH > 2000) return;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var px = Math.max(4, Math.min(12, Math.floor(Math.min(cssW * dpr / 16, cssH * dpr / 16))));
  var cols = Math.max(16, Math.floor(cssW * dpr / px));
  homePet.px = px;
  homePet.cols = cols;
  homePet.offX = Math.floor((cols - 16) / 2);
  var w = px * cols;
  var h = px * 16;
  if (homePet.canvas.width !== w || homePet.canvas.height !== h) {
    homePet.canvas.width = w;
    homePet.canvas.height = h;
  }
  if (homePet.ctx) homePet.ctx.imageSmoothingEnabled = false;
}

function homePetEvaluateMood(now) {
  if (now - homePet.lastWeatherEval < 30000) return;
  homePet.lastWeatherEval = now;
  var weatherMood = homePetWeatherMood();
  var anim = weatherMood === 'night' ? 'sleep' : (weatherMood === 'storm' ? 'walk' : 'idle');
  if (homePet.curAnim !== anim) {
    homePet.curAnim = anim;
    homePet.frameIdx = 0;
  }
  homePet.mood = weatherMood;
  if (!homePet.statusTimer) homePetSetStatus(homePetMoodNote(weatherMood));
}

function homePetTick(now) {
  homePetEvaluateMood(now);
  var dt = 1 / 30;

  // 眨眼
  if (now > homePet.nextBlink) {
    homePet.blinkUntil = now + 160;
    homePet.nextBlink = now + 2200 + Math.random() * 3500;
  }

  var sleeping = homePet.curAnim === 'sleep';

  // 雷雨：焦虑踱步；平时：偶尔散步
  if (!sleeping && homePet.mood === 'storm' && now > homePet.walkUntil) {
    homePet.walkActive = true;
    homePet.walkUntil = now + 4000;
    homePet.dir = Math.random() < 0.5 ? -1 : 1;
  }
  if (!sleeping && homePet.mood !== 'storm' && !homePet.walkActive && now > homePet.nextWalkAt) {
    homePet.walkActive = true;
    homePet.walkUntil = now + 2200 + Math.random() * 2600;
    homePet.dir = Math.random() < 0.5 ? -1 : 1;
  }
  if (homePet.walkActive && now > homePet.walkUntil) homePet.walkActive = false;

  // 微动作：打哈欠 / 伸懒腰
  if (!sleeping && !homePet.walkActive && now > homePet.nextMicro && homePet.curAnim === 'idle') {
    homePet.microState = Math.random() < 0.42 ? 'yawn' : 'stretch';
    homePet.microUntil = now + 2600;
    homePet.nextMicro = now + 20000 + Math.random() * 30000;
    homePet.curAnim = homePet.microState;
    homePet.frameIdx = 0;
    var line = HOME_PET_MICRO_LINES[homePet.microState];
    if (line && Math.random() < 0.35) homePetSetStatus(line, true);
  } else if (homePet.microState && now > homePet.microUntil) {
    homePet.microState = null;
    if (homePet.curAnim === 'yawn' || homePet.curAnim === 'stretch') {
      homePet.curAnim = 'idle';
      homePet.frameIdx = 0;
    }
  }

  // 行走位移（卡内单元格），撞边折返
  var maxWalk = Math.max(0, homePet.cols - 16);
  if (homePet.walkActive && !sleeping) {
    homePet.walkX += homePet.dir * 0.16;
    if (homePet.walkX < 0) { homePet.walkX = 0; homePet.dir = 1; homePet.walkUntil = Math.max(homePet.walkUntil, now + 1500); }
    if (homePet.walkX > maxWalk) { homePet.walkX = maxWalk; homePet.dir = -1; homePet.walkUntil = Math.max(homePet.walkUntil, now + 1500); }
  } else if (!homePet.walkActive) {
    homePet.walkX += (maxWalk / 2 - homePet.walkX) * 0.06;
  }
}

function homePetDraw(now) {
  var ctx = homePet.ctx || (homePet.ctx = homePet.canvas ? homePet.canvas.getContext('2d') : null);
  if (!ctx || typeof PetCore === 'undefined') return;
  var px = homePet.px;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, homePet.canvas.width, homePet.canvas.height);
  ctx.imageSmoothingEnabled = false;

  var jump = 0;
  if (now < homePet.jumpUntil) jump = Math.abs(Math.sin(now / 85)) * 2.2;
  var petX = homePet.offX + homePet.walkX;
  var flip = homePet.dir < 0 && homePet.walkActive;
  // 画布纵向恰好 16 格：原点平移 0 即站在地面；jump 为向上跳（负 Y）
  ctx.setTransform(flip ? -px : px, 0, 0, px, flip ? (petX + 16) * px : petX * px, -(jump * px));
  var blinking = now < homePet.blinkUntil;
  PetCore.drawPet(ctx, homePet.character, homePet.curAnim, homePet.frameIdx, blinking);
}

function homePetLoop(now) {
  homePet.rafId = requestAnimationFrame(homePetLoop);
  if (document.hidden || (typeof emptyHomeActive !== 'undefined' && !emptyHomeActive)) return;
  if (now - homePet.lastFrame < 33) return; // 30fps 封顶
  homePet.lastFrame = now;
  homePetResize();
  homePetTick(now);
  homePetDraw(now);
}

function homePetStartLoop() {
  if (homePet.rafId) return;
  homePet.lastFrame = 0;
  homePet.rafId = requestAnimationFrame(homePetLoop);
}

function homePetStopLoop() {
  if (homePet.rafId) {
    cancelAnimationFrame(homePet.rafId);
    homePet.rafId = 0;
  }
}

// ===== 自定义像素伙伴：上传照片 → 16×16 像素化 =====
var HOME_PET_BUDDY_STORE_KEY = 'mineradio-home-pet-buddies';
var HOME_PET_PAL_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+*~';
var homePetBuddySeq = 0;

function homePetLoadBuddies() {
  try {
    var raw = JSON.parse(localStorage.getItem(HOME_PET_BUDDY_STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(function (b) { return b && b.id && Array.isArray(b.frames) && b.palette; }) : [];
  } catch (_error) { return []; }
}

function homePetSaveBuddies(list) {
  try { localStorage.setItem(HOME_PET_BUDDY_STORE_KEY, JSON.stringify(list)); } catch (_error) { }
}

function homePetMergeBuddies() {
  var list = homePetLoadBuddies();
  if (list.length && typeof PetCore !== 'undefined' && PetCore.mergeCustomPets) PetCore.mergeCustomPets(list);
}

function homePetPickPhoto() {
  var input = document.getElementById('home-pet-photo-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) homePetPixelatePhoto(file);
    });
    document.body.appendChild(input);
  }
  input.click();
}

function homePetPixelatePhoto(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var image = new Image();
    image.onload = function () {
      try {
        var off = document.createElement('canvas');
        off.width = 16;
        off.height = 16;
        var octx = off.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        // cover 裁剪：取图片中心方形区域，避免拉伸
        var side = Math.min(image.width, image.height);
        var sx = (image.width - side) / 2;
        var sy = (image.height - side) / 2;
        octx.drawImage(image, sx, sy, side, side, 0, 0, 16, 16);
        var data = octx.getImageData(0, 0, 16, 16).data;
        // 量化：每通道压到 5 档，控制调色板体积
        var palette = Object.create(null);
        var grid = [];
        for (var y = 0; y < 16; y++) {
          var row = '';
          for (var x = 0; x < 16; x++) {
            var index = (y * 16 + x) * 4;
            var alpha = data[index + 3];
            if (alpha < 24) { row += '.'; continue; }
            var r = Math.min(255, Math.round(data[index] / 24) * 24);
            var g = Math.min(255, Math.round(data[index + 1] / 24) * 24);
            var b = Math.min(255, Math.round(data[index + 2] / 24) * 24);
            var hex = '#' + [r, g, b].map(function (v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }).join('');
            if (!palette[hex]) {
              if (homePetBuddySeq >= HOME_PET_PAL_CHARS.length) { row += '.'; continue; }
              palette[hex] = HOME_PET_PAL_CHARS[homePetBuddySeq++];
            }
            row += palette[hex];
          }
          grid.push(row);
        }
        var id = 'buddy-' + Date.now().toString(36);
        var list = homePetLoadBuddies();
        list.push({
          id: id,
          name: '我的' + (list.length + 1) + '号',
          frames: [grid],
          palette: palette,
        });
        homePetSaveBuddies(list);
        if (typeof PetCore !== 'undefined' && PetCore.mergeCustomPets) PetCore.mergeCustomPets(list);
        homePet.character = id;
        try { localStorage.setItem(HOME_PET_STORE_KEY, id); } catch (_) { }
        homePet.curAnim = 'idle';
        homePet.frameIdx = 0;
        homePetSetStatus('新伙伴上线！', true);
        if (typeof notifyListeningTodayGlass === 'function') notifyListeningTodayGlass();
      } catch (error) {
        console.warn('[HomePetPhoto]', error);
        if (typeof showToast === 'function') showToast('照片像素化失败');
      }
    };
    image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
}

function homePetBind() {
  var card = document.querySelector('.home-pet-card');
  homePet.canvas = document.getElementById('home-pet-canvas');
  if (!card || !homePet.canvas) return;
  try { homePet.character = localStorage.getItem(HOME_PET_STORE_KEY) || homePet.character; } catch (_error) { }
  if (!HOME_PET_CHAR_NAMES[homePet.character] || (typeof SPRITES === 'object' && SPRITES.frames && !SPRITES.frames[homePet.character])) {
    homePet.character = 'cat';
  }
  // div[role=button] 的键盘可达性：Enter/Space 等价点击
  card.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      homePetInteract();
    }
  });
  card.addEventListener('mousemove', function (e) {
    var rect = homePet.canvas.getBoundingClientRect();
    homePet.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
  card.addEventListener('mouseleave', function () {
    homePet.mouse = null;
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) homePetStopLoop();
    else if (typeof emptyHomeActive !== 'undefined' && emptyHomeActive) homePetStartLoop();
  });
  var observer = new MutationObserver(function () {
    if (typeof emptyHomeActive !== 'undefined' && emptyHomeActive) homePetStartLoop();
    else homePetStopLoop();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (typeof emptyHomeActive !== 'undefined' && emptyHomeActive) homePetStartLoop();
}

homePetBind();
