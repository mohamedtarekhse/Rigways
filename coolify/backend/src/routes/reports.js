import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/reports/summary
 * Get comprehensive dashboard summary report
 */
router.get('/summary', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    
    // Build client filter based on role
    let clientFilter = '';
    const filterParams = [];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      clientFilter = 'AND client_id = ?';
      filterParams.push(req.user.customerId);
    }
    
    // Fetch all counts in parallel
    const [
      totalAssets,
      activeAssets,
      operationAssets,
      stackedAssets,
      totalCerts,
      validCerts,
      expiringSoon,
      expiredCerts,
      pendingCerts,
      totalClients,
      activeClients,
      totalInspectors,
      activeInspectors
    ] = await Promise.all([
      // Assets
      query(`SELECT COUNT(*) as count FROM assets WHERE 1=1 ${clientFilter}`, filterParams),
      query(`SELECT COUNT(*) as count FROM assets WHERE status = 'active' ${clientFilter}`, filterParams),
      query(`SELECT COUNT(*) as count FROM assets WHERE status = 'operation' ${clientFilter}`, filterParams),
      query(`SELECT COUNT(*) as count FROM assets WHERE status = 'stacked' ${clientFilter}`, filterParams),
      // Certificates
      query(`SELECT COUNT(*) as count FROM certificates WHERE 1=1 ${clientFilter}`, filterParams),
      query(`SELECT COUNT(*) as count FROM certificates WHERE approval_status = 'approved' AND expiry_date > ? ${clientFilter}`, [thirtyDays, ...filterParams]),
      query(`SELECT COUNT(*) as count FROM certificates WHERE approval_status = 'approved' AND expiry_date BETWEEN ? AND ? ${clientFilter}`, [today, thirtyDays, ...filterParams]),
      query(`SELECT COUNT(*) as count FROM certificates WHERE approval_status = 'approved' AND expiry_date < ? ${clientFilter}`, [today, ...filterParams]),
      query(`SELECT COUNT(*) as count FROM certificates WHERE approval_status = 'pending' ${clientFilter}`, filterParams),
      // Clients
      query('SELECT COUNT(*) as count FROM clients WHERE 1=1', []),
      query('SELECT COUNT(*) as count FROM clients WHERE status = ?', ['active']),
      // Inspectors
      query('SELECT COUNT(*) as count FROM inspectors WHERE 1=1', []),
      query('SELECT COUNT(*) as count FROM inspectors WHERE status = ?', ['active'])
    ]);
    
    res.json({
      success: true,
      summary: {
        assets: {
          total: totalAssets[0]?.count || 0,
          active: activeAssets[0]?.count || 0,
          operation: operationAssets[0]?.count || 0,
          stacked: stackedAssets[0]?.count || 0,
          inactive: (totalAssets[0]?.count || 0) - (activeAssets[0]?.count || 0)
        },
        certificates: {
          total: totalCerts[0]?.count || 0,
          valid: validCerts[0]?.count || 0,
          expiring: expiringSoon[0]?.count || 0,
          expired: expiredCerts[0]?.count || 0,
          pending: pendingCerts[0]?.count || 0
        },
        clients: {
          total: totalClients[0]?.count || 0,
          active: activeClients[0]?.count || 0
        },
        inspectors: {
          total: totalInspectors[0]?.count || 0,
          active: activeInspectors[0]?.count || 0
        }
      }
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/reports/expiring
 * Get expiring certificates report
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
 * GET /api/reports/assets-by-type
 * Get assets grouped by type
 */
router.get('/assets-by-type', async (req, res) => {
  try {
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      params.push(req.user.customerId);
    }
    
    const [results] = await query(
      `SELECT asset_type, COUNT(*) as count, 
              SUM(CASE WHEN status = 'operation' THEN 1 ELSE 0 END) as operation_count,
              SUM(CASE WHEN status = 'stacked' THEN 1 ELSE 0 END) as stacked_count
       FROM assets 
       ${whereClause}
       GROUP BY asset_type
       ORDER BY count DESC`,
      params
    );
    
    res.json({
      success: true,
      data: results || []
    });
  } catch (error) {
    console.error('Get assets by type error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/reports/certificates-by-type
 * Get certificates grouped by type
 */
router.get('/certificates-by-type', async (req, res) => {
  try {
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      params.push(req.user.customerId);
    }
    
    const [results] = await query(
      `SELECT cert_type, COUNT(*) as count,
              SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved_count,
              SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) as pending_count
       FROM certificates 
       ${whereClause}
       GROUP BY cert_type
       ORDER BY count DESC`,
      params
    );
    
    res.json({
      success: true,
      data: results || []
    });
  } catch (error) {
    console.error('Get certificates by type error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
