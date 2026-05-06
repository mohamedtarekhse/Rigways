// worker/src/routes/users.js
import { createSupabase }          from '../lib/supabase.js';
import { hashPassword }            from '../lib/password.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact } from '../utils/validate.js';

const SAFE = 'id,username,name,name_ar,role,customer_id,functional_location,is_active,created_at,last_login_at';

async function validateFunctionalLocation(db, functionalLocation, customerId) {
  const fl = String(functionalLocation || '').trim().toUpperCase();
  if (!fl) return { ok: true, value: null };

  const { data } = await db.from('functional_locations', {
    filters: { 'fl_id.eq': fl },
    select: 'id,fl_id,client_id,status',
    limit: 1,
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

export async function handleUsers(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const idM    = path.match(/^\/users\/([^/]+)$/);
  const uid    = idM?.[1];

  /* LIST */
  if (!uid && method === 'GET') {
    if (!requireRole(session, ['admin','manager'])) return forbidden(env);
    const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('role'))   filters['role.eq']      = url.searchParams.get('role');
    if (url.searchParams.get('active')) filters['is_active.is'] = url.searchParams.get('active') === 'true';
    const { data: users, error } = await db.from('users', { select: SAFE, filters, limit, offset, order: 'created_at.desc' });
    if (error) return serverErr(env);
    
    // Fetch functional location names for enrichment
    const flCodes = [...new Set((users || []).map(u => u.functional_location).filter(Boolean))];
    let flNameMap = {};
    if (flCodes.length > 0) {
      const { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.in': flCodes },
        select: 'fl_id,name',
      });
      flNameMap = (flRows || []).reduce((acc, row) => {
        acc[row.fl_id] = row.name || '';
        return acc;
      }, {});
    }
    
    // Enrich users with functional location names
    const enrichedUsers = (users || []).map(user => ({
      ...user,
      functional_location_name: flNameMap[user.functional_location] || '',
    }));
    
    return ok({ users: enrichedUsers, limit, offset }, env);
  }

  /* GET ONE */
  if (uid && method === 'GET') {
    if (session.sub !== uid && !requireRole(session, ['admin','manager'])) return forbidden(env);
    const { data } = await db.from('users', { filters: { 'id.eq': uid }, select: SAFE, limit: 1 });
    const user = Array.isArray(data) ? data[0] : data;
    if (!user) return notFound('User', env);
    return ok(user, env);
  }

  /* CREATE */
  if (!uid && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      username:    { required: true,  type: 'string', minLength: 2, maxLength: 50 },
      password:    { required: true,  type: 'string', minLength: 8 },
      name:        { required: true,  type: 'string', minLength: 2, maxLength: 100 },
      role:        { required: true,  type: 'string', enum: ['user','technician','manager','admin'] },
      customer_id: { required: false, type: 'string' },
      functional_location: { required: false, type: 'string' },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    const flCheck = await validateFunctionalLocation(db, body.functional_location, body.customer_id);
    if (!flCheck.ok) return badReq(flCheck.error, 'VALIDATION', env);
    const { data: dup } = await db.from('users', { filters: { 'username.ilike': body.username }, select: 'id', limit: 1 });
    if (Array.isArray(dup) && dup.length) return conflict('Username already exists', env);
    const { data, error } = await db.insert('users', {
      username:      body.username.toLowerCase(),
      name:          body.name,
      name_ar:       body.name_ar || null,
      role:          body.role,
      customer_id:   body.customer_id || null,
      functional_location: flCheck.value,
      password_hash: await hashPassword(body.password),
      is_active:     true,
    });
    if (error) return serverErr(env);
    const u = Array.isArray(data) ? data[0] : data;
    delete u.password_hash;
    return created(u, env);
  }

  /* UPDATE */
  if (uid && method === 'PATCH') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { data: existingRows } = await db.from('users', { filters: { 'id.eq': uid }, select: 'id,customer_id,functional_location', limit: 1 });
    const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
    if (!existing) return notFound('User', env);
    const update = compact(pick(body, ['name','name_ar','role','customer_id','functional_location','is_active']));
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
    if (session.sub === uid) return badReq('Cannot disable your own account','SELF_DISABLE',env);
    await db.update('users', { is_active: false, updated_at: new Date().toISOString() }, { filters: { 'id.eq': uid } });
    return ok({ id: uid, is_active: false }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
