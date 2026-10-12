// api/estimate.js
//
// POST /api/estimate
// Receive estimate data, write a row to the corresponding product tab in Google Sheets.
// Auth: JWT required.

const { OAuth2Client } = require('google-auth-library');
const { Client } = require('pg');
const { requireAuth } = require('./auth');

// Reuse helper functions from export-to-sheet (duplicate for simplicity).
function loadJsonFromEnvOrFile(envVar, fallbackPath) {
  const raw = process.env[envVar];
  if (raw) {
    try { return JSON.parse(raw); }
    catch (e) { console.warn(`[estimate] ${envVar} JSON parse error: ${e.message}`); }
  }
  const fs = require('fs');
  return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
}

async function getAccessToken() {
  const secretJson = loadJsonFromEnvOrFile('GOOGLE_CLIENT_SECRET_JSON', '/opt/data/profiles/developer/google_client_secret.json');
  const secret = secretJson.installed || secretJson.web || secretJson;
  const tokenObj = loadJsonFromEnvOrFile('GOOGLE_TOKEN_JSON', '/opt/data/profiles/developer/google_token.json');
  const client = new OAuth2Client(secret.client_id, secret.client_secret);
  client.setCredentials({ refresh_token: tokenObj.refresh_token });
  const { token } = await client.getAccessToken();
  return token;
}

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
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function resolveTabName(accessToken, tabName) {
  const meta = await sheetsRequest(
    `${process.env.SHEETS_API || 'https://sheets.googleapis.com/v4/spreadsheets'}/${process.env.GOOGLE_SHEET_ID || '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA'}?fields=sheets.properties.title`,
    accessToken
  );
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const real = titles.find(t => t.toLowerCase() === tabName.toLowerCase());
  if (!real) throw new Error(`Tab "${tabName}" not found`);
  return real;
}

module.exports = async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // Keep one transaction open across both writes so a Sheets failure rolls back Neon.
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Vercel pre-parses JSON bodies into req.body; fallback to raw stream locally
    let body = req.body;
    if (!body) {
      const raw = await new Promise((resolve, reject) => {
        let payload = '';
        req.on('data', chunk => { payload += chunk; });
        req.on('end', () => resolve(payload));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    } else if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { month, product_tab, item, qty } = body || {};
    if (!month || !product_tab || !item || qty == null) throw new Error('Missing fields: month, product_tab, item, qty required');

    const usedQty = Number(qty);
    if (isNaN(usedQty) || usedQty <= 0) throw new Error('Qty must be a positive number');

    // ── 1. Deduct stock from Neon (atomic, guarded against concurrent requests) ──
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, product_name, quantity, unit_cost FROM inventory_items WHERE lower(product_name) = $1 FOR UPDATE',
      [String(item).trim().toLowerCase()]
    );
    if (rows.length === 0) throw new Error(`Item "${item}" not found in inventory`);
    if (rows.length > 1) throw new Error(`Item "${item}" is ambiguous — duplicate rows in inventory`);
    const { id, product_name, quantity, unit_cost } = rows[0];

    const currentQty = Number(quantity);

    if (currentQty < usedQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Stok tidak cukup: tersedia ${currentQty} g, diminta ${usedQty} g`,
        available: currentQty,
        requested: usedQty,
      });
    }
    const newQty = currentQty - usedQty;
    await client.query(
      'UPDATE inventory_items SET quantity = $1, updated_at = now() WHERE id = $2',
      [newQty, id]
    );

    // 2. Write the row to Google Sheets – insert into proper month block
    const accessToken = await getAccessToken();
    const tab = await resolveTabName(accessToken, product_tab);
    // Load full tab values to locate month header
    const tabValues = await sheetsRequest(
      `${process.env.SHEETS_API || 'https://sheets.googleapis.com/v4/spreadsheets'}/${process.env.GOOGLE_SHEET_ID || '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA'}/values/${encodeURIComponent(`'${tab}'`)}`,
      accessToken
    );
    const rowsData = tabValues.values || [];
    const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const monthIdx = rowsData.findIndex(r => r[0] && monthNames.includes(r[0].trim()));
    if (monthIdx === -1) throw new Error(`Month "${month}" not found in tab ${tab}`);
    // Find first empty row after month header (starting at monthIdx+1)
    let insertIdx = monthIdx + 1;
    while (insertIdx < rowsData.length && rowsData[insertIdx] && rowsData[insertIdx][0] !== '' && rowsData[insertIdx][0] !== undefined) {
      insertIdx++;
    }
    const targetRow = insertIdx + 1; // Sheets rows are 1-indexed
    const range = encodeURIComponent(`'${tab}'!A${targetRow}:E${targetRow}`);
    // Build row: A=ID, B=NAMA BAHAN, C=HARGA/KG, D= (empty for HARGA/GRAM), E=PEMAKAIAN
    const row = [String(id), String(product_name), String(unit_cost), "", usedQty];
    await sheetsRequest(
      `${process.env.SHEETS_API || 'https://sheets.googleapis.com/v4/spreadsheets'}/${process.env.GOOGLE_SHEET_ID || '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA'}/values/${range}?valueInputOption=USER_ENTERED`,
      accessToken,
      { method: 'PUT', body: JSON.stringify({ values: [row] }) }
    );

    // ── 3. Commit — both writes succeeded ──
    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Estimate recorded',
      row,
      tab,
      inventory: { name: item, before: currentQty, after: newQty, used: usedQty },
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    console.error('[estimate]', e);
    return res.status(400).json({ success: false, error: e.message });
  } finally {
    await client.end().catch(() => {});
  }
};
