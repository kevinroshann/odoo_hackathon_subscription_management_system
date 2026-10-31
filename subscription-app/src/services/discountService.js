class DiscountService {
  constructor(db) {
    this.db = db;
  }

  getAllDiscounts({ activeOnly = false } = {}) {
    let sql = 'SELECT * FROM discounts WHERE 1=1';
    if (activeOnly) {
      sql += ' AND active = 1';
    }
    sql += ' ORDER BY id DESC';

    const stmt = this.db.prepare(sql);
    const discounts = stmt.all();

    return discounts.map(d => this.getDiscountDetails(d.id));
  }

  getDiscountById(id) {
    const stmt = this.db.prepare('SELECT * FROM discounts WHERE id = ?');
    const discount = stmt.get(id);
    if (!discount) return null;
    return this.getDiscountDetails(id);
  }

  getDiscountByCode(code) {
    if (!code) return null;
    const stmt = this.db.prepare('SELECT * FROM discounts WHERE UPPER(code) = UPPER(?)');
    const discount = stmt.get(code.trim());
    if (!discount) return null;
    return this.getDiscountDetails(discount.id);
  }

  getDiscountDetails(id) {
    const stmt = this.db.prepare('SELECT * FROM discounts WHERE id = ?');
    const discount = stmt.get(id);
    if (!discount) return null;

    // Fetch linked specific products if scope is specific_products
    const prodStmt = this.db.prepare(`
      SELECT p.id, p.code, p.name, p.sales_price
      FROM discount_products dp
      JOIN products p ON dp.product_id = p.id
      WHERE dp.discount_id = ?
    `);
    const linkedProducts = prodStmt.all(id);

    return {
      ...discount,
      value: Number(discount.value),
      min_purchase_amount: Number(discount.min_purchase_amount || 0),
      min_quantity: Number(discount.min_quantity || 1),
      usage_limit: discount.usage_limit !== null ? Number(discount.usage_limit) : null,
      used_count: Number(discount.used_count),
      active: Boolean(discount.active),
      applicable_products: linkedProducts
    };
  }

  createDiscount({
    code,
    name,
    type,
    value,
    scope = 'whole_subscription',
    min_purchase_amount = 0.0,
    min_quantity = 1,
    usage_limit = null,
    start_date = null,
    end_date = null,
    active = 1,
    notes = '',
    product_ids = []
  }) {
    if (!code || !name || !type || value === undefined) {
      throw new Error('Code, name, type, and value are required for a discount');
    }

    const validTypes = ['fixed', 'percentage'];
    if (!validTypes.includes(type.toLowerCase())) {
      throw new Error(`Invalid discount type. Must be: ${validTypes.join(', ')}`);
    }

    const validScopes = ['whole_subscription', 'specific_products'];
    if (!validScopes.includes(scope)) {
      throw new Error(`Invalid discount scope. Must be: ${validScopes.join(', ')}`);
    }

    if (type === 'percentage' && (value <= 0 || value > 100)) {
      throw new Error('Percentage discount value must be between 0 and 100');
    }

    if (type === 'fixed' && value <= 0) {
      throw new Error('Fixed discount value must be greater than 0');
    }

    if (start_date && end_date && start_date > end_date) {
      throw new Error('Discount start_date cannot be later than end_date');
    }

    const stmt = this.db.prepare(`
      INSERT INTO discounts (
        code, name, type, value, scope,
        min_purchase_amount, min_quantity, usage_limit,
        start_date, end_date, active, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      code.trim().toUpperCase(),
      name.trim(),
      type.toLowerCase(),
      Number(value),
      scope,
      Number(min_purchase_amount) || 0.0,
      Number(min_quantity) || 1,
      usage_limit !== null && usage_limit !== '' ? Number(usage_limit) : null,
      start_date || null,
      end_date || null,
      active ? 1 : 0,
      notes || ''
    );

    const discountId = result.lastInsertRowid;

    // If specific products, link them
    if (scope === 'specific_products' && Array.isArray(product_ids)) {
      const linkStmt = this.db.prepare(`
        INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)
      `);
      for (const prodId of product_ids) {
        linkStmt.run(discountId, prodId);
      }
    }

    return this.getDiscountById(discountId);
  }

  updateDiscount(id, fields) {
    const existing = this.getDiscountById(id);
    if (!existing) throw new Error(`Discount with ID ${id} not found`);

    const code = fields.code !== undefined ? fields.code.trim().toUpperCase() : existing.code;
    const name = fields.name !== undefined ? fields.name.trim() : existing.name;
    const type = fields.type !== undefined ? fields.type.toLowerCase() : existing.type;
    const value = fields.value !== undefined ? Number(fields.value) : existing.value;
    const scope = fields.scope !== undefined ? fields.scope : existing.scope;
    const min_purchase_amount = fields.min_purchase_amount !== undefined ? Number(fields.min_purchase_amount) : existing.min_purchase_amount;
    const min_quantity = fields.min_quantity !== undefined ? Number(fields.min_quantity) : existing.min_quantity;
    const usage_limit = fields.usage_limit !== undefined ? (fields.usage_limit !== null && fields.usage_limit !== '' ? Number(fields.usage_limit) : null) : existing.usage_limit;
    const start_date = fields.start_date !== undefined ? fields.start_date : existing.start_date;
    const end_date = fields.end_date !== undefined ? fields.end_date : existing.end_date;
    const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (existing.active ? 1 : 0);
    const notes = fields.notes !== undefined ? fields.notes : existing.notes;

    if (type === 'percentage' && (value <= 0 || value > 100)) {
      throw new Error('Percentage discount value must be between 0 and 100');
    }
    if (type === 'fixed' && value <= 0) {
      throw new Error('Fixed discount value must be greater than 0');
    }

    const stmt = this.db.prepare(`
      UPDATE discounts
      SET code = ?, name = ?, type = ?, value = ?, scope = ?,
          min_purchase_amount = ?, min_quantity = ?, usage_limit = ?,
          start_date = ?, end_date = ?, active = ?, notes = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      code, name, type, value, scope,
      min_purchase_amount, min_quantity, usage_limit,
      start_date, end_date, active, notes,
      id
    );

    if (fields.product_ids !== undefined) {
      this.db.prepare('DELETE FROM discount_products WHERE discount_id = ?').run(id);
      if (scope === 'specific_products' && Array.isArray(fields.product_ids)) {
        const linkStmt = this.db.prepare('INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)');
        for (const pid of fields.product_ids) {
          linkStmt.run(id, pid);
        }
      }
    }

    return this.getDiscountById(id);
  }

  deleteDiscount(id) {
    const stmt = this.db.prepare('DELETE FROM discounts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  incrementUsage(id) {
    const stmt = this.db.prepare(`
      UPDATE discounts SET used_count = used_count + 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  // --- Core Discount Evaluation Engine ---
  evaluateDiscount({ discountIdOrCode, items = [], currentDate = new Date().toISOString().slice(0, 10) }) {
    let discount = null;
    if (typeof discountIdOrCode === 'number' || !isNaN(Number(discountIdOrCode))) {
      discount = this.getDiscountById(Number(discountIdOrCode));
    } else if (typeof discountIdOrCode === 'string') {
      discount = this.getDiscountByCode(discountIdOrCode);
    }

    if (!discount) {
      return {
        valid: false,
        reason: 'Discount code not found',
        discount_amount: 0.0,
        discount: null
      };
    }

    if (!discount.active) {
      return {
        valid: false,
        reason: `Discount '${discount.code}' is inactive`,
        discount_amount: 0.0,
        discount
      };
    }

    // Date range verification
    if (discount.start_date && currentDate < discount.start_date) {
      return {
        valid: false,
        reason: `Discount '${discount.code}' is not active until ${discount.start_date}`,
        discount_amount: 0.0,
        discount
      };
    }
    if (discount.end_date && currentDate > discount.end_date) {
      return {
        valid: false,
        reason: `Discount '${discount.code}' expired on ${discount.end_date}`,
        discount_amount: 0.0,
        discount
      };
    }

    // Usage cap verification
    if (discount.usage_limit !== null && discount.used_count >= discount.usage_limit) {
      return {
        valid: false,
        reason: `Discount '${discount.code}' has reached its maximum usage limit of ${discount.usage_limit}`,
        discount_amount: 0.0,
        discount
      };
    }

    // Calculate total order amount and total quantity from items
    // Item format: { product_id, quantity, unit_price }
    const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const totalOrderAmount = items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)), 0);

    // Minimum quantity check
    if (discount.min_quantity && totalQty < discount.min_quantity) {
      return {
        valid: false,
        reason: `Order quantity (${totalQty}) is below the required minimum of ${discount.min_quantity} items/seats`,
        discount_amount: 0.0,
        discount
      };
    }

    // Minimum purchase amount check
    if (discount.min_purchase_amount && totalOrderAmount < discount.min_purchase_amount) {
      return {
        valid: false,
        reason: `Order subtotal ($${totalOrderAmount.toFixed(2)}) is below the required minimum of $${discount.min_purchase_amount.toFixed(2)}`,
        discount_amount: 0.0,
        discount
      };
    }

    // Calculate discount amount based on scope
    let eligibleSubtotal = 0;
    const applicableProductIds = new Set(
      discount.applicable_products ? discount.applicable_products.map(p => p.id) : []
    );

    const lineBreakdown = [];

    if (discount.scope === 'specific_products') {
      for (const item of items) {
        const isEligible = applicableProductIds.has(item.product_id);
        const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);

        if (isEligible) {
          eligibleSubtotal += lineTotal;
          lineBreakdown.push({
            product_id: item.product_id,
            lineTotal,
            eligible: true
          });
        } else {
          lineBreakdown.push({
            product_id: item.product_id,
            lineTotal,
            eligible: false
          });
        }
      }

      if (eligibleSubtotal === 0) {
        return {
          valid: false,
          reason: `Discount applies only to specific products, none of which are in this quotation`,
          discount_amount: 0.0,
          discount
        };
      }
    } else {
      eligibleSubtotal = totalOrderAmount;
      for (const item of items) {
        lineBreakdown.push({
          product_id: item.product_id,
          lineTotal: (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
          eligible: true
        });
      }
    }

    let calculatedDiscount = 0;
    if (discount.type === 'percentage') {
      calculatedDiscount = (eligibleSubtotal * discount.value) / 100.0;
    } else if (discount.type === 'fixed') {
      calculatedDiscount = Math.min(discount.value, eligibleSubtotal);
    }

    calculatedDiscount = Number(calculatedDiscount.toFixed(2));

    return {
      valid: true,
      reason: 'Discount criteria satisfied',
      discount_amount: calculatedDiscount,
      eligible_amount: eligibleSubtotal,
      total_order_amount: totalOrderAmount,
      total_quantity: totalQty,
      line_breakdown: lineBreakdown,
      discount
    };
  }
}

module.exports = DiscountService;
