#!/usr/bin/env python
"""Seed Butter Cream harga_kg = 60000 into row 3 of every month block, 9 tabs.

Fixes the `#DIV/0!` in column D caused by `=1000/C` dividing a zero/blank C cell.
After this runs, row 3 of each month has C=60000 so D3 = Rp 16.67 and F works
if E3 has a value.  Blank C rows stay blank; user can fill them later.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import sheets as gsheets

BR = gsheets.BLOCK_ROWS
N = gsheets.N_BAHAN
OFFSET = gsheets.BAHAN_OFFSET

for tab in gsheets.PRODUCT_TABS:
    real = gsheets.resolve_tab_name(gsheets._get_service(), gsheets.SHEET_ID, tab)
    if not real:
        print(f"{tab}: skipped (not found)")
        continue
    svc = gsheets._get_service()
    values = []
    for m in range(1, 13):
        row3 = 1 + (m - 1) * BR + OFFSET + 1  # row 3 of each block, 1-based
        values.append([{"range": f"'{real}'!C{row3}", "values": [["60000"]]}])
    # batch
    body = {"valueInputOption": "USER_ENTERED", "data": [d for item in values for d in item]}
    svc.spreadsheets().values().batchUpdate(spreadsheetId=gsheets.SHEET_ID, body=body).execute()
    print(f"{real}: seeded 60000 into C3 of 12 months")
