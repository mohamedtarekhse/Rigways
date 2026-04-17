import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/notifications/unread-count
 * Get count of unread notifications
 */
router.get('/unread-count', async (req, res) => {
  try {
    const [result] = await query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.sub]
    );
    
    res.json({
      success: true,
      count: result?.count || 0
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read
 */
router.post('/mark-all-read', async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0`,
      [req.user.sub]
    );
    
    res.json({ success: true, marked: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications
 * List notifications for current user
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, unread } = req.query;
    
    let whereClause = 'WHERE user_id = ?';
    const params = [req.user.sub];
    
    if (unread === 'true') {
      whereClause += ' AND is_read = 0';
    }
    
    const [notifications] = await query(
      `${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const [countResult] = await query(`SELECT COUNT(*) as total FROM notifications ${whereClause}`, params);
    
    res.json({
      success: true,
      notifications: notifications || [],
      total: countResult?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PATCH /api/notifications/:id
 * Mark notification as read/unread
 */
router.patch('/:id', async (req, res) => {
  try {
    const notification = await queryOne('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    
    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    
    if (notification.user_id !== req.user.sub) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const { is_read } = req.body;
    
    if (typeof is_read !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_read must be a boolean' });
    }
    
    await query(
      `UPDATE notifications SET is_read = ?, read_at = ? WHERE id = ?`,
      [is_read ? 1 : 0, is_read ? new Date() : null, req.params.id]
    );
    
    const updated = await queryOne('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, notification: updated });
  } catch (error) {
    console.error('Update notification error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', async (req, res) => {
  try {
    const notification = await queryOne('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    
    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    
    if (notification.user_id !== req.user.sub) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    await query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
