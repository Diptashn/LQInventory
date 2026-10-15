// api/items.js – protect all endpoints with JWT auth
const { createClient } = require('./_db.js');
const { requireAuth } = require('./auth.js');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- Auth guard ---
  const auth = requireAuth(req, res);
  if (!auth) return; // response already sent (401)

  const client = createClient();
  try {
    await client.connect();

    const { id } = req.query;

    // --- Single item operations via /api/items?id=... ---
    if (id) {
      if (req.method === 'GET') {
        const { rows } = await client.query(
          'SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at FROM inventory_items WHERE id = $1',
          [id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json(rows[0]);
      }

      if (req.method === 'PUT') {
        const { entry_date, product_name, quantity, unit_cost, notes } = req.body || {};
        const { rows } = await client.query(
          `UPDATE inventory_items 
              SET entry_date = COALESCE($1, entry_date),
                  product_name = COALESCE($2, product_name),
                  quantity = COALESCE($3, quantity),
                  unit_cost = COALESCE($4, unit_cost),
                  notes = COALESCE($5, notes)
            WHERE id = $6
        RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
          [entry_date || null, product_name || null, quantity != null ? quantity : null, unit_cost != null ? unit_cost : null, notes !== undefined ? notes : null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json(rows[0]);
      }

      if (req.method === 'DELETE') {
        const { rowCount } = await client.query('DELETE FROM inventory_items WHERE id = $1', [id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json({ success: true, deleted: rowCount });
      }

      return res.status(405).json({ error: 'Method not allowed for item ID' });
    }

    // --- Collection operations via /api/items ---
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
      sql += ' ORDER BY entry_date DESC, id DESC';
      const result = await client.query(sql, params);
      return res.status(200).json({ data: result.rows, count: result.rowCount });
    }

    if (req.method === 'POST') {
      const { entry_date, product_name, quantity, unit_cost, notes } = req.body || {};
      if (!entry_date || !product_name || quantity == null || unit_cost == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      // Upsert on lower(product_name): the same material typed with different
      // capitalization must update one row, never create a second one.
      const result = await client.query(
        `INSERT INTO inventory_items (entry_date, product_name, quantity, unit_cost, notes)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (lower(product_name)) DO UPDATE
            SET quantity   = inventory_items.quantity + EXCLUDED.quantity,
                unit_cost  = EXCLUDED.unit_cost,
                notes      = EXCLUDED.notes,
                entry_date = EXCLUDED.entry_date
          RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
        [entry_date, product_name, quantity, unit_cost, notes || null]
      );
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      // Require explicit ?wipe=all confirmation to prevent accidental wipe
      if (req.query.wipe === 'all') {
        const { rowCount } = await client.query('DELETE FROM inventory_items');
        return res.status(200).json({ success: true, deleted: rowCount });
      }
      return res.status(400).json({ error: 'Missing item id or explicit ?wipe=all confirmation' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[items error]', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    await client.end();
  }
};
