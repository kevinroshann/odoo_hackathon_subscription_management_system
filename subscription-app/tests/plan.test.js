const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { initSchema } = require('../src/db/database');
const PlanService = require('../src/services/planService');

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

test('Plan Configurations: Create daily, weekly, monthly, yearly plans with min quantity and dates', () => {
  const db = setupTestDb();
  const service = new PlanService(db);

  const frequencies = ['daily', 'weekly', 'monthly', 'yearly'];
  for (const freq of frequencies) {
    const plan = service.createPlan({
      code: `PLAN-${freq.toUpperCase()}`,
      name: `${freq} subscription`,
      billing_frequency: freq,
      billing_interval: 1,
      base_fee: 50.0,
      min_quantity: 5,
      start_date: '2026-01-01',
      end_date: '2026-12-31'
    });

    assert.strictEqual(plan.billing_frequency, freq);
    assert.strictEqual(plan.min_quantity, 5);
    assert.strictEqual(plan.start_date, '2026-01-01');
    assert.strictEqual(plan.end_date, '2026-12-31');
  }
});

test('Plan Behavior Rules: auto-close, early close, pause, renew toggles', () => {
  const db = setupTestDb();
  const service = new PlanService(db);

  // 1. Strict Enterprise plan with early close disabled
  const strictPlan = service.createPlan({
    code: 'PLAN-STRICT',
    name: 'Strict 1-Year Commitment',
    billing_frequency: 'yearly',
    auto_close: 1,
    closable_early: 0, // early close disallowed
    pausable: 0,       // pausing disallowed
    renewable: 1
  });

  assert.strictEqual(strictPlan.auto_close, true);
  assert.strictEqual(strictPlan.closable_early, false);
  assert.strictEqual(strictPlan.pausable, false);
  assert.strictEqual(strictPlan.renewable, true);

  // Validate action checks
  const earlyCloseCheck = service.validateSubscriptionAction(strictPlan.id, 'early_close');
  assert.strictEqual(earlyCloseCheck.allowed, false);
  assert.ok(earlyCloseCheck.reason.includes('does not allow early termination'));

  const pauseCheck = service.validateSubscriptionAction(strictPlan.id, 'pause');
  assert.strictEqual(pauseCheck.allowed, false);
  assert.ok(pauseCheck.reason.includes('cannot be paused'));

  const renewCheck = service.validateSubscriptionAction(strictPlan.id, 'renew');
  assert.strictEqual(renewCheck.allowed, true);

  const autoCloseCheck = service.validateSubscriptionAction(strictPlan.id, 'auto_close');
  assert.strictEqual(autoCloseCheck.shouldAutoClose, true);
});

test('Plan Availability: Validates dates and active status', () => {
  const db = setupTestDb();
  const service = new PlanService(db);

  const plan = service.createPlan({
    code: 'PLAN-SUMMER',
    name: 'Summer Promo',
    billing_frequency: 'monthly',
    start_date: '2026-06-01',
    end_date: '2026-08-31'
  });

  // Check before start date
  const before = service.checkPlanAvailability(plan.id, '2026-05-15');
  assert.strictEqual(before.available, false);

  // Check during availability window
  const during = service.checkPlanAvailability(plan.id, '2026-07-01');
  assert.strictEqual(during.available, true);

  // Check after end date
  const after = service.checkPlanAvailability(plan.id, '2026-09-01');
  assert.strictEqual(after.available, false);
});
