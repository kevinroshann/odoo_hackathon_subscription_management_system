
/**
 * Member 4 - Database Performance Optimisation
 * Brightloop Subscription Management System
 *
 * Adds indexes for finance reporting and receivables.
 * Safe to execute multiple times.
 */

function optimizeFinanceDatabase(db) {
    if (!db || typeof db.exec !== 'function') {
        throw new Error('Valid SQLite database required');
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_finance_invoice_due
        ON invoices(status, due_date);

        CREATE INDEX IF NOT EXISTS idx_finance_invoice_customer_date
        ON invoices(customer_id, issue_date);

        CREATE INDEX IF NOT EXISTS idx_finance_payment_date
        ON payments(payment_date);

        CREATE INDEX IF NOT EXISTS idx_finance_subscription_status
        ON subscriptions(status);

        CREATE INDEX IF NOT EXISTS idx_finance_invoice_status_date
        ON invoices(status, issue_date);
    `);
}

module.exports = { optimizeFinanceDatabase };
