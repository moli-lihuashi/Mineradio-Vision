'use strict';

/* 首页卡片封面（.home-card-art）定位守卫。
 *
 * 曾经的真实故障：开屏点击进入主界面时，「我的歌单」右下角的封面图标会先跑到
 * 卡片左侧、把卡片从 148px 撑到 212px，过一会儿才归位。
 * 根因不是动画也不是 JS —— 是 CSS 特异性打平后靠加载顺序决胜：
 *   .home-card-art{position:absolute}   (0,1,0)
 *   .home-skeleton{position:relative}   (0,1,0) 且位于文件更后 → 胜出
 * setHomeArt() 在「封面为空且仍在 loading」时给 art 加 home-skeleton，
 * 绝对定位立刻失效，封面掉进文档流撑开卡片；真实封面到达摘类后才跳回右下角。
 *
 * 守卫两件事：
 *   1) 必须存在把定位权还给封面的更高特异性规则；
 *   2) .home-skeleton 自己的 position 不能靠改顺序/改特异性重新压过封面。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HOME_CSS = read('public/css/02-home/home.css');
const VISUAL_CSS = read('public/css/02-visual/visual.css');
const HELPERS = read('public/js/modules/05-playback/01-cover-listen-helpers.js');

// ---- 1) 封面自身必须是绝对定位，且挂在卡片右下角 ----
const artRule = HOME_CSS.match(/\.home-card-art\{([^}]*)\}/);
assert(artRule, '.home-card-art 基础规则丢失');
const artBody = artRule[1];
assert(/position:absolute/.test(artBody), '.home-card-art 必须是 position:absolute');
assert(/right:\d+px/.test(artBody), '.home-card-art 必须锚定 right');
assert(/bottom:\d+px/.test(artBody), '.home-card-art 必须锚定 bottom');

// ---- 2) 骨架屏宿主规则不能直接压过封面：必须有 (0,2,0) 的还原规则 ----
const restore = HOME_CSS.match(/\.home-card-art\.home-skeleton\{([^}]*)\}/);
assert(restore, '缺少 .home-card-art.home-skeleton 定位还原规则（封面会被 home-skeleton 挤进文档流）');
assert(
  /position:absolute/.test(restore[1]),
  '.home-card-art.home-skeleton 必须把 position 还原成 absolute'
);

// 还原规则必须排在 .home-skeleton 之后，否则同特异性下会被反压
const idxSkeleton = HOME_CSS.indexOf('.home-skeleton{');
const idxRestore = HOME_CSS.indexOf('.home-card-art.home-skeleton{');
assert(idxSkeleton >= 0, '.home-skeleton 基础规则丢失');
assert(
  idxRestore > idxSkeleton,
  '.home-card-art.home-skeleton 必须写在 .home-skeleton 之后'
);

// ---- 3) 全仓不允许出现别处再用 (0,1,0) 把 art 改回 static/relative ----
const offenders = [];
const cssFiles = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (/\.css$/.test(d.name)) cssFiles.push(p);
  });
})(path.join(ROOT, 'public/css'));

cssFiles.forEach((file) => {
  // 先剥注释，否则注释里出现的 `.home-skeleton` 会被当成选择器拼进规则
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // 逐条规则扫：选择器命中 art 本体（不含伪元素）却声明了 position 的
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selGroup = m[1].trim();
    const body = m[2];
    if (!/(^|;)\s*position\s*:/.test(body)) continue;
    // 逗号分组逐个判断；伪元素（::before/::after）写 position 是它自己的事，与本条无关
    selGroup.split(',').forEach((raw) => {
      const sel = raw.trim().replace(/\s+/g, ' ');
      if (!/\.home-card-art/.test(sel)) return;
      if (/::?(before|after|placeholder|marker)\b/.test(sel)) return;
      if (/^\.home-card-art$/.test(sel)) return;                       // 基础规则，白名单
      if (/^\.home-card-art\.home-skeleton$/.test(sel)) return;        // 唯一允许的还原规则
      offenders.push(path.relative(ROOT, file) + ' :: ' + sel);
    });
  }
});
assert.deepStrictEqual(
  offenders, [],
  '以下规则会改写 .home-card-art 的 position，需确认不是 (0,1,0) 覆盖：\n' + offenders.join('\n')
);

// ---- 4) visual.css 的 `.home-card > *` 通配定位不能反向压过封面 ----
// 两者同为 (0,1,0)，靠加载顺序决胜：home.css 必须在 visual.css 之后加载。
const HTML = read('public/index.html');
const idxVisual = HTML.indexOf('02-visual/visual.css');
const idxHome = HTML.indexOf('02-home/home.css');
assert(idxVisual >= 0 && idxHome >= 0, 'index.html 缺少 visual.css 或 home.css');
assert(
  idxHome > idxVisual,
  'home.css 必须晚于 visual.css 加载，否则 `.home-card > *{position:relative}` 会压掉封面的 absolute'
);
assert(
  /\.home-card > \*\{position:relative/.test(VISUAL_CSS),
  'visual.css 的 `.home-card > *` 定位规则已变，需重新核对层叠关系'
);

// ---- 5) setHomeArt 的骨架屏开关条件保持不变（封面为空 + loading 才加） ----
assert(
  /classList\.toggle\('home-skeleton', !src && homeDiscoverState\.loading/.test(HELPERS),
  'setHomeArt 的 home-skeleton 条件已变，需复核是否会误加到有封面的 art 上'
);

console.log('home-card-art-position: ok');
