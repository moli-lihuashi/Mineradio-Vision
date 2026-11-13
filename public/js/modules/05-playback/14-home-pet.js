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
var HOME_PET_MICRO_LINES = {
  yawn: '哈啊~ 有点困…',
  stretch: '唔~ 伸个懒腰!',
  wave: '嗨，我在呢',
  review: '这段好听…'
};

// 待机时会轮换的小动作。第一版只有 yawn/stretch 且 20~50 秒才来一次，
// 白天（不触发 sleep）几乎只看到 idle，用户反馈「只有待机和点击两个动作」。
// 池子放在 16a-pet-petdex-map.js（有单测保证每个动作都能映射到合法行号）。
var HOME_PET_IDLE_ACTS = (typeof HomePetPetdexMap !== 'undefined' && HomePetPetdexMap.IDLE_ACTS)
  ? HomePetPetdexMap.IDLE_ACTS
  : ['yawn', 'stretch', 'wave', 'review'];

function homePetPickIdleAct() {
  // 正在放歌时更常进入「沉浸聆听」（review）
  var playingNow = (typeof audio !== 'undefined' && audio && !audio.paused);
  var pool = playingNow
    ? ['review', 'review', 'review', 'wave', 'yawn']
    : ['yawn', 'stretch', 'wave', 'review'];
  return pool[Math.floor(Math.random() * pool.length)];
}

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

// ---- 宠物皮肤：内置 / 照片生成 / Petdex 三类，统一在这里切换 ----

// 所有可选的同伴。顺序稳定：内置（按 HOME_PET_CHAR_NAMES 声明序）→ 照片（按存储序）→
// Petdex（按已装列表），这样 ⇄ 每次前进到下一只，不会因集合重排跳来跳去。
function homePetSkinRing() {
  var ring = [];
  var frames = (typeof SPRITES === 'object' && SPRITES.frames) || {};
  Object.keys(HOME_PET_CHAR_NAMES).forEach(function (key) {
    if (frames[key]) ring.push({ kind: 'builtin', id: key, name: HOME_PET_CHAR_NAMES[key], label: '内置' });
  });
  homePetLoadBuddies().forEach(function (buddy) {
    if (buddy && buddy.id && frames[buddy.id]) {
      ring.push({ kind: 'photo', id: buddy.id, name: buddy.name || '照片伙伴', label: '照片' });
    }
  });
  var dex = (typeof HomePetPetdex !== 'undefined' && HomePetPetdex.state && HomePetPetdex.state.installed) || [];
  dex.forEach(function (pet) {
    if (pet && pet.slug) {
      ring.push({ kind: 'petdex', id: pet.slug, name: pet.displayName || pet.slug, label: 'Petdex' });
    }
  });
  return ring;
}

function homePetCurrentSkin() {
  if (homePet.petdex && homePet.petdex.slug) return { kind: 'petdex', id: homePet.petdex.slug };
  var chr = homePet.character || '';
  return { kind: /^buddy-/.test(chr) ? 'photo' : 'builtin', id: chr };
}

// 统一切皮肤。三类互斥：切到非 Petdex 时必须让 Petdex 模块清掉自己的状态与记忆，
// 否则 homePet.petdex 仍然存在，绘制层继续优先走图片精灵 —— 表现就是「换了没反应」。
// 第一版的 ⇄ 只改 homePet.character，所以在 Petdex 宠物上按它完全无效。
function homePetSelectSkin(kind, id, label) {
  if (!id) return false;
  if (kind === 'petdex') {
    if (typeof HomePetPetdex === 'undefined' || typeof HomePetPetdex.activate !== 'function') return false;
    HomePetPetdex.activate(id, label || '');
    if (typeof HomePetSkin !== 'undefined' && HomePetSkin.refresh) HomePetSkin.refresh();
    return true;
  }
  if (typeof HomePetPetdex !== 'undefined' && typeof HomePetPetdex.deactivate === 'function') {
    HomePetPetdex.deactivate();   // 置空 homePet.petdex，并清掉它的选择记忆
  } else {
    homePet.petdex = null;
  }
  homePet.character = id;
  try { localStorage.setItem(HOME_PET_STORE_KEY, id); } catch (_error) { }
  homePet.curAnim = 'idle';
  homePet.frameIdx = 0;
  homePetSetStatus((label || HOME_PET_CHAR_NAMES[id] || '伙伴') + ' 来啦！', true);
  if (typeof notifyListeningTodayGlass === 'function') notifyListeningTodayGlass();
  if (typeof HomePetSkin !== 'undefined' && HomePetSkin.refresh) HomePetSkin.refresh();
  return true;
}

function homePetCycleCharacter() {
  var ring = homePetSkinRing();
  if (!ring.length) return;
  var cur = homePetCurrentSkin();
  var index = -1;
  for (var i = 0; i < ring.length; i++) {
    if (ring[i].kind === cur.kind && ring[i].id === cur.id) { index = i; break; }
  }
  var next = ring[(index + 1) % ring.length];
  homePetSelectSkin(next.kind, next.id, next.name);
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
  // 首次散步给个延迟：nextWalkAt 初值是 0，不设的话第一次 tick 立刻就走
  if (!homePet.nextWalkAt) homePet.nextWalkAt = now + 7000;
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
  if (homePet.walkActive && now > homePet.walkUntil) {
    homePet.walkActive = false;
    // 第一版漏了这句：nextWalkAt 恒为 0，一轮走完下一帧立刻又满足条件，
    // 于是宠物看起来一直在左右走。现在走完歇 9~24 秒。
    homePet.nextWalkAt = now + 9000 + Math.random() * 15000;
  }

  // 待机小动作：打哈欠 / 伸懒腰 / 挥手 / 沉浸聆听，7~16 秒来一次（原来 20~50 秒）
  if (!sleeping && !homePet.walkActive && now > homePet.nextMicro && homePet.curAnim === 'idle') {
    homePet.microState = homePetPickIdleAct();
    homePet.microUntil = now + 2400 + Math.random() * 1600;
    homePet.nextMicro = now + 7000 + Math.random() * 9000;
    homePet.curAnim = homePet.microState;
    homePet.frameIdx = 0;
    var line = HOME_PET_MICRO_LINES[homePet.microState];
    if (line && Math.random() < 0.35) homePetSetStatus(line, true);
  } else if (homePet.microState && now > homePet.microUntil) {
    var wasAct = homePet.microState;
    homePet.microState = null;
    if (homePet.curAnim === wasAct) {
      homePet.curAnim = 'idle';
      homePet.frameIdx = 0;
    }
  }

  // 行走位移（卡内单元格），撞边折返。
  // 边界由 16b-pet-walk-bounds.js 算（纯函数、有单测）：walkX ∈ [-offX, cols-16-offX]，
  // 保证 petX ∈ [0, cols-16]，宠物整体始终在框内。
  var bounds = (typeof HomePetWalkBounds !== 'undefined' && HomePetWalkBounds.walkLimits)
    ? HomePetWalkBounds.walkLimits(homePet.cols, homePet.offX, 16)
    : { left: -homePet.offX, right: Math.max(-homePet.offX, homePet.cols - 16 - homePet.offX), span: 0, canWalk: false };
  if (homePet.walkActive && !sleeping && bounds.canWalk) {
    homePet.walkX += homePet.dir * 0.16;
    if (homePet.walkX <= bounds.left) {
      homePet.walkX = bounds.left; homePet.dir = 1;
      homePet.walkUntil = Math.max(homePet.walkUntil, now + 1500);
    } else if (homePet.walkX >= bounds.right) {
      homePet.walkX = bounds.right; homePet.dir = -1;
      homePet.walkUntil = Math.max(homePet.walkUntil, now + 1500);
    }
  } else {
    // 不走动（或画布太窄走不了）时回到居中：walkX=0 就是居中，因为 petX = offX + walkX
    homePet.walkX += (0 - homePet.walkX) * 0.06;
    if (Math.abs(homePet.walkX) < 0.02) homePet.walkX = 0;
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
  // Petdex 精灵优先：装了图片宠物就用 drawImage 播放序列帧，否则退回内置字符像素。
  // 帧索引按时间算（≈140ms/帧），不依赖 homePet.frameIdx —— 那个值只在切换状态时
  // 重置、从不自增，内置像素伙伴实际是静态帧 + 眨眼，拿它驱动精灵会不动。
  var petdexDrawn = false;
  if (homePet.petdex && typeof HomePetPetdex !== 'undefined' && HomePetPetdex.draw) {
    // 状态优先级：点击跳 > 微动作（伸懒腰/打哈欠）> 走路 > 睡觉 > idle。
    // 跳放最前，是为了睡觉时戳它也有反馈。
    var dexState = 'idle';
    if (now < homePet.jumpUntil) dexState = 'jump';
    else if (homePet.curAnim === 'sleep') dexState = 'sleep';
    else if (homePet.microState) dexState = homePet.microState;
    else if (homePet.walkActive) dexState = 'walk';
    // 帧间隔按动作区分（idle 慢、跑跳快），见 16a-pet-petdex-map.js
    var dexStep = typeof HomePetPetdex.frameMs === 'function' ? HomePetPetdex.frameMs(dexState) : 140;
    petdexDrawn = HomePetPetdex.draw(ctx, dexState, Math.floor(now / dexStep), homePet.dir);
  }
  if (!petdexDrawn) PetCore.drawPet(ctx, homePet.character, homePet.curAnim, homePet.frameIdx, blinking);
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
    // 必须回设 id：否则兜底条件每次都成立，点一次选照片就往 body 里
    // 追加一个隐藏 input 和一份 change 监听器，反复操作会持续泄漏。
    input.id = 'home-pet-photo-input';
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
        // 走统一切换：会顺带清掉 Petdex 状态（只改 character 的话，Petdex 精灵仍然优先绘制）
        homePetSelectSkin('photo', id, list[list.length - 1].name);
        homePetSetStatus('新伙伴上线！', true);
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
