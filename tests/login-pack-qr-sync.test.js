'use strict';

const assert = require('assert');
const http = require('http');
const {
  startLoginPackQrSession,
  stopLoginPackQrSession,
  fetchLoginPackEnvelopeFromUrl,
  pickLanAddress,
} = require('../desktop/login-pack-qr-sync');

async function main() {
  const envelope = {
    magic: 'MINERADIO_LOGIN_PACK_V1',
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: 'c2FsdA==',
    iv: 'aXY=',
    tag: 'dGFn',
    data: 'ZGF0YQ==',
  };
  const started = await startLoginPackQrSession({ envelope, ttlMs: 120000 });
  assert(started.ok, 'qr session should start');
  assert(started.url, 'qr session should expose url');
  assert(pickLanAddress(), 'lan address available');

  const fetched = await fetchLoginPackEnvelopeFromUrl(started.url);
  assert(fetched.ok, 'fetch envelope from qr url');
  assert.strictEqual(fetched.envelope.magic, 'MINERADIO_LOGIN_PACK_V1');

  const second = await fetchLoginPackEnvelopeFromUrl(started.url);
  assert(!second.ok, 'token should be one-shot');

  stopLoginPackQrSession();
  console.log('[OK] Login pack QR LAN sync verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
