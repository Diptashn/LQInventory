# Estimate <-> Google Sheet utilities for the COGS product tabs.
#
# Sheet geometry (verified live on 'CAKE 18 CM'): each month occupies a 106-row
# block, and all 99 bahan rows live ABOVE the 4 summary rows:
#
#   row 1        month header (e.g. "JANUARI 2026")
#   row 2        column headers
#   rows 3-101   the 99 bahan rows  <- estimate writes happen here
#   rows 102-105 the 4 summary rows (Total bahan / Ongkos produksi /
#               Total modal / Total Estimasi)  <- never cleared by the app
#   row 106      blank spacer
#
# So an untouched month shows only headers + the 4 summary rows.
# Month geometry: 1 header + 1 column header + N_BAHAN bahan rows + N_SUMMARY summary rows + 1 blank = BLOCK_ROWS

import sqlite3
from typing import Dict, List

from app import database as dbmod
from app import sheets as gsheets


def _month_rows(month_num: int) -> tuple:
    """Return (first_bahan, last_bahan) 1-based row numbers for a month."""
    base = (month_num - 1) * gsheets.BLOCK_ROWS   # 0-based month-header index
    first = base + 3                               # 1-based first bahan row
    last = base + 2 + gsheets.N_BAHAN              # 1-based last bahan row
    return first, last


def clear_estimate_block(tab: str, month_num: int, con: sqlite3.Connection) -> None:
    """Clear the 99 bahan rows of one month in one tab; keep the 4 summary rows."""
    svc = gsheets._get_service()
    real = gsheets.resolve_tab_name(svc, gsheets.SHEET_ID, tab)
    if not real:
        return
    first, last = _month_rows(month_num)
    svc.spreadsheets().values().clear(
        spreadsheetId=gsheets.SHEET_ID,
        range=f"'{real}'!A{first}:F{last}",
    ).execute()


def clear_all_estimate_items(con: sqlite3.Connection) -> Dict[str, int]:
    """Clear all bahan rows for every month and every product tab, preserving the 4 summary rows.

    After restructure, each month block has N_BAHAN rows (30). This uses batchClear for efficiency.
    Returns a dict mapping tab name to number of ranges cleared (12 per tab).
    """
    svc = gsheets._get_service()
    results: Dict[str, int] = {}
    for tab in gsheets.PRODUCT_TABS:
        real = gsheets.resolve_tab_name(svc, gsheets.SHEET_ID, tab)
        if not real:
            results[tab] = 0
            continue
        ranges = []
        for month in range(1, 13):
            base = (month - 1) * gsheets.BLOCK_ROWS
            first = base + 3  # first bahan row (1-indexed)
            last = base + 2 + gsheets.N_BAHAN  # last bahan row (1-indexed)
            ranges.append(f"'{real}'!A{first}:F{last}")
        svc.spreadsheets().values().batchClear(
            spreadsheetId=gsheets.SHEET_ID,
            body={"ranges": ranges},
        ).execute()
        results[tab] = len(ranges)
    return results



def sync_estimate_sheet(con: sqlite3.Connection, month_num: int, tab: str) -> str:
    """Write one month's estimate entries to a product tab.

    Clears that month's bahan rows first (summary rows untouched), then writes
    the entries directly above the summary rows.
    """
    svc = gsheets._get_service()
    real = gsheets.resolve_tab_name(svc, gsheets.SHEET_ID, tab)
    if not real:
        return f"(tab '{tab}' not found)"

    clear_estimate_block(tab, month_num, con)

    rows = dbmod.get_estimate_entries(con, month_num)
    rows = [r for r in rows if r["product_tab"] == tab]

    values: List[List] = []
    first, _ = _month_rows(month_num)
    for i, r in enumerate(rows):
        if i >= gsheets.N_BAHAN:
            # Only allow up to N_BAHAN estimate entries per month/tab
            break
        inv = dbmod.get_item(con, r["item_id"])
        harga_kg = inv["unit_cost"] if inv else 0
        harga_gr = round(harga_kg / 1000, 2)
        row_num = first + i
        formula = f"=C{row_num}*D{row_num}"
        values.append([i + 1, r["item_name"], r["qty_used"], harga_kg, harga_gr, formula])

    if values:
        last_row = first + len(values) - 1
        svc.spreadsheets().values().update(
            spreadsheetId=gsheets.SHEET_ID,
            range=f"'{real}'!A{first}:F{last_row}",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
    return f"https://docs.google.com/spreadsheets/d/{gsheets.SHEET_ID}"


def sync_all_estimate_sheets(con: sqlite3.Connection) -> dict:
    """Push every estimate entry (all months x all tabs) to the sheet.

    Idempotent: each tab/month block is cleared before it is rewritten.
    """
    written = 0
    blocks = 0
    for month in range(1, 13):
        rows = dbmod.get_estimate_entries(con, month)
        if not rows:
            continue
        for tab in {r["product_tab"] for r in rows}:
            if tab not in gsheets.PRODUCT_TABS:
                continue
            sync_estimate_sheet(con, month, tab)
            blocks += 1
            written += len([r for r in rows if r["product_tab"] == tab])
    return {
        "status": "ok",
        "blocks_written": blocks,
        "rows_written": written,
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{gsheets.SHEET_ID}",
    }
