// api/register.js
// POST /api/register – create a new user (must be called with a valid JWT in Authorization header)
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { verify } = require('./auth');

module.exports = async (req, res) => {
  // Auth check – only logged‑in users may register new accounts
  const auth = verify(req.headers.authorization?.replace('Bearer ', '') || '');
  if (!auth) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

  // Check if user already exists
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    if (rows.length) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2) RETURNING id, username, created_at`,
      [username, hash]
    );
    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[register error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.end();
  }
};