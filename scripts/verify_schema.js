#!/usr/bin/env node
// Verify the Neon schema end-to-end: insert -> list -> COGS aggregate -> delete.
const { Client } = require('pg');

const DATABASE_URL =
  'postgresql://neondb_owner:npg_5bjenFDg8BTQ@ep-flat-mountain-b3y8z56k-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

(async () => {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // --- insert one row ---
  const ins = await client.query(
    `insert into inventory_items (entry_date, product_name, quantity, unit_cost, notes)
     values ($1,$2,$3,$4,$5) returning id`,
    [
      '2026-10-01', 'Fondant', 1500, 58000, 'test row'
    ]
  );
  const id = ins.rows[0].id;
  console.log('INSERT -> id:', id);

  // --- list ---
  const list = await client.query(
    `select id, entry_date, product_name, quantity, unit_cost, notes
       from inventory_items where id = $1`,
    [id]
  );
  console.log('SELECT ->', list.rowCount, 'rows');
  console.table(list.rows);

  // --- monthly COGS aggregate (the exact SQL from the spec) ---
  const cogs = await client.query(
    `select product_name,
            sum(quantity) as total_qty,
            sum(quantity * unit_cost) as total_cogs
       from inventory_items
      where date_trunc('month', entry_date) = $1::date
      group by product_name
      order by product_name`,
    ['2026-10-01']
  );
  console.log('COGS ->');
  console.table(cogs.rows);

  // --- cleanup so the DB is not left with test data ---
  const del = await client.query(`delete from inventory_items where id = $1`, [id]);
  console.log('DELETE ->', del.rowCount, 'rows cleaned up');

  await client.end();
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});