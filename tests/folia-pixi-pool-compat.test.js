'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const WORLD = fs.readFileSync(path.join(ROOT, 'public/js/modules/12-folia/03-folia-world-runtime.js'), 'utf8');
const TEMPERA = fs.readFileSync(path.join(ROOT, 'public/js/modules/12-folia/0h-folia-tempera-runtime.js'), 'utf8');

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, 'missing markers: ' + from + ' -> ' + to);
  return source.slice(start, end);
}

function makeFakePixi() {
  function FilterSystem() {}
  FilterSystem.prototype.init = function () {};
  FilterSystem.prototype.destroy = function () { if (this._globalFilterBindGroup) this._globalFilterBindGroup.destroyed = true; };
  // 与 vendor 8.21 相同的空引用敏感实现：source=null 时抛 reading '_resolution'
  FilterSystem.prototype._findFilterResolution = function (t) {
    let e = this._filterStackIndex - 1;
    for (; e > 0 && this._filterStack[e].skip; ) --e;
    return e > 0 && this._filterStack[e].inputTexture
      ? this._filterStack[e].inputTexture.source._resolution : t;
  };
  const pool = {
    _poolKey: {},
    _buckets: new Map(),
    _dropTextures(textures, shouldDestroy) {
      if (shouldDestroy) textures.forEach((t) => { t.source = null; });
    },
    returnTexture(tex) {
      const key = this._poolKey[tex.uid];
      if (key === undefined) return;
      const bucket = this._buckets.get(key);
      if (!bucket) { delete this._poolKey[tex.uid]; tex.source = null; return; }
      bucket.push(tex);
    },
  };
  const pixi = {
    VERSION: '8.21.0',
    FilterSystem,
    TexturePool: pool,
    Texture: { EMPTY: { source: { style: {} } } },
  };
  return { pixi, pool };
}

function installWith(source) {
  const sandbox = { console, Set };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;foliaWorldInstallPixi821FilterPoolCompat;', sandbox);
  return sandbox;
}

const installerSource = slice(WORLD, 'function foliaWorldInstallPixi821FilterPoolCompat(pixi) {', 'function foliaWorldEnsureRoot() {');

test('补丁让 _findFilterResolution 跳过已回收纹理，不再抛 reading _resolution', () => {
  const { pixi, pool } = makeFakePixi();
  const sandbox = installWith(installerSource);
  assert.equal(sandbox.foliaWorldInstallPixi821FilterPoolCompat(pixi), true);
  const system = Object.create(pixi.FilterSystem.prototype);
  // 栈顶（当前 pass）的 inputTexture 已被池回收：vendor 直接读 source._resolution 抛错；
  // 补丁跳过它、命中栈底上一趟 pass 的有效引用。
  system._filterStack = [
    { skip: true, inputTexture: { source: { _resolution: 9 } } },
    { skip: false, inputTexture: { source: { _resolution: 1.25 } } },
    { skip: false, inputTexture: { source: null } },
  ];
  system._filterStackIndex = 3;
  assert.equal(system._findFilterResolution(1), 1.25);
  // 全空时退回 fallback
  system._filterStack = [
    { skip: false, inputTexture: { source: null } },
    { skip: false, inputTexture: { source: null } },
  ];
  system._filterStackIndex = 2;
  assert.equal(system._findFilterResolution(0.75), 0.75);
  void pool;
});

test('安装幂等：第二次返回 false 且不二次包裹', () => {
  const { pixi } = makeFakePixi();
  const sandbox = installWith(installerSource);
  assert.equal(sandbox.foliaWorldInstallPixi821FilterPoolCompat(pixi), true);
  const first = pixi.FilterSystem.prototype._findFilterResolution;
  assert.equal(sandbox.foliaWorldInstallPixi821FilterPoolCompat(pixi), false);
  assert.equal(pixi.FilterSystem.prototype._findFilterResolution, first);
});

test('池回收/越桶归还时会解绑 _globalFilterBindGroup（与 tempera 补丁同一行为）', () => {
  const { pixi, pool } = makeFakePixi();
  const sandbox = installWith(installerSource);
  sandbox.foliaWorldInstallPixi821FilterPoolCompat(pixi);
  const calls = [];
  const system = Object.create(pixi.FilterSystem.prototype);
  system._globalFilterBindGroup = {
    setResource(resource, slot) { calls.push([resource, slot]); },
    destroy() {},
  };
  system.init();
  assert.equal(calls.length, 0);
  const texture = { uid: 't1', source: {} };
  pool._buckets.set('k1', [texture]);
  pool._poolKey['t1'] = 'k1';
  pool._dropTextures([texture], true);
  assert.equal(texture.source, null);
  const empty = pixi.Texture.EMPTY.source;
  assert.deepEqual(calls, [[empty, 1], [empty.style, 2], [empty, 3]]);
});

test('世界创建实例前安装补丁；tick 错误带模式名与堆栈首行', () => {
  const create = slice(WORLD, 'function foliaWorldCreateInstance() {', 'function foliaWorldEnter(opts) {');
  const installAt = create.indexOf('foliaWorldInstallPixi821FilterPoolCompat(PIXI)');
  const createAt = create.indexOf('def.create(host, ctx)');
  assert.ok(installAt >= 0 && createAt > installAt, 'compat must install before def.create');
  assert.match(WORLD, /Folia 渲染异常（' \+ \(def\.name \|\| foliaWorld\.mode\)/);
  assert.match(WORLD, /function foliaWorldCompactStackHead/);
  // tempera 与世界共用同一幂等标志：谁先装都行，另一方跳过
  assert.match(TEMPERA, /__foliaPixi821FilterPoolCompat/);
  assert.match(WORLD, /__foliaPixi821FilterPoolCompat/);
});

test('tick 错误信息真实携带模式名与堆栈（行为验证）', () => {
  const sandbox = { console: { error() {} }, Set };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // tick 是该文件最后一个函数，直接整文件求值（顶层只有函数声明，无立即执行）
  vm.runInContext(WORLD, sandbox);
  const boom = new Error('Cannot read properties of null (reading \'_resolution\')');
  boom.stack = ['Error: x', '    at boom (0g-folia-mode-sonnet.js:6095:1)', '    at foliaWorldTick (03:1:1)'].join('\n');
  sandbox.foliaWorld = {
    active: true,
    mode: 'sonnet',
    instance: { __def: { id: 'sonnet', name: '商籁', tick() { throw boom; } } },
  };
  sandbox.foliaWorldBuildContext = () => ({});
  sandbox.foliaWorldExit = (opts) => { sandbox.exitedWith = opts; };
  sandbox.showToast = (msg) => { sandbox.toast = msg; };
  sandbox.foliaWorldTick(1000, 16);
  assert.equal(sandbox.exitedWith.silent, true, 'tick error must exit the world silently');
  assert.match(sandbox.foliaWorld.failReason, /商籁/);
  assert.match(sandbox.foliaWorld.failReason, /reading '_resolution'/);
  assert.match(sandbox.foliaWorld.failReason, /0g-folia-mode-sonnet\.js:6095/);
});

test('突变守卫：删安装调用 / 换回抛错实现 / 删模式名都必须失败', () => {
  const create = slice(WORLD, 'function foliaWorldCreateInstance() {', 'function foliaWorldEnter(opts) {');
  assert.throws(() => {
    assert.match(create.replace('foliaWorldInstallPixi821FilterPoolCompat(PIXI)', 'void 0'),
      /foliaWorldInstallPixi821FilterPoolCompat\(PIXI\)/);
  });
  const patched = installerSource.replace(
    'if (texture && texture.source) return texture.source._resolution;',
    'return texture.source._resolution;');
  const { pixi } = makeFakePixi();
  const sandbox = installWith(patched);
  sandbox.foliaWorldInstallPixi821FilterPoolCompat(pixi);
  const system = Object.create(pixi.FilterSystem.prototype);
  system._filterStack = [
    { skip: false, inputTexture: { source: { _resolution: 2 } } },
    { skip: false, inputTexture: { source: null } },
  ];
  system._filterStackIndex = 2;
  assert.throws(() => system._findFilterResolution(1), /_resolution/);
  assert.throws(() => {
    assert.match(WORLD.split('(def.name || foliaWorld.mode)').join('(void 0)'),
      /Folia 渲染异常（' \+ \(def\.name \|\| foliaWorld\.mode\)/);
  });
});
