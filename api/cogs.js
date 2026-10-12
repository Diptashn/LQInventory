// api/cogs.js - Vercel serverless function for monthly COGS
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let connected = false;

async function connect() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connect();

    if (req.method === 'GET') {
      const { month } = req.query;
      if (!month) {
        return res.status(400).json({ error: 'Missing month query parameter (YYYY-MM)' });
      }

      const result = await client.query(
        `SELECT product_name,
                sum(quantity) as total_qty,
                sum(quantity * unit_cost) as total_cogs
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

      const grand_total_cogs = items.reduce((sum, i) => sum + i.total_cogs, 0);

      return res.status(200).json({
        month,
        items,
        grand_total_cogs
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('COGS API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};