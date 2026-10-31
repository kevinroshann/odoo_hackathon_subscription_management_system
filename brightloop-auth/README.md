# Member 1: Auth, RBAC & Customer Portal

## Run
    cp .env.example .env     # set JWT_SECRET
    npm install
    npm start                # http://localhost:3000

Logins created on first start: `admin@brightloop.com / Admin@12345`, `demo@customer.com / Demo@12345`.
With no SMTP configured, password-reset links print in the server console.

## API
| Method | Path | Access |
|---|---|---|
| POST | /api/auth/signup | public (creates `customer`) |
| POST | /api/auth/login, /logout | public |
| GET | /api/auth/me | any logged-in user |
| POST | /api/auth/forgot-password, /reset-password | public |
| POST/GET/DELETE | /api/admin/staff | admin only |
| GET | /api/portal/summary, /subscriptions, /invoices | customer (own data only) |
| POST | /api/portal/subscriptions/:id/close | customer (own data only) |

## For teammates
    const { authenticate, requireRole } = require('./middleware/auth');
    app.use('/api/products', authenticate, requireRole('admin'), productsRouter);
    app.use('/api/invoices', authenticate, requireRole('admin','staff'), invoicesRouter);
Auth is an httpOnly cookie (or `Authorization: Bearer <jwt>`). `req.user = {id,name,email,role}`.
`subscriptions` and `invoices` tables in `src/db.js` are minimal stand-ins: merge them with the
real schema, keeping `customer_id -> users.id`, and the portal keeps working.
