
const { transaction } = require('../database');
const { httpError } = require('../utils/httpError');

const { generateInvoicePDF } = require(
  '../../../../member-4-finance/backend/invoicePdf'
);

const INVOICE_STATUSES = ['Draft', 'Confirmed', 'Paid'];

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decorateInvoice(row) {
  const totalAmount = round2(row.total_amount || row.total);
  const paidAmount = round2(row.paid_amount);

  return {
    ...row,
    subtotal: round2(row.subtotal),
    tax_total: round2(row.tax_total),
    discount_total: round2(row.discount_total),
    total_amount: totalAmount,
    total: round2(row.total),
    paid_amount: paidAmount,
    balance: round2(totalAmount - paidAmount)
  };
}

class InvoiceService {
  constructor(db) {
    this.db = db;
  }

  listInvoices({
    status = null,
    customer_id = null,
    subscription_id = null,
    from = null,
    to = null,
    q = null,
    overdue = false,
    limit = 50,
    offset = 0
  } = {}) {
    const where = [];
    const params = [];

    if (status) {
      if (!INVOICE_STATUSES.includes(status)) {
        throw httpError(
          400,
          `Invalid status filter. Allowed: ${INVOICE_STATUSES.join(', ')}`
        );
      }
      where.push('i.status = ?');
      params.push(status);
    }

    const customerId = numberOrNull(customer_id);
    if (customerId !== null) {
      where.push('i.customer_id = ?');
      params.push(customerId);
    }

    const subscriptionId = numberOrNull(subscription_id);
    if (subscriptionId !== null) {
      where.push('i.subscription_id = ?');
      params.push(subscriptionId);
    }

    if (from) {
      where.push('i.issue_date >= ?');
      params.push(String(from));
    }

    if (to) {
      where.push('i.issue_date <= ?');
      params.push(String(to));
    }

    if (overdue) {
      where.push(
        "i.status != 'Paid' AND i.due_date IS NOT NULL AND i.due_date < date('now')"
      );
    }

    if (q) {
      where.push('(i.number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
      const term = `%${String(q).trim()}%`;
      params.push(term, term, term);
    }

    const whereSql = where.length
      ? `WHERE ${where.join(' AND ')}`
      : '';

    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const total = Number(this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM invoices i
      LEFT JOIN users u ON u.id = i.customer_id
      ${whereSql}
    `).get(...params).count);

    const rows = this.db.prepare(`
      SELECT i.*,
             u.name AS customer_name,
             u.email AS customer_email,
             s.number AS subscription_number,
             COALESCE((
               SELECT SUM(p.amount)
               FROM payments p
               WHERE p.invoice_id = i.id
             ), 0) AS paid_amount
      FROM invoices i
      LEFT JOIN users u ON u.id = i.customer_id
      LEFT JOIN subscriptions s ON s.id = i.subscription_id
      ${whereSql}
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    return {
      invoices: rows.map(decorateInvoice),
      total,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  getInvoice(id) {
    const invoice = this.db.prepare(`
      SELECT i.*,
             u.name AS customer_name,
             u.email AS customer_email,
             s.number AS subscription_number,
             COALESCE((
               SELECT SUM(p.amount)
               FROM payments p
               WHERE p.invoice_id = i.id
             ), 0) AS paid_amount
      FROM invoices i
      LEFT JOIN users u ON u.id = i.customer_id
      LEFT JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.id = ?
    `).get(id);

    if (!invoice) return null;

    return {
      ...decorateInvoice(invoice),

      line_items: this.db.prepare(
        'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id ASC'
      ).all(id),

      payments: this.db.prepare(
        'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC'
      ).all(id)
    };
  }

  // Generate and download an invoice PDF.
  downloadInvoicePDF(id, res) {
    const invoice = this.getInvoice(id);

    if (!invoice) {
      throw httpError(404, 'Invoice not found');
    }

    generateInvoicePDF(invoice, res);
  }

  updateStatus(id, newStatus, { force = false } = {}) {
    if (!INVOICE_STATUSES.includes(newStatus)) {
      throw httpError(
        400,
        `Invalid status. Allowed: ${INVOICE_STATUSES.join(', ')}`
      );
    }

    const invoice = this.getInvoice(id);

    if (!invoice) throw httpError(404, 'Invoice not found');
    if (invoice.status === newStatus) return invoice;

    const allowedTransitions = {
      Draft: ['Confirmed'],
      Confirmed: ['Paid'],
      Paid: []
    };

    if (!allowedTransitions[invoice.status].includes(newStatus)) {
      throw httpError(
        409,
        `Cannot move invoice from '${invoice.status}' to '${newStatus}'. ` +
        'The lifecycle is Draft -> Confirmed -> Paid.'
      );
    }

    if (
      newStatus === 'Paid' &&
      !force &&
      invoice.paid_amount + 0.005 < invoice.total_amount
    ) {
      throw httpError(
        409,
        'Invoice still has an outstanding balance. Record payments first or pass force=true.'
      );
    }

    this.db.prepare(`
      UPDATE invoices
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, invoice.id);

    return this.getInvoice(invoice.id);
  }

  recordPayment(id, {
    amount,
    method,
    payment_date,
    note
  } = {}) {
    const paymentAmount = round2(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw httpError(400, 'Payment amount must be greater than zero');
    }

    const paymentMethod = String(method || '').trim();

    if (!paymentMethod) {
      throw httpError(400, 'Payment method is required');
    }

    const paymentDate = String(
      payment_date || new Date().toISOString().slice(0, 10)
    ).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      throw httpError(400, 'payment_date must use the YYYY-MM-DD format');
    }

    return transaction(this.db, () => {
      const invoice = this.db.prepare(
        'SELECT * FROM invoices WHERE id = ?'
      ).get(id);

      if (!invoice) throw httpError(404, 'Invoice not found');

      if (invoice.status === 'Paid') {
        throw httpError(409, 'Invoice is already fully paid');
      }

      const totalAmount = round2(
        invoice.total_amount || invoice.total
      );

      const paidBefore = round2(this.db.prepare(
        'SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE invoice_id = ?'
      ).get(id).amount);

      const balance = round2(totalAmount - paidBefore);

      if (paymentAmount > balance + 0.005) {
        throw httpError(
          400,
          `Payment exceeds the outstanding balance of ${balance.toFixed(2)}`
        );
      }

      const result = this.db.prepare(`
        INSERT INTO payments (invoice_id, amount, method, payment_date, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        paymentAmount,
        paymentMethod,
        paymentDate,
        String(note || '').trim()
      );

      const paidAfter = round2(paidBefore + paymentAmount);

      if (paidAfter + 0.005 >= totalAmount) {
        this.db.prepare(`
          UPDATE invoices
          SET status = 'Paid', updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
      }

      return {
        payment: this.db.prepare(
          'SELECT * FROM payments WHERE id = ?'
        ).get(result.lastInsertRowid),

        invoice: this.getInvoice(id)
      };
    });
  }

  getPayments(id) {
    const invoice = this.db.prepare(
      'SELECT id FROM invoices WHERE id = ?'
    ).get(id);

    if (!invoice) throw httpError(404, 'Invoice not found');

    return this.db.prepare(
      'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC'
    ).all(id);
  }
}

module.exports = InvoiceService;
module.exports.INVOICE_STATUSES = INVOICE_STATUSES;
