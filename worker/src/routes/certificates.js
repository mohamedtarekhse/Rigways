// worker/src/routes/certificates.js
import { createSupabase }                    from '../lib/supabase.js';
import { getSession, requireRole }           from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, serverErr } from '../utils/response.js';
import { validate, pick, compact }           from '../utils/validate.js';
import { sendPushToUser, sendPushToRoles }   from '../lib/web-push.js';
import { isStorageConfigured, putStorageObject } from '../lib/storage.js';
import { buildFunctionalLocationAliases }    from '../lib/functional-location.js';

const TYPES    = ['CAT III','CAT IV','ORIGINAL COC','LOAD TEST','LIFTING','NDT','TUBULAR'];
const STATUSES = ['pending','approved','rejected'];

export async function handleCertificates(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const url    = new URL(request.url);

  if (path === '/certificates/upload' && method === 'POST') {
    if (!requireRole(session, ['admin','manager','technician'])) return forbidden(env);
    if (!isStorageConfigured(env)) {
      return badReq('Certificate storage is not configured. Configure CERT_BUCKET or Backblaze B2 before uploading files.', 'NO_BUCKET', env);
    }

    let formData;
    try { formData = await request.formData(); }
    catch { return badReq('Could not parse form data', 'BAD_FORM', env); }

    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided', 'NO_FILE', env);

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return badReq('Invalid file type. Allowed: PDF, JPG, PNG, WEBP', 'INVALID_TYPE', env);
    }
    if (file.size > 200 * 1024 * 1024) {
      return badReq('File too large. Maximum size is 200MB', 'FILE_TOO_LARGE', env);
    }

    const clientId = String(formData.get('client_id') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const jobNumber = String(formData.get('job_number') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const certNumber = String(formData.get('cert_number') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const ext = String(file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';

    if (!clientId || !jobNumber || !certNumber) {
      return badReq('client_id, job_number and cert_number are required for structured upload', 'MISSING_FIELDS', env);
    }

    const safeOriginal = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'certificate';
    const safeJobNumber = jobNumber.replace(/[^a-z0-9-]/gi, '-');
    const safeCertNumber = certNumber.replace(/[^a-z0-9-]/gi, '-');
    const baseKey = `clients/${clientId}/jobs/${safeJobNumber}/${safeJobNumber}_${safeCertNumber}_${safeOriginal}.${ext}`;

    let finalKey;
    try {
      finalKey = await putStorageObject(env, baseKey, await file.arrayBuffer(), file.type, {
        originalName: file.name,
        uploadedBy: session.sub,
        username: session.username,
        certNumber,
        jobNumber,
        clientId,
      });
    } catch (e) {
      console.error('Certificate upload failed:', e);
      return badReq(`File upload failed: ${e.message || 'Storage rejected the file'}`, 'UPLOAD_FAILED', env);
    }

    return ok({
      key: finalKey,
      file_name: `${jobNumber}_${certNumber}_${safeOriginal}.${ext}`,
      file_url: finalKey,
    }, env);
  }

  const db     = createSupabase(env);
  async function clientAliases(rawClientId) {
    const key = String(rawClientId || '').trim();
    if (!key) return [];
    const out = new Set([key]);
    const queries = [{ 'id.eq': key }, { 'client_id.eq': key }];
    for (const filters of queries) {
      const { data } = await db.from('clients', { filters, select:'id,client_id', limit:1 });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.id) out.add(String(row.id));
      if (row?.client_id) out.add(String(row.client_id));
    }
    return Array.from(out);
  }

  async function functionalLocationAliases(rawLocation, rawClientId) {
    const key = String(rawLocation || '').trim();
    if (!key) return [];
    const filtersToTry = [
      { 'fl_id.eq': key },
      { 'name.eq': key },
      { 'id.eq': key },
    ];
    const clients = await clientAliases(rawClientId);
    for (const clientId of clients) {
      if (!clientId) continue;
      filtersToTry.push({ 'fl_id.eq': key, 'client_id.eq': clientId });
      filtersToTry.push({ 'name.eq': key, 'client_id.eq': clientId });
    }
    const rows = [];
    for (const filters of filtersToTry) {
      const { data } = await db.from('functional_locations', {
        filters,
        select:'id,fl_id,name,client_id',
        limit:10,
      });
      for (const row of Array.isArray(data) ? data : []) rows.push(row);
    }
    return buildFunctionalLocationAliases(key, rows);
  }

  if (path === '/certificates/history/export' && method === 'GET') {
    if (!requireRole(session, ['admin','manager','technician'])) return forbidden(env);
    const filters = {};
    if (['user','technician'].includes(session.role)) {
      if (session.customerId) filters['client_id.eq'] = session.customerId;
      // Only filter by functional_location if it exists and is not null
      if (session.functional_location) filters['functional_location.eq'] = session.functional_location;
    }
    const { data, error } = await db.from('certificate_history', { select:'*', filters, order:'changed_at.desc', limit:2000 });
    if (error) return serverErr(env);
    const withNames = await _withUserNames(db, Array.isArray(data) ? data : [], 'changed_by');
    return ok({ history: withNames }, env);
  }

  /* ── GET /api/certificates/expiring?days=30 — dashboard widget ── */
  if (path === '/certificates/expiring' && method === 'GET') {
    const days   = parseInt(url.searchParams.get('days') || '30');
    const today  = new Date().toISOString().split('T')[0];
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0];
    const filters = { 'approval_status.eq':'approved', 'expiry_date.gte': today, 'expiry_date.lte': cutoff };
    if (['user','technician'].includes(session.role)) {
      if (session.customerId) filters['client_id.eq'] = session.customerId;
      // Only filter by functional_location if it exists and is not null
      if (session.functional_location) filters['functional_location.eq'] = session.functional_location;
    }
    const { data, error } = await db.from('certificates', { select:'*', filters, order:'expiry_date.asc', limit:200 });
    if (error) return serverErr(env);
    return ok({ certificates: data || [], days }, env);
  }

  /* ── GET /api/certificates/stats — dashboard ── */
  if (path === '/certificates/stats' && method === 'GET') {
    const today  = new Date().toISOString().split('T')[0];
    const soon   = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];
    const fBase  = {};
    if (['user','technician'].includes(session.role)) {
      if (session.customerId) fBase['client_id.eq'] = session.customerId;
      // Only filter by functional_location if it exists and is not null
      if (session.functional_location) fBase['functional_location.eq'] = session.functional_location;
    }

    const [total, valid, expiring, expired, pending] = await Promise.all([
      db.count('certificates', { filters: { ...fBase } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq':'approved', 'expiry_date.gt': soon } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq':'approved', 'expiry_date.gte': today, 'expiry_date.lte': soon } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq':'approved', 'expiry_date.lt': today } }),
      db.count('certificates', { filters: { ...fBase, 'approval_status.eq':'pending' } }),
    ]);
    return ok({ total: total.count, valid: valid.count, expiring: expiring.count, expired: expired.count, pending: pending.count }, env);
  }

  const idM   = path.match(/^\/certificates\/([^/]+)$/);
  const certId = idM?.[1];
  const fileDeleteM = path.match(/^\/certificates\/([^/]+)\/file$/);
  const fileDeleteId = fileDeleteM?.[1];

  /* LIST */
  if (!certId && method === 'GET') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    const isRestricted = ['user', 'technician'].includes(session.role);
    if (isRestricted) {
      if (session.customerId) {
        filters['client_id.eq'] = session.customerId;
        if (session.functional_location) {
          filters['functional_location.eq'] = session.functional_location;
        }
      } else {
        console.warn(`[DEBUG] Restricted user ${session.username} (sub: ${session.sub}) has NULL customerId. Bypassing filters.`);
      }
    }
    if (url.searchParams.get('approval_status')) filters['approval_status.eq'] = url.searchParams.get('approval_status');
    if (url.searchParams.get('cert_type'))       filters['cert_type.eq']        = url.searchParams.get('cert_type');
    if (url.searchParams.get('asset_id'))        filters['asset_id.eq']         = url.searchParams.get('asset_id');
    if (url.searchParams.get('client_id') && requireRole(session,['admin','manager']))
      filters['client_id.eq'] = url.searchParams.get('client_id');
    let { data, error } = await db.from('certificates', { select:'*', filters, limit, offset, order:'expiry_date.asc' });
    if (error) return serverErr(env);
    if (['user','technician'].includes(session.role) && session.customerId && (!Array.isArray(data) || data.length === 0)) {
      const aliases = await clientAliases(session.customerId);
      for (const alias of aliases) {
        if (!alias || alias === session.customerId) continue;
        const fRetry = { ...filters, 'client_id.eq': alias };
        // Only filter by functional_location if it exists and is not null
        if (session.functional_location) fRetry['functional_location.eq'] = session.functional_location;
        const retry = await db.from('certificates', {
          select:'*',
          filters: fRetry,
          limit,
          offset,
          order:'expiry_date.asc',
        });
        if (retry.error) continue;
        const rows = Array.isArray(retry.data) ? retry.data : [];
        if (rows.length) {
          data = rows;
          break;
        }
      }
    }
    
    // Fetch functional location names for enrichment
    const flCodes = [...new Set((data || []).map(c => c.functional_location).filter(Boolean))];
    let flNameMap = {};
    if (flCodes.length > 0) {
      const { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.in': flCodes },
        select: 'fl_id,name',
      });
      flNameMap = (flRows || []).reduce((acc, row) => {
        acc[row.fl_id] = row.name || '';
        return acc;
      }, {});
    }
    
    // Enrich certificates with functional location names
    const enrichedCerts = (data || []).map(cert => ({
      ...cert,
      functionalLocationName: flNameMap[cert.functional_location] || '',
    }));
    
    const withNames = await _withUserNames(db, enrichedCerts, 'uploaded_by');
    return ok({ certificates: withNames, limit, offset }, env);
  }

  /* GET ONE */
  if (certId && method === 'GET') {
    const { data } = await db.from('certificates', { filters: { 'id.eq': certId }, select:'*', limit:1 });
    const cert = Array.isArray(data) ? data[0] : data;
    if (!cert) return notFound('Certificate', env);
    if (['user','technician'].includes(session.role) && session.customerId) {
      const aliases = await clientAliases(session.customerId);
      if (!aliases.includes(String(cert.client_id || ''))) return forbidden(env);
      // Also verify functional_location matches if user has one assigned
      if (session.functional_location && cert.functional_location !== session.functional_location) {
        return forbidden(env);
      }
    }
    const [withNames] = await _withUserNames(db, [cert], 'uploaded_by');
    return ok(withNames || cert, env);
  }

  /* CREATE */
  if (!certId && method === 'POST') {
    if (!requireRole(session, ['admin','manager','technician'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      name:        { required: true, type:'string', minLength:2, maxLength:200 },
      cert_type:   { required: true, type:'string', enum: TYPES },
      asset_id:    { required: true, type:'string' },
      issued_by:   { required: true, type:'string', minLength:2, maxLength:200 },
      issue_date:  { required: true, type:'string', pattern:/^\d{4}-\d{2}-\d{2}$/ },
      expiry_date: { required: true, type:'string', pattern:/^\d{4}-\d{2}-\d{2}$/ },
      related_standard: { required: false, type:'string', maxLength:200 },
      job_id:      { required: false, type:'string' },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);
    if (body.cert_type === 'TUBULAR' && !String(body.related_standard || '').trim()) {
      return badReq('Related standard is required for TUBULAR certificates','VALIDATION',env);
    }

    // Verify asset exists
    const { data: aRows } = await db.from('assets', { filters: { 'id.eq': body.asset_id }, select:'id,client_id,functional_location', limit:1 });
    const asset = Array.isArray(aRows) ? aRows[0] : aRows;
    if (!asset) return notFound('Asset', env);
    if (session.role === 'technician' && session.customerId) {
      const aliases = await clientAliases(session.customerId);
      if (!aliases.includes(String(asset.client_id || ''))) return forbidden(env);
      // Also verify functional_location matches if technician has one assigned
      if (session.functional_location && asset.functional_location !== session.functional_location) {
        return forbidden(env);
      }
    }

    // Temporary relaxation: allow technician uploads without strict job assignment checks.

    let job = null;
    if (body.job_id) {
      const { data: jRows } = await db.from('jobs', {
        filters: { 'id.eq': body.job_id },
        select:'id,job_number,client_id,functional_location,status',
        limit:1,
      });
      job = Array.isArray(jRows) ? jRows[0] : jRows;
      if (!job) return notFound('Job', env);
    }

    // NOTE: job/assignment/status constraints for technicians are temporarily disabled.

    // NOTE: job/client and functional-location matching constraints are temporarily disabled.

    const { data, error } = await db.insert('certificates', {
      name:            body.name,
      cert_type:       body.cert_type,
      asset_id:        body.asset_id,
      functional_location: asset.functional_location || null,
      client_id:       body.client_id || asset.client_id || null,
      inspector_id:    body.inspector_id || null,
      job_id:          body.job_id || null,
      issued_by:       body.issued_by,
      issue_date:      body.issue_date,
      expiry_date:     body.expiry_date,
      file_name:       body.file_name || null,
      file_url:        body.file_url  || null,
      notes:           body.notes     || null,
      related_standard: String(body.related_standard || '').trim() || null,
      approval_status: session.role === 'admin' ? 'approved' : 'pending',
      uploaded_by:     session.sub,
    });
    if (error) return serverErr(env);
    const cert = Array.isArray(data) ? data[0] : data;
    await _recordCertificateHistory(db, cert, session, 'create');

    // Notify managers/admins about pending certs
    if (cert.approval_status === 'pending') {
      await _notifyApprovers(db, session, cert);
      // Push notification to admins/managers
      sendPushToRoles(db, env, ['admin', 'manager'], {
        title: 'Certificate Pending Approval',
        body: `${session.name} uploaded "${cert.name}" — awaiting review.`,
        url: '/certificates.html',
        tag: 'cert-pending-' + cert.id,
      }, session.sub).catch(() => {});
    }
    return created(cert, env);
  }

  /* UPDATE / APPROVE / REJECT */
  if (certId && method === 'PATCH') {
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { data: ex } = await db.from('certificates', { filters: { 'id.eq': certId }, select:'*', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);

    const isUploader = existing.uploaded_by === session.sub;
    const isApprover = requireRole(session, ['admin','manager']);
    if (!isUploader && !isApprover) return forbidden(env);
    if (isUploader && !isApprover && existing.approval_status !== 'pending')
      return badReq('Cannot edit a reviewed certificate','INVALID_STATE',env);
    if (!isApprover && body.approval_status)
      return forbidden(env);

    const nextCertType = body.cert_type || existing.cert_type;
    const nextRelatedStandard = Object.prototype.hasOwnProperty.call(body, 'related_standard')
      ? body.related_standard
      : existing.related_standard;
    if (nextCertType === 'TUBULAR' && !String(nextRelatedStandard || '').trim()) {
      return badReq('Related standard is required for TUBULAR certificates','VALIDATION',env);
    }

    const allowed = isApprover
      ? ['name','cert_type','issued_by','issue_date','expiry_date','file_name','file_url','notes','approval_status','rejection_reason','inspector_id','related_standard']
      : ['name','cert_type','issued_by','issue_date','expiry_date','file_name','file_url','notes','related_standard'];

    const update = compact({
      ...pick(body, allowed),
      updated_at:  new Date().toISOString(),
      ...(body.approval_status && isApprover ? { reviewed_by: session.sub, reviewed_at: new Date().toISOString() } : {}),
    });
    const { data, error } = await db.update('certificates', update, { filters: { 'id.eq': certId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    await _recordCertificateHistory(db, updated || existing, session, 'update');

    // Notify uploader of decision
    if (body.approval_status && body.approval_status !== existing.approval_status && existing.uploaded_by) {
      await _notifyUser(db, existing.uploaded_by, 'cert_reviewed', `Certificate ${body.approval_status}`,
        `Your certificate "${updated.name}" has been ${body.approval_status}.`, 'certificate', certId);
      // Push notification to uploader
      sendPushToUser(db, env, existing.uploaded_by, {
        title: `Certificate ${body.approval_status === 'approved' ? 'Approved ✅' : 'Rejected ❌'}`,
        body: `Your certificate "${updated.name}" has been ${body.approval_status}.`,
        url: '/certificates.html',
        tag: 'cert-review-' + certId,
      }).catch(() => {});
    }

    return ok(updated || existing, env);
  }

  if (fileDeleteId && method === 'DELETE') {
    if (!requireRole(session, ['admin','technician'])) return forbidden(env);
    const { data: ex } = await db.from('certificates', { filters: { 'id.eq': fileDeleteId }, select:'*', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);
    if (session.role === 'technician') {
      if (existing.uploaded_by !== session.sub) return forbidden(env);
      const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / 3600000;
      if (ageHours > 24) return badReq('Delete window has expired (24 hours from upload)','WINDOW_EXPIRED',env);
    }
    const { data: updatedRows, error: updateErr } = await db.update('certificates', {
      file_name: null, file_url: null, updated_at: new Date().toISOString(),
    }, { filters: { 'id.eq': fileDeleteId } });
    if (updateErr) return serverErr(env);
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
    await _recordCertificateHistory(db, updated || existing, session, 'file_deleted');
    return ok({ id: fileDeleteId, file_deleted: true, certificate: updated || existing }, env);
  }

  /* DELETE */
  if (certId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const deleteScope = (url.searchParams.get('delete_scope') || '').toLowerCase();
    const { data: ex } = await db.from('certificates', { filters: { 'id.eq': certId }, select:'*', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Certificate', env);

    if (deleteScope === 'asset') {
      const { data: relRows, error: relErr } = await db.from('certificates', {
        filters: { 'asset_id.eq': existing.asset_id }, select:'*', limit:5000,
      });
      if (relErr) return serverErr(env);
      const related = Array.isArray(relRows) ? relRows : [];
      for (const cert of related) await _recordCertificateHistory(db, cert, session, 'record_deleted');
      await db.delete('certificates', { filters: { 'asset_id.eq': existing.asset_id } });
      return ok({ deleted_scope: 'asset', asset_id: existing.asset_id, deleted_count: related.length, deleted_ids: related.map(r => r.id) }, env);
    }

    await _recordCertificateHistory(db, existing, session, 'record_deleted');
    await db.delete('certificates', { filters: { 'id.eq': certId } });
    return ok({ id: certId, deleted: true, certificate: existing, deleted_scope: 'single' }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}

async function _withUserNames(db, rows, field = 'uploaded_by') {
  if (!Array.isArray(rows) || !rows.length) return [];
  const ids = [...new Set(rows.map(r => r?.[field]).filter(Boolean))];
  if (!ids.length) return rows;
  const { data: users } = await db.from('users', { select:'id,username', filters: { 'id.in': ids }, limit: ids.length + 5 });
  const map = new Map((Array.isArray(users) ? users : []).map(u => [u.id, u.username]));
  return rows.map(r => ({
    ...r,
    uploaded_by_username: field === 'uploaded_by' ? (map.get(r.uploaded_by) || null) : undefined,
    changed_by_username: field === 'changed_by' ? (map.get(r.changed_by) || null) : undefined,
  }));
}

async function _recordCertificateHistory(db, cert, session, action) {
  try {
    if (!cert?.id) return;
    await db.insert('certificate_history', {
      certificate_id: cert.id,
      cert_number: cert.cert_number || null,
      name: cert.name || null,
      cert_type: cert.cert_type || null,
      related_standard: cert.related_standard || null,
      asset_id: cert.asset_id || null,
      client_id: cert.client_id || null,
      issued_by: cert.issued_by || null,
      issue_date: cert.issue_date || null,
      expiry_date: cert.expiry_date || null,
      approval_status: cert.approval_status || null,
      file_name: cert.file_name || null,
      file_url: cert.file_url || null,
      action_type: action,
      changed_by: session?.sub || null,
      changed_at: new Date().toISOString(),
      snapshot_json: cert || {},
    });
  } catch (e) { console.warn('Certificate history write failed:', e); }
}

async function _notifyApprovers(db, session, cert) {
  try {
    const { data: approvers } = await db.from('users', {
      filters: { 'role.in': ['admin','manager'], 'is_active.is': true }, select: 'id',
    });
    if (!Array.isArray(approvers)) return;
    const notifs = approvers.filter(u => u.id !== session.sub).map(u => ({
      user_id: u.id, type: 'cert_uploaded',
      title: 'Certificate Pending Approval',
      body:  `${session.name} uploaded "${cert.name}" — awaiting review.`,
      ref_type: 'certificate', ref_id: cert.id, is_read: false,
    }));
    if (notifs.length) await db.insert('notifications', notifs);
  } catch(e) { console.warn('Notify failed:', e); }
}

async function _notifyUser(db, userId, type, title, body, refType, refId) {
  try {
    await db.insert('notifications', { user_id: userId, type, title, body, ref_type: refType, ref_id: refId, is_read: false });
  } catch(e) { console.warn('Notify failed:', e); }
}
