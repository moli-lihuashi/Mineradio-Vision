'use strict';

// 汽水音乐：登录（PC 扫码 / OAuth 换 token / token 存取）。
//
// 第 3 刀从 qishui-api.js 抽出。只依赖 config/http —— 登录是纯协议，不认识任何业务领域。

const fs = require('fs');

const {
  normalizeQishuiToken,
  qishuiTokenFile,
  writeQishuiTokenFile,
} = require('./config');

const {
  clearQishuiRuntimeCaches,
} = require('./http');

const {
  getQishuiStatus,
} = require('./account');

function saveQishuiAccessToken(value) {
  const token = normalizeQishuiToken(value);
  if (!token || token.length < 10) {
    const err = new Error('INVALID_QISHUI_TOKEN');
    err.code = 'INVALID_QISHUI_TOKEN';
    throw err;
  }
  const file = qishuiTokenFile();
  // 加密落盘（"MR" + safeStorage）；加密不可用时抛 QISHUI_TOKEN_STORAGE_UNAVAILABLE，
  // 绝不退化成明文 —— 与 netease/qq/kugou/spotify 凭据同口径。
  writeQishuiTokenFile(file, token);
  clearQishuiRuntimeCaches();
  return { ...getQishuiStatus(), saved: true };
}

function clearQishuiAccessToken() {
  const file = qishuiTokenFile();
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
  clearQishuiRuntimeCaches();
  return { ...getQishuiStatus(), ok: true };
}

module.exports = {
  saveQishuiAccessToken,
  clearQishuiAccessToken,
};
