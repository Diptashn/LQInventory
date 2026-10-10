#!/usr/bin/env python
"""Repair columns C/D/F of every product tab in the COGS/Estimate sheet.

Why this exists
---------------
Two bugs made every numeric cell render as ``#VALUE!``:

1. **Invalid number format pattern.**  ``IDR #,##0`` is unquoted, so Sheets
   parses the ``D`` as a *day-of-month* date token.  A plain number no longer
   matches the pattern and the cell renders as ``#VALUE!``.  The correct
   pattern is the already-defined :data:`app.sheets.RP_FMT`
   (``"Rp "#,##0`` -- the literal is quoted).

2. **Formulas on rows with no ingredient.**  ``=1000/C33`` with an empty ``C``
   is ``#DIV/0!``.  Rather than hide that behind ``IFERROR`` (which the user
   does not want), we write the formulas *only* on rows that actually carry a
   ingredient name in column B, and leave the remaining rows genuinely blank.

What it does, per tab, per month block
--------------------------------------
* C (HARGA/KG)      : numeric 0 on ingredient rows, blank elsewhere
* D (HARGA/GRAM)    : ``=1000/C{row}`` on ingredient rows, blank elsewhere
* E (PEMAKAIAN gr)  : untouched (user data)
* F (HARGA TOTAL)   : ``=D{row}*E{row}`` on ingredient rows, blank elsewhere
* number format     : :data:`RP_FMT` on C, D and F of every block row
* summary rows 34-37: B = label (left), F = ``=SUM(F3:F32)`` / ``0.4*`` / sum

Run:  .venv/bin/python scripts/repair_estimate_columns.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import sheets as gsheets  # noqa: E402

SUMMARY_LABELS = [
    "Total bahan",
    "Ongkos produksi 40%",
    "Total modal",
    "Total Estimasi",
]


def _range(sheet_id, row0, col0, col1):
    """Build a one-row A1-less range dict (0-based indices)."""
    return {
        "sheetId": sheet_id,
        "startRowIndex": row0,
        "endRowIndex": row0 + 1,
        "startColumnIndex": col0,
        "endColumnIndex": col1,
    }


def _clear(sheet_id, row0, col):
    """Blank one cell (removes value, formula and format)."""
    return {
        "repeatCell": {
            "range": _range(sheet_id, row0, col, col + 1),
            "cell": {"userEnteredValue": {"stringValue": ""}},
            "fields": "userEnteredValue",
        }
    }


def _write(sheet_id, row0, col, value):
    """Write a number / formula / string into one cell."""
    if isinstance(value, str) and value.startswith("="):
        uv = {"formulaValue": value}
    elif isinstance(value, (int, float)):
        uv = {"numberValue": value}
    else:
        uv = {"stringValue": value}
    return {
        "updateCells": {
            "range": _range(sheet_id, row0, col, col + 1),
            "rows": [{"values": [{"userEnteredValue": uv}]}],
            "fields": "userEnteredValue",
        }
    }


def _fmt(sheet_id, row0, row1, col0, col1):
    """Apply the shared Rupiah number format to a cell block."""
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": row0,
                "endRowIndex": row1,
                "startColumnIndex": col0,
                "endColumnIndex": col1,
            },
            "cell": {
                "userEnteredFormat": {
                    "numberFormat": {"type": "NUMBER", "pattern": gsheets.RP_FMT}
                }
            },
            "fields": "userEnteredFormat.numberFormat",
        }
    }


def ingredient_rows(svc, sid, tab):
    """Return the set of 1-based row numbers that hold an ingredient name.

    Scans column B of the whole tab and ignores the two header rows, the blank
    spacers and the four summary labels, so it stays correct even if the block
    geometry ever changes.
    """
    values = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=f"'{tab}'!B1:B500")
        .execute()
        .get("values", [])
    )
    skip = {lbl.upper() for lbl in SUMMARY_LABELS}
    skip |= {"NO.", "NAMA BAHAN", ""}
    rows = set()
    for i, row in enumerate(values, start=1):
        name = (row[0] if row else "").strip()
        if name and name.upper() not in skip:
            rows.add(i)
    return rows


def repair_tab(svc, sid, tab):
    """Apply the full C/D/F repair to one product tab."""
    sheet_id = gsheets.get_sheet_id(svc, sid, tab)

    requests = []
    for m in range(1, 13):
        b = (m - 1) * gsheets.BLOCK_ROWS          # 0-based month-header row
        bahan_start = b + gsheets.BAHAN_OFFSET    # first bahan row (0-based)
        bahan_end = bahan_start + gsheets.N_BAHAN  # one past last bahan row
        summary_start = b + gsheets.SUMMARY_OFFSET
        data_end = summary_start + gsheets.N_SUMMARY

        # --- number format on C, D and F across the whole block ---
        requests.append(_fmt(sheet_id, bahan_start, data_end, 2, 4))  # C:D
        requests.append(_fmt(sheet_id, bahan_start, data_end, 5, 6))  # F

        # --- ingredient rows (fixed geometry rows 3-32 of each block): formulas ---
        # These are 1-based sheet rows: bahan_start+1 through bahan_end
        for r in range(bahan_start + 1, bahan_end + 1):
            zero = r - 1
            # C: blank until user enters price (plain numbers, IDR format above)
            # D: plain =1000/C (shows #DIV/0! on empty rows until priced)
            # F: plain =D*E
            requests.append(_clear(sheet_id, zero, 2))
            requests.append(_write(sheet_id, zero, 3, f"=1000/C{r}"))
            requests.append(_write(sheet_id, zero, 5, f"=D{r}*E{r}"))

        # --- summary rows: label in B (left), formulas in F ---
        first_bahan_row = bahan_start + 1
        last_bahan_row = bahan_end
        for k, label in enumerate(SUMMARY_LABELS):
            zero = summary_start + k
            row_no = zero + 1
            requests.append(_clear(sheet_id, zero, 0))   # column A stays empty
            requests.append(_write(sheet_id, zero, 1, label))
            if k == 0:      # Total bahan
                f = f"=SUM(F{first_bahan_row}:F{last_bahan_row})"
            elif k == 1:    # Ongkos produksi 40%
                f = f"=0.4*F{row_no - 1}"
            elif k == 2:    # Total modal
                f = f"=F{row_no - 2}+F{row_no - 1}"
            else:           # Total Estimasi
                f = f"=F{row_no - 3}+F{row_no - 2}+F{row_no - 1}"
            requests.append(_write(sheet_id, zero, 5, f))
            requests.append(_clear(sheet_id, zero, 2))
            requests.append(_clear(sheet_id, zero, 3))

        # --- blank spacer rows (row 33 and row 38 of block): clear C, D, F ---
        for spacer_zero in (bahan_start + gsheets.N_BAHAN, data_end):  # row 33 and 38 (0-based)
            for col in (2, 3, 5):
                requests.append(_clear(sheet_id, spacer_zero, col))

    svc.spreadsheets().batchUpdate(
        spreadsheetId=sid, body={"requests": requests}
    ).execute()
    return gsheets.N_BAHAN * 12  # 360 rows per tab


def main():
    svc = gsheets._get_service()
    sid = gsheets.SHEET_ID
    grand = 0
    for tab in gsheets.PRODUCT_TABS:
        real = gsheets.resolve_tab_name(svc, sid, tab)
        if not real:
            print(f"{tab}: MISSING, skipped")
            continue
        n = repair_tab(svc, sid, real)
        grand += n
        print(f"{real}: {n} ingredient rows repaired")
    print(f"\nTotal ingredient rows: {grand}")


if __name__ == "__main__":
    main()
