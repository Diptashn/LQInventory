// app.js - Shared client-side logic for LilQuin Kitchen static site
// Includes JWT auth guards: unauthenticated users are redirected to login.html

// ── auth helpers ─────────────────────────────────────────────────────────
const API_BASE = window.APP_API_BASE || (location.hostname === 'localhost' ? 'http://localhost:8080/api' : 'https://lq-inventory.vercel.app/api');

function getToken()  { return localStorage.getItem('auth_token'); }
function setToken(t) { if (t) localStorage.setItem('auth_token', t); else localStorage.removeItem('auth_token'); }

function authFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  return fetch(url, { ...opts, headers });
}

// Redirect to login if no valid token (skip on login page itself)
function requireAuthOrRedirect() {
  if (location.pathname.endsWith('login.html')) return;
  const tok = getToken();
  if (!tok) { location.href = 'login.html'; return false; }
  return true;
}

// ── Inventory Service using NeonDB API ───────────────────────────────────
const InventoryService = {
  async getAll() {
    const res = await authFetch(`${API_BASE}/items`);
    if (!res.ok) throw new Error(`GET /items ${res.status}`);
    const data = await res.json();
    return data.data || [];
  },

  async add(item) {
    const res = await authFetch(`${API_BASE}/items`, {
      method: 'POST',
      body: JSON.stringify(item)
    });
    if (!res.ok) {
      let msg = `POST /items ${res.status}`;
      try { const d = await res.json(); if (d.error) msg += `: ${d.error}`; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  },

  async remove(id) {
    const res = await authFetch(`${API_BASE}/items?id=${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /items ${res.status}`);
  },

  async update(id, updates) {
    // GET current item first, then PUT with merged data
    const res = await authFetch(`${API_BASE}/items?id=${id}`);
    if (!res.ok) throw new Error(`GET /items ${res.status}`);
    const current = await res.json();
    const merged = { ...current, ...updates };
    const putRes = await authFetch(`${API_BASE}/items?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(merged)
    });
    if (!putRes.ok) throw new Error(`PUT /items ${putRes.status}`);
    return putRes.json();
  }
};

// ── formatting / cost helpers ───────────────────────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}
function hargaPerGram(hargaKg) { return (hargaKg / 1000).toFixed(2); }

// ── Inventory page ───────────────────────────────────────────────────────
if (location.pathname.endsWith('inventory.html') || location.pathname === '/' || (location.pathname.endsWith('.html') === false && location.pathname.includes('inventory'))) {
  document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuthOrRedirect()) return;

    const form      = document.getElementById('add-form');
    const itemsBody = document.getElementById('items-body');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search');

    async function renderItems(filter = '') {
      const all = await InventoryService.getAll();
      const items = all.filter(i => (i.product_name || i.name || '').toLowerCase().includes(filter.toLowerCase()));
      if (!items.length) { emptyState.classList.remove('hidden'); itemsBody.innerHTML = ''; return; }
      emptyState.classList.add('hidden');
      itemsBody.innerHTML = items.map(item => {
        const name  = item.product_name || item.name;
        const qty   = Number(item.quantity ?? item.qty) || 0;
        const cost  = Number(item.unit_cost) || 0;
        const itemId = item.id;
        return `
        <tr>
          <td class="p-3"><strong>${escapeHtml(name)}</strong></td>
          <td class="p-3 text-right">${qty.toFixed(2)} g</td>
          <td class="p-3 text-right">Rp ${formatCurrency(cost)}</td>
          <td class="p-3 text-right">Rp ${formatCurrency(cost / 1000)}</td>
          <td class="p-3 text-sm text-stone-500">${new Date(item.created_at || item.updated_at || Date.now()).toLocaleDateString('id-ID')}</td>
          <td class="p-3 text-center space-x-2">
            <button class="edit-btn px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600" data-id="${itemId}">Edit</button>
            <button class="delete-btn px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600" data-id="${itemId}">Hapus</button>
          </td>
        </tr>`;
      }).join('');

      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          if (!confirm('Hapus bahan ini?')) return;
          try {
            await InventoryService.remove(id);
            await renderItems(searchInput.value);
          } catch (err) { alert('Gagal hapus: ' + err.message); }
        });
      });

      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.dataset.id;
          const item = all.find(i => String(i.id) === String(id));
          if (!item) return;
          const name = item.product_name || item.name;
          const qty  = Number(item.quantity ?? item.qty) || 0;
          const cost = Number(item.unit_cost) || 0;

          const rawName = prompt('Nama bahan:', name);
          if (rawName === null) return;                    // user cancelled
          const newQty  = prompt('Qty (grams):', qty);
          if (newQty === null) return;
          const newCost = prompt('Harga /kg (Rp):', cost);
          if (newCost === null) return;

          const normName = sentenceCase(rawName);
          const nq = parseFloat(newQty), nc = parseFloat(newCost);
          if (!normName || isNaN(nq) || isNaN(nc)) { alert('Input tidak valid'); return; }

          try {
            await InventoryService.update(id, { product_name: normName, quantity: nq, unit_cost: nc });
            await renderItems(searchInput.value);
          } catch (err) { alert('Gagal update: ' + err.message); }
        });
      });
    }

    form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = form.name.value.trim();
          const normName = sentenceCase(name);
          const qty = parseFloat(form.qty.value);
          const unit_cost = parseFloat(form.unit_cost.value);
          if (!name || isNaN(qty) || isNaN(unit_cost) || qty <= 0 || unit_cost <= 0) {
            alert('Mohon isi semua field dengan nilai yang valid');
            return;
          }

          const submitBtn = form.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          try {
            // Case-insensitive dedupe happens server-side via ON CONFLICT lower(product_name)
            await InventoryService.add({
              entry_date: new Date().toISOString().split('T')[0],
              product_name: normName,
              quantity: qty,
              unit_cost,
              notes: '',
            });
            form.reset();
            await renderItems(searchInput.value);
          } catch (err) {
            alert('Gagal menyimpan: ' + err.message);
          } finally {
            submitBtn.disabled = false;
          }
        });

        searchInput.addEventListener('input', async (e) => await renderItems(e.target.value));
        await renderItems('');
  });
}

// ── Estimate page ────────────────────────────────────────────────────────
if (location.pathname.endsWith('estimate.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    if (!requireAuthOrRedirect()) return;

    const form = document.getElementById('estimate-form');
    const monthEl = document.getElementById('month');
    const productTabEl = document.getElementById('product_tab');
    const itemSelectEl = document.getElementById('item_select');
    const qtyEl = document.getElementById('qty');
    const resultEl = document.getElementById('estimate-result');
    const resultContentEl = document.getElementById('result-content');

    // Load inventory items from Neon into the item dropdown (async — getAll hits the API)
    async function loadItems() {
      try {
        const items = await InventoryService.getAll();
        itemSelectEl.innerHTML = '<option value="">Pilih item (stok dari Inventory)</option>' +
          items.map(i => {
            const name = i.product_name || i.name || '';
            const qty  = Number(i.quantity ?? i.qty) || 0;
            const cost = Number(i.unit_cost) || 0;
            return `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${qty.toFixed ? qty.toFixed(2) : qty} g, Rp ${formatCurrency(cost)}/kg)</option>`;
          }).join('');
      } catch (err) {
        itemSelectEl.innerHTML = '<option value="">Gagal memuat item</option>';
        console.error('[estimate] loadItems failed:', err);
      }
    }

    // Load items on page load
    loadItems();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const month = monthEl.value;
      const product_tab = productTabEl.value;
      const item = itemSelectEl.value;
      const qty = parseFloat(qtyEl.value);

      if (!month || !product_tab || !item || isNaN(qty) || qty <= 0) {
        alert('Mohon isi semua field dengan benar');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengirim…';

      try {
        const resp = await authFetch(`${API_BASE}/estimate`, {
          method: 'POST',
          body: JSON.stringify({ month, product_tab, item, qty }),
        });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Submit failed');

        resultContentEl.textContent = `✓ ${data.message}\nItem: ${data.row[2]}\nBulan: ${data.row[1]}\nProduk: ${data.row[0]}\nQty: ${data.row[3]} g`;
        resultEl.classList.remove('hidden');
        form.reset();
      } catch (err) {
        resultContentEl.textContent = `✗ Error: ${err.message}`;
        resultEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Estimate';
      }
    });
  });
}

// ── Sheets sync page ─────────────────────────────────────────────────────
if (location.pathname.endsWith('sheets.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    if (!requireAuthOrRedirect()) return;

    const tokenStatusEl = document.getElementById('token-status');
    const syncStatusEl  = document.getElementById('sync-status');

    // --- token/health check ---
    authFetch(`${API_BASE}/items`)
      .then(r => r.json())
      .then(data => {
        if (typeof data.count === 'number') tokenStatusEl.textContent = 'OK';
        else { tokenStatusEl.textContent = 'Invalid'; syncStatusEl.textContent = data.error || 'auth required'; }
      })
      .catch(() => { tokenStatusEl.textContent = 'Error'; syncStatusEl.textContent = 'Connection failed'; });

    // --- Export Neon → Google Sheets (one‑click) ---
    document.getElementById('export-to-sheets').addEventListener('click', async () => {
      syncStatusEl.textContent = 'Exporting Neon to Sheet…';
      try {
        const resp = await authFetch(`${API_BASE}/export-to-sheet`, { method: 'GET' });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Export failed');
        syncStatusEl.textContent = `Exported ${json.rows} rows to Google Sheet`;
      } catch (err) {
        syncStatusEl.textContent = `Export error: ${err.message}`;
      }
    });

    // --- logout ---
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
      setToken(null);
      location.href = 'login.html';
    });
  });
}

// ── global logout (any page with #logoutBtn) ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
      setToken(null);
      location.href = 'login.html';
    });
  }
});

// ── utils ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const map = { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Sentence-case: "VANILLA SUGAR" -> "Vanilla sugar"
// Also used to normalize duplicates (case-insensitive).
function sentenceCase(str) {
  const s = String(str || '').trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
