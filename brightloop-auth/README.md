# Authentication, RBAC & Customer Portal

## Run

Run these commands from this directory. The portal uses port 3001 by default
so it can run alongside the main application on port 3000.

```bash
npm ci
cp .env.example .env
openssl rand -hex 32
```

Put the generated random value in `JWT_SECRET` in `.env`, then run:

```bash
npm start
```

Open <http://localhost:3001>. The app creates its local SQLite database on
first start. The `.env` file and database are ignored by Git; do not commit
secrets.

Logins created on first start: `admin@brightloop.com / Admin@12345`,
`demo@customer.com / Demo@12345`. Change the default admin password for any
shared or deployed environment. With no SMTP configured, password-reset links
print in the server console.

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

## Integration status

This app currently runs independently from the main subscription application.
Its `subscriptions` and `invoices` tables are minimal stand-ins. Integrate the
authentication routes and user foreign keys with the main schema before using
the portal with real subscription data.

## For teammates

```js
const { authenticate, requireRole } = require('./middleware/auth');
app.use('/api/products', authenticate, requireRole('admin'), productsRouter);
app.use('/api/invoices', authenticate, requireRole('admin', 'staff'), invoicesRouter);
```

Authentication uses an httpOnly cookie or an `Authorization: Bearer <token>`
header. Middleware attaches `req.user = {id, name, email, role}`.
