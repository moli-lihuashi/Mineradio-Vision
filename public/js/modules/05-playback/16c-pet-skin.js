(function (global) {
  'use strict';

  // ====================================================================
  //  皮肤弹层 · 桌面宠物板块（16c）
  //
  //  为什么单独一个模块：宠物有三类来源（内置 7 只 / 照片生成 / Petdex 导入），
  //  切换时必须互斥地清掉另一类的绘制状态（尤其 Petdex：它一旦占住 homePet.petdex，
  //  字符像素分支就永远不会执行）。这里只负责「列出来 + 点一下调统一切换」，
  //  真正的切换语义在 14-home-pet.js 的 homePetSelectSkin。
  //
  //  与皮肤弹层其它格子共用一套观感（深色玻璃 3 列格），但**不能复用 .heart-fx-grid**：
  //  07-fx/05d 用 .heart-fx-grid 作为宿主选择器，复用会被它的 innerHTML 覆盖。
  // ====================================================================

  var GRID_ID = 'skin-pet-grid';
  var NOTE_ID = 'skin-pet-note';
  var THUMB_W = 32;
  var THUMB_H = 34;

  var observer = null;

  function el(id) { return document.getElementById(id); }

  function ring() {
    return typeof global.homePetSkinRing === 'function' ? global.homePetSkinRing() : [];
  }

  function current() {
    if (typeof global.homePetCurrentSkin === 'function') return global.homePetCurrentSkin();
    var chr = (global.homePet && global.homePet.character) || '';
    return { kind: /^buddy-/.test(chr) ? 'photo' : 'builtin', id: chr };
  }

  function setNote(text) {
    var node = el(NOTE_ID);
    if (node) node.textContent = text || '';
  }

  // Petdex 缩略图：本地已是缓存文件，直接取第 0 行第 1 帧画进 32×34 画布。
  function paintPetdexThumb(ctx, slug) {
    var api = global.Mineradio && global.Mineradio.api;
    if (!api || typeof api.apiMediaProxyUrlAsync !== 'function') return;
    api.apiMediaProxyUrlAsync('/api/pets/local/asset', { slug: slug }).then(function (src) {
      var img = new Image();
      img.onload = function () {
        try {
          ctx.drawImage(img, 0, 0, 192, 208, 0, 0, THUMB_W, THUMB_H);
        } catch (_) { }
      };
      img.src = src;
    }).catch(function () { });
  }

  function makeThumb(item) {
    var canvas = document.createElement('canvas');
    canvas.className = 'pet-skin-thumb';
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    if (item.kind === 'petdex') {
      paintPetdexThumb(ctx, item.id);
      return canvas;
    }
    // 内置 / 照片：PetCore 的字符像素，16×16 放大两倍（保持像素感）
    if (typeof global.PetCore !== 'undefined' && global.PetCore.drawPet) {
      try {
        ctx.imageSmoothingEnabled = false;
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        global.PetCore.drawPet(ctx, item.id, 'idle', 0, false);
      } catch (_) { }
    }
    return canvas;
  }

  function render() {
    var grid = el(GRID_ID);
    if (!grid) return;
    var list = ring();
    var cur = current();
    if (!list.length) {
      grid.innerHTML = '<div class="pet-skin-empty">还没有可选伙伴</div>';
      setNote('');
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (item) {
      var on = item.kind === current().kind && item.id === cur.id;
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'pet-skin-tile' + (on ? ' active' : '');
      tile.setAttribute('aria-pressed', on ? 'true' : 'false');
      tile.setAttribute('data-pet-kind', item.kind);
      tile.setAttribute('data-pet-id', item.id);
      tile.title = item.name + ' · ' + item.label;
      tile.appendChild(makeThumb(item));

      var name = document.createElement('span');
      name.className = 'pet-skin-name';
      name.textContent = item.name;
      tile.appendChild(name);

      var sub = document.createElement('span');
      sub.className = 'pet-skin-sub';
      sub.textContent = item.label;
      tile.appendChild(sub);
      frag.appendChild(tile);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);

    var curItem = list.filter(function (i) { return i.kind === cur.kind && i.id === cur.id; })[0];
    setNote('共 ' + list.length + ' 只' + (curItem ? ' · 当前：' + curItem.name : ''));
  }

  function selectFromTile(tile) {
    if (!tile) return;
    var kind = tile.getAttribute('data-pet-kind');
    var id = tile.getAttribute('data-pet-id');
    if (!kind || !id) return;
    var nameNode = tile.querySelector('.pet-skin-name');
    var name = nameNode ? nameNode.textContent : '';
    if (typeof global.homePetSelectSkin === 'function') {
      global.homePetSelectSkin(kind, id, name);
    }
    render();
  }

  // Petdex 已装列表是异步的：先刷新再渲染，避免 ⇄ 轮换时漏掉 petdex 项
  function refresh() {
    if (typeof global.HomePetPetdex !== 'undefined' && global.HomePetPetdex.refreshInstalled) {
      global.HomePetPetdex.refreshInstalled().then(render, render);
      return;
    }
    render();
  }

  function bind() {
    var grid = el(GRID_ID);
    if (grid) {
      grid.addEventListener('click', function (e) {
        var tile = e.target.closest ? e.target.closest('.pet-skin-tile') : null;
        if (tile && grid.contains(tile)) selectFromTile(tile);
      });
    }

    var popover = el('skin-popover');
    if (popover) {
      popover.addEventListener('click', function (e) {
        var act = e.target.closest ? e.target.closest('[data-pet-act]') : null;
        if (!act || !popover.contains(act)) return;
        var kind = act.getAttribute('data-pet-act');
        if (kind === 'photo') {
          if (typeof global.homePetPickPhoto === 'function') global.homePetPickPhoto();
          else setNote('照片生成还没就绪');
        } else if (kind === 'petdex') {
          if (typeof global.HomePetPetdex !== 'undefined' && global.HomePetPetdex.openPanel) {
            global.HomePetPetdex.openPanel();
          } else {
            setNote('Petdex 模块还没加载');
          }
        }
      });
    }

    // 弹层显隐靠 body.skin-popover-open，这里只观察它，不改 07-fx 的开关逻辑
    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(function () {
        if (document.body.classList.contains('skin-popover-open')) refresh();
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  global.HomePetSkin = {
    render: render,
    refresh: refresh,
    ring: ring,
    current: current
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
  } else {
    bind();
    render();
  }
})(typeof window !== 'undefined' ? window : globalThis);
