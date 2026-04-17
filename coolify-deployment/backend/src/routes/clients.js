import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication - Admin only
router.use(requireAuth);
router.use(requireRole('admin'));

/**
 * GET /api/clients
 * List all clients
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
    
    const [clients] = await query(
      `SELECT * FROM clients ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(`SELECT COUNT(*) as total FROM clients ${whereClause}`, params);
    
    res.json({
      success: true,
      clients: clients || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/clients/:id
 * Get single client by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    
    res.json({ success: true, client });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/clients
 * Create new client
 */
router.post('/', async (req, res) => {
  try {
    const { client_id, name, name_ar, industry, contact, email, phone, country, city, status, contract_start, contract_end, notes, color } = req.body;
    
    // Validate required fields
    if (!client_id || !name) {
      return res.status(400).json({ success: false, error: 'client_id and name are required' });
    }
    
    // Check for duplicate
    const existing = await queryOne('SELECT id FROM clients WHERE client_id = ?', [client_id.toUpperCase()]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Client ID already exists' });
    }
    
    const result = await query(
      `INSERT INTO clients (client_id, name, name_ar, industry, contact, email, phone, country, city, status, contract_start, contract_end, notes, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id.toUpperCase(), name, name_ar || null, industry || null, contact || null, email || null, 
       phone || null, country || null, city || null, status || 'active', contract_start || null, 
       contract_end || null, notes || null, color || '#0070f2']
    );
    
    const newClient = await queryOne('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    
    res.status(201).json({ success: true, client: newClient });
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/clients/:id
 * Update client
 */
router.patch('/:id', async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    
    const { name, name_ar, industry, contact, email, phone, country, city, status, contract_start, contract_end, notes, color } = req.body;
    
    await query(
      `UPDATE clients SET 
       name = ?, name_ar = ?, industry = ?, contact = ?, email = ?, phone = ?, 
       country = ?, city = ?, status = ?, contract_start = ?, contract_end = ?, 
       notes = ?, color = ?, updated_at = NOW()
       WHERE id = ?`,
      [name ?? client.name, name_ar ?? client.name_ar, industry ?? client.industry, 
       contact ?? client.contact, email ?? client.email, phone ?? client.phone,
       country ?? client.country, city ?? client.city, status ?? client.status,
       contract_start ?? client.contract_start, contract_end ?? client.contract_end,
       notes ?? client.notes, color ?? client.color, req.params.id]
    );
    
    const updatedClient = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, client: updatedClient });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/clients/:id
 * Delete client
 */
router.delete('/:id', async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    
    await query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
