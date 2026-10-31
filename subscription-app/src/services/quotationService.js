class QuotationService {
  constructor(db, { productService, planService, discountService, templateService, onStatusChange = null } = {}) {
    this.db = db;
    this.productService = productService;
    this.planService = planService;
    this.discountService = discountService;
    this.templateService = templateService;
    // Member 3 can pass a hook to sync an Active quotation into the billing
    // subscriptions table. Failures never break the quotation transition.
    this.onStatusChange = typeof onStatusChange === 'function' ? onStatusChange : null;
  }

  generateQuoteNumber() {
    const year = new Date().getFullYear();
    const prefix = `QT-${year}-`;
    const stmt = this.db.prepare(`
      SELECT quote_number FROM sales_quotations
      WHERE quote_number LIKE ?
      ORDER BY id DESC LIMIT 1
    `);
    const last = stmt.get(`${prefix}%`);
    let seq = 1;
    if (last && last.quote_number) {
      const parts = last.quote_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  calculateExpiryDate(createdDateStr, validityDays) {
    const date = new Date(createdDateStr);
    date.setDate(date.getDate() + Number(validityDays));
    return date.toISOString().slice(0, 10);
  }

  getAllQuotations({ status = null } = {}) {
    let sql = 'SELECT * FROM sales_quotations WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY id DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map(q => this.getQuotationById(q.id));
  }

  getQuotationById(id) {
    const qStmt = this.db.prepare('SELECT * FROM sales_quotations WHERE id = ?');
    const quote = qStmt.get(id);
    if (!quote) return null;

    const planStmt = this.db.prepare('SELECT * FROM subscription_plans WHERE id = ?');
    const plan = planStmt.get(quote.plan_id);

    let template = null;
    if (quote.template_id) {
      const tStmt = this.db.prepare('SELECT id, name FROM quotation_templates WHERE id = ?');
      template = tStmt.get(quote.template_id);
    }

    let discount = null;
    if (quote.discount_id) {
      discount = this.discountService.getDiscountById(quote.discount_id);
    }

    const linesStmt = this.db.prepare(`
      SELECT sql.*,
             p.code as product_code, p.name as product_name, p.type as product_type,
             pv.sku as variant_sku, pv.variant_name
      FROM sales_quotation_lines sql
      JOIN products p ON sql.product_id = p.id
      LEFT JOIN product_variants pv ON sql.variant_id = pv.id
      WHERE sql.quotation_id = ?
      ORDER BY sql.id ASC
    `);
    const lines = linesStmt.all(id);

    return {
      ...quote,
      validity_days: Number(quote.validity_days),
      subtotal: Number(quote.subtotal),
      discount_amount: Number(quote.discount_amount),
      tax_rate: Number(quote.tax_rate),
      tax_amount: Number(quote.tax_amount),
      total_amount: Number(quote.total_amount),
      plan,
      template,
      discount,
      lines: lines.map(l => ({
        id: l.id,
        quotation_id: l.quotation_id,
        product_id: l.product_id,
        product_code: l.product_code,
        product_name: l.product_name,
        product_type: l.product_type,
        variant_id: l.variant_id,
        variant_sku: l.variant_sku,
        variant_name: l.variant_name,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount_percent: Number(l.discount_percent),
        discount_amount: Number(l.discount_amount),
        subtotal: Number(l.subtotal),
        tax_percent: Number(l.tax_percent),
        total: Number(l.total)
      }))
    };
  }

  // Build quote directly from a Quotation Template
  createFromTemplate({ templateId, customer_name, customer_email, start_date, discount_code = null, notes = '' }) {
    const template = this.templateService.getTemplateById(templateId);
    if (!template) throw new Error(`Quotation Template #${templateId} not found`);

    if (!template.plan_id) {
      throw new Error(`Template '${template.name}' does not have an assigned subscription plan`);
    }

    const lines = template.lines.map(l => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      description: l.variant_name ? `${l.product_name} (${l.variant_name})` : l.product_name,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_percent: l.discount_percent,
      tax_percent: 10.0 // standard default tax rate
    }));

    return this.createQuotation({
      template_id: template.id,
      customer_name,
      customer_email,
      plan_id: template.plan_id,
      validity_days: template.validity_days,
      start_date,
      payment_terms: template.payment_terms || 'Net 30',
      discount_code,
      tax_rate: 10.0,
      notes: notes || template.description || '',
      lines
    });
  }

  createQuotation({
    quote_number,
    template_id = null,
    customer_name,
    customer_email,
    plan_id,
    status = 'Draft',
    created_date = new Date().toISOString().slice(0, 10),
    validity_days = 30,
    start_date = new Date().toISOString().slice(0, 10),
    payment_terms = 'Net 30',
    discount_code = null,
    tax_rate = 10.0,
    notes = '',
    lines = []
  }) {
    if (!customer_name || !customer_email) {
      throw new Error('Customer name and email are required');
    }
    if (!plan_id) {
      throw new Error('Subscription plan is required');
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one quotation line is required');
    }

    const plan = this.planService.getPlanById(plan_id);
    if (!plan) throw new Error('Selected subscription plan not found');

    const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    if (plan.min_quantity && totalQty < plan.min_quantity) {
      throw new Error(`Total seats/quantity (${totalQty}) is less than plan minimum required (${plan.min_quantity})`);
    }

    const resolvedQuoteNumber = quote_number || this.generateQuoteNumber();
    const expiry_date = this.calculateExpiryDate(created_date, validity_days);

    // Compute line calculations
    let subtotal = 0;
    const computedLines = [];

    for (const line of lines) {
      const product = this.productService.getProductById(line.product_id);
      if (!product) throw new Error(`Product #${line.product_id} not found`);

      let unitPrice = Number(line.unit_price);
      let desc = line.description || product.name;

      if (line.variant_id) {
        const variant = product.variants.find(v => v.id === Number(line.variant_id));
        if (variant) {
          if (line.unit_price === undefined || line.unit_price === null) {
            unitPrice = variant.calculated_sales_price;
          }
          desc = `${product.name} [${variant.variant_name}]`;
        }
      } else if (line.unit_price === undefined || line.unit_price === null) {
        unitPrice = product.sales_price;
      }

      const quantity = Math.max(1, Number(line.quantity) || 1);
      const lineDiscPct = Number(line.discount_percent) || 0;
      const rawSubtotal = unitPrice * quantity;
      const lineDiscAmt = Number(((rawSubtotal * lineDiscPct) / 100).toFixed(2));
      const lineSubtotal = Number((rawSubtotal - lineDiscAmt).toFixed(2));
      const lineTaxPct = Number(line.tax_percent !== undefined ? line.tax_percent : tax_rate);
      const lineTaxAmt = Number(((lineSubtotal * lineTaxPct) / 100).toFixed(2));
      const lineTotal = Number((lineSubtotal + lineTaxAmt).toFixed(2));

      subtotal += lineSubtotal;

      computedLines.push({
        product_id: product.id,
        variant_id: line.variant_id ? Number(line.variant_id) : null,
        description: desc,
        quantity,
        unit_price: unitPrice,
        discount_percent: lineDiscPct,
        discount_amount: lineDiscAmt,
        subtotal: lineSubtotal,
        tax_percent: lineTaxPct,
        total: lineTotal
      });
    }

    // Add base fee of the subscription plan to subtotal if any
    subtotal += plan.base_fee;

    // Evaluate Admin Discount if code is given
    let discountId = null;
    let discountAmount = 0;
    let appliedDiscountCode = null;

    if (discount_code) {
      const evalResult = this.discountService.evaluateDiscount({
        discountIdOrCode: discount_code,
        items: computedLines.map(l => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price
        })),
        currentDate: created_date
      });

      if (!evalResult.valid) {
        throw new Error(`Discount error: ${evalResult.reason}`);
      }

      discountId = evalResult.discount.id;
      discountAmount = evalResult.discount_amount;
      appliedDiscountCode = evalResult.discount.code;
    }

    const discountedSubtotal = Math.max(0, subtotal - discountAmount);
    const taxAmount = Number(((discountedSubtotal * Number(tax_rate)) / 100).toFixed(2));
    const totalAmount = Number((discountedSubtotal + taxAmount).toFixed(2));

    const stmt = this.db.prepare(`
      INSERT INTO sales_quotations (
        quote_number, template_id, customer_name, customer_email,
        plan_id, status, created_date, validity_days, expiry_date,
        start_date, payment_terms, discount_id, discount_code,
        discount_amount, subtotal, tax_rate, tax_amount, total_amount, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      resolvedQuoteNumber,
      template_id ? Number(template_id) : null,
      customer_name.trim(),
      customer_email.trim(),
      Number(plan_id),
      status,
      created_date,
      Number(validity_days),
      expiry_date,
      start_date,
      payment_terms,
      discountId,
      appliedDiscountCode,
      discountAmount,
      Number(subtotal.toFixed(2)),
      Number(tax_rate),
      taxAmount,
      totalAmount,
      notes || ''
    );

    const quoteId = result.lastInsertRowid;

    // Insert lines
    const lineStmt = this.db.prepare(`
      INSERT INTO sales_quotation_lines (
        quotation_id, product_id, variant_id, description,
        quantity, unit_price, discount_percent, discount_amount,
        subtotal, tax_percent, total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const cl of computedLines) {
      lineStmt.run(
        quoteId,
        cl.product_id,
        cl.variant_id,
        cl.description,
        cl.quantity,
        cl.unit_price,
        cl.discount_percent,
        cl.discount_amount,
        cl.subtotal,
        cl.tax_percent,
        cl.total
      );
    }

    return this.getQuotationById(quoteId);
  }

  // Transition status: Draft -> Quotation -> Confirmed -> Active -> Closed
  updateStatus(id, newStatus) {
    const validStatuses = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Allowed: ${validStatuses.join(', ')}`);
    }

    const quote = this.getQuotationById(id);
    if (!quote) throw new Error(`Quotation #${id} not found`);

    // Check Plan behavior rules
    if (newStatus === 'Closed' && quote.status === 'Active') {
      const check = this.planService.validateSubscriptionAction(quote.plan_id, 'early_close');
      if (!check.allowed) {
        throw new Error(`Cannot close subscription early: ${check.reason}`);
      }
    }

    // If moving to Confirmed or Active and discount was applied, increment usage count once
    if (['Confirmed', 'Active'].includes(newStatus) && !['Confirmed', 'Active', 'Closed'].includes(quote.status)) {
      if (quote.discount_id) {
        this.discountService.incrementUsage(quote.discount_id);
      }
    }

    const stmt = this.db.prepare(`
      UPDATE sales_quotations
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(newStatus, id);

    const updated = this.getQuotationById(id);

    if (this.onStatusChange && quote.status !== newStatus) {
      try {
        const hookResult = this.onStatusChange(updated, quote.status);
        if (hookResult && typeof hookResult.catch === 'function') {
          hookResult.catch((err) => {
            console.error(`[quotationService] onStatusChange failed: ${err.message}`);
          });
        }
      } catch (err) {
        console.error(`[quotationService] onStatusChange failed: ${err.message}`);
      }
    }

    return updated;
  }

  deleteQuotation(id) {
    const stmt = this.db.prepare('DELETE FROM sales_quotations WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

module.exports = QuotationService;
