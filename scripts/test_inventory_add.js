// scripts/test_inventory_add.js
// Tests: POST a new item to Neon, then GET it back — simulates what the inventory page form submit does.
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  // Simulate form submission: insert a test item
  const testItem = {
    entry_date: new Date().toISOString().split('T')[0],
    product_name: 'Test Item ' + Date.now(),
    quantity: 100,
    unit_cost: 50000,
    notes: '',
  };

  console.log('1. INSERT:', testItem);
  const insertRes = await client.query(
    `INSERT INTO inventory_items (entry_date, product_name, quantity, unit_cost, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, entry_date, product_name, quantity, unit_cost, notes, created_at`,
    [testItem.entry_date, testItem.product_name, testItem.quantity, testItem.unit_cost, testItem.notes]
  );
  console.log('   INSERT OK:', insertRes.rows[0]);

  // Read it back (same as GET /api/items)
  const getRes = await client.query(
    'SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at FROM inventory_items ORDER BY created_at DESC LIMIT 5'
  );
  console.log('2. Latest rows:', getRes.rowCount);
  getRes.rows.forEach(r => {
    console.log(`   id=${r.id}  product_name=${r.product_name}  quantity=${r.quantity}  unit_cost=${r.unit_cost}`);
  });

  // Cleanup
  await client.query('DELETE FROM inventory_items WHERE product_name = $1', [testItem.product_name]);
  console.log('3. Cleaned up test item');

  await client.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });