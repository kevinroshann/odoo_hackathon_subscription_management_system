const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { sendResetEmail } = require('../mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// >8 chars (min 9), uppercase, lowercase, special character
const passwordError = (p) => {
  if (typeof p !== 'string' || p.length <= 8) return 'Password must be more than 8 characters.';
  if (!/[A-Z]/.test(p)) return 'Password needs an uppercase letter.';
  if (!/[a-z]/.test(p)) return 'Password needs a lowercase letter.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password needs a special character.';
  return null;
};

const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600e3 };
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Public sign-up always creates a CUSTOMER. Staff are created by admin only.
router.post('/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });
  const pe = passwordError(password);
  if (pe) return res.status(400).json({ error: pe });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
    .run(name.trim(), email.trim(), bcrypt.hashSync(password, 12), 'customer').lastInsertRowid;
  const user = { id, name: name.trim(), email, role: 'customer' };
  res.cookie('token', signToken(user), cookieOpts).status(201).json({ user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  res.cookie('token', signToken(u), cookieOpts)
    .json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

router.post('/logout', (_req, res) => res.clearCookie('token').json({ ok: true }));
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// Always responds the same so emails can't be enumerated.
router.post('/forgot-password', async (req, res) => {
  const u = db.prepare('SELECT id,email FROM users WHERE email=?').get(req.body?.email || '');
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,?)')
      .run(u.id, hash(token), Date.now() + 3600e3);
    try { await sendResetEmail(u.email, `${process.env.APP_URL || 'http://localhost:3000'}/#reset=${token}`); }
    catch (e) { console.error('Mail error:', e.message); }
  }
  res.json({ message: 'If that email is registered, a reset link is on its way.' });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  const pe = passwordError(password);
  if (pe) return res.status(400).json({ error: pe });
  const r = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at>?')
    .get(hash(token || ''), Date.now());
  if (!r) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), r.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(r.user_id);
  })();
  res.json({ message: 'Password updated. You can log in now.' });
});

module.exports = { router, passwordError, EMAIL_RE };
