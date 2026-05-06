// worker/src/routes/check-expiry.js
// Cron handler: check for expiring/expired certificates and send push notifications
import { createSupabase }  from '../lib/supabase.js';
import { sendPushToUser, sendPushToRoles } from '../lib/web-push.js';

/**
 * Called by Cloudflare Cron Trigger (scheduled event) or manually via
 * GET /api/cron/check-expiry (admin-only).
 */
export async function handleCheckExpiry(env) {
  const db = createSupabase(env);

  const today  = new Date().toISOString().split('T')[0];
  const in7d   = datePlusDays(7);
  const in14d  = datePlusDays(14);
  const in30d  = datePlusDays(30);

  // ── Fetch expired certificates ───────────────────
  const { data: expiredCerts } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.lt': today },
    select: 'id,name,cert_number,expiry_date,uploaded_by,client_id',
    limit: 500,
    order: 'expiry_date.asc',
  });
  const expired = Array.isArray(expiredCerts) ? expiredCerts : [];

  // ── Fetch certificates expiring within 7 days ────
  const { data: crit7 } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': in7d },
    select: 'id,name,cert_number,expiry_date,uploaded_by,client_id',
    limit: 500,
  });
  const critical = Array.isArray(crit7) ? crit7 : [];

  // ── Fetch certificates expiring 8-30 days ────────
  const { data: warn30 } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.gt': in7d, 'expiry_date.lte': in30d },
    select: 'id,name,cert_number,expiry_date,uploaded_by,client_id',
    limit: 500,
  });
  const warning = Array.isArray(warn30) ? warn30 : [];

  let pushCount = 0;

  // ── Send push for expired certs ──────────────────
  if (expired.length > 0) {
    const payload = {
      title: `⚠️ ${expired.length} Certificate${expired.length !== 1 ? 's' : ''} Expired`,
      body: expired.length <= 3
        ? expired.map(c => c.name || c.cert_number).join(', ')
        : `${expired.slice(0, 2).map(c => c.name || c.cert_number).join(', ')} and ${expired.length - 2} more`,
      url: '/notifications.html',
      tag: 'cert-expired',
    };
    await sendPushToRoles(db, env, ['admin', 'manager'], payload);
    pushCount++;

    // Also notify uploaders
    const uploaderIds = [...new Set(expired.map(c => c.uploaded_by).filter(Boolean))];
    for (const uid of uploaderIds) {
      const userCerts = expired.filter(c => c.uploaded_by === uid);
      await sendPushToUser(db, env, uid, {
        title: `⚠️ ${userCerts.length} of your certificate${userCerts.length !== 1 ? 's' : ''} expired`,
        body: userCerts.map(c => c.name || c.cert_number).join(', '),
        url: '/certificates.html',
        tag: 'cert-expired-user',
      });
      pushCount++;
    }
  }

  // ── Send push for critical (≤7 days) ─────────────
  if (critical.length > 0) {
    const payload = {
      title: `🔴 ${critical.length} Certificate${critical.length !== 1 ? 's' : ''} Expiring Within 7 Days`,
      body: critical.length <= 3
        ? critical.map(c => `${c.name || c.cert_number} (${c.expiry_date})`).join(', ')
        : `${critical.slice(0, 2).map(c => c.name || c.cert_number).join(', ')} and ${critical.length - 2} more`,
      url: '/notifications.html',
      tag: 'cert-expiring-critical',
    };
    await sendPushToRoles(db, env, ['admin', 'manager'], payload);
    pushCount++;

    // Also notify uploaders of critical expiry
    const uploaderIds = [...new Set(critical.map(c => c.uploaded_by).filter(Boolean))];
    for (const uid of uploaderIds) {
      const userCerts = critical.filter(c => c.uploaded_by === uid);
      await sendPushToUser(db, env, uid, {
        title: `🔴 ${userCerts.length} of your certificate${userCerts.length !== 1 ? 's' : ''} expiring in ≤7 days`,
        body: userCerts.map(c => `${c.name || c.cert_number} (${c.expiry_date})`).join(', '),
        url: '/certificates.html',
        tag: 'cert-critical-user',
      });
      pushCount++;
    }
  }

  // ── Send push for warning (8-30 days) — only on Monday ──
  if (warning.length > 0) {
    const dayOfWeek = new Date().getUTCDay(); // 0=Sun
    if (dayOfWeek === 1) { // Monday only
      const payload = {
        title: `🟡 ${warning.length} Certificate${warning.length !== 1 ? 's' : ''} Expiring Within 30 Days`,
        body: `${warning.length} certificates due for renewal. Check the notifications page.`,
        url: '/notifications.html',
        tag: 'cert-expiring-warning',
      };
      await sendPushToRoles(db, env, ['admin', 'manager'], payload);
      pushCount++;

      // Also notify uploaders of weekly warning
      const uploaderIds = [...new Set(warning.map(c => c.uploaded_by).filter(Boolean))];
      for (const uid of uploaderIds) {
        const userCerts = warning.filter(c => c.uploaded_by === uid);
        await sendPushToUser(db, env, uid, {
          title: `🟡 ${userCerts.length} of your certificate${userCerts.length !== 1 ? 's' : ''} expiring soon (≤30 days)`,
          body: `${userCerts.length} certificates due soon: ${userCerts.slice(0, 2).map(c => c.name || c.cert_number).join(', ')}...`,
          url: '/certificates.html',
          tag: 'cert-warning-user',
        });
        pushCount++;
      }
    }
  }

  return { checked: true, expired: expired.length, critical: critical.length, warning: warning.length, pushesSent: pushCount };
}

function datePlusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}
