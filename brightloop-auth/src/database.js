const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { initSchema: initSubscriptionSchema } = require('../../subscription-app/src/db/database');

// Both applications share one SQLite file by default. Either process can
// override it with DB_FILE or DB_PATH; DB_FILE takes precedence.
const DEFAULT_DB_FILE =
  process.env.DB_FILE ||
  process.env.DB_PATH ||
  path.join(__dirname, '..', '..', 'data', 'brightloop.sqlite');

function openDatabase(dbFile = DEFAULT_DB_FILE) {
  if (dbFile !== ':memory:') {
    const dir = path.dirname(dbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbFile !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  initSchema(db);
  return db;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function ensureColumn(db, table, column, definition) {
  if (!tableColumns(db, table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(db) {
  // Member 2 quotations get a proper link to Member 1 users/subscriptions.
  ensureColumn(db, 'sales_quotations', 'customer_id', 'INTEGER');
  ensureColumn(db, 'sales_quotations', 'subscription_id', 'INTEGER');

  // Member 1 subscriptions gain recurring-billing fields.
  ensureColumn(db, 'subscriptions', 'quotation_id', 'INTEGER');
  ensureColumn(db, 'subscriptions', 'plan_id', 'INTEGER');
  ensureColumn(db, 'subscriptions', 'discount_id', 'INTEGER');
  ensureColumn(db, 'subscriptions', 'billing_frequency', 'TEXT');
  ensureColumn(db, 'subscriptions', 'billing_interval', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'subscriptions', 'next_billing_date', 'TEXT');
  ensureColumn(db, 'subscriptions', 'last_billed_date', 'TEXT');
  ensureColumn(db, 'subscriptions', 'auto_close', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'subscriptions', 'created_at', 'TEXT');
  ensureColumn(db, 'subscriptions', 'updated_at', 'TEXT');

  // Member 1 invoices gain the Member 3 breakdown columns. `total` is kept so
  // the existing customer portal queries keep working unchanged.
  ensureColumn(db, 'invoices', 'subtotal', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'invoices', 'tax_total', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'invoices', 'discount_total', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'invoices', 'total_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'invoices', 'billing_period_start', 'TEXT');
  ensureColumn(db, 'invoices', 'billing_period_end', 'TEXT');
  ensureColumn(db, 'invoices', 'currency', "TEXT NOT NULL DEFAULT 'USD'");
  ensureColumn(db, 'invoices', 'notes', 'TEXT');
  ensureColumn(db, 'invoices', 'created_at', 'TEXT');
  ensureColumn(db, 'invoices', 'updated_at', 'TEXT');

  db.exec(`
    UPDATE subscriptions
    SET billing_frequency = COALESCE(NULLIF(LOWER(billing_frequency), ''), NULLIF(LOWER(billing_period), ''), 'monthly')
    WHERE billing_frequency IS NULL OR billing_frequency = '';

    UPDATE subscriptions
    SET billing_interval = 1
    WHERE billing_interval IS NULL;

    UPDATE subscriptions
    SET next_billing_date = COALESCE(next_billing_date, start_date, date('now'))
    WHERE status = 'Active' AND next_billing_date IS NULL;

    UPDATE subscriptions
    SET created_at = COALESCE(created_at, datetime('now')),
        updated_at = COALESCE(updated_at, datetime('now'))
    WHERE created_at IS NULL OR updated_at IS NULL;

    UPDATE invoices
    SET subtotal = CASE WHEN subtotal = 0 AND total > 0 THEN total ELSE subtotal END,
        total_amount = CASE WHEN total_amount = 0 AND total > 0 THEN total ELSE total_amount END,
        created_at = COALESCE(created_at, issue_date, datetime('now')),
        updated_at = COALESCE(updated_at, datetime('now'))
    WHERE total_amount = 0 OR subtotal = 0 OR created_at IS NULL OR updated_at IS NULL;
  `);

  // Indexes that depend on columns added by the migrations above.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sub_due ON subscriptions(status, next_billing_date);
    CREATE INDEX IF NOT EXISTS idx_sub_quotation ON subscriptions(quotation_id);
    CREATE INDEX IF NOT EXISTS idx_quote_customer ON sales_quotations(customer_id);
    CREATE INDEX IF NOT EXISTS idx_quote_subscription ON sales_quotations(subscription_id);

    -- The partial unique index is the database-level guard against billing the
    -- same subscription for the same period twice.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_subscription_period
      ON invoices(subscription_id, billing_period_start)
      WHERE subscription_id IS NOT NULL AND billing_period_start IS NOT NULL;
  `);
}

function initSchema(db) {
  // Member 2 owns products, plans, discounts, templates and quotations.
  initSubscriptionSchema(db);

  // Member 1 owns users and the customer portal.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Member 3 extends the subscription shell into a recurring-billing record.
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      plan_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft','Quotation','Confirmed','Active','Closed')),
      start_date TEXT,
      expiry_date TEXT,
      billing_period TEXT,
      amount REAL NOT NULL DEFAULT 0,
      quotation_id INTEGER REFERENCES sales_quotations(id) ON DELETE SET NULL,
      plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL,
      discount_id INTEGER REFERENCES discounts(id) ON DELETE SET NULL,
      billing_frequency TEXT,
      billing_interval INTEGER NOT NULL DEFAULT 1,
      next_billing_date TEXT,
      last_billed_date TEXT,
      auto_close INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tax_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      percentage REAL NOT NULL DEFAULT 0 CHECK (percentage >= 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft','Confirmed','Paid')),
      issue_date TEXT,
      due_date TEXT,
      total REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      billing_period_start TEXT,
      billing_period_end TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      line_type TEXT NOT NULL CHECK (line_type IN ('base','tax','discount')),
      tax_rule_id INTEGER REFERENCES tax_rules(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sub_customer ON subscriptions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_inv_subscription ON invoices(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_inv_issue_date ON invoices(issue_date);
    CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_tax_rules_active ON tax_rules(is_active);
  `);

  runMigrations(db);

  // Member 2 state-machine hook: whenever a subscription becomes Active its
  // recurring-billing fields are guaranteed to be populated.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_subscription_active_insert
    AFTER INSERT ON subscriptions
    WHEN NEW.status = 'Active'
    BEGIN
      UPDATE subscriptions
      SET next_billing_date = COALESCE(NEW.next_billing_date, NEW.start_date, date('now')),
          billing_interval = COALESCE(NEW.billing_interval, 1),
          billing_frequency = COALESCE(NULLIF(NEW.billing_frequency, ''), NULLIF(LOWER(NEW.billing_period), ''), 'monthly')
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_subscription_active_update
    AFTER UPDATE OF status ON subscriptions
    WHEN NEW.status = 'Active'
      AND (NEW.next_billing_date IS NULL OR NEW.billing_frequency IS NULL OR NEW.billing_interval IS NULL)
    BEGIN
      UPDATE subscriptions
      SET next_billing_date = COALESCE(NEW.next_billing_date, NEW.start_date, date('now')),
          billing_interval = COALESCE(NEW.billing_interval, 1),
          billing_frequency = COALESCE(NULLIF(NEW.billing_frequency, ''), NULLIF(LOWER(NEW.billing_period), ''), 'monthly'),
          updated_at = datetime('now')
      WHERE id = NEW.id;
    END;
  `);
}

function transaction(db, fn) {
  if (typeof db.transaction === 'function') {
    const wrapped = db.transaction(fn);
    return typeof wrapped.immediate === 'function' ? wrapped.immediate() : wrapped();
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch { /* already rolled back */ }
    throw err;
  }
}

function seedTaxRules(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM tax_rules').get().count;
  if (Number(count) === 0) {
    db.prepare('INSERT INTO tax_rules (name, percentage, is_active) VALUES (?, ?, 1)')
      .run('Standard VAT', 10);
  }
}

function seedAdmin(db) {
  const email = process.env.ADMIN_EMAIL || 'admin@brightloop.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;

  return db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Administrator', email, bcrypt.hashSync(password, 12), 'admin').lastInsertRowid;
}

function seedDemoPortal(db) {
  const email = 'demo@customer.com';
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) return user.id;

  const userId = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Demo Customer', email, bcrypt.hashSync('Demo@12345', 12), 'customer').lastInsertRowid;

  const sub = db.prepare(`
    INSERT INTO subscriptions (
      number, customer_id, plan_name, status, start_date, expiry_date,
      billing_period, amount, billing_frequency, billing_interval, next_billing_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const primary = sub.run(
    'SUB-0001', userId, 'CRM Pro (Odoo brand)', 'Active', '2026-09-01', '2027-09-01',
    'Monthly', 1560, 'monthly', 1, '2026-09-01'
  ).lastInsertRowid;
  sub.run(
    'SUB-0002', userId, 'Analytics Add-on', 'Confirmed', '2026-10-15', '2027-10-15',
    'Yearly', 9600, 'yearly', 1, null
  );

  const invoice = db.prepare(`
    INSERT INTO invoices (
      number, customer_id, subscription_id, status, issue_date, due_date,
      total, subtotal, tax_total, discount_total, total_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  invoice.run('INV-0001', userId, primary, 'Paid', '2026-09-01', '2026-09-15', 1560, 1560, 0, 0, 1560);
  invoice.run('INV-0002', userId, primary, 'Confirmed', '2026-10-01', '2026-10-15', 1560, 1560, 0, 0, 1560);

  return userId;
}

function seedMember2Demo(db) {
  if (process.env.SKIP_SEED === 'true') return;
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (Number(count) > 0) return;

  // Reuse Member 2's demo catalogue/quotations in the shared database.
  const { seedDatabase } = require('../../subscription-app/src/db/seed');
  seedDatabase(db);
}

function initializeDefaults(db) {
  seedTaxRules(db);
  seedAdmin(db);
  if (process.env.SEED_DEMO === 'true') seedDemoPortal(db);
  seedMember2Demo(db);
  return db;
}

module.exports = {
  DEFAULT_DB_FILE,
  openDatabase,
  initSchema,
  runMigrations,
  ensureColumn,
  transaction,
  seedTaxRules,
  seedAdmin,
  seedDemoPortal,
  seedMember2Demo,
  initializeDefaults
};
