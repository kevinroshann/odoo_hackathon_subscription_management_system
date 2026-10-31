const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { initSchema } = require('../src/db/database');
const ProductService = require('../src/services/productService');
const PlanService = require('../src/services/planService');
const DiscountService = require('../src/services/discountService');
const TemplateService = require('../src/services/templateService');
const QuotationService = require('../src/services/quotationService');

function setupTestEnvironment() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);

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

  return { db, productService, planService, discountService, templateService, quotationService };
}

test('Quotation Templates: Fixed validity periods and pre-configured lines', () => {
  const { productService, planService, templateService } = setupTestEnvironment();

  const prod = productService.createProduct({
    code: 'PROD-ERP',
    name: 'ERP Platform',
    type: 'Software',
    sales_price: 1200.0
  });

  const plan = planService.createPlan({
    code: 'PLAN-PRO',
    name: 'Pro Monthly',
    billing_frequency: 'monthly'
  });

  const template = templateService.createTemplate({
    name: 'Enterprise Starter Template',
    description: 'Preconfigured 14-day offer',
    plan_id: plan.id,
    validity_days: 14, // Fixed validity period of 14 days
    payment_terms: 'Net 15',
    lines: [
      { product_id: prod.id, quantity: 5, unit_price: 1200.0, discount_percent: 5.0 }
    ]
  });

  assert.strictEqual(template.name, 'Enterprise Starter Template');
  assert.strictEqual(template.validity_days, 14);
  assert.strictEqual(template.lines.length, 1);
  assert.strictEqual(template.lines[0].quantity, 5);
});

test('Sales Quotation Creation: Instantiation from template calculates expiry date and lines', () => {
  const { productService, planService, discountService, templateService, quotationService } = setupTestEnvironment();

  const prod = productService.createProduct({
    code: 'PROD-SAAS',
    name: 'SaaS Suite',
    type: 'Software',
    sales_price: 1000.0
  });

  const plan = planService.createPlan({
    code: 'PLAN-ANNUAL',
    name: 'Annual Subscription',
    billing_frequency: 'yearly',
    base_fee: 100.0,
    min_quantity: 2
  });

  const template = templateService.createTemplate({
    name: 'Annual SaaS Offer',
    plan_id: plan.id,
    validity_days: 20, // 20 days validity
    lines: [
      { product_id: prod.id, quantity: 2, unit_price: 1000.0, discount_percent: 0.0 }
    ]
  });

  const quote = quotationService.createFromTemplate({
    templateId: template.id,
    customer_name: 'Bright Horizons LLC',
    customer_email: 'billing@brighthorizons.com',
    start_date: '2026-11-01'
  });

  assert.strictEqual(quote.customer_name, 'Bright Horizons LLC');
  assert.strictEqual(quote.validity_days, 20);
  // Expiry date should equal created_date + 20 days
  const expectedExpiry = quotationService.calculateExpiryDate(quote.created_date, 20);
  assert.strictEqual(quote.expiry_date, expectedExpiry);

  // Line subtotal = 2 * 1000 = 2000. Plan base fee = 100. Total subtotal = 2100.
  assert.strictEqual(quote.subtotal, 2100.0);
  assert.strictEqual(quote.status, 'Draft');
});

test('Quotation Workflow: Draft -> Quotation -> Confirmed -> Active -> Closed & plan behavior rule check', () => {
  const { productService, planService, quotationService } = setupTestEnvironment();

  const prod = productService.createProduct({
    code: 'P-TEST',
    name: 'Standard Software',
    type: 'Software',
    sales_price: 500.0
  });

  // Plan with early close disallowed!
  const lockedPlan = planService.createPlan({
    code: 'PLAN-LOCKED',
    name: 'Strict 3-Year Plan',
    billing_frequency: 'yearly',
    closable_early: 0 // Cannot be closed early!
  });

  const quote = quotationService.createQuotation({
    customer_name: 'Corp A',
    customer_email: 'admin@corpa.com',
    plan_id: lockedPlan.id,
    lines: [{ product_id: prod.id, quantity: 1, unit_price: 500.0 }]
  });

  assert.strictEqual(quote.status, 'Draft');

  // Step 1: Draft -> Quotation
  const sent = quotationService.updateStatus(quote.id, 'Quotation');
  assert.strictEqual(sent.status, 'Quotation');

  // Step 2: Quotation -> Confirmed
  const confirmed = quotationService.updateStatus(quote.id, 'Confirmed');
  assert.strictEqual(confirmed.status, 'Confirmed');

  // Step 3: Confirmed -> Active
  const active = quotationService.updateStatus(quote.id, 'Active');
  assert.strictEqual(active.status, 'Active');

  // Step 4: Attempt Active -> Closed on non-closable plan -> Must throw error!
  assert.throws(() => {
    quotationService.updateStatus(quote.id, 'Closed');
  }, /does not allow early termination/);
});
