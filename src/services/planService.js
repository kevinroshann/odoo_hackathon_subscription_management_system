class PlanService {
  constructor(db) {
    this.db = db;
  }

  getAllPlans({ activeOnly = false } = {}) {
    let sql = 'SELECT * FROM subscription_plans WHERE 1=1';
    if (activeOnly) {
      sql += ' AND active = 1';
    }
    sql += ' ORDER BY id ASC';

    const stmt = this.db.prepare(sql);
    const plans = stmt.all();

    return plans.map(p => this.formatPlan(p));
  }

  getPlanById(id) {
    const stmt = this.db.prepare('SELECT * FROM subscription_plans WHERE id = ?');
    const plan = stmt.get(id);
    if (!plan) return null;
    return this.formatPlan(plan);
  }

  formatPlan(plan) {
    return {
      ...plan,
      billing_interval: Number(plan.billing_interval),
      base_fee: Number(plan.base_fee),
      min_quantity: Number(plan.min_quantity),
      auto_close: Boolean(plan.auto_close),
      closable_early: Boolean(plan.closable_early),
      pausable: Boolean(plan.pausable),
      renewable: Boolean(plan.renewable),
      active: Boolean(plan.active)
    };
  }

  createPlan({
    code,
    name,
    description = '',
    billing_frequency,
    billing_interval = 1,
    base_fee = 0.0,
    min_quantity = 1,
    start_date = null,
    end_date = null,
    auto_close = 0,
    closable_early = 1,
    pausable = 1,
    renewable = 1,
    active = 1
  }) {
    if (!code || !name || !billing_frequency) {
      throw new Error('Plan code, name, and billing_frequency are required');
    }

    const validFrequencies = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!validFrequencies.includes(billing_frequency.toLowerCase())) {
      throw new Error(`Invalid billing frequency. Must be one of: ${validFrequencies.join(', ')}`);
    }

    if (start_date && end_date && start_date > end_date) {
      throw new Error('Plan start_date cannot be later than end_date');
    }

    const stmt = this.db.prepare(`
      INSERT INTO subscription_plans (
        code, name, description, billing_frequency, billing_interval,
        base_fee, min_quantity, start_date, end_date,
        auto_close, closable_early, pausable, renewable, active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      code.trim().toUpperCase(),
      name.trim(),
      description || '',
      billing_frequency.toLowerCase(),
      Number(billing_interval) || 1,
      Number(base_fee) || 0.0,
      Number(min_quantity) || 1,
      start_date || null,
      end_date || null,
      auto_close ? 1 : 0,
      closable_early ? 1 : 0,
      pausable ? 1 : 0,
      renewable ? 1 : 0,
      active ? 1 : 0
    );

    return this.getPlanById(result.lastInsertRowid);
  }

  updatePlan(id, fields) {
    const existing = this.getPlanById(id);
    if (!existing) throw new Error(`Plan with ID ${id} not found`);

    const code = fields.code !== undefined ? fields.code.trim().toUpperCase() : existing.code;
    const name = fields.name !== undefined ? fields.name.trim() : existing.name;
    const description = fields.description !== undefined ? fields.description : existing.description;
    const billing_frequency = fields.billing_frequency !== undefined ? fields.billing_frequency.toLowerCase() : existing.billing_frequency;
    const billing_interval = fields.billing_interval !== undefined ? Number(fields.billing_interval) : existing.billing_interval;
    const base_fee = fields.base_fee !== undefined ? Number(fields.base_fee) : existing.base_fee;
    const min_quantity = fields.min_quantity !== undefined ? Number(fields.min_quantity) : existing.min_quantity;
    const start_date = fields.start_date !== undefined ? fields.start_date : existing.start_date;
    const end_date = fields.end_date !== undefined ? fields.end_date : existing.end_date;
    const auto_close = fields.auto_close !== undefined ? (fields.auto_close ? 1 : 0) : (existing.auto_close ? 1 : 0);
    const closable_early = fields.closable_early !== undefined ? (fields.closable_early ? 1 : 0) : (existing.closable_early ? 1 : 0);
    const pausable = fields.pausable !== undefined ? (fields.pausable ? 1 : 0) : (existing.pausable ? 1 : 0);
    const renewable = fields.renewable !== undefined ? (fields.renewable ? 1 : 0) : (existing.renewable ? 1 : 0);
    const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (existing.active ? 1 : 0);

    const validFrequencies = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!validFrequencies.includes(billing_frequency)) {
      throw new Error(`Invalid billing frequency. Must be one of: ${validFrequencies.join(', ')}`);
    }

    if (start_date && end_date && start_date > end_date) {
      throw new Error('Plan start_date cannot be later than end_date');
    }

    const stmt = this.db.prepare(`
      UPDATE subscription_plans
      SET code = ?, name = ?, description = ?, billing_frequency = ?, billing_interval = ?,
          base_fee = ?, min_quantity = ?, start_date = ?, end_date = ?,
          auto_close = ?, closable_early = ?, pausable = ?, renewable = ?, active = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      code, name, description, billing_frequency, billing_interval,
      base_fee, min_quantity, start_date, end_date,
      auto_close, closable_early, pausable, renewable, active,
      id
    );

    return this.getPlanById(id);
  }

  deletePlan(id) {
    const stmt = this.db.prepare('DELETE FROM subscription_plans WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // --- Plan Behavior Rule Verification Engine ---
  checkPlanAvailability(planId, dateStr = new Date().toISOString().slice(0, 10)) {
    const plan = this.getPlanById(planId);
    if (!plan) return { available: false, reason: 'Plan not found' };
    if (!plan.active) return { available: false, reason: 'Plan is inactive' };

    if (plan.start_date && dateStr < plan.start_date) {
      return { available: false, reason: `Plan not available until ${plan.start_date}` };
    }
    if (plan.end_date && dateStr > plan.end_date) {
      return { available: false, reason: `Plan expired on ${plan.end_date}` };
    }

    return { available: true, plan };
  }

  validateSubscriptionAction(planId, action) {
    const plan = this.getPlanById(planId);
    if (!plan) throw new Error('Plan not found');

    switch (action) {
      case 'early_close':
        if (!plan.closable_early) {
          return { allowed: false, reason: `Plan '${plan.name}' does not allow early termination (closable_early = false)` };
        }
        return { allowed: true };

      case 'pause':
        if (!plan.pausable) {
          return { allowed: false, reason: `Plan '${plan.name}' cannot be paused (pausable = false)` };
        }
        return { allowed: true };

      case 'renew':
        if (!plan.renewable) {
          return { allowed: false, reason: `Plan '${plan.name}' is non-renewable (renewable = false)` };
        }
        return { allowed: true };

      case 'auto_close':
        return {
          allowed: true,
          shouldAutoClose: plan.auto_close,
          message: plan.auto_close
            ? `Plan will automatically close when the subscription end date is reached.`
            : `Plan remains active or awaits manual action upon expiration.`
        };

      default:
        return { allowed: true };
    }
  }
}

module.exports = PlanService;
