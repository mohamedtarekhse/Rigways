// worker/src/routes/reports.js
import { createSupabase }          from '../lib/supabase.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, unauth, serverErr }   from '../utils/response.js';

export async function handleReports(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const db = createSupabase(env);
  const clientFilter = (['user','technician'].includes(session.role) && session.customerId)
    ? { 'client_id.eq': session.customerId } : {};

  /* ── GET /api/reports/summary ── */
  if (path === '/reports/summary') {
    const today = new Date().toISOString().split('T')[0];
    const soon  = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

    const [
      totalAssets, activeAssets, maintenanceAssets,
      totalCerts, validCerts, expiringSoon, expiredCerts, pendingCerts,
      totalClients, activeClients,
      totalInspectors,
    ] = await Promise.all([
      db.count('assets', { filters: { ...clientFilter } }),
      db.count('assets', { filters: { ...clientFilter, 'status.eq':'active' } }),
      db.count('assets', { filters: { ...clientFilter, 'status.eq':'maintenance' } }),
      db.count('certificates', { filters: { ...clientFilter } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq':'approved', 'expiry_date.gt': soon } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq':'approved', 'expiry_date.gte': today, 'expiry_date.lte': soon } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq':'approved', 'expiry_date.lt': today } }),
      db.count('certificates', { filters: { ...clientFilter, 'approval_status.eq':'pending' } }),
      db.count('clients',      {}),
      db.count('clients',      { filters: { 'status.eq':'active' } }),
      db.count('inspectors',   {}),
    ]);

    return ok({
      assets: {
        total:       totalAssets.count,
        active:      activeAssets.count,
        maintenance: maintenanceAssets.count,
        inactive:    totalAssets.count - activeAssets.count - maintenanceAssets.count,
      },
      certificates: {
        total:    totalCerts.count,
        valid:    validCerts.count,
        expiring: expiringSoon.count,
        expired:  expiredCerts.count,
        pending:  pendingCerts.count,
      },
      clients:    { total: totalClients.count,    active: activeClients.count },
      inspectors: { total: totalInspectors.count },
    }, env);
  }

  /* ── GET /api/reports/expiring?days=30 ── */
  if (path === '/reports/expiring') {
    const url   = new URL(request.url);
    const days  = parseInt(url.searchParams.get('days') || '30');
    const today = new Date().toISOString().split('T')[0];
    const cutoff= new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0];
    const { data, error } = await db.from('certificates', {
      select:  '*',
      filters: { ...clientFilter, 'approval_status.eq':'approved', 'expiry_date.gte': today, 'expiry_date.lte': cutoff },
      order:   'expiry_date.asc',
      limit:   200,
    });
    if (error) return serverErr(env);
    return ok({ certificates: data || [], days }, env);
  }

  return ok({}, env);
}
