// api/cogs.js – protected monthly COGS aggregate
const { Client } = require('pg');
const { requireAuth } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = requireAuth(req, res);
  if (!auth) return;

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'Missing month param' });
    const result = await client.query(
      `SELECT product_name,
              SUM(quantity) AS total_qty,
              SUM(quantity * unit_cost) AS total_cogs
         FROM inventory_items
        WHERE date_trunc('month', entry_date) = $1::date
        GROUP BY product_name
        ORDER BY product_name`,
      [month + '-01']
    );
    const items = result.rows.map((r) => ({
      product_name: r.product_name,
      total_qty: Number(r.total_qty),
      total_cogs: Number(r.total_cogs)
    }));
    const grand = items.reduce((s, r) => s + Number(r.total_cogs), 0);
    return res.status(200).json({ month, items, grand_total_cogs: grand });
  } catch (err) {
    console.error('[cogs error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.end();
  }
};