// api/export-to-sheet.js
//
// GET /api/export-to-sheet
// Pulls every row from Neon (inventory_items) and writes it to the "Inventory"
// tab of the COGS spreadsheet. Pure Node — no child processes, no python.
//
// Chain: Neon <--this endpoint--> Google Sheets
//
// Auth: requires a valid JWT (Bearer token or session cookie)
//
// Query params:
//   clear=true|false – clear the target tab before writing (default true)
//   tab=NAME         – custom tab name (default 'Inventory')

const { Client } = require('pg');
const { google } = require('googleapis');
const { requireAuth } = require('./auth');

// ── config ───────────────────────────────────────────────────────────────
const SHEET_ID = '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA';
const DEFAULT_TAB = 'Inventory';

// ── helpers ──────────────────────────────────────────────────────────────
function loadJsonFromEnvOrFile(envVar, fallbackPath) {
  const raw = process.env[envVar];
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`Failed to parse ${envVar} as JSON, falling back to file`);
    }
  }
  const fs = require('fs');
  return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
}

async function getGoogleAuth() {
  const raw = process.env.GOOGLE_CLIENT_SECRET_JSON;
  console.error('[debug] GOOGLE_CLIENT_SECRET_JSON raw length:', raw?.length, 'first 200:', raw?.substring(0, 200));
  let secret;
  try {
    secret = JSON.parse(raw);
    console.error('[debug] parsed secret keys:', Object.keys(secret));
  } catch (e) {
    console.error('[debug] failed to parse GOOGLE_CLIENT_SECRET_JSON:', e.message);
    secret = null;
  }
  if (!secret || !secret.installed) {
    throw new Error('Invalid GOOGLE_CLIENT_SECRET_JSON: missing .installed field');
  }

  const tokenObj = loadJsonFromEnvOrFile(
    'GOOGLE_TOKEN_JSON',
    '/opt/data/profiles/developer/google_token.json'
  );

  const oauth2Client = new google.auth.OAuth2(
    secret.client_id,
    secret.client_secret,
    'http://localhost' // redirect uri irrelevant for refresh_token grant
  );

  // If we have a refresh_token, use it; else the tokenObj must already be valid.
  if (tokenObj.refresh_token) {
    oauth2Client.setCredentials({ refresh_token: tokenObj.refresh_token });
    await oauth2Client.refreshAccessToken();
    return oauth2Client;
  }

  // No refresh_token: assume tokenObj already has a valid access_token.
  // Build credentials from tokenObj (access_token, expiry, etc).
  const creds = google.auth.fromJSON(tokenObj);
  return creds;
}

async function getSheetsTab(auth, tabName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties.title',
  });
  const titles = meta.data.sheets.map((s) => s.properties.title);
  const real = titles.find((t) => t.toLowerCase() === tabName.toLowerCase());
  if (!real) throw new Error(`Tab "${tabName}" not found. Available: ${titles.join(', ')}`);
  return { sheets, tab: real };
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

  const clear = req.query.clear !== 'false';
  const tabName = req.query.tab || DEFAULT_TAB;

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
    const auth = await getGoogleAuth();
    const { sheets, tab } = await getSheetsTab(auth, tabName);

    // 3. clear existing data
    if (clear) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `'${tab}'!A2:G1000`,
      });
    }

    // 4. build + write header
    const header = ['ID', 'Entry Date', 'Product Name', 'Quantity', 'Unit Cost', 'Notes', 'Created At'];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${tab}'!A1:G1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] },
    });

    // 5. write data rows
    if (rows.length) {
      const values = rows.map((r) => [
        String(r.id),
        String(r.entry_date),
        r.product_name,
        String(r.quantity),
        String(r.unit_cost),
        r.notes || '',
        String(r.created_at),
      ]);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${tab}'!A2:G${values.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
    }

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