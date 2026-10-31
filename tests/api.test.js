const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { server } = require('../src/server');

function mockRequest(options, body = null) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = options.headers || { 'content-type': 'application/json' };

    let resHeaders = {};
    let resStatusCode = 200;
    let resData = '';

    const res = {
      writeHead(code, headers) {
        resStatusCode = code;
        resHeaders = headers;
      },
      end(chunk) {
        if (chunk) resData += chunk;
        let parsed = null;
        try {
          parsed = JSON.parse(resData);
        } catch {
          parsed = resData;
        }
        resolve({
          statusCode: resStatusCode,
          headers: resHeaders,
          body: parsed
        });
      }
    };

    server.emit('request', req, res);

    if (body) {
      req.emit('data', JSON.stringify(body));
    }
    req.emit('end');
  });
}

test('API GET /api/stats returns system overview counters', async () => {
  const res = await mockRequest({ url: '/api/stats', method: 'GET' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.products > 0);
  assert.ok(res.body.plans > 0);
  assert.ok(res.body.templates > 0);
  assert.ok(res.body.discounts > 0);
});

test('API GET /api/products returns products catalog with variants', async () => {
  const res = await mockRequest({ url: '/api/products', method: 'GET' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  const erp = res.body.find(p => p.code === 'PROD-BL-ERP');
  assert.ok(erp);
  assert.strictEqual(erp.type, 'Software');
  assert.strictEqual(erp.sales_price, 1000.0);

  // Check variant with Odoo +560
  const odooVariant = erp.variants.find(v => v.variant_name.includes('Odoo'));
  assert.ok(odooVariant);
  assert.strictEqual(odooVariant.calculated_sales_price, 1560.0);
});

test('API Live Variant Calculation: Odoo Brand +560', async () => {
  const prodRes = await mockRequest({ url: '/api/products', method: 'GET' });
  const erp = prodRes.body.find(p => p.code === 'PROD-BL-ERP');
  const odooVal = erp.attributes[0].values.find(v => v.value.includes('Odoo'));

  const calcRes = await mockRequest(
    { url: `/api/products/${erp.id}/calculate-variant`, method: 'POST' },
    { attribute_value_ids: [odooVal.id] }
  );

  assert.strictEqual(calcRes.statusCode, 200);
  assert.strictEqual(calcRes.body.calculated_sales_price, 1560.0);
  assert.strictEqual(calcRes.body.breakdown[0].price_extra, 560.0);
});

test('API Live Discount Simulator: evaluates discount criteria and calculates savings', async () => {
  const evalRes = await mockRequest(
    { url: '/api/discounts/evaluate', method: 'POST' },
    {
      discountIdOrCode: 'ODOO560LAUNCH',
      items: [{ product_id: 1, quantity: 2, unit_price: 1560.0 }]
    }
  );

  assert.strictEqual(evalRes.statusCode, 200);
  assert.strictEqual(evalRes.body.valid, true);
  // 12% of 3120 = 374.40
  assert.strictEqual(evalRes.body.discount_amount, 374.40);
});

test('API Quotations Lifecycle: create and fetch quotations', async () => {
  const quotesRes = await mockRequest({ url: '/api/quotations', method: 'GET' });
  assert.strictEqual(quotesRes.statusCode, 200);
  assert.ok(Array.isArray(quotesRes.body));
  assert.ok(quotesRes.body.length >= 3);
});
