// app.js - Shared client-side logic for LilQuin Kitchen static site

// Inventory Service using localStorage
const InventoryService = {
  STORAGE_KEY: 'lilquin-inventory',

  getAll() {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  saveAll(items) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items));
  },

  add(item) {
    const items = this.getAll();
    const newItem = {
      id: Date.now() + Math.floor(Math.random() * 10000), // simple unique ID
      ...item,
    };
    items.push(newItem);
    this.saveAll(items);
    return newItem;
  },

  remove(id) {
    const items = this.getAll().filter(item => item.id !== id);
    this.saveAll(items);
  },

  update(id, updates) {
    const items = this.getAll().map(item => {
      if (item.id === id) {
        return { ...item, ...updates };
      }
      return item;
    });
    this.saveAll(items);
  },
};

// Helper to format currency (Indonesian Rupiah)
function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Helper to calculate harga/gram from harga/kg
function hargaPerGram(hargaKg) {
  return (hargaKg / 1000).toFixed(2);
}

// Page-specific logic
if (window.location.pathname.endsWith('inventory.html') || window.location.pathname === '/' && window.location.pathname.includes('inventory')) {
  // Inventory page logic
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('add-form');
    const itemsBody = document.getElementById('items-body');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search');

    // Render items from inventory service
    function renderItems(filter = '') {
      const items = InventoryService.getAll()
        .filter(item =>
          item.name.toLowerCase().includes(filter.toLowerCase())
        );

      if (items.length === 0) {
        emptyState.classList.remove('hidden');
        itemsBody.innerHTML = '';
        return;
      }

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
        </tr>
      `).join('');

      // Attach event listeners to buttons
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          // IDs may be numeric (local) or UUID strings (pulled from Neon) —
          // do NOT parseInt, that yields NaN for UUIDs.
          const id = e.target.dataset.id;
          if (confirm('Hapus bahan ini?')) {
            InventoryService.remove(id);
            renderItems(searchInput.value);
          }
        });
      });

      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.dataset.id;
          const item = InventoryService.getAll().find(i => String(i.id) === String(id));
          if (!item) return;

          // Prompt for new values (simple prompt for demo)
          const name = prompt('Nama bahan:', item.name) || item.name;
          const qty = parseFloat(prompt('Qty (grams):', item.qty)) || item.qty;
          const unit_cost = parseFloat(prompt('Harga /kg (Rp):', item.unit_cost)) || item.unit_cost;

          if (name !== null && !isNaN(qty) && !isNaN(unit_cost)) {
            InventoryService.update(id, { name, qty: parseFloat(qty), unit_cost: parseFloat(unit_cost) });
            renderItems(searchInput.value);
          }
        });
      });
    }

    // Handle form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const qty = parseFloat(form.qty.value);
      const unit_cost = parseFloat(form.unit_cost.value);

      if (name && !isNaN(qty) && !isNaN(unit_cost) && qty > 0 && unit_cost > 0) {
        InventoryService.add({ name, qty, unit_cost, updated_at: new Date().toISOString() });
        form.reset();
        renderItems(searchInput.value);
      } else {
        alert('Mohon isi semua field dengan nilai yang valid');
      }
    });

    // Handle search
    searchInput.addEventListener('input', (e) => {
      renderItems(e.target.value);
    });

    // Initial render
    renderItems('');
  });
}

// Placeholder for estimate.html logic
if (window.location.pathname.endsWith('estimate.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    // TODO: Implement estimate logic using localStorage or API
    console.log('Estimate page loaded');
  });
}

// Sheets sync logic
if (window.location.pathname.endsWith('sheets.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    // Vercel API base – replace the dead Apps Script URL
    const API_BASE = "https://lq-inventory.vercel.app/api";

    const tokenStatusEl = document.getElementById('token-status');
    const syncStatusEl = document.getElementById('sync-status');

    // --- connection check: a plain GET /api/items is our health probe now ---
    fetch(`${API_BASE}/items`)
      .then(r => r.json())
      .then(data => {
        if (typeof data.count === 'number') {
          tokenStatusEl.textContent = 'OK';
        } else {
          tokenStatusEl.textContent = 'Invalid';
        }
      })
      .catch(() => { tokenStatusEl.textContent = 'Error'; });

    // --- PULL: Neon -> localStorage ---
    document.getElementById('sync-s2db').addEventListener('click', async () => {
      syncStatusEl.textContent = 'Pulling…';
      try {
        const resp = await fetch(`${API_BASE}/items`);
        const json = await resp.json();
        if (!json.data) {
          syncStatusEl.textContent = `Error: ${json.error || 'unknown'}`;
          return;
        }
        // Map DB column names -> localStorage item shape
        const mapped = json.data.map(row => ({
          id: row.id,
          name: row.product_name,
          qty: Number(row.quantity),
          unit_cost: Number(row.unit_cost),
          updated_at: row.created_at || row.entry_date,
        }));
        InventoryService.saveAll(mapped);
        syncStatusEl.textContent = `Pulled ${mapped.length} rows (${json.count} from server)`;
      } catch (err) {
        syncStatusEl.textContent = `Error: ${err.message}`;
      }
    });

    // --- PUSH: localStorage → Neon (one POST per row) ---
    document.getElementById('sync-db2s').addEventListener('click', async () => {
      syncStatusEl.textContent = 'Pushing to sheet…';
      try {
        const resp = await fetch(`${API_BASE}/export-to-sheet`, {
          method: 'GET', // simple GET triggers server‑side export
        });
        const json = await resp.json();
        if (!json.success) {
          syncStatusEl.textContent = `Error: ${json.error || 'unknown'}`;
          return;
        }
        syncStatusEl.textContent = `Exported ${json.rows} rows to Google Sheet`;
      } catch (err) {
        syncStatusEl.textContent = `Error: ${err.message}`;
      }
    });


    console.log('Sheets page loaded');
  });
}

// Utility to escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
