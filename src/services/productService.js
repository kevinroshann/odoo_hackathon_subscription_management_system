class ProductService {
  constructor(db) {
    this.db = db;
  }

  // --- Product Master ---
  getAllProducts({ activeOnly = false, type = null } = {}) {
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (activeOnly) {
      sql += ' AND active = 1';
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY id DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    // Attach variant count and attributes
    return rows.map(prod => this.getProductDetails(prod.id));
  }

  getProductById(id) {
    const stmt = this.db.prepare('SELECT * FROM products WHERE id = ?');
    const product = stmt.get(id);
    if (!product) return null;
    return this.getProductDetails(id);
  }

  getProductDetails(id) {
    const pStmt = this.db.prepare('SELECT * FROM products WHERE id = ?');
    const product = pStmt.get(id);
    if (!product) return null;

    // Fetch attributes and values
    const attrStmt = this.db.prepare(`
      SELECT a.id as attr_id, a.name as attr_name,
             v.id as val_id, v.value as val_name, v.price_extra, v.cost_extra
      FROM product_attributes a
      LEFT JOIN product_attribute_values v ON a.id = v.attribute_id
      WHERE a.product_id = ?
      ORDER BY a.id, v.id
    `);
    const attrRows = attrStmt.all(id);

    const attributesMap = new Map();
    for (const row of attrRows) {
      if (!attributesMap.has(row.attr_id)) {
        attributesMap.set(row.attr_id, {
          id: row.attr_id,
          name: row.attr_name,
          values: []
        });
      }
      if (row.val_id) {
        attributesMap.get(row.attr_id).values.push({
          id: row.val_id,
          value: row.val_name,
          price_extra: Number(row.price_extra),
          cost_extra: Number(row.cost_extra)
        });
      }
    }

    // Fetch concrete variants
    const varStmt = this.db.prepare(`
      SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY id ASC
    `);
    const variants = varStmt.all(id);

    // For each variant, fetch its attribute value tags
    const valMapStmt = this.db.prepare(`
      SELECT pav.id, pav.value, pav.price_extra, pa.name as attribute_name
      FROM product_variant_values pvv
      JOIN product_attribute_values pav ON pvv.attribute_value_id = pav.id
      JOIN product_attributes pa ON pav.attribute_id = pa.id
      WHERE pvv.variant_id = ?
    `);

    const enrichedVariants = variants.map(v => {
      const values = valMapStmt.all(v.id);
      return {
        ...v,
        attribute_values: values
      };
    });

    return {
      ...product,
      sales_price: Number(product.sales_price),
      cost_price: Number(product.cost_price),
      attributes: Array.from(attributesMap.values()),
      variants: enrichedVariants
    };
  }

  createProduct({ code, name, type, sales_price, cost_price = 0, notes = '', active = 1 }) {
    if (!code || !name || !type) {
      throw new Error('Product code, name, and type are required');
    }
    const validTypes = ['Software', 'Service', 'Consumable', 'Add-on'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid product type. Must be one of: ${validTypes.join(', ')}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO products (code, name, type, sales_price, cost_price, notes, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      code.trim(),
      name.trim(),
      type,
      Number(sales_price) || 0,
      Number(cost_price) || 0,
      notes || '',
      active ? 1 : 0
    );

    return this.getProductById(result.lastInsertRowid);
  }

  updateProduct(id, { name, type, sales_price, cost_price, notes, active }) {
    const existing = this.getProductById(id);
    if (!existing) {
      throw new Error(`Product with ID ${id} not found`);
    }

    const updatedName = name !== undefined ? name.trim() : existing.name;
    const updatedType = type !== undefined ? type : existing.type;
    const updatedSalesPrice = sales_price !== undefined ? Number(sales_price) : existing.sales_price;
    const updatedCostPrice = cost_price !== undefined ? Number(cost_price) : existing.cost_price;
    const updatedNotes = notes !== undefined ? notes : existing.notes;
    const updatedActive = active !== undefined ? (active ? 1 : 0) : existing.active;

    const stmt = this.db.prepare(`
      UPDATE products
      SET name = ?, type = ?, sales_price = ?, cost_price = ?, notes = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(updatedName, updatedType, updatedSalesPrice, updatedCostPrice, updatedNotes, updatedActive, id);

    // Recalculate prices of existing variants for this product
    this.recalculateAllVariantPrices(id);

    return this.getProductById(id);
  }

  deleteProduct(id) {
    const stmt = this.db.prepare('DELETE FROM products WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // --- Variant & Attribute Engine ---
  addAttribute(productId, attributeName) {
    const product = this.getProductById(productId);
    if (!product) throw new Error('Product not found');

    const stmt = this.db.prepare(`
      INSERT INTO product_attributes (product_id, name)
      VALUES (?, ?)
    `);
    const result = stmt.run(productId, attributeName.trim());
    return { id: result.lastInsertRowid, product_id: productId, name: attributeName.trim(), values: [] };
  }

  addAttributeValue(attributeId, { value, price_extra = 0.0, cost_extra = 0.0 }) {
    const attrStmt = this.db.prepare('SELECT * FROM product_attributes WHERE id = ?');
    const attr = attrStmt.get(attributeId);
    if (!attr) throw new Error('Attribute not found');

    const stmt = this.db.prepare(`
      INSERT INTO product_attribute_values (attribute_id, value, price_extra, cost_extra)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(attributeId, value.trim(), Number(price_extra) || 0, Number(cost_extra) || 0);

    // Recalculate any existing variants linked to this attribute value
    this.recalculateAllVariantPrices(attr.product_id);

    return {
      id: result.lastInsertRowid,
      attribute_id: attributeId,
      value: value.trim(),
      price_extra: Number(price_extra) || 0,
      cost_extra: Number(cost_extra) || 0
    };
  }

  // Calculate concrete variant price: Base Price + Sum of Extras (e.g. +$560 for Odoo brand)
  calculateVariantPrice(productId, attributeValueIds = []) {
    const product = this.getProductById(productId);
    if (!product) throw new Error('Product not found');

    let totalSalesPrice = product.sales_price;
    let totalCostPrice = product.cost_price;
    let extraBreakdown = [];

    if (attributeValueIds.length > 0) {
      const placeholders = attributeValueIds.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT pav.*, pa.name as attr_name
        FROM product_attribute_values pav
        JOIN product_attributes pa ON pav.attribute_id = pa.id
        WHERE pav.id IN (${placeholders})
      `);
      const values = stmt.all(...attributeValueIds);

      for (const val of values) {
        totalSalesPrice += Number(val.price_extra);
        totalCostPrice += Number(val.cost_extra);
        extraBreakdown.push({
          attribute: val.attr_name,
          value: val.value,
          price_extra: Number(val.price_extra),
          cost_extra: Number(val.cost_extra)
        });
      }
    }

    return {
      base_sales_price: product.sales_price,
      base_cost_price: product.cost_price,
      calculated_sales_price: Number(totalSalesPrice.toFixed(2)),
      calculated_cost_price: Number(totalCostPrice.toFixed(2)),
      breakdown: extraBreakdown
    };
  }

  createVariant(productId, { sku, variant_name, attribute_value_ids = [] }) {
    const product = this.getProductById(productId);
    if (!product) throw new Error('Product not found');

    const pricing = this.calculateVariantPrice(productId, attribute_value_ids);
    const resolvedName = variant_name || `${product.name} (${pricing.breakdown.map(b => b.value).join(' / ') || 'Standard'})`;
    const resolvedSku = sku || `${product.code}-${pricing.breakdown.map(b => b.value.substring(0, 3).toUpperCase()).join('-') || 'BASE'}`;

    const stmt = this.db.prepare(`
      INSERT INTO product_variants (product_id, sku, variant_name, calculated_sales_price, calculated_cost_price)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      productId,
      resolvedSku,
      resolvedName,
      pricing.calculated_sales_price,
      pricing.calculated_cost_price
    );
    const variantId = result.lastInsertRowid;

    // Link attribute values
    const linkStmt = this.db.prepare(`
      INSERT INTO product_variant_values (variant_id, attribute_value_id)
      VALUES (?, ?)
    `);
    for (const valId of attribute_value_ids) {
      linkStmt.run(variantId, valId);
    }

    return {
      id: variantId,
      product_id: productId,
      sku: resolvedSku,
      variant_name: resolvedName,
      calculated_sales_price: pricing.calculated_sales_price,
      calculated_cost_price: pricing.calculated_cost_price,
      breakdown: pricing.breakdown
    };
  }

  recalculateAllVariantPrices(productId) {
    const varStmt = this.db.prepare('SELECT id FROM product_variants WHERE product_id = ?');
    const variants = varStmt.all(productId);

    for (const variant of variants) {
      const valStmt = this.db.prepare('SELECT attribute_value_id FROM product_variant_values WHERE variant_id = ?');
      const valRows = valStmt.all(variant.id);
      const valIds = valRows.map(r => r.attribute_value_id);

      const pricing = this.calculateVariantPrice(productId, valIds);

      this.db.prepare(`
        UPDATE product_variants
        SET calculated_sales_price = ?, calculated_cost_price = ?
        WHERE id = ?
      `).run(pricing.calculated_sales_price, pricing.calculated_cost_price, variant.id);
    }
  }

  generateAllVariantsMatrix(productId) {
    const product = this.getProductById(productId);
    if (!product || product.attributes.length === 0) {
      return [];
    }

    // Cartesian product of attribute values
    const attrValuesArrays = product.attributes
      .filter(a => a.values.length > 0)
      .map(a => a.values);

    if (attrValuesArrays.length === 0) return [];

    const cartesian = (arrays) => {
      return arrays.reduce((acc, curr) => {
        return acc.flatMap(a => curr.map(b => [...a, b]));
      }, [[]]);
    };

    const combinations = cartesian(attrValuesArrays);
    const createdVariants = [];

    for (const combo of combinations) {
      const valIds = combo.map(v => v.id);
      const valNames = combo.map(v => v.value).join(' / ');
      const skuSuffix = combo.map(v => v.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4)).join('-');
      const sku = `${product.code}-${skuSuffix}`;
      const name = `${product.name} (${valNames})`;

      // Check if variant with SKU already exists
      const existing = this.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku);
      if (!existing) {
        const v = this.createVariant(productId, {
          sku,
          variant_name: name,
          attribute_value_ids: valIds
        });
        createdVariants.push(v);
      }
    }

    return createdVariants;
  }
}

module.exports = ProductService;
