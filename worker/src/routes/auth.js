// worker/src/routes/auth.js
// POST /api/auth/login   — username + password → JWT
// GET  /api/auth/me      — validate token, return user
// POST /api/auth/logout  — stateless, client drops token
// POST /api/auth/hash    — dev-only: hash a password (disable in prod)

import { createSupabase }          from '../lib/supabase.js';
import { verifyPassword, hashPassword } from '../lib/password.js';
import { signJwt, getSession }     from '../middleware/jwt.js';
import { ok, badReq, unauth, forbidden, serverErr } from '../utils/response.js';
import { validate }                from '../utils/validate.js';

export async function handleAuth(request, env, path) {
  const method = request.method;

  /* ── POST /api/auth/login ── */
  if (path === '/auth/login' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }

    const { valid, errors } = validate(body, {
      username: { required: true, type: 'string', minLength: 1 },
      password: { required: true, type: 'string', minLength: 1 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    const db = createSupabase(env);
    const { data: rows, error } = await db.from('users', {
      filters: { 'username.ilike': body.username.toLowerCase() },
      select:  'id,username,name,name_ar,role,customer_id,password_hash,is_active',
      limit:   1,
    });
    if (error) { console.error(error); return serverErr(env); }

    const user = Array.isArray(rows) ? rows[0] : rows;
    if (!user)           return unauth(env);
    if (!user.is_active) return forbidden(env);

    const ok2 = await verifyPassword(body.password, user.password_hash);
    if (!ok2) return unauth(env);

    // Update last_login_at (fire-and-forget)
    db.update('users', { last_login_at: new Date().toISOString() }, { filters: { 'id.eq': user.id }, select: 'id' }).catch(() => {});

    const expiresIn = parseInt(env.JWT_EXPIRES_SEC || '86400', 10);
    const token = await signJwt({
      sub:        user.id,
      username:   user.username,
      role:       user.role,
      name:       user.name,
      nameAr:     user.name_ar || '',
      customerId: user.customer_id || null,
    }, env.JWT_SECRET, expiresIn);

    return ok({
      token,
      expiresIn,
      user: {
        id:         user.id,
        username:   user.username,
        role:       user.role,
        name:       user.name,
        nameAr:     user.name_ar || '',
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
      select:  'id,username,name,name_ar,role,customer_id,is_active,created_at,last_login_at',
      limit:   1,
    });
    const user = Array.isArray(rows) ? rows[0] : rows;
    if (!user || !user.is_active) return unauth(env);

    return ok({
      id:          user.id,
      username:    user.username,
      role:        user.role,
      name:        user.name,
      nameAr:      user.name_ar || '',
      customerId:  user.customer_id || null,
      createdAt:   user.created_at,
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
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    if (!body.password) return badReq('password required','VALIDATION',env);
    const hash = await hashPassword(body.password);
    return ok({ hash }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
