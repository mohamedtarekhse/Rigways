const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256'
});

const pubBuf = publicKey.export({ type: 'spki', format: 'der' });
const privBuf = privateKey.export({ type: 'pkcs8', format: 'der' });

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// In SPKI DER for P-256, the last 65 bytes are the uncompressed public key.
const pubRaw = pubBuf.slice(pubBuf.length - 65);
// In PKCS8 DER for P-256, the last 32 bytes are the private key.
const privRaw = privBuf.slice(privBuf.length - 32);

console.log('--- NEW VAPID KEYS ---');
console.log('VAPID_PUBLIC_KEY=' + base64url(pubRaw));
console.log('VAPID_PRIVATE_KEY=' + base64url(privRaw));
console.log('---------------------');
