// api/estimate.js
//
// POST /api/estimate
// Receive estimate data, write a row to the corresponding product tab in Google Sheets.
// Auth: JWT required.

const { OAuth2Client } = require('google-auth-library');
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, error:'Method not allowed' });

  try {
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

    const accessToken = await getAccessToken();
    const tab = await resolveTabName(accessToken, product_tab);
    const range = encodeURIComponent(`'${tab}'`);

    const row = [new Date().toISOString().split('T')[0], String(month), String(item), Number(qty)];
    // Append row to the sheet tab
    await sheetsRequest(
      `${process.env.SHEETS_API || 'https://sheets.googleapis.com/v4/spreadsheets'}/${process.env.GOOGLE_SHEET_ID || '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA'}/values/${range}:append?valueInputOption=USER_ENTERED`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );

    return res.status(200).json({ success:true, message:'Estimate recorded', row, tab });
  } catch (e) {
    console.error('[estimate]', e);
    return res.status(400).json({ success:false, error:e.message });
  }
};
