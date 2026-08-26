'use strict';

/**
 * 酷狗修改版：不启用「登录彩蛋」门禁。
 * 保留同类名与 IPC 兼容，始终视为已解锁，且永不清理登录凭证。
 */

const path = require('path');

const LOGIN_EASTER_EGG_GATE_VERSION = 'disabled-kugou-fork';
const LOGIN_EASTER_EGG_STATE_FILE = 'login-easter-egg.json';
const LOGIN_EASTER_EGG_CREDENTIAL_FILES = [
  '.cookie',
  '.qq-cookie',
  '.kugou-cookie',
  '.kugou-vip-evidence.json',
  '.qishui-cookie',
  '.qishui-token',
  '.spotify-token.json',
];

class LoginEasterEggGate {
  constructor(options = {}) {
    this.userDataPath = path.resolve(String(options.userDataPath || '.'));
    this.stateFile = path.join(this.userDataPath, LOGIN_EASTER_EGG_STATE_FILE);
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
  }

  publicStatus() {
    return {
      ok: true,
      gateVersion: LOGIN_EASTER_EGG_GATE_VERSION,
      unlocked: true,
      resetComplete: true,
      disabled: true,
    };
  }

  isUnlocked() {
    return true;
  }

  async initialize() {
    return Object.assign({ resetPerformed: false }, this.publicStatus());
  }

  async resetForReplay() {
    return Object.assign({ resetPerformed: false, replayReset: true }, this.publicStatus());
  }

  unlock() {
    return Object.assign({ ok: true }, this.publicStatus());
  }
}

module.exports = {
  LoginEasterEggGate,
  LOGIN_EASTER_EGG_GATE_VERSION,
  LOGIN_EASTER_EGG_STATE_FILE,
  LOGIN_EASTER_EGG_CREDENTIAL_FILES,
};
