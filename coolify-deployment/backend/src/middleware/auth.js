import jwt from 'jsonwebtoken';

/**
 * Sign a JWT token
 */
export function signJwt(payload, secret, expiresIn = '24h') {
  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Verify a JWT token
 */
export function verifyJwt(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}

/**
 * Extract and verify JWT from Authorization header
 */
export function getTokenFromHeader(authHeader, secret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  return verifyJwt(token, secret);
}

/**
 * Middleware to protect routes requiring authentication
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const session = getTokenFromHeader(authHeader, process.env.JWT_SECRET);
  
  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  req.user = session;
  next();
}

/**
 * Check if user has required role(s)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    next();
  };
}
