// api/auth.js – shared authentication helpers
//
// Tokens are signed HMAC-SHA256 JWTs (custom, no deps) stored in:
//   1. the `Authorization: Bearer <token>` header, OR
//   2. the `session` cookie
//
// Token payload: { sub: userId, exp: <epoch seconds> }
// Signed with AUTH_SECRET env var. 12 h lifetime.

const crypto = require('crypto');

const LIFETIME_S = 12 * 60 * 60;

function sign(payload) {
  const secret = process.env.AUTH_SECRET || 'lq-inventory-dev-secret';
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + LIFETIME_S })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const secret = process.env.AUTH_SECRET || 'lq-inventory-dev-secret';
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Read token from header or cookie
function getToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const cookies = req.headers['cookie'] || '';
  for (const part of cookies.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'session') return decodeURIComponent(v || '');
  }
  return null;
}

// Guard: returns payload or null. Call early-return pattern:
//   const user = requireAuth(req, res); if (!user) return;
function requireAuth(req, res) {
  const token = getToken(req);
  const payload = verify(token);
  if (!payload) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return payload;
}

module.exports = { sign, verify, requireAuth };
