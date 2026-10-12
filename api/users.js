// GET /api/users - list users (admin only)
import { createClient } from './_db.js';
import { requireAuth } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = requireAuth(req, res);
  if (!auth) return;
  
  // Only super admin (dipta) can list users
  if (auth.username !== 'dipta') {
    return res.status(403).json({ error: 'Forbidden: super admin only' });
  }

  const client = createClient();
  try {
    await client.connect();
    const result = await client.query(
      'SELECT id, username, created_at FROM users ORDER BY created_at DESC'
    );
    return res.status(200).json({ data: result.rows, count: result.rowCount });
  } catch (e) {
    console.error('[users] error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.end();
  }
}