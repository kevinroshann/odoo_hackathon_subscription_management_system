process.env.SKIP_SEED = 'true';
process.env.SEED_DEMO = 'false';
process.env.DB_FILE = ':memory:';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { openDatabase, seedDemoPortal } = require('../src/database');
const BillingService = require('../src/services/billingService');
const InvoiceService = require('../src/services/invoiceService');
const { addInterval } = require('../src/services/billingService');

const ProductService = require('../../subscription-app/src/services/productService');
const PlanService = require('../../subscription-app/src/services/planService');
const DiscountService = require('../../subscription-app/src/services/discountService');
const TemplateService = require('../../subscription-app/src/services/templateService');
const QuotationService = require('../../subscription-app/src/services/quotationService');

let subscriptionSequence = 0;

function makeFixture() {
  const db = openDatabase(':memory:');
  const customerId = Number(db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Test Customer', 'customer@example.com', 'x', 'customer')"
  ).run().lastInsertRowid);
  return { db, customerId };
}

function makeBillingService(db, date = '2026-10-31') {
  return new BillingService({
    db,
    discountService: new DiscountService(db),
    now: () => new Date(`${date}T12:00:00.000Z`),
    logger: { log() {}, error() {} }
  });
}

function addSubscription(db, customerId, overrides = {}) {
  subscriptionSequence += 1;
  const values = {
    number: `TEST-SUB-${subscriptionSequence}`,
    status: 'Active',
    plan_name: 'Test Plan',
    start_date: '2026-09-01',
    billing_period: 'monthly',
    amount: 1000,
    billing_frequency: 'monthly',
    billing_interval: 1,
    next_billing_date: '2026-10-31',
    discount_id: null,
    ...overrides
  };

  return Number(db.prepare(`
    INSERT INTO subscriptions (
      number, customer_id, plan_name, status, start_date, billing_period,
      amount, billing_frequency, billing_interval, next_billing_date, discount_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.number, customerId, values.plan_name, values.status,
    values.start_date, values.billing_period, values.amount,
    values.billing_frequency, values.billing_interval,
    values.next_billing_date, values.discount_id
  ).lastInsertRowid);
}

function addTaxRule(db, name, percentage, isActive = 1) {
  return Number(db.prepare(
    'INSERT INTO tax_rules (name, percentage, is_active) VALUES (?, ?, ?)'
  ).run(name, percentage, isActive).lastInsertRowid);
}

function invoiceCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count);
}

test('Billing: multiple active tax rules are applied to the discounted subtotal', () => {
  const { db, customerId } = makeFixture();
  addTaxRule(db, 'VAT', 10);
  addTaxRule(db, 'City Tax', 5);
  addTaxRule(db, 'Inactive Rule', 50, 0);

  const subscriptionId = addSubscription(db, customerId, { amount: 1000 });
  const service = makeBillingService(db);
  const result = service.billSubscription(subscriptionId, { asOf: '2026-10-31' });

  assert.strictEqual(result.skipped, false);
  const invoice = result.invoice;
  assert.strictEqual(invoice.status, 'Draft');
  assert.strictEqual(invoice.subtotal, 1000);
  assert.strictEqual(invoice.discount_total, 0);
  assert.strictEqual(invoice.tax_total, 150);
  assert.strictEqual(invoice.total_amount, 1150);
  assert.strictEqual(invoice.total, 1150); // legacy portal column
  assert.strictEqual(invoice.customer_id, customerId);
  assert.strictEqual(invoice.balance, 1150);

  const baseLines = invoice.line_items.filter((line) => line.line_type === 'base');
  const taxLines = invoice.line_items.filter((line) => line.line_type === 'tax');
  assert.strictEqual(baseLines.length, 1);
  assert.strictEqual(taxLines.length, 2);
  assert.deepStrictEqual(taxLines.map((line) => line.amount).sort((a, b) => a - b), [50, 100]);

  const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
  assert.strictEqual(subscription.next_billing_date, '2026-11-30');
  assert.strictEqual(subscription.last_billed_date, '2026-10-31');
});

test('Billing: Member 2 discountService produces discount line items', () => {
  const { db, customerId } = makeFixture();
  addTaxRule(db, 'VAT', 10);

  const discountId = Number(db.prepare(`
    INSERT INTO discounts (code, name, type, value, scope, active)
    VALUES ('SAVE10', 'Ten Percent Off', 'percentage', 10, 'whole_subscription', 1)
  `).run().lastInsertRowid);

  const subscriptionId = addSubscription(db, customerId, {
    amount: 1200,
    discount_id: discountId
  });

  const service = makeBillingService(db);
  const { invoice } = service.billSubscription(subscriptionId, { asOf: '2026-10-31' });

  assert.strictEqual(invoice.subtotal, 1200);
  assert.strictEqual(invoice.discount_total, 120);
  assert.strictEqual(invoice.tax_total, 108); // 10% of 1080
  assert.strictEqual(invoice.total_amount, 1188);

  const discountLine = invoice.line_items.find((line) => line.line_type === 'discount');
  assert.ok(discountLine);
  assert.strictEqual(discountLine.amount, -120);
});

test('Billing: Member 2 Active quotation is synced into a billable subscription', () => {
  const { db } = makeFixture();
  addTaxRule(db, 'VAT', 10);

  const productService = new ProductService(db);
  const planService = new PlanService(db);
  const discountService = new DiscountService(db);
  const templateService = new TemplateService(db);
  const quotationService = new QuotationService(db, {
    productService,
    planService,
    discountService,
    templateService
  });

  const product = productService.createProduct({
    code: 'M3-ERP', name: 'Member 3 ERP', type: 'Software', sales_price: 1000
  });
  const plan = planService.createPlan({
    code: 'M3-MONTHLY', name: 'Monthly Plan',
    billing_frequency: 'monthly', billing_interval: 1, base_fee: 0, min_quantity: 1
  });
  const discount = discountService.createDiscount({
    code: 'M3-SAVE10', name: 'Ten Percent Off',
    type: 'percentage', value: 10,
    scope: 'whole_subscription', min_purchase_amount: 0, min_quantity: 1
  });

  const quotation = quotationService.createQuotation({
    customer_name: 'Acme Member 2 Customer',
    customer_email: 'acme@example.com',
    plan_id: plan.id,
    start_date: '2026-10-01',
    discount_code: discount.code,
    tax_rate: 10,
    lines: [{ product_id: product.id, quantity: 1, unit_price: 1000 }]
  });

  quotationService.updateStatus(quotation.id, 'Quotation');
  quotationService.updateStatus(quotation.id, 'Confirmed');
  quotationService.updateStatus(quotation.id, 'Active');

  const service = makeBillingService(db);
  const sync = service.syncActiveQuotations();
  assert.strictEqual(sync.synced, 1);
  assert.deepStrictEqual(sync.errors, []);

  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE quotation_id = ?'
  ).get(quotation.id);
  assert.ok(subscription);
  assert.strictEqual(subscription.status, 'Active');
  assert.strictEqual(subscription.billing_interval, 1);
  assert.strictEqual(subscription.billing_frequency, 'monthly');
  assert.strictEqual(subscription.next_billing_date, '2026-10-01');
  assert.strictEqual(subscription.plan_id, plan.id);
  assert.strictEqual(subscription.discount_id, discount.id);

  const linkedQuote = db.prepare('SELECT * FROM sales_quotations WHERE id = ?').get(quotation.id);
  assert.strictEqual(linkedQuote.subscription_id, subscription.id);
  assert.ok(linkedQuote.customer_id);

  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(linkedQuote.customer_id);
  assert.strictEqual(customer.email, 'acme@example.com');
  assert.strictEqual(customer.role, 'customer');

  const { invoice } = service.billSubscription(subscription.id, { asOf: '2026-10-01' });
  assert.strictEqual(invoice.subtotal, 1000);
  assert.strictEqual(invoice.discount_total, 100);
  assert.strictEqual(invoice.tax_total, 90);
  assert.strictEqual(invoice.total_amount, 990);

  // Re-running the sync must not duplicate the subscription.
  assert.strictEqual(service.syncActiveQuotations().synced, 0);
});

test('Billing: daily sweep only bills due Active subscriptions and is idempotent', () => {
  const { db, customerId } = makeFixture();
  const service = makeBillingService(db);

  const dueOne = addSubscription(db, customerId, { next_billing_date: '2026-10-31' });
  const dueTwo = addSubscription(db, customerId, { next_billing_date: '2026-10-15' });
  addSubscription(db, customerId, { next_billing_date: '2026-12-01' });
  addSubscription(db, customerId, { next_billing_date: '2026-10-01', status: 'Closed' });

  const first = service.runBillingSweep({ asOf: '2026-10-31' });
  assert.strictEqual(first.billed, 2);
  assert.strictEqual(first.skipped, 0);
  assert.deepStrictEqual(first.errors, []);
  assert.strictEqual(invoiceCount(db), 2);

  const second = service.runBillingSweep({ asOf: '2026-10-31' });
  assert.strictEqual(second.billed, 0);
  assert.strictEqual(invoiceCount(db), 2);

  // Simulate a crash/retry that left the period due again: the unique-period
  // guard must prevent a duplicate invoice.
  db.prepare("UPDATE subscriptions SET next_billing_date = '2026-10-31' WHERE id = ?").run(dueOne);
  const replay = service.billSubscription(dueOne, { asOf: '2026-10-31' });
  assert.strictEqual(replay.skipped, true);
  assert.strictEqual(replay.reason, 'already_billed');
  assert.strictEqual(invoiceCount(db), 2);

  // dueTwo was also advanced by exactly one month.
  const secondSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(dueTwo);
  assert.strictEqual(secondSub.next_billing_date, '2026-11-15');
});

test('Billing: date advancement handles month-end and leap years', () => {
  assert.strictEqual(addInterval('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.strictEqual(addInterval('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.strictEqual(addInterval('2026-10-31', 'weekly', 2), '2026-11-14');
  assert.strictEqual(addInterval('2026-10-31', 'daily', 3), '2026-11-03');
});

test('Payments: cumulative payments reduce balance and auto-mark the invoice Paid', () => {
  const { db, customerId } = makeFixture();
  const subscriptionId = addSubscription(db, customerId, { amount: 1000 });

  const billing = makeBillingService(db);
  const { invoice } = billing.billSubscription(subscriptionId, { asOf: '2026-10-31' });
  const invoiceService = new InvoiceService(db);

  assert.throws(
    () => invoiceService.updateStatus(invoice.id, 'Paid'),
    (err) => err.statusCode === 409 && /Draft -> Confirmed -> Paid/.test(err.message)
  );

  const confirmed = invoiceService.updateStatus(invoice.id, 'Confirmed');
  assert.strictEqual(confirmed.status, 'Confirmed');

  assert.throws(
    () => invoiceService.updateStatus(invoice.id, 'Paid'),
    (err) => err.statusCode === 409 && /outstanding balance/.test(err.message)
  );

  assert.throws(
    () => invoiceService.updateStatus(invoice.id, 'Draft'),
    (err) => err.statusCode === 409
  );

  const first = invoiceService.recordPayment(invoice.id, {
    amount: 400,
    method: 'card',
    payment_date: '2026-10-31',
    note: 'Deposit'
  });
  assert.strictEqual(first.invoice.status, 'Confirmed');
  assert.strictEqual(first.invoice.paid_amount, 400);
  assert.strictEqual(first.invoice.balance, 600);

  const second = invoiceService.recordPayment(invoice.id, {
    amount: 600,
    method: 'bank_transfer',
    payment_date: '2026-11-01'
  });
  assert.strictEqual(second.invoice.status, 'Paid');
  assert.strictEqual(second.invoice.paid_amount, 1000);
  assert.strictEqual(second.invoice.balance, 0);
  assert.strictEqual(second.invoice.payments.length, 2);

  assert.throws(
    () => invoiceService.recordPayment(invoice.id, {
      amount: 1, method: 'cash', payment_date: '2026-11-02'
    }),
    (err) => err.statusCode === 409 && /already fully paid/.test(err.message)
  );
});

test('Payments: overpayment and invalid input are rejected without side effects', () => {
  const { db, customerId } = makeFixture();
  const subscriptionId = addSubscription(db, customerId, { amount: 500 });
  const billing = makeBillingService(db);
  const { invoice } = billing.billSubscription(subscriptionId, { asOf: '2026-10-31' });
  const invoiceService = new InvoiceService(db);

  assert.throws(
    () => invoiceService.recordPayment(invoice.id, {
      amount: 501, method: 'card', payment_date: '2026-10-31'
    }),
    (err) => err.statusCode === 400 && /exceeds/.test(err.message)
  );

  assert.throws(
    () => invoiceService.recordPayment(invoice.id, {
      amount: 100, payment_date: '2026-10-31'
    }),
    (err) => err.statusCode === 400 && /method is required/.test(err.message)
  );

  assert.throws(
    () => invoiceService.recordPayment(invoice.id, {
      amount: 100, method: 'card', payment_date: '31/10/2026'
    }),
    (err) => err.statusCode === 400 && /YYYY-MM-DD/.test(err.message)
  );

  const stored = db.prepare('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?')
    .get(invoice.id).count;
  assert.strictEqual(Number(stored), 0);
  assert.strictEqual(invoiceService.getInvoice(invoice.id).balance, 500);
});

test('Seed: the demo portal customer gets subscriptions and invoices', () => {
  const db = openDatabase(':memory:');
  const userId = seedDemoPortal(db);

  const subscriptions = db.prepare(
    'SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY id ASC'
  ).all(userId);
  assert.strictEqual(subscriptions.length, 2);
  assert.strictEqual(subscriptions[0].status, 'Active');
  assert.strictEqual(subscriptions[0].next_billing_date, '2026-09-01');
  assert.strictEqual(subscriptions[0].billing_interval, 1);
  assert.strictEqual(subscriptions[1].status, 'Confirmed');

  const invoices = db.prepare(
    'SELECT * FROM invoices WHERE customer_id = ? ORDER BY id ASC'
  ).all(userId);
  assert.strictEqual(invoices.length, 2);
  assert.deepStrictEqual(invoices.map((row) => row.status), ['Paid', 'Confirmed']);
});

test('Migration: an existing Member 1 database gains Member 3 tables and billing columns', () => {
  const file = path.join(os.tmpdir(), `brightloop-migration-${process.pid}-${Date.now()}.sqlite`);
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      plan_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft','Quotation','Confirmed','Active','Closed')),
      start_date TEXT, expiry_date TEXT,
      billing_period TEXT, amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      subscription_id INTEGER REFERENCES subscriptions(id),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Confirmed','Paid')),
      issue_date TEXT, due_date TEXT, total REAL NOT NULL DEFAULT 0
    );
    INSERT INTO users (name, email, password_hash, role)
      VALUES ('Legacy Customer', 'legacy@example.com', 'x', 'customer');
    INSERT INTO subscriptions (number, customer_id, plan_name, status, start_date, billing_period, amount)
      VALUES ('SUB-LEGACY-1', 1, 'Legacy Plan', 'Active', '2026-09-01', 'Monthly', 500);
    INSERT INTO invoices (number, customer_id, subscription_id, status, issue_date, due_date, total)
      VALUES ('INV-LEGACY-1', 1, 1, 'Confirmed', '2026-09-01', '2026-09-15', 500);
  `);
  legacy.close();

  const db = openDatabase(file);
  try {
    const subscriptionColumns = db.prepare('PRAGMA table_info(subscriptions)').all().map((c) => c.name);
    assert.ok(subscriptionColumns.includes('next_billing_date'));
    assert.ok(subscriptionColumns.includes('billing_interval'));
    assert.ok(subscriptionColumns.includes('quotation_id'));

    const invoiceColumns = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
    for (const column of ['subtotal', 'tax_total', 'discount_total', 'total_amount', 'created_at']) {
      assert.ok(invoiceColumns.includes(column), `invoices.${column} should be added`);
    }

    const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = 1').get();
    assert.strictEqual(subscription.next_billing_date, '2026-09-01');
    assert.strictEqual(subscription.billing_frequency, 'monthly');
    assert.strictEqual(subscription.billing_interval, 1);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = 1').get();
    assert.strictEqual(invoice.total_amount, 500);
    assert.strictEqual(invoice.subtotal, 500);

    for (const table of ['tax_rules', 'invoice_line_items', 'payments']) {
      const found = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table);
      assert.ok(found, `${table} should be created`);
    }

    const trigger = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_subscription_active_update'"
    ).get();
    assert.ok(trigger);
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${file}${suffix}`); } catch { /* ignore */ }
    }
  }
});
