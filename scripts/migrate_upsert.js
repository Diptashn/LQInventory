// scripts/migrate_upsert.js
// One-time migration: add lowercase unique index on product_name so the API
// can use ON CONFLICT (lower(product_name)) DO UPDATE.
const { Client } = require('pg');
const fs = require('fs');

// Load DATABASE_URL from .env
const envPath = '/opt/data/hermes/LQInventory/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  // 1. Deduplicate first: keep newest row per lowercase name, drop the rest
  const dupes = await client.query(`
    DELETE FROM inventory_items a
    USING inventory_items b
    WHERE lower(a.product_name) = lower(b.product_name)
      AND (a.created_at, a.id::text) < (b.created_at, b.id::text)
    RETURNING a.product_name
  `);
  console.log('Removed duplicate rows:', dupes.rowCount, dupes.rows.map(r => r.product_name));

  // 2. Create the lowercase unique index
  await client.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_lower_name ON inventory_items (lower(product_name))'
  );
  console.log('Unique index on lower(product_name) created.');

  // 3. Verify
  const rows = await client.query('SELECT id, product_name, quantity, unit_cost FROM inventory_items ORDER BY product_name');
  console.log('Current rows:', rows.rowCount);
  rows.rows.forEach(r => console.log(`  ${r.product_name} | ${r.quantity} g | Rp ${r.unit_cost}/kg`));

  await client.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });