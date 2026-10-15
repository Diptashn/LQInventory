// assets/js/app.js - Main client-side entry point for LilQuin Kitchen
import { requireAuthOrRedirect, initGlobalAuthUI, isSuperAdmin } from './modules/auth.js';
import { initInventoryPage } from './pages/inventory.js';
import { initEstimatePage } from './pages/estimate.js';
import { initSheetsPage } from './pages/sheets.js';
import { initAdminPage } from './pages/admin.js';

// Re-export common services and utilities for direct script or console usage
export * from './modules/api.js';
export * from './modules/auth.js';
export * from './modules/utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;

  // Login page has its own standalone form logic
  if (path.endsWith('login.html')) {
    return;
  }

  // Enforce auth check across all internal application pages
  if (!requireAuthOrRedirect()) {
    return;
  }

  // Setup global headers, nav links, and logout handlers
  initGlobalAuthUI();

  // Route to the active page controller
  if (path.endsWith('inventory.html') || path.includes('/inventory')) {
    initInventoryPage();
  } else if (path.endsWith('estimate.html') || path.includes('/estimate')) {
    initEstimatePage();
  } else if (path.endsWith('sheets.html') || path.includes('/sheets')) {
    initSheetsPage();
  } else if (path.endsWith('admin.html') || path.includes('/admin')) {
    initAdminPage();
  } else {
    // Dashboard (index.html or root /)
    // If super admin, display admin link card on dashboard hero
    if (isSuperAdmin()) {
      const heroButtons = document.querySelector('section .flex.flex-wrap');
      if (heroButtons && !heroButtons.querySelector('a[href="admin.html"]')) {
        const adminBtn = document.createElement('a');
        adminBtn.href = 'admin.html';
        adminBtn.className = 'px-5 py-2.5 rounded-lg bg-stone-800 text-white font-medium hover:bg-stone-900 transition shadow-sm';
        adminBtn.innerHTML = '🛡️ Admin Panel';
        heroButtons.appendChild(adminBtn);
      }
    }
  }
});
