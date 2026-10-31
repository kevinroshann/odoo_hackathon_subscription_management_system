process.env.SKIP_SEED = 'true';
process.env.SEED_DEMO = 'false';
process.env.DB_FILE = ':memory:';
process.env.DISABLE_BILLING_CRON = 'true';
process.env.JWT_SECRET = 'member-3-test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const {
  app,
  db,
  billingService
} = require('../src/server');
const { signToken } = require('../src/middleware/auth');

let server;
let baseUrl;
let admin;
let customer;
let invoice;
let customerToken;

function issueToken(user) {
  return signToken(user);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

before(async () => {
  admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  assert.ok(admin, 'seeded admin should exist');

  const customerId = Number(db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Portal Customer', 'portal@example.com', 'x', 'customer')"
  ).run().lastInsertRowid);
  customer = db.prepare('SELECT * FROM users WHERE id = ?').get(customerId);
  customerToken = issueToken(customer);

  const subscriptionId = Number(db.prepare(`
    INSERT INTO subscriptions (
      number, customer_id, plan_name, status, start_date, billing_period,
      amount, billing_frequency, billing_interval, next_billing_date
    ) VALUES ('API-SUB-1', ?, 'API Test Plan', 'Active', '2026-10-01',
              'monthly', 1000, 'monthly', 1, '2026-10-31')
  `).run(customerId).lastInsertRowid);

  const result = billingService.billSubscription(subscriptionId, { asOf: '2026-10-31' });
  assert.strictEqual(result.skipped, false);
  invoice = result.invoice;

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
});

test('Invoices API: unauthenticated and customer roles are rejected', async () => {
  const anonymous = await api('/api/invoices');
  assert.strictEqual(anonymous.status, 401);

  const forbidden = await api('/api/invoices', { token: customerToken });
  assert.strictEqual(forbidden.status, 403);

  const forbiddenPayment = await api(`/api/invoices/${invoice.id}/payments`, {
    method: 'POST',
    token: customerToken,
    body: { amount: 10, method: 'card' }
  });
  assert.strictEqual(forbiddenPayment.status, 403);
});

test('Invoices API: admin can list invoices with filters and inspect line items', async () => {
  const token = issueToken(admin);
  const list = await api('/api/invoices', { token });
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.total >= 1);
  assert.ok(Array.isArray(list.body.invoices));

  const found = list.body.invoices.find((row) => row.id === invoice.id);
  assert.ok(found);
  assert.strictEqual(found.customer_email, 'portal@example.com');
  assert.strictEqual(Number(found.total_amount), invoice.total_amount);

  const filtered = await api(`/api/invoices?status=Draft&customer_id=${customer.id}`, { token });
  assert.strictEqual(filtered.status, 200);
  assert.ok(filtered.body.invoices.every((row) => row.status === 'Draft'));
  assert.ok(filtered.body.invoices.every((row) => row.customer_id === customer.id));

  const invalidFilter = await api('/api/invoices?status=Nope', { token });
  assert.strictEqual(invalidFilter.status, 400);

  const detail = await api(`/api/invoices/${invoice.id}`, { token });
  assert.strictEqual(detail.status, 200);
  assert.ok(detail.body.invoice.line_items.length >= 2); // base + tax
  assert.strictEqual(detail.body.invoice.balance, invoice.total_amount);
});

test('Invoices API: status lifecycle is validated and payment auto-completes the invoice', async () => {
  const token = issueToken(admin);

  const invalidSkip = await api(`/api/invoices/${invoice.id}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'Paid' }
  });
  assert.strictEqual(invalidSkip.status, 409);
  assert.match(invalidSkip.body.error, /Draft -> Confirmed -> Paid/);

  const confirmed = await api(`/api/invoices/${invoice.id}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'Confirmed' }
  });
  assert.strictEqual(confirmed.status, 200);
  assert.strictEqual(confirmed.body.invoice.status, 'Confirmed');

  const unpaid = await api(`/api/invoices/${invoice.id}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'Paid' }
  });
  assert.strictEqual(unpaid.status, 409);
  assert.match(unpaid.body.error, /outstanding balance/);

  const payment = await api(`/api/invoices/${invoice.id}/payments`, {
    method: 'POST',
    token,
    body: {
      amount: invoice.total_amount,
      method: 'bank_transfer',
      payment_date: '2026-10-31',
      note: 'Full settlement'
    }
  });
  assert.strictEqual(payment.status, 201);
  assert.strictEqual(payment.body.invoice.status, 'Paid');
  assert.strictEqual(payment.body.invoice.balance, 0);
  assert.strictEqual(payment.body.payment.method, 'bank_transfer');

  const payments = await api(`/api/invoices/${invoice.id}/payments`, { token });
  assert.strictEqual(payments.status, 200);
  assert.strictEqual(payments.body.payments.length, 1);

  const overpay = await api(`/api/invoices/${invoice.id}/payments`, {
    method: 'POST',
    token,
    body: { amount: 1, method: 'cash', payment_date: '2026-11-01' }
  });
  assert.strictEqual(overpay.status, 409);

  const paidFilter = await api('/api/invoices?status=Paid', { token });
  assert.strictEqual(paidFilter.status, 200);
  assert.ok(paidFilter.body.invoices.some((row) => row.id === invoice.id));
});

test('Portal integration: customer only sees their own invoice and balance', async () => {
  const otherId = Number(db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Other Customer', 'other@example.com', 'x', 'customer')"
  ).run().lastInsertRowid);
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);

  const own = await api('/api/portal/invoices', { token: customerToken });
  assert.strictEqual(own.status, 200);
  assert.ok(own.body.invoices.some((row) => row.id === invoice.id));

  const others = await api('/api/portal/invoices', { token: issueToken(other) });
  assert.strictEqual(others.status, 200);
  assert.deepStrictEqual(others.body.invoices, []);
});

test('Tax rules API: admin/staff can manage active tax rules', async () => {
  const token = issueToken(admin);

  const list = await api('/api/tax-rules?activeOnly=true', { token });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body));
  assert.ok(list.body.length >= 1);

  const created = await api('/api/tax-rules', {
    method: 'POST',
    token,
    body: { name: 'API Service Tax', percentage: 3.5, is_active: true }
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.tax_rule.percentage, 3.5);

  const updated = await api(`/api/tax-rules/${created.body.tax_rule.id}`, {
    method: 'PATCH',
    token,
    body: { is_active: false }
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.tax_rule.is_active, false);

  const removed = await api(`/api/tax-rules/${created.body.tax_rule.id}`, {
    method: 'DELETE',
    token
  });
  assert.strictEqual(removed.status, 200);

  const badPercentage = await api('/api/tax-rules', {
    method: 'POST',
    token,
    body: { name: 'Bad Tax', percentage: 300 }
  });
  assert.strictEqual(badPercentage.status, 400);
});

test('Billing run endpoint: staff can trigger the sweep idempotently', async () => {
  const staffId = Number(db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Billing Staff', 'staff@example.com', 'x', 'staff')"
  ).run().lastInsertRowid);
  const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(staffId);
  const token = issueToken(staff);

  const first = await api('/api/admin/billing/run', {
    method: 'POST',
    token,
    body: { asOf: '2026-10-31' }
  });
  assert.strictEqual(first.status, 200);
  assert.ok(first.body.summary);

  const before = Number(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count);
  const second = await api('/api/admin/billing/run', {
    method: 'POST',
    token,
    body: { asOf: '2026-10-31' }
  });
  assert.strictEqual(second.status, 200);
  const after = Number(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count);
  assert.strictEqual(after, before);
});
