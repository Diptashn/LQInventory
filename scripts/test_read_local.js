// Local harness: call the read-mode handler with a mock req/res to surface
// the real exception instead of Vercel's opaque FUNCTION_INVOCATION_FAILED.
const fs = require('fs');
process.env.GOOGLE_CLIENT_SECRET_JSON = fs.readFileSync(
  '/opt/data/profiles/developer/google_client_secret.json', 'utf8');
process.env.GOOGLE_TOKEN_JSON = fs.readFileSync(
  '/opt/data/profiles/developer/google_token.json', 'utf8');
process.env.AUTH_SECRET = 'lq-inventory-dev-secret';

const handler = require('/opt/data/hermes/LQInventory/api/export-to-sheet.js');
const { sign } = require('/opt/data/hermes/LQInventory/api/auth.js');

const token = sign({ id: 'test', username: 'dipta' });
console.log('token:', token.slice(0, 30) + '...');

// Mock req/res
const req = {
  method: 'GET',
  headers: {
    authorization: `Bearer ${token}`,
    cookie: '',
  },
  query: { read: 'true', tab: 'Inventory' },
};

const resData = { statusCode: 200, body: null, headers: {} };
const res = {
  setHeader: (k, v) => { resData.headers[k] = v; },
  status: (code) => { resData.statusCode = code; return res; },
  json: (obj) => { resData.body = obj; return res; },
  end: () => { return res; },
};

async function run() {
  try {
    await handler(req, res);
    console.log('status:', resData.statusCode);
    console.log('headers:', resData.headers);
    console.log('body:', JSON.stringify(resData.body, null, 2));
  } catch (e) {
    console.error('UNCAUGHT ERROR:', e);
  }
}
run();