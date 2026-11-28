'use strict';

/* 档位真实性探测（2026-11-28）。
 *
 * 上游声明的 level 只是它自己的说法：标 lossless 实发 320k mp3、标 hires 实发
 * 16bit/44.1k FLAC 都出现过，表现是「整首闷」而不是报错。
 * 判据只用于向下纠正：证明不了更好时一律不改上游标注。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const probe = require('../server/lib/audio-quality-probe');

function flacHeader({ sampleRate, channels, bitsPerSample, totalSamples = 0 }) {
  const buf = Buffer.alloc(42);
  buf.write('fLaC', 0, 'latin1');
  buf[4] = 0x00;            // 非最后一块，type 0 = STREAMINFO
  buf.writeUIntBE(34, 5, 3); // 长度 34
  const sr = sampleRate;
  const ch = channels - 1;
  const bps = bitsPerSample - 1;
  buf[18] = (sr >> 12) & 0xff;
  buf[19] = (sr >> 4) & 0xff;
  buf[20] = ((sr & 0x0f) << 4) | ((ch & 0x07) << 1) | ((bps >> 4) & 0x01);
  buf[21] = (((bps & 0x0f) << 4) | Math.floor(totalSamples / 4294967296)) & 0xff;
  buf.writeUInt32BE(totalSamples >>> 0, 22);
  return buf;
}

function mp3Frame(bitrateIndex, rateIndex = 0) {
  const buf = Buffer.alloc(16);
  buf.write('ID3', 0, 'latin1');
  buf[3] = 4; buf[4] = 0; buf[5] = 0;
  buf[6] = 0; buf[7] = 0; buf[8] = 0; buf[9] = 0; // ID3v2 size = 0
  buf[10] = 0xff;
  buf[11] = 0xfb; // MPEG1 Layer3
  buf[12] = ((bitrateIndex & 0x0f) << 4) | ((rateIndex & 0x03) << 2);
  buf[13] = 0x00;
  return buf;
}

test('容器识别：flac / mp3(带 ID3) / mp4 / wav', () => {
  assert.equal(probe.sniffContainer(flacHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16 })), 'flac');
  assert.equal(probe.sniffContainer(mp3Frame(9)), 'mp3');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A ', 'latin1')]);
  assert.equal(probe.sniffContainer(mp4), 'mp4');
  const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVEfmt ', 'latin1')]);
  assert.equal(probe.sniffContainer(wav), 'wav');
  assert.equal(probe.sniffContainer(Buffer.from('nope', 'latin1')), '');
});

test('FLAC STREAMINFO：解出采样率/声道/位深（24bit 96k）', () => {
  const info = probe.parseFlacStreamInfo(flacHeader({ sampleRate: 96000, channels: 2, bitsPerSample: 24 }));
  assert.deepEqual(info, { sampleRate: 96000, channels: 2, bitsPerSample: 24, totalSamples: 0 });
});

test('FLAC STREAMINFO：CD 级 16bit 44.1k', () => {
  const info = probe.parseFlacStreamInfo(flacHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16 }));
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.bitsPerSample, 16);
});

test('MP3 首帧：128k / 320k 真实码率', () => {
  assert.equal(probe.parseMp3FrameInfo(mp3Frame(9)).bitrateKbps, 128);
  assert.equal(probe.parseMp3FrameInfo(mp3Frame(14)).bitrateKbps, 320);
});

test('Content-Range 里的总长度优先于 Content-Length（Range 响应的 length 只是片段）', () => {
  assert.equal(probe.totalBytesFromHeaders({ 'content-range': 'bytes 0-131071/9876543', 'content-length': '131072' }), 9876543);
  assert.equal(probe.totalBytesFromHeaders({ 'content-length': '5242880' }), 5242880);
  assert.equal(probe.totalBytesFromHeaders({}), 0);
});

test('纠正：标 hires 实发 CD 级 FLAC → 降为 lossless', () => {
  const verdict = probe.classifyClaim('hires', {
    container: 'flac', sampleRate: 44100, bitsPerSample: 16,
  });
  assert.equal(verdict.level, 'lossless');
  assert.equal(verdict.mismatch, 'hires→lossless');
});

test('纠正：标 lossless 实发 128k mp3 → 降为 standard', () => {
  const verdict = probe.classifyClaim('lossless', { container: 'mp3', bitrateKbps: 128 });
  assert.equal(verdict.level, 'standard');
});

test('不纠正：标 hires 且确实是 24bit/96k FLAC', () => {
  assert.equal(probe.classifyClaim('hires', { container: 'flac', sampleRate: 96000, bitsPerSample: 24 }).level, '');
});

test('不纠正：标 lossless 实发 16bit/44.1k FLAC（名实相符）', () => {
  assert.equal(probe.classifyClaim('lossless', { container: 'flac', sampleRate: 44100, bitsPerSample: 16 }).level, '');
});

test('jymaster 只按有损降级：24/48 的母带不算名不副实', () => {
  assert.equal(probe.classifyClaim('jymaster', { container: 'flac', sampleRate: 48000, bitsPerSample: 24 }).level, '');
  assert.equal(probe.classifyClaim('jymaster', { container: 'mp3', bitrateKbps: 320 }).level, 'exhigh');
});

test('证明不了就不动：mp4 / 无码率 / 探测为空', () => {
  assert.equal(probe.classifyClaim('hires', { container: 'mp4' }).level, '');
  assert.equal(probe.classifyClaim('hires', { container: 'mp3' }).level, '');
  assert.equal(probe.classifyClaim('hires', null).level, '');
  assert.equal(probe.classifyClaim('', { container: 'mp3', bitrateKbps: 128 }).level, '');
});

test('非无损档不触发探测（不起网络请求，直接返回 null）', async () => {
  const result = await probe.verifyResolvedQuality({ data: { url: 'https://example.invalid/a.mp3', level: 'exhigh' } });
  assert.equal(result, null);
});

test('没有地址时不探测', async () => {
  const result = await probe.verifyResolvedQuality({ data: { level: 'hires' } });
  assert.equal(result, null);
});

// ---- 真实 HTTP 行为：重定向、Range、慢速滴流的墙钟上限 ----
// 纯解析测试证明不了「拿到字节」的那一段；真实 CDN 常见 302 到边缘节点、
// 206 + Content-Range，以及慢速滴流（inactivity 超时永远不触发）。

const http = require('node:http');

function serveOnce(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      origin: 'http://127.0.0.1:' + server.address().port,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

test('跟随 302：边缘节点重定向后仍能解析', async () => {
  const flac = flacHeader({ sampleRate: 96000, channels: 2, bitsPerSample: 24 });
  const edge = await serveOnce((req, res) => {
    res.writeHead(206, { 'Content-Type': 'audio/flac', 'Content-Length': String(flac.length) });
    res.end(flac);
  });
  const front = await serveOnce((req, res) => {
    res.writeHead(302, { Location: edge.origin + '/edge.flac' });
    res.end();
  });
  try {
    const result = await probe.probeAudioQuality(front.origin + '/song.flac', { timeoutMs: 3000 });
    assert.ok(result, '302 没有被跟随，探测拿不到字节');
    assert.equal(result.container, 'flac');
    assert.equal(result.sampleRate, 96000);
    assert.equal(result.bitsPerSample, 24);
  } finally {
    await front.close();
    await edge.close();
  }
});

test('Content-Range 的总长度进结果（Range 响应的 Content-Length 只是片段）', async () => {
  const flac = flacHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16 });
  const srv = await serveOnce((req, res) => {
    res.writeHead(206, {
      'Content-Type': 'audio/flac',
      'Content-Range': 'bytes 0-' + (flac.length - 1) + '/9876543',
      'Content-Length': String(flac.length),
    });
    res.end(flac);
  });
  try {
    const result = await probe.probeAudioQuality(srv.origin + '/a.flac', { timeoutMs: 3000 });
    assert.equal(result.totalBytes, 9876543);
  } finally {
    await srv.close();
  }
});

test('慢速滴流：墙钟上限兜底返回 null（不会挂住 socket）', async () => {
  const srv = await serveOnce((req, res) => {
    res.writeHead(206, { 'Content-Type': 'audio/flac', 'Content-Length': '9999999' });
    res.write(Buffer.from([0x66])); // 发一个字节后一直不结束
  });
  const startedAt = Date.now();
  try {
    const result = await probe.probeAudioQuality(srv.origin + '/slow.flac', {
      timeoutMs: 5000,   // inactivity 超时不会触发（每 50ms 有字节也照样滴）
      hardDeadlineMs: 400,
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(result, null);
    assert.ok(elapsed < 2500, '墙钟上限没生效，探测挂住了 ' + elapsed + 'ms');
  } finally {
    await srv.close();
  }
});

test('302 交棒后外层预算必须退场：链路总耗时超过首跳剩余预算仍能成功', async () => {
  const flac = flacHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 24 });
  // 首跳用掉 180ms 才给 302，边缘节点再要 100ms > 首跳剩余预算（20ms）。
  // 交棒不重置预算的话，外层墙钟在 200ms 开火，把 280ms 才完成的探测判死。
  const edge = await serveOnce((req, res) => {
    setTimeout(() => {
      res.writeHead(206, { 'Content-Type': 'audio/flac', 'Content-Length': String(flac.length) });
      res.end(flac);
    }, 100);
  });
  const front = await serveOnce((req, res) => {
    setTimeout(() => {
      res.writeHead(302, { Location: edge.origin + '/edge.flac' });
      res.end();
    }, 180);
  });
  try {
    const result = await probe.probeAudioQuality(front.origin + '/song.flac', {
      timeoutMs: 200, hardDeadlineMs: 200,
    });
    assert.ok(result, '外层预算在交棒后仍然生效，把慢一跳的探测判死了');
    assert.equal(result.container, 'flac');
    assert.equal(result.bitsPerSample, 24);
  } finally {
    await front.close();
    await edge.close();
  }
});
