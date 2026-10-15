// assets/js/modules/auth.js - Authentication helpers and route guards
import { API_BASE } from './api.js';

export function getToken() {
  return localStorage.getItem('auth_token');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('auth_token', token);
  } else {
    localStorage.removeItem('auth_token');
  }
}

export function getCurrentUser() {
  const token = getToken();
  if (!token) return null;
  try {
    // Custom JWT format: body.signature (body is base64url encoded JSON with {sub, username, exp})
    const body = token.split('.')[0];
    const jsonStr = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(jsonStr);
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      setToken(null);
      return null;
    }
    return payload;
  } catch (err) {
    console.warn('[auth] Could not decode token payload', err);
    return null;
  }
}

export function isSuperAdmin() {
  const user = getCurrentUser();
  return user?.username === 'dipta';
}

// Redirect to login if unauthenticated (skips on login.html)
export function requireAuthOrRedirect() {
  if (location.pathname.endsWith('login.html')) return true;
  const token = getToken();
  if (!token) {
    const next = encodeURIComponent(location.pathname);
    location.href = `login.html?next=${next}`;
    return false;
  }
  return true;
}

// Global UI setup: wire logout buttons, display user info, inject admin link for super admin
export function initGlobalAuthUI() {
  const user = getCurrentUser();
  const superAdmin = isSuperAdmin();

  // If superadmin, ensure "Admin" link exists in header nav
  if (superAdmin) {
    const navs = document.querySelectorAll('header nav, nav');
    navs.forEach(nav => {
      if (!nav.querySelector('a[href="admin.html"]') && !location.pathname.endsWith('admin.html')) {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'px-3 py-1.5 rounded hover:bg-stone-100 text-amber-800 font-medium flex items-center gap-1';
        adminLink.innerHTML = '🛡️ Admin';
        // insert before logoutBtn if present
        const logoutBtn = nav.querySelector('#logoutBtn');
        if (logoutBtn) {
          nav.insertBefore(adminLink, logoutBtn);
        } else {
          nav.appendChild(adminLink);
        }
      }
    });
  }

  // Display user badge if #nav-user exists
  const navUser = document.getElementById('nav-user');
  if (navUser && user?.username) {
    navUser.textContent = `${superAdmin ? '👑 ' : ''}${user.username}`;
    navUser.classList.remove('hidden');
  }

  // Wire all logout buttons
  document.querySelectorAll('#logoutBtn, #logout-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch(`${API_BASE}/logout`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (err) {
        console.warn('[logout] API call error:', err);
      } finally {
        setToken(null);
        location.href = 'login.html';
      }
    });
  });
}
