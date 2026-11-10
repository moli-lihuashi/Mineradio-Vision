'use strict';

// =============================================================================
// 「歌词显示」功能删除 / 「桌面歌词」只删按钮 —— 回归守卫（2026-11-08）
// -----------------------------------------------------------------------------
// 用户要求不对称，必须同时守住两侧：
//   · 歌词显示 = 功能级彻底删除（按钮、L 键、开关函数、状态同步、旧存档恢复）；
//   · 桌面歌词 = 只删快捷菜单的重复按钮，功能/热键/视觉控制台入口完整保留。
// 检测写成纯函数，并用变异体自检防假阴性。
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 按大括号配对切出真实函数体，避免用正则猜实现（项目既有做法）。
function sliceFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('找不到函数：' + name);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const appRoot = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(appRoot, rel), 'utf8');

const PATHS = {
  html: 'public/index.html',
  lyrics: 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js',
  gesture: 'public/js/modules/10-shell/00-gesture-resize-ui.js',
  desktopOverlay: 'public/js/modules/10-shell/04-desktop-overlay-fullscreen.js',
  fxBindings: 'public/js/modules/07-fx/07-bindings-shelf-immersive.js',
  preset: 'public/js/modules/07-fx/00-preset-archive-data.js',
  hotkeys: 'public/js/modules/00-state/12a-audio-login-globals.js',
  fxDefaults: 'public/js/modules/00-state/12d-fx-runtime-globals.js'
};

function loadSources() {
  const out = {};
  Object.keys(PATHS).forEach(key => { out[key] = read(PATHS[key]); });
  return out;
}

// 纯函数：返回全部违规描述；空数组代表合规。
function analyze(s) {
  const issues = [];

  // A. 快捷菜单里的两个按钮都消失
  ['quick-menu-lyrics-toggle', 'quick-menu-desktop-lyrics-toggle'].forEach(id => {
    if (s.html.includes(id)) issues.push('快捷菜单仍残留按钮 id：' + id);
  });
  if (/<span>\s*歌词显示\s*<\/span>/.test(s.html)) issues.push('「歌词显示」按钮文案仍存在');

  // B. 三个开关函数彻底不存在（含定义与调用）
  const retired = [
    ['lyrics', 'toggleLyricsPanel'],
    ['lyrics', 'toggleLyricsFromQuickMenu'],
    ['desktopOverlay', 'toggleDesktopLyricsFromQuickMenu']
  ];
  retired.forEach(([file, fn]) => {
    // 允许注释里提到名字，但不允许 function 定义或 () 调用
    const stripped = s[file].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (new RegExp('(?:function\\s+' + fn + '\\s*\\(|' + fn + '\\s*\\()').test(stripped)) {
      issues.push('已删除的开关函数仍被定义或调用：' + fn);
    }
  });

  // C. L 键不再切换歌词（Alt+L 桌面歌词不受影响，见 F）
  const gestureCode = s.gesture.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/e\.code === 'KeyL'/.test(gestureCode)) issues.push('L 键仍绑定了已删除的歌词开关');

  // D. updatePlayerQuickMenuUi 保留（定时关闭 / 顶栏按钮状态仍靠它同步）
  if (!/function updatePlayerQuickMenuUi\s*\(/.test(s.lyrics)) issues.push('updatePlayerQuickMenuUi 被误删');
  if (!/has-timer/.test(s.lyrics) || !/player-quick-menu-btn-fs/.test(s.lyrics)) {
    issues.push('定时关闭或全屏顶栏按钮的状态同步被误删');
  }

  // E. 舞台歌词恒定显示：旧存档 / 预设恢复都不能再关掉它，
  //    但经典预设的内部互斥（用内置歌词）必须保留。
  if (!/particleLyrics:\s*true/.test(s.preset)) issues.push('预设归一化未强制 particleLyrics=true');
  if (/raw\.particleLyrics\s*!==\s*false/.test(s.preset)) issues.push('旧存档仍能恢复出关歌词状态');
  if (!/else setParticleLyricsSilently\(true\)/.test(s.preset)) issues.push('预设恢复未强制开启舞台歌词');
  if (!/if \(isClassicPresetActive\(\)\) setParticleLyricsSilently\(false\)/.test(s.preset)) {
    issues.push('经典预设的内部歌词互斥被误删');
  }
  if (!/function setParticleLyricsSilently/.test(s.fxBindings)) {
    issues.push('沉浸模式/经典预设共用的 setParticleLyricsSilently 被误删');
  }

  // F. 桌面歌词功能必须完整保留
  if (!/id="t-desktopLyrics"/.test(s.html)) issues.push('视觉控制台的桌面歌词主开关被误删');
  if (!/toggleFx\('desktopLyrics'\)/.test(s.html)) issues.push('桌面歌词主开关逻辑被误删');
  if (!/toggleDesktopLyrics/.test(s.hotkeys)) issues.push('桌面歌词热键条目被误删');
  if (!/Alt\+KeyL/.test(s.hotkeys) || !/Ctrl\+Alt\+KeyL/.test(s.hotkeys)) {
    issues.push('桌面歌词 Alt+L / Ctrl+Alt+KeyL 热键被误删');
  }
  if (!/desktopLyrics:\s*false/.test(s.fxDefaults)) issues.push('桌面歌词默认值（关）被改动');
  if (!fs.existsSync(path.join(appRoot, 'public', 'desktop-lyrics.html'))) {
    issues.push('桌面歌词窗口页面被误删');
  }

  return issues;
}

test('歌词显示开关彻底删除、桌面歌词功能完整保留', () => {
  assert.deepEqual(analyze(loadSources()), []);
});

test('真实 updatePlayerQuickMenuUi 切片在无按钮 DOM 下仍正确同步且无悬空引用', () => {
  const source = read(PATHS.lyrics);
  const fn = sliceFunction(source, 'updatePlayerQuickMenuUi');
  const calls = [];
  function makeBtn(id) {
    return {
      classList: { toggle: (cls, on) => calls.push([id, cls, on]) },
      set title(v) { calls.push([id, 'title', v]); },
      get title() { return ''; }
    };
  }
  const els = {
    'player-quick-menu-btn': makeBtn('player-quick-menu-btn'),
    'player-quick-menu-btn-fs': makeBtn('player-quick-menu-btn-fs')
  };
  // 两个已删按钮的 id 若仍被查询，返回 null 而不是伪造节点 —— 有悬空引用会直接抛错。
  const ctx = {
    document: {
      getElementById: id => els[id] || null,
      body: { classList: { contains: cls => cls === 'player-quick-menu-open' } }
    },
    sleepTimer: { active: true, pendingStop: false }
  };
  assert.doesNotThrow(() => vm.runInNewContext(fn + '\nupdatePlayerQuickMenuUi();', ctx));
  assert.ok(calls.some(c => c[0] === 'player-quick-menu-btn' && c[1] === 'has-timer' && c[2] === true),
    '定时关闭进行中标记未同步');
  assert.ok(calls.some(c => c[0] === 'player-quick-menu-btn-fs' && c[1] === 'active' && c[2] === true),
    '全屏顶栏按钮打开态未同步');
  assert.ok(calls.some(c => c[1] === 'title' && /定时关闭进行中/.test(c[2])), '定时关闭提示文案未同步');
  assert.ok(!fn.includes('quick-menu-lyrics-toggle') && !fn.includes('quick-menu-desktop-lyrics-toggle'),
    '函数体内仍引用已删除的按钮 id');
});

test('检测函数对 6 个回归变异体全部判红（自检，防假阴性）', () => {
  const mutations = [
    {
      name: '歌词显示按钮被加回快捷菜单',
      apply: s => ({ ...s, html: s.html.replace('<div class="quick-menu-divider"></div>',
        '<button id="quick-menu-lyrics-toggle" onclick="toggleLyricsFromQuickMenu()">歌词显示</button>\n  <div class="quick-menu-divider"></div>') })
    },
    {
      name: '桌面歌词按钮被加回快捷菜单',
      apply: s => ({ ...s, html: s.html.replace('<div class="quick-menu-divider"></div>',
        '<button id="quick-menu-desktop-lyrics-toggle">桌面歌词</button>\n  <div class="quick-menu-divider"></div>') })
    },
    {
      name: '开关函数被复活',
      apply: s => ({ ...s, lyrics: s.lyrics + '\nfunction toggleLyricsPanel(){ }\n' })
    },
    {
      name: 'L 键重新绑定',
      apply: s => ({ ...s, gesture: s.gesture.replace("else if (e.code === 'KeyP') {",
        "else if (e.code === 'KeyL') { toggleLyricsPanel(); }\n  else if (e.code === 'KeyP') {") })
    },
    {
      name: '旧存档重新能关掉歌词',
      apply: s => ({ ...s, preset: s.preset.replace('particleLyrics: true,', 'particleLyrics: raw.particleLyrics !== false,') })
    },
    {
      name: '桌面歌词功能被误删',
      apply: s => ({ ...s, html: s.html.replace('id="t-desktopLyrics"', 'id="t-desktopLyrics-removed"') })
    }
  ];
  const base = loadSources();
  mutations.forEach(m => {
    const mutated = m.apply(base);
    assert.ok(analyze(mutated).length > 0, '变异体未被判红：' + m.name);
  });
});
