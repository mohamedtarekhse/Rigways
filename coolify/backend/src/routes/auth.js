import { Router } from 'express';
import { query, queryOne } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signJwt, getTokenFromHeader } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    // Find user by username (case-insensitive)
    const users = await query(
      `SELECT id, username, name, name_ar, role, customer_id, password_hash, is_active, created_at, last_login_at 
       FROM users 
       WHERE LOWER(username) = LOWER(?) 
       LIMIT 1`,
      [username]
    );
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    const user = users[0];
    
    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }
    
    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    
    // Generate JWT
    const expiresIn = parseInt(process.env.JWT_EXPIRES_SEC) || 86400;
    const token = signJwt({
      sub: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      nameAr: user.name_ar || '',
      customerId: user.customer_id || null,
    }, process.env.JWT_SECRET, `${expiresIn}s`);
    
    res.json({
      success: true,
      token,
      expiresIn,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        nameAr: user.name_ar || '',
        customerId: user.customer_id || null,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const session = getTokenFromHeader(authHeader, process.env.JWT_SECRET);
    
    if (!session) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const users = await query(
      `SELECT id, username, name, name_ar, role, customer_id, is_active, created_at, last_login_at 
       FROM users 
       WHERE id = ? 
       LIMIT 1`,
      [session.sub]
    );
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    const user = users[0];
    
    if (!user.is_active) {
      return res.status(401).json({ success: false, error: 'Account is inactive' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        nameAr: user.name_ar || '',
        customerId: user.customer_id || null,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (stateless - client just removes token)
 */
router.post('/logout', async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
