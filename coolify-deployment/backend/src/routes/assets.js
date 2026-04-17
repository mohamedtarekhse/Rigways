import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/assets
 * List all assets with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status, asset_type, client_id, search } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    // Role-based filtering
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND (a.client_id = ? OR a.client_id IS NULL)';
      params.push(req.user.customerId);
    }
    
    if (status) {
      whereClause += ' AND a.status = ?';
      params.push(status);
    }
    
    if (asset_type) {
      whereClause += ' AND a.asset_type = ?';
      params.push(asset_type);
    }
    
    if (client_id && ['admin', 'manager'].includes(req.user.role)) {
      whereClause += ' AND a.client_id = ?';
      params.push(client_id);
    }
    
    if (search) {
      whereClause += ' AND (a.name LIKE ? OR a.asset_number LIKE ? OR a.serial_number LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    const [assets] = await query(
      `SELECT a.*, c.name as client_name 
       FROM assets a
       LEFT JOIN clients c ON a.client_id = c.client_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM assets a ${whereClause.replace('a.', 'a.')}`,
      params
    );
    
    res.json({
      success: true,
      assets: assets || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get assets error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/assets/stats
 * Get dashboard statistics for assets
 */
router.get('/stats', async (req, res) => {
  try {
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      params.push(req.user.customerId);
    }
    
    const [total] = await query(`SELECT COUNT(*) as count FROM assets ${whereClause}`, params);
    const [active] = await query(`SELECT COUNT(*) as count FROM assets ${whereClause} AND status = 'operation'`, params);
    const [stacked] = await query(`SELECT COUNT(*) as count FROM assets ${whereClause} AND status = 'stacked'`, params);
    
    res.json({
      success: true,
      stats: {
        total: total?.count || 0,
        active: active?.count || 0,
        stacked: stacked?.count || 0,
        inactive: (total?.count || 0) - (active?.count || 0)
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/assets/:id
 * Get single asset by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const asset = await queryOne(
      `SELECT a.*, c.name as client_name 
       FROM assets a
       LEFT JOIN clients c ON a.client_id = c.client_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    // Check permissions
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId && asset.client_id !== req.user.customerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    res.json({ success: true, asset });
  } catch (error) {
    console.error('Get asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/assets
 * Create new asset
 */
router.post('/', requireRole('admin', 'manager', 'technician'), async (req, res) => {
  try {
    const { name, asset_type, status, client_id, functional_location, serial_number, manufacturer, model, description, notes } = req.body;
    
    // Validate required fields
    if (!name || !asset_type || !status) {
      return res.status(400).json({ success: false, error: 'Name, asset_type, and status are required' });
    }
    
    // Generate next asset number
    const [lastAsset] = await query(
      `SELECT asset_number FROM assets WHERE asset_number REGEXP '^AST-[0-9]+$' ORDER BY asset_number DESC LIMIT 1`
    );
    
    let assetNumber = 'AST-0001';
    if (lastAsset && lastAsset.asset_number) {
      const match = lastAsset.asset_number.match(/^AST-(\d+)$/);
      if (match) {
        const nextNum = parseInt(match[1]) + 1;
        assetNumber = `AST-${String(nextNum).padStart(4, '0')}`;
      }
    }
    
    const result = await query(
      `INSERT INTO assets (asset_number, name, asset_type, status, client_id, functional_location, serial_number, manufacturer, model, description, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [assetNumber, name, asset_type, status, client_id || null, functional_location || null, serial_number || null, manufacturer || null, model || null, description || null, notes || null, req.user.sub, req.user.sub]
    );
    
    const newAsset = await queryOne('SELECT * FROM assets WHERE id = ?', [result.insertId]);
    
    res.status(201).json({ success: true, asset: newAsset });
  } catch (error) {
    console.error('Create asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/assets/:id
 * Update asset
 */
router.patch('/:id', requireRole('admin', 'manager', 'technician'), async (req, res) => {
  try {
    const asset = await queryOne('SELECT * FROM assets WHERE id = ?', [req.params.id]);
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    // Check permissions
    if (['user', 'technician'].includes(req.user.role) && req.user.customerId && asset.client_id !== req.user.customerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const { name, asset_type, status, client_id, functional_location, serial_number, manufacturer, model, description, notes } = req.body;
    
    await query(
      `UPDATE assets SET 
       name = ?, asset_type = ?, status = ?, client_id = ?, functional_location = ?, 
       serial_number = ?, manufacturer = ?, model = ?, description = ?, notes = ?, updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [name || asset.name, asset_type || asset.asset_type, status || asset.status, client_id ?? asset.client_id, 
       functional_location ?? asset.functional_location, serial_number ?? asset.serial_number, 
       manufacturer ?? asset.manufacturer, model ?? asset.model, description ?? asset.description, 
       notes ?? asset.notes, req.user.sub, req.params.id]
    );
    
    const updatedAsset = await queryOne('SELECT * FROM assets WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, asset: updatedAsset });
  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/assets/:id
 * Delete asset
 */
router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const asset = await queryOne('SELECT * FROM assets WHERE id = ?', [req.params.id]);
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    await query('DELETE FROM assets WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
