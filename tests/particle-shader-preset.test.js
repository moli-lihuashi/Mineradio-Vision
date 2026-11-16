'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PARTICLE = fs.readFileSync(path.join(ROOT, 'public/js/modules/02-visual/00c-particle-system.js'), 'utf8');
const GRID = fs.readFileSync(path.join(ROOT, 'public/js/modules/07-fx/04-preset-grid-uniforms.js'), 'utf8');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing source markers: ' + from + ' -> ' + to);
  return source.slice(start, end);
}

const fullShader = /var vs = `([\s\S]*?)\n`;/.exec(PARTICLE);
assert.ok(fullShader, 'particle vertex shader template');
const fullVs = fullShader[1];

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(slice(PARTICLE, 'function particleShaderPresetValue(', 'var particlePresetShaderCache ='), sandbox);

function collectBranches(source) {
  const mainStart = source.indexOf('  if (uPreset < 0.5) {');
  const mainEnd = source.indexOf('  //  鼠标交互 (仅 SILK)', mainStart);
  const re = /(?:^|\n)\s*(?:if|else if) \(uPreset\s*<\s*([0-9.]+)\)\s*\{/g;
  re.lastIndex = Math.max(0, mainStart - 1);
  const branches = [];
  let match;
  while ((match = re.exec(source)) && match.index < mainEnd) {
    const open = match.index + match[0].lastIndexOf('{');
    const close = sandbox.particleShaderBlockEnd(source, open);
    branches.push({ open, close, limit: Number(match[1]), body: source.slice(open + 1, close) });
    re.lastIndex = close + 1;
  }
  return branches;
}

const branches = collectBranches(fullVs);
assert.equal(branches.length, 11, 'eleven selectable particle presets');

test('每个可选中预设只保留自己的分支，公共头尾保持完整', () => {
  for (let preset = 0; preset < branches.length; preset += 1) {
    const built = sandbox.buildParticleVertexShaderForPreset(fullVs, preset);
    assert.ok(built.includes(branches[preset].body), 'preset ' + preset + ' keeps selected body');
    const omitted = (built.match(/inactive particle preset omitted/g) || []).length;
    assert.equal(omitted, branches.length - 1, 'preset ' + preset + ' omits the other ten bodies');
    assert.ok(built.length < fullVs.length, 'preset ' + preset + ' source is smaller');
    assert.ok(built.includes('float rippleSumAt('), 'preset ' + preset + ' keeps common helpers');
    assert.ok(built.includes('gl_Position = projectionMatrix * mvPos;'), 'preset ' + preset + ' keeps vertex output');
    assert.ok(built.includes('if (uMouseActive > 0.5 && uPreset < 0.5)'), 'preset ' + preset + ' keeps post effects');
    for (let other = 0; other < branches.length; other += 1) {
      if (other === preset) continue;
      assert.ok(!built.includes(branches[other].body), 'preset ' + preset + ' drops preset ' + other);
    }
  }
});

test('经典预设生成最小源，越界值仍回退完整源', () => {
  const classic = sandbox.buildParticleVertexShaderForPreset(fullVs, 11);
  assert.ok(classic.includes('  pos = position;\n'), 'classic keeps the single minimal body line');
  assert.ok(classic.includes('float rippleSumAt('), 'classic keeps common helpers');
  assert.ok(classic.includes('gl_Position = projectionMatrix * mvPos;'), 'classic keeps vertex output');
  for (const body of branches.map((b) => b.body)) {
    assert.ok(!classic.includes(body), 'classic drops every particle preset body');
  }
  assert.ok(classic.length < fullVs.length / 3, 'classic source is substantially smaller');
  assert.equal(sandbox.buildParticleVertexShaderForPreset(fullVs, 99), fullVs);
});

test('非法完整源安全回退且缓存按预设隔离', () => {
  assert.equal(sandbox.buildParticleVertexShaderForPreset('not a shader', 4), 'not a shader');
  const bounds = /function buildParticleVertexShaderForPreset[\s\S]*?\n}\nvar particlePresetShaderCache/.exec(PARTICLE);
  assert.ok(bounds, 'builder function exists');
  assert.match(PARTICLE, /particlePresetShaderCache\[key\] = buildParticleVertexShaderForPreset\(vs, preset\)/);
  assert.match(PARTICLE, /uniforms: uniforms, vertexShader: activeParticleVs, fragmentShader: fs/);
});

test('预设切换同时更新普通与 bloom 材质，并在同值时跳过', () => {
  assert.match(PARTICLE, /function syncParticleShaderPreset\(preset\)/);
  assert.match(PARTICLE, /material\.vertexShader = nextVs;/);
  assert.match(PARTICLE, /bloomMaterial\.vertexShader = nextVs/);
  assert.match(PARTICLE, /material\.needsUpdate = true;/);
  assert.match(PARTICLE, /bloomMaterial\.needsUpdate = true;/);
  assert.match(PARTICLE, /if \(nextPreset === particleShaderActivePreset \|\| !material \|\| !bloomMaterial\) return false;/);
  assert.match(GRID, /uniforms\.uPreset\.value = p;\n  if \(typeof syncParticleShaderPreset === 'function'\) syncParticleShaderPreset\(p\);/);
  assert.match(GRID, /function syncFxUniforms\(\) \{\n  uniforms\.uPreset\.value = fx\.preset;\n  if \(typeof syncParticleShaderPreset === 'function'\) syncParticleShaderPreset\(fx\.preset\);/);
});
