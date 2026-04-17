import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication - Admin/Manager only
router.use(requireAuth);
router.use(requireRole('admin', 'manager'));

/**
 * GET /api/inspectors
 * List all inspectors
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    const [inspectors] = await query(
      `SELECT * FROM inspectors ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(`SELECT COUNT(*) as total FROM inspectors ${whereClause}`, params);
    
    res.json({
      success: true,
      inspectors: inspectors || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get inspectors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/inspectors/:id
 * Get single inspector by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const inspector = await queryOne('SELECT * FROM inspectors WHERE id = ?', [req.params.id]);
    
    if (!inspector) {
      return res.status(404).json({ success: false, error: 'Inspector not found' });
    }
    
    res.json({ success: true, inspector });
  } catch (error) {
    console.error('Get inspector error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/inspectors
 * Create new inspector
 */
router.post('/', async (req, res) => {
  try {
    const { name, title, email, phone, status, experience_years, experience_desc, cv_file, cv_url, color, education, trainings, training_certs } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    const result = await query(
      `INSERT INTO inspectors (inspector_number, name, title, email, phone, status, experience_years, experience_desc, cv_file, cv_url, color, education, trainings, training_certs)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, title || null, email || null, phone || null, status || 'active', 
       experience_years || null, experience_desc || null, cv_file || null, cv_url || null, 
       color || '#0070f2', JSON.stringify(education || []), JSON.stringify(trainings || []), JSON.stringify(training_certs || [])]
    );
    
    const newInspector = await queryOne('SELECT * FROM inspectors WHERE id = ?', [result.insertId]);
    
    res.status(201).json({ success: true, inspector: newInspector });
  } catch (error) {
    console.error('Create inspector error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/inspectors/:id
 * Update inspector
 */
router.patch('/:id', async (req, res) => {
  try {
    const inspector = await queryOne('SELECT * FROM inspectors WHERE id = ?', [req.params.id]);
    
    if (!inspector) {
      return res.status(404).json({ success: false, error: 'Inspector not found' });
    }
    
    const { name, title, email, phone, status, experience_years, experience_desc, cv_file, cv_url, color, education, trainings, training_certs } = req.body;
    
    await query(
      `UPDATE inspectors SET 
       name = ?, title = ?, email = ?, phone = ?, status = ?, 
       experience_years = ?, experience_desc = ?, cv_file = ?, cv_url = ?, 
       color = ?, education = ?, trainings = ?, training_certs = ?, updated_at = NOW()
       WHERE id = ?`,
      [name ?? inspector.name, title ?? inspector.title, email ?? inspector.email, 
       phone ?? inspector.phone, status ?? inspector.status,
       experience_years ?? inspector.experience_years, experience_desc ?? inspector.experience_desc,
       cv_file ?? inspector.cv_file, cv_url ?? inspector.cv_url, color ?? inspector.color,
       JSON.stringify(education !== undefined ? education : JSON.parse(inspector.education || '[]')),
       JSON.stringify(trainings !== undefined ? trainings : JSON.parse(inspector.trainings || '[]')),
       JSON.stringify(training_certs !== undefined ? training_certs : JSON.parse(inspector.training_certs || '[]')),
       req.params.id]
    );
    
    const updatedInspector = await queryOne('SELECT * FROM inspectors WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, inspector: updatedInspector });
  } catch (error) {
    console.error('Update inspector error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/inspectors/:id
 * Delete inspector
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const inspector = await queryOne('SELECT * FROM inspectors WHERE id = ?', [req.params.id]);
    
    if (!inspector) {
      return res.status(404).json({ success: false, error: 'Inspector not found' });
    }
    
    await query('DELETE FROM inspectors WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Inspector deleted successfully' });
  } catch (error) {
    console.error('Delete inspector error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
