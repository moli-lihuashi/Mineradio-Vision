/* Folia 世界 — 共享异步依赖：@chenglou/pretext
 *
 * pretext 只有 ESM 构建（无 UMD），所以不能像其它 vendor 那样用 <script> 直挂，
 * 只能在需要它的样式里动态 import()。主窗口是 http://127.0.0.1:PORT/，同源，
 * CSP script-src 'self' 允许。
 *
 * 约定：
 *   - 全仓只此一个 Promise。第一次 import 成功后常驻，反复切样式不会重复拉取。
 *   - 失败时清空缓存并把错误原样抛出，让模式的 create 走 reject → 运行时退出世界
 *     并给出可见原因（不静默白屏），也允许用户重试。
 *   - 两个样式（tilt / claddagh）都用它，所以放在 core 里而不是各自 IIFE 里各存一份。
 */
'use strict';

var foliaPretextModulePromise = null;
var foliaPretextRichModulePromise = null;

function foliaLoadPretext() {
  if (foliaPretextModulePromise) return foliaPretextModulePromise;
  var url;
  try {
    url = new URL('vendor/folia/pretext/layout.js', document.baseURI).href;
  } catch (_) {
    url = 'vendor/folia/pretext/layout.js';
  }
  foliaPretextModulePromise = import(url).catch(function (err) {
    foliaPretextModulePromise = null;
    throw err;
  });
  return foliaPretextModulePromise;
}

/* 富行内测量（@chenglou/pretext/rich-inline）：monet 要按「token 原子」量行数
 * （timed 词 break:'never'，静态串 break:'normal'），普通 layoutWithLines 会按整串
 * 断行，CJK 尤其对不上 DOM。rich-inline 只依赖已 vendor 的 layout/line-text/
 * line-break/measurement 四个文件，单独一份 Promise 即可。 */
function foliaLoadPretextRich() {
  if (foliaPretextRichModulePromise) return foliaPretextRichModulePromise;
  var url;
  try {
    url = new URL('vendor/folia/pretext/rich-inline.js', document.baseURI).href;
  } catch (_) {
    url = 'vendor/folia/pretext/rich-inline.js';
  }
  foliaPretextRichModulePromise = import(url).catch(function (err) {
    foliaPretextRichModulePromise = null;
    throw err;
  });
  return foliaPretextRichModulePromise;
}
