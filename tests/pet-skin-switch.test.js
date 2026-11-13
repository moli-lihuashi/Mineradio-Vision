'use strict';

// 宠物切换的静态守卫。
//
// 守的是什么：第一版 Petdex 宠物一旦装上，卡片上的 ⇄ 就失效 —— 它只改
// homePet.character，而绘制层 `if (homePet.petdex) 走图片` 优先级更高，
// 所以按了等于没按。同类问题还有：换照片时没清 petdex，生成完仍显示旧宠物。
// 现在统一到 homePetSelectSkin，切到非 Petdex 必须让 Petdex 模块 deactivate。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const PET = 'public/js/modules/05-playback/14-home-pet.js';
const SKIN = 'public/js/modules/05-playback/16c-pet-skin.js';
const HTML = 'public/index.html';
const LOADER = 'public/js/index-loader.js';

test('切换入口存在且唯一：homePetSelectSkin / homePetSkinRing / homePetCurrentSkin', () => {
  const src = read(PET);
  assert.match(src, /function homePetSelectSkin\s*\(/, '必须有统一切换函数');
  assert.match(src, /function homePetSkinRing\s*\(/, '必须有跨类型皮肤清单');
  assert.match(src, /function homePetCurrentSkin\s*\(/, '必须能判断当前是哪一类');
});

test('切到非 Petdex 时必须清掉 Petdex 状态（否则绘制层仍走图片，按了没反应）', () => {
  const src = read(PET);
  const fn = src.slice(src.indexOf('function homePetSelectSkin'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /HomePetPetdex\.deactivate\(\)/, '非 Petdex 分支必须调 deactivate');
  assert.match(body, /homePet\.petdex = null/, 'deactivate 不可用时也要直接置空');
});

test('⇄ 走跨类型清单，不再只遍历内置角色', () => {
  const src = read(PET);
  const fn = src.slice(src.indexOf('function homePetCycleCharacter'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /homePetSkinRing\(\)/, '轮换必须基于完整的皮肤清单');
  assert.match(body, /homePetSelectSkin\(/, '轮换必须走统一切换');
  assert.ok(!/Object\.keys\(HOME_PET_CHAR_NAMES\)/.test(body), '不该再只看内置角色表');
});

test('照片生成后走统一切换（否则 Petdex 精灵会继续占着画面）', () => {
  const src = read(PET);
  assert.match(src, /homePetSelectSkin\('photo',\s*id/, '照片生成后必须调 homePetSelectSkin');
});

test('卡片只留一个切换按钮，照片/Petdex 入口收进皮肤弹层', () => {
  const html = read(HTML);
  // 卡片上的按钮区
  const card = html.slice(html.indexOf('home-pet-card'), html.indexOf('home-pet-dex'));
  assert.ok(!/homePetPickPhoto\(\)/.test(card), '卡片上不该再有「用照片生成」按钮');
  assert.ok(!/HomePetPetdex\.togglePanel\(\)/.test(card), '卡片上不该再有 Petdex 面板按钮');
  const swapCount = (card.match(/class="home-pet-swap"/g) || []).length;
  assert.equal(swapCount, 1, '卡片上应只剩一个 ⇄，实际 ' + swapCount + ' 个');
  assert.match(card, /homePetCycleCharacter\(\)/);
});

test('皮肤弹层里有宠物板块，且加载了 16c 模块', () => {
  const html = read(HTML);
  assert.match(html, /id="skin-pet-grid"/, '皮肤弹层必须有宠物格子容器');
  assert.match(html, /data-pet-act="photo"/, '要有「用照片生成」入口');
  assert.match(html, /data-pet-act="petdex"/, '要有「从 Petdex 导入」入口');
  assert.match(read(LOADER), /16c-pet-skin\.js/, 'index-loader 必须加载 16c');
});

test('宠物格子不能复用 heart-fx 系列类名（07-fx/05d 用它当宿主，会被覆盖）', () => {
  const src = read(SKIN);
  const html = read(HTML);
  // JS 里不许把 heart-fx-grid / heart-fx-tile 当类名用（注释里提到不算）
  assert.ok(!/['"]heart-fx-grid['"]/.test(src),
    '16c 不能用 heart-fx-grid 作为类名，否则 renderHeartFxGrid 会覆盖宠物格子的 innerHTML');
  assert.ok(!/['"]heart-fx-tile['"]/.test(src), '16c 不能用 heart-fx-tile 当类名');
  // 容器用自己的类（类在 HTML 上，JS 只认 id）
  assert.match(html, /class="pet-skin-grid"\s+id="skin-pet-grid"/, '容器应使用独立的 pet-skin-grid 类');
  assert.match(src, /pet-skin-tile/, '格子用独立的 pet-skin-tile 类');
});
