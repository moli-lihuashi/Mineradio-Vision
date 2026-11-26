'use strict';

// 出站 URL 防护（SSRF）守：
//
// 背景：LX 音源「从链接导入」原来只校验 `^https?:$`，任意内网地址都能被服务端请求，
// 下载到的脚本随后进 vm 执行（SSRF → RCE 链）。媒体代理也漏了 CGNAT 100.64/10 /
// 0.0.0.0/8 / 组播 / IPv6 映射地址。两处现在共用 server/lib/net-guard.js。
//
// 这个测试盯四件事：
//   ① 回环 / 私网 / 链路本地（含云元数据 169.254.169.254）/ CGNAT / 保留段必须拒绝；
//   ② IPv6：::1、fe80::、fc00::/7、::ffff:127.0.0.1、64:ff9b::（NAT64）、2002::（6to4）都要拒绝；
//   ③ 域名解析到内网必须拒绝（注入解析器替身，不依赖真实 DNS）；
//   ④ 公网地址放行，非 http(s) / 带 URL 凭证的地址拒绝。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const guard = require(path.join(root, 'server', 'lib', 'net-guard.js'));

async function expectBlocked(url, tag) {
  let err = null;
  try {
    await guard.assertPublicHttpUrl(url, 'TEST');
  } catch (e) {
    err = e;
  }
  assert.ok(err, (tag || url) + ' 必须被拒绝');
  assert.match(err.message, /^TEST_/, '错误码要带调用方 tag，便于路由映射');
  return err.message;
}

test('① 回环 / 私网 / 链路本地 / CGNAT / 保留段全部拒绝', async () => {
  const blocked = [
    'http://127.0.0.1/x',
    'http://127.1.2.3/x',
    'http://localhost:3000/',
    'http://foo.localhost/',
    'http://svc.local/',
    'http://svc.internal/',
    'http://svc.lan/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
    'http://240.0.0.1/',
  ];
  for (const url of blocked) await expectBlocked(url);
  // 172.32 与 100.128 已经不在 172.16/12 与 100.64/10 里，必须放行（防过度拦截）
  assert.equal(await guard.assertPublicHttpUrl('http://172.32.0.1/', 'TEST'), 'http://172.32.0.1/');
  assert.equal(await guard.assertPublicHttpUrl('http://100.128.0.1/', 'TEST'), 'http://100.128.0.1/');
});

test('② IPv6 私网 / 映射 / NAT64 / 6to4 全部拒绝', async () => {
  const blocked = [
    'http://[::1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:192.168.1.1]/',
    'http://[64:ff9b::a00:1]/',      // NAT64 嵌入 10.0.0.1
    'http://[2002:c0a8:0101::1]/',   // 6to4 嵌入 192.168.1.1
  ];
  for (const url of blocked) await expectBlocked(url);
  // 公网 IPv6 放行
  assert.equal(await guard.assertPublicHttpUrl('http://[2606:4700::1111]/', 'TEST'), 'http://[2606:4700::1111]/');
});

test('③ 域名解析到内网必须拒绝（解析器替身，不依赖真实 DNS）', async () => {
  const cases = [
    [{ address: '10.0.0.5', family: 4 }, true],
    [{ address: '127.0.0.1', family: 4 }, true],
    [{ address: '169.254.169.254', family: 4 }, true],
    [{ address: '::1', family: 6 }, true],
    [{ address: '::ffff:127.0.0.1', family: 6 }, true],
    [{ address: '93.184.216.34', family: 4 }, false],
  ];
  for (const [addr, shouldBlock] of cases) {
    const fakeDns = { lookup: async () => [addr] };
    let err = null;
    try {
      await guard.assertPublicHttpUrl('https://evil.example/', 'TEST', { dns: fakeDns });
    } catch (e) {
      err = e;
    }
    if (shouldBlock) assert.ok(err, '解析到 ' + addr.address + ' 必须拒绝');
    else assert.equal(err, null, '公网解析结果必须放行');
  }
  // 混合解析（一个公网一个内网）也必须拒绝
  const mixed = { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.0.2', family: 4 }] };
  let mixedErr = null;
  try { await guard.assertPublicHttpUrl('https://mixed.example/', 'TEST', { dns: mixed }); } catch (e) { mixedErr = e; }
  assert.ok(mixedErr, '任一解析结果落在内网就必须拒绝');
});

test('④ 协议 / 凭证 / 空值拒绝，公网 http(s) 放行', async () => {
  await expectBlocked('file:///etc/passwd');
  await expectBlocked('ftp://example.com/x');
  await expectBlocked('javascript:alert(1)');
  await expectBlocked('http://user:pass@example.com/');
  await expectBlocked('');
  assert.equal(await guard.assertPublicHttpUrl('http://1.1.1.1/', 'TEST'), 'http://1.1.1.1/');
});

test('⑤ LX 导入与沙箱出口都接上了 net-guard（防接线被摘回）', () => {
  const lxSrc = fs.readFileSync(path.join(root, 'server', 'lx', 'source-host.js'), 'utf8');
  assert.match(lxSrc, /require\('\.\.\/lib\/net-guard'\)/, 'LX 必须复用 net-guard');
  assert.match(lxSrc, /async function downloadSourceScript/, '下载脚本入口必须是 async 并被守卫');
  assert.match(lxSrc, /assertPublicHttpUrl\(sourceUrl, 'LX_SOURCE_DOWNLOAD'\)/, '链接导入下载前必须校验');
  assert.match(lxSrc, /assertPublicHttpUrl\(target\.href, 'LX_REQUEST'\)/, 'lx.request 每次出站都要校验');
  assert.match(lxSrc, /fetchWithGuardedRedirects/, '沙箱 fetch / electronFetch 必须逐跳校验重定向');
  assert.doesNotMatch(lxSrc, /sourceUrlHttpFallback/, '证书错误自动降级 http 的路径必须保持删除');
  // 沙箱仍暴露宿主 fetch 时，必须是包装过的版本
  assert.match(lxSrc, /fetch: typeof globalThis\.fetch === 'function'[\s\S]{0,240}fetchWithGuardedRedirects/,
    '沙箱 fetch 必须走守卫包装，不能把裸 fetch 塞进沙箱');
});

test('⑥ 媒体代理：ACAO 不得通配，只回显自身 origin', () => {
  const create = require(path.join(root, 'server', 'lib', 'media-proxy.js'));
  const proxy = create({
    dns: require('dns'),
    fetchWithTimeout: async () => { throw new Error('unused'); },
    UA: 'test',
    PROXY_FETCH_TIMEOUT_MS: 1000,
    API_AUTH_QUERY_TOKEN_PATHS: new Set(),
    getApiToken: () => 'token',
  });
  const makeRes = (headers) => ({
    req: { headers: headers || {} },
    statusCode: 0,
    headers: null,
    writeHead(status, h) { this.statusCode = status; this.headers = h; },
    end() {},
  });
  const body = Buffer.alloc(64);

  const noOrigin = makeRes({ host: '127.0.0.1:1234' });
  proxy.sendAudioBuffer(noOrigin, body, 'audio/mp4', 'bytes=0-15');
  assert.equal(noOrigin.statusCode, 206);
  assert.equal(noOrigin.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:1234',
    '始终声明自身 origin：<audio crossOrigin="anonymous"> 的路径不赌浏览器同源语义');

  const sameOrigin = makeRes({ host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234' });
  proxy.sendAudioBuffer(sameOrigin, body, 'audio/mp4', '');
  assert.equal(sameOrigin.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:1234', '自身 origin 可以回显');
  assert.equal(sameOrigin.headers.Vary, 'Origin');

  const foreign = makeRes({ host: '127.0.0.1:1234', origin: 'http://127.0.0.1:9999' });
  proxy.sendAudioBuffer(foreign, body, 'audio/mp4', '');
  assert.equal(foreign.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:1234',
    '声明的是自身 origin；其他端口的网页与之不匹配，CORS 检查会拒绝');
  assert.doesNotMatch(JSON.stringify(foreign.headers), /"\*"/, '任何路径都不得再出现 ACAO: *');

  const foreignHost = makeRes({ host: 'evil.example:80', origin: 'http://evil.example:80' });
  proxy.sendAudioBuffer(foreignHost, body, 'audio/mp4', '');
  assert.equal(foreignHost.headers['Access-Control-Allow-Origin'], undefined, '非环回 Host 不声明 ACAO');
});
