const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { initSchema } = require('../src/db/database');
const ProductService = require('../src/services/productService');
const DiscountService = require('../src/services/discountService');

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

test('Discount Engine: Admin creates percentage and fixed amount discounts', () => {
  const db = setupTestDb();
  const service = new DiscountService(db);

  const pct = service.createDiscount({
    code: 'PERCENT15',
    name: '15 Percent Off',
    type: 'percentage',
    value: 15.0
  });
  assert.strictEqual(pct.code, 'PERCENT15');
  assert.strictEqual(pct.type, 'percentage');
  assert.strictEqual(pct.value, 15.0);

  const fixed = service.createDiscount({
    code: 'FIXED50',
    name: '50 Dollars Credit',
    type: 'fixed',
    value: 50.0
  });
  assert.strictEqual(fixed.code, 'FIXED50');
  assert.strictEqual(fixed.type, 'fixed');
  assert.strictEqual(fixed.value, 50.0);
});

test('Discount Engine: Minimum purchase amount & minimum quantity requirements', () => {
  const db = setupTestDb();
  const service = new DiscountService(db);

  const discount = service.createDiscount({
    code: 'TIERED20',
    name: 'Volume Promo',
    type: 'percentage',
    value: 20.0,
    min_purchase_amount: 1000.0,
    min_quantity: 5
  });

  // Test 1: Order quantity below min quantity
  const failQty = service.evaluateDiscount({
    discountIdOrCode: 'TIERED20',
    items: [{ product_id: 1, quantity: 3, unit_price: 400.0 }] // total: 1200, but qty 3 < 5
  });
  assert.strictEqual(failQty.valid, false);
  assert.ok(failQty.reason.includes('required minimum of 5'));

  // Test 2: Order amount below min purchase amount
  const failAmount = service.evaluateDiscount({
    discountIdOrCode: 'TIERED20',
    items: [{ product_id: 1, quantity: 5, unit_price: 100.0 }] // qty 5 >= 5, but total 500 < 1000
  });
  assert.strictEqual(failAmount.valid, false);
  assert.ok(failAmount.reason.includes('below the required minimum of $1000.00'));

  // Test 3: Satisfies both minimums
  const success = service.evaluateDiscount({
    discountIdOrCode: 'TIERED20',
    items: [{ product_id: 1, quantity: 5, unit_price: 300.0 }] // total: 1500, qty 5
  });
  assert.strictEqual(success.valid, true);
  assert.strictEqual(success.discount_amount, 300.0); // 20% of 1500 = 300!
});

test('Discount Engine: Usage caps and limit enforcement', () => {
  const db = setupTestDb();
  const service = new DiscountService(db);

  const capped = service.createDiscount({
    code: 'LIMIT2',
    name: 'First 2 Customers Only',
    type: 'fixed',
    value: 100.0,
    usage_limit: 2
  });

  const cart = [{ product_id: 1, quantity: 1, unit_price: 500.0 }];

  // Usage 0/2: Valid
  let evalRes = service.evaluateDiscount({ discountIdOrCode: capped.id, items: cart });
  assert.strictEqual(evalRes.valid, true);
  service.incrementUsage(capped.id);

  // Usage 1/2: Valid
  evalRes = service.evaluateDiscount({ discountIdOrCode: capped.id, items: cart });
  assert.strictEqual(evalRes.valid, true);
  service.incrementUsage(capped.id);

  // Usage 2/2: Exhausted / Cap reached!
  evalRes = service.evaluateDiscount({ discountIdOrCode: capped.id, items: cart });
  assert.strictEqual(evalRes.valid, false);
  assert.ok(evalRes.reason.includes('reached its maximum usage limit of 2'));
});

test('Discount Engine: Specific products scope vs Whole subscription scope', () => {
  const db = setupTestDb();
  const prodService = new ProductService(db);
  const discService = new DiscountService(db);

  const p1 = prodService.createProduct({ code: 'P1', name: 'Software', type: 'Software', sales_price: 1000.0 });
  const p2 = prodService.createProduct({ code: 'P2', name: 'Addon', type: 'Add-on', sales_price: 200.0 });

  // Discount applies ONLY to P1
  const targetedDisc = discService.createDiscount({
    code: 'TARGET_P1',
    name: 'Software 10% Off',
    type: 'percentage',
    value: 10.0,
    scope: 'specific_products',
    product_ids: [p1.id]
  });

  // Cart with both P1 and P2
  const evalRes = discService.evaluateDiscount({
    discountIdOrCode: targetedDisc.id,
    items: [
      { product_id: p1.id, quantity: 1, unit_price: 1000.0 },
      { product_id: p2.id, quantity: 2, unit_price: 200.0 } // 400
    ]
  });

  assert.strictEqual(evalRes.valid, true);
  // Total order is 1400, but only P1 (1000) is eligible! 10% of 1000 = 100!
  assert.strictEqual(evalRes.eligible_amount, 1000.0);
  assert.strictEqual(evalRes.discount_amount, 100.0);
});
