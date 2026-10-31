const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { getDatabase } = require('./db/database');
const { seedDatabase } = require('./db/seed');
const ProductService = require('./services/productService');
const PlanService = require('./services/planService');
const DiscountService = require('./services/discountService');
const TemplateService = require('./services/templateService');
const QuotationService = require('./services/quotationService');

const PORT = process.env.PORT || 3000;
const db = getDatabase();

// Check if database needs seeding
const productCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get().cnt;
if (productCount === 0) {
  console.log('Database empty, running initial seed...');
  seedDatabase(db);
}

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

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method;
  const query = Object.fromEntries(reqUrl.searchParams.entries());

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // API Routes
    if (pathname.startsWith('/api/')) {
      // 1. Dashboard Stats
      if (pathname === '/api/stats' && method === 'GET') {
        const prodCnt = db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1').get().count;
        const planCnt = db.prepare('SELECT COUNT(*) as count FROM subscription_plans WHERE active = 1').get().count;
        const discCnt = db.prepare('SELECT COUNT(*) as count FROM discounts WHERE active = 1').get().count;
        const tmplCnt = db.prepare('SELECT COUNT(*) as count FROM quotation_templates WHERE active = 1').get().count;
        const quoteCnt = db.prepare('SELECT COUNT(*) as count FROM sales_quotations').get().count;
        const activeSubCnt = db.prepare("SELECT COUNT(*) as count FROM sales_quotations WHERE status = 'Active'").get().count;

        return sendJson(res, 200, {
          products: prodCnt,
          plans: planCnt,
          discounts: discCnt,
          templates: tmplCnt,
          quotations: quoteCnt,
          active_subscriptions: activeSubCnt
        });
      }

      // 2. Products API
      if (pathname === '/api/products' && method === 'GET') {
        const products = productService.getAllProducts({
          activeOnly: query.activeOnly === 'true',
          type: query.type || null
        });
        return sendJson(res, 200, products);
      }

      const prodMatch = pathname.match(/^\/api\/products\/(\d+)$/);
      if (prodMatch && method === 'GET') {
        const prod = productService.getProductById(Number(prodMatch[1]));
        if (!prod) return sendError(res, 404, 'Product not found');
        return sendJson(res, 200, prod);
      }

      if (pathname === '/api/products' && method === 'POST') {
        const body = await parseJsonBody(req);
        const product = productService.createProduct(body);
        return sendJson(res, 201, product);
      }

      if (prodMatch && method === 'PUT') {
        const body = await parseJsonBody(req);
        const product = productService.updateProduct(Number(prodMatch[1]), body);
        return sendJson(res, 200, product);
      }

      if (prodMatch && method === 'DELETE') {
        const ok = productService.deleteProduct(Number(prodMatch[1]));
        return sendJson(res, 200, { success: ok });
      }

      // Add attribute to product
      const attrMatch = pathname.match(/^\/api\/products\/(\d+)\/attributes$/);
      if (attrMatch && method === 'POST') {
        const body = await parseJsonBody(req);
        const attr = productService.addAttribute(Number(attrMatch[1]), body.name);
        return sendJson(res, 201, attr);
      }

      // Add attribute value (e.g. Odoo brand +560)
      const attrValMatch = pathname.match(/^\/api\/attributes\/(\d+)\/values$/);
      if (attrValMatch && method === 'POST') {
        const body = await parseJsonBody(req);
        const val = productService.addAttributeValue(Number(attrValMatch[1]), body);
        return sendJson(res, 201, val);
      }

      // Create variant
      const varMatch = pathname.match(/^\/api\/products\/(\d+)\/variants$/);
      if (varMatch && method === 'POST') {
        const body = await parseJsonBody(req);
        const variant = productService.createVariant(Number(varMatch[1]), body);
        return sendJson(res, 201, variant);
      }

      // Generate variant combinations matrix
      const genVarMatch = pathname.match(/^\/api\/products\/(\d+)\/generate-variants$/);
      if (genVarMatch && method === 'POST') {
        const variants = productService.generateAllVariantsMatrix(Number(genVarMatch[1]));
        return sendJson(res, 200, variants);
      }

      // Live calculate variant price
      const calcVarMatch = pathname.match(/^\/api\/products\/(\d+)\/calculate-variant$/);
      if (calcVarMatch && method === 'POST') {
        const body = await parseJsonBody(req);
        const pricing = productService.calculateVariantPrice(Number(calcVarMatch[1]), body.attribute_value_ids || []);
        return sendJson(res, 200, pricing);
      }

      // 3. Plans API
      if (pathname === '/api/plans' && method === 'GET') {
        const plans = planService.getAllPlans({
          activeOnly: query.activeOnly === 'true'
        });
        return sendJson(res, 200, plans);
      }

      const planMatch = pathname.match(/^\/api\/plans\/(\d+)$/);
      if (planMatch && method === 'GET') {
        const plan = planService.getPlanById(Number(planMatch[1]));
        if (!plan) return sendError(res, 404, 'Plan not found');
        return sendJson(res, 200, plan);
      }

      if (pathname === '/api/plans' && method === 'POST') {
        const body = await parseJsonBody(req);
        const plan = planService.createPlan(body);
        return sendJson(res, 201, plan);
      }

      if (planMatch && method === 'PUT') {
        const body = await parseJsonBody(req);
        const plan = planService.updatePlan(Number(planMatch[1]), body);
        return sendJson(res, 200, plan);
      }

      if (planMatch && method === 'DELETE') {
        const ok = planService.deletePlan(Number(planMatch[1]));
        return sendJson(res, 200, { success: ok });
      }

      // Check plan availability
      const planAvailMatch = pathname.match(/^\/api\/plans\/(\d+)\/check-availability$/);
      if (planAvailMatch && method === 'GET') {
        const check = planService.checkPlanAvailability(Number(planAvailMatch[1]), query.date);
        return sendJson(res, 200, check);
      }

      // Validate plan behavior action
      const planActionMatch = pathname.match(/^\/api\/plans\/(\d+)\/validate-action$/);
      if (planActionMatch && method === 'POST') {
        const body = await parseJsonBody(req);
        const result = planService.validateSubscriptionAction(Number(planActionMatch[1]), body.action);
        return sendJson(res, 200, result);
      }

      // 4. Discounts API
      if (pathname === '/api/discounts' && method === 'GET') {
        const discounts = discountService.getAllDiscounts({
          activeOnly: query.activeOnly === 'true'
        });
        return sendJson(res, 200, discounts);
      }

      const discMatch = pathname.match(/^\/api\/discounts\/(\d+)$/);
      if (discMatch && method === 'GET') {
        const discount = discountService.getDiscountById(Number(discMatch[1]));
        if (!discount) return sendError(res, 404, 'Discount not found');
        return sendJson(res, 200, discount);
      }

      if (pathname === '/api/discounts' && method === 'POST') {
        const body = await parseJsonBody(req);
        const discount = discountService.createDiscount(body);
        return sendJson(res, 201, discount);
      }

      if (discMatch && method === 'PUT') {
        const body = await parseJsonBody(req);
        const discount = discountService.updateDiscount(Number(discMatch[1]), body);
        return sendJson(res, 200, discount);
      }

      if (discMatch && method === 'DELETE') {
        const ok = discountService.deleteDiscount(Number(discMatch[1]));
        return sendJson(res, 200, { success: ok });
      }

      // Discount evaluation simulator / test bench
      if (pathname === '/api/discounts/evaluate' && method === 'POST') {
        const body = await parseJsonBody(req);
        const evaluation = discountService.evaluateDiscount(body);
        return sendJson(res, 200, evaluation);
      }

      // 5. Quotation Templates API
      if (pathname === '/api/templates' && method === 'GET') {
        const templates = templateService.getAllTemplates({
          activeOnly: query.activeOnly === 'true'
        });
        return sendJson(res, 200, templates);
      }

      const tmplMatch = pathname.match(/^\/api\/templates\/(\d+)$/);
      if (tmplMatch && method === 'GET') {
        const tmpl = templateService.getTemplateById(Number(tmplMatch[1]));
        if (!tmpl) return sendError(res, 404, 'Template not found');
        return sendJson(res, 200, tmpl);
      }

      if (pathname === '/api/templates' && method === 'POST') {
        const body = await parseJsonBody(req);
        const tmpl = templateService.createTemplate(body);
        return sendJson(res, 201, tmpl);
      }

      if (tmplMatch && method === 'PUT') {
        const body = await parseJsonBody(req);
        const tmpl = templateService.updateTemplate(Number(tmplMatch[1]), body);
        return sendJson(res, 200, tmpl);
      }

      if (tmplMatch && method === 'DELETE') {
        const ok = templateService.deleteTemplate(Number(tmplMatch[1]));
        return sendJson(res, 200, { success: ok });
      }

      // 6. Sales Quotations API
      if (pathname === '/api/quotations' && method === 'GET') {
        const quotations = quotationService.getAllQuotations({
          status: query.status || null
        });
        return sendJson(res, 200, quotations);
      }

      const quoteMatch = pathname.match(/^\/api\/quotations\/(\d+)$/);
      if (quoteMatch && method === 'GET') {
        const quote = quotationService.getQuotationById(Number(quoteMatch[1]));
        if (!quote) return sendError(res, 404, 'Quotation not found');
        return sendJson(res, 200, quote);
      }

      if (pathname === '/api/quotations' && method === 'POST') {
        const body = await parseJsonBody(req);
        const quote = quotationService.createQuotation(body);
        return sendJson(res, 201, quote);
      }

      if (pathname === '/api/quotations/from-template' && method === 'POST') {
        const body = await parseJsonBody(req);
        const quote = quotationService.createFromTemplate(body);
        return sendJson(res, 201, quote);
      }

      const quoteStatusMatch = pathname.match(/^\/api\/quotations\/(\d+)\/status$/);
      if (quoteStatusMatch && method === 'PATCH') {
        const body = await parseJsonBody(req);
        const quote = quotationService.updateStatus(Number(quoteStatusMatch[1]), body.status);
        return sendJson(res, 200, quote);
      }

      if (quoteMatch && method === 'DELETE') {
        const ok = quotationService.deleteQuotation(Number(quoteMatch[1]));
        return sendJson(res, 200, { success: ok });
      }

      // Reset / Re-seed database
      if (pathname === '/api/seed' && method === 'POST') {
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          DELETE FROM sales_quotation_lines;
          DELETE FROM sales_quotations;
          DELETE FROM quotation_template_lines;
          DELETE FROM quotation_templates;
          DELETE FROM discount_products;
          DELETE FROM discounts;
          DELETE FROM subscription_plans;
          DELETE FROM product_variant_values;
          DELETE FROM product_variants;
          DELETE FROM product_attribute_values;
          DELETE FROM product_attributes;
          DELETE FROM products;
        `);
        db.exec('PRAGMA foreign_keys = ON;');
        seedDatabase(db);
        return sendJson(res, 200, { success: true, message: 'Database reseeded successfully' });
      }

      return sendError(res, 404, `API route not found: ${pathname}`);
    }

    // Static Files
    const publicDir = path.join(__dirname, 'public');
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

    if (!fs.existsSync(filePath)) {
      filePath = path.join(publicDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    serveStatic(res, filePath, mimeTypes[ext] || 'text/plain');
  } catch (err) {
    console.error('Server error:', err);
    sendError(res, 400, err.message || 'Internal server error');
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Brightloop Subscription Management System`);
    console.log(`📍 Server listening on: http://localhost:${PORT}`);
    console.log(`📦 Member 2: Products, Plans & Sales Quotations`);
    console.log(`====================================================`);
  });
}

module.exports = { server, db };
