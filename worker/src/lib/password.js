// worker/src/lib/password.js — PBKDF2-SHA256, no npm deps

const ITERS = 100_000, LEN = 32;
const ALGO  = { name: 'PBKDF2', hash: 'SHA-256' };

const b64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = str => { str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4)str+='='; return Uint8Array.from(atob(str),c=>c.charCodeAt(0)); };

export async function hashPassword(password) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', enc.encode(password), ALGO, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ ...ALGO, salt, iterations: ITERS }, key, LEN * 8);
  return `pbkdf2:${ITERS}:${b64(salt)}:${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [, iters, saltB64, hashB64] = stored.split(':');
  const enc  = new TextEncoder();
  const salt = unb64(saltB64);
  const key  = await crypto.subtle.importKey('raw', enc.encode(password), ALGO, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ ...ALGO, salt, iterations: Number(iters) }, key, LEN * 8);
  const a = new Uint8Array(bits), b = unb64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
