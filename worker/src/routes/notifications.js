// worker/src/routes/notifications.js
import { createSupabase } from '../lib/supabase.js';
import { getSession }     from '../middleware/jwt.js';
import { ok, badReq, unauth, forbidden, notFound, serverErr } from '../utils/response.js';

export async function handleNotifications(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);

  if (path === '/notifications/unread-count' && method === 'GET') {
    const { count, error } = await db.count('notifications', { filters: { 'user_id.eq': session.sub, 'is_read.is': false } });
    if (error) return serverErr(env);
    return ok({ count }, env);
  }

  if (path === '/notifications/mark-all-read' && method === 'POST') {
    await db.update('notifications', { is_read: true, read_at: new Date().toISOString() }, { filters: { 'user_id.eq': session.sub, 'is_read.is': false } });
    return ok({ marked: true }, env);
  }

  const idM    = path.match(/^\/notifications\/([^/]+)$/);
  const notifId = idM?.[1];

  /* LIST */
  if (!notifId && method === 'GET') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = { 'user_id.eq': session.sub };
    if (url.searchParams.get('unread') === 'true') filters['is_read.is'] = false;
    const { data, error } = await db.from('notifications', { select:'*', filters, limit, offset, order:'created_at.desc' });
    if (error) return serverErr(env);
    return ok({ notifications: data || [], limit, offset }, env);
  }

  /* MARK READ */
  if (notifId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { data: ex } = await db.from('notifications', { filters: { 'id.eq': notifId }, select:'id,user_id', limit:1 });
    const notif = Array.isArray(ex) ? ex[0] : ex;
    if (!notif) return notFound('Notification', env);
    if (notif.user_id !== session.sub) return forbidden(env);
    const update = {};
    if (typeof body.is_read === 'boolean') { update.is_read = body.is_read; if (body.is_read) update.read_at = new Date().toISOString(); }
    if (!Object.keys(update).length) return badReq('No fields to update','VALIDATION',env);
    const { data } = await db.update('notifications', update, { filters: { 'id.eq': notifId } });
    return ok(Array.isArray(data) ? data[0] : data, env);
  }

  /* DELETE */
  if (notifId && method === 'DELETE') {
    const { data: ex } = await db.from('notifications', { filters: { 'id.eq': notifId }, select:'id,user_id', limit:1 });
    const notif = Array.isArray(ex) ? ex[0] : ex;
    if (!notif) return notFound('Notification', env);
    if (notif.user_id !== session.sub) return forbidden(env);
    await db.delete('notifications', { filters: { 'id.eq': notifId } });
    return ok({ id: notifId, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
