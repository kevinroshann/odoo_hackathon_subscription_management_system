
/**
 * Brightloop Subscription Management System
 * Member 4: Finance Analytics
 *
 * Core financial calculations.
 * Database integration will be handled separately.
 */

function calculateOutstanding(totalAmount, payments = []) {
    const total = Number(totalAmount) || 0;

    const paid = payments.reduce(
        (sum, payment) => sum + (Number(payment.amount) || 0),
        0
    );

    return Math.max(0, total - paid);
}

function calculateDashboardMetrics({
    subscriptions = [],
    invoices = [],
    payments = [],
    asOf = new Date()
}) {
    const activeSubscriptions = subscriptions.filter(
        sub => sub.status === 'Active'
    ).length;

    const revenueCollected = payments.reduce(
        (sum, payment) => {
            const paymentDate = new Date(payment.payment_date);

            if (paymentDate > asOf) return sum;

            return sum + (Number(payment.amount) || 0);
        },
        0
    );

    let outstandingBalance = 0;
    let overdueInvoices = 0;
    let grossRevenue = 0;

    invoices.forEach(invoice => {
        if (!['Confirmed', 'Paid'].includes(invoice.status)) {
            return;
        }

        const total = Number(invoice.total) || 0;

        grossRevenue += total;

        const invoicePayments = payments.filter(
            payment => Number(payment.invoice_id) === Number(invoice.id)
        );

        const outstanding = calculateOutstanding(
            total,
            invoicePayments
        );

        outstandingBalance += outstanding;

        if (
            outstanding > 0 &&
            new Date(invoice.due_date) < asOf
        ) {
            overdueInvoices++;
        }
    });

    return {
        activeSubscriptions,
        grossRevenue,
        revenueCollected,
        outstandingBalance,
        overdueInvoices
    };
}

module.exports = {
    calculateOutstanding,
    calculateDashboardMetrics
};

