'use strict';

/* 恢复链路必须绕过地址缓存（2026-11-28）。
 *
 * 服务端给三家（网易/QQ/酷狗）加了 5 分钟地址缓存。播放中断后的「重新取链」
 * 前提是旧签名已经不可用；如果它命中缓存拿回同一枚 URL，恢复逻辑会把它判成
 * 「没换到源」并提前收工 —— 缓存把一条修复路径变成了新的失败路径。
 * 因此恢复链路显式带 fresh=1，这里守住这个约定。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const registryPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '01-music-provider-registry.js');
const recoveryPath = path.join(appRoot, 'public', 'js', 'modules', '05-playback', '09d-playback-stall-recovery.js');
const source = fs.readFileSync(registryPath, 'utf8');

function functionSource(name) {
  const declaration = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `missing ${name}()`);
  const bodyStart = source.indexOf('{', declaration.index + declaration[0].length);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(declaration.index, i + 1);
    }
  }
  throw new Error(`unterminated ${name}()`);
}

const sandbox = {
  encodeURIComponent,
  String,
  Number,
  // 只替换不属于本用例的两处依赖，其余保持真实实现（函数内 typeof 兜底）
  resolveProviderRequestedQuality: (song) => ({
    provider: song.__provider,
    qualityParam: '&quality=standard',
  }),
  neteasePlaybackMatchQuery: () => '',
};
vm.createContext(sandbox);
vm.runInContext(functionSource('providerPlayUrlEndpoint'), sandbox);
const endpoint = sandbox.providerPlayUrlEndpoint;

function song(provider) {
  return { __provider: provider, id: '42', mid: 'm42', hash: 'H42' };
}

test('恢复取链：网易/QQ/酷狗带 fresh=1', () => {
  for (const provider of ['netease', 'qq', 'kugou']) {
    const url = endpoint(song(provider), { freshResolve: true });
    assert.match(url, /[?&]fresh=1(&|$)/, provider + ' 没带 fresh=1：会命中缓存里的死链');
  }
});

test('普通起播不带 fresh=1（否则缓存永远命中不了）', () => {
  for (const provider of ['netease', 'qq', 'kugou']) {
    const url = endpoint(song(provider), {});
    assert.doesNotMatch(url, /fresh=1/);
    const noOpts = endpoint(song(provider));
    assert.doesNotMatch(noOpts, /fresh=1/);
  }
});

test('不走缓存的平台不塞 fresh（汽水/Spotify 无需绕）', () => {
  for (const provider of ['qishui', 'spotify']) {
    const url = endpoint(song(provider), { freshResolve: true });
    assert.doesNotMatch(url, /fresh=1/);
  }
});

test('恢复调用点确实传了 freshResolve', () => {
  const recovery = fs.readFileSync(recoveryPath, 'utf8');
  const fnStart = recovery.indexOf('async function recoverCurrentTrackPlaybackFromFreshUrl');
  assert.ok(fnStart > 0, 'missing recoverCurrentTrackPlaybackFromFreshUrl()');
  const next = recovery.indexOf('\nasync function ', fnStart + 10);
  const body = recovery.slice(fnStart, next > 0 ? next : undefined);
  assert.match(body, /freshResolve:\s*true/, '重新取链没有要求新签名，会命中地址缓存');
});
