// _worker.js — Cloudflare Pages Advanced Mode
// Place this at the REPO ROOT alongside index.html
// Pages automatically uses this file for ALL requests when it exists.
// Static files (html, css, js) are served via env.ASSETS.fetch()
// API requests are handled by the bundled Worker code below.

// ── response.js ──
// worker/src/utils/response.js
// Consistent { success, data?, error?, code? } shape on every response

function securityHeaders(request, env = {}) {
  const isHttps = String(request?.url || '').startsWith('https://');
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "upgrade-insecure-requests",
  ].join('; ');
  return {
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': csp,
    ...(isHttps ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload' } : {}),
    ...(env.SECURITY_XDNS_PREFETCH_CONTROL ? { 'X-DNS-Prefetch-Control': env.SECURITY_XDNS_PREFETCH_CONTROL } : { 'X-DNS-Prefetch-Control': 'off' }),
  };
}

function json(body, status = 200, env = {}, request = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      ...cors(env),
      ...securityHeaders(request),
    },
  });
}

function cors(env = {}) {
  const origin = env.CORS_ALLOW_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: { ...cors(env), ...securityHeaders(request, env) } });
}

const ok = (data, env, request = null) => json({ success: true, data }, 200, env, request);
const created = (data, env, request = null) => json({ success: true, data }, 201, env, request);
const badReq = (error, code, env, request = null) => json({ success: false, error, code }, 400, env, request);
const unauth = (env, request = null) => json({ success: false, error: 'Unauthorized', code: 'UNAUTH' }, 401, env, request);
const forbidden = (env, request = null) => json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403, env, request);
const notFound = (res, env, request = null) => json({ success: false, error: `${res} not found`, code: 'NOT_FOUND' }, 404, env, request);
const conflict = (error, env, request = null) => json({ success: false, error, code: 'CONFLICT' }, 409, env, request);
const serverErr = (env, msg, request = null) => json({ success: false, error: msg ? 'Server error: ' + msg : 'Internal server error', code: 'SERVER_ERROR' }, 500, env, request);

// ── validate.js ──
// worker/src/utils/validate.js

function validate(body, rules) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const val = body?.[field];
    const missing = val === undefined || val === null || val === '';
    if (rule.required && missing) { errors.push(`${field} is required`); continue; }
    if (missing) continue;
    if (rule.type === 'string' && typeof val !== 'string') errors.push(`${field} must be a string`);
    if (rule.type === 'number' && typeof val !== 'number') errors.push(`${field} must be a number`);
    if (rule.type === 'boolean' && typeof val !== 'boolean') errors.push(`${field} must be a boolean`);
    if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) errors.push(`${field} must be at least ${rule.minLength} characters`);
    if (rule.maxLength && typeof val === 'string' && val.length > rule.maxLength) errors.push(`${field} must be at most ${rule.maxLength} characters`);
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) errors.push(`${field} must be a valid email`);
    if (rule.enum && !rule.enum.includes(val)) errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
    if (rule.pattern && !rule.pattern.test(val)) errors.push(`${field} has an invalid format`);
  }
  return { valid: errors.length === 0, errors };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

// ── supabase.js ──
// worker/src/lib/supabase.js
// Thin Supabase REST wrapper — service key never leaves the Worker

function createSupabase(env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    throw new Error('Critical Configuration Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in Cloudflare Environment Variables.');
  }

  async function _fetch(path, options = {}) {
    const prefer = options._prefer || 'return=representation';
    const res = await fetch(`${base}/rest/v1${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': prefer,
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return { data: null, error: null };
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { message: text }; }
    if (!res.ok) return { data: null, error: body };
    return { data: body, error: null };
  }

  function qs(opts = {}) {
    const p = new URLSearchParams();
    if (opts.select) p.set('select', opts.select);
    if (opts.order) p.set('order', opts.order);
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.offset) p.set('offset', String(opts.offset));
    for (const [key, val] of Object.entries(opts.filters || {})) {
      const [col, op = 'eq'] = key.split('.');
      if (op === 'in') p.append(col, `in.(${val.join(',')})`);
      else if (op === 'is') p.append(col, `is.${val}`);
      else if (op === 'gte') p.append(col, `gte.${val}`);
      else if (op === 'lte') p.append(col, `lte.${val}`);
      else if (op === 'gt') p.append(col, `gt.${val}`);
      else if (op === 'lt') p.append(col, `lt.${val}`);
      else if (op === 'ilike') p.append(col, `ilike.${val}`);
      else if (op === 'neq') p.append(col, `neq.${val}`);
      else p.append(col, `eq.${val}`);
    }
    const str = p.toString();
    return str ? `?${str}` : '';
  }

  return {
    async from(table, opts = {}) {
      const headers = opts.single ? { Accept: 'application/vnd.pgrst.object+json' } : {};
      return _fetch(`/${table}${qs(opts)}`, { method: 'GET', headers });
    },
    async insert(table, body) {
      return _fetch(`/${table}?select=*`, { method: 'POST', body: JSON.stringify(body), _prefer: 'return=representation' });
    },
    async update(table, body, opts = {}) {
      return _fetch(`/${table}${qs({ select: opts.select || '*', filters: opts.filters })}`, { method: 'PATCH', body: JSON.stringify(body), _prefer: 'return=representation' });
    },
    async delete(table, opts = {}) {
      return _fetch(`/${table}${qs({ filters: opts.filters })}`, { method: 'DELETE', _prefer: 'return=minimal' });
    },
    async rpc(fn, params = {}) {
      return _fetch(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
    },
    async count(table, opts = {}) {
      const res = await fetch(`${base}/rest/v1/${table}${qs({ filters: opts.filters })}`, {
        method: 'HEAD',
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      });
      const count = parseInt(res.headers.get('Content-Range')?.split('/')?.[1] || '0', 10);
      return { count: isNaN(count) ? 0 : count, error: res.ok ? null : { message: 'Count failed' } };
    },
  };
}

// ── password.js ──
// worker/src/lib/password.js — PBKDF2-SHA256, no npm deps

const ITERS = 100_000, LEN = 32;
const ALGO = { name: 'PBKDF2', hash: 'SHA-256' };

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = str => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return Uint8Array.from(atob(str), c => c.charCodeAt(0)); };

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), ALGO, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ ...ALGO, salt, iterations: ITERS }, key, LEN * 8);
  return `pbkdf2:${ITERS}:${b64(salt)}:${b64(bits)}`;
}

async function verifyPassword(password, stored) {
  const [, iters, saltB64, hashB64] = stored.split(':');
  const enc = new TextEncoder();
  const salt = unb64(saltB64);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), ALGO, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ ...ALGO, salt, iterations: Number(iters) }, key, LEN * 8);
  const a = new Uint8Array(bits), b = unb64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── jwt.js ──
// worker/src/middleware/jwt.js — HS256, Web Crypto only

// b64/unb64 reuse the ones defined in password.js above
const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signJwt(payload, secret, expiresIn = 86400) {
  const header = b64(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresIn })));
  const k = await key(secret);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64(sig)}`;
}

async function verifyJwt(token, secret) {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) throw new Error('Malformed token');
  const k = await key(secret);
  const valid = await crypto.subtle.verify('HMAC', k, unb64(s), enc.encode(`${h}.${b}`));
  if (!valid) throw new Error('Invalid signature');
  const claims = JSON.parse(new TextDecoder().decode(unb64(b)));
  if (claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return claims;
}

async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('JWT_SECRET missing in environment');
    return null;
  }
  try { return await verifyJwt(auth.slice(7), jwtSecret); }
  catch { return null; }
}

function requireRole(session, roles) {
  return session && roles.includes(session.role);
}

function isAdminOrManager(session) {
  return requireRole(session, ['admin', 'manager']);
}

// ── auth.js ──
// worker/src/routes/auth.js
// POST /api/auth/login   — username + password → JWT
// GET  /api/auth/me      — validate token, return user
// POST /api/auth/logout  — stateless, client drops token
// POST /api/auth/hash    — dev-only: hash a password (disable in prod)






async function handleAuth(request, env, path) {
  const method = request.method;

  /* ── POST /api/auth/login ── */
  if (path === '/auth/login' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { valid, errors } = validate(body, {
      username: { required: true, type: 'string', minLength: 1 },
      password: { required: true, type: 'string', minLength: 1 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    const db = createSupabase(env);
    const { data: rows, error } = await db.from('users', {
      filters: { 'username.ilike': body.username.toLowerCase() },
      select: 'id,username,name,name_ar,role,customer_id,password_hash,is_active',
      limit: 1,
    });
    if (error) {
      return json({ success: false, error: 'Supabase error: ' + (error.message || error.hint || error.code || JSON.stringify(error)), code: 'DB_ERROR' }, 500, env);
    }

    const user = Array.isArray(rows) ? rows[0] : rows;
    if (!user) return unauth(env);
    if (!user.is_active) return forbidden(env);

    const ok2 = await verifyPassword(body.password, user.password_hash);
    if (!ok2) return unauth(env);

    // Update last_login_at (fire-and-forget)
    db.update('users', { last_login_at: new Date().toISOString() }, { filters: { 'id.eq': user.id }, select: 'id' }).catch(() => { });

    const expiresIn = parseInt(env.JWT_EXPIRES_SEC || '86400', 10);
    const jwtSecret = env.JWT_SECRET;
    if (!jwtSecret) return serverErr(env, 'JWT_SECRET is missing in Cloudflare dashboard');

    const token = await signJwt({
      sub: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      nameAr: user.name_ar || '',
      customerId: user.customer_id || null,
    }, jwtSecret, expiresIn);

    return ok({
      token,
      expiresIn,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        nameAr: user.name_ar || '',
        customerId: user.customer_id || null,
      },
    }, env);
  }

  /* ── GET /api/auth/me ── */
  if (path === '/auth/me' && method === 'GET') {
    const session = await getSession(request, env);
    if (!session) return unauth(env);

    const db = createSupabase(env);
    const { data: rows } = await db.from('users', {
      filters: { 'id.eq': session.sub },
      select: 'id,username,name,name_ar,role,customer_id,is_active,created_at,last_login_at',
      limit: 1,
    });
    const user = Array.isArray(rows) ? rows[0] : rows;
    if (!user || !user.is_active) return unauth(env);

    return ok({
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      nameAr: user.name_ar || '',
      customerId: user.customer_id || null,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    }, env);
  }

  /* ── POST /api/auth/logout ── */
  if (path === '/auth/logout' && method === 'POST') {
    return ok({ message: 'Logged out' }, env);
  }

  /* ── POST /api/auth/hash — DEV ONLY: generate a PBKDF2 hash ──
     Used once to seed admin/test users. Remove from production
     by setting env var DISABLE_HASH_ENDPOINT=true               */
  if (path === '/auth/hash' && method === 'POST') {
    if (env.DISABLE_HASH_ENDPOINT === 'true') return notFound('Route', env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    if (!body.password) return badReq('password required', 'VALIDATION', env);
    const hash = await hashPassword(body.password);
    return ok({ hash }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── users.js ──
// worker/src/routes/users.js





const SAFE = 'id,username,name,name_ar,role,customer_id,functional_location,is_active,created_at,last_login_at';

async function validateFunctionalLocation(db, functionalLocation, customerId) {
  const fl = String(functionalLocation || '').trim().toUpperCase();
  if (!fl) return { ok: true, value: null };

  const { data } = await db.from('functional_locations', {
    filters: { 'fl_id.eq': fl },
    select: 'id,fl_id,client_id,status',
    limit: 1
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: 'Functional location not found' };
  if (row.status !== 'active') return { ok: false, error: 'Functional location must be active' };
  const cid = String(customerId || '').trim();
  if (cid && row.client_id && row.client_id !== cid) {
    return { ok: false, error: 'Functional location must belong to the same client' };
  }
  return { ok: true, value: row.fl_id };
}

async function handleUsers(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);
  const idM = path.match(/^\/users\/([^/]+)$/);
  const uid = idM?.[1];

  /* LIST */
  if (!uid && method === 'GET') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('role')) filters['role.eq'] = url.searchParams.get('role');
    if (url.searchParams.get('active')) filters['is_active.is'] = url.searchParams.get('active') === 'true';
    const { data, error } = await db.from('users', { select: SAFE, filters, limit, offset, order: 'created_at.desc' });
    if (error) return serverErr(env);
    return ok({ users: data || [], limit, offset }, env);
  }

  /* GET ONE */
  if (uid && method === 'GET') {
    if (session.sub !== uid && !requireRole(session, ['admin', 'manager'])) return forbidden(env);
    const { data } = await db.from('users', { filters: { 'id.eq': uid }, select: SAFE, limit: 1 });
    const user = Array.isArray(data) ? data[0] : data;
    if (!user) return notFound('User', env);
    return ok(user, env);
  }

  /* CREATE */
  if (!uid && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      username: { required: true, type: 'string', minLength: 2, maxLength: 50 },
      password: { required: true, type: 'string', minLength: 8 },
      name: { required: true, type: 'string', minLength: 2, maxLength: 100 },
      role: { required: true, type: 'string', enum: ['user', 'technician', 'manager', 'admin'] },
      customer_id: { required: false, type: 'string' },
      functional_location: { required: false, type: 'string' },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);
    const flCheck = await validateFunctionalLocation(db, body.functional_location, body.customer_id);
    if (!flCheck.ok) return badReq(flCheck.error, 'VALIDATION', env);
    const { data: dup } = await db.from('users', { filters: { 'username.ilike': body.username }, select: 'id', limit: 1 });
    if (Array.isArray(dup) && dup.length) return conflict('Username already exists', env);
    const { data, error } = await db.insert('users', {
      username: body.username.toLowerCase(),
      name: body.name,
      name_ar: body.name_ar || null,
      role: body.role,
      customer_id: body.customer_id || null,
      functional_location: flCheck.value,
      password_hash: await hashPassword(body.password),
      is_active: true,
    });
    if (error) return serverErr(env);
    const u = Array.isArray(data) ? data[0] : data;
    delete u.password_hash;
    return created(u, env);
  }

  /* UPDATE */
  if (uid && method === 'PATCH') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { data: existingRows } = await db.from('users', { filters: { 'id.eq': uid }, select: 'id,customer_id,functional_location', limit: 1 });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (!existing) return notFound('User', env);
    const update = compact(pick(body, ['name', 'name_ar', 'role', 'customer_id', 'functional_location', 'is_active']));
    if (Object.prototype.hasOwnProperty.call(body, 'functional_location') || Object.prototype.hasOwnProperty.call(body, 'customer_id')) {
      const nextCustomerId = Object.prototype.hasOwnProperty.call(update, 'customer_id')
        ? update.customer_id
        : existing.customer_id;
      const nextFunctionalLocation = Object.prototype.hasOwnProperty.call(update, 'functional_location')
        ? update.functional_location
        : existing.functional_location;
      const flCheck = await validateFunctionalLocation(db, nextFunctionalLocation, nextCustomerId);
      if (!flCheck.ok) return badReq(flCheck.error, 'VALIDATION', env);
      update.functional_location = flCheck.value;
    }
    if (body.password) update.password_hash = await hashPassword(body.password);
    update.updated_at = new Date().toISOString();
    const { data, error } = await db.update('users', update, { filters: { 'id.eq': uid } });
    if (error) return serverErr(env);
    const u = Array.isArray(data) ? data[0] : data;
    if (!u) return notFound('User', env);
    delete u.password_hash;
    return ok(u, env);
  }

  /* DISABLE */
  if (uid && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (session.sub === uid) return badReq('Cannot disable your own account', 'SELF_DISABLE', env);
    await db.update('users', { is_active: false, updated_at: new Date().toISOString() }, { filters: { 'id.eq': uid } });
    return ok({ id: uid, is_active: false }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── jobs.js ──
// Job workflow: one job belongs to one client, many inspectors can be assigned.
async function handleJobs(request, env, path) {
  const method = request.method;
  const db = createSupabase(env);
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const idM = path.match(/^\/jobs\/([^/]+)$/);
  const inspectorsM = path.match(/^\/jobs\/([^/]+)\/inspectors$/);
  const jobId = idM?.[1];
  const jobInspectorsId = inspectorsM?.[1];

  const isAdminOrManager = requireRole(session, ['admin', 'manager']);
  const isTechnician = session.role === 'technician';

  function buildJobNumber() {
    const y = new Date().getUTCFullYear();
    const rnd = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    return `JOB-${y}-${rnd}`;
  }

  async function addJobEvent(job_id, event_type, payload = {}) {
    try {
      await db.insert('job_events', {
        job_id,
        event_type,
        actor_user_id: session.sub,
        payload_json: payload,
      });
    } catch (e) { console.warn('job event failed:', e); }
  }

  if (!jobId && !jobInspectorsId && method === 'GET') {
    const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(new URL(request.url).searchParams.get('offset') || '0', 10);
    const url = new URL(request.url);
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    if (url.searchParams.get('client_id') && isAdminOrManager) filters['client_id.eq'] = url.searchParams.get('client_id');
    if (!isAdminOrManager && session.customerId) filters['client_id.eq'] = session.customerId;
    const { data, error } = await db.from('jobs', { select: '*', filters, limit, offset, order: 'created_at.desc' });
    if (error) return serverErr(env, error.message || JSON.stringify(error));
    return ok({ jobs: data || [], limit, offset }, env);
  }

  if (!jobId && !jobInspectorsId && method === 'POST') {
    if (!isAdminOrManager) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      client_id: { required: true, type: 'string', minLength: 1, maxLength: 20 },
      functional_location: { required: true, type: 'string', minLength: 1, maxLength: 50 },
      title: { required: false, type: 'string', maxLength: 200 },
      notes: { required: false, type: 'string', maxLength: 4000 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    const inspectorIds = Array.isArray(body.inspector_ids) ? body.inspector_ids.filter(Boolean) : [];
    if (!inspectorIds.length) return badReq('At least one inspector is required', 'VALIDATION', env);

    const { data: flRows } = await db.from('functional_locations', {
      filters: { 'fl_id.eq': body.functional_location, 'client_id.eq': body.client_id },
      select: 'id,fl_id',
      limit: 1,
    });
    const fl = Array.isArray(flRows) ? flRows[0] : flRows;
    if (!fl) return badReq('functional_location must belong to selected client', 'VALIDATION', env);

    const jobNumber = String(body.job_number || '').trim() || buildJobNumber();
    const { data, error } = await db.insert('jobs', {
      job_number: jobNumber,
      client_id: body.client_id,
      functional_location: body.functional_location,
      title: body.title || null,
      notes: body.notes || null,
      status: 'active',
      created_by: session.sub,
    });
    if (error) return serverErr(env, error.message || JSON.stringify(error));
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.id) return serverErr(env, 'Failed to create job');

    for (const inspector_id of inspectorIds) {
      await db.insert('job_inspectors', { job_id: job.id, inspector_id, assigned_by: session.sub }).catch(() => {});
    }
    await addJobEvent(job.id, 'created', { inspector_ids: inspectorIds });
    return created(job, env);
  }

  if (jobId && method === 'GET') {
    const { data } = await db.from('jobs', { filters: { 'id.eq': jobId }, select: '*', limit: 1 });
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return notFound('Job', env);
    if (!isAdminOrManager && session.customerId && job.client_id !== session.customerId) return forbidden(env);
    return ok(job, env);
  }

  if (jobId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { data: ex } = await db.from('jobs', { filters: { 'id.eq': jobId }, select: '*', limit: 1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Job', env);
    if (!isAdminOrManager && (!session.customerId || existing.client_id !== session.customerId)) return forbidden(env);

    let patch = {};
    const action = String(body.action || '').trim();
    if (action === 'mark_done') {
      if (!isTechnician && !isAdminOrManager) return forbidden(env);
      patch = { status: 'technician_done', finished_by: session.sub, finished_at: new Date().toISOString() };
      await _notifyRoles(db, env, ['admin', 'manager'], 'job_finished', 'Job Finished by Technician', `Job ${existing.job_number} is marked as finished by ${session.name}.`, 'job', jobId, [session.sub]);
      await addJobEvent(jobId, 'technician_done');
    } else if (action === 'close') {
      if (!isAdminOrManager) return forbidden(env);
      patch = { status: 'closed', closed_by: session.sub, closed_at: new Date().toISOString() };
      await addJobEvent(jobId, 'closed', { reason: body.reason || null });
    } else if (action === 'reopen') {
      if (!isAdminOrManager) return forbidden(env);
      patch = { status: 'reopened', reopened_by: session.sub, reopened_at: new Date().toISOString() };
      await addJobEvent(jobId, 'reopened', { reason: body.reason || null });
    } else {
      if (!isAdminOrManager) return forbidden(env);
      patch = compact(pick(body, ['title', 'notes', 'functional_location']));
      if (patch.functional_location) {
        const { data: flRows } = await db.from('functional_locations', {
          filters: { 'fl_id.eq': patch.functional_location, 'client_id.eq': existing.client_id },
          select: 'id',
          limit: 1,
        });
        const fl = Array.isArray(flRows) ? flRows[0] : flRows;
        if (!fl) return badReq('functional_location must belong to selected client', 'VALIDATION', env);
      }
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await db.update('jobs', patch, { filters: { 'id.eq': jobId } });
    if (error) return serverErr(env, error.message || JSON.stringify(error));
    return ok(Array.isArray(data) ? data[0] : data, env);
  }

  if (jobInspectorsId && method === 'GET') {
    const { data, error } = await db.from('job_inspectors', {
      filters: { 'job_id.eq': jobInspectorsId },
      select: '*',
      order: 'created_at.asc',
    });
    if (error) return serverErr(env, error.message || JSON.stringify(error));
    return ok({ inspectors: data || [] }, env);
  }

  if (jobInspectorsId && method === 'POST') {
    if (!isAdminOrManager) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const inspectorIds = Array.isArray(body.inspector_ids) ? body.inspector_ids.filter(Boolean) : [];
    if (!inspectorIds.length) return badReq('inspector_ids is required', 'VALIDATION', env);
    for (const inspector_id of inspectorIds) {
      await db.insert('job_inspectors', { job_id: jobInspectorsId, inspector_id, assigned_by: session.sub }).catch(() => {});
    }
    await addJobEvent(jobInspectorsId, 'inspectors_assigned', { inspector_ids: inspectorIds });
    return ok({ assigned: inspectorIds.length }, env);
  }

  if (jobId && method === 'DELETE') {
    if (!isAdminOrManager) return forbidden(env);
    const { data: ex } = await db.from('jobs', { filters: { 'id.eq': jobId }, select: '*', limit: 1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Job', env);
    if (!isAdminOrManager && (!session.customerId || existing.client_id !== session.customerId)) return forbidden(env);
    await db.delete('job_inspectors', { filters: { 'job_id.eq': jobId } }).catch(() => {});
    await db.delete('jobs', { filters: { 'id.eq': jobId } });
    await addJobEvent(jobId, 'deleted');
    return ok({ deleted: true }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── assets.js ──
// worker/src/routes/assets.js




const ASSET_TYPES = ['Hoisting Equipment', 'Drilling Equipment', 'Mud System Low Pressure', 'Mud System High Pressure', 'Wirelines', 'Structure', 'Well Control', 'Tubular'];
const ASSET_STATUSES = ['operation', 'stacked'];

// Resolve AST-number (e.g. AST-0001) to UUID for DB operations
// Returns the UUID or the original value if it's already a UUID
async function resolveAssetId(db, rawId) {
  if (!rawId) return rawId;
  // If it looks like AST-xxx, look up by asset_number
  if (/^AST-/i.test(rawId)) {
    const { data } = await db.from('assets', {
      filters: { 'asset_number.ilike': rawId },
      select: 'id',
      limit: 1,
    });
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id || rawId;
  }
  return rawId; // already a UUID
}

async function generateNextAssetNumber(db) {
  const { data } = await db.from('assets', { select: 'asset_number', limit: 5000 });
  const rows = Array.isArray(data) ? data : [];
  let max = 0;
  for (const r of rows) {
    const m = String(r.asset_number || '').toUpperCase().match(/^AST-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `AST-${String(max + 1).padStart(4, '0')}`;
}


async function handleAssets(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);

  /* ── POST /api/assets/import/validate — server-side revalidation for mass upload ── */
  if (path === '/assets/import/validate' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return ok({ rows: [] }, env);

    const { data: existingRows } = await db.from('assets', {
      select: 'id,asset_number,serial_number',
      limit: 5000,
    });
    const existing = Array.isArray(existingRows) ? existingRows : [];
    const byAsset = new Map(existing.map(r => [String(r.asset_number || '').toLowerCase(), r]));
    const bySerial = new Map(existing.filter(r => r.serial_number).map(r => [String(r.serial_number || '').toLowerCase(), r]));
    const seenAsset = new Set();
    const seenSerial = new Set();

    const out = rows.map((row, idx) => {
      const assetNumber = String(row.asset_number || '').trim().toUpperCase();
      const serial = String(row.serial_number || '').trim();
      const errors = [];
      const warnings = [];
      if (!assetNumber) errors.push('asset_number is required');
      if (!String(row.name || '').trim()) errors.push('name is required');
      if (!String(row.asset_type || '').trim()) errors.push('asset_type is required');
      if (!String(row.status || '').trim()) errors.push('status is required');
      if (!String(row.client_id || '').trim()) errors.push('client_id is required');
      if (!String(row.functional_location || '').trim()) errors.push('functional_location is required');
      if (!serial) errors.push('serial_number is required');
      if (row.asset_type && !ASSET_TYPES.includes(row.asset_type)) errors.push(`asset_type "${row.asset_type}" is not valid`);
      if (row.status && !ASSET_STATUSES.includes(String(row.status).toLowerCase())) errors.push(`status "${row.status}" is not valid`);
      if (!String(row.manufacturer || '').trim()) warnings.push('manufacturer is empty');
      if (!String(row.model || '').trim()) warnings.push('model is empty');
      const assetKey = assetNumber.toLowerCase();
      const serialKey = serial.toLowerCase();
      const duplicate = Boolean((assetKey && byAsset.has(assetKey)) || (serialKey && bySerial.has(serialKey)) || seenAsset.has(assetKey) || seenSerial.has(serialKey));
      if (assetKey) seenAsset.add(assetKey);
      if (serialKey) seenSerial.add(serialKey);

      const status = errors.length ? 'error' : (duplicate ? 'duplicate' : (warnings.length ? 'warning' : 'valid'));
      return { index: idx, status, errors, warnings, duplicate, duplicate_by: duplicate ? 'asset_number_or_serial_number' : null };
    });
    return ok({ rows: out }, env);
  }
  /* ── GET /api/assets/stats — dashboard KPIs ── */
  if (path === '/assets/stats' && method === 'GET') {
    const filters = {};
    if (['user', 'technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;

    const [total, active, maintenance, inactive] = await Promise.all([
      db.count('assets', { filters }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'active' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'maintenance' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'inactive' } }),
    ]);
    return ok({ total: total.count, active: active.count, maintenance: maintenance.count, inactive: inactive.count }, env);
  }

  const idM = path.match(/^\/assets\/([^/]+)$/);
  const asId = idM?.[1] ? await resolveAssetId(db, idM[1]) : undefined;

  /* LIST */
  if (!asId && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (['user', 'technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    if (url.searchParams.get('type')) filters['asset_type.eq'] = url.searchParams.get('type');
    if (url.searchParams.get('client_id') && requireRole(session, ['admin', 'manager']))
      filters['client_id.eq'] = url.searchParams.get('client_id');
    const { data, error } = await db.from('assets', { select: '*', filters, limit, offset, order: 'created_at.desc' });
    if (error) return serverErr(env);
    return ok({ assets: data || [], limit, offset }, env);
  }

  /* GET ONE */
  if (asId && method === 'GET') {
    const { data } = await db.from('assets', { filters: { 'id.eq': asId }, select: '*', limit: 1 });
    const asset = Array.isArray(data) ? data[0] : data;
    if (!asset) return notFound('Asset', env);
    if (['user', 'technician'].includes(session.role) && session.customerId && asset.client_id !== session.customerId)
      return forbidden(env);
    return ok(asset, env);
  }

  /* CREATE */
  if (!asId && method === 'POST') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      asset_number: { required: false, type: 'string', minLength: 1, maxLength: 50 },
      name: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      asset_type: { required: true, type: 'string', enum: ASSET_TYPES },
      status: { required: false, type: 'string', enum: ASSET_STATUSES },
      client_id: { required: false, type: 'string' },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    // Strict client/location ownership: functional_location must belong to the same client
    if (body.functional_location) {
      if (!body.client_id) return badReq('client_id is required when functional_location is set', 'VALIDATION', env);
      let { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.eq': body.functional_location },
        select: 'id,client_id,status',
        limit: 1,
      });
      let fl = Array.isArray(flRows) ? flRows[0] : flRows;
      if (!fl) {
        const { data: byNameRows } = await db.from('functional_locations', {
          filters: { 'name.ilike': body.functional_location, 'client_id.eq': body.client_id },
          select: 'id,client_id,status',
          limit: 1,
        });
        fl = Array.isArray(byNameRows) ? byNameRows[0] : byNameRows;
      }
      if (!fl) return badReq('Functional location not found', 'INVALID_LOCATION', env);
      if (fl.client_id !== body.client_id) {
        return badReq('Functional location must belong to the same client', 'CLIENT_LOCATION_MISMATCH', env);
      }
    }

    const requestedNumber = String(body.asset_number || '').trim().toUpperCase();
    let assetNumber = requestedNumber || await generateNextAssetNumber(db);
    let data, error;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await db.insert('assets', {
        asset_number: assetNumber,
        name: body.name,
        asset_type: body.asset_type,
        status: body.status || 'operation',
        client_id: body.client_id || null,
        functional_location: body.functional_location || null,
        serial_number: body.serial_number || null,
        manufacturer: body.manufacturer || null,
        model: body.model || null,
        description: body.description || null,
        created_by: session.sub,
      });
      data = result.data; error = result.error;
      if (!error) break;
      if (error.code === '23505' && !requestedNumber) {
        assetNumber = await generateNextAssetNumber(db);
        continue;
      }
      break;
    }

    if (error) {
      if (error.code === '23505') return conflict('Asset number already exists across all clients', env);
      return serverErr(env);
    }
    const asset = Array.isArray(data) ? data[0] : data;
    await audit(db, session, 'assets', asset.id, 'create', null, asset);
    return created(asset, env);
  }

  /* UPDATE */
  if (asId && method === 'PATCH') {
    if (!requireRole(session, ['admin', 'manager', 'technician'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select: '*', limit: 1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);

    if (session.role === 'technician') {
      if (session.customerId && existing.client_id !== session.customerId) return forbidden(env);
      body = pick(body, ['status', 'notes']); // technicians can only update these
    }
    const { valid, errors } = validate(body, {
      name: { type: 'string', minLength: 2, maxLength: 200 },
      asset_type: { type: 'string', enum: ASSET_TYPES },
      status: { type: 'string', enum: ASSET_STATUSES },
      client_id: { type: 'string' },
      notes: { type: 'string', maxLength: 2000 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    const effectiveClientId = body.client_id || existing.client_id;
    const effectiveLocation = body.functional_location || existing.functional_location;
    if (effectiveLocation) {
      if (!effectiveClientId) return badReq('client_id is required when functional_location is set', 'VALIDATION', env);
      let { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.eq': effectiveLocation },
        select: 'id,client_id,status',
        limit: 1,
      });
      let fl = Array.isArray(flRows) ? flRows[0] : flRows;
      if (!fl) {
        const { data: byNameRows } = await db.from('functional_locations', {
          filters: { 'name.ilike': effectiveLocation, 'client_id.eq': effectiveClientId },
          select: 'id,client_id,status',
          limit: 1,
        });
        fl = Array.isArray(byNameRows) ? byNameRows[0] : byNameRows;
      }
      if (!fl) return badReq('Functional location not found', 'INVALID_LOCATION', env);
      if (fl.client_id !== effectiveClientId) {
        return badReq('Functional location must belong to the same client', 'CLIENT_LOCATION_MISMATCH', env);
      }
    }

    const update = compact({ ...pick(body, ['name', 'asset_type', 'status', 'client_id', 'functional_location', 'serial_number', 'manufacturer', 'model', 'description', 'notes']), updated_by: session.sub, updated_at: new Date().toISOString() });
    const { data, error } = await db.update('assets', update, { filters: { 'id.eq': asId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Asset', env);
    await audit(db, session, 'assets', asId, 'update', existing, updated);
    return ok(updated, env);
  }

  /* DELETE */
  if (asId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select: 'id,asset_number,name', limit: 1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);
    const { data: relCerts } = await db.from('certificates', {
      filters: { 'asset_id.eq': asId },
      select: 'id,file_url',
      limit: 5000,
    });
    const certs = Array.isArray(relCerts) ? relCerts : [];
    for (const cert of certs) {
      if (cert.file_url && isStorageConfigured(env)) {
        try { await deleteStorageObject(env, cert.file_url); } catch (e) { console.warn('Storage delete warning:', e.message); }
      }
    }
    await _deleteCertificateFileRecords(db, env, certs.map(c => c.id));
    if (certs.length) await db.delete('certificates', { filters: { 'asset_id.eq': asId } });
    await audit(db, session, 'assets', asId, 'delete', existing, null);
    await db.delete('assets', { filters: { 'id.eq': asId } });
    return ok({ id: asId, deleted: true, related_certificates_deleted: certs.length }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

async function audit(db, session, table, id, action, before, after) {
  try {
    await db.insert('audit_logs', {
      user_id: session.sub, username: session.username, role: session.role,
      table_name: table, record_id: id, action,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
    });
  } catch (e) { console.warn('Audit failed:', e); }
}

// ── storage.js ──
// Supports Backblaze B2 (B2_* env vars) as primary, or Cloudflare R2 (CERT_BUCKET) as fallback.

let __b2AuthCache = null;

function isStorageConfigured(env) {
  return !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) || !!env.CERT_BUCKET;
}

function storageBackendLabel(env) {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) return 'B2';
  if (env.CERT_BUCKET) return 'R2';
  return 'none';
}

async function getB2Auth(env) {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY || !env.B2_BUCKET_ID || !env.B2_BUCKET_NAME) {
    throw new Error('B2 is not fully configured');
  }
  const now = Date.now();
  if (__b2AuthCache && (__b2AuthCache.expiresAt - now > 60_000)) return __b2AuthCache;

  const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
  const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!authRes.ok) throw new Error(`B2 authorize failed (${authRes.status})`);
  const auth = await authRes.json();
  __b2AuthCache = {
    authorizationToken: auth.authorizationToken,
    apiUrl: auth.apiUrl,
    downloadUrl: auth.downloadUrl,
    expiresAt: now + 23 * 60 * 60 * 1000,
  };
  return __b2AuthCache;
}

async function computeSha1(body) {
  const buffer = await body.arrayBuffer();
  return computeSha1FromBuffer(buffer);
}

async function computeSha1FromBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sanitize filename for B2 storage: replace spaces with hyphens, remove/replace special chars
function sanitizeFilenameForB2(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')  // Replace any non-alphanumeric (except . _ -) with hyphen
    .replace(/-+/g, '-')                // Collapse multiple hyphens
    .replace(/^[-.]+|[-.]+$/g, '')      // Remove leading/trailing hyphens/dots
    .slice(0, 200);                     // Limit length
}

async function putStorageObject(env, key, body, contentType = 'application/octet-stream', metadata = {}) {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
    const auth = await getB2Auth(env);
    const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
    });
    if (!uploadUrlRes.ok) {
      const errText = await uploadUrlRes.text().catch(() => '');
      throw new Error(`B2 get_upload_url failed (${uploadUrlRes.status}): ${errText}`);
    }
    const uploadUrl = await uploadUrlRes.json();
    const sanitizedKey = sanitizeFilenameForB2(key);
    const encodedName = encodeURIComponent(sanitizedKey);
    const metaHeaders = Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`X-Bz-Info-${k}`, String(v ?? '')]));
    
    // Read body buffer once, then use for both SHA1 computation and upload
    const bodyBuffer = body instanceof ArrayBuffer ? body : await body.arrayBuffer();
    const sha1Hash = await computeSha1FromBuffer(bodyBuffer);
    
    const uploadRes = await fetch(uploadUrl.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: uploadUrl.authorizationToken,
        'X-Bz-File-Name': encodedName,
        'Content-Type': contentType,
        'X-Bz-Content-Sha1': sha1Hash,
        ...metaHeaders,
      },
      body: bodyBuffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      throw new Error(`B2 upload_file failed (${uploadRes.status}): ${errText}`);
    }
    return;
  }

  if (env.CERT_BUCKET) {
    await env.CERT_BUCKET.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: metadata,
    });
    return;
  }

  throw new Error('No storage backend configured');
}

async function getStorageObject(env, key) {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
    const auth = await getB2Auth(env);
    const fileName = encodeURIComponent(key);
    const dlUrl = `${auth.downloadUrl}/file/${encodeURIComponent(env.B2_BUCKET_NAME)}/${fileName}`;
    const res = await fetch(dlUrl, { headers: { Authorization: auth.authorizationToken } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`B2 download failed (${res.status})`);
    return {
      body: res.body,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      uploadedAt: res.headers.get('x-bz-upload-timestamp')
        ? new Date(Number(res.headers.get('x-bz-upload-timestamp'))).toISOString()
        : null,
      size: Number(res.headers.get('content-length') || '0') || null,
    };
  }

  if (env.CERT_BUCKET) {
    const obj = await env.CERT_BUCKET.get(key);
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      uploadedAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
      size: obj.size ?? null,
    };
  }

  throw new Error('No storage backend configured');
}

async function listStorageObjects(env, prefix = '', limit = 500) {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
    const auth = await getB2Auth(env);
    const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: env.B2_BUCKET_ID,
        prefix,
        maxFileCount: limit,
      }),
    });
    if (!res.ok) throw new Error(`B2 list failed (${res.status})`);
    const data = await res.json();
    return {
      objects: (data.files || []).map(f => ({
        key: f.fileName,
        size: f.size,
        uploaded: f.uploadTimestamp ? new Date(f.uploadTimestamp).toISOString() : null,
      })),
      truncated: !!data.nextFileName,
    };
  }

  if (env.CERT_BUCKET) return env.CERT_BUCKET.list({ prefix, limit });

  throw new Error('No storage backend configured');
}

async function deleteStorageObject(env, key) {
  if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
    const auth = await getB2Auth(env);
    const listRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: env.B2_BUCKET_ID,
        startFileName: key,
        maxFileCount: 1,
      }),
    });
    if (!listRes.ok) throw new Error(`B2 find object failed (${listRes.status})`);
    const listData = await listRes.json();
    const found = (listData.files || [])[0];
    if (!found || found.fileName !== key) return;

    const delRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: found.fileName, fileId: found.fileId }),
    });
    if (!delRes.ok) throw new Error(`B2 delete failed (${delRes.status})`);
    return;
  }

  if (env.CERT_BUCKET) return env.CERT_BUCKET.delete(key);

  throw new Error('No storage backend configured');
}

// ── certificates.js ──
// worker/src/routes/certificates.js




const CERT_TYPES = ['CAT III', 'CAT IV', 'ORIGINAL COC', 'LOAD TEST', 'LIFTING', 'NDT', 'TUBULAR'];
const CERT_STATUSES = ['pending', 'approved', 'rejected'];

// ── CERTIFICATES FILE UPLOAD ──
// POST /api/certificates/upload  — upload file to R2, returns file_key + public URL
// GET  /api/certificates/file/:certId — get signed URL for a cert file

async function handleCertUpload(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  // ── POST /api/certificates/upload ──
  if (path === '/certificates/upload' && request.method === 'POST') {
    if (!isStorageConfigured(env)) {
      return json({ success: false, error: 'Storage is not configured. Configure B2_* variables (primary) or CERT_BUCKET (R2 fallback).', code: 'NO_BUCKET' }, 500, env);
    }

    let formData;
    try { formData = await request.formData(); }
    catch (e) { return badReq('Could not parse form data', 'BAD_FORM', env); }

    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided', 'NO_FILE', env);

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return badReq('Invalid file type. Allowed: PDF, JPG, PNG, WEBP', 'INVALID_TYPE', env);
    }

    // Max 200MB
    if (file.size > 200 * 1024 * 1024) {
      return badReq('File too large. Maximum size is 200MB', 'FILE_TOO_LARGE', env);
    }

    // Structured R2 key: clients/{clientId}/jobs/{jobNumber}/{certNumber}.{ext}
    // All three are required — passed from frontend after the cert record has been saved.
    const clientId = (formData.get('client_id') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const jobNumber = (formData.get('job_number') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const certNumber = (formData.get('cert_number') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!clientId || !jobNumber || !certNumber) {
      return badReq('client_id, job_number and cert_number are required for structured upload', 'MISSING_FIELDS', env);
    }

    // Key: clients/{clientId}/jobs/{jobNumber}/{jobNumber}_{certNumber}_{safeOriginalName}.{ext}
    // e.g. clients/C001/jobs/JOB-2024-010/JOB-2024-010_CERT-0012_inspection-report.pdf
    const safeOriginal = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const safeJobNumber = jobNumber.replace(/[^a-z0-9-]/gi, '-');
    const safeCertNumber = certNumber.replace(/[^a-z0-9-]/gi, '-');
    const key = `clients/${clientId}/jobs/${safeJobNumber}/${safeJobNumber}_${safeCertNumber}_${safeOriginal}.${ext}`;
    const fileBuffer = await file.arrayBuffer();

    try {
      await putStorageObject(env, key, fileBuffer, file.type, {
        originalName: file.name,
        uploadedBy: session.sub,
        username: session.username,
        certNumber,
        jobNumber,
        clientId,
      });
    } catch (e) {
      console.error('B2/R2 upload error:', e);
      return json({ success: false, error: 'File upload failed: ' + e.message, code: 'UPLOAD_FAILED' }, 500, env);
    }

    return ok({ key, file_name: `${jobNumber}_${certNumber}_${safeOriginal}.${ext}`, file_url: key }, env);
  }

  // ── GET /api/certificates/file/:certId — get signed URL ──
  const fileMatch = path.match(/^\/certificates\/file\/([^/]+)$/);
  if (fileMatch && request.method === 'GET') {
    if (!isStorageConfigured(env)) {
      return json({ success: false, error: 'Storage is not configured', code: 'NO_BUCKET' }, 500, env);
    }

    const certId = fileMatch[1];
    const db = createSupabase(env);
    const { data: rows } = await db.from('certificates', {
      filters: { 'id.eq': certId },
      select: 'id,file_url,file_name,client_id',
      limit: 1,
    });
    const cert = Array.isArray(rows) ? rows[0] : rows;
    if (!cert) return notFound('Certificate', env);

    // Check access
    if (['user', 'technician'].includes(session.role) && session.customerId && cert.client_id !== session.customerId)
      return forbidden(env);

    if (!cert.file_url) return json({ success: false, error: 'No file attached to this certificate', code: 'NO_FILE' }, 404, env);

    // Proxy the file directly through the Worker — works on free plan, no signed URL needed.
    // The browser opens /api/certificates/file/:id and the Worker streams the bytes back.
    try {
      const obj = await getStorageObject(env, cert.file_url);
      if (!obj) return json({ success: false, error: 'File not found in storage', code: 'FILE_MISSING' }, 404, env);

      const contentType = obj.contentType || 'application/octet-stream';
      const disposition = contentType === 'application/pdf' || contentType.startsWith('image/')
        ? 'inline'
        : 'attachment';

      return new Response(obj.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${disposition}; filename="${cert.file_name || 'certificate'}"`,
          'Cache-Control': 'private, max-age=3600',
          ...cors(env),
          ...securityHeaders(request, env),
        },
      });
    } catch (e) {
      console.error('Storage get error:', e);
      return json({ success: false, error: 'Could not retrieve file: ' + e.message, code: 'STORAGE_ERROR' }, 500, env);
    }
  }

  return null; // signal: not handled here
}


async function handleCertificates(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);

  /* ── GET /api/certificates/history/export — all certificates history snapshot ── */
  if (path === '/certificates/history/export' && method === 'GET') {
    if (!requireRole(session, ['admin', 'manager', 'technician'])) return forbidden(env);
    const filters = {};
    if (['user', 'technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;
    const { data, error } = await db.from('certificate_history', {
      select: '*',
      filters,
      order: 'changed_at.desc',
      limit: Math.min(parseInt(url.searchParams.get('limit') || '2000', 10), 5000),
    });
    if (error) return serverErr(env);
    const rows = Array.isArray(data) ? data : [];
    const withNames = await _withUploaderUsername(db, rows, 'changed_by');
    return ok({ history: withNames }, env);
  }

  if (path === '/diag' && method === 'GET') {
    const checks = {
      STORAGE_BACKEND: storageBackendLabel(env),
      SUPABASE_URL: !!env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!env.SUPABASE_SERVICE_ROLE_KEY,
      JWT_SECRET: !!env.JWT_SECRET,
      VAPID_PRIVATE_KEY: !!env.VAPID_PRIVATE_KEY,
      VAPID_PUBLIC_KEY: !!env.VAPID_PUBLIC_KEY,
      CRON_SECRET: !!env.CRON_SECRET,
      B2_BUCKET: !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME),
      CERT_BUCKET: !!env.CERT_BUCKET
    };

    // Crypto Self-Test
    let cryptoTest = { ok: false };
    try {
      if (env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY) {
        const dummySub = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/dummy', keys: { p256dh: 'BNkHRry_3w6SjdeQNJbCpV3ouo7s5FHHSzWhAZQ5oja-X9tabOf8gqO7xRQpVBEHNrlSEazJLeqBY1eBhSMTdig', auth: '8eByt89o4J9v-02e3K5IYA' } };
        const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: 'mailto:test@test.com' };
        await buildVapidHeaders(dummySub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);
        await encryptPayload(dummySub.keys.p256dh, dummySub.keys.auth, new TextEncoder().encode('test'));
        cryptoTest.ok = true;
      } else {
        cryptoTest.error = 'Keys missing';
      }
    } catch (e) {
      cryptoTest.error = e.message || String(e);
    }

    return ok({
      success: true,
      checks,
      cryptoTest,
      deployment: 'worker_v2_diag',
      timestamp: new Date().toISOString()
    }, env);
  }

  /* ── GET /api/certificates/expiring?days=30 — dashboard widget ── */
  if (path === '/certificates/expiring' && method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '30');
    const today = new Date().toISOString().split('T')[0];
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0];
    const filters = { 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': cutoff };
    if (['user', 'technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;
    const { data, error } = await db.from('certificates', { select: '*', filters, order: 'expiry_date.asc', limit: 200 });
    if (error) return serverErr(env);
    return ok({ certificates: data || [], days }, env);
  }

  /* ── GET /api/certificates/stats — dashboard ── */
  if (path === '/certificates/stats' && method === 'GET') {
    const today = new Date().toISOString().split('T')[0];
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];
    const fBase = {};
    if (['user', 'technician'].includes(session.role) && session.customerId)
      fBase['client_id.eq'] = session.customerId;

    const [total, valid, expiring, expired, pending] = await Promise.all([
      db.count('certificates', { filters: { ...fBase } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq': 'approved', 'expiry_date.gt': soon } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': soon } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq': 'approved', 'expiry_date.lt': today } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq': 'pending' } }),
    ]);
    return ok({ total: total.count, valid: valid.count, expiring: expiring.count, expired: expired.count, pending: pending.count }, env);
  }

  const idM = path.match(/^\/certificates\/([^/]+)$/);
  const certId = idM?.[1];
  const fileDeleteM = path.match(/^\/certificates\/([^/]+)\/file$/);
  const fileDeleteId = fileDeleteM?.[1];

  /* LIST */
  if (!certId && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (['user', 'technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;
    if (url.searchParams.get('approval_status')) filters['approval_status.eq'] = url.searchParams.get('approval_status');
    if (url.searchParams.get('cert_type')) filters['cert_type.eq'] = url.searchParams.get('cert_type');
    if (url.searchParams.get('asset_id')) filters['asset_id.eq'] = url.searchParams.get('asset_id');
    if (url.searchParams.get('client_id') && requireRole(session, ['admin', 'manager']))
      filters['client_id.eq'] = url.searchParams.get('client_id');
    const { data, error } = await db.from('certificates', { select: '*', filters, limit, offset, order: 'expiry_date.asc' });
    if (error) return serverErr(env);
    const certs = Array.isArray(data) ? data : [];
    const withNames = await _withUploaderUsername(db, certs, 'uploaded_by');
    return ok({ certificates: withNames, limit, offset }, env);
  }

  /* GET ONE */
  if (certId && method === 'GET') {
    const { data } = await db.from('certificates', { filters: { 'id.eq': certId }, select: '*', limit: 1 });
    const cert = Array.isArray(data) ? data[0] : data;
    if (!cert) return notFound('Certificate', env);
    if (['user', 'technician'].includes(session.role) && session.customerId && cert.client_id !== session.customerId)
      return forbidden(env);
    const [withNames] = await _withUploaderUsername(db, [cert], 'uploaded_by');
    return ok(withNames || cert, env);
  }

  /* CREATE */
  if (!certId && method === 'POST') {
    if (!requireRole(session, ['admin', 'manager', 'technician'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      name: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      cert_type: { required: true, type: 'string', minLength: 2, maxLength: 100 },
      lifting_subtype: { required: false, type: 'string', maxLength: 100 },
      asset_id: { required: true, type: 'string' },
      issued_by: { required: true, type: 'string', minLength: 2, maxLength: 200 },
      issue_date: { required: true, type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
      expiry_date: { required: true, type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    // Verify asset exists — accept both UUID and AST-0001 format
    const assetFilter = /^AST-/i.test(body.asset_id || '')
      ? { 'asset_number.ilike': body.asset_id }
      : { 'id.eq': body.asset_id };
    const { data: aRows } = await db.from('assets', { filters: assetFilter, select: 'id,asset_number,client_id', limit: 1 });
    const asset = Array.isArray(aRows) ? aRows[0] : aRows;
    if (!asset) return notFound('Asset', env);
    // Always store UUID in asset_id FK column
    body.asset_id = asset.id;
    if (session.role === 'technician' && session.customerId && asset.client_id !== session.customerId)
      return forbidden(env);

    const { data, error } = await db.insert('certificates', {
      name: body.name,
      cert_type: body.cert_type,
      lifting_subtype: body.lifting_subtype || null,
      asset_id: body.asset_id,
      client_id: body.client_id || asset.client_id || null,
      inspector_id: body.inspector_id || null,
      issued_by: body.issued_by,
      issue_date: body.issue_date,
      expiry_date: body.expiry_date,
      file_name: body.file_name || null,
      file_url: body.file_url || null,
      notes: body.notes || null,
      approval_status: session.role === 'admin' ? 'approved' : 'pending',
      uploaded_by: session.sub,
    });
    if (error) return serverErr(env);
    const cert = Array.isArray(data) ? data[0] : data;
    await _recordCertificateHistory(db, cert, session, 'create');

    // Notify managers/admins about pending certs
    if (cert.approval_status === 'pending') await _notifyApprovers(db, env, session, cert);
    return created(cert, env);
  }

  /* UPDATE / APPROVE / REJECT */
  if (certId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { data: ex } = await db.from('certificates', { filters: { 'id.eq': certId }, select: '*', limit: 1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);

    const isUploader = existing.uploaded_by === session.sub;
    const isApprover = requireRole(session, ['admin', 'manager']);
    if (!isUploader && !isApprover) return forbidden(env);
    if (isUploader && !isApprover && existing.approval_status !== 'pending')
      return badReq('Cannot edit a reviewed certificate', 'INVALID_STATE', env);
    if (!isApprover && body.approval_status)
      return forbidden(env);

    // Support re-linking certificate to a different asset during edit.
    // Accept either UUID or business asset number (AST-xxxx), then normalize to UUID.
    if (body.asset_id) {
      const assetFilter = /^AST-/i.test(String(body.asset_id || ''))
        ? { 'asset_number.ilike': String(body.asset_id || '').trim() }
        : { 'id.eq': String(body.asset_id || '').trim() };
      const { data: aRows } = await db.from('assets', { filters: assetFilter, select: 'id,asset_number,client_id', limit: 1 });
      const asset = Array.isArray(aRows) ? aRows[0] : aRows;
      if (!asset) return notFound('Asset', env);
      if (['user', 'technician'].includes(session.role) && session.customerId && asset.client_id !== session.customerId)
        return forbidden(env);
      body.asset_id = asset.id;
      // Keep client in sync with selected asset if client_id was not explicitly sent.
      if (!body.client_id && asset.client_id) body.client_id = asset.client_id;
    }

    const allowed = isApprover
      ? ['name', 'cert_type', 'lifting_subtype', 'issued_by', 'issue_date', 'expiry_date', 'file_name', 'file_url', 'notes', 'asset_id', 'client_id', 'approval_status', 'rejection_reason', 'inspector_id']
      : ['name', 'cert_type', 'lifting_subtype', 'issued_by', 'issue_date', 'expiry_date', 'file_name', 'file_url', 'notes', 'asset_id', 'client_id'];

    const update = compact({
      ...pick(body, allowed),
      updated_at: new Date().toISOString(),
      ...(body.approval_status && isApprover ? { reviewed_by: session.sub, reviewed_at: new Date().toISOString() } : {}),
    });
    const { data, error } = await db.update('certificates', update, { filters: { 'id.eq': certId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    await db.update('certificate_files', {
      client_id: updated?.client_id || null,
      cert_type: updated?.cert_type || null,
    }, { filters: { 'certificate_id.eq': certId } }).catch(() => {});
    await _recordCertificateHistory(db, updated || existing, session, 'update');

    // Notify uploader + admins/managers of approval status changes
    if (body.approval_status && body.approval_status !== existing.approval_status) {
      if (existing.uploaded_by) {
        await _notifyUser(db, env, existing.uploaded_by, 'cert_reviewed', `Certificate ${body.approval_status}`,
          `Your certificate "${updated.name}" has been ${body.approval_status}.`, 'certificate', certId);
      }
      await _notifyRoles(
        db, env, ['admin', 'manager'], 'cert_status_changed',
        `Certificate ${body.approval_status}`,
        `${session.name} changed "${updated.name}" to ${body.approval_status}.`,
        'certificate', certId,
        [session.sub]
      );
    }

    // Instant notification for manual expiry status change
    if (body.expiry_date && body.expiry_date !== existing.expiry_date && updated.approval_status !== 'rejected') {
      const today = new Date().toISOString().split('T')[0];
      const in7d = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      let expiryPayload = null;
      if (body.expiry_date < today) {
        expiryPayload = { title: 'Certificate Expired', body: `"${updated.name}" is now expired (${body.expiry_date}).`, url: '/notifications.html', tag: 'instant-expire-' + certId };
      } else if (body.expiry_date <= in7d) {
        expiryPayload = { title: 'Certificate Expiring Soon', body: `"${updated.name}" will expire on ${body.expiry_date}.`, url: '/notifications.html', tag: 'instant-expiring-' + certId };
      }
      if (expiryPayload) {
        await sendPushToRoles(db, env, ['admin', 'manager'], expiryPayload, session.sub);
        if (existing.uploaded_by && existing.uploaded_by !== session.sub) {
          await sendPushToUser(db, env, existing.uploaded_by, expiryPayload);
        }
      }
    }

    return ok(updated || existing, env);
  }

  /* DELETE FILE ONLY — admin anytime; technician within 24hrs own record only */
  if (fileDeleteId && method === 'DELETE') {
    if (!requireRole(session, ['admin', 'technician'])) return forbidden(env);

    const { data: ex } = await db.from('certificates', {
      filters: { 'id.eq': fileDeleteId },
      select: 'id,name,file_name,file_url,uploaded_by,created_at,approval_status,client_id',
      limit: 1,
    });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);
    if (!existing.file_url && !existing.file_name) return ok({ id: fileDeleteId, file_deleted: false, message: 'No file attached' }, env);

    if (session.role === 'technician') {
      if (existing.uploaded_by !== session.sub) return forbidden(env);
      const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / 3600000;
      if (ageHours > 24) {
        return json({ success: false, error: 'Delete window has expired (24 hours from upload)', code: 'WINDOW_EXPIRED' }, 403, env);
      }
    }
    if (['user', 'technician'].includes(session.role) && session.customerId && existing.client_id !== session.customerId)
      return forbidden(env);

    if (existing.file_url && isStorageConfigured(env)) {
      try { await deleteStorageObject(env, existing.file_url); }
      catch (e) { console.warn('Storage delete warning:', e.message); }
    }

    const { data: updatedRows, error: updateErr } = await db.update('certificates', {
      file_name: null,
      file_url: null,
      updated_at: new Date().toISOString(),
    }, { filters: { 'id.eq': fileDeleteId } });
    if (updateErr) return serverErr(env);
    await db.update('certificate_files', {
      status: 'deleted',
      is_current: false,
      deleted_at: new Date().toISOString(),
    }, { filters: { 'certificate_id.eq': fileDeleteId, 'status.eq': 'active' } }).catch(() => {});
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
    await _recordCertificateHistory(db, updated || existing, session, 'file_deleted');
    return ok({ id: fileDeleteId, file_deleted: true, certificate: updated || existing }, env);
  }

  /* DELETE — admin anytime; technician within 24 hrs of upload (own records only); manager/user forbidden */
  if (certId && method === 'DELETE') {
    // Record delete is admin-only. Optional scope: ?delete_scope=asset (delete all certs for same asset).
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const deleteScope = (url.searchParams.get('delete_scope') || '').toLowerCase();

    // Fetch the full record so we can check ownership, timing, and get the file key
    const { data: ex } = await db.from('certificates', {
      filters: { 'id.eq': certId },
      select: 'id,asset_id,file_url,uploaded_by,created_at',
      limit: 1,
    });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);
    if (deleteScope === 'asset') {
      const { data: relRows, error: relErr } = await db.from('certificates', {
        filters: { 'asset_id.eq': existing.asset_id },
        select: '*',
        limit: 5000,
      });
      if (relErr) return serverErr(env);
      const related = Array.isArray(relRows) ? relRows : [];
      for (const cert of related) {
        if (cert.file_url && isStorageConfigured(env)) {
          try { await deleteStorageObject(env, cert.file_url); }
          catch (e) { console.warn('Storage delete warning:', e.message); }
        }
        await _recordCertificateHistory(db, cert, session, 'record_deleted');
      }
      await _deleteCertificateFileRecords(db, env, related.map(r => r.id));
      await db.delete('certificates', { filters: { 'asset_id.eq': existing.asset_id } });
      return ok({
        deleted_scope: 'asset',
        asset_id: existing.asset_id,
        deleted_count: related.length,
        deleted_ids: related.map(r => r.id),
      }, env);
    }

    // Delete one certificate row
    if (existing.file_url && isStorageConfigured(env)) {
      try { await deleteStorageObject(env, existing.file_url); }
      catch (e) { console.warn('Storage delete warning:', e.message); }
    }
    await _deleteCertificateFileRecords(db, env, [certId]);
    await _recordCertificateHistory(db, { ...existing, id: certId }, session, 'record_deleted');
    await db.delete('certificates', { filters: { 'id.eq': certId } });
    return ok({ id: certId, deleted: true, deleted_scope: 'single' }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── files.js ──
// Admin file explorer for certificate files (1 certificate -> many files)
async function handleFiles(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin'])) return forbidden(env);

  const db = createSupabase(env);
  const method = request.method;
  const url = new URL(request.url);

  if (path === '/files' && method === 'GET') {
    const q = url.searchParams;
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const limit = Math.min(Math.max(parseInt(q.get('limit') || '500', 10), 1), 1000);
    const jobNumber = q.get('job_number') || '';
    const prefix = q.get('prefix') || '';
    const listRes = await listStorageObjects(env, prefix, limit);
    const objects = (listRes.objects || []);

    const { data: metaRows } = await db.from('certificate_files', { select: '*', filters: {}, limit: 5000, order: 'uploaded_at.desc' });
    const metaMap = new Map((Array.isArray(metaRows) ? metaRows : []).map(r => [r.r2_key, r]));
    const { data: certRows } = await db.from('certificates', {
      select: 'id,cert_type,client_id,file_name,file_url,uploaded_by,created_at',
      filters: {},
      limit: 5000,
      order: 'created_at.desc',
    });
    const legacyMap = new Map(
      (Array.isArray(certRows) ? certRows : [])
        .filter(r => r.file_url)
        .map(r => [r.file_url, r])
    );

    const allKeys = new Set([
      ...objects.map(o => o.key),
      ...Array.from(metaMap.keys()).filter(Boolean),
      ...Array.from(legacyMap.keys()).filter(Boolean),
    ]);

    const objectMap = new Map(objects.map(o => [o.key, o]));
    const merged = Array.from(allKeys).map(key => {
      const o = objectMap.get(key) || {};
      const m = metaMap.get(key) || {};
      const c = legacyMap.get(key) || {};
      return {
        id: m.id || null,
        r2_key: key,
        file_name: m.file_name || c.file_name || key.split('/').pop(),
        file_size: m.file_size ?? o.size ?? null,
        uploaded_at: m.uploaded_at || c.created_at || o.uploaded || null,
        uploaded_by: m.uploaded_by || c.uploaded_by || null,
        client_id: m.client_id || c.client_id || null,
        cert_type: m.cert_type || c.cert_type || null,
        job_number: m.job_number || (key.match(/\/jobs\/([^/]+)\//)?.[1] || key.match(/^files\/jobs\/([^/]+)\//)?.[1] || null),
        status: m.status || 'active',
        scan_status: m.scan_status || 'pending',
        is_current: !!m.is_current,
        deleted_at: m.deleted_at || null,
      };
    });

    const filtered = merged.filter(r => {
      if (jobNumber && !(r.job_number === jobNumber || (r.r2_key || '').includes(`/jobs/${jobNumber}/`))) return false;
      if (q.get('client_id') && r.client_id !== q.get('client_id')) return false;
      if (q.get('cert_type') && r.cert_type !== q.get('cert_type')) return false;
      if (q.get('filename') && !(r.file_name || '').toLowerCase().includes(q.get('filename').toLowerCase())) return false;
      if (q.get('date_from')) {
        const d = new Date(r.uploaded_at || 0); if (isNaN(d)) return false;
        if (d < new Date(q.get('date_from') + 'T00:00:00.000Z')) return false;
      }
      if (q.get('date_to')) {
        const d = new Date(r.uploaded_at || 0); if (isNaN(d)) return false;
        if (d > new Date(q.get('date_to') + 'T23:59:59.999Z')) return false;
      }
      return true;
    });
    const withNames = await _withUploaderUsername(db, filtered, 'uploaded_by');
    return ok({ files: withNames, prefix, truncated: !!listRes.truncated }, env);
  }

  if (path === '/files/upload' && method === 'POST') {
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badReq('file is required', 'MISSING_FILE', env);
    const maxBytes = 150 * 1024 * 1024;
    if (file.size > maxBytes) return badReq('Max file size is 150MB', 'FILE_TOO_LARGE', env);

    const allowed = [
      'application/pdf',
      'image/jpeg','image/png','image/webp','image/gif','image/tiff',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain','application/rtf'
    ];
    if (!allowed.includes(file.type)) return badReq('Unsupported file type', 'INVALID_FILE_TYPE', env);

    const certificateId = String(form.get('certificate_id') || '').trim();
    const jobNumber = String(form.get('job_number') || '').trim();
    const clientId = String(form.get('client_id') || '').trim();
    const certType = String(form.get('cert_type') || '').trim();
    if (!jobNumber || !certificateId) return badReq('job_number and certificate_id are required', 'MISSING_FIELDS', env);

    const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = (safeName.split('.').pop() || 'bin').toLowerCase();
    const base = safeName.replace(/\.[^.]+$/, '');
    const { data: existingRows } = await db.from('certificate_files', {
      select: 'id,version_no',
      filters: { 'certificate_id.eq': certificateId },
      limit: 200,
      order: 'version_no.desc',
    });
    const nextVersion = ((existingRows || [])[0]?.version_no || 0) + 1;
    const safeJobNumber = jobNumber.replace(/[^a-z0-9-]/gi, '-');
    const key = `files/jobs/${safeJobNumber}/certificates/${certificateId}/v${nextVersion}_${Date.now()}_${base}.${ext}`;

    const fileBuffer = await file.arrayBuffer();
    try {
      await putStorageObject(env, key, fileBuffer, file.type || 'application/octet-stream', {
        originalName: file.name,
        uploadedBy: session.sub,
        certificateId,
        jobNumber,
        version: String(nextVersion),
      });
    } catch (e) {
      console.error('Certificate asset upload error:', e);
      return json({ success: false, error: 'Asset upload failed: ' + e.message, code: 'UPLOAD_FAILED' }, 500, env);
    }

    // Mark previous versions as non-current
    await db.update('certificate_files', { is_current: false }, { filters: { 'certificate_id.eq': certificateId } }).catch(() => {});
    const nowIso = new Date().toISOString();
    const payload = {
      certificate_id: certificateId,
      client_id: clientId || null,
      job_number: jobNumber,
      cert_type: certType || null,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
      r2_key: key,
      version_no: nextVersion,
      is_current: true,
      status: 'active',
      scan_status: 'pending',
      uploaded_by: session.sub,
      uploaded_at: nowIso,
    };
    const { data, error } = await db.insert('certificate_files', payload);
    if (error) return serverErr(env, error.message || 'Could not save file metadata');

    // Antivirus scanning hook (non-blocking)
    if (env.ANTIVIRUS_SCAN_HOOK) {
      fetch(env.ANTIVIRUS_SCAN_HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'file_uploaded',
          file_id: data?.id || null,
          r2_key: key,
          mime_type: payload.mime_type,
          size: payload.file_size,
          certificate_id: certificateId,
          uploaded_at: nowIso,
        }),
      }).catch(() => {});
    }

    return created({ file: data || payload }, env);
  }

  if (path === '/files/object/signed-url' && method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key) return badReq('key is required', 'MISSING_KEY', env);
    const ttl = Math.min(Math.max(parseInt(url.searchParams.get('ttl') || '300', 10), 30), 900);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = await _signFileToken(env, key, exp);
    const dl = new URL(request.url);
    dl.pathname = `/api/files/object/download`;
    dl.search = `key=${encodeURIComponent(key)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
    return ok({ url: dl.toString(), expires_at: exp }, env);
  }

  if (path === '/files/object/download' && method === 'GET') {
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const key = url.searchParams.get('key') || '';
    const exp = parseInt(url.searchParams.get('exp') || '0', 10);
    const sig = url.searchParams.get('sig') || '';
    if (!key || !exp || exp < Math.floor(Date.now() / 1000)) return forbidden(env);
    const valid = await _verifyFileToken(env, key, exp, sig);
    if (!valid) return forbidden(env);
    const obj = await getStorageObject(env, key);
    if (!obj) return notFound('file', env);
    const headers = new Headers();
    headers.set('Content-Type', obj.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename=\"${(key.split('/').pop() || 'file').replace(/\"/g, '')}\"`);
    headers.set('Cache-Control', 'private, max-age=30');
    Object.entries(cors(env)).forEach(([k, v]) => headers.set(k, v));
    Object.entries(securityHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));
    return new Response(obj.body, { status: 200, headers });
  }

  if (path === '/files/object' && method === 'DELETE') {
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const key = url.searchParams.get('key') || '';
    const mode = (url.searchParams.get('mode') || 'hard').toLowerCase();
    if (!key) return badReq('key is required', 'MISSING_KEY', env);
    const { data: rows } = await db.from('certificate_files', { select: 'id', filters: { 'r2_key.eq': key }, limit: 1 });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (mode === 'soft' && row?.id) {
      await db.update('certificate_files', { status: 'deleted', deleted_at: new Date().toISOString(), is_current: false }, { filters: { 'id.eq': row.id } });
      return ok({ key, deleted: true, mode: 'soft' }, env);
    }
    try { await deleteStorageObject(env, key); } catch (e) { console.warn('Storage delete warning:', e.message); }
    if (row?.id) await db.delete('certificate_files', { filters: { 'id.eq': row.id } }).catch(() => {});
    return ok({ key, deleted: true, mode: 'hard' }, env);
  }

  const signedM = path.match(/^\/files\/([^/]+)\/signed-url$/);
  if (signedM && method === 'GET') {
    const fileId = signedM[1];
    const ttl = Math.min(Math.max(parseInt(url.searchParams.get('ttl') || '300', 10), 30), 900);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = await _signFileToken(env, fileId, exp);
    const dl = new URL(request.url);
    dl.pathname = `/api/files/download/${fileId}`;
    dl.search = `exp=${exp}&sig=${encodeURIComponent(sig)}`;
    return ok({ url: dl.toString(), expires_at: exp }, env);
  }

  const dlM = path.match(/^\/files\/download\/([^/]+)$/);
  if (dlM && method === 'GET') {
    const fileId = dlM[1];
    const exp = parseInt(url.searchParams.get('exp') || '0', 10);
    const sig = url.searchParams.get('sig') || '';
    if (!exp || exp < Math.floor(Date.now() / 1000)) return forbidden(env);
    const valid = await _verifyFileToken(env, fileId, exp, sig);
    if (!valid) return forbidden(env);
    const { data: rows, error } = await db.from('certificate_files', { select: 'id,file_name,mime_type,r2_key,status,deleted_at', filters: { 'id.eq': fileId }, limit: 1 });
    if (error || !rows?.length) return notFound('file', env);
    const row = rows[0];
    if (!row.r2_key || row.deleted_at || row.status === 'deleted') return notFound('file', env);
    const obj = await getStorageObject(env, row.r2_key);
    if (!obj) return notFound('file', env);
    const headers = new Headers();
    headers.set('Content-Type', row.mime_type || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename=\"${(row.file_name || 'file').replace(/\"/g, '')}\"`);
    headers.set('Cache-Control', 'private, max-age=30');
    Object.entries(cors(env)).forEach(([k, v]) => headers.set(k, v));
    Object.entries(securityHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));
    return new Response(obj.body, { status: 200, headers });
  }

  const makeCurrentM = path.match(/^\/files\/([^/]+)\/make-current$/);
  if (makeCurrentM && method === 'POST') {
    const fileId = makeCurrentM[1];
    const { data: rows } = await db.from('certificate_files', { select: 'id,certificate_id', filters: { 'id.eq': fileId }, limit: 1 });
    if (!rows?.length) return notFound('file', env);
    const row = rows[0];
    await db.update('certificate_files', { is_current: false }, { filters: { 'certificate_id.eq': row.certificate_id } });
    const { data, error } = await db.update('certificate_files', { is_current: true }, { filters: { 'id.eq': fileId } });
    if (error) return serverErr(env, error.message || 'Could not set current version');
    return ok({ file: Array.isArray(data) ? data[0] : data }, env);
  }

  const fileM = path.match(/^\/files\/([^/]+)$/);
  if (fileM && method === 'DELETE') {
    const fileId = fileM[1];
    const mode = (url.searchParams.get('mode') || 'soft').toLowerCase();
    const { data: rows, error } = await db.from('certificate_files', { select: '*', filters: { 'id.eq': fileId }, limit: 1 });
    if (error || !rows?.length) return notFound('file', env);
    const row = rows[0];
    if (mode === 'hard') {
      if (row.r2_key && isStorageConfigured(env)) {
        try { await deleteStorageObject(env, row.r2_key); } catch (e) { console.warn('Storage delete warning', e.message); }
      }
      await db.delete('certificate_files', { filters: { 'id.eq': fileId } });
      return ok({ id: fileId, deleted: true, mode: 'hard' }, env);
    }
    const { data: updated, error: upErr } = await db.update('certificate_files', {
      status: 'deleted',
      deleted_at: new Date().toISOString(),
      is_current: false,
    }, { filters: { 'id.eq': fileId } });
    if (upErr) return serverErr(env, upErr.message || 'Could not soft delete');
    return ok({ file: Array.isArray(updated) ? updated[0] : updated, mode: 'soft' }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

async function _signFileToken(env, fileId, exp) {
  const secret = env.JWT_SECRET || 'dev-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = `${fileId}.${exp}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return b64(sig);
}

async function _verifyFileToken(env, fileId, exp, sig) {
  try {
    const expected = await _signFileToken(env, fileId, exp);
    return expected === sig;
  } catch {
    return false;
  }
}

async function _deleteCertificateFileRecords(db, env, certificateIds = []) {
  const ids = (Array.isArray(certificateIds) ? certificateIds : [certificateIds]).filter(Boolean);
  if (!ids.length) return;
  const { data: rows } = await db.from('certificate_files', {
    select: 'id,r2_key',
    filters: { 'certificate_id.in': ids },
    limit: 5000,
  });
  const files = Array.isArray(rows) ? rows : [];
  for (const file of files) {
    if (file.r2_key && isStorageConfigured(env)) {
      try { await deleteStorageObject(env, file.r2_key); } catch (e) { console.warn('Storage delete warning:', e.message); }
    }
  }
  await db.delete('certificate_files', { filters: { 'certificate_id.in': ids } }).catch(() => {});
}

async function _notifyApprovers(db, env, session, cert) {
  try {
    const { data: approvers } = await db.from('users', {
      filters: { 'role.in': ['admin', 'manager'], 'is_active.is': true }, select: 'id',
    });
    if (!Array.isArray(approvers)) return;
    const eligible = approvers.filter(u => u.id !== session.sub);
    const notifs = eligible.map(u => ({
      user_id: u.id, type: 'cert_uploaded',
      title: 'Certificate Pending Approval',
      body: `${session.name} uploaded "${cert.name}" — awaiting review.`,
      ref_type: 'certificate', ref_id: cert.id, is_read: false,
    }));
    if (notifs.length) {
      await db.insert('notifications', notifs);
      // Web Push
      const payload = { 
        title: 'New Certificate Uploaded', 
        body: `${session.name} uploaded "${cert.name || 'document'}"`, 
        url: '/notifications.html', 
        tag: 'cert-pending-' + cert.id 
      };
      await sendPushToRoles(db, env, ['admin', 'manager'], payload, session.sub);
    }
  } catch (e) { console.warn('_notifyApprovers failed:', e); }
}

async function _notifyUser(db, env, userId, type, title, body, refType, refId) {
  try {
    await db.insert('notifications', { user_id: userId, type, title, body, ref_type: refType, ref_id: refId, is_read: false });
    // Web Push
    const payload = { title, body, url: '/notifications.html', tag: type + '-' + (refId || 'null') };
    await sendPushToUser(db, env, userId, payload);
  } catch (e) { console.warn('_notifyUser failed:', e); }
}

async function _notifyRoles(db, env, roles, type, title, body, refType, refId, excludeUserIds = []) {
  try {
    const excluded = new Set((Array.isArray(excludeUserIds) ? excludeUserIds : [excludeUserIds]).filter(Boolean));
    const { data: users } = await db.from('users', {
      filters: { 'role.in': roles, 'is_active.is': true },
      select: 'id',
      limit: 300,
    });
    const recipients = (Array.isArray(users) ? users : [])
      .map(u => u.id)
      .filter(Boolean)
      .filter(id => !excluded.has(id));
    if (!recipients.length) return;
    await Promise.allSettled(
      recipients.map(uid => _notifyUser(db, env, uid, type, title, body, refType, refId))
    );
  } catch (e) {
    console.warn('_notifyRoles failed:', e);
  }
}

async function _withUploaderUsername(db, rows, field = 'uploaded_by') {
  if (!Array.isArray(rows) || !rows.length) return [];
  const userIds = [...new Set(rows.map(r => r?.[field]).filter(Boolean))];
  if (!userIds.length) return rows.map(r => ({ ...r, uploaded_by_username: null }));
  const { data: users } = await db.from('users', {
    select: 'id,username',
    filters: { 'id.in': userIds },
    limit: userIds.length + 5,
  });
  const map = new Map((Array.isArray(users) ? users : []).map(u => [u.id, u.username]));
  return rows.map(r => ({
    ...r,
    uploaded_by_username: field === 'uploaded_by' ? (map.get(r.uploaded_by) || null) : undefined,
    changed_by_username: field === 'changed_by' ? (map.get(r.changed_by) || null) : undefined,
  }));
}

async function _recordCertificateHistory(db, cert, session, action) {
  try {
    if (!cert?.id) return;
    const snapshot = _createHistorySnapshot(cert);
    await db.insert('certificate_history', {
      certificate_id: cert.id,
      cert_number: cert.cert_number || null,
      name: cert.name || null,
      cert_type: cert.cert_type || null,
      lifting_subtype: cert.lifting_subtype || null,
      asset_id: cert.asset_id || null,
      client_id: cert.client_id || null,
      issued_by: cert.issued_by || null,
      issue_date: cert.issue_date || null,
      expiry_date: cert.expiry_date || null,
      approval_status: cert.approval_status || null,
      file_name: cert.file_name || null,
      file_url: cert.file_url || null,
      action_type: action,
      changed_by: session?.sub || null,
      changed_at: new Date().toISOString(),
      snapshot_json: snapshot,
    });
  } catch (e) { console.warn('Certificate history write failed:', e); }
}

function _createHistorySnapshot(cert) {
  return {
    id: cert.id || null,
    cert_number: cert.cert_number || null,
    name: cert.name || null,
    cert_type: cert.cert_type || null,
    lifting_subtype: cert.lifting_subtype || null,
    asset_id: cert.asset_id || null,
    client_id: cert.client_id || null,
    inspector_id: cert.inspector_id || null,
    issued_by: cert.issued_by || null,
    issue_date: cert.issue_date || null,
    expiry_date: cert.expiry_date || null,
    file_name: cert.file_name || null,
    file_url: cert.file_url || null,
    notes: cert.notes || null,
    approval_status: cert.approval_status || null,
    rejection_reason: cert.rejection_reason || null,
    uploaded_by: cert.uploaded_by || null,
    reviewed_by: cert.reviewed_by || null,
    reviewed_at: cert.reviewed_at || null,
    created_at: cert.created_at || null,
    updated_at: cert.updated_at || null,
  };
}

// ── clients.js ──
// worker/src/routes/clients.js




const INDUSTRIES = ['Oil & Gas', 'Construction', 'Manufacturing', 'Real Estate', 'Healthcare', 'Finance', 'Transport', 'Other'];
const CLIENT_STATUSES = ['active', 'inactive', 'suspended'];

async function handleClients(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin'])) return forbidden(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);
  const idM = path.match(/^\/clients\/([^/]+)$/);
  const cid = idM?.[1];

  if (!cid && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    const { data, error } = await db.from('clients', { select: '*', filters, limit, offset, order: 'name.asc' });
    if (error) return serverErr(env);
    return ok({ clients: data || [], limit, offset }, env);
  }

  if (cid && method === 'GET') {
    const { data } = await db.from('clients', { filters: { 'id.eq': cid }, select: '*', limit: 1 });
    const client = Array.isArray(data) ? data[0] : data;
    if (!client) return notFound('Client', env);
    return ok(client, env);
  }

  if (!cid && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      client_id: { required: true, type: 'string', minLength: 2, maxLength: 20, pattern: /^[A-Z0-9-]+$/ },
      name: { required: true, type: 'string', minLength: 2, maxLength: 150 },
      industry: { required: false, type: 'string', enum: INDUSTRIES },
      status: { required: false, type: 'string', enum: CLIENT_STATUSES },
      email: { required: false, type: 'string', email: true },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);
    const { data: dup } = await db.from('clients', { filters: { 'client_id.eq': body.client_id.toUpperCase() }, select: 'id', limit: 1 });
    if (Array.isArray(dup) && dup.length) return conflict('Client ID already exists', env);
    const { data, error } = await db.insert('clients', {
      client_id: body.client_id.toUpperCase(),
      name: body.name,
      name_ar: body.name_ar || null,
      industry: body.industry || null,
      contact: body.contact || null,
      email: body.email || null,
      phone: body.phone || null,
      country: body.country || null,
      city: body.city || null,
      status: body.status || 'active',
      contract_start: body.contract_start || null,
      contract_end: body.contract_end || null,
      notes: body.notes || null,
      color: body.color || '#0070f2',
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (cid && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const update = compact({ ...pick(body, ['name', 'name_ar', 'industry', 'contact', 'email', 'phone', 'country', 'city', 'status', 'contract_start', 'contract_end', 'notes', 'color']), updated_at: new Date().toISOString() });
    const { data, error } = await db.update('clients', update, { filters: { 'id.eq': cid } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Client', env);
    return ok(updated, env);
  }

  if (cid && method === 'DELETE') {
    // Soft delete
    const { data, error } = await db.update('clients', { status: 'inactive', updated_at: new Date().toISOString() }, { filters: { 'id.eq': cid } });
    if (error) return serverErr(env);
    return ok({ id: cid, status: 'inactive' }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── inspectors.js ──
// worker/src/routes/inspectors.js




async function handleInspectors(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);
  const fileM = path.match(/^\/inspectors\/file\/([^/]+)$/);
  const fileId = fileM?.[1];
  const cvM = path.match(/^\/inspectors\/cv\/([^/]+)$/);
  const cvId = cvM?.[1];
  const idM = path.match(/^\/inspectors\/([^/]+)$/);
  const iid = idM?.[1];

  if (path === '/inspectors/upload-file' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    let formData;
    try { formData = await request.formData(); } catch { return badReq('Invalid form data', 'BAD_FORM_DATA', env); }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided', 'NO_FILE', env);
    const category = (formData.get('category') || 'training').toString().toLowerCase();
    const allowed = category === 'cv'
      ? ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
      : ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return badReq('Invalid file type for this upload', 'INVALID_TYPE', env);
    if (file.size > 10 * 1024 * 1024) return badReq('File too large (max 10MB)', 'FILE_TOO_LARGE', env);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const labelRaw = (formData.get('label') || file.name.replace(/\.[^.]+$/, '') || 'file').toString();
    const safeLabel = labelRaw.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file';
    const finalName = `${safeLabel}.${ext}`;
    const safeCategory = category.replace(/[^a-z0-9-]/gi, '-');
    const key = `inspectors/${safeCategory}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${finalName}`;
    const fileBuffer = await file.arrayBuffer();
    try {
      await putStorageObject(env, key, fileBuffer, file.type, {
        originalName: file.name,
        uploadedBy: session.sub,
        category,
      });
    } catch (e) {
      console.error('Inspector file upload error:', e);
      return badReq('File upload failed: ' + e.message, 'UPLOAD_FAILED', env);
    }
    return ok({ file_name: finalName, file_url: key }, env);
  }

  if (path === '/inspectors/upload-cv' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    let formData;
    try { formData = await request.formData(); } catch { return badReq('Invalid form data', 'BAD_FORM_DATA', env); }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided', 'NO_FILE', env);
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) return badReq('Invalid file type. Allowed: PDF, DOC, DOCX', 'INVALID_TYPE', env);
    if (file.size > 10 * 1024 * 1024) return badReq('File too large (max 10MB)', 'FILE_TOO_LARGE', env);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 80) || 'cv';
    const key = `inspectors/cv/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}.${ext}`;
    const fileBuffer = await file.arrayBuffer();
    try {
      await putStorageObject(env, key, fileBuffer, file.type, {
        originalName: file.name,
        uploadedBy: session.sub,
      });
    } catch (e) {
      console.error('Inspector CV upload error:', e);
      return badReq('CV upload failed: ' + e.message, 'UPLOAD_FAILED', env);
    }
    return ok({ cv_file: file.name, cv_url: key }, env);
  }

  if (fileId && method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key.startsWith('inspectors/')) return badReq('Invalid file key', 'INVALID_KEY', env);
    const idFilter = fileId.includes('-') ? { 'id.eq': fileId } : { 'inspector_number.eq': fileId };
    const { data } = await db.from('inspectors', { filters: idFilter, select: 'id', limit: 1 });
    if (!(Array.isArray(data) ? data[0] : data)) return notFound('Inspector', env);
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const obj = await getStorageObject(env, key);
    if (!obj) return notFound('File', env);
    const fileName = url.searchParams.get('name') || key.split('/').pop() || 'inspector-file';
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${fileName}"`,
        ...cors(env),
        ...securityHeaders(request, env),
      },
    });
  }

  if (cvId && method === 'GET') {
    const idFilter = cvId.includes('-') ? { 'id.eq': cvId } : { 'inspector_number.eq': cvId };
    const { data } = await db.from('inspectors', { filters: idFilter, select: 'id,cv_file,cv_url', limit: 1 });
    const insp = Array.isArray(data) ? data[0] : data;
    if (!insp) return notFound('Inspector', env);
    if (!insp.cv_url) return notFound('CV file', env);
    if (!isStorageConfigured(env)) return badReq('Storage is not configured', 'NO_BUCKET', env);
    const obj = await getStorageObject(env, insp.cv_url);
    if (!obj) return notFound('CV file', env);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${insp.cv_file || 'inspector-cv'}"`,
        ...cors(env),
        ...securityHeaders(request, env),
      },
    });
  }

  if (!iid && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    const { data, error } = await db.from('inspectors', { select: '*', filters, limit, offset, order: 'inspector_number.asc' });
    if (error) return serverErr(env);
    return ok({ inspectors: data || [], limit, offset }, env);
  }

  if (iid && method === 'GET') {
    const { data } = await db.from('inspectors', { filters: { 'id.eq': iid }, select: '*', limit: 1 });
    const insp = Array.isArray(data) ? data[0] : data;
    if (!insp) return notFound('Inspector', env);
    return ok(insp, env);
  }

  if (!iid && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      name: { required: true, type: 'string', minLength: 2, maxLength: 150 },
      email: { required: false, type: 'string', email: true },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);
    if (body.email) {
      const { data: dup } = await db.from('inspectors', { filters: { 'email.ilike': body.email }, select: 'id', limit: 1 });
      if (Array.isArray(dup) && dup.length) return conflict('Email already in use', env);
    }
    const { data, error } = await db.insert('inspectors', {
      name: body.name,
      title: body.title || null,
      email: body.email || null,
      phone: body.phone || null,
      status: body.status || 'active',
      experience_years: body.experience_years || null,
      experience_desc: body.experience_desc || null,
      cv_file: body.cv_file || null,
      cv_url: body.cv_url || null,
      color: body.color || '#0070f2',
      education: JSON.stringify(Array.isArray(body.education) ? body.education : []),
      trainings: JSON.stringify(Array.isArray(body.trainings) ? body.trainings : []),
      training_certs: JSON.stringify(Array.isArray(body.training_certs) ? body.training_certs : []),
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (iid && method === 'PATCH') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const update = compact({ ...pick(body, ['name', 'title', 'email', 'phone', 'status', 'experience_years', 'experience_desc', 'cv_file', 'cv_url', 'color']), updated_at: new Date().toISOString() });
    if (Array.isArray(body.education)) update.education = JSON.stringify(body.education);
    if (Array.isArray(body.trainings)) update.trainings = JSON.stringify(body.trainings);
    if (Array.isArray(body.training_certs)) update.training_certs = JSON.stringify(body.training_certs);
    const { data, error } = await db.update('inspectors', update, { filters: { 'id.eq': iid } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Inspector', env);
    return ok(updated, env);
  }

  if (iid && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('inspectors', { filters: { 'id.eq': iid }, select: 'id', limit: 1 });
    if (!(Array.isArray(ex) ? ex[0] : ex)) return notFound('Inspector', env);
    await db.delete('inspectors', { filters: { 'id.eq': iid } });
    return ok({ id: iid, deleted: true }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── functional-locations.js ──
// worker/src/routes/functional-locations.js




const FL_TYPES = ['Rig', 'Workshop', 'Yard', 'Warehouse', 'Other'];
const FL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleFunctionalLocations(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);
  const idM = path.match(/^\/functional-locations\/([^/]+)$/);
  const flId = idM?.[1];
  const isAdmin = session.role === 'admin';
  const isManager = session.role === 'manager';

  /* READ scope:
     - admin/manager: all
     - user/technician: only their own customerId */
  if (!flId && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    if (url.searchParams.get('type')) filters['type.eq'] = url.searchParams.get('type');
    if (!isAdmin && !isManager) {
      if (!session.customerId) return forbidden(env);
      filters['client_id.eq'] = session.customerId;
    }
    const { data, error } = await db.from('functional_locations', { select: '*', filters, limit, offset, order: 'fl_id.asc' });
    if (error) return serverErr(env);
    return ok({ functional_locations: data || [], limit, offset }, env);
  }

  if (flId && method === 'GET') {
    const lookup = FL_UUID_RE.test(flId) ? { 'id.eq': flId } : { 'fl_id.eq': flId.toUpperCase() };
    const { data } = await db.from('functional_locations', { filters: lookup, select: '*', limit: 1 });
    const fl = Array.isArray(data) ? data[0] : data;
    if (!fl) return notFound('Functional Location', env);
    if (!isAdmin && !isManager && session.customerId !== fl.client_id) return forbidden(env);
    return ok(fl, env);
  }

  /* Write operations: admin only */
  if (!isAdmin) return forbidden(env);

  if (!flId && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { valid, errors } = validate(body, {
      fl_id: { required: true, type: 'string', minLength: 1, maxLength: 20 },
      name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
      type: { required: true, type: 'string', enum: FL_TYPES },
      client_id: { required: true, type: 'string', minLength: 1, maxLength: 20 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);
    const { data: dup } = await db.from('functional_locations', { filters: { 'fl_id.ilike': body.fl_id }, select: 'id', limit: 1 });
    if (Array.isArray(dup) && dup.length) return conflict('Functional Location ID already exists', env);
    const { data, error } = await db.insert('functional_locations', {
      fl_id: body.fl_id.toUpperCase(),
      name: body.name,
      type: body.type,
      status: body.status || 'active',
      client_id: body.client_id || null,
      notes: body.notes || null,
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (flId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const update = compact({ ...pick(body, ['name', 'type', 'status', 'client_id', 'notes']), updated_at: new Date().toISOString() });
    const lookup = FL_UUID_RE.test(flId) ? { 'id.eq': flId } : { 'fl_id.eq': flId.toUpperCase() };
    const { data, error } = await db.update('functional_locations', update, { filters: lookup });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Functional Location', env);
    return ok(updated, env);
  }

  if (flId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const lookup = FL_UUID_RE.test(flId) ? { 'id.eq': flId } : { 'fl_id.eq': flId.toUpperCase() };
    const { data: ex } = await db.from('functional_locations', { filters: lookup, select: 'id,fl_id', limit: 1 });
    if (!(Array.isArray(ex) ? ex[0] : ex)) return notFound('Functional Location', env);
    await db.delete('functional_locations', { filters: lookup });
    return ok({ id: flId, deleted: true }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── notifications.js ──
// worker/src/routes/notifications.js



async function handleNotifications(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);

  if (path === '/notifications/unread-count' && method === 'GET') {
    const { count, error } = await db.count('notifications', { filters: { 'user_id.eq': session.sub, 'is_read.is': false } });
    if (error) return serverErr(env);
    return ok({ count }, env);
  }

  if (path === '/notifications/mark-all-read' && method === 'POST') {
    await db.update('notifications', { is_read: true, read_at: new Date().toISOString() }, { filters: { 'user_id.eq': session.sub, 'is_read.is': false } });
    return ok({ marked: true }, env);
  }

  const idM = path.match(/^\/notifications\/([^/]+)$/);
  const notifId = idM?.[1];

  /* LIST */
  if (!notifId && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = { 'user_id.eq': session.sub };
    if (url.searchParams.get('unread') === 'true') filters['is_read.is'] = false;
    const { data, error } = await db.from('notifications', { select: '*', filters, limit, offset, order: 'created_at.desc' });
    if (error) return serverErr(env);
    return ok({ notifications: data || [], limit, offset }, env);
  }

  /* MARK READ */
  if (notifId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { data: ex } = await db.from('notifications', { filters: { 'id.eq': notifId }, select: 'id,user_id', limit: 1 });
    const notif = Array.isArray(ex) ? ex[0] : ex;
    if (!notif) return notFound('Notification', env);
    if (notif.user_id !== session.sub) return forbidden(env);
    const update = {};
    if (typeof body.is_read === 'boolean') { update.is_read = body.is_read; if (body.is_read) update.read_at = new Date().toISOString(); }
    if (!Object.keys(update).length) return badReq('No fields to update', 'VALIDATION', env);
    const { data } = await db.update('notifications', update, { filters: { 'id.eq': notifId } });
    return ok(Array.isArray(data) ? data[0] : data, env);
  }

  /* DELETE */
  if (notifId && method === 'DELETE') {
    const { data: ex } = await db.from('notifications', { filters: { 'id.eq': notifId }, select: 'id,user_id', limit: 1 });
    const notif = Array.isArray(ex) ? ex[0] : ex;
    if (!notif) return notFound('Notification', env);
    if (notif.user_id !== session.sub) return forbidden(env);
    await db.delete('notifications', { filters: { 'id.eq': notifId } });
    return ok({ id: notifId, deleted: true }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── reports.js ──
// worker/src/routes/reports.js



async function handleReports(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const db = createSupabase(env);
  const clientFilter = (['user', 'technician'].includes(session.role) && session.customerId)
    ? { 'client_id.eq': session.customerId } : {};

  /* ── GET /api/reports/summary ── */
  if (path === '/reports/summary') {
    const today = new Date().toISOString().split('T')[0];
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

    const [
      totalAssets, activeAssets, maintenanceAssets,
      totalCerts, validCerts, expiringSoon, expiredCerts, pendingCerts,
      totalClients, activeClients,
      totalInspectors,
    ] = await Promise.all([
      db.count('assets', { filters: { ...clientFilter } }),
      db.count('assets', { filters: { ...clientFilter, 'status.eq': 'active' } }),
      db.count('assets', { filters: { ...clientFilter, 'status.eq': 'maintenance' } }),
      db.count('certificates', { filters: { ...clientFilter } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq': 'approved', 'expiry_date.gt': soon } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': soon } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq': 'approved', 'expiry_date.lt': today } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq': 'pending' } }),
      db.count('clients', {}),
      db.count('clients', { filters: { 'status.eq': 'active' } }),
      db.count('inspectors', {}),
    ]);

    return ok({
      assets: {
        total: totalAssets.count,
        active: activeAssets.count,
        maintenance: maintenanceAssets.count,
        inactive: totalAssets.count - activeAssets.count - maintenanceAssets.count,
      },
      certificates: {
        total: totalCerts.count,
        valid: validCerts.count,
        expiring: expiringSoon.count,
        expired: expiredCerts.count,
        pending: pendingCerts.count,
      },
      clients: { total: totalClients.count, active: activeClients.count },
      inspectors: { total: totalInspectors.count },
    }, env);
  }

  /* ── GET /api/reports/expiring?days=30 ── */
  if (path === '/reports/expiring') {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30');
    const today = new Date().toISOString().split('T')[0];
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0];
    const { data, error } = await db.from('certificates', {
      select: '*',
      filters: { ...clientFilter, 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': cutoff },
      order: 'expiry_date.asc',
      limit: 200,
    });
    if (error) return serverErr(env);
    return ok({ certificates: data || [], days }, env);
  }

  return ok({}, env);
}

// ── web-push.js ──
// worker/src/lib/web-push.js
// Zero-dependency Web Push — VAPID + AES-128-GCM encryption
// Uses standard Web Crypto API (crypto.subtle) only. No Node.js deps.
// RFC 8291 (payload encryption) + RFC 8292 (VAPID signing)

// ── Base64url helpers ───────────────────────────────────────────────────────
function b64urlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlEncodeText(text) {
  return b64urlEncodeBytes(new TextEncoder().encode(text));
}
function b64urlDecodeBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function utf8Bytes(text) {
  return new TextEncoder().encode(String(text || ''));
}
function concatBytes(...parts) {
  const arrays = parts.filter(Boolean).map(part => part instanceof Uint8Array ? part : new Uint8Array(part));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) { out.set(part, offset); offset += part.length; }
  return out;
}
function uint32Bytes(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

// ── HKDF (RFC 5869) ────────────────────────────────────────────────────────
async function hmacSha256Bytes(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}
async function hkdfExtract(saltBytes, ikmBytes) {
  return hmacSha256Bytes(saltBytes, ikmBytes);
}
async function hkdfExpand(prkBytes, infoBytes, length) {
  let prev = new Uint8Array(0);
  const chunks = [];
  let generated = 0;
  let counter = 1;
  while (generated < length) {
    prev = await hmacSha256Bytes(prkBytes, concatBytes(prev, infoBytes, Uint8Array.of(counter)));
    chunks.push(prev);
    generated += prev.length;
    counter += 1;
  }
  return concatBytes(...chunks).slice(0, length);
}

// ── VAPID JWT Signing (RFC 8292) ────────────────────────────────────────────
function parseVapidPublicKey(publicKey) {
  const raw = b64urlDecodeBytes(String(publicKey || '').trim());
  if (raw.length !== 65 || raw[0] !== 4) throw new Error(`VAPID_PUBLIC_KEY must be an uncompressed P-256 public key (65 bytes, prefix 0x04). Got ${raw.length} bytes with prefix 0x${raw[0]?.toString(16)}. Re-generate VAPID keys.`);
  return {
    raw,
    x: b64urlEncodeBytes(raw.slice(1, 33)),
    y: b64urlEncodeBytes(raw.slice(33, 65)),
  };
}
async function importVapidPrivateKey(privateKey, publicKey) {
  const pub = parseVapidPublicKey(publicKey);
  // Decode to raw bytes then re-encode as clean base64url (no padding, no +/)
  // This fixes "Invalid EC key in JSON Web Key" caused by padding or wrong alphabet
  const privBytes = b64urlDecodeBytes(String(privateKey || '').trim());
  if (privBytes.length !== 32) throw new Error(`VAPID_PRIVATE_KEY must be 32 bytes (got ${privBytes.length}). Re-generate VAPID keys.`);
  const d = b64urlEncodeBytes(privBytes);
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x: pub.x, y: pub.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}
function derToJose(der, size) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (bytes.length === size) return bytes;
  if (bytes[0] !== 0x30) throw new Error('Unexpected DER signature format');
  let offset = 2;
  if (bytes[1] & 0x80) offset = 2 + (bytes[1] & 0x7f);
  if (bytes[offset] !== 0x02) throw new Error('Unexpected DER signature format');
  const rLen = bytes[offset + 1];
  const r = bytes.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (bytes[offset] !== 0x02) throw new Error('Unexpected DER signature format');
  const sLen = bytes[offset + 1];
  const s = bytes.slice(offset + 2, offset + 2 + sLen);
  const out = new Uint8Array(size);
  out.set(r.slice(-size / 2), size / 2 - Math.min(r.length, size / 2));
  out.set(s.slice(-size / 2), size - Math.min(s.length, size / 2));
  return out;
}
async function signVapidJwt(endpoint, subject, publicKey, privateKey) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 60 * 60;
  const header = b64urlEncodeText(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = b64urlEncodeText(JSON.stringify({ aud, exp, sub: subject }));
  const signingInput = `${header}.${payload}`;
  const key = await importVapidPrivateKey(privateKey, publicKey);
  const sigDer = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8Bytes(signingInput)));
  const joseSig = derToJose(sigDer, 64);
  return `${signingInput}.${b64urlEncodeBytes(joseSig)}`;
}

// ── Web Push Payload Encryption (RFC 8291 — aes128gcm) ─────────────────────
async function encryptWebPushPayload(subscription, payload) {
  const userPublicRaw = b64urlDecodeBytes(String(subscription?.keys?.p256dh || ''));
  const authSecret = b64urlDecodeBytes(String(subscription?.keys?.auth || ''));
  if (userPublicRaw.length !== 65) throw new Error('Invalid subscription public key (p256dh must be 65 bytes)');
  if (!authSecret.length) throw new Error('Invalid subscription auth secret');

  const uaPublicKey = await crypto.subtle.importKey('raw', userPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeys.privateKey, 256));

  // RFC 8291 §3.3: PRK_key = HKDF-Extract(auth_secret, ECDH_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  // RFC 8291 §3.3: IKM = HKDF-Expand(PRK_key, key_info, 32)
  const keyInfo = concatBytes(utf8Bytes('WebPush: info'), Uint8Array.of(0), userPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentPrk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(contentPrk, utf8Bytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(contentPrk, utf8Bytes('Content-Encoding: nonce\0'), 12);

  // Pad payload: append 0x02 delimiter (final record indicator)
  const plainBytes = concatBytes(utf8Bytes(JSON.stringify(payload || {})), Uint8Array.of(0x02));

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, plainBytes));

  // aes128gcm record: salt(16) + rs(4 BE) + idlen(1) + keyid(65)
  const recordHeader = concatBytes(salt, uint32Bytes(4096), Uint8Array.of(asPublicRaw.length), asPublicRaw);
  return concatBytes(recordHeader, ciphertext);
}

// ── VAPID config helper ─────────────────────────────────────────────────────
function getVapidConfig(env) {
  return {
    publicKey: String(env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: String(env.VAPID_PRIVATE_KEY || '').trim(),
    subject: env.VAPID_SUBJECT || 'mailto:admin@rigways.com',
  };
}

// ── Send a single Web Push notification ────────────────────────────────────
/**
 * @param {object} subscription  { endpoint, keys: { p256dh, auth } }
 * @param {object} payload       { title, body, url?, tag?, event_type? }
 * @param {object} vapid         { publicKey, privateKey, subject }
 * @returns {Promise<{ ok: boolean, status: number, gone: boolean }>}
 */
async function sendPushNotification(subscription, payload, vapid) {
  try {
    const body = await encryptWebPushPayload(subscription, payload);
    const token = await signVapidJwt(subscription.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);
    const commonHeaders = {
      'TTL': '86400',
      'Urgency': 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    };

    // Primary (RFC 8292): Authorization: WebPush <JWT> + Crypto-Key
    let response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Authorization': `WebPush ${token}`,
        'Crypto-Key': `p256ecdsa=${vapid.publicKey}`,
      },
      body,
    });

    let ok = response.ok || response.status === 201;
    let gone = response.status === 410 || response.status === 404;

    // Compatibility fallback for some push services that still expect legacy VAPID auth format.
    if (!ok && !gone && (response.status === 400 || response.status === 401 || response.status === 403)) {
      response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          ...commonHeaders,
          'Authorization': `vapid t=${token},k=${vapid.publicKey}`,
        },
        body,
      });
      ok = response.ok || response.status === 201;
      gone = response.status === 410 || response.status === 404;
    }

    if (!ok && !gone) {
      const text = await response.text().catch(() => '');
      console.warn(`[Push] Non-ok response ${response.status} for endpoint ${subscription.endpoint.slice(0, 60)}: ${text.slice(0, 200)}`);
    }
    return { ok, status: response.status, gone };
  } catch (e) {
    console.error('[Push] sendPushNotification error:', e);
    return { ok: false, status: 0, gone: false };
  }
}

// ── Send push to all active subscriptions for a user ───────────────────────
/**
 * Sends push to all active subscriptions belonging to userId.
 * On HTTP 410/404: soft-deletes the subscription (active = false).
 */
async function sendPushToUser(db, env, userId, payload) {
  if (!userId) return { sent: 0, total: 0, reason: 'missing_user' };
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { sent: 0, total: 0, reason: 'missing_vapid' };
  try {
    const { data: subs } = await db.from('push_subscriptions', {
      filters: { 'user_id.eq': userId, 'active.is': true },
      select: '*',
      limit: 20,
    });
    if (!Array.isArray(subs) || !subs.length) return { sent: 0, total: 0, reason: 'no_subscriptions' };

    const vapid = getVapidConfig(env);
    const now = new Date().toISOString();

    const results = await Promise.allSettled(
      subs.map(sub =>
        sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          vapid
        ).then(async (result) => {
          if (result.gone) {
            // Soft-delete: mark inactive instead of hard-delete
            await db.update('push_subscriptions', { active: false, updated_at: now }, { filters: { 'id.eq': sub.id } }).catch(() => {});
          } else if (result.ok) {
            // Track last successful dispatch
            await db.update('push_subscriptions', { last_used_at: now }, { filters: { 'id.eq': sub.id } }).catch(() => {});
          }
          return result;
        })
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const statusCounts = results.reduce((acc, r) => {
      const code = (r.status === 'fulfilled' && r.value?.status !== undefined) ? String(r.value.status) : 'rejected';
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    return {
      sent,
      total: subs.length,
      reason: sent > 0 ? null : 'dispatch_failed',
      statusCounts,
    };
  } catch (e) {
    console.warn('[Push] sendPushToUser failed:', e);
    return { sent: 0, total: 0, reason: 'internal_error' };
  }
}

// ── Send push to all active users with given roles ──────────────────────────
/**
 * @param {string[]} roles          e.g. ['admin', 'manager']
 * @param {string|null} excludeUserId  optional user to skip
 */
async function sendPushToRoles(db, env, roles, payload, excludeUserId = null) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { users: 0, sent: 0, reason: 'missing_vapid' };
  try {
    const { data: users } = await db.from('users', {
      filters: { 'role.in': roles, 'is_active.is': true },
      select: 'id',
    });
    if (!Array.isArray(users) || !users.length) return { users: 0, sent: 0, reason: 'no_users' };

    const eligible = users.filter(u => u.id !== excludeUserId);
    if (!eligible.length) return { users: 0, sent: 0, reason: 'no_eligible_users' };
    const results = await Promise.allSettled(
      eligible.map(u => sendPushToUser(db, env, u.id, payload))
    );

    const sent = results.reduce((acc, r) => acc + (r.status === 'fulfilled' ? (r.value?.sent || 0) : 0), 0);
    return { users: eligible.length, sent, reason: sent > 0 ? null : 'dispatch_failed' };
  } catch (e) {
    console.warn('[Push] sendPushToRoles failed:', e);
    return { users: 0, sent: 0, reason: 'internal_error' };
  }
}

// ── push.js ──
// worker/src/routes/push.js

async function handlePush(request, env, path) {
  const method = request.method;
  const db = createSupabase(env);

  /* ── GET /api/push/validate-keys — check VAPID key format ── */
  if (path === '/push/validate-keys' && method === 'GET') {
    const report = { ok: false, publicKey: {}, privateKey: {}, error: null };
    try {
      const pub = String(env.VAPID_PUBLIC_KEY || '').trim();
      const priv = String(env.VAPID_PRIVATE_KEY || '').trim();
      const pubBytes = b64urlDecodeBytes(pub);
      const privBytes = b64urlDecodeBytes(priv);
      report.publicKey = {
        present: pub.length > 0,
        rawLength: pubBytes.length,
        prefix: pubBytes[0],
        valid: pubBytes.length === 65 && pubBytes[0] === 4,
        note: pubBytes.length !== 65 ? `Expected 65 bytes, got ${pubBytes.length}` : pubBytes[0] !== 4 ? `Expected prefix 0x04, got 0x${pubBytes[0].toString(16)}` : 'OK',
      };
      report.privateKey = {
        present: priv.length > 0,
        rawLength: privBytes.length,
        valid: privBytes.length === 32,
        note: privBytes.length !== 32 ? `Expected 32 bytes, got ${privBytes.length}` : 'OK',
      };
      if (report.publicKey.valid && report.privateKey.valid) {
        // Try actually importing the key
        await importVapidPrivateKey(priv, pub);
        report.ok = true;
        report.error = null;
      } else {
        report.error = 'Key format invalid — re-generate VAPID keys with: npx web-push generate-vapid-keys';
      }
    } catch (e) {
      report.ok = false;
      report.error = e.message;
    }
    return ok(report, env);
  }

  /* ── GET /api/push/vapid-key — public, no auth needed ── */
  if (path === '/push/vapid-key' && method === 'GET') {
    return ok({ publicKey: env.VAPID_PUBLIC_KEY || '' }, env);
  }

  const session = await getSession(request, env);
  if (!session) return unauth(env);

  /* ── POST /api/push/subscribe — save a browser push subscription ── */
  if (path === '/push/subscribe' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const { endpoint, keys } = body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return badReq('Missing subscription fields (endpoint, keys.p256dh, keys.auth)', 'VALIDATION', env);
    if (!endpoint.startsWith('https://')) return badReq('Invalid push endpoint (HTTPS required)', 'VALIDATION', env);

    // Check if this endpoint is already registered for this user
    const { data: existing } = await db.from('push_subscriptions', {
      filters: { 'user_id.eq': session.sub, 'endpoint.eq': endpoint },
      select: 'id',
      limit: 1,
    });
    const existingRow = Array.isArray(existing) ? existing[0] : existing;

    const ua = request.headers.get('User-Agent') || null;
    const now = new Date().toISOString();

    if (existingRow) {
      // Re-subscribe: refresh keys + optional metadata
      await db.update('push_subscriptions', {
        p256dh: keys.p256dh,
        auth: keys.auth,
        active: true,
        user_agent: ua,
        ...(body.client_id !== undefined && { client_id: body.client_id }),
        ...(body.platform !== undefined && { platform: body.platform }),
        ...(body.is_standalone !== undefined && { is_standalone: Boolean(body.is_standalone) }),
        updated_at: now,
      }, { filters: { 'id.eq': existingRow.id } });
      return ok({ subscribed: true, updated: true }, env);
    }

    // New subscription
    const { error } = await db.insert('push_subscriptions', {
      user_id: session.sub,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      active: true,
      user_agent: ua,
      client_id: body.client_id || null,
      platform: body.platform || null,
      is_standalone: body.is_standalone !== undefined ? Boolean(body.is_standalone) : null,
    });
    if (error) return serverErr(env, error.message || JSON.stringify(error));
    return created({ subscribed: true }, env);
  }

  /* ── DELETE /api/push/unsubscribe ── */
  if (path === '/push/unsubscribe' && method === 'DELETE') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    if (!body?.endpoint) return badReq('Missing endpoint', 'VALIDATION', env);
    await db.delete('push_subscriptions', { filters: { 'user_id.eq': session.sub, 'endpoint.eq': body.endpoint } });
    return ok({ unsubscribed: true }, env);
  }

  /* ── GET /api/push/status ── */
  if (path === '/push/status' && method === 'GET') {
    const { count } = await db.count('push_subscriptions', { filters: { 'user_id.eq': session.sub, 'active.is': true } });
    return ok({ subscribed: (count || 0) > 0, count: count || 0 }, env);
  }

  /* ── POST /api/push/batch-notify ── */
  if (path === '/push/batch-notify' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }
    const count = parseInt(body.count) || 0;
    if (count < 1) return badReq('Count must be at least 1', 'VALIDATION', env);
    const payload = { title: 'Certificates Uploaded', body: body.message || `${count} certificate(s) uploaded.`, url: '/certificates.html', tag: 'batch-cert-upload', event_type: 'cert_upload' };
    await sendPushToUser(db, env, session.sub, payload);
    await sendPushToRoles(db, env, ['admin', 'manager'], payload, session.sub);
    return ok({ notified: true, count }, env);
  }

  /* ── POST /api/push/test — send a test notification to yourself ── */
  if (path === '/push/test' && method === 'POST') {
    const payload = { title: 'Test Notification', body: 'This is a test notification for your device.', url: '/notifications.html', tag: 'test-push-individual', event_type: 'test' };
    const stats = await sendPushToUser(db, env, session.sub, payload);
    let message = '';
    if (stats.sent > 0) {
      message = `Triggered for ${stats.sent} of your ${stats.total} registered device(s). Check your notification center.`;
    } else if (stats.reason === 'missing_vapid') {
      message = 'Push server keys are missing or invalid. Configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Worker settings.';
    } else if (stats.reason === 'no_subscriptions') {
      message = 'No active push subscriptions found for your account. Enable push notifications above, then retry.';
    } else if (stats.reason === 'dispatch_failed') {
      const sc = stats.statusCounts ? ` Statuses: ${JSON.stringify(stats.statusCounts)}.` : '';
      message = `Push request was attempted for ${stats.total} device(s), but all were rejected by the push service.${sc} Check worker logs for [Push] warnings.`;
    } else {
      message = 'Push test completed with no successful deliveries. Check worker logs for details.';
    }
    return ok({
      success: true,
      stats,
      message,
    }, env);
  }

  /* ── POST /api/push/test-all — broadcast test to all admins/managers ── */
  if (path === '/push/test-all' && method === 'POST') {
    if (!isAdminOrManager(session)) return forbidden(env);
    const payload = { title: 'Global Push Test', body: `Broadcast test triggered by ${session.name}.`, url: '/notifications.html', tag: 'test-push-global', event_type: 'test' };
    const stats = await sendPushToRoles(db, env, ['admin', 'manager'], payload);
    let message = `Broadcasted to ${stats.users} qualified users. Total of ${stats.sent} push notification(s) triggered.`;
    if (stats.sent === 0) {
      if (stats.reason === 'missing_vapid') {
        message = 'Broadcast blocked: VAPID keys are not configured in Worker settings.';
      } else if (stats.reason === 'no_users' || stats.reason === 'no_eligible_users') {
        message = 'Broadcast found no eligible admin/manager accounts to notify.';
      } else {
        message = `Broadcast reached ${stats.users} users but no device accepted the push. Check active subscriptions and worker logs.`;
      }
    }
    return ok({ success: true, stats, message }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

// ── check-expiry.js ──
// worker/src/routes/check-expiry.js — Cron logic

async function handleCheckExpiry(env) {
  const db = createSupabase(env);
  const today = new Date().toISOString().split('T')[0];
  const in7d = datePlusDays(7);
  const in14d = datePlusDays(14);
  const in30d = datePlusDays(30);

  const { data: expired } = await db.from('certificates', { filters: { 'approval_status.eq': 'approved', 'expiry_date.lt': today }, select: 'id,name,cert_number,expiry_date,uploaded_by,client_id', limit: 500 });
  const { data: crit7 } = await db.from('certificates', { filters: { 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': in7d }, select: 'id,name,cert_number,expiry_date,uploaded_by,client_id', limit: 500 });
  const { data: warn30 } = await db.from('certificates', { filters: { 'approval_status.eq': 'approved', 'expiry_date.gt': in7d, 'expiry_date.lte': in30d }, select: 'id,name,cert_number,expiry_date,uploaded_by,client_id', limit: 500 });

  const expiredList = Array.isArray(expired) ? expired : [];
  const criticalList = Array.isArray(crit7) ? crit7 : [];
  const warningList = Array.isArray(warn30) ? warn30 : [];

  let pushCount = 0;
  if (expiredList.length > 0) {
    const payload = { title: `⚠️ ${expiredList.length} Certs Expired`, body: expiredList.slice(0, 3).map(c => c.name || c.cert_number).join(', '), url: '/notifications.html', tag: 'cert-expired' };
    await sendPushToRoles(db, env, ['admin', 'manager'], payload); pushCount++;
    const uploaderIds = [...new Set(expiredList.map(c => c.uploaded_by).filter(Boolean))];
    for (const uid of uploaderIds) {
      const userCerts = expiredList.filter(c => c.uploaded_by === uid);
      await sendPushToUser(db, env, uid, { title: `⚠️ ${userCerts.length} of your certs expired`, body: userCerts.map(c => c.name || c.cert_number).join(', '), url: '/certificates.html', tag: 'cert-expired-user' });
      pushCount++;
    }
  }
  if (criticalList.length > 0) {
    const payload = { title: `🔴 ${criticalList.length} Certs Expiring (7d)`, body: criticalList.slice(0, 3).map(c => `${c.name || c.cert_number} (${c.expiry_date})`).join(', '), url: '/notifications.html', tag: 'cert-expiring-critical' };
    await sendPushToRoles(db, env, ['admin', 'manager'], payload); pushCount++;

    const uploaderIds = [...new Set(criticalList.map(c => c.uploaded_by).filter(Boolean))];
    for (const uid of uploaderIds) {
      const userCerts = criticalList.filter(c => c.uploaded_by === uid);
      await sendPushToUser(db, env, uid, { title: `🔴 ${userCerts.length} of your certs expiring (≤7d)`, body: userCerts.map(c => `${c.name || c.cert_number} (${c.expiry_date})`).join(', '), url: '/certificates.html', tag: 'cert-critical-user' });
      pushCount++;
    }
  }
  if (warningList.length > 0 && new Date().getUTCDay() === 1) {
    await sendPushToRoles(db, env, ['admin', 'manager'], { title: `🟡 ${warningList.length} Certs Expiring (30d)`, body: `${warningList.length} certificates due soon.`, url: '/notifications.html', tag: 'cert-expiring-warning' });
    pushCount++;

    const uploaderIds = [...new Set(warningList.map(c => c.uploaded_by).filter(Boolean))];
    for (const uid of uploaderIds) {
      const userCerts = warningList.filter(c => c.uploaded_by === uid);
      await sendPushToUser(db, env, uid, { title: `🟡 ${userCerts.length} of your certs expiring soon (≤30d)`, body: `${userCerts.length} certificates due soon.`, url: '/certificates.html', tag: 'cert-warning-user' });
      pushCount++;
    }
  }
  return { checked: true, expired: expiredList.length, critical: criticalList.length, warning: warningList.length, pushesSent: pushCount };
}

function datePlusDays(days) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// ── Entry point ──
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve static files for non-API requests
    if (!url.pathname.startsWith('/api/')) {
      const assetRes = await env.ASSETS.fetch(request);
      const headers = new Headers(assetRes.headers);
      const sec = securityHeaders(request, env);
      Object.entries(sec).forEach(([k, v]) => headers.set(k, v));
      Object.entries(cors(env)).forEach(([k, v]) => headers.set(k, v));
      return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    try {
      const path = url.pathname.replace('/api', '');

      if (path.startsWith('/auth')) return await handleAuth(request, env, path);
      if (path.startsWith('/users')) return await handleUsers(request, env, path);
      if (path.startsWith('/jobs')) return await handleJobs(request, env, path);
      if (path.startsWith('/assets')) return await handleAssets(request, env, path);
      if (path.startsWith('/certificates/upload') || path.startsWith('/certificates/file/')) {
        const uploadResult = await handleCertUpload(request, env, path);
        if (uploadResult) return uploadResult;
      }
      if (path.startsWith('/certificates')) return await handleCertificates(request, env, path);
      if (path.startsWith('/files')) return await handleFiles(request, env, path);
      if (path.startsWith('/clients')) return await handleClients(request, env, path);
      if (path.startsWith('/inspectors')) return await handleInspectors(request, env, path);
      if (path.startsWith('/functional-locations')) return await handleFunctionalLocations(request, env, path);
      if (path.startsWith('/notifications')) return await handleNotifications(request, env, path);
      if (path.startsWith('/reports')) return await handleReports(request, env, path);
      if (path.startsWith('/push')) return await handlePush(request, env, path);

      /* ── GET /api/diag ── Configuration Diagnostics */
      if (path === '/diag' && request.method === 'GET') {
        const checks = {
      STORAGE_BACKEND: storageBackendLabel(env),
          SUPABASE_URL: !!env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: !!env.SUPABASE_SERVICE_ROLE_KEY,
          JWT_SECRET: !!env.JWT_SECRET,
          VAPID_PRIVATE_KEY: !!env.VAPID_PRIVATE_KEY,
          VAPID_PUBLIC_KEY: !!env.VAPID_PUBLIC_KEY,
          CRON_SECRET: !!env.CRON_SECRET,
          B2_BUCKET: !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME),
          CERT_BUCKET: !!env.CERT_BUCKET
        };
        
        let cryptoTest = { ok: false };
        try {
          if (env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY) {
            const dummySub = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/dummy', keys: { p256dh: 'BNkHRry_3w6SjdeQNJbCpV3ouo7s5FHHSzWhAZQ5oja-X9tabOf8gqO7xRQpVBEHNrlSEazJLeqBY1eBhSMTdig', auth: '8eByt89o4J9v-02e3K5IYA' } };
            const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@rigways.com' };
            await signVapidJwt(dummySub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);
            await encryptWebPushPayload(dummySub, { title: 'diag-test' });
            cryptoTest.ok = true;
          } else { cryptoTest.error = 'Keys missing'; }
        } catch (e) { cryptoTest.error = e.message || String(e); }
        
        let cronWorkerHeartbeat = { ok: false };
        if (env.CRON_WORKER_URL) {
          try {
            const cronRes = await fetch(env.CRON_WORKER_URL, { signal: AbortSignal.timeout(3000) });
            const text = await cronRes.text();
            cronWorkerHeartbeat = { 
              ok: cronRes.ok, 
              status: cronRes.status, 
              response: text.slice(0, 50),
              online: text.includes('active') || text.includes('initiated')
            };
          } catch (e) { cronWorkerHeartbeat.error = e.message || String(e); }
        } else { cronWorkerHeartbeat.error = 'CRON_WORKER_URL not configured'; }
 
        return ok({ 
          success: true, 
          checks, 
          cryptoTest,
          cronWorkerHeartbeat,
          deployment: 'worker_v2_diag',
          version: '2.0.5',
          timestamp: new Date().toISOString() 
        }, env);
      }

      // Cron manual trigger (Admin or Secret)
      if (path === '/cron/check-expiry' && (request.method === 'GET' || request.method === 'POST')) {
        const cronSecret = env.CRON_SECRET;
        const authHeader = request.headers.get('Authorization');
        const isSecretMatch = cronSecret && (authHeader === `Bearer ${cronSecret}` || url.searchParams.get('secret') === cronSecret);

        if (!isSecretMatch) {
          const session = await getSession(request, env);
          if (!session || !requireRole(session, ['admin'])) {
            const reason = !cronSecret ? 'CRON_SECRET_NOT_CONFIGURED' : 'INVALID_SECRET_PROVIDED';
            return json({ success: false, error: `Forbidden: ${reason}`, code: 'FORBIDDEN' }, 403, env, request);
          }
        }

        const result = await handleCheckExpiry(env);
        return json({ success: true, data: result }, 200, env, request);
      }

      return json({ success: false, error: 'Route not found' }, 404, env, request);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: 'Error: ' + (err?.message || String(err)), code: 'SERVER_ERROR' }, 500, env, request);
    }
  }
};
