// worker/src/routes/jobs.js — Jobs/Work Orders API
import { createSupabase } from '../lib/supabase.js';
import { getSession, requireRole } from '../middleware/jwt.js';
import { ok, created, badReq, unauth, forbidden, notFound, serverErr } from '../utils/response.js';

export async function handleJobs(request, env, path) {
  const session = await getSession(request, env);
  if (!session) return unauth(env);

  const method = request.method;
  const db = createSupabase(env);
  const url = new URL(request.url);

  // GET /api/jobs — List jobs with optional filters
  if (path === '/jobs' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '200', 10);
    
    let query = db.from('jobs').select(`
      *,
      client:clients!inner(name, name_ar),
      functional_location:functional_locations!inner(name, name_ar),
      inspectors:inspectors_jobs(inspector_id, inspectors(id, name, name_ar, inspector_number))
    `).limit(limit);

    // Filter by client/customer for non-admin users
    if (session.role === 'user' && session.customerId) {
      query = query.eq('client.client_id', session.customerId);
    } else if (session.role === 'technician' && session.customerId) {
      query = query.eq('client.client_id', session.customerId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) {
      console.error('Jobs fetch error:', error);
      return serverErr('Failed to fetch jobs', env);
    }

    // Transform data for frontend
    const jobs = (data || []).map(job => ({
      ...job,
      client_name: job.client?.name || job.client_id,
      functional_location_name: job.functional_location?.name || job.functional_location,
      inspector_list: (job.inspectors || []).map(ij => ij.inspectors).filter(Boolean)
    }));

    return ok({ jobs }, env);
  }

  // POST /api/jobs — Create new job
  if (path === '/jobs' && method === 'POST') {
    if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);

    let body;
    try { body = await request.json(); } 
    catch (e) { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { job_number, client_id, functional_location, title, inspector_ids } = body;

    if (!client_id) return badReq('Client ID is required', 'MISSING_CLIENT', env);
    if (!functional_location) return badReq('Functional location is required', 'MISSING_FUNC_LOC', env);
    if (!inspector_ids || !Array.isArray(inspector_ids) || inspector_ids.length === 0) {
      return badReq('At least one inspector is required', 'MISSING_INSPECTORS', env);
    }

    // Generate job number if not provided
    let finalJobNumber = job_number;
    if (!finalJobNumber) {
      const { data: existing } = await db.from('jobs').select('job_number').order('created_at', { ascending: false }).limit(1);
      let maxNum = 0;
      if (existing && existing.length > 0) {
        const match = existing[0].job_number?.match(/^JOB-(\d+)$/);
        if (match) maxNum = parseInt(match[1], 10);
      }
      finalJobNumber = `JOB-${String(maxNum + 1).padStart(4, '0')}`;
    }

    // Create job
    const { data: job, error: jobError } = await db.from('jobs').insert({
      job_number: finalJobNumber,
      client_id,
      functional_location,
      title: title || null,
      status: 'open',
      created_by: session.userId
    }).select().single();

    if (jobError) {
      console.error('Job creation error:', jobError);
      return serverErr('Failed to create job', env);
    }

    // Link inspectors
    if (inspector_ids.length > 0) {
      const inspectorLinks = inspector_ids.map(inspector_id => ({
        job_id: job.id,
        inspector_id
      }));
      const { error: linkError } = await db.from('inspectors_jobs').insert(inspectorLinks);
      if (linkError) {
        console.error('Inspector linking error:', linkError);
        // Continue anyway - job was created
      }
    }

    return created({ job }, env);
  }

  // PATCH /api/jobs/:id — Update job status/action
  if (path.match(/^\/jobs\/[^/]+$/) && method === 'PATCH') {
    if (!requireRole(session, ['admin', 'manager', 'technician'])) return forbidden(env);

    const jobId = path.split('/')[2];
    let body;
    try { body = await request.json(); }
    catch (e) { return badReq('Invalid JSON', 'BAD_JSON', env); }

    const { action } = body;

    let newStatus = null;
    if (action === 'close' || action === 'mark_done') {
      if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);
      newStatus = 'closed';
    } else if (action === 'reopen') {
      if (!requireRole(session, ['admin', 'manager'])) return forbidden(env);
      newStatus = 'reopened';
    } else if (action === 'technician_done') {
      if (!requireRole(session, ['technician'])) return forbidden(env);
      newStatus = 'technician_done';
    } else {
      return badReq('Invalid action. Use: close, reopen, mark_done, technician_done', 'INVALID_ACTION', env);
    }

    const { data: job, error } = await db.from('jobs')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .select()
      .single();

    if (error) {
      console.error('Job update error:', error);
      return serverErr('Failed to update job', env);
    }

    if (!job) return notFound('Job not found', env);

    return ok({ job }, env);
  }

  // GET /api/jobs/:id/context — Load job context for drawer
  if (path.match(/^\/jobs\/[^/]+\/context$/) && method === 'GET') {
    const parts = path.split('/');
    const jobId = parts[2];

    // Get job details
    const { data: job, error: jobError } = await db.from('jobs').select(`
      *,
      client:clients!inner(client_id, name, name_ar),
      functional_location:functional_locations!inner(id, name, name_ar)
    `).eq('id', jobId).single();

    if (jobError || !job) {
      return notFound('Job not found', env);
    }

    // Get linked assets (from certificates or direct links)
    const { data: certs } = await db.from('certificates')
      .select('id, cert_number, name, approval_status, asset_id, assets(asset_number, name)')
      .eq('job_id', jobId);

    const assets = [];
    const seenAssets = new Set();
    if (certs) {
      for (const cert of certs) {
        if (cert.asset_id && !seenAssets.has(cert.asset_id)) {
          seenAssets.add(cert.asset_id);
          if (cert.assets) {
            assets.push({
              id: cert.asset_id,
              asset_number: cert.assets.asset_number,
              name: cert.assets.name
            });
          }
        }
      }
    }

    // Get inspectors assigned to this job
    const { data: inspectorLinks } = await db.from('inspectors_jobs')
      .select('inspectors(id, name, name_ar, inspector_number)')
      .eq('job_id', jobId);

    const inspectors = (inspectorLinks || []).map(il => il.inspectors).filter(Boolean);

    // Get recent timeline events
    const { data: timeline } = await db.from('certificate_history')
      .select('created_at, type, description')
      .or(`job_id.eq.${jobId},reference_id.eq.${jobId}`)
      .order('created_at', { ascending: false })
      .limit(20);

    return ok({
      job,
      client: job.client,
      functional_location: job.functional_location,
      assets,
      certificates: certs || [],
      inspectors,
      timeline: timeline || []
    }, env);
  }

  return notFound('Job route not found', env);
}
