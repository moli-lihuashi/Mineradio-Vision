'use strict';

// 壁纸模式「桌面效果层」的呈现守卫 —— 2026-11-21 重写
//
// 现在的形态（用户定案）：
//   播放器窗口      → 完全不动：任务栏、标题栏、控制条、交互全部保留
//   桌面效果层      → 另一张透明全屏窗（?stage=1），只画粒子+歌词；
//                     原世界不显示内置壁纸（要和用户自己的 Wallpaper Engine 共生），
//                     Folia 世界只留歌词、背景壳层摘掉
//   退出            → 再点一次开关，不再有「双击 Esc」
//
// 守五件事：
//   1. CSS 的隐藏清单与 JS 导出的三份清单逐条对齐（只改一边 = 有一层漏出来）
//   2. 该留的舞台层不能被误伤（画布 / 原生歌词 / Folia root / toast）
//   3. 首帧闸门（html.wp-stage）必须覆盖同一份清单，且只认 ?stage=1（兼容旧 ?wallpaper=1）
//   4. 主窗口不得再进入舞台态（setWallpaperStageWanted 已删除）
//   5. 不再存在任何 Esc 退出判定

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CSS_FILE = 'public/css/10-shell/wallpaper-stage.css';
const HTML_FILE = 'public/index.html';
const STAGE_MODULE = 'public/js/modules/10-shell/08-wallpaper-stage.js';
const SYNC_MODULE = 'public/js/modules/10-shell/09-wallpaper-stage-sync.js';
const OVERLAY_MODULE = 'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js';

function cssText() {
  return fs.readFileSync(path.join(root, CSS_FILE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/* 按「顶层逗号」切选择器列表。不能用 split(',')：:is(body.a, html.b) 里的逗号
 * 不是选择器分隔符，直接切会把一个选择器劈成两半，之后的比对全部失真。 */
function splitSelectors(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function cssRules(text) {
  return text.split('}').map((block) => block.trim()).filter(Boolean).map((block) => {
    const brace = block.indexOf('{');
    if (brace < 0) return { selectors: [], body: '' };
    return { selectors: splitSelectors(block.slice(0, brace)), body: block.slice(brace + 1) };
  });
}

function hidesSelector(rules, scopeClass, selector) {
  const scopePattern = new RegExp(
    '(^|[^-\\w.])' + scopeClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![-\\w])'
  );
  for (const rule of rules) {
    if (!/display:\s*none/.test(rule.body)) continue;
    for (const sel of rule.selectors) {
      if (!sel.endsWith(' ' + selector)) continue;
      const scope = sel.slice(0, sel.length - selector.length - 1);
      if (scopePattern.test(scope)) return true;
    }
  }
  return false;
}

const stage = require('../public/js/modules/10-shell/08-wallpaper-stage');

test('JS 导出的「播放器本体」清单每一条都在 CSS 里被 body.wallpaper-stage 隐藏', () => {
  const rules = cssRules(cssText());
  const missing = stage.CHROME_SELECTORS.filter((sel) => !hidesSelector(rules, 'body.wallpaper-stage', sel));
  assert.deepEqual(missing, [], '这些层在 JS 清单里但 CSS 没隐藏：' + missing.join(', '));
});

test('JS 导出的「背景层」清单每一条都在 CSS 里被隐藏（内置壁纸不显示、透出 WE 壁纸）', () => {
  const rules = cssRules(cssText());
  const missing = stage.BACKDROP_LAYERS.filter((sel) => !hidesSelector(rules, 'body.wallpaper-stage', sel));
  assert.deepEqual(missing, [], '这些背景层在 JS 清单里但 CSS 没隐藏：' + missing.join(', '));
});

test('JS 导出的「Folia 之下要摘掉的原生舞台层」每一条都在 CSS 里被 body.wallpaper-stage-folia 隐藏', () => {
  const rules = cssRules(cssText());
  const missing = stage.NATIVE_LAYERS.filter((sel) => !hidesSelector(rules, 'body.wallpaper-stage-folia', sel));
  assert.deepEqual(missing, [], '这些层在 JS 清单里但 CSS 没隐藏：' + missing.join(', '));
});

test('首帧闸门：同一份清单也必须被 html.wp-stage / html.wp-stage-folia 覆盖', () => {
  const rules = cssRules(cssText());
  const missingChrome = stage.CHROME_SELECTORS.filter((sel) => !hidesSelector(rules, 'html.wp-stage', sel));
  assert.deepEqual(missingChrome, [], '这些层在 html.wp-stage 下没隐藏：' + missingChrome.join(', '));
  const missingBackdrop = stage.BACKDROP_LAYERS.filter((sel) => !hidesSelector(rules, 'html.wp-stage', sel));
  assert.deepEqual(missingBackdrop, [], '这些背景层在 html.wp-stage 下没隐藏：' + missingBackdrop.join(', '));
  const missingNative = stage.NATIVE_LAYERS.filter((sel) => !hidesSelector(rules, 'html.wp-stage-folia', sel));
  assert.deepEqual(missingNative, [], '这些层在 html.wp-stage-folia 下没隐藏：' + missingNative.join(', '));
});

test('index.html 的首帧脚本必须在任何样式表之前执行，且认 ?stage=1', () => {
  const html = fs.readFileSync(path.join(root, HTML_FILE), 'utf8');
  const gateAt = html.indexOf("classList.add('wp-stage')");
  assert.ok(gateAt > 0, 'index.html 里没有首帧舞台态脚本');
  const firstStyleAt = html.search(/<link[^>]+rel=["']stylesheet["']/i);
  assert.ok(firstStyleAt > 0, 'index.html 里找不到样式表链接');
  assert.ok(gateAt < firstStyleAt, '首帧脚本排在样式表之后，第一帧照样会画出 chrome');
  assert.match(html, /\[\?&\]stage=1/, '首帧脚本没按 ?stage=1 判定');
  assert.match(html, /__MINERADIO_STAGE_PAGE__/, '首帧脚本没给模块留效果层标记');
  assert.match(html, /stageWorld/, '首帧脚本没读 stageWorld，Folia 世界会先画出原生舞台层');
});

test('wallpaper-stage.css 的缓存版本串必须带 ?v=（改 CSS 不 bump 会走磁盘缓存）', () => {
  const html = fs.readFileSync(path.join(root, HTML_FILE), 'utf8');
  assert.match(html, /wallpaper-stage\.css\?v=[\w.-]+/, 'wallpaper-stage.css 缺少 ?v= 版本串');
});

test('该留的舞台层不在「播放器本体 / 背景层」清单里', () => {
  for (const sel of ['#canvas-container', '#stage-lyrics', '#folia-world-root', '#toast']) {
    assert.ok(!stage.CHROME_SELECTORS.includes(sel), sel + ' 是舞台层，不该当作播放器本体隐藏');
    assert.ok(!stage.BACKDROP_LAYERS.includes(sel), sel + ' 是舞台层，不该当作背景层隐藏');
  }
  // 原生画布/行层只允许出现在「Folia 下摘掉」的清单里
  assert.ok(stage.NATIVE_LAYERS.includes('#canvas-container'));
  assert.ok(stage.NATIVE_LAYERS.includes('#stage-lyrics'));
});

test('内置壁纸与玻璃镜像必须在背景层清单里（用户要求不显示内置壁纸）', () => {
  assert.ok(stage.BACKDROP_LAYERS.includes('#wallpaper-engine-layer'),
    '内置壁纸层必须隐藏，否则会盖住用户自己的 Wallpaper Engine');
  assert.ok(stage.BACKDROP_LAYERS.includes('#wallpaper-engine-glass-mirror'),
    '玻璃镜像画布必须隐藏（回读快照会露出一块半透明卡片）');
});

test('壁纸模式下禁用整屏场景样式：花火/町景/雾笺/凝彩/隐喻', () => {
  const state = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/00-folia-state.js'), 'utf8');
  assert.match(state, /FOLIA_WALLPAPER_BLOCKED_MODES\s*=\s*\['hanabi',\s*'machi',\s*'nebbia',\s*'tempera',\s*'metaphor'\]/,
    '禁用清单必须正好是这五个整屏场景样式（2026-11-27 +隐喻：它整屏铺纸，不是叠在壁纸上的效果层）');
  assert.match(state, /function foliaModeBlockedInWallpaper/, '缺少统一的判定函数');
  const panel = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/04-folia-panel.js'), 'utf8');
  assert.match(panel, /foliaModeBlockedInWallpaper\(mode\.id\)/, '面板没有读取禁用判定');
  assert.match(panel, /card\.disabled = true/, '面板没有真正禁用按钮');
  const runtime = fs.readFileSync(path.join(root, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');
  assert.match(runtime, /foliaModeBlockedInWallpaper\(id\)/, '切换样式时缺少兜底守卫');
  assert.match(runtime, /function foliaWorldSanitizeModeForWallpaper/, '进入世界前要把存档里的被禁样式换掉');
  const overlay = fs.readFileSync(path.join(root, 'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js'), 'utf8');
  assert.match(overlay, /FOLIA_WALLPAPER_BLOCKED_MODES/, '开壁纸时要把不透明样式切回流光');
  const sync = fs.readFileSync(path.join(root, 'public/js/modules/10-shell/09-wallpaper-stage-sync.js'), 'utf8');
  assert.match(sync, /FOLIA_WALLPAPER_BLOCKED_MODES/, '效果层同步必须用同一份清单');
});

test('#toast 必须留着：启动失败的原因要靠它说话', () => {
  const rules = cssRules(cssText());
  assert.equal(hidesSelector(rules, 'body.wallpaper-stage', '#toast'), false, '#toast 被隐藏了，回落就不可见了');
});

test('Folia 舞台：root 底色必须转透明、背景壳层必须摘掉', () => {
  const text = cssText();
  assert.match(text, /#folia-world-root\s*\{[^}]*background:\s*transparent\s*!important/,
    'Folia root 底色没转透明，「悬浮在桌面上」就成了不透明块');
  assert.match(text, /#folia-world-root \.folia-bg-host\s*\{[^}]*display:\s*none/,
    'Folia 背景壳层没摘掉，就不止剩歌词了');
});

test('整页透明：效果层不能画出自己的底色（否则 WE 壁纸被盖住）', () => {
  const text = cssText();
  assert.match(text, /:is\(html\.wp-stage, body\.wallpaper-stage\)[\s\S]{0,120}background:\s*transparent/,
    '效果层根节点必须透明');
});

test('效果层判定只看页面标记，不再看 desktop-wallpaper-mode', () => {
  const source = fs.readFileSync(path.join(root, STAGE_MODULE), 'utf8');
  assert.ok(/__MINERADIO_STAGE_PAGE__/.test(source), '模块要读效果层标记');
  assert.ok(!/desktop-wallpaper-mode/.test(source), '主窗口不再进入舞台态，不该再读 desktop-wallpaper-mode');
  assert.ok(!/setWallpaperStageWanted/.test(source), '旧入口已删除，不该再导出');
  assert.ok(!/wallpaperStageEscapeTap/.test(source), '双击 Esc 已取消，不该再保留判定函数');
});

test('主窗口不得再调用 setWallpaperStageWanted（否则播放器会被藏成空舞台）', () => {
  const overlay = fs.readFileSync(path.join(root, OVERLAY_MODULE), 'utf8');
  assert.ok(!/setWallpaperStageWanted\(/.test(overlay),
    '04 还在切舞台态：主窗口会再次变成「只剩粒子」的半死状态');
});

test('舞台态 class 由页面标记推出（body + html 同步）', () => {
  const state = new Set();
  const makeClassList = (target) => ({
    contains: (name) => target.has(name),
    toggle: (name, force) => { if (force) target.add(name); else target.delete(name); },
    add: (name) => target.add(name),
    remove: (name) => target.delete(name),
  });
  const bodyState = new Set();
  const rootState = new Set(['wp-stage']);
  const previousDocument = globalThis.document;
  const previousFlag = globalThis.__MINERADIO_STAGE_PAGE__;
  globalThis.__MINERADIO_STAGE_PAGE__ = true;
  globalThis.document = {
    body: { classList: makeClassList(bodyState) },
    documentElement: { classList: makeClassList(rootState) },
  };
  void state;
  try {
    stage.syncWallpaperStagePresentation();
    assert.ok(bodyState.has('wallpaper-stage'), '效果层页面没挂 wallpaper-stage');
    assert.ok(!bodyState.has('wallpaper-stage-folia'), '原生世界不该挂 folia class');
    assert.ok(rootState.has('wp-stage'), 'html 上的首帧标记被摘掉了');
  } finally {
    globalThis.document = previousDocument;
    globalThis.__MINERADIO_STAGE_PAGE__ = previousFlag;
  }
});

test('预设同步：同曲换预设也要生效，且全屏 UI 预设不照搬', () => {
  const sync = fs.readFileSync(path.join(root, 'public/js/modules/10-shell/09-wallpaper-stage-sync.js'), 'utf8');
  assert.match(sync, /function stageApplyPreset\(/, '缺少 stageApplyPreset');
  assert.match(sync, /STAGE_PRESET_SKIP_INDICES\s*=\s*\[11\]/,
    '只有 11 经典（纯 DOM 播放器界面）需要跳过；10 音域回响走共享 three 场景，必须同步');
  // sameSong 分支以前直接 return，导致 full 到了但预设被丢掉（用户实测：切预设桌面不动）
  const sameSongBlock = sync.slice(sync.indexOf('var sameSong ='), sync.indexOf('if (typeof applyPlaybackSession'));
  assert.match(sameSongBlock, /stageApplyPreset\(full\.visualPreset\)/,
    '同一首歌换预设时也必须应用预设');
  const pulseBlock = sync.slice(sync.indexOf("session.kind === 'pulse'"), sync.indexOf('stageSyncPosition(session.position'));
  assert.match(pulseBlock, /stageApplyPreset\(session\.preset\)/,
    'pulse 也要带预设，否则 full 15s 才刷一次');
});

test('非效果层页面：wallpaperStageOnly() 必须为 false（主窗口不进入舞台态）', () => {
  const previousDocument = globalThis.document;
  const previousFlag = globalThis.__MINERADIO_STAGE_PAGE__;
  globalThis.__MINERADIO_STAGE_PAGE__ = undefined;
  const bodyState = new Set(['desktop-wallpaper-mode', 'folia-world-active']);
  globalThis.document = {
    body: {
      classList: {
        contains: (name) => bodyState.has(name),
        toggle: () => {},
        add: () => {},
        remove: () => {},
      },
    },
    documentElement: { classList: { contains: () => false, toggle: () => {}, add: () => {}, remove: () => {} } },
  };
  try {
    assert.equal(stage.wallpaperStageOnly(), false,
      '主窗口即使带着 desktop-wallpaper-mode 也不能被当成效果层');
  } finally {
    globalThis.document = previousDocument;
    globalThis.__MINERADIO_STAGE_PAGE__ = previousFlag;
  }
});

test('帧率设置必须真的进效果层：设置类消息不能被 session 早退丢掉', () => {
  const sync = fs.readFileSync(path.join(root, SYNC_MODULE), 'utf8');
  const handler = sync.slice(sync.indexOf('function stageHandleState'), sync.indexOf('/* 效果层只要'));
  assert.match(handler, /state\.frameRate/, 'stageHandleState 没有读 state.frameRate：面板里的 24/30/60 是死开关');
  assert.match(handler, /fx\.wallpaperFps\s*=/, '读到了但没有写进 fx.wallpaperFps，主循环节流不会变');
  assert.ok(handler.indexOf('state.frameRate') < handler.indexOf('if (!session) return;'),
    '必须在 session 早退之前处理，否则「只发设置」的消息永远到不了这一段');
});

test('效果层不允许把播放器的提示条弹到桌面上', () => {
  const sync = fs.readFileSync(path.join(root, SYNC_MODULE), 'utf8');
  assert.match(sync, /setPreset\(p, \{[^}]*silent: true/,
    'stageApplyPreset 没给 silent：每换一次预设桌面都会弹「视觉预设: xxx」');
  assert.match(sync, /foliaWorldEnter\(\{ silent: true \}\)/,
    'stageApplyWorld / stageApplyFolia 进 Folia 时会弹「已进入 Folia 世界」到桌面');
  const session = fs.readFileSync(path.join(root, 'public/js/modules/05-playback/00c-home-session.js'), 'utf8');
  assert.match(session, /setPreset\(session\.visualPreset, \{[^}]*silent: opts\.silent === true/,
    'applyPlaybackSession 恢复会话时也会弹预设提示（silent 要跟随调用方）');
});

test('效果层不解码自定义背景视频（#custom-bg 已隐藏，多解一份纯浪费）', () => {
  const src = fs.readFileSync(path.join(root, 'public/js/modules/07-fx/01-lyric-color-accent.js'), 'utf8');
  const head = src.slice(src.indexOf('function applyCustomBackground()'), src.indexOf('function applyCustomBackground()') + 900);
  assert.match(head, /isWallpaperStagePage\(\)/, 'applyCustomBackground 在效果层没有短路：会多解一路背景视频');
  assert.match(head, /stageBgVideo\.pause\(\)/, '短路时要确保背景视频真的停了');
});

test('置底失败必须让用户看见（回落不能静默）', () => {
  const overlay = fs.readFileSync(path.join(root, OVERLAY_MODULE), 'utf8');
  assert.match(overlay, /status\.zOrder === 'none'[\s\S]{0,200}showToast/,
    'zOrder=none 时没有任何提示：效果层会「成功开启」但其实浮在所有窗口上面');
  assert.match(overlay, /desktopWallpaperZOrderWarned/, '提示要有一次性闸门，不能每秒弹一条');
});

test('壁纸模式下主窗口只控不渲染：画布/歌词/背景层让位，提示卡出现', () => {
  const text = cssText();
  assert.match(text, /body\.wallpaper-host-cast #canvas-container[\s\S]{0,900}?display:\s*none/,
    '舞台画布没被摘掉：播放器会继续跑一份一模一样的粒子渲染');
  assert.match(text, /body\.wallpaper-host-cast #stage-lyrics/, '3D 歌词没让位');
  assert.match(text, /body\.wallpaper-host-cast #folia-world-root/, 'Folia 舞台没让位');
  /* 背景层必须一起摘：用户实机截图里播放器窗口透出了桌面/WE 壁纸 */
  assert.match(text, /body\.wallpaper-host-cast #custom-bg/, '#custom-bg 没摘，播放器会露出自定义背景');
  assert.match(text, /body\.wallpaper-host-cast #album-bg/, '#album-bg 没摘，播放器会露出封面模糊底');
  assert.match(text, /body\.wallpaper-host-cast #wallpaper-engine-layer/, '内置 WE 壁纸层没摘');
  /* 摘掉背景层后必须自己补不透明底，否则窗口整张透明 */
  assert.match(text, /body\.wallpaper-host-cast,?[\s\S]{0,160}#desktop-window-shell[\s\S]{0,160}background:\s*var\(--custom-bg-color/,
    '缺少窗口不透明底：背景层摘完后播放器会透出桌面');
  /* 底色只能画在外壳上（外壳有 border-radius + clip-path）；画到 body 上会填满四个角，
   * 窗口就变成方角了（2026-11-21 用户反馈） */
  assert.ok(!/body\.wallpaper-host-cast\s*\{[^}]*background:/.test(text),
    'body 被涂了底色：34px 圆角之外的四个角会被填满，播放器窗口会变方角');
  const html = fs.readFileSync(path.join(root, HTML_FILE), 'utf8');
  assert.match(html, /id="wallpaper-cast-hint"/, '缺少「已投到桌面」提示卡');
  assert.match(html, /歌词写真已投到桌面/, '提示文案不对');
  assert.match(text, /body\.wallpaper-stage #wallpaper-cast-hint[\s\S]{0,220}?display:\s*none/,
    '效果层页面必须隐藏提示卡（那是桌面，不该有播放器提示）');
});

test('只控不渲染态：主循环必须在 renderer.render 之前返回', () => {
  const loop = fs.readFileSync(path.join(root, 'public/js/modules/11-main-loop.js'), 'utf8');
  const animStart = loop.indexOf('function animate()');
  const castAt = loop.indexOf('isWallpaperHostCastRenderSuppressed', animStart);
  const renderAt = loop.lastIndexOf('renderer.render(scene, camera);');
  assert.ok(castAt > 0, '主循环没有读只控不渲染判据');
  assert.ok(renderAt > castAt, '判据在渲染之后：那一帧照样把整个场景画了一遍');
  const gate = loop.slice(castAt - 120, castAt + 420);
  assert.match(gate, /return;/, '判据分支没有提前返回');
  assert.match(gate, /syncDesktopOverlayState/, '提前返回前要保留桌面歌词/状态推送');
});

test('只控不渲染态：渲染器缩到 4×4，且面板预览时不缩', () => {
  const globals = fs.readFileSync(path.join(root, 'public/js/modules/00-state/12d-fx-runtime-globals.js'), 'utf8');
  const fn = globals.slice(globals.indexOf('function applyRendererPowerMode'), globals.indexOf('function applyRendererPowerMode') + 1200);
  assert.match(fn, /isWallpaperHostCastRenderSuppressed/, '功耗模式没有读壁纸只控不渲染判据');
  assert.match(fn, /var shrink = deep \|\| hostCast;/, '尺寸收缩没有把 hostCast 算进去');
  assert.match(fn, /shrink \? 4/, '收缩尺寸不是 4×4');
  const modeFn = globals.slice(globals.indexOf('function isWallpaperHostCastMode'), globals.indexOf('function isWallpaperHostCastMode') + 520);
  assert.match(modeFn, /isWallpaperStagePage\(\)/, '判据没有排除效果层页面：桌面会被自己关掉渲染');
  assert.match(modeFn, /fx\.wallpaperMode !== true/, '判据没有绑定壁纸开关');
});

test('视觉控制台只在真正动控件时给短暂预览（打开面板不得恢复整块渲染）', () => {
  const overlay = fs.readFileSync(path.join(root, OVERLAY_MODULE), 'utf8');
  assert.match(overlay, /function wallpaperHostCastPreviewRequested/, '缺少控件交互预览判据');
  const previewFn = overlay.slice(overlay.indexOf('function wallpaperHostCastPreviewRequested'), overlay.indexOf('function wallpaperHostCastPreviewRequested') + 260);
  assert.match(previewFn, /wallpaperHostCastPreviewUntil/, '预览窗口没有到期时间：打开面板就会一直恢复渲染');
  assert.ok(!/classList\.contains\('show'\)/.test(previewFn), '预览判据还在看面板是否打开：点 FX 就会恢复整块舞台');
  assert.match(overlay, /function noteWallpaperHostCastPreview/, '缺少控件交互入口');
  assert.match(overlay, /addEventListener\(name, onInteraction, true\)/, '没有监听面板控件事件');
  assert.match(overlay, /'input', 'change', 'click'/, '监听的事件类型不完整');
  /* 预设卡会经 stage 同步到桌面，不该触发只控态预览：否则点一下预设，
   * host-cast 类被摘掉，提示卡会消失 1.2s 再回来（2026-11-21 用户反馈）。 */
  const bindFn = overlay.slice(overlay.indexOf('function bindWallpaperHostCastPanel'), overlay.indexOf('function bindWallpaperHostCastPanel') + 1400);
  assert.ok(!/data-preset/.test(bindFn), '预设卡还在触发预览：切换预设时提示卡会消失一会儿');
});
