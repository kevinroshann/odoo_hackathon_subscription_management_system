
const express = require('express');

function createFinanceRouter(db) {
    const router = express.Router();

    // GET /api/finance/summary
    router.get('/summary', (req, res, next) => {
        try {
            const subscriptions = db.prepare(`
                SELECT COUNT(*) AS count
                FROM subscriptions
                WHERE status = 'Active'
            `).get();

            const finance = db.prepare(`
                WITH payment_totals AS (
                    SELECT invoice_id, SUM(amount) AS paid_amount
                    FROM payments
                    GROUP BY invoice_id
                ),
                invoice_balances AS (
                    SELECT
                        i.id,
                        i.status,
                        i.due_date,
                        CASE
                            WHEN i.total_amount > 0 THEN i.total_amount
                            ELSE i.total
                        END AS invoice_total,
                        COALESCE(p.paid_amount, 0) AS paid_amount
                    FROM invoices i
                    LEFT JOIN payment_totals p
                        ON p.invoice_id = i.id
                    WHERE i.status IN ('Confirmed', 'Paid')
                )
                SELECT
                    COALESCE(SUM(invoice_total), 0) AS gross_revenue,

                    COALESCE(SUM(
                        CASE
                            WHEN invoice_total > paid_amount
                            THEN invoice_total - paid_amount
                            ELSE 0
                        END
                    ), 0) AS outstanding_balance,

                    COALESCE(SUM(
                        CASE
                            WHEN due_date < date('now')
                             AND invoice_total > paid_amount
                            THEN 1
                            ELSE 0
                        END
                    ), 0) AS overdue_invoices

                FROM invoice_balances
            `).get();

            const collected = db.prepare(`
                SELECT COALESCE(SUM(p.amount), 0) AS total
                FROM payments p
                JOIN invoices i ON i.id = p.invoice_id
                WHERE i.status IN ('Confirmed', 'Paid')
            `).get();

            res.json({
                activeSubscriptions: Number(subscriptions.count),
                grossRevenue: Number(finance.gross_revenue),
                revenueCollected: Number(collected.total),
                outstandingBalance: Number(finance.outstanding_balance),
                overdueInvoices: Number(finance.overdue_invoices)
            });

        } catch (error) {
            next(error);
        }
    });


    // GET /api/finance/receivables
    router.get('/receivables', (req, res, next) => {
        try {
            const { filter = 'all', q = '' } = req.query;

            const limit = Math.min(
                200,
                Math.max(1, Number(req.query.limit) || 50)
            );

            const offset = Math.max(
                0,
                Number(req.query.offset) || 0
            );

            const conditions = ['balance > 0'];
            const params = [];

            if (filter === 'overdue') {
                conditions.push(
                    "due_date IS NOT NULL AND due_date < date('now')"
                );
            } else if (filter === 'unpaid') {
                conditions.push('paid_amount = 0');
            } else if (filter === 'partially_paid') {
                conditions.push('paid_amount > 0');
            } else if (filter !== 'all') {
                return res.status(400).json({
                    error: 'Invalid filter'
                });
            }

            if (q.trim()) {
                conditions.push(`
                    (
                        number LIKE ?
                        OR customer_name LIKE ?
                        OR customer_email LIKE ?
                    )
                `);

                const term = `%${q.trim()}%`;
                params.push(term, term, term);
            }

            const where = conditions.join(' AND ');

            const baseQuery = `
                WITH payment_totals AS (
                    SELECT invoice_id, SUM(amount) AS paid_amount
                    FROM payments
                    GROUP BY invoice_id
                ),
                invoice_balances AS (
                    SELECT
                        i.id,
                        i.number,
                        i.customer_id,
                        i.status,
                        i.issue_date,
                        i.due_date,
                        u.name AS customer_name,
                        u.email AS customer_email,

                        CASE
                            WHEN i.total_amount > 0 THEN i.total_amount
                            ELSE i.total
                        END AS total_amount,

                        COALESCE(p.paid_amount, 0) AS paid_amount,

                        CASE
                            WHEN (
                                CASE
                                    WHEN i.total_amount > 0
                                    THEN i.total_amount
                                    ELSE i.total
                                END
                            ) > COALESCE(p.paid_amount, 0)
                            THEN (
                                CASE
                                    WHEN i.total_amount > 0
                                    THEN i.total_amount
                                    ELSE i.total
                                END
                            ) - COALESCE(p.paid_amount, 0)
                            ELSE 0
                        END AS balance

                    FROM invoices i
                    LEFT JOIN users u ON u.id = i.customer_id
                    LEFT JOIN payment_totals p ON p.invoice_id = i.id

                    WHERE i.status IN ('Confirmed', 'Paid')
                )
            `;

            const total = db.prepare(`
                ${baseQuery}
                SELECT COUNT(*) AS count
                FROM invoice_balances
                WHERE ${where}
            `).get(...params);

            const rows = db.prepare(`
                ${baseQuery}
                SELECT *,
                    CASE
                        WHEN due_date < date('now')
                        THEN CAST(
                            julianday('now') - julianday(due_date)
                            AS INTEGER
                        )
                        ELSE 0
                    END AS days_overdue

                FROM invoice_balances
                WHERE ${where}

                ORDER BY
                    CASE WHEN due_date < date('now') THEN 0 ELSE 1 END,
                    due_date ASC

                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            res.json({
                total: Number(total.count),
                limit,
                offset,
                receivables: rows
            });

        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createFinanceRouter;
