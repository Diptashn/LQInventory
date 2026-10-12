// api/items/[id].js – single‑item routes (GET, PUT, DELETE) – JWT protected
const { Client } = require('pg');
const { requireAuth } = require('../auth');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth guard
  const auth = requireAuth(req, res);
  if (!auth) return; // 401 already sent

  const { id } = req.query; // Vercel passes dynamic segment as query param
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    if (req.method === 'GET') {
      const { rows } = await client.query(
        'SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at FROM inventory_items WHERE id = $1',
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'PUT') {
      const { entry_date, product_name, quantity, unit_cost, notes } = req.body;
      const { rows } = await client.query(
        `UPDATE inventory_items SET entry_date=$1, product_name=$2, quantity=$3, unit_cost=$4, notes=$5 WHERE id=$6 RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
        [entry_date, product_name, quantity, unit_cost, notes, id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      await client.query('DELETE FROM inventory_items WHERE id = $1', [id]);
      return res.status(204).end();
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[item id error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.end();
  }
};