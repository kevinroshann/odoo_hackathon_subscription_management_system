class TemplateService {
  constructor(db) {
    this.db = db;
  }

  getAllTemplates({ activeOnly = false } = {}) {
    let sql = 'SELECT * FROM quotation_templates WHERE 1=1';
    if (activeOnly) {
      sql += ' AND active = 1';
    }
    sql += ' ORDER BY id DESC';

    const stmt = this.db.prepare(sql);
    const templates = stmt.all();

    return templates.map(t => this.getTemplateDetails(t.id));
  }

  getTemplateById(id) {
    const stmt = this.db.prepare('SELECT * FROM quotation_templates WHERE id = ?');
    const template = stmt.get(id);
    if (!template) return null;
    return this.getTemplateDetails(id);
  }

  getTemplateDetails(id) {
    const stmt = this.db.prepare('SELECT * FROM quotation_templates WHERE id = ?');
    const template = stmt.get(id);
    if (!template) return null;

    // Fetch associated plan if any
    let plan = null;
    if (template.plan_id) {
      const planStmt = this.db.prepare('SELECT * FROM subscription_plans WHERE id = ?');
      plan = planStmt.get(template.plan_id);
    }

    // Fetch template lines with product and variant details
    const linesStmt = this.db.prepare(`
      SELECT qtl.*,
             p.code as product_code, p.name as product_name, p.sales_price as base_sales_price,
             pv.sku as variant_sku, pv.variant_name, pv.calculated_sales_price as variant_sales_price
      FROM quotation_template_lines qtl
      JOIN products p ON qtl.product_id = p.id
      LEFT JOIN product_variants pv ON qtl.variant_id = pv.id
      WHERE qtl.template_id = ?
      ORDER BY qtl.id ASC
    `);
    const lines = linesStmt.all(id);

    return {
      ...template,
      validity_days: Number(template.validity_days),
      active: Boolean(template.active),
      plan,
      lines: lines.map(l => ({
        id: l.id,
        template_id: l.template_id,
        product_id: l.product_id,
        product_code: l.product_code,
        product_name: l.product_name,
        variant_id: l.variant_id,
        variant_sku: l.variant_sku,
        variant_name: l.variant_name,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount_percent: Number(l.discount_percent)
      }))
    };
  }

  createTemplate({
    name,
    description = '',
    plan_id = null,
    validity_days = 30,
    payment_terms = 'Net 30',
    terms_and_conditions = '',
    active = 1,
    lines = []
  }) {
    if (!name) throw new Error('Template name is required');
    if (!validity_days || Number(validity_days) <= 0) {
      throw new Error('validity_days must be a positive number of days');
    }

    const stmt = this.db.prepare(`
      INSERT INTO quotation_templates (
        name, description, plan_id, validity_days, payment_terms, terms_and_conditions, active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name.trim(),
      description || '',
      plan_id ? Number(plan_id) : null,
      Number(validity_days),
      payment_terms || 'Net 30',
      terms_and_conditions || '',
      active ? 1 : 0
    );

    const templateId = result.lastInsertRowid;

    if (Array.isArray(lines) && lines.length > 0) {
      const lineStmt = this.db.prepare(`
        INSERT INTO quotation_template_lines (
          template_id, product_id, variant_id, quantity, unit_price, discount_percent
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        lineStmt.run(
          templateId,
          Number(line.product_id),
          line.variant_id ? Number(line.variant_id) : null,
          Number(line.quantity) || 1,
          Number(line.unit_price) || 0.0,
          Number(line.discount_percent) || 0.0
        );
      }
    }

    return this.getTemplateById(templateId);
  }

  updateTemplate(id, fields) {
    const existing = this.getTemplateById(id);
    if (!existing) throw new Error(`Template with ID ${id} not found`);

    const name = fields.name !== undefined ? fields.name.trim() : existing.name;
    const description = fields.description !== undefined ? fields.description : existing.description;
    const plan_id = fields.plan_id !== undefined ? (fields.plan_id ? Number(fields.plan_id) : null) : existing.plan_id;
    const validity_days = fields.validity_days !== undefined ? Number(fields.validity_days) : existing.validity_days;
    const payment_terms = fields.payment_terms !== undefined ? fields.payment_terms : existing.payment_terms;
    const terms_and_conditions = fields.terms_and_conditions !== undefined ? fields.terms_and_conditions : existing.terms_and_conditions;
    const active = fields.active !== undefined ? (fields.active ? 1 : 0) : (existing.active ? 1 : 0);

    const stmt = this.db.prepare(`
      UPDATE quotation_templates
      SET name = ?, description = ?, plan_id = ?, validity_days = ?,
          payment_terms = ?, terms_and_conditions = ?, active = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(name, description, plan_id, validity_days, payment_terms, terms_and_conditions, active, id);

    if (fields.lines !== undefined && Array.isArray(fields.lines)) {
      this.db.prepare('DELETE FROM quotation_template_lines WHERE template_id = ?').run(id);

      const lineStmt = this.db.prepare(`
        INSERT INTO quotation_template_lines (
          template_id, product_id, variant_id, quantity, unit_price, discount_percent
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const line of fields.lines) {
        lineStmt.run(
          id,
          Number(line.product_id),
          line.variant_id ? Number(line.variant_id) : null,
          Number(line.quantity) || 1,
          Number(line.unit_price) || 0.0,
          Number(line.discount_percent) || 0.0
        );
      }
    }

    return this.getTemplateById(id);
  }

  deleteTemplate(id) {
    const stmt = this.db.prepare('DELETE FROM quotation_templates WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

module.exports = TemplateService;
