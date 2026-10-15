// assets/js/pages/estimate.js - Estimate page controller
import { InventoryService, EstimateService } from '../modules/api.js';
import { requireAuthOrRedirect } from '../modules/auth.js';
import { formatCurrency, escapeHtml, showToast } from '../modules/utils.js';

export function initEstimatePage() {
  if (!requireAuthOrRedirect()) return;

  const form = document.getElementById('estimate-form');
  const monthEl = document.getElementById('month');
  const productTabEl = document.getElementById('product_tab');
  const itemSelectEl = document.getElementById('item_select');
  const qtyEl = document.getElementById('qty');
  const resultEl = document.getElementById('estimate-result');
  const resultContentEl = document.getElementById('result-content');

  if (!form) return;

  // Load inventory items into select dropdown
  async function loadItems() {
    try {
      const items = await InventoryService.getAll();
      if (!items || !items.length) {
        itemSelectEl.innerHTML = '<option value="">Inventory kosong (tambah bahan di menu Inventory)</option>';
        return;
      }

      itemSelectEl.innerHTML = '<option value="">Pilih item (stok dari Inventory)</option>' +
        items.map(i => {
          const name = i.product_name || i.name || '';
          const qty = Number(i.quantity ?? i.qty) || 0;
          const cost = Number(i.unit_cost) || 0;
          return `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${qty.toFixed(2)} g, ${formatCurrency(cost)}/kg)</option>`;
        }).join('');
    } catch (err) {
      console.error('[estimate] loadItems error:', err);
      itemSelectEl.innerHTML = '<option value="">Gagal memuat item inventory</option>';
    }
  }

  // Initial load
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
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengirim…';
    }

    try {
      const data = await EstimateService.submit({ month, product_tab, item, qty });
      const inv = data.inventory || {};
      
      resultContentEl.textContent = `✓ ${data.message || 'Estimate berhasil dicatat'}\nItem: ${data.row?.[0] || item}\nBulan: ${month}\nProduk: ${data.row?.[1] || product_tab}\nQty: ${data.row?.[4] || qty} g\nSisa Stok: ${inv.after ?? '—'} g`;
      resultEl.classList.remove('hidden');
      
      showToast('Estimate berhasil dicatat!', 'success');
      form.reset();
      await loadItems(); // Refresh dropdown to reflect updated inventory stock
    } catch (err) {
      resultContentEl.textContent = `✗ ${err.message}`;
      resultEl.classList.remove('hidden');
      showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Estimate';
      }
    }
  });
}
