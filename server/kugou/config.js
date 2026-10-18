'use strict';

// 酷狗：环境 / 端点 / 加密盐 / 版本号 / 调试开关。
//
// 第 1 刀从 kugou-api.js 抽出。零依赖：不 require 任何本地模块，也不碰运行时状态。


const KUGOU_SEARCH_URL = 'http://songsearch.kugou.com/song_search_v2';

const KUGOU_PLAY_MOBILE = 'http://m.kugou.com/app/i/getSongInfo.php';

const KUGOU_PLAY_WEB = 'https://wwwapi.kugou.com/yy/index.php';

const KUGOU_VIP_ROLEINFO_URL = 'https://vip.kugou.com/recharge/roleinfo';

const KUGOU_LYRIC_SEARCH = 'https://krcs.kugou.com/search';

const KUGOU_LYRIC_DOWNLOAD = 'https://krcs.kugou.com/download';

const KUGOU_HEADERS = {
  Referer: 'https://www.kugou.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const KUGOU_GATEWAY = 'https://gateway.kugou.com';

const KUGOU_APPID = 1005;

const KUGOU_WEB_APPID = 1014;

const KUGOU_VERBOSE = !!process.env.MINERADIO_DEBUG;

function kugouDebug() {
  if (!KUGOU_VERBOSE) return;
  console.log.apply(console, arguments);
}

const KUGOU_CLIENTVER = 20489;

const KUGOU_ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';

const KUGOU_H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

const KUGOU_H5_SRC_APPID = '2919';

const KUGOU_H5_CLIENTVER = '20000';

const KUGOU_SIGN_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';

const KUGOU_GATEWAY_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';

const KUGOU_H5_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const KUGOU_QUALITY_CHAIN = [
  { key: 'jymaster', label: 'Hi-Res', field: 'ResFileHash' },
  { key: 'hires', label: 'Hi-Res', field: 'ResFileHash' },
  { key: 'lossless', label: '无损', field: 'SQFileHash' },
  { key: 'exhigh', label: '极高', field: 'HQFileHash' },
  { key: 'standard', label: '标准', field: 'FileHash' },
];

const KUGOU_LITE_APPID = '3116';

const KUGOU_LITE_CLIENTVER = '11440';

const KUGOU_LITE_ANDROID_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';

const KUGOU_LITE_GATEWAY_UA = 'Android15-1070-11440-46-0-DiscoveryDRADProtocol-wifi';

const KUGOU_REGISTER_RSA_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB\n-----END PUBLIC KEY-----';

const KUGOU_LIKE_FILEID_MAX = 500;

module.exports = {
  KUGOU_SEARCH_URL,
  KUGOU_PLAY_MOBILE,
  KUGOU_PLAY_WEB,
  KUGOU_VIP_ROLEINFO_URL,
  KUGOU_LYRIC_SEARCH,
  KUGOU_LYRIC_DOWNLOAD,
  KUGOU_HEADERS,
  KUGOU_GATEWAY,
  KUGOU_APPID,
  KUGOU_WEB_APPID,
  KUGOU_VERBOSE,
  kugouDebug,
  KUGOU_CLIENTVER,
  KUGOU_ANDROID_SALT,
  KUGOU_H5_SALT,
  KUGOU_H5_SRC_APPID,
  KUGOU_H5_CLIENTVER,
  KUGOU_SIGN_KEY_SALT,
  KUGOU_GATEWAY_UA,
  KUGOU_H5_UA,
  KUGOU_QUALITY_CHAIN,
  KUGOU_LITE_APPID,
  KUGOU_LITE_CLIENTVER,
  KUGOU_LITE_ANDROID_SALT,
  KUGOU_LITE_GATEWAY_UA,
  KUGOU_REGISTER_RSA_PUBLIC_KEY,
  KUGOU_LIKE_FILEID_MAX,
};
