// worker/src/routes/clients.js
import { createSupabase }          from '../lib/supabase.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact } from '../utils/validate.js';

const INDUSTRIES = ['Oil & Gas','Construction','Manufacturing','Real Estate','Healthcare','Finance','Transport','Other'];
const STATUSES   = ['active','inactive','suspended'];

export async function handleClients(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin'])) return forbidden(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const idM    = path.match(/^\/clients\/([^/]+)$/);
  const cid    = idM?.[1];

  if (!cid && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    const { data, error } = await db.from('clients', { select:'*', filters, limit, offset, order:'name.asc' });
    if (error) return serverErr(env);
    return ok({ clients: data || [], limit, offset }, env);
  }

  if (cid && method === 'GET') {
    const { data } = await db.from('clients', { filters: { 'id.eq': cid }, select:'*', limit:1 });
    const client = Array.isArray(data) ? data[0] : data;
    if (!client) return notFound('Client', env);
    return ok(client, env);
  }

  if (!cid && method === 'POST') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      client_id: { required: true,  type:'string', minLength:2, maxLength:20, pattern:/^[A-Z0-9-]+$/ },
      name:      { required: true,  type:'string', minLength:2, maxLength:150 },
      industry:  { required: false, type:'string', enum: INDUSTRIES },
      status:    { required: false, type:'string', enum: STATUSES },
      email:     { required: false, type:'string', email: true },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    const { data: dup } = await db.from('clients', { filters: { 'client_id.eq': body.client_id.toUpperCase() }, select:'id', limit:1 });
    if (Array.isArray(dup) && dup.length) return conflict('Client ID already exists', env);
    const { data, error } = await db.insert('clients', {
      client_id:      body.client_id.toUpperCase(),
      name:           body.name,
      name_ar:        body.name_ar        || null,
      industry:       body.industry       || null,
      contact:        body.contact        || null,
      email:          body.email          || null,
      phone:          body.phone          || null,
      country:        body.country        || null,
      city:           body.city           || null,
      status:         body.status         || 'active',
      contract_start: body.contract_start || null,
      contract_end:   body.contract_end   || null,
      notes:          body.notes          || null,
      color:          body.color          || '#0070f2',
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (cid && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const update = compact({ ...pick(body,['name','name_ar','industry','contact','email','phone','country','city','status','contract_start','contract_end','notes','color']), updated_at: new Date().toISOString() });
    const { data, error } = await db.update('clients', update, { filters: { 'id.eq': cid } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Client', env);
    return ok(updated, env);
  }

  if (cid && method === 'DELETE') {
    // Soft delete
    const { data, error } = await db.update('clients', { status:'inactive', updated_at: new Date().toISOString() }, { filters: { 'id.eq': cid } });
    if (error) return serverErr(env);
    return ok({ id: cid, status:'inactive' }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
