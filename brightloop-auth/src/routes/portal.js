const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Every query is scoped to req.user.id: customers can never see others' data.
router.use(authenticate, requireRole('customer'));

router.get('/summary', (req, res) => {
  const id = req.user.id;
  res.json({
    activeSubscriptions: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE customer_id=? AND status='Active'").get(id).c,
    outstanding: db.prepare("SELECT COALESCE(SUM(total),0) s FROM invoices WHERE customer_id=? AND status!='Paid'").get(id).s,
    unpaidInvoices: db.prepare("SELECT COUNT(*) c FROM invoices WHERE customer_id=? AND status!='Paid'").get(id).c
  });
});

router.get('/subscriptions', (req, res) =>
  res.json({ subscriptions: db.prepare('SELECT * FROM subscriptions WHERE customer_id=? ORDER BY id DESC').all(req.user.id) }));

router.get('/invoices', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM invoices WHERE customer_id=? AND status=? ORDER BY id DESC').all(req.user.id, status)
    : db.prepare('SELECT * FROM invoices WHERE customer_id=? ORDER BY id DESC').all(req.user.id);
  res.json({ invoices: rows });
});

// Customer self-service: close their own subscription
router.post('/subscriptions/:id/close', (req, res) => {
  const s = db.prepare('SELECT * FROM subscriptions WHERE id=? AND customer_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Subscription not found.' });
  if (s.status === 'Closed') return res.status(400).json({ error: 'Already closed.' });
  db.prepare("UPDATE subscriptions SET status='Closed' WHERE id=?").run(s.id);
  res.json({ ok: true });
});

module.exports = router;
