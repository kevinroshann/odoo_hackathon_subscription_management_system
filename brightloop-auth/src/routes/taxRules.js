const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../utils/httpError');

router.use(authenticate, requireRole('admin', 'staff'));

function taxRuleId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid tax rule id');
  return id;
}

function validatePercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw httpError(400, 'percentage must be a number between 0 and 100');
  }
  return percentage;
}

router.get('/', (req, res, next) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const rows = activeOnly
      ? db.prepare('SELECT * FROM tax_rules WHERE is_active = 1 ORDER BY id ASC').all()
      : db.prepare('SELECT * FROM tax_rules ORDER BY is_active DESC, id ASC').all();
    res.json(rows.map((rule) => ({ ...rule, is_active: Boolean(rule.is_active) })));
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const { name, percentage, is_active } = req.body || {};
    if (!String(name || '').trim()) throw httpError(400, 'name is required');

    const result = db.prepare(`
      INSERT INTO tax_rules (name, percentage, is_active)
      VALUES (?, ?, ?)
    `).run(
      String(name).trim(),
      validatePercentage(percentage),
      is_active === false || is_active === 0 || is_active === '0' ? 0 : 1
    );

    const rule = db.prepare('SELECT * FROM tax_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ tax_rule: { ...rule, is_active: Boolean(rule.is_active) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = taxRuleId(req.params.id);
    const existing = db.prepare('SELECT * FROM tax_rules WHERE id = ?').get(id);
    if (!existing) throw httpError(404, 'Tax rule not found');

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) throw httpError(400, 'name cannot be empty');

    const percentage = req.body?.percentage !== undefined
      ? validatePercentage(req.body.percentage)
      : Number(existing.percentage);

    const isActive = req.body?.is_active !== undefined
      ? (req.body.is_active ? 1 : 0)
      : Number(existing.is_active);

    db.prepare(`
      UPDATE tax_rules
      SET name = ?, percentage = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, percentage, isActive, id);

    const rule = db.prepare('SELECT * FROM tax_rules WHERE id = ?').get(id);
    res.json({ tax_rule: { ...rule, is_active: Boolean(rule.is_active) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const result = db.prepare('DELETE FROM tax_rules WHERE id = ?').run(taxRuleId(req.params.id));
    if (!result.changes) throw httpError(404, 'Tax rule not found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
