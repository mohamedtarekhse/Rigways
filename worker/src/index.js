// worker/src/index.js — Cloudflare Worker entry point

import { handleAuth }               from './routes/auth.js';
import { handleUsers }              from './routes/users.js';
import { handleAssets }             from './routes/assets.js';
import { handleCertificates }       from './routes/certificates.js';
import { handleClients }            from './routes/clients.js';
import { handleInspectors }         from './routes/inspectors.js';
import { handleFunctionalLocations }from './routes/functional-locations.js';
import { handleNotifications }      from './routes/notifications.js';
import { handleReports }            from './routes/reports.js';
import { handlePush }               from './routes/push.js';
import { handleCheckExpiry }        from './routes/check-expiry.js';
import { handleJobs }               from './routes/jobs.js';
import { handleOptions, json }      from './utils/response.js';
import { getSession, requireRole }  from './middleware/jwt.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    // Only handle /api/* — everything else is static files served by Pages
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const path = url.pathname.replace('/api', '');

      if (path.startsWith('/auth'))                 return await handleAuth(request, env, path);
      if (path.startsWith('/users'))                return await handleUsers(request, env, path);
      if (path.startsWith('/assets'))               return await handleAssets(request, env, path);
      if (path.startsWith('/certificates'))         return await handleCertificates(request, env, path);
      if (path.startsWith('/clients'))              return await handleClients(request, env, path);
      if (path.startsWith('/inspectors'))           return await handleInspectors(request, env, path);
      if (path.startsWith('/functional-locations')) return await handleFunctionalLocations(request, env, path);
      if (path.startsWith('/notifications'))        return await handleNotifications(request, env, path);
      if (path.startsWith('/reports'))              return await handleReports(request, env, path);
      if (path.startsWith('/push'))                 return await handlePush(request, env, path);
      if (path.startsWith('/jobs'))                 return await handleJobs(request, env, path);

      // Cron check-expiry (admin-only manual trigger)
      if (path === '/cron/check-expiry' && request.method === 'GET') {
        const session = await getSession(request, env);
        if (!session || !requireRole(session, ['admin'])) return json({ success: false, error: 'Forbidden' }, 403, env);
        const result = await handleCheckExpiry(env);
        return json({ success: true, data: result }, 200, env);
      }

      return json({ success: false, error: 'Route not found' }, 404, env);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: 'Internal server error' }, 500, env);
    }
  },

  // Cloudflare Cron Trigger handler
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCheckExpiry(env));
  },
};
