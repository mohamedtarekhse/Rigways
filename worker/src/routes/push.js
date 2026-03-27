// worker/src/routes/push.js
import { createSupabase } from '../lib/supabase.js';
import { getSession }     from '../middleware/jwt.js';
import { ok, created, badReq, unauth, serverErr } from '../utils/response.js';
import { sendPushToRoles } from '../lib/web-push.js';

export async function handlePush(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);

  /* ── POST /api/push/subscribe ── */
  if (path === '/push/subscribe' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { endpoint, keys } = body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return badReq('Missing subscription fields (endpoint, keys.p256dh, keys.auth)', 'VALIDATION', env);
    }

    // Upsert — if same user+endpoint exists, update keys
    const { data: existing } = await db.from('push_subscriptions', {
      filters: { 'user_id.eq': session.sub, 'endpoint.eq': endpoint },
      select: 'id',
      limit: 1,
    });
    const existingRow = Array.isArray(existing) ? existing[0] : existing;

    if (existingRow) {
      await db.update('push_subscriptions', {
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: request.headers.get('User-Agent') || null,
      }, { filters: { 'id.eq': existingRow.id } });
      return ok({ subscribed: true, updated: true }, env);
    }

    const { error } = await db.insert('push_subscriptions', {
      user_id: session.sub,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: request.headers.get('User-Agent') || null,
    });
    if (error) return serverErr(env);
    return created({ subscribed: true }, env);
  }

  /* ── DELETE /api/push/unsubscribe ── */
  if (path === '/push/unsubscribe' && method === 'DELETE') {
    let body;
    try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { endpoint } = body || {};
    if (!endpoint) return badReq('Missing endpoint', 'VALIDATION', env);

    await db.delete('push_subscriptions', {
      filters: { 'user_id.eq': session.sub, 'endpoint.eq': endpoint },
    });
    return ok({ unsubscribed: true }, env);
  }

  /* ── GET /api/push/status ── */
  if (path === '/push/status' && method === 'GET') {
    const { count } = await db.count('push_subscriptions', {
      filters: { 'user_id.eq': session.sub },
    });
    return ok({ subscribed: (count || 0) > 0, count: count || 0 }, env);
  }

  /* ── GET /api/push/vapid-key ── public key needed by frontend to subscribe */
  if (path === '/push/vapid-key' && method === 'GET') {
    return ok({ publicKey: env.VAPID_PUBLIC_KEY || '' }, env);
  }

  /* ── POST /api/push/batch-notify ── called by frontend after batch cert upload */
  if (path === '/push/batch-notify' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const count = parseInt(body.count) || 0;
    const message = body.message || `${count} certificate${count !== 1 ? 's' : ''} have been uploaded.`;

    if (count < 1) return badReq('Count must be at least 1', 'VALIDATION', env);

    const payload = {
      title: 'Certificates Uploaded',
      body: message,
      url: '/certificates.html',
      tag: 'batch-cert-upload',
    };

    // Notify the uploader
    const { sendPushToUser } = await import('../lib/web-push.js');
    await sendPushToUser(db, env, session.sub, payload);

    // Notify admins and managers (excluding the uploader)
    await sendPushToRoles(db, env, ['admin', 'manager'], payload, session.sub);

    return ok({ notified: true, count }, env);
  }

  return badReq('Not found', 'NOT_FOUND', env);
}
