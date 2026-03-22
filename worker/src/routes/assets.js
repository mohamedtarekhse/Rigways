// worker/src/routes/assets.js
import { createSupabase }                    from '../lib/supabase.js';
import { getSession, requireRole }           from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact }           from '../utils/validate.js';

const TYPES    = ['Equipment','Vehicle','Facility','Tool','IT','Other'];
const STATUSES = ['active','inactive','maintenance','decommissioned'];

export async function handleAssets(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);

  /* ── GET /api/assets/stats — dashboard KPIs ── */
  if (path === '/assets/stats' && method === 'GET') {
    const filters = {};
    if (['user','technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;

    const [total, active, maintenance, inactive] = await Promise.all([
      db.count('assets', { filters }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'active' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'maintenance' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'inactive' } }),
    ]);
    return ok({ total: total.count, active: active.count, maintenance: maintenance.count, inactive: inactive.count }, env);
  }

  const idM  = path.match(/^\/assets\/([^/]+)$/);
  const asId = idM?.[1];

  /* LIST */
  if (!asId && method === 'GET') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (['user','technician'].includes(session.role) && session.customerId)
      filters['client_id.eq'] = session.customerId;
    if (url.searchParams.get('status'))    filters['status.eq']    = url.searchParams.get('status');
    if (url.searchParams.get('type'))      filters['asset_type.eq']= url.searchParams.get('type');
    if (url.searchParams.get('client_id') && requireRole(session,['admin','manager']))
      filters['client_id.eq'] = url.searchParams.get('client_id');
    const { data, error } = await db.from('assets', { select:'*', filters, limit, offset, order:'created_at.desc' });
    if (error) return serverErr(env);
    return ok({ assets: data || [], limit, offset }, env);
  }

  /* GET ONE */
  if (asId && method === 'GET') {
    const { data } = await db.from('assets', { filters: { 'id.eq': asId }, select:'*', limit: 1 });
    const asset = Array.isArray(data) ? data[0] : data;
    if (!asset) return notFound('Asset', env);
    if (['user','technician'].includes(session.role) && session.customerId && asset.client_id !== session.customerId)
      return forbidden(env);
    return ok(asset, env);
  }

  /* CREATE */
  if (!asId && method === 'POST') {
    if (!requireRole(session, ['admin','manager'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      asset_number: { required: true,  type: 'string', minLength: 1, maxLength: 50 },
      name:         { required: true,  type: 'string', minLength: 2, maxLength: 200 },
      asset_type:   { required: true,  type: 'string', enum: TYPES },
      status:       { required: false, type: 'string', enum: STATUSES },
      client_id:    { required: false, type: 'string' },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    const { data, error } = await db.insert('assets', {
      asset_number:        body.asset_number,
      name:                body.name,
      asset_type:          body.asset_type,
      status:              body.status || 'active',
      client_id:           body.client_id || null,
      functional_location: body.functional_location || null,
      serial_number:       body.serial_number || null,
      manufacturer:        body.manufacturer || null,
      model:               body.model || null,
      description:         body.description || null,
      created_by:          session.sub,
    });
    if (error) {
      if (error.code === '23505') return conflict('Asset number already exists', env);
      return serverErr(env);
    }
    const asset = Array.isArray(data) ? data[0] : data;
    await audit(db, session, 'assets', asset.id, 'create', null, asset);
    return created(asset, env);
  }

  /* UPDATE */
  if (asId && method === 'PATCH') {
    if (!requireRole(session, ['admin','manager','technician'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }

    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select:'*', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);

    if (session.role === 'technician') {
      if (session.customerId && existing.client_id !== session.customerId) return forbidden(env);
      body = pick(body, ['status','notes']); // technicians can only update these
    }
    const { valid, errors } = validate(body, {
      name:         { type:'string', minLength:2, maxLength:200 },
      asset_type:   { type:'string', enum: TYPES },
      status:       { type:'string', enum: STATUSES },
      client_id:    { type:'string' },
      notes:        { type:'string', maxLength:2000 },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);

    const update = compact({ ...pick(body,['name','asset_type','status','client_id','functional_location','serial_number','manufacturer','model','description','notes']), updated_by: session.sub, updated_at: new Date().toISOString() });
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
    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select:'id,asset_number,name', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);
    await audit(db, session, 'assets', asId, 'delete', existing, null);
    await db.delete('assets', { filters: { 'id.eq': asId } });
    return ok({ id: asId, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}

async function audit(db, session, table, id, action, before, after) {
  try {
    await db.insert('audit_logs', {
      user_id: session.sub, username: session.username, role: session.role,
      table_name: table, record_id: id, action,
      before: before ? JSON.stringify(before) : null,
      after:  after  ? JSON.stringify(after)  : null,
    });
  } catch(e) { console.warn('Audit failed:', e); }
}
