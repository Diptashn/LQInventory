// assets/js/modules/utils.js - Shared utilities and helpers

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

export function hargaPerGram(hargaKg) {
  const num = Number(hargaKg) || 0;
  return (num / 1000).toFixed(2);
}

export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

// Sentence-case: "VANILLA SUGAR" -> "Vanilla sugar"
export function sentenceCase(str) {
  const s = String(str || '').trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Toast notification helper
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-stone-800' : 'bg-stone-700';
  toast.className = `${bg} text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center justify-between gap-3 toast-notice`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="text-white/70 hover:text-white text-xs font-bold px-1">&times;</button>
  `;

  toast.querySelector('button').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
