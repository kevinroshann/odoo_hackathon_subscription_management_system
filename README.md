# Brightloop Subscription Management System

The project is organized into two app folders:

```text
odoo_hackathon/
├── subscription-app/   # Products, plans, quotations, discounts
├── brightloop-auth/    # Unified server: auth/RBAC/portal + billing/taxes/payments
├── data/               # Shared SQLite database (created on first run)
├── run.sh              # Starts both apps together
├── README.md           # Setup and run instructions
└── .gitignore
```

Both apps now share one SQLite database, `<repo>/data/brightloop.sqlite`, so
Member 2 quotations flow into Member 3 billing and Member 1 customer accounts.
The auth app (`brightloop-auth`) is the integrated application server: it
creates the full schema, exposes the portal and billing APIs, and runs the
recurring billing cron. The subscription app remains available as the Member 2
product/quotation dashboard on port 3000.

## Requirements

- Debian/Linux, Bash, and `curl` for `run.sh` (Windows users can start each app
  directly with `npm start`).
- Node.js 22.5.0 or newer and npm.
- `nvm` is recommended for managing Node.js versions.

Both apps use Node's built-in `node:sqlite` module. There is no native
`better-sqlite3` build step.

## First-time setup

Open a terminal at the repository root:

```bash
cd ~/Desktop/odoo_hackathon
nvm install 22
nvm use 22
```

If another program (for example OSS CAD Suite) still puts Node 20 first, put
the nvm-managed Node 22 at the front of `PATH`:

```bash
export PATH="$HOME/.nvm/versions/node/$(nvm version)/bin:$PATH"
hash -r
node --version
command -v node
```

Confirm that the version is at least `v22.5.0` and the executable path is
under `~/.nvm/versions/node/`.

Install the portal dependencies and create its local settings:

```bash
cd brightloop-auth
npm ci
if [ ! -f .env ]; then cp .env.example .env; fi
```

Edit `brightloop-auth/.env` and replace the `JWT_SECRET` placeholder with a
new random secret. Generate one with:

```bash
openssl rand -hex 32
```

Open the settings file:

```bash
nano .env
```

Set `JWT_SECRET` to the generated value and save (`Ctrl+O`, Enter, `Ctrl+X` in
nano). The admin and demo passwords below are the defaults already present in
`.env.example`; change `ADMIN_EMAIL` / `ADMIN_PASSWORD` here if desired before
the auth database is first created. Do not copy `.env.example` over an
existing `.env`, because that would replace your local settings.

Return to the project root:

```bash
cd ..
```

The `.env` file and local databases are intentionally not committed. Keep
secrets private. If `node_modules` was installed with a different Node
version, rerun `npm ci` in `brightloop-auth/`.

On first start the shared database is created at `data/brightloop.sqlite`.
Both apps resolve the same path by default; override it for both with
`DB_FILE` or `DB_PATH` (see the configuration reference).

## Login details

The auth portal creates these demo accounts when it first creates its
database, unless you change the related `.env` settings:

| Role | Email / username | Default password |
|---|---|---|
| Admin | `admin@brightloop.com` | `Admin@12345` |
| Demo customer | `demo@customer.com` | `Demo@12345` |

Use the admin account for staff administration and the demo customer account
to view the customer portal. The demo customer and example subscriptions are
created only when `SEED_DEMO=true`.

To change the default admin login **before the auth database is first
created**, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `brightloop-auth/.env`.
Existing accounts are saved in the database; changing these settings later
does not change an existing user's password. These default credentials are
for local demonstration only. Choose a unique admin password before sharing
or deploying the app.

## Run both apps

From the repository root, with Node 22 selected and the auth `.env` set up:

```bash
./run.sh
```

Open these pages in your browser:

- Main subscription dashboard: <http://localhost:3000>
- Login and customer portal: <http://localhost:3001>

Keep the terminal open while using the apps. The script starts the auth app
first (which creates the shared schema and seeds the Member 2 demo catalogue),
then starts the subscription dashboard. It checks that the ports are available
and waits until both apps respond. Press **Ctrl+C** in that terminal to stop
both.

If ports 3000 or 3001 are already in use, use two free ports instead:

```bash
MAIN_PORT=3100 AUTH_PORT=3101 ./run.sh
```

Then open <http://localhost:3100> and <http://localhost:3101>.

## Run an app separately

The main app can be started without the portal:

```bash
cd subscription-app
npm start
```

Open <http://localhost:3000>. It uses the shared
`data/brightloop.sqlite` database and seeds the demo catalogue on first run,
unless `SKIP_SEED=true`. Run its tests from `subscription-app/` with:

```bash
npm test
```

Start the auth portal separately in another terminal:

```bash
cd ~/Desktop/odoo_hackathon/brightloop-auth
npm start
```

Open <http://localhost:3001>. With `.env` present, `PORT=3001` keeps the portal
alongside the dashboard. The portal reads the same subscriptions, quotations,
invoices, and payments as the main app. It also starts the daily billing cron;
set `DISABLE_BILLING_CRON=true` when you only want the HTTP API.

## Configuration reference

Auth settings live in `brightloop-auth/.env`:

| Setting | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Auth portal port when started by itself |
| `APP_URL` | `http://localhost:3001` | Base URL used in password reset links |
| `JWT_SECRET` | Set this yourself | Secret used to sign login tokens |
| `ADMIN_EMAIL` | `admin@brightloop.com` | Initial admin email, only used during initial database setup |
| `ADMIN_PASSWORD` | `Admin@12345` | Initial admin password, only used during initial database setup |
| `SEED_DEMO` | `true` | Create the demo customer and sample portal data |
| `SKIP_SEED` | `false` | Skip Member 2 demo products/quotations on an empty database |
| `DB_FILE`, `DB_PATH` | `<repo>/data/brightloop.sqlite` | Shared SQLite database; `DB_FILE` wins if both are set |
| `BILLING_CRON` | `0 2 * * *` | Cron expression for the automatic billing sweep |
| `BILLING_TIMEZONE` | `UTC` | Timezone used to evaluate `BILLING_CRON` |
| `DISABLE_BILLING_CRON` | `false` | Set to `true` to run the API without the billing scheduler |
| `SMTP_HOST`, `SMTP_PORT` | Empty, `587` | Optional outgoing mail server settings |
| `SMTP_USER`, `SMTP_PASS` | Empty | Optional SMTP login |
| `MAIL_FROM` | `Brightloop <no-reply@brightloop.com>` | Sender address for email |

When SMTP is not configured, password-reset links are printed in the auth
server terminal.

## Troubleshooting

- **`node:sqlite` not found / Node 20 appears in the error:** run `nvm use 22`,
  put the nvm Node directory first in `PATH` using the command above, and
  verify `node --version` before `./run.sh`.
- **“Port is unavailable” or “address already in use”:** stop the other app
  using that port, or run with `MAIN_PORT=3100 AUTH_PORT=3101`.
- **“Missing brightloop-auth/.env”:** complete the first-time setup above.
- **Auth startup fails with a SQLite error:** select Node 22+ and confirm
  `node --version`; no native SQLite package needs to be compiled.
- **“database is locked”:** both apps must point at the same `DB_FILE` /
  `DB_PATH`. Stop stray `node` processes holding the database and retry.
- **“Failed to fetch”:** start the app with `./run.sh` and browse to the
  printed app URL; do not open the HTML file directly from the file manager.

## API

The main application exposes these API groups:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Dashboard statistics |
| `GET`, `POST`, `PUT`, `DELETE` | `/api/products` | Product catalog |
| `POST` | `/api/products/:id/attributes` | Add a product attribute |
| `POST` | `/api/attributes/:id/values` | Add a value and price surcharge |
| `POST` | `/api/products/:id/generate-variants` | Generate product variants |
| `POST` | `/api/products/:id/calculate-variant` | Calculate a variant price |
| `GET`, `POST` | `/api/plans` | Subscription plans |
| `POST` | `/api/plans/:id/validate-action` | Check plan behavior rules |
| `GET`, `POST` | `/api/templates` | Quotation templates |
| `GET`, `POST` | `/api/quotations` | Sales quotations |
| `POST` | `/api/quotations/from-template` | Create a quote from a template |
| `PATCH` | `/api/quotations/:id/status` | Advance quotation status |
| `GET`, `POST` | `/api/discounts` | Discount rules |
| `POST` | `/api/discounts/evaluate` | Evaluate a discount |
| `POST` | `/api/seed` | Reload demo scenarios |

Member 1 and Member 3 endpoints are exposed by `brightloop-auth` on port 3001:

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/portal/summary`, `/subscriptions`, `/invoices` | Customer | Own data only |
| `POST` | `/api/portal/subscriptions/:id/close` | Customer | Close own subscription |
| `GET` | `/api/invoices` | Admin, staff | List invoices (`status`, `customer_id`, `subscription_id`, `from`, `to`, `q`, `overdue`, `limit`, `offset`) |
| `GET` | `/api/invoices/:id` | Admin, staff | Invoice detail with line items and payments |
| `PATCH` | `/api/invoices/:id/status` | Admin, staff | Advance Draft → Confirmed → Paid; `force=true` allows manual Paid |
| `GET` | `/api/invoices/:id/payments` | Admin, staff | Payment history |
| `POST` | `/api/invoices/:id/payments` | Admin, staff | Record `{amount, method, payment_date, note}`; auto-marks Paid when covered |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/tax-rules` | Admin, staff | Manage active tax rules |
| `POST` | `/api/admin/billing/run` | Admin, staff | Run the billing sweep (`{asOf}` optional) |
| `POST` | `/api/admin/billing/sync` | Admin, staff | Sync Active Member 2 quotations into subscriptions |

The billing sweep runs daily at 02:00 UTC by default. For each due Active
subscription it applies the linked quotation/discount, adds every active tax
rule, creates a Draft invoice with line items, and advances
`next_billing_date`. The sweep is idempotent for each billing period.
