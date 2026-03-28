const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256'
});

const pubBuf = publicKey.export({ type: 'spki', format: 'der' });
const privBuf = privateKey.export({ type: 'pkcs8', format: 'der' });

// Base64url helper
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Extract the raw public key (uncompressed point, 65 bytes)
// DER format includes some ASN.1 structure. For X.509/SPKI P-256, 
// the public key is at the end. In SPKI, the bit string is usually the last 65 bytes.
const pubRaw = pubBuf.slice(pubBuf.length - 65);
// For private key PKCS8, the private key is also near the end (32 bytes).
const privRaw = privBuf.slice(privBuf.length - 32);

console.log('--- NEW VAPID KEYS ---');
console.log('VAPID_PUBLIC_KEY=' + base64url(pubRaw));
console.log('VAPID_PRIVATE_KEY=' + base64url(privRaw));
console.log('---------------------');
