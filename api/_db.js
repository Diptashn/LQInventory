// api/_db.js – shared Neon Postgres client factory
const { Client } = require('pg');

function createClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

module.exports = { createClient };
