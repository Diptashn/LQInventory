Lilquin Inventory — LilQuin Kitchen

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
index.html           home (section picker)
inventory.html       inventory CRUD (localStorage)
estimate.html        estimate input (localStorage-backed)
sheets.html          Sheets sync status page
assets/css/          tailwind.css (source), styles.css (project tweaks)
assets/js/app.js     all client-side logic (ES module)
assets/images/       logo
data/inventory.json  snapshot export from the old SQLite DB
config.json          site config (sheet id, feature flags)
app/                 optional FastAPI backend
```

## Notes

* No `hx-*` attributes, no HTMX, no Jinja2 syntax in any HTML file.
* All asset paths are relative (`assets/…`) so the site works from any subpath.
* No hard-coded hosts (`localhost`, `127.0.0.1`, tunnel domains) anywhere.
