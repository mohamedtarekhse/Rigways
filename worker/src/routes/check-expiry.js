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

  // ── Fetch all approved and pending certificates to apply suppression logic ──
  const { data: allCerts } = await db.from('certificates', {
    filters: { 'approval_status.in': ['approved', 'pending'] },
    select: 'id,name,cert_number,expiry_date,uploaded_by,client_id,asset_id,cert_type,lifting_subtype,approval_status',
    limit: 5000,
  });
  const certs = Array.isArray(allCerts) ? allCerts : [];

  // Group by (asset_id, base_type, sub_type)
  const certGroups = new Map();
  certs.forEach(cert => {
    if (!cert.asset_id) return;
    const rawType = String(cert.cert_type || '');
    const baseType = rawType.split(' — ')[0] || rawType;
    const subType = cert.lifting_subtype || '';
    const groupKey = `${cert.asset_id}|${baseType}|${subType}`;

    if (!certGroups.has(groupKey)) {
      certGroups.set(groupKey, { latestApproved: null, hasPending: false });
    }
    const group = certGroups.get(groupKey);

    if (cert.approval_status === 'pending') {
      group.hasPending = true;
    } else if (cert.approval_status === 'approved' && cert.expiry_date) {
      if (!group.latestApproved || new Date(cert.expiry_date) > new Date(group.latestApproved.expiry_date)) {
        group.latestApproved = cert;
      }
    }
  });

  const expired = [];
  const critical = [];
  const warning = [];

  certGroups.forEach(group => {
    // If a renewal is pending, suppress all alerts for this asset/type
    if (group.hasPending || !group.latestApproved) return;

    const cert = group.latestApproved;
    const expiryDate = cert.expiry_date;
    
    if (expiryDate < today) {
      expired.push(cert);
    } else if (expiryDate <= in7d) {
      critical.push(cert);
    } else if (expiryDate <= in30d) {
      warning.push(cert);
    }
  });

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
