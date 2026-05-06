// worker/src/routes/assets.js
import { createSupabase }                    from '../lib/supabase.js';
import { buildFunctionalLocationAliases }    from '../lib/functional-location.js';
import { getSession, requireRole }           from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, conflict, serverErr } from '../utils/response.js';
import { validate, pick, compact }           from '../utils/validate.js';

const TYPES    = ['Hoisting Equipment','Drilling Equipment','Mud System Low Pressure','Mud System High Pressure','Wirelines','Structure','Well Control','Tubular'];
const STATUSES = ['operation','stacked'];

async function resolveClientAliases(db, rawClientId) {
  const key = String(rawClientId || '').trim();
  if (!key) return [];
  const out = new Set([key]);
  const queries = [
    { 'id.eq': key },
    { 'client_id.eq': key },
  ];
  for (const filters of queries) {
    const { data } = await db.from('clients', { filters, select:'id,client_id', limit:1 });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id) out.add(String(row.id));
    if (row?.client_id) out.add(String(row.client_id));
  }
  return Array.from(out);
}

async function resolveFunctionalLocationAliases(db, rawLocation, rawClientId) {
  const key = String(rawLocation || '').trim();
  if (!key) return [];
  const filtersToTry = [
    { 'fl_id.eq': key },
    { 'name.eq': key },
    { 'id.eq': key },
  ];
  const clientAliases = await resolveClientAliases(db, rawClientId);
  for (const clientId of clientAliases) {
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

async function resolveAssetId(db, rawId) {
  if (!rawId) return null;
  // Allow API callers to pass either UUID or business asset number (AST-xxxx)
  if (/^AST-/i.test(rawId)) {
    const { data } = await db.from('assets', {
      filters: { 'asset_number.ilike': rawId },
      select: 'id',
      limit: 1,
    });
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id || null;
  }
  return rawId;
}

async function generateNextAssetNumber(db) {
  const { data } = await db.from('assets', { select:'asset_number', limit:5000 });
  const rows = Array.isArray(data) ? data : [];
  let max = 0;
  for (const r of rows) {
    const m = String(r.asset_number || '').toUpperCase().match(/^AST-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `AST-${String(max + 1).padStart(4, '0')}`;
}

export async function handleAssets(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);

  if (path === '/assets/import/validate' && method === 'POST') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return ok({ rows: [] }, env);

    const { data: existingRows } = await db.from('assets', { select:'id,asset_number,serial_number', limit:5000 });
    const existing = Array.isArray(existingRows) ? existingRows : [];
    const byAsset = new Map(existing.map(r => [String(r.asset_number || '').toLowerCase(), r]));
    const bySerial = new Map(existing.filter(r => r.serial_number).map(r => [String(r.serial_number || '').toLowerCase(), r]));
    const seenAsset = new Set();
    const seenSerial = new Set();

    const out = rows.map((row, idx) => {
      const assetNumber = String(row.asset_number || '').trim().toUpperCase();
      const serial = String(row.serial_number || '').trim();
      const errors = [];
      const warnings = [];
      if (!assetNumber) errors.push('asset_number is required');
      if (!String(row.name || '').trim()) errors.push('name is required');
      if (!String(row.asset_type || '').trim()) errors.push('asset_type is required');
      if (!String(row.status || '').trim()) errors.push('status is required');
      if (row.asset_type && !TYPES.includes(row.asset_type)) errors.push(`asset_type "${row.asset_type}" is not valid`);
      if (row.status && !STATUSES.includes(String(row.status).toLowerCase())) errors.push(`status "${row.status}" is not valid`);
      if (!String(row.manufacturer || '').trim()) warnings.push('manufacturer is empty');
      if (!String(row.model || '').trim()) warnings.push('model is empty');

      const assetKey = assetNumber.toLowerCase();
      const serialKey = serial.toLowerCase();
      const hasAssetDup = Boolean((assetKey && byAsset.has(assetKey)) || seenAsset.has(assetKey));
      const hasSerialDup = Boolean((serialKey && bySerial.has(serialKey)) || seenSerial.has(serialKey));
      const duplicate = hasAssetDup || hasSerialDup;
      let duplicateBy = null;
      if (duplicate) {
        if (hasAssetDup && hasSerialDup) duplicateBy = 'asset_number_and_serial_number';
        else if (hasSerialDup) duplicateBy = 'serial_number';
        else duplicateBy = 'asset_number';
      }
      if (assetKey) seenAsset.add(assetKey);
      if (serialKey) seenSerial.add(serialKey);
      const status = errors.length ? 'error' : (duplicate ? 'duplicate' : (warnings.length ? 'warning' : 'valid'));
      return { index: idx, status, errors, warnings, duplicate, duplicate_by: duplicateBy };
    });
    return ok({ rows: out }, env);
  }

  /* ── GET /api/assets/stats — dashboard KPIs ── */
  if (path === '/assets/stats' && method === 'GET') {
    const filters = {};
    if (['user','technician'].includes(session.role)) {
      if (session.customerId) filters['client_id.eq'] = session.customerId;
      // Only filter by functional_location if it exists and is not null
      if (session.functional_location) filters['functional_location.eq'] = session.functional_location;
    }

    const [total, active, maintenance, inactive] = await Promise.all([
      db.count('assets', { filters }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'active' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'maintenance' } }),
      db.count('assets', { filters: { ...filters, 'status.eq': 'inactive' } }),
    ]);
    return ok({ total: total.count, active: active.count, maintenance: maintenance.count, inactive: inactive.count }, env);
  }

  const idM  = path.match(/^\/assets\/([^/]+)$/);
  const asId = idM?.[1] ? await resolveAssetId(db, idM[1]) : undefined;

  /* LIST */
  if (!asId && method === 'GET') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50'),200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};
    const isRestricted = ['user','technician'].includes(session.role);
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
    if (url.searchParams.get('status'))    filters['status.eq']    = url.searchParams.get('status');
    if (url.searchParams.get('type'))      filters['asset_type.eq']= url.searchParams.get('type');
    if (url.searchParams.get('client_id') && requireRole(session,['admin','manager']))
      filters['client_id.eq'] = url.searchParams.get('client_id');
    let { data, error } = await db.from('assets', { select:'*', filters, limit, offset, order:'created_at.desc' });
    if (error) return serverErr(env);

    // Backward-compat fallback: some deployments store assets.client_id as clients.id,
    // while session.customerId contains clients.client_id (or vice versa).
    if (isRestricted && (!Array.isArray(data) || data.length === 0)) {
      const clientAliases = session.customerId ? await resolveClientAliases(db, session.customerId) : [''];
      for (const clientAlias of clientAliases) {
        const f2 = { ...filters };
        if (clientAlias) f2['client_id.eq'] = clientAlias;
        const retry = await db.from('assets', { select:'*', filters: f2, limit, offset, order:'created_at.desc' });
        if (retry.error) continue;
        const rows = Array.isArray(retry.data) ? retry.data : [];
        if (rows.length) {
          data = rows;
          break;
        }
        if (Array.isArray(data) && data.length) break;
      }
    }

    return ok({ assets: data || [], limit, offset }, env);
  }

  /* GET ONE */
  if (asId && method === 'GET') {
    const { data } = await db.from('assets', { filters: { 'id.eq': asId }, select:'*', limit: 1 });
    const asset = Array.isArray(data) ? data[0] : data;
    if (!asset) return notFound('Asset', env);
    if (['user','technician'].includes(session.role) && session.customerId) {
      const aliases = await resolveClientAliases(db, session.customerId);
      if (!aliases.includes(String(asset.client_id || ''))) return forbidden(env);
    }
    return ok(asset, env);
  }

  /* CREATE */
  if (!asId && method === 'POST') {
    if (!requireRole(session, ['admin','manager'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }
    const { valid, errors } = validate(body, {
      asset_number: { required: false, type: 'string', minLength: 1, maxLength: 50 },
      name:         { required: true,  type: 'string', minLength: 2, maxLength: 200 },
      asset_type:   { required: true,  type: 'string', enum: TYPES },
      status:       { required: false, type: 'string', enum: STATUSES },
      client_id:    { required: false, type: 'string' },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);

    if (body.functional_location) {
      if (!body.client_id) return badReq('client_id is required when functional_location is set','VALIDATION',env);
      
      // First try exact match on fl_id
      let { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.eq': body.functional_location },
        select:'fl_id,id,client_id,status,name',
        limit:1,
      });
      let fl = Array.isArray(flRows) ? flRows[0] : flRows;
      
      // If not found by fl_id, try matching by name (case-insensitive)
      if (!fl) {
        const { data: byNameRows } = await db.from('functional_locations', {
          filters: { 'name.eq': body.functional_location, 'client_id.eq': body.client_id },
          select:'fl_id,id,client_id,status,name',
          limit:1,
        });
        fl = Array.isArray(byNameRows) ? byNameRows[0] : byNameRows;
      }
      
      // Try without client_id filter as fallback
      if (!fl) {
        const { data: anyNameRows } = await db.from('functional_locations', {
          filters: { 'name.eq': body.functional_location },
          select:'fl_id,id,client_id,status,name',
          limit:1,
        });
        fl = Array.isArray(anyNameRows) ? anyNameRows[0] : anyNameRows;
      }
      
      if (!fl) return badReq(`Functional location "${body.functional_location}" not found. Please ensure the location exists and is active.`,'INVALID_LOCATION',env);
      if (fl.client_id && body.client_id && fl.client_id !== body.client_id) return badReq('Functional location must belong to the same client','CLIENT_LOCATION_MISMATCH',env);
      
      // Use fl_id for storage, not the name
      body.functional_location = fl.fl_id || fl.id;
    }

    const requestedNumber = String(body.asset_number || '').trim().toUpperCase();
    let assetNumber = requestedNumber || await generateNextAssetNumber(db);
    let data, error;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await db.insert('assets', {
        asset_number:        assetNumber,
        name:                body.name,
        asset_type:          body.asset_type,
        status:              body.status || 'operation',
        client_id:           body.client_id || null,
        functional_location: body.functional_location || null,
        serial_number:       body.serial_number || null,
        manufacturer:        body.manufacturer || null,
        model:               body.model || null,
        description:         body.description || null,
        created_by:          session.sub,
      });
      data = result.data; error = result.error;
      if (!error) break;
      if (error.code === '23505' && !requestedNumber) {
        assetNumber = await generateNextAssetNumber(db);
        continue;
      }
      break;
    }
    if (error) {
      if (error.code === '23505') return conflict('Asset number already exists across all clients', env);
      return serverErr(env);
    }
    const asset = Array.isArray(data) ? data[0] : data;
    await audit(db, session, 'assets', asset.id, 'create', null, asset);
    return created(asset, env);
  }

  /* UPDATE */
  if (asId && method === 'PATCH') {
    if (!requireRole(session, ['admin','manager','technician'])) return forbidden(env);
    let body; try { body = await request.json(); } catch { return badReq('Invalid JSON','BAD_JSON',env); }

    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select:'*', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);

    if (session.role === 'technician') {
      if (session.customerId && existing.client_id !== session.customerId) return forbidden(env);
      body = pick(body, ['status','notes']); // technicians can only update these
    }
    const { valid, errors } = validate(body, {
      name:         { type:'string', minLength:2, maxLength:200 },
      asset_type:   { type:'string', enum: TYPES },
      status:       { type:'string', enum: STATUSES },
      client_id:    { type:'string' },
      notes:        { type:'string', maxLength:2000 },
    });
    if (!valid) return badReq(errors.join('; '),'VALIDATION',env);

    const effectiveClientId = body.client_id || existing.client_id;
    const effectiveLocation = body.functional_location || existing.functional_location;
    if (effectiveLocation) {
      if (!effectiveClientId) return badReq('client_id is required when functional_location is set','VALIDATION',env);
      let { data: flRows } = await db.from('functional_locations', {
        filters: { 'fl_id.eq': effectiveLocation }, select:'id,client_id,status', limit:1,
      });
      let fl = Array.isArray(flRows) ? flRows[0] : flRows;
      if (!fl) {
        const { data: byNameRows } = await db.from('functional_locations', {
          filters: { 'name.ilike': effectiveLocation, 'client_id.eq': effectiveClientId }, select:'id,client_id,status', limit:1,
        });
        fl = Array.isArray(byNameRows) ? byNameRows[0] : byNameRows;
      }
      if (!fl) return badReq('Functional location not found','INVALID_LOCATION',env);
      if (fl.client_id !== effectiveClientId) return badReq('Functional location must belong to the same client','CLIENT_LOCATION_MISMATCH',env);
    }

    const update = compact({ ...pick(body,['name','asset_type','status','client_id','functional_location','serial_number','manufacturer','model','description','notes']), updated_by: session.sub, updated_at: new Date().toISOString() });
    const { data, error } = await db.update('assets', update, { filters: { 'id.eq': asId } });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return notFound('Asset', env);
    await audit(db, session, 'assets', asId, 'update', existing, updated);
    return ok(updated, env);
  }

  /* DELETE */
  if (asId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);
    const { data: ex } = await db.from('assets', { filters: { 'id.eq': asId }, select:'id,asset_number,name', limit:1 });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Asset', env);
    await audit(db, session, 'assets', asId, 'delete', existing, null);
    await db.delete('assets', { filters: { 'id.eq': asId } });
    return ok({ id: asId, deleted: true }, env);
  }

  return badReq('Not found','NOT_FOUND',env);
}

async function audit(db, session, table, id, action, before, after) {
  try {
    await db.insert('audit_logs', {
      user_id: session.sub, username: session.username, role: session.role,
      table_name: table, record_id: id, action,
      before: before ? JSON.stringify(before) : null,
      after:  after  ? JSON.stringify(after)  : null,
    });
  } catch(e) { console.warn('Audit failed:', e); }
}
