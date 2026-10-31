# Brightloop Subscription Management System

The project is organized into two app folders:

```text
odoo_hackathon/
├── subscription-app/   # Products, plans, quotations, discounts, tests, database
├── brightloop-auth/    # Login, staff roles, and customer portal
├── run.sh              # Starts both apps together
├── README.md           # Setup and run instructions
└── .gitignore
```

They use separate SQLite databases and HTTP servers. The authentication and
portal routes have not yet been merged into the main application's schema or
server.

## Requirements

- Debian/Linux, Bash, and `curl`.
- Node.js 22.5.0 or newer and npm.
- `nvm` is recommended for managing Node.js versions.

The main app uses Node's built-in SQLite support. The auth portal has a native
SQLite dependency, so install its dependencies after selecting the Node
version you will use to run it.

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

Keep the terminal open while using the apps. The script checks that the ports
are available and waits until both apps respond. Press **Ctrl+C** in that
terminal to stop both.

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

Open <http://localhost:3000>. It creates and seeds
`subscription-app/data/brightloop.sqlite` on first run. Run its tests from
`subscription-app/` with:

```bash
npm test
```

Start the portal separately in another terminal:

```bash
cd ~/Desktop/odoo_hackathon/brightloop-auth
npm start
```

Open <http://localhost:3001>. The portal settings, demo logins, and database
are independent of the main app. The two apps are not yet integrated with
each other's subscription data.

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
- **Auth startup fails loading `better-sqlite3`:** select Node 22, then run
  `cd brightloop-auth && npm ci` again.
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
