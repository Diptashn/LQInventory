// api/export-to-sheet.js
//
// GET /api/export-to-sheet
// Pulls every row from Neon (inventory_items) and writes it to the "Inventory"
// tab of the COGS spreadsheet.
//
// Auth: requires a valid JWT (Bearer token or session cookie)
//
// Why direct REST instead of the `googleapis` SDK:
//   `require('googleapis')` pulls in ~500 generated API clients (131 KB index
//   alone), which blows past Vercel's serverless bundle limit and makes cold
//   starts time out. `google-auth-library` is tiny and does one job: turn a
//   refresh_token into an access_token. The Sheets API itself is a couple of
//   plain REST calls, so we do them directly.
//
// Query params:
//   clear=true|false – clear the target tab before writing (default true)
//   tab=NAME         – custom tab name (default 'Inventory')

const { Client } = require('pg');
const { OAuth2Client } = require('google-auth-library');
const { requireAuth } = require('./auth');

// ── config ───────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID
  || '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA';
const DEFAULT_TAB = 'Inventory';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── helpers ──────────────────────────────────────────────────────────────

// Parse a JSON credential blob from the environment, with a local-file
// fallback so the endpoint stays runnable on this machine during dev.
function loadJsonFromEnvOrFile(envVar, fallbackPath) {
  const raw = process.env[envVar];
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`[export-to-sheet] ${envVar} is not valid JSON: ${e.message}`);
    }
  }
  const fs = require('fs');
  return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
}

// Build an authorized OAuth2 client from the client-secret + token env vars.
async function getAccessToken() {
  const secretJson = loadJsonFromEnvOrFile(
    'GOOGLE_CLIENT_SECRET_JSON',
    '/opt/data/profiles/developer/google_client_secret.json'
  );
  // Google files usually nest the app under "installed" or "web"; accept both.
  const secret = secretJson.installed || secretJson.web || secretJson;

  const tokenObj = loadJsonFromEnvOrFile(
    'GOOGLE_TOKEN_JSON',
    '/opt/data/profiles/developer/google_token.json'
  );

  const client = new OAuth2Client(secret.client_id, secret.client_secret);
  client.setCredentials({ refresh_token: tokenObj.refresh_token });

  const { token } = await client.getAccessToken();
  return token;
}

// Thin fetch wrapper that surfaces Google's error text instead of "500".
async function sheetsRequest(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

// Resolve the requested tab to its real (case-preserved) title in the sheet.
async function resolveTabName(accessToken, tabName) {
  const meta = await sheetsRequest(
    `${SHEETS_API}/${SHEET_ID}?fields=sheets.properties.title`,
    accessToken
  );
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  const real = titles.find((t) => t.toLowerCase() === tabName.toLowerCase());
  if (!real) throw new Error(`Tab "${tabName}" not found. Available: ${titles.join(', ')}`);
  return real;
}

// ── main handler ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Auth guard – requires a valid JWT
  const auth = requireAuth(req, res);
  if (!auth) return; // 401 already sent

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const read = req.query.read === 'true';
  const clear = !req.query.clear; // when read=true, default clear=false
  const tabName = req.query.tab || DEFAULT_TAB;

  // When read-only, skip DB query and just fetch sheet values
  if (read) {
    const accessToken = await getAccessToken();
    const tab = await resolveTabName(accessToken, tabName);

    // Read all values from the tab, starting below the header row
    const meta = await sheetsRequest(
      `${SHEETS_API}/${SHEET_ID}?range=${encodeURIComponent("'"+tab+"'")}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIALIZE`,
      accessToken
    );
    const values = meta.values || [];

    // First row is header; treat remaining as data rows
    const header = values[0] || [];
    const rows = values.slice(1).map((row, i) => ({
      id: i + 1, // fallback ID since we don't have Neon IDs from sheet
      name: row[2] || '',        // Product Name column (index 2)
      qty: row[3] ? Number(row[3]) : 0, // Quantity column (index 3)
      unit_cost: row[4] ? Number(row[4]) : 0, // Unit Cost column (index 4)
      notes: row[5] || '',
      updated_at: new Date().toISOString(),
    }));

    return res.status(200).json({
      success: true,
      tab,
      rows,
      sheet_url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    });
  }

  // ── full pipeline: Neon → Google Sheet (original behaviour) ──────────────
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // 1. read all inventory rows
    const { rows } = await client.query(
      `SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at
         FROM inventory_items
        ORDER BY created_at DESC`
    );

    // 2. auth to google
    const accessToken = await getAccessToken();
    const tab = await resolveTabName(accessToken, tabName);
    const range = encodeURIComponent(`'${tab}'`);

    // 3. clear existing data below the header row
    if (clear) {
      await sheetsRequest(
        `${SHEETS_API}/${SHEET_ID}/values/${range}!A2:G1000:clear`,
        accessToken,
        { method: 'POST' }
      );
    }

    // 4. write header + data in a single update (batch keeps it to one call)
    const header = ['ID', 'Entry Date', 'Product Name', 'Quantity', 'Unit Cost', 'Notes', 'Created At'];
    const values = rows.map((r) => [
      String(r.id),
      String(r.entry_date),
      r.product_name,
      String(r.quantity),
      String(r.unit_cost),
      r.notes || '',
      String(r.created_at),
    ]);

    await sheetsRequest(
      `${SHEETS_API}/${SHEET_ID}/values/${range}!A1:G${values.length + 1}?valueInputOption=USER_ENTERED`,
      accessToken,
      { method: 'PUT', body: JSON.stringify({ values: [header, ...values] }) }
    );

    return res.status(200).json({
      success: true,
      rows: rows.length,
      tab,
      sheet_url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    });
  } catch (err) {
    console.error('[export-to-sheet]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'export failed',
    });
  } finally {
    await client.end();
  }
};