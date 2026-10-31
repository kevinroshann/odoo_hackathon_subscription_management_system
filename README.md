# Brightloop Software - Subscription Management Platform
## Member 2: Products, Plans & Sales Quotations

A production-grade, zero-dependency subscription management and sales quoting engine built for **Brightloop Software** according to the challenge requirements.

---

### 🌟 Key Functional Capabilities

#### 1. Product Catalog & Pricing Engine
- **Master Product Management**: Complete metadata including Product Name, Code, Product Type (`Software`, `Service`, `Add-on`, `Consumable`), Sales Price, Cost Price, Margin calculations, and internal notes.
- **Variant Engine & Surcharges**:
  - Dynamically attach attributes (e.g. `Brand Edition`, `Cloud Hosting`, `Deployment Tier`).
  - Configure attribute values with explicit price surcharges (e.g. **Odoo Connected Brand adds +$560** to the base price).
  - Concrete variant generation (Cartesian matrix generation or manual SKU creation).
  - Real-time variant price recalculation: `Base Price + Σ(Attribute Value Extras)`.

#### 2. Subscription Plan Configurations & Behavior Rules
- **Billing Frequencies**: Full support for `daily`, `weekly`, `monthly`, and `yearly` recurring billing cadences.
- **Contract Controls**:
  - Base Platform Fees.
  - Minimum seat/quantity enforcement.
  - Availability date windows (`start_date` to `end_date`) with active validation.
- **Behavior Rules Engine**:
  - `auto_close`: Automatically terminates the subscription when the contract end date is reached.
  - `closable_early`: Dictates whether customers or staff can close/cancel an active subscription before its expiry date.
  - `pausable`: Controls whether subscriptions can be temporarily suspended/resumed.
  - `renewable`: Controls whether automatic or manual renewals are allowed.

#### 3. Sales Quotation Templates & Lifecycle Management
- **Quotation Templates**:
  - Standardized quotes with default subscription plans and pre-configured product lines.
  - **Fixed Validity Periods**: Automatically computes quote expiration date: `created_date + validity_days` (e.g. 15 days, 30 days).
  - Configurable payment terms (`Net 30`, `Net 45`, `Immediate`).
  - One-click customer quote generation from templates.
- **Quotation Status Lifecycle**:
  - State machine: `Draft` ➔ `Quotation Sent` ➔ `Confirmed` ➔ `Active Subscription` ➔ `Closed`.
  - Enforces plan behavior rules on transitions (e.g. blocks `Active` ➔ `Closed` if the plan has `closable_early = false`).
  - Itemized lines with unit prices, variant details, line taxes, discounts, and recurring totals.
  - Professional print / invoice preview mode.

#### 4. Admin Discount Engine
- **Discount Rules**:
  - Types: **Percentage (`%`)** or **Fixed Amount (`$`)**.
  - Target Scopes: **Whole Subscription** or **Specific Products Only** (attaches directly to designated product IDs).
  - Minimum Requirements: **Minimum Purchase Subtotal ($)** and **Minimum Seats/Quantity**.
  - **Usage Caps**: Strict limit on maximum redemptions with automatic counter increment upon confirmation.
  - Validity Windows: Date-range checks (`start_date` & `end_date`).
- **Interactive Discount Simulator / Test Bench**:
  - Live sandbox to test discount codes against simulated cart sizes and seat counts, returning immediate eligibility feedback and discount breakdowns.

---

### 📂 Architecture & File Structure

```
d:\prajith\anty\
├── src\
│   ├── db\
│   │   ├── database.js          # SQLite connection, foreign keys & schema migrations
│   │   └── seed.js              # Brightloop realistic seed dataset (Odoo +560, plans, etc.)
│   ├── services\
│   │   ├── productService.js    # Master catalog, attributes & variant surcharge engine
│   │   ├── planService.js       # Subscription plans & behavior rule validator
│   │   ├── discountService.js   # Admin discount engine (caps, dates, min qty/amounts)
│   │   ├── templateService.js   # Quotation templates with fixed validity periods
│   │   └── quotationService.js  # Quotations lifecycle, taxes, discounts & calculations
│   ├── server.js                # High-speed HTTP server & REST API
│   └── public\
│       ├── index.html           # Modern responsive dashboard & UI
│       ├── app.js               # Frontend state management & live calculators
│       └── styles.css           # Styling, status badges & print layouts
├── tests\
│   ├── product.test.js          # Unit tests: products & variant engine (+560 surcharge)
│   ├── plan.test.js             # Unit tests: cadences & behavior rules
│   ├── discount.test.js         # Unit tests: % / fixed, caps, minimums, specific products
│   ├── quotation.test.js        # Unit tests: templates, expiry dates, lifecycle transitions
│   └── api.test.js              # Integration tests: REST API endpoints & live simulator
├── package.json
├── start.bat                    # One-click Windows starter
├── test.bat                     # One-click Windows test runner
└── README.md
```

---

### 🚀 Running the Project

#### 1. Run Unit Tests (18 passing tests)
```bash
agy-node --test tests/*.test.js
```
Or double-click `test.bat`.

#### 2. Start the Application Server
```bash
agy-node src/server.js
```
Or double-click `start.bat`.

The server will automatically seed the initial database if empty and start on:
**`http://localhost:3000`**

Open your browser to access the complete interactive interface!

---

### 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Dashboard statistics & summary counters |
| `GET` | `/api/products` | List all products with attributes & variants |
| `POST` | `/api/products` | Create a new master product |
| `POST` | `/api/products/:id/attributes` | Add attribute (e.g. Brand) to product |
| `POST` | `/api/attributes/:id/values` | Add value with price surcharge (e.g. Odoo +560) |
| `POST` | `/api/products/:id/generate-variants` | Auto-generate all variant combinations |
| `POST` | `/api/products/:id/calculate-variant` | Calculate variant price based on selected values |
| `GET` | `/api/plans` | List subscription plans with behavior rules |
| `POST` | `/api/plans` | Create a subscription plan |
| `POST` | `/api/plans/:id/validate-action` | Test plan behavior rule (`early_close`, `pause`, `renew`) |
| `GET` | `/api/templates` | List quotation templates |
| `POST` | `/api/templates` | Create template with validity period & lines |
| `GET` | `/api/quotations` | List quotations with status filter |
| `POST` | `/api/quotations` | Create a sales quotation |
| `POST` | `/api/quotations/from-template` | Generate quotation from a template |
| `PATCH`| `/api/quotations/:id/status` | Advance quote lifecycle (`Draft` ➔ `Quotation` ➔ `Confirmed` ➔ `Active` ➔ `Closed`) |
| `GET` | `/api/discounts` | List admin discount rules with usage tracking |
| `POST` | `/api/discounts` | Create discount rule |
| `POST` | `/api/discounts/evaluate` | Live discount engine evaluator & simulator |
| `POST` | `/api/seed` | Reset and reload demo scenarios |
