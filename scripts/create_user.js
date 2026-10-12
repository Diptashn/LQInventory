#!/usr/bin/env node
// scripts/create_user.js – one-time admin account creation.
// Usage: node scripts/create_user.js <username> <password>
// Reads DATABASE_URL from the repo .env file (or env).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function main() {
  const [u, p] = process.argv.slice(2);
  if (!u || !p) {
    console.error('Usage: node scripts/create_user.js <username> <password>');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Check if user already exists
  const existing = await client.query(
    'SELECT id FROM users WHERE username = $1', [u]
  );
  if (existing.rows.length) {
    console.log(`Username "${u}" already exists (id: ${existing.rows[0].id}). Password updated.`);
  }

  const hash = await bcrypt.hash(p, 12);
  const res = await client.query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, username, created_at`,
    [u, hash]
  );
  console.log('User ready:', res.rows[0]);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });