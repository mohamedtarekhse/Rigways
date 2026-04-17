import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/certificates
 * List all certificates with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, approval_status, cert_type, asset_id, client_id } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    // Role-based filtering
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND (c.client_id = ? OR c.client_id IS NULL)';
      params.push(req.user.customerId);
    }
    
    if (approval_status) {
      whereClause += ' AND c.approval_status = ?';
      params.push(approval_status);
    }
    
    if (cert_type) {
      whereClause += ' AND c.cert_type = ?';
      params.push(cert_type);
    }
    
    if (asset_id) {
      whereClause += ' AND c.asset_id = ?';
      params.push(asset_id);
    }
    
    if (client_id && ['admin', 'manager'].includes(req.user.role)) {
      whereClause += ' AND c.client_id = ?';
      params.push(client_id);
    }
    
    const [certificates] = await query(
      `SELECT c.*, a.name as asset_name, a.asset_number, i.name as inspector_name
       FROM certificates c
       LEFT JOIN assets a ON c.asset_id = a.id
       LEFT JOIN inspectors i ON c.inspector_id = i.id
       ${whereClause}
       ORDER BY c.expiry_date ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM certificates c ${whereClause}`,
      params
    );
    
    res.json({
      success: true,
      certificates: certificates || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get certificates error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/certificates/stats
 * Get dashboard statistics for certificates
 */
router.get('/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    
    let whereClause = 'WHERE 1=1';
    const baseParams = [];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      baseParams.push(req.user.customerId);
    }
    
    const [total] = await query(`SELECT COUNT(*) as count FROM certificates ${whereClause}`, baseParams);
    const [valid] = await query(`${whereClause} AND approval_status = 'approved' AND expiry_date > ?`, [...baseParams, thirtyDays]);
    const [expiring] = await query(`${whereClause} AND approval_status = 'approved' AND expiry_date BETWEEN ? AND ?`, [...baseParams, today, thirtyDays]);
    const [expired] = await query(`${whereClause} AND approval_status = 'approved' AND expiry_date < ?`, [...baseParams, today]);
    const [pending] = await query(`${whereClause} AND approval_status = 'pending'`, baseParams);
    
    res.json({
      success: true,
      stats: {
        total: total?.count || 0,
        valid: valid?.count || 0,
        expiring: expiring?.count || 0,
        expired: expired?.count || 0,
        pending: pending?.count || 0
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/certificates/expiring
 * Get expiring certificates for dashboard widget
 */
router.get('/expiring', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const today = new Date().toISOString().split('T')[0];
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
    
    let whereClause = `WHERE approval_status = 'approved' AND expiry_date >= ? AND expiry_date <= ?`;
    const params = [today, cutoff];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      params.push(req.user.customerId);
    }
    
    const [certificates] = await query(
      `SELECT c.*, a.name as asset_name, a.asset_number 
       FROM certificates c
       LEFT JOIN assets a ON c.asset_id = a.id
       ${whereClause}
       ORDER BY c.expiry_date ASC
       LIMIT 200`,
      params
    );
    
    res.json({
      success: true,
      certificates: certificates || [],
      days
    });
  } catch (error) {
    console.error('Get expiring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/certificates/:id
 * Get single certificate by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const certificate = await queryOne(
      `SELECT c.*, a.name as asset_name, a.asset_number, i.name as inspector_name
       FROM certificates c
       LEFT JOIN assets a ON c.asset_id = a.id
       LEFT JOIN inspectors i ON c.inspector_id = i.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    
    if (!certificate) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }
    
    // Check permissions
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId && certificate.client_id !== req.user.customerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    res.json({ success: true, certificate });
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/certificates
 * Create new certificate
 */
router.post('/', requireRole('admin', 'manager', 'technician'), async (req, res) => {
  try {
    const { name, cert_type, asset_id, inspector_id, issued_by, issue_date, expiry_date, client_id, file_name, file_url, notes } = req.body;
    
    // Validate required fields
    if (!name || !cert_type || !asset_id || !issued_by || !issue_date || !expiry_date) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // Verify asset exists
    const asset = await queryOne('SELECT id, client_id FROM assets WHERE id = ?', [asset_id]);
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    // Generate next cert number
    const [lastCert] = await query(
      `SELECT cert_number FROM certificates WHERE cert_number REGEXP '^CERT-[0-9]+$' ORDER BY cert_number DESC LIMIT 1`
    );
    
    let certNumber = 'CERT-0001';
    if (lastCert && lastCert.cert_number) {
      const match = lastCert.cert_number.match(/^CERT-(\d+)$/);
      if (match) {
        const nextNum = parseInt(match[1]) + 1;
        certNumber = `CERT-${String(nextNum).padStart(4, '0')}`;
      }
    }
    
    const approvalStatus = req.user.role === 'admin' ? 'approved' : 'pending';
    
    const result = await query(
      `INSERT INTO certificates (cert_number, name, cert_type, asset_id, client_id, inspector_id, issued_by, issue_date, expiry_date, file_name, file_url, notes, approval_status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [certNumber, name, cert_type, asset_id, client_id || asset.client_id, inspector_id || null, issued_by, issue_date, expiry_date, file_name || null, file_url || null, notes || null, approvalStatus, req.user.sub]
    );
    
    const newCert = await queryOne('SELECT * FROM certificates WHERE id = ?', [result.insertId]);
    
    res.status(201).json({ success: true, certificate: newCert });
  } catch (error) {
    console.error('Create certificate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/certificates/:id
 * Update certificate (including approve/reject)
 */
router.patch('/:id', requireRole('admin', 'manager', 'technician'), async (req, res) => {
  try {
    const certificate = await queryOne('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
    
    if (!certificate) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }
    
    // Check permissions
    const isUploader = certificate.uploaded_by === req.user.sub;
    const isApprover = ['admin', 'manager'].includes(req.user.role);
    
    if (!isUploader && !isApprover) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    if (isUploader && !isApprover && certificate.approval_status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Cannot edit reviewed certificate' });
    }
    
    const { name, cert_type, asset_id, inspector_id, issued_by, issue_date, expiry_date, client_id, file_name, file_url, notes, approval_status, rejection_reason } = req.body;
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (cert_type !== undefined) { updates.push('cert_type = ?'); values.push(cert_type); }
    if (asset_id !== undefined) { updates.push('asset_id = ?'); values.push(asset_id); }
    if (inspector_id !== undefined) { updates.push('inspector_id = ?'); values.push(inspector_id); }
    if (issued_by !== undefined) { updates.push('issued_by = ?'); values.push(issued_by); }
    if (issue_date !== undefined) { updates.push('issue_date = ?'); values.push(issue_date); }
    if (expiry_date !== undefined) { updates.push('expiry_date = ?'); values.push(expiry_date); }
    if (client_id !== undefined) { updates.push('client_id = ?'); values.push(client_id); }
    if (file_name !== undefined) { updates.push('file_name = ?'); values.push(file_name); }
    if (file_url !== undefined) { updates.push('file_url = ?'); values.push(file_url); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    if (approval_status !== undefined) { updates.push('approval_status = ?'); values.push(approval_status); }
    if (rejection_reason !== undefined) { updates.push('rejection_reason = ?'); values.push(rejection_reason); }
    
    if (isApprover && approval_status) {
      updates.push('reviewed_by = ?'); values.push(req.user.sub);
      updates.push('reviewed_at = NOW()');
    }
    
    updates.push('updated_at = NOW()');
    values.push(req.params.id);
    
    await query(`UPDATE certificates SET ${updates.join(', ')} WHERE id = ?`, values);
    
    const updatedCert = await queryOne('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, certificate: updatedCert });
  } catch (error) {
    console.error('Update certificate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/certificates/:id
 * Delete certificate
 */
router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const certificate = await queryOne('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
    
    if (!certificate) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }
    
    await query('DELETE FROM certificates WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Certificate deleted successfully' });
  } catch (error) {
    console.error('Delete certificate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
