'use strict';

// 汽水音乐（抖音系）加密音频解密：
//   · 逐样本 AES 在 worker 线程里跑，避免阻塞主进程事件循环（worker 不可用/出错自动回退同步解密）
//   · 解密结果按「干净 URL + spadeA」做 sha1 缓存，LRU 按字节上限淘汰
//   · 同一首歌并发请求合并成一次下载解密（inflight 去重），并发上限 QISHUI_DECRYPT_MAX_CONCURRENT
//   · 产物做文件头校验（fLaC / ftyp+moov），不过就当解密失败，绝不把脏数据发给渲染端
// 从 server.js 抽出（原 server.js 249–345 与 2059–2152）。不 require server.js，避免循环依赖。
//
// deps: { workerPath, crypto, Worker, TrackDecryptor, mediaProxy }
//   mediaProxy 是 server/lib/media-proxy.js 的完整导出对象（单向依赖，反向不引用）

module.exports = function createQishuiAudio(deps) {
  const {
    workerPath,
    crypto,
    Worker,
    TrackDecryptor,
    mediaProxy,
  } = deps || {};
  const { fetchProxiedMedia, audioProxyHeadersFor } = mediaProxy || {};

  const qishuiAudioDecryptor = new TrackDecryptor();
  const qishuiAudioDecryptCache = new Map();
  const QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES = 96 * 1024 * 1024;
  let qishuiAudioDecryptCacheBytes = 0;

  // ---- 汽水音频解密 worker（把逐样本 AES 从主进程事件循环挪到 worker 线程）----
  // 目的：避免解密阻塞主进程 → UI 卡顿；并在独立堆里跑，降低主进程内存尖峰导致整 app 崩的概率。
  // 单 worker 串行解密（解密是 CPU 密集，串行反而最优）；worker 不可用/出错时自动回退同步解密。
  let qishuiDecryptWorker = null;
  let qishuiDecryptWorkerFailed = false;
  const qishuiWorkerPending = new Map();
  let qishuiWorkerSeq = 0;

  function ensureQishuiDecryptWorker() {
    if (qishuiDecryptWorker || qishuiDecryptWorkerFailed) return qishuiDecryptWorker;
    try {
      const worker = new Worker(workerPath);
      worker.on('message', (msg) => {
        const pending = msg && qishuiWorkerPending.get(msg.id);
        if (!pending) return;
        qishuiWorkerPending.delete(msg.id);
        if (msg.ok) pending.resolve({ buffer: msg.buffer, extension: msg.extension });
        else pending.reject(new Error(msg.error || 'qishui decrypt worker failed'));
      });
      const failAll = (err) => {
        const entries = [...qishuiWorkerPending.values()];
        qishuiWorkerPending.clear();
        entries.forEach((p) => p.reject(err));
      };
      worker.on('error', (err) => {
        console.error('[QishuiDecryptWorker] worker error, fallback to sync:', err && err.message);
        qishuiDecryptWorkerFailed = true;
        qishuiDecryptWorker = null;
        failAll(err || new Error('qishui decrypt worker error'));
      });
      worker.on('exit', (code) => {
        if (qishuiWorkerPending.size) {
          console.error('[QishuiDecryptWorker] worker exited code', code, ', fallback to sync');
          qishuiDecryptWorkerFailed = true;
          failAll(new Error('qishui decrypt worker exited ' + code));
        }
        qishuiDecryptWorker = null;
      });
      qishuiDecryptWorker = worker;
    } catch (err) {
      console.error('[QishuiDecryptWorker] worker create failed, using sync decrypt:', err && err.message);
      qishuiDecryptWorkerFailed = true;
      qishuiDecryptWorker = null;
    }
    return qishuiDecryptWorker;
  }

  function qishuiDecryptInWorker(encryptedBuffer, spadeA) {
    const worker = ensureQishuiDecryptWorker();
    if (!worker) return Promise.reject(new Error('qishui decrypt worker unavailable'));
    const id = ++qishuiWorkerSeq;
    return new Promise((resolve, reject) => {
      qishuiWorkerPending.set(id, { resolve, reject });
      try {
        // transfer 加密 buffer（只传底层 ArrayBuffer），避免结构化克隆再复制一份。
        // encryptedBuffer 由 Buffer.from(arrayBuffer) 得到，byteOffset=0、长度=整个 ArrayBuffer，
        // 因此 transfer .buffer 即恰好转移这段加密数据。
        worker.postMessage({ id, encryptedBuffer, spadeA }, [encryptedBuffer.buffer]);
      } catch (transferErr) {
        // 兜底：极少数情况底层 ArrayBuffer 不可 transfer（如来自共享池），退回复制传递
        try {
          worker.postMessage({ id, encryptedBuffer, spadeA });
        } catch (err) {
          qishuiWorkerPending.delete(id);
          reject(err);
        }
      }
    });
  }

  async function qishuiDecryptAudio(encryptedBuffer, spadeA) {
    if (!qishuiDecryptWorkerFailed) {
      try {
        return await qishuiDecryptInWorker(encryptedBuffer, spadeA);
      } catch (err) {
        // worker 任务失败：若 worker 已不可用，后续会走同步；本条因 buffer 已 transfer，直接抛出（该曲播放失败但不崩）
        console.error('[QishuiDecrypt] worker decrypt failed:', err && err.message);
        throw err;
      }
    }
    return qishuiAudioDecryptor.decrypt({ encryptedBuffer, spadeA });
  }

  function looksLikeValidDecryptedAudio(buffer, extension) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
    if (extension === '.flac') {
      return buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43; // 'fLaC'
    }
    // m4a: 前 4 字节是 box 大小，第 5-8 字节应为 'ftyp'，且应包含 'moov'
    const ftyp = buffer.toString('latin1', 4, 8);
    return ftyp === 'ftyp' && buffer.includes(Buffer.from('moov'));
  }

  function qishuiAudioAuthFromUrl(audioUrl) {
    const text = String(audioUrl || '');
    const idx = text.indexOf('#auth=');
    if (idx < 0) return { cleanUrl: text, auth: '' };
    const authRaw = text.slice(idx + 6);
    let auth = authRaw;
    try { auth = decodeURIComponent(authRaw); } catch (_) {}
    return { cleanUrl: text.slice(0, idx), auth };
  }

  function qishuiAudioCacheKey(cleanUrl, auth) {
    return crypto.createHash('sha1').update(String(cleanUrl || '') + '\n' + String(auth || '')).digest('hex');
  }

  function rememberQishuiDecryptedAudio(key, payload) {
    if (!payload || !Buffer.isBuffer(payload.buffer)) return;
    qishuiAudioDecryptCache.set(key, Object.assign({ at: Date.now() }, payload));
    qishuiAudioDecryptCacheBytes += payload.buffer.length;
    while (qishuiAudioDecryptCacheBytes > QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES && qishuiAudioDecryptCache.size > 1) {
      const oldest = [...qishuiAudioDecryptCache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0];
      if (!oldest) break;
      qishuiAudioDecryptCache.delete(oldest[0]);
      qishuiAudioDecryptCacheBytes -= oldest[1].buffer.length;
    }
  }

  // 汽水加密音频解密：并发上限 + 大小防御；同一首歌并发请求合并为一次下载解密
  const QISHUI_DECRYPT_MAX_CONCURRENT = 2;
  const QISHUI_ENCRYPTED_AUDIO_MAX_BYTES = 128 * 1024 * 1024;
  const qishuiDecryptInflight = new Map();
  let qishuiDecryptActive = 0;
  const qishuiDecryptWaiters = [];
  function qishuiDecryptAcquire() {
    if (qishuiDecryptActive < QISHUI_DECRYPT_MAX_CONCURRENT) {
      qishuiDecryptActive += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => qishuiDecryptWaiters.push(resolve));
  }
  function qishuiDecryptRelease() {
    const next = qishuiDecryptWaiters.shift();
    if (next) next();
    else qishuiDecryptActive -= 1;
  }
  async function getQishuiDecryptedAudio(audioUrl) {
    const parsed = qishuiAudioAuthFromUrl(audioUrl);
    if (!parsed.auth) return null;
    const key = qishuiAudioCacheKey(parsed.cleanUrl, parsed.auth);
    const cached = qishuiAudioDecryptCache.get(key);
    if (cached) {
      cached.at = Date.now();
      return cached;
    }
    const inflight = qishuiDecryptInflight.get(key);
    if (inflight) return inflight;
    const task = (async () => {
      await qishuiDecryptAcquire();
      try {
        const cachedAfterWait = qishuiAudioDecryptCache.get(key);
        if (cachedAfterWait) {
          cachedAfterWait.at = Date.now();
          return cachedAfterWait;
        }
        const up = await fetchProxiedMedia(parsed.cleanUrl, audioProxyHeadersFor(parsed.cleanUrl, ''));
        if (!up.ok) throw new Error('Qishui encrypted audio fetch failed: HTTP ' + up.status);
        const declared = Number(up.headers.get('content-length')) || 0;
        if (declared > QISHUI_ENCRYPTED_AUDIO_MAX_BYTES) {
          throw new Error('Qishui encrypted audio too large: ' + declared + ' bytes');
        }
        const encryptedBuffer = Buffer.from(await up.arrayBuffer());
        if (encryptedBuffer.length > QISHUI_ENCRYPTED_AUDIO_MAX_BYTES) {
          throw new Error('Qishui encrypted audio too large: ' + encryptedBuffer.length + ' bytes');
        }
        const result = await qishuiDecryptAudio(encryptedBuffer, parsed.auth);
        const payload = {
          buffer: result.buffer,
          contentType: result.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
          extension: result.extension,
        };
        // 产物校验：解密失败/曲目结构不符时会产出非音视频数据，喂给渲染端可能打崩媒体管线。
        // 校验不过就当该曲解密失败，返回错误让播放走降级，绝不把脏数据发出去。
        if (!looksLikeValidDecryptedAudio(payload.buffer, payload.extension)) {
          throw new Error('Qishui decrypted audio failed signature check');
        }
        rememberQishuiDecryptedAudio(key, payload);
        return payload;
      } finally {
        qishuiDecryptRelease();
        qishuiDecryptInflight.delete(key);
      }
    })();
    qishuiDecryptInflight.set(key, task);
    return task;
  }

  return {
    QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES,
    ensureQishuiDecryptWorker,
    qishuiDecryptInWorker,
    qishuiDecryptAudio,
    looksLikeValidDecryptedAudio,
    qishuiAudioAuthFromUrl,
    qishuiAudioCacheKey,
    rememberQishuiDecryptedAudio,
    QISHUI_DECRYPT_MAX_CONCURRENT,
    QISHUI_ENCRYPTED_AUDIO_MAX_BYTES,
    qishuiDecryptAcquire,
    qishuiDecryptRelease,
    getQishuiDecryptedAudio,
  };
};
