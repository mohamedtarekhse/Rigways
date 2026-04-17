import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/users
 * List all users (admin/manager only see all, others see limited)
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, role, is_active } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    // Non-admin users can only see their own client's users
    if (!['admin'].includes(req.user.role) && req.user.customerId) {
      whereClause += ' AND customer_id = ?';
      params.push(req.user.customerId);
    }
    
    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }
    
    if (is_active !== undefined) {
      whereClause += ' AND is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }
    
    const [users] = await query(
      `SELECT id, username, name, name_ar, role, customer_id, is_active, last_login_at, created_at 
       FROM users ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params);
    
    res.json({
      success: true,
      users: users || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/users/:id
 * Get single user by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT id, username, name, name_ar, role, customer_id, is_active, last_login_at, created_at 
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/users
 * Create new user (admin only)
 */
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { username, name, name_ar, role, customer_id, password, is_active } = req.body;
    
    // Validate required fields
    if (!username || !name || !password) {
      return res.status(400).json({ success: false, error: 'username, name, and password are required' });
    }
    
    // Check for duplicate username
    const existing = await queryOne('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username already exists' });
    }
    
    // Hash password
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await query(
      `INSERT INTO users (username, name, name_ar, role, customer_id, password_hash, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username.toLowerCase(), name, name_ar || null, role || 'user', customer_id || null, passwordHash, is_active !== false ? 1 : 0]
    );
    
    const newUser = await queryOne(
      `SELECT id, username, name, name_ar, role, customer_id, is_active, created_at 
       FROM users WHERE id = ?`,
      [result.insertId]
    );
    
    res.status(201).json({ success: true, user: newUser });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/users/:id
 * Update user
 */
router.patch('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Managers can only update users in their client org
    if (req.user.role === 'manager' && req.user.customerId && user.customer_id !== req.user.customerId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const { name, name_ar, role, customer_id, is_active, password } = req.body;
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (name_ar !== undefined) { updates.push('name_ar = ?'); values.push(name_ar); }
    if (role !== undefined && req.user.role === 'admin') { updates.push('role = ?'); values.push(role); }
    if (customer_id !== undefined && req.user.role === 'admin') { updates.push('customer_id = ?'); values.push(customer_id); }
    if (is_active !== undefined && req.user.role === 'admin') { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (password) {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?'); values.push(passwordHash);
    }
    
    updates.push('updated_at = NOW()');
    values.push(req.params.id);
    
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    
    const updatedUser = await queryOne(
      `SELECT id, username, name, name_ar, role, customer_id, is_active, updated_at 
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/users/:id
 * Delete user (admin only)
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Prevent self-deletion
    if (user.id === req.user.sub) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }
    
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
