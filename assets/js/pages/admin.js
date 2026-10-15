// assets/js/pages/admin.js - Super Admin page controller
import { UserService } from '../modules/api.js';
import { getCurrentUser, isSuperAdmin, requireAuthOrRedirect } from '../modules/auth.js';
import { escapeHtml, showToast } from '../modules/utils.js';

export function initAdminPage() {
  if (!requireAuthOrRedirect()) return;

  const currentUser = getCurrentUser();
  if (!isSuperAdmin()) {
    document.body.innerHTML = `
      <div class="max-w-md mx-auto mt-20 p-8 bg-white border border-stone-200 rounded-2xl text-center shadow-sm">
        <div class="text-4xl mb-3">🚫</div>
        <h2 class="text-red-700 font-bold text-lg mb-2">Akses Ditolak</h2>
        <p class="text-stone-600 text-sm">Hanya super admin (dipta) yang diizinkan mengakses panel ini.</p>
        <a href="index.html" class="mt-5 inline-block px-4 py-2 bg-[#b4602e] text-white text-sm font-medium rounded-lg hover:bg-[#8a4520] transition">
          Kembali ke Dashboard
        </a>
      </div>
    `;
    return;
  }

  const navUser = document.getElementById('nav-user');
  if (navUser) {
    navUser.textContent = `👑 ${currentUser.username}`;
    navUser.classList.remove('hidden');
  }

  const tbody = document.getElementById('users-body');
  const addUserForm = document.getElementById('add-user-form');
  const msgEl = document.getElementById('add-user-msg');

  async function loadUsers() {
    if (!tbody) return;
    try {
      const users = await UserService.getAll();
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-6 text-center text-stone-400">Belum ada akun pengguna tambahan</td></tr>';
        return;
      }

      tbody.innerHTML = users.map(u => {
        const isSuper = u.username === 'dipta';
        const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID') : '—';

        return `
          <tr class="hover:bg-stone-50 transition">
            <td class="p-3.5 font-mono font-medium text-stone-900">${escapeHtml(u.username)}</td>
            <td class="p-3.5 text-stone-500 text-xs">${dateStr}</td>
            <td class="p-3.5 text-center">
              ${!isSuper ? `
                <button class="delete-user-btn px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium rounded-md transition" data-username="${escapeHtml(u.username)}">
                  Hapus
                </button>
              ` : '<span class="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-medium">super admin</span>'}
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const username = btn.dataset.username;
          if (!confirm(`Hapus akun user "${username}"?`)) return;
          try {
            await UserService.remove(username);
            showToast(`User "${username}" berhasil dihapus`, 'info');
            await loadUsers();
          } catch (err) {
            alert('Gagal menghapus user: ' + err.message);
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-red-500">Gagal memuat pengguna: ${err.message}</td></tr>`;
    }
  }

  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('new-username');
      const passwordInput = document.getElementById('new-password');
      const username = usernameInput?.value.trim();
      const password = passwordInput?.value;
      const submitBtn = addUserForm.querySelector('button[type="submit"]');

      if (!username || !password) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Membuat akun…';
      }
      if (msgEl) msgEl.classList.add('hidden');

      try {
        await UserService.create({ username, password });
        if (msgEl) {
          msgEl.textContent = `✓ Pengguna "${username}" berhasil dibuat`;
          msgEl.className = 'text-sm text-emerald-600 mt-3 font-medium';
          msgEl.classList.remove('hidden');
        }
        showToast(`User "${username}" berhasil didaftarkan`, 'success');
        addUserForm.reset();
        await loadUsers();
      } catch (err) {
        if (msgEl) {
          msgEl.textContent = `✗ ${err.message}`;
          msgEl.className = 'text-sm text-red-600 mt-3';
          msgEl.classList.remove('hidden');
        }
        showToast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '+ Tambah User';
        }
      }
    });
  }

  loadUsers();
}
