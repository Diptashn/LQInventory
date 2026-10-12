// api/export-to-sheet.js
// Vercel serverless function: /api/export-to-sheet
// Triggers the Python export script (scripts/export_neon_to_sheet.py)
// which pulls rows from Neon and writes them to the target Google Sheet tab.
//
// Query params:
//   clear=false   – skip clearing the sheet before export (default: clear)
//   tab=Inventory – target sheet tab name (default: Inventory)
//
// The Python script uses the .venv-export virtualenv that has psycopg2-binary
// + google-api-python-client installed. DATABASE_URL comes from Vercel env vars.
module.exports = async (req, res) => {
  // Enable CORS so the static site (GitHub Pages / custom domain) can call it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { execFile } = require('child_process');
  const { join } = require('path');

  // Prepare environment for the child process
  const childEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || '',  // injected via Vercel env
    PYTHONPATH: join(process.cwd(), '.venv-export/lib/python3.13/site-packages'),
  };

  // Build flags from query params
  const clear = req.query.clear !== 'false';                    // default true
  const tab = req.query.tab || 'Inventory';

  // Build command-line args for the export script
  // (We rely on the script reading DATABASE_URL from env)
  const scriptPath = join(process.cwd(), 'scripts', 'export_neon_to_sheet.py');
  const pythonPath = join(process.cwd(), '.venv-export', 'bin', 'python');

  // Exec with timeout (Vercel max is limited; set 25s)
  execFile(pythonPath, [scriptPath], {
    cwd: process.cwd(),
    env: childEnv,
    timeout: 25000,
    maxBuffer: 1024 * 1024, // 1 MB output buffer
  }, (error, stdout, stderr) => {
    if (error) {
      console.error('[export-to-sheet] child error:', stderr || error.message);
      return res.status(500).json({
        success: false,
        error: `Export failed: ${error.message}`,
        detail: stderr || '',
      });
    }

    // Parse row count from stdout (script prints "→ N rows exported")
    const rowsMatch = stdout.match(/→ (\d+) rows exported/);
    const rows = rowsMatch ? parseInt(rowsMatch[1]) : 0;

    const sheetUrl = `https://docs.google.com/spreadsheets/d/1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA`;

    return res.status(200).json({
      success: true,
      rows,
      sheet_url: sheetUrl,
      raw_output: stdout.trim(),
    });
  });
};