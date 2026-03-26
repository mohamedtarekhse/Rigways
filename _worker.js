// _worker.js — Cloudflare Pages Advanced Mode
// Place this at the REPO ROOT alongside index.html
// Pages automatically uses this file for ALL requests when it exists.
// Static files (html, css, js) are served via env.ASSETS.fetch()
// API requests are handled by the bundled Worker code below.

// ── response.js ──
// worker/src/utils/response.js
// Consistent { success, data?, error?, code? } shape on every response

function json(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env) },
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
  return new Response(null, { status: 204, headers: cors(env) });
}

const ok = (data, env) => json({ success: true, data }, 200, env);
const created = (data, env) => json({ success: true, data }, 201, env);
const badReq = (error, code, env) => json({ success: false, error, code }, 400, env);
const unauth = (env) => json({ success: false, error: 'Unauthorized', code: 'UNAUTH' }, 401, env);
const forbidden = (env) => json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403, env);
const notFound = (res, env) => json({ success: false, error: `${res} not found`, code: 'NOT_FOUND' }, 404, env);
const conflict = (error, env) => json({ success: false, error, code: 'CONFLICT' }, 409, env);
const serverErr = (env, msg) => json({ success: false, error: msg ? 'Server error: ' + msg : 'Internal server error', code: 'SERVER_ERROR' }, 500, env);

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
  // Falls back to hardcoded values if env vars not set
  const base = env.SUPABASE_URL || 'https://rsrwcimpeeulwvweupla.supabase.co';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzcndjaW1wZWV1bHd2d2V1cGxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA3MjY2NCwiZXhwIjoyMDg5NjQ4NjY0fQ.hgIrf05XlM4soC97Imw7Wg7fYeW84ldHOw3Daanf_Ek';

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
  try { return await verifyJwt(auth.slice(7), env.JWT_SECRET); }
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
    const jwtSecret = env.JWT_SECRET || 'RpqWYICUJpGoAPqmRhbaY2OW9repND0gRtqzCOedMvvVD/wT0hld52zEAXYDQdLdXwqa0WxO9wpaDbm4e1QTjQ==';
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





const SAFE = 'id,username,name,name_ar,role,customer_id,is_active,created_at,last_login_at';

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
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);
    const { data: dup } = await db.from('users', { filters: { 'username.ilike': body.username }, select: 'id', limit: 1 });
    if (Array.isArray(dup) && dup.length) return conflict('Username already exists', env);
    const { data, error } = await db.insert('users', {
      username: body.username.toLowerCase(),
      name: body.name,
      name_ar: body.name_ar || null,
      role: body.role,
      customer_id: body.customer_id || null,
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
    const update = compact(pick(body, ['name', 'name_ar', 'role', 'customer_id', 'is_active']));
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

// ── assets.js ──
// worker/src/routes/assets.js




const ASSET_TYPES = ['Hoisting Equipment','Drilling Equipment','Mud System Low Pressure','Mud System High Pressure','Wirelines','Structure','Well Control','Tubular'];
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

async function notifyAssetAdded(db, session, asset) {
  try {
    const { data: recipients } = await db.from('users', {
      filters: { 'role.in': ['admin', 'manager'], 'is_active.is': true },
      select: 'id',
    });
    if (!Array.isArray(recipients) || !recipients.length) return;
    const notifs = recipients
      .filter(u => u.id && u.id !== session.sub)
      .map(u => ({
        user_id: u.id,
        type: 'asset_added',
        title: 'New Asset Added',
        body: `${session.name} added asset "${asset.name}" (${asset.asset_number}).`,
        ref_type: 'asset',
        ref_id: asset.id,
        is_read: false,
      }));
    if (notifs.length) await db.insert('notifications', notifs);
  } catch (e) { console.warn('Asset added notification failed:', e); }
}


async function handleAssets(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db  = createSupabase(env);
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
      const hasAssetDup = Boolean((assetKey && byAsset.has(assetKey)) || seenAsset.has(assetKey));
      const hasSerialDup = Boolean((serialKey && bySerial.has(serialKey)) || seenSerial.has(serialKey));
      const duplicate = hasAssetDup || hasSerialDup;
      let duplicateBy = null;
      if (duplicate) {
        if (hasAssetDup && hasSerialDup) duplicateBy = 'asset_number_and_serial_number';
        else if (hasSerialDup) duplicateBy = 'serial_number';
        else duplicateBy = 'asset_number';
      }
      if (assetKey) seenAsset.add(assetKey);
      if (serialKey) seenSerial.add(serialKey);

      const status = errors.length ? 'error' : (duplicate ? 'duplicate' : (warnings.length ? 'warning' : 'valid'));
      return { index: idx, status, errors, warnings, duplicate, duplicate_by: duplicateBy };
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

  const idM    = path.match(/^\/assets\/([^/]+)$/);
  const asId    = idM?.[1] ? await resolveAssetId(db, idM[1]) : undefined;

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
    await notifyAssetAdded(db, session, asset);
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
    await audit(db, session, 'assets', asId, 'delete', existing, null);
    await db.delete('assets', { filters: { 'id.eq': asId } });
    return ok({ id: asId, deleted: true }, env);
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

// ── certificates.js ──
// worker/src/routes/certificates.js




const CERT_TYPES = ['CAT III','CAT IV','ORIGINAL COC','LOAD TEST','LIFTING','NDT','TUBULAR'];
const CERT_STATUSES = ['pending', 'approved', 'rejected'];

// ── CERTIFICATES FILE UPLOAD ──
// POST /api/certificates/upload  — upload file to R2, returns file_key + public URL
// GET  /api/certificates/file/:certId — get signed URL for a cert file

async function handleCertUpload(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  // ── POST /api/certificates/upload ──
  if (path === '/certificates/upload' && request.method === 'POST') {
    if (!env.CERT_BUCKET) {
      return json({ success: false, error: 'R2 bucket not configured. Add [[r2_buckets]] binding in wrangler.toml', code: 'NO_BUCKET' }, 500, env);
    }

    let formData;
    try { formData = await request.formData(); }
    catch(e) { return badReq('Could not parse form data', 'BAD_FORM', env); }

    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided', 'NO_FILE', env);

    // Validate file type
    const allowedTypes = ['application/pdf','image/jpeg','image/png','image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return badReq('Invalid file type. Allowed: PDF, JPG, PNG, WEBP', 'INVALID_TYPE', env);
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return badReq('File too large. Maximum size is 10MB', 'FILE_TOO_LARGE', env);
    }

    // Structured R2 key: clients/{clientId}/jobs/{jobNumber}/{certNumber}.{ext}
    // All three are required — passed from frontend after the cert record has been saved.
    const clientId  = (formData.get('client_id')   || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const jobNumber = (formData.get('job_number')   || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const certNumber= (formData.get('cert_number')  || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const ext       = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');

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
    const key       = `clients/${clientId}/jobs/${jobNumber}/${jobNumber}_${certNumber}_${safeOriginal}.${ext}`;
    const fileBuffer = await file.arrayBuffer();

    try {
      await env.CERT_BUCKET.put(key, fileBuffer, {
        httpMetadata: { contentType: file.type },
        customMetadata: {
          originalName: file.name,
          uploadedBy:   session.sub,
          username:     session.username,
          certNumber,
          jobNumber,
          clientId,
        },
      });
    } catch(e) {
      console.error('R2 upload error:', e);
      return json({ success: false, error: 'File upload failed: ' + e.message, code: 'UPLOAD_FAILED' }, 500, env);
    }

    return ok({ key, file_name: `${jobNumber}_${certNumber}_${safeOriginal}.${ext}`, file_url: key }, env);
  }

  // ── GET /api/certificates/file/:certId — get signed URL ──
  const fileMatch = path.match(/^\/certificates\/file\/([^/]+)$/);
  if (fileMatch && request.method === 'GET') {
    if (!env.CERT_BUCKET) {
      return json({ success: false, error: 'R2 bucket not configured', code: 'NO_BUCKET' }, 500, env);
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
    if (['user','technician'].includes(session.role) && session.customerId && cert.client_id !== session.customerId)
      return forbidden(env);

    if (!cert.file_url) return json({ success: false, error: 'No file attached to this certificate', code: 'NO_FILE' }, 404, env);

    // Proxy the file directly through the Worker — works on free plan, no signed URL needed.
    // The browser opens /api/certificates/file/:id and the Worker streams the bytes back.
    try {
      const obj = await env.CERT_BUCKET.get(cert.file_url);
      if (!obj) return json({ success: false, error: 'File not found in storage', code: 'FILE_MISSING' }, 404, env);

      const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
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
        },
      });
    } catch(e) {
      console.error('R2 get error:', e);
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
    if (cert.approval_status === 'pending') await _notifyApprovers(db, session, cert);
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

    const allowed = isApprover
      ? ['name', 'cert_type', 'issued_by', 'issue_date', 'expiry_date', 'file_name', 'file_url', 'notes', 'approval_status', 'rejection_reason', 'inspector_id']
      : ['name', 'cert_type', 'issued_by', 'issue_date', 'expiry_date', 'file_name', 'file_url', 'notes'];

    const update = compact({
      ...pick(body, allowed),
      updated_at: new Date().toISOString(),
      ...(body.approval_status && isApprover ? { reviewed_by: session.sub, reviewed_at: new Date().toISOString() } : {}),
    });
    const { data, error } = await db.update('certificates', update, { filters: { 'id.eq': certId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    await _recordCertificateHistory(db, updated || existing, session, 'update');

    // Notify uploader of decision
    if (body.approval_status && body.approval_status !== existing.approval_status && existing.uploaded_by)
      await _notifyUser(db, existing.uploaded_by, 'cert_reviewed', `Certificate ${body.approval_status}`,
        `Your certificate "${updated.name}" has been ${body.approval_status}.`, 'certificate', certId);

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

    if (existing.file_url && env.CERT_BUCKET) {
      try { await env.CERT_BUCKET.delete(existing.file_url); }
      catch (e) { console.warn('R2 delete warning:', e.message); }
    }

    const { data: updatedRows, error: updateErr } = await db.update('certificates', {
      file_name: null,
      file_url: null,
      updated_at: new Date().toISOString(),
    }, { filters: { 'id.eq': fileDeleteId } });
    if (updateErr) return serverErr(env);
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
        if (cert.file_url && env.CERT_BUCKET) {
          try { await env.CERT_BUCKET.delete(cert.file_url); }
          catch (e) { console.warn('R2 delete warning:', e.message); }
        }
        await _recordCertificateHistory(db, cert, session, 'record_deleted');
      }
      await db.delete('certificates', { filters: { 'asset_id.eq': existing.asset_id } });
      return ok({
        deleted_scope: 'asset',
        asset_id: existing.asset_id,
        deleted_count: related.length,
        deleted_ids: related.map(r => r.id),
      }, env);
    }

    // Delete one certificate row
    if (existing.file_url && env.CERT_BUCKET) {
      try { await env.CERT_BUCKET.delete(existing.file_url); }
      catch (e) { console.warn('R2 delete warning:', e.message); }
    }
    await _recordCertificateHistory(db, { ...existing, id: certId }, session, 'record_deleted');
    await db.delete('certificates', { filters: { 'id.eq': certId } });
    return ok({ id: certId, deleted: true, deleted_scope: 'single' }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}

async function _notifyApprovers(db, session, cert) {
  try {
    const { data: approvers } = await db.from('users', {
      filters: { 'role.in': ['admin', 'manager'], 'is_active.is': true }, select: 'id',
    });
    if (!Array.isArray(approvers)) return;
    const notifs = approvers.filter(u => u.id !== session.sub).map(u => ({
      user_id: u.id, type: 'cert_uploaded',
      title: 'Certificate Pending Approval',
      body: `${session.name} uploaded "${cert.name}" — awaiting review.`,
      ref_type: 'certificate', ref_id: cert.id, is_read: false,
    }));
    if (notifs.length) await db.insert('notifications', notifs);
  } catch (e) { console.warn('Notify failed:', e); }
}

async function _notifyUser(db, userId, type, title, body, refType, refId) {
  try {
    await db.insert('notifications', { user_id: userId, type, title, body, ref_type: refType, ref_id: refId, is_read: false });
  } catch (e) { console.warn('Notify failed:', e); }
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
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured', 'NO_BUCKET', env);
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
    const key = `inspectors/${category}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${finalName}`;
    try {
      await env.CERT_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name, uploadedBy: session.sub, category },
      });
    } catch {
      return badReq('File upload failed', 'UPLOAD_FAILED', env);
    }
    return ok({ file_name: finalName, file_url: key }, env);
  }

  if (path === '/inspectors/upload-cv' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured', 'NO_BUCKET', env);
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
    try {
      await env.CERT_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name, uploadedBy: session.sub },
      });
    } catch {
      return badReq('CV upload failed', 'UPLOAD_FAILED', env);
    }
    return ok({ cv_file: file.name, cv_url: key }, env);
  }

  if (fileId && method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key.startsWith('inspectors/')) return badReq('Invalid file key', 'INVALID_KEY', env);
    const idFilter = fileId.includes('-') ? { 'id.eq': fileId } : { 'inspector_number.eq': fileId };
    const { data } = await db.from('inspectors', { filters: idFilter, select: 'id', limit: 1 });
    if (!(Array.isArray(data) ? data[0] : data)) return notFound('Inspector', env);
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured', 'NO_BUCKET', env);
    const obj = await env.CERT_BUCKET.get(key);
    if (!obj) return notFound('File', env);
    const fileName = url.searchParams.get('name') || key.split('/').pop() || 'inspector-file';
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${fileName}"`,
      },
    });
  }

  if (cvId && method === 'GET') {
    const idFilter = cvId.includes('-') ? { 'id.eq': cvId } : { 'inspector_number.eq': cvId };
    const { data } = await db.from('inspectors', { filters: idFilter, select: 'id,cv_file,cv_url', limit: 1 });
    const insp = Array.isArray(data) ? data[0] : data;
    if (!insp) return notFound('Inspector', env);
    if (!insp.cv_url) return notFound('CV file', env);
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured', 'NO_BUCKET', env);
    const obj = await env.CERT_BUCKET.get(insp.cv_url);
    if (!obj) return notFound('CV file', env);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${insp.cv_file || 'inspector-cv'}"`,
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
  // ── push-notifications.js ──
// POST /api/notifications/subscribe   — save user push subscription
// POST /api/notifications/unsubscribe — remove user push subscription

async function handlePushNotifications(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const db = createSupabase(env);
  const method = request.method;

  /* ── POST /api/notifications/subscribe ── */
  if (path === '/notifications/subscribe' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    if (!body.subscription || !body.subscription.endpoint) {
      return badReq('Invalid subscription object', 'INVALID_SUB', env);
    }

    try {
      const { data, error } = await db.insert('push_subscriptions', {
        user_id: session.sub,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys?.p256dh || null,
        auth: body.subscription.keys?.auth || null,
        user_agent: request.headers.get('User-Agent'),
      });

      if (error) {
        console.warn('Failed to save subscription:', error);
        return serverErr(env, 'Failed to save subscription');
      }

      return ok({ message: 'Subscription saved', id: Array.isArray(data) ? data[0]?.id : data?.id }, env);
    } catch (e) {
      console.error('Subscribe error:', e);
      return serverErr(env, e.message);
    }
  }

  /* ── POST /api/notifications/unsubscribe ── */
  if (path === '/notifications/unsubscribe' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    if (!body.endpoint) {
      return badReq('endpoint required', 'MISSING_ENDPOINT', env);
    }

    try {
      await db.delete('push_subscriptions', {
        filters: { 'endpoint.eq': body.endpoint, 'user_id.eq': session.sub },
      });

      return ok({ message: 'Subscription removed' }, env);
    } catch (e) {
      console.error('Unsubscribe error:', e);
      return serverErr(env, e.message);
    }
  }

  return badReq('Not found', 'NOT_FOUND', env);
}
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

// ── Entry point ──
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve static files for non-API requests
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    try {
      const path = url.pathname.replace('/api', '');
      if (pathname.startsWith('/api/notifications/subscribe') || pathname.startsWith('/api/notifications/unsubscribe')) return handlePushNotifications(request, env, path);
      if (path.startsWith('/auth')) return await handleAuth(request, env, path);
      if (path.startsWith('/users')) return await handleUsers(request, env, path);
      if (path.startsWith('/assets')) return await handleAssets(request, env, path);
      if (path.startsWith('/certificates/upload') || path.startsWith('/certificates/file/')) {
      const uploadResult = await handleCertUpload(request, env, path);
      if (uploadResult) return uploadResult;
    }
    if (path.startsWith('/certificates')) return await handleCertificates(request, env, path);
      if (path.startsWith('/clients')) return await handleClients(request, env, path);
      if (path.startsWith('/inspectors')) return await handleInspectors(request, env, path);
      if (path.startsWith('/functional-locations')) return await handleFunctionalLocations(request, env, path);
      if (path.startsWith('/notifications')) return await handleNotifications(request, env, path);
      if (path.startsWith('/push')) return await handlePushNotifications(request, env, path);
      if (path.startsWith('/reports')) return await handleReports(request, env, path);

      return json({ success: false, error: 'Route not found' }, 404, env);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: 'Error: ' + (err?.message || String(err)), code: 'SERVER_ERROR' }, 500, env);
    }
  }
};
