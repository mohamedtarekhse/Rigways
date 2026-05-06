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
  const certSelect = 'id,name,cert_number,cert_type,expiry_date,uploaded_by,client_id,asset_id,created_at';

  const { data: approvedCertsRaw } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved' },
    select: certSelect,
    limit: 5000,
    order: 'expiry_date.desc',
  });
  const approvedCerts = Array.isArray(approvedCertsRaw) ? approvedCertsRaw : [];

  // ── Fetch expired certificates ───────────────────
  const { data: expiredCerts } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.lt': today },
    select: certSelect,
    limit: 500,
    order: 'expiry_date.asc',
  });
  let expired = Array.isArray(expiredCerts) ? expiredCerts : [];

  // ── Fetch certificates expiring within 7 days ────
  const { data: crit7 } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.gte': today, 'expiry_date.lte': in7d },
    select: certSelect,
    limit: 500,
  });
  let critical = Array.isArray(crit7) ? crit7 : [];

  // ── Fetch certificates expiring 8-30 days ────────
  const { data: warn30 } = await db.from('certificates', {
    filters: { 'approval_status.eq': 'approved', 'expiry_date.gt': in7d, 'expiry_date.lte': in30d },
    select: certSelect,
    limit: 500,
  });
  let warning = Array.isArray(warn30) ? warn30 : [];
  const candidates = [...expired, ...critical, ...warning];
  const { active, superseded } = await filterSupersededCertificates(db, candidates, approvedCerts, today);
  expired = active.filter(c => c.expiry_date < today);
  critical = active.filter(c => c.expiry_date >= today && c.expiry_date <= in7d);
  warning = active.filter(c => c.expiry_date > in7d && c.expiry_date <= in30d);
  await closeSupersededExpiryNotifications(db, superseded);

  let pushCount = 0;
  let notificationCount = 0;

  // ── Send push for expired certs ──────────────────
  if (expired.length > 0) {
    notificationCount += await createExpiryNotifications(db, expired, 'cert_expired', 'Certificate Expired',
      c => `"${c.name || c.cert_number}" expired on ${c.expiry_date}.`);
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
    notificationCount += await createExpiryNotifications(db, critical, 'cert_expiring_critical', 'Certificate Expiring Within 7 Days',
      c => `"${c.name || c.cert_number}" will expire on ${c.expiry_date}.`);
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
      notificationCount += await createExpiryNotifications(db, warning, 'cert_expiring_warning', 'Certificate Expiring Within 30 Days',
        c => `"${c.name || c.cert_number}" will expire on ${c.expiry_date}.`);
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

  return {
    checked: true,
    expired: expired.length,
    critical: critical.length,
    warning: warning.length,
    superseded: superseded.length,
    notificationsCreated: notificationCount,
    pushesSent: pushCount
  };
}

function datePlusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function renewalKey(cert) {
  return `${cert.asset_id || ''}::${String(cert.cert_type || '').trim().toUpperCase()}`;
}

async function filterSupersededCertificates(db, candidates, approvedCerts, today) {
  const latestByAssetType = new Map();
  for (const cert of approvedCerts) {
    if (!cert.asset_id || !cert.cert_type || !cert.expiry_date) continue;
    const key = renewalKey(cert);
    const current = latestByAssetType.get(key);
    if (!current || String(cert.expiry_date) > String(current.expiry_date)) {
      latestByAssetType.set(key, cert);
    }
  }

  const active = [];
  const superseded = [];
  for (const cert of candidates) {
    const replacement = latestByAssetType.get(renewalKey(cert));
    const isRenewed = replacement &&
      replacement.id !== cert.id &&
      String(replacement.expiry_date) > String(cert.expiry_date) &&
      String(replacement.expiry_date) >= today;
    if (isRenewed) {
      superseded.push({ oldCert: cert, newCert: replacement });
      await createRenewalNotification(db, cert, replacement);
    } else {
      active.push(cert);
    }
  }
  return { active, superseded };
}

async function closeSupersededExpiryNotifications(db, superseded) {
  const now = new Date().toISOString();
  for (const item of superseded) {
    await db.update('notifications', { is_read: true, read_at: now }, {
      filters: {
        'ref_id.eq': item.oldCert.id,
        'type.in': ['cert_expired', 'cert_expiring_critical', 'cert_expiring_warning'],
        'is_read.is': false,
      }
    }).catch(() => {});
  }
}

async function notificationRecipients(db, cert) {
  const recipients = new Set();
  const { data: users } = await db.from('users', {
    filters: { 'role.in': ['admin', 'manager'], 'is_active.is': true },
    select: 'id',
    limit: 500,
  });
  for (const user of Array.isArray(users) ? users : []) {
    if (user.id) recipients.add(user.id);
  }
  if (cert.uploaded_by) recipients.add(cert.uploaded_by);
  return [...recipients];
}

async function insertNotificationOnce(db, userId, type, title, body, refId) {
  if (!userId || !refId) return 0;
  const { data: existing } = await db.from('notifications', {
    filters: { 'user_id.eq': userId, 'type.eq': type, 'ref_id.eq': refId, 'is_read.is': false },
    select: 'id',
    limit: 1,
  });
  if (Array.isArray(existing) && existing.length) return 0;
  await db.insert('notifications', {
    user_id: userId,
    type,
    title,
    body,
    ref_type: 'certificate',
    ref_id: refId,
    is_read: false,
  }).catch(() => {});
  return 1;
}

async function createExpiryNotifications(db, certs, type, title, bodyForCert) {
  let count = 0;
  for (const cert of certs) {
    const recipients = await notificationRecipients(db, cert);
    for (const userId of recipients) {
      count += await insertNotificationOnce(db, userId, type, title, bodyForCert(cert), cert.id);
    }
  }
  return count;
}

async function createRenewalNotification(db, oldCert, newCert) {
  const title = 'Certificate Renewal Detected';
  const body = `"${oldCert.name || oldCert.cert_number}" was replaced by "${newCert.name || newCert.cert_number}" for the same asset and certificate type.`;
  const recipients = await notificationRecipients(db, oldCert);
  for (const userId of recipients) {
    await insertNotificationOnce(db, userId, 'cert_renewed', title, body, newCert.id);
  }
}
