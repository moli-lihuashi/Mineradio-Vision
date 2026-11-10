/* Folia 世界 — 模式注册表
 *
 * 每个歌词样式在加载时注册一次：registerFoliaMode(id, def)。
 * def 契约（与 Folia 的 VisualizerRegistryEntry 同形，去掉 React）：
 *   { id, name, desc, create(host, ctx) -> instance | Promise<instance>, tick(instance, ctx), destroy(instance) }
 *
 * create 允许返回 Promise：需要动态 import 的样式（如 tilt 要 @chenglou/pretext 的 ESM 构建）
 * 才能先 await 依赖再建 DOM。返回 Promise 时运行时先放一个 __pending 占位实例，
 * 期间 tick 直接跳过；resolve 后替换为真实实例，reject 则退回原生并给出可见原因。
 *
 * ctx 由 03-folia-world-runtime.js 每帧构造一次，所有模式共享：
 *   { now, dt, time, index, lines, theme, audio, paused, showText, showTranslation, fontScale }
 * 模式只读 ctx，不得改它；有状态的动画放自己的 instance 上。
 *
 * 背景（壳层）也在这里注册：registerFoliaBackground(id, def)，契约见文件下半部分。
 */
'use strict';

var foliaModeRegistry = {};

function registerFoliaMode(id, def) {
  if (!id || !def || typeof def.create !== 'function') return null;
  var entry = {
    id: id,
    name: def.name || id,
    desc: def.desc || '',
    order: isFinite(Number(def.order)) ? Number(def.order) : 500,
    needsWebGL2: def.needsWebGL2 === true,
    create: def.create,
    tick: def.tick || null,
    destroy: def.destroy || null
  };
  foliaModeRegistry[id] = entry;
  return entry;
}

function getFoliaMode(id) {
  return foliaModeRegistry[id] || null;
}

function listFoliaModes() {
  var ids = Object.keys(foliaModeRegistry);
  var out = [];
  for (var i = 0; i < ids.length; i++) out.push(foliaModeRegistry[ids[i]]);
  out.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.id).localeCompare(String(b.id));
  });
  return out;
}

/* ---- 背景注册表 ----
 * Folia 的背景是「壳层」（src/components/visualizer/backgrounds/registry.tsx）：
 *   common 通用(10) / monet 莫奈(20) / nomand 漫游(30) / latent 隐现(35) / url 嵌入(40) / sora 空(50)
 * 每个背景的契约与模式同形，去掉 React：
 *   { id, name, desc, order, needsWebGL2, create(host, ctx) -> instance|Promise, tick(inst, ctx), destroy(inst) }
 * 背景画在模式**下面**（.folia-bg-host → .folia-mode-host），模式的 pixi 画布 backgroundAlpha=0，
 * 再由绘光/凝彩自己的暗场层按 darkField 压暗——与 Folia 的层级一致。
 */
var foliaBackgrounds = [];

function registerFoliaBackground(id, def) {
  if (!id || !def) return null;
  var entry = {
    id: id,
    name: def.name || id,
    desc: def.desc || '',
    order: isFinite(Number(def.order)) ? Number(def.order) : 500,
    needsWebGL2: def.needsWebGL2 === true,
    create: typeof def.create === 'function' ? def.create : null,
    tick: typeof def.tick === 'function' ? def.tick : null,
    destroy: typeof def.destroy === 'function' ? def.destroy : null
  };
  for (var i = foliaBackgrounds.length - 1; i >= 0; i--) {
    if (foliaBackgrounds[i].id === id) foliaBackgrounds.splice(i, 1);
  }
  foliaBackgrounds.push(entry);
  foliaBackgrounds.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.id).localeCompare(String(b.id));
  });
  return entry;
}

/* 本项目保留的「无背景」：Folia 侧没有这一项（它的默认是隐现），
 * 而 Mineradio 的 Folia 世界是可选叠加层，默认保持原样最不惊扰，所以留一个空壳并排在最前。 */
registerFoliaBackground('none', {
  name: '无背景',
  desc: '纯色暗场',
  order: 0
});

function getFoliaBackground(id) {
  for (var i = 0; i < foliaBackgrounds.length; i++) {
    if (foliaBackgrounds[i].id === id) return foliaBackgrounds[i];
  }
  return foliaBackgrounds[0] || null;
}

/* getFoliaBackground 对未知 id 会返回第一项（兜底），所以「有没有注册过」
 * 必须单独问一句 —— 读档校正要靠它分辨「用户选的就是无背景」和「选的已不存在」。 */
function hasFoliaBackground(id) {
  for (var i = 0; i < foliaBackgrounds.length; i++) {
    if (foliaBackgrounds[i].id === id) return true;
  }
  return false;
}

function listFoliaBackgrounds() {
  return foliaBackgrounds.slice();
}
