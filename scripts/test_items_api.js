// Quick sanity: Neon upsert & DELETE via API
const fs = require('fs');
process.env.GOOGLE_CLIENT_SECRET_JSON = fs.readFileSync('/opt/data/profiles/developer/google_client_secret.json', 'utf8');
process.env.GOOGLE_TOKEN_JSON = fs.readFileSync('/opt/data/profiles/developer/google_token.json', 'utf8');
process.env.AUTH_SECRET = 'lq-inventory-dev-secret';

const { sign } = require('./api/auth.js');
const token = sign({ id: 'test', username: 'dipta' });

async function callApi(method, path, body = null) {
  const url = `https://lq-inventory.vercel.app/api${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const txt = await res.text();
  try { return { status: res.status, json: JSON.parse(txt) }; }
  catch { return { status: res.status, text: txt }; }
}

async function main() {
  // 1. wipe
  let r = await callApi('DELETE', '/items');
  console.log('WIPE:', r);

  // 2. insert Fondant
  r = await callApi('POST', '/items', { entry_date: '2026-10-12', product_name: 'Fondant', quantity: 1000, unit_cost: 50000 });
  console.log('INSERT Fondant:', r);

  // 3. insert fondant (lowercase) -> should update same row
  r = await callApi('POST', '/items', { entry_date: '2026-10-12', product_name: 'fondant', quantity: 2000, unit_cost: 55000 });
  console.log('INSERT fondant (should update):', r);

  // 4. list
  r = await callApi('GET', '/items');
  console.log('LIST:', r);

  // 5. delete via ID (if we had the id)
  if (r.json && r.json.data && r.json.data[0]) {
    const id = r.json.data[0].id;
    r = await callApi('DELETE', `/items?id=${id}`);
    console.log('DELETE by ID (not implemented):', r);
  }
  // 6. list again
  r = await callApi('GET', '/items');
  console.log('LIST after delete attempt:', r);
}

main();