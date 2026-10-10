# RED: test HTMX UI endpoints
from fastapi.testclient import TestClient

from app.main import app, get_db


def _client():
    import sqlite3
    from app import database as dbmod

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


def test_ui_pages():
    client = _client()

    # Root redirects to inventory — don't follow
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (200, 302, 307)

    # Inventory page
    r = client.get("/ui/inventory")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    assert "Belum ada bahan" in r.text  # empty initially

    # Create via UI form
    r = client.post("/ui/inventory", data={
        "name": "Tepung Terigu",
        "qty": "10",
        "unit_cost": "15000",
    })
    assert r.status_code == 200
    assert "Tepung Terigu" in r.text

    # List shows item
    r = client.get("/ui/inventory")
    assert "Tepung Terigu" in r.text
    assert "10" in r.text
    assert "15000" in r.text


def test_ui_cogs_page():
    client = _client()

    # Add some inventory first
    client.post("/api/inventory", json={"name": "Tepung", "qty": 10, "unit_cost": 15000})
    client.post("/api/inventory", json={"name": "Gula", "qty": 5, "unit_cost": 20000})

    # COGS page
    r = client.get("/ui/cogs")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    # Should show calculator structure (GET shows input rows, summary after POST)
    assert "Kalkulator COGS" in r.text
    assert "Ringkasan COGS" in r.text
    # After POST with pemakaian should show totals
    r2 = client.post("/ui/cogs", data={
        "row_0_nama": "Tepung",
        "row_0_kg": "15000",
        "row_0_gram": "500",
        "row_1_nama": "Gula",
        "row_1_kg": "20000",
        "row_1_gram": "250",
    })
    assert r2.status_code == 200
    assert "12,500" in r2.text  # total_bahan formatted
    assert "Total Bahan" in r2.text