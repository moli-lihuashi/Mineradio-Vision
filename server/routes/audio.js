// ====================================================================
//  路由: 媒体代理
//  - /api/cover  (封面代理, CORS)
//  - /api/audio  (音频代理, 支持 Range; 汽水 #auth= 走本地解密)
// ====================================================================
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
        const resp = await fetchProxiedMedia(coverUrl, { 'User-Agent': UA, 'Referer': 'https://music.163.com/' });
        const ct  = resp.headers.get('content-type') || 'image/jpeg';
        const cl  = resp.headers.get('content-length');
        const hdr = {
          'Content-Type': ct,
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'public, max-age=86400',
        };
        if (cl) hdr['Content-Length'] = cl;
        res.writeHead(resp.status, hdr);
        const reader = resp.body.getReader();
        while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
        res.end();
      } catch (err) { console.error('[Cover]', err); res.writeHead(500); res.end(); }
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
        const hdr = audioProxyHeadersFor(audioUrl, range);
        const up = await fetchProxiedMedia(audioUrl, hdr);
        const out = {
          'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
          'Accept-Ranges': 'bytes',
        };
        const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
        const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
        res.writeHead(up.status, out);
        const reader = up.body.getReader();
        while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
        res.end();
      } catch (err) { console.error('[Audio]', err); res.writeHead(500); res.end(); }
      return;
    }
  };
};
