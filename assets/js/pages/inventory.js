// assets/js/pages/inventory.js - Inventory page controller
import { InventoryService } from '../modules/api.js';
import { requireAuthOrRedirect } from '../modules/auth.js';
import { formatCurrency, escapeHtml, sentenceCase, showToast } from '../modules/utils.js';

export function initInventoryPage() {
  if (!requireAuthOrRedirect()) return;

  const form = document.getElementById('add-form');
  const itemsBody = document.getElementById('items-body');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search');

  if (!itemsBody) return;

  async function renderItems(filter = '') {
    try {
      const all = await InventoryService.getAll();
      const items = all.filter(i => (i.product_name || i.name || '').toLowerCase().includes(filter.toLowerCase()));

      if (!items.length) {
        if (emptyState) emptyState.classList.remove('hidden');
        itemsBody.innerHTML = '';
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');
      itemsBody.innerHTML = items.map(item => {
        const name = item.product_name || item.name;
        const qty = Number(item.quantity ?? item.qty) || 0;
        const cost = Number(item.unit_cost) || 0;
        const itemId = item.id;
        const dateStr = item.created_at || item.updated_at || item.entry_date || Date.now();

        return `
          <tr class="hover:bg-amber-50/40 transition">
            <td class="p-3.5 font-medium text-stone-900">${escapeHtml(name)}</td>
            <td class="p-3.5 text-right font-mono text-stone-700">${qty.toFixed(2)} g</td>
            <td class="p-3.5 text-right text-stone-700">${formatCurrency(cost)}</td>
            <td class="p-3.5 text-right font-mono text-stone-500">${formatCurrency(cost / 1000)}</td>
            <td class="p-3.5 text-xs text-stone-400">${new Date(dateStr).toLocaleDateString('id-ID')}</td>
            <td class="p-3.5 text-center space-x-1">
              <button class="edit-btn px-2.5 py-1 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-md transition" data-id="${itemId}">
                Edit
              </button>
              <button class="delete-btn px-2.5 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition" data-id="${itemId}">
                Hapus
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Wire delete buttons
      itemsBody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          if (!confirm('Hapus bahan ini dari inventory?')) return;
          try {
            await InventoryService.remove(id);
            showToast('Bahan berhasil dihapus', 'info');
            await renderItems(searchInput ? searchInput.value : '');
          } catch (err) {
            alert('Gagal hapus: ' + err.message);
          }
        });
      });

      // Wire edit buttons
      itemsBody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const item = all.find(i => String(i.id) === String(id));
          if (!item) return;

          const name = item.product_name || item.name;
          const qty = Number(item.quantity ?? item.qty) || 0;
          const cost = Number(item.unit_cost) || 0;

          const rawName = prompt('Nama bahan:', name);
          if (rawName === null) return;
          const newQty = prompt('Qty (grams):', qty);
          if (newQty === null) return;
          const newCost = prompt('Harga /kg (Rp):', cost);
          if (newCost === null) return;

          const normName = sentenceCase(rawName);
          const nq = parseFloat(newQty);
          const nc = parseFloat(newCost);
          if (!normName || isNaN(nq) || isNaN(nc)) {
            alert('Input tidak valid');
            return;
          }

          try {
            await InventoryService.update(id, { product_name: normName, quantity: nq, unit_cost: nc });
            showToast('Bahan berhasil diperbarui', 'success');
            await renderItems(searchInput ? searchInput.value : '');
          } catch (err) {
            alert('Gagal update: ' + err.message);
          }
        });
      });
    } catch (err) {
      console.error('[inventory] render error:', err);
      itemsBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500">Gagal memuat data: ${err.message}</td></tr>`;
    }
  }

  // Handle add item form
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name?.value?.trim();
      const normName = sentenceCase(name);
      const qty = parseFloat(form.qty?.value);
      const unit_cost = parseFloat(form.unit_cost?.value);

      if (!name || isNaN(qty) || isNaN(unit_cost) || qty <= 0 || unit_cost <= 0) {
        alert('Mohon isi semua field dengan nilai yang valid');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await InventoryService.add({
          entry_date: new Date().toISOString().split('T')[0],
          product_name: normName,
          quantity: qty,
          unit_cost,
          notes: '',
        });
        form.reset();
        showToast(`Bahan "${normName}" berhasil ditambahkan`, 'success');
        await renderItems(searchInput ? searchInput.value : '');
      } catch (err) {
        alert('Gagal menyimpan: ' + err.message);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Search input filter
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      await renderItems(e.target.value);
    });
  }

  // Initial load
  renderItems('');
}
