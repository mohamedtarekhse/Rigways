// worker/src/middleware/jwt.js — HS256, Web Crypto only

const b64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = str => { str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4)str+='='; return Uint8Array.from(atob(str),c=>c.charCodeAt(0)); };
const enc   = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
}

export async function signJwt(payload, secret, expiresIn = 86400) {
  const header = b64(enc.encode(JSON.stringify({ alg:'HS256', typ:'JWT' })));
  const now    = Math.floor(Date.now() / 1000);
  const body   = b64(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresIn })));
  const k      = await key(secret);
  const sig    = await crypto.subtle.sign('HMAC', k, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64(sig)}`;
}

export async function verifyJwt(token, secret) {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) throw new Error('Malformed token');
  const k     = await key(secret);
  const valid = await crypto.subtle.verify('HMAC', k, unb64(s), enc.encode(`${h}.${b}`));
  if (!valid) throw new Error('Invalid signature');
  const claims = JSON.parse(new TextDecoder().decode(unb64(b)));
  if (claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return claims;
}

export async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  try { return await verifyJwt(auth.slice(7), env.JWT_SECRET); }
  catch { return null; }
}

export function requireRole(session, roles) {
  return session && roles.includes(session.role);
}

export function isAdminOrManager(session) {
  return requireRole(session, ['admin', 'manager']);
}
