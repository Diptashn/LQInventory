import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        login: 'login.html',
        inventory: 'inventory.html',
        estimate: 'estimate.html',
        sheets: 'sheets.html',
        admin: 'admin.html',
      },
    },
    minify: 'esbuild',
  },
});