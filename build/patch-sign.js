#!/usr/bin/env node
/**
 * Sign a Mineradio resource patch manifest for release.
 * Usage:
 *   node build/patch-sign.js patch.json private.pem > patch.signed.json
 *   MINERADIO_UPDATE_PUBKEY_PEM="$(cat public.pem)" — set in app env to enforce verification
 */
const crypto = require('crypto');
const fs = require('fs');

const patchPath = process.argv[2];
const keyPath = process.argv[3];
if (!patchPath || !keyPath) {
  console.error('Usage: node build/patch-sign.js <patch.json> <private.pem>');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
if (payload.signature || payload.sig) {
  delete payload.signature;
  delete payload.sig;
}
const privateKey = fs.readFileSync(keyPath, 'utf8');
const signature = crypto.sign(
  'sha256',
  Buffer.from(JSON.stringify(payload), 'utf8'),
  crypto.createPrivateKey(privateKey),
).toString('base64');
payload.signature = signature;
process.stdout.write(JSON.stringify(payload, null, 2));
