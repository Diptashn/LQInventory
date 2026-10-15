// DELETE /api/users/:username - delete user (super admin only)
const { createClient } = require('../_db.js');
const { requireAuth } = require('../auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = requireAuth(req, res);
  if (!auth) return;
  
  // Only super admin (dipta) can delete users
  if (auth.username !== 'dipta') {
    return res.status(403).json({ error: 'Forbidden: super admin only' });
  }

  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  // Prevent deleting self
  if (username === 'dipta') {
    return res.status(400).json({ error: 'Cannot delete super admin' });
  }

  const client = createClient();
  try {
    await client.connect();
    const result = await client.query(
      'DELETE FROM users WHERE username = $1 RETURNING id',
      [username]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({ success: true, message: `User ${username} deleted` });
  } catch (e) {
    console.error('[users/delete] error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.end();
  }
};