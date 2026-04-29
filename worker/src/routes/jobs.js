// worker/src/routes/jobs.js
import { createSupabase }                    from '../lib/supabase.js';
import { getSession, requireRole }           from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, serverErr } from '../utils/response.js';
import { validate, pick, compact }           from '../utils/validate.js';
import { sendPushToRoles }                   from '../lib/web-push.js';

const STATUSES = ['active', 'technician_done', 'closed', 'reopened'];

export async function handleJobs(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db     = createSupabase(env);
  const url    = new URL(request.url);

  // Helper to check client access
  async function canAccessClient(clientId) {
    if (session.role === 'admin' || session.role === 'manager') return true;
    if (session.role === 'technician' && session.customerId) {
      return String(session.customerId) === String(clientId);
    }
    return false;
  }

  /* ── GET /api/jobs/stats — dashboard stats ── */
  if (path === '/jobs/stats' && method === 'GET') {
    const filters = {};
    if (['user', 'technician'].includes(session.role) && session.customerId) {
      filters['client_id.eq'] = session.customerId;
    }

    const [total, active, technicianDone, closed] = await Promise.all([
      db.count('jobs', { filters: { ...filters } }),
      db.count('jobs', { filters: { ...filters, 'status.eq': 'active' } }),
      db.count('jobs', { filters: { ...filters, 'status.eq': 'technician_done' } }),
      db.count('jobs', { filters: { ...filters, 'status.eq': 'closed' } }),
    ]);

    return ok({ 
      total: total.count, 
      active: active.count, 
      technicianDone: technicianDone.count, 
      closed: closed.count 
    }, env);
  }

  const idM   = path.match(/^\/jobs\/([^/]+)$/);
  const jobId = idM?.[1];

  const inspectorsM = path.match(/^\/jobs\/([^/]+)\/inspectors$/);
  const eventsM = path.match(/^\/jobs\/([^/]+)\/events$/);

  /* LIST */
  if (!jobId && !inspectorsM && !eventsM && method === 'GET') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const filters = {};

    if (['user', 'technician'].includes(session.role) && session.customerId) {
      filters['client_id.eq'] = session.customerId;
    }
    if (url.searchParams.get('status')) filters['status.eq'] = url.searchParams.get('status');
    if (url.searchParams.get('client_id') && requireRole(session, ['admin', 'manager'])) {
      filters['client_id.eq'] = url.searchParams.get('client_id');
    }
    if (url.searchParams.get('functional_location')) {
      filters['functional_location.eq'] = url.searchParams.get('functional_location');
    }

    const { data, error } = await db.from('jobs', { 
      select: '*', 
      filters, 
      limit, 
      offset, 
      order: 'created_at.desc' 
    });
    if (error) return serverErr(env);

    const jobs = Array.isArray(data) ? data : [];
    const jobIds = jobs.map(j => j.id).filter(Boolean);
    if (jobIds.length === 0) return ok({ jobs, limit, offset }, env);

    const { data: assignments } = await db.from('job_inspectors', {
      filters: { 'job_id.in': jobIds },
      select: 'job_id,inspector_id',
    });

    const inspectorIds = [...new Set((assignments || []).map(a => a.inspector_id).filter(Boolean))];
    let inspectorNameMap = {};
    if (inspectorIds.length > 0) {
      const { data: inspectorRows } = await db.from('inspectors', {
        filters: { 'id.in': inspectorIds },
        select: 'id,name',
      });
      inspectorNameMap = (inspectorRows || []).reduce((acc, row) => {
        acc[row.id] = row.name || '';
        return acc;
      }, {});
    }

    // Fetch client names
    const clientIds = [...new Set(jobs.map(j => j.client_id).filter(Boolean))];
    let clientNameMap = {};
    if (clientIds.length > 0) {
      const { data: clientRows } = await db.from('clients', {
        filters: { 'client_id.in': clientIds },
        select: 'client_id,name',
      });
      clientNameMap = (clientRows || []).reduce((acc, row) => {
        acc[row.client_id] = row.name || '';
        return acc;
      }, {});
    }

    // Fetch functional location names
    const flCodes = [...new Set(jobs.map(j => j.functional_location).filter(Boolean))];
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

    const byJob = (assignments || []).reduce((acc, row) => {
      if (!acc[row.job_id]) acc[row.job_id] = [];
      acc[row.job_id].push(row.inspector_id);
      return acc;
    }, {});

    const enrichedJobs = jobs.map(job => {
      const ids = byJob[job.id] || [];
      return {
        ...job,
        inspector_ids: ids,
        inspector_names: ids.map(id => inspectorNameMap[id]).filter(Boolean),
        client_name: clientNameMap[job.client_id] || '',
        functional_location_name: flNameMap[job.functional_location] || '',
      };
    });

    return ok({ jobs: enrichedJobs, limit, offset }, env);
  }

  /* GET ONE */
  if (jobId && !inspectorsM && !eventsM && method === 'GET') {
    const { data } = await db.from('jobs', { filters: { 'id.eq': jobId }, select: '*', limit: 1 });
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return notFound('Job', env);

    if (!await canAccessClient(job.client_id)) return forbidden(env);

    // Fetch assigned inspectors
    const { data: inspectorRows } = await db.from('job_inspectors', { 
      filters: { 'job_id.eq': jobId }, 
      select: 'inspector_id' 
    });
    const inspectorIds = Array.isArray(inspectorRows) 
      ? inspectorRows.map(r => r.inspector_id) 
      : [];
    
    let inspectors = [];
    if (inspectorIds.length > 0) {
      const { data: inspData } = await db.from('inspectors', { 
        filters: { 'id.in': inspectorIds }, 
        select: 'id,inspector_number,name,title,status' 
      });
      inspectors = Array.isArray(inspData) ? inspData : [];
    }

    // Fetch recent events
    const { data: eventRows } = await db.from('job_events', { 
      filters: { 'job_id.eq': jobId }, 
      select: '*', 
      order: 'created_at.desc', 
      limit: 50 
    });

    return ok({ 
      job, 
      inspectors, 
      events: Array.isArray(eventRows) ? eventRows : [] 
    }, env);
  }

  /* CREATE */
  if (!jobId && method === 'POST') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);
    
    let body; 
    try { body = await request.json(); } 
    catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { valid, errors } = validate(body, {
      client_id:   { required: true, type: 'string' },
      title:       { required: false, type: 'string', maxLength: 200 },
      functional_location: { required: false, type: 'string', maxLength: 200 },
      notes:       { required: false, type: 'string', maxLength: 1000 },
    });
    if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

    // Verify client exists
    const { data: clientData } = await db.from('clients', { 
      filters: { 'client_id.eq': body.client_id }, 
      select: 'client_id,name', 
      limit: 1 
    });
    const client = Array.isArray(clientData) ? clientData[0] : clientData;
    if (!client) return notFound('Client', env);

    // Insert job - job_number will be auto-generated by trigger
    const { data, error } = await db.insert('jobs', {
      job_number:        body.job_number || null,  // Will be auto-generated if null
      client_id:         body.client_id,
      functional_location: body.functional_location || null,
      title:             body.title || null,
      status:            'active',
      notes:             body.notes || null,
      created_by:        session.sub,
    });
    if (error) return serverErr(env);
    const job = Array.isArray(data) ? data[0] : data;

    // Assign inspectors if provided
    if (Array.isArray(body.inspector_ids) && body.inspector_ids.length > 0) {
      const assignInserts = body.inspector_ids.map(inspId => ({
        job_id: job.id,
        inspector_id: inspId,
        assigned_by: session.sub,
      }));
      await db.insert('job_inspectors', assignInserts);
    }

    // Record event
    await db.insert('job_events', {
      job_id: job.id,
      event_type: 'created',
      actor_user_id: session.sub,
      payload_json: { job_number: job.job_number, title: job.title },
    });

    // Notify technicians about new job
    sendPushToRoles(db, env, ['technician'], {
      title: 'New Job Assigned',
      body: `Job ${job.job_number} created for ${client.name}.`,
      url: '/jobs.html?job=' + job.id,
      tag: 'job-new-' + job.id,
    }, session.sub).catch(() => {});

    return created(job, env);
  }

  /* UPDATE */
  if (jobId && method === 'PATCH') {
    let body; 
    try { body = await request.json(); } 
    catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { data: ex } = await db.from('jobs', { 
      filters: { 'id.eq': jobId }, 
      select: '*', 
      limit: 1 
    });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Job', env);

    if (!await canAccessClient(existing.client_id)) return forbidden(env);

    // Only admins/managers can update jobs
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);

    const allowed = ['title', 'functional_location', 'notes', 'status'];
    const update = compact({
      ...pick(body, allowed),
      updated_at: new Date().toISOString(),
    });

    // Handle status transitions with proper tracking
    if (body.status && body.status !== existing.status) {
      const now = new Date().toISOString();
      
      if (body.status === 'technician_done') {
        update.finished_by = session.sub;
        update.finished_at = now;
      } else if (body.status === 'closed') {
        update.closed_by = session.sub;
        update.closed_at = now;
      } else if (body.status === 'reopened') {
        update.reopened_by = session.sub;
        update.reopened_at = now;
      }
    }

    const { data, error } = await db.update('jobs', update, { 
      filters: { 'id.eq': jobId } 
    });
    if (error) return serverErr(env);
    const updated = Array.isArray(data) ? data[0] : data;

    // Record event
    if (body.status && body.status !== existing.status) {
      await db.insert('job_events', {
        job_id: jobId,
        event_type: 'status_changed',
        actor_user_id: session.sub,
        payload_json: { 
          from_status: existing.status, 
          to_status: body.status,
          job_number: updated.job_number,
        },
      });
    }

    return ok(updated || existing, env);
  }

  /* DELETE */
  if (jobId && method === 'DELETE') {
    if (!requireRole(session, ['admin'])) return forbidden(env);

    const { data: ex } = await db.from('jobs', { 
      filters: { 'id.eq': jobId }, 
      select: '*', 
      limit: 1 
    });
    const existing = Array.isArray(ex) ? ex[0] : ex;
    if (!existing) return notFound('Job', env);

    // Record final event
    await db.insert('job_events', {
      job_id: jobId,
      event_type: 'deleted',
      actor_user_id: session.sub,
      payload_json: { job_number: existing.job_number },
    });

    await db.delete('jobs', { filters: { 'id.eq': jobId } });
    return ok({ id: jobId, deleted: true }, env);
  }

  /* ASSIGN INSPECTORS to job */
  if (jobId && inspectorsM && method === 'POST') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);

    let body; 
    try { body = await request.json(); } 
    catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

    if (!Array.isArray(body.inspector_ids) || body.inspector_ids.length === 0) {
      return badReq('inspector_ids array is required', 'VALIDATION', env);
    }

    const { data: ex } = await db.from('jobs', { 
      filters: { 'id.eq': jobId }, 
      select: 'id', 
      limit: 1 
    });
    if (!ex) return notFound('Job', env);

    const inserts = body.inspector_ids.map(inspId => ({
      job_id: jobId,
      inspector_id: inspId,
      assigned_by: session.sub,
    }));

    const { error } = await db.insert('job_inspectors', inserts);
    if (error) return serverErr(env);

    // Record event
    await db.insert('job_events', {
      job_id: jobId,
      event_type: 'inspectors_assigned',
      actor_user_id: session.sub,
      payload_json: { inspector_ids: body.inspector_ids },
    });

    return ok({ assigned: body.inspector_ids }, env);
  }

  /* REMOVE INSPECTOR from job */
  if (jobId && inspectorsM && method === 'DELETE') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);

    const inspectorId = url.searchParams.get('inspector_id');
    if (!inspectorId) return badReq('inspector_id query param required', 'VALIDATION', env);

    const { error } = await db.delete('job_inspectors', { 
      filters: { 'job_id.eq': jobId, 'inspector_id.eq': inspectorId } 
    });
    if (error) return serverErr(env);

    // Record event
    await db.insert('job_events', {
      job_id: jobId,
      event_type: 'inspector_removed',
      actor_user_id: session.sub,
      payload_json: { inspector_id: inspectorId },
    });

    return ok({ removed: inspectorId }, env);
  }

  /* GET/POST JOB EVENTS */
  if (jobId && eventsM) {
    if (method === 'GET') {
      const { data, error } = await db.from('job_events', { 
        filters: { 'job_id.eq': jobId }, 
        select: '*', 
        order: 'created_at.desc', 
        limit: 100 
      });
      if (error) return serverErr(env);
      return ok({ events: Array.isArray(data) ? data : [] }, env);
    }

    if (method === 'POST') {
      if (!requireRole(session, ['admin', 'manager', 'technician'])) return forbidden(env);

      let body; 
      try { body = await request.json(); } 
      catch { return badReq('Invalid JSON', 'BAD_JSON', env); }

      const { valid, errors } = validate(body, {
        event_type: { required: true, type: 'string', maxLength: 100 },
        payload_json: { required: false, type: 'object' },
      });
      if (!valid) return badReq(errors.join('; '), 'VALIDATION', env);

      const { data, error } = await db.insert('job_events', {
        job_id: jobId,
        event_type: body.event_type,
        actor_user_id: session.sub,
        payload_json: body.payload_json || {},
      });
      if (error) return serverErr(env);
      return created(Array.isArray(data) ? data[0] : data, env);
    }
  }

  return badReq('Not found', 'NOT_FOUND', env);
}
