// worker/src/routes/inspectors.js
import { createSupabase }          from '../lib/supabase.js';
import { hashPassword }            from '../lib/password.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact } from '../utils/validate.js';

const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const TRAINING_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const DEFAULT_INSPECTOR_PASSWORD = '12345678';

function sanitizeUsernameBase(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return raw.slice(0, 50);
}

function makeInspectorUsername(email, name, inspectorNumber) {
  const emailBase = sanitizeUsernameBase(email);
  if (emailBase) return emailBase;

  const firstName = String(name || '').trim().split(/\s+/).filter(Boolean)[0] || '';
  const firstNameBase = sanitizeUsernameBase(firstName);
  if (firstNameBase) return firstNameBase;

  return sanitizeUsernameBase(inspectorNumber || '') || `inspector_${Date.now()}`;
}

async function resolveUniqueUsername(db, preferred) {
  let candidate = sanitizeUsernameBase(preferred) || `inspector_${Date.now()}`;
  let i = 0;
  while (i < 50) {
    const suffix = i === 0 ? '' : `_${i + 1}`;
    const tryUsername = `${candidate}${suffix}`.slice(0, 50);
    const { data } = await db.from('users', {
      filters: { 'username.ilike': tryUsername },
      select: 'id',
      limit: 1,
    });
    const hit = Array.isArray(data) ? data[0] : data;
    if (!hit) return tryUsername;
    i += 1;
  }
  return `${candidate.slice(0, 40)}_${crypto.randomUUID().slice(0, 8)}`;
}

async function ensureInspectorUser(db, inspector) {
  const desiredUsername = makeInspectorUsername(inspector.email, inspector.name, inspector.inspector_number);
  const baseName = String(inspector.name || '').trim() || 'Inspector';

  if (inspector.user_id) {
    const updateUser = {
      name: baseName,
      role: 'technician',
      customer_id: null,
      is_active: inspector.status !== 'inactive',
      updated_at: new Date().toISOString(),
    };
    // Keep existing username unless it is empty somehow.
    const { data: currentRows } = await db.from('users', {
      filters: { 'id.eq': inspector.user_id },
      select: 'id,username',
      limit: 1,
    });
    const current = Array.isArray(currentRows) ? currentRows[0] : currentRows;
    if (!current) return { ok: false, error: 'Linked inspector user not found' };
    if (!current.username) {
      updateUser.username = await resolveUniqueUsername(db, desiredUsername);
    }
    const { error } = await db.update('users', updateUser, { filters: { 'id.eq': inspector.user_id } });
    if (error) return { ok: false, error: 'Failed to update linked user' };
    return { ok: true, userId: inspector.user_id };
  }

  const username = await resolveUniqueUsername(db, desiredUsername);
  const { data, error } = await db.insert('users', {
    username,
    password_hash: await hashPassword(DEFAULT_INSPECTOR_PASSWORD),
    name: baseName,
    role: 'technician',
    customer_id: null,
    is_active: inspector.status !== 'inactive',
  });
  if (error) return { ok: false, error: 'Failed to create linked user' };
  const user = Array.isArray(data) ? data[0] : data;
  if (!user?.id) return { ok: false, error: 'Linked user was not created' };
  return { ok: true, userId: user.id };
}

export async function handleInspectors(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const isInspectorUpload = method === 'POST' && (path === '/inspectors/upload-file' || path === '/inspectors/upload-cv');
  if (isInspectorUpload) {
    if (!requireRole(session, ['admin', 'technician'])) return forbidden(env);
  } else if (!requireRole(session, ['admin', 'manager'])) {
    return forbidden(env);
  }

  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const fileM  = path.match(/^\/inspectors\/file\/([^/]+)$/);
  const fileId = fileM?.[1];
  const cvM    = path.match(/^\/inspectors\/cv\/([^/]+)$/);
  const cvId   = cvM?.[1];
  const idM    = path.match(/^\/inspectors\/([^/]+)$/);
  const iid    = idM?.[1];

  // Storage check helper: B2 (primary) or R2 (fallback)
  const isStorageReady = () => !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) || !!env.CERT_BUCKET;

  if (path === '/inspectors/upload-file' && method === 'POST') {
    if (!requireRole(session, ['admin', 'technician'])) return forbidden(env);
    if (!isStorageReady()) return badReq('Storage not configured. Set B2_* variables (primary) or CERT_BUCKET (R2 fallback).','NO_BUCKET',env);
    let formData;
    try { formData = await request.formData(); } catch { return badReq('Invalid form data','BAD_FORM_DATA',env); }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided','NO_FILE',env);
    const category = (formData.get('category') || 'training').toString().toLowerCase();
    const allowed = category === 'cv' ? CV_TYPES : TRAINING_TYPES;
    if (!allowed.includes(file.type)) return badReq('Invalid file type for this upload','INVALID_TYPE',env);
    if (file.size > 10 * 1024 * 1024) return badReq('File too large (max 10MB)','FILE_TOO_LARGE',env);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const labelRaw = (formData.get('label') || file.name.replace(/\.[^.]+$/, '') || 'file').toString();
    const safeLabel = labelRaw.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file';
    const finalName = `${safeLabel}.${ext}`;
    const key = `inspectors/${category}/${Date.now()}_${crypto.randomUUID().slice(0,8)}_${finalName}`;
    try {
      // Use B2 if configured, otherwise R2
      if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
        // Inline B2 upload (same logic as _worker.js storage helpers)
        const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
        const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } });
        if (!authRes.ok) throw new Error('B2 auth failed');
        const auth = await authRes.json();
        const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: 'POST',
          headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
        });
        if (!uploadUrlRes.ok) throw new Error('B2 upload URL failed');
        const uploadUrl = await uploadUrlRes.json();
        const encodedName = encodeURIComponent(key);
        
        // Compute SHA1 hash for B2 (required) - read buffer once, use for both hash and upload
        const fileBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-1', fileBuffer);
        const sha1Hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const uploadRes = await fetch(uploadUrl.uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: uploadUrl.authorizationToken,
            'X-Bz-File-Name': encodedName,
            'Content-Type': file.type,
            'X-Bz-Content-Sha1': sha1Hash,
          },
          body: fileBuffer,
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '');
          throw new Error(`B2 upload failed (${uploadRes.status}): ${errText}`);
        }
      } else {
        const fileBufferForR2 = await file.arrayBuffer();
        await env.CERT_BUCKET.put(key, fileBufferForR2, {
          httpMetadata: { contentType: file.type },
          customMetadata: { originalName: file.name, uploadedBy: session.sub, category },
        });
      }
    } catch { return badReq('File upload failed','UPLOAD_FAILED',env); }
    return ok({ file_name: finalName, file_url: key }, env);
  }

  if (path === '/inspectors/upload-cv' && method === 'POST') {
    if (!requireRole(session, ['admin', 'technician'])) return forbidden(env);
    if (!isStorageReady()) return badReq('Storage not configured. Set B2_* variables (primary) or CERT_BUCKET (R2 fallback).','NO_BUCKET',env);
    let formData;
    try { formData = await request.formData(); } catch { return badReq('Invalid form data','BAD_FORM_DATA',env); }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return badReq('No file provided','NO_FILE',env);
    if (!CV_TYPES.includes(file.type)) return badReq('Invalid file type. Allowed: PDF, DOC, DOCX','INVALID_TYPE',env);
    if (file.size > 10 * 1024 * 1024) return badReq('File too large (max 10MB)','FILE_TOO_LARGE',env);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 80) || 'cv';
    const key = `inspectors/cv/${Date.now()}_${crypto.randomUUID().slice(0,8)}_${safeName}.${ext}`;
    try {
      if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
        const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
        const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } });
        if (!authRes.ok) throw new Error('B2 auth failed');
        const auth = await authRes.json();
        const uploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: 'POST',
          headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
        });
        if (!uploadUrlRes.ok) throw new Error('B2 upload URL failed');
        const uploadUrl = await uploadUrlRes.json();
        const encodedName = encodeURIComponent(key);
        
        // Compute SHA1 hash for B2 (required) - read buffer once, use for both hash and upload
        const fileBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-1', fileBuffer);
        const sha1Hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const uploadRes = await fetch(uploadUrl.uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: uploadUrl.authorizationToken,
            'X-Bz-File-Name': encodedName,
            'Content-Type': file.type,
            'X-Bz-Content-Sha1': sha1Hash,
          },
          body: fileBuffer,
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '');
          throw new Error(`B2 upload failed (${uploadRes.status}): ${errText}`);
        }
      } else {
        const fileBufferForR2 = await file.arrayBuffer();
        await env.CERT_BUCKET.put(key, fileBufferForR2, {
          httpMetadata: { contentType: file.type },
          customMetadata: { originalName: file.name, uploadedBy: session.sub },
        });
      }
    } catch { return badReq('CV upload failed','UPLOAD_FAILED',env); }
    return ok({ cv_file: file.name, cv_url: key }, env);
  }

  if (fileId && method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key.startsWith('inspectors/')) return badReq('Invalid file key','INVALID_KEY',env);
    const idFilter = fileId.includes('-')
      ? { 'id.eq': fileId }
      : { 'inspector_number.eq': fileId };
    const { data } = await db.from('inspectors', { filters: idFilter, select:'id', limit:1 });
    if (!(Array.isArray(data) ? data[0] : data)) return notFound('Inspector', env);
    if (!isStorageReady()) return badReq('Storage not configured','NO_BUCKET',env);
    
    let obj;
    if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
      const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
      const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } });
      if (!authRes.ok) return badReq('B2 auth failed','STORAGE_ERROR',env);
      const auth = await authRes.json();
      const fileName = encodeURIComponent(key);
      const dlUrl = `${auth.downloadUrl}/file/${encodeURIComponent(env.B2_BUCKET_NAME)}/${fileName}`;
      const res = await fetch(dlUrl, { headers: { Authorization: auth.authorizationToken } });
      if (res.status === 404) return notFound('File', env);
      if (!res.ok) return badReq('B2 download failed','STORAGE_ERROR',env);
      obj = {
        body: res.body,
        httpMetadata: { contentType: res.headers.get('content-type') || 'application/octet-stream' },
      };
    } else {
      obj = await env.CERT_BUCKET.get(key);
    }
    if (!obj) return notFound('File', env);
    const fileName = url.searchParams.get('name') || key.split('/').pop() || 'inspector-file';
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${fileName}"`,
      },
    });
  }

  if (cvId && method === 'GET') {
    const idFilter = cvId.includes('-')
      ? { 'id.eq': cvId }
      : { 'inspector_number.eq': cvId };
    const { data } = await db.from('inspectors', { filters: idFilter, select:'id,cv_file,cv_url', limit:1 });
    const insp = Array.isArray(data) ? data[0] : data;
    if (!insp) return notFound('Inspector', env);
    if (!insp.cv_url) return notFound('CV file', env);
    if (!isStorageReady()) return badReq('Storage not configured','NO_BUCKET',env);
    
    let obj;
    if (env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME) {
      const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
      const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } });
      if (!authRes.ok) return badReq('B2 auth failed','STORAGE_ERROR',env);
      const auth = await authRes.json();
      const fileName = encodeURIComponent(insp.cv_url);
      const dlUrl = `${auth.downloadUrl}/file/${encodeURIComponent(env.B2_BUCKET_NAME)}/${fileName}`;
      const res = await fetch(dlUrl, { headers: { Authorization: auth.authorizationToken } });
      if (res.status === 404) return notFound('CV file', env);
      if (!res.ok) return badReq('B2 download failed','STORAGE_ERROR',env);
      obj = {
        body: res.body,
        httpMetadata: { contentType: res.headers.get('content-type') || 'application/octet-stream' },
      };
    } else {
      obj = await env.CERT_BUCKET.get(insp.cv_url);
    }
    if (!obj) return notFound('CV file', env);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${insp.cv_file || 'inspector-cv'}"`,
      },
    });
  }

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
    const inspector = Array.isArray(data) ? data[0] : data;

    const userResult = await ensureInspectorUser(db, inspector);
    if (!userResult.ok) return serverErr(env);

    const { data: linkedRows, error: linkedErr } = await db.update('inspectors', {
      user_id: userResult.userId,
      updated_at: new Date().toISOString(),
    }, { filters: { 'id.eq': inspector.id } });
    if (linkedErr) return serverErr(env);
    return created(Array.isArray(linkedRows) ? linkedRows[0] : linkedRows, env);
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

    const userResult = await ensureInspectorUser(db, updated);
    if (!userResult.ok) return serverErr(env);

    if (updated.user_id !== userResult.userId) {
      const { data: linkedRows, error: linkedErr } = await db.update('inspectors', {
        user_id: userResult.userId,
        updated_at: new Date().toISOString(),
      }, { filters: { 'id.eq': iid } });
      if (linkedErr) return serverErr(env);
      return ok(Array.isArray(linkedRows) ? linkedRows[0] : linkedRows, env);
    }
    return ok(updated, env);
  }

  if (iid && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('inspectors', { filters: { 'id.eq': iid }, select:'id,user_id', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Inspector', env);
    if (existing.user_id) {
      await db.update('users', {
        is_active: false,
        updated_at: new Date().toISOString(),
      }, { filters: { 'id.eq': existing.user_id } });
    }
    await db.delete('inspectors', { filters: { 'id.eq': iid } });
    return ok({ id: iid, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
