'use strict';

// 元测试：每个 extras 模块导出的 handler 必须在其测试文件里被真正调用过。
//
// 为什么需要它：批次1–5 新增了 59 个 handler，靠人工记得「加接口要加测试」不可靠。
// 这条测试直接解析模块的 return 对象，拿不到对应测试就红，新增接口时必然被提醒。
//
// 它证明的是「没有一条新能力是没测过的」，不证明「上游真实行为正确」——
// 后者靠匿名契约探针（harness/verify-live.js）与实号联测。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const MODULES = [
  { provider: 'netease', mod: 'server/netease/extras.js', spec: 'tests/netease-extras.test.js' },
  { provider: 'qq', mod: 'server/qq/extras.js', spec: 'tests/qq-extras.test.js' },
  { provider: 'kugou', mod: 'server/kugou/extras.js', spec: 'tests/kugou-extras.test.js' },
  { provider: 'spotify', mod: 'server/spotify/extras.js', spec: 'tests/spotify-extras.test.js' },
  { provider: 'qishui', mod: 'server/qishui/extras.js', spec: 'tests/qishui-extras.test.js' },
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 取模块最后一个 return {...} 块里的一级键名。支持单行、多行、箭头函数值。
function exportedHandlerNames(src) {
  const idx = src.lastIndexOf('return {');
  if (idx < 0) return [];
  const start = src.indexOf('{', idx);
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return [];
  const body = src.slice(start + 1, end);
  // 按顶层逗号切分（只把 { ( [ 当开括号，避免 => 的 > 干扰）
  const segments = [];
  let buf = '';
  let d = 0;
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') d += 1;
    else if (ch === '}' || ch === ')' || ch === ']') d -= 1;
    if (ch === ',' && d === 0) { segments.push(buf); buf = ''; } else buf += ch;
  }
  if (buf.trim()) segments.push(buf);
  return segments
    .map(seg => {
      const m = seg.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
      return m ? m[1] : '';
    })
    .filter(Boolean);
}

test('handler 覆盖审计：每个导出的 handler 都在对应测试里被调用过', () => {
  const report = [];
  const problems = [];
  for (const entry of MODULES) {
    const handlers = exportedHandlerNames(read(entry.mod));
    const spec = read(entry.spec);
    const missing = handlers.filter(name => !new RegExp('extras\\.' + name + '\\s*\\(').test(spec));
    report.push(entry.provider + ': ' + (handlers.length - missing.length) + '/' + handlers.length);
    if (!handlers.length) problems.push(entry.provider + ' 解析不到 handler（模块结构变了？）');
    if (missing.length) problems.push(entry.provider + ' 缺测试：' + missing.join(', '));
  }
  assert.deepEqual(problems, [], 'handler 覆盖缺口 → ' + problems.join('；') + '（覆盖：' + report.join(' | ') + '）');
});

test('handler 覆盖审计：解析器本身要能处理单行与箭头函数两种形态', () => {
  // 防「审计器 0 命中却装作通过」：先给合成正例。
  const single = 'module.exports = function () {\n  return { a, b };\n};';
  assert.deepEqual(exportedHandlerNames(single), ['a', 'b']);

  const arrow = 'module.exports = function () {\n  return {\n    x,\n    y: (p, q) => f(p, q),\n    z: async (p) => ({ nested: { k: 1 } }),\n  };\n};';
  assert.deepEqual(exportedHandlerNames(arrow), ['x', 'y', 'z']);

  assert.deepEqual(exportedHandlerNames('module.exports = 1;'), []);
});
