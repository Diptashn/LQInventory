// api/logout.js
// POST /api/logout – clear session cookie
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Clear the session cookie
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=None; Max-Age=0; Path=/');
  return res.status(200).json({ success: true });
};