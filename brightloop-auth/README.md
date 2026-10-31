# Auth, Portal & Billing

This app is the integrated Brightloop server. It provides:

- Member 1: authentication, RBAC, staff administration, and the customer portal.
- Member 2 integration: products, plans, quotations, and discounts are read from
  the shared database and imported into billing.
- Member 3: recurring billing automation, tax rules, invoices, and payments.

## Run

Run these commands from this directory:

```bash
npm ci
cp .env.example .env
openssl rand -hex 32
```

Put the generated random value in `JWT_SECRET` in `.env`, then run:

```bash
npm start
```

Open <http://localhost:3001>. With no `PORT` override the app listens on 3001 so
it can run alongside the subscription dashboard on 3000.

## Shared database

Both apps default to `<repo>/data/brightloop.sqlite`. Override the path in either
app with `DB_FILE` or `DB_PATH` (`DB_FILE` takes precedence). Set the same value
for both processes if you move the file.

On first start this app creates the complete schema: Member 2 product/quotation
tables, Member 1 users/subscriptions/invoices, and Member 3 tax rules, invoice
line items, and payments. Member 1's existing `invoices.customer_id` and
`invoices.total` columns remain in place for portal compatibility.

The app uses Node's built-in `node:sqlite`; there is no `better-sqlite3` native
build step.

Logins created on first start: `admin@brightloop.com / Admin@12345`,
`demo@customer.com / Demo@12345` (`SEED_DEMO=true`). Change the default admin
password for any shared or deployed environment. With no SMTP configured,
password-reset links print in the server console.

## Billing automation

The billing service runs a daily sweep using `node-cron`:

| Setting | Default | Purpose |
|---|---|---|
| `BILLING_CRON` | `0 2 * * *` | Sweep schedule |
| `BILLING_TIMEZONE` | `UTC` | Schedule timezone |
| `DISABLE_BILLING_CRON` | `false` | Run HTTP only, without the scheduler |

For each due `Active` subscription the sweep:

1. Syncs `Active` Member 2 quotations into linked subscriptions.
2. Loads the quotation/plan quantity and unit prices, plus the linked discount.
3. Applies Member 2's `discountService` and records a discount line item.
4. Applies every active Member 3 tax rule to the discounted subtotal.
5. Creates a `Draft` invoice with line items and advances
   `next_billing_date` by the subscription's billing interval/frequency.
6. Skips a subscription if an invoice already exists for that billing period,
   so re-running the sweep is safe.

Billing fields (`next_billing_date`, `billing_interval`,
`billing_frequency`) are populated automatically by database triggers whenever
a subscription becomes `Active`.

## API

| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/signup` | Public (creates `customer`) |
| POST | `/api/auth/login`, `/logout` | Public |
| GET | `/api/auth/me` | Any logged-in user |
| POST | `/api/auth/forgot-password`, `/reset-password` | Public |
| POST/GET/DELETE | `/api/admin/staff` | Admin only |
| GET | `/api/portal/summary`, `/subscriptions`, `/invoices` | Customer (own data only) |
| POST | `/api/portal/subscriptions/:id/close` | Customer (own data only) |
| GET | `/api/invoices` | Admin, staff |
| GET | `/api/invoices/:id` | Admin, staff |
| PATCH | `/api/invoices/:id/status` | Admin, staff |
| GET/POST | `/api/invoices/:id/payments` | Admin, staff |
| GET/POST/PATCH/DELETE | `/api/tax-rules` | Admin, staff |
| POST | `/api/admin/billing/run` | Admin, staff |
| POST | `/api/admin/billing/sync` | Admin, staff |

`GET /api/invoices` accepts `status`, `customer_id`, `subscription_id`, `from`,
`to`, `q`, `overdue`, `limit`, and `offset`. Invoice status follows
`Draft -> Confirmed -> Paid`. A payment must be positive, must not exceed the
outstanding balance, and automatically marks the invoice `Paid` when fully
covered. To mark an invoice `Paid` manually before full payment, pass
`force=true` to the status endpoint.

## Tests

```bash
npm test
```

The suite covers tax/discount calculation, quotation sync, idempotent sweeps,
date advancement, payments, migrations, RBAC, and portal integration.

## For teammates

```js
const { authenticate, requireRole } = require('./middleware/auth');
app.use('/api/products', authenticate, requireRole('admin'), productsRouter);
app.use('/api/invoices', authenticate, requireRole('admin', 'staff'), invoicesRouter);
```

Authentication uses an httpOnly cookie or an `Authorization: Bearer <token>`
header. Middleware attaches `req.user = {id, name, email, role}`.
