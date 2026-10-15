// assets/js/modules/api.js - API Client & Data Services
import { getToken } from './auth.js';

export const API_BASE = window.APP_API_BASE || (
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:8080/api'
    : 'https://lq-inventory.vercel.app/api'
);

export function authFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) {
    headers['Authorization'] = 'Bearer ' + tok;
  }
  return fetch(url, { ...opts, headers });
}

// ── Inventory Service with offline fallback ──────────────────────────────
export const InventoryService = {
  async getAll() {
    try {
      const res = await authFetch(`${API_BASE}/items`);
      if (res.ok) {
        const data = await res.json();
        const items = data.data || [];
        localStorage.setItem('lq_inventory_cache', JSON.stringify(items));
        return items;
      }
    } catch (err) {
      console.warn('[InventoryService] API unavailable, attempting offline cache', err);
    }

    // Fallback to offline localStorage cache
    const cached = localStorage.getItem('lq_inventory_cache');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
    return [];
  },

  async add(item) {
    try {
      const res = await authFetch(`${API_BASE}/items`, {
        method: 'POST',
        body: JSON.stringify(item),
      });
      if (res.ok) {
        return res.json();
      }
      let msg = `POST /items ${res.status}`;
      try {
        const d = await res.json();
        if (d.error) msg += `: ${d.error}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    } catch (err) {
      // Local demo fallback if offline
      const cached = JSON.parse(localStorage.getItem('lq_inventory_cache') || '[]');
      const localItem = {
        id: Date.now(),
        product_name: item.product_name,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        created_at: new Date().toISOString()
      };
      cached.unshift(localItem);
      localStorage.setItem('lq_inventory_cache', JSON.stringify(cached));
      return localItem;
    }
  },

  async remove(id) {
    const res = await authFetch(`${API_BASE}/items?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      // Also try route param fallback
      const fallbackRes = await authFetch(`${API_BASE}/items/${id}`, { method: 'DELETE' });
      if (!fallbackRes.ok && fallbackRes.status !== 204) {
        throw new Error(`DELETE /items ${res.status}`);
      }
    }
    // Update local cache
    const cached = JSON.parse(localStorage.getItem('lq_inventory_cache') || '[]');
    const filtered = cached.filter(i => String(i.id) !== String(id));
    localStorage.setItem('lq_inventory_cache', JSON.stringify(filtered));
  },

  async update(id, updates) {
    // GET current item first, then PUT with merged data
    let current = {};
    try {
      const res = await authFetch(`${API_BASE}/items?id=${id}`);
      if (res.ok) {
        current = await res.json();
      }
    } catch { /* ignore */ }

    const merged = { ...current, ...updates };
    const putRes = await authFetch(`${API_BASE}/items?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(merged)
    });
    if (!putRes.ok) {
      const fallbackRes = await authFetch(`${API_BASE}/items/${id}`, {
        method: 'PUT',
        body: JSON.stringify(merged)
      });
      if (!fallbackRes.ok) throw new Error(`PUT /items ${putRes.status}`);
      return fallbackRes.json();
    }
    return putRes.json();
  }
};

// ── User Management Service (Super Admin) ─────────────────────────────────
export const UserService = {
  async getAll() {
    const res = await authFetch(`${API_BASE}/users`);
    if (!res.ok) throw new Error(`GET /users ${res.status}`);
    const json = await res.json();
    return json.data || [];
  },

  async create(user) {
    const res = await authFetch(`${API_BASE}/register`, {
      method: 'POST',
      body: JSON.stringify(user)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal membuat pengguna');
    return data;
  },

  async remove(username) {
    const res = await authFetch(`${API_BASE}/users/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`DELETE /users ${res.status}`);
    return res.json();
  }
};

// ── Estimate Service ──────────────────────────────────────────────────────
export const EstimateService = {
  async submit(data) {
    const res = await authFetch(`${API_BASE}/estimate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Submit estimate gagal');
    return json;
  }
};

// ── Google Sheets Service ─────────────────────────────────────────────────
export const SheetsService = {
  async exportToSheets() {
    const res = await authFetch(`${API_BASE}/export-to-sheet`, { method: 'GET' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Export gagal');
    return json;
  },

  async checkHealth() {
    const res = await authFetch(`${API_BASE}/items`);
    return res.json();
  }
};
