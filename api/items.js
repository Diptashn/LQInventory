// api/items.js – protect all endpoints with JWT auth
const { Client } = require('pg');
const { requireAuth } = require('./auth');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
let connected = false;
async function connect() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

module.exports = async (req, res) => {
  // Enable CORS globally
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- Auth guard ---
  const auth = requireAuth(req, res);
  if (!auth) return; // response already sent (401)

  try {
    await connect();

    // DELETE /api/items -> wipe the table (used by PUSH so the sheet is a
    // true mirror of localStorage instead of accumulating stale rows)
    if (req.method === 'DELETE') {
      const { rowCount } = await client.query('DELETE FROM inventory_items');
      return res.status(200).json({ success: true, deleted: rowCount });
    }

    if (req.method === 'GET') {
      const { month, product } = req.query;
      let sql = 'SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at FROM inventory_items';
      const params = [];
      const conditions = [];
      if (month) {
        conditions.push(`date_trunc('month', entry_date) = $${params.length + 1}::date`);
        params.push(month + '-01');
      }
      if (product) {
        conditions.push(`lower(product_name) = lower($${params.length + 1})`);
        params.push(product);
      }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY entry_date DESC';
      const result = await client.query(sql, params);
      return res.status(200).json({ data: result.rows, count: result.rowCount });
    }

    if (req.method === 'POST') {
      const { entry_date, product_name, quantity, unit_cost, notes } = req.body;
      if (!entry_date || !product_name || quantity == null || unit_cost == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      // Upsert on lower(product_name): the same material typed with different
      // capitalization must update one row, never create a second one.
      const result = await client.query(
        `INSERT INTO inventory_items (entry_date, product_name, quantity, unit_cost, notes)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (lower(product_name)) DO UPDATE
            SET quantity   = EXCLUDED.quantity,
                unit_cost = EXCLUDED.unit_cost,
                notes     = EXCLUDED.notes,
                entry_date = EXCLUDED.entry_date
          RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
        [entry_date, product_name, quantity, unit_cost, notes || null]
      );
      return res.status(201).json(result.rows[0]);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[items error]', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
