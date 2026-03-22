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
import { handleOptions, json }      from './utils/response.js';

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

      return json({ success: false, error: 'Route not found' }, 404, env);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: 'Internal server error' }, 500, env);
    }
  },
};
