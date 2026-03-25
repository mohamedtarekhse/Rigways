// worker/src/routes/inspectors.js
import { createSupabase }          from '../lib/supabase.js';
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

export async function handleInspectors(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);
  if (!requireRole(session, ['admin','manager'])) return forbidden(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);
  const fileM  = path.match(/^\/inspectors\/file\/([^/]+)$/);
  const fileId = fileM?.[1];
  const cvM    = path.match(/^\/inspectors\/cv\/([^/]+)$/);
  const cvId   = cvM?.[1];
  const idM    = path.match(/^\/inspectors\/([^/]+)$/);
  const iid    = idM?.[1];

  if (path === '/inspectors/upload-file' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured','NO_BUCKET',env);
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
      await env.CERT_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name, uploadedBy: session.sub, category },
      });
    } catch { return badReq('File upload failed','UPLOAD_FAILED',env); }
    return ok({ file_name: finalName, file_url: key }, env);
  }

  if (path === '/inspectors/upload-cv' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured','NO_BUCKET',env);
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
      await env.CERT_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name, uploadedBy: session.sub },
      });
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
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured','NO_BUCKET',env);
    const obj = await env.CERT_BUCKET.get(key);
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
    if (!env.CERT_BUCKET) return badReq('R2 bucket not configured','NO_BUCKET',env);
    const obj = await env.CERT_BUCKET.get(insp.cv_url);
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
    return created(Array.isArray(data) ? data[0] : data, env);
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
    return ok(updated, env);
  }

  if (iid && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('inspectors', { filters: { 'id.eq': iid }, select:'id', limit:1 });
    if (!(Array.isArray(ex) ? ex[0] : ex)) return notFound('Inspector', env);
    await db.delete('inspectors', { filters: { 'id.eq': iid } });
    return ok({ id: iid, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}
