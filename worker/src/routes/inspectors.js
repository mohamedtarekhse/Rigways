// worker/src/routes/inspectors.js
import { createSupabase }          from '../lib/supabase.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact } from '../utils/validate.js';

export async function handleInspectors(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin','manager'])) return forbidden(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const idM    = path.match(/^\/inspectors\/([^/]+)$/);
  const iid    = idM?.[1];

  if (!iid && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    const { data, error } = await db.from('inspectors', { select:'*', filters, limit, offset, order:'inspector_number.asc' });
    if (error) return serverErr(env);
    return ok({ inspectors: data || [], limit, offset }, env);
  }

  if (iid && method === 'GET') {
    const { data } = await db.from('inspectors', { filters: { 'id.eq': iid }, select:'*', limit:1 });
    const insp = Array.isArray(data) ? data[0] : data;
    if (!insp) return notFound('Inspector', env);
    return ok(insp, env);
  }

  if (!iid && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      name:  { required: true,  type:'string', minLength:2, maxLength:150 },
      email: { required: false, type:'string', email: true },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    if (body.email) {
      const { data: dup } = await db.from('inspectors', { filters: { 'email.ilike': body.email }, select:'id', limit:1 });
      if (Array.isArray(dup) && dup.length) return conflict('Email already in use', env);
    }
    const { data, error } = await db.insert('inspectors', {
      name:             body.name,
      title:            body.title            || null,
      email:            body.email            || null,
      phone:            body.phone            || null,
      status:           body.status           || 'active',
      experience_years: body.experience_years || null,
      experience_desc:  body.experience_desc  || null,
      cv_file:          body.cv_file          || null,
      cv_url:           body.cv_url           || null,
      color:            body.color            || '#0070f2',
      education:        JSON.stringify(Array.isArray(body.education)      ? body.education      : []),
      trainings:        JSON.stringify(Array.isArray(body.trainings)      ? body.trainings      : []),
      training_certs:   JSON.stringify(Array.isArray(body.training_certs) ? body.training_certs : []),
    });
    if (error) return serverErr(env);
    return created(Array.isArray(data) ? data[0] : data, env);
  }

  if (iid && method === 'PATCH') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const update = compact({ ...pick(body,['name','title','email','phone','status','experience_years','experience_desc','cv_file','cv_url','color']), updated_at: new Date().toISOString() });
    if (Array.isArray(body.education))      update.education      = JSON.stringify(body.education);
    if (Array.isArray(body.trainings))      update.trainings      = JSON.stringify(body.trainings);
    if (Array.isArray(body.training_certs)) update.training_certs = JSON.stringify(body.training_certs);
    const { data, error } = await db.update('inspectors', update, { filters: { 'id.eq': iid } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Inspector', env);
    return ok(updated, env);
  }

  if (iid && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('inspectors', { filters: { 'id.eq': iid }, select:'id', limit:1 });
    if (!(Array.isArray(ex) ? ex[0] : ex)) return notFound('Inspector', env);
    await db.delete('inspectors', { filters: { 'id.eq': iid } });
    return ok({ id: iid, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
