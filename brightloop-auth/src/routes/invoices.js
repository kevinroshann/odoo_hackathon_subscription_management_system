const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const InvoiceService = require('../services/invoiceService');
const { httpError } = require('../utils/httpError');

const invoiceService = new InvoiceService(db);

// Every billing endpoint is restricted to back-office users. Customers use
// /api/portal/invoices, which is scoped to their own customer_id.
router.use(authenticate, requireRole('admin', 'staff'));

function invoiceId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid invoice id');
  return id;
}

router.get('/', (req, res, next) => {
  try {
    res.json(invoiceService.listInvoices({
      status: req.query.status || null,
      customer_id: req.query.customer_id || null,
      subscription_id: req.query.subscription_id || null,
      from: req.query.from || null,
      to: req.query.to || null,
      q: req.query.q || req.query.search || null,
      overdue: req.query.overdue === 'true',
      limit: req.query.limit,
      offset: req.query.offset
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const invoice = invoiceService.getInvoice(invoiceId(req.params.id));
    if (!invoice) throw httpError(404, 'Invoice not found');
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', (req, res, next) => {
  try {
    const force = req.body?.force === true || req.query.force === 'true';
    const invoice = invoiceService.updateStatus(
      invoiceId(req.params.id),
      req.body?.status,
      { force }
    );
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/payments', (req, res, next) => {
  try {
    const id = invoiceId(req.params.id);
    const invoice = invoiceService.getInvoice(id);
    if (!invoice) throw httpError(404, 'Invoice not found');
    res.json({ payments: invoiceService.getPayments(id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/payments', (req, res, next) => {
  try {
    const result = invoiceService.recordPayment(invoiceId(req.params.id), req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
