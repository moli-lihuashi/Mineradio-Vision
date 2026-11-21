// ====================================================================
//  路由: 媒体代理
//  - /api/cover  (封面代理, CORS)
//  - /api/audio  (音频代理, 支持 Range; 汽水 #auth= 走本地解密)
// ====================================================================
const { pipeline } = require('stream');
const { decodeHeaderParam } = require('../lib/proxy-headers');
const { Readable, Transform } = require('stream');

const BODY_STALL_TIMEOUT_MS = 30000;

// 上游 body 看门狗：连续 30s 没有任何新数据就断开，防止上游挂死占住连接
function stallGuardStream() {
  let timer = null;
  const arm = (self) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const err = new Error('upstream body stalled');
      err.code = 'UPSTREAM_STALL';
      self.destroy(err);
    }, BODY_STALL_TIMEOUT_MS);
  };
  const t = new Transform({
    transform(chunk, enc, cb) { arm(this); cb(null, chunk); },
    flush(cb) { if (timer) clearTimeout(timer); cb(); },
    destroy(err, cb) { if (timer) clearTimeout(timer); cb(err); },
  });
  arm(t);
  return t;
}

// 把上游 web ReadableStream 经 pipeline 转给 res：
// - pipeline 自动处理背压，慢客户端不再把数据堆在内存里
// - 客户端断开（切歌/取消）自动销毁上游读取，不再继续拉完整首歌
function pipeWebBodyToRes(res, webBody) {
  return new Promise((resolve, reject) => {
    pipeline(Readable.fromWeb(webBody), stallGuardStream(), res, (err) => {
      if (!err) { resolve(); return; }
      const clientGone = err.code === 'ERR_STREAM_PREMATURE_CLOSE'
        || err.code === 'ERR_STREAM_DESTROYED'
        || err.code === 'EPIPE'
        || err.code === 'ECONNRESET';
      /* 客户端走了这条路径**必须**把 res 收尾成 destroyed。
       * 只 resolve 而不动 res，会留下 headersSent=true / writableEnded=false 的响应：
       * 分发器靠 writableEnded 判断「matcher 处理完了」，于是继续往下掉到静态资源
       * 处理器，对同一个 res 再 writeHead(404) → ERR_HTTP_HEADERS_SENT，抛在 fs 回调里
       * 变进程级未捕获异常。实测触发：壁纸模式重建窗口 → 旧渲染进程 destroy →
       * 在途音频流中断 → 主进程崩溃退出（窗口留下 ERR_CONNECTION_REFUSED）。 */
      if (clientGone) {
        try { res.destroy(); } catch (_) {}
        resolve();
        return;
      }
      reject(err);
    });
  });
}

function sendProxyError(res, err, tag) {
  console.error(tag, err && err.code === 'UPSTREAM_STALL' ? err.message : err);
  if (!res.headersSent) {
    res.writeHead(502, { 'Cache-Control': 'no-store' });
    res.end();
  } else {
    try { res.destroy(); } catch (_) {}
  }
}

module.exports = function register(ctx) {
  const {
    UA,
    assertProxyableMediaUrl, fetchProxiedMedia,
    audioProxyHeadersFor, audioContentTypeForUrl, sendAudioBuffer,
    qishuiAudioAuthFromUrl, getQishuiDecryptedAudio,
  } = ctx;

  return async function(req, res, url, pn) {
    // ---------- 封面代理 (带 CORS 头, 给 canvas 提取像素用) ----------
    if (pn === '/api/cover') {
      try {
        let coverUrl;
        try { coverUrl = await assertProxyableMediaUrl(url.searchParams.get('url'), 'COVER'); }
        catch (err) {
          res.writeHead(400);
          res.end(err.message || 'Invalid cover url');
          return;
        }
        const resp = await fetchProxiedMedia(coverUrl, audioProxyHeadersFor(coverUrl));
        const ct  = resp.headers.get('content-type') || 'image/jpeg';
        const cl  = resp.headers.get('content-length');
        if (!resp.ok) throw new Error('upstream status ' + resp.status);
        if (!ct.startsWith('image/')) throw new Error('Unexpected content-type: ' + ct);
        if (cl && Number(cl) > 20 * 1024 * 1024) throw new Error('cover too large');
        const hdr = {
          'Content-Type': ct,
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'public, max-age=86400',
        };
        if (cl) hdr['Content-Length'] = cl;
        res.writeHead(resp.status, hdr);
        await pipeWebBodyToRes(res, resp.body);
      } catch (err) { sendProxyError(res, err, '[Cover]'); }
      return;
    }

    // ---------- 音频代理 (支持 Range；汽水 #auth= 走本地解密) ----------
    if (pn === '/api/audio') {
      try {
        const rawAudioUrl = url.searchParams.get('url');
        const range = req.headers.range || '';
        if (rawAudioUrl && String(rawAudioUrl).includes('#auth=')) {
          const authParsed = qishuiAudioAuthFromUrl(rawAudioUrl);
          try { await assertProxyableMediaUrl(authParsed.cleanUrl, 'AUDIO'); }
          catch (err) {
            res.writeHead(400);
            res.end(err.message || 'Invalid audio url');
            return;
          }
          const decrypted = await getQishuiDecryptedAudio(rawAudioUrl);
          if (decrypted && decrypted.buffer) {
            sendAudioBuffer(res, decrypted.buffer, decrypted.contentType, range);
            return;
          }
        }
        let audioUrl;
        try { audioUrl = await assertProxyableMediaUrl(rawAudioUrl, 'AUDIO'); }
        catch (err) {
          res.writeHead(400);
          res.end(err.message || 'Invalid audio url');
          return;
        }
        // 音源（如 LX 源脚本）返回的地址可能带防盗链，需要补 Referer/UA。
        // 只接受 referer/origin/user-agent 三个头，见 server/lib/proxy-headers.js。
        const extraHeaders = decodeHeaderParam(url.searchParams.get('h'));
        const hdr = Object.assign(audioProxyHeadersFor(audioUrl, range), extraHeaders);
        const up = await fetchProxiedMedia(audioUrl, hdr);
        const out = {
          'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
          'Accept-Ranges': 'bytes',
        };
        const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
        const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
        res.writeHead(up.status, out);
        await pipeWebBodyToRes(res, up.body);
      } catch (err) { sendProxyError(res, err, '[Audio]'); }
      return;
    }
  };
};
