# Brightloop Finance Module — Performance Plan

## 1. Objective

Ensure that finance dashboard and accounts receivable queries remain responsive when the application contains thousands of subscriptions, invoices and payment records.

**Target:** API response time below 2 seconds under normal test conditions.

## 2. Database Optimization

The finance module uses SQLite, consistent with the existing application database.

The following indexes are proposed to support common finance operations:

| Index | Purpose |
|---|---|
| `idx_finance_invoice_due` | Supports invoice status and due-date filtering |
| `idx_finance_invoice_customer_date` | Supports customer and invoice-date filtering |
| `idx_finance_payment_date` | Supports payment-date queries |
| `idx_finance_subscription_status` | Supports subscription status filtering |
| `idx_finance_invoice_status_date` | Supports invoice status and date filtering |

These indexes are defined in `backend/performanceIndexes.js`. Existing indexes should be checked for overlap before applying additional indexes.

## 3. Query Optimization

The finance API uses SQL aggregation to calculate:

- Total active subscriptions
- Gross invoiced revenue
- Revenue collected
- Outstanding balances
- Overdue invoice counts

Payment totals should be aggregated before joining them with invoices to avoid repeatedly calculating payment sums for individual invoices.

Pagination is used for accounts receivable records to avoid loading the entire invoice collection at once.

## 4. Performance Testing Procedure

After integration, test with datasets containing approximately:

| Test | Subscriptions | Invoices | Payments |
|---|---:|---:|---:|
| Small | 100 | 500 | 500 |
| Medium | 1,000 | 5,000 | 5,000 |
| Large | 5,000 | 25,000 | 25,000 |

For each dataset, measure:

1. Finance dashboard API response time.
2. Accounts receivable API response time.
3. Overdue invoice filtering response time.
4. Customer search response time.
5. Pagination response time.

Use the browser Network panel or an API testing tool to record response times.

## 5. Performance Evaluation

Record actual measurements after integration.

| API / Operation | Target | Actual |
|---|---:|---|
| Dashboard summary | Below 2 seconds | Pending |
| Receivables listing | Below 2 seconds | Pending |
| Overdue filtering | Below 2 seconds | Pending |
| Customer search | Below 2 seconds | Pending |

## 6. Expected Outcome

The combination of indexed database queries, SQL-level aggregation and pagination is intended to maintain responsive finance operations as the database grows.

**Note:** Performance targets are design goals, not measured results. Actual performance must be verified against representative datasets.
