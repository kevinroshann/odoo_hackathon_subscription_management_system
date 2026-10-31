require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('node:path');

const db = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');
const DiscountService = require('../../subscription-app/src/services/discountService');
const BillingService = require('./services/billingService');
const InvoiceService = require('./services/invoiceService');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60e3, max: 100, standardHeaders: true }));

const discountService = new DiscountService(db);
const billingService = new BillingService({ db, discountService });
const invoiceService = new InvoiceService(db);

// Member 1: Authentication, RBAC and customer portal.
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/portal', require('./routes/portal'));

// Member 3 operational endpoints. Registered before /api/admin so staff (not
// just admins) can trigger a billing run.
app.post('/api/admin/billing/run', authenticate, requireRole('admin', 'staff'), (req, res, next) => {
  try {
    const summary = billingService.runBillingSweep({ asOf: req.body?.asOf || req.body?.as_of });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/billing/sync', authenticate, requireRole('admin', 'staff'), (_req, res, next) => {
  try {
    res.json({ summary: billingService.syncActiveQuotations() });
  } catch (err) {
    next(err);
  }
});

app.use('/api/admin', require('./routes/admin'));

// Member 3: invoices, payments and tax rules (admin + staff only).
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/tax-rules', require('./routes/taxRules'));

// Static assets for the auth/portal front-end.
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  const statusCode = Number(err.statusCode) || 400;
  if (statusCode >= 500) console.error('Server error:', err);
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
});

function start(port = process.env.PORT || 3001) {
  try {
    const sync = billingService.syncActiveQuotations();
    if (sync.synced > 0 || sync.errors.length > 0) {
      console.log(
        `[billing] member 2 sync: ${sync.synced} subscription(s) created` +
        (sync.errors.length ? `, ${sync.errors.length} error(s)` : '')
      );
    }
  } catch (err) {
    console.error('[billing] initial member 2 sync failed:', err);
  }

  const server = app.listen(port, () => {
    console.log('====================================================');
    console.log('Brightloop Subscription Management System');
    console.log(`Server listening on: http://localhost:${port}`);
    console.log('Member 1: Auth, RBAC & Customer Portal');
    console.log('Member 2: Products, Plans, Quotations & Discounts');
    console.log('Member 3: Billing Automation, Taxes & Payments');
    console.log('====================================================');
  });

  if (process.env.DISABLE_BILLING_CRON !== 'true') {
    billingService.startCron();
  }
  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  db,
  billingService,
  invoiceService,
  discountService,
  start
};
