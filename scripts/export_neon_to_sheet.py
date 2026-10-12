#!/usr/bin/env python3
"""
export_neon_to_sheet.py
Export Neon DB rows from inventory_items table to Google Sheet 'Inventory' tab.

Flow:
  1. Connect to Neon (pg)
  2. Query all inventory_items
  3. Load Google token
  4. Clear Inventory tab (rows 2–1000)
  5. Write header + data
  6. Print summary

Usage:
  python3 scripts/export_neon_to_sheet.py
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Neon connection ─────────────────────────────────────────────────────
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:***@ep-flat-mountain-b3y8z56k-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
)

# ── Google Sheets config ────────────────────────────────────────────────
SHEET_ID = "1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA"
TARGET_TAB = "Inventory"

TOKEN_PATH = Path("/opt/data/profiles/developer/google_token.json")


def get_db_rows():
    """Query all inventory_items from Neon."""
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(DATABASE_URL, sslmode="require", channel_binding="require")
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, entry_date, product_name, quantity, unit_cost, notes, created_at
            FROM inventory_items
            ORDER BY created_at DESC
            """
        )
        return cur.fetchall()
    finally:
        conn.close()


def get_sheets_service():
    """Return a Google Sheets v4 service object."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    if not TOKEN_PATH.exists():
        raise FileNotFoundError(f"Google token not found at {TOKEN_PATH}")

    with open(TOKEN_PATH) as f:
        token_data = json.load(f)

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), scopes)
    return build("sheets", "v4", credentials=creds)


def main():
    print("Step 1: Querying Neon database…")
    rows = get_db_rows()
    print(f"  → {len(rows)} rows found")
    if not rows:
        print("No rows to export. Done.")
        return

    print(f"Step 2: Connecting to Google Sheets (tab: {TARGET_TAB})…")
    svc = get_sheets_service()

    # Resolve real tab title (case-insensitive)
    meta = svc.spreadsheets().get(
        spreadsheetId=SHEET_ID, fields="sheets.properties.title"
    ).execute()
    titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
    target_tab = None
    for t in titles:
        if t.lower() == TARGET_TAB.lower():
            target_tab = t
            break
    if not target_tab:
        raise RuntimeError(f"Tab '{TARGET_TAB}' not found. Available: {titles}")

    print(f"  → Resolved tab title: '{target_tab}'")

    # Build data rows: header + data
    header = ["ID", "Entry Date", "Product Name", "Quantity", "Unit Cost", "Notes", "Created At"]
    data_rows = []
    for r in rows:
        data_rows.append([
            str(r["id"]),
            str(r["entry_date"]),
            r["product_name"],
            str(r["quantity"]),
            str(r["unit_cost"]),
            r.get("notes") or "",
            str(r["created_at"]),
        ])

    # Step 3: Clear existing data (rows 2 through 1000)
    print("Step 3: Clearing existing data in Inventory tab…")
    svc.spreadsheets().values().clear(
        spreadsheetId=SHEET_ID,
        range=f"'{target_tab}'!A2:G1000",
    ).execute()

    # Step 4: Write header
    print("Step 4: Writing header…")
    header_body = {
        "valueInputOption": "USER_ENTERED",
        "data": [{"range": f"'{target_tab}'!A1:G1", "values": [header]}],
    }
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=SHEET_ID, body=header_body
    ).execute()

    # Step 5: Write data rows
    if data_rows:
        print(f"Step 5: Writing {len(data_rows)} data rows…")
        data_body = {
            "valueInputOption": "USER_ENTERED",
            "data": [{
                "range": f"'{target_tab}'!A2:G{len(data_rows) + 1}",
                "values": data_rows,
            }],
        }
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=SHEET_ID, body=data_body
        ).execute()
    else:
        print("No data rows to write.")

    print("Done.")
    print(f"  → {len(data_rows)} rows exported to '{target_tab}' tab")
    print(f"  → Sheet URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}")


if __name__ == "__main__":
    main()
