const { getDatabase } = require('./database');
const ProductService = require('../services/productService');
const PlanService = require('../services/planService');
const DiscountService = require('../services/discountService');
const TemplateService = require('../services/templateService');
const QuotationService = require('../services/quotationService');

function seedDatabase(db) {
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

  console.log('Seeding Brightloop Software database...');

  // 1. Products Master
  const p1 = productService.createProduct({
    code: 'PROD-BL-ERP',
    name: 'Brightloop Cloud ERP Platform',
    type: 'Software',
    sales_price: 1000.0,
    cost_price: 350.0,
    notes: 'Core business management subscription software with finance, CRM, and inventory'
  });

  const p2 = productService.createProduct({
    code: 'PROD-AI-ANALYTICS',
    name: 'Intelligent Analytics & AI Insights',
    type: 'Add-on',
    sales_price: 180.0,
    cost_price: 45.0,
    notes: 'Real-time predictive forecasting and multi-currency reporting plugin'
  });

  const p3 = productService.createProduct({
    code: 'PROD-IMPL-SRV',
    name: 'Enterprise Onboarding & Migration Service',
    type: 'Service',
    sales_price: 2400.0,
    cost_price: 900.0,
    notes: 'Dedicated solution architect implementation and data pipeline setup'
  });

  const p4 = productService.createProduct({
    code: 'PROD-API-PACK',
    name: 'High-Throughput API Gateway Tokens',
    type: 'Consumable',
    sales_price: 65.0,
    cost_price: 10.0,
    notes: '100,000 requests monthly quota pack for external third-party integrations'
  });

  // 2. Product Attributes & Variants (e.g. Odoo brand +560)
  const brandAttr = productService.addAttribute(p1.id, 'Brand Edition');
  const valStd = productService.addAttributeValue(brandAttr.id, {
    value: 'Standard Edition',
    price_extra: 0.0,
    cost_extra: 0.0
  });
  const valOdoo = productService.addAttributeValue(brandAttr.id, {
    value: 'Odoo Connected Brand',
    price_extra: 560.0, // <-- Explicit requirement from PDF (+560 to price!)
    cost_extra: 150.0
  });
  const valEnt = productService.addAttributeValue(brandAttr.id, {
    value: 'Enterprise Dedicated',
    price_extra: 1250.0,
    cost_extra: 400.0
  });

  // Concrete variants
  const varStd = productService.createVariant(p1.id, {
    sku: 'BL-ERP-STD',
    variant_name: 'Brightloop Cloud ERP (Standard Edition)',
    attribute_value_ids: [valStd.id]
  });

  const varOdoo = productService.createVariant(p1.id, {
    sku: 'BL-ERP-ODOO-560',
    variant_name: 'Brightloop Cloud ERP (Odoo Connected Brand)',
    attribute_value_ids: [valOdoo.id]
  });

  const varEnt = productService.createVariant(p1.id, {
    sku: 'BL-ERP-ENT-DED',
    variant_name: 'Brightloop Cloud ERP (Enterprise Dedicated)',
    attribute_value_ids: [valEnt.id]
  });

  // 3. Subscription Plans (daily, weekly, monthly, yearly, min quantities, behavior rules)
  const planDaily = planService.createPlan({
    code: 'PLAN-DAILY-SANDBOX',
    name: 'Developer Sandbox Daily Pass',
    description: 'Instant environment testing with daily billing and automatic closure.',
    billing_frequency: 'daily',
    billing_interval: 1,
    base_fee: 10.0,
    min_quantity: 1,
    start_date: '2026-01-01',
    end_date: '2027-12-31',
    auto_close: 1, // Auto-close enabled
    closable_early: 1,
    pausable: 0,
    renewable: 0
  });

  const planWeekly = planService.createPlan({
    code: 'PLAN-WEEKLY-ACCEL',
    name: 'Growth Sprint Weekly Plan',
    description: 'Short-term team project license billed every week.',
    billing_frequency: 'weekly',
    billing_interval: 1,
    base_fee: 45.0,
    min_quantity: 2,
    start_date: '2026-01-01',
    end_date: '2027-12-31',
    auto_close: 0,
    closable_early: 1,
    pausable: 1,
    renewable: 1
  });

  const planMonthly = planService.createPlan({
    code: 'PLAN-MONTHLY-BIZ',
    name: 'Business Pro Monthly',
    description: 'Core subscription for thriving businesses with monthly billing and flexible pausing.',
    billing_frequency: 'monthly',
    billing_interval: 1,
    base_fee: 99.0,
    min_quantity: 3,
    start_date: '2026-01-01',
    end_date: '2028-12-31',
    auto_close: 0,
    closable_early: 1,
    pausable: 1,
    renewable: 1
  });

  const planYearly = planService.createPlan({
    code: 'PLAN-YEARLY-ENT',
    name: 'Enterprise Strategic Annual',
    description: 'Committed annual partnership with fixed cost benefits; early cancellation locked.',
    billing_frequency: 'yearly',
    billing_interval: 1,
    base_fee: 499.0,
    min_quantity: 10,
    start_date: '2026-01-01',
    end_date: '2028-12-31',
    auto_close: 0,
    closable_early: 0, // early close locked!
    pausable: 1,
    renewable: 1
  });

  // 4. Admin Discounts (fixed amount or %, min requirements, usage caps, start/end dates, product/order scope)
  const discOdoo = discountService.createDiscount({
    code: 'ODOO560LAUNCH',
    name: 'Odoo Ecosystem Special Promotion',
    type: 'percentage',
    value: 12.0,
    scope: 'specific_products',
    product_ids: [p1.id],
    min_purchase_amount: 1500.0,
    min_quantity: 2,
    usage_limit: 50,
    start_date: '2026-01-01',
    end_date: '2027-12-31',
    notes: '12% discount on Odoo ERP licenses for multi-seat deployments'
  });

  const discFixed = discountService.createDiscount({
    code: 'SEATEXPAND250',
    name: 'Volume Expansion Fixed Credit',
    type: 'fixed',
    value: 250.0,
    scope: 'whole_subscription',
    min_purchase_amount: 2000.0,
    min_quantity: 5,
    usage_limit: 100,
    start_date: '2026-01-01',
    end_date: '2027-12-31',
    notes: '$250 instantaneous discount for taking 5+ seats'
  });

  const discWelcome = discountService.createDiscount({
    code: 'WELCOME10',
    name: 'New Customer Welcome Kickstart',
    type: 'percentage',
    value: 10.0,
    scope: 'whole_subscription',
    min_purchase_amount: 500.0,
    min_quantity: 1,
    usage_limit: 200,
    start_date: '2026-01-01',
    end_date: '2028-12-31',
    notes: 'General 10% coupon for new customer onboarding'
  });

  // 5. Quotation Templates
  const templateOdoo = templateService.createTemplate({
    name: 'Brightloop Odoo Cloud Suite Template',
    description: 'Preconfigured offer for companies migrating to Odoo Brand Edition with AI analytics.',
    plan_id: planMonthly.id,
    validity_days: 15, // Fixed 15-day validity period
    payment_terms: 'Net 30',
    terms_and_conditions: 'Standard Brightloop SaaS SLA applies. 99.9% uptime guaranteed. Monthly automatic billing.',
    lines: [
      {
        product_id: p1.id,
        variant_id: varOdoo.id,
        quantity: 5,
        unit_price: varOdoo.calculated_sales_price, // $1560
        discount_percent: 0.0
      },
      {
        product_id: p2.id,
        variant_id: null,
        quantity: 5,
        unit_price: 180.0,
        discount_percent: 5.0
      }
    ]
  });

  const templateEnterprise = templateService.createTemplate({
    name: 'Enterprise Strategic Annual Transformation',
    description: 'Turnkey 10+ seat annual contract with dedicated implementation and API throughput.',
    plan_id: planYearly.id,
    validity_days: 30, // Fixed 30-day validity period
    payment_terms: 'Net 45',
    terms_and_conditions: 'Annual commitment. Non-cancellable during term. Invoicing upon signature.',
    lines: [
      {
        product_id: p1.id,
        variant_id: varEnt.id,
        quantity: 10,
        unit_price: varEnt.calculated_sales_price, // $2250
        discount_percent: 5.0
      },
      {
        product_id: p3.id,
        variant_id: null,
        quantity: 1,
        unit_price: 2400.0,
        discount_percent: 10.0
      },
      {
        product_id: p4.id,
        variant_id: null,
        quantity: 10,
        unit_price: 65.0,
        discount_percent: 0.0
      }
    ]
  });

  // 6. Seed Quotations (demonstrating status transitions: Draft -> Quotation -> Confirmed -> Active -> Closed)
  const q1 = quotationService.createFromTemplate({
    templateId: templateOdoo.id,
    customer_name: 'Apex Global Logistics',
    customer_email: 'procurement@apexlogistics.com',
    start_date: '2026-11-01',
    discount_code: 'ODOO560LAUNCH',
    notes: 'Urgent priority rollout for Q4 regional hubs.'
  });
  quotationService.updateStatus(q1.id, 'Quotation');
  quotationService.updateStatus(q1.id, 'Confirmed');
  quotationService.updateStatus(q1.id, 'Active');

  const q2 = quotationService.createFromTemplate({
    templateId: templateEnterprise.id,
    customer_name: 'Starlight Medical Informatics',
    customer_email: 'it-contracts@starlightmed.org',
    start_date: '2026-11-15',
    discount_code: 'SEATEXPAND250',
    notes: 'HIPAA compliant deployment quote awaiting CFO sign-off.'
  });
  quotationService.updateStatus(q2.id, 'Quotation');

  const q3 = quotationService.createQuotation({
    customer_name: 'Vanguard Retail Systems',
    customer_email: 'finance@vanguardretail.io',
    plan_id: planWeekly.id,
    status: 'Draft',
    validity_days: 14,
    start_date: '2026-11-05',
    payment_terms: 'Immediate',
    discount_code: 'WELCOME10',
    tax_rate: 10.0,
    lines: [
      {
        product_id: p1.id,
        variant_id: varStd.id,
        quantity: 3,
        unit_price: varStd.calculated_sales_price,
        discount_percent: 0.0
      },
      {
        product_id: p2.id,
        quantity: 3,
        unit_price: 180.0,
        discount_percent: 0.0
      }
    ]
  });

  console.log('Database seeded successfully!');
}

if (require.main === module) {
  const db = getDatabase();
  seedDatabase(db);
}

module.exports = { seedDatabase };
