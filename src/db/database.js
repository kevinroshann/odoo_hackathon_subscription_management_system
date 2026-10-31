const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'brightloop.sqlite');

function getDatabase(dbPath = DB_PATH) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enable foreign keys and WAL mode for high concurrency & integrity
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    -- Products Master
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('Software', 'Service', 'Consumable', 'Add-on')),
      sales_price REAL NOT NULL DEFAULT 0.0,
      cost_price REAL NOT NULL DEFAULT 0.0,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Product Attributes (e.g. Brand, Edition, Cloud Region)
    CREATE TABLE IF NOT EXISTS product_attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- Product Attribute Values (e.g. Odoo brand with +560 price extra)
    CREATE TABLE IF NOT EXISTS product_attribute_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      price_extra REAL NOT NULL DEFAULT 0.0,
      cost_extra REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (attribute_id) REFERENCES product_attributes(id) ON DELETE CASCADE
    );

    -- Concrete Product Variants
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      variant_name TEXT NOT NULL,
      calculated_sales_price REAL NOT NULL DEFAULT 0.0,
      calculated_cost_price REAL NOT NULL DEFAULT 0.0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- Variant to Attribute Value mapping
    CREATE TABLE IF NOT EXISTS product_variant_values (
      variant_id INTEGER NOT NULL,
      attribute_value_id INTEGER NOT NULL,
      PRIMARY KEY (variant_id, attribute_value_id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
      FOREIGN KEY (attribute_value_id) REFERENCES product_attribute_values(id) ON DELETE CASCADE
    );

    -- Subscription Plans
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      billing_frequency TEXT NOT NULL CHECK(billing_frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      billing_interval INTEGER NOT NULL DEFAULT 1,
      base_fee REAL NOT NULL DEFAULT 0.0,
      min_quantity INTEGER NOT NULL DEFAULT 1,
      start_date TEXT,
      end_date TEXT,
      auto_close INTEGER NOT NULL DEFAULT 0,
      closable_early INTEGER NOT NULL DEFAULT 1,
      pausable INTEGER NOT NULL DEFAULT 1,
      renewable INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Admin Discounts
    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('fixed', 'percentage')),
      value REAL NOT NULL,
      scope TEXT NOT NULL DEFAULT 'whole_subscription' CHECK(scope IN ('whole_subscription', 'specific_products')),
      min_purchase_amount REAL DEFAULT 0.0,
      min_quantity INTEGER DEFAULT 1,
      usage_limit INTEGER DEFAULT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Products attached to specific product discounts
    CREATE TABLE IF NOT EXISTS discount_products (
      discount_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      PRIMARY KEY (discount_id, product_id),
      FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- Sales Quotation Templates
    CREATE TABLE IF NOT EXISTS quotation_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      plan_id INTEGER,
      validity_days INTEGER NOT NULL DEFAULT 30,
      payment_terms TEXT DEFAULT 'Net 30',
      terms_and_conditions TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL
    );

    -- Quotation Template Lines
    CREATE TABLE IF NOT EXISTS quotation_template_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0.0,
      discount_percent REAL NOT NULL DEFAULT 0.0,
      FOREIGN KEY (template_id) REFERENCES quotation_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    );

    -- Sales Quotations (Draft -> Quotation -> Confirmed -> Active -> Closed)
    CREATE TABLE IF NOT EXISTS sales_quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT UNIQUE NOT NULL,
      template_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      plan_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Quotation', 'Confirmed', 'Active', 'Closed')),
      created_date TEXT NOT NULL,
      validity_days INTEGER NOT NULL DEFAULT 30,
      expiry_date TEXT NOT NULL,
      start_date TEXT NOT NULL,
      payment_terms TEXT DEFAULT 'Net 30',
      discount_id INTEGER,
      discount_code TEXT,
      discount_amount REAL NOT NULL DEFAULT 0.0,
      subtotal REAL NOT NULL DEFAULT 0.0,
      tax_rate REAL NOT NULL DEFAULT 0.0,
      tax_amount REAL NOT NULL DEFAULT 0.0,
      total_amount REAL NOT NULL DEFAULT 0.0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (template_id) REFERENCES quotation_templates(id) ON DELETE SET NULL,
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
      FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE SET NULL
    );

    -- Sales Quotation Lines
    CREATE TABLE IF NOT EXISTS sales_quotation_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0.0,
      discount_percent REAL NOT NULL DEFAULT 0.0,
      discount_amount REAL NOT NULL DEFAULT 0.0,
      subtotal REAL NOT NULL DEFAULT 0.0,
      tax_percent REAL NOT NULL DEFAULT 0.0,
      total REAL NOT NULL DEFAULT 0.0,
      FOREIGN KEY (quotation_id) REFERENCES sales_quotations(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    );
  `);
}

module.exports = {
  getDatabase,
  initSchema
};
