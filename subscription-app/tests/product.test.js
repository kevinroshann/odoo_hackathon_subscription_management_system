const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { initSchema } = require('../src/db/database');
const ProductService = require('../src/services/productService');

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

test('Product Master: Creates products with type, pricing, and notes', () => {
  const db = setupTestDb();
  const service = new ProductService(db);

  const product = service.createProduct({
    code: 'TEST-PROD-01',
    name: 'Brightloop Cloud ERP',
    type: 'Software',
    sales_price: 1000.0,
    cost_price: 400.0,
    notes: 'Primary SaaS suite'
  });

  assert.strictEqual(product.code, 'TEST-PROD-01');
  assert.strictEqual(product.name, 'Brightloop Cloud ERP');
  assert.strictEqual(product.type, 'Software');
  assert.strictEqual(product.sales_price, 1000.0);
  assert.strictEqual(product.cost_price, 400.0);
  assert.strictEqual(product.notes, 'Primary SaaS suite');
  assert.strictEqual(product.active, 1);
});

test('Product Variant Engine: Adding brand configurations like Odoo +560 calculates final price', () => {
  const db = setupTestDb();
  const service = new ProductService(db);

  // 1. Create base product with base sales price 1000
  const product = service.createProduct({
    code: 'PROD-BASE',
    name: 'Brightloop Core Suite',
    type: 'Software',
    sales_price: 1000.0,
    cost_price: 300.0
  });

  // 2. Add 'Brand' attribute
  const brandAttr = service.addAttribute(product.id, 'Brand');
  assert.strictEqual(brandAttr.name, 'Brand');

  // 3. Add values: Standard (0) and Odoo (+560)
  const stdValue = service.addAttributeValue(brandAttr.id, {
    value: 'Standard',
    price_extra: 0.0
  });
  const odooValue = service.addAttributeValue(brandAttr.id, {
    value: 'Odoo',
    price_extra: 560.0, // <-- Explicit PDF requirement
    cost_extra: 120.0
  });

  // 4. Calculate variant price dynamically for Odoo brand
  const odooPricing = service.calculateVariantPrice(product.id, [odooValue.id]);
  assert.strictEqual(odooPricing.base_sales_price, 1000.0);
  assert.strictEqual(odooPricing.calculated_sales_price, 1560.0); // 1000 + 560 = 1560!
  assert.strictEqual(odooPricing.calculated_cost_price, 420.0);  // 300 + 120 = 420!
  assert.strictEqual(odooPricing.breakdown.length, 1);
  assert.strictEqual(odooPricing.breakdown[0].price_extra, 560.0);

  // 5. Create concrete variant
  const variant = service.createVariant(product.id, {
    sku: 'PROD-BASE-ODOO',
    variant_name: 'Brightloop Core Suite (Odoo)',
    attribute_value_ids: [odooValue.id]
  });

  assert.strictEqual(variant.sku, 'PROD-BASE-ODOO');
  assert.strictEqual(variant.calculated_sales_price, 1560.0);
  assert.strictEqual(variant.calculated_cost_price, 420.0);
});

test('Product Variant Matrix: Automatically generates variant combinations', () => {
  const db = setupTestDb();
  const service = new ProductService(db);

  const product = service.createProduct({
    code: 'PROD-MATRIX',
    name: 'Modular App',
    type: 'Software',
    sales_price: 500.0
  });

  const brandAttr = service.addAttribute(product.id, 'Brand');
  service.addAttributeValue(brandAttr.id, { value: 'Odoo', price_extra: 560.0 });
  service.addAttributeValue(brandAttr.id, { value: 'Enterprise', price_extra: 1000.0 });

  const hostAttr = service.addAttribute(product.id, 'Hosting');
  service.addAttributeValue(hostAttr.id, { value: 'Shared', price_extra: 0.0 });
  service.addAttributeValue(hostAttr.id, { value: 'Dedicated', price_extra: 200.0 });

  const generated = service.generateAllVariantsMatrix(product.id);
  // 2 brands * 2 hosting = 4 variants
  assert.strictEqual(generated.length, 4);

  const odooDedicated = generated.find(v => v.variant_name.includes('Odoo') && v.variant_name.includes('Dedicated'));
  assert.ok(odooDedicated);
  assert.strictEqual(odooDedicated.calculated_sales_price, 500.0 + 560.0 + 200.0); // 1260
});
