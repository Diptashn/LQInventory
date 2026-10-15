# Lilquin Inventory — LilQuin Kitchen

Static front-end for LilQuin Kitchen inventory & estimation, with an optional
backend API for Google Sheets sync.

## Local development

```bash
npm install          # once
npm run dev          # vite dev server -> http://localhost:5173
```

## Build for production

```bash
npm run build        # minified static output in ./dist
npm run preview      # serve ./dist locally to verify
```

## Deploy to GitHub Pages

The workflow `.github/workflows/pages.yml` builds and publishes `dist/` to GitHub
Pages on every push to `main`. No extra steps required.

## Quick check: does the site work offline?

Open `index.html` directly from disk — the app stores inventory in
`localStorage`, so it functions with no server at all.

## Backend (optional)

The Python/FastAPI backend lives in `app/` and is **not required** for the
static site. It is kept for Google Sheets bidirectional sync. Run it when you
want live Sheets integration:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Copy `inventory.db` into the backend directory before syncing from the DB.

## Layout

```
index.html               Dashboard (quick access & overview)
login.html               Authentication portal with redirect support
inventory.html           Inventory CRUD (Neon DB API + local fallback)
estimate.html            COGS & ingredient estimate calculations
sheets.html              Google Sheets export & sync status
admin.html               Super Admin user management (dipta only)
assets/css/styles.css    Design system tokens, typography, & UI utilities
assets/js/
  app.js                 Main router & client entrypoint
  modules/               api.js (services), auth.js (JWT & guards), utils.js (helpers)
  pages/                 Page controllers (inventory, estimate, sheets, admin)
public/                  Static assets (favicon.ico, /images/logo.jpg)
api/                     Vercel serverless API endpoints (items, auth, estimate, export)
app/                     Optional FastAPI backend for Sheets bidirectional sync
scripts/                 Database migration and verification scripts
```

## Notes

* No `hx-*` attributes, no HTMX, no Jinja2 syntax in any HTML file.
* All asset paths are relative (`assets/…`) so the site works from any subpath.
* Modular client-side architecture with Vite bundling and offline resilience.

