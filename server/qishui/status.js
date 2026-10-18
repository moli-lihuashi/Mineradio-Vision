'use strict';

// 汽水音乐：`/api/qishui/status` 的聚合响应。
//
// 单独成文件的唯一原因：它同时要 account（账号态）和 library（曲库概况），
// 放进 account 会让 account ↔ library 成环（第 3 刀唯一的环就来自它）。


const {
  getQishuiStatus,
} = require('./account');

const {
  fetchQishuiWebLibrary,
} = require('./library');

async function handleQishuiStatus(cookieText) {
  const status = getQishuiStatus(cookieText);
  if (!status.webSession) return status;
  try {
    const library = await fetchQishuiWebLibrary(cookieText);
    const profile = library && library.profile || {};
    if (profile.profileReady) {
      status.userId = profile.userId || status.userId;
      status.nickname = profile.nickname || status.nickname;
      status.avatar = profile.avatar || status.avatar;
      status.douyinId = profile.douyinId || '';
      status.vipType = profile.vipType || 0;
      status.vipLevel = profile.vipLevel || 'none';
      status.isVip = !!profile.isVip;
      status.isSvip = !!profile.isSvip;
      status.vipLabel = profile.vipLabel || (status.vipLevel === 'svip' ? 'SVIP' : (status.vipLevel === 'vip' ? 'VIP' : '无VIP'));
      status.membershipKnown = !!profile.membershipKnown;
      status.profileReady = true;
    }
    status.libraryReady = true;
    status.libraryErrors = library && library.errors || [];
  } catch (err) {
    status.profileReady = false;
    status.profileError = err && err.message || 'QISHUI_PROFILE_FAILED';
  }
  return status;
}

module.exports = {
  handleQishuiStatus,
};
