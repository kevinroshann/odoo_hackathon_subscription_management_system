// Brightloop Subscription Management System - Member 2 Frontend Application

let appState = {
  activeTab: 'dashboard',
  products: [],
  plans: [],
  templates: [],
  quotations: [],
  discounts: [],
  selectedProductIdForVariants: null,
  currentProductTypeFilter: '',
  currentQuoteStatusFilter: ''
};

// Initialize app on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  await loadAllData();
  setupEventListeners();
});

// Toast notification helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  toastMsg.textContent = message;

  toast.className = `fixed bottom-5 right-5 z-50 transform transition-all duration-300 opacity-100 translate-y-0 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-2 ${
    isError ? 'bg-rose-600' : 'bg-slate-900'
  }`;

  setTimeout(() => {
    toast.className = 'fixed bottom-5 right-5 z-50 transform transition-all duration-300 opacity-0 translate-y-3 pointer-events-none bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center space-x-2';
  }, 3500);
}

// Tab navigation
function switchTab(tabId) {
  appState.activeTab = tabId;

  // Update navbar desktop and mobile tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav) activeNav.classList.add('active');

  document.querySelectorAll('.mobile-nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.id === `m-nav-${tabId}`);
  });

  // Update tab content displays
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.add('hidden');
    section.classList.remove('block');
  });
  const activeSection = document.getElementById(`tab-${tabId}`);
  if (activeSection) {
    activeSection.classList.remove('hidden');
    activeSection.classList.add('block');
  }

  if (window.lucide) lucide.createIcons();

  // Reload specific tab data
  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'products') renderProducts();
  if (tabId === 'plans') renderPlans();
  if (tabId === 'templates') renderTemplates();
  if (tabId === 'quotations') renderQuotations();
  if (tabId === 'discounts') renderDiscounts();
}

// Fetch all data from API
async function loadAllData() {
  try {
    const [stats, prods, plans, tmpls, quotes, discs] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
      fetch('/api/plans').then(r => r.json()),
      fetch('/api/templates').then(r => r.json()),
      fetch('/api/quotations').then(r => r.json()),
      fetch('/api/discounts').then(r => r.json())
    ]);

    appState.stats = stats;
    appState.products = prods;
    appState.plans = plans;
    appState.templates = tmpls;
    appState.quotations = quotes;
    appState.discounts = discs;

    renderDashboard();
    renderProducts();
    renderPlans();
    renderTemplates();
    renderQuotations();
    renderDiscounts();
  } catch (err) {
    console.error('Error loading data:', err);
    showToast('Failed to load data from server', true);
  }
}

async function reseedData() {
  if (!confirm('Reseed database with fresh Brightloop demo data?')) return;
  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('Database reset and seeded successfully!');
      await loadAllData();
    } else {
      showToast(data.error || 'Reseed failed', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const s = appState.stats || {};
  document.getElementById('stat-products').textContent = s.products || appState.products.length;
  document.getElementById('stat-plans').textContent = s.plans || appState.plans.length;
  document.getElementById('stat-quotations').textContent = s.quotations || appState.quotations.length;
  document.getElementById('stat-active-subs').textContent = s.active_subscriptions || appState.quotations.filter(q => q.status === 'Active').length;

  const tbody = document.getElementById('dashboard-quotes-tbody');
  const recent = appState.quotations.slice(0, 5);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-6 text-center text-slate-400">No sales quotations recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(q => `
    <tr class="hover:bg-slate-50 transition">
      <td class="px-6 py-3.5 font-bold text-slate-900">${q.quote_number}</td>
      <td class="px-6 py-3.5">
        <div class="font-semibold text-slate-800">${escapeHtml(q.customer_name)}</div>
        <div class="text-[11px] text-slate-400">${escapeHtml(q.customer_email)}</div>
      </td>
      <td class="px-6 py-3.5">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
          ${q.plan ? escapeHtml(q.plan.name) : 'Plan #' + q.plan_id}
        </span>
      </td>
      <td class="px-6 py-3.5 text-xs text-slate-600">
        ${q.expiry_date}
      </td>
      <td class="px-6 py-3.5 font-bold text-slate-900">$${q.total_amount.toFixed(2)}</td>
      <td class="px-6 py-3.5">
        <span class="status-badge badge-${q.status}">${q.status}</span>
      </td>
      <td class="px-6 py-3.5 text-right">
        <button onclick="viewQuotationDetails(${q.id})" class="text-xs font-semibold text-brand-600 hover:text-brand-800">
          View
        </button>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

// ==================== PRODUCTS & VARIANTS ====================
function filterProductsByType(type) {
  appState.currentProductTypeFilter = type;
  document.querySelectorAll('.prod-type-btn').forEach(b => {
    if ((type === '' && b.textContent === 'All') || b.textContent === type) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  renderProducts();
}

function renderProducts() {
  const container = document.getElementById('products-container');
  let filtered = appState.products;
  if (appState.currentProductTypeFilter) {
    filtered = filtered.filter(p => p.type === appState.currentProductTypeFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">No products match this filter.</div>`;
    return;
  }

  container.innerHTML = filtered.map(prod => {
    const margin = prod.sales_price > 0 ? (((prod.sales_price - prod.cost_price) / prod.sales_price) * 100).toFixed(0) : 0;
    const variantsCount = prod.variants ? prod.variants.length : 0;
    const hasOdoo = prod.variants && prod.variants.some(v => v.variant_name.toLowerCase().includes('odoo'));

    return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between mb-2">
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${prod.code}</span>
              <h3 class="font-bold text-base text-slate-900">${escapeHtml(prod.name)}</h3>
            </div>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-brand-50 text-brand-700 border border-brand-200">
              ${prod.type}
            </span>
          </div>

          <p class="text-xs text-slate-500 mb-4 line-clamp-2">${escapeHtml(prod.notes || 'No description provided.')}</p>

          <!-- Pricing summary -->
          <div class="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg mb-4 text-xs">
            <div>
              <span class="text-[10px] text-slate-400 block uppercase font-semibold">Sales Price</span>
              <span class="font-bold text-slate-900 text-sm">$${prod.sales_price.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 block uppercase font-semibold">Cost Price</span>
              <span class="font-medium text-slate-600 text-sm">$${prod.cost_price.toFixed(2)}</span>
              <span class="text-[10px] text-emerald-600 font-semibold ml-1">(${margin}% margin)</span>
            </div>
          </div>

          <!-- Variants info badge -->
          <div class="flex items-center space-x-2 mb-3">
            <span class="text-xs font-semibold text-slate-600">Variants:</span>
            <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
              ${variantsCount} configured
            </span>
            ${hasOdoo ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">Odoo +$560</span>` : ''}
          </div>
        </div>

        <div class="border-t border-slate-100 pt-3 flex items-center justify-between">
          <button onclick="openVariantsModal(${prod.id})" class="btn-xs-primary">
            <i data-lucide="sliders" class="w-3.5 h-3.5 mr-1 inline"></i>Manage Variants
          </button>
          <div class="space-x-1">
            <button onclick="openEditProductModal(${prod.id})" class="p-1 text-slate-400 hover:text-slate-600" title="Edit"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
            <button onclick="deleteProduct(${prod.id})" class="p-1 text-slate-400 hover:text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openCreateProductModal() {
  document.getElementById('form-product').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('modal-product-title').textContent = 'Create New Product';
  openModal('modal-product');
}

function openEditProductModal(id) {
  const prod = appState.products.find(p => p.id === id);
  if (!prod) return;

  document.getElementById('prod-id').value = prod.id;
  document.getElementById('prod-code').value = prod.code;
  document.getElementById('prod-name').value = prod.name;
  document.getElementById('prod-type').value = prod.type;
  document.getElementById('prod-sales-price').value = prod.sales_price;
  document.getElementById('prod-cost-price').value = prod.cost_price;
  document.getElementById('prod-notes').value = prod.notes || '';
  document.getElementById('prod-active').checked = Boolean(prod.active);

  document.getElementById('modal-product-title').textContent = `Edit Product: ${prod.code}`;
  openModal('modal-product');
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('prod-id').value;
  const payload = {
    code: document.getElementById('prod-code').value,
    name: document.getElementById('prod-name').value,
    type: document.getElementById('prod-type').value,
    sales_price: parseFloat(document.getElementById('prod-sales-price').value),
    cost_price: parseFloat(document.getElementById('prod-cost-price').value || 0),
    notes: document.getElementById('prod-notes').value,
    active: document.getElementById('prod-active').checked ? 1 : 0
  };

  try {
    const url = id ? `/api/products/${id}` : '/api/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      showToast(id ? 'Product updated successfully' : 'Product created successfully');
      closeModal('modal-product');
      await loadAllData();
    } else {
      showToast(data.error || 'Operation failed', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product? All linked variants will also be removed.')) return;
  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Product deleted');
      await loadAllData();
    } else {
      const data = await res.json();
      showToast(data.error || 'Delete failed', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// --- Variant Engine Modal Logic ---
function openVariantsModal(productId) {
  appState.selectedProductIdForVariants = productId;
  renderVariantsModalContent();
  openModal('modal-variants');
}

function renderVariantsModalContent() {
  const prod = appState.products.find(p => p.id === appState.selectedProductIdForVariants);
  if (!prod) return;

  document.getElementById('modal-variants-subtitle').textContent = `Product: ${prod.name} (${prod.code}) | Base Price: $${prod.sales_price.toFixed(2)}`;

  // 1. Render Attributes and Values
  const attrList = document.getElementById('product-attributes-list');
  if (!prod.attributes || prod.attributes.length === 0) {
    attrList.innerHTML = `<div class="p-3 text-center text-slate-400 bg-slate-50 rounded-xl">No attributes added yet. Add an attribute like "Brand" to enable variant configurations.</div>`;
  } else {
    attrList.innerHTML = prod.attributes.map(attr => `
      <div class="border border-slate-200 rounded-xl p-3 bg-white">
        <div class="flex justify-between items-center mb-2">
          <span class="font-bold text-slate-900">${escapeHtml(attr.name)}</span>
          <button onclick="showAddValuePrompt(${attr.id})" class="btn-xs-secondary">+ Add Value</button>
        </div>
        <div class="flex flex-wrap gap-2">
          ${attr.values.length === 0 ? '<span class="text-slate-400 text-xs">No values yet</span>' : ''}
          ${attr.values.map(val => `
            <div class="px-2.5 py-1 rounded-lg border text-xs flex items-center space-x-1.5 ${
              val.value.toLowerCase().includes('odoo')
                ? 'bg-purple-50 border-purple-300 text-purple-900 font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }">
              <span>${escapeHtml(val.value)}</span>
              <span class="${val.price_extra > 0 ? 'text-purple-700 font-extrabold' : 'text-slate-400'}">
                (${val.price_extra >= 0 ? '+' : ''}$${val.price_extra.toFixed(2)})
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  // 2. Render Configured Variants
  const tbody = document.getElementById('product-variants-tbody');
  if (!prod.variants || prod.variants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-4 text-center text-slate-400">No variants generated yet. Click "Generate All Combinations" above.</td></tr>`;
  } else {
    tbody.innerHTML = prod.variants.map(v => {
      const breakdownText = v.attribute_values && v.attribute_values.length > 0
        ? v.attribute_values.map(av => `${av.value} (+$${av.price_extra})`).join(' + ')
        : 'Base standard';

      return `
        <tr class="hover:bg-slate-50">
          <td class="px-4 py-2.5 font-bold text-slate-800">${escapeHtml(v.sku)}</td>
          <td class="px-4 py-2.5 font-medium text-slate-900">${escapeHtml(v.variant_name)}</td>
          <td class="px-4 py-2.5 text-slate-500 text-[11px]">${escapeHtml(breakdownText)}</td>
          <td class="px-4 py-2.5 font-bold text-brand-600">$${v.calculated_sales_price.toFixed(2)}</td>
        </tr>
      `;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
}

function toggleAttributeForm() {
  const form = document.getElementById('form-new-attr');
  form.classList.toggle('hidden');
}

async function submitNewAttribute() {
  const name = document.getElementById('new-attr-name').value.trim();
  if (!name) return;

  try {
    const res = await fetch(`/api/products/${appState.selectedProductIdForVariants}/attributes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      document.getElementById('new-attr-name').value = '';
      toggleAttributeForm();
      showToast('Attribute added');
      await loadAllData();
      renderVariantsModalContent();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function showAddValuePrompt(attrId) {
  const valName = prompt('Enter Attribute Value name (e.g. Odoo, Enterprise):');
  if (!valName) return;
  const priceExtra = prompt('Enter Price Extra surcharge in $ (e.g. 560):', '0');
  if (priceExtra === null) return;

  try {
    const res = await fetch(`/api/attributes/${attrId}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: valName,
        price_extra: parseFloat(priceExtra) || 0
      })
    });
    if (res.ok) {
      showToast(`Added value '${valName}' with +$${priceExtra}`);
      await loadAllData();
      renderVariantsModalContent();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// Quick Add Odoo Brand (+560) button
async function quickAddOdooBrand() {
  const prod = appState.products.find(p => p.id === appState.selectedProductIdForVariants);
  if (!prod) return;

  let brandAttr = prod.attributes ? prod.attributes.find(a => a.name.toLowerCase().includes('brand')) : null;

  try {
    if (!brandAttr) {
      const aRes = await fetch(`/api/products/${prod.id}/attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Brand' })
      });
      brandAttr = await aRes.json();
    }

    const vRes = await fetch(`/api/attributes/${brandAttr.id}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'Odoo Connected Brand', price_extra: 560.0 })
    });

    if (vRes.ok) {
      showToast('Odoo brand configuration (+560) added!');
      await loadAllData();
      // Auto generate variants
      await generateVariantMatrix();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function generateVariantMatrix() {
  try {
    const res = await fetch(`/api/products/${appState.selectedProductIdForVariants}/generate-variants`, {
      method: 'POST'
    });
    if (res.ok) {
      showToast('Variants generated from attribute combinations!');
      await loadAllData();
      renderVariantsModalContent();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== SUBSCRIPTION PLANS ====================
function renderPlans() {
  const container = document.getElementById('plans-container');
  if (appState.plans.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">No subscription plans configured.</div>`;
    return;
  }

  container.innerHTML = appState.plans.map(plan => {
    const freqColor = {
      daily: 'bg-amber-100 text-amber-800 border-amber-200',
      weekly: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      monthly: 'bg-blue-100 text-blue-800 border-blue-200',
      yearly: 'bg-purple-100 text-purple-800 border-purple-200'
    }[plan.billing_frequency] || 'bg-slate-100 text-slate-700';

    return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between mb-3">
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${plan.code}</span>
              <h3 class="font-bold text-lg text-slate-900">${escapeHtml(plan.name)}</h3>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${freqColor}">
              ${plan.billing_frequency}
            </span>
          </div>

          <p class="text-xs text-slate-500 mb-4">${escapeHtml(plan.description || 'No description.')}</p>

          <div class="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl mb-4 text-xs">
            <div>
              <span class="text-[10px] text-slate-400 block uppercase font-semibold">Base Platform Fee</span>
              <span class="font-bold text-slate-900 text-sm">$${plan.base_fee.toFixed(2)}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 block uppercase font-semibold">Minimum Quantity</span>
              <span class="font-bold text-slate-900 text-sm">${plan.min_quantity} seat(s)</span>
            </div>
            <div class="col-span-2 text-[11px] text-slate-500 border-t border-slate-200/60 pt-2 flex justify-between">
              <span>Availability Window:</span>
              <span class="font-medium text-slate-700">
                ${plan.start_date || 'Evergreen'} to ${plan.end_date || 'Open'}
              </span>
            </div>
          </div>

          <!-- Behavior Rules Matrix -->
          <div class="border border-slate-200 rounded-xl p-3 bg-white space-y-2 mb-4">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Plan Behavior Rules Engine</span>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="flex items-center space-x-1.5">
                <i data-lucide="${plan.auto_close ? 'check-circle-2' : 'x-circle'}" class="w-4 h-4 ${plan.auto_close ? 'text-amber-600' : 'text-slate-300'}"></i>
                <span class="text-slate-700 font-medium">Auto-Close on End</span>
              </div>
              <div class="flex items-center space-x-1.5">
                <i data-lucide="${plan.closable_early ? 'check-circle-2' : 'x-circle'}" class="w-4 h-4 ${plan.closable_early ? 'text-emerald-600' : 'text-rose-500'}"></i>
                <span class="${plan.closable_early ? 'text-slate-700' : 'text-rose-700 font-bold'}">Early Close</span>
              </div>
              <div class="flex items-center space-x-1.5">
                <i data-lucide="${plan.pausable ? 'check-circle-2' : 'x-circle'}" class="w-4 h-4 ${plan.pausable ? 'text-emerald-600' : 'text-slate-300'}"></i>
                <span class="text-slate-700 font-medium">Pausable</span>
              </div>
              <div class="flex items-center space-x-1.5">
                <i data-lucide="${plan.renewable ? 'check-circle-2' : 'x-circle'}" class="w-4 h-4 ${plan.renewable ? 'text-emerald-600' : 'text-slate-300'}"></i>
                <span class="text-slate-700 font-medium">Renewable</span>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-slate-100 pt-3 flex justify-between items-center">
          <button onclick="testPlanRuleAction(${plan.id})" class="text-xs text-brand-600 hover:text-brand-800 font-semibold">
            Test Behavior Rule →
          </button>
          <div class="space-x-1">
            <button onclick="openEditPlanModal(${plan.id})" class="p-1 text-slate-400 hover:text-slate-600"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
            <button onclick="deletePlan(${plan.id})" class="p-1 text-slate-400 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openCreatePlanModal() {
  document.getElementById('form-plan').reset();
  document.getElementById('plan-id').value = '';
  document.getElementById('modal-plan-title').textContent = 'Create Subscription Plan';
  openModal('modal-plan');
}

function openEditPlanModal(id) {
  const plan = appState.plans.find(p => p.id === id);
  if (!plan) return;

  document.getElementById('plan-id').value = plan.id;
  document.getElementById('plan-code').value = plan.code;
  document.getElementById('plan-name').value = plan.name;
  document.getElementById('plan-freq').value = plan.billing_frequency;
  document.getElementById('plan-base-fee').value = plan.base_fee;
  document.getElementById('plan-min-qty').value = plan.min_quantity;
  document.getElementById('plan-start-date').value = plan.start_date || '';
  document.getElementById('plan-end-date').value = plan.end_date || '';
  document.getElementById('plan-auto-close').checked = plan.auto_close;
  document.getElementById('plan-closable-early').checked = plan.closable_early;
  document.getElementById('plan-pausable').checked = plan.pausable;
  document.getElementById('plan-renewable').checked = plan.renewable;

  document.getElementById('modal-plan-title').textContent = `Edit Plan: ${plan.code}`;
  openModal('modal-plan');
}

async function handlePlanSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('plan-id').value;
  const payload = {
    code: document.getElementById('plan-code').value,
    name: document.getElementById('plan-name').value,
    billing_frequency: document.getElementById('plan-freq').value,
    base_fee: parseFloat(document.getElementById('plan-base-fee').value || 0),
    min_quantity: parseInt(document.getElementById('plan-min-qty').value || 1, 10),
    start_date: document.getElementById('plan-start-date').value || null,
    end_date: document.getElementById('plan-end-date').value || null,
    auto_close: document.getElementById('plan-auto-close').checked ? 1 : 0,
    closable_early: document.getElementById('plan-closable-early').checked ? 1 : 0,
    pausable: document.getElementById('plan-pausable').checked ? 1 : 0,
    renewable: document.getElementById('plan-renewable').checked ? 1 : 0,
    active: 1
  };

  try {
    const url = id ? `/api/plans/${id}` : '/api/plans';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(id ? 'Plan updated' : 'Plan created successfully');
      closeModal('modal-plan');
      await loadAllData();
    } else {
      showToast(data.error || 'Failed to save plan', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deletePlan(id) {
  if (!confirm('Are you sure you want to delete this subscription plan?')) return;
  try {
    const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Plan deleted');
      await loadAllData();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to delete plan', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function testPlanRuleAction(planId) {
  const action = prompt('Test a rule against this plan. Type one of: early_close, pause, renew, auto_close', 'early_close');
  if (!action) return;

  try {
    const res = await fetch(`/api/plans/${planId}/validate-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action.trim() })
    });
    const result = await res.json();

    if (result.allowed === false) {
      alert(`❌ ACTION BLOCKED BY PLAN RULE:\n${result.reason}`);
    } else {
      alert(`✅ ACTION PERMITTED BY PLAN RULE!\n${result.message || 'Action is compliant with plan behavior policies.'}`);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== QUOTATION TEMPLATES ====================
function renderTemplates() {
  const container = document.getElementById('templates-container');
  if (appState.templates.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">No quotation templates configured.</div>`;
    return;
  }

  container.innerHTML = appState.templates.map(tmpl => {
    return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between mb-2">
            <div>
              <h3 class="font-bold text-base text-slate-900">${escapeHtml(tmpl.name)}</h3>
              <span class="text-xs text-brand-600 font-semibold">
                ${tmpl.plan ? escapeHtml(tmpl.plan.name) : 'No plan assigned'}
              </span>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
              Valid for ${tmpl.validity_days} Days
            </span>
          </div>

          <p class="text-xs text-slate-500 mb-4">${escapeHtml(tmpl.description || 'No description.')}</p>

          <!-- Preconfigured Lines -->
          <div class="border border-slate-200 rounded-xl p-3 bg-slate-50 mb-4">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Preconfigured Product Lines</span>
            <div class="space-y-1.5 text-xs">
              ${tmpl.lines.map(l => `
                <div class="flex justify-between items-center text-slate-700 bg-white p-2 rounded-lg border border-slate-100">
                  <span class="font-medium">
                    ${l.quantity}x ${escapeHtml(l.product_name)}
                    ${l.variant_name ? `<span class="text-purple-700 font-semibold text-[11px] block">Variant: ${escapeHtml(l.variant_name)}</span>` : ''}
                  </span>
                  <span class="font-bold text-slate-900">$${(l.unit_price * l.quantity).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="border-t border-slate-100 pt-4 flex justify-between items-center">
          <button onclick="startQuoteFromTemplate(${tmpl.id})" class="btn-primary text-xs">
            <i data-lucide="sparkles" class="w-3.5 h-3.5 mr-1 inline"></i>Create Customer Quote
          </button>
          <div class="space-x-1">
            <button onclick="deleteTemplate(${tmpl.id})" class="p-1 text-slate-400 hover:text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openCreateTemplateModal() {
  document.getElementById('form-template').reset();
  document.getElementById('tmpl-id').value = '';
  document.getElementById('modal-template-title').textContent = 'Create Quotation Template';

  // Populate plans dropdown
  const planSelect = document.getElementById('tmpl-plan');
  planSelect.innerHTML = appState.plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.billing_frequency})</option>`).join('');

  // Reset lines
  const linesContainer = document.getElementById('tmpl-lines-container');
  linesContainer.innerHTML = '';
  addTemplateLineRow();

  openModal('modal-template');
}

function addTemplateLineRow(data = {}) {
  const container = document.getElementById('tmpl-lines-container');
  const index = container.children.length;

  const row = document.createElement('div');
  row.className = 'grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200 text-xs';
  row.innerHTML = `
    <div class="col-span-5">
      <select class="form-input text-xs tmpl-line-product" onchange="handleTemplateProductChange(this, ${index})" required>
        <option value="">-- Choose Product --</option>
        ${appState.products.map(p => `<option value="${p.id}" ${data.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)} ($${p.sales_price})</option>`).join('')}
      </select>
    </div>
    <div class="col-span-3">
      <select class="form-input text-xs tmpl-line-variant">
        <option value="">Base / No Variant</option>
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" min="1" value="${data.quantity || 1}" class="form-input text-xs tmpl-line-qty" placeholder="Qty">
    </div>
    <div class="col-span-1">
      <input type="number" step="0.01" value="${data.unit_price || 0}" class="form-input text-xs tmpl-line-price" placeholder="Price">
    </div>
    <div class="col-span-1 text-center">
      <button type="button" onclick="this.closest('.grid').remove()" class="text-rose-500 hover:text-rose-700">✕</button>
    </div>
  `;
  container.appendChild(row);

  if (data.product_id) {
    const prodSelect = row.querySelector('.tmpl-line-product');
    handleTemplateProductChange(prodSelect, index, data.variant_id);
  }
}

function handleTemplateProductChange(selectElem, index, selectedVariantId = null) {
  const prodId = parseInt(selectElem.value, 10);
  const row = selectElem.closest('.grid');
  const varSelect = row.querySelector('.tmpl-line-variant');
  const priceInput = row.querySelector('.tmpl-line-price');

  varSelect.innerHTML = '<option value="">Base Standard</option>';
  const prod = appState.products.find(p => p.id === prodId);
  if (!prod) return;

  priceInput.value = prod.sales_price;

  if (prod.variants && prod.variants.length > 0) {
    prod.variants.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.variant_name} ($${v.calculated_sales_price})`;
      if (selectedVariantId && selectedVariantId === v.id) opt.selected = true;
      varSelect.appendChild(opt);
    });
  }

  varSelect.onchange = () => {
    const vid = parseInt(varSelect.value, 10);
    const variant = prod.variants ? prod.variants.find(v => v.id === vid) : null;
    if (variant) {
      priceInput.value = variant.calculated_sales_price;
    } else {
      priceInput.value = prod.sales_price;
    }
  };
}

async function handleTemplateSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('tmpl-id').value;

  const lines = [];
  document.querySelectorAll('#tmpl-lines-container .grid').forEach(row => {
    const prodId = parseInt(row.querySelector('.tmpl-line-product').value, 10);
    const varId = row.querySelector('.tmpl-line-variant').value ? parseInt(row.querySelector('.tmpl-line-variant').value, 10) : null;
    const qty = parseInt(row.querySelector('.tmpl-line-qty').value || 1, 10);
    const price = parseFloat(row.querySelector('.tmpl-line-price').value || 0);

    if (prodId) {
      lines.push({
        product_id: prodId,
        variant_id: varId,
        quantity: qty,
        unit_price: price,
        discount_percent: 0.0
      });
    }
  });

  const payload = {
    name: document.getElementById('tmpl-name').value,
    plan_id: parseInt(document.getElementById('tmpl-plan').value, 10),
    validity_days: parseInt(document.getElementById('tmpl-validity').value || 30, 10),
    payment_terms: document.getElementById('tmpl-payment-terms').value,
    terms_and_conditions: document.getElementById('tmpl-terms').value,
    active: 1,
    lines
  };

  try {
    const url = id ? `/api/templates/${id}` : '/api/templates';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Quotation template saved');
      closeModal('modal-template');
      await loadAllData();
    } else {
      showToast(data.error || 'Failed to save template', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteTemplate(id) {
  if (!confirm('Are you sure you want to delete this quotation template?')) return;
  try {
    const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Template deleted');
      await loadAllData();
    } else {
      const data = await res.json();
      showToast(data.error || 'Delete failed', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== SALES QUOTATIONS ====================
function filterQuotesByStatus(status) {
  appState.currentQuoteStatusFilter = status;
  document.querySelectorAll('.quote-status-btn').forEach(b => {
    if ((status === '' && b.textContent === 'All') || b.textContent.includes(status)) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  renderQuotations();
}

function renderQuotations() {
  const tbody = document.getElementById('quotations-tbody');
  let filtered = appState.quotations;
  if (appState.currentQuoteStatusFilter) {
    filtered = filtered.filter(q => q.status === appState.currentQuoteStatusFilter);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-8 text-center text-slate-400">No quotations match this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(q => {
    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-6 py-3.5 font-bold text-slate-900">${q.quote_number}</td>
        <td class="px-6 py-3.5">
          <div class="font-semibold text-slate-800">${escapeHtml(q.customer_name)}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(q.customer_email)}</div>
        </td>
        <td class="px-6 py-3.5">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
            ${q.plan ? escapeHtml(q.plan.name) : 'Plan #' + q.plan_id}
          </span>
        </td>
        <td class="px-6 py-3.5 text-xs text-slate-600">
          <div>Expires: <span class="font-medium text-slate-900">${q.expiry_date}</span></div>
          <div class="text-[10px] text-slate-400">(${q.validity_days} days validity)</div>
        </td>
        <td class="px-6 py-3.5 font-semibold text-slate-700">$${q.subtotal.toFixed(2)}</td>
        <td class="px-6 py-3.5 text-emerald-600 font-semibold">
          ${q.discount_amount > 0 ? `-$${q.discount_amount.toFixed(2)}` : '-'}
        </td>
        <td class="px-6 py-3.5 font-extrabold text-slate-900">$${q.total_amount.toFixed(2)}</td>
        <td class="px-6 py-3.5">
          <span class="status-badge badge-${q.status}">${q.status}</span>
        </td>
        <td class="px-6 py-3.5 text-right space-x-2">
          <button onclick="viewQuotationDetails(${q.id})" class="text-xs font-semibold text-brand-600 hover:text-brand-800">
            View / Manage →
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openCreateQuoteModal() {
  document.getElementById('form-quotation').reset();

  const planSelect = document.getElementById('quote-plan');
  planSelect.innerHTML = appState.plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.billing_frequency})</option>`).join('');

  const tmplSelect = document.getElementById('quote-select-template');
  tmplSelect.innerHTML = `<option value="">-- Choose Template (Optional) --</option>` +
    appState.templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.validity_days} days)</option>`).join('');

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('quote-start-date').value = today;
  document.getElementById('quote-validity-days').value = 30;
  updateQuoteCalculatedExpiry();

  document.getElementById('quote-lines-container').innerHTML = '';
  addQuoteLineRow();

  openModal('modal-quotation');
}

function startQuoteFromTemplate(templateId) {
  openCreateQuoteModal();
  document.getElementById('quote-select-template').value = templateId;
  loadTemplateIntoQuoteForm(templateId);
  switchTab('quotations');
}

function loadTemplateIntoQuoteForm(templateId) {
  if (!templateId) return;
  const tmpl = appState.templates.find(t => t.id === parseInt(templateId, 10));
  if (!tmpl) return;

  if (tmpl.plan_id) document.getElementById('quote-plan').value = tmpl.plan_id;
  document.getElementById('quote-validity-days').value = tmpl.validity_days;
  document.getElementById('quote-payment-terms').value = tmpl.payment_terms || 'Net 30';
  updateQuoteCalculatedExpiry();

  // Load lines
  const container = document.getElementById('quote-lines-container');
  container.innerHTML = '';
  tmpl.lines.forEach(l => {
    addQuoteLineRow(l);
  });
}

function updateQuoteCalculatedExpiry() {
  const days = parseInt(document.getElementById('quote-validity-days').value || 30, 10);
  const date = new Date();
  date.setDate(date.getDate() + days);
  document.getElementById('quote-expiry-preview').textContent = `Calculated Expiration: ${date.toISOString().slice(0, 10)}`;
}

function addQuoteLineRow(data = {}) {
  const container = document.getElementById('quote-lines-container');
  const index = container.children.length;

  const row = document.createElement('div');
  row.className = 'grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200 text-xs';
  row.innerHTML = `
    <div class="col-span-5">
      <select class="form-input text-xs quote-line-product" onchange="handleQuoteProductChange(this, ${index})" required>
        <option value="">-- Choose Product --</option>
        ${appState.products.map(p => `<option value="${p.id}" ${data.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="col-span-3">
      <select class="form-input text-xs quote-line-variant">
        <option value="">Base / Standard</option>
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" min="1" value="${data.quantity || 1}" class="form-input text-xs quote-line-qty" placeholder="Qty">
    </div>
    <div class="col-span-1">
      <input type="number" step="0.01" value="${data.unit_price || 0}" class="form-input text-xs quote-line-price" placeholder="Price">
    </div>
    <div class="col-span-1 text-center">
      <button type="button" onclick="this.closest('.grid').remove()" class="text-rose-500 hover:text-rose-700">✕</button>
    </div>
  `;
  container.appendChild(row);

  if (data.product_id) {
    const prodSelect = row.querySelector('.quote-line-product');
    handleQuoteProductChange(prodSelect, index, data.variant_id);
  }
}

function handleQuoteProductChange(selectElem, index, selectedVariantId = null) {
  const prodId = parseInt(selectElem.value, 10);
  const row = selectElem.closest('.grid');
  const varSelect = row.querySelector('.quote-line-variant');
  const priceInput = row.querySelector('.quote-line-price');

  varSelect.innerHTML = '<option value="">Base Standard</option>';
  const prod = appState.products.find(p => p.id === prodId);
  if (!prod) return;

  priceInput.value = prod.sales_price;

  if (prod.variants && prod.variants.length > 0) {
    prod.variants.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.variant_name} ($${v.calculated_sales_price})`;
      if (selectedVariantId && selectedVariantId === v.id) opt.selected = true;
      varSelect.appendChild(opt);
    });
  }

  varSelect.onchange = () => {
    const vid = parseInt(varSelect.value, 10);
    const variant = prod.variants ? prod.variants.find(v => v.id === vid) : null;
    if (variant) {
      priceInput.value = variant.calculated_sales_price;
    } else {
      priceInput.value = prod.sales_price;
    }
  };
}

async function validateQuoteDiscountCode() {
  const code = document.getElementById('quote-discount-code').value.trim();
  const feedback = document.getElementById('quote-discount-feedback');
  if (!code) {
    feedback.textContent = 'Please enter a code';
    feedback.className = 'text-[11px] text-slate-400 mt-1 block';
    return;
  }

  // Collect items
  const items = [];
  document.querySelectorAll('#quote-lines-container .grid').forEach(row => {
    const pid = parseInt(row.querySelector('.quote-line-product').value, 10);
    const qty = parseInt(row.querySelector('.quote-line-qty').value || 1, 10);
    const price = parseFloat(row.querySelector('.quote-line-price').value || 0);
    if (pid) items.push({ product_id: pid, quantity: qty, unit_price: price });
  });

  try {
    const res = await fetch('/api/discounts/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountIdOrCode: code, items })
    });
    const result = await res.json();

    if (result.valid) {
      feedback.textContent = `✅ Discount Valid: $${result.discount_amount.toFixed(2)} off (${result.discount.name})`;
      feedback.className = 'text-[11px] text-emerald-600 font-bold mt-1 block';
    } else {
      feedback.textContent = `❌ ${result.reason}`;
      feedback.className = 'text-[11px] text-rose-600 font-semibold mt-1 block';
    }
  } catch (err) {
    feedback.textContent = err.message;
    feedback.className = 'text-[11px] text-rose-600 mt-1 block';
  }
}

async function handleQuotationSubmit(e) {
  e.preventDefault();

  const lines = [];
  document.querySelectorAll('#quote-lines-container .grid').forEach(row => {
    const prodId = parseInt(row.querySelector('.quote-line-product').value, 10);
    const varId = row.querySelector('.quote-line-variant').value ? parseInt(row.querySelector('.quote-line-variant').value, 10) : null;
    const qty = parseInt(row.querySelector('.quote-line-qty').value || 1, 10);
    const price = parseFloat(row.querySelector('.quote-line-price').value || 0);

    if (prodId) {
      lines.push({
        product_id: prodId,
        variant_id: varId,
        quantity: qty,
        unit_price: price,
        discount_percent: 0.0,
        tax_percent: 10.0
      });
    }
  });

  const tmplId = document.getElementById('quote-select-template').value;
  const payload = {
    template_id: tmplId ? parseInt(tmplId, 10) : null,
    customer_name: document.getElementById('quote-cust-name').value,
    customer_email: document.getElementById('quote-cust-email').value,
    plan_id: parseInt(document.getElementById('quote-plan').value, 10),
    start_date: document.getElementById('quote-start-date').value,
    validity_days: parseInt(document.getElementById('quote-validity-days').value || 30, 10),
    payment_terms: document.getElementById('quote-payment-terms').value,
    discount_code: document.getElementById('quote-discount-code').value.trim() || null,
    tax_rate: 10.0,
    lines
  };

  try {
    const res = await fetch('/api/quotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Quotation ${data.quote_number} generated!`);
      closeModal('modal-quotation');
      await loadAllData();
      viewQuotationDetails(data.id);
    } else {
      showToast(data.error || 'Failed to create quotation', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// View & Manage Quotation Modal
function viewQuotationDetails(id) {
  const quote = appState.quotations.find(q => q.id === id);
  if (!quote) return;

  document.getElementById('vq-quote-number').textContent = quote.quote_number;
  const badge = document.getElementById('vq-status-badge');
  badge.textContent = quote.status;
  badge.className = `status-badge badge-${quote.status}`;

  document.getElementById('vq-customer').textContent = quote.customer_name;
  document.getElementById('vq-email').textContent = quote.customer_email;
  document.getElementById('vq-dates').textContent = `Created: ${quote.created_date} | Expiry: ${quote.expiry_date} (${quote.validity_days}d)`;
  document.getElementById('vq-terms').textContent = `Payment Terms: ${quote.payment_terms || 'Net 30'}`;

  document.getElementById('vq-plan-name').textContent = quote.plan ? quote.plan.name : `Plan #${quote.plan_id}`;
  document.getElementById('vq-plan-cadence').textContent = quote.plan
    ? `Billed ${quote.plan.billing_frequency.toUpperCase()} | Base fee: $${quote.plan.base_fee.toFixed(2)}`
    : '';

  // Lines
  const tbody = document.getElementById('vq-lines-tbody');
  tbody.innerHTML = quote.lines.map(l => `
    <tr class="hover:bg-slate-50">
      <td class="py-2.5">
        <div class="font-bold text-slate-800">${escapeHtml(l.description)}</div>
        <div class="text-[10px] text-slate-400">SKU: ${l.variant_sku || l.product_code}</div>
      </td>
      <td class="py-2.5 text-center font-semibold">${l.quantity}</td>
      <td class="py-2.5 text-right font-medium">$${l.unit_price.toFixed(2)}</td>
      <td class="py-2.5 text-right text-slate-500">${l.discount_percent}%</td>
      <td class="py-2.5 text-right font-bold text-slate-900">$${l.subtotal.toFixed(2)}</td>
    </tr>
  `).join('');

  // Totals
  document.getElementById('vq-subtotal').textContent = `$${quote.subtotal.toFixed(2)}`;
  if (quote.discount_amount > 0) {
    document.getElementById('vq-discount-row').classList.remove('hidden');
    document.getElementById('vq-discount-label').textContent = `Discount (${quote.discount_code || 'Promo'}):`;
    document.getElementById('vq-discount-amount').textContent = `-$${quote.discount_amount.toFixed(2)}`;
  } else {
    document.getElementById('vq-discount-row').classList.add('hidden');
  }

  document.getElementById('vq-tax-label').textContent = `Tax (${quote.tax_rate}%):`;
  document.getElementById('vq-tax-amount').textContent = `$${quote.tax_amount.toFixed(2)}`;
  document.getElementById('vq-total-amount').textContent = `$${quote.total_amount.toFixed(2)}`;

  // Lifecycle buttons based on status: Draft -> Quotation -> Confirmed -> Active -> Closed
  const actionsContainer = document.getElementById('vq-status-actions');
  actionsContainer.innerHTML = '';

  if (quote.status === 'Draft') {
    actionsContainer.innerHTML = `
      <button onclick="transitionQuoteStatus(${quote.id}, 'Quotation')" class="btn-primary text-xs">
        <i data-lucide="send" class="w-3.5 h-3.5 mr-1 inline"></i>Mark as Quotation Sent
      </button>
    `;
  } else if (quote.status === 'Quotation') {
    actionsContainer.innerHTML = `
      <button onclick="transitionQuoteStatus(${quote.id}, 'Confirmed')" class="btn-primary text-xs bg-purple-600 hover:bg-purple-700">
        <i data-lucide="check" class="w-3.5 h-3.5 mr-1 inline"></i>Customer Confirm
      </button>
    `;
  } else if (quote.status === 'Confirmed') {
    actionsContainer.innerHTML = `
      <button onclick="transitionQuoteStatus(${quote.id}, 'Active')" class="btn-primary text-xs bg-emerald-600 hover:bg-emerald-700">
        <i data-lucide="play-circle" class="w-3.5 h-3.5 mr-1 inline"></i>Activate Subscription
      </button>
    `;
  } else if (quote.status === 'Active') {
    actionsContainer.innerHTML = `
      <button onclick="transitionQuoteStatus(${quote.id}, 'Closed')" class="btn-secondary text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
        <i data-lucide="x-circle" class="w-3.5 h-3.5 mr-1 inline"></i>Close Subscription
      </button>
    `;
  } else if (quote.status === 'Closed') {
    actionsContainer.innerHTML = `<span class="text-xs text-slate-400 font-semibold">Subscription Terminated</span>`;
  }

  if (window.lucide) lucide.createIcons();
  openModal('modal-view-quote');
}

async function transitionQuoteStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/quotations/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Status updated to ${newStatus}`);
      await loadAllData();
      viewQuotationDetails(id);
    } else {
      alert(`⚠️ Action Prohibited: ${data.error}`);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== ADMIN DISCOUNT ENGINE ====================
function renderDiscounts() {
  const container = document.getElementById('discounts-container');
  const simSelect = document.getElementById('sim-discount-select');

  // Populate simulator select
  simSelect.innerHTML = appState.discounts.map(d => `<option value="${d.id}">${escapeHtml(d.code)} - ${d.type === 'percentage' ? d.value + '%' : '$' + d.value} (${escapeHtml(d.name)})</option>`).join('');

  if (appState.discounts.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">No discount rules configured.</div>`;
    return;
  }

  container.innerHTML = appState.discounts.map(d => {
    const isExpired = d.end_date && new Date().toISOString().slice(0, 10) > d.end_date;
    const isCapReached = d.usage_limit !== null && d.used_count >= d.usage_limit;
    const usagePercent = d.usage_limit ? Math.min(100, Math.round((d.used_count / d.usage_limit) * 100)) : 0;

    return `
      <div class="bg-white rounded-xl border ${isCapReached || isExpired ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'} shadow-sm p-6 flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between mb-2">
            <div>
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                ${d.code}
              </span>
              <h3 class="font-bold text-base text-slate-900 mt-1">${escapeHtml(d.name)}</h3>
            </div>
            <span class="px-2 py-0.5 rounded text-xs font-black ${
              d.type === 'percentage' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }">
              ${d.type === 'percentage' ? `${d.value}% OFF` : `$${d.value.toFixed(2)} OFF`}
            </span>
          </div>

          <p class="text-xs text-slate-500 mb-4">${escapeHtml(d.notes || 'No description.')}</p>

          <div class="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-2 mb-4 text-xs">
            <div class="flex justify-between text-slate-600">
              <span>Scope:</span>
              <span class="font-bold text-slate-800">
                ${d.scope === 'whole_subscription' ? 'Whole Subscription' : 'Specific Products'}
              </span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Min Purchase:</span>
              <span class="font-medium text-slate-800">$${d.min_purchase_amount.toFixed(2)}</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Min Seats:</span>
              <span class="font-medium text-slate-800">${d.min_quantity} seat(s)</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Validity:</span>
              <span class="font-medium ${isExpired ? 'text-rose-600 font-bold' : 'text-slate-800'}">
                ${d.start_date || 'Evergreen'} to ${d.end_date || 'Forever'} ${isExpired ? '(EXPIRED)' : ''}
              </span>
            </div>

            <!-- Usage Cap Progress Bar -->
            <div class="pt-2 border-t border-slate-200">
              <div class="flex justify-between text-[11px] mb-1">
                <span class="text-slate-500 font-medium">Usage Cap:</span>
                <span class="font-bold ${isCapReached ? 'text-rose-600' : 'text-slate-700'}">
                  ${d.used_count} / ${d.usage_limit !== null ? d.usage_limit : '∞'} used
                </span>
              </div>
              ${d.usage_limit !== null ? `
                <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div class="h-1.5 rounded-full ${isCapReached ? 'bg-rose-500' : 'bg-brand-600'}" style="width: ${usagePercent}%"></div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="border-t border-slate-100 pt-3 flex justify-between items-center">
          <span class="text-[11px] font-semibold ${d.active && !isExpired && !isCapReached ? 'text-emerald-600' : 'text-amber-700'}">
            ● ${d.active && !isExpired && !isCapReached ? 'Active & Ready' : (isCapReached ? 'Cap Exhausted' : 'Inactive / Expired')}
          </span>
          <div class="space-x-1">
            <button onclick="deleteDiscount(${d.id})" class="p-1 text-slate-400 hover:text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openCreateDiscountModal() {
  document.getElementById('form-discount').reset();
  document.getElementById('disc-id').value = '';
  document.getElementById('modal-discount-title').textContent = 'Create Admin Discount Rule';

  // Populate specific products checkboxes
  const cbContainer = document.getElementById('disc-products-checkboxes');
  cbContainer.innerHTML = appState.products.map(p => `
    <label class="flex items-center space-x-2 text-xs text-slate-700">
      <input type="checkbox" value="${p.id}" class="rounded text-brand-600 disc-prod-cb">
      <span>${escapeHtml(p.name)} ($${p.sales_price})</span>
    </label>
  `).join('');

  toggleDiscountProductsSelector('whole_subscription');
  openModal('modal-discount');
}

function toggleDiscountProductsSelector(scope) {
  const box = document.getElementById('disc-products-selector-box');
  if (scope === 'specific_products') {
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

async function handleDiscountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('disc-id').value;
  const scope = document.getElementById('disc-scope').value;

  const product_ids = [];
  if (scope === 'specific_products') {
    document.querySelectorAll('.disc-prod-cb:checked').forEach(cb => {
      product_ids.push(parseInt(cb.value, 10));
    });
  }

  const payload = {
    code: document.getElementById('disc-code').value.trim().toUpperCase(),
    name: document.getElementById('disc-name').value,
    type: document.getElementById('disc-type').value,
    value: parseFloat(document.getElementById('disc-value').value),
    scope,
    min_purchase_amount: parseFloat(document.getElementById('disc-min-purchase').value || 0),
    min_quantity: parseInt(document.getElementById('disc-min-qty').value || 1, 10),
    usage_limit: document.getElementById('disc-usage-limit').value ? parseInt(document.getElementById('disc-usage-limit').value, 10) : null,
    start_date: document.getElementById('disc-start-date').value || null,
    end_date: document.getElementById('disc-end-date').value || null,
    active: 1,
    product_ids
  };

  try {
    const url = id ? `/api/discounts/${id}` : '/api/discounts';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Discount rule created');
      closeModal('modal-discount');
      await loadAllData();
    } else {
      showToast(data.error || 'Failed to save discount', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteDiscount(id) {
  if (!confirm('Are you sure you want to delete this discount rule?')) return;
  try {
    const res = await fetch(`/api/discounts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Discount rule deleted');
      await loadAllData();
    } else {
      const data = await res.json();
      showToast(data.error || 'Delete failed', true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// Live Discount Simulator Runner
async function runDiscountSimulation() {
  const discountId = document.getElementById('sim-discount-select').value;
  const qty = parseInt(document.getElementById('sim-quantity').value || 1, 10);
  const resultBox = document.getElementById('sim-result-box');

  const discount = appState.discounts.find(d => d.id === parseInt(discountId, 10));
  if (!discount) return;

  // Build simulated cart: take first software product or fallback
  const testProd = appState.products[0] || { id: 1, sales_price: 1000 };
  const items = [{ product_id: testProd.id, quantity: qty, unit_price: testProd.sales_price }];

  try {
    const res = await fetch('/api/discounts/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discountIdOrCode: discount.id,
        items
      })
    });
    const data = await res.json();
    resultBox.classList.remove('hidden');

    if (data.valid) {
      resultBox.className = 'mt-4 p-4 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-950 text-xs space-y-2';
      resultBox.innerHTML = `
        <div class="flex items-center space-x-2 font-bold text-emerald-800">
          <i data-lucide="check-circle" class="w-4 h-4"></i>
          <span>Discount Applied Successfully!</span>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-200">
          <div>Order Subtotal: <strong>$${data.total_order_amount.toFixed(2)}</strong> (${data.total_quantity} seats)</div>
          <div>Eligible Amount: <strong>$${data.eligible_amount.toFixed(2)}</strong></div>
          <div class="col-span-2 text-emerald-900 font-extrabold text-sm">
            Instant Savings: -$${data.discount_amount.toFixed(2)} (Net payable: $${(data.total_order_amount - data.discount_amount).toFixed(2)})
          </div>
        </div>
      `;
    } else {
      resultBox.className = 'mt-4 p-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-950 text-xs space-y-2';
      resultBox.innerHTML = `
        <div class="flex items-center space-x-2 font-bold text-rose-800">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i>
          <span>Discount Evaluation Failed:</span>
        </div>
        <p class="font-medium text-rose-900">${escapeHtml(data.reason)}</p>
      `;
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Modal helpers
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setupEventListeners() {
  // Close modals on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    }
  });
}
