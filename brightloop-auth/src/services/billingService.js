const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const { transaction } = require('../database');
const { httpError } = require('../utils/httpError');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function toDateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}

function normalizeFrequency(frequency) {
  const value = String(frequency || 'monthly').trim().toLowerCase();
  if (value === 'annual' || value === 'annually') return 'yearly';
  return FREQUENCIES.includes(value) ? value : 'monthly';
}

function addDays(dateString, days) {
  const [year, month, day] = toDateOnly(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function addInterval(dateString, frequency, interval = 1) {
  const [year, month, day] = toDateOnly(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const steps = Math.max(1, Number(interval) || 1);

  switch (normalizeFrequency(frequency)) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() + steps);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + (7 * steps));
      break;
    case 'monthly': {
      const originalDay = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + steps);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
    case 'yearly': {
      const originalDay = date.getUTCDate();
      const originalMonth = date.getUTCMonth();
      date.setUTCDate(1);
      date.setUTCFullYear(date.getUTCFullYear() + steps);
      date.setUTCMonth(originalMonth);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(originalDay, lastDay));
      break;
    }
    default:
      break;
  }

  return date.toISOString().slice(0, 10);
}

function paymentTermDays(paymentTerms) {
  const match = String(paymentTerms || '').match(/(\d+)/);
  return match ? Number(match[1]) : 30;
}

class BillingService {
  constructor({ db, discountService, now = () => new Date(), logger = console } = {}) {
    if (!db) throw new Error('BillingService requires a database');
    if (!discountService) throw new Error('BillingService requires Member 2 discountService');
    this.db = db;
    this.discountService = discountService;
    this.now = now;
    this.logger = logger;
    this._cronTask = null;
  }

  today() {
    return toDateOnly(this.now());
  }

  getSubscription(id) {
    return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) || null;
  }

  getQuotation(id) {
    if (!id) return null;
    return this.db.prepare('SELECT * FROM sales_quotations WHERE id = ?').get(id) || null;
  }

  getPlan(id) {
    if (!id) return null;
    return this.db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) || null;
  }

  getQuotationLines(quotationId) {
    if (!quotationId) return [];
    return this.db.prepare(
      'SELECT * FROM sales_quotation_lines WHERE quotation_id = ? ORDER BY id ASC'
    ).all(quotationId);
  }

  getActiveTaxRules() {
    return this.db.prepare(
      'SELECT * FROM tax_rules WHERE is_active = 1 ORDER BY id ASC'
    ).all();
  }

  generateNumber(table, column, prefix) {
    const rows = this.db.prepare(
      `SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC`
    ).all(`${prefix}%`);

    let next = 1;
    for (const row of rows) {
      const sequence = Number(String(row.value).slice(prefix.length));
      if (Number.isFinite(sequence)) next = Math.max(next, sequence + 1);
    }

    let candidate = `${prefix}${String(next).padStart(4, '0')}`;
    while (this.db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(candidate)) {
      next += 1;
      candidate = `${prefix}${String(next).padStart(4, '0')}`;
    }
    return candidate;
  }

  buildBaseLines(subscription, quotation, plan, lines) {
    if (quotation && lines.length > 0) {
      const baseLines = lines.map((line) => ({
        description: line.description || 'Subscription charge',
        amount: round2(line.subtotal),
        line_type: 'base',
        tax_rule_id: null
      }));

      if (plan && Number(plan.base_fee) > 0) {
        baseLines.push({
          description: `${plan.name} plan base fee`,
          amount: round2(plan.base_fee),
          line_type: 'base',
          tax_rule_id: null
        });
      }
      return baseLines;
    }

    const amount = quotation
      ? Number(quotation.subtotal) || 0
      : Number(plan?.base_fee) || Number(subscription.amount) || 0;

    return [{
      description: `${subscription.plan_name} subscription`,
      amount: round2(amount),
      line_type: 'base',
      tax_rule_id: null
    }];
  }

  evaluateDiscount(subscription, quotation, lines, baseSubtotal, billingDate) {
    const discountId = subscription.discount_id || quotation?.discount_id || null;
    if (!discountId) return { discount: null, amount: 0, reason: 'No discount applied' };

    const items = lines.length > 0
      ? lines.map((line) => ({
          product_id: line.product_id,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price)
        }))
      : [{
          product_id: null,
          quantity: 1,
          unit_price: round2(baseSubtotal)
        }];

    const evaluation = this.discountService.evaluateDiscount({
      discountIdOrCode: discountId,
      items,
      currentDate: billingDate
    });

    if (!evaluation.valid) {
      return { discount: evaluation.discount || null, amount: 0, reason: evaluation.reason };
    }

    return {
      discount: evaluation.discount,
      amount: Math.min(round2(evaluation.discount_amount), round2(baseSubtotal)),
      reason: evaluation.reason
    };
  }

  calculateTaxes(taxableAmount) {
    const rules = this.getActiveTaxRules();
    return {
      rules,
      lines: rules.map((rule) => ({
        description: `${rule.name} (${round2(rule.percentage)}%)`,
        amount: round2((taxableAmount * Number(rule.percentage)) / 100),
        line_type: 'tax',
        tax_rule_id: rule.id
      })),
      total: round2(rules.reduce(
        (sum, rule) => sum + ((taxableAmount * Number(rule.percentage)) / 100),
        0
      ))
    };
  }

  computeNextDate(subscription, fromDate) {
    const frequency = normalizeFrequency(
      subscription.billing_frequency || subscription.billing_period
    );
    const interval = Math.max(1, Number(subscription.billing_interval) || 1);
    return addInterval(fromDate, frequency, interval);
  }

  buildInvoiceDraft(subscription, billingDate = this.today()) {
    const quotation = this.getQuotation(subscription.quotation_id);
    const plan = this.getPlan(subscription.plan_id || quotation?.plan_id);
    const quotationLines = this.getQuotationLines(quotation?.id);

    const baseLines = this.buildBaseLines(subscription, quotation, plan, quotationLines);
    const subtotal = round2(baseLines.reduce((sum, line) => sum + line.amount, 0));

    const discount = this.evaluateDiscount(
      subscription,
      quotation,
      quotationLines,
      subtotal,
      billingDate
    );
    const discountTotal = round2(Math.min(discount.amount, subtotal));
    const taxableAmount = round2(Math.max(0, subtotal - discountTotal));
    const taxes = this.calculateTaxes(taxableAmount);
    const totalAmount = round2(taxableAmount + taxes.total);

    const periodStart = toDateOnly(subscription.next_billing_date || billingDate);
    const periodEnd = this.computeNextDate(subscription, periodStart);

    const lines = [...baseLines];
    if (discountTotal > 0) {
      lines.push({
        description: discount.discount
          ? `Discount: ${discount.discount.name} (${discount.discount.code})`
          : 'Subscription discount',
        amount: -discountTotal,
        line_type: 'discount',
        tax_rule_id: null
      });
    }
    lines.push(...taxes.lines.filter((line) => line.amount !== 0));

    const paymentDays = paymentTermDays(quotation?.payment_terms);

    return {
      invoice_number: this.generateNumber(
        'invoices', 'number', `INV-${billingDate.slice(0, 4)}-`
      ),
      issue_date: billingDate,
      due_date: addDays(billingDate, paymentDays),
      billing_period_start: periodStart,
      billing_period_end: periodEnd,
      subtotal,
      discount_total: discountTotal,
      tax_total: taxes.total,
      total_amount: totalAmount,
      currency: 'USD',
      notes: quotation?.notes || 'Automatically generated by the recurring billing engine',
      lines,
      discount,
      tax_rules: taxes.rules
    };
  }

  insertInvoice(subscription, draft) {
    const result = this.db.prepare(`
      INSERT INTO invoices (
        number, customer_id, subscription_id, status, issue_date, due_date,
        total, subtotal, tax_total, discount_total, total_amount,
        billing_period_start, billing_period_end, currency, notes
      ) VALUES (?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draft.invoice_number,
      subscription.customer_id,
      subscription.id,
      draft.issue_date,
      draft.due_date,
      draft.total_amount,
      draft.subtotal,
      draft.tax_total,
      draft.discount_total,
      draft.total_amount,
      draft.billing_period_start,
      draft.billing_period_end,
      draft.currency,
      draft.notes
    );

    const invoiceId = Number(result.lastInsertRowid);
    const lineStatement = this.db.prepare(`
      INSERT INTO invoice_line_items (
        invoice_id, description, amount, line_type, tax_rule_id
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const line of draft.lines) {
      lineStatement.run(
        invoiceId,
        line.description,
        round2(line.amount),
        line.line_type,
        line.tax_rule_id || null
      );
    }

    return invoiceId;
  }

  getInvoiceById(id) {
    const invoice = this.db.prepare(`
      SELECT i.*,
             u.name AS customer_name, u.email AS customer_email,
             s.number AS subscription_number
      FROM invoices i
      LEFT JOIN users u ON u.id = i.customer_id
      LEFT JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.id = ?
    `).get(id);
    if (!invoice) return null;

    const paidAmount = round2(this.db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE invoice_id = ?'
    ).get(id).amount);

    const totalAmount = round2(invoice.total_amount || invoice.total);
    return {
      ...invoice,
      subtotal: round2(invoice.subtotal),
      tax_total: round2(invoice.tax_total),
      discount_total: round2(invoice.discount_total),
      total_amount: totalAmount,
      total: round2(invoice.total),
      paid_amount: paidAmount,
      balance: round2(totalAmount - paidAmount),
      line_items: this.db.prepare(
        'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id ASC'
      ).all(id),
      payments: this.db.prepare(
        'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC'
      ).all(id)
    };
  }

  billSubscription(subscriptionId, { asOf = this.today() } = {}) {
    const billingDate = toDateOnly(asOf);

    return transaction(this.db, () => {
      // Re-read inside the transaction: this is the race-condition guard.
      const subscription = this.getSubscription(subscriptionId);
      if (!subscription) throw httpError(404, `Subscription #${subscriptionId} not found`);
      if (subscription.status !== 'Active') {
        return { skipped: true, reason: 'not_active', subscription_id: Number(subscriptionId) };
      }
      if (!subscription.next_billing_date || subscription.next_billing_date > billingDate) {
        return { skipped: true, reason: 'not_due', subscription_id: Number(subscriptionId) };
      }

      const periodStart = subscription.next_billing_date;
      const existing = this.db.prepare(`
        SELECT id FROM invoices
        WHERE subscription_id = ? AND billing_period_start = ?
        LIMIT 1
      `).get(subscription.id, periodStart);

      if (existing) {
        // Repair state left behind by a crash after invoice insertion.
        const nextDate = this.computeNextDate(subscription, periodStart);
        this.db.prepare(`
          UPDATE subscriptions
          SET next_billing_date = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(nextDate, subscription.id);
        return {
          skipped: true,
          reason: 'already_billed',
          subscription_id: subscription.id,
          invoice: this.getInvoiceById(existing.id)
        };
      }

      const draft = this.buildInvoiceDraft(subscription, billingDate);
      const invoiceId = this.insertInvoice(subscription, draft);
      const nextDate = this.computeNextDate(subscription, periodStart);

      this.db.prepare(`
        UPDATE subscriptions
        SET next_billing_date = ?, last_billed_date = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextDate, billingDate, subscription.id);

      return {
        skipped: false,
        subscription_id: subscription.id,
        invoice: this.getInvoiceById(invoiceId)
      };
    });
  }

  ensureCustomer(email, name) {
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) throw new Error('Cannot bill a quotation without a customer email');

    const existing = this.db.prepare(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE'
    ).get(normalizedEmail);
    if (existing) return Number(existing.id);

    // Customers originating in Member 2 may not have signed up yet. Create a
    // portal account so invoices stay linked to users.id; they can use the
    // normal password-reset flow to claim it.
    const temporaryPassword = crypto.randomBytes(24).toString('hex');
    try {
      return Number(this.db.prepare(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(
        String(name || normalizedEmail).trim() || normalizedEmail,
        normalizedEmail,
        bcrypt.hashSync(temporaryPassword, 10),
        'customer'
      ).lastInsertRowid);
    } catch (err) {
      const raced = this.db.prepare(
        'SELECT id FROM users WHERE email = ? COLLATE NOCASE'
      ).get(normalizedEmail);
      if (raced) return Number(raced.id);
      throw err;
    }
  }

  /**
   * Bridge Member 2's Quotation state machine into Member 1's subscriptions.
   * Called by the daily sweep and by POST /api/admin/billing/sync.
   */
  syncActiveQuotations() {
    const summary = { synced: 0, errors: [] };
    const quotations = this.db.prepare(`
      SELECT q.*
      FROM sales_quotations q
      LEFT JOIN subscriptions s ON s.quotation_id = q.id
      WHERE q.status = 'Active' AND s.id IS NULL
      ORDER BY q.id ASC
    `).all();

    for (const quotation of quotations) {
      try {
        const subscriptionId = transaction(this.db, () => {
          const customerId = this.ensureCustomer(quotation.customer_email, quotation.customer_name);
          const plan = this.getPlan(quotation.plan_id);
          const frequency = normalizeFrequency(plan?.billing_frequency || 'monthly');
          const interval = Math.max(1, Number(plan?.billing_interval) || 1);
          const startDate = toDateOnly(quotation.start_date || this.today());
          const nextBillingDate = quotation.start_date
            ? toDateOnly(quotation.start_date)
            : this.today();
          const number = this.generateNumber(
            'subscriptions', 'number', `SUB-${startDate.slice(0, 4)}-`
          );

          const result = this.db.prepare(`
            INSERT INTO subscriptions (
              number, customer_id, plan_name, status, start_date, expiry_date,
              billing_period, amount, quotation_id, plan_id, discount_id,
              billing_frequency, billing_interval, next_billing_date
            ) VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            number,
            customerId,
            plan?.name || `Plan #${quotation.plan_id}`,
            startDate,
            plan?.end_date || null,
            frequency,
            round2(quotation.total_amount),
            quotation.id,
            quotation.plan_id || null,
            quotation.discount_id || null,
            frequency,
            interval,
            nextBillingDate
          );

          const id = Number(result.lastInsertRowid);
          this.db.prepare(`
            UPDATE sales_quotations
            SET customer_id = ?, subscription_id = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(customerId, id, quotation.id);
          return id;
        });
        summary.synced += 1;
        summary.last_subscription_id = subscriptionId;
      } catch (err) {
        summary.errors.push({ quotation_id: quotation.id, error: err.message });
      }
    }

    return summary;
  }

  runBillingSweep({ asOf = this.today() } = {}) {
    const billingDate = toDateOnly(asOf);
    const summary = {
      as_of: billingDate,
      synced_subscriptions: 0,
      billed: 0,
      skipped: 0,
      invoices: [],
      errors: []
    };

    try {
      const sync = this.syncActiveQuotations();
      summary.synced_subscriptions = sync.synced;
      summary.errors.push(...sync.errors);
    } catch (err) {
      summary.errors.push({ stage: 'sync', error: err.message });
    }

    const due = this.db.prepare(`
      SELECT id FROM subscriptions
      WHERE status = 'Active'
        AND next_billing_date IS NOT NULL
        AND next_billing_date <= ?
      ORDER BY next_billing_date ASC, id ASC
    `).all(billingDate);

    for (const row of due) {
      try {
        const result = this.billSubscription(row.id, { asOf: billingDate });
        if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.billed += 1;
          summary.invoices.push(result.invoice);
        }
      } catch (err) {
        summary.errors.push({ subscription_id: row.id, error: err.message });
      }
    }

    return summary;
  }

  startCron({ expression = process.env.BILLING_CRON || '0 2 * * *' } = {}) {
    if (this._cronTask) return this._cronTask;
    if (!cron.validate(expression)) {
      throw new Error(`Invalid billing cron expression: ${expression}`);
    }

    this._cronTask = cron.schedule(expression, () => {
      try {
        const summary = this.runBillingSweep();
        this.logger.log(
          `[billing] sweep complete: ${summary.billed} billed, ${summary.skipped} skipped, ` +
          `${summary.errors.length} error(s)`
        );
      } catch (err) {
        this.logger.error('[billing] sweep failed:', err);
      }
    }, {
      timezone: process.env.BILLING_TIMEZONE || 'UTC'
    });

    this.logger.log(`[billing] cron scheduled (${expression}, ${process.env.BILLING_TIMEZONE || 'UTC'})`);
    return this._cronTask;
  }

  stopCron() {
    if (this._cronTask) {
      this._cronTask.stop();
      this._cronTask = null;
    }
  }
}

module.exports = BillingService;
module.exports.addInterval = addInterval;
module.exports.addDays = addDays;
module.exports.toDateOnly = toDateOnly;
module.exports.normalizeFrequency = normalizeFrequency;
module.exports.round2 = round2;
