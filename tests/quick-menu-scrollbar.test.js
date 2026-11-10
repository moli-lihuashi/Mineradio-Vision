'use strict';

// =============================================================================
// 深色玻璃浮层滚动条守卫（2026-11-08）
// -----------------------------------------------------------------------------
// .player-quick-menu-popover 和 .skin-popover 都是 overflow-y:auto 的深色玻璃
// 容器。未自定义时 Chromium 会画浅色系统滚动条（白色轨道 + 上下三角箭头），
// 与深色面板割裂。这里把「细窄半透明药丸」的规则约束固化下来，并用变异体
// 自检检测函数本身能判红，避免"字符串在就全绿"的假阴性。
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const cssSource = fs.readFileSync(path.join(appRoot, 'public', 'css', 'index.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');

const TARGETS = ['.player-quick-menu-popover', '.skin-popover'];

// 每条规则必须同时覆盖两个弹层，且形态固定。
const REQUIRED_RULES = [
  {
    name: '标准属性：thin + 透明轨道',
    re: /scrollbar-width:\s*thin;\s*scrollbar-color:\s*rgba\(255,255,255,\.18\)\s+transparent/
  },
  {
    name: '细窄滚动条 6px',
    re: /::-webkit-scrollbar\{width:6px;height:6px\}/
  },
  {
    name: '轨道透明（消除白色长条）',
    re: /::-webkit-scrollbar-track\{background:transparent\}/
  },
  {
    name: '半透明药丸滑块',
    re: /::-webkit-scrollbar-thumb\{border:1px solid transparent;background:rgba\(255,255,255,\.16\);background-clip:content-box;border-radius:999px\}/
  },
  {
    name: '容器悬停时滑块加深',
    re: /:hover::-webkit-scrollbar-thumb\{background:rgba\(255,255,255,\.30\);background-clip:content-box\}/
  },
  {
    name: '滑块自身悬停时再加深',
    re: /::-webkit-scrollbar-thumb:hover\{background:rgba\(255,255,255,\.46\);background-clip:content-box\}/
  },
  {
    name: '去掉上下三角箭头',
    re: /::-webkit-scrollbar-button\{display:none;width:0;height:0\}/
  },
  {
    name: '角落透明',
    re: /::-webkit-scrollbar-corner\{background:transparent\}/
  }
];

// 抽出本功能的规则块，避免被 index.css 里其它面板的滚动条规则蒙混过关。
function scrollbarBlock(source) {
  const marker = '深色玻璃浮层滚动条';
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const endMarker = '\nbody.desktop-shell #search-area';
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end < 0 ? source.length : end);
}

// 纯函数：返回所有违规描述；空数组代表合规。
function analyze(source) {
  const issues = [];
  const block = scrollbarBlock(source);
  if (!block) return ['滚动条规则块缺失（找不到标记注释）'];

  const lines = block.split('\n').map(line => line.trim()).filter(line =>
    line && !line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('//'));

  REQUIRED_RULES.forEach(rule => {
    const hit = lines.find(line => rule.re.test(line));
    if (!hit) {
      issues.push('缺少规则：' + rule.name);
      return;
    }
    const missing = TARGETS.filter(sel => !hit.includes(sel));
    if (missing.length) issues.push(rule.name + ' 未覆盖：' + missing.join(', '));
  });

  // 浅色实色轨道回归：这是截图里最刺眼的部分，必须挡住。
  if (/::-webkit-scrollbar-track\{background:(?!transparent)[^}]*\}/.test(block)) {
    issues.push('滚动条轨道不是透明色');
  }
  if (/::-webkit-scrollbar-button\{(?!display:none)[^}]*\}/.test(block)) {
    issues.push('上下三角箭头没有被隐藏');
  }
  if (/color-scheme:\s*dark/.test(block)) {
    issues.push('不要给弹层加 color-scheme:dark（会改变内部原生 range/select 外观）');
  }

  // Chromium 的标准属性优先规则：scrollbar-width/color 一旦裸写就会让整组
  // ::-webkit-scrollbar 失效，必须隔离在 @supports not selector(...) 兜底块里。
  const supports = /@supports not selector\(::-webkit-scrollbar\)\s*\{/;
  if (!supports.test(block)) {
    issues.push('标准属性缺少 @supports not selector(::-webkit-scrollbar) 隔离');
  }
  const outsideSupports = block.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/, '');
  if (/scrollbar-(?:width|color)\s*:/.test(outsideSupports)) {
    issues.push('scrollbar-width/color 裸写在兜底块之外会覆盖 Chromium 的 webkit 自定义');
  }
  return issues;
}

test('两个深色玻璃弹层都使用统一的细窄半透明药丸滚动条', () => {
  assert.deepEqual(analyze(cssSource), []);
});

test('规则块位于两个弹层定义之后，不会被前面的定义覆盖', () => {
  const blockStart = cssSource.indexOf('深色玻璃浮层滚动条');
  const quickMenuDef = cssSource.indexOf('.player-quick-menu-popover{position:fixed');
  const skinDef = cssSource.indexOf('.skin-popover{position:fixed');
  assert.ok(blockStart > 0, '滚动条规则块不存在');
  assert.ok(quickMenuDef > 0 && skinDef > 0, '两个弹层的基础定义不存在');
  assert.ok(blockStart > quickMenuDef && blockStart > skinDef, '滚动条规则必须排在弹层定义之后');
});

test('两个弹层确实是需要滚动的深色玻璃容器，且 DOM 节点存在', () => {
  assert.match(cssSource, /\.player-quick-menu-popover\{[^}]*overflow-y:auto[^}]*\}/);
  assert.match(cssSource, /\.skin-popover\{[^}]*overflow-y:auto[^}]*\}/);
  assert.match(htmlSource, /id="player-quick-menu-popover"\s+class="player-quick-menu-popover"/);
  assert.match(htmlSource, /id="skin-popover"\s+class="skin-popover"/);
});

test('标准属性隔离在 @supports 兜底块里（Chromium 优先规则）', () => {
  const block = scrollbarBlock(cssSource);
  assert.match(block, /@supports not selector\(::-webkit-scrollbar\)\s*\{/);
  const outside = block.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/, '');
  assert.doesNotMatch(outside, /scrollbar-(?:width|color)\s*:/);
});

test('检测函数对 6 个回归变异体全部判红（自检，防假阴性）', () => {
  const mutations = [
    {
      name: '箭头按钮规则被整行删除',
      apply: s => s.replace(/^[^\n]*::-webkit-scrollbar-button\{[^\n]*\n/m, '')
    },
    {
      name: '轨道退回浅色实色',
      apply: s => s.replace('::-webkit-scrollbar-track{background:transparent}', '::-webkit-scrollbar-track{background:#f0f0f0}')
    },
    {
      name: '滑块变回方角',
      apply: s => s.replace('border-radius:999px}', 'border-radius:0}')
    },
    {
      name: '滚动条退回粗系统条',
      apply: s => s.replace('::-webkit-scrollbar{width:6px', '::-webkit-scrollbar{width:17px')
    },
    {
      name: '少覆盖皮肤弹层',
      apply: s => s.replace(',.skin-popover::-webkit-scrollbar-button', '')
    },
    {
      name: '标准属性裸写（Chromium 会忽略整组 webkit 自定义）',
      apply: s => s.replace('@supports not selector(::-webkit-scrollbar){', '/* no isolation */')
    }
  ];
  mutations.forEach(m => {
    const mutated = m.apply(cssSource);
    assert.notDeepEqual(mutated, cssSource, '变异体没有真正改动文本：' + m.name);
    assert.ok(analyze(mutated).length > 0, '变异体未被判红：' + m.name);
  });
});
