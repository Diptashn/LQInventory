// test with proper token flow
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');

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
  if (rows.length === 0) {
    console.log('No users in DB');
    return;
  }
  const user = rows[0];
  console.log('User:', user);

  const token = sign({ sub: user.id });
  console.log('Token:', token);

  // Test API
  const fetch = (await import('node-fetch')).default;
  const res = await fetch('https://lq-inventory.vercel.app/api/items', {
    headers: { Authorization: 'Bearer ' + token },
  });
  console.log('GET /items status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));

  await client.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });