import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/functional-locations
 * List all functional locations
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 100, offset = 0, status, type } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    // Role-based filtering
    if (!['admin', 'manager'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND client_id = ?';
      params.push(req.user.customerId);
    }
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    
    const [locations] = await query(
      `SELECT fl.*, c.name as client_name 
       FROM functional_locations fl
       LEFT JOIN clients c ON fl.client_id = c.client_id
       ${whereClause}
       ORDER BY fl.fl_id ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(`SELECT COUNT(*) as total FROM functional_locations fl ${whereClause}`, params);
    
    res.json({
      success: true,
      functional_locations: locations || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get functional locations error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/functional-locations/:id
 * Get single functional location by ID or fl_id
 */
router.get('/:id', async (req, res) => {
  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id);
    const where = isUUID ? 'fl.id = ?' : 'fl.fl_id = ?';
    
    const location = await queryOne(
      `SELECT fl.*, c.name as client_name 
       FROM functional_locations fl
       LEFT JOIN clients c ON fl.client_id = c.client_id
       WHERE ${where}`,
      [req.params.id]
    );
    
    if (!location) {
      return res.status(404).json({ success: false, error: 'Functional location not found' });
    }
    
    // Check permissions
    if (!['admin', 'manager'].includes(req.user.role) && req.user.customerId && location.client_id !== req.user.customerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    res.json({ success: true, functional_location: location });
  } catch (error) {
    console.error('Get functional location error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/functional-locations
 * Create new functional location (admin only)
 */
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { fl_id, name, type, client_id, status, notes } = req.body;
    
    // Validate required fields
    if (!fl_id || !name || !type || !client_id) {
      return res.status(400).json({ success: false, error: 'fl_id, name, type, and client_id are required' });
    }
    
    // Check for duplicate
    const existing = await queryOne('SELECT id FROM functional_locations WHERE LOWER(fl_id) = LOWER(?)', [fl_id]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Functional location ID already exists' });
    }
    
    const result = await query(
      `INSERT INTO functional_locations (fl_id, name, type, status, client_id, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fl_id.toUpperCase(), name, type, status || 'active', client_id, notes || null]
    );
    
    const newLocation = await queryOne('SELECT * FROM functional_locations WHERE id = ?', [result.insertId]);
    
    res.status(201).json({ success: true, functional_location: newLocation });
  } catch (error) {
    console.error('Create functional location error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/functional-locations/:id
 * Update functional location (admin only)
 */
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const location = await queryOne('SELECT * FROM functional_locations WHERE id = ?', [req.params.id]);
    
    if (!location) {
      return res.status(404).json({ success: false, error: 'Functional location not found' });
    }
    
    const { name, type, status, client_id, notes } = req.body;
    
    await query(
      `UPDATE functional_locations SET 
       name = ?, type = ?, status = ?, client_id = ?, notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [name ?? location.name, type ?? location.type, status ?? location.status, 
       client_id ?? location.client_id, notes ?? location.notes, req.params.id]
    );
    
    const updatedLocation = await queryOne('SELECT * FROM functional_locations WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, functional_location: updatedLocation });
  } catch (error) {
    console.error('Update functional location error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/functional-locations/:id
 * Delete functional location (admin only)
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const location = await queryOne('SELECT * FROM functional_locations WHERE id = ?', [req.params.id]);
    
    if (!location) {
      return res.status(404).json({ success: false, error: 'Functional location not found' });
    }
    
    await query('DELETE FROM functional_locations WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Functional location deleted successfully' });
  } catch (error) {
    console.error('Delete functional location error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
