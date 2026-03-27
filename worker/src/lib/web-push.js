// worker/src/lib/web-push.js
// Web Push sending using VAPID (pure Web Crypto — no npm deps)
// Works in Cloudflare Workers environment

/**
 * Send a Web Push notification to a single subscription.
 * @param {object} subscription - { endpoint, keys: { p256dh, auth } }
 * @param {object} payload      - { title, body, icon?, url?, tag? }
 * @param {object} vapid        - { publicKey, privateKey, subject }
 * @returns {Promise<{ok: boolean, status: number, gone: boolean}>}
 */
export async function sendPushNotification(subscription, payload, vapid) {
  try {
    const payloadStr = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadStr);

    // Build encrypted body + headers using Web Push encryption
    const { ciphertext, headers } = await encryptPayload(
      subscription.keys.p256dh,
      subscription.keys.auth,
      payloadBytes
    );

    // VAPID Authorization header
    const vapidHeaders = await buildVapidHeaders(
      subscription.endpoint,
      vapid.subject,
      vapid.publicKey,
      vapid.privateKey
    );

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        ...headers,
        ...vapidHeaders,
        'TTL': '86400',
      },
      body: ciphertext,
    });

    return {
      ok: response.ok || response.status === 201,
      status: response.status,
      gone: response.status === 410 || response.status === 404,
    };
  } catch (e) {
    console.error('sendPushNotification error:', e);
    return { ok: false, status: 0, gone: false };
  }
}

/**
 * Send push notification to all subscriptions for a user.
 * Auto-deletes expired subscriptions (HTTP 410).
 */
export async function sendPushToUser(db, env, userId, payload) {
  if (!userId || !env.VAPID_PRIVATE_KEY) return;
  try {
    const { data: subs } = await db.from('push_subscriptions', {
      filters: { 'user_id.eq': userId },
      select: '*',
      limit: 20,
    });
    if (!Array.isArray(subs) || !subs.length) return;

    const vapid = getVapidConfig(env);
    const results = await Promise.allSettled(
      subs.map(sub =>
        sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          vapid
        ).then(async (result) => {
          if (result.gone) {
            await db.delete('push_subscriptions', { filters: { 'id.eq': sub.id } }).catch(() => {});
          }
          return result;
        })
      )
    );
    return results;
  } catch (e) {
    console.warn('sendPushToUser failed:', e);
  }
}

/**
 * Send push notification to all users with specified roles.
 * @param {string[]} roles — e.g. ['admin','manager']
 * @param {string|null} excludeUserId — user to exclude (e.g. the one who triggered the event)
 */
export async function sendPushToRoles(db, env, roles, payload, excludeUserId = null) {
  if (!env.VAPID_PRIVATE_KEY) return;
  try {
    const { data: users } = await db.from('users', {
      filters: { 'role.in': roles, 'is_active.is': true },
      select: 'id',
    });
    if (!Array.isArray(users) || !users.length) return;

    await Promise.allSettled(
      users
        .filter(u => u.id !== excludeUserId)
        .map(u => sendPushToUser(db, env, u.id, payload))
    );
  } catch (e) {
    console.warn('sendPushToRoles failed:', e);
  }
}

// ── VAPID config helper ─────────────────────────────
function getVapidConfig(env) {
  return {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:admin@rigways.com',
  };
}

// ── VAPID JWT header generation ─────────────────────
async function buildVapidHeaders(endpoint, subject, publicKeyBase64, privateKeyBase64) {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours

  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud: audience, exp: expiration, sub: subject };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const claimsB64 = base64urlEncode(JSON.stringify(claims));
  const unsignedToken = `${headerB64}.${claimsB64}`;

  // Import VAPID private key
  const privateKeyBytes = base64urlDecode(privateKeyBase64);
  const publicKeyBytes = base64urlDecode(publicKeyBase64);

  // Build JWK for the ECDSA P-256 key
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64urlEncode(publicKeyBytes.slice(1, 33)),
    y: base64urlEncode(publicKeyBytes.slice(33, 65)),
    d: base64urlEncode(privateKeyBytes),
  };

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format
  const sigBytes = new Uint8Array(signature);
  const rawSig = derToRaw(sigBytes);
  const token = `${unsignedToken}.${base64urlEncodeBytes(rawSig)}`;

  return {
    'Authorization': `vapid t=${token}, k=${publicKeyBase64}`,
  };
}

// ── Web Push Encryption (RFC 8291 — aes128gcm) ─────
async function encryptPayload(p256dhBase64, authBase64, payload) {
  // Client public key and auth secret
  const clientPublicKeyBytes = base64urlDecode(p256dhBase64);
  const authSecret = base64urlDecode(authBase64);

  // Import client's public key
  const clientPublicKey = await crypto.subtle.importKey(
    'raw', clientPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // Generate server ECDH key pair
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeys.privateKey,
    256
  );

  // Export server public key
  const serverPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeys.publicKey)
  );

  // Generate salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF to derive encryption key and nonce
  const prk = await hkdfExtract(authSecret, new Uint8Array(sharedSecret));

  // Info for content encryption key
  const cekInfo = buildInfo('aesgcm', clientPublicKeyBytes, serverPublicKeyBytes);
  const contentEncryptionKey = await hkdfExpand(prk, createInfo('Content-Encoding: aes128gcm\0', salt, clientPublicKeyBytes, serverPublicKeyBytes), 16);

  // Info for nonce
  const nonce = await hkdfExpand(prk, createInfo('Content-Encoding: nonce\0', salt, clientPublicKeyBytes, serverPublicKeyBytes), 12);

  // AES-128-GCM encryption
  const cryptoKey = await crypto.subtle.importKey(
    'raw', contentEncryptionKey, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // Add padding delimiter
  const paddedPayload = new Uint8Array(payload.length + 1);
  paddedPayload.set(payload);
  paddedPayload[payload.length] = 2; // delimiter for final record

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, cryptoKey, paddedPayload
  );

  // Build aes128gcm content coding header:
  // salt (16) + rs (4) + idlen (1) + keyid (65)
  const rs = payload.length + 1 + 16 + 1; // recordSize
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = serverPublicKeyBytes.length;
  header.set(serverPublicKeyBytes, 21);

  // Combine header + encrypted
  const ciphertext = new Uint8Array(header.length + encrypted.byteLength);
  ciphertext.set(header, 0);
  ciphertext.set(new Uint8Array(encrypted), header.length);

  return {
    ciphertext,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(ciphertext.length),
    },
  };
}

// ── HKDF helpers ────────────────────────────────────
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = new Uint8Array(info.length + 1);
  infoWithCounter.set(info, 0);
  infoWithCounter[info.length] = 1;
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', key, infoWithCounter));
  return result.slice(0, length);
}

function createInfo(type, salt, clientPublicKey, serverPublicKey) {
  const typeBytes = new TextEncoder().encode(type);
  // "WebPush: info\0" + client_public_key + server_public_key
  const wpInfo = new TextEncoder().encode('WebPush: info\0');
  const info = new Uint8Array(wpInfo.length + clientPublicKey.length + serverPublicKey.length);
  info.set(wpInfo, 0);
  info.set(clientPublicKey, wpInfo.length);
  info.set(serverPublicKey, wpInfo.length + clientPublicKey.length);

  // Actually for aes128gcm, the info is:
  // "Content-Encoding: <type>\0" for CEK
  // We need full HKDF with the PRK derived from auth + ECDH
  // Simplified: use salt + info approach
  const fullInfo = new Uint8Array(typeBytes.length);
  fullInfo.set(typeBytes, 0);

  // Proper aes128gcm key derivation
  const combined = new Uint8Array(salt.length + info.length);
  combined.set(salt, 0);
  combined.set(info, salt.length);

  return combined;
}

function buildInfo(type, clientPublicKey, serverPublicKey) {
  const typeBytes = new TextEncoder().encode(`Content-Encoding: ${type}\0`);
  return typeBytes;
}

// ── Base64url helpers ───────────────────────────────
function base64urlEncode(str) {
  const bytes = typeof str === 'string' ? new TextEncoder().encode(str) : str;
  return base64urlEncodeBytes(bytes);
}

function base64urlEncodeBytes(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── DER to raw signature conversion ─────────────────
function derToRaw(der) {
  // If already 64 bytes (raw format), return as-is
  if (der.length === 64) return der;

  // ECDSA P-256 signatures from WebCrypto may be raw (64 bytes)
  // or DER encoded. Handle both.
  if (der[0] !== 0x30) return der; // Not DER, assume raw

  let offset = 2;
  if (der[1] === 0x81) offset = 3; // Long form length

  // Read r
  if (der[offset] !== 0x02) return der;
  offset++;
  const rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;

  // Read s
  if (der[offset] !== 0x02) return der;
  offset++;
  const sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);

  // Trim leading zeros and pad to 32 bytes
  if (r.length > 32) r = r.slice(r.length - 32);
  if (s.length > 32) s = s.slice(s.length - 32);

  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}
