// worker/src/routes/functional-locations.js
import { createSupabase }          from '../lib/supabase.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact } from '../utils/validate.js';

const TYPES = ['Rig','Workshop','Yard','Warehouse','Other'];

export async function handleFunctionalLocations(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const idM    = path.match(/^\/functional-locations\/([^/]+)$/);
  const flId   = idM?.[1];
  const isAdmin = session.role === 'admin';
  const isManager = session.role === 'manager';

  /* READ scope:
     - admin/manager: all
     - user/technician: only their own customerId */
  if (!flId && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'),500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    if (url.searchParams.get('type'))   filters['type.eq']   = url.searchParams.get('type');
    if (!isAdmin && !isManager) {
      if (!session.customerId) return forbidden(env);
      filters['client_id.eq'] = session.customerId;
    }
    const { data, error } = await db.from('functional_locations', { select:'*', filters, limit, offset, order:'fl_id.asc' });
    if (error) return serverErr(env);
    return ok({ functional_locations: data || [], limit, offset }, env);
  }

  if (flId && method === 'GET') {
    const { data } = await db.from('functional_locations', { filters: { 'id.eq': flId }, select:'*', limit:1 });
    const fl = Array.isArray(data) ? data[0] : data;
    if (!fl) return notFound('Functional Location', env);
    if (!isAdmin && !isManager && session.customerId !== fl.client_id) return forbidden(env);
    return ok(fl, env);
  }

  /* Write operations: admin only */
  if (!isAdmin) return forbidden(env);

  if (!flId && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      fl_id: { required: true, type:'string', minLength:1, maxLength:20 },
      name:  { required: true, type:'string', minLength:1, maxLength:100 },
      type:  { required: true, type:'string', enum: TYPES },
      client_id: { required: true, type:'string', minLength:1, maxLength:20 },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    const { data: dup } = await db.from('functional_locations', { filters: { 'fl_id.ilike': body.fl_id }, select:'id', limit:1 });
    if (Array.isArray(dup) && dup.length) return conflict('Functional Location ID already exists', env);
    const { data, error } = await db.insert('functional_locations', {
      fl_id:     body.fl_id.toUpperCase(),
      name:      body.name,
      type:      body.type,
      status:    body.status    || 'active',
      client_id: body.client_id || null,
      notes:     body.notes     || null,
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (flId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const update = compact({ ...pick(body,['name','type','status','client_id','notes']), updated_at: new Date().toISOString() });
    const { data, error } = await db.update('functional_locations', update, { filters: { 'id.eq': flId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Functional Location', env);
    return ok(updated, env);
  }

  if (flId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('functional_locations', { filters: { 'id.eq': flId }, select:'id', limit:1 });
    if (!(Array.isArray(ex) ? ex[0] : ex)) return notFound('Functional Location', env);
    await db.delete('functional_locations', { filters: { 'id.eq': flId } });
    return ok({ id: flId, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
