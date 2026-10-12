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
    const data = await res.json();
    return data.data || [];
  },

  async add(item) {
    const res = await authFetch(`${API_BASE}/items`, {
      method: 'POST',
      body: JSON.stringify(item)
    });
    return res.json();
  },

  async remove(id) {
    await authFetch(`${API_BASE}/items?id=${id}`, { method: 'DELETE' });
  },

  async update(id, updates) {
    // GET current item first, then PUT with merged data
    const res = await authFetch(`${API_BASE}/items?id=${id}`);
    const current = await res.json();
    const merged = { ...current, ...updates };
    const putRes = await authFetch(`${API_BASE}/items?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(merged)
    });
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
  document.addEventListener('DOMContentLoaded', () => {
    if (!requireAuthOrRedirect()) return;

    const form      = document.getElementById('add-form');
    const itemsBody = document.getElementById('items-body');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search');

    function renderItems(filter = '') {
      const items = InventoryService.getAll().filter(i => i.name.toLowerCase().includes(filter.toLowerCase()));
      if (!items.length) { emptyState.classList.remove('hidden'); itemsBody.innerHTML = ''; return; }
      emptyState.classList.add('hidden');
      itemsBody.innerHTML = items.map(item => `
        <tr>
          <td class="p-3"><strong>${escapeHtml(item.name)}</strong></td>
          <td class="p-3 text-right">${item.qty.toFixed(2)} g</td>
          <td class="p-3 text-right">Rp ${formatCurrency(item.unit_cost)}</td>
          <td class="p-3 text-right">Rp ${formatCurrency(parseFloat(item.unit_cost) / 1000)}</td>
          <td class="p-3 text-sm text-stone-500">${new Date(item.updated_at || Date.now()).toLocaleDateString('id-ID')}</td>
          <td class="p-3 text-center space-x-2">
            <button class="edit-btn px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600" data-id="${item.id}">Edit</button>
            <button class="delete-btn px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600" data-id="${item.id}">Hapus</button>
          </td>
        </tr>`).join('');

      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idStr = e.target.dataset.id;
          // id in localStorage is numeric; dataset.id is string → loose compare
          if (confirm('Hapus bahan ini?')) { InventoryService.remove(Number(idStr)); renderItems(searchInput.value); }
        });
      });
      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.dataset.id;
          const item = InventoryService.getAll().find(i => String(i.id) === String(id));
          if (!item) return;
          const rawName = prompt('Nama bahan:', item.name) || item.name;
          const name = sentenceCase(rawName);
          const qty  = parseFloat(prompt('Qty (grams):', item.qty)) || item.qty;
          const unit_cost = parseFloat(prompt('Harga /kg (Rp):', item.unit_cost)) || item.unit_cost;
          if (name !== null && !isNaN(qty) && !isNaN(unit_cost)) {
            InventoryService.update(id, { name, qty: parseFloat(qty), unit_cost: parseFloat(unit_cost) });
            renderItems(searchInput.value);
          }
        });
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const normName = sentenceCase(name);
      const qty = parseFloat(form.qty.value);
      const unit_cost = parseFloat(form.unit_cost.value);
      if (name && !isNaN(qty) && !isNaN(unit_cost) && qty > 0 && unit_cost > 0) {
        // Case-insensitive duplicate check: update the existing row instead of adding a new one
        const existing = InventoryService.getAll().find(i => i.name.toLowerCase() === normName.toLowerCase());
        if (existing) {
          InventoryService.update(existing.id, { name: normName, qty, unit_cost, updated_at: new Date().toISOString() });
        } else {
          InventoryService.add({ name: normName, qty, unit_cost, updated_at: new Date().toISOString() });
        }
        form.reset();
        renderItems(searchInput.value);
      } else { alert('Mohon isi semua field dengan nilai yang valid'); }
    });

    searchInput.addEventListener('input', (e) => renderItems(e.target.value));
    renderItems('');
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

    // Load inventory items into item dropdown
    function loadItems() {
      const items = InventoryService.getAll();
      itemSelectEl.innerHTML = '<option value="">Pilih item (stok dari Inventory)</option>' +
        items.map(i => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)} (${i.qty} g, Rp ${formatCurrency(i.unit_cost)}/kg)</option>`).join('');
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

    // --- PULL: Google Sheet → localStorage → Neon ---
    document.getElementById('sync-s2db').addEventListener('click', async () => {
      syncStatusEl.textContent = 'Pulling from Google Sheet…';
      try {
        // Step 1: fetch data from Google Sheet (server-side, needs Google creds)
        const sheetResp = await authFetch(`${API_BASE}/export-to-sheet?read=true`, { method: 'GET' });
        const sheetJson = await sheetResp.json();
        if (!sheetJson.success) { syncStatusEl.textContent = `Sheet read error: ${sheetJson.error || 'unknown'}`; return; }

        const items = sheetJson.rows;
        InventoryService.saveAll(items);

        // Step 2: push each sheet row to Neon so both sides match
        let pushed = 0;
        for (const item of items) {
          try {
            const resp = await authFetch(`${API_BASE}/items`, {
              method: 'POST',
              body: JSON.stringify({
                entry_date: new Date().toISOString().split('T')[0],
                product_name: item.name,
                quantity: Number(item.qty) || 0,
                unit_cost: Number(item.unit_cost) || 0,
                notes: item.notes || '',
              }),
            });
            if (resp.ok) pushed++;
          } catch { /* keep going */ }
        }

        syncStatusEl.textContent = `Pulled ${items.length} rows from Sheet, synced ${pushed} to Neon.`;
      } catch (err) { syncStatusEl.textContent = `Error: ${err.message}`; }
    });

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
