// tmp/test_estimate.js — verify estimate API writes to correct month block
const SHEET_ID = '1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA';

async function main() {
  // 1. login
  const loginRes = await fetch('https://lq-inventory.vercel.app/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dipta', password: 'admin123' }),
  });
  const { token } = await loginRes.json();
  console.log('login ok:', !!token);

  // 2. submit estimate
  const estRes = await fetch('https://lq-inventory.vercel.app/api/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ month: '1', product_tab: 'CAKE 18 CM', item: 'Test', qty: '500' }),
  });
  const est = await estRes.json();
  console.log('estimate status:', estRes.status);
  console.log('estimate body:', JSON.stringify(est, null, 2));

  // 3. reject case: qty far over stock
  const badRes = await fetch('https://lq-inventory.vercel.app/api/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ month: '1', product_tab: 'CAKE 18 CM', item: 'Test', qty: '99999999' }),
  });
  console.log('over-qty status:', badRes.status, JSON.stringify(await badRes.json()));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});