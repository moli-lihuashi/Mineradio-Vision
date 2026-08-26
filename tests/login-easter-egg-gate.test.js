'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LoginEasterEggGate,
  LOGIN_EASTER_EGG_CREDENTIAL_FILES,
} = require('../desktop/login-easter-egg-gate');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-login-gate-disabled-'));
  try {
    LOGIN_EASTER_EGG_CREDENTIAL_FILES.forEach((name) => {
      fs.writeFileSync(path.join(root, name), 'keep-login', 'utf8');
    });
    const gate = new LoginEasterEggGate({ userDataPath: root, now: () => 1234 });
    const first = await gate.initialize();
    assert.strictEqual(first.unlocked, true);
    assert.strictEqual(first.resetComplete, true);
    assert.strictEqual(gate.isUnlocked(), true);
    LOGIN_EASTER_EGG_CREDENTIAL_FILES.forEach((name) => {
      assert.strictEqual(fs.existsSync(path.join(root, name)), true, `${name} must not be cleared`);
    });

    const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
    assert(!/qishui-music-open-login[\s\S]{0,180}loginEasterEggLockedResult/.test(main), 'qishui open-login must not be gated');
    assert(!/spotify-music-open-login[\s\S]{0,180}loginEasterEggLockedResult/.test(main), 'spotify open-login must not be gated');

    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(!html.includes('id="login-easter-egg-gate"'), 'login easter egg gate UI must be removed');
    assert(!html.includes('重新锁定彩蛋'), 'logout button must not mention easter egg');

    console.log('[OK] Login easter egg disabled for Kugou fork; credentials preserved; qishui/spotify login ungated.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
