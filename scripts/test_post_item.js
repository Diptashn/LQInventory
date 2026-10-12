// test POST add item via API
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const AUTH_SECRET = process.env.AUTH_SECRET || 'lq-inventory-dev-secret';

function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 12*60*60 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query('SELECT id, username FROM users LIMIT 1');
  const user = rows[0];
  const token = sign({ sub: user.id });
  console.log('Token created');

  // POST new item
  const newItem = {
    entry_date: '2026-10-12',
    product_name: 'Test Fondant',
    quantity: 1000,
    unit_cost: 50000,
    notes: '',
  };

  console.log('POST /items:', newItem);
  const postRes = await fetch('https://lq-inventory.vercel.app/api/items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(newItem),
  });
  console.log('POST status:', postRes.status);
  const postData = await postRes.json();
  console.log('POST response:', postData);

  // GET list
  const getRes = await fetch('https://lq-inventory.vercel.app/api/items', {
    headers: { Authorization: 'Bearer ' + token },
  });
  console.log('GET status:', getRes.status);
  const list = await getRes.json();
  console.log('List:', JSON.stringify(list, null, 2));

  // Cleanup
  if (postData.id) {
    await client.query('DELETE FROM inventory_items WHERE id = $1', [postData.id]);
    console.log('Cleaned up test item');
  }

  await client.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });