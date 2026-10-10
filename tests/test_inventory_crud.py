# RED: failing test for inventory CRUD API.
# Fields: name, qty, unit_cost, updated_at
from fastapi.testclient import TestClient

from app.main import app, get_db


def _client() -> TestClient:
    # Use isolated in-memory DB per test session via dependency override.
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


def test_inventory_crud():
    client = _client()

    # CREATE
    r = client.post("/api/inventory", json={
        "name": "Tepung Terigu",
        "qty": 10.0,
        "unit_cost": 15000.0,
    })
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["name"] == "Tepung terigu"
    assert created["qty"] == 10.0
    assert created["unit_cost"] == 15000.0
    assert "id" in created
    item_id = created["id"]

    # READ ALL
    r = client.get("/api/inventory")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["name"] == "Tepung terigu"

    # READ ONE
    r = client.get(f"/api/inventory/{item_id}")
    assert r.status_code == 200
    assert r.json()["id"] == item_id

    # UPDATE
    r = client.put(f"/api/inventory/{item_id}", json={
        "qty": 15.0,
        "unit_cost": 16000.0,
    })
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["qty"] == 15.0
    assert updated["unit_cost"] == 16000.0
    assert updated["name"] == "Tepung terigu"

    # DELETE
    r = client.delete(f"/api/inventory/{item_id}")
    assert r.status_code == 200

    # VERIFY DELETED
    r = client.get("/api/inventory")
    assert r.json() == []


def test_cogs_math():
    # total_bahan = sum(harga_total), ongkos = 40%, total_modal, total_estimasi
    from app.cogs import compute_cogs

    rows = [
        {"nama_bahan": "Tepung", "harga_kg": 15000.0, "pemakaian_gram": 500.0},
        {"nama_bahan": "Gula", "harga_kg": 20000.0, "pemakaian_gram": 250.0},
    ]
    out = compute_cogs(rows)
    # Tepung: 15/g * 500 = 7500; Gula: 20/g * 250 = 5000; total_bahan=12500
    assert out["total_bahan"] == 12500.0
    assert out["ongkos_produksi"] == 5000.0  # 40%
    assert out["total_modal"] == 17500.0
    assert out["rows"][0]["harga_gram"] == 15.0
    assert out["rows"][0]["harga_total"] == 7500.0
