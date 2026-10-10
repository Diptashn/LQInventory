# Tests for Google Sheets sync module
import json
import pytest
from fastapi.testclient import TestClient
from app.main import app, get_db
from app import database as dbmod
from app import sheets as gsheets


def _client():
    import sqlite3
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)

    def _override():
        try:
            yield con
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    return TestClient(app)


def test_sheet_status_endpoint():
    client = _client()
    r = client.get("/api/sheets/status")
    d = r.json()
    assert d["token_present"] is True
    assert d["sheet_id"] == "1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA"
    assert len(d["product_tabs"]) > 0


def test_parse_rp():
    assert gsheets.parse_rp(" Rp 15,000.00 ") == 15000
    assert gsheets.parse_rp(" Rp 3,500.00 ") == 3500
    assert gsheets.parse_rp(" Rp -   ") == 0
    assert gsheets.parse_rp("#N/A") == 0
    assert gsheets.parse_rp("") == 0
    assert gsheets.parse_rp(" Rp 1,186,028.80 ") == 1186028.80


def _seed_and_restore():
    """Seed a bahan row into CAKE 18 CM / Januari so the COGS tests have data.

    These tests read the LIVE Google Sheet, so they cannot rely on whatever the
    user happens to have entered. Seed one row before the test and remove it
    again afterwards, leaving the user's sheet exactly as it was.
    """
    import sqlite3
    svc = gsheets._get_service()
    sid = gsheets.SHEET_ID
    tab = gsheets.resolve_tab_name(svc, sid, "CAKE 18 CM")
    base = 1 + 0 * gsheets.BLOCK_ROWS      # Januari block header row
    row = base + 2  # first bahan row of the block
    rng = f"'{tab}'!A{row}:E{row}"
    before = svc.spreadsheets().values().get(
        spreadsheetId=sid, range=rng).execute().get("values", [])
    svc.spreadsheets().values().update(
        spreadsheetId=sid, range=rng,
        valueInputOption="USER_ENTERED",
        body={"values": [["1", "Butter Cream", 60000, 60, 100]]}).execute()

    def _cleanup():
        svc.spreadsheets().values().clear(
            spreadsheetId=sid, range=rng).execute()
        if before:
            svc.spreadsheets().values().update(
                spreadsheetId=sid, range=rng,
                valueInputOption="USER_ENTERED",
                body={"values": before}).execute()

    return _cleanup


def test_monthly_cogs_october():
    client = _client()
    cleanup = _seed_and_restore()
    try:
        r = client.get("/api/sheets/cogs/1")
        d = r.json()
        assert r.status_code == 200, r.text
        assert d["month"] == 1
        assert d["month_name"] == "Januari"
        assert "per_tab" in d
        assert "combined" in d
        assert len(d["per_tab"]) > 0
    finally:
        cleanup()


def test_sync_db_to_sheet():
    client = _client()
    cleanup = _seed_and_restore()
    try:
        # Update an existing bahan that's already in the sheet
        r = client.post("/api/inventory", json={"name": "Butter Cream", "qty": 100, "unit_cost": 88888})
        assert r.status_code == 200
        # Sync to sheet
        r = client.post("/api/sheets/sync/db-to-sheet")
        d = r.json()
        assert "cells_updated" in d
        assert d["cells_updated"] > 0, "expected the seeded Butter Cream row to be updated"
        # Verify appears in COGS (price should propagate)
        r = client.get("/api/sheets/cogs/1")
        d = r.json()
        # Find our bahan in per_tab results
        found = False
        for tab_name, tab_data in d["per_tab"].items():
            for row in tab_data["rows"]:
                if row["nama_bahan"] == "Butter Cream" and row["harga_kg"] == 88888:
                    found = True
        assert found, f"Butter Cream with price 88888 not in per_tab: {d}"
    finally:
        cleanup()