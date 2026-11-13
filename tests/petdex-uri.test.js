'use strict';

// Petdex 接入的安全边界单测。
// 这两条规则一个挡路径穿越（slug 直接拼磁盘路径），一个挡 SSRF
// （下载地址来自客户端 POST body），都属于「错了就是漏洞」的判定，必须锁住。

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafePetSlug, resolvePetdexAssetUrl, parsePetdexPetInput, extractPetFromHtml } = require('../server/lib/petdex-uri');

test('slug 白名单：正常 slug 放行', () => {
  ['boba', 'cloud-4', 'a1', 'nickel-file-ledger', 'x'.repeat(64)].forEach(s => {
    assert.equal(isSafePetSlug(s), true, s + ' 应放行');
  });
});

test('slug 白名单：路径穿越与非法形态一律拒绝', () => {
  [
    '', '   ', '..', '../etc', '../../etc/passwd', 'a/b', 'a\\b',
    '.hidden', '-lead', 'Upper', 'a b', 'boba.webp', '中文',
    'x'.repeat(65),
  ].forEach(s => {
    assert.equal(isSafePetSlug(s), false, JSON.stringify(s) + ' 应拒绝');
  });
});

test('资源地址：只接受 assets.petdex.dev 的 https webp/png', () => {
  assert.equal(
    resolvePetdexAssetUrl('https://assets.petdex.dev/curated/boba/sprite-v2.webp'),
    'https://assets.petdex.dev/curated/boba/sprite-v2.webp'
  );
  assert.equal(
    resolvePetdexAssetUrl('https://assets.petdex.dev/pets/mallow-e2413d735bce/sprite.webp'),
    'https://assets.petdex.dev/pets/mallow-e2413d735bce/sprite.webp'
  );
  assert.equal(
    resolvePetdexAssetUrl('https://assets.petdex.dev/a/b/sprite.png'),
    'https://assets.petdex.dev/a/b/sprite.png'
  );
});

test('资源地址：跨域、非 https、非图片、带凭据、非标准端口都要拒绝', () => {
  [
    'http://assets.petdex.dev/a.webp',            // 非 https
    'https://evil.com/a.webp',                    // 其他域
    'https://assets.petdex.dev.evil.com/a.webp',  // 前缀伪装
    'https://evil.com/assets.petdex.dev/a.webp',  // 路径伪装
    'https://assets.petdex.dev/a.zip',            // 非图片扩展
    'https://assets.petdex.dev/a.json',
    'https://user:pass@assets.petdex.dev/a.webp', // 带凭据
    'https://assets.petdex.dev:8443/a.webp',      // 非标准端口
    'file:///etc/passwd',
    'javascript:alert(1)',
    '',
    'not-a-url',
  ].forEach(s => {
    assert.equal(resolvePetdexAssetUrl(s), '', JSON.stringify(s) + ' 应拒绝');
  });
});

test('静态守卫：宠物路由已注册，前端模块已加载', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const loader = fs.readFileSync(path.join(root, 'public/js/index-loader.js'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'public/js/modules/05-playback/14-home-pet.js'), 'utf8');

  assert.match(server, /require\('\.\/server\/routes\/pets'\)\(routeCtx\)/, 'server.js 必须注册 pets 路由');
  assert.match(loader, /16-pet-petdex\.js/, 'index-loader 必须加载 16-pet-petdex.js');
  assert.match(home, /HomePetPetdex\.draw/, '14-home-pet.js 的绘制必须给 Petdex 精灵让路');
});

test('导入输入解析：宠物页地址与纯 slug 都认', () => {
  const cases = [
    ['https://petdex.dev/pets/hachiware-2', 'hachiware-2'],
    ['https://petdex.dev/zh/pets/hachiware-2', 'hachiware-2'],
    ['https://www.petdex.dev/pets/boba', 'boba'],
    ['https://petdex.dev/pets/boba?from=share', 'boba'],
    ['https://petdex.dev/pets/boba#top', 'boba'],
    ['  https://petdex.dev/en/pets/mallow  ', 'mallow'],
    ['hachiware-2', 'hachiware-2'],
    ['Boba'.toLowerCase(), 'boba'],
  ];
  cases.forEach(([input, slug]) => {
    const got = parsePetdexPetInput(input);
    assert.ok(got, JSON.stringify(input) + ' 应被识别');
    assert.equal(got.slug, slug, JSON.stringify(input));
  });
});

test('导入输入解析：列表页、别的站点、非法 slug 一律拒绝', () => {
  [
    '', '   ', 'https://petdex.dev/zh/pets', 'https://petdex.dev/',
    'https://evil.com/pets/boba',
    'https://petdex.dev.attacker.com/pets/boba',
    'https://petdex.dev/pets/../secret',
    'https://petdex.dev/pets/a b',
    'javascript:alert(1)',
    'ftp://petdex.dev/pets/boba',
    '宠物名不是地址',
  ].forEach(input => {
    assert.equal(parsePetdexPetInput(input), null, JSON.stringify(input) + ' 应拒绝');
  });
});

test('宠物页解析：抽出精灵地址与名字（h1 优先，其次 og:title）', () => {
  const html = [
    '<html><head><meta property="og:title" content="小八: Animated Codex pet" /></head><body>',
    '<h1 class="t">小八</h1>',
    '<div class="pet-sprite" style="--sprite-url:url(&quot;https://assets.petdex.dev/pets/hachiware-6d07aabe3762/sprite.webp&quot;);--sprite-row:0"></div>',
    '<script>self.__next_f.push([1,"{\\"description\\":\\"Chiikawa style pet\\"}"])</script>',
    '</body></html>',
  ].join('');
  const pet = extractPetFromHtml(html);
  assert.ok(pet);
  assert.equal(pet.spriteUrl, 'https://assets.petdex.dev/pets/hachiware-6d07aabe3762/sprite.webp');
  assert.equal(pet.displayName, '小八');
  assert.match(pet.description, /Chiikawa style pet/);
});

test('宠物页解析：没有精灵地址、或地址不在 petdex 资产域，返回 null', () => {
  assert.equal(extractPetFromHtml('<html><h1>x</h1></body></html>'), null);
  assert.equal(extractPetFromHtml(
    '<div style="--sprite-url:url(https://evil.com/a.webp)"></div><h1>x</h1>'
  ), null);
  assert.equal(extractPetFromHtml(''), null);
});

test('宠物页解析：只有 og:title 时切掉后缀当名字', () => {
  const pet = extractPetFromHtml(
    '<meta property="og:title" content="Boba: Animated Codex pet" />' +
    '<div style="--sprite-url:url(https://assets.petdex.dev/curated/boba/sprite-v2.webp)"></div>'
  );
  assert.equal(pet.displayName, 'Boba');
});

test('静态守卫：跳转地址必须是实测可用的 /zh（/pets 与 /zh/pets 都是 404）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
  const mod = fs.readFileSync(path.join(root, 'public/js/modules/05-playback/16-pet-petdex.js'), 'utf8');

  // 主进程那条 IPC 的目标地址
  const m = main.match(/mineradio-open-petdex['"],\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,400}?const target = '([^']+)'/);
  assert.ok(m, 'main.js 里必须能找到 open-petdex 的硬编码目标地址');
  assert.equal(m[1], 'https://petdex.dev/zh', '跳转目标必须是实测可用的 /zh');
  assert.ok(!/\/pets'/.test(m[1]), '/pets 与 /zh/pets 实测都是 404，不能再用');

  // 前端兜底常量
  const w = mod.match(/var PETDEX_WEB = '([^']+)'/);
  assert.ok(w, '前端必须有 PETDEX_WEB 常量');
  assert.equal(w[1], 'https://petdex.dev/zh');
});

test('静态守卫：精灵表是 <img> 加载的，asset 端点必须在 query-token 白名单里', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const mod = fs.readFileSync(path.join(root, 'public/js/modules/05-playback/16-pet-petdex.js'), 'utf8');

  // 少了这条，<img> 发不了 X-Mineradio-Token → 403 → 前端报「精灵表解码失败」
  const m = server.match(/API_AUTH_QUERY_TOKEN_PATHS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, 'server.js 里必须有 API_AUTH_QUERY_TOKEN_PATHS');
  assert.match(m[1], /'\/api\/pets\/local\/asset'/, 'asset 端点必须在 ?token= 白名单里');

  // 前端必须用带 token 的 URL 构造，不能拼裸路径
  assert.match(mod, /apiMediaProxyUrlAsync\('\/api\/pets\/local\/asset'/, '前端必须用 apiMediaProxyUrlAsync 拼 asset 地址');
  assert.ok(!/loadImage\('\/api\/pets\/local\/asset/.test(mod), '不能把裸 asset 路径直接喂给 <img>');
});
