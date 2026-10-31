const jwt = require('jsonwebtoken');
const db = require('../db');
const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';

exports.signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, SECRET(), { expiresIn: '8h' });

// Attaches req.user from the httpOnly cookie or a Bearer token.
exports.authenticate = (req, res, next) => {
  const h = req.headers.authorization;
  const token = req.cookies?.token || (h?.startsWith('Bearer ') ? h.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    const { sub } = jwt.verify(token, SECRET());
    const user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user; next();
  } catch { res.status(401).json({ error: 'Session expired. Please log in again.' }); }
};

// Usage: router.post('/x', authenticate, requireRole('admin','staff'), handler)
exports.requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next()
    : res.status(403).json({ error: 'You do not have permission to do this.' });
