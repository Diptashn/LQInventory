// api/items.js - Vercel serverless function for inventory items
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connect();

    if (req.method === 'GET') {
      // List items, optional query: month=YYYY-MM, product=name
      const { month, product } = req.query;
      let sql = 'SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at FROM inventory_items';
      const params = [];
      const conditions = [];
      if (month) {
        conditions.push(`date_trunc('month', entry_date) = $${params.length + 1}::date`);
        params.push(month + '-01');
      }
      if (product) {
        conditions.push(`product_name = $${params.length + 1}`);
        params.push(product);
      }
      if (conditions.length) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY entry_date DESC';
      const result = await client.query(sql, params);
      return res.status(200).json({ data: result.rows, count: result.rowCount });
    }

    if (req.method === 'POST') {
      const { entry_date, product_name, quantity, unit_cost, notes } = req.body;
      if (!entry_date || !product_name || quantity == null || unit_cost == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const result = await client.query(
        `INSERT INTO inventory_items (entry_date, product_name, quantity, unit_cost, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
        [entry_date, product_name, quantity, unit_cost, notes || null]
      );
      return res.status(201).json(result.rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};