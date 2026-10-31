const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database(process.env.DB_FILE || 'brightloop.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
-- Minimal shells so the portal works standalone. Merge with the billing
-- members' real tables (keep customer_id -> users.id).
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  plan_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Quotation','Confirmed','Active','Closed')),
  start_date TEXT, expiry_date TEXT,
  billing_period TEXT, amount REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  subscription_id INTEGER REFERENCES subscriptions(id),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Confirmed','Paid')),
  issue_date TEXT, due_date TEXT, total REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sub_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
`);

function seed() {
  const add = (name, email, pw, role) => {
    if (!db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
      return db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
        .run(name, email, bcrypt.hashSync(pw, 12), role).lastInsertRowid;
  };
  add('Administrator', process.env.ADMIN_EMAIL || 'admin@brightloop.com',
      process.env.ADMIN_PASSWORD || 'Admin@12345', 'admin');
  if (process.env.SEED_DEMO === 'true') {
    const id = add('Demo Customer', 'demo@customer.com', 'Demo@12345', 'customer');
    if (id) {
      const s = db.prepare('INSERT INTO subscriptions(number,customer_id,plan_name,status,start_date,expiry_date,billing_period,amount) VALUES(?,?,?,?,?,?,?,?)');
      const a = s.run('SUB-0001', id, 'CRM Pro (Odoo brand)', 'Active', '2026-09-01', '2027-09-01', 'Monthly', 1560).lastInsertRowid;
      s.run('SUB-0002', id, 'Analytics Add-on', 'Confirmed', '2026-10-15', '2027-10-15', 'Yearly', 9600);
      const i = db.prepare('INSERT INTO invoices(number,customer_id,subscription_id,status,issue_date,due_date,total) VALUES(?,?,?,?,?,?,?)');
      i.run('INV-0001', id, a, 'Paid', '2026-09-01', '2026-09-15', 1560);
      i.run('INV-0002', id, a, 'Confirmed', '2026-10-01', '2026-10-15', 1560);
    }
  }
}
seed();
module.exports = db;
