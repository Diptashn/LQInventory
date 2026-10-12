// api/login.js – POST /api/login – login & issue JWT token
// In plain Vercel serverless (no Express) we set the cookie via response header.
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { sign } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const { rows } = await client.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = sign({ sub: user.id, username: user.username });

    // Set the session cookie header so the browser will send it automatically
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Secure; SameSite=None; Max-Age=${12 * 60 * 60}; Path=/`);

    return res.status(200).json({
      success: true,
      user: { id: user.id, username: user.username },
      token,
    });
  } catch (err) {
    console.error('[login error]', err);
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};