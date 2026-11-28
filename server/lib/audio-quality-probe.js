'use strict';

/**
 * 取址后的「真实性」校验：上游声明的 level/bitrate 只是它自己的说法，CDN 实际发什么另说。
 * 已知形态：标 lossless 实发 320k mp3；标 hires 实发 16bit/44.1k FLAC（CD 级）。
 * 这类偏差不会报错，只会让整首歌听起来「闷」——正是最容易被当成玄学的那一类。
 *
 * 做法：取地址后异步拉文件头（Range: 前 128KB），按容器魔数判断有损/无损，
 * FLAC 再解 STREAMINFO 拿采样率与位深，MP3 解首帧头拿真实码率。
 * 判据只用于「向下纠正」：证明不了更好时不改动上游标注，绝不因为探测失败降档。
 *
 * 代价与取舍：探测是 fire-and-forget，不占起播路径；结果写回地址缓存，
 * 因此第一次播放仍显示上游标注，同一次会话的后续播放显示真实档位。
 */

const http = require('http');
const https = require('https');

const LEVEL_RANK = { standard: 1, exhigh: 2, lossless: 3, hires: 4, jymaster: 5 };
const PROBE_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 2500;
/* 墙钟上限：setTimeout 只在「连不上」时救命，上游慢速滴流时永远不触发。
   探测是 fire-and-forget，慢 CDN 不值得我们挂住一个 socket（实测样本站点要 15s）。 */
const DEFAULT_HARD_DEADLINE_MS = 4000;

function normalizeLevel(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'jymaster' || text === 'master' || text === 'svip') return 'jymaster';
  if (text === 'hires' || text === 'hi-res' || text === 'highres' || text === 'highest') return 'hires';
  if (text === 'lossless' || text === 'flac' || text === 'sq') return 'lossless';
  if (text === 'exhigh' || text === 'high' || text === '320k' || text === 'hq') return 'exhigh';
  if (text === 'standard' || text === 'normal' || text === 'std') return 'standard';
  return '';
}

function levelRank(value) {
  return LEVEL_RANK[normalizeLevel(value)] || 0;
}

function sniffContainer(buf) {
  if (!buf || buf.length < 4) return '';
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return 'flac'; // fLaC
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3';                     // ID3
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';                              // 裸帧同步
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  return '';
}

/** STREAMINFO 是 fLaC 之后的第一个 metadata block（type 0，固定 34 字节）。 */
function parseFlacStreamInfo(buf) {
  if (!buf || buf.length < 42 || sniffContainer(buf) !== 'flac') return null;
  if (((buf[4] >> 0) & 0x7f) !== 0) return null; // 不是 STREAMINFO
  const b = buf;
  const sampleRate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
  const channels = ((b[20] >> 1) & 0x07) + 1;
  const bitsPerSample = (((b[20] & 0x01) << 4) | (b[21] >> 4)) + 1;
  const totalSamples = (b[21] & 0x0f) * 4294967296 + (((b[22] << 24) | (b[23] << 16) | (b[24] << 8) | b[25]) >>> 0);
  if (!sampleRate || !bitsPerSample) return null;
  return { sampleRate, channels, bitsPerSample, totalSamples };
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_RATES = [44100, 48000, 32000, 0];
const MPEG2_RATES = [22050, 24000, 16000, 0];

/** 跳过 ID3v2 后解首帧头：给的是「真实码率」，不是上游自报的档位。 */
function parseMp3FrameInfo(buf) {
  if (!buf || buf.length < 8) return null;
  let offset = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    offset = 10 + size + ((buf[5] & 0x10) ? 10 : 0);
  }
  const limit = Math.min(buf.length - 4, offset + 64 * 1024);
  for (let i = Math.max(0, offset); i < limit; i += 1) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buf[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (buf[i + 1] >> 1) & 0x03;   // 1=Layer3
    const bitrateIndex = (buf[i + 2] >> 4) & 0x0f;
    const rateIndex = (buf[i + 2] >> 2) & 0x03;
    if (layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const mpeg1 = versionBits === 3;
    const bitrateKbps = (mpeg1 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex];
    const sampleRate = (mpeg1 ? MPEG1_RATES : MPEG2_RATES)[rateIndex];
    if (!bitrateKbps) continue;
    return { bitrateKbps, sampleRate, mpeg1 };
  }
  return null;
}

/** content-range: "bytes 0-131071/12345678" → 总长度 */
function totalBytesFromHeaders(headers) {
  const range = String((headers && (headers['content-range'] || headers['Content-Range'])) || '');
  const slash = range.lastIndexOf('/');
  if (slash >= 0) {
    const total = Number(range.slice(slash + 1));
    if (Number.isFinite(total) && total > 0) return total;
  }
  const length = Number((headers && (headers['content-length'] || headers['Content-Length'])) || 0);
  return Number.isFinite(length) && length > 0 ? length : 0;
}

/**
 * 把探测结果折算成「实际交付的档位」。
 * 只在能证明「比声明差」时返回纠正值；证明不了（mp4/ogg、无码率、探测失败）一律返回空。
 */
function classifyClaim(claimedLevel, probe) {
  const claimed = normalizeLevel(claimedLevel);
  if (!claimed || !probe || !probe.container) return { level: '', mismatch: '' };
  let actual = '';
  if (probe.container === 'flac') {
    const bits = Number(probe.bitsPerSample) || 0;
    const rate = Number(probe.sampleRate) || 0;
    // 24bit 或 >48k 才算 hires；16bit/44.1k 的 FLAC 就是 CD 级 lossless
    actual = (bits > 16 || rate > 48000) ? 'hires' : 'lossless';
  } else if (probe.container === 'mp3' || probe.container === 'aac') {
    const br = Number(probe.bitrateKbps) || 0;
    if (br > 0) actual = br >= 256 ? 'exhigh' : 'standard';
  } else if (probe.container === 'wav') {
    actual = 'lossless';
  }
  if (!actual) return { level: '', mismatch: '' };
  if (levelRank(actual) >= levelRank(claimed)) return { level: '', mismatch: '' };
  // jymaster 只按有损降级：母带可能是 24/48，凭位深/采样率判它不足不成立
  if (claimed === 'jymaster' && levelRank(actual) >= LEVEL_RANK.lossless) return { level: '', mismatch: '' };
  return { level: actual, mismatch: claimed + '→' + actual };
}

/**
 * 拉文件头并解析。任何失败都返回 null —— 探测不到不等于音质有问题。
 * headers 走调用方传入（各平台防盗链要求不同），默认只带 Range 与 UA。
 * 跟随最多 3 次重定向：真实 CDN 常见 301/302 到边缘节点（samplelib、部分酷狗节点都这样），
 * 不跟随会拿一个空 body 回来，然后被误判成「探测失败」。
 */
function probeAudioQuality(targetUrl, options, redirectsLeft) {
  const opts = options || {};
  const hops = Number.isFinite(redirectsLeft) ? redirectsLeft : 3;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const hardDeadlineMs = Number(opts.hardDeadlineMs) > 0 ? Number(opts.hardDeadlineMs) : DEFAULT_HARD_DEADLINE_MS;
  return new Promise((resolve) => {
    let settled = false;
    let hardTimer = null;
    const startedAt = Date.now();
    let req = null;
    const done = (value) => {
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let parsedUrl;
    try {
      parsedUrl = new URL(String(targetUrl || ''));
    } catch (_) {
      done(null);
      return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      done(null);
      return;
    }
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      Range: 'bytes=0-' + (PROBE_BYTES - 1),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mineradio/quality-probe',
    }, opts.headers || {});
    try {
      req = lib.request(parsedUrl, { method: 'GET', headers }, (res) => {
        const status = Number(res.statusCode) || 0;
        if (status >= 300 && status < 400 && res.headers && res.headers.location && hops > 0) {
          let next = '';
          try { next = new URL(String(res.headers.location), parsedUrl).toString(); } catch (_) {}
          if (next) {
            /* 交棒给下一跳：外层必须彻底退场，而且要在 destroy 之前退场 ——
               destroy 会同步抛 error，'error' 处理器一 done(null) 就把下一跳的
               结果作废（实测：302 → 边缘节点，外层 timeout 先开火，整次判失败）。 */
            settled = true;
            if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
            try { req.setTimeout(0); } catch (_) {}
            try { res.destroy(); } catch (_) {}
            probeAudioQuality(next, opts, hops - 1).then(resolve, () => resolve(null));
            return;
          }
          try { res.destroy(); } catch (_) {}
          done(null);
          return;
        }
        const chunks = [];
        let received = 0;
        const finish = () => {
          const buf = Buffer.concat(chunks);
          const container = sniffContainer(buf);
          const probe = {
            status: res.statusCode,
            container,
            contentType: String(res.headers['content-type'] || ''),
            totalBytes: totalBytesFromHeaders(res.headers),
            elapsedMs: Date.now() - startedAt,
          };
          if (container === 'flac') {
            const info = parseFlacStreamInfo(buf);
            if (info) Object.assign(probe, info);
          } else if (container === 'mp3') {
            const frame = parseMp3FrameInfo(buf);
            if (frame) Object.assign(probe, frame);
          }
          if (opts.durationMs > 0 && probe.totalBytes > 0 && !probe.bitrateKbps) {
            probe.bitrateKbps = Math.round((probe.totalBytes * 8) / (Number(opts.durationMs) / 1000) / 1000);
            probe.bitrateEstimated = true;
          }
          done(probe);
          try { res.destroy(); } catch (_) {}
        };
        res.on('data', (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          if (received >= PROBE_BYTES) finish();
        });
        res.on('end', finish);
        res.on('error', () => done(null));
      });
    } catch (_) {
      done(null);
      return;
    }
    if (req) {
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_) {} done(null); });
      req.on('error', () => done(null));
      // 墙钟上限：慢速滴流的上游不会触发 inactivity 超时（实测 3s 的样本文件拉了 15s）
      hardTimer = setTimeout(() => {
        try { req.destroy(); } catch (_) {}
        done(null);
      }, hardDeadlineMs);
      req.end();
    }
  });
}

/**
 * 取址之后调用：探测 + 把「名不副实的档位」写回地址缓存。
 * 不阻塞响应；日志只记一次纠正，不刷屏。返回的 promise 便于测试等待。
 */
function verifyResolvedQuality(input) {
  const opts = input || {};
  const cache = opts.cache;
  const cacheKey = opts.cacheKey;
  const data = opts.data;
  if (!data || !data.url) return Promise.resolve(null);
  if (levelRank(data.level) < LEVEL_RANK.lossless) return Promise.resolve(null);
  return probeAudioQuality(data.url, {
    headers: opts.headers,
    durationMs: opts.durationMs,
  }).then((probe) => {
    if (!probe) return null;
    const verdict = classifyClaim(data.level, probe);
    if (!verdict.level) return Object.assign({ probe, corrected: false }, verdict);
    if (cache && cacheKey) {
      cache.correct(cacheKey, { level: verdict.level, qualityMismatch: verdict.mismatch });
    }
    if (typeof opts.onCorrect === 'function') {
      try { opts.onCorrect(verdict, probe); } catch (_) {}
    }
    console.warn('[AudioQuality] 档位名不副实 ' + verdict.mismatch
      + ' container=' + probe.container
      + ' br=' + (probe.bitrateKbps || '?') + 'kbps'
      + ' sr=' + (probe.sampleRate || '?') + ' bits=' + (probe.bitsPerSample || '?'));
    return Object.assign({ probe, corrected: true }, verdict);
  }).catch(() => null);
}

module.exports = {
  probeAudioQuality,
  verifyResolvedQuality,
  classifyClaim,
  sniffContainer,
  parseFlacStreamInfo,
  parseMp3FrameInfo,
  totalBytesFromHeaders,
  normalizeLevel,
  levelRank,
  PROBE_BYTES,
};
