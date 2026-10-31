async function loadReceivables(container, options = {}) {
  const filter = options.filter || 'all';
  const q = options.q || '';
  const limit = 20;
  const offset = options.offset || 0;

  container.innerHTML = '<p>Loading receivables...</p>';

  try {
    const params = new URLSearchParams({ filter, q, limit, offset });

    const response = await fetch(
      `/api/finance/receivables?${params}`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();
    const invoices = data.receivables || [];

    const escapeHTML = (value) =>
      String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);

    const currency = value =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(Number(value) || 0);

    const rows = invoices.map(invoice => `
      <tr>
        <td>${escapeHTML(invoice.number)}</td>
        <td>${escapeHTML(invoice.customer_name)}</td>
        <td>${escapeHTML(invoice.due_date)}</td>
        <td>${currency(invoice.total_amount)}</td>
        <td>${currency(invoice.paid_amount)}</td>
        <td>${currency(invoice.balance)}</td>
        <td>${Number(invoice.days_overdue) > 0
          ? `${Number(invoice.days_overdue)} days`
          : '—'}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <section class="receivables">
        <h2>Accounts Receivable</h2>

        <div class="receivables-controls">
          <input id="receivable-search"
            type="search"
            placeholder="Search invoice or customer"
            value="${escapeHTML(q)}">

          <select id="receivable-filter">
            <option value="all">All invoices</option>
            <option value="overdue">Overdue</option>
            <option value="unpaid">Unpaid</option>
            <option value="partially_paid">Partially paid</option>
          </select>

          <button id="receivable-search-btn">Search</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Due Date</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Overdue</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="7">No invoices found.</td></tr>'}
          </tbody>
        </table>

        <div class="receivables-pagination">
          <button id="receivable-prev" ${offset === 0 ? 'disabled' : ''}>
            Previous
          </button>
          <span>Showing ${invoices.length} of ${data.total || 0}</span>
          <button id="receivable-next"
            ${offset + invoices.length >= (data.total || 0) ? 'disabled' : ''}>
            Next
          </button>
        </div>
      </section>
    `;

    container.querySelector('#receivable-filter').value = filter;

    container.querySelector('#receivable-search-btn')
      .addEventListener('click', () => {
        loadReceivables(container, {
          filter: container.querySelector('#receivable-filter').value,
          q: container.querySelector('#receivable-search').value
        });
      });

    container.querySelector('#receivable-prev')
      .addEventListener('click', () => {
        loadReceivables(container, {
          filter, q, offset: Math.max(0, offset - limit)
        });
      });

    container.querySelector('#receivable-next')
      .addEventListener('click', () => {
        loadReceivables(container, {
          filter, q, offset: offset + limit
        });
      });

  } catch (error) {
    container.innerHTML = `
      <p>Unable to load receivables: ${escapeHTML(error.message)}</p>
    `;
  }
}

window.loadReceivables = loadReceivables;
