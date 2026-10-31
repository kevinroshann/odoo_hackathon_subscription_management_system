const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { passwordError, EMAIL_RE } = require('./auth');

router.use(authenticate, requireRole('admin'));

// Admin-only: create a staff member
router.post('/staff', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });
  const pe = passwordError(password);
  if (pe) return res.status(400).json({ error: pe });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
    .run(name.trim(), email.trim(), bcrypt.hashSync(password, 12), 'staff').lastInsertRowid;
  res.status(201).json({ user: { id, name: name.trim(), email, role: 'staff' } });
});

router.get('/staff', (_req, res) =>
  res.json({ staff: db.prepare("SELECT id,name,email,created_at FROM users WHERE role='staff' ORDER BY id DESC").all() }));

router.delete('/staff/:id', (req, res) => {
  const r = db.prepare("DELETE FROM users WHERE id=? AND role='staff'").run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Staff member not found.' });
});

module.exports = router;
