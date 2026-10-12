// api/items/[id].js - Vercel serverless function for a single inventory item
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connect();

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    if (req.method === 'GET') {
      const result = await client.query(
        `SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at
         FROM inventory_items WHERE id = $1`,
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      const { entry_date, product_name, quantity, unit_cost, notes } = req.body;
      if (entry_date == null && product_name == null && quantity == null && unit_cost == null && notes == null) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      // Build dynamic update
      const fields = [];
      const values = [];
      let paramIdx = 1;
      if (entry_date !== undefined) {
        fields.push(`entry_date = $${paramIdx++}`);
        values.push(entry_date);
      }
      if (product_name !== undefined) {
        fields.push(`product_name = $${paramIdx++}`);
        values.push(product_name);
      }
      if (quantity !== undefined) {
        fields.push(`quantity = $${paramIdx++}`);
        values.push(quantity);
      }
      if (unit_cost !== undefined) {
        fields.push(`unit_cost = $${paramIdx++}`);
        values.push(unit_cost);
      }
      if (notes !== undefined) {
        fields.push(`notes = $${paramIdx++}`);
        values.push(notes);
      }
      const sql = `UPDATE inventory_items SET ${fields.join(', ')}, updated_at = now() WHERE id = $${paramIdx} RETURNING *`;
      values.push(id);
      const result = await client.query(sql, values);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const result = await client.query('DELETE FROM inventory_items WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};