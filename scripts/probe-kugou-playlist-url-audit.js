'use strict';

/**
 * 对照实验：用真实登录态，对用户歌单里的一批 KG 曲目 + 两首目标歌
 * 逐一调 /api/kugou/song/url，区分：
 *   A) 只有这两首 UGC 曲目拿不到地址（上游无版权/仅客户端）；
 *   B) 整条 trackercdn 取址链路参数有问题（例如 vipType 传了 0）。
 *
 * 必须用【真实 profile】启动（safeStorage 密钥绑定 userData）。
 * 用法：node scripts/probe-kugou-playlist-url-audit.js
 */
const cdp = require('../.workbuddy/harness/cdp-client');
const PORT = 9442;

const TARGETS = [
  { name: 'Phone Kisses (雨声)', hash: '0340CCD98FC51CFE226057ADC75E2395', albumAudioId: '438093215' },
  { name: '罗生门 (Follow)', hash: 'A3294EF23A6FEE092BC7A72269730AAE', albumAudioId: '288989998' },
];

async function main() {
  let app = null;
  try {
    app = await cdp.launch({
      port: PORT, safeClose: true, bootTimeoutMs: 120000, evalTimeoutMs: 180000, extraArgs: [],
    });
  } catch (e) {
    console.log('FATAL  CDP 启动失败: ' + (e && e.message));
    process.exitCode = 1;
    return;
  }
  try {
    const ready = await app.waitReady(90000);
    console.log('ready=' + ready);
    if (!ready) return;
    await app.dismissSplash();

    const expression = `(async function(){
      var api = window.Mineradio.api.apiJson;
      async function call(p) {
        try { return { ok:true, d: await api(p, { timeoutMs: 25000 }) }; }
        catch (e) { return { ok:false, e: String(e && (e.message || e) || e) }; }
      }
      var out = { login:null, playlistRaw:[], sample:[], cases:[] };
      var pl = await call('/api/kugou/user/playlists');
      var d0 = pl.d || {};
      out.login = { loggedIn:d0.loggedIn, count:(d0.playlists||[]).length, error:pl.e };
      var lists = d0.playlists || (d0.data && d0.data.playlists) || [];
      out.playlistRaw = lists.slice(0,3).map(function(x){
        return { id:x.id||x.listid||x.list_id||x.global_collection_id||'', name:x.name||x.title||'', keys:Object.keys(x).slice(0,12) };
      });
      var collected = [];
      for (var i=0;i<Math.min(2,lists.length);i++) {
        var lid = out.playlistRaw[i].id;
        if (!lid) continue;
        var t = await call('/api/kugou/playlist/tracks?id=' + encodeURIComponent(lid));
        var td = t.d || {};
        var tracks = td.tracks || td.list || td.songs || (td.data && (td.data.tracks||td.data.list)) || [];
        for (var j=0;j<Math.min(8,tracks.length);j++) {
          var s = tracks[j] || {};
          collected.push({
            name: s.name||s.title||s.songName||'',
            hash: s.hash||s.FileHash||s.fileHash||s.id||'',
            albumAudioId: s.albumAudioId||s.album_audio_id||s.AlbumAudioID||''
          });
        }
      }
      out.sample = collected.map(function(s){ return { name:String(s.name).slice(0,30), hash:String(s.hash).slice(0,10), hasAaid:!!s.albumAudioId }; });
      var all = ${JSON.stringify(TARGETS)}.concat(collected.filter(function(s){ return !!s.hash; }).slice(0,8));
      for (var k=0;k<all.length;k++) {
        var song = all[k];
        var p = '/api/kugou/song/url?hash=' + encodeURIComponent(song.hash) +
                (song.albumAudioId ? '&albumAudioId=' + encodeURIComponent(song.albumAudioId) : '');
        var r = await call(p);
        var d = r.d || {};
        out.cases.push({
          name: String(song.name||'').slice(0,30),
          hash: String(song.hash||'').slice(0,10),
          playable: !!d.playable, hasUrl: !!d.url, code: d.kugouCode,
          reason: d.reason, loggedIn: d.loggedIn, vipType: d.vipType,
          err: r.e || ''
        });
        // 两首目标歌额外试四通道
        if (k < 2) {
          var m = await call(p + '&channels=multi');
          var md = m.d || {};
          out.cases.push({
            name: String(song.name||'').slice(0,30) + ' [4ch]',
            hash: String(song.hash||'').slice(0,10),
            playable: !!md.playable, hasUrl: !!md.url, code: md.kugouCode,
            reason: md.reason, loggedIn: md.loggedIn, vipType: md.vipType,
            err: m.e || '', message: md.message || ''
          });
        }
      }
      return out;
    })()`;

    const r = await app.eval(expression);
    if (!r || r.__thrown) { console.log('求值异常: ' + JSON.stringify(r)); return; }
    console.log('\nlogin: ' + JSON.stringify(r.login));
    console.log('playlists: ' + JSON.stringify(r.playlistRaw));
    console.log('sample: ' + JSON.stringify(r.sample));
    console.log('\n==== 取址对照 ====');
    (r.cases || []).forEach(function (c) {
      console.log(
        (c.playable ? 'OK   ' : 'FAIL ') +
        String(c.name).padEnd(34) +
        ' hash=' + String(c.hash).padEnd(11) +
        ' code=' + String(c.code) +
        ' reason=' + String(c.reason || c.message || '-') +
        ' vip=' + String(c.vipType) +
        (c.err ? ' ERR=' + c.err : ''));
    });
  } finally {
    try { await app.close(); } catch (_) {}
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
