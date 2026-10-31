
/**
 * Brightloop Finance Dashboard
 * Member 4
 *
 * Renders financial summary metrics.
 * Uses data returned by /api/finance/summary.
 */

async function loadFinanceDashboard(container) {
    container.innerHTML = '<p>Loading finance data...</p>';

    try {
        const response = await fetch('/api/finance/summary', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Unable to retrieve finance data');
        }

        const data = await response.json();

        const metrics = [
            {
                title: 'Active Subscriptions',
                value: data.activeSubscriptions
            },
            {
                title: 'Gross Revenue',
                value: formatCurrency(data.grossRevenue)
            },
            {
                title: 'Revenue Collected',
                value: formatCurrency(data.revenueCollected)
            },
            {
                title: 'Outstanding Balance',
                value: formatCurrency(data.outstandingBalance)
            },
            {
                title: 'Overdue Invoices',
                value: data.overdueInvoices
            }
        ];

        container.innerHTML = `
            <section class="finance-dashboard">
                <h2>Finance Dashboard</h2>

                <div class="finance-grid">
                    ${metrics.map(metric => `
                        <article class="finance-card">
                            <h3>${metric.title}</h3>
                            <p>${metric.value}</p>
                        </article>
                    `).join('')}
                </div>

                <button id="refresh-finance">
                    Refresh Dashboard
                </button>
            </section>
        `;

        document
            .getElementById('refresh-finance')
            .addEventListener('click', () => loadFinanceDashboard(container));

    } catch (error) {
        container.innerHTML = `
            <p>Finance dashboard unavailable: ${error.message}</p>
            <button onclick="loadFinanceDashboard(
                document.getElementById('finance-dashboard')
            )">Retry</button>
        `;
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(Number(amount) || 0);
}

window.loadFinanceDashboard = loadFinanceDashboard;
