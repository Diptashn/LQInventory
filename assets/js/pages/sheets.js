// assets/js/pages/sheets.js - Google Sheets Sync page controller
import { SheetsService } from '../modules/api.js';
import { requireAuthOrRedirect } from '../modules/auth.js';
import { showToast } from '../modules/utils.js';

export function initSheetsPage() {
  if (!requireAuthOrRedirect()) return;

  const tokenStatusEl = document.getElementById('token-status');
  const syncStatusEl = document.getElementById('sync-status');
  const exportBtn = document.getElementById('export-to-sheets');

  if (!exportBtn) return;

  // Health / token check
  SheetsService.checkHealth()
    .then(data => {
      if (typeof data.count === 'number' || Array.isArray(data.data)) {
        if (tokenStatusEl) {
          tokenStatusEl.textContent = 'OK (Terkoneksi)';
          tokenStatusEl.className = 'text-xs mt-1 font-medium text-emerald-600';
        }
      } else {
        if (tokenStatusEl) {
          tokenStatusEl.textContent = 'Auth Diperlukan';
          tokenStatusEl.className = 'text-xs mt-1 font-medium text-amber-600';
        }
        if (syncStatusEl) syncStatusEl.textContent = data.error || 'Autentikasi diperlukan';
      }
    })
    .catch(() => {
      if (tokenStatusEl) {
        tokenStatusEl.textContent = 'Terputus (Mode Offline)';
        tokenStatusEl.className = 'text-xs mt-1 font-medium text-stone-500';
      }
      if (syncStatusEl) syncStatusEl.textContent = 'Koneksi ke backend belum tersedia.';
    });

  // Export Neon -> Google Sheets
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Mengekspor data ke Google Sheets…';
    if (syncStatusEl) syncStatusEl.textContent = 'Sedang menyinkronkan data Neon DB ke Spreadsheet…';

    try {
      const json = await SheetsService.exportToSheets();
      const count = json.rows ?? json.count ?? 'beberapa';
      if (syncStatusEl) {
        syncStatusEl.textContent = `✓ Berhasil mengekspor ${count} baris data ke Google Sheet`;
        syncStatusEl.className = 'mt-2 text-sm text-emerald-600 font-medium';
      }
      showToast(`Export berhasil: ${count} baris diekspor ke Sheet`, 'success');
    } catch (err) {
      if (syncStatusEl) {
        syncStatusEl.textContent = `✗ Gagal export: ${err.message}`;
        syncStatusEl.className = 'mt-2 text-sm text-red-600';
      }
      showToast(err.message, 'error');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export Neon → Sheets';
    }
  });
}
