'use strict';

/**
 * 真机取证：两首「KG 客户端能播、Mineradio 播不了」的酷狗 UGC 曲目，
 * 用用户真实登录态实调 /api/kugou/song/url，看服务端到底返回什么。
 *
 * 歌曲元数据来自用户真实存档 Local Storage/leveldb（UTF-16）：
 *   Phone Kisses (雨声)  hash=0340CCD98FC51CFE226057ADC75E2395  albumAudioId=438093215
 *   罗生门 (Follow)      hash=A3294EF23A6FEE092BC7A72269730AAE  albumAudioId=288989998
 *
 * ★ 必须用【真实 profile】启动（不要传 --user-data-dir）：
 *   Electron safeStorage 在 Windows 上的密钥绑定 userData，隔离 profile 解不开
 *   .kugou-cookie，会读成 len=0 / loggedIn:false，得到假的「未登录」结论。
 *   用户实例没在跑时直接带调试端口启动真实 exe 即可，只读不写存档。
 *
 * 用法：node scripts/probe-kugou-ugc-playurl.js
 */

const cdp = require('../.workbuddy/harness/cdp-client');
const PORT = 9441;

const SONGS = [
  { name: 'Phone Kisses (雨声)', hash: '0340CCD98FC51CFE226057ADC75E2395', albumAudioId: '438093215' },
  { name: '罗生门 (Follow)', hash: 'A3294EF23A6FEE092BC7A72269730AAE', albumAudioId: '288989998' },
];

async function main() {
  let app = null;
  try {
    app = await cdp.launch({
      port: PORT, safeClose: true, bootTimeoutMs: 120000, evalTimeoutMs: 90000,
      extraArgs: [],   // 真实 profile：safeStorage 才能解开 .kugou-cookie
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
      var out = { api: !!window.Mineradio, apiJson: !!(window.Mineradio && window.Mineradio.api && window.Mineradio.api.apiJson),
                  login: null, cases: [], errors: [] };
      async function call(path) {
        try {
          var d = await window.Mineradio.api.apiJson(path, { timeoutMs: 25000 });
          return { ok: true, data: d };
        } catch (e) {
          return { ok: false, error: String(e && (e.message || e) || e), status: e && e.status, data: e && e.data };
        }
      }
      // 登录态（只取是否 loggedIn，不打印歌单内容）
      var li = await call('/api/kugou/user/playlists');
      out.login = { ok: li.ok, status: li.status, error: li.error,
                    loggedIn: li.data && li.data.loggedIn,
                    playlists: li.data && li.data.playlists ? li.data.playlists.length : null };
      var songs = ${JSON.stringify(SONGS)};
      for (var i = 0; i < songs.length; i++) {
        var s = songs[i];
        var base = '/api/kugou/song/url?hash=' + encodeURIComponent(s.hash);
        var variants = [
          ['with-albumAudioId', base + '&albumAudioId=' + s.albumAudioId],
          ['without-albumAudioId', base],
          ['album_audio_id-alias', base + '&album_audio_id=' + s.albumAudioId]
        ];
        for (var j = 0; j < variants.length; j++) {
          var r = await call(variants[j][1]);
          var d = r.data || {};
          out.cases.push({
            song: s.name, label: variants[j][0], ok: r.ok, status: r.status, error: r.error,
            urlHead: d.url ? String(d.url).slice(0, 110) : '',
            playable: d.playable, loggedIn: d.loggedIn, vipType: d.vipType, vipLevel: d.vipLevel,
            reason: d.reason, kugouCode: d.kugouCode, message: d.message,
            level: d.level, source: d.source, resolvedHash: d.resolvedHash,
            effectiveQuality: d.effectiveQuality,
            restriction: d.restriction ? {
              category: d.restriction.category, action: d.restriction.action,
              message: d.restriction.message, rawMessage: d.restriction.rawMessage
            } : null
          });
        }
      }
      return out;
    })()`;

    const result = await app.eval(expression);
    console.log('\n==== 真机接口返回 ====');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { await app.close(); } catch (_) {}
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
